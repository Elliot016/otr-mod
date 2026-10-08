// What the sidebar keeps of a transcript row; tool results and replies are most of the bytes and are dropped here.
export type Row = {
  uuid: string
  parent?: string
  isSidechain: boolean
  // The prompt's text when the row is one, else undefined.
  prompt?: string
  // A prompt typed while a turn ran, which the file keeps as a queued command.
  isQueued?: boolean
  // A subagent's report: a row that opens a turn of its own, which is no prompt.
  isReport?: boolean
  at?: string
  // What the row adds to its turn: tool calls a reply makes, lines a tool result changed, the turn's length.
  tools?: number
  added?: number
  removed?: number
  durationMs?: number
}

export type Prompt = { id: string; text: string; at?: string; tools: number; added: number; removed: number; durationMs?: number; isQueued?: boolean }

// Lines a successful edit or new file changed; a failed tool result changed nothing, so it counts nothing.
function changedLines(row: any) {
  const content = row.message?.content
  if (Array.isArray(content) && content.some((block: any) => block?.type === 'tool_result' && block.is_error === true)) return {}
  const result = row.toolUseResult
  let added = 0
  let removed = 0
  for (const hunk of Array.isArray(result?.structuredPatch) ? result.structuredPatch : []) {
    for (const line of Array.isArray(hunk?.lines) ? hunk.lines : []) {
      if (typeof line !== 'string') continue
      if (line.startsWith('+')) added++
      else if (line.startsWith('-')) removed++
    }
  }
  // A new file has no patch, only its content.
  if (result?.type === 'create' && added === 0 && typeof result.content === 'string') added = result.content.split('\n').length
  return added || removed ? { added, removed } : {}
}

// Rows Claude Code wraps around commands, hooks and notices; none is a prompt.
const WRAPPER = /^<(command-|local-command-|bash-|system-reminder|task-notification|user-prompt-submit-hook)/
const INTERRUPTED = /^\[Request interrupted by user/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const promptText = (text: string) => {
  const trimmed = text.trim()
  return trimmed && !WRAPPER.test(trimmed) && !INTERRUPTED.test(trimmed) && !trimmed.startsWith('/') ? trimmed : undefined
}

export function parseRow(line: string): Row | undefined {
  let row: any
  try {
    row = JSON.parse(line)
  } catch {
    return undefined
  }
  if (typeof row?.uuid !== 'string') return undefined
  const base = {
    uuid: row.uuid,
    parent: row.parentUuid ?? row.logicalParentUuid ?? undefined,
    isSidechain: row.isSidechain === true,
    at: typeof row.timestamp === 'string' ? row.timestamp : undefined,
  }
  // A prompt typed while a turn ran is stored as a queued_command attachment, not a user row; a meta one is a note the harness queued.
  if (row.type === 'attachment' && row.attachment?.type === 'queued_command' && typeof row.attachment.prompt === 'string') {
    if (row.attachment.isMeta === true) return base
    return { ...base, prompt: promptText(row.attachment.prompt), isQueued: true }
  }
  if (row.type === 'system' && row.subtype === 'turn_duration' && typeof row.durationMs === 'number') return { ...base, durationMs: row.durationMs }
  if (row.type === 'user' && row.isMeta === true && row.origin?.kind === 'peer') return { ...base, isReport: true }
  if (row.type === 'assistant' && Array.isArray(row.message?.content)) {
    const tools = row.message.content.filter((block: any) => block?.type === 'tool_use').length
    return tools ? { ...base, tools } : base
  }
  if (row.type !== 'user' || row.isMeta || row.isCompactSummary || row.message?.role !== 'user') return base
  const content = row.message.content
  if (Array.isArray(content) && content.some((block: any) => block?.type === 'tool_result')) return { ...base, ...changedLines(row) }
  const text =
    typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content.filter((block: any) => block?.type === 'text' && typeof block.text === 'string').map((block: any) => block.text).join('\n')
        : ''
  return { ...base, prompt: promptText(text) }
}

// The prompts on the live branch, oldest first; a report or an abandoned prompt opens a turn that lists nothing, as turns.ts does.
export function promptsOf(rows: Row[]): Prompt[] {
  const byId = new Map(rows.filter(row => !row.isSidechain).map(row => [row.uuid, row]))
  const live = new Set<string>()
  let row = [...rows].reverse().find(candidate => !candidate.isSidechain)
  while (row && !live.has(row.uuid)) {
    live.add(row.uuid)
    row = row.parent ? byId.get(row.parent) : undefined
  }
  const prompts: Prompt[] = []
  // The prompt the rows after it belong to, in file order; undefined after a report or an abandoned prompt.
  let turn: Prompt | undefined
  for (const candidate of rows) {
    if (candidate.isSidechain) continue
    if (candidate.isReport) {
      turn = undefined
      continue
    }
    if (candidate.prompt) {
      turn = live.has(candidate.uuid) ? { id: candidate.uuid, text: candidate.prompt, at: candidate.at, tools: 0, added: 0, removed: 0, isQueued: candidate.isQueued === true } : undefined
      if (turn) prompts.push(turn)
      continue
    }
    if (!turn) continue
    turn.tools += candidate.tools ?? 0
    turn.added += candidate.added ?? 0
    turn.removed += candidate.removed ?? 0
    if (candidate.durationMs !== undefined) turn.durationMs = (turn.durationMs ?? 0) + candidate.durationMs
  }
  return prompts
}

// Parses a growing transcript a feed at a time; a torn last line waits for the next feed.
export class TranscriptRows {
  rows: Row[] = []
  private parsed = 0

  feed(text: string) {
    const end = text.lastIndexOf('\n') + 1
    if (end < this.parsed) {
      this.rows = []
      this.parsed = 0
    }
    const lines = text.slice(this.parsed, end).split('\n').filter(line => line.trim())
    this.parsed = end
    for (const line of lines) {
      const row = parseRow(line)
      if (row) this.rows.push(row)
    }
    return lines.length
  }
}

// A message drawn as several rows gets ids that keep its uuid's first four groups, so rows match on those.
export const rowKey = (id: string) => (UUID.test(id) ? id.slice(0, 24) : id)

// The id a jump scrolls to: the row as Claude Code last drew it, else the message's own uuid.
export const targetOf = (drawn: Map<string, string>, id: string) => drawn.get(rowKey(id)) ?? id
