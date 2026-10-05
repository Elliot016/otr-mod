import type { ConfigRow, ConfigValue, EngineInterface, Register } from 'claude-code'

import type { ListMessage, Row as ListRow } from './list'
import { isNerdFace, lookFor, paneTitle, section, terminalSettings, withIcon, type IconMode, type Look, withMark } from './look'
import type { EntryMessage } from './entry'
import { PILL, pillRow, splitRow, tipLine, titleRow } from './pills'
import { TOAST_MS, ToastList, toastCards } from './toasts'
import { settingsBody, type Action, type Previews } from './settings'
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

// Git's letters, as VS Code shows them: added, modified, and R for a file Claude only read.
const STATUS: Record<Kind, { letter: string; tone: ListRow['tone'] }> = {
  read: { letter: text.status.read, tone: 'read' },
  edit: { letter: text.status.edit, tone: 'changed' },
  write: { letter: text.status.write, tone: 'changed' },
  new: { letter: text.status.new, tone: 'added' },
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
    const status = !entry ? '' : isLive ? WORD[entry.last].live : STATUS[entry.kind].letter
    // A folded folder shows what its files add up to, so folding hides no change.
    const inside = row.isDir && row.isFolded ? current.files.filter(file => file.path.startsWith(`${row.key}/`)) : []
    const add = entry?.add ?? inside.reduce((sum, file) => sum + file.add, 0)
    const del = entry?.del ?? inside.reduce((sum, file) => sum + file.del, 0)
    const counts = [add > 0 ? `+${add}` : '', del > 0 ? `−${del}` : ''].filter(Boolean).join(' ')
    const stats = counts.length + (status && counts ? 1 : 0)
    // The live word sits in a pill, one cell wider on each side.
    const used = guides.length + (mark ? [...mark].length + 1 : 0) + stats + status.length + (isLive ? 2 : 0)
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
  // A forced mode needs no detection; auto waits for session.start to read the terminal font.
  look = lookFor(iconMode === 'nerd')

  on('session.start', async ($, e, next) => {
    look = await detectLook($)
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
    const hidden = await $.state.get({ plugin: 'mod-menu', key: 'hidden' })
    if (e.surface !== 'terminal' || e.props.hasSurvey) return next(e)
    if (hidden.value === true) {
      if (toasts.items.length === 0) return next(e)
      const { Box, Client, Text } = $.ui.resolve(e)
      return <Box key="toasts-filetree" flexDirection="column">{toastCards({ Box, Client, Text }, toasts)}{await next(e)}</Box>
    }

    const { Box, Client, Text } = $.ui.resolve(e)
    // Reading the value subscribes the bar to redraws; the look trusts the pane list itself.
    await $.state.get({ plugin: 'mod-file-tree', key: 'pane' })
    const shown = await isOpen($, PANE)
    const { group, row, rest, tip } = splitRow(await next(e))
    // Opening the pane from here queues nothing, so the entry stays live mid-turn.
    const entry = (
      <Box key="menu-pad-filetree">
        <Client key="menu-entry-filetree" module="./entry.tsx" height={1} props={{ id: 'filetree', label: text.pill, isOpen: shown, bg: PILL.primary, idle: THEME.pill, isBusy: isOpening, still }} />
      </Box>
    )

    return pillRow({ Box, Text }, look.nerd, [entry, ...group], row, [...toastCards({ Box, Client, Text }, toasts), ...rest], tipShown ? tipLine({ Box, Text }, text.pillTip) : tip)
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
    const message = e.data as EntryMessage
    if (message?.type !== 'menu-entry') return next(e)
    if (message.id === 'filetree') await openingPane($)
    // The title row's pill swaps the panel and its settings.
    if (message.id === 'filetree-settings') await toggleSettings($)
    if (message.id === 'filetree-back') await togglePane($)
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

    return next(e)
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE && e.requestId !== SETTINGS) return next(e)
    if (isOpening) $.clock.after(0, () => endOpening($))

    const { Box, Button, Client, Text } = $.ui.resolve(e)
    const elements = { Box, Button, Text }

    if (e.requestId === SETTINGS) {
      const rows = (await $.config.list()).filter(row => row.key.startsWith('mod-file-tree.'))
      // A saved change reloads this mod, which redraws the panel with the new value.
      const set = async (row: ConfigRow, value: ConfigValue) => {
        const result = await $.config.set({ key: row.key, value })
        note = 'deny' in result && result.deny ? `${MARK.warn} ${result.deny}` : `${MARK.ok} ${fill(text.settingSaved, { label: row.label })}`
        $.ui.invalidate('ui.render')
      }
      const run = async (action: Action) => {
        const said = answer($, action.args ?? '')
        note = await said.then(said => `${MARK.ok} ${said || action.label}`).catch(error => `${MARK.warn} ${String(error)}`)
        $.ui.invalidate('ui.render')
      }
      return (
        <Box flexDirection="column" backgroundColor={THEME.bg} paddingX={1} minHeight={e.props.scroll.bodyRows}>
          {titleRow({ Box, Client, Text }, look.nerd, paneTitle(elements, look, 'settings', fill(text.settingsTitle, { sep: MARK.sep })), 'filetree-back', `${look.glyph.back} ${text.backLabel}`, still)}
          <Text color={statusColor(note)}>{withMark(look, note) || fill(text.settingsHint, { sep: MARK.sep })}</Text>
          <Box marginTop={0}>{settingsBody(elements, look, { rows, actions, working: false, set, run, previews })}</Box>
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
    const entry = (id: string, label: string, isOn: boolean, bg: string = THEME.surface1) => (
      <Box key={`${id}-pad`}>
        <Client key={id} module="./entry.tsx" height={1} props={{ id, label, isOpen: isOn, bg, still }} />
      </Box>
    )
    const tab = (id: string, isActive: boolean, icon: string, label: string) => entry(id, withIcon(look, icon, label), isActive, isActive ? THEME.surface2 : THEME.bg)

    // The pane and the section each pad one column on both sides.
    const width = Math.max(20, e.props.bodyColumns - 4)
    const tree =
      rows.length === 0
        ? <Text key="tree-empty" color={THEME.muted}>{text.treeEmpty}</Text>
        : (
            <Box key="lists" flexDirection="column">
              {chunksOf(listRows(current, rows, look, width)).map((chunk, n) => (
                <Client key={`list-${n}`} module="./list.tsx" height={chunk.length} props={{ rows: chunk, offset: n * LIST_CHUNK, still, nerd: look.nerd }} />
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
            {/* The steppers sit on top, so they stay put whatever the diff's length. */}
            <Box key="replay-nav" flexDirection="row" columnGap={1}>
              {entry('replay-prev', `${glyph.back} ${text.prev}`, at > 0)}
              <Text color={THEME.onSurface} bold>{fill(text.stepOf, { at: at + 1, total: steps.length })}</Text>
              {entry('replay-next', `${text.next} ${glyph.title}`, at < steps.length - 1)}
            </Box>
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

    const hint =
      mode === 'tree'
        ? `${fill(text.hintTree, { sep: MARK.sep })}${showReads ? '' : fill(text.hintReadsHidden, { sep: MARK.sep })}`
        : fill(text.hintReplay, { sep: MARK.sep })

    return (
      <Box flexDirection="column" backgroundColor={THEME.bg} paddingX={1} minHeight={e.props.scroll.bodyRows}>
        {titleRow({ Box, Client, Text }, look.nerd, paneTitle(elements, look, 'files', `${fill(text.paneTitle, { sep: MARK.sep, n: touched })}${current.working ? fill(text.paneWorking, { sep: MARK.sep }) : ''}`), 'filetree-settings', `${look.glyph.gear} Settings`, still)}
        <Text color={statusColor(note)}>{withMark(look, note) || hint}</Text>
        <Box key="tabs" flexDirection="row" columnGap={1} marginTop={1}>
          {tab('tab-tree', mode === 'tree', 'files', text.tabTree)}
          {tab('tab-replay', mode === 'replay', 'replay', text.tabReplay)}
          {mode === 'tree' ? <Text key="scope-sep" color={THEME.border}>│</Text> : null}
          {mode === 'tree' ? entry('scope-turn', text.scopeTurn, scope === 'turn', scope === 'turn' ? THEME.surface2 : THEME.bg) : null}
          {mode === 'tree' ? entry('scope-recent', fill(text.scopeRecent, { n: recentTurns }), scope === 'recent', scope === 'recent' ? THEME.surface2 : THEME.bg) : null}
          {mode === 'tree' ? entry('scope-session', text.scopeSession, scope === 'session', scope === 'session' ? THEME.surface2 : THEME.bg) : null}
        </Box>
        {mode === 'tree' ? section(elements, look, 'tree', 'folder-open', rootName, tree) : section(elements, look, 'replay', 'replay', fill(text.replayHeading, { sep: MARK.sep, n: steps.length, unit: steps.length === 1 ? text.editOne : text.editMany }), replay)}
      </Box>
    )
  })
}
