// mod-wrap-up / hooks/register.tsx, by v-amorim
// Registers the wrap-up pill, commands, settings pane and handoff or compact actions with the engine.
import type { ConfigValue, EngineInterface, ModelForkResult, Register, RenderElement } from 'claude-code'

import { ALSO_KEEP, buildPrompt, clampWords, compactNote, FORK_FAILURES, isFresh, parseThreads, scopeNote, threadsPrompt, THREADS_SYSTEM, transcriptText, type AlsoId, type Thread } from './handoff'
import { detectNerd, FOOTER_ROWS, heading, lookFor, paneFooter, type IconMode, withMark } from './look'
import { isTipMessage, tipText, type EntryMessage, type EntryProps, type Tip, type TipMessage } from './entry'
import type { ChoiceProps } from './choice'
import { PILL, pill, pillRow, splitRow, tabRow, tipLine } from './pills'
import style from './style'
import { TOAST_MS, ToastList, toastCards } from './toasts'
import { settingChoice, settingsBody, type Action, type Previews } from './settings'
import text from './text'
import { fill, MARK, statusColor, THEME } from './theme'

const PANE = 'wrap-up'

// The settings (userConfig), fixed per activation: a change reloads the mod.
let iconMode: IconMode = 'auto'
let maxWords = clampWords(undefined)
let look = lookFor(false)

let working = false
let isRunning = false
let pickThreads = true
let note = ''

type Mode = 'handoff' | 'compact'
// The card that picks what carries over; threads is null while Haiku still reads the session.
type Card = { mode: Mode; threads: Thread[] | null; kept: boolean[]; also: Record<AlsoId, boolean>; token: number }

let card: Card | null = null
let cardToken = 0
let actions: Action[] = []
let previews: Previews | undefined

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

const isOpen = async ($: EngineInterface) => (await $.ui.panes()).some(pane => pane.id === PANE && pane.isPlaced)

// `/mod-wrap-up settings` toggles the panel. An unplaced pane is waiting, not open.
async function togglePane($: EngineInterface) {
  if (await isOpen($)) {
    await $.ui.close({ id: PANE })
    await $.state.set({ plugin: 'mod-wrap-up', key: 'pane' }, false)
    return
  }
  note = ''
  const showcase = await $.fs.read(`${$.plugin.root}/showcase.json`).then(text => JSON.parse(String(text))).catch(() => null)
  previews = showcase?.previews
  actions = Array.isArray(showcase?.actions) ? showcase.actions : []
  const opened = await $.ui.open({ id: PANE, title: text.paneName, closeOnEscape: true })
  if (!opened.isPlaced) $.ui.toast(fill(text.settingsWaiting, { reason: opened.reason }))
  await $.state.set({ plugin: 'mod-wrap-up', key: 'pane' }, opened.isPlaced)
}

// The pane shows the last outcome; a failure is a toast, since a long line in the pill row wraps and breaks it.
function say($: EngineInterface, line: string) {
  note = line
  if (line.startsWith(MARK.warn)) $.ui.toast(line.slice(MARK.warn.length).trim())
  $.ui.invalidate('ui.render')
}

// Puts the waiting handoff into the fresh prompt. It stays in the store until a fill lands, so a late call is harmless.
async function fillPending($: EngineInterface) {
  const pending = await $.store.get('pending')
  if (!isFresh(pending, await $.clock.now())) return false
  const filled = await $.prompt.fill({ text: pending.text, mode: 'replace' })
  if (!filled.isFilled) return false
  await $.store.delete('pending')
  say($, `${MARK.ok} ${text.filledIn}`)
  return true
}

async function fillWithRetry($: EngineInterface) {
  for (let tries = 0; tries < 10; tries++) {
    if (await fillPending($)) return true
    if (!isFresh(await $.store.get('pending'), await $.clock.now())) return false
    await $.clock.sleep(200)
  }
  return false
}

// Haiku splits the session into threads the card can keep or drop; none when it fails or finds nothing to choose between.
async function readThreads($: EngineInterface): Promise<Thread[]> {
  const messages = await $.session.messages().catch(() => [])
  if (!Array.isArray(messages) || messages.length === 0) return []
  const reply = await $.model.complete({ model: 'haiku', system: THREADS_SYSTEM, prompt: threadsPrompt(transcriptText(messages, 150_000)), maxTokens: 600, timeoutMs: 30000 }).catch(() => null)
  return reply?.isAnswered ? parseThreads(reply.text) : []
}

