// Read-only previews; `$` cannot cross an import, so the caller hands in plain functions (Io).
import type { Risk } from './risk'

export type Io = {
  cwd: () => Promise<string>
  home: () => Promise<string>
  run: (argv: string[], cwd: string) => Promise<{ exitCode: number; stdout: string; stderr: string }>
  list: (path: string) => Promise<{ name: string; kind: 'file' | 'dir' | 'other'; size: number }[]>
  stat: (path: string) => Promise<{ kind: 'file' | 'dir' | 'other'; size: number }>
  // Reads a folder variable, so a target like "$TEMP/x" can be measured before the command runs.
  env?: (name: string) => Promise<string | undefined>
}

export type Entry = { dir: string; name: string; detail: string }

// lines and more are what the card shows; all and entries are the whole list for the side pane.
export type Group = { title: string; lines: string[]; more: number; all?: string[]; entries?: Entry[] }

// The numbers and names the plain-words copy is made from.
export type Facts = {
  files?: number
  folders?: number
  bytes?: number
  items?: { path: string; stats: string }[]
  count?: number
  subject?: string
}

export type Report = {
  summary: string
  groups: Group[]
  note: string
  // The command would change nothing that exists, so it runs without a hold.
  isHarmless?: boolean
  // The preview could not be computed; the hold still stands and says so.
  isUnknown?: boolean
  // The side pane's title when the command deletes paths; otherwise it falls back to the summary.
  listTitle?: string
  facts?: Facts
}

export const LIST_MAX = 8
const VISIT_MAX = 4000
const GLOB_MAX = 500

