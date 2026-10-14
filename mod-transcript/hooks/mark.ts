// mod-transcript / hooks/mark.ts, by v-amorim
// Cuts a reply into the parts a copy choice copies and the parts it leaves, so the copied characters can be marked.
import { linkSpans, pieces, plainLine, tableRanges, textOf, type CopyChoice } from './clip'

// A leaf Claude Code draws as markdown, or text the mod draws itself with some characters marked.
export type Piece = { kind: 'markdown'; text: string } | { kind: 'marked'; parts: { text: string; isMarked: boolean }[] }

// The Markdown leaf takes at most this many characters.
const LEAF_LIMIT = 10000

const marked = (text: string): Piece => ({ kind: 'marked', parts: [{ text, isMarked: true }] })

// Prose cut into paragraphs (runs of lines with no blank line), each with its lines.
const paragraphsOf = (text: string) => {
  const found: string[][] = []
  let run: string[] = []
  for (const line of text.split('\n')) {
    if (line.trim()) run.push(line)
    else if (run.length) {
      found.push(run)
      run = []
    }
  }
  return run.length ? [...found, run] : found
}

// A paragraph as plain lines with each link marked; undefined when it names none.
function linkedParagraph(lines: string[]): Piece | undefined {
  const plain = lines.map(plainLine)
  if (!plain.some(line => linkSpans(line).length)) return undefined
  const parts: { text: string; isMarked: boolean }[] = []
  plain.forEach((line, n) => {
    let at = 0
    for (const span of linkSpans(line)) {
      if (span.from > at) parts.push({ text: line.slice(at, span.from), isMarked: false })
      parts.push({ text: line.slice(span.from, span.to), isMarked: true })
      at = span.to
    }
    parts.push({ text: line.slice(at) + (n < plain.length - 1 ? '\n' : ''), isMarked: false })
  })
  return { kind: 'marked', parts }
}

// The reply as pieces with the characters `what` copies marked; null when it marks none, so the reply draws as Claude Code draws it.
export function markPieces(reply: string, what: CopyChoice): Piece[] | null {
  if (what === 'reply') return reply.trim() ? [marked(reply)] : null
  if (what === 'text') {
    const plain = textOf(reply)
    return plain ? [marked(plain)] : null
  }
  const out: Piece[] = []
  let rest = ''
  const flush = () => {
    const text = rest.replace(/^(?:[ \t]*\n)+/, '').trimEnd()
    if (text) out.push({ kind: 'markdown', text })
    rest = ''
  }
  const ranges = what === 'table' ? tableRanges(reply) : []
  for (const [index, part] of pieces(reply).entries()) {
    if (part.isCode) {
      if (what === 'code' && part.text) {
        flush()
        out.push(marked(part.text))
      } else rest += part.raw
      continue
    }
    if (what === 'code') {
      rest += part.raw
      continue
    }
    const lines = part.raw.split('\n')
    if (what === 'table') {
      let at = 0
      for (const range of ranges.filter(each => each.part === index)) {
        rest += lines.slice(at, range.from).join('\n') + '\n'
        flush()
        out.push(marked(lines.slice(range.from, range.to).join('\n')))
        at = range.to
      }
      rest += lines.slice(at).join('\n')
      continue
    }
    for (const run of paragraphsOf(part.raw)) {
      const linked = what === 'links' ? linkedParagraph(run) : undefined
      if (linked) {
        flush()
        out.push(linked)
      } else rest += run.join('\n') + '\n\n'
    }
  }
  flush()
  const isMarking = out.some(piece => piece.kind === 'marked')
  return isMarking && out.every(piece => piece.kind !== 'markdown' || piece.text.length <= LEAF_LIMIT) ? out : null
}
