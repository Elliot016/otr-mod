// mod-blast-radius / hooks/register.tsx, by v-amorim
// Wires the mod into the engine: holds risky Bash commands, draws the card, pane and settings.
import type { ConfigValue, EngineInterface, Register, RenderElement } from 'claude-code'

import { detectNerd, FOOTER_ROWS, lookFor, paneFooter, section, type IconMode, type Look } from './look'
import { isTipMessage, tipText, type EntryMessage, type Tip, type TipMessage } from './entry'
import { pill, pillRow, splitRow, tabRow, tipLine } from './pills'
import { TOAST_MS, ToastList, toastCards } from './toasts'
import { ACTION_EXTRA, ACTION_GAP, actionLabels, cardRows, HOTKEY, plainFor, segmentsOf, stepsView, whyOf, type Plain } from './explain'
import { describePrompt, parseDescribed, SYSTEM, verdictOf, type Described } from './haiku'
import { colorLines, colorStep, LEGEND, wrapSpans, type Role, type Span } from './syntax'
import { measure, tilde, type Io, type Report } from './preview'
import { CHECKS, compileRules, evaluate, type Risk, type UserRule } from './risk'
import { settingChoice, settingsBody, type Action, type Previews } from './settings'
import text from './text'
import { fill, MARK, mix, statusColor, SYNTAX, THEME, WASH } from './theme'

const SETTINGS_PANE = 'blast-radius-settings'
const LIST_PANE = 'blast-radius-list'
const DETAILS_TAB = 'mod-blast-radius-details-tab'
const SETTINGS_TAB = 'mod-blast-radius-settings-tab'
const RULES_FILE = '.claude/mods-data/mod-blast-radius/rules.json'
const DESTRUCTIVE_ASK = 'Destructive operation detected'
const BUILT_IN = [...new Set(CHECKS.map(check => check.reason))]

type Unit = { one: string; many: string }
const plural = (count: number, unit: Unit) => fill(count === 1 ? unit.one : unit.many, { n: count })

type Decision = 'run' | 'cancel' | 'interrupted' | 'error'
// isDescribing: Haiku is still writing the card's words.
type Held = { command: string; risk: Risk; report: Report | null; plain: Plain | null; decision: Decision | null; described?: Described; isDescribing?: boolean }

// The person's settings (userConfig), fixed per activation: a change reloads the mod.
let isEnabled = true
let iconMode: IconMode = 'auto'
let look: Look = lookFor(false)

// One hold at a time: Bash calls in a turn run in order, but a subagent's can overlap.
let held: Held | null = null
let note = ''
let working = false
// The control under the pointer, from its tip post: the card's tip row and the Details footer show it.
let hovered: TipMessage | null = null

const hoveredTip = (): Tip | null => (hovered?.id && hovered.label ? { glyph: hovered.glyph ?? '', label: hovered.label, text: hovered.text ?? '' } : null)
let actions: Action[] = []
let previews: Previews | undefined

