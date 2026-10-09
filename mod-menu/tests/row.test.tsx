// mod-menu / tests/row.test.tsx, by v-amorim
// Tests how tip messages become band tip row text and how a leave clears it.
import { expect, test } from 'claude-code/testing'

import Entry, { tipText } from '../hooks/entry'

test('a tip message becomes the band tip row text, and a leave clears it', () => {
  expect(tipText({ type: 'tip', id: 'x', glyph: '>', label: 'Ask', text: 'sends a note' })).toBe('Ask: sends a note')
  expect(tipText({ type: 'tip', id: null })).toBe('')
})

// A stand-in surface that counts running timers, since every pill, tab and row mounts an entry.
function fakeSurface() {
  const running = new Set<() => void>()
  let pointer: (event: any) => void = () => {}
  const posts: unknown[] = []
  const surface: any = {
    elements: { Box: (props: any) => props, Text: (props: any) => props },
    state: undefined,
    setState: (state: any) => (surface.state = state),
    every: (_ms: number, fn: () => void) => {
      running.add(fn)
      return () => running.delete(fn)
    },
    onPointer: (handler: (event: any) => void) => (pointer = handler),
    post: (data: unknown) => posts.push(data),
  }
  return { surface, running, posts, point: (event: object) => pointer(event), tick: () => [...running].forEach(fn => fn()) }
}

const PROPS = { id: 'x', label: 'Files', isOpen: false, bg: '#000000' }

test('an entry at rest runs no timer; a busy one shimmers until it is idle again, and a hover runs it until the pointer leaves', () => {
  const idle = fakeSurface()
  Entry(PROPS, idle.surface)
  expect(idle.running.size).toBe(0)

  const busy = fakeSurface()
  Entry({ ...PROPS, isBusy: true }, busy.surface)
  expect(busy.running.size).toBe(1)
  busy.tick()
  expect(busy.surface.state.phase).toBe(1)
  Entry(PROPS, busy.surface)
  busy.tick()
  expect(busy.running.size).toBe(0)

  const hovered = fakeSurface()
  Entry(PROPS, hovered.surface)
  hovered.point({ type: 'move', x: 0, y: 0 })
  Entry(PROPS, hovered.surface)
  hovered.tick()
  expect(hovered.running.size).toBeGreaterThan(0)
  hovered.point({ type: 'leave', x: 0, y: 0 })
  for (let n = 0; n < 5; n++) hovered.tick()
  expect(hovered.running.size).toBe(0)
})

test('with animations off a busy entry starts no timer', () => {
  const still = fakeSurface()
  Entry({ ...PROPS, isBusy: true, still: true }, still.surface)
  expect(still.running.size).toBe(0)
})
