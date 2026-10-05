// Read-only previews; `$` cannot cross an import, so the caller hands in plain functions (Io).
import type { Risk } from './risk'
import text from './text'
import { fill, MARK } from './theme'

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
  // The measured paths in full, so the verdict can tell whether any sits outside the working folder.
  paths?: string[]
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

type Unit = { one: string; many: string }
const plural = (count: number, unit: Unit) => fill(count === 1 ? unit.one : unit.many, { n: count })
const capped = (isCapped: boolean) => (isCapped ? text.atLeast : '')

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
    ? fill(text.preview.dirLine, { path: item.path, files: plural(item.tally.files, text.units.file), folders: plural(item.tally.dirs + 1, text.units.folder), capped: capped(item.tally.isCapped), size: formatSize(item.tally.bytes) })
    : fill(text.preview.fileLine, { path: item.path, size: formatSize(item.size) })

// Home spelled as ~, forward slashes.
export function tilde(path: string, home: string) {
  const root = home.replace(/\\/g, '/').replace(/\/$/, '')
  return root && (path === root || path.startsWith(`${root}/`)) ? `~${path.slice(root.length)}` : path
}

const baseOf = (path: string) => path.replace(/\/$/, '').split('/').pop() || path

const statsOf = (item: Measured) =>
  item.kind === 'dir'
    ? [plural(item.tally.files, text.units.file), plural(item.tally.dirs + 1, text.units.folder), `${capped(item.tally.isCapped)}${formatSize(item.tally.bytes)}`].join(` ${MARK.sep} `)
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

const cappedGroup = (lines: string[], title: string): Group => ({ title, lines: lines.slice(0, LIST_MAX), more: Math.max(0, lines.length - LIST_MAX), all: lines })

type Scope = { io: Io; base: string; home: string }

async function measureRm({ io, base, home }: Scope, risk: Risk): Promise<Report> {
  if (!risk.targets.length) return unknown(fill(text.preview.noPaths, { label: risk.label }), text.preview.rmNoPathsNote)
  const { existing, missing } = await resolveTargets(io, base, home, risk.targets)
  if (!existing.length) return { summary: text.preview.deleteNothing, groups: [], note: fill(text.preview.targets, { targets: risk.targets.join(' ') }) }
  const measured = await measurePaths(io, existing)
  const total = totals(measured)
  const folders = total.dirs ? fill(text.preview.andFolders, { folders: plural(total.dirs, text.units.folder) }) : ''
  const note = [missing ? fill(text.preview.notFound, { paths: plural(missing, text.units.namedPath) }) : '', text.preview.recycleNote].filter(Boolean).join(' ')
  return {
    summary: fill(text.preview.deleteSummary, { files: plural(total.files, text.units.file), folders, capped: capped(total.isCapped), size: formatSize(total.bytes) }),
    groups: [pathGroup(text.preview.wouldBeDeleted, measured)],
    listTitle: [text.preview.wouldDelete, plural(total.files, text.units.file), `${capped(total.isCapped)}${formatSize(total.bytes)}`].join(` ${MARK.sep} `),
    facts: { files: total.files, folders: total.dirs, bytes: total.bytes, items: itemsOf(measured, home), paths: measured.map(item => item.path), subject: measured.length === 1 ? baseOf(measured[0]!.path) : plural(measured.length, text.units.path) },
    note,
  }
}

async function measureMv({ io, base, home }: Scope, risk: Risk): Promise<Report> {
  if (!risk.targets.length) return unknown(text.preview.mvNoSources, text.preview.mvNoSourcesNote)
  const dest = resolvePath(base, home, risk.dest ?? '')
  const destStat = await io.stat(dest).catch(() => null)
  if (!destStat) return { summary: text.preview.overwriteNoDest, groups: [], note: '', isHarmless: true }
  const { existing } = await resolveTargets(io, base, home, risk.targets)
  const hit: string[] = []
  for (const source of existing) {
    const target = destStat.kind === 'dir' ? `${dest.replace(/\/$/, '')}/${source.split('/').pop()}` : dest
    if (await io.stat(target).then(() => true, () => false)) hit.push(target)
  }
  if (!hit.length) return { summary: text.preview.overwriteNoFile, groups: [], note: '', isHarmless: true }
  const measured = await measurePaths(io, [...new Set(hit)])
  return {
    summary: fill(text.preview.replaceSummary, { paths: plural(measured.length, text.units.existingPath) }),
    groups: [pathGroup(text.preview.wouldBeReplaced, measured)],
    note: text.preview.mvNote,
    facts: { items: itemsOf(measured, home), paths: measured.map(item => item.path), count: measured.length, subject: measured.length === 1 ? baseOf(measured[0]!.path) : plural(measured.length, text.units.file) },
  }
}

