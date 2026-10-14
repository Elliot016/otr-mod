// mod-progress / hooks/register.tsx, by v-amorim
// Registers the mod: wires the band pill, pane, settings, stop line and loop tracking.
import type { ConfigValue, EngineInterface, Register } from 'claude-code'

import { isTipMessage, tipText, type EntryMessage, type Tip, type TipMessage } from './entry'
import { detectNerd, FOOTER_ROWS, lookFor, paneFooter, section, withMark, type IconMode } from './look'
import { layoutLoops, type LoopsMessage, type LoopsProps } from './loops'
import { menuEntry, PILL, pillRow, splitRow, tabRow, tipLine } from './pills'
import { addBg, appendTail, applyCall, applyStep, applyTask, bandSummary, bgIdOf, bgOutputOf, bgStartOf, buildRows, emptySnap, endBg, endOfStatus, finishAgent, findBg, firstLine, gatesStemIn, hasRunningBg, isGatesPath, MAIN_GATES, outputRoom, pageOf, parseGates, resyncBg, settle, stemOf, TAIL_LINES, wipeBg, type AgentLite, type BgTask, type Gate, type Snap, type Tail, type Usage, type UsageLite } from './progress'
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
// The control under the pointer, from its tip post: the band's tip row shows a band control's, the pane footer a pane control's.
let bandTip: TipMessage | null = null
let paneTip: TipMessage | null = null
const hoveredTip = (): Tip | null => (paneTip?.id && paneTip.label ? { glyph: paneTip.glyph ?? '', label: paneTip.label, text: paneTip.text ?? '' } : null)
const toasts = new ToastList('progress')
// The animations setting, fixed per activation: off, every entry draws still.
let still = false

// The figures survive a reload in the store, under the session's id; this is only their cache.
let snap: Snap | null = null
// The load in flight, shared, so two hooks never build two snaps and save over each other's changes.
let snapLoad: Promise<Snap> | null = null

// A /resume or /clear keeps the process and changes the id; asking it on every call would cost a round trip per render, so calls ask after a session.end, or once this long has passed.
const SESSION_CHECK_MS = 500
let sessionCheckedAt = 0

async function loadSnap($: EngineInterface) {
  const now = Date.now()
  if (snap && now - sessionCheckedAt < SESSION_CHECK_MS) return snap
  sessionCheckedAt = now
  const sid = String(await $.session.id())
  if (snap?.sid === sid) return snap
  // No session.start follows a /clear, so a snap replacing another session's takes its start time here.
  const isSwitch = snap !== null
  snapLoad ??= (async () => {
    let stored: Snap | undefined
    try {
      const raw = await $.store.get('snap')
      if (raw && typeof raw === 'object' && (raw as Snap).sid === sid) stored = JSON.parse(JSON.stringify(raw)) as Snap
    } catch {
      // An unreadable store starts the figures over.
    }
    snap = stored ?? (isSwitch ? { ...emptySnap(sid), startedAt: await $.clock.now() } : emptySnap(sid))
    // A /clear keeps the process, so the shells and monitors it started still run: the session that ended left them in the store.
    const carried = isSwitch && !stored ? await $.store.get('carry-bg').catch(() => undefined) : undefined
    if (Array.isArray(carried)) {
      snap.main.bg = JSON.parse(JSON.stringify(carried)) as BgTask[]
      await $.store.set('carry-bg', null).catch(() => undefined)
      await $.state.set(BOOT_KEY, true).catch(() => undefined)
    }
    return snap
  })().finally(() => {
    snapLoad = null
  })
  return snapLoad
}

async function saveSnap($: EngineInterface) {
  try {
    await $.store.set('snap', JSON.parse(JSON.stringify(snap)))
  } catch {
    // The figures still draw from memory.
  }
}

// The folder found for a session, kept so later refreshes skip the search.
let foundGates = { session: '', dir: '' }

