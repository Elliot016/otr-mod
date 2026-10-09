// mod-menu / tests/row.test.tsx, by v-amorim
// Tests how tip messages become band tip row text and how a leave clears it.
import { expect, test } from 'claude-code/testing'

import { tipText } from '../hooks/entry'

test('a tip message becomes the band tip row text, and a leave clears it', () => {
  expect(tipText({ type: 'tip', id: 'x', glyph: '>', label: 'Ask', text: 'sends a note' })).toBe('Ask: sends a note')
  expect(tipText({ type: 'tip', id: null })).toBe('')
})
