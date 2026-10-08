import type { ConfigValue, EngineInterface, Register, SessionMessage } from 'claude-code'

import { checkPrompt, parseCheck, parseRecheck, parseRewrite, recheckPrompt, rewritePrompt, type Direction } from './ask'
import { isTipMessage, tipText, type EntryMessage, type EntryProps, type Tip } from './entry'
import { detectNerd, FOOTER_ROWS, lookFor, paneFooter, section, subpill, withMark, type IconMode } from './look'
import { byTurn, canFork, CLEAR_AFTER_PROMPTS, emptySaved, KNOWN_KEPT, pack, remember, sameText, savedOf, SEEN_KEPT, shouldCheck, stringsOf, unreadCount, type Note, type Saved } from './notes'
import { isPrompt, PLACEHOLDER, PromptNumbers } from './prompts'
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
  const env = { WT_SESSION: await $.env.get('WT_SESSION'), TERM_PROGRAM: await $.env.get('TERM_PROGRAM') }
  const local = ((await $.env.get('LOCALAPPDATA')) ?? '').replace(/\\/g, '/')
  return lookFor(await detectNerd(env, local, path => $.fs.read(path).then(String)))
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
// The prompts drawn in the composer this session, by requestId: the transcript may not hold them yet.
const drawnPrompts = new Map<string, string>()

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
// The notes opened in the panel, kept in $.state so they survive redraws.
const OPEN_KEY = { plugin: 'mod-heads-up', key: 'open' }
const openIds = async ($: EngineInterface) => stringsOf((await $.state.get(OPEN_KEY)).value)

async function setOpen($: EngineInterface, id: string, isOpen: boolean) {
  const ids = (await openIds($)).filter(each => each !== id)
  await $.state.set(OPEN_KEY, isOpen ? [...ids, id] : ids)
}
// The note whose rewording choices are shown.
let wording = ''
let note = ''
let actions: Action[] = []
let previews: Previews | undefined
// Prompt text -> the requestId Claude Code drew its row under, which ↗ scrolls to.
const drawn = new Map<string, string>()

async function ensureLoaded($: EngineInterface) {
  const session = await $.session.id()
  if (session === loadedSession) return
  loadedSession = session
  drawnPrompts.clear()
  saved = savedOf(await $.store.get(`notes:${session}`).catch(() => undefined))
  seen = stringsOf(await $.store.get('seen').catch(() => undefined))
  known = stringsOf(await $.store.get('known').catch(() => undefined))
}

async function save($: EngineInterface) {
  await $.store.set(`notes:${loadedSession}`, saved).catch(() => {
    // Without a store the notes still show until the next reload.
  })
}

