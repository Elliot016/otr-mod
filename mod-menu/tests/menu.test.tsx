// mod-menu / tests/menu.test.tsx, by v-amorim
// Tests the command that flips the hidden flag and stores it for the next session, its usage line, and the state after a /clear.
import { expect, mock, test } from 'claude-code/testing'

import text from '../hooks/text'

type On = Parameters<Extract<Parameters<typeof test>[1], (...args: never[]) => unknown>>[1]

const BAND = { plugin: 'mod-menu', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 100, scroll: { offset: 0, bodyRows: 6 }, view: {} } } as never

// The store and the state backed by maps; the test clears the state map the way the host does on a /clear.
function stubEngine(on: On) {
  const states = new Map<string, unknown>()
  const store = new Map<string, unknown>()
  on('store.get', (_$, e) => ({ value: store.get(e.key) }))
  on('store.set', (_$, e) => {
    store.set(e.key, e.value)
    return { value: undefined } as never
  })
  on('state.get', (_$, e) => ({ value: { value: states.get(`${e.plugin}.${e.key}`) } }) as never)
  on('state.set', (_$, e) => {
    states.set(`${e.plugin}.${e.key}`, e.value)
    return { value: undefined } as never
  })
  on('session.start', () => ({ cwd: '/w' }))
  on('command.register', () => ({ value: { command: 'mod-menu' } }))
  on('ui.render', ($$, e) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>other mod</Text>
  })
  return { states, store }
}

test('/mod-menu flips hidden and stores it for the next session', async ($, on) => {
  const { store } = stubEngine(on)

  await $.command.run({ command: 'mod-menu' } as never)
  expect(store.get('hidden')).toBe(true)
  await $.command.run({ command: 'mod-menu' } as never)
  expect(store.get('hidden')).toBe(false)
})

test('an unknown word prints usage and changes nothing', async ($, on) => {
  const { states, store } = stubEngine(on)

  const res = await $.command.run({ command: 'mod-menu', args: 'settings' } as never)
  expect(JSON.stringify(res)).toContain(text.usage)
  expect(states.has('mod-menu.hidden')).toBe(false)
  expect(store.has('hidden')).toBe(false)
})

test('a hidden menu stays hidden after a /clear, which empties the state and starts no session', async ($, on) => {
  const { states } = stubEngine(on)
  const clock = mock.clock(on, { now: 0 })
  await $.session.start({ cwd: '/w' } as never)
  await $.command.run({ command: 'mod-menu' } as never)
  expect(states.get('mod-menu.hidden')).toBe(true)

  states.clear()
  const band = await $.ui.mount(BAND)
  await band.drawn()
  await clock.advance(1)
  expect(states.get('mod-menu.hidden')).toBe(true)
  expect(states.get('mod-menu.labels')).toBe('always')
  await band.unmount()
})
