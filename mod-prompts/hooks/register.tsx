import type { ConfigRow, ConfigValue, EngineInterface, Register } from 'claude-code'

import { cardSpace, stickyCard } from './card'
import type { ListMessage } from './list'
import type { EntryMessage } from './entry'
import { isNerdFace, lookFor, paneTitle, terminalSettings, withMark, type IconMode } from './look'
import { PILL, pillRow, splitRow, tipLine, titleRow } from './pills'
import { settingsBody } from './settings'
import { TOAST_MS, ToastList, toastCards } from './toasts'
import { parseRow, promptsOf, promptText, rowKey, targetOf, type Prompt, type Row } from './prompts'
import { actionColumn } from './rows'
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

// The jump control on each row.
const GO = '[↵]'

// Border, the number line and three lines of the prompt.
const CARD_ROWS = 6

let transcript = ''
// A long session's transcript takes seconds to read, so it is read once; later prompts come from the rows Claude Code draws.
let isLoaded = false
let prompts: Prompt[] = []
let selected = -1
let note = ''
// Row key -> the requestId Claude Code drew that prompt's row under, which a jump scrolls to.
const drawn = new Map<string, string>()

const isOpen = async ($: EngineInterface, id = PANE) => (await $.ui.panes()).some(pane => pane.id === id && pane.isPlaced)

// A long session outgrows $.fs.read's 4 MiB cap; then the transcript streams through the platform's own file printer.
async function load($: EngineInterface) {
  if (isLoaded) return
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
  prompts = promptsOf(rows)
  if (selected < 0 || selected >= prompts.length) selected = prompts.length - 1
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
    if (!e.agentId && (await isOpen($))) $.ui.invalidate('ui.render')

    return next(e)
  })

  // Each prompt row as Claude Code draws it, so a jump scrolls to the id the row really has.
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    drawn.set(rowKey(e.requestId), e.requestId)
    // A prompt sent after the read joins the list as its row draws.
    const text = e.props.origin?.kind === 'composer' ? promptText(String(e.props.text ?? '')) : undefined
    if (isLoaded && text && !prompts.some(prompt => rowKey(prompt.id) === rowKey(e.requestId))) {
      prompts = [...prompts, { id: e.requestId, text, at: new Date().toISOString() }]
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
    const entry = (
      <Box key="menu-pad-prompts">
        <Client key="menu-entry-prompts" module="./entry.tsx" height={1} props={{ id: 'prompts', label: text.pillLabel, isOpen: shown, bg: PILL.primary, idle: THEME.pill, isBusy: isOpening, still }} />
      </Box>
    )

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
    // The title row's pill swaps the sidebar and its settings.
    if (message?.type === 'menu-entry' && message.id === 'prompts-settings') await toggleSettings($)
    if (message?.type === 'menu-entry' && message.id === 'prompts-back') await togglePane($)

    return next(e)
  })

  // The list reports clicks on a prompt's text, which select it into the card.
  on('ui.message', { requestId: 'prompts' }, async ($, e, next) => {
    const message = e.data as ListMessage
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
      // A saved change reloads this mod, which redraws the panel with the new value.
      const set = async (row: ConfigRow, value: ConfigValue) => {
        const result = await $.config.set({ key: row.key, value })
        note = 'deny' in result && result.deny ? `${MARK.warn} ${result.deny}` : `${MARK.ok} ${fill(text.settingSaved, { label: row.label })}`
        $.ui.invalidate('ui.render')
      }
      return (
        <Box flexDirection="column" backgroundColor={THEME.bg} paddingX={1} minHeight={e.props.scroll.bodyRows}>
          {titleRow({ Box, Client, Text }, look.nerd, paneTitle({ Box, Text }, look, 'settings', text.settingsHeading), 'prompts-back', `${look.glyph.back} ${text.backPill}`, still)}
          <Text color={statusColor(note)}>{withMark(look, note) || fill(text.settingsHint, { sep: MARK.sep })}</Text>
          <Box marginTop={0}>{settingsBody({ Box, Button, Text }, look, { rows, actions: [], working: false, set, run: async () => {} })}</Box>
        </Box>
      )
    }

    // A reload resets module state while the pane stays open, so read the transcript again.
    if (prompts.length === 0) await load($)

    const width = Math.max(10, e.props.bodyColumns - 2 - GO.length - 1)
    const number = String(prompts.length).length
    const current = prompts[selected]

    // Mouse only: [↵] is a Button, since a jump needs the person's press behind it; a click on the text selects it into the card.
    return (
      <Box flexDirection="column" backgroundColor={THEME.bg} paddingX={1} minHeight={e.props.scroll.bodyRows}>
        {titleRow({ Box, Client, Text }, look.nerd, <Text color={THEME.accent} bold>{`${MARK.stage} ${fill(text.heading, { sep: MARK.sep, count: prompts.length })}`}</Text>, 'prompts-settings', `${look.glyph.gear} ${text.settingsPill}`, still)}
        <Text color={statusColor(note)}>{note || fill(text.hint, { go: GO, sep: MARK.sep })}</Text>
        {prompts.length === 0 ? <Text color={THEME.muted}>{text.empty}</Text> : null}
        {current ? cardSpace({ Box }, CARD_ROWS) : null}
        <Box marginTop={1} flexDirection="row" columnGap={1}>
          {actionColumn(
            { Box, Button, Text },
            'prompts',
            prompts.map((_, index) => ({ label: GO, onPress: () => jump($, index) })),
          )}
          <Client
            key="list"
            module="./list.tsx"
            height={prompts.length}
            props={{ rows: prompts.map((prompt, index) => ({ number: String(index + 1).padStart(number), time: clock(prompt.at), text: oneLine(prompt.text, width - number - 1 - (prompt.at ? 6 : 0)) })), selected }}
          />
        </Box>
        {current
          ? stickyCard({ Box }, e.props.scroll.offset, e.props.bodyColumns, CARD_ROWS, [
              <Box key="card-title" flexShrink={0}>
                <Text color={THEME.onSurface} bold>{[fill(text.cardNumber, { n: selected + 1 }), clock(current.at)].filter(Boolean).join(` ${MARK.sep} `)}</Text>
              </Box>,
              <Box key="card-text" height={CARD_ROWS - 3} overflow="hidden" flexShrink={0}>
                <Text color={THEME.muted}>{current.text}</Text>
              </Box>,
            ])
          : null}
      </Box>
    )
  })
}
