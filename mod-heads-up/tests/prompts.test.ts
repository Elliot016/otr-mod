// mod-heads-up / tests/prompts.test.ts, by v-amorim
// Tests prompt numbering: branches, wrappers, interruptions and placeholder rows.
import { expect, test } from 'claude-code/testing'

import { PromptNumbers } from '../hooks/prompts'

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const row = (n: number, parent: number | null, extra: object) => JSON.stringify({ uuid: ID(n), parentUuid: parent === null ? null : ID(parent), ...extra })
const user = (n: number, parent: number | null, text: string) => row(n, parent, { type: 'user', message: { role: 'user', content: text } })
const said = (n: number, parent: number) => row(n, parent, { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] } })

const feed = (lines: string[]) => {
  const numbers = new PromptNumbers()
  for (const line of lines) numbers.feed(line)
  return numbers
}
const shown = (numbers: PromptNumbers) => numbers.numbered().map(prompt => [prompt.number, prompt.text])
const draws = (...pairs: [string, string][]) => pairs.map(([id, text]) => ({ id, text }))

test('a prompt sent mid-turn with an image, stored as content blocks, takes its number in place', () => {
  const queued = row(3, 2, { type: 'attachment', attachment: { type: 'queued_command', prompt: [{ type: 'text', text: '[Image #1] the header' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBOR' } }] } })
  const numbers = feed([user(1, null, 'first'), said(2, 1), queued, user(4, 3, 'push it')])
  expect(shown(numbers)).toEqual([[1, 'first'], [2, '[Image #1] the header'], [3, 'push it']])
})

test('a prompt the transcript holds is numbered from the file, though the mod never saw it sent', () => {
  const numbers = feed([user(1, null, 'first'), said(2, 1), user(3, 2, 'second'), said(4, 3)])
  expect(shown(numbers)).toEqual([[1, 'first'], [2, 'second']])
  expect(numbers.latest()?.number).toBe(2)
})

test('a /rewind drops the prompts of the abandoned branch, and the next prompt takes the number after the live ones', () => {
  const numbers = feed([user(1, null, 'first'), said(2, 1), user(3, 2, 'second'), said(4, 3), user(5, 2, 'third'), said(6, 5)])
  expect(shown(numbers)).toEqual([[1, 'first'], [2, 'third']])
})

test('a row whose parent Claude Code never wrote joins the chain through the row before it, so the earlier prompts keep their numbers', () => {
  const numbers = feed([user(1, null, 'first'), said(2, 1), user(3, 2, 'second'), said(5, 4), user(6, 5, 'third')])
  expect(shown(numbers)).toEqual([[1, 'first'], [2, 'second'], [3, 'third']])
})

test('a prompt the transcript does not hold, such as one cancelled before it was written, takes no number', () => {
  const numbers = feed([user(1, null, 'first'), said(2, 1)])
  expect(numbers.latest()).toMatchObject({ number: 1, text: 'first' })
})

test('a prompt drawn but never written takes no number once a prompt drawn after it is in the file', () => {
  const numbers = feed([user(1, null, 'first'), said(2, 1), user(3, 2, 'second')])
  numbers.drawn(draws([ID(9), 'cancelled'], [ID(3), 'second']))
  expect(shown(numbers)).toEqual([[1, 'first'], [2, 'second']])
})

test('in a fresh session the first prompt is #1, though Claude Code draws it under a placeholder id first', () => {
  const numbers = new PromptNumbers()
  numbers.drawn(draws(['placeholder', 'first'], [ID(1), 'first'], ['placeholder', 'second']))
  expect(shown(numbers)).toEqual([[1, 'first']])
  numbers.drawn(draws([ID(1), 'first'], [ID(3), 'second']))
  expect(shown(numbers)).toEqual([[1, 'first'], [2, 'second']])
})

test('a prompt drawn before the file holds it counts as live, once', () => {
  const numbers = feed([user(1, null, 'first'), said(2, 1)])
  numbers.drawn(draws([ID(1), 'first'], [ID(9), 'second']))
  expect(shown(numbers)).toEqual([[1, 'first'], [2, 'second']])
  numbers.drawn(draws([ID(1), 'first'], [ID(9), 'second']))
  expect(shown(numbers)).toEqual([[1, 'first'], [2, 'second']])
})

test('reports, tool results, slash commands, interruptions and sidechains take no number, a queued prompt does', () => {
  const numbers = feed([
    user(1, null, 'first'),
    said(2, 1),
    row(3, 2, { type: 'user', isMeta: true, origin: { kind: 'peer' }, message: { role: 'user', content: 'report' } }),
    row(4, 3, { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'ok' }] } }),
    user(5, 4, '/clear'),
    user(6, 5, '[Request interrupted by user]'),
    row(7, 2, { type: 'user', isSidechain: true, message: { role: 'user', content: 'side question' } }),
    row(8, 6, { type: 'attachment', attachment: { type: 'queued_command', prompt: 'queued ask' } }),
  ])
  expect(shown(numbers)).toEqual([[1, 'first'], [2, 'queued ask']])
})

test('a transcript with no prompt has no latest prompt', () => {
  expect(feed([said(1, 0)]).latest()).toBeUndefined()
  expect(new PromptNumbers().latest()).toBeUndefined()
})
