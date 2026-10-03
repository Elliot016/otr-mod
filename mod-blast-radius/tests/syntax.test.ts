import { expect, test } from 'claude-code/testing'

import { colorLines, LEGEND, tokenizeLine, wrapSpans } from '../hooks/syntax'

const rolesOf = (line: string) => tokenizeLine(line).filter(span => span.text.trim()).map(span => `${span.role}:${span.text}`)

test('the scanner gives every part of a line its role and joins back to the line exactly', () => {
  const line = 'sudo rm -rf "$HOME/a b" && echo $X 12 > out.txt'
  const spans = tokenizeLine(line)
  expect(spans.map(span => span.text).join('')).toBe(line)
  expect(rolesOf(line)).toEqual([
    'command:sudo',
    'command:rm',
    'option:-rf',
    'text:"',
    'variable:$HOME',
    'text:/a b"',
    'operator:&&',
    'command:echo',
    'variable:$X',
    'number:12',
    'operator:>',
    'plain:out.txt',
  ])
})

test('quotes and escapes: an escaped quote stays inside the string, single quotes hold everything, and operators inside quotes are text', () => {
  expect(rolesOf('echo "a \\" b" c')).toEqual(['command:echo', 'text:"a \\" b"', 'plain:c'])
  expect(rolesOf("echo 'a && $X' ; ls")).toEqual(['command:echo', "text:'a && $X'", 'operator:;', 'command:ls'])
  expect(rolesOf('echo "a | b; c"')).toEqual(['command:echo', 'text:"a | b; c"'])
})

test('assignments and wrappers keep the command position, and a step after an operator starts a new one', () => {
  expect(rolesOf('FOO=1 env BAR=2 rm x | grep y')).toEqual(['variable:FOO=1', 'command:env', 'variable:BAR=2', 'command:rm', 'plain:x', 'operator:|', 'command:grep', 'plain:y'])
})

test('a risky step shows its command word and operands as risk, and the rest keeps its colors', () => {
  const [line] = colorLines('cd ~ && rm -r --force demo "my files" $DIR')
  const roles = line!.filter(span => span.text.trim()).map(span => `${span.role}:${span.text}`)
  expect(roles).toEqual(['command:cd', 'plain:~', 'operator:&&', 'risk:rm', 'option:-r', 'option:--force', 'risk:demo', 'risk:"my files"', 'risk:$DIR'])
})

test('a quoted word is never risky, and a bash -c string that runs is', () => {
  const quoted = colorLines('grep -n "rm -rf x" notes.md')[0]!
  expect(quoted.some(span => span.role === 'risk')).toBe(false)
  const shell = colorLines('bash -c "rm -rf x"')[0]!
  expect(shell.some(span => span.role === 'risk')).toBe(true)
})

test('a heredoc body is muted data unless a shell reads it', () => {
  const data = colorLines("node - <<'EOF'\nrm -rf x\nEOF")
  expect(data.map(line => line.map(span => span.role))).toEqual([['command', 'plain', 'plain', 'plain', 'operator', 'text'], ['muted'], ['muted']])
  const code = colorLines("bash <<'EOF'\nrm -rf x\nEOF")
  expect(code[1]!.some(span => span.role === 'risk')).toBe(true)
  expect(code[2]!.map(span => span.role)).toEqual(['muted'])
})

test('rows wrap at the width, keep their roles, and the cap counts what is left', () => {
  const lines = colorLines('echo "' + 'x'.repeat(30) + '"\nls')
  const wrapped = wrapSpans(lines, 12, 3)
  expect(wrapped.rows).toHaveLength(3)
  expect(wrapped.rows.every(row => row.map(span => span.text).join('').length <= 12)).toBe(true)
  expect(wrapped.more).toBe(2)
  expect(wrapped.rows[1]!.every(span => span.role === 'text')).toBe(true)
})

test('the legend names every role it draws, one row of spans', () => {
  expect(LEGEND.map(span => span.role).filter(role => role !== 'muted')).toEqual(['command', 'option', 'text', 'variable', 'number', 'operator', 'risk'])
  expect(LEGEND.map(span => span.text).join('').length).toBeLessThan(60)
})
