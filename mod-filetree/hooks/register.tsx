import type { ConfigRow, ConfigValue, EngineInterface, Register } from 'claude-code'

import type { ListMessage, Row as ListRow } from './list'
import { isNerdFace, lookFor, paneTitle, section, terminalSettings, withIcon, type IconMode, type Look, withMark } from './look'
import type { EntryMessage } from './entry'
import { PILL, pillRow, splitRow, tipLine } from './pills'
import { TOAST_MS, ToastList, toastCards } from './toasts'
import { settingsBody, type Action, type Previews } from './settings'
import { MARK, statusColor, THEME } from './theme'
import { commit, diffLines, emptyLog, fit, iconOf, latestStepOf, relPath, rootOf, rowsOf, stepsOfTurn, touch, type Entry, type Kind, type Line, type Log } from './tree'

const PANE = 'filetree'
const SETTINGS = 'filetree-settings'

let showReads = true
let wrapDiff = true
let iconMode: IconMode = 'auto'
let look = lookFor(false)

// The log survives a reload in $.state; this copy is what the hooks edit, reloaded from there when empty.
let log: Log | undefined
let mode: 'tree' | 'replay' = 'tree'
// null follows the latest turn that edited something.
let replayTurn: number | null = null
let index = 0
let collapsed: string[] = []
let note = ''
let actions: Action[] = []
let previews: Previews | undefined

const isOpen = async ($: EngineInterface, id: string) => (await $.ui.panes()).some(pane => pane.id === id && pane.isPlaced)

async function hydrate($: EngineInterface) {
  if (!log) log = ((await $.state.get({ plugin: 'mod-filetree', key: 'log' })).value as Log | undefined) ?? emptyLog()
  return log
}

async function save($: EngineInterface) {
  await $.state.set({ plugin: 'mod-filetree', key: 'log' }, log ?? emptyLog())
  $.ui.invalidate('ui.render')
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
    await $.state.set({ plugin: 'mod-filetree', key: 'pane' }, false)
    return
  }
  if (await isOpen($, SETTINGS)) await $.ui.close({ id: SETTINGS })
  note = ''
  await hydrate($)
  const opened = await $.ui.open({ id: PANE, title: 'Files', closeOnEscape: true })
  if (!opened.isPlaced) $.ui.toast(`Files panel waiting: ${opened.reason}`)
  await $.state.set({ plugin: 'mod-filetree', key: 'pane' }, opened.isPlaced)
}

// `/mod-filetree settings` toggles the panel; an unplaced pane is waiting, not open.
async function toggleSettings($: EngineInterface) {
  if (await isOpen($, SETTINGS)) {
    await $.ui.close({ id: SETTINGS })
    await $.state.set({ plugin: 'mod-filetree', key: 'pane' }, false)
    return
  }
  if (await isOpen($, PANE)) await $.ui.close({ id: PANE })
  note = ''
  const showcase = await $.fs.read(`${$.plugin.root}/showcase.json`).then(text => JSON.parse(String(text))).catch(() => null)
  previews = showcase?.previews
  actions = (Array.isArray(showcase?.actions) ? showcase.actions : []).map((action: Action) => ({ ...action, isLocal: action.command === 'mod-filetree' }))
  const opened = await $.ui.open({ id: SETTINGS, title: 'mod-filetree', closeOnEscape: true })
  if (!opened.isPlaced) $.ui.toast(`Settings panel waiting: ${opened.reason}`)
  await $.state.set({ plugin: 'mod-filetree', key: 'pane' }, opened.isPlaced)
}

async function clearAll($: EngineInterface) {
  log = emptyLog()
  mode = 'tree'
  replayTurn = null
  index = 0
  collapsed = []
  await save($)
}

// What `/mod-filetree <args>` does; the settings panel's own actions call it directly, since $.command.run skips the calling plugin.
async function answer($: EngineInterface, args: string) {
  if (args.trim() === 'settings') {
    await toggleSettings($)
    return ''
  }
  if (args.trim() === 'clear') {
    await clearAll($)
    return 'Cleared the file tree and the replay'
  }
  await togglePane($)
  return ''
}

// Opens the file's latest diff in the replay; a file Claude only read has none.
async function openDiff($: EngineInterface, path: string) {
  const current = await hydrate($)
  const step = latestStepOf(current, path)
  if (!step) {
    note = `${MARK.warn} ${path} was only read, there is no diff`
  } else {
    mode = 'replay'
    replayTurn = step.turn
    index = Math.max(0, stepsOfTurn(current, step.turn).findIndex(other => other.id === step.id))
    note = `${MARK.ok} Replaying ${path}`
  }
  $.ui.invalidate('ui.render')
}

