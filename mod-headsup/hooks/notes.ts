// The session's notes, when a check runs and how the conversation is packed for it. Pure: no engine calls.
import type { SessionMessage } from 'claude-code'

import type { Finding } from './ask'

export type Note = Finding & { id: string; turn: number; prompt: string; at: number; isRead: boolean }

// What this mod keeps per session in its store: the notes, the prompts sent, and the note on the band card with the prompts sent since it showed.
export type Saved = { notes: Note[]; prompts: number; lastPrompt: string; card: string | null; since: number }

export const CHECK_EVERY = 6
// A shown card clears once this many prompts were sent after it.
export const CLEAR_AFTER_PROMPTS = 2
export const SEEN_KEPT = 10
export const KNOWN_KEPT = 50
// How much of the conversation the uncached route sends, newest first.
export const PACK_CHARS = 60_000

export const emptySaved = (): Saved => ({ notes: [], prompts: 0, lastPrompt: '', card: null, since: 0 })

export function savedOf(value: unknown): Saved {
  const raw = value as Partial<Saved> | undefined
  const notes = Array.isArray(raw?.notes) ? raw.notes.filter(note => typeof note?.id === 'string' && typeof note?.learn === 'string') : []
  return {
    notes,
    prompts: typeof raw?.prompts === 'number' ? raw.prompts : 0,
    lastPrompt: typeof raw?.lastPrompt === 'string' ? raw.lastPrompt : '',
    card: typeof raw?.card === 'string' && notes.some(note => note.id === raw.card) ? raw.card : null,
    since: typeof raw?.since === 'number' ? raw.since : 0,
  }
}

export const stringsOf = (value: unknown) => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [])

// Newest last, without repeats, capped.
export const remember = (list: string[], item: string, cap: number) => [...list.filter(each => each !== item), item].slice(-cap)

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
