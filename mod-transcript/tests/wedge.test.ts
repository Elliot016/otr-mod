// mod-transcript / tests/wedge.test.ts, by v-amorim
// Tests wedge choice for iTerm2 with custom box drawing on, off or unreadable.
import { expect, test } from 'claude-code/testing'

import { detectWedge, FILLED, OUTLINE } from '../hooks/wedge'

const answering = (out: string) => async () => out
const failing = async () => Promise.reject(new Error('The domain/default pair does not exist'))

test('iTerm2 with its custom box drawing on gets the outline wedge, whether the key is missing or 0', async () => {
  expect(await detectWedge('iTerm.app', failing)).toEqual(OUTLINE)
  expect(await detectWedge('iTerm.app', answering('0\n'))).toEqual(OUTLINE)
})

test('iTerm2 with its custom box drawing disabled draws the filled wedge from the font', async () => {
  expect(await detectWedge('iTerm.app', answering('1\n'))).toEqual(FILLED)
})

test('iTerm2 reads the setting with defaults, and no other terminal runs anything', async () => {
  const ran: string[] = []
  const run = async (argv: string[]) => (ran.push(argv.join(' ')), '1')

  await detectWedge('iTerm.app', run)
  expect(ran).toEqual(['defaults read com.googlecode.iterm2 DisableCustomBoxDrawing'])

  ran.length = 0
  for (const program of [undefined, 'WindowsTerminal', 'mintty', 'vscode', 'Apple_Terminal', 'ghostty']) expect(await detectWedge(program, run)).toEqual(FILLED)
  expect(ran).toEqual([])
})
