// mod-progress / hooks/register.tsx, by v-amorim
// Registers the mod: wires the band pill, pane, settings, stop line and loop tracking.
import type { ConfigValue, EngineInterface, Register } from 'claude-code'

import { isTipMessage, tipText, type EntryMessage, type Tip, type TipMessage } from './entry'
import { detectNerd, FOOTER_ROWS, lookFor, paneFooter, section, withMark, type IconMode } from './look'
import { layoutLoops, type LoopsMessage, type LoopsProps } from './loops'
import { menuEntry, PILL, pillRow, splitRow, tabRow, tipLine } from './pills'
import { applyCall, applyStep, applyTask, bandSummary, buildRows, emptySnap, finishAgent, firstLine, gatesStemIn, isGatesPath, MAIN_GATES, parseGates, settle, stemOf, type AgentLite, type Gate, type Snap, type Usage, type UsageLite } from './progress'
import { stopLine, stopOf } from './stop'
import { settingChoice, settingsBody } from './settings'
import text from './text'
import { fill, MARK, mix, statusColor, THEME, WASH } from './theme'
import { TOAST_MS, ToastList, toastCards } from './toasts'

// The icons setting (userConfig), fixed per activation: a change reloads the mod.
let iconMode: IconMode = 'auto'
let look = lookFor(false)

