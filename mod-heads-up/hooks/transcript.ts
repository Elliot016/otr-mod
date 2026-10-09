// mod-heads-up / hooks/transcript.ts, by v-amorim
// Reads the session transcript a chunk at a time from a byte offset. Pure: no engine calls, so the reads stay in register.tsx.
import { PromptNumbers } from './prompts'

// Bytes per process read: base64 grows a third, so the output stays under the 4 MiB the process result keeps.
export const CHUNK_BYTES = 2 * 1024 * 1024

// One fs.read takes a file up to this size.
export const WHOLE_READ_BYTES = 4 * 1024 * 1024

// How many bytes the text takes in UTF-8, without building them.
export function utf8Length(text: string) {
  let bytes = 0
  for (let at = 0; at < text.length; at++) {
    const code = text.charCodeAt(at)
    if (code < 0x80) bytes += 1
    else if (code < 0x800) bytes += 2
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4
      at++
    } else bytes += 3
  }
  return bytes
}

const LINE_END = 10
const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

// The command that prints `length` bytes of `path` from byte `from`, as base64 so no byte is lost in decoding. Windows reads through PowerShell, elsewhere through tail and head.
export function chunkArgv(path: string, from: number, length: number): string[] {
  if (/^[A-Za-z]:|\\/.test(path)) {
    const quoted = path.replace(/'/g, "''")
    return ['powershell', '-NoProfile', '-NonInteractive', '-Command', `$s = [IO.File]::OpenRead('${quoted}'); try { [void]$s.Seek(${from}, 'Begin'); $b = [byte[]]::new(${length}); $n = $s.Read($b, 0, $b.Length); [Convert]::ToBase64String($b, 0, $n) } finally { $s.Dispose() }`]
  }
  return ['sh', '-c', 'tail -c +"$2" "$1" | head -c "$3" | base64 | tr -d "\\n"', 'sh', path, String(from + 1), String(length)]
}

// Decodes base64 by hand: the mod runtime does not promise atob.
export function bytesOf(base64: string): Uint8Array {
  const clean = base64.replace(/[^A-Za-z0-9+/]/g, '')
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4))
  let bits = 0
  let value = 0
  let at = 0
  for (const char of clean) {
    value = (value << 6) | BASE64.indexOf(char)
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out[at++] = (value >> bits) & 0xff
    }
  }
  return out
}

// Feeds the whole lines of `carry` and `chunk` to the numbers, and returns the bytes of the line still being written. That line is read again next time, once its newline is in the file.
export function feedLines(numbers: PromptNumbers, carry: Uint8Array, chunk: Uint8Array): Uint8Array {
  const bytes = new Uint8Array(carry.length + chunk.length)
  bytes.set(carry)
  bytes.set(chunk, carry.length)
  const end = bytes.lastIndexOf(LINE_END)
  if (end < 0) return bytes
  for (const line of new TextDecoder().decode(bytes.subarray(0, end)).split('\n')) if (line.trim()) numbers.feed(line)
  return bytes.slice(end + 1)
}
