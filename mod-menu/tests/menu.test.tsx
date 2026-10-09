// mod-menu / tests/menu.test.tsx, by v-amorim
// Tests the command that flips the hidden flag and stores it for the next session.
import { expect, test } from 'claude-code/testing'

test('/mod-menu flips hidden and stores it for the next session', async ($, on) => {
  const stored: unknown[] = []
  on('store.set', (_$, e) => {
    stored.push(e.value)
    return { value: undefined }
  })

  await $.command.run({ command: 'mod-menu' } as never)
  await $.command.run({ command: 'mod-menu' } as never)
  expect(stored).toEqual([true, false])
})
