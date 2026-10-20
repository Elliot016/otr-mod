// mod-manager / tests/show-all.test.tsx, by v-amorim
// Tests the hover card's Show all / Show less control: cut, opened, held, reset, tip, icon modes.
import { expect, test } from 'claude-code/testing'

const withPointer = <T,>(m: T) => m as T & { pointer(e: object): Promise<unknown> }

const neutral = (path: string) => path.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')
const hooks = JSON.stringify({ modules: ['./register.tsx'] })
const source = "on('ui.render', { component: 'AbovePrompt' }, async () => {})"
const LONG = `${'word '.repeat(119)}last`
const wordsOf = (node: unknown): string => (typeof node === 'string' ? node : Array.isArray(node) ? node.map(wordsOf).join('') : node ? wordsOf((node as { children?: unknown }).children) : '')

const longPane = async ($: any, on: any) => {
  const files: Record<string, string> = {
    '/h/.claude/settings.json': JSON.stringify({ env: { CLAUDE_CODE_PLUGIN_DIRS: '~/.claude/mods/alpha' } }) + '\n',
    '/h/.claude/mods/alpha/.claude-plugin/plugin.json': JSON.stringify({ name: 'alpha', description: LONG, version: '1.0.0' }),
    '/h/.claude/mods/alpha/hooks/hooks.json': hooks,
    '/h/.claude/mods/alpha/hooks/register.tsx': source,
    '/h/.claude/mods/beta/.claude-plugin/plugin.json': JSON.stringify({ name: 'beta', description: 'beta does a thing', version: '1.0.0' }),
    '/h/.claude/mods/beta/hooks/hooks.json': hooks,
    '/h/.claude/mods/beta/hooks/register.tsx': source,
  }
  on('fs.read', (_$: unknown, e: { path: string }) => {
    const path = neutral(e.path)
    if (!(path in files)) throw new Error('ENOENT')
    return { value: files[path]! }
  })
  on('fs.write', (_$: unknown, e: { path: string; text: string }) => {
    files[neutral(e.path)] = e.text
    return { value: undefined }
  })
  on('fs.list', () => ({
    value: [
      { name: 'alpha', kind: 'dir', size: 0, mtimeMs: 0, isLink: false },
      { name: 'beta', kind: 'dir', size: 0, mtimeMs: 0, isLink: false },
    ],
  }))
  on('env.get', (_$: unknown, e: { name: string }) => ({ value: e.name === 'USERPROFILE' ? '/h' : undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [] }))
  on('config.list', () => ({ value: [] }))
  on('ui.render', ($$: any, e: unknown) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>base</Text>
  })
  await $.command.run({ command: 'mod-manager' } as never)
  return withPointer(await $.ui.mount({
    plugin: 'mod-manager',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'manager',
    props: { title: 'Mods', isFocused: true, bodyColumns: 80, placement: 'above', scroll: { offset: 0, bodyRows: 40 }, view: {} },
  } as never))
}

const MORE_ID = 'manager-card-more'

test('a short description shows no Show all control', { options: { icons: 'safe' } }, async ($, on) => {
  const ui = await longPane($, on)
  await ui.pointer({ in: 'list-dir', type: 'move', x: 12, y: 1 })
  expect(await ui.find({ type: 'Text', text: /beta does a thing/ })).toBeDefined()
  expect(await ui.find({ key: MORE_ID })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /Show all/ })).toBeUndefined()
  await ui.unmount()
})

test('a cut description pins Show all right on its last text row; a click shows all of it with Show less, and a second click cuts it again', { options: { icons: 'safe' } }, async ($, on) => {
  const ui = await longPane($, on)
  await ui.pointer({ in: 'list-dir', type: 'move', x: 12, y: 0 })
  expect(await ui.find({ key: 'card-row-gap' })).toBeDefined()
  expect(await ui.find({ key: 'card-row-text' })).toBeDefined()
  expect(wordsOf(await ui.drawn({ in: MORE_ID }))).toBe(' ▾ Show all ')
  expect(await ui.find({ type: 'Text', text: /last/ })).toBeUndefined()
  // The pointer leaves the row on its way to the control, which stays.
  await ui.pointer({ in: 'list-dir', type: 'leave', x: 0, y: 0 })
  expect(wordsOf(await ui.drawn({ in: MORE_ID }))).toBe(' ▾ Show all ')
  await ui.pointer({ in: MORE_ID, type: 'down', button: 'left', x: 1, y: 0 })
  expect(wordsOf(await ui.drawn({ in: MORE_ID }))).toBe(' ▴ Show less ')
  expect(await ui.find({ type: 'Text', text: /last/ })).toBeDefined()
  await ui.pointer({ in: MORE_ID, type: 'down', button: 'left', x: 1, y: 0 })
  expect(wordsOf(await ui.drawn({ in: MORE_ID }))).toBe(' ▾ Show all ')
  expect(await ui.find({ type: 'Text', text: /last/ })).toBeUndefined()
  await ui.unmount()
})

