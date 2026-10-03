export const DEFAULT_WORDS = 400

export const clampWords = (value: unknown) => {
  const words = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : DEFAULT_WORDS
  return Math.min(2000, Math.max(100, words))
}

// The skill file without its front matter.
export const skillBody = (text: string) => text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').trim()

export const buildPrompt = (skillText: string, words: number) =>
  `${skillBody(skillText)}\n\nWrite the handoff for this conversation now. The cap for this run is ${words} words, which replaces any other cap above.`

// A handoff waits in the store across the clear; an old one is stale and ignored.
export const PENDING_MAX_AGE_MS = 120_000

export type Pending = { text: string; at: number }

export const isFresh = (pending: unknown, now: number): pending is Pending => {
  const item = pending as Pending | null | undefined
  return typeof item?.text === 'string' && item.text !== '' && typeof item.at === 'number' && now - item.at < PENDING_MAX_AGE_MS
}

type Message = { role: string; text: string; toolUses?: { tool: string; input: Record<string, unknown> }[] }

const TOOL_KEYS = ['file_path', 'command', 'pattern', 'description', 'url', 'skill']

const toolLine = (use: { tool: string; input: Record<string, unknown> }) => {
  const key = TOOL_KEYS.find(name => typeof use.input?.[name] === 'string')
  const detail = key ? String(use.input[key]).replace(/\s+/g, ' ').slice(0, 200) : ''
  return `[${use.tool}${detail ? `: ${detail}` : ''}]`
}

// After a resume the fork has nothing to send, so the summary reads the transcript instead: text and tool calls, no tool output, newest kept.
export const transcriptText = (messages: Message[], maxChars = 400_000) => {
  const lines = messages.map(message => {
    const tools = (message.toolUses ?? []).map(toolLine).join('\n')
    return `${message.role.toUpperCase()}: ${[message.text.trim(), tools].filter(Boolean).join('\n')}`
  })
  return lines.join('\n\n').slice(-maxChars)
}

export const FORK_FAILURES: Record<string, string> = {
  'nothing-to-fork': 'Nothing to hand off yet, send a message first',
  'api-error': 'The summary request failed',
  'empty-reply': 'The model returned no handoff',
  aborted: 'The summary was interrupted',
}
