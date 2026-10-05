import type { ConfigRow, ConfigValue, EngineInterface, ModelForkResult, Register } from 'claude-code'

import { buildPrompt, clampWords, FORK_FAILURES, isFresh, transcriptText } from './handoff'
import { isNerdFace, lookFor, paneTitle, terminalSettings, type IconMode, withMark } from './look'
import type { EntryMessage } from './entry'
import { PILL, pill, pillRow, splitRow, tipLine } from './pills'
import { TOAST_MS, ToastList, toastCards } from './toasts'
import { settingsBody, type Action, type Previews } from './settings'
import { MARK, statusColor, THEME } from './theme'

const PANE = 'handoff'
const LABEL = 'Handoff'
const CONFIRM_MS = 5000

// The settings (userConfig), fixed per activation: a change reloads the mod.
let iconMode: IconMode = 'auto'
let maxWords = clampWords(undefined)
let look = lookFor(false)

let working = false
let isRunning = false
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
  const opened = await $.ui.open({ id: PANE, title: 'mod-handoff', closeOnEscape: true })
  if (!opened.isPlaced) $.ui.toast(`Handoff settings waiting: ${opened.reason}`)
  await $.state.set({ plugin: 'mod-handoff', key: 'pane' }, opened.isPlaced)
}

// The pane shows the last outcome; a failure is a toast, since a long line in the pill row wraps and breaks it.
function say($: EngineInterface, text: string) {
  note = text
  if (text.startsWith(MARK.warn)) $.ui.toast(text.slice(MARK.warn.length).trim())
  $.ui.invalidate('ui.render')
}

// Puts the waiting handoff into the fresh prompt. It stays in the store until a fill lands, so a late call is harmless.
async function fillPending($: EngineInterface) {
  const pending = await $.store.get('pending')
  if (!isFresh(pending, await $.clock.now())) return false
  const filled = await $.prompt.fill({ text: pending.text, mode: 'replace' })
  if (!filled.isFilled) return false
  await $.store.delete('pending')
  say($, `${MARK.ok} Handoff filled in, review it and press Enter`)
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

// Summarize through a hidden fork, run /clear, fill the handoff into the new prompt. Nothing is sent.
async function startHandoff($: EngineInterface) {
  if (isRunning) return
  cancelConfirm($)
  if (working) {
    say($, `${MARK.warn} Claude is working, try again once it is idle`)
    return
  }
  isRunning = true
  say($, 'writing the handoff')
  try {
    const skill = await $.fs.read(`${$.plugin.root}/skills/session-handoff/SKILL.md`).then(String)
    const prompt = buildPrompt(skill, maxWords)
    let result = await $.model.fork({ prompt })
    if (!result.isAnswered && result.reason === 'nothing-to-fork') result = await summarizeTranscript($, prompt)
    if (!result.isAnswered) {
      say($, `${MARK.warn} ${FORK_FAILURES[result.reason] ?? result.reason}`)
      return
    }
    const text = result.text.trim()
    if (!text) {
      say($, `${MARK.warn} ${FORK_FAILURES['empty-reply']}`)
      return
    }
    if (working) {
      say($, `${MARK.warn} Claude started working, nothing was cleared`)
      return
    }
    await $.store.set('pending', { text, at: await $.clock.now() })
    try {
      await $.command.run({ command: 'clear' })
    } catch {
      // The person can run /clear themselves; session.end then fills the handoff.
      await $.prompt.fill({ text: '/clear', mode: 'replace' })
      say($, `${MARK.warn} Could not run /clear, press Enter to clear and the handoff fills in after`)
      return
    }
    if (!(await fillWithRetry($))) say($, `${MARK.warn} Cleared, but the handoff could not be filled in`)
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
  return 'Writing the handoff, then clearing'
}

// True while the pointer is on this mod's pill entry, which then shows its tip under the row.
let tipShown = false

const toasts = new ToastList('handoff')

export const register: Register = (on, options) => {
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
  look = lookFor(iconMode === 'nerd')

  on('session.start', async ($, e, next) => {
    look = await detectLook($)
    await $.command.register({
      name: 'mod-handoff',
      description: 'Summarize the session, clear it, and fill the handoff into the new prompt; `settings` opens its settings panel',
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
        <Client key={id} module="./entry.tsx" height={1} props={{ id, label, isOpen: isIdle, bg: PILL.secondary, isBusy }} />
      </Box>
    )
    const body = isRunning ? (
      // Writing takes a model call; the shimmer shows it is still on its way.
      entry('handoff-running', 'Writing handoff…', true)
    ) : isConfirming ? (
      <Box key="handoff-confirm" flexDirection="row" paddingLeft={1}>
        <Text key="handoff-ask" color={THEME.onSurface}>{'Clear & continue?'}</Text>
        {entry('handoff-yes', 'Yes')}
        <Text key="handoff-slash" color={THEME.border}>│</Text>
        {entry('handoff-no', 'No')}
      </Box>
    ) : (
      entry('handoff-entry', LABEL)
    )

    return pillRow({ Box, Text }, look.nerd, group, [...row, pill({ Box, Text }, look.nerd, PILL.secondary, body, 'handoff-pill')], [...toastCards({ Box, Client, Text }, toasts), ...rest], tipShown ? tipLine({ Box, Text }, 'Handoff: summarize, clear the chat and continue fresh') : tip)
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
    if (hover?.type === 'menu-hover' && hover.id === 'handoff-entry') {
      tipShown = hover.isOver === true
      $.ui.invalidate('ui.render')
    }
    const message = e.data as EntryMessage
    if (message?.type !== 'menu-entry') return next(e)
    if (message.id === 'handoff-entry') {
      if (working) $.ui.toast('Claude is working, Handoff is available once it is idle')
      else askConfirm($)
    }
    if (message.id === 'handoff-yes') await startHandoff($)
    if (message.id === 'handoff-no') cancelConfirm($)

    return next(e)
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const rows = (await $.config.list()).filter(row => row.key.startsWith('mod-handoff.'))
    const set = async (row: ConfigRow, value: ConfigValue) => {
      const result = await $.config.set({ key: row.key, value })
      say($, 'deny' in result && result.deny ? `${MARK.warn} ${result.deny}` : `${MARK.ok} ${row.label} saved`)
    }
    const run = (_action: Action) => startHandoff($)

    return (
      <Box flexDirection="column" backgroundColor={THEME.bg} paddingX={1} minHeight={e.props.scroll.bodyRows}>
        {paneTitle({ Box, Text }, look, 'fold', `Handoff ${MARK.sep} settings`)}
        <Text color={statusColor(note)}>{withMark(look, note) || `click a control to change it ${MARK.sep} saved at once, the mod reloads`}</Text>
        {settingsBody({ Box, Button, Text }, look, { rows, actions, working, set, run, previews })}
      </Box>
    )
  })
}
