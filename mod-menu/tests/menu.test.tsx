import { expect, test } from 'claude-code/testing'

test('/mod-menu flips hidden and stores it for the next session', async ($, on) => {
  const stored: unknown[] = []
  on('store.set', (_$, e) => {
    stored.push(e.value)
    return { value: undefined }
  })

  await $.command.run({ command: 'mod-menu' })
  await $.command.run({ command: 'mod-menu' })
  expect(stored).toEqual([true, false])
})