export function formatSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes < 1024) return `${bytes || 0} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes
  let at = -1
  while (value >= 1024 && at < units.length - 1) {
    value /= 1024
    at++
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[at]}`
}

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`

// Absolute, forward-slash, `.` and `..` folded. Git Bash spells C:\x as /c/x, which a Windows host reads as C:/x.
export function resolvePath(base: string, home: string, path: string) {
  let text = path.replace(/\\/g, '/')
  const isWindows = /^[A-Za-z]:/.test(base)
  if (text === '~' || text.startsWith('~/')) text = `${home.replace(/\\/g, '/')}${text.slice(1)}`
  else if (isWindows && /^\/[A-Za-z](?:\/|$)/.test(text)) text = `${text[1]!.toUpperCase()}:${text.slice(2) || '/'}`
  const full = /^(?:[A-Za-z]:)?\//.test(text) ? text : `${base.replace(/\\/g, '/').replace(/\/$/, '')}/${text}`
  const drive = /^[A-Za-z]:/.test(full) ? full.slice(0, 2) : ''
  const parts: string[] = []
  for (const part of full.slice(drive.length).split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return `${drive}/${parts.join('/')}`
}

const hasWildcard = (text: string) => /[*?[]/.test(text)

function expandBraces(text: string): string[] {
  const match = /\{([^{}]*,[^{}]*)\}/.exec(text)
  if (!match) return [text]
  return match[1]!.split(',').flatMap(option => expandBraces(text.slice(0, match.index) + option + text.slice(match.index + match[0].length)))
}

const segmentPattern = (segment: string) =>
  new RegExp(`^${segment.replace(/[.+^${}()|\\]/g, '\\$&').replace(/\*+/g, '[^/]*').replace(/\?/g, '[^/]')}$`, 'i')

// Matches of an absolute pattern, walking the folders that exist; capped.
async function expandGlob(io: Io, absolute: string): Promise<string[]> {
  const drive = /^[A-Za-z]:/.test(absolute) ? absolute.slice(0, 2) : ''
  const parts = absolute.slice(drive.length).split('/').filter(Boolean)
  let found = [`${drive}/`]
  for (const part of parts) {
    const next: string[] = []
    for (const base of found) {
      const join = (name: string) => (base.endsWith('/') ? `${base}${name}` : `${base}/${name}`)
      if (!hasWildcard(part)) {
        next.push(join(part))
        continue
      }
      const pattern = segmentPattern(part)
      const entries = await io.list(base).catch(() => [])
      for (const entry of entries) {
        if (entry.name.startsWith('.') && !part.startsWith('.')) continue
        if (pattern.test(entry.name)) next.push(join(entry.name))
        if (next.length >= GLOB_MAX) break
      }
    }
    found = next.slice(0, GLOB_MAX)
  }
  return found
}

type Tally = { files: number; dirs: number; bytes: number; isCapped: boolean; items: { path: string; size: number }[] }

const ITEM_MAX = 3000

// Counts what sits under a path, sharing one visit budget so a huge tree stops early.
async function walk(io: Io, path: string, tally: Tally, budget: { left: number }) {
  if (budget.left <= 0) {
    tally.isCapped = true
    return
  }
  budget.left--
  const entries = await io.list(path).catch(() => null)
  if (!entries) return
  for (const entry of entries) {
    if (entry.kind === 'dir') {
      tally.dirs++
      await walk(io, `${path.replace(/\/$/, '')}/${entry.name}`, tally, budget)
    } else {
      tally.files++
      tally.bytes += entry.size
      if (tally.items.length < ITEM_MAX) tally.items.push({ path: `${path.replace(/\/$/, '')}/${entry.name}`, size: entry.size })
      budget.left--
    }
    if (budget.left <= 0) {
      tally.isCapped = true
      return
    }
  }
}

type Measured = { path: string; kind: 'file' | 'dir' | 'other'; size: number; tally: Tally }

// Only folder variables expand: any other name could carry a secret, and its value would land on the card.
const FOLDER_VARS = new Set(['TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA'])

async function expandFolderVars(io: Io, text: string) {
  let out = text
  for (const found of text.matchAll(/\$\{(\w+)\}|\$(\w+)|%(\w+)%/g)) {
    const name = found[1] ?? found[2] ?? found[3]!
    if (!FOLDER_VARS.has(name.toUpperCase()) || !io.env) continue
    const value = await io.env(name).catch(() => undefined)
    if (value) out = out.replace(found[0], value)
  }
  return out
}

async function resolveTargets(io: Io, base: string, home: string, targets: string[]) {
  const paths: string[] = []
  for (const target of targets) {
    const bare = target.replace(/^["']|["']$/g, '')
    for (const option of expandBraces(await expandFolderVars(io, bare))) {
      const absolute = resolvePath(base, home, option)
      if (hasWildcard(option)) paths.push(...(await expandGlob(io, absolute)))
      else paths.push(absolute)
    }
  }
  const existing: string[] = []
  for (const path of paths) if (await io.stat(path).then(() => true, () => false)) existing.push(path)
  return { existing, missing: paths.length - existing.length }
}

async function measurePaths(io: Io, paths: string[]) {
  const budget = { left: VISIT_MAX }
  const measured: Measured[] = []
  for (const path of paths) {
    const stat = await io.stat(path).catch(() => null)
    if (!stat) continue
    const tally: Tally = { files: stat.kind === 'dir' ? 0 : 1, dirs: 0, bytes: stat.kind === 'dir' ? 0 : stat.size, isCapped: false, items: stat.kind === 'dir' ? [] : [{ path, size: stat.size }] }
    if (stat.kind === 'dir') await walk(io, path, tally, budget)
    measured.push({ path, kind: stat.kind, size: stat.size, tally })
  }
  return measured
}

const describe = (item: Measured) =>
  item.kind === 'dir'
    ? `${item.path}/  ${plural(item.tally.files, 'file')}${`, ${plural(item.tally.dirs + 1, 'folder')}`}, ${item.tally.isCapped ? 'at least ' : ''}${formatSize(item.tally.bytes)}`
    : `${item.path}  ${formatSize(item.size)}`

// Home spelled as ~, forward slashes.
export function tilde(path: string, home: string) {
  const root = home.replace(/\\/g, '/').replace(/\/$/, '')
  return root && (path === root || path.startsWith(`${root}/`)) ? `~${path.slice(root.length)}` : path
}

const baseOf = (path: string) => path.replace(/\/$/, '').split('/').pop() || path

const statsOf = (item: Measured) =>
  item.kind === 'dir'
    ? `${plural(item.tally.files, 'file')} · ${plural(item.tally.dirs + 1, 'folder')} · ${item.tally.isCapped ? 'at least ' : ''}${formatSize(item.tally.bytes)}`
    : formatSize(item.size)

const itemsOf = (measured: Measured[], home: string) => measured.map(item => ({ path: `${tilde(item.path, home)}${item.kind === 'dir' ? '/' : ''}`, stats: statsOf(item) }))

function pathGroup(title: string, measured: Measured[]): Group {
  const entries = measured.flatMap(item => item.tally.items).map(({ path, size }) => {
    const cut = path.lastIndexOf('/')
    return { dir: cut > 0 ? path.slice(0, cut) : '/', name: path.slice(cut + 1), detail: formatSize(size) }
  })
  return { title, lines: measured.slice(0, LIST_MAX).map(describe), more: Math.max(0, measured.length - LIST_MAX), entries, all: measured.map(describe) }
}

function totals(measured: Measured[]) {
  const files = measured.reduce((sum, item) => sum + item.tally.files, 0)
  const dirs = measured.reduce((sum, item) => sum + item.tally.dirs + (item.kind === 'dir' ? 1 : 0), 0)
  const bytes = measured.reduce((sum, item) => sum + item.tally.bytes, 0)
  const isCapped = measured.some(item => item.tally.isCapped)
  return { files, dirs, bytes, isCapped }
}

const unknown = (summary: string, note: string): Report => ({ summary, groups: [], note, isUnknown: true })

const linesOf = (text: string) => text.split(/\r?\n/).filter(line => line !== '')

const capped = (lines: string[], title: string): Group => ({ title, lines: lines.slice(0, LIST_MAX), more: Math.max(0, lines.length - LIST_MAX), all: lines })

type Scope = { io: Io; base: string; home: string }

async function measureRm({ io, base, home }: Scope, risk: Risk): Promise<Report> {
  if (!risk.targets.length) return unknown(`${risk.label} (no paths to list)`, 'The paths come from a pipe or another command, so none can be listed here.')
  const { existing, missing } = await resolveTargets(io, base, home, risk.targets)
  if (!existing.length) return { summary: 'delete nothing: no path matches', groups: [], note: `Targets: ${risk.targets.join(' ')}` }
  const measured = await measurePaths(io, existing)
  const total = totals(measured)
  const folders = total.dirs ? ` and ${plural(total.dirs, 'folder')}` : ''
  const note = [missing ? `${plural(missing, 'named path')} not found.` : '', 'Deleted files skip the recycle bin.'].filter(Boolean).join(' ')
  return {
    summary: `delete ${plural(total.files, 'file')}${folders} (${total.isCapped ? 'at least ' : ''}${formatSize(total.bytes)})`,
    groups: [pathGroup('Would be deleted', measured)],
    listTitle: `Would delete · ${plural(total.files, 'file')} · ${total.isCapped ? 'at least ' : ''}${formatSize(total.bytes)}`,
    facts: { files: total.files, folders: total.dirs, bytes: total.bytes, items: itemsOf(measured, home), subject: measured.length === 1 ? baseOf(measured[0]!.path) : plural(measured.length, 'path') },
    note,
  }
}

async function measureMv({ io, base, home }: Scope, risk: Risk): Promise<Report> {
  if (!risk.targets.length) return unknown('mv (no source paths to list)', 'The sources come from a pipe or another command.')
  const dest = resolvePath(base, home, risk.dest ?? '')
  const destStat = await io.stat(dest).catch(() => null)
  if (!destStat) return { summary: 'overwrite nothing: the destination does not exist', groups: [], note: '', isHarmless: true }
  const { existing } = await resolveTargets(io, base, home, risk.targets)
  const hit: string[] = []
  for (const source of existing) {
    const target = destStat.kind === 'dir' ? `${dest.replace(/\/$/, '')}/${source.split('/').pop()}` : dest
    if (await io.stat(target).then(() => true, () => false)) hit.push(target)
  }
  if (!hit.length) return { summary: 'overwrite nothing: no destination file exists yet', groups: [], note: '', isHarmless: true }
  const measured = await measurePaths(io, [...new Set(hit)])
  return {
    summary: `replace ${plural(measured.length, 'existing path')}`,
    groups: [pathGroup('Would be replaced', measured)],
    note: 'The old content is gone once mv runs.',
    facts: { items: itemsOf(measured, home), count: measured.length, subject: measured.length === 1 ? baseOf(measured[0]!.path) : plural(measured.length, 'file') },
  }
}

async function measureRedirect({ io, base, home }: Scope, risk: Risk): Promise<Report> {
  const target = risk.args[0] ?? ''
  if (/[$*?`]/.test(target)) return { summary: 'truncate nothing: the target is built at run time', groups: [], note: '', isHarmless: true }
  const path = resolvePath(base, home, target)
  const stat = await io.stat(path).catch(() => null)
  if (!stat || stat.kind !== 'file') return { summary: 'truncate nothing: the file does not exist', groups: [], note: '', isHarmless: true }
  const item: Measured = { path, kind: 'file', size: stat.size, tally: { files: 1, dirs: 0, bytes: stat.size, isCapped: false, items: [{ path, size: stat.size }] } }
  return {
    summary: `empty ${path} (${formatSize(stat.size)} now)`,
    groups: [pathGroup('Would be overwritten', [item])],
    note: 'A single > replaces the whole file. >> would append.',
    facts: { items: itemsOf([item], home), subject: baseOf(path) },
  }
}

