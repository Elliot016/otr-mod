import type { ConfigValue, EngineInterface, Register, SessionMessage } from 'claude-code'

import { checkPrompt, parseCheck, parseRecheck, parseRewrite, recheckPrompt, rewritePrompt, type Direction } from './ask'
import type { EntryMessage, EntryProps } from './entry'
import { isNerdFace, lookFor, section, subpill, terminalSettings, withMark, type IconMode } from './look'
import { byTurn, canFork, CLEAR_AFTER_PROMPTS, emptySaved, KNOWN_KEPT, pack, remember, sameText, savedOf, SEEN_KEPT, shouldCheck, stringsOf, unreadCount, type Note, type Saved } from './notes'
import { menuEntry, pill, PILL, pillRow, splitRow, tabRow, tipLine } from './pills'
import { settingChoice, settingsBody, type Action, type Previews } from './settings'
import text from './text'
import { fill, MARK, mix, statusColor, THEME, WASH } from './theme'
import { TOAST_MS, ToastList, toastCards } from './toasts'

// The settings (userConfig), fixed per activation: a change reloads the mod.
let iconMode: IconMode = 'auto'
let enabled = true
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

const PANE = 'headsup'
const SETTINGS = 'headsup-settings'

// The session's notes, the shown card and the prompt count live in the store, so a reload or a resume keeps them.
let saved: Saved = emptySaved()
let loadedSession = ''
let seen: string[] = []
let known: string[] = []

// The last main request's model and effort, which pick the check's route.
let lastModel = ''
let lastEffort: string | number | undefined
// A check runs at most once per turn.
let checkedTurn = ''
let isChecking = false
// Main requests seen so far, so a check knows whether the session moved on while it ran.
let mainSteps = 0
// `<direction>-<note id>` while a rewrite runs.
let rewriting = ''
// The note opened in the panel.
let expanded = ''
let note = ''
let actions: Action[] = []
let previews: Previews | undefined
// Prompt text -> the requestId Claude Code drew its row under, which ↗ scrolls to.
const drawn = new Map<string, string>()

async function ensureLoaded($: EngineInterface) {
  const session = await $.session.id()
  if (session === loadedSession) return
  loadedSession = session
  saved = savedOf(await $.store.get(`notes:${session}`).catch(() => undefined))
  seen = stringsOf(await $.store.get('seen').catch(() => undefined))
  known = stringsOf(await $.store.get('known').catch(() => undefined))
}

async function save($: EngineInterface) {
  await $.store.set(`notes:${loadedSession}`, saved).catch(() => {
    // Without a store the notes still show until the next reload.
  })
}

const noteOf = (id: string) => saved.notes.find(each => each.id === id)

// A fork runs at the session's effort and reads its cache; above medium, or with nothing to fork yet, the packed conversation goes to the session's model at medium.
async function ask($: EngineInterface, prompt: string) {
  if (canFork(lastEffort)) {
    const reply = await $.model.fork({ prompt })
    if (reply.isAnswered) return reply.text
    if (!('reason' in reply) || reply.reason !== 'nothing-to-fork') return null
  }
  const messages = (await $.session.messages()) as SessionMessage[]
  const model = lastModel || (await $.session.model())
  const reply = await $.model.complete({ model, effort: 'medium', prompt: `<conversation>\n${pack(messages)}\n</conversation>\n\n${prompt}`, maxTokens: 1500, timeoutMs: 120_000 })
  return reply.isAnswered ? reply.text : null
}

async function check($: EngineInterface) {
  if (isChecking) return
  isChecking = true
  $.ui.invalidate('ui.render')
  try {
    await ensureLoaded($)
    const session = loadedSession
    const startStep = mainSteps
    const reply = await ask($, checkPrompt(seen, known))
    const found = reply ? parseCheck(reply) : null
    // A /clear while the check ran makes it another session's.
    if (!found || seen.includes(found.learn) || session !== (await $.session.id())) return
    // The main agent often catches the same thing within a step or two, so a finding that a newer step may have overtaken is asked about once more.
    if (mainSteps !== startStep) {
      const verdict = await ask($, recheckPrompt(found))
      if (!verdict || !parseRecheck(verdict) || session !== (await $.session.id())) return
    }
    const at = await $.clock.now()
    const added: Note = { ...found, id: `n${saved.notes.length + 1}-${at}`, turn: saved.prompts, prompt: saved.lastPrompt, at, isRead: false }
    saved = { ...saved, notes: [...saved.notes, added], card: added.id, since: 0 }
    seen = remember(seen, found.learn, SEEN_KEPT)
    await save($)
    await $.store.set('seen', seen).catch(() => {})
  } catch {
    // A heads-up is a courtesy: any failure shows nothing.
  } finally {
    isChecking = false
    $.ui.invalidate('ui.render')
  }
}

