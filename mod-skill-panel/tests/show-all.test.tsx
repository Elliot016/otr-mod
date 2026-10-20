// mod-skill-panel / tests/show-all.test.tsx, by v-amorim
// Tests the hover card's Show all / Show less control: cut, opened, reset, tip, icon modes.
import { expect, test } from 'claude-code/testing'

type Pointer = { pointer: (event: object) => Promise<unknown> }
const pointing = <T extends object>(ui: T) => ui as T & Pointer

const neutral = (path: string) => path.replace(/\\/g, '/').replace(/^.*?(?=[A-Za-z]:\/)/, '').replace(/^[A-Za-z]:/, '')

const LONG = `${'word '.repeat(119)}last`
const wordsOf = (node: unknown): string => (typeof node === 'string' ? node : Array.isArray(node) ? node.map(wordsOf).join('') : node ? wordsOf((node as { children?: unknown }).children) : '')

const longPane = async ($: any, on: any, agents = false) => {
  on('session.start', () => ({ cwd: '/h' }))
  on('command.register', () => ({ value: { command: 'mod-skill-panel' } }))
  on('state.set', () => ({ value: undefined }) as never)
  on('env.get', (_$: unknown, e: { name: string }) => ({ value: e.name === 'USERPROFILE' ? '/h' : undefined }))
  on('fs.list', (_$: unknown, e: { path: string }) => ({
    value: neutral(e.path).endsWith('/agents') ? (agents ? [{ name: 'big.md', kind: 'file', size: 0, mtimeMs: 0, isLink: false }] : []) : neutral(e.path).endsWith('/mods') ? [] : [
      { name: 'aaa', kind: 'dir', size: 0, mtimeMs: 0, isLink: false },
      { name: 'bbb', kind: 'dir', size: 0, mtimeMs: 0, isLink: false },
    ],
  }))
  on('fs.read', (_$: unknown, e: { path: string }) => {
    const path = neutral(e.path)
    if (path.endsWith('/aaa/SKILL.md')) return { value: `---\nname: aaa\ndescription: ${LONG}\n---\nbody` }
    if (path.endsWith('/bbb/SKILL.md')) return { value: '---\nname: bbb\ndescription: short one\n---\nbody' }
    if (path.endsWith('/big.md')) return { value: `---\nname: big\ndescription: ${LONG}\nmodel: haiku\n---\nbody` }
    throw new Error('ENOENT')
  })
  on('ui.panes', () => ({ value: [] }))
  const ui = pointing(await $.ui.mount({ plugin: 'mod-skill-panel', surface: 'terminal', component: 'Pane', requestId: 'skill-panel', props: { title: 'Skills', isFocused: true, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } } as never))
  await $.session.start({ cwd: '/h' } as never)
  return ui
}

const MORE_ID = 'card-more'

test('a short description shows no Show all control', { options: { icons: 'safe' } }, async ($, on) => {
  const ui = await longPane($, on)
  await ui.pointer({ in: 'skills-cloud', type: 'move', x: 24, y: 0 })
  expect(await ui.find({ type: 'Text', text: /short one/ })).toBeDefined()
  expect(await ui.find({ key: MORE_ID })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /Show all/ })).toBeUndefined()
  await ui.unmount()
})

test('a cut description pins Show all right on its last text row; a click shows all of it with Show less, and a second click cuts it again', { options: { icons: 'safe' } }, async ($, on) => {
  const ui = await longPane($, on)
  expect(await ui.find({ key: 'card-row-gap' })).toBeDefined()
  expect(await ui.find({ key: 'card-row-text' })).toBeDefined()
  expect(wordsOf(await ui.drawn({ in: MORE_ID }))).toBe(' ▾ Show all ')
  expect(await ui.find({ type: 'Text', text: /last/ })).toBeUndefined()
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
  const cut = await spaceOf()
  await ui.pointer({ in: MORE_ID, type: 'down', button: 'left', x: 1, y: 0 })
  expect(await spaceOf()).not.toBe(cut)
  await ui.pointer({ in: MORE_ID, type: 'down', button: 'left', x: 1, y: 0 })
  expect(await spaceOf()).toBe(cut)
  await ui.unmount()
})

test('pointing at another chip returns an opened card to the cut one', { options: { icons: 'safe' } }, async ($, on) => {
  const ui = await longPane($, on)
  await ui.pointer({ in: MORE_ID, type: 'down', button: 'left', x: 1, y: 0 })
  expect(await ui.find({ type: 'Text', text: /last/ })).toBeDefined()
  await ui.pointer({ in: 'skills-cloud', type: 'move', x: 24, y: 0 })
  expect(await ui.find({ type: 'Text', text: /short one/ })).toBeDefined()
  await ui.pointer({ in: 'skills-cloud', type: 'move', x: 16, y: 0 })
  expect(await ui.find({ type: 'Text', text: /last/ })).toBeUndefined()
  expect(wordsOf(await ui.drawn({ in: MORE_ID }))).toBe(' ▾ Show all ')
  await ui.unmount()
})

test('the Show all tip reaches the pane footer', { options: { icons: 'safe' } }, async ($, on) => {
  const ui = await longPane($, on)
  await ui.pointer({ in: MORE_ID, type: 'move', x: 1, y: 0 })
  expect(await ui.find({ type: 'Text', text: ' · shows the whole description' })).toBeDefined()
  await ui.pointer({ in: MORE_ID, type: 'down', button: 'left', x: 1, y: 0 })
  await ui.pointer({ in: MORE_ID, type: 'leave', x: 0, y: 0 })
  await ui.pointer({ in: MORE_ID, type: 'move', x: 1, y: 0 })
  expect(await ui.find({ type: 'Text', text: ' · cuts it back to six lines' })).toBeDefined()
  await ui.unmount()
})

test('icons=nerd draws the Show all control with the Nerd arrows', { options: { icons: 'nerd' } }, async ($, on) => {
  const ui = await longPane($, on)
  expect(JSON.stringify(await ui.drawn({ in: MORE_ID }))).toContain(String.fromCodePoint(0xf0d7))
  await ui.pointer({ in: MORE_ID, type: 'down', button: 'left', x: 1, y: 0 })
  expect(JSON.stringify(await ui.drawn({ in: MORE_ID }))).toContain(String.fromCodePoint(0xf0d8))
  await ui.unmount()
})

test('the agents card cuts and opens the same way', { options: { icons: 'safe' } }, async ($, on) => {
  const ui = await longPane($, on, true)
  await ui.pointer({ in: 'skills-agents', type: 'down', button: 'left', x: 1, y: 0 })
  expect(wordsOf(await ui.drawn({ in: MORE_ID }))).toBe(' ▾ Show all ')
  await ui.pointer({ in: MORE_ID, type: 'down', button: 'left', x: 1, y: 0 })
  expect(wordsOf(await ui.drawn({ in: MORE_ID }))).toBe(' ▴ Show less ')
  expect(await ui.find({ type: 'Text', text: /last/ })).toBeDefined()
  await ui.unmount()
})
