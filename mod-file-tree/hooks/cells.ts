// Terminal cells: East Asian wide and emoji code points take two, combining marks and joiners none, anything else one.
const WIDE: [number, number][] = [
  [0x1100, 0x115f],
  [0x2e80, 0x303e],
  [0x3041, 0x33ff],
  [0x3400, 0x4dbf],
  [0x4e00, 0x9fff],
  [0xa000, 0xa4cf],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe30, 0xfe4f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x1f300, 0x1faff],
  [0x20000, 0x3fffd],
]

const ZERO: [number, number][] = [
  [0x0300, 0x036f],
  [0x200b, 0x200d],
  [0xfe00, 0xfe0f],
]

const within = (code: number, ranges: [number, number][]) => ranges.some(([from, to]) => code >= from && code <= to)

export const cellOf = (char: string) => {
  const code = char.codePointAt(0)!
  if (within(code, ZERO)) return 0
  return within(code, WIDE) ? 2 : 1
}

export const cells = (text: string) => {
  let sum = 0
  for (const char of text) sum += cellOf(char)
  return sum
}

// The text cut to `width` cells, its last cell an ellipsis when it had to cut; spaces stay as written.
export function cut(text: string, width: number) {
  if (cells(text) <= width) return text
  let out = ''
  let used = 0
  for (const char of text) {
    const next = used + cellOf(char)
    if (next > width - 1) break
    out += char
    used = next
  }
  return `${out}…`
}

// One line, runs of whitespace joined, cut to `width` cells.
export const fit = (text: string, width: number) => cut(text.replace(/\s+/g, ' '), width)

// A Text inside a card overflows instead of wrapping, so long lines break at word boundaries here.
export function wrapWords(line: string, width: number) {
  const rows: string[] = []
  let row = ''
  for (const word of line.split(' ')) {
    if (row && cells(row) + 1 + cells(word) > width) {
      rows.push(row)
      row = word
    } else row = row ? `${row} ${word}` : word
  }
  return [...rows, row]
}