const ioOf = ($: EngineInterface): Io => ({
  cwd: () => $.session.cwd(),
  home: async () => (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '',
  run: (argv, cwd) => $.process.run(argv[0] === 'git' ? ['git', '--no-optional-locks', ...argv.slice(1)] : argv, { cwd, timeoutMs: 15000 }),
  list: path => $.fs.list(path),
  stat: path => $.fs.stat(path),
  env: name => folderVar($, name),
})

// The validator wants literal names, and only folder variables are ever read: see FOLDER_VARS in preview.ts.
async function folderVar($: EngineInterface, name: string) {
  switch (name.toUpperCase()) {
    case 'TEMP': return $.env.get('TEMP')
    case 'TMP': return $.env.get('TMP')
    case 'TMPDIR': return $.env.get('TMPDIR')
    case 'HOME': return (await $.env.get('HOME')) ?? $.env.get('USERPROFILE')
    case 'USERPROFILE': return $.env.get('USERPROFILE')
    case 'APPDATA': return $.env.get('APPDATA')
    case 'LOCALAPPDATA': return $.env.get('LOCALAPPDATA')
    default: return undefined
  }
}

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

type Rules = { path: string; mtimeMs: number; rules: UserRule[]; notes: string[] }
let rulesCache: Rules | null = null

// rules.json, re-read only when its mtime moves; a missing or broken file never disables the built-in checks.
async function loadRules($: EngineInterface): Promise<Rules> {
  const home = ((await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '').replace(/\\/g, '/')
  const path = `${home}/${RULES_FILE}`
  try {
    const stat = await $.fs.stat(path).catch(() => null)
    if (!stat) return (rulesCache = { path, mtimeMs: -1, rules: [], notes: [] })
    if (rulesCache?.path === path && rulesCache.mtimeMs === stat.mtimeMs) return rulesCache
    const compiled = compileRules(String(await $.fs.read(path)))
    return (rulesCache = { path, mtimeMs: stat.mtimeMs, ...compiled })
  } catch (error) {
    return { path, mtimeMs: -1, rules: [], notes: [fill(text.rulesNotes.unreadable, { why: String((error as Error)?.message ?? error).slice(0, 60) })] }
  }
}

const judge = async ($: EngineInterface, value: unknown) => evaluate(value, (await loadRules($)).rules)

// VS Code chat, -p and SDK sessions list no surface that draws a pane or a band.
// Haiku rewrites the card's words once per command; the rule's own text shows until it answers, and stays when it fails.
const describedCache = new Map<string, Described>()

async function describe($: EngineInterface, mine: Held) {
  const rules = (await loadRules($)).rules
  const risky = segmentsOf(mine.command, rules).filter(step => step.risk)
  let found = describedCache.get(mine.command)
  if (!found) {
    mine.isDescribing = true
    $.ui.invalidate('ui.render')
    const prompt = describePrompt(mine.command, mine.risk.reason, mine.report?.summary ?? '', risky.map(step => step.text))
    const reply = await $.model.complete({ model: 'haiku', system: SYSTEM, prompt, maxTokens: 500, timeoutMs: 15000 }).catch(() => null)
    mine.isDescribing = false
    $.ui.invalidate('ui.render')
    found = reply?.isAnswered ? parseDescribed(reply.text, risky.length) ?? undefined : undefined
    // No answer still gets a verdict line: with nothing to go on, it points to Details.
    if (!found) {
      if (held === mine && mine.decision === null && mine.plain) mine.plain = { ...mine.plain, verdict: { isOk: false, why: text.verdict.noAnswer } }
      $.ui.invalidate('ui.render')
      return
    }
    describedCache.set(mine.command, found)
  }
  const cwd = String((await $.session.cwd().catch(() => '')) ?? '')
  if (held !== mine || mine.decision !== null || !mine.plain) return
  mine.described = found
  mine.plain = { ...mine.plain, verb: found.verb, subject: undefined, does: found.does, undo: found.undo, targets: found.targets, verdict: verdictOf(found, mine.report, cwd) }
  $.ui.invalidate('ui.render')
}

async function canDraw($: EngineInterface) {
  const surfaces = await $.session.surfaces().catch(() => ['terminal' as const])
  return surfaces.some(surface => surface === 'terminal' || surface === 'desktop')
}

// What Run approved, by tool_use_id and by command text, so the settings hook's own prompt is not asked a second time.
const approved = new Set<string>()
const approvedCommands = new Set<string>()

const isApproved = (id: unknown, command: unknown) => approved.has(String(id)) || approvedCommands.has(String(command))

// The settings hook's ask, wherever the engine carries it; matched loosely because a prefix may precede its text.
const isDestructiveAsk = (ask: unknown) => typeof ask === 'string' && ask.includes(DESTRUCTIVE_ASK)

const isPaneOpen = async ($: EngineInterface, id: string) => (await $.ui.panes()).some(pane => pane.id === id && pane.isPlaced)

// One of this mod's panels at a time; `pane` tells other mods that a panel of this one is open.
async function closePanes($: EngineInterface, except = '') {
  for (const id of [SETTINGS_PANE, LIST_PANE]) {
    if (id !== except && (await isPaneOpen($, id))) await $.ui.close({ id })
  }
}

// The Details entry on the card: a read-only pane with everything about the held command.
async function toggleList($: EngineInterface) {
  if (await isPaneOpen($, LIST_PANE)) {
    await $.ui.close({ id: LIST_PANE })
    await $.state.set({ plugin: 'mod-blast-radius', key: 'pane' }, false)
    return
  }
  if (!held?.report) {
    $.ui.toast(text.ui.nothingHeld)
    return
  }
  await closePanes($, LIST_PANE)
  const opened = await $.ui.open({ id: LIST_PANE, title: text.card.details, closeOnEscape: true })
  if (!opened.isPlaced) $.ui.toast(fill(text.ui.listWaiting, { reason: opened.reason }))
  await $.state.set({ plugin: 'mod-blast-radius', key: 'pane' }, opened.isPlaced)
}

// A hook's own time is 10 s, but time inside a `$` call is free, so the hold waits on a short child process.
const PAUSES = {
  windows: [['sleep', '0.25'], ['powershell', '-NoProfile', '-NonInteractive', '-Command', 'Start-Sleep -Milliseconds 250'], ['ping', '-n', '1', '-w', '250', '192.0.2.1']],
  other: [['sleep', '0.25'], ['perl', '-e', 'select(undef,undef,undef,0.25)']],
}
let pauseAt = 0
let isWindows: boolean | undefined

async function pause($: EngineInterface) {
  if (isWindows === undefined) isWindows = (await $.env.get('OS')) === 'Windows_NT'
  const choices = isWindows ? PAUSES.windows : PAUSES.other
  for (; pauseAt < choices.length; pauseAt++) {
    try {
      const waited = await $.process.run(choices[pauseAt]!, { timeoutMs: 5000 })
      if (waited.exitCode === 0) return
    } catch {
      // that waiter is not installed; try the next one
    }
  }
  throw new Error('no way to wait')
}

// Both panes' title line: Details and Settings as tabs, the shown one open.
const tabs = (isSettings: boolean) => [
  { id: DETAILS_TAB, label: text.card.details, icon: look.glyph.mark.shell ?? '', isOpen: !isSettings, tip: { glyph: look.glyph.mark.shell ?? '', label: text.card.details, text: text.tipTabDetails } },
  { id: SETTINGS_TAB, label: text.ui.settings, icon: look.glyph.gear, isOpen: isSettings, tip: { glyph: look.glyph.gear, label: text.ui.settings, text: text.tipTabSettings } },
]

const isSettingsOpen = async ($: EngineInterface) => (await $.ui.panes()).some(pane => pane.id === SETTINGS_PANE && pane.isPlaced)

// `/mod-blast-radius settings` toggles the panel; an unplaced pane is waiting, not open.
async function toggleSettings($: EngineInterface) {
  if (await isSettingsOpen($)) {
    await $.ui.close({ id: SETTINGS_PANE })
    await $.state.set({ plugin: 'mod-blast-radius', key: 'pane' }, false)
    return
  }
  await closePanes($, SETTINGS_PANE)
  note = ''
  const showcase = await $.fs.read(`${$.plugin.root}/showcase.json`).then(file => JSON.parse(String(file))).catch(() => null)
  previews = showcase?.previews
  actions = (Array.isArray(showcase?.actions) ? showcase.actions : []).map((action: Action) => ({ ...action, isLocal: action.command === 'mod-blast-radius' }))
  const opened = await $.ui.open({ id: SETTINGS_PANE, title: text.ui.paneName, closeOnEscape: true })
  if (!opened.isPlaced) $.ui.toast(fill(text.ui.settingsWaiting, { reason: opened.reason }))
  await $.state.set({ plugin: 'mod-blast-radius', key: 'pane' }, opened.isPlaced)
}

// What `/mod-blast-radius <args>` does; the panel's own actions call it directly, since $.command.run skips the calling plugin.
async function answer($: EngineInterface, args: string) {
  if (args.trim() === 'settings') {
    await toggleSettings($)
    return ''
  }
  const { rules, notes } = await loadRules($)
  const mine = rules.length ? fill(text.ui.mine, { n: rules.length }) : ''
  const bad = notes.length ? fill(text.ui.bad, { n: notes.length }) : ''
  return isEnabled ? fill(text.ui.isOn, { builtIn: BUILT_IN.length, mine, bad }) : text.ui.isOff
}

const refusal = (decision: Decision | null) =>
  ({
    cancel: 'the person pressed Cancel',
    interrupted: 'the turn was interrupted',
    error: 'Blast radius hit an error while holding it',
  } as Record<string, string | undefined>)[decision ?? 'error'] ?? 'no answer was recorded'

type Elements = { Box: (props: any) => RenderElement; Client: (props: any) => RenderElement; Text: (props: any) => RenderElement }

// Counts and sizes in a line get the warning color.
const FIGURE = /(\d[\d.,]*\s(?:[KMGT]?B|files?|folders?|commits?|paths?|entr(?:y|ies)|branch(?:es)?|statements?)\b)/
const NOT_LOST = [text.preview.searchesUnder, text.preview.reaches, text.preview.statements]

function figures(Text: Elements['Text'], text: string, key: string) {
  return text.split(FIGURE).map((part, index) => (index % 2 ? <Text key={`${key}-${index}`} color={THEME.warn}>{part}</Text> : part))
}

// Moonlight syntax roles for a shell command; the risky part reads as risk.
const roleProps = (role: Role) => {
  if (role === 'command') return { color: SYNTAX.command, bold: true }
  if (role === 'option') return { color: SYNTAX.option }
  if (role === 'text') return { color: SYNTAX.text }
  if (role === 'variable') return { color: SYNTAX.variable }
  if (role === 'number') return { color: SYNTAX.number }
  if (role === 'operator') return { color: SYNTAX.operator }
  if (role === 'risk') return { color: THEME.alert, bold: true }
  if (role === 'muted') return { color: THEME.muted }
  return { color: THEME.onSurface }
}

// One row of colored spans; a row of a single color is one plain Text.
function spansText(Text: Elements['Text'], spans: Span[], key: string) {
  if (spans.length === 1) return <Text key={key} wrap="wrap" {...roleProps(spans[0]!.role)}>{spans[0]!.text}</Text>
  return <Text key={key} wrap="wrap">{spans.map((span, index) => <Text key={`${key}-${index}`} {...roleProps(span.role)}>{span.text}</Text>)}</Text>
}

// The held command as a card above the pills: what happens in plain words, what it touches, then Cancel, Details and the consequence. Every row fits the band.
function holdCard({ Box, Button, Client, Text }: Elements & { Button: (props: any) => RenderElement }, state: Held, columns: number, maxRows: number, onKey: (id: string) => unknown) {
  const width = Math.max(20, columns - 4)
  // The card's rows are what is left after its border, its action row and the pill row below.
  const rows = cardRows(state.plain!, state.report!, width, Math.max(1, maxRows - 2 - 3))
  const labels = actionLabels(state.plain!, width)
  const body = rows.map((row, index) => {
    const key = `hold-row-${index}`
    if (row.kind === 'head') return <Text key={key} color={THEME.alert} bold>{`${look.glyph.warn} ${row.text}`}</Text>
    if (row.kind === 'does') return <Text key={key} color={THEME.onSurface}>{row.text}</Text>
    if (row.kind === 'path') {
      return (
        <Text key={key}>
          <Text key={`${key}-path`} color={THEME.alert}>{row.text}</Text>
          <Text key={`${key}-gap`} color={THEME.onSurface}>{'   '}</Text>
          {figures(Text, row.stats ?? '', key)}
        </Text>
      )
    }
    if (row.kind === 'verdict' && row.isOk) return <Text key={key} color={THEME.good}>{`${MARK.ok} ${row.text}`}</Text>
    if (row.kind === 'verdict') {
      return (
        <Text key={key}>
          <Text key={`${key}-mark`} color={THEME.alert} bold>{MARK.warn}</Text>
          <Text key={`${key}-text`} color={THEME.muted}>{` ${row.text}`}</Text>
        </Text>
      )
    }
    if (row.kind === 'line') return <Text key={key} color={THEME.alert}>{figures(Text, row.text, key)}</Text>
    return <Text key={key} color={THEME.muted}>{row.text}</Text>
  })
  // The entry draws the action; a Button nobody sees carries its digit, since only a Button takes a hotkey and a visible one inverts under the pointer.
  // Each action is a numbered pill: its digit in a subpill before the label.
  const entry = (id: string, label: string, hotkey: string, tipLabel: string, tipBody: string, tipGlyph: string, color?: string) => (
    <Box key={`${id}-pad`} flexDirection="row">
      {pill({ Box, Text }, look.nerd, THEME.surface3, <Client key={id} module="./entry.tsx" height={1} props={{ id, label, isOpen: true, bg: THEME.surface3, subLead: hotkey, nerd: look.nerd, tip: { glyph: tipGlyph, label: tipLabel, text: tipBody }, ...(color ? { color } : {}), still }} />, `${id}-pill`, THEME.surface1)}
      <Box key={`${id}-key`} width={0} height={0} overflow="hidden">
        <Button key={`${id}-hotkey`} label={label} hotkey={hotkey} plain onPress={() => onKey(id)} />
      </Box>
    </Box>
  )

  return (
    <Box key="blast-card" flexDirection="column" borderStyle="round" borderColor={THEME.alert} backgroundColor={THEME.surface1} paddingX={1}>
      {body}
      <Box key="hold-actions" flexDirection="row" columnGap={ACTION_GAP}>
        {entry('blast-cancel', labels.cancel, HOTKEY.cancel, labels.cancel, text.tips.cancel, look.glyph.close)}
        {entry('blast-details', labels.details, HOTKEY.details, labels.details, text.tips.details, look.glyph.mark.shell ?? '')}
        {entry('blast-run', labels.run, HOTKEY.run, labels.run, text.tips.run, look.glyph.go, THEME.alert)}
        {/* While Haiku writes the plain words, a shimmer on the right says they are coming; only where the row has room. */}
        {state.isDescribing && labels.cancel.length + labels.details.length + labels.run.length + 3 * ACTION_EXTRA + 3 * ACTION_GAP + text.card.explaining.length + 2 <= width ? (
          <Box key="hold-explaining-row" flexGrow={1} justifyContent="flex-end">
            <Client key="hold-explaining" module="./entry.tsx" height={1} props={{ id: 'hold-explaining', label: text.card.explaining, isOpen: false, bg: THEME.surface1, isBusy: true, still }} />
          </Box>
        ) : null}
      </Box>
    </Box>
  )
}

// A card action, from a click on its entry or its digit typed into the empty prompt.
async function choose($: EngineInterface, id: string) {
  if (!held || held.decision !== null) return
  if (id === 'blast-run') held.decision = 'run'
  if (id === 'blast-cancel') held.decision = 'cancel'
  if (id === 'blast-details') await toggleList($)
  $.ui.invalidate('ui.render')
}

const toasts = new ToastList('blast')
// The animations setting, fixed per activation: off, every entry draws still.
let still = false

// A settings card's click: its row, saved through /config; a saved change reloads this mod.
async function saveSetting($: EngineInterface, key: string, value: ConfigValue) {
  const row = (await $.config.list()).find(each => each.key === key)
  if (!row) return
  const result = await $.config.set({ key: row.key, value })
  note = 'deny' in result && result.deny ? `${MARK.warn} ${result.deny}` : `${MARK.ok} ${fill(text.ui.settingSaved, { label: row.label })}`
  $.ui.invalidate('ui.render')
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

  isEnabled = options.enabled !== false
  iconMode = (options.icons as IconMode | undefined) ?? 'auto'
  // A forced mode needs no detection; auto loads the saved answer, then checks the terminal font beside the hooks.
  look = lookFor(iconMode === 'nerd')

  on('session.start', async ($, e, next) => {
    await loadLook($)
    await $.command.register({
      name: 'mod-blast-radius',
      description: text.ui.commandDescription,
      argumentHint: '[settings]',
    })
    await $.state.set({ plugin: 'mod-blast-radius', key: 'pane' }, await isSettingsOpen($))
    $.ui.invalidate('ui.render')

    return next(e)
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (!isEnabled) return next(e)
    const { risk, command } = await judge($, e.command)
    if (!risk) return next(e)
    // Without a surface that draws, nothing could answer a hold: tool.check puts the call to the permission system instead.
    if (!(await canDraw($))) return next(e)

    // `held` is claimed with no await between the check and the claim, so two waiting calls cannot both pass.
    while (held !== null) {
      if (next.signal.aborted) return { deny: `Blast radius held this command and did not run it: ${refusal('interrupted')}. Do not retry it unless the person asks you to.` }
      try {
        await pause($)
      } catch {
        return { deny: `Blast radius held this command and did not run it: ${refusal('error')}. Do not retry it unless the person asks you to.` }
      }
    }
    const mine: Held = { command, risk, report: null, plain: null, decision: null }
    held = mine
    let isSilent = false
    try {
      mine.report = await measure(ioOf($), risk)
      mine.plain = plainFor(risk, mine.report)
      if (mine.report.isHarmless) {
        isSilent = true
        mine.decision = 'run'
      } else {
        // Other band mods can read this to step aside while the card is up.
        await $.state.set({ plugin: 'mod-blast-radius', key: 'holding' }, true)
        $.clock.after(0, () => describe($, mine))
        $.ui.invalidate('ui.render')
        // No timeout: the hold stays until the person answers, or the turn is interrupted.
        while (mine.decision === null) {
          if (next.signal.aborted) mine.decision = 'interrupted'
          else await pause($)
        }
      }
    } catch {
      mine.decision = 'error'
    } finally {
      if (held === mine) held = null
      hovered = null
      await $.state.set({ plugin: 'mod-blast-radius', key: 'holding' }, false).catch(() => undefined)
      // The list pane belongs to the hold: when the hold ends it goes too.
      if (await isPaneOpen($, LIST_PANE).catch(() => false)) {
        await $.ui.close({ id: LIST_PANE }).catch(() => undefined)
        await $.state.set({ plugin: 'mod-blast-radius', key: 'pane' }, false).catch(() => undefined)
      }
      $.ui.invalidate('ui.render')
    }

    if (mine.decision === 'run') {
      if (!isSilent) {
        approved.add(String(e.tool_use_id))
        approvedCommands.add(command)
        if (approved.size > 100) approved.delete(approved.values().next().value as string)
        $.ui.toast(text.ui.running)
      }
      return next(e)
    }
    return { deny: `Blast radius held this command and did not run it: ${refusal(mine.decision)}. Reason: ${mine.risk.reason}. It would have: ${mine.report?.summary ?? mine.risk.label}. Do not retry it unless the person asks you to.` }
  })

  // The settings hook's ask arrives here as the verdict; with no surface that draws, a hold cannot be answered, so the permission system asks.
  on('tool.check', { tool: 'Bash' }, async ($, e, next) => {
    const verdict = await next(e)
    const command = (e.input as { command?: unknown } | null)?.command
    const answered = isApproved(e.tool_use_id, command) && verdict.decision === 'ask' && isDestructiveAsk(verdict.reason)
    // What Run approved is not asked again.
    if (answered) return { decision: 'allow' }
    if (!isEnabled || verdict.decision === 'deny' || (await canDraw($))) return verdict
    const { risk } = await judge($, command)

    return risk ? { decision: 'ask', reason: fill(text.ui.askReason, { reason: risk.reason }) } : verdict
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === SETTINGS_PANE || e.id === LIST_PANE) await $.state.set({ plugin: 'mod-blast-radius', key: 'pane' }, false)

    return next(e)
  })

  // One panel at a time: another mod's pane opening closes this mod's panels, deferred past that plugin's dispatch.
  on('state.set', async ($, e, next) => {
    if (e.key === 'pane' && e.plugin !== 'mod-blast-radius' && e.value === true) {
      $.clock.after(0, async () => {
        await closePanes($)
        await $.state.set({ plugin: 'mod-blast-radius', key: 'pane' }, false)
      })
    }

    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (!(e as { agentId?: string }).agentId) {
      working = true
      $.ui.invalidate('ui.render')
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (!e.agentId) {
      working = false
      approved.clear()
      approvedCommands.clear()
      $.ui.invalidate('ui.render')
    }

    return next(e)
  })

  on('command.run', { command: 'mod-blast-radius' }, async ($, e) => ({ text: await answer($, e.args) }))

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    await loadLook($)
    // @ts-expect-error The host's types omit Client from a Pane's elements, yet a Pane draws it.
    const { Box, Button, Client, Text } = $.ui.resolve(e)

    if (e.requestId === LIST_PANE) {
      if (!held?.report || !held.plain) return next(e)
      const { report, plain, risk, command } = held
      const { source } = whyOf(risk)
      const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? ''
      const plainText = (key: string, value: string, color: string, extra: Record<string, unknown> = {}) => <Text key={key} color={color} wrap="wrap" {...extra}>{value}</Text>
      const rules = (await loadRules($)).rules
      const { shown, rest } = stepsView(segmentsOf(command, rules))
      // Haiku's step sentences line up with the risky steps only, so a shown step maps to its place among them.
      const riskyIndex = (index: number) => shown.slice(0, index).filter(step => step.risk).length
      // Risky steps and scripts get a row each; the harmless rest is one muted line.
      const does = [
        ...shown.map((step, index) => (
          <Box key={`does-${index}`} flexDirection="column" marginTop={index === 0 ? 0 : 1}>
            {spansText(Text, colorStep(step.text, rules), `does-${index}-text`)}
            {plainText(`does-${index}-says`, (step.risk && held!.described?.steps[riskyIndex(index)]) || step.says, step.risk ? THEME.onSurface : THEME.muted)}
          </Box>
        )),
        rest ? plainText('does-rest', rest, THEME.muted) : null,
      ]
      const full = wrapSpans(colorLines(command, rules), Math.max(20, e.props.bodyColumns - 6), 12)
      const fullRows = [
        ...full.rows.map((row, index) => spansText(Text, row.length ? row : [{ text: ' ', role: 'plain' }], `full-${index}`)),
        full.more ? <Text key="full-more" color={THEME.muted}>{fill(text.ui.andMoreLines, { n: full.more })}</Text> : null,
      ]
      // One pill per role, in a wash of its color, as mod-file-tree's footer names its colors.
      const legend = LEGEND.map(span => {
        const hue = roleProps(span.role).color
        return pill({ Box, Text }, look.nerd, mix(hue, THEME.bg, WASH), <Text color={hue}>{look.nerd ? span.text : ` ${span.text} `}</Text>, `legend-${span.role}`, THEME.bg)
      })

      const touches: unknown[] = [
        <Text key="touch-total" color={THEME.onSurface} wrap="wrap">{figures(Text, report.listTitle ?? fill(text.ui.wouldSummary, { summary: report.summary }), 'touch-total')}</Text>,
      ]
      report.groups.forEach((group, index) => {
        const color = NOT_LOST.includes(group.title) ? THEME.onSurface : THEME.alert
        touches.push(plainText(`touch-${index}-title`, group.title, THEME.muted, { bold: true }))
        if (group.entries) {
          // Grouped by folder, in the order the preview found them.
          const byDir = new Map<string, { name: string; detail: string }[]>()
          for (const entry of group.entries) byDir.set(entry.dir, [...(byDir.get(entry.dir) ?? []), entry])
          let drawn = 0
          for (const [dir, files] of byDir) {
            if (drawn >= 400) break
            touches.push(plainText(`dir-${index}-${drawn}`, `${tilde(dir, home)}/`, THEME.muted))
            for (const file of files) {
              touches.push(
                <Text key={`file-${index}-${drawn}`} wrap="wrap">
                  <Text key={`file-${index}-${drawn}-name`} color={color}>{`  ${file.name}`}</Text>
                  <Text key={`file-${index}-${drawn}-size`} color={THEME.warn}>{`  ${file.detail}`}</Text>
                </Text>,
              )
              drawn++
            }
          }
          if (group.entries.length > drawn) touches.push(plainText(`touch-${index}-rest`, fill(text.ui.andMoreNotShown, { n: group.entries.length - drawn }), THEME.muted))
        } else {
          ;(group.all ?? group.lines).forEach((line, at) => touches.push(<Text key={`line-${index}-${at}`} color={color} wrap="wrap">{figures(Text, line, `line-${index}-${at}`)}</Text>))
        }
      })
      if (report.isUnknown && report.note) touches.push(plainText('touch-note', report.note, THEME.muted))

      return (
        <Box flexDirection="column" backgroundColor={THEME.bg} paddingX={1} minHeight={e.props.scroll.bodyRows}>
          {tabRow({ Box, Client, Text }, look.nerd, tabs(false), still)}
          <Text color={THEME.muted} wrap="truncate-end">{`${text.ui.readOnly} ${MARK.sep} ${text.ui.answerOnCard}`}</Text>
          {section({ Box, Text }, look, 'does', '', '', [...does, plainText('why-source', fill(text.ui.heldBy, { source: source.replace(/\.$/, '') }), THEME.muted, { key: 'why-source' })])}
          {section({ Box, Text }, look, 'touches', 'tool', text.ui.sectionTouches, touches)}
          {section({ Box, Text }, look, 'undo', 'actions', text.ui.sectionUndo, [plainText('undo-text', plain.undo, THEME.onSurface)])}
          {section({ Box, Text }, look, 'full', 'prompt', text.ui.sectionFull, fullRows)}
          <Box key="legend-row" flexDirection="row" flexWrap="wrap" columnGap={1} marginTop={1}>{legend}</Box>
          <Box key="footer-space" height={FOOTER_ROWS} />
          {paneFooter({ Box, Text }, hoveredTip(), e.props.bodyColumns, e.props.scroll)}
        </Box>
      )
    }
    if (e.requestId !== SETTINGS_PANE) return next(e)

    const rows = (await $.config.list()).filter(row => row.key.startsWith('mod-blast-radius.'))
    // A saved change reloads this mod, which redraws the panel with the new value.
    const run = async (action: Action) => {
      const said = action.command === 'mod-blast-radius' ? answer($, action.args ?? '') : $.command.run({ command: action.command, args: action.args ?? '' }).then(() => fill(text.ui.ran, { command: action.command }))
      note = await said.then(reply => `${MARK.ok} ${reply || action.label}`).catch(error => `${MARK.warn} ${String(error)}`)
      $.ui.invalidate('ui.render')
    }
    const patterns = BUILT_IN.map((name, index) => (
      <Box key={`built-in-${index}`} flexDirection="row" columnGap={1}>
        <Text color={THEME.accent}>{MARK.bullet}</Text>
        <Text color={THEME.onSurface} wrap="truncate-end">{name}</Text>
      </Box>
    ))
    const loaded = await loadRules($)
    const bad = loaded.notes.length ? `${MARK.warn} ${loaded.notes[0]}${loaded.notes.length > 1 ? fill(text.ui.moreProblems, { n: loaded.notes.length - 1 }) : ''}` : ''
    const ruleLines = [
      <Text key="rules-path" color={THEME.onSurface} wrap="truncate-end">{`~/${RULES_FILE}`}</Text>,
      <Text key="rules-format" color={THEME.muted} wrap="truncate-end">{'[{ "pattern": "terraform\\s+destroy", "reason": "Destroys infrastructure", "flags": "i" }]'}</Text>,
      <Text key="rules-count" color={THEME.muted}>{`${fill(text.ui.rulesLoaded, { rules: plural(loaded.rules.length, text.units.rule) })} ${MARK.sep} ${text.ui.rulesNote}`}</Text>,
    ]

    return (
      <Box flexDirection="column" backgroundColor={THEME.bg} paddingX={1} minHeight={e.props.scroll.bodyRows}>
        {tabRow({ Box, Client, Text }, look.nerd, tabs(true), still)}
        <Text wrap="truncate-end" color={statusColor(note || bad)}>{note || bad || `${text.ui.statusHint} ${MARK.sep} ${text.ui.statusHintSaved}`}</Text>
        {settingsBody({ Box, Button, Client, Text }, look, { rows, actions, working, run, previews , still: still, tips: text.settingTips })}
        {section({ Box, Text }, look, 'rules', 'Bash', text.ui.sectionRules, ruleLines)}
        {section({ Box, Text }, look, 'built-in', 'Bash', text.ui.sectionBuiltIn, patterns)}
      </Box>
    )
  })

  // Cancel, Details and Run are entry Clients in the card; a click posts the entry's id.
  on('ui.message', async ($, e, next) => {
    if (isTipMessage(e.data)) {
      hovered = e.data
      $.ui.invalidate('ui.render')
      return next(e)
    }
    const change = settingChoice(e.data)
    if (change) await saveSetting($, change.key, change.value)
    const clicked = e.data as EntryMessage
    const dismissed = clicked?.type === 'menu-entry' ? toasts.idOf(clicked.id) : undefined
    if (dismissed !== undefined) {
      toasts.drop(dismissed)
      $.ui.invalidate('ui.render')
      return next(e)
    }
    const message = e.data as EntryMessage
    if (message?.type === 'menu-entry') await choose($, message.id)
    // The title line's tabs swap Details and Settings; the open tab does nothing.
    if (message?.type === 'menu-entry' && message.id === SETTINGS_TAB && !(await isSettingsOpen($))) await toggleSettings($)
    if (message?.type === 'menu-entry' && message.id === DETAILS_TAB && !(await isPaneOpen($, LIST_PANE))) await toggleList($)

    return next(e)
  })

  // The hold is a card above the pill row, so it draws wherever the band does, desktop included.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    await loadLook($)
    // @ts-expect-error The host's types omit Client from a Pane's elements, yet a Pane draws it.
    const { Box, Button, Client, Text } = $.ui.resolve(e)
    if (!held || !held.report || !held.plain || held.decision !== null) {
      if (toasts.items.length === 0) return next(e)
      const others = await next(e)
      const { group, row, rest, tip } = splitRow(others)
      const cards = toastCards({ Box, Client, Text }, toasts, look, text.tipToast)
      if (group.length > 0 || row.length > 0) return pillRow({ Box, Client, Text }, look.nerd, group, row, [...cards, ...rest], tip, e.props.bodyColumns)
      return (
        <Box key="toasts-blast" flexDirection="column">
          {cards}
          {others}
        </Box>
      )
    }
    const { group, row, tip: menuTip } = splitRow(await next(e))
    const tip = hovered?.id ? tipLine({ Box, Text }, tipText(hovered)) : menuTip

    // While a call is held only the card and the pill row draw, so other rows cannot fill the band and cut the card off.
    return pillRow({ Box, Client, Text }, look.nerd, group, row, [holdCard({ Box, Button, Client, Text }, held, e.props.bodyColumns, e.props.maxRows, id => choose($, id))], tip, e.props.bodyColumns)
  })
}
