// mod-heads-up / tests/transcript.test.ts, by v-amorim
// Tests chunked transcript reads: byte offsets, chunk arguments and line feeding.
import { expect, test } from 'claude-code/testing'

import { PromptNumbers } from '../hooks/prompts'
import { bytesOf, chunkArgv, feedLines } from '../hooks/transcript'

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const row = (n: number, parent: number | null, text: string) =>
  JSON.stringify({ type: 'user', uuid: ID(n), parentUuid: parent === null ? null : ID(parent), message: { role: 'user', content: text } }) + '\n'
const bytes = (text: string) => new TextEncoder().encode(text)
const base64Of = (data: Uint8Array) => btoa(Array.from(data, byte => String.fromCharCode(byte)).join(''))

test('base64 from the process decodes to the bytes it encodes, multi-byte characters included', () => {
  const text = 'first café ✓ 日本\n'
  expect(Array.from(bytesOf(base64Of(bytes(text))))).toEqual(Array.from(bytes(text)))
})

test('a line still being written is held back, then fed whole once its newline arrives', () => {
  const numbers = new PromptNumbers()
  const whole = row(1, null, 'first') + row(2, 1, 'second')
  const cut = whole.indexOf('second') + 3
  let carry = feedLines(numbers, new Uint8Array(0), bytes(whole.slice(0, cut)))
  expect(numbers.numbered().map(prompt => prompt.text)).toEqual(['first'])
  carry = feedLines(numbers, carry, bytes(whole.slice(cut)))
  expect(numbers.numbered().map(prompt => prompt.text)).toEqual(['first', 'second'])
  expect(carry.length).toBe(0)
})

test('a multi-byte character cut by a chunk edge is read whole', () => {
  const numbers = new PromptNumbers()
  const line = bytes(row(1, null, 'café'))
  const cut = line.indexOf(0xc3) + 1
  let carry = feedLines(numbers, new Uint8Array(0), line.subarray(0, cut))
  carry = feedLines(numbers, carry, line.subarray(cut))
  expect(numbers.latest()?.text).toBe('café')
})

test('a read from an offset asks tail and head on a POSIX path, and PowerShell on a Windows one', () => {
  expect(chunkArgv('/home/u/s1.jsonl', 100, 50).slice(0, 2)).toEqual(['sh', '-c'])
  expect(chunkArgv('/home/u/s1.jsonl', 100, 50).slice(3)).toEqual(['sh', '/home/u/s1.jsonl', '101', '50'])
  const windows = chunkArgv('C:/Users/O\'Brien/s1.jsonl', 100, 50)
  expect(windows[0]).toBe('powershell')
  expect(windows[4]).toContain("OpenRead('C:/Users/O''Brien/s1.jsonl')")
  expect(windows[4]).toContain('Seek(100, \'Begin\')')
  expect(windows[4]).toContain('[byte[]]::new(50)')
})
