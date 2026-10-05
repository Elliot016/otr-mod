import { commit, diffLines, emptyLog, relPath, touch, type Kind, type Line, type Log } from './tree'

// What a call does to which file: the live hook and the transcript parse both reduce a call to this.
export type Plan = { path: string; tool: string; kind: Kind; note: string; lines: Line[] }

const WRAPPER = /^<(command-|local-command-|bash-|system-reminder|task-notification|user-prompt-submit-hook)/
const INTERRUPTED = /^\[Request interrupted by user/

const isPrompt = (text: string) => {
  const trimmed = text.trim()
  return Boolean(trimmed) && !WRAPPER.test(trimmed) && !INTERRUPTED.test(trimmed) && !trimmed.startsWith('/')
}

const userText = (content: unknown) =>
  typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.filter((block: any) => block?.type === 'text' && typeof block.text === 'string').map((block: any) => block.text).join('\n')
      : ''

// Claude Code stores each edit's hunks; their lines carry the diff sign as the first character.
export function patchLines(patch: unknown): Line[] | undefined {
  if (!Array.isArray(patch) || patch.length === 0) return undefined
  const out: Line[] = []
  patch.forEach((hunk: any, at) => {
    if (at > 0) out.push({ op: '~', t: '...' })
    for (const line of Array.isArray(hunk?.lines) ? hunk.lines : []) {
      if (typeof line !== 'string') continue
      const sign = line[0]
      out.push({ op: sign === '+' ? '+' : sign === '-' ? '-' : ' ', t: line.slice(1) })
    }
  })
  return out
}

// The plan of one tool_use as the transcript recorded it, without the result yet.
export function planOfUse(name: string, input: any, cwd: string): Plan | undefined {
  const at = (path: unknown) => relPath(cwd, String(path))
  if (name === 'Read' && input?.file_path) return { path: at(input.file_path), tool: 'Read', kind: 'read', note: '', lines: [] }
  if ((name === 'Edit' || name === 'MultiEdit') && input?.file_path) {
    return { path: at(input.file_path), tool: name, kind: 'edit', note: input.replace_all ? 'replace all' : '', lines: diffLines(String(input.old_string ?? ''), String(input.new_string ?? '')) }
  }
  if (name === 'NotebookEdit' && input?.notebook_path) {
    return { path: at(input.notebook_path), tool: name, kind: 'edit', note: `${String(input.edit_mode ?? 'replace')} cell`, lines: diffLines('', String(input.new_source ?? '')) }
  }
  if (name === 'Write' && input?.file_path) return { path: at(input.file_path), tool: 'Write', kind: 'write', note: 'rewrite', lines: diffLines('', String(input.content ?? '')) }
  return undefined
}

// The files a shell command changed, as Claude Code diffed them: hunks when it kept them, else only the names.
export function shellPlans(diff: any, cwd: string): Plan[] {
  if (!diff || diff.unavailable || diff.skipped) return []
  const at = (path: unknown) => relPath(cwd, String(path))
  const shown: Plan[] = (Array.isArray(diff.files) ? diff.files : []).map((file: any) => ({
    path: at(file.filePath),
    tool: 'Bash',
    kind: file.created ? 'new' : 'edit',
    note: file.created ? 'new file' : file.deleted ? 'deleted' : 'shell',
    lines: patchLines(file.hunks) ?? [],
  }))
  const named = (Array.isArray(diff.changedFiles) ? diff.changedFiles : []).map((path: unknown) => at(path)).filter((path: string) => !shown.some(plan => plan.path === path))
  return [...shown, ...named.map((path: string): Plan => ({ path, tool: 'Bash', kind: 'edit', note: 'shell, no diff kept', lines: [] }))]
}

// Builds the tree and the replay from the transcript, a line at a time, so a re-read feeds only the new lines.
export class TranscriptFiles {
  log: Log = emptyLog()
  private open = new Map<string, Plan>()
  private shells = new Set<string>()

  constructor(private cwd: string) {}

  feed(line: string) {
    let row: any
    try {
      row = JSON.parse(line)
    } catch {
      return
    }
    if (typeof row?.uuid !== 'string' || row.isSidechain === true) return
    const content = row.message?.content

    // A prompt, or a subagent's report that Claude answers in a turn of its own, starts a turn.
    const isPeer = row.type === 'user' && row.isMeta && row.origin?.kind === 'peer'
    const isTyped = row.type === 'user' && !row.isMeta && !row.isCompactSummary && !(Array.isArray(content) && content.some((block: any) => block?.type === 'tool_result')) && isPrompt(userText(content))
    const isQueued = row.type === 'attachment' && row.attachment?.type === 'queued_command' && !row.attachment.isMeta && isPrompt(String(row.attachment.prompt ?? ''))
    if (isPeer || isTyped || isQueued) {
      this.log = { ...this.log, turn: this.log.turn + 1 }
      return
    }

    if (row.type === 'assistant' && Array.isArray(content)) {
      for (const block of content) {
        if (block?.type !== 'tool_use' || typeof block.id !== 'string') continue
        if (block.name === 'Bash') this.shells.add(block.id)
        const plan = planOfUse(String(block.name), block.input, this.cwd)
        if (!plan) continue
        this.open.set(block.id, plan)
        this.log = touch(this.log, plan.path, plan.kind)
      }
      return
    }

    if (row.type === 'user' && Array.isArray(content)) {
      for (const block of content) {
        if (block?.type === 'tool_result' && this.shells.delete(block.tool_use_id)) {
          for (const shell of shellPlans(row.toolUseResult?.bashEditDiff, this.cwd)) {
            this.log = touch(this.log, shell.path, shell.kind)
            this.log = commit(this.log, shell.path, shell.tool, shell.kind, shell.note, shell.lines)
          }
          continue
        }
        const plan = block?.type === 'tool_result' ? this.open.get(block.tool_use_id) : undefined
        if (!plan) continue
        this.open.delete(block.tool_use_id)
        if (block.is_error === true || plan.kind === 'read') continue
        const result = row.toolUseResult
        const isNew = plan.tool === 'Write' && result?.type === 'create'
        const kind: Kind = isNew ? 'new' : plan.kind
        if (isNew) this.log = touch(this.log, plan.path, 'new')
        const note = isNew ? 'new file' : plan.note
        const lines = isNew ? diffLines('', String(result?.content ?? '')) : patchLines(result?.structuredPatch) ?? plan.lines
        this.log = commit(this.log, plan.path, plan.tool, kind, note, lines)
      }
    }
  }
}
