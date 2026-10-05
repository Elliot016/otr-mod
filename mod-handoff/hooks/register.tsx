import type { ConfigValue, EngineInterface, ModelForkResult, Register } from 'claude-code'

import { buildPrompt, clampWords, FORK_FAILURES, isFresh, parseThreads, pickedThreads, scopeNote, threadsPrompt, THREADS_SYSTEM, transcriptText } from './handoff'
import { isNerdFace, lookFor, paneTitle, terminalSettings, type IconMode, withMark } from './look'
import type { EntryMessage } from './entry'
import { PILL, pill, pillRow, splitRow, tabRow, tipLine } from './pills'
import { TOAST_MS, ToastList, toastCards } from './toasts'
import { settingChoice, settingsBody, type Action, type Previews } from './settings'
import text from './text'
import { fill, MARK, statusColor, THEME } from './theme'

const PANE = 'handoff'
const CONFIRM_MS = 5000

// The settings (userConfig), fixed per activation: a change reloads the mod.
let iconMode: IconMode = 'auto'
let maxWords = clampWords(undefined)
let look = lookFor(false)

let working = false
let isRunning = false
// Which wait the running entry names: Haiku reading the session, the person picking threads, or the handoff being written.
let stage: 'reading' | 'picking' | 'writing' = 'writing'
let pickThreads = true
let isConfirming = false
let confirmToken = 0
let note = ''
let actions: Action[] = []
let previews: Previews | undefined

async function detectLook($: EngineInterface) {
  if (iconMode !== 'auto') return lookFor(iconMode === 'nerd')
  if (!(await $.env.get('WT_SESSION'))) return lookFor(false)
  const local = ((await $.env.get('LOCALAPPDATA')) ?? '').replace(/\\/g, '/')
  for (const path of terminalSettings(local)) {
    if (isNerdFace(String(await $.fs.read(path).catch(() => '')))) return lookFor(true)
  }
  return lookFor(false)
}

const isOpen = async ($: EngineInterface) => (await $.ui.panes()).some(pane => pane.id === PANE && pane.isPlaced)

