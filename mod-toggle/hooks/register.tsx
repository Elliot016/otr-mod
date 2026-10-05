import type { ConfigRow, ConfigValue, EngineInterface, Register, RenderElement } from 'claude-code'

import type { BarMessage, BarProps } from './bar'
import { isNerdFace, lookFor, terminalSettings, type IconMode, withMark } from './look'
import { settingsBody, type Action, type Previews } from './settings'
import { MARK, statusColor, THEME } from './theme'
import { callTime, diffStat, isPrompt, rowKey, timeOfDay, toolLabel, turnSummary, TurnLog, type Turn } from './turns'

let transcript = ''
let log = new TurnLog()
let isLoaded = false
let working = false
// The person's settings (userConfig), fixed per activation: a change reloads the mod.
let foldTurns = true
let foldTools = true
let showTimes = true
let expandLive = true
let iconMode: IconMode = 'auto'
let look = lookFor(false)
type Kind = 'turns' | 'tools'
// Spike only: each drawn row's component and id, and whether the transcript parse placed it in a turn.
const seen = new Map<string, boolean>()

const PANE = 'toggle-settings'
let actions: Action[] = []
let previews: Previews | undefined
let note = ''

const isPaneOpen = async ($: EngineInterface) => (await $.ui.panes()).some(pane => pane.id === PANE && pane.isPlaced)

// `/mod-toggle settings` toggles the panel; an unplaced pane is waiting, not open.
async function toggleSettings($: EngineInterface) {
  if (await isPaneOpen($)) {
    await $.ui.close({ id: PANE })
    await $.state.set({ plugin: 'mod-toggle', key: 'pane' }, false)
    return
  }
  note = ''
  const showcase = await $.fs.read(`${$.plugin.root}/showcase.json`).then(text => JSON.parse(String(text))).catch(() => null)
  previews = showcase?.previews
  actions = (Array.isArray(showcase?.actions) ? showcase.actions : []).map((action: Action) => ({ ...action, isLocal: action.command === 'mod-toggle' }))
  const result = await $.ui.open({ id: PANE, title: 'mod-toggle', closeOnEscape: true })
  if (!result.isPlaced) $.ui.toast(`Settings panel waiting: ${result.reason}`)
  await $.state.set({ plugin: 'mod-toggle', key: 'pane' }, result.isPlaced)
}

