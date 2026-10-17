// mod-wrap-up / hooks/register.tsx, by v-amorim
// Registers the wrap-up pill, commands, settings pane and handoff or compact actions with the engine.
import type { ConfigValue, EngineInterface, ModelCompleteRequest, ModelCompleteResult, ModelForkResult, Register, RenderElement } from 'claude-code'

import { AUTO_SYSTEM, autoPrompt, capWords, clampCompactAt, clampCompactTokens, clampEvery, emptyLedger, flip, isDue, mergeDelta, mergeInstructions, parseRelated, parseUpdate, projectSlug, readLedger, RELATED_SYSTEM, relatedPrompt, restoreContext, shortGoal, shouldCompact, yieldsToManual, type Carry, type CompactMarks, type Ledger } from './ledger'
import { ALSO_KEEP, buildPrompt, clampWords, compactNote, FORK_FAILURES, isFresh, parseThreads, scopeNote, threadsPrompt, THREADS_SYSTEM, transcriptText, type AlsoId, type Thread } from './handoff'
import { cardFill, detectNerd, FOOTER_ROWS, heading, lookFor, paneFooter, subpill, type IconMode, withMark } from './look'
import { isTipMessage, tipText, type EntryMessage, type EntryProps, type Tip, type TipMessage } from './entry'
import { choiceCells, type ChoiceProps } from './choice'
import { labelsOf, PILL, pill, pillRow, splitRow, tabRow, tipLine } from './pills'
import { TOAST_MS, ToastList, toastCards } from './toasts'
import { actionReveals, settingChoice, settingsBody, type Action, type Previews, type Range } from './settings'
import { recordSpend } from './spend'
import text from './text'
import { fill, MARK, statusColor, THEME } from './theme'

const PANE = 'wrap-up'

// The settings (userConfig), fixed per activation: a change reloads the mod.
let iconMode: IconMode = 'auto'
let maxWords = clampWords(undefined)
let look = lookFor(false)

// The automatic handoff (opt-in, off by default), fixed per activation like the settings above.
let autoOn = false
let every = 1
let marks: CompactMarks = { percent: 65, tokens: 400_000 }
let compactOn = false

// Counters that reset on a compaction, a clear or a newer run; a result that finds them moved is stale and dropped.
let turnsSince = 0
let runId = 0
let epoch = 0
let cursor = 0
// A clear waits for the first prompt to decide; a compaction waits for the next one to carry the handoff.
let awaitFirst = false
let inject = false
let manualAt: number | null = null
// When the mod's own clear at the mark ran, so the first prompt after it never asks "related?".
let carriedAt: number | null = null
let ledgerPath = ''

// The countdown before the handoff at the mark; left is 0 while the ledger catches up.
type Countdown = { token: number; left: number; tokens: string; percent: number }
let countdown: Countdown | null = null
let countToken = 0

// The chain this process works on: the session id it started with, kept across /compact and a carried /clear.
let chain = ''
let clearedFrom = ''
// The first prompt after a clear was carried or started fresh; held is the other chain a switch brings back.
type Choice = { carry: Carry; goal: string; token: number }
let choice: Choice | null = null
let choiceToken = 0
let held: string | null = null

let working = false
let isRunning = false
let pickThreads = true
let note = ''

type Mode = 'handoff' | 'compact'
// The card that picks what carries over; threads is null while Haiku still reads the session.
type Card = { mode: Mode; threads: Thread[] | null; kept: boolean[]; also: Record<AlsoId, boolean>; token: number }

let card: Card | null = null
// The choices card a pill cut to its icon opens above the row.
let isMenuOpen = false
let cardToken = 0
let actions: Action[] = []
let previews: Previews | undefined
let fields: Record<string, Range> | undefined

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
  fields = await $.fs.read(`${$.plugin.root}/.claude-plugin/plugin.json`).then(text => JSON.parse(String(text)).userConfig).catch(() => undefined)
  actions = (Array.isArray(showcase?.actions) ? showcase.actions : []).map((action: Action) => ({ ...action, isLocal: action.command === 'mod-wrap-up' }))
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

// Never throws: a failed read or fill counts as "not filled", so a timer or a command never fails on it.
async function fillWithRetry($: EngineInterface) {
  try {
    for (let tries = 0; tries < 10; tries++) {
      if (await fillPending($)) return true
      if (!isFresh(await $.store.get('pending'), await $.clock.now())) return false
      await $.clock.sleep(200)
    }
  } catch {
    // The handoff stays in the store, so a later fill can still land.
  }
  return false
}

async function isPendingLeft($: EngineInterface) {
  try {
    return isFresh(await $.store.get('pending'), await $.clock.now())
  } catch {
    return true
  }
}

