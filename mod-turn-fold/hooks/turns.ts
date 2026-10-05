import text from './text'
import { fill } from './theme'

// One prompt and everything Claude drew after it, up to the next prompt.
export type Turn = {
  prompt: string
  // Drawn row ids that belong to the turn: row keys of messages, tool_use ids of tool rows.
  ids: Set<string>
  // Row key of the turn's last text block, which stays visible when the turn folds.
  reply?: string
  tools: ToolCall[]
  durationMs?: number
  // When the prompt was sent, in epoch ms.
  at?: number
}

// Times in epoch ms; thought is the thinking just before the call, empty when it kept no text.
export type ToolCall = { id: string; name: string; input: any; added: number; removed: number; startedAt?: number; endedAt?: number; thought?: string; preview?: Preview }

// What an opened call shows under its line: a diff's lines, or the start of what the call gave back, and how many lines were left out.
export type PreviewLine = { text: string; kind: 'add' | 'del' | 'same' | 'out' }
export type Preview = { lines: PreviewLine[]; more: number }

// The thinking since the last result or text, carried block by block: thinking adds its text, text ends it.
const thoughtAfter = (pending: string | undefined, block: any) => {
  if (block?.type === 'thinking') return [pending, typeof block.thinking === 'string' ? block.thinking.trim() : ''].filter(Boolean).join('\n\n')
  if (block?.type === 'redacted_thinking') return pending ?? ''
  if (block?.type === 'text' && typeof block.text === 'string' && block.text.trim()) return undefined
  return pending
}