// Read once, since a long session's file is large (past $.fs.read's cap it streams through the file printer); later rows are claimed as they render.
async function load($: EngineInterface) {
  if (isLoaded) return
  if (!transcript) transcript = String((await $.store.get(`transcript:${await $.session.id()}`)) ?? '')
  if (!transcript) transcript = await findTranscript($)
  if (!transcript) return
  let text = String(await $.fs.read(transcript).catch(() => ''))
  if (!text) {
    const isWindows = /^[A-Za-z]:|\\/.test(transcript)
    // cmd's type rejects forward slashes ("The syntax of the command is incorrect").
    const argv = isWindows ? ['cmd', '/c', 'type', transcript.replace(/\//g, '\\')] : ['cat', transcript]
    for await (const chunk of $.process.spawn({ argv })) {
      if (chunk.stream === 'stdout') text += chunk.text
    }
  }
  if (!text) return
  log = new TurnLog()
  for (const line of text.split('\n')) if (line.trim()) log.feed(line)
  isLoaded = true
  $.ui.invalidate('ui.render')
}

// When no SessionStart named the transcript, it is `<session id>.jsonl` in one of ~/.claude/projects' folders.
async function findTranscript($: EngineInterface) {
  const home = ((await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '').replace(/\\/g, '/')
  const projects = `${home}/.claude/projects`
  const file = `${await $.session.id()}.jsonl`
  for (const entry of await $.fs.list(projects).catch(() => [])) {
    const path = `${projects}/${entry.name}/${file}`
    if (entry.kind === 'dir' && (await $.fs.exists(path).catch(() => false))) return path
  }
  return ''
}

// The live turn stays open; a turn is done once a later prompt follows it, its duration is stored, or Claude is idle.
// The turns list holds the turns flipped away from what fold_turns sets for all of them.
const isTurnOpen = (flipped: string[], turn: Turn) => flipped.includes(turn.prompt) === foldTurns

// The latest turn draws in full until the next prompt; a row the transcript doesn't hold yet belongs to it.
const isLive = (turn: Turn | undefined) => expandLive && (!turn || !isDone(turn))

// The prompt of the last turn known to have ended. A flag set by turn.start would read idle after a mod reload mid-turn.
let endedPrompt = ''

// With expand_live off, the latest turn folds as soon as it ends instead of at the next prompt.
const isDone = (turn: Turn) =>
  turn !== log.turns[log.turns.length - 1] || (!expandLive && (turn.durationMs !== undefined || turn.prompt === endedPrompt))

const markEnded = () => {
  endedPrompt = log.turns[log.turns.length - 1]?.prompt ?? ''
}

// Reading the lists subscribes the row to redraws when a click changes them.
async function opened($: EngineInterface, kind: Kind) {
  const value = (kind === 'turns' ? await $.state.get({ plugin: 'mod-toggle', key: 'turns' }) : await $.state.get({ plugin: 'mod-toggle', key: 'tools' })).value
  return Array.isArray(value) ? value : []
}

async function flip($: EngineInterface, kind: Kind, id: string) {
  const list = await opened($, kind)
  const value = list.includes(id) ? list.filter(open => open !== id) : [...list, id]
  if (kind === 'turns') await $.state.set({ plugin: 'mod-toggle', key: 'turns' }, value)
  else await $.state.set({ plugin: 'mod-toggle', key: 'tools' }, value)
}

const fit = (text: string, width: number) => {
  const flat = text.replace(/\s+/g, ' ')
  return flat.length > width ? `${flat.slice(0, Math.max(0, width - 1))}…` : flat
}

// `11:32:05 · 6m 12s` with its two caps and a space: the widest start-and-duration a tool line shows.
const WHEN_WIDTH = 21

const widthOf =(e: { viewport?: { columns: number } }) => Math.max(20, (e.viewport?.columns ?? 100) - 6)

// How a turn's row draws: hidden while its turn is folded, inside the card while unfolded, as is in the live turn or as the reply.
async function placeOf($: EngineInterface, turn: Turn | undefined, requestId: string) {
  if (!turn || !isDone(turn) || rowKey(requestId) === turn.reply) return 'plain'
  return isTurnOpen(await opened($, 'turns'), turn) ? 'card' : 'hidden'
}

type Elements = { Box: (props: any) => RenderElement }

// One row's share of a turn's card; stacked rows make one tinted block with a bar down its left edge.
const slice = ({ Box, Client }: Bars, key: string, bar: string, body: unknown, fold: BarProps) => (
  <Box key={key} flexDirection="row" backgroundColor={THEME.surface1}>
    <Box key={`${key}-bar`} width={1} flexShrink={0} backgroundColor={bar}>
      <Client key={`${key}-strip`} module="./bar.tsx" width={1} height="100%" props={fold} />
    </Box>
    <Box key={`${key}-body`} flexDirection="column" flexGrow={1} paddingX={1}>
      {body}
    </Box>
  </Box>
)

// A strip is clickable, so drawing one takes a Client.
type Bars = Elements & { Client: (props: any) => RenderElement }

type Controls = Elements & { Button: (props: any) => RenderElement }

// A fold control: a colored chip showing + or the minus sign, then the line's text; a click on either toggles.
const toggleLine = ({ Box, Button }: Controls, key: string, chip: string, isOpen: boolean, label: string, onPress: () => unknown, extra: unknown = null) => (
  <Box key={key} flexDirection="row" columnGap={1}>
    <Box key={`${key}-chip`} backgroundColor={chip} flexShrink={0}>
      <Button key={`${key}-chip-button`} label={` ${isOpen ? '−' : '+'} `} plain hover={{ scope: `${key}-chip`, color: THEME.onSurface }} onPress={onPress} />
    </Box>
    <Box key={`${key}-label`} flexShrink={1}>
      <Button key={`${key}-button`} label={label} plain dimColor={!isOpen} hover={{ scope: `${key}-label`, color: THEME.accent }} onPress={onPress} />
    </Box>
    {extra}
  </Box>
)

// An unfolded tool's own row and result, set in under its line.
const nested = ({ Box, Client }: Bars, key: string, body: unknown, fold: BarProps) => (
  <Box key={key} flexDirection="row">
    <Box key={`${key}-bar`} width={1} flexShrink={0} backgroundColor={THEME.border}>
      <Client key={`${key}-strip`} module="./bar.tsx" width={1} height="100%" props={fold} />
    </Box>
    <Box key={`${key}-body`} flexDirection="column" flexGrow={1} paddingLeft={1}>
      {body}
    </Box>
  </Box>
)

// What `/mod-toggle <args>` does; the panel's own actions call it directly, since $.command.run skips the calling plugin.
async function answer($: EngineInterface, args: string) {
  if (args.trim() === 'settings') {
    await toggleSettings($)
    return ''
  }
  if (args.trim() === 'debug') {
    const temp = ((await $.env.get('TEMP')) ?? (await $.env.get('TMPDIR')) ?? '/tmp').replace(/\\/g, '/')
    const rows = [...seen].map(([row, isPlaced]) => `${isPlaced ? 'placed  ' : 'unplaced'} ${row}`)
    await $.fs.write(`${temp}/mod-toggle-ids.txt`, `${log.turns.length} turns\n${rows.join('\n')}\n`)
    return `${rows.length} drawn rows written to ${temp}/mod-toggle-ids.txt`
  }
  const flippedNow = await opened($, 'turns')
  const done = log.turns.filter(isDone)
  const isAnyOpen = done.some(turn => isTurnOpen(flippedNow, turn))
  // Folding all clears the flips when turns fold by default, and flips every turn when they open by default.
  const flipAll = isAnyOpen !== foldTurns
  await $.state.set({ plugin: 'mod-toggle', key: 'turns' }, flipAll ? done.map(turn => turn.prompt) : [])

  return isAnyOpen ? 'Folded every finished turn' : 'Unfolded every finished turn'
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

// A time as a rounded pill, like the omp transient prompt; plain muted text where the font has no caps.
function timePill({ Box, Text }: { Box: (props: any) => RenderElement; Text: (props: any) => RenderElement }, key: string, time: string) {
  if (!look.nerd) return <Box key={key} flexShrink={0}><Text color={THEME.muted}>{`${time} `}</Text></Box>
  return (
    <Box key={key} flexDirection="row" flexShrink={0}>
      <Text color={THEME.surface2}>{String.fromCodePoint(0xe0b6)}</Text>
      <Box key={`${key}-body`} backgroundColor={THEME.surface2}><Text color={THEME.muted}>{time}</Text></Box>
      <Text color={THEME.surface2}>{`${String.fromCodePoint(0xe0b4)} `}</Text>
    </Box>
  )
}

export const register: Register = (on, options) => {
  iconMode = (options.icons as IconMode | undefined) ?? 'auto'
  look = lookFor(iconMode === 'nerd')
  foldTurns = options.fold_turns !== false
  foldTools = options.fold_tools !== false
  showTimes = options.timestamps !== false
  expandLive = options.expand_live !== false

  on('session.start', async ($, e, next) => {
    look = await detectLook($)
    await $.command.register({
      name: 'mod-toggle',
      description: 'Fold or unfold every finished turn; `settings` opens its settings panel, `debug` writes the drawn row ids to %TEMP%',
      argumentHint: '[settings|debug]',
    })
    await $.state.set({ plugin: 'mod-toggle', key: 'pane' }, await isPaneOpen($))
    await load($)

    return next(e)
  })

  // A click on a card's strip folds the turn or tool it runs beside.
  on('ui.message', async ($, e, next) => {
    const message = e.data as BarMessage
    if (message?.type === 'fold') await flip($, message.kind, message.id)

    return next(e)
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) await $.state.set({ plugin: 'mod-toggle', key: 'pane' }, false)

    return next(e)
  })

  // One panel at a time: another mod's pane opening closes this one, deferred past that plugin's dispatch.
  on('state.set', async ($, e, next) => {
    if (e.key === 'pane' && e.plugin !== 'mod-toggle' && e.value === true) {
      $.clock.after(0, async () => {
        if (!(await isPaneOpen($))) return
        await $.ui.close({ id: PANE })
        await $.state.set({ plugin: 'mod-toggle', key: 'pane' }, false)
      })
    }

    return next(e)
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const rows = (await $.config.list()).filter(row => row.key.startsWith('mod-toggle.'))
    // A saved change reloads this mod, which redraws the panel with the new value.
    const set = async (row: ConfigRow, value: ConfigValue) => {
      const result = await $.config.set({ key: row.key, value })
      note = 'deny' in result && result.deny ? `${MARK.warn} ${result.deny}` : `${MARK.ok} ${row.label} saved`
      $.ui.invalidate('ui.render')
    }
    const run = async (action: Action) => {
      const said =
        action.command === 'mod-toggle'
          ? answer($, action.args ?? '')
          : $.command.run({ command: action.command, args: action.args ?? '' }).then(() => `ran /${[action.command, action.args].filter(Boolean).join(' ')}`)
      note = await said.then(text => `${MARK.ok} ${text || action.label}`).catch(error => `${MARK.warn} ${String(error)}`)
      $.ui.invalidate('ui.render')
    }

    return (
      <Box flexDirection="column" backgroundColor={THEME.bg} paddingX={1} minHeight={e.props.scroll.bodyRows}>
        <Text color={THEME.accent} bold>{`${MARK.stage} mod-toggle ${MARK.sep} settings`}</Text>
        <Text color={statusColor(note)}>{withMark(look, note) || `click a control to change it ${MARK.sep} saved at once, the mod reloads`}</Text>
        <Box marginTop={1}>{settingsBody({ Box, Button, Text }, { rows, actions, working, set, run, previews })}</Box>
      </Box>
    )
  })

  // Only the settings hook event names the transcript; kept per session so a reload finds it again.
  on('classic.SessionStart', async ($, e, next) => {
    // A compact keeps the same file, which the log already holds.
    if (e.transcript_path !== transcript || !isLoaded) {
      transcript = e.transcript_path
      log = new TurnLog()
      isLoaded = false
      await $.store.set(`transcript:${e.session_id}`, e.transcript_path)
      await load($)
    }
    // SessionStart comes between turns, so whatever the transcript holds has ended.
    markEnded()

    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (!e.agentId) working = true

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (!e.agentId) {
      working = false
      markEnded()
      $.ui.invalidate('ui.render')
    }

    return next(e)
  })

  on('command.run', { command: 'mod-toggle' }, async ($, e) => ({ text: await answer($, e.args) }))

  // The prompt row carries the card's head: one line naming what the turn did, which a click folds or unfolds.
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    // A subagent's report opens a turn of its own, as in the transcript.
    if (isLoaded && (e.props.origin.kind === 'peer' || (e.props.origin.kind === 'composer' && isPrompt(e.props.text)))) log.claim(e.requestId, 'prompt')
    if (e.props.origin.kind !== 'composer') return next(e)
    const turn = log.turnAt(e.requestId)
    seen.set(`UserMessage ${e.requestId}`, Boolean(turn))
    const { Box, Button, Client, Text } = $.ui.resolve(e)
    const prompt = await next(e)
    const row =
      showTimes && turn?.at !== undefined ? (
        <Box key="toggle-prompt-row" flexDirection="row" flexGrow={1}>
          {/* Claude Code draws a prompt with a blank row above it, so the time steps down one row to sit beside the text. */}
          <Box key="toggle-prompt-time-row" marginTop={1} flexShrink={0}>{timePill({ Box, Text }, 'toggle-prompt-time', timeOfDay(turn.at))}</Box>
          <Box key="toggle-prompt-text" flexDirection="column" flexGrow={1} flexShrink={1}>{prompt}</Box>
        </Box>
      ) : (
        <Box key="toggle-prompt-row" flexDirection="column" flexGrow={1}>{prompt}</Box>
      )
    if (!turn || !isDone(turn) || turn.tools.length === 0) return row

    const isOpen = isTurnOpen(await opened($, 'turns'), turn)
    const head = toggleLine({ Box, Button }, 'toggle-turn', THEME.accent, isOpen, fit(turnSummary(turn), widthOf(e) - 4), () => flip($, 'turns', turn.prompt))
    return (
      <Box key="toggle-prompt" flexDirection="column" flexGrow={1}>
        {row}
        {slice({ Box, Client }, 'toggle-head', isOpen ? THEME.accent : THEME.border, head, { kind: 'turns', id: turn.prompt })}
      </Box>
    )
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    if (isLoaded) log.claim(e.requestId, 'reply')
    const turn = log.turnOf(e.requestId)
    seen.set(`AssistantMessage ${e.requestId}`, Boolean(turn))
    const place = await placeOf($, turn, e.requestId)
    if (place === 'plain') return next(e)

    const { Box, Client } = $.ui.resolve(e)
    return place === 'hidden' ? <Box key="toggle-hidden" /> : slice({ Box, Client }, 'toggle-card', THEME.accent, await next(e), { kind: 'turns', id: turn!.prompt })
  })

  // A finished tool row folds to one line of its own; a click shows Claude Code's full row and result under it.
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    if (isLoaded) log.claimCall(e.props.tool_use_id, e.props.tool, e.props.input, e.props.isRunning, e.props.output)
    const turn = log.turnOf(e.requestId)
    seen.set(`ToolUse ${e.requestId}`, Boolean(turn))
    const { Box, Button, Client, Text } = $.ui.resolve(e)
    const place = await placeOf($, turn, e.requestId)
    if (place === 'hidden') return <Box key="toggle-hidden" />
    if (e.props.isRunning || !foldTools || isLive(turn)) return place === 'card' ? slice({ Box, Client }, 'toggle-card', THEME.accent, await next(e), { kind: 'turns', id: turn!.prompt }) : next(e)

    const { added, removed } = diffStat(e.props.tool, e.props.input, e.props.output)
    const isOpen = (await opened($, 'tools')).includes(e.props.tool_use_id)
    const isFailed = e.props.isErrored || e.props.isInterrupted
    const when = showTimes ? callTime(log.callOf(e.props.tool_use_id)) : ''
    const stats = [
      added ? <Box key="toggle-tool-added"><Text color={THEME.good}>{`+${added}`}</Text></Box> : null,
      removed ? <Box key="toggle-tool-removed"><Text color={THEME.alert}>{`−${removed}`}</Text></Box> : null,
    ]
    const line = toggleLine(
      { Box, Button },
      'toggle-tool',
      isFailed ? THEME.alert : THEME.border,
      isOpen,
      fit(toolLabel(e.props.tool, e.props.input, 0, 0), widthOf(e) - 16 - (when ? WHEN_WIDTH : 0)),
      () => flip($, 'tools', e.props.tool_use_id),
      stats,
    )
    // Start time and duration lead the line, in a fixed-width column so the labels stay aligned.
    const timed = when ? (
      <Box key="toggle-tool-timed" flexDirection="row">
        <Box key="toggle-tool-time-col" flexShrink={0} width={WHEN_WIDTH}>{timePill({ Box, Text }, 'toggle-tool-time', when)}</Box>
        {line}
      </Box>
    ) : line
    const body = isOpen ? [timed, nested({ Box, Client }, 'toggle-tool-row', await next(e), { kind: 'tools', id: e.props.tool_use_id })] : timed
    return place === 'card' ? slice({ Box, Client }, 'toggle-card', THEME.accent, body, { kind: 'turns', id: turn!.prompt }) : <Box key="toggle-tool-plain" flexDirection="column">{body}</Box>
  })

  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    if (isLoaded) log.claim(e.requestId, 'row')
    const turn = log.turnOf(e.requestId)
    seen.set(`ToolResult ${e.requestId}`, Boolean(turn))
    const { Box, Client } = $.ui.resolve(e)
    const place = await placeOf($, turn, e.requestId)
    if (place === 'hidden' || (foldTools && !isLive(turn) && !(await opened($, 'tools')).includes(e.props.tool_use_id))) return <Box key="toggle-hidden" />

    const body = nested({ Box, Client }, 'toggle-result', await next(e), { kind: 'tools', id: e.props.tool_use_id })
    return place === 'card' ? slice({ Box, Client }, 'toggle-card', THEME.accent, body, { kind: 'turns', id: turn!.prompt }) : body
  })

  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const id = e.props.calls.find(call => call.tool_use_id)?.tool_use_id ?? e.requestId
    const turn = log.turnOf(id)
    seen.set(`ToolGroup ${e.requestId}`, Boolean(turn))
    const place = await placeOf($, turn, id)
    if (place === 'plain') return next(e)

    const { Box, Client } = $.ui.resolve(e)
    return place === 'hidden' ? <Box key="toggle-hidden" /> : slice({ Box, Client }, 'toggle-card', THEME.accent, await next(e), { kind: 'turns', id: turn!.prompt })
  })

  on('ui.render', { component: 'TurnDuration' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    if (isLoaded) log.claim(e.requestId, 'row')
    const turn = log.turnOf(e.requestId)
    seen.set(`TurnDuration ${e.requestId}`, Boolean(turn))
    if ((await placeOf($, turn, e.requestId)) !== 'hidden') return next(e)

    const { Box } = $.ui.resolve(e)
    return <Box key="toggle-hidden" />
  })
}