async function update($: EngineInterface, id: string, change: Partial<Note>) {
  saved = { ...saved, notes: saved.notes.map(each => (each.id === id ? { ...each, ...change } : each)) }
  await save($)
  $.ui.invalidate('ui.render')
}

async function closeCard($: EngineInterface) {
  if (!saved.card) return
  saved = { ...saved, card: null, since: 0 }
  await save($)
  $.ui.invalidate('ui.render')
}

async function knowIt($: EngineInterface, id: string) {
  const found = noteOf(id)
  if (!found) return
  known = remember(known, found.title || found.learn, KNOWN_KEPT)
  await $.store.set('known', known).catch(() => {})
  if (saved.card === id) saved = { ...saved, card: null, since: 0 }
  await update($, id, { isRead: true })
}

// Appends to the prompt and skips a line already there; nothing is sent.
async function chat($: EngineInterface, id: string) {
  const found = noteOf(id)
  if (!found) return
  const line = fill(text.chatPrompt, { learn: found.learn })
  const draft = await $.prompt.read()
  if (draft.text.includes(line)) return
  const isEmpty = draft.text.trim() === ''
  await $.prompt.fill({ text: isEmpty ? line : ` ${line}`, mode: isEmpty ? 'replace' : 'append' })
}

async function redo($: EngineInterface, id: string, direction: Direction) {
  const found = noteOf(id)
  if (!found || rewriting) return
  rewriting = `${direction}-${id}`
  $.ui.invalidate('ui.render')
  try {
    const reply = await ask($, rewritePrompt(found, direction))
    const rewritten = reply ? parseRewrite(reply) : null
    if (rewritten) await update($, id, { title: rewritten.title || found.title, body: rewritten.body })
  } catch {
    // The old explanation stays.
  } finally {
    rewriting = ''
    $.ui.invalidate('ui.render')
  }
}

const isOpen = async ($: EngineInterface, id = PANE) => (await $.ui.panes()).some(pane => pane.id === id && pane.isPlaced)

// The command and the bar entry both toggle. An unplaced pane is waiting, not open.
async function togglePane($: EngineInterface) {
  if (await isOpen($)) {
    await $.ui.close({ id: PANE })
    await $.state.set({ plugin: 'mod-heads-up', key: 'pane' }, false)
    return
  }
  await showPane($)
}

async function showPane($: EngineInterface) {
  if (await isOpen($)) {
    $.ui.invalidate('ui.render')
    return
  }
  if (await isOpen($, SETTINGS)) await $.ui.close({ id: SETTINGS })
  note = ''
  const opened = await $.ui.open({ id: PANE, title: text.paneTitle, closeOnEscape: true })
  if (!opened.isPlaced) $.ui.toast(fill(text.panelWaiting, { reason: opened.reason }))
  await $.state.set({ plugin: 'mod-heads-up', key: 'pane' }, opened.isPlaced)
}

// `/mod-heads-up settings` and the Settings tab swap the panel for its settings.
async function toggleSettings($: EngineInterface) {
  if (await isOpen($, SETTINGS)) {
    await $.ui.close({ id: SETTINGS })
    await $.state.set({ plugin: 'mod-heads-up', key: 'pane' }, false)
    return
  }
  if (await isOpen($)) await $.ui.close({ id: PANE })
  note = ''
  const showcase = await $.fs.read(`${$.plugin.root}/showcase.json`).then(raw => JSON.parse(String(raw))).catch(() => null)
  previews = showcase?.previews
  actions = (Array.isArray(showcase?.actions) ? showcase.actions : []).map((action: Action) => ({ ...action, isLocal: action.command === 'mod-heads-up' }))
  const opened = await $.ui.open({ id: SETTINGS, title: text.settingsPaneTitle, closeOnEscape: true })
  if (!opened.isPlaced) $.ui.toast(fill(text.settingsWaiting, { reason: opened.reason }))
  await $.state.set({ plugin: 'mod-heads-up', key: 'pane' }, opened.isPlaced)
}

// The entry shimmers from the click until the pane draws, so a slow open never looks ignored.
const OPEN_WAIT_MS = 8000
let isOpening = false