async function measureRedirect({ io, base, home }: Scope, risk: Risk): Promise<Report> {
  const target = risk.args[0] ?? ''
  if (/[$*?`]/.test(target)) return { summary: text.preview.truncateBuilt, groups: [], note: '', isHarmless: true }
  const path = resolvePath(base, home, target)
  const stat = await io.stat(path).catch(() => null)
  if (!stat || stat.kind !== 'file') return { summary: text.preview.truncateMissing, groups: [], note: '', isHarmless: true }
  const item: Measured = { path, kind: 'file', size: stat.size, tally: { files: 1, dirs: 0, bytes: stat.size, isCapped: false, items: [{ path, size: stat.size }] } }
  return {
    summary: fill(text.preview.emptySummary, { path, size: formatSize(stat.size) }),
    groups: [pathGroup(text.preview.wouldBeOverwritten, [item])],
    note: text.preview.redirectNote,
    facts: { items: itemsOf([item], home), paths: [path], subject: baseOf(path) },
  }
}

async function measureTree({ io, base, home }: Scope, risk: Risk): Promise<Report> {
  if (!risk.targets.length) return unknown(fill(text.preview.noPaths, { label: risk.label }), text.preview.treeNoPaths)
  const { existing } = await resolveTargets(io, base, home, risk.targets)
  if (!existing.length) return { summary: fill(text.preview.noPathMatches, { label: risk.label }), groups: [], note: fill(text.preview.targets, { targets: risk.targets.join(' ') }) }
  const measured = await measurePaths(io, existing)
  const total = totals(measured)
  const reach = `${plural(total.files + total.dirs, text.units.entry)}${total.isCapped ? text.orMore : ''}`
  if (risk.kind === 'chmod') return { summary: fill(text.preview.chmodSummary, { label: risk.label, reach }), groups: [pathGroup(text.preview.reaches, measured)], note: text.preview.chmodNote, facts: { items: itemsOf(measured, home), count: total.files + total.dirs, subject: measured.length === 1 ? baseOf(measured[0]!.path) : plural(measured.length, text.units.path) } }
  return { summary: fill(text.preview.findSummary, { paths: plural(measured.length, text.units.startPath), files: plural(total.files, text.units.file) }), groups: [pathGroup(text.preview.searchesUnder, measured)], note: text.preview.findNote, facts: { items: itemsOf(measured, home), count: total.files, subject: measured.length === 1 ? baseOf(measured[0]!.path) : plural(measured.length, text.units.path) } }
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
  if (run.exitCode !== 0) return unknown(text.preview.cleanFailed, run.stderr.trim().slice(0, 200))
  const gone = linesOf(run.stdout).filter(line => line.startsWith('Would remove ')).map(line => line.slice(13))
  return {
    summary: gone.length ? fill(text.preview.removeSummary, { paths: plural(gone.length, text.units.untrackedPath) }) : text.preview.removeNothing,
    groups: gone.length ? [cappedGroup(gone, text.preview.wouldBeRemoved)] : [],
    note: text.preview.cleanNote,
    facts: { count: gone.length },
  }
}

async function measureReset({ io, base }: Scope, risk: Risk): Promise<Report> {
  const status = await io.run(['git', 'status', '--porcelain'], base)
  if (status.exitCode !== 0) return unknown(text.preview.resetNotRepo, status.stderr.trim().slice(0, 200))
  const lost = linesOf(status.stdout).filter(line => !line.startsWith('??')).map(line => `${line.slice(0, 2)} ${line.slice(3)}`)
  const ref = risk.args.find(arg => !arg.startsWith('-'))
  const groups: Group[] = lost.length ? [cappedGroup(lost, text.preview.uncommittedLost)] : []
  let dropped = 0
  if (ref) {
    const log = await io.run(['git', 'log', '--oneline', '--no-decorate', `${ref}..HEAD`], base)
    const commits = log.exitCode === 0 ? linesOf(log.stdout) : []
    dropped = commits.length
    if (commits.length) groups.push(cappedGroup(commits, fill(text.preview.branchLeaves, { ref })))
  }
  const stat = await io.run(['git', 'diff', '--shortstat', 'HEAD'], base)
  const parts = [lost.length ? fill(text.preview.discardUncommitted, { files: plural(lost.length, text.units.file) }) : '', dropped ? fill(text.preview.moveOff, { commits: plural(dropped, text.units.commit) }) : ''].filter(Boolean)
  const shortstat = stat.exitCode === 0 ? stat.stdout.trim() : ''
  return {
    summary: parts.length ? parts.join(text.preview.joinAnd) : text.preview.discardNothing,
    groups,
    note: shortstat ? fill(text.preview.resetStatNote, { stat: shortstat }) : text.preview.resetNote,
    facts: { count: lost.length, files: dropped },
  }
}

async function measureCheckout({ io, base }: Scope, risk: Risk): Promise<Report> {
  const cut = risk.args.indexOf('--')
  const isRestore = risk.label === 'git restore'
  const paths = cut >= 0 ? risk.args.slice(cut + 1) : isRestore ? risk.args.filter(arg => !arg.startsWith('-')) : risk.args.filter(arg => arg === '.')
  const isForced = risk.args.some(arg => arg === '-f' || arg === '--force')
  const status = await io.run(['git', 'status', '--porcelain', '--', ...paths], base)
  if (status.exitCode !== 0) return unknown(fill(text.preview.notRepo, { label: risk.label }), status.stderr.trim().slice(0, 200))
  const rows = linesOf(status.stdout).filter(line => !line.startsWith('??'))
  const lost = (isForced ? rows : rows.filter(line => line[1] !== ' ')).map(line => `${line.slice(0, 2)} ${line.slice(3)}`)
  return {
    summary: lost.length ? fill(text.preview.discardChanges, { files: plural(lost.length, text.units.file) }) : text.preview.discardNothingUnstaged,
    groups: lost.length ? [cappedGroup(lost, text.preview.changesLost)] : [],
    note: text.preview.checkoutNote,
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
  if (known.exitCode !== 0) return unknown(fill(text.preview.forcePushTo, { ref }), fill(text.preview.noLocalCopy, { ref }))
  const log = await io.run(['git', 'log', '--oneline', '--no-decorate', `${source}..${ref}`], base)
  const dropped = linesOf(log.stdout)
  return {
    summary: dropped.length ? fill(text.preview.forcePushDrops, { ref, commits: plural(dropped.length, text.units.commit) }) : fill(text.preview.forcePushDropsNone, { ref }),
    groups: dropped.length ? [cappedGroup(dropped, fill(text.preview.commitsLack, { ref, source }))] : [],
    note: text.preview.pushNote,
    facts: { count: dropped.length, subject: ref },
  }
}

async function measureBranches({ io, base }: Scope, risk: Risk): Promise<Report> {
  const names = risk.targets.slice(0, 5)
  if (!names.length) return unknown(text.preview.noBranchNamed, '')
  const groups: Group[] = []
  let total = 0
  for (const name of names) {
    const log = await io.run(['git', 'log', '--oneline', '--no-decorate', `HEAD..${name}`], base)
    if (log.exitCode !== 0) {
      groups.push({ title: name, lines: [text.preview.branchNotFound], more: 0 })
      continue
    }
    const commits = linesOf(log.stdout)
    total += commits.length
    groups.push(cappedGroup(commits.length ? commits : [text.preview.noCommitsMissing], fill(text.preview.onlyOn, { name })))
  }
  return {
    summary: fill(text.preview.deleteBranches, { branches: plural(names.length, text.units.branch), commits: plural(total, text.units.commit) }),
    groups,
    note: text.preview.branchNote,
    facts: { count: total, subject: names.join(', ') },
  }
}

function measureSql(risk: Risk): Report {
  const statements = risk.statements ?? []
  return {
    summary: fill(text.preview.runSql, { statements: plural(statements.length, text.units.destructiveStatement) }),
    groups: [cappedGroup(statements, text.preview.statements)],
    note: text.preview.sqlNote,
  }
}

// Never throws and never runs the risky command: a failed preview is said, and the hold stands.
export async function measure(io: Io, risk: Risk): Promise<Report> {
  try {
    const session = await io.cwd()
    const home = await io.home()
    let base = session
    if (risk.dir === '-') return unknown(fill(text.preview.afterCdDash, { label: risk.label }), text.preview.afterCdDashNote)
    if (risk.dir) {
      base = resolvePath(session, home, risk.dir)
      if (!(await io.stat(base).then(() => true, () => false))) return unknown(fill(text.preview.folderMissing, { label: risk.label, dir: risk.dir }), text.preview.folderMissingNote)
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
      default: return unknown(risk.isError ? fill(text.preview.couldNotEvaluate, { label: risk.label }) : text.preview.cantList, risk.isError ? risk.reason : text.preview.cantListNote)
    }
  } catch (error) {
    return unknown(fill(text.preview.previewFailed, { label: risk.label }), fill(text.preview.couldNotMeasure, { why: String((error as Error)?.message ?? error).slice(0, 200) }))
  }
}