function walk($: EngineInterface, delta: number, total: number) {
  const to = Math.max(0, Math.min(index + delta, total - 1))
  note = to === index ? `${MARK.warn} No ${delta < 0 ? 'earlier' : 'later'} edit in this turn` : ''
  index = to
  $.ui.invalidate('ui.render')
}

function fold($: EngineInterface, key: string) {
  collapsed = collapsed.includes(key) ? collapsed.filter(other => other !== key) : [...collapsed, key]
  note = ''
  $.ui.invalidate('ui.render')
}

const WORD: Record<Kind, { done: string; live: string }> = {
  read: { done: 'read', live: 'reading' },
  edit: { done: 'edited', live: 'editing' },
  write: { done: 'written', live: 'writing' },
  new: { done: 'created', live: 'creating' },
}

// Git's letters, as VS Code shows them: added, modified, and R for a file Claude only read.
const STATUS: Record<Kind, { letter: string; tone: ListRow['tone'] }> = {
  read: { letter: 'R', tone: 'read' },
  edit: { letter: 'M', tone: 'changed' },
  write: { letter: 'M', tone: 'changed' },
  new: { letter: 'A', tone: 'added' },
}

type ToolEvent = { tool: string; [argument: string]: unknown }

// What a call does to which file, read before it runs so a Write can see the file it replaces.
async function planOf($: EngineInterface, e: ToolEvent) {
  const cwd = await $.session.cwd().catch(() => '')
  const at = (path: unknown) => relPath(String(cwd ?? ''), String(path))
  if (e.tool === 'Read' && e.file_path) return { path: at(e.file_path), tool: 'Read', kind: 'read' as Kind, note: '', lines: [] as Line[] }
  if (e.tool === 'Edit' && e.file_path) {
    return { path: at(e.file_path), tool: 'Edit', kind: 'edit' as Kind, note: e.replace_all ? 'replace all' : '', lines: diffLines(String(e.old_string ?? ''), String(e.new_string ?? '')) }
  }
  if (e.tool === 'NotebookEdit' && e.notebook_path) {
    const editMode = String(e.edit_mode ?? 'replace')
    return { path: at(e.notebook_path), tool: 'NotebookEdit', kind: 'edit' as Kind, note: `${editMode} cell`, lines: diffLines('', String(e.new_source ?? '')) }
  }
  if (e.tool === 'Write' && e.file_path) {
    const path = String(e.file_path)
    const isThere = await $.fs.exists(path).catch(() => false)
    const before = isThere ? String(await $.fs.read(path).catch(() => '')) : ''
    return { path: at(path), tool: 'Write', kind: (isThere ? 'write' : 'new') as Kind, note: isThere ? 'rewrite' : 'new file', lines: diffLines(before, String(e.content ?? '')) }
  }
  return undefined
}

// The tree's rows as the Client draws them, cut to `width` with the counts and status flush right.
function listRows(current: Log, rows: ReturnType<typeof rowsOf>, glyphs: Look, width: number): ListRow[] {
  const icon = (name: string) => glyphs.glyph.icon[name] ?? ''
  return rows.map(row => {
    const guides = '│ '.repeat(row.depth)
    const entry: Entry | undefined = row.entry
    const isLive = Boolean(entry && current.working && entry.seq === current.seq)
    const mark = row.isDir
      ? [row.isFolded ? glyphs.glyph.collapsed : glyphs.glyph.expanded, icon(row.isFolded ? 'folder' : 'folder-open')].filter(Boolean).join(' ')
      : icon(iconOf(row.name))
    // Safe mode has no folder icon, so a trailing slash tells a folder from a file.
    const name = row.isDir && !glyphs.nerd ? `${row.name}/` : row.name
    const status = !entry ? '' : isLive ? WORD[entry.last].live : STATUS[entry.kind].letter
    const stats = !entry ? 0 : (entry.add > 0 ? `+${entry.add} `.length : 0) + (entry.del > 0 ? `−${entry.del} `.length : 0)
    const used = guides.length + (mark ? [...mark].length + 1 : 0) + stats + status.length
    const shown = fit(name, Math.max(6, width - used - 1))
    return {
      guides,
      mark,
      name: shown,
      tone: !entry ? 'dir' : isLive ? 'live' : STATUS[entry.kind].tone,
      add: entry?.add ?? 0,
      del: entry?.del ?? 0,
      status,
      pad: width - used - shown.length,
    }
  })
}

// True while the pointer is on this mod's pill entry, which then shows its tip under the row.
let tipShown = false

const toasts = new ToastList('filetree')

