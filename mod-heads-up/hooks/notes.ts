// The session's notes, when a check runs and how the conversation is packed for it. Pure: no engine calls.
import type { SessionMessage } from 'claude-code'

import type { Finding } from './ask'

// promptId is the row of the prompt the note belongs to, so ↗ scrolls to that row and not to another copy of its text.
export type Note = Finding & { id: string; turn: number; prompt: string; promptId?: string; at: number; isRead: boolean }

// The last check that read an answer: the number of its prompt, when it ran, and whether it showed a note.
export type LastCheck = { turn: number; at: number; found: boolean }

// What this mod keeps per session in its store: the notes, the note on the band card with the prompts sent since it showed, and the last check.
export type Saved = { notes: Note[]; card: string | null; since: number; checked: LastCheck | null }

export const CHECK_EVERY = 6
// A shown card clears once this many prompts were sent after it.
export const CLEAR_AFTER_PROMPTS = 2
export const SEEN_KEPT = 10
export const KNOWN_KEPT = 50
// The sessions whose notes and seen topics stay in the store; the older ones are deleted.
export const SESSIONS_KEPT = 40
// How much of the conversation the uncached route sends, newest first.
export const PACK_CHARS = 60_000

export const emptySaved = (): Saved => ({ notes: [], card: null, since: 0, checked: null })

export function savedOf(value: unknown): Saved {
  const raw = value as Partial<Saved> | undefined
  const notes = Array.isArray(raw?.notes) ? raw.notes.filter(note => typeof note?.id === 'string' && typeof note?.learn === 'string') : []
  return {
    notes,
    card: typeof raw?.card === 'string' && notes.some(note => note.id === raw.card) ? raw.card : null,
    since: typeof raw?.since === 'number' ? raw.since : 0,
    checked: checkedOf(raw?.checked),
  }
}

function checkedOf(value: unknown): LastCheck | null {
  const raw = value as Partial<LastCheck> | null | undefined
  return typeof raw?.turn === 'number' && typeof raw.at === 'number' && typeof raw.found === 'boolean' ? { turn: raw.turn, at: raw.at, found: raw.found } : null
}

export const stringsOf = (value: unknown) => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [])

// Newest last, without repeats, capped.
export const remember = (list: string[], item: string, cap: number) => [...list.filter(each => each !== item), item].slice(-cap)

// The sessions kept once `session` loads, and the ones that fall out of the cap.
export function recentSessions(list: string[], session: string) {
  const kept = remember(list, session, SESSIONS_KEPT)
  return { kept, dropped: list.filter(each => !kept.includes(each)) }
}

// Words that carry no topic. "not" and "no" stay, since they change what a note says.
const STOP_WORDS = new Set(['a', 'an', 'the', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'at', 'by', 'for', 'from', 'with', 'as', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'it', 'its', 'this', 'that', 'these', 'those', 'so', 'if', 'then', 'than', 'do', 'does', 'did', 'has', 'have', 'had', 'will', 'would', 'can', 'could', 'should', 'may', 'might', 'must', 'you', 'your', 'we', 'our', 'they', 'their', 'he', 'she', 'i', 'me', 'my', 'about', 'into', 'over', 'up', 'down', 'out', 'just', 'now', 'also', 'very', 'there', 'here', 'what', 'which', 'who', 'when', 'where', 'how', 'why', 'all', 'any', 'each', 'some', 'more', 'most', 'other', 'such', 'only', 'own', 'same', 'too', 's', 't'])

// The topic words of a note: lowercased, stop words dropped, and a plural s trimmed so "tests" matches "test".
const topicWords = (text: string) =>
  new Set(
    (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
      .filter(word => !STOP_WORDS.has(word))
      .map(word => (word.length > 3 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word)),
  )

const plain = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

// Two notes restate each other when 70% of the shorter one's topic words appear in the other. With one topic word, or none, only the same text matches: "Deploy?" and "Deploy now?" can ask different things.
export function restates(a: string, b: string) {
  const wordsA = topicWords(a)
  const wordsB = topicWords(b)
  const shorter = wordsA.size <= wordsB.size ? wordsA : wordsB
  const longer = shorter === wordsA ? wordsB : wordsA
  if (shorter.size < 2) return plain(a) === plain(b)
  const shared = [...shorter].filter(word => longer.has(word)).length
  return shared / shorter.size >= 0.7
}

// A check runs on a main step that is a multiple of CHECK_EVERY, once per turn, and never over a shown card.
export const shouldCheck = (index: number, turnId: string, checkedTurn: string, isCardShown: boolean) =>
  index > 0 && index % CHECK_EVERY === 0 && turnId !== checkedTurn && !isCardShown

// A fork runs at the session's effort, so above medium the check takes the uncached route at medium instead.
export const canFork = (effort: string | number | undefined) => effort === undefined || typeof effort === 'number' || effort === 'low' || effort === 'medium'

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text)

function render(message: SessionMessage) {
  if (message.role === 'user') return message.text ? `Person: ${message.text}` : ''
  const calls = message.toolUses.map(use => `  [${use.tool}] ${clip(JSON.stringify(use.input ?? {}), 300)}${use.text ? ` -> ${clip(use.text.replace(/\s+/g, ' '), 400)}` : ''}`)
  return [message.text ? `Assistant: ${message.text}` : '', ...calls].filter(Boolean).join('\n')
}

// The conversation as text, newest kept first until the budget runs out, then read oldest to newest.
export function pack(messages: SessionMessage[], budget = PACK_CHARS) {
  const kept: string[] = []
  let used = 0
  for (const message of [...messages].reverse()) {
    const text = render(message)
    if (!text) continue
    if (used + text.length > budget) break
    kept.unshift(text)
    used += text.length
  }
  return kept.join('\n\n')
}

export const unreadCount = (notes: Note[]) => notes.filter(note => !note.isRead).length

// Notes grouped under their turn, newest turn first, notes in the order they came.
export function byTurn(notes: Note[]) {
  const turns = new Map<number, Note[]>()
  for (const note of notes) turns.set(note.turn, [...(turns.get(note.turn) ?? []), note])
  return [...turns.entries()].sort(([a], [b]) => b - a).map(([turn, list]) => ({ turn, prompt: list[0]!.prompt, at: list[0]!.at, notes: list }))
}

export const sameText = (text: string) => text.replace(/\s+/g, ' ').trim()