// The transcript the session's SessionStart named; a session that began before this mod loaded is found by its file name.
async function transcriptOf($: EngineInterface) {
  const named = await $.store.get(`transcript:${await $.session.id()}`).catch(() => undefined)
  return typeof named === 'string' && named ? named : findTranscript($)
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

// $.fs.read rejects past 4 MiB, so a longer transcript streams through cat or type, as mod-transcript reads it.
async function transcriptText($: EngineInterface, path: string) {
  const size = path ? ((await $.fs.stat(path).catch(() => null))?.size ?? 0) : 0
  if (size === 0) return ''
  const text = String(await $.fs.read(path).catch(() => ''))
  if (text) return text
  const isWindows = /^[A-Za-z]:|\\/.test(path)
  // cmd's type rejects forward slashes.
  const argv = isWindows ? ['cmd', '/c', 'type', path.replace(/\//g, '\\')] : ['cat', path]
  let streamed = ''
  for await (const chunk of $.process.spawn({ argv })) {
    if (chunk.stream === 'stdout') streamed += chunk.text
  }
  return streamed
}

// The prompts numbered as the transcript numbers them. Read at each check: /rewind and a late load change the live branch.
async function numberPrompts($: EngineInterface) {
  const numbers = new PromptNumbers()
  for (const line of (await transcriptText($, await transcriptOf($))).split('\n')) if (line.trim()) numbers.feed(line)
  drawnPrompts.forEach((text, id) => numbers.claim(id, text))
  return numbers
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
    // The prompt the running turn answers, numbered before the check's model call takes a while.
    const running = (await numberPrompts($)).latest()
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
    const added: Note = { ...found, id: `n${saved.notes.length + 1}-${at}`, turn: running?.number ?? 0, prompt: running?.text ?? '', at, isRead: false }
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
  await setOpen($, id, true)
  bandTip = ''
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
  { id: 'headsup-tab', label: text.paneTitle, icon: look.glyph.warn, isOpen: !isSettings, count: saved.notes.length, tip: { glyph: bare(look.glyph.warn), label: text.paneTitle, text: text.tipTabNotes } },
  { id: 'headsup-settings', label: text.settingsTab, icon: look.glyph.gear, isOpen: isSettings, tip: { glyph: bare(look.glyph.gear), label: text.settingsTab, text: text.tipTabSettings } },
]

// The hovered control's tip: the band's tip row text, and the pane footer's glyph, label and text.
let bandTip = ''
let paneTip: Tip | null = null

const toasts = new ToastList('headsup')
// The animations setting, fixed per activation: off, every entry draws still.
let still = false

const DIRECTIONS: [Direction, string, string][] = [['simpler', text.simpler, text.tipSimpler], ['less', text.lessDetail, text.tipLess], ['more', text.moreDetail, text.tipMore]]

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
      saved = { ...saved, since, card: since >= CLEAR_AFTER_PROMPTS ? null : saved.card }
      await save($)
      $.ui.invalidate('ui.render')
    }

    return next(e)
  })

  // Each prompt row as Claude Code draws it, so ↗ scrolls to the id the row really has, and a prompt the transcript may not hold yet is numbered.
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    if (e.props.origin?.kind === 'composer') {
      const promptText = String(e.props.text ?? '')
      drawn.set(sameText(promptText), e.requestId)
      await ensureLoaded($)
      if (e.requestId !== PLACEHOLDER && isPrompt(promptText)) drawnPrompts.set(e.requestId, promptText)
    }

    return next(e)
  })

  // Only SessionStart names the transcript file; the store keeps it per session, as mod-transcript does.
  on('classic.SessionStart', async ($, e, next) => {
    await $.store.set(`transcript:${e.session_id}`, e.transcript_path).catch(() => {})

    return next(e)
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE || e.id === SETTINGS) paneTip = null
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
    if (isTipMessage(e.data)) {
      const tip = e.data
      const isBand = tip.id === 'headsup' || Boolean(tip.id?.startsWith('headsup-card')) || Boolean(tip.id?.startsWith('toast-headsup-'))
      if (!tip.id) {
        bandTip = ''
        paneTip = null
      } else if (isBand) bandTip = tipText(tip)
      else paneTip = { glyph: tip.glyph ?? '', label: tip.label ?? '', text: tip.text ?? '' }
      $.ui.invalidate('ui.render')
      return next(e)
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
    else if (id === 'headsup-card-open' && card) await learnMore($, card)
    else if (id === 'headsup-card-dismiss' && card) {
      bandTip = ''
      await closeCard($)
      await update($, card, { isRead: true })
    } else if (id.startsWith('headsup-note-')) {
      const noteId = id.slice('headsup-note-'.length)
      await setOpen($, noteId, !(await openIds($)).includes(noteId))
      wording = ''
      await update($, noteId, { isRead: true })
    } else if (id.startsWith('headsup-understood-')) {
      const noteId = id.slice('headsup-understood-'.length)
      await setOpen($, noteId, false)
      wording = ''
      paneTip = null
      await knowIt($, noteId)
    } else if (id.startsWith('headsup-chat-')) await chat($, id.slice('headsup-chat-'.length))
    else if (id.startsWith('headsup-reword-')) {
      const noteId = id.slice('headsup-reword-'.length)
      wording = wording === noteId ? '' : noteId
      $.ui.invalidate('ui.render')
    } else if (id.startsWith('headsup-redo-')) {
      const [direction, ...rest] = id.slice('headsup-redo-'.length).split('-')
      wording = ''
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
    const keyed = (id: string, label: string, subLead: string | undefined, tipLabel: string, tipBody: string) =>
      pill({ Box, Text }, nerd, THEME.surface3, <Client key={id} module="./entry.tsx" height={1} props={{ id, label, isOpen: true, bg: THEME.surface3, nerd, still, tip: { glyph: subLead ?? bare(look.glyph.close), label: tipLabel, text: tipBody }, ...(subLead ? { subLead } : {}) } satisfies EntryProps} />, `${id}-pill`, THEME.surface1)
    const card = shown ? (
      <Box key="headsup-card" flexDirection="column" paddingX={1} borderStyle="round" borderColor={THEME.accent} backgroundColor={THEME.surface1}>
        <Box key="headsup-card-line" flexDirection="row" columnGap={1}>
          {subpill({ Box, Text }, nerd, THEME.surface1, shown.tag, 'headsup-card-tag')}
          <Box key="headsup-card-text" flexShrink={1}>
            <Text color={THEME.onSurface}>{shown.learn}</Text>
          </Box>
        </Box>
        <Box key="headsup-card-keys" flexDirection="row" columnGap={1}>
          {keyed('headsup-card-open', text.open, bare(look.glyph.go), text.open, text.tipOpen)}
          {keyed('headsup-card-dismiss', bare(look.glyph.close), undefined, text.dismiss, text.tipDismiss)}
        </Box>
      </Box>
    ) : null
    const items = [...toastCards({ Box, Client, Text }, toasts, look, text.tipToast), card].filter(Boolean)

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
    const entry = menuEntry({ Box, Client, Text }, nerd, 'headsup', { label: text.pillLabel, isOpen: isShown, idle: THEME.pill, isBusy: isOpening || isChecking || rewriting !== '', still, nerd, tip: { glyph: nerd ? bare(look.glyph.warn) : MARK.bullet, label: text.pillLabel, text: text.tipPill }, ...badge })

    return pillRow({ Box, Client, Text }, nerd, [entry, ...group], row, [...items, ...rest], bandTip ? tipLine({ Box, Text }, bandTip) : tip, e.props.bodyColumns)
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
          {settingsBody({ Box, Button, Client, Text }, look, { rows, actions, working: false, run, previews, tips: text.settingTips, still })}
          <Box key="footer-space" height={FOOTER_ROWS} flexShrink={0} />
          {paneFooter(elements, paneTip, e.props.bodyColumns, e.props.scroll)}
        </Box>
      )
    }

    // Pane padding, the section's border and padding, then the row's lead glyph and gaps.
    const inner = Math.max(20, e.props.bodyColumns - 2 - 4)
    const entryPill = (id: string, label: string, subLead: string | undefined, tip: Tip, extra: Partial<EntryProps> = {}) =>
      pill({ Box, Text }, nerd, THEME.surface3, <Client key={id} module="./entry.tsx" height={1} props={{ id, label, isOpen: true, bg: THEME.surface3, nerd, still, tip, ...(subLead ? { subLead } : {}), ...extra } satisfies EntryProps} />, `${id}-pill`, THEME.surface1)

    // One round section per note. The header is always shown and every part of it toggles the note; ↗ stays a Button, since a transcript scroll needs the person's press.
    const noteSection = (found: Note, isOpened: boolean) => {
      const isRewording = wording === found.id
      const turn = fill(text.turnNumber, { n: found.turn })
      const time = clock(found.at)
      const toggleId = `headsup-note-${found.id}`
      const tip = { glyph: bare(isOpened ? look.glyph.expanded : look.glyph.collapsed), label: text.noteLabel, text: text.tipNote }
      const part = (key: string, label: string, extra: Partial<EntryProps>) => (
        <Client key={key} module="./entry.tsx" height={1} props={{ id: toggleId, label, isOpen: !found.isRead, bg: THEME.surface1, idle: THEME.muted, nerd, still, tip, ...extra } satisfies EntryProps} />
      )
      // Pane padding, section border and padding, the glyph, three subpills, and the ↗ pill.
      const room = Math.max(8, inner - turn.length - found.tag.length - time.length - 24)
      return section(elements, look, `note-${found.id}`, '', '', [
        <Box key={`note-head-${found.id}`} flexDirection="row">
          {part(toggleId, '', { lead: isOpened ? look.glyph.expanded : look.glyph.collapsed, leadColor: THEME.accent, subLead: turn, subLeadColor: THEME.muted })}
          {part(`note-tag-${found.id}`, '', { subLead: found.tag, subLeadColor: THEME.accent })}
          {part(`note-time-${found.id}`, time, { isOpen: false })}
          {isOpened ? null : <Box key={`note-summary-${found.id}`} flexShrink={1}>{part(`note-summary-text-${found.id}`, fit(found.learn, room), {})}</Box>}
          <Box key={`note-gap-${found.id}`} flexGrow={1} />
          <Box key={`note-jump-pill-${found.id}`} flexShrink={0}>
            {pill({ Box, Text }, nerd, THEME.surface3, (
              <Button key={`note-jump-${found.id}`} label={nerd ? MARK.open : ` ${MARK.open} `} plain hover={{ scope: `note-jump-box-${found.id}`, color: THEME.accent }} onPress={() => jump($, found.turn, found.prompt)} />
            ), `note-jump-box-${found.id}`, THEME.surface1)}
          </Box>
        </Box>,
        ...(isOpened ? noteBody(found, isRewording) : []),
      ])
    }

    const noteBody = (found: Note, isRewording: boolean) => {
      return [
        <Box key={`summary-${found.id}`} marginTop={1}>
          <Text color={THEME.onSurface} bold>{found.learn}</Text>
        </Box>,
        found.title ? (
          <Box key={`title-${found.id}`} marginTop={1}>
            <Text color={THEME.onSurface} bold>{found.title}</Text>
          </Box>
        ) : null,
        ...found.body.map((line, at) => <Text key={`body-${found.id}-${at}`} color={THEME.onSurface}>{`${MARK.bullet} ${line}`}</Text>),
        <Box key={`actions-${found.id}`} flexDirection="row" columnGap={1} marginTop={1} flexWrap="wrap">
          {entryPill(`headsup-understood-${found.id}`, text.gotIt, bare(look.glyph.ok), { glyph: bare(look.glyph.ok), label: text.gotIt, text: text.tipGotIt })}
          {entryPill(`headsup-chat-${found.id}`, text.askClaude, bare(look.glyph.go), { glyph: bare(look.glyph.go), label: text.askClaude, text: text.tipAsk })}
          {pill({ Box, Text }, nerd, THEME.surface2, <Client key={`headsup-reword-${found.id}`} module="./entry.tsx" height={1} props={{ id: `headsup-reword-${found.id}`, label: text.reword, isOpen: isRewording, bg: THEME.surface2, idle: THEME.muted, nerd, still, isBusy: rewriting.endsWith(`-${found.id}`), subLead: bare(look.glyph.cycle), tip: { glyph: bare(look.glyph.cycle), label: text.reword, text: text.tipReword } } satisfies EntryProps} />, `headsup-reword-${found.id}-pill`, THEME.surface1)}
        </Box>,
        // The three rewrites, shown once Reword is pressed: a choice bar on one surface2 pill.
        isRewording ? (
          <Box key={`redo-row-${found.id}`} flexDirection="row" marginTop={1}>
            {pill({ Box, Text }, nerd, THEME.surface2, (
              <Box key={`redo-body-${found.id}`} flexDirection="row">
                {DIRECTIONS.map(([direction, label, tipBody]) => {
                  const id = `headsup-redo-${direction}-${found.id}`
                  return <Client key={id} module="./entry.tsx" height={1} props={{ id, label: ` ${label} `, isOpen: false, bg: THEME.surface2, idle: THEME.muted, nerd, still, isBusy: rewriting === `${direction}-${found.id}`, tip: { glyph: bare(look.glyph.cycle), label, text: tipBody } } satisfies EntryProps} />
                })}
              </Box>
            ), `redo-${found.id}`, THEME.surface1)}
          </Box>
        ) : null,
      ]
    }

    const opened = await openIds($)
    const ordered = byTurn(saved.notes).flatMap(group => group.notes)
    return (
      <Box flexDirection="column" backgroundColor={THEME.bg} paddingX={1} minHeight={e.props.scroll.bodyRows}>
        {tabRow({ Box, Client, Text }, nerd, tabs(false), still)}
        <Text wrap="truncate-end" color={statusColor(note)}>{withMark(look, note) || fill(text.hint, { sep: MARK.sep })}</Text>
        {ordered.length === 0 ? <Text color={THEME.muted}>{text.empty}</Text> : null}
        {ordered.map(found => noteSection(found, opened.includes(found.id)))}
        <Box key="footer-space" height={FOOTER_ROWS} flexShrink={0} />
        {paneFooter(elements, paneTip, e.props.bodyColumns, e.props.scroll)}
      </Box>
    )
  })
}