export const register: Register = (on, options) => {
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
  iconMode = (options.icons as IconMode | undefined) ?? 'auto'
  // A forced mode needs no detection; auto waits for session.start to read the terminal font.
  look = lookFor(iconMode === 'nerd')

  on('session.start', async ($, e, next) => {
    look = await detectLook($)
    await $.command.register({
      name: 'mod-filetree',
      description: 'Open the files sidebar: a tree of the files Claude touched and a replay of its last edits; `settings` opens its settings panel',
      argumentHint: '[settings|clear]',
    })
    // The bar entry reads this; an unload drops the pane without raising ui.close here.
    await $.state.set({ plugin: 'mod-filetree', key: 'pane' }, (await isOpen($, PANE)) || (await isOpen($, SETTINGS)))
    await hydrate($)
    // A hot reload leaves an open pane on its old drawing until something redraws it.
    $.ui.invalidate('ui.render')

    return next(e)
  })

  on('command.run', { command: 'mod-filetree' }, async ($, e) => ({ text: await answer($, e.args) }))

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE || e.id === SETTINGS) {
      await $.state.set({ plugin: 'mod-filetree', key: 'pane' }, await isOpen($, e.id === PANE ? SETTINGS : PANE))
    }

    return next(e)
  })

  // Deferred past this dispatch, so this mod's own state write is not nested in another plugin's.
  on('state.set', async ($, e, next) => {
    if (e.key === 'pane' && e.plugin !== 'mod-filetree' && e.value === true) {
      $.clock.after(0, async () => {
        const wasOpen = (await isOpen($, PANE)) || (await isOpen($, SETTINGS))
        if (!wasOpen) return
        await $.ui.close({ id: PANE })
        await $.ui.close({ id: SETTINGS })
        await $.state.set({ plugin: 'mod-filetree', key: 'pane' }, false)
      })
    }

    return next(e)
  })

  // Observes only: the call is recorded before it runs (the tree shows it live) and its diff once it succeeds.
  on('tool.call', async ($, e, next) => {
    const plan = await planOf($, e as ToolEvent).catch(() => undefined)
    if (!plan) return next(e)

    await hydrate($)
    log = touch(log!, plan.path, plan.kind)
    await save($)

    const result = await next(e)
    const isFailed = typeof result === 'object' && result !== null && ('deny' in result || ('isError' in result && result.isError === true))
    if (plan.kind !== 'read' && !isFailed) {
      log = commit(log!, plan.path, plan.tool, plan.kind, plan.note, plan.lines)
      if (replayTurn === null) index = Math.max(0, stepsOfTurn(log, null).length - 1)
      await save($)
    }

    return result
  })

  on('turn.start', async ($, e, next) => {
    if (!e.agentId) {
      await hydrate($)
      log = { ...log!, turn: log!.turn + 1, working: true }
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
    await $.state.get({ plugin: 'mod-filetree', key: 'pane' })
    const shown = await isOpen($, PANE)
    const { group, row, rest, tip } = splitRow(await next(e))
    // Opening the pane from here queues nothing, so the entry stays live mid-turn.
    const entry = (
      <Box key="menu-pad-filetree">
        <Client key="menu-entry-filetree" module="./entry.tsx" height={1} props={{ id: 'filetree', label: 'Files', isOpen: shown, bg: PILL.primary, idle: THEME.pill }} />
      </Box>
    )

    return pillRow({ Box, Text }, look.nerd, [entry, ...group], row, [...toastCards({ Box, Client, Text }, toasts), ...rest], tipShown ? tipLine({ Box, Text }, 'Files: what Claude read and changed, with a replay of each edit') : tip)
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
    if (message.id === 'filetree') await togglePane($)
    if (message.id === 'tab-tree' || message.id === 'tab-replay') {
      mode = message.id === 'tab-tree' ? 'tree' : 'replay'
      note = ''
      $.ui.invalidate('ui.render')
    }
    if (message.id === 'replay-prev' || message.id === 'replay-next') {
      walk($, message.id === 'replay-prev' ? -1 : 1, stepsOfTurn(await hydrate($), replayTurn).length)
    }

    return next(e)
  })

  // The list reports clicks on a row's text: a folder folds, a file opens its diff.
  on('ui.message', { requestId: PANE }, async ($, e, next) => {
    const message = e.data as ListMessage
    if (message.type === 'select') {
      const current = await hydrate($)
      const row = rowsOf(current, collapsed, showReads)[message.index]
      if (row?.isDir) fold($, row.key)
      else if (row) await openDiff($, row.key)
    }

    return next(e)
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE && e.requestId !== SETTINGS) return next(e)

    const { Box, Button, Client, Text } = $.ui.resolve(e)
    const elements = { Box, Button, Text }

    if (e.requestId === SETTINGS) {
      const rows = (await $.config.list()).filter(row => row.key.startsWith('mod-filetree.'))
      // A saved change reloads this mod, which redraws the panel with the new value.
      const set = async (row: ConfigRow, value: ConfigValue) => {
        const result = await $.config.set({ key: row.key, value })
        note = 'deny' in result && result.deny ? `${MARK.warn} ${result.deny}` : `${MARK.ok} ${row.label} saved`
        $.ui.invalidate('ui.render')
      }
      const run = async (action: Action) => {
        const said = answer($, action.args ?? '')
        note = await said.then(text => `${MARK.ok} ${text || action.label}`).catch(error => `${MARK.warn} ${String(error)}`)
        $.ui.invalidate('ui.render')
      }
      return (
        <Box flexDirection="column" backgroundColor={THEME.bg} paddingX={1} minHeight={e.props.scroll.bodyRows}>
          {paneTitle(elements, look, 'settings', 'mod-filetree · settings')}
          <Text color={statusColor(note)}>{withMark(look, note) || `click a control to change it ${MARK.sep} saved at once, the mod reloads`}</Text>
          <Box marginTop={0}>{settingsBody(elements, look, { rows, actions, working: false, set, run, previews })}</Box>
        </Box>
      )
    }

    // Reading the log subscribes the pane to every tool call; a reload empties the copy, so it is read again.
    await $.state.get({ plugin: 'mod-filetree', key: 'log' })
    const current = await hydrate($)
    const rows = rowsOf(current, collapsed, showReads)
    const touched = rows.filter(row => !row.isDir).length
    const { glyph } = look

    // Tabs and the replay's steppers are entries: text that lights on hover, the active tab on its own surface.
    const entry = (id: string, label: string, isOn: boolean, bg: string = THEME.surface1) => (
      <Box key={`${id}-pad`}>
        <Client key={id} module="./entry.tsx" height={1} props={{ id, label, isOpen: isOn, bg }} />
      </Box>
    )
    const tab = (id: string, isActive: boolean, icon: string, label: string) => entry(id, withIcon(look, icon, label), isActive, isActive ? THEME.surface2 : THEME.bg)

    // The pane and the section each pad one column on both sides.
    const width = Math.max(20, e.props.bodyColumns - 4)
    const tree =
      rows.length === 0
        ? <Text key="tree-empty" color={THEME.muted}>No files touched yet. Reads and edits show up here as Claude works.</Text>
        : <Client key="list" module="./list.tsx" height={rows.length} props={{ rows: listRows(current, rows, look, width) }} />
    const root = rootOf(current, showReads)
    const rootName = root.split('/').pop() || String(await $.session.cwd().catch(() => '')).replace(/\\/g, '/').split('/').pop() || 'Files'

    const steps = stepsOfTurn(current, replayTurn)
    const at = Math.max(0, Math.min(index, steps.length - 1))
    const step = steps[at]
    const color = (op: Line['op']) => (op === '+' ? THEME.good : op === '-' ? THEME.alert : THEME.muted)
    const replay = !step
      ? <Text key="replay-empty" color={THEME.muted}>No edits yet. Each edit Claude makes in a turn can be stepped through here.</Text>
      : (
          <Box key="replay-body" flexDirection="column">
            {/* The steppers sit on top, so they stay put whatever the diff's length. */}
            <Box key="replay-nav" flexDirection="row" columnGap={1}>
              {entry('replay-prev', `${glyph.back} Prev`, at > 0)}
              <Text color={THEME.onSurface} bold>{`${at + 1} of ${steps.length}`}</Text>
              {entry('replay-next', `Next ${glyph.title}`, at < steps.length - 1)}
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
              {step.lines.length === 0 ? <Text color={THEME.muted}>(no line changes)</Text> : null}
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
        ? `click a file to replay its edit ${MARK.sep} click a folder to fold it${showReads ? '' : ` ${MARK.sep} reads hidden`}`
        : `Prev and Next step through this turn's edits ${MARK.sep} a file in the tree jumps here`

    return (
      <Box flexDirection="column" backgroundColor={THEME.bg} paddingX={1} minHeight={e.props.scroll.bodyRows}>
        {paneTitle(elements, look, 'files', `Files ${MARK.sep} ${touched}${current.working ? ` ${MARK.sep} working` : ''}`)}
        <Text color={statusColor(note)}>{withMark(look, note) || hint}</Text>
        <Box key="tabs" flexDirection="row" columnGap={1} marginTop={1}>
          {tab('tab-tree', mode === 'tree', 'files', 'Tree')}
          {tab('tab-replay', mode === 'replay', 'replay', 'Replay')}
        </Box>
        {mode === 'tree' ? section(elements, look, 'tree', 'folder-open', rootName, tree) : section(elements, look, 'replay', 'replay', `Turn ${MARK.sep} ${steps.length} ${steps.length === 1 ? 'edit' : 'edits'}`, replay)}
      </Box>
    )
  })
}
