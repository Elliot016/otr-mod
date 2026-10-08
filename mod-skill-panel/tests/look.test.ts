import { expect, test } from 'claude-code/testing'

import { detectNerd, lookFor } from '../hooks/look'

const LOCAL = 'C:/Users/me/AppData/Local'
const NERD_FONT = '{ "profiles": { "defaults": { "font": { "face": "CaskaydiaCove Nerd Font Mono" } } } }'
const PLAIN_FONT = '{ "profiles": { "defaults": { "font": { "face": "Cascadia Mono" } } } }'

const reading = (text: string) => async () => text

test('Windows Terminal with a Nerd font draws Nerd glyphs', async () => {
  expect(await detectNerd({ WT_SESSION: 'guid' }, LOCAL, reading(NERD_FONT))).toBe(true)
})

test('Windows Terminal with a plain font stays safe', async () => {
  expect(await detectNerd({ WT_SESSION: 'guid' }, LOCAL, reading(PLAIN_FONT))).toBe(false)
})

test('Windows Terminal that names itself keeps the Nerd check', async () => {
  expect(await detectNerd({ WT_SESSION: 'guid', TERM_PROGRAM: 'WindowsTerminal' }, LOCAL, reading(NERD_FONT))).toBe(true)
})

test('mintty inside a Windows Terminal tab stays safe even with a Nerd font', async () => {
  expect(await detectNerd({ WT_SESSION: 'guid', TERM_PROGRAM: 'mintty' }, LOCAL, reading(NERD_FONT))).toBe(false)
})

test('conhost, with neither variable, stays safe and never reads the settings', async () => {
  let reads = 0
  const read = async () => {
    reads += 1
    return NERD_FONT
  }

  expect(await detectNerd({}, LOCAL, read)).toBe(false)
  expect(reads).toBe(0)
})

test('an unreadable settings file stays safe', async () => {
  expect(await detectNerd({ WT_SESSION: 'guid' }, LOCAL, async () => Promise.reject(new Error('missing')))).toBe(false)
})

test('the safe glyph set holds no private-use code points, so it draws without a Nerd font', () => {
  const strings = (value: unknown): string[] => (typeof value === 'string' ? [value] : Object.values(value as object).flatMap(strings))
  const privateUse = strings(lookFor(false).glyph)
    .flatMap(text => [...text])
    .filter(ch => {
      const code = ch.codePointAt(0)!
      return (code >= 0xe000 && code <= 0xf8ff) || code >= 0xf0000
    })

  expect(privateUse).toEqual([])
  expect(lookFor(false).nerd).toBe(false)
})
