// Shell syntax roles for drawing a command: one scanner for the colors, the same step rules the matcher uses for what is risky. Pure.
import { classify, HEREDOC_MARK, receiverOf, RUNS_BODY, type UserRule } from './risk'

export type Role = 'command' | 'option' | 'text' | 'variable' | 'number' | 'operator' | 'plain' | 'risk' | 'muted'
export type Span = { text: string; role: Role }

// Wrappers keep the next word in command position: `sudo rm` runs rm.
const WRAPPERS = new Set(['sudo', 'env', 'nice', 'time', 'command', 'nohup', 'exec', 'xargs', 'builtin', 'then', 'do', 'else', 'elif', '!'])
const ASSIGN = /^[A-Za-z_][A-Za-z0-9_]*=/
const BREAK = /^(?:&&|\|\||;|\||&(?!>)|\(|\))/
const REDIRECT = /^(?:\d?>>?&?\d?|<<?<?|&>>?)/
const VARIABLE = /(\$\{[^}]*\}|\$[A-Za-z_]\w*|\$[0-9?#@*!$])/
const STEP_END = /^(?:&&|\|\||;|\||&)$/

// Splits one line of shell into colored spans that join back to the line exactly.
export function tokenizeLine(line: string): Span[] {
  const spans: Span[] = []
  const push = (text: string, role: Role) => {
    if (text) spans.push({ text, role })
  }
  const withVariables = (text: string, role: Role) => text.split(VARIABLE).forEach((part, index) => push(part, index % 2 ? 'variable' : role))
  let isCommand = true
  let isTarget = false
  let i = 0
  while (i < line.length) {
    const rest = line.slice(i)
    const c = line[i]!
    const space = /^\s+/.exec(rest)
    if (space) {
      push(space[0], 'plain')
      i += space[0].length
      continue
    }
    const brk = BREAK.exec(rest)
    if (brk) {
      push(brk[0], 'operator')
      i += brk[0].length
      isCommand = true
      isTarget = false
      continue
    }
    const redirect = REDIRECT.exec(rest)
    if (redirect) {
      push(redirect[0], 'operator')
      i += redirect[0].length
      isTarget = true
      continue
    }
    if (c === "'" || c === '"') {
      let end = i + 1
      while (end < line.length && line[end] !== c) end += c === '"' && line[end] === '\\' ? 2 : 1
      end = Math.min(line.length, end + 1)
      const body = line.slice(i, end)
      if (c === '"') withVariables(body, 'text')
      else push(body, 'text')
      i = end
      isCommand = false
      isTarget = false
      continue
    }
    const word = /^[^\s&|;()<>'"]+/.exec(rest)?.[0] ?? c
    if (isTarget) withVariables(word, 'plain')
    else if (isCommand && word.startsWith('-') && word.length > 1) push(word, 'option')
    else if (isCommand && ASSIGN.test(word)) push(word, 'variable')
    else if (isCommand) {
      push(word, 'command')
      if (!WRAPPERS.has(word)) isCommand = false
    } else if (word.startsWith('-') && word.length > 1) withVariables(word, 'option')
    else if (/^\d+(?:\.\d+)?$/.test(word)) push(word, 'number')
    else withVariables(word, 'plain')
    isTarget = false
    i += word.length
  }
  return spans
}

// A risky step shows its command word and its operands as risk, so the dangerous part stands out; options keep their color.
function markRisk(spans: Span[], rules: UserRule[]): Span[] {
  const out = spans.map(span => ({ ...span }))
  let start = 0
  const closeStep = (end: number) => {
    const text = out.slice(start, end).map(span => span.text).join('').trim().replace(/^(?:do|then|else)\s+/, '')
    if (text && classify(text, rules)) {
      for (let at = start; at < end; at++) {
        const span = out[at]!
        const isOperand = span.role === 'plain' || span.role === 'text' || span.role === 'variable' || span.role === 'number'
        if ((span.role === 'command' && !WRAPPERS.has(span.text)) || (isOperand && span.text.trim())) span.role = 'risk'
      }
    }
    start = end + 1
  }
  out.forEach((span, at) => {
    if (span.role === 'operator' && STEP_END.test(span.text)) closeStep(at)
  })
  closeStep(out.length)
  return out
}

// The whole command, line by line. A heredoc body is muted data unless a shell or a SQL client reads it.
export function colorLines(command: string, rules: UserRule[] = []): Span[][] {
  const out: Span[][] = []
  const pending: { delimiter: string; isCode: boolean }[] = []
  for (const line of command.split('\n')) {
    const head = pending[0]
    if (head) {
      if (line.trim() === head.delimiter) {
        pending.shift()
        out.push([{ text: line, role: 'muted' }])
      } else out.push(head.isCode ? markRisk(tokenizeLine(line), rules) : [{ text: line, role: 'muted' }])
      continue
    }
    out.push(markRisk(tokenizeLine(line), rules))
    const marks = [...line.matchAll(HEREDOC_MARK)]
    if (marks.length) {
      const isCode = RUNS_BODY.has(receiverOf(line.slice(0, marks[0]!.index)))
      for (const mark of marks) pending.push({ delimiter: mark[1] ?? mark[2] ?? mark[3]!, isCode })
    }
  }
  return out
}

// One step of the command, colored the same way.
export const colorStep = (text: string, rules: UserRule[] = []) => colorLines(text, rules)[0] ?? []

// Rows no wider than the width, at most maxRows of them, with the rest counted.
export function wrapSpans(lines: Span[][], width: number, maxRows: number) {
  const rows: Span[][] = []
  for (const spans of lines) {
    let row: Span[] = []
    let used = 0
    for (const span of spans) {
      let text = span.text
      while (text.length) {
        if (used === width) {
          rows.push(row)
          row = []
          used = 0
        }
        const take = text.slice(0, width - used)
        row.push({ text: take, role: span.role })
        used += take.length
        text = text.slice(take.length)
      }
    }
    rows.push(row)
  }
  return { rows: rows.slice(0, maxRows), more: Math.max(0, rows.length - maxRows) }
}

// What each color means, drawn in those colors.
export const LEGEND: Span[] = [
  { text: 'command', role: 'command' },
  { text: ' · ', role: 'muted' },
  { text: '--option', role: 'option' },
  { text: ' · ', role: 'muted' },
  { text: '"text"', role: 'text' },
  { text: ' · ', role: 'muted' },
  { text: '$var', role: 'variable' },
  { text: ' · ', role: 'muted' },
  { text: '12', role: 'number' },
  { text: ' · ', role: 'muted' },
  { text: '&&', role: 'operator' },
  { text: ' · ', role: 'muted' },
  { text: 'risky part', role: 'risk' },
]
