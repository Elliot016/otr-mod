import type { ConfigValue, EngineInterface, Register, RenderElement } from 'claude-code'

import type { BarMessage, BarProps } from './bar'
import type { Chip, ChipsMessage, ChipsProps } from './chips'
import { copyWidth, type CopyMessage, type CopyProps } from './copy'
import type { EdgeProps } from './edge'
import type { DotProps } from './dot'
import type { FoldProps } from './fold'
import type { LabelPart, LabelProps } from './label'
import { isNerdFace, lookFor, terminalSettings, type IconMode, withMark } from './look'
import { tabRow } from './pills'
import { settingChoice, settingsBody, type Action, type Previews } from './settings'
import style from './style'
import text from './text'
import { tokenizeLine, type Role } from './shell'
import { CAPS, fill, MARK, statusColor, SYNTAX, THEME } from './theme'
import { copyChoices, copyText, type CopyChoice } from './clip'
import { callTime, diffStat, elapsed, isPrompt, rowKey, timeOfDay, toolLabel, turnKinds, turnLine, turnThoughts, TurnLog, type Turn } from './turns'

let transcript = ''
let log = new TurnLog()
let isLoaded = false
// Until the transcript is read, turns come from the in-memory messages: a row that folds later off screen keeps its height and eats the scroll.
let guessing: Promise<void> | null = null
const guess = ($: EngineInterface) =>
  (guessing ??= $.session.messages().then(messages => {
    if (!isLoaded) log = TurnLog.fromMessages(messages)
  }).catch(() => {
    // Without the messages, rows draw as before: unfolded until the transcript is read.
  }))
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

// `/mod-transcript settings` toggles the panel; an unplaced pane is waiting, not open.
async function toggleSettings($: EngineInterface) {
  if (await isPaneOpen($)) {
    await $.ui.close({ id: PANE })
    await $.state.set({ plugin: 'mod-transcript', key: 'pane' }, false)
    return
  }
  note = ''
  const showcase = await $.fs.read(`${$.plugin.root}/showcase.json`).then(text => JSON.parse(String(text))).catch(() => null)
  previews = showcase?.previews
  actions = (Array.isArray(showcase?.actions) ? showcase.actions : []).map((action: Action) => ({ ...action, isLocal: action.command === 'mod-transcript' }))
  const result = await $.ui.open({ id: PANE, title: text.panePlacedTitle, closeOnEscape: true })
  if (!result.isPlaced) $.ui.toast(fill(text.paneWaiting, { reason: String(result.reason) }))
  await $.state.set({ plugin: 'mod-transcript', key: 'pane' }, result.isPlaced)
}