// Haiku splits the session into threads the card can keep or drop; none when it fails or finds nothing to choose between.
async function readThreads($: EngineInterface): Promise<Thread[]> {
  const messages = await $.session.messages().catch(() => [])
  if (!Array.isArray(messages) || messages.length === 0) return []
  const reply = await $.model.complete({ model: 'haiku', system: THREADS_SYSTEM, prompt: threadsPrompt(transcriptText(messages, 150_000)), maxTokens: 600, timeoutMs: 30000 }).catch(() => null)
  recordSpend($, 'haiku', reply)
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
  const instructions = compactNote(picked.threads ?? [], keptThreads(picked), picked.also, autoOn ? await ledgerFile($) : '')
  const filled = await $.prompt.fill({ text: instructions ? `/compact ${instructions}` : '/compact', mode: 'replace' })
  say($, filled.isFilled ? `${MARK.ok} ${text.compactFilled}` : `${MARK.warn} ${text.compactNotFilled}`)
}

// The handoff model is pinned to Sonnet. A blocked model rejects and an unavailable one answers forbidden or not found: either way the session's own model answers instead. Rate limits and server errors are left alone.
async function askHandoffModel($: EngineInterface, request: Omit<ModelCompleteRequest, 'model'>): Promise<ModelCompleteResult> {
  let pinned: ModelCompleteResult | null = null
  let failure: unknown = null
  try {
    pinned = await $.model.complete({ ...request, model: 'sonnet' })
    recordSpend($, 'sonnet', pinned)
  } catch (error) {
    failure = error
  }
  const isUnavailable = !pinned || (!pinned.isAnswered && pinned.reason === 'api-error' && (pinned.status === 403 || pinned.status === 404))
  const own = isUnavailable ? await $.session.model().catch(() => '') : ''
  if (own) {
    const answer = await $.model.complete({ ...request, model: own })
    recordSpend($, own, answer)
    return answer
  }
  if (!pinned) throw failure
  return pinned
}