async function measureTree({ io, base, home }: Scope, risk: Risk): Promise<Report> {
  if (!risk.targets.length) return unknown(`${risk.label} (no paths to list)`, 'The paths come from a pipe or another command.')
  const { existing } = await resolveTargets(io, base, home, risk.targets)
  if (!existing.length) return { summary: `${risk.label}: no path matches`, groups: [], note: `Targets: ${risk.targets.join(' ')}` }
  const measured = await measurePaths(io, existing)
  const total = totals(measured)
  const reach = `${plural(total.files + total.dirs, 'entry', 'entries')}${total.isCapped ? ' or more' : ''}`
  if (risk.kind === 'chmod') return { summary: `${risk.label}: up to ${reach}`, groups: [pathGroup('Reaches', measured)], note: 'Every file and folder under these paths changes.', facts: { items: itemsOf(measured, home), count: total.files + total.dirs, subject: measured.length === 1 ? baseOf(measured[0]!.path) : plural(measured.length, 'path') } }
  return { summary: `delete matching files under ${plural(measured.length, 'start path')} (up to ${plural(total.files, 'file')})`, groups: [pathGroup('Searches under', measured)], note: 'The find expression picks which of these go; it is not evaluated here.', facts: { items: itemsOf(measured, home), count: total.files, subject: measured.length === 1 ? baseOf(measured[0]!.path) : plural(measured.length, 'path') } }
}