// Read once, since a long session's file is large (past $.fs.read's cap it streams through the file printer); later rows are claimed as they render.
async function load($: EngineInterface) {
  if (isLoaded) return
  if (!transcript) transcript = String((await $.store.get(`transcript:${await $.session.id()}`)) ?? '')
  if (!transcript) transcript = await findTranscript($)
  // A new session's transcript is empty or not written yet: nothing to read, its rows join the empty log as they draw.
  const size = transcript ? ((await $.fs.stat(transcript).catch(() => null))?.size ?? 0) : 0
  let text = size ? String(await $.fs.read(transcript).catch(() => '')) : ''
  if (size && !text) {
    const isWindows = /^[A-Za-z]:|\\/.test(transcript)
    // cmd's type rejects forward slashes ("The syntax of the command is incorrect").
    const argv = isWindows ? ['cmd', '/c', 'type', transcript.replace(/\//g, '\\')] : ['cat', transcript]
    for await (const chunk of $.process.spawn({ argv })) {
      if (chunk.stream === 'stdout') text += chunk.text
    }
    if (!text) return
  }
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
  const value = (kind === 'turns' ? await $.state.get({ plugin: 'mod-transcript', key: 'turns' }) : await $.state.get({ plugin: 'mod-transcript', key: 'tools' })).value
  return Array.isArray(value) ? value : []
}

async function flip($: EngineInterface, kind: Kind, id: string) {
  const list = await opened($, kind)
  const value = list.includes(id) ? list.filter(open => open !== id) : [...list, id]
  if (kind === 'turns') await $.state.set({ plugin: 'mod-transcript', key: 'turns' }, value)
  else await $.state.set({ plugin: 'mod-transcript', key: 'tools' }, value)
}

const fit = (text: string, width: number) => {
  const flat = text.replace(/\s+/g, ' ')
  return flat.length > width ? `${flat.slice(0, Math.max(0, width - 1))}…` : flat
}

// A Text inside the card overflows instead of wrapping, so long lines break at word boundaries here.
const wrapWords = (line: string, width: number) => {
  const rows: string[] = []
  let row = ''
  for (const word of line.split(' ')) {
    if (row && row.length + 1 + word.length > width) {
      rows.push(row)
      row = word
    } else row = row ? `${row} ${word}` : word
  }
  return [...rows, row]
}

// `11:32 · 6m 12s` with its two caps and a space: the widest start-and-duration a tool line shows.
const WHEN_WIDTH = 18

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

const edge = ({ Box, Client }: Bars, key: string, props: EdgeProps) =>
  props.kind === 'top' || props.kind === 'bottom' ? (
    <Box key={key} height={1}>
      <Client key={`${key}-edge`} module="./edge.tsx" width="100%" height={1} props={props} />
    </Box>
  ) : (
    // Absolute, so the lines it draws for the last height never stretch the row they measure.
    <Box key={key} width={1} flexShrink={0}>
      <Box key={`${key}-pin`} position="absolute" top={0} left={0} width={1} height="100%">
        <Client key={`${key}-edge`} module="./edge.tsx" width={1} height="100%" props={props} />
      </Box>
    </Box>
  )

// A finished turn with tools opens its bubble at the head under the prompt; its card rows and its reply carry on inside.
const hasHead = (turn: Turn) => isDone(turn) && turn.tools.length > 0

function frame({ Box, Client }: Bars, key: string, body: unknown, isTop: boolean, isBottom: boolean, isTight = false, turn?: Turn) {
  const parts = { Box, Client }
  return (
    <Box key={key} flexDirection="column" flexGrow={1}>
      {isTop ? edge(parts, `${key}-top`, { kind: 'top', color: THEME.accent, wedge: true }) : null}
      <Box key={`${key}-sides`} flexDirection="row">
        {edge(parts, `${key}-left`, { kind: 'side', color: THEME.accent })}
        <Box key={`${key}-body`} flexDirection="column" flexGrow={1} paddingX={isTight ? 0 : 1}>{body}</Box>
        {edge(parts, `${key}-right`, { kind: 'side', color: THEME.accent })}
      </Box>
      {isBottom ? closing(parts, `${key}-bottom`, turn) : null}
    </Box>
  )
}

// An unfolded finished turn's row, inside the bubble its head opened.
const cardRow = (parts: Bars, body: unknown, fold: BarProps) => frame(parts, 'toggle-frame', slice(parts, 'toggle-card', THEME.accent, body, fold), false, false)

// Rows draw in no fixed order, so the prompt and duration rows carry the edges; a finished turn's reply closes it.
function bubble(parts: Bars, key: string, turn: Turn, body: unknown, isTool = false, isTight = false) {
  const { Box } = parts
  // Claude Code starts each row with a blank line; in a tool row it rides out of the band, where it paints nothing.
  const inner = isTool ? (
    <Box key={`${key}-band`} flexDirection="row" flexGrow={1} marginTop={1} backgroundColor={THEME.surface1}>
      {edge(parts, `${key}-rail`, { kind: 'rail', color: THEME.accent })}
      <Box key={`${key}-tool`} flexDirection="column" flexGrow={1} paddingLeft={1} marginTop={-1}>{body}</Box>
    </Box>
  ) : body
  return frame(parts, key, inner, false, isDone(turn), isTight, turn)
}

// Claude Code sizes a markdown table to the whole terminal, so a block holding one drops the bubble's padding to fit it.
const hasTable = (text: string) => /^\s*\|.*\|\s*$/m.test(text) && /^\s*\|?\s*:?-{3,}/m.test(text)

// A turn has ended once a later prompt follows it, its duration is stored, or Claude went idle after it.
const hasEnded = (turn: Turn) => turn !== log.turns[log.turns.length - 1] || turn.durationMs !== undefined || turn.prompt === endedPrompt

// The copy pill, once the turn has ended with a reply to copy.
function copyPill({ Box, Client }: Bars, turn: Turn) {
  const choices = copyChoices(turn.replyText)
  if (!hasEnded(turn) || !choices.length) return null
  const props: CopyProps = { id: turn.prompt, choices: choices.map(what => ({ what, label: text.copyChoice[what] })), icon: look.glyph.copy, copied: text.copied, bg: style.colors.pills.secondary, nerd: look.nerd, lead: { char: '─', color: THEME.accent } }
  return (
    <Box key="toggle-copy" flexShrink={0}>
      <Client key="toggle-copy-pill" module="./copy.tsx" width={copyWidth(props)} height={1} props={props} />
    </Box>
  )
}

// Claude's bubble opens under the prompt: as the head of a finished turn with tools, else as a bare top edge.
const opening = (parts: Bars) => edge(parts, 'toggle-bubble-open', { kind: 'top', color: THEME.accent, wedge: true })

// The bubble's bottom edge, under the newest output, carries the copy pill near its corner once the turn has ended.
function closing(parts: Bars, key: string, turn: Turn | undefined) {
  const { Box } = parts
  const copy = turn ? copyPill(parts, turn) : null
  if (!copy) return edge(parts, key, { kind: 'bottom', color: THEME.accent })
  return (
    <Box key={`${key}-row`} flexDirection="row" height={1}>
      <Box key={`${key}-run`} flexGrow={1}>{edge(parts, key, { kind: 'bottom', color: THEME.accent, open: 'end' })}</Box>
      {copy}
      <Box key={`${key}-corner`} width={2} flexShrink={0}>{edge(parts, `${key}-end`, { kind: 'bottom', color: THEME.accent, open: 'start' })}</Box>
    </Box>
  )
}

type Controls = Elements & { Button: (props: any) => RenderElement }

// A fold control: a colored pill showing + or the minus sign, then the line's text; a click on either toggles.
// Without a Nerd Font the pill's ends are a space each, so the chip takes three cells either way.
// A label given as colored `parts` is a Client that folds on click; a plain one stays a Button.
const toggleLine = ({ Box, Button, Client }: Controls & { Client: (props: any) => RenderElement }, key: string, chip: string, isOpen: boolean, label: string, fold: BarProps, onPress: () => unknown, extra: unknown = null, parts?: LabelPart[]) => (
  <Box key={key} flexDirection="row" columnGap={1}>
    <Box key={`${key}-chip-pill`} flexShrink={0}>
      <Client key={`${key}-chip`} module="./fold.tsx" width={3} height={1} props={{ ...fold, color: chip, isOpen, nerd: look.nerd, still: false } satisfies FoldProps} />
    </Box>
    <Box key={`${key}-label`} flexShrink={1}>
      {parts ? (
        <Client key={`${key}-colored`} module="./label.tsx" width={partsWidth(parts)} height={1} props={{ ...fold, parts, isDim: !isOpen, hover: THEME.accent } satisfies LabelProps} />
      ) : (
        <Button key={`${key}-button`} label={label} plain dimColor={!isOpen} hover={{ scope: `${key}-label`, color: THEME.accent }} onPress={onPress} />
      )}
    </Box>
    {extra}
  </Box>
)

// Blast-radius's Moonlight roles for a shell command: the command word bold, then options, quoted text, variables, numbers and operators.
const ROLE_LOOK: Partial<Record<Role, Omit<LabelPart, 'text'>>> = {
  command: { color: SYNTAX.command, bold: true },
  option: { color: SYNTAX.option },
  text: { color: SYNTAX.text },
  variable: { color: SYNTAX.variable },
  number: { color: SYNTAX.number },
  operator: { color: SYNTAX.operator },
}

const commandParts = (command: string): LabelPart[] => tokenizeLine(command).map(span => ({ text: span.text, ...ROLE_LOOK[span.role] }))

const partsWidth = (parts: LabelPart[]) => parts.reduce((sum, part) => sum + [...part.text].length, 0)

// A tool's one-line label, cut to `width`; a Bash call's command keeps its shell colors.
function labelParts(name: string, input: any, width: number): LabelPart[] {
  const label = fit(toolLabel(name, input, 0, 0), width)
  if (name !== 'Bash' || !label.startsWith('Bash(')) return [{ text: label }]
  const isClosed = label.endsWith(')')
  return [{ text: 'Bash(' }, ...commandParts(label.slice('Bash('.length, isClosed ? -1 : undefined)), ...(isClosed ? [{ text: ')' }] : [])]
}

// A Bash call under the Ran chip: the fold glyph and the colored command, spaced like the plain call lines beside it.
function callParts(call: Turn['tools'][number], isOpen: boolean, width: number): LabelPart[] {
  const glyph = isOpen ? look.glyph.expanded : look.glyph.collapsed
  const isLifted = look.nerd && isOpen
  return [{ text: isLifted ? `${glyph} ` : ` ${glyph} ` }, ...labelParts(call.name, call.input, width - 28), ...(isLifted ? [] : [{ text: ' ' }])]
}

// Claude Code's own Bash row, drawn here so the command keeps its colors; the blank first line stands in for the one the tool band lifts away.
function bashRow({ Box, Client, Text }: Rows, input: any, isRunning: boolean, isFailed: boolean) {
  const command = String(input?.command ?? '')
  const dot = isRunning
    ? <Client key="bash-dot" module="./dot.tsx" width={1} height={1} props={{ color: THEME.accent, dim: THEME.border, still: false } satisfies DotProps} />
    : <Text key="bash-dot" color={isFailed ? THEME.alert : THEME.good}>●</Text>
  return (
    <Box key="bash-row" flexDirection="column">
      <Text key="bash-blank"> </Text>
      <Box key="bash-head" flexDirection="row" columnGap={1}>
        {dot}
        <Text key="bash-description" bold>{String(input?.description || 'Bash')}</Text>
      </Box>
      {command.split('\n').map((line, n) => (
        <Box key={`bash-line-${n}`} flexDirection="row" paddingLeft={2}>
          <Text key="bash-lead" color={THEME.muted}>{n === 0 ? '└ $ ' : '    '}</Text>
          <Box key="bash-command" flexShrink={1}>
            <Text>
              {commandParts(line).map((part, at) => (
                <Text key={`part-${at}`} color={part.color ?? THEME.onSurface} bold={part.bold}>{part.text}</Text>
              ))}
            </Text>
          </Box>
        </Box>
      ))}
    </Box>
  )
}

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

type Rows = Bars & { Text: (props: any) => RenderElement }

// Lines added and removed as one pill on the card; plain colored text where the font has no caps.
function countsPill({ Box, Text }: Pick<Rows, 'Box' | 'Text'>, key: string, added: number, removed: number) {
  if (!added && !removed) return null
  const parts = [added ? <Text key={`${key}-added`} color={THEME.good}>{`+${added}`}</Text> : null, removed ? <Text key={`${key}-removed`} color={THEME.alert}>{`${added ? ' ' : ''}−${removed}`}</Text> : null]
  if (!look.nerd) return <Box key={key} flexDirection="row" flexShrink={0}>{parts}</Box>
  return (
    <Box key={key} flexDirection="row" flexShrink={0}>
      <Text color={THEME.surface3}>{CAPS.left}</Text>
      <Box key={`${key}-body`} flexDirection="row" backgroundColor={THEME.surface3}>{parts}</Box>
      <Text color={THEME.surface3}>{CAPS.right}</Text>
    </Box>
  )
}

// One open chip per turn: picking another closes the first, picking the open one closes it.
async function pickChip($: EngineInterface, turnId: string, kind: string) {
  const list = await opened($, 'tools')
  const key = `${turnId}:${kind}`
  const others = list.filter(open => !open.startsWith(`${turnId}:`))
  await $.state.set({ plugin: 'mod-transcript', key: 'tools' }, list.includes(key) ? others : [...others, key])
}

// An open turn's work under its head: a line of kind chips (Thought first, then each kind in order of first use) and, under the picked one, its calls or its thinking.
// onCall opens or closes one call: its own row then shows under the list, in the turn's order.
function chipSection({ Box, Button, Client, Text }: Rows & { Button: (props: any) => RenderElement }, turn: Turn, openTools: string[], width: number, onCall: (id: string) => unknown) {
  // Claude Code's drawing reaches a mod sealed, so the thinking comes from the session's messages, without its time.
  const thoughts = turnThoughts(turn)
  const kinds = turnKinds(turn)
  const isOpen = (kind: string) => openTools.includes(`${turn.prompt}:${kind}`)
  const chips: Chip[] = [
    ...(thoughts.length ? [{ kind: 'thinking' as const, mark: look.glyph.mark.thinking, label: text.thought, count: thoughts.length, added: 0, removed: 0, isOpen: isOpen('thinking') }] : []),
    ...kinds.map(group => ({ kind: group.kind, mark: look.glyph.mark[group.kind], label: text.kindChip[group.kind], count: group.calls.length, added: group.added, removed: group.removed, isOpen: isOpen(group.kind) })),
  ]
  const picked = chips.find(chip => chip.isOpen)
  const bar = picked ? style.colors.kinds[picked.kind].hue : THEME.border
  const line = (key: string, body: unknown, time = '') => (
    <Box key={key} flexDirection="row">
      <Box key={`${key}-line`} flexDirection="row" columnGap={1} flexGrow={1} flexShrink={1}>{body}</Box>
      {showTimes && time ? timePill({ Box, Text }, `${key}-time`, time, THEME.surface3) : null}
    </Box>
  )
  const thoughtLines = thoughts.filter(Boolean).join('\n\n').split('\n').flatMap(paragraph => wrapWords(paragraph, width - 8))
  // An open call's preview under its line: diff lines on Claude Code's add and remove backgrounds, any other output muted.
  const preview = (call: Turn['tools'][number], n: number) => {
    const shown = call.preview?.lines ?? []
    const more = call.preview?.more ?? 0
    return (
      <Box key={`toggle-call-${n}-preview`} flexDirection="column" paddingLeft={3}>
        {shown.length === 0 ? <Text key="none" color={THEME.muted}>{text.previewEmpty}</Text> : null}
        {shown.map((previewLine, at) => {
          const mark = previewLine.kind === 'add' ? '+ ' : previewLine.kind === 'del' ? '- ' : previewLine.kind === 'same' ? '  ' : ''
          const background = previewLine.kind === 'add' ? { backgroundColor: THEME.addBg } : previewLine.kind === 'del' ? { backgroundColor: THEME.delBg } : {}
          return (
            <Text key={`line-${at}`} color={previewLine.kind === 'out' ? THEME.muted : THEME.onSurface} wrap="truncate-end" {...background}>
              {fit(`${mark}${previewLine.text}`, width - 10) || ' '}
            </Text>
          )
        })}
        {more > 0 ? <Text key="more" color={THEME.muted}>{fill(text.previewMore, { n: more })}</Text> : null}
      </Box>
    )
  }
  const calls = (kind: string) =>
    kinds.find(group => group.kind === kind)?.calls.flatMap((call, n) => [
      line(
        `toggle-call-${n}`,
        [
          // The open call lifts, as a picked chip does; the others stay dim until the pointer lights them.
          // The open call is a lifted pill whose ends take the spaces around the label, so lines keep one width.
          <Box key={`toggle-call-${n}-line`} flexDirection="row" flexShrink={1}>
            {look.nerd && openTools.includes(call.id) ? <Text color={THEME.lifted}>{CAPS.left}</Text> : null}
            <Box key={`toggle-call-${n}-pick`} flexShrink={1} {...(openTools.includes(call.id) ? { backgroundColor: THEME.lifted } : {})}>
              {call.name === 'Bash' ? (
                <Client
                  key={`toggle-call-${n}-colored`}
                  module="./label.tsx"
                  height={1}
                  width={partsWidth(callParts(call, openTools.includes(call.id), width))}
                  props={{ kind: 'tools', id: call.id, parts: callParts(call, openTools.includes(call.id), width), isDim: !openTools.includes(call.id), hover: THEME.accent } satisfies LabelProps}
                />
              ) : (
                <Button
                  key={`toggle-call-${n}-button`}
                  label={look.nerd && openTools.includes(call.id) ? `${look.glyph.expanded} ${fit(toolLabel(call.name, call.input, 0, 0), width - 28)}` : ` ${openTools.includes(call.id) ? look.glyph.expanded : look.glyph.collapsed} ${fit(toolLabel(call.name, call.input, 0, 0), width - 28)} `}
                  plain
                  dimColor={!openTools.includes(call.id)}
                  hover={{ scope: `toggle-call-${n}-pick`, color: THEME.accent }}
                  onPress={() => onCall(call.id)}
                />
              )}
            </Box>
            {look.nerd && openTools.includes(call.id) ? <Text color={THEME.lifted}>{CAPS.right}</Text> : null}
          </Box>,
          countsPill({ Box, Text }, `toggle-call-${n}-counts`, call.added, call.removed),
        ],
        call.startedAt !== undefined && call.endedAt !== undefined ? elapsed(call.endedAt - call.startedAt) : '',
      ),
      ...(openTools.includes(call.id) ? [preview(call, n)] : []),
    ]) ?? []
  const body = !picked
    ? null
    : picked.kind === 'thinking'
      ? thoughtLines.some(Boolean)
        ? thoughtLines.map((thoughtLine, n) => <Text key={`toggle-thought-${n}`} color={THEME.muted}>{thoughtLine || ' '}</Text>)
        : <Text key="toggle-thought-none" color={THEME.muted}>{text.thoughtNoText}</Text>
      : calls(picked.kind)
  return [
    <Box key="toggle-chips" height={1}>
      <Client key="toggle-chips-line" module="./chips.tsx" height={1} props={{ id: turn.prompt, chips, nerd: look.nerd } satisfies ChipsProps} />
    </Box>,
    body ? (
      <Box key="toggle-picked" flexDirection="row">
        <Box key="toggle-picked-bar" width={1} flexShrink={0} backgroundColor={bar} />
        <Box key="toggle-picked-body" flexDirection="column" flexGrow={1} paddingLeft={1}>{body}</Box>
      </Box>
    ) : null,
  ]
}

// What `/mod-transcript <args>` does; the panel's own actions call it directly, since $.command.run skips the calling plugin.
async function answer($: EngineInterface, args: string) {
  if (args.trim() === 'settings') {
    await toggleSettings($)
    return ''
  }
  if (args.trim() === 'debug') {
    const temp = ((await $.env.get('TEMP')) ?? (await $.env.get('TMPDIR')) ?? '/tmp').replace(/\\/g, '/')
    const rows = [...seen].map(([row, isPlaced]) => `${isPlaced ? 'placed  ' : 'unplaced'} ${row}`)
    await $.fs.write(`${temp}/mod-transcript-ids.txt`, `${log.turns.length} turns\n${rows.join('\n')}\n`)
    return `${rows.length} drawn rows written to ${temp}/mod-transcript-ids.txt`
  }
  const flippedNow = await opened($, 'turns')
  const done = log.turns.filter(isDone)
  const isAnyOpen = done.some(turn => isTurnOpen(flippedNow, turn))
  // Folding all clears the flips when turns fold by default, and flips every turn when they open by default.
  const flipAll = isAnyOpen !== foldTurns
  await $.state.set({ plugin: 'mod-transcript', key: 'turns' }, flipAll ? done.map(turn => turn.prompt) : [])

  return isAnyOpen ? text.noteFolded : text.noteUnfolded
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

// A time as a rounded pill, like the omp transient prompt; plain muted text where the font has no caps.
function timePill({ Box, Text }: { Box: (props: any) => RenderElement; Text: (props: any) => RenderElement }, key: string, time: string, fill: string = THEME.surface2) {
  if (!look.nerd) return <Box key={key} flexShrink={0}><Text color={THEME.muted}>{`${time} `}</Text></Box>
  return (
    <Box key={key} flexDirection="row" flexShrink={0}>
      <Text color={fill}>{CAPS.left}</Text>
      <Box key={`${key}-body`} backgroundColor={fill}><Text color={THEME.muted}>{time}</Text></Box>
      <Text color={fill}>{`${CAPS.right} `}</Text>
    </Box>
  )
}

// A settings card's click: its row, saved through /config; a saved change reloads this mod.
async function saveSetting($: EngineInterface, key: string, value: ConfigValue) {
  const row = (await $.config.list()).find(each => each.key === key)
  if (!row) return
  const result = await $.config.set({ key: row.key, value })
  note = 'deny' in result && result.deny ? `${MARK.warn} ${result.deny}` : `${MARK.ok} ${fill(text.noteSettingSaved, { label: row.label })}`
  $.ui.invalidate('ui.render')
}

export const register: Register = (on, options) => {
  iconMode = (options.icons as IconMode | undefined) ?? 'auto'
  look = lookFor(iconMode === 'nerd')
  foldTurns = options.fold_turns !== false
  foldTools = options.fold_tools !== false
  showTimes = options.timestamps !== false
  expandLive = options.expand_live !== false

  on('session.start', async ($, e, next) => {
    await loadLook($)
    await $.command.register({
      name: 'mod-transcript',
      description: text.commandDescription,
      argumentHint: '[settings|debug]',
    })
    await $.state.set({ plugin: 'mod-transcript', key: 'pane' }, await isPaneOpen($))
    await load($)

    return next(e)
  })

  // A click on a card's strip folds the turn or tool it runs beside.
  on('ui.message', async ($, e, next) => {
    const change = settingChoice(e.data)
    if (change) await saveSetting($, change.key, change.value)
    const message = e.data as BarMessage
    if (message?.type === 'fold') await flip($, message.kind, message.id)
    const picked = e.data as ChipsMessage
    if (picked?.type === 'chip') await pickChip($, picked.id, picked.kind)
    const copy = e.data as CopyMessage
    if (copy?.type === 'copy') {
      const turn = log.turns.find(each => each.prompt === copy.id)
      const result = turn ? await $.ui.copy({ text: copyText(turn.replyText ?? '', copy.what as CopyChoice), surface: e.surface }) : { isCopied: false, reason: text.copyNoTurn }
      if (!result.isCopied) $.ui.toast(fill(text.copyFailed, { reason: String('reason' in result ? result.reason : '') }))
    }

    return next(e)
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) await $.state.set({ plugin: 'mod-transcript', key: 'pane' }, false)

    return next(e)
  })

  // One panel at a time: another mod's pane opening closes this one, deferred past that plugin's dispatch.
  on('state.set', async ($, e, next) => {
    if (e.key === 'pane' && e.plugin !== 'mod-transcript' && e.value === true) {
      $.clock.after(0, async () => {
        if (!(await isPaneOpen($))) return
        await $.ui.close({ id: PANE })
        await $.state.set({ plugin: 'mod-transcript', key: 'pane' }, false)
      })
    }

    return next(e)
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    await loadLook($)
    if (e.requestId !== PANE) return next(e)

    const { Box, Button, Client, Text } = $.ui.resolve(e)
    const rows = (await $.config.list()).filter(row => row.key.startsWith('mod-transcript.'))
    // A saved change reloads this mod, which redraws the panel with the new value.
    const run = async (action: Action) => {
      const said =
        action.command === 'mod-transcript'
          ? answer($, action.args ?? '')
          : $.command.run({ command: action.command, args: action.args ?? '' }).then(() => fill(text.noteCommandRan, { command: [action.command, action.args].filter(Boolean).join(' ') }))
      note = await said.then(text => `${MARK.ok} ${text || action.label}`).catch(error => `${MARK.warn} ${String(error)}`)
      $.ui.invalidate('ui.render')
    }

    return (
      <Box flexDirection="column" backgroundColor={THEME.bg} paddingX={1} minHeight={e.props.scroll.bodyRows}>
        {tabRow({ Box, Client, Text }, look.nerd, [{ id: 'mod-transcript-settings-tab', label: `${text.paneHeading} ${MARK.sep} ${text.paneSubheading}`, icon: look.glyph.gear, isOpen: true }], false)}
        <Text wrap="truncate-end" color={statusColor(note)}>{withMark(look, note) || `${text.paneHintClick} ${MARK.sep} ${text.paneHintSaved}`}</Text>
        <Box marginTop={0}>{settingsBody({ Box, Button, Client, Text }, look, { rows, actions, working, run, previews, still: false })}</Box>
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
      guessing = null
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
      const messages = await $.session.messages({ as: 'api' }).catch(() => null)
      if (Array.isArray(messages)) log.learnThoughts(messages)
      $.ui.invalidate('ui.render')
    }

    return next(e)
  })

  on('command.run', { command: 'mod-transcript' }, async ($, e) => ({ text: await answer($, e.args) }))

  // The prompt row carries the card's head: one line naming what the turn did, which a click folds or unfolds.
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    await loadLook($)
    if (e.surface !== 'terminal') return next(e)
    // A subagent's report opens a turn of its own, as in the transcript.
    if (isLoaded && (e.props.origin.kind === 'peer' || (e.props.origin.kind === 'composer' && isPrompt(e.props.text)))) log.claim(e.requestId, 'prompt')
    if (e.props.origin.kind !== 'composer') return next(e)
    if (!isLoaded && e.props.origin.kind === 'composer') {
      await guess($)
      log.adopt(e.requestId, 'prompt', e.props.text)
    }
    const turn = log.turnAt(e.requestId)
    seen.set(`UserMessage ${e.requestId}`, Boolean(turn))
    const { Box, Button, Client, Text } = $.ui.resolve(e)
    const prompt = await next(e)
    // The wedge is an absolute sibling: Claude Code refuses its row under a positioned Box.
    const row = (
      <Box key="toggle-prompt-row" flexDirection="row" flexGrow={1} justifyContent="flex-end" backgroundColor={THEME.bg}>
        <Box key="toggle-prompt-bubble" flexDirection="column" flexShrink={1}>
          <Box key="toggle-prompt-outline" flexDirection="row" borderStyle="round" borderColor={THEME.secondary}>
            {showTimes && turn?.at !== undefined ? (
              // The column takes the prompt's background (Moonlight userMessageBackground) down every wrapped line; the pill stays one row tall.
              <Box key="toggle-prompt-time-col" flexShrink={0} alignItems="flex-start" backgroundColor={THEME.surface2}>
                {timePill({ Box, Text }, 'toggle-prompt-time', timeOfDay(turn.at), THEME.surface3)}
              </Box>
            ) : showTimes && turn ? (
              // A guessed turn has no time until the transcript is read; the space keeps the prompt's wrap, so its height holds.
              <Box key="toggle-prompt-time-col" flexShrink={0} width={look.nerd ? 8 : 6} backgroundColor={THEME.surface2} />
            ) : null}
            <Box key="toggle-prompt-lift" flexDirection="column" flexShrink={1} marginTop={-1}>{prompt}</Box>
          </Box>
          <Box key="toggle-prompt-wedge" position="absolute" top={0} right={0}>
            <Text color={THEME.secondary}>◥</Text>
          </Box>
        </Box>
      </Box>
    )
    if (!turn) return row
    if (!hasHead(turn)) return <Box key="toggle-prompt" flexDirection="column" flexGrow={1}>{row}{opening({ Box, Client })}</Box>

    const isOpen = isTurnOpen(await opened($, 'turns'), turn)
    // The head: what the turn did, then its line counts and how long it took, each a pill.
    const added = turn.tools.reduce((sum, call) => sum + call.added, 0)
    const removed = turn.tools.reduce((sum, call) => sum + call.removed, 0)
    const head = (
      <Box key="toggle-head-line" flexDirection="row" columnGap={1}>
        {toggleLine({ Box, Button, Client }, 'toggle-turn', THEME.accent, isOpen, fit(turnLine(turn), widthOf(e) - 30), { kind: 'turns', id: turn.prompt }, () => flip($, 'turns', turn.prompt))}
        {countsPill({ Box, Text }, 'toggle-head-counts', added, removed)}
        {turn.durationMs !== undefined ? timePill({ Box, Text }, 'toggle-head-time', fill(text.turnTook, { time: elapsed(turn.durationMs) }), THEME.surface3) : null}
      </Box>
    )
    const kinds = isOpen && foldTools ? chipSection({ Box, Button, Client, Text }, turn, await opened($, 'tools'), widthOf(e), id => flip($, 'tools', id)) : null
    return (
      <Box key="toggle-prompt" flexDirection="column" flexGrow={1}>
        {row}
        {frame({ Box, Client }, 'toggle-head-frame', slice({ Box, Client }, 'toggle-head', isOpen ? THEME.accent : THEME.border, [head, kinds], { kind: 'turns', id: turn.prompt }), true, false)}
      </Box>
    )
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    await loadLook($)
    if (e.surface !== 'terminal') return next(e)
    if (isLoaded) log.claim(e.requestId, 'reply')
    else {
      await guess($)
      log.adopt(e.requestId, 'text', e.props.text)
    }
    const turn = log.turnOf(e.requestId)
    seen.set(`AssistantMessage ${e.requestId}`, Boolean(turn))
    // A reply drawn live is newer than the transcript the log read; the copy pill hands over what it says.
    if (turn && rowKey(e.requestId) === turn.reply && e.props.text.trim()) turn.replyText = e.props.text.trim()
    const place = await placeOf($, turn, e.requestId)
    const { Box, Client } = $.ui.resolve(e)
    if (place === 'plain') return turn ? bubble({ Box, Client }, 'toggle-bubble', turn, await next(e), false, hasTable(e.props.text)) : next(e)

    return place === 'hidden' ? <Box key="toggle-hidden" /> : cardRow({ Box, Client }, await next(e), { kind: 'turns', id: turn!.prompt })
  })

  // A finished tool row folds to one line of its own; a click shows Claude Code's full row and result under it.
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    await loadLook($)
    if (e.surface !== 'terminal') return next(e)
    if (isLoaded) log.claimCall(e.props.tool_use_id, e.props.tool, e.props.input, e.props.isRunning, e.props.output, e.props.isErrored || e.props.isInterrupted)
    else {
      await guess($)
      log.follow(e.props.tool_use_id)
    }
    const turn = log.turnOf(e.requestId)
    seen.set(`ToolUse ${e.requestId}`, Boolean(turn))
    const { Box, Button, Client, Text } = $.ui.resolve(e)
    const place = await placeOf($, turn, e.requestId)
    // In an open turn the head's kind rows list every call, so the row itself draws nothing.
    if (place === 'hidden' || (place === 'card' && foldTools)) return <Box key="toggle-hidden" />
    const inBubble = (body: unknown) => (turn ? bubble({ Box, Client }, 'toggle-bubble', turn, body, true) : body)
    const isFailed = e.props.isErrored || e.props.isInterrupted
    if (e.props.isRunning || !foldTools || isLive(turn)) {
      const row = e.props.tool === 'Bash' ? bashRow({ Box, Client, Text }, e.props.input, e.props.isRunning, isFailed) : await next(e)
      return place === 'card' ? cardRow({ Box, Client }, row, { kind: 'turns', id: turn!.prompt }) : inBubble(row)
    }

    const { added, removed } = diffStat(e.props.tool, e.props.input, e.props.output, isFailed)
    const isOpen = (await opened($, 'tools')).includes(e.props.tool_use_id)
    const when = showTimes ? callTime(log.callOf(e.props.tool_use_id)) : ''
    const stats = [
      added ? <Box key="toggle-tool-added"><Text color={THEME.good}>{`+${added}`}</Text></Box> : null,
      removed ? <Box key="toggle-tool-removed"><Text color={THEME.alert}>{`−${removed}`}</Text></Box> : null,
    ]
    const line = toggleLine(
      { Box, Button, Client },
      'toggle-tool',
      isFailed ? THEME.alert : THEME.border,
      isOpen,
      fit(toolLabel(e.props.tool, e.props.input, 0, 0), widthOf(e) - 16 - (when ? WHEN_WIDTH : 0)),
      { kind: 'tools', id: e.props.tool_use_id },
      () => flip($, 'tools', e.props.tool_use_id),
      stats,
      e.props.tool === 'Bash' ? labelParts('Bash', e.props.input, widthOf(e) - 16 - (when ? WHEN_WIDTH : 0)) : undefined,
    )
    // Start time and duration lead the line, in a fixed-width column so the labels stay aligned.
    const timed = when ? (
      <Box key="toggle-tool-timed" flexDirection="row">
        <Box key="toggle-tool-time-col" flexShrink={0} width={WHEN_WIDTH}>{timePill({ Box, Text }, 'toggle-tool-time', when)}</Box>
        {line}
      </Box>
    ) : line
    const body = isOpen ? [timed, nested({ Box, Client }, 'toggle-tool-row', await next(e), { kind: 'tools', id: e.props.tool_use_id })] : timed
    return inBubble(<Box key="toggle-tool-plain" flexDirection="column">{body}</Box>)
  })

  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    await loadLook($)
    if (e.surface !== 'terminal') return next(e)
    if (isLoaded) log.claim(e.requestId, 'row')
    else {
      await guess($)
      log.follow(e.requestId)
    }
    const turn = log.turnOf(e.requestId)
    seen.set(`ToolResult ${e.requestId}`, Boolean(turn))
    const { Box, Client } = $.ui.resolve(e)
    const place = await placeOf($, turn, e.requestId)
    if (place === 'hidden' || (place === 'card' && foldTools) || (foldTools && !isLive(turn) && !(await opened($, 'tools')).includes(e.props.tool_use_id))) return <Box key="toggle-hidden" />

    const body = nested({ Box, Client }, 'toggle-result', await next(e), { kind: 'tools', id: e.props.tool_use_id })
    if (place === 'card') return cardRow({ Box, Client }, body, { kind: 'turns', id: turn!.prompt })
    return turn ? bubble({ Box, Client }, 'toggle-bubble', turn, body, true) : body
  })

  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    await loadLook($)
    if (e.surface !== 'terminal') return next(e)
    // A folded group's calls never draw rows of their own, so the group claims them for the turn.
    if (isLoaded) for (const call of e.props.calls) if (call.tool_use_id) log.claimCall(call.tool_use_id, call.tool, call.input, call.isRunning, call.output, call.isErrored || call.isInterrupted)
    // A group of thinking alone has no calls; it joins the turn by its own message id.
    if (isLoaded && e.props.calls.length === 0) log.claim(e.requestId.replace(/^collapsed-/, ''), 'row')
    const id = e.props.calls.find(call => call.tool_use_id)?.tool_use_id ?? e.requestId
    if (!isLoaded) {
      await guess($)
      if (e.props.calls.length === 0) log.adoptNear(e.requestId)
      else log.follow(id)
    }
    const turn = log.turnOf(id)
    seen.set(`ToolGroup ${e.requestId}`, Boolean(turn))
    const place = await placeOf($, turn, id)
    const { Box, Client, Text } = $.ui.resolve(e)
    // A group shows its running call while it runs; a Bash one is drawn here so its command keeps its colors.
    const running = e.props.calls.find(call => call.isRunning && call.tool === 'Bash')
    const group = running ? bashRow({ Box, Client, Text }, running.input, true, false) : await next(e)
    if (place === 'plain') return turn ? bubble({ Box, Client }, 'toggle-bubble', turn, group, true) : group

    // In an open turn the head's kind rows list every call, so the group draws nothing.
    if (place === 'hidden' || foldTools) return <Box key="toggle-hidden" />
    return cardRow({ Box, Client }, await next(e), { kind: 'turns', id: turn!.prompt })
  })

  on('ui.render', { component: 'TurnDuration' }, async ($, e, next) => {
    await loadLook($)
    if (e.surface !== 'terminal') return next(e)
    if (isLoaded) log.claim(e.requestId, 'row')
    else {
      await guess($)
      log.adoptNear(e.requestId)
    }
    const turn = log.turnOf(e.requestId)
    seen.set(`TurnDuration ${e.requestId}`, Boolean(turn))
    // A turn learned as it drew has no duration row from the transcript; this line carries it.
    if (turn && turn.durationMs === undefined && typeof e.props.durationMs === 'number') turn.durationMs = e.props.durationMs
    const place = await placeOf($, turn, e.requestId)
    const { Box, Client } = $.ui.resolve(e)
    if (place === 'hidden') return <Box key="toggle-hidden" />
    // The running turn's last line closes its bubble; a finished turn's reply closes its own.
    if (turn && !isDone(turn)) {
      return (
        <Box key="toggle-close" flexDirection="column">
          {closing({ Box, Client }, 'toggle-bubble-close', turn)}
          {await next(e)}
        </Box>
      )
    }
    return next(e)
  })
}
