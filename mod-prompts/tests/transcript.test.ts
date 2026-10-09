// mod-prompts / tests/transcript.test.ts, by v-amorim
// Tests transcript reading when a row's parent is missing, keeping earlier prompts listed.
import { expect, test } from 'claude-code/testing'

import { promptsOf, TranscriptRows } from '../hooks/prompts'

const ID = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`
const user = (n: number, parent: number | null, text: string) =>
  JSON.stringify({ type: 'user', uuid: ID(n), parentUuid: parent === null ? null : ID(parent), message: { role: 'user', content: text } })

test('a row whose parent Claude Code never wrote joins the chain through the row before it, so the earlier prompts stay listed', () => {
  const log = new TranscriptRows()
  log.feed([user(1, null, 'first prompt'), user(2, 1, 'second prompt'), user(4, 3, 'third prompt')].join('\n') + '\n')
  expect(promptsOf(log.rows).map(prompt => prompt.text)).toEqual(['first prompt', 'second prompt', 'third prompt'])
})

test('a prompt sent mid-turn with an image, stored as content blocks, is listed in its place', () => {
  const log = new TranscriptRows()
  const queued = JSON.stringify({ type: 'attachment', uuid: ID(2), parentUuid: ID(1), attachment: { type: 'queued_command', prompt: [{ type: 'text', text: '[Image #1] the header' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBOR' } }] } })
  log.feed([user(1, null, 'first prompt'), queued, user(3, 2, 'third prompt')].join('\n') + '\n')
  expect(promptsOf(log.rows).map(prompt => prompt.text)).toEqual(['first prompt', '[Image #1] the header', 'third prompt'])
})

test('a grown transcript parses only the lines past the last complete one, and a torn line waits for the next read', () => {
  const log = new TranscriptRows()
  const first = `${user(1, null, 'first prompt')}\n`
  const second = user(2, 1, 'second prompt')
  expect(log.feed(first + second.slice(0, 20))).toBe(1)
  expect(log.feed(`${first}${second}\n`)).toBe(1)
  expect(log.feed(`${first}${second}\n`)).toBe(0)
  expect(promptsOf(log.rows).map(prompt => prompt.text)).toEqual(['first prompt', 'second prompt'])
})
