export type Kind = 'read' | 'edit' | 'write' | 'new'

export type Line = { op: '+' | '-' | ' ' | '~'; t: string }

export type Step = { id: number; turn: number; path: string; tool: string; kind: Kind; note: string; add: number; del: number; lines: Line[] }

// One touched file: its strongest action, the latest one, and the line counts its edits added up to.
export type Entry = { path: string; kind: Kind; last: Kind; seq: number; add: number; del: number }

export type Log = { turn: number; seq: number; working: boolean; files: Entry[]; steps: Step[] }

export const emptyLog = (): Log => ({ turn: 0, seq: 0, working: false, files: [], steps: [] })

const MAX_STEPS = 100
const MAX_LINES = 80
const MAX_DIFF_INPUT = 400

const STRENGTH: Record<Kind, number> = { read: 0, edit: 1, write: 2, new: 3 }

export const norm = (path: string) => path.replace(/\\/g, '/')

// Paths inside the working folder are shown relative to it; others keep their full path.
export function relPath(cwd: string, path: string) {
  const file = norm(path)
  const root = norm(cwd).replace(/\/+$/, '')
  if (root && file.toLowerCase().startsWith(`${root.toLowerCase()}/`)) return file.slice(root.length + 1)
  return file
}

const splitLines = (text: string | undefined) => {
  if (!text) return []
  const lines = text.split('\n')
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()
  return lines
}

// Keeps one line of context around each change, so a long file shows only what moved.
function trimContext(lines: Line[]): Line[] {
  if (!lines.some(line => line.op !== ' ')) return lines.slice(0, 6)
  const keep = lines.map((line, at) => line.op !== ' ' || (lines[at - 1] && lines[at - 1]!.op !== ' ') || (lines[at + 1] && lines[at + 1]!.op !== ' '))
  const out: Line[] = []
  let skipped = false
  lines.forEach((line, at) => {
    if (keep[at]) {
      if (skipped && out.length) out.push({ op: '~', t: '...' })
      out.push(line)
      skipped = false
    } else skipped = true
  })
  return out
}

// A line diff: LCS for small inputs, all removed then all added for big ones.
export function diffLines(before: string | undefined, after: string | undefined): Line[] {
  const a = splitLines(before)
  const b = splitLines(after)
  if (a.length > MAX_DIFF_INPUT || b.length > MAX_DIFF_INPUT) {
    return [...a.map(t => ({ op: '-' as const, t })), ...b.map(t => ({ op: '+' as const, t }))]
  }
  const n = a.length
  const m = b.length
  const dp = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!)
  }
  const out: Line[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ op: ' ', t: a[i]! })
      i++
      j++
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) out.push({ op: '-', t: a[i++]! })
    else out.push({ op: '+', t: b[j++]! })
  }
  while (i < n) out.push({ op: '-', t: a[i++]! })
  while (j < m) out.push({ op: '+', t: b[j++]! })
  return trimContext(out)
}

export const countOf = (lines: Line[]) => ({
  add: lines.filter(line => line.op === '+').length,
  del: lines.filter(line => line.op === '-').length,
})

// Marks a file as touched, before its call runs, so the tree shows what Claude is doing right now.
export function touch(log: Log, path: string, kind: Kind): Log {
  const seq = log.seq + 1
  const found = log.files.find(file => file.path === path)
  const files = found
    ? log.files.map(file => (file === found ? { ...file, last: kind, seq, kind: STRENGTH[kind] > STRENGTH[file.kind] ? kind : file.kind } : file))
    : [...log.files, { path, kind, last: kind, seq, add: 0, del: 0 }]
  return { ...log, seq, files }
}

// Records a finished edit: its diff steps through the replay, and its counts join the file's.
export function commit(log: Log, path: string, tool: string, kind: Kind, note: string, lines: Line[]): Log {
  const { add, del } = countOf(lines)
  const shown = lines.length > MAX_LINES ? [...lines.slice(0, MAX_LINES), { op: '~' as const, t: `... ${lines.length - MAX_LINES} more lines` }] : lines
  const id = log.steps.length === 0 ? 1 : log.steps[log.steps.length - 1]!.id + 1
  const step: Step = { id, turn: log.turn, path, tool, kind, note, add, del, lines: shown }
  const files = log.files.map(file => (file.path === path ? { ...file, add: file.add + add, del: file.del + del } : file))
  return { ...log, files, steps: [...log.steps, step].slice(-MAX_STEPS) }
}

