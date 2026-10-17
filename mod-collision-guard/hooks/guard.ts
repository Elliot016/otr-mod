// mod-collision-guard / hooks/guard.ts, by v-amorim
// Holds the pure logic that records edits per session and finds conflicts between sessions.
import text from './text'
import { fill } from './theme'

// `$` never crosses an import, so the register file hands in plain functions.
export type Edit = { path: string; session: string; at: number }

export type Io = {
  read: (path: string) => Promise<unknown>
  write: (path: string, text: string) => Promise<void>
  list: (path: string) => Promise<{ name: string; kind: string; mtimeMs?: number }[]>
}

export const EDIT_TOOLS = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit']

// Edit, Write and MultiEdit name `file_path`; NotebookEdit names `notebook_path`.
export const pathOf = (input: Record<string, unknown>) => {
  const raw = input.file_path ?? input.notebook_path
  return typeof raw === 'string' && raw ? raw : ''
}

// One spelling per file: forward slashes, git-bash `/c/` as `c:/`, and case folded on a Windows drive path.
export const normalize = (path: string) => {
  const flat = path.replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/^\/([A-Za-z])\//, '$1:/')
  return /^[A-Za-z]:/.test(flat) ? flat.toLowerCase() : flat
}

const fileOf = (dir: string, session: string) => `${dir}/${session.replace(/[^A-Za-z0-9_-]/g, '_')}.json`

// A corrupt or half-written file reads as empty instead of failing the edit.
export function parseEdits(text: unknown): Edit[] {
  try {
    const data = JSON.parse(String(text))
    if (!Array.isArray(data)) return []
    return data.filter((item): item is Edit => item && typeof item.path === 'string' && typeof item.session === 'string' && typeof item.at === 'number')
  } catch {
    return []
  }
}

// Each session writes only its own file, so concurrent sessions never overwrite one another; one writer at a time inside a session.
let queue: Promise<unknown> = Promise.resolve()
const serial = <T>(task: () => Promise<T>) => {
  const run = queue.then(task, task)
  queue = run.catch(() => undefined)
  return run
}

export const recordEdit = (io: Io, dir: string, session: string, path: string, now: number, windowMs: number) =>
  serial(async () => {
    const file = fileOf(dir, session)
    const own = parseEdits(await io.read(file).catch(() => ''))
    const kept = own.filter(edit => now - edit.at <= windowMs && edit.path !== normalize(path))
    kept.push({ path: normalize(path), session, at: now })
    await io.write(file, JSON.stringify(kept))
  })

export const clearOwn = (io: Io, dir: string, session: string) => serial(() => io.write(fileOf(dir, session), '[]'))

// The newest edit of this file by another session inside the window, or undefined.
export async function findConflict(io: Io, dir: string, session: string, path: string, now: number, windowMs: number) {
  const mine = fileOf(dir, session).slice(dir.length + 1)
  const target = normalize(path)
  const entries = await io.list(dir).catch(() => [])
  let newest: Edit | undefined
  for (const entry of entries) {
    if (entry.kind !== 'file' || !entry.name.endsWith('.json') || entry.name === mine) continue
    // Ended sessions leave their files behind; one not written inside the window holds no live edit, so it is never read.
    if (entry.mtimeMs && now - entry.mtimeMs > windowMs) continue
    for (const edit of parseEdits(await io.read(`${dir}/${entry.name}`).catch(() => ''))) {
      if (edit.session === session || normalize(edit.path) !== target || now - edit.at > windowMs) continue
      if (!newest || edit.at > newest.at) newest = edit
    }
  }
  return newest
}

export function agoText(ms: number) {
  const minutes = Math.floor(ms / 60000)
  if (minutes < 1) return text.agoLessThanMinute
  if (minutes < 60) return fill(text.agoMinutes, { minutes })
  return fill(text.agoHoursMinutes, { hours: Math.floor(minutes / 60), minutes: minutes % 60 })
}

const two = (n: number) => String(n).padStart(2, '0')

export const clockText = (at: number) => {
  const date = new Date(at)
  return `${two(date.getHours())}:${two(date.getMinutes())}`
}
