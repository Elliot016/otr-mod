// mod-transcript / hooks/register.tsx, by v-amorim
// Registers the transcript's drawing, commands, settings pane and click handling with the engine.
import type { ConfigValue, EngineInterface, ModelApiError, Register, RenderElement } from 'claude-code'

import { cells, cut, fit, wrapWords } from './cells'
import type { BarMessage, BarProps } from './bar'
import type { Chip, ChipsMessage, ChipsProps } from './chips'
import { copyWidth, type CopyHoverMessage, type CopyMessage, type CopyProps, type CopyTipMessage } from './copy'
import type { EdgeProps } from './edge'
import type { DotProps } from './dot'
import type { FoldProps } from './fold'
import type { LabelPart, LabelProps } from './label'
import { pillWidth, type NumberProps } from './number'
import { isTipMessage, tipText, type Tip, type TipMessage } from './entry'
import { detectNerd, FOOTER_ROWS, lookFor, paneFooter, type IconMode, withMark } from './look'
import { pillRow, splitRow, tabRow, tipLine } from './pills'
import { settingChoice, settingsBody, type Action, type Previews } from './settings'
import style from './style'
import text from './text'
import { tokenizeLine, type Role } from './shell'
import { detectWedge, FILLED, OUTLINE, type Wedge } from './wedge'
import { CAPS, fill, MARK, statusColor, SYNTAX, THEME } from './theme'
import { copyChoices, copyText, type CopyChoice } from './clip'
import { markPieces, type Piece } from './mark'
import { callTime, diffStat, elapsed, isPrompt, rowKey, timeOfDay, toolLabel, turnKinds, turnLine, turnThoughts, TurnLog, type Turn } from './turns'
import { apiErrorAction, completeLines, hexColors, questionsOf, reportOf, senderTaskOf, statusesOf, withNotice, type Notice, type Report } from './rows'
import { bytesOf, CHUNK_BYTES, chunkArgv, utf8Length } from './tail'

let transcript = ''
let log = new TurnLog()
let isLoaded = false
// How many bytes of the transcript are fed, and whether its last line was still unfinished at the last read.
let fedBytes = 0
let isPartial = false
// The session the log belongs to. A /resume or /clear keeps the process and changes the id, so the old log must never draw the new rows.
let logSession = ''
// Until the transcript is read, turns come from the in-memory messages: a row that folds later off screen keeps its height and eats the scroll.
let guessing: Promise<void> | null = null
const guess = ($: EngineInterface) => {
  const session = logSession
  return (guessing ??= $.session.messages().then(messages => {
    if (!isLoaded && session === logSession) log = TurnLog.fromMessages(messages)
  }).catch(() => {
    // Without the messages, rows draw as before: unfolded until the transcript is read.
  }))
}
let working = false
// The agent whose transcript is on screen (the band's view); its rows are not the main conversation's turns.
let viewedAgent: string | undefined
// The engine's expanded view (ctrl+o, --verbose) draws every row in full, so the rows pass through there.
let isFullView = false
// Calls a hook or the person refused (PermissionDenied): an error the person chose, drawn neutral.
const declined = new Set<string>()
type ApiFailure = { error: ModelApiError; details: string; text: string }
// The API error that ended the last turn (StopFailure); the reply row with its text draws as one line.
let apiFailure: ApiFailure | null = null
// The person's settings (userConfig), fixed per activation: a change reloads the mod.
let foldTurns = true
let foldTools = true
let showTimes = true
let expandLive = true
let showCopy = true
let showNumbers = true
let iconMode: IconMode = 'auto'
let look = lookFor(false)
let wedge: Wedge = FILLED
type Kind = 'turns' | 'tools'
// Spike only: each drawn row's component and id, and whether the transcript parse placed it in a turn.
const seen = new Map<string, boolean>()
// Each task's notice, and the tasks with a report drawn; see taskRow.
const notices = new Map<string, Notice>()
const reported = new Set<string>()

const PANE = 'toggle-settings'
let actions: Action[] = []
let previews: Previews | undefined
let note = ''

// The control under the pointer, from its tip post: the band's tip row and the Settings footer show it.
let hovered: TipMessage | null = null
const hoveredTip = (): Tip | null => (hovered?.id && hovered.label ? { glyph: hovered.glyph ?? '', label: hovered.label, text: hovered.text ?? '' } : null)

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

// One fs.read takes a file up to this size.
const WHOLE_READ_BYTES = 4 * 1024 * 1024

