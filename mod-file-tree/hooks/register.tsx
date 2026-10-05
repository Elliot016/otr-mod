import type { ConfigValue, EngineInterface, Register } from 'claude-code'

import { NAME_COLOR, OPEN_CELLS, type ListMessage, type Row as ListRow } from './list'
import { heading, isNerdFace, lookFor, section, terminalSettings, withIcon, type IconMode, type Look, withMark } from './look'
import { mix, type EntryMessage, type EntryProps } from './entry'
import { menuEntry, pill, pillRow, splitRow, tabRow, tipLine } from './pills'
import { TOAST_MS, ToastList, toastCards } from './toasts'
import { settingChoice, settingsBody, type Action, type Previews } from './settings'
import text from './text'
import { fill, MARK, statusColor, THEME } from './theme'
import { shellPlans, TranscriptFiles } from './transcript'
import { commit, diffLines, emptyLog, fit, iconOf, latestStepOf, liveFolds, relPath, rootOf, recentView, rowsOf, stepsOfTurn, touch, turnView, type Entry, type Kind, type Line, type Log } from './tree'

const PANE = 'filetree'
const SETTINGS = 'filetree-settings'

let showReads = true
let wrapDiff = true
let iconMode: IconMode = 'auto'
let look = lookFor(false)

// The transcript is read once per session start, since a long session's file is large; live calls then update the log. Kept in $.state for the pane and reloads.
let log: Log | undefined
let transcript = ''
// `/mod-file-tree clear` hides what came before it; the transcript would bring it back otherwise.
let cleared = { seq: 0, step: 0 }
let scope: 'turn' | 'recent' | 'session' = 'turn'
// How many turns the middle view covers, from the recent_turns setting.
let recentTurns = 5
let mode: 'tree' | 'replay' = 'tree'
// null follows the latest turn that edited something.
let replayTurn: number | null = null
let index = 0
let collapsed: string[] = []
let note = ''
let actions: Action[] = []
let previews: Previews | undefined

const isOpen = async ($: EngineInterface, id: string) => (await $.ui.panes()).some(pane => pane.id === id && pane.isPlaced)

// A reload empties the module copy and $.state still holds it; only an empty state reads the transcript.
async function hydrate($: EngineInterface) {
  if (log) return log
  cleared = (await $.state.get({ plugin: 'mod-file-tree', key: 'cleared' })).value ?? cleared
  log = (await $.state.get({ plugin: 'mod-file-tree', key: 'log' })).value as Log | undefined
  if (!log) await load($)
  return log ?? (log = emptyLog())
}

async function save($: EngineInterface) {
  await $.state.set({ plugin: 'mod-file-tree', key: 'log' }, log ?? emptyLog())
  $.ui.invalidate('ui.render')
}

