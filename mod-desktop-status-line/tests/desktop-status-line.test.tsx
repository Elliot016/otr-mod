// mod-desktop-status-line / tests/desktop-status-line.test.tsx, by v-amorim
// Tests the status line band rendering from a fixed snapshot of branch, limits and cost.
import { expect, mock, test } from 'claude-code/testing'

import { fill } from '../hooks/register'
import text from '../hooks/text'

const BAND = (surface: string) =>
  ({
    plugin: 'mod-desktop-status-line',
    surface,
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 120, scroll: { offset: 0, bodyRows: 6 }, view: {} },
  }) as never

const SNAPSHOT = {
  now: Date.parse('2026-10-05T12:00:00Z'),
  branch: 'main',
  branchUrl: '',
  isDirty: true,
  ahead: 2,
  behind: 0,
  root: 'C:/repo',
  path: 'Users › repo',
  cost: null,
  contextPercent: null,
  fiveHour: null,
  sevenDay: null,
}

const base = (on: any) =>
  on('ui.render', ($$: any, e: any) => {
    const { Text } = $$.ui.resolve(e)
    return <Text key="base">base</Text>
  })

// The mod reads its snapshot through $.state; the test answers that read.
const withSnapshot = (on: any) =>
  on('state.get', (_$: unknown, e: { key: string }) => ({ value: { value: e.key === 'snapshot' ? SNAPSHOT : e.key === 'menuOpen' ? false : null } }))

test('the terminal keeps its own status line: the band falls through', async ($, on) => {
  base(on)
  withSnapshot(on)
  const band = await $.ui.mount(BAND('terminal'))
  expect(await band.find({ type: 'Text', text: 'base' })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /main/ })).toBeUndefined()
  await band.unmount()
})

test('on the desktop, nothing draws until the first snapshot', async ($, on) => {
  base(on)
  const band = await $.ui.mount(BAND('desktop'))
  expect(await band.find({ type: 'Text', text: 'base' })).toBeDefined()
  await band.unmount()
})

test('on the desktop, the branch, its marks and the path draw from style.ts symbols', async ($, on) => {
  base(on)
  withSnapshot(on)
  const band = await $.ui.mount(BAND('desktop'))
  expect(await band.find({ type: 'Text', text: '⑂ main' })).toBeDefined()
  expect(await band.find({ type: 'Text', text: ' ●' })).toBeDefined()
  expect(await band.find({ type: 'Text', text: ' ↑2' })).toBeDefined()
  expect(await band.find({ type: 'Text', text: ' › repo' })).toBeDefined()
  await band.unmount()
})

test('a toast fills its {slots}', () => {
  expect(fill(text.openFailed, { name: 'Explorer', error: 'denied' })).toBe('Could not open Explorer: denied')
})

// The engine side of a refresh: state backs the snapshot atom, and git answers when `git` resolves, or never.
function engine(on: any) {
  const state = new Map<string, unknown>()
  const w = { git: new Promise<never>(() => {}) as Promise<unknown> }
  on('env.get', () => ({ value: undefined }))
  on('fs.read', () => {
    throw new Error('no theme')
  })
  on('session.root', () => ({ value: 'C:/repo' }))
  on('session.repo', () => ({ value: null }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1, percent: 10, tokens: 1 }, rateLimits: [] } }))
  on('process.run', async () => ({ value: await w.git }))
  on('state.get', (_$: unknown, e: { key: string }) => ({ value: { value: state.get(e.key) ?? null, version: 0 } }))
  on('state.set', (_$: unknown, e: { key: string; value: unknown }) => {
    state.set(e.key, e.value)
    return { value: { isSet: true, version: 1 } }
  })
  on('session.start', () => ({ cwd: '/w' }))
  on('session.end', (_$: unknown, e: { sessionId: string }) => ({ sessionId: e.sessionId }))
  base(on)
  return { state, w, clock: mock.clock(on) }
}

test('a git that hangs never holds up session.start past its bound', async ($, on) => {
  const { clock } = engine(on)
  let isStarted = false
  const starting = $.session.start({ cwd: '/w' } as never).then(() => (isStarted = true))
  await clock.advance(2100)
  expect(isStarted).toBe(true)
  await starting
})

test('a /resume or /clear drops the old session\'s figures at once', async ($, on) => {
  const { state, w, clock } = engine(on)
  w.git = Promise.resolve({ exitCode: 0, stdout: '# branch.head main\n', stderr: '' })
  await $.session.start({ cwd: '/w' } as never)
  await clock.settle()
  expect((state.get('snapshot') as { branch?: string } | null)?.branch).toBe('main')
  w.git = new Promise<never>(() => {})
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: {} } as never)
  expect(state.get('snapshot')).toBeNull()
})