// `/mod-handoff settings` toggles the panel. An unplaced pane is waiting, not open.
async function togglePane($: EngineInterface) {
  if (await isOpen($)) {
    await $.ui.close({ id: PANE })
    await $.state.set({ plugin: 'mod-handoff', key: 'pane' }, false)
    return
  }
  note = ''
  const showcase = await $.fs.read(`${$.plugin.root}/showcase.json`).then(text => JSON.parse(String(text))).catch(() => null)
  previews = showcase?.previews
  actions = Array.isArray(showcase?.actions) ? showcase.actions : []
  const opened = await $.ui.open({ id: PANE, title: text.paneName, closeOnEscape: true })
  if (!opened.isPlaced) $.ui.toast(fill(text.settingsWaiting, { reason: opened.reason }))
  await $.state.set({ plugin: 'mod-handoff', key: 'pane' }, opened.isPlaced)
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

function cancelConfirm($: EngineInterface) {
  isConfirming = false
  confirmToken += 1
  $.ui.invalidate('ui.render')
}

// The pill asks first; it falls back to idle after a few seconds. The typed command skips this.
function askConfirm($: EngineInterface) {
  isConfirming = true
  const token = (confirmToken += 1)
  $.ui.invalidate('ui.render')
  $.clock.after(CONFIRM_MS, () => {
    if (confirmToken === token) cancelConfirm($)
  })
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

// Haiku splits the session into threads and the person picks which carry over: the prompt's addition, '' to keep all, null when cancelled.
async function pickScope($: EngineInterface): Promise<string | null> {
  const messages = await $.session.messages().catch(() => [])
  if (!Array.isArray(messages) || messages.length === 0) return ''
  const reply = await $.model.complete({ model: 'haiku', system: THREADS_SYSTEM, prompt: threadsPrompt(transcriptText(messages, 150_000)), maxTokens: 600, timeoutMs: 30000 }).catch(() => null)
  const threads = reply?.isAnswered ? parseThreads(reply.text) : []
  // Nothing to choose between, or Haiku failed: everything carries over, as without the picker.
  if (threads.length === 0) return ''
  stage = 'picking'
  $.ui.invalidate('ui.render')
  const chosen = await $.ui.ask(text.pickQuestion, { options: threads.map(thread => thread.label), header: text.pickHeader, multiSelect: true }).catch(() => null)
  if (chosen === null) return null
  const { kept, note } = pickedThreads(chosen, threads)
  return kept.length || note ? scopeNote(threads, kept, note) : null
}

// Summarize through a hidden fork, run /clear, fill the handoff into the new prompt. Nothing is sent.
async function startHandoff($: EngineInterface) {
  if (isRunning) return
  cancelConfirm($)
  if (working) {
    say($, `${MARK.warn} ${text.claudeWorking}`)
    return
  }
  isRunning = true
  try {
    let scope = ''
    if (pickThreads) {
      stage = 'reading'
      $.ui.invalidate('ui.render')
      const picked = await pickScope($)
      if (picked === null) {
        say($, `${MARK.warn} ${text.cancelled}`)
        return
      }
      scope = picked
    }
    stage = 'writing'
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

// What `/mod-handoff <args>` does; the panel's action calls it directly, since $.command.run skips the calling plugin.
async function answer($: EngineInterface, args: string) {
  if (args.trim() === 'settings') {
    await togglePane($)
    return ''
  }
  // Deferred past this command's dispatch, which the turn waits on.
  $.clock.after(0, () => startHandoff($))
  return text.writingThenClearing
}

// True while the pointer is on this mod's pill entry, which then shows its tip under the row.
let tipShown = false

const toasts = new ToastList('handoff')
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
    look = await detectLook($)
    await $.command.register({
      name: 'mod-handoff',
      description: text.commandDescription,
      argumentHint: '[settings]',
    })
    await $.state.set({ plugin: 'mod-handoff', key: 'pane' }, await isOpen($))
    $.ui.invalidate('ui.render')

    return next(e)
  })

  on('command.run', { command: 'mod-handoff' }, async ($, e) => ({ text: await answer($, e.args) }))

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
      isConfirming = false
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
    if (e.id === PANE) await $.state.set({ plugin: 'mod-handoff', key: 'pane' }, false)

    return next(e)
  })

  on('state.set', async ($, e, next) => {
    if (e.key === 'pane' && e.plugin !== 'mod-handoff' && e.value === true) {
      $.clock.after(0, async () => {
        if (!(await isOpen($))) return
        await $.ui.close({ id: PANE })
        await $.state.set({ plugin: 'mod-handoff', key: 'pane' }, false)
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
      return <Box key="toasts-handoff" flexDirection="column">{toastCards({ Box, Client, Text }, toasts)}{await next(e)}</Box>
    }

    const { Box, Client, Text } = $.ui.resolve(e)
    const { group, row, rest, tip } = splitRow(await next(e))
    // A muted entry while Claude works; a click then explains in a toast instead of crowding the row.
    const isIdle = !(e.props.isWorking || working)
    const entry = (id: string, label: string, isBusy = false) => (
      <Box key={`${id}-pad`}>
        <Client key={id} module="./entry.tsx" height={1} props={{ id, label, isOpen: isIdle, bg: PILL.secondary, isBusy, still }} />
      </Box>
    )
    const body = isRunning ? (
      // Writing takes a model call; the shimmer shows it is still on its way.
      entry('handoff-running', text.stage[stage], true)
    ) : isConfirming ? (
      <Box key="handoff-confirm" flexDirection="row" paddingLeft={1}>
        <Text key="handoff-ask" color={THEME.onSurface}>{text.confirmAsk}</Text>
        {entry('handoff-yes', text.confirmYes)}
        <Text key="handoff-slash" color={THEME.border}>│</Text>
        {entry('handoff-no', text.confirmNo)}
      </Box>
    ) : (
      entry('handoff-entry', text.label)
    )

    return pillRow({ Box, Text }, look.nerd, group, [...row, pill({ Box, Text }, look.nerd, PILL.secondary, body, 'handoff-pill')], [...toastCards({ Box, Client, Text }, toasts), ...rest], tipShown ? tipLine({ Box, Text }, text.tip) : tip)
  })

  on('ui.message', async ($, e, next) => {
    const change = settingChoice(e.data)
    if (change) await saveSetting($, change.key, change.value)
    const clicked = e.data as EntryMessage
    const dismissed = clicked?.type === 'menu-entry' ? toasts.idOf(clicked.id) : undefined
    if (dismissed !== undefined) {
      toasts.drop(dismissed)
      $.ui.invalidate('ui.render')
      return next(e)
    }
    const hover = e.data as { type?: string; id?: string; isOver?: boolean }
    if (hover?.type === 'menu-hover' && hover.id === 'handoff-entry') {
      tipShown = hover.isOver === true
      $.ui.invalidate('ui.render')
    }
    const message = e.data as EntryMessage
    if (message?.type !== 'menu-entry') return next(e)
    if (message.id === 'handoff-entry') {
      if (working) $.ui.toast(text.claudeWorkingPill)
      else askConfirm($)
    }
    if (message.id === 'handoff-yes') await startHandoff($)
    if (message.id === 'handoff-no') cancelConfirm($)

    return next(e)
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE) return next(e)

    const { Box, Button, Client, Text } = $.ui.resolve(e)
    const rows = (await $.config.list()).filter(row => row.key.startsWith('mod-handoff.'))
    const run = (_action: Action) => startHandoff($)

    return (
      <Box flexDirection="column" backgroundColor={THEME.bg} paddingX={1} minHeight={e.props.scroll.bodyRows}>
        {tabRow({ Box, Client, Text }, look.nerd, [{ id: 'mod-handoff-settings-tab', label: `${text.label} ${MARK.sep} ${text.paneSettings}`, icon: look.glyph.gear, isOpen: true }], still)}
        <Text color={statusColor(note)}>{withMark(look, note) || `${text.statusHint} ${MARK.sep} ${text.statusHintSaved}`}</Text>
        {settingsBody({ Box, Button, Client, Text }, look, { rows, actions, working, run, previews , still: still })}
      </Box>
    )
  })
}
