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

export const FORK_FAILURES: Record<string, string> = {
  'nothing-to-fork': 'nothing to hand off yet, send a message first',
  'api-error': 'the summary request failed',
  'empty-reply': 'the model returned no handoff',
  aborted: 'the summary was interrupted',
}
