// mod-file-tree / tests/previews.test.tsx, by v-amorim
import { mock, test, type TestBody } from 'claude-code/testing'

import { capture, expectPreview } from './previews-kit'
import { snapshot } from './previews.snapshot'

const PANE = {
  plugin: 'mod-file-tree',
  surface: 'terminal',
  component: 'Pane',
  requestId: 'filetree',
  props: { title: 'Files', isFocused: true, bodyColumns: 56, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as never

const WIDTH = 54
const END = { turnId: 't1', answer: '', durationMs: 1, isAborted: false, reason: 'end_turn' } as never

const stubs = (on: Parameters<TestBody>[1]) => {
  on('session.cwd', () => ({ value: '/w' }))
  on('session.id', () => ({ value: 's1' }))
  on('env.get', (_$, e) => ({ value: e.name === 'USERPROFILE' ? '/h' : undefined }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('fs.list', () => ({ value: [] }))
  on('fs.exists', () => ({ value: false }))
  on('fs.stat', () => ({ value: { kind: 'file', size: 0, mtimeMs: 0, isLink: false } }))
  on('fs.read', () => ({ value: '' }))
  on('ui.panes', () => ({ value: [] }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('tool.call', () => ({ result: { text: 'ok' } }) as never)
  on('turn.start', (_$, e) => ({ turnId: e.turnId }) as never)
  on('turn.complete', () => ({ text: '' }))
  mock.clock(on)
  on('ui.render', ($$, e) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>base</Text>
  })
}

// The tree card after a turn that read one file and edited another.
async function tree($: any, on: Parameters<TestBody>[1]) {
  stubs(on)
  await $.turn.start({ turnId: 't1' } as never)
  await $.tool.call({ tool: 'Read', file_path: '/w/hooks/theme.ts' } as never)
  await $.tool.call({ tool: 'Edit', file_path: '/w/hooks/register.tsx', old_string: 'x\n', new_string: 'a\nb\nc\nd\n' } as never)
  await $.turn.complete(END)
  const ui = await $.ui.mount(PANE)
  const got = await capture(await ui.find({ key: 'tree' }), key => ui.drawn({ in: key }), WIDTH)
  await ui.unmount()
  return got
}

// The replay card's diff of a line too long for the pane.
async function diff($: any, on: Parameters<TestBody>[1]) {
  stubs(on)
  await $.turn.start({ turnId: 't1' } as never)
  await $.tool.call({ tool: 'Edit', file_path: '/w/hooks/register.tsx', old_string: 'x\n', new_string: 'const label = withIcon(look, icon, name, tooltip)\n' } as never)
  await $.turn.complete(END)
  const ui = await $.ui.mount(PANE)
  await ui.pointer({ in: 'list-0', type: 'down', button: 'left', x: 3, y: 0 })
  const got = await capture(await ui.find({ key: 'replay' }), key => ui.drawn({ in: key }), WIDTH)
  await ui.unmount()
  return got
}

for (const mode of ['nerd', 'safe'] as const) {
  for (const reads of [true, false]) {
    test(`show_reads=${reads} example is the real tree card (${mode})`, { options: { icons: mode, show_reads: reads, animations: false } }, async ($, on) => {
      expectPreview(snapshot, 'show_reads', String(reads), mode, await tree($, on))
    })
  }

  for (const wrap of [true, false]) {
    test(`wrap_diff=${wrap} example is the real diff (${mode})`, { options: { icons: mode, wrap_diff: wrap, animations: false } }, async ($, on) => {
      expectPreview(snapshot, 'wrap_diff', String(wrap), mode, await diff($, on))
    })
  }
}
