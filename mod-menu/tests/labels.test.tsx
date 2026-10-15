// mod-menu / tests/labels.test.tsx, by v-amorim
// Tests the icon a menu entry leads with and the `labels` mode that can hide its text.
import { expect, test } from 'claude-code/testing'

import { labelsOf, menuEntry, PILL } from '../hooks/pills'
import style from '../hooks/style'
import { decodeAll, mix, THEME, WASH } from '../hooks/theme'

const els: any = { Box: (props: any) => props, Text: (props: any) => props, Client: (props: any) => props }

type Node = { key?: string; props?: Record<string, any>; children?: Node[] }

const entryProps = (node: unknown): Record<string, any> => {
  const found: Node[] = []
  const walk = (value: Node) => {
    if (value.key?.startsWith('menu-entry-')) found.push(value)
    for (const child of value.children ?? []) walk(child)
  }
  walk(node as Node)
  return found[0]!.props!
}

const ids = ['skills', 'prompts', 'filetree', 'progress', 'headsup']
const icon = (id: string) => decodeAll((style.glyphs.nerd.icon as Record<string, string>)[`menu-${id}`]!)

test('on Nerd an entry leads with its bare icon and keeps its label after a gap', () => {
  for (const id of ids) {
    const props = entryProps(menuEntry(els, true, id, { label: 'Name', isOpen: false }))
    expect(props.lead).toBe(icon(id))
    expect(props.label).toBe(' Name')
  }
})

test('labels never leaves the icon alone on Nerd', () => {
  const props = entryProps(menuEntry(els, true, 'skills', { label: 'Skills', isOpen: false, labels: 'never' }))
  expect(props.lead).toBe(icon('skills'))
  expect(props.label).toBe('')
})

test('safe mode has no icon, so labels never still shows the label', () => {
  const props = entryProps(menuEntry(els, false, 'skills', { label: 'Skills', isOpen: false, labels: 'never' }))
  expect(props.lead).toBeUndefined()
  expect(props.label).toBe('Skills')
})

test('an entry with no icon of its own, or a lead the caller set, is left as it was', () => {
  expect(entryProps(menuEntry(els, true, 'manager', { label: 'X', isOpen: false })).lead).toBeUndefined()
  expect(entryProps(menuEntry(els, true, 'skills', { label: 'Skills', isOpen: false, lead: '*' })).label).toBe('Skills')
})

test('the open pane draws like an On switch, text in ok on ok washed into the group fill; closed entries stay as they were', () => {
  const open = entryProps(menuEntry(els, true, 'skills', { label: 'Skills', isOpen: true }))
  expect(open.bg).toBe(mix(THEME.ok, PILL.primary, WASH))
  expect(open.color).toBe(THEME.ok)
  const closed = entryProps(menuEntry(els, true, 'skills', { label: 'Skills', isOpen: false }))
  expect(closed.bg).toBe(PILL.primary)
  expect(closed.color).toBeUndefined()
})

test('every menu icon is one private-use code point, so it takes one cell', () => {
  for (const id of ids) expect([...icon(id)].length).toBe(1)
})

test('the labels state reads always unless it says never, so a mod works without mod-menu', () => {
  expect(labelsOf('never')).toBe('never')
  expect(labelsOf('always')).toBe('always')
  expect(labelsOf(undefined)).toBe('always')
  expect(labelsOf('auto')).toBe('always')
})
