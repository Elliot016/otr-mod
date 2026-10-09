// mod-desktop-status-line / tests/desktop-status-line.test.tsx, by v-amorim
// Tests the status line band rendering from a fixed snapshot of branch, limits and cost.
import { expect, test } from 'claude-code/testing'

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
