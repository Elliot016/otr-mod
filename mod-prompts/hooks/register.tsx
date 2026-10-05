import type { ConfigValue, EngineInterface, Register } from 'claude-code'

import { cardSpace, stickyCard } from './card'
import type { EntryMessage, EntryProps } from './entry'
import { isNerdFace, lookFor, terminalSettings, withMark, type IconMode } from './look'
import { menuEntry, pill, pillRow, splitRow, tabRow, tipLine } from './pills'
import { settingChoice, settingsBody } from './settings'
import { TOAST_MS, ToastList, toastCards } from './toasts'
import { parseRow, promptsOf, promptText, rowKey, targetOf, type Prompt, type Row } from './prompts'
import { GUTTER, timelineRows, type TimelineMessage, type TimelineProps } from './timeline'
import { fill, MARK, statusColor, THEME } from './theme'
import text from './text'


// The icons setting (userConfig), fixed per activation: a change reloads the mod.
let iconMode: IconMode = 'auto'
let look = lookFor(false)

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

const PANE = 'prompts'
const SETTINGS = 'prompts-settings'

// Border, the number line and six lines of the prompt.
const CARD_ROWS = 9

const STOPS_PER_CLIENT = 30

const PAGE_SIZE = 100

let transcript = ''
// A long session's transcript takes seconds to read, so it is read once; later prompts come from the rows Claude Code draws.
let isLoaded = false
// A turn ended while the pane was open: read again in the background, so its prompt gets its numbers.
let isStale = false
let prompts: Prompt[] = []
let selected = -1
// The page the timeline shows; -1 follows the open prompt.
let page = -1
// How many pages the last drawing had, so a pager click knows its bounds.
let pageCount = 1
let note = ''
// Row key -> the requestId Claude Code drew that prompt's row under, which a jump scrolls to.
const drawn = new Map<string, string>()

const isOpen = async ($: EngineInterface, id = PANE) => (await $.ui.panes()).some(pane => pane.id === id && pane.isPlaced)