// Nerd glyphs when the setting asks for them, or on auto when the terminal's font is a Nerd Font.
async function detectLook($: EngineInterface) {
  if (iconMode !== 'auto') return lookFor(iconMode === 'nerd')
  const env = {
    WT_SESSION: await $.env.get('WT_SESSION'),
    TERM_PROGRAM: await $.env.get('TERM_PROGRAM'),
    ITERM_PROFILE: await $.env.get('ITERM_PROFILE'),
    KITTY_WINDOW_ID: await $.env.get('KITTY_WINDOW_ID'),
    ALACRITTY_WINDOW_ID: await $.env.get('ALACRITTY_WINDOW_ID'),
    GNOME_TERMINAL_SCREEN: await $.env.get('GNOME_TERMINAL_SCREEN'),
    KONSOLE_VERSION: await $.env.get('KONSOLE_VERSION'),
  }
  const host = {
    localAppData: ((await $.env.get('LOCALAPPDATA')) ?? '').replace(/\\/g, '/'),
    home: ((await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '').replace(/\\/g, '/'),
    read: (path: string) => $.fs.read(path).then(String),
    run: async (argv: string[]) => {
      const result = await $.process.run(argv, { timeoutMs: 5000 })
      if (result.exitCode !== 0) throw new Error(result.stderr)
      return result.stdout
    },
  }
  return lookFor(await detectNerd(env, host))
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

const PANE = 'progress'
const SETTINGS = 'progress-settings'

let note = ''
// The control under the pointer, from its tip post: the band's tip row and the pane footer show it.
let hovered: TipMessage | null = null
const hoveredTip = (): Tip | null => (hovered?.id && hovered.label ? { glyph: hovered.glyph ?? '', label: hovered.label, text: hovered.text ?? '' } : null)
const toasts = new ToastList('progress')
// The animations setting, fixed per activation: off, every entry draws still.
let still = false

// The figures survive a reload in the store, under the session's id; this is only their cache.
let snap: Snap | null = null

async function loadSnap($: EngineInterface) {
  if (snap) return snap
  const sid = String(await $.session.id())
  let stored: Snap | undefined
  try {
    const raw = await $.store.get('snap')
    if (raw && typeof raw === 'object' && (raw as Snap).sid === sid) stored = JSON.parse(JSON.stringify(raw)) as Snap
  } catch {
    // An unreadable store starts the figures over.
  }
  snap = stored ?? emptySnap(sid)
  return snap
}

async function saveSnap($: EngineInterface) {
  try {
    await $.store.set('snap', JSON.parse(JSON.stringify(snap)))
  } catch {
    // The figures still draw from memory.
  }
}

// GATES.md and every gates/<name>.md make up the main ledger; gates/<name>.md also belongs to the agent of that name.
async function readGates($: EngineInterface, target: Snap) {
  const cwd = String(await $.session.cwd()).replace(/\\/g, '/')
  const found: Record<string, Gate[]> = {}
  const root = await $.fs.read(`${cwd}/GATES.md`).catch(() => null)
  if (root !== null) found[MAIN_GATES] = parseGates(String(root))
  for (const entry of await $.fs.list(`${cwd}/gates`).catch(() => [])) {
    if (entry.kind !== 'file' || !entry.name.toLowerCase().endsWith('.md')) continue
    const stem = stemOf(entry.name)
    found[stem] = parseGates(String(await $.fs.read(`${cwd}/gates/${entry.name}`).catch(() => ''))).map(gate => ({ ...gate, file: stem }))
  }
  const isChanged = JSON.stringify(found) !== JSON.stringify(target.gates)
  target.gates = found
  return isChanged
}

async function refreshGates($: EngineInterface) {
  const current = await loadSnap($)
  if (await readGates($, current)) await saveSnap($)
  $.ui.invalidate('ui.render')
}

// The rows both panes draw, from the engine's agent list and the session's own usage.
async function currentRows($: EngineInterface) {
  const current = await loadSnap($)
  const list = (await $.agent.list()) as AgentLite[]
  const now = await $.clock.now()
  const usage = await $.session.usage().catch(() => undefined)
  const figures: UsageLite | undefined = usage ? { window: usage.context.window, startedAt: usage.startedAt, ...(usage.context.percent === undefined ? {} : { percent: usage.context.percent }) } : undefined
  if (settle(current, list, now)) await saveSnap($)
  const model = await $.session.model().catch(() => undefined)
  return { current, rows: buildRows(current, list, figures, now, text.mainName, text.mainTask, model), now }
}

// The stop's "ago" would freeze between redraws, so while a stop shows a timer redraws it every minute.
const AGE_MS = 60000
let ageTimer: { cancel: () => void } | null = null
function ageStop($: EngineInterface, current: Snap) {
  ageTimer?.cancel()
  ageTimer = current.stop ? $.clock.every(AGE_MS, () => $.ui.invalidate('ui.render')) : null
}

const isOpen = async ($: EngineInterface, id = PANE) => (await $.ui.panes()).some(pane => pane.id === id && pane.isPlaced)

// The command and the bar entry both toggle. An unplaced pane is waiting, not open.
async function togglePane($: EngineInterface) {
  if (await isOpen($)) {
    await $.ui.close({ id: PANE })
    await $.state.set({ plugin: 'mod-progress', key: 'pane' }, false)
    return
  }
  if (await isOpen($, SETTINGS)) await $.ui.close({ id: SETTINGS })
  note = ''
  const opened = await $.ui.open({ id: PANE, title: text.paneTitle, closeOnEscape: true })
  if (!opened.isPlaced) $.ui.toast(fill(text.progressWaiting, { reason: opened.reason }))
  await $.state.set({ plugin: 'mod-progress', key: 'pane' }, opened.isPlaced)
}

// `/mod-progress settings` and the title row's pill toggle the settings panel, which takes the sidebar's place.
async function toggleSettings($: EngineInterface) {
  if (await isOpen($, SETTINGS)) {
    await $.ui.close({ id: SETTINGS })
    await $.state.set({ plugin: 'mod-progress', key: 'pane' }, false)
    return
  }
  if (await isOpen($)) await $.ui.close({ id: PANE })
  note = ''
  const opened = await $.ui.open({ id: SETTINGS, title: text.settingsPaneTitle, closeOnEscape: true })
  if (!opened.isPlaced) $.ui.toast(fill(text.settingsWaiting, { reason: opened.reason }))
  await $.state.set({ plugin: 'mod-progress', key: 'pane' }, opened.isPlaced)
}

// A saved change reloads this mod, which redraws the panel with the new value.
async function saveSetting($: EngineInterface, key: string, value: ConfigValue) {
  const row = (await $.config.list()).find(each => each.key === key)
  const result = await $.config.set({ key, value })
  note = 'deny' in result && result.deny ? `${MARK.warn} ${result.deny}` : `${MARK.ok} ${fill(text.settingSaved, { label: row?.label ?? key })}`
  $.ui.invalidate('ui.render')
}

const agentIcon = () => look.glyph.icon.Agent ?? look.glyph.mark.agent ?? look.glyph.title

// The panel's title line: the list and the settings as tabs, the shown one open.
const tabs = (open: 'list' | 'settings', count: number) => [
  { id: 'progress-tab', label: text.paneTitle, icon: agentIcon(), isOpen: open === 'list', count, tip: { glyph: agentIcon(), label: text.paneTitle, text: text.tipTabList } },
  { id: 'progress-settings', label: text.settingsTab, icon: look.glyph.gear, isOpen: open === 'settings', tip: { glyph: look.glyph.gear, label: text.settingsTab, text: text.tipTabSettings } },
]

export const register: Register = (on, options) => {
  still = options.animations === false
  iconMode = (options.icons as IconMode | undefined) ?? 'auto'
  // A forced mode needs no detection; auto loads the saved answer, then checks the terminal font beside the hooks.
  look = lookFor(iconMode === 'nerd')
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

  on('session.start', async ($, e, next) => {
    await loadLook($)
    await $.command.register({ name: 'mod-progress', description: text.commandDescription, argumentHint: '[settings]' })
    const current = await loadSnap($)
    const usage = await $.session.usage().catch(() => undefined)
    if (current.startedAt === undefined) current.startedAt = usage?.startedAt ?? (await $.clock.now())
    await readGates($, current)
    ageStop($, current)
    await saveSnap($)
    // The bar entry reads this; an unload drops the pane without raising ui.close here.
    await $.state.set({ plugin: 'mod-progress', key: 'pane' }, await isOpen($))
    // A hot reload leaves an open pane on its old drawing until something redraws it.
    $.ui.invalidate('ui.render')

    return next(e)
  })

  on('command.run', { command: 'mod-progress' }, async ($, e) => {
    if ((e.args ?? '').trim() === 'settings') await toggleSettings($)
    else await togglePane($)

    return { text: '' }
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE || e.id === SETTINGS) await $.state.set({ plugin: 'mod-progress', key: 'pane' }, await isOpen($, e.id === PANE ? SETTINGS : PANE))

    return next(e)
  })

  // One panel at a time: another mod's pane opening closes this one.
  on('state.set', async ($, e, next) => {
    // The declared state names no other mod's pane, so the types narrow this event to never.
    // Deferred past this dispatch, so this mod's own state write is not nested in another plugin's.
    if (e.key === 'pane' && e.plugin !== 'mod-progress' && (e as { value?: unknown }).value === true) {
      $.clock.after(0, async () => {
        const wasOpen = (await isOpen($)) || (await isOpen($, SETTINGS))
        if (!wasOpen) return
        await $.ui.close({ id: PANE })
        await $.ui.close({ id: SETTINGS })
        await $.state.set({ plugin: 'mod-progress', key: 'pane' }, false)
      })
    }

    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const result = await next(e)
    if ('agentId' in result) {
      const current = await loadSnap($)
      current.agents[result.agentId!] = {
        model: result.model,
        tokens: 0,
        context: 0,
        spawnedAt: await $.clock.now(),
        gatesStem: gatesStemIn(e.prompt),
        ...(e.workflow ? { workflow: { runId: e.workflow.runId, index: e.workflow.agentIndex, name: e.name ?? fill(text.workflowAgent, { n: e.workflow.agentIndex }), description: firstLine(e.description ?? e.prompt) } } : {}),
      }
      await saveSnap($)
      $.ui.invalidate('ui.render')
    }
    return result
  })

  on('turn.start', async ($, e, next) => {
    if (!(e as { agentId?: string }).agentId) {
      const current = await loadSnap($)
      current.busy = true
      delete current.stop
      ageStop($, current)
      await saveSnap($)
      $.ui.invalidate('ui.render')
    }
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    const current = await loadSnap($)
    applyStep(current, e.agentId, e.model, e.effort, (result as { usage?: Usage | null }).usage)
    await saveSnap($)
    $.ui.invalidate('ui.render')
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const current = await loadSnap($)
    if (!(e as { agentId?: string }).agentId) {
      current.busy = false
      delete current.main.step
    }
    const now = await $.clock.now()
    // A workflow agent is in no list, so its own turn ending is the only sign it is over.
    if (e.agentId) finishAgent(current, e.agentId, now, e.reason !== 'answer')
    settle(current, (await $.agent.list()) as AgentLite[], now)
    await readGates($, current)
    await saveSnap($)
    $.ui.invalidate('ui.render')
    return next(e)
  })

  // The main turn ended on an API error. A subagent's failure is its own turn, so it leaves the main line alone.
  on('classic.StopFailure', async ($, e, next) => {
    if (e.agent_id) {
      const current = await loadSnap($)
      if (finishAgent(current, e.agent_id, await $.clock.now(), true)) {
        await saveSnap($)
        $.ui.invalidate('ui.render')
      }
    } else {
      const current = await loadSnap($)
      const usage = await $.session.usage().catch(() => undefined)
      current.stop = stopOf(e.error, await $.clock.now(), usage?.rateLimits ?? [])
      ageStop($, current)
      await saveSnap($)
      $.ui.invalidate('ui.render')
    }
    return next(e)
  })

  // Tasks come from each loop's own TaskCreate and TaskUpdate; gates files change through Write, Edit or the gate checker run by Bash.
  on('tool.call', async ($, e, next) => {
    // The step is set before the call runs, so the head row shows what the tool is doing while it works.
    try {
      const current = await loadSnap($)
      applyCall(current, e.agentId, String(e.tool), { ...e })
      await saveSnap($)
      $.ui.invalidate('ui.render')
    } catch {
      // The figures stay as they were.
    }
    const result = await next(e)
    // The observers never fail the call they watch.
    try {
      const input: Record<string, unknown> = { ...e }
      const tool = String(e.tool)
      const current = await loadSnap($)
      const owner = e.agentId ? current.agents[e.agentId] : current
      if (owner && (tool === 'TaskCreate' || tool === 'TaskUpdate')) {
        applyTask(owner, tool, input, (result as { result?: { task?: { id?: string } } }).result?.task?.id)
        await saveSnap($)
        $.ui.invalidate('ui.render')
      }
      const touchesGates = /^(Write|Edit|MultiEdit)$/.test(tool) ? isGatesPath(String(input.file_path ?? '')) : tool === 'Bash' && /gate/i.test(String(input.command ?? ''))
      if (touchesGates) await refreshGates($)
    } catch {
      // The figures stay as they were.
    }
    return result
  })

  // The bar entry lives here, not in mod-menu: only a press in this mod counts as the person asking for this pane.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    await loadLook($)
    const hidden = await $.state.get({ plugin: 'mod-menu', key: 'hidden' })
    if (e.surface !== 'terminal' || e.props.hasSurvey) return next(e)
    if (hidden.value === true) {
      if (toasts.items.length === 0) return next(e)
      const { Box, Client, Text } = $.ui.resolve(e)
      return <Box key="toasts-progress" flexDirection="column">{toastCards({ Box, Client, Text }, toasts, look, text.tipToast)}{await next(e)}</Box>
    }
    const nerd = look.nerd

    const { Box, Client, Text } = $.ui.resolve(e)
    // Reading the value subscribes the bar to redraws; the look trusts the pane list itself.
    await $.state.get({ plugin: 'mod-progress', key: 'pane' })
    const shown = await isOpen($)
    const { current, rows, now } = await currentRows($)
    const summary = bandSummary(rows)
    const stop = stopLine(current.stop, now)
    const { group, row, rest, tip } = splitRow(await next(e))
    const badge = summary.count > 0 ? { badge: { text: String(summary.count), color: THEME.accent, bg: mix(THEME.accent, shown ? THEME.lifted : PILL.primary, WASH) } } : {}
    const pillTip = stop?.line ?? (summary.total > 0 ? fill(text.tipPillGates, summary) : text.tipPill)
    const entry = menuEntry({ Box, Client, Text }, nerd, 'progress', { label: text.pillLabel, isOpen: shown, idle: THEME.pill, still, nerd, tip: { glyph: look.glyph.icon.Agent ?? look.glyph.mark.agent ?? look.glyph.title, label: text.pillLabel, text: pillTip }, ...badge })
    // A pill tip is posted once on enter, so its text is redrawn from the figures here, the minute the stop's age ticks.
    const shownTip = hovered?.id === 'progress' ? { ...hovered, text: pillTip } : hovered

    return pillRow({ Box, Client, Text }, nerd, [entry, ...group], row, [...toastCards({ Box, Client, Text }, toasts, look, text.tipToast), ...rest], shownTip?.id ? tipLine({ Box, Text }, tipText(shownTip)) : tip, e.props.bodyColumns)
  })

  on('ui.message', async ($, e, next) => {
    if (isTipMessage(e.data)) {
      hovered = e.data
      $.ui.invalidate('ui.render')
      return next(e)
    }
    const clicked = e.data as EntryMessage
    const dismissed = clicked?.type === 'menu-entry' ? toasts.idOf(clicked.id) : undefined
    if (dismissed !== undefined) {
      toasts.drop(dismissed)
      $.ui.invalidate('ui.render')
      return next(e)
    }
    if (clicked?.type === 'menu-entry' && clicked.id === 'progress') await togglePane($)
    // The title line's tabs swap the list and the settings; the open tab does nothing.
    if (clicked?.type === 'menu-entry' && clicked.id === 'progress-settings' && !(await isOpen($, SETTINGS))) await toggleSettings($)
    if (clicked?.type === 'menu-entry' && clicked.id === 'progress-tab' && !(await isOpen($))) await togglePane($)
    const change = settingChoice(e.data)
    if (change) await saveSetting($, change.key, change.value)

    return next(e)
  })

  // A click on a card opens its gates under it, a second click closes them.
  on('ui.message', { requestId: 'progress' }, async ($, e, next) => {
    const message = e.data as LoopsMessage
    if (message?.type === 'toggle') {
      const current = await loadSnap($)
      current.expanded = current.expanded === message.id ? '' : message.id
      await saveSnap($)
      $.ui.invalidate('ui.render')
    }

    return next(e)
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    await loadLook($)
    if (e.requestId !== PANE && e.requestId !== SETTINGS) return next(e)

    // @ts-expect-error The host's types omit Client from a Pane's elements, yet a Pane draws it.
    const { Box, Button, Client, Text } = $.ui.resolve(e)

    if (e.requestId === SETTINGS) {
      const settingRows = (await $.config.list()).filter(row => row.key.startsWith('mod-progress.'))
      const { rows } = await currentRows($)
      return (
        <Box flexDirection="column" paddingX={1} minHeight={e.props.scroll.bodyRows}>
          {tabRow({ Box, Client, Text }, look.nerd, tabs('settings', rows.length - 1), still)}
          <Text wrap="truncate-end" color={statusColor(note)}>{withMark(look, note) || fill(text.settingsHint, { sep: MARK.sep })}</Text>
          <Box marginTop={0}>{settingsBody({ Box, Button, Client, Text }, look, { rows: settingRows, actions: [], working: false, run: async () => {}, still })}</Box>
          <Box key="footer-space" height={FOOTER_ROWS} />
          {paneFooter({ Box, Text }, hoveredTip(), e.props.bodyColumns, e.props.scroll)}
        </Box>
      )
    }

    const { current, rows, now } = await currentRows($)
    const stop = stopLine(current.stop, now)
    // Pane padding, then the section's border and padding.
    const width = e.props.bodyColumns - 2 - 4
    const props = JSON.parse(JSON.stringify({ rows, width, expanded: current.expanded, nerd: look.nerd, viewing: e.props.view.agentId ?? '' })) as LoopsProps

    return (
      <Box flexDirection="column" paddingX={1} minHeight={e.props.scroll.bodyRows}>
        {tabRow({ Box, Client, Text }, look.nerd, tabs('list', rows.length - 1), still)}
        <Text wrap="truncate-end" color={statusColor(note)}>{withMark(look, note) || text.hint}</Text>
        {/* A blank row of the same height while no stop shows, so the list below does not move when one appears. */}
        <Text key="stop-line" wrap="truncate-end" color={stop?.tone === 'alert' ? THEME.alert : THEME.warn}>{stop ? withMark(look, `${MARK.warn} ${stop.line}`) : ' '}</Text>
        {section({ Box, Text }, look, 'loops', '', '', (
          <Client key="loops" module="./loops.tsx" height={layoutLoops(rows, current.expanded).length} props={props} />
        ))}
        {rows.length === 1 ? <Text color={THEME.muted}>{text.noAgents}</Text> : null}
        <Box key="footer-space" height={FOOTER_ROWS} />
        {paneFooter({ Box, Text }, hoveredTip(), e.props.bodyColumns, e.props.scroll)}
      </Box>
    )
  })
}