function endOpening($: EngineInterface) {
  if (!isOpening) return
  isOpening = false
  $.ui.invalidate('ui.render')
}

async function openingPane($: EngineInterface, open: () => Promise<void>) {
  if (!(await isOpen($))) {
    isOpening = true
    $.ui.invalidate('ui.render')
    $.clock.after(OPEN_WAIT_MS, () => endOpening($))
  }
  await open()
  if (!(await isOpen($))) endOpening($)
}

// The card's Learn more: the panel opens on that note, already expanded and read.
async function learnMore($: EngineInterface, id: string) {
  expanded = id
  if (saved.card === id) saved = { ...saved, card: null, since: 0 }
  await update($, id, { isRead: true })
  await openingPane($, () => showPane($))
}

// What `/mod-heads-up <args>` does; the panel's own actions call it directly, since $.command.run skips the calling plugin.
async function answer($: EngineInterface, args: string) {
  const word = args.trim()
  if (word === 'clear') {
    await closeCard($)
    return text.cardCleared
  }
  if (word === 'forget') {
    known = []
    await $.store.set('known', known).catch(() => {})
    return text.knownForgotten
  }
  if (word === 'settings') await toggleSettings($)
  else await togglePane($)
  return ''
}

// Scrolls the transcript to the turn's prompt row; Claude Code allows it only with the person's press behind it.
async function jump($: EngineInterface, turn: number, prompt: string) {
  const requestId = drawn.get(sameText(prompt))
  if (!requestId) {
    note = `${MARK.warn} ${fill(text.notDrawn, { n: turn })}`
  } else {
    const result = await $.ui.scroll({ to: { requestId }, block: 'start' }).catch((error: Error) => ({ deny: error.message }))
    note = 'deny' in result && result.deny ? `${MARK.warn} ${result.deny}` : `${MARK.ok} ${fill(text.jumped, { n: turn })}`
  }
  $.ui.invalidate('ui.render')
}

async function saveSetting($: EngineInterface, key: string, value: ConfigValue) {
  const row = (await $.config.list()).find(each => each.key === key)
  const result = await $.config.set({ key, value })
  note = 'deny' in result && result.deny ? `${MARK.warn} ${result.deny}` : `${MARK.ok} ${fill(text.settingSaved, { label: row?.label ?? key })}`
  $.ui.invalidate('ui.render')
}

const fit = (line: string, width: number) => {
  const flat = line.replace(/\s+/g, ' ')
  return flat.length <= width ? flat : `${flat.slice(0, Math.max(0, width - 1))}…`
}

