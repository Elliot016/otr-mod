// What the sidebar keeps of a transcript row; tool results and replies are most of the bytes and are dropped here.
export type Row = {
  uuid: string
  parent?: string
  isSidechain: boolean
  // The prompt's text when the row is one, else undefined.
  prompt?: string
  at?: string
}

export type Prompt = { id: string; text: string; at?: string }

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
  // A prompt typed while a turn ran is stored as a queued_command attachment, not a user row.
  if (row.type === 'attachment' && row.attachment?.type === 'queued_command' && typeof row.attachment.prompt === 'string') {
    return { ...base, prompt: promptText(row.attachment.prompt) }
  }
  if (row.type !== 'user' || row.isMeta || row.isCompactSummary || row.message?.role !== 'user') return base
  const content = row.message.content
  if (Array.isArray(content) && content.some((block: any) => block?.type === 'tool_result')) return base
  const text =
    typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content.filter((block: any) => block?.type === 'text' && typeof block.text === 'string').map((block: any) => block.text).join('\n')
        : ''
  return { ...base, prompt: promptText(text) }
}

// The prompts on the live branch, oldest first: the parent chain from the last row, so /rewind's abandoned rows drop out.
export function promptsOf(rows: Row[]): Prompt[] {
  const byId = new Map(rows.map(row => [row.uuid, row]))
  const live = new Set<string>()
  let row = [...rows].reverse().find(candidate => !candidate.isSidechain)
  while (row && !live.has(row.uuid)) {
    live.add(row.uuid)
    row = row.parent ? byId.get(row.parent) : undefined
  }
  return rows.filter(candidate => live.has(candidate.uuid) && candidate.prompt).map(candidate => ({ id: candidate.uuid, text: candidate.prompt!, at: candidate.at }))
}

// A message drawn as several rows gets ids that keep its uuid's first four groups, so rows match on those.
export const rowKey = (id: string) => (UUID.test(id) ? id.slice(0, 24) : id)

// The id a jump scrolls to: the row as Claude Code last drew it, else the message's own uuid.
export const targetOf = (drawn: Map<string, string>, id: string) => drawn.get(rowKey(id)) ?? id
