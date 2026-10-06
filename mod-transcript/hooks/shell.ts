// Shell syntax roles for drawing a command, copied from mod-blast-radius/hooks/syntax.ts (mods never share code). Pure.

export type Role = 'command' | 'option' | 'text' | 'variable' | 'number' | 'operator' | 'plain'
export type Span = { text: string; role: Role }

// Wrappers keep the next word in command position: `sudo rm` runs rm.
const WRAPPERS = new Set(['sudo', 'env', 'nice', 'time', 'command', 'nohup', 'exec', 'xargs', 'builtin', 'then', 'do', 'else', 'elif', '!'])
const ASSIGN = /^[A-Za-z_][A-Za-z0-9_]*=/
const BREAK = /^(?:&&|\|\||;|\||&(?!>)|\(|\))/
const REDIRECT = /^(?:\d?>>?&?\d?|<<?<?|&>>?)/
const VARIABLE = /(\$\{[^}]*\}|\$[A-Za-z_]\w*|\$[0-9?#@*!$])/

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
