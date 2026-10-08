import { expect, test } from 'claude-code/testing'

import { apiErrorAction, completeLines, questionsOf, reportOf, statusesOf } from '../hooks/rows'

test('a status word comes from a typed result field, never from the words in the output', () => {
  expect(statusesOf({ isInterrupted: false, isDeclined: false, output: { timedOutAfterMs: 120000 } })).toEqual(['timedOut'])
  expect(statusesOf({ isInterrupted: true, isDeclined: false, output: { interrupted: true } })).toEqual(['interrupted'])
  expect(statusesOf({ isInterrupted: false, isDeclined: false, output: { backgroundTaskId: 'b1' } })).toEqual(['background'])
  expect(statusesOf({ isInterrupted: false, isDeclined: false, output: 'started', input: { command: 'ping', run_in_background: true } })).toEqual(['background'])
  expect(statusesOf({ isInterrupted: false, isDeclined: true, output: 'refused' })).toEqual(['declined'])
  expect(statusesOf({ isInterrupted: false, isDeclined: false, output: 'command timed out and was interrupted' })).toEqual([])
})

test('the status words keep their order: timed out, interrupted, background, declined', () => {
  expect(statusesOf({ isInterrupted: true, isDeclined: true, output: { timedOutAfterMs: 1, backgroundedByUser: true } })).toEqual(['timedOut', 'interrupted', 'background', 'declined'])
})

test('AskUserQuestion lists each question with the answer its result holds, or none', () => {
  const input = { questions: [{ question: 'Which db?' }, { question: 'Ship now?' }] }
  expect(questionsOf(input, { answers: { 'Which db?': 'Postgres' } })).toEqual([
    { question: 'Which db?', answer: 'Postgres' },
    { question: 'Ship now?', answer: undefined },
  ])
  expect(questionsOf({}, undefined)).toEqual([])
})

test('an API error the engine retries is a warning; the others need the person', () => {
  expect(apiErrorAction('rate_limit')).toBe('retry')
  expect(apiErrorAction('overloaded')).toBe('retry')
  expect(apiErrorAction('server_error')).toBe('retry')
  expect(apiErrorAction('billing_error')).toBe('act')
  expect(apiErrorAction('unknown')).toBe('act')
})

test('a report names its sender or task, and carries the task fields it parsed', () => {
  expect(reportOf({ name: 'researcher' }, { id: 'a1', status: 'completed', type: 'local_agent', durationMs: 122000 })).toEqual({
    name: 'researcher',
    status: 'completed',
    durationMs: 122000,
    id: 'a1',
    type: 'local_agent',
  })
  expect(reportOf(undefined, { type: 'local_bash' }).name).toBe('local_bash')
})

test('a read keeps its unfinished last line for the next read', () => {
  expect(completeLines('a\n{"b')).toEqual({ lines: ['a'], rest: '{"b' })
  expect(completeLines('x\n')).toEqual({ lines: ['x'], rest: '' })
  expect(completeLines('')).toEqual({ lines: [], rest: '' })
})
