// mod-wrap-up / hooks/titles.ts, by v-amorim: linked session names, each holding only its direct parent; pure, the reads stay in register.tsx.
import type { Names } from './handoff'
import text from './text'

const ARROW = text.link

// The part after the last arrow: the name a session goes by in the chain.
export function ownName(title: string) {
  const at = title.lastIndexOf(ARROW)
  return (at < 0 ? title : title.slice(at + ARROW.length)).trim()
}

// The part before the last arrow: the parent a title the mod set links to.
export function parentName(title: string) {
  const at = title.lastIndexOf(ARROW)
  return at < 0 ? '' : title.slice(0, at).trim()
}

// Only the parts after each name's last arrow join, so a name never holds two arrows.
export const linked = (previous: string, own: string) => (previous && own ? `${ownName(previous)} ${ARROW} ${ownName(own)}` : ownName(own))

// The latest custom-title row of a transcript, which is the session's name now. A row of another session (a resume copies rows) is skipped.
export function latestTitle(transcript: string, session: string) {
  const lines = transcript.split('\n')
  for (let at = lines.length - 1; at >= 0; at--) {
    if (!lines[at]!.includes('"custom-title"')) continue
    try {
      const row = JSON.parse(lines[at]!)
      if (row?.type === 'custom-title' && typeof row.customTitle === 'string' && (!row.sessionId || !session || row.sessionId === session)) return row.customTitle.trim()
    } catch {
      // A half-written row is skipped.
    }
  }
  return ''
}

export const KEEP_APPLIED = 40

// What the handoff does to the two names. A title the mod did not set was written by the person, so it stays and the fresh session links to it.
export type NamePlan = { old: string; next: string; oldOwn: string; nextOwn: string }

export function planNames(current: string, applied: readonly string[], names: Names): NamePlan {
  const isPersons = current !== '' && !applied.includes(current)
  const parent = current !== '' && !isPersons ? parentName(current) : ''
  const oldOwn = isPersons || !names.this ? ownName(current) : names.this
  const old = isPersons || !names.this ? '' : linked(parent, names.this)
  return { old, next: linked(oldOwn, names.next), oldOwn, nextOwn: names.next }
}

// The fresh session of a clear the person ran: the old session can no longer be renamed, so only the new one is.
export function lateNext(current: string, names: Names): NamePlan {
  const oldOwn = ownName(current)
  return { old: '', next: linked(oldOwn, names.next), oldOwn, nextOwn: names.next }
}

export const remember = (applied: readonly string[], titles: readonly string[]) => [...applied, ...titles.filter(Boolean)].slice(-KEEP_APPLIED)
