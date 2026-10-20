// mod-model-effort / tests/feed.ts, by v-amorim: stubs the bridge file the command hooks append to, and feeds records to it.
export const HOME = '/home/u'
export const BRIDGE_FILE = `${HOME}/.claude/mods-data/mod-model-effort/bridge/sid-1.jsonl`

const neutral = (path: string) => path.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')

// Stubs the host calls that start the bridge; `files` holds any other file a test reads.
export function bridgeStubs(on: any, files: Record<string, string> = {}) {
  const bridge = { text: '' }
  on('env.get', (_$: unknown, e: { name: string }) => ({ value: e.name === 'USERPROFILE' ? HOME : undefined }))
  on('fs.read', (_$: unknown, e: { path: string }) => {
    const path = neutral(e.path)
    if (path === BRIDGE_FILE) return { value: bridge.text }
    if (path in files) return { value: files[path]! }
    throw new Error(`ENOENT ${path}`)
  })
  on('fs.exists', (_$: unknown, e: { path: string }) => ({ value: neutral(e.path) in files }))
  on('fs.write', (_$: unknown, e: { path: string; text: string }) => {
    files[neutral(e.path)] = e.text
    return { value: undefined }
  })
  on('session.id', () => ({ value: 'sid-1' }))
  on('session.start', () => ({ cwd: '/w' }))
  on('command.register', () => ({ value: { command: 'mod-model-effort' } }))
  on('ui.panes', () => ({ value: [] }))
  return bridge
}

// Appends a record to the session's file, as the command hook does, then lets the next poll read it.
export async function feed(clock: { advance: (ms: number) => Promise<unknown> }, bridge: { text: string }, event: string, body: object = {}) {
  bridge.text += `${JSON.stringify({ session_id: 'sid-1', hook_event_name: event, ...body })}\n`
  await clock.advance(250)
}