// A resumed session has nothing to fork until its first turn, so the transcript is summarized directly.
async function summarizeTranscript($: EngineInterface, prompt: string): Promise<ModelForkResult> {
  const messages = await $.session.messages()
  if (!Array.isArray(messages) || messages.length === 0) return { isAnswered: false, reason: 'nothing-to-fork' }
  return askHandoffModel($, {
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
    const base = buildPrompt(skill, maxWords, autoOn ? await ledgerFile($) : '')
    const prompt = scope ? `${base}\n\n${scope}` : base
    let result = await $.model.fork({ prompt })
    recordSpend($, await $.session.model().catch(() => ''), result)
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
    manualAt = await $.clock.now()
    await $.store.set('pending', { text: summary, at: manualAt })
    try {
      await $.command.run({ command: 'clear' })
    } catch {
      // The person can run /clear themselves; session.end then fills the handoff.
      await $.prompt.fill({ text: '/clear', mode: 'replace' })
      say($, `${MARK.warn} ${text.clearFailed}`)
      return
    }
    // A /clear can reach session.end first, which fills the prompt itself: warn only when the handoff is still waiting.
    if (!(await fillWithRetry($)) && (await isPendingLeft($))) say($, `${MARK.warn} ${text.clearedNotFilled}`)
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

// Claude Code's config folder: CLAUDE_CONFIG_DIR when set, else ~/.claude; empty when the home folder is unknown.
async function configDir($: EngineInterface) {
  const set = ((await $.env.get('CLAUDE_CONFIG_DIR')) ?? '').replace(/\\/g, '/').replace(/\/+$/, '')
  if (set) return set
  const home = ((await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '').replace(/\\/g, '/')
  return home ? `${home}/.claude` : ''
}

// One folder per project under the mod's data dir; empty when the config folder is unknown.
async function ledgerDir($: EngineInterface) {
  try {
    const config = await configDir($)
    if (!config) return ''
    const dir = `${config}/mods-data/mod-wrap-up/${projectSlug(await $.session.cwd())}`
    // A reload mid-session forgets the chain; the ledger that lists this session or the one before a clear still names it.
    if (!chain) {
      const id = await $.session.id()
      chain = (await chainOf($, dir, id)) ?? (clearedFrom ? await chainOf($, dir, clearedFrom) : undefined) ?? id
    }
    return dir
  } catch {
    return ''
  }
}

async function ledgerFile($: EngineInterface) {
  const dir = await ledgerDir($)
  if (dir) ledgerPath = fileOf(dir)
  return ledgerPath
}

// One file per chain, so sessions sharing a folder never read or write each other's ledger.
const fileOf = (dir: string, of = chain) => `${dir}/ledgers/${of}.json`

const loadLedger = async ($: EngineInterface, dir: string, of = chain) => readLedger(await $.fs.read(fileOf(dir, of)).then(String).catch(() => ''))

const saveLedger = ($: EngineInterface, dir: string, ledger: Ledger, of = chain) => $.fs.write(fileOf(dir, of), JSON.stringify(ledger, null, 1))

const withSession = (ledger: Ledger, id: string) => ({ ...ledger, sessions: ledger.sessions.includes(id) ? ledger.sessions : [...ledger.sessions, id] })

// A resumed session's chain is the ledger that already lists it.
async function chainOf($: EngineInterface, dir: string, id: string) {
  const entries = await $.fs.list(`${dir}/ledgers`).catch(() => [])
  for (const entry of entries) {
    if (entry.kind !== 'file' || !entry.name.endsWith('.json')) continue
    const of = entry.name.slice(0, -'.json'.length)
    if ((await loadLedger($, dir, of))?.sessions.includes(id)) return of
  }
  return undefined
}

// A startup starts its own chain; a resume (the transcript has messages) picks its chain back up.
async function openLedger($: EngineInterface) {
  const dir = await ledgerDir($)
  if (!dir) return
  const id = await $.session.id()
  const messages = await $.session.messages().catch(() => [])
  chain = Array.isArray(messages) && messages.length > 0 ? ((await chainOf($, dir, id)) ?? id) : id
  if (!(await loadLedger($, dir))) await saveLedger($, dir, emptyLedger(await $.clock.now(), id))
  await ledgerFile($)
}

const COUNTDOWN_S = 5

// Between turns past the mark, a countdown card above the prompt; its end hands off. Cancel, a draft or a new turn stops it.
async function startCountdown($: EngineInterface) {
  if (!autoOn || !compactOn || working || countdown || isRunning) return
  const { context } = await $.session.usage()
  if (!shouldCompact(context ?? {}, marks)) return
  if (working || countdown || (await hasDraft($))) return
  const token = (countToken += 1)
  countdown = { token, left: COUNTDOWN_S, tokens: `${Math.round((context.tokens ?? 0) / 1000)}K`, percent: Math.round(context.percent ?? 0) }
  $.ui.invalidate('ui.render')
  tickCountdown($, token)
}

function stopCountdown($: EngineInterface) {
  countdown = null
  countToken += 1
  $.ui.invalidate('ui.render')
}

const hasDraft = async ($: EngineInterface) => ((await $.prompt.read().catch(() => ({ text: '' }))).text ?? '').trim() !== ''

function tickCountdown($: EngineInterface, token: number) {
  $.clock.after(1000, async () => {
    if (countdown?.token !== token) return
    if (await hasDraft($)) {
      if (countdown?.token === token) stopCountdown($)
      return
    }
    if (countdown?.token !== token) return
    countdown = { ...countdown, left: countdown.left - 1 }
    $.ui.invalidate('ui.render')
    if (countdown.left > 0) tickCountdown($, token)
    else await handOffAtMark($, token)
  })
}

// The countdown ran out: bring the ledger up to date, clear keeping the chain, then continue the open task or fill the handoff.
async function handOffAtMark($: EngineInterface, token: number) {
  const isLive = () => countdown?.token === token
  try {
    const messages = await $.session.messages().catch(() => [])
    if (Array.isArray(messages) && messages.length > cursor) await runAuto($)
    if (!isLive()) return
    if (working || (await hasDraft($))) {
      stopCountdown($)
      return
    }
    const dir = await ledgerDir($)
    const ledger = dir ? await loadLedger($, dir) : null
    if (!dir || !ledger?.handoff) {
      stopCountdown($)
      $.ui.toast(text.auto.noHandoff)
      return
    }
    const carried = restoreContext(ledger.handoff, fileOf(dir))
    const hasOpenTask = ledger.tasks.some(task => task.status === 'open')
    stopCountdown($)
    carriedAt = await $.clock.now()
    if (!hasOpenTask) await $.store.set('pending', { text: carried, at: carriedAt })
    try {
      await $.command.run({ command: 'clear' })
    } catch {
      carriedAt = null
      await $.store.delete('pending')
      $.ui.toast(text.auto.clearFailed)
      return
    }
    await saveLedger($, dir, withSession(ledger, await $.session.id()))
    showChoice($, 'carried', ledger.goal)
    if (hasOpenTask) await $.prompt.submit({ text: `${text.auto.continue}\n\n${carried}` })
    else if (!(await fillWithRetry($))) $.ui.toast(text.clearedNotFilled)
  } catch {
    if (isLive()) stopCountdown($)
  }
}

async function runAuto($: EngineInterface) {
  if (!autoOn || isRunning) return
  const mine = (runId += 1)
  const mineEpoch = epoch
  try {
    const dir = await ledgerDir($)
    if (!dir) return
    const ledger = (await loadLedger($, dir)) ?? emptyLedger(await $.clock.now(), await $.session.id())
    const messages = await $.session.messages()
    const turns = Array.isArray(messages) && cursor > 0 && cursor <= messages.length ? messages.slice(cursor) : messages
    if (!Array.isArray(turns) || turns.length === 0) return
    const skill = await $.fs.read(`${$.plugin.root}/skills/session-handoff/SKILL.md`).then(String)
    const reply = await askHandoffModel($, { effort: 'low', system: AUTO_SYSTEM, prompt: autoPrompt(skill, maxWords, ledger, transcriptText(turns, 150_000)), maxTokens: 4000, timeoutMs: 180_000 }).catch(() => null)
    if (mine !== runId || mineEpoch !== epoch || !reply?.isAnswered) return
    const update = parseUpdate(reply.text)
    if (!update) return
    const now = await $.clock.now()
    await saveLedger($, dir, { ...mergeDelta(ledger, update.delta, now), handoff: capWords(update.handoff, maxWords), handoffAt: now })
    cursor = messages.length
  } catch {
    // A background update never shows an error; the next turn tries again.
  }
}

async function restoreFrom($: EngineInterface) {
  const dir = await ledgerDir($)
  const ledger = dir ? await loadLedger($, dir) : null
  return ledger?.handoff ? restoreContext(ledger.handoff, fileOf(dir)) : ''
}

function showChoice($: EngineInterface, carry: Carry, goal: string) {
  const token = (choiceToken += 1)
  choice = { carry, goal, token }
  $.clock.after(120_000, () => {
    if (choice?.token !== token) return
    choice = null
    $.ui.invalidate('ui.render')
  })
  $.ui.invalidate('ui.render')
}

// The first prompt after a clear: related work keeps the ledger and carries the handoff, unrelated work archives it and starts a new one.
async function decideAfterClear($: EngineInterface, prompt: string) {
  const dir = await ledgerDir($)
  const ledger = dir ? await loadLedger($, dir) : null
  if (!dir || !ledger || !(ledger.handoff || ledger.goal)) return ''
  const reply = await askHandoffModel($, { effort: 'low', system: RELATED_SYSTEM, prompt: relatedPrompt(ledger.goal, ledger.handoff, prompt), maxTokens: 100, timeoutMs: 20_000 }).catch(() => null)
  const id = await $.session.id()
  // Only a clear "related" carries the old handoff; an unsure answer starts fresh.
  if (reply?.isAnswered && parseRelated(reply.text)) {
    await saveLedger($, dir, withSession(ledger, id))
    showChoice($, 'carried', ledger.goal)
    return ledger.handoff ? restoreContext(ledger.handoff, fileOf(dir)) : ''
  }
  held = chain
  chain = id
  await saveLedger($, dir, emptyLedger(await $.clock.now(), id))
  showChoice($, 'fresh', ledger.goal)
  return ''
}

// What a prompt carries beside its text: the post-clear decision once, or the handoff once after a compaction.
async function promptContext($: EngineInterface, prompt: string) {
  if (awaitFirst) {
    // A slash command is not the work the person is starting.
    if (prompt.trimStart().startsWith('/')) return ''
    awaitFirst = false
    return decideAfterClear($, prompt)
  }
  if (!inject) return ''
  inject = false
  return restoreFrom($)
}

// The card's switch: leave the carried chain for one of this session's own, or go back to the chain left behind. Neither file is touched beyond who it lists.
async function flipChoice($: EngineInterface) {
  if (!choice) return
  const dir = await ledgerDir($)
  if (!dir) return
  const id = await $.session.id()
  const carry = flip(choice.carry)
  if (carry === 'fresh') {
    const left = await loadLedger($, dir)
    if (left) await saveLedger($, dir, { ...left, sessions: left.sessions.filter(item => item !== id) })
    held = chain
    chain = id
    if (!(await loadLedger($, dir))) await saveLedger($, dir, emptyLedger(await $.clock.now(), id))
    cursor = 0
  } else {
    if (!held) return
    const back = await loadLedger($, dir, held)
    if (!back) return
    ;[chain, held] = [held, chain]
    await saveLedger($, dir, withSession(back, id))
    inject = true
  }
  runId += 1
  epoch += 1
  showChoice($, carry, choice.goal)
}

type Elements = { Box: (props: any) => RenderElement; Client: (props: any) => RenderElement; Text: (props: any) => RenderElement }

const bare = (glyph: string) => glyph.replace(/[[\]\s]/g, '')

// The pill cut to its icon opens its choices here: one pill of the three side by side, then a × pill, right-aligned over the row.
function menuCard({ Box, Client, Text }: Elements, options: { id: string; label: string; tip: Tip }[], isIdle: boolean) {
  const bg = THEME.surface3
  const entry = (id: string, label: string, isOpen: boolean, tip: Tip) =>
    <Client key={id} module="./entry.tsx" height={1} props={{ id, label, isOpen, bg, nerd: look.nerd, still, idle: THEME.muted, tip } satisfies EntryProps} />
  const entries = options.flatMap((option, at) => [
    ...(at === 0 ? [] : [<Client key={`wrap-up-menu-rail-${at}`} module="./entry.tsx" height={1} props={{ id: `wrap-up-menu-rail-${at}`, label: '', isOpen: false, bg, rail: true } satisfies EntryProps} />]),
    entry(option.id, option.label, isIdle, option.tip),
  ])
  const close = bare(look.glyph.close)
  return (
    <Box key="wrap-up-menu-row" flexDirection="row" justifyContent="flex-end">
      <Box key="wrap-up-menu" flexDirection="row" columnGap={1} paddingX={1} borderStyle="round" borderColor={THEME.border} backgroundColor={cardFill()}>
        {pill({ Box, Text }, look.nerd, bg, entries, 'wrap-up-menu-group', cardFill())}
        {pill({ Box, Text }, look.nerd, bg, entry('wrap-up-menu-close', close, false, { glyph: close, label: text.menu.close, text: text.menu.tipClose }), 'wrap-up-menu-close-pill', cardFill())}
      </Box>
    </Box>
  )
}

function cardBox({ Box, Client, Text }: Elements, picked: Card) {
  const line = (id: string, label: string, isKept: boolean, tip: string) => {
    const bg = isKept ? THEME.surface3 : THEME.surface2
    const mark = isKept ? MARK.stopOpen : MARK.stop
    return pill({ Box, Text }, look.nerd, bg, <Client key={id} module="./entry.tsx" height={1} props={{ id, label, isOpen: isKept, bg, nerd: look.nerd, still, idle: THEME.muted, subLead: mark, subLeadColor: isKept ? THEME.accent : THEME.muted, tip: { glyph: mark, label, text: tip } } satisfies EntryProps} />, `${id}-pill`, cardFill())
  }
  const action = (id: string, label: string, lead: Pick<EntryProps, 'subLead'>, tip: string) => (
    pill({ Box, Text }, look.nerd, THEME.surface3, <Client key={id} module="./entry.tsx" height={1} props={{ id, label, isOpen: true, bg: THEME.surface3, nerd: look.nerd, still, tip: { glyph: lead.subLead ?? bare(look.glyph.close), label, text: tip }, ...lead } satisfies EntryProps} />, `${id}-pill`, cardFill())
  )
  const block = (key: string, icon: string, title: string, body: unknown) => (
    <Box key={key} flexDirection="column" marginTop={1}>
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
  const instructions = compactNote(picked.threads ?? [], keptThreads(picked), picked.also, autoOn ? ledgerPath : '')
  const foot = picked.mode === 'compact' ? (
    <Box key="wrap-up-foot" flexDirection="row">
      <Text key="wrap-up-foot-command" color={THEME.accent} bold>{'/compact '}</Text>
      <Text key="wrap-up-foot-text" color={THEME.secondary}>{instructions}</Text>
    </Box>
  ) : (
    <Text key="wrap-up-foot" color={THEME.muted}>{text.card.handoffFoot}</Text>
  )
  return (
    <Box key="wrap-up-card" flexDirection="column" paddingX={1} borderStyle="round" borderColor={THEME.border} backgroundColor={cardFill()}>
      <Box key="wrap-up-card-title" flexDirection="row">
        <Text key="wrap-up-card-mode" color={THEME.onSurface} bold>{text.choice[picked.mode]}</Text>
        <Text key="wrap-up-card-hint" color={THEME.muted}>{`: ${text.card.title} ${MARK.sep} ${text.card.hint}`}</Text>
      </Box>
      {pickThreads ? block('wrap-up-threads', 'prompt', text.card.threads, threads) : null}
      {block('wrap-up-also', 'features', text.card.also, (
        <Box key="wrap-up-also-row" flexDirection="row" flexWrap="wrap" columnGap={1}>
          {ALSO_KEEP.map(item => <Box key={`wrap-up-also-pad-${item.id}`} flexShrink={0}>{line(`wrap-up-also-${item.id}`, text.alsoKeep[item.id], picked.also[item.id], text.tips.also)}</Box>)}
        </Box>
      ))}
      <Box key="wrap-up-gap" height={1} />
      {foot}
      <Box key="wrap-up-actions" flexDirection="row" justifyContent="flex-end" columnGap={1}>
        {action('wrap-up-go', text.card.go[picked.mode], { subLead: bare(look.glyph.go) }, text.tips.go[picked.mode])}
        {action('wrap-up-cancel', text.card.cancel, { subLead: bare(look.glyph.close) }, text.tips.cancel)}
      </Box>
    </Box>
  )
}

function choiceCard({ Box, Client, Text }: Elements, picked: Choice) {
  const isCarried = picked.carry === 'carried'
  const line = isCarried ? (picked.goal ? fill(text.auto.carried, { goal: shortGoal(picked.goal) }) : text.auto.carriedNoGoal) : text.auto.fresh
  const label = isCarried ? text.auto.toFresh : text.auto.toCarry
  const close = bare(look.glyph.close)
  const control = (id: string, name: string, isOpen: boolean, tip: string, glyph: string) =>
    pill({ Box, Text }, look.nerd, THEME.surface3, <Client key={id} module="./entry.tsx" height={1} props={{ id, label: name, isOpen, bg: THEME.surface3, nerd: look.nerd, still, tip: { glyph, label: name, text: tip } } satisfies EntryProps} />, `${id}-pill`, cardFill())
  return (
    <Box key="wrap-up-choice-card" flexDirection="row" columnGap={1} paddingX={1} borderStyle="round" borderColor={THEME.border} backgroundColor={cardFill()}>
      <Box key="wrap-up-choice-text" flexGrow={1} flexShrink={1}>
        <Text color={THEME.onSurface} wrap="truncate-end">{line}</Text>
      </Box>
      {control('wrap-up-switch', label, true, isCarried ? text.tips.toFresh : text.tips.toCarry, bare(look.glyph.cycle))}
      {control('wrap-up-switch-close', close, false, text.tips.dismissAuto, close)}
    </Box>
  )
}

function countdownCard({ Box, Button, Text }: Elements & { Button: (props: any) => RenderElement }, shown: Countdown, onCancel: () => void) {
  const line = shown.left > 0 ? fill(text.auto.countdown, { tokens: shown.tokens, percent: shown.percent, seconds: shown.left }) : fill(text.auto.updating, { tokens: shown.tokens, percent: shown.percent })
  const scope = 'wrap-up-countdown-cancel-pill'
  return (
    <Box key="wrap-up-countdown-card" flexDirection="row" columnGap={1} paddingX={1} borderStyle="round" borderColor={THEME.border} backgroundColor={cardFill()}>
      <Box key="wrap-up-countdown-text" flexGrow={1} flexShrink={1}>
        <Text color={THEME.onSurface} wrap="truncate-end">{line}</Text>
      </Box>
      {pill({ Box, Text }, look.nerd, THEME.surface3, (
        <Box key="wrap-up-countdown-body" flexDirection="row" backgroundColor={THEME.surface3}>
          {subpill({ Box, Text }, look.nerd, THEME.surface3, bare(look.glyph.close), 'wrap-up-countdown-close')}
          <Button key="wrap-up-countdown-cancel" label={look.nerd ? ` ${text.card.cancel}` : ` ${text.card.cancel} `} plain hover={{ scope, color: THEME.accent, inverse: true }} onPress={onCancel} />
        </Box>
      ), scope, cardFill(), THEME.accent)}
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

const marksText = () => fill(text.tips.autoMarks, { tokens: `${Math.round(marks.tokens / 1000)}K`, percent: marks.percent })

// What the Auto switch is set to now, since the pill shows only its on or off mark.
function autoTip() {
  if (!autoOn) return text.tips.autoNeedsHandoff
  return fill(compactOn ? text.tips.autoOn : text.tips.autoOff, { marks: marksText() })
}

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
  autoOn = options.auto_handoff === true
  every = clampEvery(options.auto_every)
  compactOn = options.auto_compact === true
  marks = { percent: clampCompactAt(options.compact_at), tokens: clampCompactTokens(options.compact_at_tokens) }
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
    if (autoOn) $.clock.after(0, () => void openLedger($).catch(() => undefined))

    return next(e)
  })

  on('command.run', { command: 'mod-wrap-up' }, async ($, e) => ({ text: await answer($, e.args) }))

  // session.start does not fire on /clear, session.end does: that is the cue to fill a waiting handoff.
  on('session.end', async ($, e, next) => {
    runId += 1
    epoch += 1
    turnsSince = 0
    cursor = 0
    inject = false
    choice = null
    held = null
    if (e.reason === 'clear') {
      clearedFrom = e.sessionId
      const now = await $.clock.now()
      awaitFirst = autoOn && !yieldsToManual(manualAt, now) && !yieldsToManual(carriedAt, now)
      manualAt = null
      carriedAt = null
    }
    if (e.reason === 'clear' && isFresh(await $.store.get('pending'), await $.clock.now())) {
      $.clock.after(300, () => fillWithRetry($).catch(() => undefined))
    }

    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (!(e as { agentId?: string }).agentId) {
      if (countdown) stopCountdown($)
      working = true
      $.ui.invalidate('ui.render')
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (!e.agentId) {
      working = false
      $.ui.invalidate('ui.render')
      turnsSince += 1
      const isUpdate = autoOn && isDue(turnsSince, every)
      if (isUpdate) turnsSince = 0
      if (autoOn) $.clock.after(0, () => void (isUpdate ? runAuto($) : Promise.resolve()).then(() => startCountdown($)).catch(() => undefined))
    }

    return next(e)
  })

  // The handoff goes to the compaction as instructions, after what the person typed. No model call runs here.
  on('session.compact', async ($, e, next) => {
    if (!autoOn || e.trigger === 'precompute' || e.agentId) return next(e)
    const dir = await ledgerDir($)
    const ledger = dir ? await loadLedger($, dir) : null
    const result = await next(ledger?.handoff ? { ...e, instructions: mergeInstructions(e.instructions, ledger.handoff, fileOf(dir)) } : e)
    if ('messages' in result && result.messages) {
      cursor = result.messages.length
      epoch += 1
      runId += 1
      inject = true
    }

    return result
  })

  // classic.SessionStart never reaches a mod without a settings hook, so the next prompt carries what a restore needs.
  on('prompt.submit', async ($, e, next) => {
    if (!autoOn || e.origin?.kind !== 'composer' || e.turnId) return next(e)
    const context = await promptContext($, e.text).catch(() => '')

    return next(context ? { ...e, context: [...(e.context ?? []), context] } : e)
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) await $.state.set({ plugin: 'mod-wrap-up', key: 'pane' }, false)

    return next(e)
  })

  on('state.set', async ($, e, next) => {
    // The declared state names no other mod's pane, so the types narrow this event to never.
    if (e.key === 'pane' && e.plugin !== 'mod-wrap-up' && (e as { value?: unknown }).value === true) {
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
    // @ts-expect-error The host's types omit Button from the band's elements, yet it draws one.
    const { Box, Button, Client, Text } = $.ui.resolve(e)
    const counting = countdown ? [countdownCard({ Box, Button, Text }, countdown, () => stopCountdown($))] : []
    if (hidden.value === true) {
      const shown = [...toastCards({ Box, Client, Text }, toasts, look, text.tipToast), ...counting, ...(choice ? [choiceCard({ Box, Client, Text }, choice)] : []), ...(card ? [cardBox({ Box, Client, Text }, card)] : [])]
      if (shown.length === 0) return next(e)
      return <Box key="toasts-wrap-up" flexDirection="column">{shown}{await next(e)}</Box>
    }

    const { group, row, rest, tip } = splitRow(await next(e))
    // A muted entry while Claude works; a click then explains in a toast instead of crowding the row.
    const isIdle = !(e.props.isWorking || working)
    const autoGlyph = (compactOn ? look.glyph.on : look.glyph.off).trim()
    const options = [
      { id: 'wrap-up-handoff', label: text.choice.handoff },
      { id: 'wrap-up-compact', label: text.choice.compact },
      { id: 'wrap-up-auto', label: `${autoGlyph} ${text.choice.auto}` },
    ]
    // The pill row cuts the pill to its icon when the row overflows; labels never draws the icon alone.
    const labels = labelsOf((await $.state.get({ plugin: 'mod-menu', key: 'labels' })).value)
    const icon = look.nerd ? look.glyph.icon.wrapup : undefined
    const fit = icon && labels !== 'always' ? { icon, cells: choiceCells(text.label, look.nerd), compact: labels === 'never' } : {}
    const body = isRunning ? (
      <Box key="wrap-up-running-pad">
        <Client key="wrap-up-running" module="./entry.tsx" height={1} props={{ id: 'wrap-up-running', label: text.writingStage, isOpen: isIdle, bg: PILL.secondary, isBusy: true, still }} />
      </Box>
    ) : (
      <Box key="wrap-up-choice-pad">
        <Client key="wrap-up-entry" module="./choice.tsx" height={1} props={{ id: 'wrap-up-entry', label: text.label, options, mode: card ? `wrap-up-${card.mode}` : null, isMenuOpen, bg: PILL.secondary, nerd: look.nerd, isIdle, still, tips: [{ glyph: look.glyph.icon.actions ?? look.glyph.title, label: text.label, text: text.tips.head }, { glyph: look.glyph.title, label: text.choice.handoff, text: text.tips.handoff }, { glyph: look.glyph.title, label: text.choice.compact, text: text.tips.compact }, { glyph: autoGlyph, label: text.choice.autoCompact, text: autoTip() }], ...fit } satisfies ChoiceProps} />
      </Box>
    )
    const menu = isMenuOpen && !isRunning
    const menuOptions = [
      { ...options[0]!, tip: { glyph: look.glyph.title, label: text.choice.handoff, text: text.tips.handoff } },
      { ...options[1]!, tip: { glyph: look.glyph.title, label: text.choice.compact, text: text.tips.compact } },
      { ...options[2]!, tip: { glyph: autoGlyph, label: text.choice.autoCompact, text: autoTip() } },
    ]
    const cards = [...counting, ...(choice ? [choiceCard({ Box, Client, Text }, choice)] : []), ...(card ? [cardBox({ Box, Client, Text }, card)] : []), ...(menu ? [menuCard({ Box, Client, Text }, menuOptions, isIdle)] : [])]
    const menuHint = `${text.label}: ${fill(text.menu.hint, { close: bare(look.glyph.close) })}`
    const shownTip = bandTip?.id ? tipLine({ Box, Text }, tipText(bandTip)) : menu ? tipLine({ Box, Text }, menuHint) : tip

    return pillRow({ Box, Client, Text }, look.nerd, group, [...row, isRunning ? pill({ Box, Text }, look.nerd, PILL.secondary, body, 'wrap-up-pill') : <Box key="wrap-up-pill" flexDirection="row">{body}</Box>], [...toastCards({ Box, Client, Text }, toasts, look, text.tipToast), ...cards, ...rest], shownTip, e.props.bodyColumns)
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
    const picksFromMenu = message.id === 'wrap-up-handoff' || message.id === 'wrap-up-compact' || message.id === 'wrap-up-auto'
    const wasMenuOpen = isMenuOpen
    if (message.id === 'wrap-up-menu-close' || picksFromMenu) isMenuOpen = false
    if (message.id === 'wrap-up-entry-open') isMenuOpen = !isMenuOpen && !working
    if (wasMenuOpen !== isMenuOpen) {
      bandTip = null
      $.ui.invalidate('ui.render')
    }
    const isChoice = message.id === 'wrap-up-entry' || message.id === 'wrap-up-entry-open' || message.id === 'wrap-up-handoff' || message.id === 'wrap-up-compact' || message.id === 'wrap-up-auto'
    if (isChoice && working) $.ui.toast(text.claudeWorkingPill)
    else if (message.id === 'wrap-up-handoff') openCard($, 'handoff')
    else if (message.id === 'wrap-up-compact') openCard($, 'compact')
    // Saving reloads the mod, which redraws the switch with the new mark.
    else if (message.id === 'wrap-up-auto') await $.config.set({ key: 'mod-wrap-up.auto_compact', value: !compactOn })
    if (message.id === 'wrap-up-switch') await flipChoice($)
    if (message.id === 'wrap-up-switch-close') {
      choice = null
      $.ui.invalidate('ui.render')
    }
    if (message.id === 'wrap-up-cancel') closeCard($)
    if (message.id === 'wrap-up-go') await finishCard($)
    toggleLine($, message.id)

    return next(e)
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    await loadLook($)
    if (e.requestId !== PANE) return next(e)

    // @ts-expect-error The host's types omit Client from a Pane's elements, yet a Pane draws it.
    const { Box, Button, Client, Text } = $.ui.resolve(e)
    const rows = (await $.config.list()).filter(row => row.key.startsWith('mod-wrap-up.'))
    const run = async (_action: Action) => openCard($, 'handoff')

    return (
      <Box flexDirection="column" backgroundColor={THEME.bg} paddingX={1} minHeight={e.props.scroll.bodyRows}>
        {tabRow({ Box, Client, Text }, look.nerd, [{ id: 'mod-wrap-up-settings-tab', label: `${text.label} ${MARK.sep} ${text.paneSettings}`, icon: look.glyph.gear, isOpen: true, tip: { glyph: look.glyph.gear, label: text.paneSettings, text: text.tips.tab } }], still)}
        <Text wrap="truncate-end" color={statusColor(note)}>{withMark(look, note) || `${text.statusHint} ${MARK.sep} ${text.statusHintSaved}`}</Text>
        {settingsBody({ Box, Button, Client, Text }, look, { rows, actions, working, run, previews, fields, still: still })}
        <Box key="footer-space" height={FOOTER_ROWS} flexShrink={0} />
        {paneFooter({ Box, Text }, paneTip, e.props.bodyColumns, e.props.scroll, actionReveals(actions, look, working))}
      </Box>
    )
  })
}
