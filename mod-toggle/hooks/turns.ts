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

// startedAt is when Claude asked for the call, endedAt when its result came back, both epoch ms.
export type ToolCall = { id: string; name: string; input: any; added: number; removed: number; startedAt?: number; endedAt?: number }

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
export function diffStat(name: string, input: any, output: any): { added: number; removed: number } {
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

// Reads the transcript a line at a time, in file order, so a re-read feeds only the new lines.
export class TurnLog {
  turns: Turn[] = []
  private byId = new Map<string, Turn>()
  private calls = new Map<string, ToolCall>()

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
        if (block?.type === 'text' && typeof block.text === 'string' && block.text.trim()) current.reply = rowKey(row.uuid)
        if (block?.type === 'tool_use' && typeof block.id === 'string') {
          const call: ToolCall = { id: block.id, name: String(block.name), input: block.input, added: 0, removed: 0, startedAt: timeOf(row) }
          current.tools.push(call)
          this.calls.set(block.id, call)
          this.add(current, block.id)
        }
      }
      return
    }
    if (row.type === 'user' && Array.isArray(content)) {
      this.add(current, rowKey(row.uuid))
      for (const block of content) {
        const call = block?.type === 'tool_result' ? this.calls.get(block.tool_use_id) : undefined
        if (call) Object.assign(call, diffStat(call.name, call.input, row.toolUseResult), { endedAt: timeOf(row) })
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
  claimCall(id: string, name: string, input: any, isRunning: boolean, output: any, at = Date.now()) {
    let call = this.calls.get(id)
    if (!call) {
      const current = this.turns[this.turns.length - 1]
      if (!current) return
      call = { id, name, input, added: 0, removed: 0, startedAt: at }
      current.tools.push(call)
      this.calls.set(id, call)
      this.add(current, id)
    }
    if (!isRunning && call.endedAt === undefined) Object.assign(call, diffStat(name, input, output), { endedAt: at })
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
  if (name === 'Edit' || name === 'MultiEdit' || name === 'Write' || name === 'NotebookEdit') return `${name}(${tail(input?.file_path ?? input?.notebook_path)})${stat}`
  if (name === 'Skill') return `Skill(${input?.skill ?? '?'})`
  if (name === 'Agent' || name === 'Task') return `Agent(${input?.description ?? input?.subagent_type ?? '?'})`
  if (name === 'Bash') return `Bash(${String(input?.command ?? '').split('\n')[0]})`
  if (name === 'Read') return `Read(${tail(input?.file_path)})`
  return name
}

const clock = (ms: number) => {
  const seconds = Math.round(ms / 1000)
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

const two = (n: number) => String(n).padStart(2, '0')

// Local wall-clock time: `14:32` for a prompt, `14:32:05` for a tool call.
export const timeOfDay = (at: number, withSeconds = false) => {
  const date = new Date(at)
  const time = `${two(date.getHours())}:${two(date.getMinutes())}`
  return withSeconds ? `${time}:${two(date.getSeconds())}` : time
}

// How long a call took: `0.4s` under a second, then `41s`, `6m 12s`, `1h 3m`.
export const elapsed = (ms: number) => {
  if (ms < 1000) return `${(Math.max(0, ms) / 1000).toFixed(1)}s`
  const seconds = Math.round(ms / 1000)
  if (seconds < 3600) return clock(ms)
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`
}

// A call's start and duration for its line, or nothing while either end is unknown.
export const callTime = (call: ToolCall | undefined) =>
  call?.startedAt === undefined || call.endedAt === undefined ? '' : `${timeOfDay(call.startedAt, true)} · ${elapsed(call.endedAt - call.startedAt)}`

// The folded turn's line: tool count, then each file change, skill and agent, then the time it took.
export function turnSummary(turn: Turn) {
  const named = turn.tools.filter(call => ['Edit', 'MultiEdit', 'Write', 'NotebookEdit', 'Skill', 'Agent', 'Task'].includes(call.name))
  const parts = [`${turn.tools.length} tool${turn.tools.length === 1 ? '' : 's'}`, ...named.map(call => toolLabel(call.name, call.input, call.added, call.removed))]
  if (turn.durationMs !== undefined) parts.push(clock(turn.durationMs))
  return parts.join(' · ')
}