// A long session outgrows $.fs.read's 4 MiB cap; then the transcript streams through the platform's own file printer.
async function load($: EngineInterface) {
  if (isLoaded && !isStale) return
  isStale = false
  if (!transcript) transcript = String((await $.store.get(`transcript:${await $.session.id()}`)) ?? '')
  if (!transcript) transcript = await findTranscript($)
  if (!transcript) return
  const { size } = await $.fs.stat(transcript).catch(() => ({ size: -1 }))
  let text = String(await $.fs.read(transcript).catch(() => ''))
  if (!text && size > 0) {
    const isWindows = /^[A-Za-z]:|\\/.test(transcript)
    // cmd's type rejects forward slashes ("The syntax of the command is incorrect").
    const argv = isWindows ? ['cmd', '/c', 'type', transcript.replace(/\//g, '\\')] : ['cat', transcript]
    for await (const chunk of $.process.spawn({ argv })) {
      if (chunk.stream === 'stdout') text += chunk.text
    }
  }
  // A failed read leaves the transcript unloaded, so the next open tries again.
  if (!text) return
  const rows: Row[] = []
  for (const line of text.slice(0, text.lastIndexOf('\n') + 1).split('\n')) {
    const row = line.trim() ? parseRow(line) : undefined
    if (row) rows.push(row)
  }
  isLoaded = true
  // Prompts drawn since the read, not yet in the file, stay at the end.
  const read = promptsOf(rows)
  // A prompt typed mid-turn is drawn under another id than the file's, so a drawn one also matches by its text.
  const known = new Set(read.flatMap(prompt => [rowKey(prompt.id), sameText(prompt.text)]))
  prompts = [...read, ...prompts.filter(prompt => !known.has(rowKey(prompt.id)) && !known.has(sameText(prompt.text)))]
  if (selected < 0 || selected >= prompts.length) selected = prompts.length - 1
}

const sameText = (text: string) => `text:${text.replace(/\s+/g, ' ').trim()}`

// A turn's length as the fold writes it: seconds, then minutes and seconds.
const duration = (ms: number) => {
  const seconds = Math.round(ms / 1000)
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

// A saved change reloads this mod, which redraws the panel with the new value.
async function saveSetting($: EngineInterface, key: string, value: ConfigValue) {
  const row = (await $.config.list()).find(each => each.key === key)
  const result = await $.config.set({ key, value })
  note = 'deny' in result && result.deny ? `${MARK.warn} ${result.deny}` : `${MARK.ok} ${fill(text.settingSaved, { label: row?.label ?? key })}`
  $.ui.invalidate('ui.render')
}

// The panel's title line: the list and its settings as tabs, the shown one open.
const tabs = (isSettings: boolean) => [
  { id: 'prompts-tab', label: text.paneTitle, icon: look.glyph.icon.prompt ?? look.glyph.title, isOpen: !isSettings, count: prompts.length },
  { id: 'prompts-settings', label: text.settingsTab, icon: look.glyph.gear, isOpen: isSettings },
]

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

// The command and the bar entry both toggle. An unplaced pane is waiting, not open.
async function togglePane($: EngineInterface) {
  if (await isOpen($)) {
    await $.ui.close({ id: PANE })
    await $.state.set({ plugin: 'mod-prompts', key: 'pane' }, false)
    return
  }
  if (await isOpen($, SETTINGS)) await $.ui.close({ id: SETTINGS })
  note = ''
  selected = -1
  page = -1
  await load($)
  const opened = await $.ui.open({ id: PANE, title: text.paneTitle, closeOnEscape: true })
  if (!opened.isPlaced) $.ui.toast(fill(text.panelWaiting, { reason: opened.reason }))
  await $.state.set({ plugin: 'mod-prompts', key: 'pane' }, opened.isPlaced)
}

// `/mod-prompts settings` and the title row's pill toggle the settings panel, which takes the sidebar's place.
async function toggleSettings($: EngineInterface) {
  if (await isOpen($, SETTINGS)) {
    await $.ui.close({ id: SETTINGS })
    await $.state.set({ plugin: 'mod-prompts', key: 'pane' }, false)
    return
  }
  if (await isOpen($)) await $.ui.close({ id: PANE })
  note = ''
  const opened = await $.ui.open({ id: SETTINGS, title: text.settingsPaneTitle, closeOnEscape: true })
  if (!opened.isPlaced) $.ui.toast(fill(text.settingsWaiting, { reason: opened.reason }))
  await $.state.set({ plugin: 'mod-prompts', key: 'pane' }, opened.isPlaced)
}

// Scrolls the transcript to the prompt's row; Claude Code allows it only with the person's press behind it.
async function jump($: EngineInterface, index: number) {
  const prompt = prompts[index]
  if (!prompt) return
  selected = index
  const result = await $.ui.scroll({ to: { requestId: targetOf(drawn, prompt.id) }, block: 'start' }).catch((error: Error) => ({ deny: error.message }))
  note = result.deny ? `${MARK.warn} ${result.deny}` : `${MARK.ok} ${fill(text.jumped, { n: index + 1 })}`
  $.ui.invalidate('ui.render')
}

const oneLine = (text: string, width: number) => {
  const flat = text.replace(/\s+/g, ' ')
  return flat.length > width ? `${flat.slice(0, Math.max(0, width - 1))}…` : flat
}

const clock = (at?: string) => {
  const date = at ? new Date(at) : undefined
  return date && !Number.isNaN(date.getTime()) ? `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}` : ''
}

// True while the pointer is on this mod's pill entry, which then shows its tip above the row.
let tipShown = false

const toasts = new ToastList('prompts')
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
  if (!(await isOpen($))) {
    isOpening = true
    $.ui.invalidate('ui.render')
    $.clock.after(OPEN_WAIT_MS, () => endOpening($))
  }
  await togglePane($)
  if (!(await isOpen($))) endOpening($)
}

export const register: Register = (on, options) => {
  still = options.animations === false
  iconMode = (options.icons as IconMode | undefined) ?? 'auto'
  // A forced mode needs no detection; auto waits for session.start to read the terminal font.
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
    look = await detectLook($)
    await $.command.register({ name: 'mod-prompts', description: text.commandDescription, argumentHint: '[settings]' })
    // The bar entry reads this; an unload drops the pane without raising ui.close here.
    await $.state.set({ plugin: 'mod-prompts', key: 'pane' }, await isOpen($))
    // A hot reload leaves an open pane on its old drawing until something redraws it.
    $.ui.invalidate('ui.render')

    return next(e)
  })

  // Only the settings hook event names the transcript; kept per session so a reload finds it again.
  on('classic.SessionStart', async ($, e, next) => {
    // A compact keeps the same transcript, and the prompts learned since the read are already here.
    if (e.transcript_path !== transcript) {
      isLoaded = false
      prompts = []
    }
    transcript = e.transcript_path
    await $.store.set(`transcript:${e.session_id}`, e.transcript_path)

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (!e.agentId && (await isOpen($))) {
      isStale = true
      $.clock.after(0, async () => {
        await load($)
        $.ui.invalidate('ui.render')
      })
    }

    return next(e)
  })

  // Each prompt row as Claude Code draws it, so a jump scrolls to the id the row really has.
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    drawn.set(rowKey(e.requestId), e.requestId)
    // A prompt sent after the read joins the list as its row draws.
    const text = e.props.origin?.kind === 'composer' ? promptText(String(e.props.text ?? '')) : undefined
    // Claude Code redraws rows (a reload, a scroll), so a row whose text is already listed is not a new prompt.
    if (isLoaded && text && !prompts.some(prompt => rowKey(prompt.id) === rowKey(e.requestId) || sameText(prompt.text) === sameText(text))) {
      prompts = [...prompts, { id: e.requestId, text, at: new Date().toISOString(), tools: 0, added: 0, removed: 0 }]
      $.clock.after(0, () => $.ui.invalidate('ui.render'))
    }

    return next(e)
  })

  on('command.run', { command: 'mod-prompts' }, async ($, e) => {
    if ((e.args ?? '').trim() === 'settings') await toggleSettings($)
    else await togglePane($)

    return { text: '' }
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE || e.id === SETTINGS) await $.state.set({ plugin: 'mod-prompts', key: 'pane' }, await isOpen($, e.id === PANE ? SETTINGS : PANE))

    return next(e)
  })

  // Deferred past this dispatch, so this mod's own state write is not nested in another plugin's.
  on('state.set', async ($, e, next) => {
    if (e.key === 'pane' && e.plugin !== 'mod-prompts' && e.value === true) {
      $.clock.after(0, async () => {
        const wasOpen = (await isOpen($)) || (await isOpen($, SETTINGS))
        if (!wasOpen) return
        await $.ui.close({ id: PANE })
        await $.ui.close({ id: SETTINGS })
        await $.state.set({ plugin: 'mod-prompts', key: 'pane' }, false)
      })
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const hidden = await $.state.get({ plugin: 'mod-menu', key: 'hidden' })
    if (e.surface !== 'terminal' || e.props.hasSurvey) return next(e)
    if (hidden.value === true) {
      if (toasts.items.length === 0) return next(e)
      const { Box, Client, Text } = $.ui.resolve(e)
      return <Box key="toasts-prompts" flexDirection="column">{toastCards({ Box, Client, Text }, toasts)}{await next(e)}</Box>
    }
    const nerd = look.nerd

    const { Box, Client, Text } = $.ui.resolve(e)
    // Reading the value subscribes the bar to redraws; the look trusts the pane list itself.
    await $.state.get({ plugin: 'mod-prompts', key: 'pane' })
    const shown = await isOpen($)
    const { group, row, rest, tip } = splitRow(await next(e))
    // Opening the pane from here queues nothing, so the entry stays live mid-turn.
    const entry = menuEntry({ Box, Client, Text }, nerd, 'prompts', { label: text.pillLabel, isOpen: shown, idle: THEME.pill, isBusy: isOpening, still })

    return pillRow({ Box, Text }, nerd, [entry, ...group], row, [...toastCards({ Box, Client, Text }, toasts), ...rest], tipShown ? tipLine({ Box, Text }, text.tip) : tip)
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
    if (hover?.type === 'menu-hover' && hover.id === 'prompts') {
      tipShown = hover.isOver === true
      $.ui.invalidate('ui.render')
    }
    const message = e.data as EntryMessage
    if (message?.type === 'menu-entry' && message.id === 'prompts') await openingPane($)
    // The title line's tabs swap the sidebar and its settings; the open tab does nothing.
    if (message?.type === 'menu-entry' && message.id === 'prompts-settings' && !(await isOpen($, SETTINGS))) await toggleSettings($)
    if (message?.type === 'menu-entry' && message.id === 'prompts-tab' && !(await isOpen($))) await togglePane($)
    if (message?.type === 'menu-entry' && (message.id === 'prompts-page-prev' || message.id === 'prompts-page-next')) {
      const shown = page < 0 ? Math.floor(Math.max(0, selected) / PAGE_SIZE) : page
      page = Math.max(0, Math.min(pageCount - 1, shown + (message.id === 'prompts-page-next' ? 1 : -1)))
      $.ui.invalidate('ui.render')
    }
    const change = settingChoice(e.data)
    if (change) await saveSetting($, change.key, change.value)

    return next(e)
  })

  // The timeline reports a click on a stop, which opens that prompt.
  on('ui.message', { requestId: 'prompts' }, async ($, e, next) => {
    const message = e.data as TimelineMessage
    if (message.type === 'select' && message.index !== selected) {
      selected = message.index
      $.ui.invalidate('ui.render')
    }

    return next(e)
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE && e.requestId !== SETTINGS) return next(e)
    if (isOpening) $.clock.after(0, () => endOpening($))
    const { Box, Button, Client, Text } = $.ui.resolve(e)

    if (e.requestId === SETTINGS) {
      const rows = (await $.config.list()).filter(row => row.key.startsWith('mod-prompts.'))
      return (
        <Box flexDirection="column" backgroundColor={THEME.bg} paddingX={1} minHeight={e.props.scroll.bodyRows}>
          {tabRow({ Box, Client, Text }, look.nerd, tabs(true), still)}
          <Text color={statusColor(note)}>{withMark(look, note) || fill(text.settingsHint, { sep: MARK.sep })}</Text>
          <Box marginTop={0}>{settingsBody({ Box, Button, Client, Text }, look, { rows, actions: [], working: false, run: async () => {}, still })}</Box>
        </Box>
      )
    }

    // A reload resets module state while the pane stays open, so read the transcript again.
    if (prompts.length === 0) await load($)

    const width = Math.max(10, e.props.bodyColumns - 2 - GUTTER - 2)
    const current = prompts[selected]
    const stops = prompts.map((prompt, index) => ({ index, time: clock(prompt.at), text: oneLine(prompt.text, width) }))
    const marks = { dot: MARK.stop, openDot: MARK.stopOpen, rail: MARK.rail }
    pageCount = Math.max(1, Math.ceil(stops.length / PAGE_SIZE))
    const shownPage = Math.min(pageCount - 1, page < 0 ? Math.floor(Math.max(0, selected) / PAGE_SIZE) : page)
    const first = shownPage * PAGE_SIZE
    const onPage = stops.slice(first, first + PAGE_SIZE)
    const hasOpen = selected >= first && selected < first + PAGE_SIZE
    const before = hasOpen ? onPage.filter(stop => stop.index <= selected) : onPage
    const after = hasOpen ? onPage.filter(stop => stop.index > selected) : []
    const pager = (id: string, label: string) => (
      <Client key={id} module="./entry.tsx" height={1} props={{ id, label, isOpen: false, bg: THEME.surface3, idle: THEME.secondary, still } satisfies EntryProps} />
    )
    // The engine caps how large one Client's tree may serialize, so a long session's stops spread over several Clients.
    const timeline = (key: string, list: typeof stops, railFirst: boolean) =>
      Array.from({ length: Math.ceil(list.length / STOPS_PER_CLIENT) }, (_, n) => {
        const chunk = list.slice(n * STOPS_PER_CLIENT, (n + 1) * STOPS_PER_CLIENT)
        const first = railFirst || n > 0
        return <Client key={n === 0 ? key : `${key}-${n}`} module="./timeline.tsx" height={timelineRows(chunk.length, first)} props={{ stops: chunk, selected, railFirst: first, ...marks } satisfies TimelineProps} />
      })
    const stat = (key: string, body: unknown) => pill({ Box, Text }, look.nerd, THEME.surface3, body, key, THEME.bg)
    const stats = current
      ? [
          current.durationMs !== undefined ? stat('open-time', <Text color={THEME.muted}>{duration(current.durationMs)}</Text>) : null,
          current.added || current.removed
            ? stat('open-counts', (
                <Text>
                  <Text color={THEME.good}>{current.added ? `+${current.added}` : ''}</Text>
                  <Text color={THEME.alert}>{current.added && current.removed ? ' ' : ''}{current.removed ? `−${current.removed}` : ''}</Text>
                </Text>
              ))
            : null,
          current.tools ? stat('open-tools', <Text color={THEME.muted}>{fill(text.tools, { count: current.tools })}</Text>) : null,
        ].filter(Boolean)
      : []

    // Mouse only: the jump is a Button, since a scroll needs the person's press behind it; a click on a stop opens it.
    return (
      <Box flexDirection="column" backgroundColor={THEME.bg} paddingX={1} minHeight={e.props.scroll.bodyRows}>
        {tabRow({ Box, Client, Text }, look.nerd, tabs(false), still)}
        <Text color={statusColor(note)}>{note || fill(text.hint, { sep: MARK.sep })}</Text>
        {prompts.length === 0 ? <Text color={THEME.muted}>{text.empty}</Text> : null}
        {current ? cardSpace({ Box }, CARD_ROWS) : null}
        <Box marginTop={1} flexDirection="column">
          {before.length > 0 ? (
            timeline('timeline-before', before, false)
          ) : null}
          {current && hasOpen ? (
            <Box key="open" flexDirection="row" paddingLeft={GUTTER} columnGap={1}>
              {/* The rail runs on only when a stop follows. */}
              <Text color={THEME.accent}>{after.length > 0 ? MARK.rail : ' '}</Text>
              <Box key="open-stats" flexDirection="row" columnGap={1} flexGrow={1}>
                {stats}
              </Box>
              {/* A Button, not an Entry: a transcript scroll needs the person's press, and a Client click is refused as not person-initiated. */}
              {stat('open-jump-pill', <Button key="open-jump" label={`${look.glyph.go.replace(/[[\]\s]/g, '')} ${text.jump}`} plain hover={{ scope: 'open-jump', color: THEME.accent }} onPress={() => jump($, selected)} />)}
            </Box>
          ) : null}
          {after.length > 0 ? (
            timeline('timeline-after', after, true)
          ) : null}
        </Box>
        {current
          ? stickyCard({ Box }, e.props.scroll.offset, e.props.bodyColumns, CARD_ROWS, [
              <Box key="card-title" flexShrink={0}>
                <Text color={THEME.onSurface} bold>{[fill(text.cardNumber, { n: selected + 1 }), clock(current.at)].filter(Boolean).join(` ${MARK.sep} `)}</Text>
              </Box>,
              <Box key="card-text" height={CARD_ROWS - 3 - (pageCount > 1 ? 1 : 0)} overflow="hidden" flexShrink={0}>
                <Text color={THEME.muted}>{current.text}</Text>
              </Box>,
              // The pager rides in the pinned card, so it stays in view however far the timeline scrolls.
              pageCount > 1 ? (
                <Box key="pager" flexDirection="row" columnGap={1} flexShrink={0}>
                  {shownPage > 0 ? pill({ Box, Text }, look.nerd, THEME.surface3, pager('prompts-page-prev', text.pagePrev), 'pager-prev', THEME.surface1) : null}
                  <Text color={THEME.muted}>{fill(text.page, { page: shownPage + 1, pages: pageCount, from: first + 1, to: first + onPage.length, sep: MARK.sep })}</Text>
                  {shownPage < pageCount - 1 ? pill({ Box, Text }, look.nerd, THEME.surface3, pager('prompts-page-next', text.pageNext), 'pager-next', THEME.surface1) : null}
                </Box>
              ) : null,
            ])
          : null}
      </Box>
    )
  })
}