async function measureClean({ io, base }: Scope, risk: Risk): Promise<Report> {
  const flags: string[] = []
  const paths: string[] = []
  for (let i = 0; i < risk.args.length; i++) {
    const arg = risk.args[i]!
    if (arg === '--') {
      paths.push(...risk.args.slice(i + 1))
      break
    }
    if (arg === '-e' || arg === '--exclude') {
      flags.push(arg, risk.args[i + 1] ?? '')
      i++
    } else if (arg.startsWith('--exclude=') || /^-e./.test(arg)) flags.push(arg)
    else if (/^-[a-zA-Z]+$/.test(arg)) {
      const kept = arg.replace(/[fniq]/g, '')
      if (kept !== '-') flags.push(kept)
    } else if (!arg.startsWith('-')) paths.push(arg)
  }
  const run = await io.run(['git', 'clean', '-n', ...flags, '--', ...paths], base)
  if (run.exitCode !== 0) return unknown('git clean (dry run failed)', run.stderr.trim().slice(0, 200))
  const gone = linesOf(run.stdout).filter(line => line.startsWith('Would remove ')).map(line => line.slice(13))
  return {
    summary: gone.length ? `remove ${plural(gone.length, 'untracked path')}` : 'remove nothing: no untracked path matches',
    groups: gone.length ? [capped(gone, 'Would be removed')] : [],
    note: 'From git clean -n. Untracked files are not in git, so they cannot be recovered.',
    facts: { count: gone.length },
  }
}

