import { expect, test } from 'claude-code/testing'

import { recentSessions, restates, savedOf } from '../hooks/notes'

test('a reworded note restates the one it rewords when 70% of the shorter one\'s topic words appear in the other', () => {
  expect(restates('The main agent cached /ask, so one-off questions now cost more.', 'One-off /ask questions cost more because the main agent cached them.')).toBe(true)
  expect(restates('Retries double the upload cost.', 'Retries now double every upload.')).toBe(true)
  expect(restates('Tests fail on CI.', 'The test fails on the CI.')).toBe(true)
})

test('a note with too few shared topic words is a different note', () => {
  expect(restates('Retries double the upload cost.', 'Every upload waits on the server.')).toBe(false)
  expect(restates('Retries double the upload cost.', 'Retries are slow and cost money.')).toBe(false)
})

test('a note with one topic word restates only the same text', () => {
  expect(restates('Deploy?', 'deploy!')).toBe(true)
  expect(restates('Deploy?', 'Deploy now?')).toBe(false)
})

test('the session list keeps the 40 most recent sessions and names the ones that fall out', () => {
  const sessions = Array.from({ length: 40 }, (_, index) => `s${index}`)
  const { kept, dropped } = recentSessions(sessions, 'new')
  expect(kept.length).toBe(40)
  expect(kept.at(-1)).toBe('new')
  expect(dropped).toEqual(['s0'])
  expect(recentSessions(['a', 'b'], 'a')).toEqual({ kept: ['b', 'a'], dropped: [] })
})

test('the stored last check is kept when it has its three fields, and dropped otherwise', () => {
  expect(savedOf({ notes: [], checked: { turn: 2, at: 5, found: true } }).checked).toEqual({ turn: 2, at: 5, found: true })
  expect(savedOf({ notes: [], checked: 'soon' }).checked).toBe(null)
})