const defaultAlso = () => Object.fromEntries(ALSO_KEEP.map(item => [item.id, item.isKept])) as Record<AlsoId, boolean>

// Either choice opens the card; the other one switches its mode and keeps what was picked.
function openCard($: EngineInterface, mode: Mode) {
  if (card) {
    card = { ...card, mode }
    $.ui.invalidate('ui.render')
    return
  }
  const token = (cardToken += 1)
  card = { mode, threads: pickThreads ? null : [], kept: [], also: defaultAlso(), token }
  $.ui.invalidate('ui.render')
  if (!pickThreads) return
  void readThreads($).then(threads => {
    if (card?.token !== token) return
    card = { ...card, threads, kept: threads.map(() => true) }
    $.ui.invalidate('ui.render')
  })
}

function closeCard($: EngineInterface) {
  card = null
  bandTip = null
  cardToken += 1
  $.ui.invalidate('ui.render')
}

// A click on a card line keeps or drops it.
function toggleLine($: EngineInterface, id: string) {
  if (!card) return
  const thread = /^wrap-up-thread-(\d+)$/.exec(id)
  if (thread) card = { ...card, kept: card.kept.map((isKept, at) => (at === Number(thread[1]) ? !isKept : isKept)) }
  const also = ALSO_KEEP.find(item => id === `wrap-up-also-${item.id}`)
  if (also) card = { ...card, also: { ...card.also, [also.id]: !card.also[also.id] } }
  $.ui.invalidate('ui.render')
}

const keptThreads = (picked: Card) => (picked.threads ?? []).filter((_, at) => picked.kept[at])

// The card's go: Compact fills /compact with the picks for review, Handoff writes, clears and fills the handoff.
async function finishCard($: EngineInterface) {
  if (!card) return
  const picked = card
  closeCard($)
  if (picked.mode === 'handoff') {
    await startHandoff($, scopeNote(picked.threads ?? [], keptThreads(picked), picked.also))
    return
  }
  const instructions = compactNote(picked.threads ?? [], keptThreads(picked), picked.also)
  const filled = await $.prompt.fill({ text: instructions ? `/compact ${instructions}` : '/compact', mode: 'replace' })
  say($, filled.isFilled ? `${MARK.ok} ${text.compactFilled}` : `${MARK.warn} ${text.compactNotFilled}`)
}

// A resumed session has nothing to fork until its first turn, so the transcript is summarized directly.
async function summarizeTranscript($: EngineInterface, prompt: string): Promise<ModelForkResult> {
  const messages = await $.session.messages()
  if (!Array.isArray(messages) || messages.length === 0) return { isAnswered: false, reason: 'nothing-to-fork' }
  return $.model.complete({
    model: 'sonnet',
    system: 'You write session handoffs from a transcript. Tool output is left out; tool calls appear in brackets.',
    prompt: `<transcript>\n${transcriptText(messages)}\n</transcript>\n\n${prompt}`,
    maxTokens: 4000,
  })
}

// Summarize through a hidden fork, run /clear, fill the handoff into the new prompt. Nothing is sent. scope is what the card dropped.
async function startHandoff($: EngineInterface, scope: string) {
  if (isRunning) return
  if (working) {
    say($, `${MARK.warn} ${text.claudeWorking}`)
    return
  }
  isRunning = true
  try {
    $.ui.invalidate('ui.render')
    say($, text.writing)
    const skill = await $.fs.read(`${$.plugin.root}/skills/session-handoff/SKILL.md`).then(String)
    const prompt = scope ? `${buildPrompt(skill, maxWords)}\n\n${scope}` : buildPrompt(skill, maxWords)
    let result = await $.model.fork({ prompt })
    if (!result.isAnswered && result.reason === 'nothing-to-fork') result = await summarizeTranscript($, prompt)
    if (!result.isAnswered) {
      say($, `${MARK.warn} ${FORK_FAILURES[result.reason] ?? result.reason}`)
      return
    }
    const summary = result.text.trim()
    if (!summary) {
      say($, `${MARK.warn} ${FORK_FAILURES['empty-reply']}`)
      return
    }
    if (working) {
      say($, `${MARK.warn} ${text.startedWorking}`)
      return
    }
    await $.store.set('pending', { text: summary, at: await $.clock.now() })
    try {
      await $.command.run({ command: 'clear' })
    } catch {
      // The person can run /clear themselves; session.end then fills the handoff.
      await $.prompt.fill({ text: '/clear', mode: 'replace' })
      say($, `${MARK.warn} ${text.clearFailed}`)
      return
    }
    if (!(await fillWithRetry($))) say($, `${MARK.warn} ${text.clearedNotFilled}`)
  } catch (error) {
    say($, `${MARK.warn} ${String(error)}`)
  } finally {
    isRunning = false
    $.ui.invalidate('ui.render')
  }
}