// When no SessionStart named the transcript, it is `<session id>.jsonl` in one of ~/.claude/projects' folders.
async function findTranscript($: EngineInterface) {
  const home = ((await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '').replace(/\\/g, '/')
  const projects = `${home}/.claude/projects`
  const file = `${await $.session.id().catch(() => '')}.jsonl`
  for (const entry of await $.fs.list(projects).catch(() => [])) {
    const path = `${projects}/${entry.name}/${file}`
    if (entry.kind === 'dir' && (await $.fs.exists(path).catch(() => false))) return path
  }
  return ''
}

// Builds the log from the whole transcript; a long session outgrows $.fs.read's 4 MiB cap, so it then streams through the platform's file printer.
async function load($: EngineInterface) {
  if (!transcript) transcript = String((await $.store.get(`transcript:${await $.session.id()}`)) ?? '')
  if (!transcript) transcript = await findTranscript($)
  if (!transcript) return
  let raw = String(await $.fs.read(transcript).catch(() => ''))
  if (!raw) {
    const isWindows = /^[A-Za-z]:|\\/.test(transcript)
    // cmd's type rejects forward slashes.
    const argv = isWindows ? ['cmd', '/c', 'type', transcript.replace(/\//g, '\\')] : ['cat', transcript]
    for await (const chunk of $.process.spawn({ argv })) {
      if (chunk.stream === 'stdout') raw += chunk.text
    }
  }
  const parsed = new TranscriptFiles(String((await $.session.cwd().catch(() => '')) ?? ''))
  for (const line of raw.split('\n')) if (line.trim()) parsed.feed(line)
  log = { ...parsed.log, working: false }
}

// The log the pane shows: the whole session or the latest turn, without what a clear hid.
function viewOf(current: Log): Log {
  const scoped = scope === 'turn' ? turnView(current) : scope === 'recent' ? recentView(current, recentTurns) : current
  return { ...scoped, files: scoped.files.filter(file => file.seq > cleared.seq), steps: scoped.steps.filter(step => step.id > cleared.step) }
}

// Nerd glyphs when the setting asks for them, or on auto when Windows Terminal's font is a Nerd Font.
async function detectLook($: EngineInterface) {
  if (iconMode !== 'auto') return lookFor(iconMode === 'nerd')
  if (!(await $.env.get('WT_SESSION'))) return lookFor(false)
  const local = ((await $.env.get('LOCALAPPDATA')) ?? '').replace(/\\/g, '/')
  for (const path of terminalSettings(local)) {
    if (isNerdFace(String(await $.fs.read(path).catch(() => '')))) return lookFor(true)
  }
  return lookFor(false)
}

// Reading the terminal's settings takes a while, so on auto the last answer, kept in this mod's store, draws until it returns.
async function savedLook($: EngineInterface) {
  if (iconMode !== 'auto') return look
  try {
    const nerd = await $.store.get('look-nerd')
    return typeof nerd === 'boolean' ? lookFor(nerd) : look
  } catch {
    return look
  }
}

async function saveLook($: EngineInterface) {
  try {
    await $.store.set('look-nerd', look.nerd)
  } catch {
    // Without a store the mod still draws; it only starts from safe again next time.
  }
}

// Hooks of one event run in turn, so the slow font check runs beside them instead of holding up every mod after this one.
let lookLoad: Promise<void> | null = null

function loadLook($: EngineInterface) {
  lookLoad ??= (async () => {
    look = await savedLook($)
    void detectLook($).then(async found => {
      const isChanged = found.nerd !== look.nerd
      look = found
      await saveLook($)
      if (isChanged) $.ui.invalidate('ui.render')
    }).catch(() => {
      // A failed check keeps the icons drawn now.
    })
  })()
  return lookLoad
}

// One panel at a time, this mod's two panes included; opening one closes the other.
async function togglePane($: EngineInterface) {
  if (await isOpen($, PANE)) {
    await $.ui.close({ id: PANE })
    await $.state.set({ plugin: 'mod-file-tree', key: 'pane' }, false)
    return
  }
  if (await isOpen($, SETTINGS)) await $.ui.close({ id: SETTINGS })
  note = ''
  await hydrate($)
  const opened = await $.ui.open({ id: PANE, title: text.pill, closeOnEscape: true })
  if (!opened.isPlaced) $.ui.toast(fill(text.paneWaiting, { reason: opened.reason }))
  await $.state.set({ plugin: 'mod-file-tree', key: 'pane' }, opened.isPlaced)
}

// `/mod-file-tree settings` toggles the panel; an unplaced pane is waiting, not open.
async function toggleSettings($: EngineInterface) {
  if (await isOpen($, SETTINGS)) {
    await $.ui.close({ id: SETTINGS })
    await $.state.set({ plugin: 'mod-file-tree', key: 'pane' }, false)
    return
  }
  if (await isOpen($, PANE)) await $.ui.close({ id: PANE })
  note = ''
  const showcase = await $.fs.read(`${$.plugin.root}/showcase.json`).then(raw => JSON.parse(String(raw))).catch(() => null)
  previews = showcase?.previews
  actions = (Array.isArray(showcase?.actions) ? showcase.actions : []).map((action: Action) => ({ ...action, isLocal: action.command === 'mod-file-tree' }))
  const opened = await $.ui.open({ id: SETTINGS, title: text.settingsFrame, closeOnEscape: true })
  if (!opened.isPlaced) $.ui.toast(fill(text.settingsWaiting, { reason: opened.reason }))
  await $.state.set({ plugin: 'mod-file-tree', key: 'pane' }, opened.isPlaced)
}

async function clearAll($: EngineInterface) {
  const current = await hydrate($)
  cleared = { seq: current.seq, step: current.steps[current.steps.length - 1]?.id ?? 0 }
  await $.state.set({ plugin: 'mod-file-tree', key: 'cleared' }, cleared)
  mode = 'tree'
  replayTurn = null
  index = 0
  collapsed = []
  await save($)
}

// What `/mod-file-tree <args>` does; the settings panel's own actions call it directly, since $.command.run skips the calling plugin.
async function answer($: EngineInterface, args: string) {
  if (args.trim() === 'settings') {
    await toggleSettings($)
    return ''
  }
  if (args.trim() === 'clear') {
    await clearAll($)
    return text.cleared
  }
  await togglePane($)
  return ''
}

// Runs a command to its end: its exit code, or null and the reason when it could not start.
async function launch($: EngineInterface, argv: string[]) {
  try {
    const result = await $.process.run(argv, { timeoutMs: 15_000 })
    return { code: result.exitCode as number | null, reason: result.stderr.trim() }
  } catch (error) {
    return { code: null, reason: String(error) }
  }
}

// Explorer, Finder or the desktop's file manager on a folder, the default app on a file. Only a failed start counts as failing.
async function openWithSystem($: EngineInterface, isWindows: boolean, native: string) {
  // A mod's child starts with its window hidden, which Explorer honors, so `start` launches it with a normal window instead.
  if (isWindows) return launch($, ['cmd', '/c', 'start', 'explorer', native])
  const opened = await launch($, ['open', native])
  return opened.code === 0 ? opened : launch($, ['xdg-open', native])
}

// A row's path as the system writes it: joined to the session's folder when relative, with backslashes on Windows.
async function nativePath($: EngineInterface, path: string) {
  const cwd = String((await $.session.cwd().catch(() => '')) ?? '').replace(/\\/g, '/')
  const full = /^([A-Za-z]:)?\//.test(path) ? path : `${cwd}/${path}`
  const isWindows = /^[A-Za-z]:/.test(full)
  return { isWindows, native: isWindows ? full.replace(/\//g, '\\') : full }
}

async function openFolder($: EngineInterface, path: string, name = path) {
  const { isWindows, native } = await nativePath($, path)
  const opened = await openWithSystem($, isWindows, native)
  note = opened.code === null ? `${MARK.warn} ${fill(text.openFailed, { path: name, reason: opened.reason })}` : `${MARK.ok} ${fill(text.openedFolder, { path: name })}`
  $.ui.invalidate('ui.render')
}

// VS Code when its `code` command is on PATH, otherwise the system's default app for the file's type.
async function openFile($: EngineInterface, path: string) {
  const { isWindows, native } = await nativePath($, path)
  if ((await launch($, isWindows ? ['cmd', '/c', 'code', native] : ['code', native])).code === 0) {
    note = `${MARK.ok} ${fill(text.openedInCode, { path })}`
  } else {
    const opened = await openWithSystem($, isWindows, native)
    note = opened.code === null ? `${MARK.warn} ${fill(text.openFailed, { path, reason: opened.reason })}` : `${MARK.ok} ${fill(text.opened, { path })}`
  }
  $.ui.invalidate('ui.render')
}

// Opens the file's latest diff in the replay; a file Claude only read has none.
async function openDiff($: EngineInterface, path: string) {
  const current = viewOf(await hydrate($))
  const step = latestStepOf(current, path)
  if (!step) {
    note = `${MARK.warn} ${fill(text.onlyRead, { path })}`
  } else {
    mode = 'replay'
    replayTurn = step.turn
    index = Math.max(0, stepsOfTurn(current, step.turn).findIndex(other => other.id === step.id))
    note = `${MARK.ok} ${fill(text.replaying, { path })}`
  }
  $.ui.invalidate('ui.render')
}

function walk($: EngineInterface, delta: number, total: number) {
  const to = Math.max(0, Math.min(index + delta, total - 1))
  note = to === index ? `${MARK.warn} ${delta < 0 ? text.noEarlier : text.noLater}` : ''
  index = to
  $.ui.invalidate('ui.render')
}

// Folders the person opened while Claude works; the live folds leave them open until the next turn.
let opened: string[] = []

const foldsOf = (current: Log) => liveFolds(current, showReads)?.filter(key => !opened.includes(key)) ?? collapsed

function fold($: EngineInterface, current: Log, key: string) {
  const isLiveFold = liveFolds(current, showReads)?.includes(key)
  if (isLiveFold) opened = opened.includes(key) ? opened.filter(other => other !== key) : [...opened, key]
  else collapsed = collapsed.includes(key) ? collapsed.filter(other => other !== key) : [...collapsed, key]
  note = ''
  $.ui.invalidate('ui.render')
}

const WORD: Record<Kind, { done: string; live: string }> = text.words

// What a file's name color says: added, modified, or only read.
const STATUS: Record<Kind, { tone: ListRow['tone'] }> = {
  read: { tone: 'read' },
  edit: { tone: 'changed' },
  write: { tone: 'changed' },
  new: { tone: 'added' },
}

type ToolEvent = { tool: string; [argument: string]: unknown }

// What a call does to which file, read before it runs so a Write can see the file it replaces.
async function planOf($: EngineInterface, e: ToolEvent) {
  const cwd = await $.session.cwd().catch(() => '')
  const at = (path: unknown) => relPath(String(cwd ?? ''), String(path))
  if (e.tool === 'Read' && e.file_path) return { path: at(e.file_path), tool: 'Read', kind: 'read' as Kind, note: '', lines: [] as Line[] }
  if (e.tool === 'Edit' && e.file_path) {
    return { path: at(e.file_path), tool: 'Edit', kind: 'edit' as Kind, note: e.replace_all ? text.notes.replaceAll : '', lines: diffLines(String(e.old_string ?? ''), String(e.new_string ?? '')) }
  }
  if (e.tool === 'NotebookEdit' && e.notebook_path) {
    const editMode = String(e.edit_mode ?? 'replace')
    return { path: at(e.notebook_path), tool: 'NotebookEdit', kind: 'edit' as Kind, note: fill(text.notes.cell, { mode: editMode }), lines: diffLines('', String(e.new_source ?? '')) }
  }
  if (e.tool === 'Write' && e.file_path) {
    const path = String(e.file_path)
    const isThere = await $.fs.exists(path).catch(() => false)
    const before = isThere ? String(await $.fs.read(path).catch(() => '')) : ''
    return { path: at(path), tool: 'Write', kind: (isThere ? 'write' : 'new') as Kind, note: isThere ? text.notes.rewrite : text.notes.newFile, lines: diffLines(before, String(e.content ?? '')) }
  }
  return undefined
}

// The engine refuses a Client whose drawing is too large, which a whole session's tree reaches; each list draws this many rows.
const LIST_CHUNK = 40

// When each file's latest live edit landed, and the log's seq then; transcript rebuilds leave it empty, so old edits don't glow.
const landed = new Map<string, { at: number; seq: number }>()

const chunksOf = <T,>(items: T[]) => Array.from({ length: Math.ceil(items.length / LIST_CHUNK) }, (_, n) => items.slice(n * LIST_CHUNK, (n + 1) * LIST_CHUNK))

// The tree's rows as the Client draws them, cut to `width` with the counts and status flush right.
function listRows(current: Log, rows: ReturnType<typeof rowsOf>, glyphs: Look, width: number): ListRow[] {
  const icon = (name: string) => glyphs.glyph.icon[name] ?? ''
  return rows.map(row => {
    const guides = '│ '.repeat(row.depth)
    const entry: Entry | undefined = row.entry
    const done = entry ? landed.get(entry.path) : undefined
    // Once the edit lands the row stops being live and glows instead, until Claude touches another file.
    const isLive = Boolean(entry && current.working && entry.seq === current.seq && done?.seq !== entry.seq)
    const mark = row.isDir
      ? [row.isFolded ? glyphs.glyph.collapsed : glyphs.glyph.expanded, icon(row.isFolded ? 'folder' : 'folder-open')].filter(Boolean).join(' ')
      : icon(iconOf(row.name))
    // Safe mode has no folder icon, so a trailing slash tells a folder from a file.
    const name = row.isDir && !glyphs.nerd ? `${row.name}/` : row.name
    // Only the live row carries a word; the others show their status as the name's color.
    const status = entry && isLive ? WORD[entry.last].live : ''
    // A folded folder shows what its files add up to, so folding hides no change.
    const inside = row.isDir && row.isFolded ? current.files.filter(file => file.path.startsWith(`${row.key}/`)) : []
    const add = entry?.add ?? inside.reduce((sum, file) => sum + file.add, 0)
    const del = entry?.del ?? inside.reduce((sum, file) => sum + file.del, 0)
    const counts = [add > 0 ? `+${add}` : '', del > 0 ? `−${del}` : ''].filter(Boolean).join(' ')
    // The counts' pill adds a cap on each side where the font has them.
    const stats = counts.length + (counts && glyphs.nerd ? 2 : 0) + (status && counts ? 1 : 0)
    // The live word sits in a pill, one cell wider on each side.
    const used = guides.length + (mark ? [...mark].length + 1 : 0) + stats + status.length + (isLive ? 2 : 0) + OPEN_CELLS
    const shown = fit(name, Math.max(6, width - used - 1))
    return {
      guides,
      mark,
      name: shown,
      tone: !entry ? 'dir' : isLive ? 'live' : STATUS[entry.kind].tone,
      add,
      del,
      status,
      pad: width - used - shown.length,
      endMark: row.isDir ? glyphs.glyph.reveal : MARK.open,
      endColor: row.isDir ? THEME.folder : THEME.accent,
      ...(done ? { changedAt: done.at } : {}),
    }
  })
}

// True while the pointer is on this mod's pill entry, which then shows its tip under the row.
let tipShown = false

const toasts = new ToastList('filetree')
// The animations setting, fixed per activation: off, every entry draws still.
let still = false

// The entry shimmers from the click until the pane draws, so a slow open never looks ignored.
const OPEN_WAIT_MS = 8000
let isOpening = false

function endOpening($: EngineInterface) {
  if (!isOpening) return
  isOpening = false
  $.ui.invalidate('ui.render')
}

async function openingPane($: EngineInterface) {
  if (!(await isOpen($, PANE))) {
    isOpening = true
    $.ui.invalidate('ui.render')
    $.clock.after(OPEN_WAIT_MS, () => endOpening($))
  }
  await togglePane($)
  if (!(await isOpen($, PANE))) endOpening($)
}

// The share of each status color left in its legend pill, as the turn-fold chips tint their counts.
const LEGEND_WASH = 0.72

// A settings card's click: its row, saved through /config; a saved change reloads this mod.
async function saveSetting($: EngineInterface, key: string, value: ConfigValue) {
  const row = (await $.config.list()).find(each => each.key === key)
  if (!row) return
  const result = await $.config.set({ key, value })
  note = 'deny' in result && result.deny ? `${MARK.warn} ${result.deny}` : `${MARK.ok} ${fill(text.settingSaved, { label: row.label })}`
  $.ui.invalidate('ui.render')
}

// The panel's title line: the files and their settings as tabs, the shown one open.
const tabs = (isSettings: boolean, touched: number) => [
  { id: 'filetree-tab', label: text.pill, icon: look.glyph.icon.files ?? look.glyph.title, isOpen: !isSettings, ...(isSettings ? {} : { count: touched }) },
  { id: 'filetree-settings', label: text.settingsLabel, icon: look.glyph.gear, isOpen: isSettings },
]

export const register: Register = (on, options) => {
  still = options.animations === false
  toasts.isStill = still
  // This mod's toasts draw as cards in the band; Claude Code's own box is narrow and cuts them.
  on('ui.toast', async ($, e) => {
    const id = toasts.add(e.text)
    $.ui.invalidate('ui.render')
    $.clock.after(e.timeoutMs ?? TOAST_MS, () => {
      toasts.drop(id)
      $.ui.invalidate('ui.render')
    })
    return { value: undefined }
  })

  showReads = options.show_reads !== false
  wrapDiff = options.wrap_diff !== false
  recentTurns = Math.min(20, Math.max(2, Math.round(Number(options.recent_turns ?? 5)) || 5))
  iconMode = (options.icons as IconMode | undefined) ?? 'auto'
  // A forced mode needs no detection; auto loads the saved answer, then checks the terminal font beside the hooks.
  look = lookFor(iconMode === 'nerd')

  on('session.start', async ($, e, next) => {
    await loadLook($)
    await $.command.register({
      name: 'mod-file-tree',
      description: text.commandDescription,
      argumentHint: '[settings|clear]',
    })
    // The bar entry reads this; an unload drops the pane without raising ui.close here.
    await $.state.set({ plugin: 'mod-file-tree', key: 'pane' }, (await isOpen($, PANE)) || (await isOpen($, SETTINGS)))
    await hydrate($)
    // A hot reload leaves an open pane on its old drawing until something redraws it.
    $.ui.invalidate('ui.render')

    return next(e)
  })

  on('command.run', { command: 'mod-file-tree' }, async ($, e) => ({ text: await answer($, e.args) }))

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE || e.id === SETTINGS) {
      await $.state.set({ plugin: 'mod-file-tree', key: 'pane' }, await isOpen($, e.id === PANE ? SETTINGS : PANE))
    }

    return next(e)
  })

  // Deferred past this dispatch, so this mod's own state write is not nested in another plugin's.
  on('state.set', async ($, e, next) => {
    if (e.key === 'pane' && e.plugin !== 'mod-file-tree' && e.value === true) {
      $.clock.after(0, async () => {
        const wasOpen = (await isOpen($, PANE)) || (await isOpen($, SETTINGS))
        if (!wasOpen) return
        await $.ui.close({ id: PANE })
        await $.ui.close({ id: SETTINGS })
        await $.state.set({ plugin: 'mod-file-tree', key: 'pane' }, false)
      })
    }

    return next(e)
  })

  // Observes only: the call is recorded before it runs (the tree shows it live) and its diff once it succeeds.
  on('tool.call', async ($, e, next) => {
    const plan = await planOf($, e as ToolEvent).catch(() => undefined)
    if (!plan) {
      if (e.tool !== 'Bash') return next(e)
      // A shell command's edits come back with its result, as Claude Code diffed them.
      const ran = await next(e)
      const cwd = String((await $.session.cwd().catch(() => '')) ?? '')
      const shells = shellPlans((ran as { result?: { bashEditDiff?: unknown } })?.result?.bashEditDiff, cwd)
      if (shells.length > 0) {
        await hydrate($)
        for (const shell of shells) {
          log = commit(touch(log!, shell.path, shell.kind), shell.path, shell.tool, shell.kind, shell.note, shell.lines)
          landed.set(shell.path, { at: Date.now(), seq: log.seq })
        }
        await save($)
      }
      return ran
    }

    await hydrate($)
    log = touch(log!, plan.path, plan.kind)
    await save($)

    const result = await next(e)
    const isFailed = typeof result === 'object' && result !== null && ('deny' in result || ('isError' in result && result.isError === true))
    if (plan.kind !== 'read' && !isFailed) {
      log = commit(log!, plan.path, plan.tool, plan.kind, plan.note, plan.lines)
      landed.set(plan.path, { at: Date.now(), seq: log.seq })
      if (replayTurn === null) index = Math.max(0, stepsOfTurn(viewOf(log), null).length - 1)
      await save($)
    }

    return result
  })

  on('turn.start', async ($, e, next) => {
    if (!e.agentId) {
      await hydrate($)
      log = { ...log!, turn: log!.turn + 1, working: true }
      opened = []
      replayTurn = null
      await save($)
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (!e.agentId) {
      await hydrate($)
      log = { ...log!, working: false }
      if (replayTurn === null) index = 0
      await save($)
    }

    return next(e)
  })

  // Only the settings hook event names the transcript. A compact keeps the same file and the log already holds it, so only a new transcript is read.
  on('classic.SessionStart', async ($, e, next) => {
    if (e.transcript_path !== transcript || !log) {
      transcript = e.transcript_path
      log = undefined
      cleared = { seq: 0, step: 0 }
      await $.state.set({ plugin: 'mod-file-tree', key: 'cleared' }, cleared)
      await $.store.set(`transcript:${e.session_id}`, e.transcript_path)
      await load($)
      log ??= emptyLog()
      await save($)
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    await loadLook($)
    const hidden = await $.state.get({ plugin: 'mod-menu', key: 'hidden' })
    if (e.surface !== 'terminal' || e.props.hasSurvey) return next(e)
    if (hidden.value === true) {
      if (toasts.items.length === 0) return next(e)
      const { Box, Client, Text } = $.ui.resolve(e)
      return <Box key="toasts-filetree" flexDirection="column">{toastCards({ Box, Client, Text }, toasts, look)}{await next(e)}</Box>
    }

    const { Box, Client, Text } = $.ui.resolve(e)
    // Reading the value subscribes the bar to redraws; the look trusts the pane list itself.
    await $.state.get({ plugin: 'mod-file-tree', key: 'pane' })
    const shown = await isOpen($, PANE)
    const { group, row, rest, tip } = splitRow(await next(e))
    // Opening the pane from here queues nothing, so the entry stays live mid-turn.
    const entry = menuEntry({ Box, Client, Text }, look.nerd, 'filetree', { label: text.pill, isOpen: shown, idle: THEME.pill, isBusy: isOpening, still })

    return pillRow({ Box, Text }, look.nerd, [entry, ...group], row, [...toastCards({ Box, Client, Text }, toasts, look), ...rest], tipShown ? tipLine({ Box, Text }, text.pillTip) : tip)
  })

  on('ui.message', async ($, e, next) => {
    const clicked = e.data as EntryMessage
    const dismissed = clicked?.type === 'menu-entry' ? toasts.idOf(clicked.id) : undefined
    if (dismissed !== undefined) {
      toasts.drop(dismissed)
      $.ui.invalidate('ui.render')
      return next(e)
    }
    const hover = e.data as { type?: string; id?: string; isOver?: boolean }
    if (hover?.type === 'menu-hover' && hover.id === 'filetree') {
      tipShown = hover.isOver === true
      $.ui.invalidate('ui.render')
    }
    const change = settingChoice(e.data)
    if (change) await saveSetting($, change.key, change.value)
    const message = e.data as EntryMessage
    if (message?.type !== 'menu-entry') return next(e)
    if (message.id === 'filetree') await openingPane($)
    // The title line's tabs swap the panel and its settings; the open tab does nothing.
    if (message.id === 'filetree-settings' && !(await isOpen($, SETTINGS))) await toggleSettings($)
    if (message.id === 'filetree-tab' && !(await isOpen($, PANE))) await togglePane($)
    if (message.id === 'tab-tree' || message.id === 'tab-replay') {
      mode = message.id === 'tab-tree' ? 'tree' : 'replay'
      note = ''
      $.ui.invalidate('ui.render')
    }
    if (message.id === 'scope-turn' || message.id === 'scope-recent' || message.id === 'scope-session') {
      scope = message.id === 'scope-turn' ? 'turn' : message.id === 'scope-recent' ? 'recent' : 'session'
      note = ''
      $.ui.invalidate('ui.render')
    }
    if (message.id === 'session-reveal') {
      const cwd = String((await $.session.cwd().catch(() => '')) ?? '').replace(/\\/g, '/')
      await openFolder($, cwd, cwd.split('/').pop() || text.rootFallback)
    }
    if (message.id === 'replay-prev' || message.id === 'replay-next') {
      walk($, message.id === 'replay-prev' ? -1 : 1, stepsOfTurn(viewOf(await hydrate($)), replayTurn).length)
    }

    return next(e)
  })

  // The list reports clicks on a row's text: a folder folds, a file opens its diff.
  on('ui.message', { requestId: PANE }, async ($, e, next) => {
    const message = e.data as ListMessage
    if (message.type === 'select') {
      const current = viewOf(await hydrate($))
      const row = rowsOf(current, foldsOf(current), showReads)[message.index]
      if (row?.isDir) fold($, current, row.key)
      else if (row) await openDiff($, row.key)
    }
    if (message.type === 'open') {
      const current = viewOf(await hydrate($))
      const row = rowsOf(current, foldsOf(current), showReads)[message.index]
      if (row?.isDir) await openFolder($, row.key)
      else if (row) await openFile($, row.key)
    }

    return next(e)
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    await loadLook($)
    if (e.requestId !== PANE && e.requestId !== SETTINGS) return next(e)
    if (isOpening) $.clock.after(0, () => endOpening($))

    const { Box, Button, Client, Text } = $.ui.resolve(e)
    const elements = { Box, Button, Text }

    if (e.requestId === SETTINGS) {
      const rows = (await $.config.list()).filter(row => row.key.startsWith('mod-file-tree.'))
      const run = async (action: Action) => {
        const said = answer($, action.args ?? '')
        note = await said.then(said => `${MARK.ok} ${said || action.label}`).catch(error => `${MARK.warn} ${String(error)}`)
        $.ui.invalidate('ui.render')
      }
      return (
        <Box flexDirection="column" backgroundColor={THEME.bg} paddingX={1} minHeight={e.props.scroll.bodyRows}>
          {tabRow({ Box, Client, Text }, look.nerd, tabs(true, 0), still)}
          <Text wrap="truncate-end" color={statusColor(note)}>{withMark(look, note) || fill(text.settingsHint, { sep: MARK.sep })}</Text>
          <Box marginTop={0}>{settingsBody({ Box, Button, Client, Text }, look, { rows, actions, working: false, run, previews, still })}</Box>
        </Box>
      )
    }

    // Reading the log subscribes the pane to every tool call; a reload empties the copy, so it is read again.
    await $.state.get({ plugin: 'mod-file-tree', key: 'log' })
    const current = viewOf(await hydrate($))
    const rows = rowsOf(current, foldsOf(current), showReads)
    // Every file in the view, folded or not.
    const touched = current.files.filter(file => showReads || file.kind !== 'read').length
    const { glyph } = look

    // Tabs and the replay's steppers are entries: text that lights on hover, the active tab on its own surface.
    const entry = (id: string, label: string, isOn: boolean, bg: string = THEME.surface1, extra: Partial<EntryProps> = {}) => (
      <Box key={`${id}-pad`}>
        <Client key={id} module="./entry.tsx" height={1} props={{ id, label, isOpen: isOn, bg, nerd: look.nerd, still, ...extra }} />
      </Box>
    )
    // A Nerd icon as a subpill before the label; safe mode has none, so the prop stays out.
    const iconLead = (name: string, color: string) => (look.glyph.icon[name] ? { subLead: look.glyph.icon[name], subLeadColor: color } : {})
    // A switch is a choice bar, as on a settings page: the options on one surface-2 pill, the chosen one on its own surface-3 pill.
    const choiceBar = (key: string, options: { id: string; label: string; isOn: boolean; icon?: string }[]) =>
      pill({ Box, Text }, look.nerd, THEME.surface2, (
        <Box key={`${key}-options`} flexDirection="row" backgroundColor={THEME.surface2}>
          {options.map(option => {
            const lead = option.icon ? iconLead(option.icon, option.isOn ? THEME.accent : THEME.muted) : {}
            return option.isOn
              ? pill({ Box, Text }, look.nerd, THEME.surface3, entry(option.id, option.label, true, THEME.surface3, { idle: THEME.muted, ...lead }), `${option.id}-chosen`, THEME.surface2)
              : entry(option.id, option.label, false, THEME.surface2, lead)
          })}
        </Box>
      ), `${key}-bar`, THEME.bg)

    // The pane and the section each pad one column on both sides.
    const width = Math.max(20, e.props.bodyColumns - 4)
    const tree =
      rows.length === 0
        ? <Text key="tree-empty" color={THEME.muted}>{text.treeEmpty}</Text>
        : (
            <Box key="lists" flexDirection="column">
              {chunksOf(listRows(current, rows, look, width)).map((chunk, n) => (
                <Client key={`list-${n}`} module="./list.tsx" height={chunk.length} props={{ rows: chunk, offset: n * LIST_CHUNK, still, nerd: look.nerd, width }} />
              ))}
            </Box>
          )
    const root = rootOf(current, showReads)
    const rootName = root.split('/').pop() || String(await $.session.cwd().catch(() => '')).replace(/\\/g, '/').split('/').pop() || text.rootFallback

    const steps = stepsOfTurn(current, replayTurn)
    const at = Math.max(0, Math.min(index, steps.length - 1))
    const step = steps[at]
    const color = (op: Line['op']) => (op === '+' ? THEME.good : op === '-' ? THEME.alert : THEME.muted)
    const replay = !step
      ? <Text key="replay-empty" color={THEME.muted}>{text.replayEmpty}</Text>
      : (
          <Box key="replay-body" flexDirection="column">
            <Box key="replay-file" flexDirection="row" marginTop={1}>
              <Text color={THEME.accent} bold wrap="truncate-start">{withIcon(look, iconOf(step.path), step.path)}</Text>
            </Box>
            <Box key="replay-meta" flexDirection="row" columnGap={1}>
              <Text color={THEME.muted}>{[step.tool, step.note].filter(Boolean).join(` ${MARK.sep} `)}</Text>
              {step.add > 0 ? <Text color={THEME.good}>{`+${step.add}`}</Text> : null}
              {step.del > 0 ? <Text color={THEME.alert}>{`−${step.del}`}</Text> : null}
            </Box>
            <Box key="replay-diff" flexDirection="column" marginTop={1}>
              {step.lines.length === 0 ? <Text color={THEME.muted}>{text.noLineChanges}</Text> : null}
              {step.lines.map((line, n) => (
                // Red text on the delete tint fails contrast, so only the sign carries the signal color.
                <Box key={`diff-${n}`} flexDirection="row" backgroundColor={line.op === '+' ? THEME.addBg : line.op === '-' ? THEME.delBg : undefined}>
                  <Text color={color(line.op)} bold={line.op === '+' || line.op === '-'}>{`${line.op === '~' ? ' ' : line.op === '-' ? '−' : line.op} `}</Text>
                  <Text color={line.op === ' ' || line.op === '~' ? THEME.muted : THEME.onSurface} wrap={wrapDiff ? 'wrap' : 'truncate-end'}>{line.t}</Text>
                </Box>
              ))}
            </Box>
          </Box>
        )

    // The steppers ride on the heading row, right-aligned, so they stay put whatever the diff's length.
    const arrow = { color: THEME.accent, bg: mix(THEME.accent, THEME.surface3, LEGEND_WASH) }
    const replayNav = step ? (
      <Box key="replay-nav" flexDirection="row" columnGap={1}>
        {pill({ Box, Text }, look.nerd, THEME.surface3, entry('replay-prev', text.prev, at > 0, THEME.surface3, { subLead: glyph.back, subLeadColor: THEME.accent }), 'replay-prev-pill', THEME.surface1)}
        <Text color={THEME.onSurface} bold>{fill(text.stepOf, { at: at + 1, total: steps.length })}</Text>
        {pill({ Box, Text }, look.nerd, THEME.surface3, entry('replay-next', text.next, at < steps.length - 1, THEME.surface3, { badge: { text: glyph.title, ...arrow }, nerd: look.nerd }), 'replay-next-pill', THEME.surface1)}
      </Box>
    ) : null
    const replayTitle = fill(text.replayHeading, { sep: MARK.sep, n: steps.length, unit: steps.length === 1 ? text.editOne : text.editMany })
    const replayHead = (
      <Box key="replay-heading-row" flexDirection="row">
        {heading(elements, look, 'replay', 'replay', replayTitle)}
        <Box key="replay-heading-gap" flexGrow={1} />
        {replayNav}
      </Box>
    )

    const hint =
      mode === 'tree'
        ? `${fill(text.hintTree, { sep: MARK.sep })}${showReads ? '' : fill(text.hintReadsHidden, { sep: MARK.sep })}`
        : fill(text.hintReplay, { sep: MARK.sep })

    return (
      <Box flexDirection="column" backgroundColor={THEME.bg} paddingX={1} minHeight={e.props.scroll.bodyRows}>
        <Box key="title-line" flexDirection="row" columnGap={1}>
          {tabRow({ Box, Client, Text }, look.nerd, tabs(false, touched), still)}
          {current.working ? <Text color={THEME.muted}>{text.working}</Text> : null}
        </Box>
        <Text wrap="truncate-end" color={statusColor(note)}>{withMark(look, note) || hint}</Text>
        <Box key="tabs" flexDirection="row" columnGap={1} marginTop={1}>
          {choiceBar('view', [
            { id: 'tab-tree', label: text.tabTree, isOn: mode === 'tree', icon: 'files' },
            { id: 'tab-replay', label: text.tabReplay, isOn: mode === 'replay', icon: 'replay' },
          ])}
          {mode === 'tree'
            ? choiceBar('scope', [
                { id: 'scope-turn', label: text.scopeTurn, isOn: scope === 'turn' },
                { id: 'scope-recent', label: fill(text.scopeRecent, { n: recentTurns }), isOn: scope === 'recent' },
                { id: 'scope-session', label: text.scopeSession, isOn: scope === 'session' },
              ])
            : null}
        </Box>
        {mode === 'tree' ? section(elements, look, 'tree', 'folder-open', rootName, tree) : section(elements, look, 'replay', '', '', [replayHead, replay])}
        {/* The footer names what each name color means, once, instead of a letter on every row. */}
        {mode === 'tree' ? <Box key="legend-push" flexGrow={1} /> : null}
        {mode === 'tree' ? (
          <Box key="legend" flexDirection="column">
            <Text key="legend-rule" color={THEME.border}>{'─'.repeat(Math.max(1, e.props.bodyColumns - 2))}</Text>
            <Box key="legend-row" flexDirection="row" columnGap={1}>
              {(['changed', 'added', 'read'] as const).map(tone =>
                pill({ Box, Text }, look.nerd, mix(NAME_COLOR[tone], THEME.bg, LEGEND_WASH), <Text color={NAME_COLOR[tone]}>{look.nerd ? text.legend[tone] : ` ${text.legend[tone]} `}</Text>, `legend-${tone}`, THEME.bg),
              )}
              <Box key="legend-gap" flexGrow={1} />
              {/* The session's own folder opens from a pill at the footer's right end, with the folder rows' mark. */}
              {pill({ Box, Text }, look.nerd, THEME.surface3, entry('session-reveal', text.sessionFolder, false, THEME.surface3, { subLead: look.glyph.icon.folder ?? look.glyph.reveal, subLeadColor: THEME.folder }), 'session-reveal-pill', THEME.bg)}
            </Box>
          </Box>
        ) : null}
      </Box>
    )
  })
}