const WRAPPER = /^<(command-|local-command-|bash-|system-reminder|task-notification|user-prompt-submit-hook)/
const INTERRUPTED = /^\[Request interrupted by user/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// A message drawn as several rows gets ids that keep its uuid's first four groups, so rows match on those.
export const rowKey = (id: string) => (UUID.test(id) ? id.slice(0, 24) : id)

export const isPrompt = (text: string) => {
  const trimmed = text.trim()
  return Boolean(trimmed) && !WRAPPER.test(trimmed) && !INTERRUPTED.test(trimmed) && !trimmed.startsWith('/')
}

const timeOf = (row: any) => {
  const at = Date.parse(String(row?.timestamp ?? ''))
  return Number.isNaN(at) ? undefined : at
}

const userText = (content: unknown) =>
  typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.filter((block: any) => block?.type === 'text' && typeof block.text === 'string').map((block: any) => block.text).join('\n')
      : ''

// Lines a file edit added and removed, from the result Claude Code stored for it.
// A failed call changed nothing, so it counts nothing, even a Write whose content never reached the file.
export function diffStat(name: string, input: any, output: any, isFailed = false): { added: number; removed: number } {
  if (isFailed) return { added: 0, removed: 0 }
  const patch = Array.isArray(output?.structuredPatch) ? output.structuredPatch : []
  let added = 0
  let removed = 0
  for (const hunk of patch) {
    for (const line of Array.isArray(hunk?.lines) ? hunk.lines : []) {
      if (typeof line !== 'string') continue
      if (line.startsWith('+')) added++
      else if (line.startsWith('-')) removed++
    }
  }
  // A new file has no patch, only its content.
  if (name === 'Write' && patch.length === 0 && typeof input?.content === 'string') added = input.content.split('\n').length
  return { added, removed }
}

const PREVIEW_LINES = 8

const capped = (lines: PreviewLine[]): Preview => ({ lines: lines.slice(0, PREVIEW_LINES), more: Math.max(0, lines.length - PREVIEW_LINES) })

// The text a result block carries: a plain string, or its text parts.
export const resultText = (content: unknown) =>
  typeof content === 'string' ? content : Array.isArray(content) ? content.filter((part: any) => part?.type === 'text').map((part: any) => String(part.text ?? '')).join('\n') : ''

// The text a drawn row's output holds, for a call whose result the transcript has not given yet.
const outputText = (output: any) =>
  [output?.stdout, output?.stderr, output?.file?.content, typeof output?.content === 'string' ? output.content : '', Array.isArray(output?.filenames) ? output.filenames.join('\n') : '']
    .filter((part): part is string => typeof part === 'string' && part.trim() !== '')
    .join('\n')

// An edit shows its patch, a new file its content as added lines; any other call the start of its result.
export function previewOf(name: string, input: any, output: any, text: string): Preview {
  const patch = Array.isArray(output?.structuredPatch) ? output.structuredPatch : []
  const diff: PreviewLine[] = patch.flatMap((hunk: any) =>
    (Array.isArray(hunk?.lines) ? hunk.lines : []).filter((line: unknown) => typeof line === 'string').map((line: string) => ({
      text: line.slice(1),
      kind: line.startsWith('+') ? 'add' : line.startsWith('-') ? 'del' : 'same',
    })),
  )
  if (diff.length) return capped(diff)
  if (name === 'Write' && typeof input?.content === 'string') return capped(input.content.split('\n').map((line: string) => ({ text: line, kind: 'add' as const })))
  const body = (text || outputText(output)).replace(/\s+$/, '')
  return capped(body ? body.split('\n').map(line => ({ text: line, kind: 'out' as const })) : [])
}

// Reads the transcript a line at a time, in file order, so a re-read feeds only the new lines.
export class TurnLog {
  turns: Turn[] = []
  private byId = new Map<string, Turn>()
  private calls = new Map<string, ToolCall>()
  private thinking: string | undefined

  feed(line: string) {
    let row: any
    try {
      row = JSON.parse(line)
    } catch {
      return
    }
    if (typeof row?.uuid !== 'string' || row.isSidechain === true) return
    const content = row.message?.content
    const current = this.turns[this.turns.length - 1]

    // A subagent's report is a meta row, yet Claude answers it in a turn of its own.
    if (row.type === 'user' && row.isMeta && row.origin?.kind === 'peer') {
      this.start(row.uuid, timeOf(row))
      return
    }
    if (row.type === 'user' && !row.isMeta && !row.isCompactSummary && !(Array.isArray(content) && content.some((block: any) => block?.type === 'tool_result'))) {
      if (isPrompt(userText(content))) this.start(row.uuid, timeOf(row))
      return
    }
    // A meta queued command is a report delivered mid-turn, which stays in the running turn.
    if (row.type === 'attachment' && row.attachment?.type === 'queued_command' && typeof row.attachment.prompt === 'string') {
      if (!row.attachment.isMeta && isPrompt(row.attachment.prompt)) this.start(row.uuid, timeOf(row))
      return
    }
    if (!current) return

    if (row.type === 'assistant' && Array.isArray(content)) {
      this.add(current, rowKey(row.uuid))
      for (const block of content) {
        this.thinking = thoughtAfter(this.thinking, block)
        if (block?.type === 'text' && typeof block.text === 'string' && block.text.trim()) current.reply = rowKey(row.uuid)
        if (block?.type === 'tool_use' && typeof block.id === 'string') {
          const call: ToolCall = { id: block.id, name: String(block.name), input: block.input, added: 0, removed: 0, startedAt: timeOf(row), thought: this.thinking }
          current.tools.push(call)
          this.calls.set(block.id, call)
          this.add(current, block.id)
        }
      }
      return
    }
    if (row.type === 'user' && Array.isArray(content)) {
      this.add(current, rowKey(row.uuid))
      this.thinking = undefined
      for (const block of content) {
        const call = block?.type === 'tool_result' ? this.calls.get(block.tool_use_id) : undefined
        if (call) Object.assign(call, diffStat(call.name, call.input, row.toolUseResult, block.is_error === true), { endedAt: timeOf(row), preview: previewOf(call.name, call.input, row.toolUseResult, resultText(block.content)) })
      }
      return
    }
    if (row.type === 'system') {
      this.add(current, rowKey(row.uuid))
      if (row.subtype === 'turn_duration' && typeof row.durationMs === 'number') current.durationMs = row.durationMs
    }
  }

  // A row drawn after the transcript was read: a new prompt opens a turn, any other row joins the latest one.
  claim(requestId: string, kind: 'prompt' | 'reply' | 'row', at = Date.now()) {
    if (this.turnOf(requestId) || this.turnAt(requestId)) return
    if (kind === 'prompt') {
      this.start(requestId, at)
      return
    }
    const current = this.turns[this.turns.length - 1]
    if (!current) return
    this.add(current, rowKey(requestId))
    if (kind === 'reply') current.reply = rowKey(requestId)
  }

  // A tool row drawn after the transcript was read: the call joins the latest turn, and ends once its row stops running.
  claimCall(id: string, name: string, input: any, isRunning: boolean, output: any, isFailed = false, at = Date.now()) {
    let call = this.calls.get(id)
    if (!call) {
      const current = this.turns[this.turns.length - 1]
      if (!current) return
      // A call first seen finished has no start this mod saw, so it shows no time rather than a false one.
      call = { id, name, input, added: 0, removed: 0, startedAt: isRunning ? at : undefined }
      current.tools.push(call)
      this.calls.set(id, call)
      this.add(current, id)
    }
    // A row first draws while its input still streams in, so a later, fuller input replaces the first.
    if (input && Object.keys(input).length >= Object.keys(call.input ?? {}).length) call.input = input
    if (isRunning) return
    if (call.endedAt === undefined) call.endedAt = at
    // A group's copy of the output may lack the patch its own row carries, so any later count fills in.
    const stat = diffStat(name, call.input, output, isFailed)
    if (stat.added || stat.removed || isFailed) Object.assign(call, stat)
    if (!call.preview?.lines.length) call.preview = previewOf(name, call.input, output, '')
  }

  // Calls claimed as they drew have no thought yet; the session's own messages, read once a turn ends, carry the thinking before each.
  learnThoughts(messages: readonly { role: string; content: readonly any[] }[]) {
    let pending: string | undefined
    for (const message of messages) {
      if (message.role !== 'assistant') {
        pending = undefined
        continue
      }
      for (const block of message.content) {
        pending = thoughtAfter(pending, block)
        const call = block?.type === 'tool_use' ? this.calls.get(block.id) : undefined
        if (call && call.thought === undefined) call.thought = pending
      }
    }
  }

  // The turn a drawn row belongs to.
  turnOf(requestId: string) {
    // A folded group of calls is drawn under its first message's uuid, prefixed.
    const id = requestId.replace(/^collapsed-/, '')
    return this.byId.get(id) ?? this.byId.get(rowKey(id))
  }

  callOf(toolUseId: string) {
    return this.calls.get(toolUseId)
  }

  // The turn a prompt row opens.
  turnAt(requestId: string) {
    const key = rowKey(requestId)
    return this.turns.find(turn => rowKey(turn.prompt) === key)
  }

  private start(uuid: string, at: number | undefined) {
    const turn: Turn = { prompt: uuid, ids: new Set(), tools: [], at }
    this.turns.push(turn)
    this.thinking = undefined
  }

  private add(turn: Turn, id: string) {
    turn.ids.add(id)
    this.byId.set(id, turn)
  }
}

const tail = (path: string) => String(path ?? '').replace(/\\/g, '/').split('/').filter(Boolean).slice(-2).join('/')

// The one line a folded tool row shows: `Edit(hooks/register.tsx) +3 -1`, `Skill(tidy)`, `Agent(Research docs)`.
export function toolLabel(name: string, input: any, added: number, removed: number) {
  const stat = added || removed ? ` +${added} \u2212${removed}` : ''
  // An input not known yet shows the bare name, never empty parentheses.
  const call = (label: string, detail: unknown) => (detail ? `${label}(${detail})` : label)
  if (name === 'Edit' || name === 'MultiEdit' || name === 'Write' || name === 'NotebookEdit') return `${call(name, tail(input?.file_path ?? input?.notebook_path))}${stat}`
  if (name === 'Skill') return call('Skill', input?.skill)
  if (name === 'Agent' || name === 'Task') return call('Agent', input?.description ?? input?.subagent_type)
  if (name === 'Bash') return call('Bash', String(input?.command ?? '').split('\n')[0])
  if (name === 'Read') return call('Read', tail(input?.file_path))
  return name
}

const clock = (ms: number) => {
  const seconds = Math.round(ms / 1000)
  return seconds < 60 ? fill(text.durationSeconds, { s: seconds }) : fill(text.durationMinutes, { m: Math.floor(seconds / 60), s: seconds % 60 })
}

const two = (n: number) => String(n).padStart(2, '0')

// Local wall-clock time, `14:32`, for a prompt and a tool call alike.
export const timeOfDay = (at: number) => {
  const date = new Date(at)
  return `${two(date.getHours())}:${two(date.getMinutes())}`
}

// How long a call took: `0.4s` under a second, then `41s`, `6m 12s`, `1h 3m`.
export const elapsed = (ms: number) => {
  if (ms < 1000) return fill(text.durationSeconds, { s: (Math.max(0, ms) / 1000).toFixed(1) })
  const seconds = Math.round(ms / 1000)
  if (seconds < 3600) return clock(ms)
  return fill(text.durationHours, { h: Math.floor(seconds / 3600), m: Math.floor((seconds % 3600) / 60) })
}

// A call's start and duration for its line, or nothing while either end is unknown.
export const callTime = (call: ToolCall | undefined) =>
  call?.startedAt === undefined || call.endedAt === undefined ? '' : `${timeOfDay(call.startedAt)} · ${elapsed(call.endedAt - call.startedAt)}`

// The head's words: tool count, then each file changed, skill and agent once; counts and the time draw as pills beside it.
export function turnLine(turn: Turn) {
  const named = turn.tools.filter(call => ['Edit', 'MultiEdit', 'Write', 'NotebookEdit', 'Skill', 'Agent', 'Task'].includes(call.name))
  return [fill(turn.tools.length === 1 ? text.toolCountOne : text.toolCountMany, { n: turn.tools.length }), ...new Set(named.map(call => toolLabel(call.name, call.input, 0, 0)))].join(' · ')
}

export type Kind = 'read' | 'search' | 'edit' | 'shell' | 'web' | 'agent' | 'tool'

const KIND_OF: Record<string, Kind> = {
  Read: 'read',
  Grep: 'search',
  Glob: 'search',
  Edit: 'edit',
  MultiEdit: 'edit',
  Write: 'edit',
  NotebookEdit: 'edit',
  Bash: 'shell',
  PowerShell: 'shell',
  WebFetch: 'web',
  WebSearch: 'web',
  Agent: 'agent',
  Task: 'agent',
}

const KIND_LABEL = (kind: Kind, n: number) => fill(n === 1 ? text.kind[kind].one : text.kind[kind].many, { n })

// A finished turn's calls, one group per kind in order of first use, with the group's line counts.
export function turnKinds(turn: Turn) {
  const groups = new Map<Kind, ToolCall[]>()
  for (const call of turn.tools) {
    const kind = KIND_OF[call.name] ?? 'tool'
    groups.set(kind, [...(groups.get(kind) ?? []), call])
  }
  return [...groups].map(([kind, calls]) => ({
    kind,
    label: KIND_LABEL(kind, calls.length),
    calls,
    added: calls.reduce((sum, call) => sum + call.added, 0),
    removed: calls.reduce((sum, call) => sum + call.removed, 0),
  }))
}

// What Claude thought across a turn, once per thinking: calls asked in parallel share one.
export const turnThoughts = (turn: Turn) => [...new Set(turn.tools.filter(call => call.thought !== undefined).map(call => call.thought!))]