// What `/mod-wrap-up <args>` does; the panel's action calls it directly, since $.command.run skips the calling plugin.
async function answer($: EngineInterface, args: string) {
  if (args.trim() === 'settings') {
    await togglePane($)
    return ''
  }
  openCard($, args.trim() === 'compact' ? 'compact' : 'handoff')
  return text.cardOpened
}

type Elements = { Box: (props: any) => RenderElement; Client: (props: any) => RenderElement; Text: (props: any) => RenderElement }

// A control glyph without the brackets and padding it carries as a Button label, for drawing as a subpill.
const bare = (glyph: string) => glyph.replace(/[[\]\s]/g, '')

// The band card: each thread and each "also keep" item a line that keeps or drops itself on a click, then what the go does.
function cardBox({ Box, Client, Text }: Elements, picked: Card) {
  const line = (id: string, label: string, isKept: boolean, tip: string) => (
    <Client key={id} module="./entry.tsx" height={1} props={{ id, label, isOpen: isKept, tip: { glyph: isKept ? MARK.stopOpen : MARK.stop, label, text: tip }, idle: THEME.muted, bg: THEME.surface1, lead: isKept ? MARK.stopOpen : MARK.stop, leadColor: isKept ? THEME.accent : style.colors.pills.separator, still }} />
  )
  // An action pill on surface3; the go leads with its glyph as a subpill.
  const action = (id: string, label: string, lead: Pick<EntryProps, 'subLead'>, tip: string) => (
    pill({ Box, Text }, look.nerd, THEME.surface3, <Client key={id} module="./entry.tsx" height={1} props={{ id, label, isOpen: true, bg: THEME.surface3, nerd: look.nerd, still, tip: { glyph: lead.subLead ?? bare(look.glyph.close), label, text: tip }, ...lead } satisfies EntryProps} />, `${id}-pill`, THEME.surface1)
  )
  // Threads and Also keep each sit in a round-bordered box inside the card, its heading a pill on the first row.
  const block = (key: string, icon: string, title: string, body: unknown) => (
    <Box key={key} flexDirection="column" paddingX={1} borderStyle="round" borderColor={THEME.border} backgroundColor={THEME.surface1}>
      {heading({ Box, Text }, look, key, icon, title)}
      {body}
    </Box>
  )
  const threads = picked.threads === null
    ? <Text key="wrap-up-reading" color={THEME.muted}>{text.card.reading}</Text>
    : picked.threads.length === 0
      ? <Text key="wrap-up-none" color={THEME.muted}>{text.card.noThreads}</Text>
      : picked.threads.map((thread, at) => (
          <Box key={`wrap-up-thread-row-${at}`} flexDirection="row">
            <Box key={`wrap-up-thread-pad-${at}`} flexShrink={0}>{line(`wrap-up-thread-${at}`, thread.label, picked.kept[at] === true, text.tips.thread)}</Box>
            <Text key={`wrap-up-thread-detail-${at}`} color={THEME.muted} wrap="truncate-end">{`${MARK.sep} ${thread.detail}`}</Text>
          </Box>
        ))
  const instructions = compactNote(picked.threads ?? [], keptThreads(picked), picked.also)
  const foot = picked.mode === 'compact' ? (
    <Box key="wrap-up-foot" flexDirection="row">
      <Text key="wrap-up-foot-command" color={THEME.accent} bold>{'/compact '}</Text>
      <Text key="wrap-up-foot-text" color={THEME.secondary}>{instructions}</Text>
    </Box>
  ) : (
    <Text key="wrap-up-foot" color={THEME.muted}>{text.card.handoffFoot}</Text>
  )
  return (
    <Box key="wrap-up-card" flexDirection="column" paddingX={1} borderStyle="round" borderColor={THEME.accent} backgroundColor={THEME.surface1}>
      <Box key="wrap-up-card-title" flexDirection="row">
        <Text key="wrap-up-card-mode" color={THEME.onSurface} bold>{text.choice[picked.mode]}</Text>
        <Text key="wrap-up-card-hint" color={THEME.muted}>{`: ${text.card.title} ${MARK.sep} ${text.card.hint}`}</Text>
      </Box>
      {pickThreads ? block('wrap-up-threads', 'prompt', text.card.threads, threads) : null}
      {block('wrap-up-also', 'features', text.card.also, (
        <Box key="wrap-up-also-row" flexDirection="row" flexWrap="wrap">
          {ALSO_KEEP.map(item => line(`wrap-up-also-${item.id}`, text.alsoKeep[item.id], picked.also[item.id], text.tips.also))}
        </Box>
      ))}
      <Box key="wrap-up-gap" height={1} />
      {foot}
      <Box key="wrap-up-actions" flexDirection="row" justifyContent="flex-end" columnGap={1}>
        {action('wrap-up-go', text.card.go[picked.mode], { subLead: bare(look.glyph.go) }, text.tips.go[picked.mode])}
        {action('wrap-up-cancel', text.card.cancel, {}, text.tips.cancel)}
      </Box>
    </Box>
  )
}