async function measureReset({ io, base }: Scope, risk: Risk): Promise<Report> {
  const status = await io.run(['git', 'status', '--porcelain'], base)
  if (status.exitCode !== 0) return unknown('git reset --hard (not a git repo here?)', status.stderr.trim().slice(0, 200))
  const lost = linesOf(status.stdout).filter(line => !line.startsWith('??')).map(line => `${line.slice(0, 2)} ${line.slice(3)}`)
  const ref = risk.args.find(arg => !arg.startsWith('-'))
  const groups: Group[] = lost.length ? [capped(lost, 'Uncommitted changes lost')] : []
  let dropped = 0
  if (ref) {
    const log = await io.run(['git', 'log', '--oneline', '--no-decorate', `${ref}..HEAD`], base)
    const commits = log.exitCode === 0 ? linesOf(log.stdout) : []
    dropped = commits.length
    if (commits.length) groups.push(capped(commits, `Commits the branch leaves (${ref})`))
  }
  const stat = await io.run(['git', 'diff', '--shortstat', 'HEAD'], base)
  const parts = [lost.length ? `discard uncommitted changes in ${plural(lost.length, 'file')}` : '', dropped ? `move the branch off ${plural(dropped, 'commit')}` : ''].filter(Boolean)
  const shortstat = stat.exitCode === 0 ? stat.stdout.trim() : ''
  return {
    summary: parts.length ? parts.join(' and ') : 'discard nothing: no uncommitted changes',
    groups,
    note: shortstat ? `${shortstat}. Uncommitted changes cannot be recovered.` : 'From git status --porcelain. Untracked files stay.',
    facts: { count: lost.length, files: dropped },
  }
}

async function measureCheckout({ io, base }: Scope, risk: Risk): Promise<Report> {
  const cut = risk.args.indexOf('--')
  const isRestore = risk.label === 'git restore'
  const paths = cut >= 0 ? risk.args.slice(cut + 1) : isRestore ? risk.args.filter(arg => !arg.startsWith('-')) : risk.args.filter(arg => arg === '.')
  const isForced = risk.args.some(arg => arg === '-f' || arg === '--force')
  const status = await io.run(['git', 'status', '--porcelain', '--', ...paths], base)
  if (status.exitCode !== 0) return unknown(`${risk.label} (not a git repo here?)`, status.stderr.trim().slice(0, 200))
  const rows = linesOf(status.stdout).filter(line => !line.startsWith('??'))
  const lost = (isForced ? rows : rows.filter(line => line[1] !== ' ')).map(line => `${line.slice(0, 2)} ${line.slice(3)}`)
  return {
    summary: lost.length ? `discard changes in ${plural(lost.length, 'file')}` : 'discard nothing: no unstaged changes there',
    groups: lost.length ? [capped(lost, 'Changes lost')] : [],
    note: 'From git status --porcelain. Unstaged changes cannot be recovered.',
    facts: { count: lost.length },
  }
}

