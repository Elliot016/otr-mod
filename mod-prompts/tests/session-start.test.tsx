// mod-prompts / tests/session-start.test.tsx, by v-amorim: how the prompt list gets its transcript.
import { expect, mock, test } from 'claude-code/testing'

const ID = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`
const user = (n: number, parent: number | null, text: string) =>
  JSON.stringify({ type: 'user', uuid: ID(n), parentUuid: parent === null ? null : ID(parent), timestamp: '2026-10-03T11:58:00Z', message: { role: 'user', content: text } })
const FILE = `${user(1, null, 'alpha prompt')}\n${user(2, 1, 'beta prompt')}\n`
const BRIDGE_FILE = '/home/u/.claude/mods-data/mod-prompts/bridge/s1.jsonl'
const plain = (path: string) => path.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')

const pane = {
  plugin: 'mod-prompts',
  surface: 'terminal',
  component: 'Pane',
  requestId: 'prompts',
  props: { title: 'Prompts', isFocused: true, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} },
} as never

// A session `s1` whose transcript sits at `path`; `stored` collects what the mod keeps in its store.
function host(on: any, path: string) {
  const bridge = { text: '' }
  const stored = new Map<string, unknown>()
  const reads: string[] = []
  on('store.get', (_$: unknown, e: { key: string }) => ({ value: stored.get(e.key) }))
  on('store.set', (_$: unknown, e: { key: string; value: unknown }) => {
    stored.set(e.key, e.value)
    return { value: undefined }
  })
  on('session.id', () => ({ value: 's1' }))
  on('fs.stat', () => ({ value: { kind: 'file', size: FILE.length, mtimeMs: 0, isLink: false } }))
  on('fs.read', (_$: unknown, e: { path: string }) => {
    if (plain(e.path) === BRIDGE_FILE) return { value: bridge.text }
    reads.push(plain(e.path))
    return { value: FILE }
  })
  on('store.keys', () => ({ value: [...stored.keys()] }))
  on('store.delete', () => ({ value: undefined }))
  on('command.register', () => ({ value: undefined }))
  on('session.start', () => ({ cwd: '/w' }))
  on('fs.list', () => ({ value: [{ name: 'proj', kind: 'dir' }] }) as never)
  on('fs.exists', (_$: unknown, e: { path: string }) => ({ value: plain(e.path) === path }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.render', ($$: any, e: any) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>base</Text>
  })
  mock.env(on, { USERPROFILE: '/home/u' })
  const clock = mock.clock(on)
  return { stored, reads, clock, bridge }
}

async function listed($: any, clock: { settle: () => Promise<void> }) {
  await $.command.run({ command: 'mod-prompts' } as never)
  await clock.settle()
  const ui = await $.ui.mount(pane)
  await clock.settle()
  const drawn = JSON.stringify(await ui.drawn())
  await ui.unmount()
  return drawn
}

test('no SessionStart event: the transcript is found by session id under the projects folder and the prompts list', async ($, on) => {
  const { reads, clock, stored } = host(on, '/home/u/.claude/projects/proj/s1.jsonl')
  const drawn = await listed($, clock)
  expect(reads).toContain('/home/u/.claude/projects/proj/s1.jsonl')
  expect(drawn).toContain('alpha prompt')
  expect(drawn).toContain('beta prompt')
  expect(stored.has('transcript:s1')).toBe(false)
})

test('a SessionStart record from the bridge names the transcript: the list loads from transcript_path and the path is stored under transcript:<id>', async ($, on) => {
  const { reads, clock, stored, bridge } = host(on, '/nowhere/else.jsonl')
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true } as never)
  bridge.text = `${JSON.stringify({ session_id: 's1', transcript_path: '/t/named.jsonl', hook_event_name: 'SessionStart', source: 'startup' })}\n`
  await clock.advance(250)
  const drawn = await listed($, clock)
  expect(reads).toEqual(['/t/named.jsonl'])
  expect(drawn).toContain('alpha prompt')
  expect(drawn).toContain('beta prompt')
  expect(stored.get('transcript:s1')).toMatchObject({ path: '/t/named.jsonl' })
})