// The pill part or card control under the pointer, shown in the tip row above the pill row.
let bandTip: TipMessage | null = null

// The settings pane's control under the pointer, shown in its footer.
let paneTip: Tip | null = null

const toasts = new ToastList('wrap-up')
// The animations setting, fixed per activation: off, every entry draws still.
let still = false

// A settings card's click: its row, saved through /config; a saved change reloads this mod.
async function saveSetting($: EngineInterface, key: string, value: ConfigValue) {
  const row = (await $.config.list()).find(each => each.key === key)
  if (!row) return
  const result = await $.config.set({ key: row.key, value })
  say($, 'deny' in result && result.deny ? `${MARK.warn} ${result.deny}` : `${MARK.ok} ${fill(text.settingSaved, { label: row.label })}`)
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

  iconMode = (options.icons as IconMode | undefined) ?? 'auto'
  maxWords = clampWords(options.max_words)
  pickThreads = options.pick_threads !== false
  look = lookFor(iconMode === 'nerd')

  on('session.start', async ($, e, next) => {
    await loadLook($)
    await $.command.register({
      name: 'mod-wrap-up',
      description: text.commandDescription,
      argumentHint: '[settings]',
    })
    await $.state.set({ plugin: 'mod-wrap-up', key: 'pane' }, await isOpen($))
    $.ui.invalidate('ui.render')

    return next(e)
  })

  on('command.run', { command: 'mod-wrap-up' }, async ($, e) => ({ text: await answer($, e.args) }))

  // session.start does not fire on /clear, session.end does: that is the cue to fill a waiting handoff.
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear' && isFresh(await $.store.get('pending'), await $.clock.now())) {
      $.clock.after(300, () => fillWithRetry($))
    }

    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (!e.agentId) {
      working = true
      $.ui.invalidate('ui.render')
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (!e.agentId) {
      working = false
      $.ui.invalidate('ui.render')
    }

    return next(e)
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) await $.state.set({ plugin: 'mod-wrap-up', key: 'pane' }, false)

    return next(e)
  })

  on('state.set', async ($, e, next) => {
    if (e.key === 'pane' && e.plugin !== 'mod-wrap-up' && e.value === true) {
      $.clock.after(0, async () => {
        if (!(await isOpen($))) return
        await $.ui.close({ id: PANE })
        await $.state.set({ plugin: 'mod-wrap-up', key: 'pane' }, false)
      })
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    await loadLook($)
    const hidden = await $.state.get({ plugin: 'mod-menu', key: 'hidden' })
    if (e.surface !== 'terminal' || e.props.hasSurvey) return next(e)
    if (hidden.value === true) {
      if (toasts.items.length === 0) return next(e)
      const { Box, Client, Text } = $.ui.resolve(e)
      return <Box key="toasts-wrap-up" flexDirection="column">{toastCards({ Box, Client, Text }, toasts, look, text.tipToast)}{await next(e)}</Box>
    }

    const { Box, Client, Text } = $.ui.resolve(e)
    const { group, row, rest, tip } = splitRow(await next(e))
    // A muted entry while Claude works; a click then explains in a toast instead of crowding the row.
    const isIdle = !(e.props.isWorking || working)
    const options = [
      { id: 'wrap-up-handoff', label: text.choice.handoff },
      { id: 'wrap-up-compact', label: text.choice.compact },
    ]
    const body = isRunning ? (
      // Writing takes a model call; the shimmer shows it is still on its way.
      <Box key="wrap-up-running-pad">
        <Client key="wrap-up-running" module="./entry.tsx" height={1} props={{ id: 'wrap-up-running', label: text.writingStage, isOpen: isIdle, bg: PILL.secondary, isBusy: true, still }} />
      </Box>
    ) : (
      // Like the effort pill, the pointer opens the options and lifts the one under it, all inside the Client, so nothing waits on a redraw.
      <Box key="wrap-up-choice-pad">
        <Client key="wrap-up-entry" module="./choice.tsx" height={1} props={{ id: 'wrap-up-entry', label: text.label, options, mode: card ? `wrap-up-${card.mode}` : null, bg: PILL.secondary, nerd: look.nerd, isIdle, tips: [{ glyph: look.glyph.icon.actions ?? look.glyph.title, label: text.label, text: text.tips.head }, { glyph: look.glyph.title, label: text.choice.handoff, text: text.tips.handoff }, { glyph: look.glyph.title, label: text.choice.compact, text: text.tips.compact }] } satisfies ChoiceProps} />
      </Box>
    )
    const cards = card ? [cardBox({ Box, Client, Text }, card)] : []

    return pillRow({ Box, Client, Text }, look.nerd, group, [...row, isRunning ? pill({ Box, Text }, look.nerd, PILL.secondary, body, 'wrap-up-pill') : <Box key="wrap-up-pill" flexDirection="row">{body}</Box>], [...toastCards({ Box, Client, Text }, toasts, look, text.tipToast), ...cards, ...rest], bandTip?.id ? tipLine({ Box, Text }, tipText(bandTip)) : tip, e.props.bodyColumns)
  })

  on('ui.message', async ($, e, next) => {
    if (isTipMessage(e.data)) {
      const tip = e.data
      const own = Boolean(tip.id?.startsWith('wrap-up-') || tip.id?.startsWith('toast-wrap-up-'))
      bandTip = own ? tip : null
      paneTip = tip.id && !own ? { glyph: tip.glyph ?? '', label: tip.label ?? '', text: tip.text ?? '' } : null
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
    if (message?.type !== 'menu-entry') return next(e)
    const isChoice = message.id === 'wrap-up-entry' || message.id === 'wrap-up-handoff' || message.id === 'wrap-up-compact'
    if (isChoice && working) $.ui.toast(text.claudeWorkingPill)
    else if (message.id === 'wrap-up-handoff') openCard($, 'handoff')
    else if (message.id === 'wrap-up-compact') openCard($, 'compact')
    if (message.id === 'wrap-up-cancel') closeCard($)
    if (message.id === 'wrap-up-go') await finishCard($)
    toggleLine($, message.id)

    return next(e)
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    await loadLook($)
    if (e.requestId !== PANE) return next(e)

    const { Box, Button, Client, Text } = $.ui.resolve(e)
    const rows = (await $.config.list()).filter(row => row.key.startsWith('mod-wrap-up.'))
    const run = async (_action: Action) => openCard($, 'handoff')

    return (
      <Box flexDirection="column" backgroundColor={THEME.bg} paddingX={1} minHeight={e.props.scroll.bodyRows}>
        {tabRow({ Box, Client, Text }, look.nerd, [{ id: 'mod-wrap-up-settings-tab', label: `${text.label} ${MARK.sep} ${text.paneSettings}`, icon: look.glyph.gear, isOpen: true, tip: { glyph: look.glyph.gear, label: text.paneSettings, text: text.tips.tab } }], still)}
        <Text wrap="truncate-end" color={statusColor(note)}>{withMark(look, note) || `${text.statusHint} ${MARK.sep} ${text.statusHintSaved}`}</Text>
        {settingsBody({ Box, Button, Client, Text }, look, { rows, actions, working, run, previews , still: still })}
        <Box key="footer-space" height={FOOTER_ROWS} />
        {paneFooter({ Box, Text }, paneTip, e.props.bodyColumns, e.props.scroll)}
      </Box>
    )
  })
}