// The execute skill's folder for this session, as its gates-dir.mjs resolves it: ~/.claude/gates/<repo>/<session id>.
async function gatesDir($: EngineInterface) {
  const session = String(await $.session.id())
  if (foundGates.session === session) return foundGates.dir
  const home = ((await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '').replace(/\\/g, '/')
  const base = ((await $.env.get('GATES_HOME')) ?? `${home}/.claude/gates`).replace(/\\/g, '/')
  const where = ((await $.session.repo())?.root ?? String(await $.session.cwd())).replace(/\\/g, '/').replace(/\/+$/, '')
  const own = `${base}/${where.split('/').pop()}/${session}`
  const exists = (dir: string) => $.fs.exists(dir).catch(() => false)
  // The checker names the repo its shell is in, which drifts once the agent cds; a session id is unique, so any repo folder holding it is this session's.
  const others = async () => (await $.fs.list(base).catch(() => [])).filter(entry => entry.kind === 'dir').map(entry => `${base}/${entry.name}/${session}`)
  for (const dir of (await exists(own)) ? [own] : await others()) {
    if (!(await exists(dir))) continue
    foundGates = { session, dir }
    return dir
  }
  return own
}

// GATES.md and every gates/<name>.md make up the main ledger; gates/<name>.md also belongs to the agent of that name.
async function readGates($: EngineInterface, target: Snap) {
  const dir = await gatesDir($)
  const found: Record<string, Gate[]> = {}
  const root = await $.fs.read(`${dir}/GATES.md`).catch(() => null)
  if (root !== null) found[MAIN_GATES] = parseGates(String(root))
  for (const entry of await $.fs.list(`${dir}/gates`).catch(() => [])) {
    if (entry.kind !== 'file' || !entry.name.toLowerCase().endsWith('.md')) continue
    const stem = stemOf(entry.name)
    found[stem] = parseGates(String(await $.fs.read(`${dir}/gates/${entry.name}`).catch(() => ''))).map(gate => ({ ...gate, file: stem }))
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

// A running background task's clock keeps its seconds, so while one runs and the pane is open a timer redraws it every second.
const TASK_TICK_MS = 1000
let taskTimer: { cancel: () => void } | null = null
function tickTasks($: EngineInterface, current: Snap) {
  if (!hasRunningBg(current)) {
    taskTimer?.cancel()
    taskTimer = null
    return
  }
  taskTimer ??= $.clock.every(TASK_TICK_MS, async () => {
    if (snap && !hasRunningBg(snap)) return tickTasks($, snap)
    if (await isOpen($)) $.ui.invalidate('ui.render')
  })
}

async function saveBackground($: EngineInterface, current: Snap) {
  tickTasks($, current)
  // A /clear resets $.state: a task still running proves the process is the same one.
  await $.state.set(BOOT_KEY, true)
  await saveSnap($)
  await syncOutput($)
  $.ui.invalidate('ui.render')
}

// The task whose page is open, kept in $.state so a reload keeps it; empty is the list.
const BOOT_KEY = { plugin: 'mod-progress', key: 'booted' } as const
const TASK_KEY = { plugin: 'mod-progress', key: 'task' } as const
const openTask = async ($: EngineInterface) => String((await $.state.get(TASK_KEY)).value ?? '')

// What each task's output holds, read from its file; a reload reads it again from the start.
const tails = new Map<string, Tail>()
const unreadable = new Set<string>()
const finalRead = new Set<string>()
const OUTPUT_TICK_MS = 1000
// fs.read takes a file up to this size.
const WHOLE_READ_BYTES = 4 * 1024 * 1024
let outputTimer: { cancel: () => void } | null = null

// Reads what the file gained since the last read (the file's size says whether it grew); true when the tail changed.
async function pumpOutput($: EngineInterface, id: string, path: string) {
  let tail = tails.get(id) ?? { from: 0, lines: [], partial: '' }
  const size = (await $.fs.stat(path).catch(() => null))?.size
  if (size === undefined) return false
  if (size < tail.from) tail = { from: 0, lines: [], partial: '' }
  if (size === tail.from) return false
  if (size > WHOLE_READ_BYTES) {
    unreadable.add(id)
    return false
  }
  const whole = await $.fs.read(path).then(String, () => null)
  if (whole === null) return false
  const bytes = new TextEncoder().encode(whole)
  tails.set(id, appendTail(tail, new TextDecoder().decode(bytes.subarray(tail.from)), bytes.length))
  return true
}

// While a task's page is open and the task runs, its output is read every second; once it ends, one last read, then the timer stops.
async function syncOutput($: EngineInterface) {
  try {
    const id = await openTask($)
    const task = id ? findBg(await loadSnap($), id) : undefined
    if (id && !task) await $.state.set(TASK_KEY, '')
    if (!task || !(await isOpen($))) {
      outputTimer?.cancel()
      outputTimer = null
      return
    }
    const isRunning = task.endedAt === undefined
    if (isRunning) outputTimer ??= $.clock.every(OUTPUT_TICK_MS, () => syncOutput($))
    else {
      outputTimer?.cancel()
      outputTimer = null
    }
    const isFinal = !isRunning && !finalRead.has(id)
    if (!isRunning) finalRead.add(id)
    const isChanged = task.output && (isRunning || isFinal) ? await pumpOutput($, id, task.output) : false
    if (isChanged || isRunning) $.ui.invalidate('ui.render')
  } catch {
    // The page keeps what it has read.
  }
}

// A background Bash or Monitor adds a task once its result names the id; TaskStop and KillShell end one.
async function watchBackground($: EngineInterface, agentId: string | undefined, tool: string, input: Record<string, unknown>, result: unknown, calledAt: number) {
  const refused = (result as { deny?: string; isError?: boolean } | undefined)?.deny || (result as { isError?: boolean } | undefined)?.isError
  if (refused) return
  const current = await loadSnap($)
  const now = await $.clock.now()
  const isMoved = tool === 'Bash' && typeof (result as { result?: { backgroundTaskId?: unknown } } | undefined)?.result?.backgroundTaskId === 'string'
  const start = bgStartOf(tool, input, isMoved)
  const id = start ? bgIdOf(result) : undefined
  const output = start?.kind === 'shell' ? bgOutputOf(String((result as { text?: unknown }).text ?? '')) : undefined
  if (start && id && addBg(current, agentId, id, { ...start, ...(output ? { output } : {}) }, calledAt)) await saveBackground($, current)
  if (tool === 'TaskStop' || tool === 'KillShell') {
    const stopped = String(input.task_id ?? input.shell_id ?? input.taskId ?? input.id ?? '')
    if (stopped && endBg(current, stopped, 'failed', now)) await saveBackground($, current)
  }
}

async function resync($: EngineInterface, agentId: string | undefined, listed: { id: string; status: string }[] | undefined) {
  if (!listed) return
  try {
    const current = await loadSnap($)
    if (resyncBg(current, agentId, listed, await $.clock.now())) await saveBackground($, current)
  } catch {
    // The figures stay as they were.
  }
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
    // A plugin reload re-runs this hook in the same process, with a fresh module; $.state is the host's and dies with the process, so an unset marker means a new process, whose shells are gone.
    if (!(await $.state.get(BOOT_KEY)).value) wipeBg(current)
    await $.state.set(BOOT_KEY, true)
    const usage = await $.session.usage().catch(() => undefined)
    if (current.startedAt === undefined) current.startedAt = usage?.startedAt ?? (await $.clock.now())
    await readGates($, current)
    ageStop($, current)
    tickTasks($, current)
    await saveSnap($)
    await syncOutput($)
    // The bar entry reads this; an unload drops the pane without raising ui.close here.
    await $.state.set({ plugin: 'mod-progress', key: 'pane' }, await isOpen($))
    // A hot reload leaves an open pane on its old drawing until something redraws it.
    $.ui.invalidate('ui.render')

    return next(e)
  })

  // A /resume or /clear ends this session; the next call asks for the id at once.
  on('session.end', async ($, e, next) => {
    sessionCheckedAt = 0
    try {
      // A /clear leaves the shells running in the same process; any other end takes them with it.
      if (snap && e.reason === 'clear') await $.store.set('carry-bg', JSON.parse(JSON.stringify((snap.main.bg ?? []).filter(task => task.endedAt === undefined))))
      else if (snap && wipeBg(snap)) await saveBackground($, snap)
    } catch {
      // The figures stay as they were.
    }

    return next(e)
  })

  on('command.run', { command: 'mod-progress' }, async ($, e) => {
    if ((e.args ?? '').trim() === 'settings') await toggleSettings($)
    else await togglePane($)

    return { text: '' }
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE || e.id === SETTINGS) await $.state.set({ plugin: 'mod-progress', key: 'pane' }, await isOpen($, e.id === PANE ? SETTINGS : PANE))
    if (e.id === PANE || e.id === SETTINGS) paneTip = null
    if (e.id === PANE) await syncOutput($)

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
    const calledAt = await $.clock.now()
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
      await watchBackground($, e.agentId, tool, input, result, calledAt)
    } catch {
      // The figures stay as they were.
    }
    return result
  })

  // The main turn's Stop lists the background work still running; whatever it no longer lists has finished.
  on('classic.Stop', async ($, e, next) => {
    await resync($, undefined, e.background_tasks)
    return next(e)
  })

  on('classic.SubagentStop', async ($, e, next) => {
    await resync($, e.agent_id, e.background_tasks)
    return next(e)
  })

  // A task's notification reaches the session as a prompt of its own, whether or not anything draws it.
  on('prompt.submit', async ($, e, next) => {
    try {
      if (e.origin?.kind === 'task-notification') {
        const id = /<task-id>\s*([^<\s]+)\s*<\/task-id>/.exec(e.text)?.[1]
        const status = /<status>\s*([^<\s]+)\s*<\/status>/.exec(e.text)?.[1]
        const current = await loadSnap($)
        // The closing notice names the output file, which a monitor's start did not.
        const known = id ? findBg(current, id) : undefined
        const file = bgOutputOf(e.text)
        if (known && file && !known.output) known.output = file
        // A monitor's event rows carry no status; only the closing notice does.
        if (id && status && endBg(current, id, endOfStatus(status), await $.clock.now())) await saveBackground($, current)
      }
    } catch {
      // The figures stay as they were.
    }
    return next(e)
  })

  // A task stopped from /tasks reaches no tool call, no Stop and no prompt hook; its notification row is drawn, and that carries the status.
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    const task = (e.props as { task?: { id?: string; status?: string } }).task
    if (task?.id && task.status) {
      const { id, status } = task
      $.clock.after(0, async () => {
        const current = await loadSnap($)
        if (endBg(current, id, endOfStatus(status), await $.clock.now())) await saveBackground($, current)
      })
    }
    return next(e)
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
    const shownTip = bandTip?.id === 'progress' ? { ...bandTip, text: pillTip } : bandTip

    return pillRow({ Box, Client, Text }, nerd, [entry, ...group], row, [...toastCards({ Box, Client, Text }, toasts, look, text.tipToast), ...rest], shownTip?.id ? tipLine({ Box, Text }, tipText(shownTip)) : tip, e.props.bodyColumns)
  })

  on('ui.message', async ($, e, next) => {
    if (isTipMessage(e.data)) {
      // The band's own controls are the pill and its toasts; every other id is a pane control. An empty id clears both.
      const isBand = e.data.id === 'progress' || (e.data.id ? toasts.idOf(e.data.id) !== undefined : false)
      if (!e.data.id) {
        bandTip = null
        paneTip = null
      } else if (isBand) bandTip = e.data
      else paneTip = e.data
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
    if (clicked?.type === 'menu-entry' && clicked.id === 'progress-back') {
      await $.state.set(TASK_KEY, '')
      await syncOutput($)
      $.ui.invalidate('ui.render')
    }
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
    if (message?.type === 'task') {
      await $.state.set(TASK_KEY, message.id)
      await syncOutput($)
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
          {tabRow({ Box, Client, Text }, look.nerd, tabs('settings', bandSummary(rows).count), still)}
          <Text wrap="truncate-end" color={statusColor(note)}>{withMark(look, note) || fill(text.settingsHint, { sep: MARK.sep })}</Text>
          <Box marginTop={0}>{settingsBody({ Box, Button, Client, Text }, look, { rows: settingRows, actions: [], working: false, run: async () => {}, still })}</Box>
          <Box key="footer-space" height={FOOTER_ROWS} />
          {paneFooter({ Box, Text }, hoveredTip(), e.props.bodyColumns, e.props.scroll)}
        </Box>
      )
    }

    const pageId = await openTask($)
    if (pageId) {
      const page = pageOf(await loadSnap($), pageId, await $.clock.now())
      if (page) {
        const tail = tails.get(pageId)
        // Only as many of the held lines as the pane has room for, so the last one is never cut by the pane's edge.
        const room = Math.min(TAIL_LINES, outputRoom(e.props.scroll.bodyRows, e.props.bodyColumns, page.command, text.commandLead, FOOTER_ROWS))
        const shown = tail ? [...tail.lines, ...(tail.partial ? [tail.partial] : [])].slice(-room) : []
        const status = fill(text.taskStatus, { kind: page.kind === 'shell' ? text.taskShell : text.taskMonitor, sep: MARK.sep, status: page.status === 'running' ? text.taskRunning : page.status === 'done' ? text.taskDone : text.taskFailed, elapsed: page.elapsed })
        const back = [{ id: 'progress-back', label: text.paneTitle, icon: look.glyph.back, isOpen: false, tip: { glyph: look.glyph.back, label: text.paneTitle, text: text.tipBack } }]
        const empty = !page.output ? text.noOutputFile : unreadable.has(pageId) ? text.outputUnreadable : text.noOutputYet
        return (
          <Box flexDirection="column" paddingX={1} minHeight={e.props.scroll.bodyRows}>
            <Box key="task-head" flexDirection="row" columnGap={1}>
              {tabRow({ Box, Client, Text }, look.nerd, back, still)}
              <Text wrap="truncate-end" color={THEME.muted}>{status}</Text>
            </Box>
            {section({ Box, Text }, look, 'task-command', '', '', (
              <Box key="task-command-lines" flexDirection="column">
                {page.command.split(/\r?\n/).map((line, at) => (
                  <Text key={`command-${at}`} wrap="wrap" color={THEME.onSurface}>{`${at === 0 ? text.commandLead : ' '} ${line}`}</Text>
                ))}
              </Box>
            ))}
            {section({ Box, Text }, look, 'task-output', '', '', (
              <Box key="task-output-lines" flexDirection="column">
                {shown.length === 0 ? <Text key="output-empty" color={THEME.muted}>{empty}</Text> : shown.map((line, at) => <Text key={`output-${at}`} wrap="truncate-end" color={THEME.muted}>{line || ' '}</Text>)}
              </Box>
            ))}
            <Box key="footer-space" height={FOOTER_ROWS} />
            {paneFooter({ Box, Text }, hoveredTip(), e.props.bodyColumns, e.props.scroll)}
          </Box>
        )
      }
      $.clock.after(0, () => $.state.set(TASK_KEY, ''))
    }

    const { current, rows, now } = await currentRows($)
    const stop = stopLine(current.stop, now)
    // Pane padding, then the section's border and padding.
    const width = e.props.bodyColumns - 2 - 4
    const props = JSON.parse(JSON.stringify({ rows, width, expanded: current.expanded, nerd: look.nerd, viewing: e.props.view.agentId ?? '' })) as LoopsProps

    return (
      <Box flexDirection="column" paddingX={1} minHeight={e.props.scroll.bodyRows}>
        {tabRow({ Box, Client, Text }, look.nerd, tabs('list', bandSummary(rows).count), still)}
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