test('an opened card grows and moves the list down; Show less brings it back', { options: { icons: 'safe' } }, async ($, on) => {
  const ui = await longPane($, on)
  const spaceOf = async () => JSON.stringify(await ui.find({ key: 'card-space' }))
  await ui.pointer({ in: 'list-dir', type: 'move', x: 12, y: 0 })
  const cut = await spaceOf()
  await ui.pointer({ in: MORE_ID, type: 'down', button: 'left', x: 1, y: 0 })
  expect(await spaceOf()).not.toBe(cut)
  await ui.pointer({ in: MORE_ID, type: 'down', button: 'left', x: 1, y: 0 })
  expect(await spaceOf()).toBe(cut)
  await ui.unmount()
})

test('pointing at another row returns an opened card to the cut one', { options: { icons: 'safe' } }, async ($, on) => {
  const ui = await longPane($, on)
  await ui.pointer({ in: 'list-dir', type: 'move', x: 12, y: 0 })
  await ui.pointer({ in: MORE_ID, type: 'down', button: 'left', x: 1, y: 0 })
  expect(await ui.find({ type: 'Text', text: /last/ })).toBeDefined()
  await ui.pointer({ in: 'list-dir', type: 'move', x: 12, y: 1 })
  expect(await ui.find({ type: 'Text', text: /beta does a thing/ })).toBeDefined()
  await ui.pointer({ in: 'list-dir', type: 'move', x: 12, y: 0 })
  expect(await ui.find({ type: 'Text', text: /last/ })).toBeUndefined()
  expect(wordsOf(await ui.drawn({ in: MORE_ID }))).toBe(' ▾ Show all ')
  await ui.unmount()
})

test('pointing at another control drops the held card, an opened one included', { options: { icons: 'safe' } }, async ($, on) => {
  const ui = await longPane($, on)
  await ui.pointer({ in: 'list-dir', type: 'move', x: 12, y: 0 })
  await ui.pointer({ in: MORE_ID, type: 'down', button: 'left', x: 1, y: 0 })
  await ui.pointer({ in: 'list-dir', type: 'leave', x: 0, y: 0 })
  expect(await ui.find({ key: 'hover-card' })).toBeDefined()
  await ui.pointer({ in: 'manager-tab', type: 'move', x: 1, y: 0 })
  expect(await ui.find({ key: 'hover-card' })).toBeUndefined()
  await ui.pointer({ in: 'list-dir', type: 'move', x: 12, y: 0 })
  expect(await ui.find({ type: 'Text', text: /last/ })).toBeUndefined()
  await ui.unmount()
})

test('the Show all tip reaches the pane footer', { options: { icons: 'safe' } }, async ($, on) => {
  const ui = await longPane($, on)
  await ui.pointer({ in: 'list-dir', type: 'move', x: 12, y: 0 })
  await ui.pointer({ in: 'list-dir', type: 'leave', x: 0, y: 0 })
  await ui.pointer({ in: MORE_ID, type: 'move', x: 1, y: 0 })
  expect(await ui.find({ type: 'Text', text: / · shows the whole description$/ })).toBeDefined()
  await ui.pointer({ in: MORE_ID, type: 'down', button: 'left', x: 1, y: 0 })
  await ui.pointer({ in: MORE_ID, type: 'leave', x: 0, y: 0 })
  await ui.pointer({ in: MORE_ID, type: 'move', x: 1, y: 0 })
  expect(await ui.find({ type: 'Text', text: / · cuts it back to two lines$/ })).toBeDefined()
  await ui.unmount()
})

test('icons=nerd draws the Show all control with the Nerd arrows', { options: { icons: 'nerd' } }, async ($, on) => {
  const ui = await longPane($, on)
  await ui.pointer({ in: 'list-dir', type: 'move', x: 12, y: 0 })
  expect(JSON.stringify(await ui.drawn({ in: MORE_ID }))).toContain(String.fromCodePoint(0xf0d7))
  await ui.pointer({ in: MORE_ID, type: 'down', button: 'left', x: 1, y: 0 })
  expect(JSON.stringify(await ui.drawn({ in: MORE_ID }))).toContain(String.fromCodePoint(0xf0d8))
  await ui.unmount()
})
