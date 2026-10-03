import type { EngineInterface, Register } from 'claude-code'

import { cardSpace, stickyCard } from './card'
import type { ListMessage } from './list'
import type { EntryMessage } from './entry'
import { PILL, pillRow, splitRow, tipLine } from './pills'
import { parseRow, promptsOf, rowKey, targetOf, type Prompt, type Row } from './prompts'
import { actionColumn } from './rows'
import { MARK, statusColor, THEME } from './theme'

const PANE = 'prompts'

// The jump control on each row.
const GO = '[↵]'

// Border, the number line and three lines of the prompt.
const CARD_ROWS = 6

let transcript = ''
let rows: Row[] = []
// Characters of the transcript already parsed, and its size then, so a re-read parses only new lines.
let consumed = 0
let lastSize = -1
let prompts: Prompt[] = []
let selected = -1
let note = ''
// Row key -> the requestId Claude Code drew that prompt's row under, which a jump scrolls to.
const drawn = new Map<string, string>()

const isOpen = async ($: EngineInterface) => (await $.ui.panes()).some(pane => pane.id === PANE && pane.isPlaced)

// A long session outgrows $.fs.read's 4 MiB cap; then the transcript streams through the platform's own file printer.
async function load($: EngineInterface) {
  if (!transcript) transcript = String((await $.store.get(`transcript:${await $.session.id()}`)) ?? '')
  if (!transcript) transcript = await findTranscript($)
  if (!transcript) return
  const { size } = await $.fs.stat(transcript).catch(() => ({ size: -1 }))
  if (size === lastSize) return
  let text = String(await $.fs.read(transcript).catch(() => ''))
  if (!text && size > 0) {
    const isWindows = /^[A-Za-z]:|\\/.test(transcript)
    // cmd's type rejects forward slashes ("The syntax of the command is incorrect").
    const argv = isWindows ? ['cmd', '/c', 'type', transcript.replace(/\//g, '\\')] : ['cat', transcript]
    for await (const chunk of $.process.spawn({ argv })) {
      if (chunk.stream === 'stdout') text += chunk.text
    }
  }
  // A failed read leaves the size unrecorded, so the next open tries again.
  if (!text) return
  const end = text.lastIndexOf('\n') + 1
  if (end < consumed) {
    rows = []
    consumed = 0
  }
  for (const line of text.slice(consumed, end).split('\n')) {
    const row = line.trim() ? parseRow(line) : undefined
    if (row) rows.push(row)
  }
  consumed = end
  lastSize = size
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
  note = ''
  selected = -1
  await load($)
  const opened = await $.ui.open({ id: PANE, title: 'Prompts', closeOnEscape: true })
  if (!opened.isPlaced) $.ui.toast(`Prompts panel waiting: ${opened.reason}`)
  await $.state.set({ plugin: 'mod-prompts', key: 'pane' }, opened.isPlaced)
}

// Scrolls the transcript to the prompt's row; Claude Code allows it only with the person's press behind it.
async function jump($: EngineInterface, index: number) {
  const prompt = prompts[index]
  if (!prompt) return
  selected = index
  const result = await $.ui.scroll({ to: { requestId: targetOf(drawn, prompt.id) }, block: 'start' }).catch((error: Error) => ({ deny: error.message }))
  note = result.deny ? `${MARK.warn} ${result.deny}` : `${MARK.ok} Jumped to #${index + 1}`
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

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'mod-prompts', description: 'Open the prompts sidebar: every prompt of this session, Enter or click jumps to it' })
    // The bar entry reads this; an unload drops the pane without raising ui.close here.
    await $.state.set({ plugin: 'mod-prompts', key: 'pane' }, await isOpen($))
    // A hot reload leaves an open pane on its old drawing until something redraws it.
    $.ui.invalidate('ui.render')

    return next(e)
  })

  // Only the settings hook event names the transcript; kept per session so a reload finds it again.
  on('classic.SessionStart', async ($, e, next) => {
    transcript = e.transcript_path
    rows = []
    consumed = 0
    lastSize = -1
    await $.store.set(`transcript:${e.session_id}`, e.transcript_path)

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (!e.agentId && (await isOpen($))) {
      await load($)
      $.ui.invalidate('ui.render')
    }

    return next(e)
  })

  // Each prompt row as Claude Code draws it, so a jump scrolls to the id the row really has.
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    drawn.set(rowKey(e.requestId), e.requestId)

    return next(e)
  })

  on('command.run', { command: 'mod-prompts' }, async $ => {
    await togglePane($)

    return { text: '' }
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) await $.state.set({ plugin: 'mod-prompts', key: 'pane' }, false)

    return next(e)
  })

  // Deferred past this dispatch, so this mod's own state write is not nested in another plugin's.
  on('state.set', async ($, e, next) => {
    if (e.key === 'pane' && e.plugin !== 'mod-prompts' && e.value === true) {
      $.clock.after(0, async () => {
        if (!(await isOpen($))) return
        await $.ui.close({ id: PANE })
        await $.state.set({ plugin: 'mod-prompts', key: 'pane' }, false)
      })
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const hidden = await $.state.get({ plugin: 'mod-menu', key: 'hidden' })
    if (e.surface !== 'terminal' || e.props.hasSurvey || hidden.value === true) return next(e)
    const nerd = (await $.state.get({ plugin: 'mod-menu', key: 'nerd' })).value === true

    const { Box, Client, Text } = $.ui.resolve(e)
    // Reading the value subscribes the bar to redraws; the look trusts the pane list itself.
    await $.state.get({ plugin: 'mod-prompts', key: 'pane' })
    const shown = await isOpen($)
    const { group, row, rest, tip } = splitRow(await next(e))
    // Opening the pane from here queues nothing, so the entry stays live mid-turn.
    const entry = (
      <Box key="menu-pad-prompts">
        <Client key="menu-entry-prompts" module="./entry.tsx" height={1} props={{ id: 'prompts', label: 'Prompts', isOpen: shown, bg: PILL.primary, idle: THEME.pill }} />
      </Box>
    )

    return pillRow({ Box, Text }, nerd, [entry, ...group], row, rest, tipShown ? tipLine({ Box, Text }, 'Prompts: every prompt this session, click one to jump to it') : tip)
  })

  on('ui.message', async ($, e, next) => {
    const hover = e.data as { type?: string; id?: string; isOver?: boolean }
    if (hover?.type === 'menu-hover' && hover.id === 'prompts') {
      tipShown = hover.isOver === true
      $.ui.invalidate('ui.render')
    }
    const message = e.data as EntryMessage
    if (message?.type === 'menu-entry' && message.id === 'prompts') await togglePane($)

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
    if (e.requestId !== PANE) return next(e)

    // A reload resets module state while the pane stays open, so read the transcript again.
    if (prompts.length === 0) await load($)

    const { Box, Button, Client, Text } = $.ui.resolve(e)
    const width = Math.max(10, e.props.bodyColumns - 2 - GO.length - 1)
    const number = String(prompts.length).length
    const current = prompts[selected]

    // Mouse only: [↵] is a Button, since a jump needs the person's press behind it; a click on the text selects it into the card.
    return (
      <Box flexDirection="column" backgroundColor={THEME.bg} paddingX={1} minHeight={e.props.scroll.bodyRows}>
        <Text color={THEME.accent} bold>{`${MARK.stage} Prompts ${MARK.sep} ${prompts.length}`}</Text>
        <Text color={statusColor(note)}>{note || `click ${GO} to jump ${MARK.sep} click a prompt to read it`}</Text>
        {prompts.length === 0 ? <Text color={THEME.muted}>No prompts yet.</Text> : null}
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
                <Text color={THEME.onSurface} bold>{[`#${selected + 1}`, clock(current.at)].filter(Boolean).join(` ${MARK.sep} `)}</Text>
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
