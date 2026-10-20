// mod-file-tree / tests/session-start.test.tsx, by v-amorim: how the tree gets its transcript from a SessionStart.
import { expect, mock, test, type Mounted } from 'claude-code/testing'

const PANE = {
  plugin: 'mod-file-tree',
  surface: 'terminal',
  component: 'Pane',
  requestId: 'filetree',
  props: { title: 'Files', isFocused: true, bodyColumns: 70, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as never

let uuid = 0
const jrow = (fields: object) => JSON.stringify({ uuid: `u${(uuid += 1)}`, ...fields })
const prompt = (text: string) => jrow({ type: 'user', message: { role: 'user', content: text } })
const use = (id: string, path: string) => jrow({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id, name: 'Read', input: { file_path: path } }] } })
const result = (id: string) => jrow({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] } })
const readOf = (id: string, path: string) => [prompt(`read ${path}`), use(id, path), result(id), ''].join('\n')

const plain = (path: string) => path.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')
const BRIDGE = (session: string) => `/h/.claude/mods-data/mod-file-tree/bridge/${session}.jsonl`
const FOUND = '/h/.claude/projects/p/a.jsonl'
const NAMED_A = '/t/named-a.jsonl'
const NAMED_B = '/t/named-b.jsonl'

// `files` maps a path to the transcript text it holds; any other path reads as missing.
function host(on: any, files: Record<string, string>) {
  const w = { session: 'a', files, reads: [] as string[], bridge: {} as Record<string, string> }
  const stored = new Map<string, unknown>()
  const clock = mock.clock(on, { now: Date.UTC(2026, 9, 20, 9, 0) })
  on('session.cwd', () => ({ value: '/w' }))
  on('session.id', () => ({ value: w.session }))
  on('env.get', (_$: unknown, e: { name: string }) => ({ value: e.name === 'USERPROFILE' ? '/h' : undefined }))
  on('store.get', (_$: unknown, e: { key: string }) => ({ value: stored.get(e.key) }))
  on('store.set', (_$: unknown, e: { key: string; value: unknown }) => {
    stored.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...stored.keys()] }))
  on('store.delete', () => ({ value: undefined }))
  on('fs.list', () => ({ value: [{ name: 'p', kind: 'dir', size: 0, mtimeMs: 0, isLink: false }] }))
  on('fs.exists', (_$: unknown, e: { path: string }) => ({ value: plain(e.path) in w.files }))
  on('fs.read', (_$: unknown, e: { path: string }) => {
    const path = plain(e.path)
    if (path.includes('/bridge/')) return { value: w.bridge[path] ?? '' }
    w.reads.push(path)
    if (!(path in w.files)) throw new Error('missing')
    return { value: w.files[path] }
  })
  on('ui.panes', () => ({ value: [] }))
  on('tool.call', () => ({ result: { text: 'ok' } }) as never)
  on('session.start', () => ({ cwd: '/w' }) as never)
  on('session.end', (_$: unknown, e: { sessionId: string }) => ({ sessionId: e.sessionId }) as never)
  on('command.register', () => ({ value: undefined }) as never)
  on('ui.render', ($$: any, e: any) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>base</Text>
  })
  return { w, stored, clock }
}

// The SessionStart a session raises, as the host delivers it to this mod.
async function startOf($: any, w: ReturnType<typeof host>['w'], clock: { advance: (ms: number) => Promise<void> }, session: string, transcript_path: string, source = 'startup') {
  const record = { session_id: session, transcript_path, source, hook_event_name: 'SessionStart', cwd: '/w' }
  w.bridge[BRIDGE(session)] = (w.bridge[BRIDGE(session)] ?? '') + `${JSON.stringify(record)}
`
  await clock.advance(250)
}

const sessionTree = async (ui: Mounted) => {
  await (ui as Mounted & { pointer: (event: object) => Promise<unknown> }).pointer({ type: 'down', x: 1, y: 0, button: 'left', in: 'scope-session' } as never)
  return JSON.stringify(await ui.drawn({ in: 'list-0' }).catch(() => ''))
}

const treeOf = async ($: any, clock: { settle: () => Promise<void> }) => {
  await clock.settle()
  const ui = await $.ui.mount(PANE)
  const tree = await sessionTree(ui)
  await ui.unmount()
  return tree
}

test('no SessionStart: the transcript is found by session id under the projects folder', async ($, on) => {
  const { w, stored, clock } = host(on, { [FOUND]: readOf('t1', '/w/found.ts') })
  await $.session.start({ cwd: '/w' } as never)
  const tree = await treeOf($, clock)
  expect(tree).toContain('found.ts')
  expect(w.reads).toContain(FOUND)
  expect(stored.has('transcript:a')).toBe(false)
})

test('a SessionStart names the transcript: its files show and the path is kept under transcript:<id>', async ($, on) => {
  const { w, stored, clock } = host(on, { [NAMED_A]: readOf('t1', '/w/named.ts') })
  await $.session.start({ cwd: '/w' } as never)
  await startOf($, w, clock, 'a', NAMED_A)
  const tree = await treeOf($, clock)
  expect(tree).toContain('named.ts')
  expect(stored.get('transcript:a')).toMatchObject({ path: NAMED_A, at: expect.any(Number) })
})

test('a SessionStart for the log already held (a compact) does not read the transcript again', async ($, on) => {
  const { w, clock } = host(on, { [NAMED_A]: readOf('t1', '/w/named.ts') })
  await $.session.start({ cwd: '/w' } as never)
  await startOf($, w, clock, 'a', NAMED_A)
  await clock.settle()
  const before = w.reads.filter(path => path === NAMED_A).length
  expect(before).toBeGreaterThan(0)
  await startOf($, w, clock, 'a', NAMED_A, 'compact')
  await clock.settle()
  expect(w.reads.filter(path => path === NAMED_A).length).toBe(before)
})

test('a SessionStart naming another transcript for the same session reads the new one and drops the old files', async ($, on) => {
  const { w, clock } = host(on, { [NAMED_A]: readOf('t1', '/w/old.ts'), [NAMED_B]: readOf('t2', '/w/new.ts') })
  await $.session.start({ cwd: '/w' } as never)
  await startOf($, w, clock, 'a', NAMED_A)
  expect(await treeOf($, clock)).toContain('old.ts')
  await startOf($, w, clock, 'a', NAMED_B)
  const tree = await treeOf($, clock)
  expect(tree).toContain('new.ts')
  expect(tree).not.toContain('old.ts')
})

test('a resume to another session: its SessionStart brings that session\'s own files and not the first one\'s', async ($, on) => {
  const { w, clock } = host(on, { [NAMED_A]: readOf('t1', '/w/alpha.ts'), [NAMED_B]: readOf('t2', '/w/beta.ts') })
  await $.session.start({ cwd: '/w' } as never)
  await startOf($, w, clock, 'a', NAMED_A)
  expect(await treeOf($, clock)).toContain('alpha.ts')
  await $.session.end({ reason: 'resume', sessionId: 'a', resume: {} } as never)
  w.session = 'b'
  await startOf($, w, clock, 'b', NAMED_B, 'resume')
  const tree = await treeOf($, clock)
  expect(tree).toContain('beta.ts')
  expect(tree).not.toContain('alpha.ts')
})
