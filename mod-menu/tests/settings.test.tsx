// mod-menu / tests/settings.test.tsx, by v-amorim: the labels setting and /mod-menu labels
import { expect, mock, test } from 'claude-code/testing'

const start = ($: any) => $.session.start({ cwd: '/h' } as never)

// Records every state write by key and answers reads from them.
const states = (on: any) => {
  const written = new Map<string, unknown>()
  on('session.start', () => ({ cwd: '/h' }))
  on('command.register', () => ({ value: undefined }) as never)
  on('state.set', (_$: any, e: any) => {
    written.set(`${e.plugin}.${e.key}`, e.value)
    return { value: undefined }
  })
  on('state.get', (_$: any, e: any) => ({ value: { value: written.get(`${e.plugin}.${e.key}`) } }) as never)
  mock.store(on)
  return written
}

test('the labels setting defaults to always in the shared state', async ($, on) => {
  const written = states(on)
  await start($)
  expect(written.get('mod-menu.labels')).toBe('always')
})

test('the labels setting never reaches the shared state at session start', { options: { labels: 'never' } }, async ($, on) => {
  const written = states(on)
  await start($)
  expect(written.get('mod-menu.labels')).toBe('never')
})

test('/mod-menu labels never saves the setting and sets the state now', async ($, on) => {
  const written = states(on)
  const saved: unknown[] = []
  on('config.set', (_$, e) => {
    saved.push([e.key, e.value])
    return { value: e.value }
  })
  const result = await $.command.run({ command: 'mod-menu', args: 'labels never' } as never)
  expect(saved).toEqual([['mod-menu.labels', 'never']])
  expect(written.get('mod-menu.labels')).toBe('never')
  expect(JSON.stringify(result)).toContain('Menu labels: never')
})

test('/mod-menu labels with no valid mode saves nothing and says the usage', async ($, on) => {
  states(on)
  const saved: unknown[] = []
  on('config.set', (_$, e) => {
    saved.push(e.key)
    return { value: e.value }
  })
  const result = await $.command.run({ command: 'mod-menu', args: 'labels auto' } as never)
  expect(saved).toEqual([])
  expect(JSON.stringify(result)).toContain('Usage: /mod-menu labels always|never')
})

test('/mod-menu with no argument still flips hidden and says so', async ($, on) => {
  states(on)
  expect(JSON.stringify(await $.command.run({ command: 'mod-menu', args: '' } as never))).toContain('Menu hidden')
  expect(JSON.stringify(await $.command.run({ command: 'mod-menu', args: '' } as never))).toContain('Menu shown')
})