// The steps the replay walks: those of one turn, by default the latest turn that edited anything.
export const stepsOfTurn = (log: Log, turn: number | null) => {
  const at = turn ?? log.steps[log.steps.length - 1]?.turn
  return log.steps.filter(step => step.turn === at)
}

export const latestStepOf = (log: Log, path: string) => [...log.steps].reverse().find(step => step.path === path)

export type Row = { isDir: boolean; depth: number; name: string; key: string; entry?: Entry; isFolded: boolean }

type Node = { name: string; key: string; dirs: Map<string, Node>; files: Entry[] }

const shownFiles = (log: Log, showReads: boolean) => log.files.filter(entry => showReads || entry.kind !== 'read')

// The folder every shown file sits in, so the tree starts there instead of at the drive.
export function rootOf(log: Log, showReads: boolean) {
  const dirs = shownFiles(log, showReads).map(entry => entry.path.split('/').slice(0, -1))
  if (dirs.length === 0) return ''
  let shared = dirs[0]!
  for (const dir of dirs.slice(1)) {
    let same = 0
    while (same < shared.length && same < dir.length && shared[same]!.toLowerCase() === dir[same]!.toLowerCase()) same++
    shared = shared.slice(0, same)
  }
  return shared.join('/')
}

// Flat rows below the root, folders first; single-folder chains merge into one row, like VS Code's compact folders.
export function rowsOf(log: Log, collapsed: string[], showReads: boolean): Row[] {
  const rootPath = rootOf(log, showReads)
  const root: Node = { name: '', key: rootPath, dirs: new Map(), files: [] }
  for (const entry of shownFiles(log, showReads)) {
    const parts = entry.path.split('/').slice(rootPath ? rootPath.split('/').length : 0)
    let node = root
    for (const part of parts.slice(0, -1)) {
      const key = node.key ? `${node.key}/${part}` : part
      if (!node.dirs.has(part)) node.dirs.set(part, { name: part, key, dirs: new Map(), files: [] })
      node = node.dirs.get(part)!
    }
    node.files.push(entry)
  }
  const rows: Row[] = []
  const walk = (node: Node, depth: number) => {
    for (const first of [...node.dirs.values()].sort((x, y) => x.name.localeCompare(y.name))) {
      let dir = first
      let name = dir.name
      while (dir.files.length === 0 && dir.dirs.size === 1) {
        dir = [...dir.dirs.values()][0]!
        name = `${name}/${dir.name}`
      }
      const isFolded = collapsed.includes(dir.key)
      rows.push({ isDir: true, depth, name, key: dir.key, isFolded })
      if (!isFolded) walk(dir, depth + 1)
    }
    for (const entry of [...node.files].sort((x, y) => x.path.localeCompare(y.path))) {
      rows.push({ isDir: false, depth, name: entry.path.split('/').pop()!, key: entry.path, entry, isFolded: false })
    }
  }
  walk(root, 0)
  return rows
}

const EXT_ICON: Record<string, string> = {
  ts: 'ext-ts', mts: 'ext-ts', cts: 'ext-ts', tsx: 'ext-react', jsx: 'ext-react',
  js: 'ext-js', mjs: 'ext-js', cjs: 'ext-js', json: 'ext-json', jsonl: 'ext-json',
  md: 'ext-md', py: 'ext-py', sh: 'ext-sh', ps1: 'ext-sh',
  yml: 'ext-config', yaml: 'ext-config', toml: 'ext-config', ini: 'ext-config',
}

// The look.tsx icon name for a file, by extension; `file` when there is no better one.
export const iconOf = (name: string) => EXT_ICON[name.split('.').pop()!.toLowerCase()] ?? 'file'

export const fit = (text: string, width: number) => (text.length > width ? `${text.slice(0, Math.max(0, width - 1))}…` : text)