const clock = (at: number) => {
  const date = new Date(at)
  return Number.isNaN(date.getTime()) ? '' : `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

// A control glyph without the brackets and padding it carries as a Button label, for drawing inside a pill.
const bare = (glyph: string) => glyph.replace(/[[\]\s]/g, '')

const tabs = (isSettings: boolean) => [
  { id: 'headsup-tab', label: text.paneTitle, icon: look.glyph.warn, isOpen: !isSettings, count: saved.notes.length },
  { id: 'headsup-settings', label: text.settingsTab, icon: look.glyph.gear, isOpen: isSettings },
]

// True while the pointer is on this mod's pill entry, which then shows its tip above the row.
let tipShown = false

const toasts = new ToastList('headsup')
// The animations setting, fixed per activation: off, every entry draws still.
let still = false

const DIRECTIONS: [Direction, string][] = [['simpler', text.simpler], ['less', text.lessDetail], ['more', text.moreDetail]]

export const register: Register = (on, options) => {
  still = options.animations === false
  enabled = options.enabled !== false
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
    await $.command.register({ name: 'mod-heads-up', description: text.commandDescription, argumentHint: '[settings|clear|forget]' })
    await ensureLoaded($)
    // The bar entry reads this; an unload drops the pane without raising ui.close here.
    await $.state.set({ plugin: 'mod-heads-up', key: 'pane' }, (await isOpen($)) || (await isOpen($, SETTINGS)))
    $.ui.invalidate('ui.render')

    return next(e)
  })

  on('command.run', { command: 'mod-heads-up' }, async ($, e) => ({ text: await answer($, e.args ?? '') }))

  // Main requests only: a subagent's steps carry agentId. The check runs off the hook's time, so the turn never waits.
  on('turn.step', async function* ($, e, next) {
    if (!e.agentId) {
      lastModel = e.model
      lastEffort = e.effort
      mainSteps += 1
      if (enabled && shouldCheck(e.index, e.turnId, checkedTurn, Boolean(saved.card))) {
        checkedTurn = e.turnId
        $.clock.after(0, () => check($))
      }
    }

    return yield* next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    const sent = sameText(String(e.text ?? ''))
    if (sent && !sent.startsWith('/')) {
      await ensureLoaded($)
      const since = saved.card ? saved.since + 1 : 0
      saved = { ...saved, prompts: saved.prompts + 1, lastPrompt: sent, since, card: since >= CLEAR_AFTER_PROMPTS ? null : saved.card }
      await save($)
      $.ui.invalidate('ui.render')
    }

    return next(e)
  })

  // Each prompt row as Claude Code draws it, so ↗ scrolls to the id the row really has.
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    if (e.props.origin?.kind === 'composer') drawn.set(sameText(String(e.props.text ?? '')), e.requestId)

    return next(e)
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE || e.id === SETTINGS) await $.state.set({ plugin: 'mod-heads-up', key: 'pane' }, await isOpen($, e.id === PANE ? SETTINGS : PANE))

    return next(e)
  })

  // One panel at a time: another mod's pane opening closes this one, deferred past that plugin's dispatch.
  on('state.set', async ($, e, next) => {
    if (e.key === 'pane' && e.plugin !== 'mod-heads-up' && e.value === true) {
      $.clock.after(0, async () => {
        if (!(await isOpen($)) && !(await isOpen($, SETTINGS))) return
        await $.ui.close({ id: PANE })
        await $.ui.close({ id: SETTINGS })
        await $.state.set({ plugin: 'mod-heads-up', key: 'pane' }, false)
      })
    }

    return next(e)
  })

  on('ui.message', async ($, e, next) => {
    const change = settingChoice(e.data)
    if (change) await saveSetting($, change.key, change.value)
    const hover = e.data as { type?: string; id?: string; isOver?: boolean }
    if (hover?.type === 'menu-hover' && hover.id === 'headsup') {
      tipShown = hover.isOver === true
      $.ui.invalidate('ui.render')
    }
    const clicked = e.data as EntryMessage
    if (clicked?.type !== 'menu-entry') return next(e)
    const dismissed = toasts.idOf(clicked.id)
    if (dismissed !== undefined) {
      toasts.drop(dismissed)
      $.ui.invalidate('ui.render')
      return next(e)
    }
    const id = clicked.id
    const card = saved.card ?? ''
    if (id === 'headsup') await openingPane($, () => togglePane($))
    else if (id === 'headsup-tab' && !(await isOpen($))) await showPane($)
    else if (id === 'headsup-settings' && !(await isOpen($, SETTINGS))) await toggleSettings($)
    else if (id === 'headsup-card-learn' && card) await learnMore($, card)
    else if (id === 'headsup-card-know' && card) await knowIt($, card)
    else if (id === 'headsup-card-dismiss' && card) {
      await closeCard($)
      await update($, card, { isRead: true })
    } else if (id.startsWith('headsup-note-')) {
      const noteId = id.slice('headsup-note-'.length)
      expanded = expanded === noteId ? '' : noteId
      await update($, noteId, { isRead: true })
    } else if (id.startsWith('headsup-understood-')) {
      const noteId = id.slice('headsup-understood-'.length)
      expanded = ''
      await update($, noteId, { isRead: true })
    } else if (id.startsWith('headsup-chat-')) await chat($, id.slice('headsup-chat-'.length))
    else if (id.startsWith('headsup-know-')) await knowIt($, id.slice('headsup-know-'.length))
    else if (id.startsWith('headsup-redo-')) {
      const [direction, ...rest] = id.slice('headsup-redo-'.length).split('-')
      await redo($, rest.join('-'), direction as Direction)
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    await loadLook($)
    if (e.surface !== 'terminal' || e.props.hasSurvey) return next(e)
    await ensureLoaded($)
    const elements = $.ui.resolve(e)
    const { Box, Client, Text } = elements
    const nerd = look.nerd
    // A command waiting on the person outranks a heads-up: the band has few rows, and a hidden hold looks like a hang.
    const isHolding = (await $.state.get({ plugin: 'mod-blast-radius', key: 'holding' })).value === true
    const shown = saved.card && !isHolding ? noteOf(saved.card) : undefined
    const key = (id: string, label: string, subLead: string) =>
      pill({ Box, Text }, nerd, THEME.surface3, <Client key={id} module="./entry.tsx" height={1} props={{ id, label, isOpen: true, bg: THEME.surface3, subLead, nerd, still } satisfies EntryProps} />, `${id}-pill`, THEME.surface1)
    const card = shown ? (
      <Box key="headsup-card" flexDirection="column" paddingX={1} borderStyle="round" borderColor={THEME.accent} backgroundColor={THEME.surface1}>
        <Box key="headsup-card-line" flexDirection="row" columnGap={1}>
          {subpill({ Box, Text }, nerd, THEME.surface1, shown.tag, 'headsup-card-tag')}
          <Box key="headsup-card-text" flexShrink={1}>
            <Text color={THEME.onSurface}>{shown.learn}</Text>
          </Box>
        </Box>
        <Box key="headsup-card-keys" flexDirection="row" columnGap={1}>
          {key('headsup-card-learn', text.learnMore, bare(look.glyph.go))}
          {key('headsup-card-know', text.knowThis, bare(look.glyph.ok))}
          {pill({ Box, Text }, nerd, THEME.surface3, <Client key="headsup-card-dismiss" module="./entry.tsx" height={1} props={{ id: 'headsup-card-dismiss', label: bare(look.glyph.close), isOpen: false, bg: THEME.surface3, nerd, still } satisfies EntryProps} />, 'headsup-card-dismiss-pill', THEME.surface1)}
        </Box>
      </Box>
    ) : null
    const items = [...toastCards({ Box, Client, Text }, toasts, look), card].filter(Boolean)

    const hidden = await $.state.get({ plugin: 'mod-menu', key: 'hidden' })
    if (hidden.value === true) {
      if (items.length === 0) return next(e)
      return <Box key="headsup-band" flexDirection="column">{items}{await next(e)}</Box>
    }
    // Reading the value subscribes the bar to redraws; the look trusts the pane list itself.
    await $.state.get({ plugin: 'mod-heads-up', key: 'pane' })
    const isShown = await isOpen($)
    const { group, row, rest, tip } = splitRow(await next(e))
    const unread = unreadCount(saved.notes)
    const badge = unread > 0 ? { badge: { text: String(unread), color: THEME.accent, bg: mix(THEME.accent, isShown ? THEME.lifted : PILL.primary, WASH) } } : {}
    // Opening the pane from here queues nothing, so the entry stays live mid-turn.
    const entry = menuEntry({ Box, Client, Text }, nerd, 'headsup', { label: text.pillLabel, isOpen: isShown, idle: THEME.pill, isBusy: isOpening || isChecking || rewriting !== '', still, nerd, ...badge })

    return pillRow({ Box, Text }, nerd, [entry, ...group], row, [...items, ...rest], tipShown ? tipLine({ Box, Text }, text.tip) : tip)
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    await loadLook($)
    if (e.requestId !== PANE && e.requestId !== SETTINGS) return next(e)
    if (isOpening) $.clock.after(0, () => endOpening($))
    await ensureLoaded($)
    const elements = $.ui.resolve(e)
    const { Box, Button, Client, Text } = elements
    const nerd = look.nerd

    if (e.requestId === SETTINGS) {
      const rows = (await $.config.list()).filter(row => row.key.startsWith('mod-heads-up.'))
      const run = async (action: Action) => {
        const said = action.command === 'mod-heads-up' ? answer($, action.args ?? '') : Promise.resolve('')
        note = await said.then(result => `${MARK.ok} ${result || action.label}`).catch(error => `${MARK.warn} ${String(error)}`)
        $.ui.invalidate('ui.render')
      }
      return (
        <Box flexDirection="column" backgroundColor={THEME.bg} paddingX={1} minHeight={e.props.scroll.bodyRows}>
          {tabRow({ Box, Client, Text }, nerd, tabs(true), still)}
          <Text wrap="truncate-end" color={statusColor(note)}>{withMark(look, note) || fill(text.settingsHint, { sep: MARK.sep })}</Text>
          {settingsBody({ Box, Button, Client, Text }, look, { rows, actions, working: false, run, previews, still })}
        </Box>
      )
    }

    // Pane padding, the section's border and padding, then the row's lead glyph and gaps.
    const inner = Math.max(20, e.props.bodyColumns - 2 - 4)
    const entryPill = (id: string, label: string, subLead: string | undefined, bg: string, under: string, isBusy = false) =>
      pill({ Box, Text }, nerd, bg, <Client key={id} module="./entry.tsx" height={1} props={{ id, label, isOpen: true, bg, nerd, still, isBusy, ...(subLead ? { subLead } : {}) } satisfies EntryProps} />, `${id}-pill`, under)

    const opened = (found: Note) => [
      found.learn.length > inner - found.tag.length - 8 ? <Text key={`full-${found.id}`} color={THEME.onSurface}>{found.learn}</Text> : null,
      found.title ? (
        <Box key={`title-${found.id}`} marginTop={1}>
          <Text color={THEME.onSurface} bold>{found.title}</Text>
        </Box>
      ) : null,
      ...found.body.map((line, at) => <Text key={`body-${found.id}-${at}`} color={THEME.onSurface}>{`${MARK.bullet} ${line}`}</Text>),
      <Box key={`actions-${found.id}`} flexDirection="row" columnGap={1} marginTop={1} flexWrap="wrap">
        {entryPill(`headsup-understood-${found.id}`, text.understood, bare(look.glyph.ok), THEME.surface3, THEME.surface1)}
        {entryPill(`headsup-chat-${found.id}`, text.chat, bare(look.glyph.go), THEME.surface3, THEME.surface1)}
        {entryPill(`headsup-know-${found.id}`, text.knowThisShort, undefined, THEME.surface3, THEME.surface1)}
      </Box>,
      // A choice bar: the three rewrites side by side on one surface2 pill.
      pill({ Box, Text }, nerd, THEME.surface2, (
        <Box key={`redo-body-${found.id}`} flexDirection="row">
          {DIRECTIONS.map(([direction, label]) => {
            const id = `headsup-redo-${direction}-${found.id}`
            return <Client key={id} module="./entry.tsx" height={1} props={{ id, label: ` ${label} `, isOpen: false, bg: THEME.surface2, idle: THEME.muted, nerd, still, isBusy: rewriting === `${direction}-${found.id}` } satisfies EntryProps} />
          })}
        </Box>
      ), `redo-${found.id}`, THEME.surface1),
    ]

    const groups = byTurn(saved.notes)
    return (
      <Box flexDirection="column" backgroundColor={THEME.bg} paddingX={1} minHeight={e.props.scroll.bodyRows}>
        {tabRow({ Box, Client, Text }, nerd, tabs(false), still)}
        <Text wrap="truncate-end" color={statusColor(note)}>{withMark(look, note) || fill(text.hint, { sep: MARK.sep })}</Text>
        {groups.length === 0 ? <Text color={THEME.muted}>{text.empty}</Text> : null}
        {groups.map(group =>
          section(elements, look, `turn-${group.turn}`, '', '', [
            <Box key={`turn-head-${group.turn}`} flexDirection="row" columnGap={1}>
              {subpill({ Box, Text }, nerd, THEME.surface1, fill(text.turnNumber, { n: group.turn }), `turn-number-${group.turn}`)}
              {/* Only the prompt gives way: a wrapped time made the row two lines and stretched the ↗ pill with it. */}
              <Box key={`turn-time-${group.turn}`} flexShrink={0}>
                <Text color={THEME.muted}>{clock(group.at)}</Text>
              </Box>
              <Box key={`turn-prompt-${group.turn}`} flexGrow={1} flexShrink={1}>
                <Text color={THEME.onSurface} wrap="truncate-end">{group.prompt}</Text>
              </Box>
              {/* A Button, not an entry: a transcript scroll needs the person's press. */}
              <Box key={`turn-jump-pill-${group.turn}`} flexShrink={0}>
                {pill({ Box, Text }, nerd, THEME.surface3, (
                  <Button key={`turn-jump-${group.turn}`} label={nerd ? MARK.open : ` ${MARK.open} `} plain hover={{ scope: `turn-jump-box-${group.turn}`, color: THEME.accent }} onPress={() => jump($, group.turn, group.prompt)} />
                ), `turn-jump-box-${group.turn}`, THEME.surface1)}
              </Box>
            </Box>,
            ...group.notes.flatMap(found => {
              const isExpanded = expanded === found.id
              const id = `headsup-note-${found.id}`
              const row = (
                <Client key={id} module="./entry.tsx" height={1} props={{ id, label: fit(found.learn, Math.max(10, inner - found.tag.length - 8)), isOpen: !found.isRead, bg: THEME.surface1, idle: THEME.muted, lead: isExpanded ? look.glyph.expanded : look.glyph.collapsed, leadColor: THEME.accent, subLead: found.tag, subLeadColor: THEME.accent, nerd, still } satisfies EntryProps} />
              )
              return isExpanded ? [row, <Box key={`open-${found.id}`} flexDirection="column" paddingLeft={2}>{opened(found)}</Box>] : [row]
            }),
          ]),
        )}
      </Box>
    )
  })
}