async function measurePush({ io, base }: Scope, risk: Risk): Promise<Report> {
  const positional = risk.args.filter(arg => !arg.startsWith('-') && !arg.startsWith('+'))
  const plus = risk.args.find(arg => arg.startsWith('+'))?.slice(1)
  const remote = positional[0] ?? 'origin'
  const spec = (positional[1] ?? plus ?? '').replace(/^\+/, '')
  let [source, branch] = spec.includes(':') ? spec.split(':') : [spec, spec]
  branch = (branch ?? '').replace(/^refs\/heads\//, '')
  if (!branch || branch === 'HEAD') {
    const head = await io.run(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], base)
    branch = head.stdout.trim()
    source = 'HEAD'
  }
  source = source || 'HEAD'
  const ref = `${remote}/${branch}`
  const known = await io.run(['git', 'rev-parse', '--verify', '--quiet', ref], base)
  if (known.exitCode !== 0) return unknown(`force-push to ${ref}`, `No local copy of ${ref}, so the commits it would drop are unknown. Run git fetch first.`)
  const log = await io.run(['git', 'log', '--oneline', '--no-decorate', `${source}..${ref}`], base)
  const dropped = linesOf(log.stdout)
  return {
    summary: dropped.length ? `force-push to ${ref}: drops ${plural(dropped.length, 'commit')}` : `force-push to ${ref}: drops no commits`,
    groups: dropped.length ? [capped(dropped, `Commits on ${ref} that ${source} lacks`)] : [],
    note: 'As of the last fetch.',
    facts: { count: dropped.length, subject: ref },
  }
}

async function measureBranches({ io, base }: Scope, risk: Risk): Promise<Report> {
  const names = risk.targets.slice(0, 5)
  if (!names.length) return unknown('git branch -D (no branch named)', '')
  const groups: Group[] = []
  let total = 0
  for (const name of names) {
    const log = await io.run(['git', 'log', '--oneline', '--no-decorate', `HEAD..${name}`], base)
    if (log.exitCode !== 0) {
      groups.push({ title: name, lines: ['not found as a local branch'], more: 0 })
      continue
    }
    const commits = linesOf(log.stdout)
    total += commits.length
    groups.push(capped(commits.length ? commits : ['no commits missing from the current branch'], `Only on ${name}`))
  }
  return {
    summary: `delete ${plural(names.length, 'branch', 'branches')}, ${plural(total, 'commit')} not on the current branch`,
    groups,
    note: 'The commits stay in the reflog for a while, then git collects them.',
    facts: { count: total, subject: names.join(', ') },
  }
}

function measureSql(risk: Risk): Report {
  const statements = risk.statements ?? []
  return {
    summary: `run ${plural(statements.length, 'destructive SQL statement')}`,
    groups: [capped(statements, 'Statements')],
    note: 'Row counts and the target database cannot be read from the command line.',
  }
}

// Never throws and never runs the risky command: a failed preview is said, and the hold stands.
export async function measure(io: Io, risk: Risk): Promise<Report> {
  try {
    const session = await io.cwd()
    const home = await io.home()
    let base = session
    if (risk.dir === '-') return unknown(`${risk.label} (runs after cd -)`, 'The command changes to the previous folder first, so where it runs is unknown.')
    if (risk.dir) {
      base = resolvePath(session, home, risk.dir)
      if (!(await io.stat(base).then(() => true, () => false))) return unknown(`${risk.label} (folder ${risk.dir} not found)`, 'The folder does not exist yet, so nothing could be measured.')
    }
    const scope = { io, base, home }
    switch (risk.kind) {
      case 'rm': return await measureRm(scope, risk)
      case 'mv': return await measureMv(scope, risk)
      case 'redirect': return await measureRedirect(scope, risk)
      case 'chmod':
      case 'find-delete': return await measureTree(scope, risk)
      case 'git-clean': return await measureClean(scope, risk)
      case 'git-reset': return await measureReset(scope, risk)
      case 'git-checkout': return await measureCheckout(scope, risk)
      case 'git-push-force': return await measurePush(scope, risk)
      case 'git-branch-delete': return await measureBranches(scope, risk)
      case 'sql': return measureSql(risk)
      default: return unknown(risk.isError ? `${risk.label} (could not evaluate)` : "change files that can't be listed before it runs", risk.isError ? risk.reason : 'Its files are only known once it runs, so nothing can be listed ahead.')
    }
  } catch (error) {
    return unknown(`${risk.label} (preview failed)`, `Could not measure: ${String((error as Error)?.message ?? error).slice(0, 200)}`)
  }
}
