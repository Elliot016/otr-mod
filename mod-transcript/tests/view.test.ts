// mod-transcript / tests/view.test.ts, by v-amorim
// Tests that a view switch is known before it lands.
import { expect, test } from 'claude-code/testing'

import { announceView, viewing } from '../hooks/view'

test('a switch to an agent is known while the engine still performs it, so rows draw that view from the first frame', async () => {
  viewing.agent = undefined
  let seen: string | undefined = 'unset'
  const shown = await announceView({ agentId: 'a1' }, async () => {
    seen = viewing.agent
    return { value: {} }
  })
  expect(seen).toBe('a1')
  expect(viewing.agent).toBe('a1')
  expect(shown).toEqual({ value: {} })
})

test('a switch back to the main conversation clears the agent', async () => {
  viewing.agent = 'a1'
  await announceView({}, async () => ({ value: {} }))
  expect(viewing.agent).toBeUndefined()
})

test('a refused switch puts the old view back', async () => {
  viewing.agent = undefined
  await announceView({ agentId: 'a1' }, async () => ({ value: { deny: 'not person-initiated' } }))
  expect(viewing.agent).toBeUndefined()
  viewing.agent = 'a2'
  await announceView({}, async () => ({ value: { deny: 'not person-initiated' } }))
  expect(viewing.agent).toBe('a2')
})