// The text from byte `from` on ('' for none, null when unreadable); past one fs.read, only the first read streams the whole file.
async function readTranscript($: EngineInterface, from: number): Promise<{ text: string | null; size: number }> {
  const size = transcript ? ((await $.fs.stat(transcript).catch(() => null))?.size ?? 0) : 0
  if (!size || size <= from) return { text: '', size }
  if (size <= WHOLE_READ_BYTES) {
    const whole = String(await $.fs.read(transcript).catch(() => ''))
    if (whole) return { text: from ? new TextDecoder().decode(new TextEncoder().encode(whole).subarray(from)) : whole, size }
  }
  if (from > 0) {
    const parts: Uint8Array[] = []
    for (let at = from; at < size; at += CHUNK_BYTES) {
      const { stdout } = await $.process.run(chunkArgv(transcript, at, Math.min(CHUNK_BYTES, size - at)))
      parts.push(bytesOf(stdout))
    }
    const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
    parts.reduce((at, part) => (bytes.set(part, at), at + part.length), 0)
    return { text: new TextDecoder().decode(bytes), size }
  }
  const isWindows = /^[A-Za-z]:|\\/.test(transcript)
  // cmd's type rejects forward slashes ("The syntax of the command is incorrect").
  const argv = isWindows ? ['cmd', '/c', 'type', transcript.replace(/\//g, '\\')] : ['cat', transcript]
  let text = ''
  for await (const chunk of $.process.spawn({ argv })) {
    if (chunk.stream === 'stdout') text += chunk.text
  }
  return { text: text || null, size }
}

function startLog(session: string, path = '') {
  logSession = session
  transcript = path
  log = new TurnLog()
  isLoaded = false
  fedBytes = 0
  isPartial = false
  guessing = null
  working = false
  endedPrompt = ''
  apiFailure = null
  seen.clear()
}

// Asking the id on every row slowed scrolling, so rows ask after a session.end, or once this long has passed.
const SESSION_CHECK_MS = 500
let sessionCheckedAt = 0

// A new session's rows can draw before its SessionStart arrives, so rows check the id before using the log.
async function followSession($: EngineInterface) {
  const now = Date.now()
  if (logSession && now - sessionCheckedAt < SESSION_CHECK_MS) return
  sessionCheckedAt = now
  const asked = logSession
  const session = await $.session.id().catch(() => logSession)
  // A SessionStart that switched the log while the id was on its way knows better than this answer.
  if (session === logSession || asked !== logSession) return
  startLog(session)
  // The session's SessionStart may never come, so its transcript is looked up by id.
  $.clock.after(0, () => void load($))
}

// One read at a time: two at once would feed the same lines twice.
let reading: Promise<void> = Promise.resolve()
const load = ($: EngineInterface) => (reading = reading.then(() => readMore($)).catch(() => {}))

// A startup hook waits this long at most, so a long session's read never holds up the start; rows fold from the guess meanwhile.
const LOAD_WAIT_MS = 300
const loadAWhile = ($: EngineInterface) => Promise.race([load($), $.clock.sleep(LOAD_WAIT_MS).catch(() => {})])

// Later reads feed only the text after what was fed; a failed read leaves the log unloaded for the next turn.
async function readMore($: EngineInterface) {
  await followSession($)
  if (isLoaded && !isPartial) return
  const session = logSession
  const path = transcript || String((await $.store.get(`transcript:${session}`).catch(() => '')) ?? '') || (await findTranscript($))
  // A switch while this read waited makes it another session's.
  if (session !== logSession) return
  transcript = path
  const readAt = Date.now()
  lastRead = `reading ${path}`
  const failed = (error: Error) => {
    lastRead = `read failed after ${Date.now() - readAt} ms: ${error?.message ?? error}`
    return { text: null, size: 0 }
  }
  let from = isLoaded ? fedBytes : 0
  let read = await readTranscript($, from).catch(failed)
  // A file shorter than what was fed was rewritten, so it is read again from its start.
  if (read.text !== null && read.size < fedBytes) {
    isLoaded = false
    isPartial = false
    from = 0
    read = await readTranscript($, 0).catch(failed)
  }
  const fresh = read.text
  if (fresh === null || session !== logSession || path !== transcript) return
  const fedAt = Date.now()
  const { lines, rest } = completeLines(fresh)
  // A line unfinished through two reads is taken as it stands: feed drops it when it is not JSON.
  const isStale = isPartial && rest.length > 0
  // The first read builds its log aside, so rows keep drawing from the guess until it is whole.
  const target = isLoaded ? log : new TurnLog()
  const fed = isStale ? [...lines, rest] : lines
  for (let at = 0; at < fed.length; at += FEED_SLICE) {
    for (const line of fed.slice(at, at + FEED_SLICE)) target.feed(line)
    // A long session has tens of thousands of rows; feeding them in one go stalled every row draw meanwhile.
    if (at + FEED_SLICE < fed.length) {
      await $.clock.sleep(0)
      if (session !== logSession || path !== transcript) return
    }
  }
  log = target
  fedBytes = from + utf8Length(fresh) - (isStale ? 0 : utf8Length(rest))
  isPartial = rest.length > 0 && !isPartial
  isLoaded = true
  lastRead = `last read: ${fresh.length} chars from byte ${from} in ${fedAt - readAt} ms, ${lines.length} lines fed in ${Date.now() - fedAt} ms`
  $.ui.invalidate('ui.render')
}

const FEED_SLICE = 2000

// For /mod-transcript debug: how long the last transcript read and feed took.
let lastRead = ''

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

const listOf = (value: unknown): string[] => (Array.isArray(value) ? value : [])

// The flipped lists, copied from $.state: reading the state on every row cost a round trip per row while scrolling. A change redraws every row.
const flips: Record<Kind, string[]> = { turns: [], tools: [] }

function setFlips($: EngineInterface, kind: Kind, value: unknown) {
  flips[kind] = listOf(value)
  $.ui.invalidate('ui.render')
}

async function readFlips($: EngineInterface) {
  setFlips($, 'turns', (await $.state.get({ plugin: 'mod-transcript', key: 'turns' })).value)
  setFlips($, 'tools', (await $.state.get({ plugin: 'mod-transcript', key: 'tools' })).value)
}

// Writes a list computed from its latest value, only while no other write landed since the read; a lost race reads again.
async function changeList($: EngineInterface, kind: Kind, change: (list: string[]) => string[]) {
  for (let tries = 0; tries < 5; tries++) {
    if (kind === 'turns') {
      const { value, version } = await $.state.get({ plugin: 'mod-transcript', key: 'turns' })
      const next = change(listOf(value))
      if ((await $.state.set({ plugin: 'mod-transcript', key: 'turns' }, next, { ifVersion: version })).isSet) return setFlips($, kind, next)
    } else {
      const { value, version } = await $.state.get({ plugin: 'mod-transcript', key: 'tools' })
      const next = change(listOf(value))
      if ((await $.state.set({ plugin: 'mod-transcript', key: 'tools' }, next, { ifVersion: version })).isSet) return setFlips($, kind, next)
    }
  }
}

async function flip($: EngineInterface, kind: Kind, id: string) {
  await changeList($, kind, list => (list.includes(id) ? list.filter(open => open !== id) : [...list, id]))
}

// `11:32 · 6m 12s` with its two caps and a space: the widest start-and-duration a tool line shows.
const WHEN_WIDTH = 18

const widthOf =(e: { viewport?: { columns: number } }) => Math.max(20, (e.viewport?.columns ?? 100) - 6)

// The head line's cells around its label: the card's edges and padding, the bar and its padding, the fold chip and its gap, and one spare.
const HEAD_CHROME = 12

// How a turn's row draws: hidden while its turn is folded, inside the card while unfolded, as is in the live turn or as the reply.
async function placeOf($: EngineInterface, turn: Turn | undefined, requestId: string) {
  if (!turn || !isDone(turn) || rowKey(requestId) === turn.reply) return 'plain'
  return isTurnOpen(flips.turns, turn) ? 'card' : 'hidden'
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
    // Absolute so its lines never stretch the row; clipped so lines left from a taller row never paint below it.
    <Box key={key} width={1} flexShrink={0}>
      <Box key={`${key}-pin`} position="absolute" top={0} left={0} width={1} height="100%" overflow="hidden">
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
      {isTop ? edge(parts, `${key}-top`, { kind: 'top', color: THEME.accent, wedge: wedge.left }) : null}
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
function bubble(parts: Bars, key: string, turn: Turn, body: unknown, isTight = false) {
  return frame(parts, key, body, false, isDone(turn), isTight, turn)
}

// Claude Code sizes a markdown table to the whole terminal, so a block holding one drops the bubble's padding to fit it.
const hasTable = (text: string) => /^\s*\|.*\|\s*$/m.test(text) && /^\s*\|?\s*:?-{3,}/m.test(text)

// A turn has ended once a later prompt follows it, its duration is stored, or Claude went idle after it.
const hasEnded = (turn: Turn) => turn !== log.turns[log.turns.length - 1] || turn.durationMs !== undefined || turn.prompt === endedPrompt

// The copy pill, once the turn has ended with a reply to copy.
function copyPill({ Box, Client }: Bars, turn: Turn) {
  const choices = copyChoices(turn.replyText)
  if (!showCopy || !hasEnded(turn) || !choices.length) return null
  const props: CopyProps = { id: turn.prompt, choices: choices.map(what => ({ what, label: text.copyChoice[what] })), icon: look.glyph.copy, copied: text.copied, bg: style.colors.pills.secondary, nerd: look.nerd, lead: { char: '─', color: THEME.accent } }
  return (
    <Box key="toggle-copy" flexShrink={0}>
      <Client key="toggle-copy-pill" module="./copy.tsx" width={copyWidth(props)} height={1} props={props} />
    </Box>
  )
}

// Claude's bubble opens under the prompt: as the head of a finished turn with tools, else as a bare top edge.
const opening = (parts: Bars) => edge(parts, 'toggle-bubble-open', { kind: 'top', color: THEME.accent, wedge: wedge.left })

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

const partsWidth = (parts: LabelPart[]) => parts.reduce((sum, part) => sum + cells(part.text), 0)

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

// Claude Code's own Bash row, drawn here so the command keeps its colors; the blank first line matches the one Claude Code starts each row with.
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

// The reply drawn in pieces while a copy choice is hovered: its copied characters on a background, the rest as Claude Code draws markdown.
// The gutter stands in for the bullet and the indent Claude Code gives a reply's text.
function markedReply({ Box, Markdown, Text }: Pick<Rows, 'Box' | 'Text'> & { Markdown: (props: any) => RenderElement }, pieces: Piece[], isFirst: boolean) {
  return (
    <Box key="toggle-marked" flexDirection="row">
      <Box key="toggle-marked-gutter" width={2} flexShrink={0}>
        <Text>{isFirst ? MARK.stopOpen : ' '}</Text>
      </Box>
      <Box key="toggle-marked-body" flexDirection="column" flexGrow={1} flexShrink={1}>
        {pieces.map((piece, n) =>
          piece.kind === 'markdown' ? (
            <Box key={`toggle-piece-${n}`} marginTop={n ? 1 : 0}>
              <Markdown text={piece.text} />
            </Box>
          ) : (
            <Box key={`toggle-piece-${n}`} marginTop={n ? 1 : 0}>
              <Text color={THEME.onSurface}>
                {piece.parts.map((part, at) =>
                  part.isMarked ? (
                    <Text key={`part-${at}`} backgroundColor={THEME.surface3} color={THEME.onSurface}>{part.text}</Text>
                  ) : (
                    <Text key={`part-${at}`}>{part.text}</Text>
                  ),
                )}
              </Text>
            </Box>
          ),
        )}
      </Box>
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
  if (!look.nerd) return <Box key={key} flexDirection="row" flexShrink={0} height={1} alignSelf="flex-start">{parts}</Box>
  // One row tall whatever the line's height: a filled body stretched by a taller row painted the row below.
  return (
    <Box key={key} flexDirection="row" flexShrink={0} height={1} alignSelf="flex-start">
      <Text color={THEME.surface3}>{CAPS.left}</Text>
      <Box key={`${key}-body`} flexDirection="row" height={1} backgroundColor={THEME.surface3}>{parts}</Box>
      <Text color={THEME.surface3}>{CAPS.right}</Text>
    </Box>
  )
}

// An AskUserQuestion call folds to one line per question: its answer, or the question with no answer yet.
function questionRows({ Box, Text }: Pick<Rows, 'Box' | 'Text'>, input: unknown, output: unknown, width: number) {
  return (
    <Box key="toggle-questions" flexDirection="column">
      {questionsOf(input, output).map((each, n) => (
        <Text key={`toggle-question-${n}`} color={each.answer ? THEME.onSurface : THEME.muted} wrap="truncate-end">
          {cut(each.answer ? `${look.glyph.mark.search} ${each.question} ${MARK.stage} ${each.answer}` : `${MARK.stop} ${fill(text.askedYou, { question: each.question })}`, width)}
        </Text>
      ))}
    </Box>
  )
}

const REPORT_LINES = 6

// What a notice or a report row reads from its props.
type TaskProps = { text: string; origin: { kind: string }; from?: { name: string }; task?: { id?: string; status?: string; type?: string; durationMs?: number; toolUseId?: string } }

// A subagent's or teammate's report: a head line with its sender, status, time and first line, then a card of its fields and first lines.
function reportRow(parts: Controls & Rows, props: TaskProps, report: Report, width: number, fold?: { id: string; isOpen: boolean; onPress: () => unknown }) {
  const { Box, Text } = parts
  const all = props.text.replace(/\s+$/, '').split('\n')
  const first = all.findIndex(line => line.trim())
  const summary = first < 0 ? '' : all[first]!.trim()
  const time = report.durationMs !== undefined ? elapsed(report.durationMs) : ''
  const head = [report.name || text.reportFallback, report.status, time, summary].filter(Boolean).join(` ${MARK.sep} `)
  const label = `${look.glyph.mark.agent} ${head}`
  const headRoom = fold ? width - 4 : width
  // A summary the head shows whole is not repeated in the card; a cut one stays there in full.
  const lines = cut(label, headRoom) === label ? all.slice(first + 1) : all
  const fields = [
    props.task?.id ? fill(text.reportTask, { id: props.task.id }) : '',
    props.task?.type ? fill(text.reportType, { type: props.task.type }) : '',
    props.task?.toolUseId ? fill(text.reportTool, { id: props.task.toolUseId }) : '',
  ].filter(Boolean)
  const shown = lines.slice(0, REPORT_LINES)
  const more = lines.length - shown.length
  // With no lines past the head, a card of ids alone would repeat the head, so none draws.
  const isOpen = (fold?.isOpen ?? true) && shown.some(line => line.trim())
  return (
    <Box key="toggle-report" flexDirection="column">
      {fold ? (
        toggleLine(parts, 'toggle-report-fold', THEME.accent, fold.isOpen, cut(label, headRoom), { kind: 'turns', id: fold.id }, fold.onPress)
      ) : (
        <Text key="toggle-report-head" color={THEME.onSurface} wrap="truncate-end">{cut(label, headRoom)}</Text>
      )}
      {isOpen ? (
        <Box key="toggle-report-card" flexDirection="column" borderStyle="round" borderColor={THEME.border} backgroundColor={THEME.surface1} paddingX={1}>
          {fields.map((field, n) => (
            <Text key={`toggle-report-field-${n}`} color={THEME.muted} wrap="truncate-end">{field}</Text>
          ))}
          {shown.map((line, n) => (
            <Text key={`toggle-report-line-${n}`} color={THEME.onSurface} wrap="truncate-end">{cut(line, width - 4) || ' '}</Text>
          ))}
          {more > 0 ? <Text key="toggle-report-more" color={THEME.muted}>{fill(text.previewMore, { n: more })}</Text> : null}
        </Box>
      ) : null}
    </Box>
  )
}

const isSameNotice = (known: Notice | undefined, notice: Notice) => known !== undefined && known.status === notice.status && known.durationMs === notice.durationMs

// Either may draw first, so whichever comes second redraws the row that shows the other.
function learnNotice($: EngineInterface, id: string, notice: Notice) {
  if (isSameNotice(notices.get(id), notice)) return
  notices.set(id, notice)
  if (reported.has(id)) $.ui.invalidate('ui.render')
}

function learnReport($: EngineInterface, id: string) {
  if (reported.has(id)) return
  reported.add(id)
  if (notices.has(id)) $.ui.invalidate('ui.render')
}

// A notice draws nothing once its report draws; a report takes the notice's status and time.
async function taskRow(parts: Controls & Rows, $: EngineInterface, requestId: string, props: TaskProps, width: number) {
  const { Box } = parts
  if (props.origin.kind === 'task-notification') {
    const id = props.task?.id
    if (id) learnNotice($, id, { status: props.task?.status, durationMs: props.task?.durationMs })
    if (id && reported.has(id)) return <Box key="toggle-hidden" />
    return reportRow(parts, props, reportOf(props.from, props.task), width)
  }
  const id = senderTaskOf(props.origin)
  if (id) learnReport($, id)
  const report = withNotice(reportOf(props.from, props.task), id ? notices.get(id) : undefined)
  const turn = log.turnAt(requestId)
  if (!turn || !isDone(turn)) return reportRow(parts, props, report, width)
  const isOpen = isTurnOpen(flips.turns, turn)
  return reportRow(parts, props, report, width, { id: turn.prompt, isOpen, onPress: () => flip($, 'turns', turn.prompt) })
}

// An API error that ended the reply, as one line: red when the person must act, warn when Claude Code retries.
function apiErrorRow({ Box, Text }: Pick<Rows, 'Box' | 'Text'>, failure: ApiFailure, width: number) {
  const action = apiErrorAction(failure.error)
  const detail = failure.details ? ` ${MARK.sep} ${failure.details}` : ''
  return (
    <Box key="toggle-api-error" flexDirection="row">
      <Text color={action === 'act' ? THEME.alert : THEME.warn} bold={action === 'act'} wrap="truncate-end">
        {fit(`${MARK.warn} ${text.apiWhat[failure.error]} ${MARK.sep} ${text.apiAction[action]}${detail}`, width)}
      </Text>
    </Box>
  )
}

// One open chip per turn: picking another closes the first, picking the open one closes it.
async function pickChip($: EngineInterface, turnId: string, kind: string) {
  const key = `${turnId}:${kind}`
  await changeList($, 'tools', list => {
    const others = list.filter(open => !open.startsWith(`${turnId}:`))
    return list.includes(key) ? others : [...others, key]
  })
}

// An open turn's work under its head: a line of kind chips (Thought first, then each kind in order of first use) and, under the picked one, its calls or its thinking.
// onCall opens or closes one call: its own row then shows under the list, in the turn's order.
function chipSection({ Box, Button, Client, Text }: Rows & { Button: (props: any) => RenderElement }, turn: Turn, openTools: string[], width: number, onCall: (id: string) => unknown) {
  // Claude Code's drawing reaches a mod sealed, so the thinking comes from the session's messages, without its time.
  const thoughts = turnThoughts(turn)
  const kinds = turnKinds(turn)
  const isOpen = (kind: string) => openTools.includes(`${turn.prompt}:${kind}`)
  const chips: Chip[] = [
    ...(thoughts.length ? [{ kind: 'thinking' as const, mark: look.glyph.mark.thinking as string, label: text.thought, count: thoughts.length, added: 0, removed: 0, isOpen: isOpen('thinking') }] : []),
    ...kinds.map(group => ({ kind: group.kind, mark: look.glyph.mark[group.kind] as string, label: text.kindChip[group.kind], count: group.calls.length, added: group.added, removed: group.removed, isOpen: isOpen(group.kind) })),
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
    // The call line cuts a long command, so the open call shows it whole first.
    const command = call.name === 'Bash' ? String(call.input?.command ?? '').split('\n').flatMap(commandLine => wrapWords(commandLine, width - 14)) : []
    return (
      <Box key={`toggle-call-${n}-preview`} flexDirection="column" paddingLeft={3}>
        {command.map((commandLine, at) => (
          <Text key={`command-${at}`}>
            <Text color={THEME.muted}>{at === 0 ? '$ ' : '  '}</Text>
            {commandParts(commandLine).map((part, index) => (
              <Text key={`part-${index}`} color={part.color ?? THEME.onSurface} bold={part.bold}>{part.text}</Text>
            ))}
          </Text>
        ))}
        {shown.length === 0 ?<Text key="none" color={THEME.muted}>{text.previewEmpty}</Text> : null}
        {shown.map((previewLine, at) => {
          const mark = previewLine.kind === 'add' ? '+ ' : previewLine.kind === 'del' ? '- ' : previewLine.kind === 'same' ? '  ' : ''
          const background = previewLine.kind === 'add' ? { backgroundColor: THEME.addBg } : previewLine.kind === 'del' ? { backgroundColor: THEME.delBg } : {}
          return (
            <Text key={`line-${at}`} color={previewLine.kind === 'out' ? THEME.muted : THEME.onSurface} wrap="truncate-end" {...background}>
              {cut(`${mark}${previewLine.text}`, width - 10) || ' '}
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

// The reply row marks the characters of this turn's choice while the pill hovers or has just copied it; null clears it.
async function markCopy($: EngineInterface, id: string, what: string | null) {
  await $.state.set({ plugin: 'mod-transcript', key: 'copy-hover' }, what ? `${id}\n${what}` : '')
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
    await $.fs.write(`${temp}/mod-transcript-ids.txt`, `${log.turns.length} turns\n${lastRead}\n${rows.join('\n')}\n`)
    return `${rows.length} drawn rows written to ${temp}/mod-transcript-ids.txt`
  }
  const done = log.turns.filter(isDone)
  let isAnyOpen = false
  // Folding all clears the flips when turns fold by default, and flips every turn when they open by default.
  await changeList($, 'turns', list => {
    isAnyOpen = done.some(turn => isTurnOpen(list, turn))
    return isAnyOpen !== foldTurns ? done.map(turn => turn.prompt) : []
  })

  return isAnyOpen ? text.noteFolded : text.noteUnfolded
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

// The last answer draws until the check returns, so the first frame already has the right wedge.
async function loadWedge($: EngineInterface) {
  try {
    const isOutline = await $.store.get('wedge-outline')
    if (typeof isOutline === 'boolean') wedge = isOutline ? OUTLINE : FILLED
  } catch {
    // Without a store the wedge starts filled until the check returns.
  }
  const found = await detectWedge(await $.env.get('TERM_PROGRAM'), async argv => {
    const result = await $.process.run(argv, { timeoutMs: 5000 })
    if (result.exitCode !== 0) throw new Error(result.stderr)
    return result.stdout
  })
  const isChanged = found.right !== wedge.right
  wedge = found
  try {
    await $.store.set('wedge-outline', found === OUTLINE)
  } catch {
    // Without a store the check just runs again next time.
  }
  if (isChanged) $.ui.invalidate('ui.render')
}

// Hooks of one event run in turn, so the slow font check runs beside them instead of holding up every mod after this one.
let lookLoad: Promise<void> | null = null

function loadLook($: EngineInterface) {
  lookLoad ??= (async () => {
    void loadWedge($).catch(() => {
      // A failed check keeps the wedge drawn now.
    })
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
  if (!look.nerd) return <Box key={key} flexShrink={0} height={1} alignSelf="flex-start"><Text color={THEME.muted}>{`${time} `}</Text></Box>
  // One row tall whatever the line's height: a filled body stretched by a taller row painted the row below.
  return (
    <Box key={key} flexDirection="row" flexShrink={0} height={1} alignSelf="flex-start">
      <Text color={fill}>{CAPS.left}</Text>
      <Box key={`${key}-body`} height={1} backgroundColor={fill}><Text color={THEME.muted}>{time}</Text></Box>
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
  showCopy = options.copy_pill !== false
  showNumbers = options.prompt_numbers !== false

  on('session.start', async ($, e, next) => {
    await loadLook($)
    await $.command.register({
      name: 'mod-transcript',
      description: text.commandDescription,
      argumentHint: '[settings|debug]',
    })
    await $.state.set({ plugin: 'mod-transcript', key: 'pane' }, await isPaneOpen($))
    await readFlips($)
    await loadAWhile($)

    return next(e)
  })

  // A click on a card's strip folds the turn or tool it runs beside.
  on('ui.message', async ($, e, next) => {
    if (isTipMessage(e.data)) {
      const mark = (e.data as CopyTipMessage).mark
      if (mark) await markCopy($, mark.id, mark.what)
      hovered = e.data
      $.ui.invalidate('ui.render')
      return next(e)
    }
    // The pill names the choice to mark; the reply row reads it from the state and redraws.
    const hover = e.data as CopyHoverMessage
    if (hover?.type === 'copy-hover') {
      await markCopy($, hover.id, hover.what)
      return next(e)
    }
    // A click can move or remove the control under the pointer, and a leave may never come.
    if (hovered) {
      hovered = null
      $.ui.invalidate('ui.render')
    }
    const change = settingChoice(e.data)
    if (change) await saveSetting($, change.key, change.value)
    const message = e.data as BarMessage
    if (message?.type === 'fold') await flip($, message.kind, message.id)
    const picked = e.data as ChipsMessage
    if (picked?.type === 'chip') await pickChip($, picked.id, picked.kind)
    const copy = e.data as CopyMessage
    if (copy?.type === 'copy') {
      await markCopy($, copy.id, copy.what)
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
    // Another surface, the desktop's say, can fold a turn too.
    if (e.plugin === 'mod-transcript' && (e.key === 'turns' || e.key === 'tools')) {
      const result = await next(e)
      setFlips($, e.key, e.value)
      return result
    }
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

    // @ts-expect-error The host's types omit Client from a Pane's elements, yet a Pane draws it.
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
      <Box flexDirection="column" paddingX={1} minHeight={e.props.scroll.bodyRows}>
        {tabRow({ Box, Client, Text }, look.nerd, [{ id: 'mod-transcript-settings-tab', label: `${text.paneHeading} ${MARK.sep} ${text.paneSubheading}`, icon: look.glyph.gear, isOpen: true, tip: { glyph: look.glyph.gear, label: text.paneSubheading, text: text.tipTabSettings } }], false)}
        <Text wrap="truncate-end" color={statusColor(note)}>{withMark(look, note) || `${text.paneHintClick} ${MARK.sep} ${text.paneHintSaved}`}</Text>
        <Box marginTop={0}>{settingsBody({ Box, Button, Client, Text }, look, { rows, actions, working, run, previews, still: false, tips: text.settingTips })}</Box>
        <Box key="footer-space" height={FOOTER_ROWS} />
        {paneFooter({ Box, Text }, hoveredTip(), e.props.bodyColumns, e.props.scroll)}
      </Box>
    )
  })

  // The chat rows' controls have no tip row of their own, so their tip shows in the band's, on the shared pill row another mod drew.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // Read once: a leave posted while next(e) runs clears `hovered`.
    const tip = tipText(hovered)
    if (e.surface === 'terminal') viewedAgent = e.props.view.agentId
    if (e.surface !== 'terminal' || e.props.hasSurvey || !tip) return next(e)
    const { Box, Client, Text } = $.ui.resolve(e)
    const others = await next(e)
    const { group, row, rest } = splitRow(others)
    if (group.length === 0 && row.length === 0) return others
    return pillRow({ Box, Client, Text }, look.nerd, group, row, rest, tipLine({ Box, Text }, tip), e.props.bodyColumns)
  })

  // Only the settings hook event names the transcript; kept per session so a reload finds it again.
  on('classic.SessionStart', async ($, e, next) => {
    // A compact keeps the same session and file, which the log already holds.
    if (e.session_id !== logSession || e.transcript_path !== transcript || !isLoaded) {
      startLog(e.session_id, e.transcript_path)
      await $.store.set(`transcript:${e.session_id}`, e.transcript_path)
      await loadAWhile($)
    }
    // SessionStart comes between turns, so whatever the transcript holds has ended.
    markEnded()

    return next(e)
  })

  on('classic.PermissionDenied', async ($, e, next) => {
    declined.add(e.tool_use_id)
    $.ui.invalidate('ui.render')

    return next(e)
  })

  on('classic.StopFailure', async ($, e, next) => {
    apiFailure = { error: e.error, details: e.error_details ?? '', text: (e.last_assistant_message ?? '').trim() }
    $.ui.invalidate('ui.render')

    return next(e)
  })

  // A /resume or /clear ends this session; the next row asks for the id at once.
  on('session.end', async ($, e, next) => {
    sessionCheckedAt = 0

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    if (e.agentId && e.tool_use_id) {
      log.dropForeign(e.tool_use_id)
      $.ui.invalidate('ui.render')
    }

    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (!(e as { agentId?: string }).agentId) working = true

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (!e.agentId) {
      working = false
      markEnded()
    }
    // The turn is handed on before the messages are read, so no mod after this one waits for them.
    const result = await next(e)
    if (!e.agentId) {
      await load($)
      const messages = await $.session.messages({ as: 'api' }).catch(() => null)
      if (Array.isArray(messages)) log.learnThoughts(messages)
      $.ui.invalidate('ui.render')
    }

    return result
  })

  on('command.run', { command: 'mod-transcript' }, async ($, e) => ({ text: await answer($, e.args) }))

  // The prompt row carries the card's head: one line naming what the turn did, which a click folds or unfolds.
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    await loadLook($)
    if (e.surface !== 'terminal' || viewedAgent) return next(e)
    await followSession($)
    isFullView = e.props.isExpanded
    // A subagent's report opens a turn of its own, as in the transcript, unless it lands while Claude works: the transcript keeps that one in the running turn.
    const isReport = e.props.origin.kind === 'peer'
    if (isLoaded && (isReport ? !working : e.props.origin.kind === 'composer' && isPrompt(e.props.text))) log.claim(e.requestId, 'prompt', Date.now(), isReport, String(e.props.text ?? ''))
    if (isFullView) return next(e)
    if (e.props.origin.kind === 'peer' || e.props.origin.kind === 'task-notification') return taskRow($.ui.resolve(e), $, e.requestId, e.props, widthOf(e))
    if (e.props.origin.kind !== 'composer') return next(e)
    if (!isLoaded && e.props.origin.kind === 'composer') {
      await guess($)
      log.adopt(e.requestId, 'prompt', e.props.text)
    }
    const turn = log.turnAt(e.requestId)
    seen.set(`UserMessage ${e.requestId}`, Boolean(turn))
    const { Box, Button, Client, Text } = $.ui.resolve(e)
    // Read before next(e) draws, since a row drawn meanwhile can renumber the prompts.
    const n = showNumbers && turn ? log.numberOf(turn) : undefined
    const prompt = await next(e)
    // The wedge is an absolute sibling: Claude Code refuses its row under a positioned Box.
    const row = (
      <Box key="toggle-prompt-row" flexDirection="row" flexGrow={1} justifyContent="flex-end" backgroundColor={THEME.bg}>
        {n !== undefined ? (
          <Box key="toggle-prompt-gutter" flexShrink={0} width={pillWidth(n) + 1} backgroundColor={THEME.bg}>
            <Client key="toggle-prompt-number" module="./number.tsx" width={pillWidth(n) + 1} height="100%" props={{ id: turn!.prompt, n, nerd: look.nerd } satisfies NumberProps} />
          </Box>
        ) : null}
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
            <Text color={THEME.secondary}>{wedge.right}</Text>
          </Box>
        </Box>
      </Box>
    )
    if (!turn) return row
    if (!hasHead(turn)) return <Box key="toggle-prompt" flexDirection="column" flexGrow={1}>{row}{opening({ Box, Client })}</Box>

    const isOpen = isTurnOpen(flips.turns, turn)
    // The head: what the turn did, then its line counts and how long it took, each a pill.
    const added = turn.tools.reduce((sum, call) => sum + call.added, 0)
    const removed = turn.tools.reduce((sum, call) => sum + call.removed, 0)
    const took = turn.durationMs !== undefined ? fill(text.turnTook, { time: elapsed(turn.durationMs) }) : ''
    // The label gets what the pills leave, so it never wraps: a wrapped label made the line two rows and the pills' fill bled into the second.
    const countsWidth = added || removed ? cells(`${added ? `+${added}` : ''}${added && removed ? ' ' : ''}${removed ? `−${removed}` : ''}`) + (look.nerd ? 2 : 0) + 1 : 0
    const tookWidth = took ? cells(took) + (look.nerd ? 3 : 1) + 1 : 0
    const head = (
      <Box key="toggle-head-line" flexDirection="row" columnGap={1}>
        {toggleLine({ Box, Button, Client }, 'toggle-turn', THEME.accent, isOpen, fit(turnLine(turn), widthOf(e) - HEAD_CHROME - countsWidth - tookWidth), { kind: 'turns', id: turn.prompt }, () => flip($, 'turns', turn.prompt))}
        {countsPill({ Box, Text }, 'toggle-head-counts', added, removed)}
        {took ? timePill({ Box, Text }, 'toggle-head-time', took, THEME.surface3) : null}
      </Box>
    )
    const kinds = isOpen && foldTools ? chipSection({ Box, Button, Client, Text }, turn, flips.tools, widthOf(e), id => flip($, 'tools', id)) : null
    // The reply closes the card; a turn cancelled before any reply has none, so its head closes it whenever no tool row draws below.
    const isClosed = !turn.reply && (foldTools || !isOpen)
    return (
      <Box key="toggle-prompt" flexDirection="column" flexGrow={1}>
        {row}
        {frame({ Box, Client }, 'toggle-head-frame', slice({ Box, Client }, 'toggle-head', isOpen ? THEME.accent : THEME.border, [head, kinds], { kind: 'turns', id: turn.prompt }), true, isClosed, false, turn)}
      </Box>
    )
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    await loadLook($)
    if (e.surface !== 'terminal' || viewedAgent) return next(e)
    await followSession($)
    if (isLoaded) log.claim(e.requestId, 'reply')
    if (isFullView) return next(e)
    // Once the transcript is read the guess is not needed, and asking for it fetched every message of the session.
    if (!isLoaded) {
      await guess($)
      log.adopt(e.requestId, 'text', e.props.text)
    }
    const turn = log.turnOf(e.requestId)
    seen.set(`AssistantMessage ${e.requestId}`, Boolean(turn))
    // A reply drawn live is newer than the transcript the log read; the copy pill hands over what it says.
    if (turn && rowKey(e.requestId) === turn.reply && e.props.text.trim()) turn.replyText = e.props.text.trim()
    const place = await placeOf($, turn, e.requestId)
    const { Box, Client, Markdown, Text } = $.ui.resolve(e)
    const failure = apiFailure?.text && e.props.text.trim() === apiFailure.text ? apiFailure : null
    // Only the reply's row reads the hover, which subscribes it: the pill's choice on this turn marks what that choice copies.
    const hover = showCopy && !failure && turn && rowKey(e.requestId) === turn.reply ? String((await $.state.get({ plugin: 'mod-transcript', key: 'copy-hover' })).value ?? '') : ''
    const hovered = turn && hover.startsWith(`${turn.prompt}\n`) ? hover.slice(turn.prompt.length + 1) : ''
    const marks = hovered ? markPieces(e.props.text.trim(), hovered as CopyChoice) : null
    const colors = failure ? [] : hexColors(e.props.text, THEME.surface2)
    const reply = async () => (failure ? apiErrorRow({ Box, Text }, failure, widthOf(e)) : marks ? markedReply({ Box, Markdown, Text }, marks, e.props.isFirstOfReply) : next(e))
    // Claude Code draws the reply's markdown, which cannot color a character, so the colors it names show in a strip under it.
    const drawn = async () =>
      colors.length === 0 ? reply() : (
        <Box key="toggle-colored" flexDirection="column">
          {await reply()}
          <Box key="toggle-colors" marginTop={1} flexDirection="row" flexWrap="wrap" columnGap={1}>
            {colors.map((color, n) => (
              <Box key={`toggle-color-${n}`} flexDirection="row" flexShrink={0}>
                {look.nerd ? <Text color={THEME.surface2}>{CAPS.left}</Text> : null}
                <Box key={`toggle-color-${n}-body`} backgroundColor={THEME.surface2} paddingX={look.nerd ? 0 : 1}>
                  <Text>
                    <Text color={color.rgb}>■</Text>
                    <Text color={THEME.muted}>{` ${color.code}`}</Text>
                  </Text>
                </Box>
                {look.nerd ? <Text color={THEME.surface2}>{CAPS.right}</Text> : null}
              </Box>
            ))}
          </Box>
        </Box>
      )
    if (place === 'plain') return turn ? bubble({ Box, Client }, 'toggle-bubble', turn, await drawn(), hasTable(e.props.text)) : drawn()

    return place === 'hidden' ? <Box key="toggle-hidden" /> : cardRow({ Box, Client }, await drawn(), { kind: 'turns', id: turn!.prompt })
  })

  // A finished tool row folds to one line of its own; a click shows Claude Code's full row and result under it.
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    await loadLook($)
    if (e.surface !== 'terminal' || viewedAgent) return next(e)
    await followSession($)
    if (isLoaded) log.claimCall(e.props.tool_use_id, e.props.tool, e.props.input, e.props.isRunning, e.props.output, e.props.isErrored || e.props.isInterrupted)
    else {
      await guess($)
      log.follow(e.props.tool_use_id)
    }
    const turn = log.turnOf(e.requestId)
    seen.set(`ToolUse ${e.requestId}`, Boolean(turn))
    if (isFullView) return next(e)
    const { Box, Button, Client, Text } = $.ui.resolve(e)
    const place = await placeOf($, turn, e.requestId)
    // In an open turn the head's kind rows list every call, so the row itself draws nothing.
    if (place === 'hidden' || (place === 'card' && foldTools)) return <Box key="toggle-hidden" />
    const inBubble = (body: unknown) => (turn ? bubble({ Box, Client }, 'toggle-bubble', turn, body) : body) as RenderElement
    const isFailed = e.props.isErrored || e.props.isInterrupted
    // A call a hook or the person refused is an error they chose, so it draws neutral.
    const isDeclined = e.props.isErrored && declined.has(e.props.tool_use_id)
    const isRed = isFailed && !isDeclined
    if (e.props.isRunning || !foldTools || isLive(turn)) {
      const row = e.props.tool === 'Bash' ? bashRow({ Box, Client, Text }, e.props.input, e.props.isRunning, isRed) : await next(e)
      return place === 'card' ? cardRow({ Box, Client }, row, { kind: 'turns', id: turn!.prompt }) : inBubble(row)
    }

    if (e.props.tool === 'AskUserQuestion') return inBubble(questionRows({ Box, Text }, e.props.input, e.props.output, widthOf(e)))
    const { added, removed } = diffStat(e.props.tool, e.props.input, e.props.output, isFailed)
    const isOpen = flips.tools.includes(e.props.tool_use_id)
    const when = showTimes ? callTime(log.callOf(e.props.tool_use_id)) : ''
    // The status words take their room first, so the name is cut to leave it.
    const suffix = statusesOf({ isInterrupted: e.props.isInterrupted, isDeclined, output: e.props.output, input: e.props.input }).map(status => ` ${MARK.sep} ${text.status[status]}`).join('')
    const room = widthOf(e) - 16 - (when ? WHEN_WIDTH : 0) - cells(suffix)
    const stats = [
      added ? <Box key="toggle-tool-added"><Text color={THEME.good}>{`+${added}`}</Text></Box> : null,
      removed ? <Box key="toggle-tool-removed"><Text color={THEME.alert}>{`−${removed}`}</Text></Box> : null,
    ]
    const line = toggleLine(
      { Box, Button, Client },
      'toggle-tool',
      isRed ? THEME.alert : THEME.border,
      isOpen,
      fit(toolLabel(e.props.tool, e.props.input, 0, 0), room) + suffix,
      { kind: 'tools', id: e.props.tool_use_id },
      () => flip($, 'tools', e.props.tool_use_id),
      stats,
      e.props.tool === 'Bash' ? [...labelParts('Bash', e.props.input, room), ...(suffix ? [{ text: suffix }] : [])] : undefined,
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
    if (e.surface !== 'terminal' || viewedAgent) return next(e)
    await followSession($)
    if (isLoaded) log.claim(e.requestId, 'row')
    if (isFullView) return next(e)
    else {
      await guess($)
      log.follow(e.requestId)
    }
    const turn = log.turnOf(e.requestId)
    seen.set(`ToolResult ${e.requestId}`, Boolean(turn))
    const { Box, Client } = $.ui.resolve(e)
    const place = await placeOf($, turn, e.requestId)
    if (place === 'hidden' || (place === 'card' && foldTools) || (foldTools && !isLive(turn) && !flips.tools.includes(e.props.tool_use_id))) return <Box key="toggle-hidden" />

    const body = nested({ Box, Client }, 'toggle-result', await next(e), { kind: 'tools', id: e.props.tool_use_id })
    if (place === 'card') return cardRow({ Box, Client }, body, { kind: 'turns', id: turn!.prompt })
    return turn ? bubble({ Box, Client }, 'toggle-bubble', turn, body) : body
  })

  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    await loadLook($)
    if (e.surface !== 'terminal' || viewedAgent) return next(e)
    await followSession($)
    // A folded group's calls never draw rows of their own, so the group claims them for the turn.
    if (isLoaded) for (const call of e.props.calls) if (call.tool_use_id) log.claimCall(call.tool_use_id, call.tool, call.input, call.isRunning, call.output, call.isErrored || call.isInterrupted)
    // A group of thinking alone has no calls; it joins the turn by its own message id.
    if (isLoaded && e.props.calls.length === 0) log.claim(e.requestId.replace(/^collapsed-/, ''), 'row')
    if (isFullView) return next(e)
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
    if (place === 'plain') return turn ? bubble({ Box, Client }, 'toggle-bubble', turn, group) : group

    // In an open turn the head's kind rows list every call, so the group draws nothing.
    if (place === 'hidden' || foldTools) return <Box key="toggle-hidden" />
    return cardRow({ Box, Client }, await next(e), { kind: 'turns', id: turn!.prompt })
  })

  on('ui.render', { component: 'TurnDuration' }, async ($, e, next) => {
    await loadLook($)
    if (e.surface !== 'terminal' || viewedAgent) return next(e)
    await followSession($)
    if (isLoaded) log.claim(e.requestId, 'row')
    if (isFullView) return next(e)
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
