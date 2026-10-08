import { expect, test } from 'claude-code/testing'

import { promptsOf, TranscriptRows } from '../hooks/prompts'

const ID = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`
const user = (n: number, parent: number | null, text: string) =>
  JSON.stringify({ type: 'user', uuid: ID(n), parentUuid: parent === null ? null : ID(parent), message: { role: 'user', content: text } })

test('a grown transcript parses only the lines past the last complete one, and a torn line waits for the next read', () => {
  const log = new TranscriptRows()
  const first = `${user(1, null, 'first prompt')}\n`
  const second = user(2, 1, 'second prompt')
  expect(log.feed(first + second.slice(0, 20))).toBe(1)
  expect(log.feed(`${first}${second}\n`)).toBe(1)
  expect(log.feed(`${first}${second}\n`)).toBe(0)
  expect(promptsOf(log.rows).map(prompt => prompt.text)).toEqual(['first prompt', 'second prompt'])
})
