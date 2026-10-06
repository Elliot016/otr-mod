import { expect, test } from 'claude-code/testing'

import { checkPrompt, parseCheck, parseRewrite, rewritePrompt } from '../hooks/ask'
import { byTurn, canFork, pack, remember, savedOf, shouldCheck, type Note } from '../hooks/notes'

test('a check runs on every sixth main step, once per turn, never over a shown card', () => {
  expect([1, 2, 3, 4, 5].map(index => shouldCheck(index, 't1', '', false))).toEqual([false, false, false, false, false])
  expect(shouldCheck(0, 't1', '', false)).toBe(false)
  expect(shouldCheck(6, 't1', '', false)).toBe(true)
  expect(shouldCheck(12, 't1', 't1', false)).toBe(false)
  expect(shouldCheck(12, 't2', 't1', false)).toBe(true)
  expect(shouldCheck(6, 't2', 't1', true)).toBe(false)
})

test('the check forks at low or medium effort and takes the uncached route above', () => {
  expect([undefined, 'low', 'medium', 3].map(canFork)).toEqual([true, true, true, true])
  expect(['high', 'xhigh', 'max'].map(canFork)).toEqual([false, false, false])
})

test('learn: none, an empty learn line or unreadable text shows nothing', () => {
  expect(parseCheck('learn: none')).toBe(null)
  expect(parseCheck('learn: None.')).toBe(null)
  expect(parseCheck('learn:')).toBe(null)
  expect(parseCheck('I think you are doing great!')).toBe(null)
  expect(parseCheck(`learn: ${'x'.repeat(300)}`)).toBe(null)
})

test('a full reply reads its learn line, tag, title and plain bullet lines', () => {
  const reply = [
    '**learn:** The main agent cached /ask, so one-off questions now cost about 25% more.',
    'tag: Heads up',
    'title: One-off /ask questions now cost more.',
    'explain:',
    '- **/ask** takes a quick side question.',
    '* Caching costs `1.25x` to save.',
    '',
    '- Watch how often people ask follow-ups.',
  ].join('\n')
  expect(parseCheck(reply)).toEqual({
    learn: 'The main agent cached /ask, so one-off questions now cost about 25% more.',
    tag: 'Heads up',
    title: 'One-off /ask questions now cost more',
    body: ['/ask takes a quick side question.', 'Caching costs 1.25x to save.', 'Watch how often people ask follow-ups.'],
  })
})

test('a reply without a tag or a body is still a note, tagged You should know', () => {
  expect(parseCheck('learn: The queue retries failed orders, so one can be sent twice.')).toEqual({
    learn: 'The queue retries failed orders, so one can be sent twice.',
    tag: 'You should know',
    title: '',
    body: [],
  })
})

test('the prompt lists what was offered and what the person knows; a rewrite carries the note and its direction', () => {
  const prompt = checkPrompt(['Caching costs more.'], ['Prompt caching'])
  expect(prompt).toContain('- Caching costs more.')
  expect(prompt).toContain('- Prompt caching')
  expect(prompt).toContain('learn: none')
  expect(checkPrompt([], [])).toContain('- (none)')
  const rewrite = rewritePrompt({ learn: 'L.', tag: 'Heads up', title: 'T', body: ['one'] }, 'less')
  expect(rewrite).toContain('learn: L.')
  expect(rewrite).toContain('At most 45 words')
  expect(parseRewrite('title: Shorter\nexplain:\n- just this')).toEqual({ title: 'Shorter', body: ['just this'] })
  expect(parseRewrite('no body here')).toBe(null)
})

test('the packed conversation keeps the newest messages within its budget, oldest first', () => {
  const messages = [
    { role: 'user' as const, text: 'old prompt', toolUses: [] },
    { role: 'assistant' as const, text: 'did it', toolUses: [{ tool_use_id: 'a', tool: 'Bash', input: { command: 'ls' }, text: 'a.txt' }] },
    { role: 'user' as const, text: 'new prompt', toolUses: [] },
  ]
  const all = pack(messages)
  expect(all.indexOf('Person: old prompt') < all.indexOf('Person: new prompt')).toBe(true)
  expect(all).toContain('[Bash] {"command":"ls"} -> a.txt')
  expect(pack(messages, 20)).toBe('Person: new prompt')
})

test('notes group by turn, newest first; stored values are checked on load', () => {
  const note = (id: string, turn: number): Note => ({ id, turn, prompt: `p${turn}`, at: turn, isRead: false, learn: id, tag: 'Heads up', title: '', body: [] })
  expect(byTurn([note('a', 1), note('b', 3), note('c', 1)]).map(group => [group.turn, group.notes.map(each => each.id)])).toEqual([[3, ['b']], [1, ['a', 'c']]])
  expect(savedOf(undefined)).toEqual({ notes: [], prompts: 0, lastPrompt: '', card: null, since: 0 })
  expect(savedOf({ notes: [note('a', 1)], card: 'gone', prompts: 2 }).card).toBe(null)
  expect(remember(['a', 'b', 'c'], 'a', 2)).toEqual(['c', 'a'])
})
