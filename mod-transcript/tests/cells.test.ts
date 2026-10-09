// mod-transcript / tests/cells.test.ts, by v-amorim
// Tests terminal cell width counting plus cutting, fitting and word wrapping by cells.
import { expect, test } from 'claude-code/testing'

import { cells, cut, fit, wrapWords } from '../hooks/cells'

test('a terminal cell count takes ASCII as one, CJK, Hangul and fullwidth forms as two, emoji as two, marks as none', () => {
  expect(cells('abc')).toBe(3)
  expect(cells('日本')).toBe(4)
  expect(cells('한국')).toBe(4)
  expect(cells('ＡＢ')).toBe(4)
  expect(cells('🚀')).toBe(2)
  expect(cells('🧠x')).toBe(3)
  expect(cells('é')).toBe(1)
})

test('a cut keeps leading spaces, so a diff preview keeps its indentation', () => {
  expect(cut('    indented line', 12)).toBe('    indente…')
  expect(cut('short', 12)).toBe('short')
})

test('a cut counts wide characters by cells and never splits one', () => {
  expect(cut('日本語テキスト', 5)).toBe('日本…')
})

test('a label fit runs its whitespace together and fits the cells it is given', () => {
  expect(fit('a   b\n c', 20)).toBe('a b c')
  expect(fit('日本語テキスト', 6)).toBe('日本…')
})

test('a wrapped line breaks at words, counting wide words by cells', () => {
  expect(wrapWords('日本語 テキスト', 6)).toEqual(['日本語', 'テキスト'])
  expect(wrapWords('one two three', 7)).toEqual(['one two', 'three'])
})
