// mod-transcript / tests/bridge-feed.ts, by v-amorim: feeds the hook events to the mod the way the command hooks do, as lines in the session's bridge file.
const files = new Map<string, string>()
const started = new WeakSet<object>()
const MARKER = '/mods-data/mod-transcript/bridge/'

// A world's fs.read goes through this first: the bridge file answers with what was fed, any other path goes to `inner`.
export function reading<A extends unknown[], R>(inner: (...args: A) => R) {
  files.clear()
  return (...args: A) => {
    const path = String((args[1] as { path?: string })?.path ?? '').replace(/\\/g, '/')
    const at = path.indexOf(MARKER)
    return at < 0 ? inner(...args) : { value: files.get(path.slice(at + MARKER.length).replace(/\.jsonl$/, '')) ?? '' }
  }
}

// Appends a line to the session's file, as the command hook does.
export function append(session: string, record: object) {
  files.set(session, `${files.get(session) ?? ''}${JSON.stringify(record)}\n`)
}

// The bridge starts with session.start, so the first feed of a world starts the mod.
export async function feed($: any, clock: { advance: (ms: number) => Promise<void> }, record: Record<string, unknown>) {
  if (!started.has($)) {
    started.add($)
    await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true } as never)
  }
  append(String(record.session_id ?? 's1'), record)
  await clock.advance(250)
}

export const sessionStarted = ($: any, clock: any, session: string, path: string, source = 'startup') =>
  feed($, clock, { session_id: session, transcript_path: path, source, hook_event_name: 'SessionStart', cwd: '/w' })
