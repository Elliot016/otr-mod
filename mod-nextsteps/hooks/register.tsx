import type { ConfigRow, ConfigValue, EngineInterface, Register } from 'claude-code'

import { actionColumn } from './rows'
import { isNerdFace, lookFor, paneTitle, terminalSettings, type IconMode, withMark } from './look'
import { settingsBody, type Action, type Previews } from './settings'
import { MARK, statusColor, THEME } from './theme'
import type { EntryMessage } from './entry'
import type { ListMessage } from './list'
import { TOAST_MS, ToastList, toastCards } from './toasts'

const PANE = 'nextsteps'
const MAX_CHARS = 100

// The person's settings (userConfig), fixed per activation: a change reloads the mod.
let iconMode: IconMode = 'auto'
let enabled = true
let count = 3
let look = lookFor(false)

// Suggestions on show. `epoch` counts turn starts and submits, so a reply that arrives late is dropped.
let steps: string[] = []
let epoch = 0
let working = false
let note = ''
let actions: Action[] = []
let previews: Previews | undefined

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

const question = (limit: number) =>
  `Suggest up to ${limit} short prompts I might send you next, given this conversation. ` +
  `Each is one line under 80 characters, written the way I would type it. ` +
  `Reply with the prompts only, one per line, no numbering, no quotes, no commentary.`

// One suggestion per line, bullets and numbering stripped, long or empty lines dropped.
function parseSteps(text: string, limit: number) {
  const lines = text
    .split(/\r?\n/)
    .map(line => line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').replace(/^["'`]+|["'`]+$/g, '').trim())
    .filter(line => line.length > 0 && line.length <= MAX_CHARS)
  return [...new Set(lines)].slice(0, limit)
}

async function suggest($: EngineInterface, mine: number) {
  try {
    const reply = await $.model.fork({ prompt: question(count) })
    if (mine !== epoch || !reply.isAnswered) return
    const found = parseSteps(reply.text, count)
    if (found.length === 0) return
    steps = found
    $.ui.invalidate('ui.render')
  } catch {
    // A suggestion is a courtesy: any failure shows nothing.
  }
}

function clearSteps($: EngineInterface) {
  epoch += 1
  if (steps.length === 0) return
  steps = []
  $.ui.invalidate('ui.render')
}

async function fillFrom($: EngineInterface, index: number) {
  const text = steps[index]
  if (!text) return
  const draft = await $.prompt.read()
  if (draft.text.trim() === '') await $.prompt.fill({ text, mode: 'replace' })
  else await $.prompt.fill({ text: ` ${text}`, mode: 'append' })
}

const isPaneOpen = async ($: EngineInterface) => (await $.ui.panes()).some(pane => pane.id === PANE && pane.isPlaced)

// `/mod-nextsteps settings` toggles the panel; an unplaced pane is waiting, not open.
async function toggleSettings($: EngineInterface) {
  if (await isPaneOpen($)) {
    await $.ui.close({ id: PANE })
    await $.state.set({ plugin: 'mod-nextsteps', key: 'pane' }, false)
    return
  }
  note = ''
  const showcase = await $.fs.read(`${$.plugin.root}/showcase.json`).then(text => JSON.parse(String(text))).catch(() => null)
  previews = showcase?.previews
  actions = (Array.isArray(showcase?.actions) ? showcase.actions : []).map((action: Action) => ({ ...action, isLocal: action.command === 'mod-nextsteps' }))
  const opened = await $.ui.open({ id: PANE, title: 'mod-nextsteps', closeOnEscape: true })
  if (!opened.isPlaced) $.ui.toast(`Settings panel waiting: ${opened.reason}`)
  await $.state.set({ plugin: 'mod-nextsteps', key: 'pane' }, opened.isPlaced)
}

// What `/mod-nextsteps <args>` does; the panel's own actions call it directly, since $.command.run skips the calling plugin.
async function answer($: EngineInterface, args: string) {
  if (args.trim() === 'clear') {
    clearSteps($)
    return 'Suggestions cleared'
  }
  await toggleSettings($)
  return ''
}

const toasts = new ToastList('nextsteps')

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
  enabled = options.enabled !== false
  count = Math.min(3, Math.max(1, Math.round(Number(options.count ?? 3)) || 3))
  // A forced mode needs no detection; auto waits for session.start to read the terminal font.
  look = lookFor(iconMode === 'nerd')

  on('session.start', async ($, e, next) => {
    look = await detectLook($)
    await $.command.register({
      name: 'mod-nextsteps',
      description: 'Next-prompt suggestions above the input; `settings` opens its settings panel, `clear` drops the current ones',
      argumentHint: '[settings|clear]',
    })
    await $.state.set({ plugin: 'mod-nextsteps', key: 'pane' }, await isPaneOpen($))
    $.ui.invalidate('ui.render')

    return next(e)
  })

  on('command.run', { command: 'mod-nextsteps' }, async ($, e) => ({ text: await answer($, e.args ?? '') }))

  // Subagent turns carry agentId and say nothing about the main prompt.
  on('turn.start', async ($, e, next) => {
    if (!e.agentId) {
      working = true
      clearSteps($)
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId) return next(e)
    working = false
    const result = await next(e)
    if (enabled && e.reason === 'answer' && !e.isAborted && e.answer.trim() !== '') {
      const mine = epoch
      // Off the hook's own time: the turn never waits for the model.
      $.clock.after(0, () => suggest($, mine))
    }

    return result
  })

  on('prompt.submit', async ($, e, next) => {
    clearSteps($)

    return next(e)
  })

  on('ui.message', async ($, e, next) => {
    const clicked = e.data as EntryMessage
    const dismissed = clicked?.type === 'menu-entry' ? toasts.idOf(clicked.id) : undefined
    if (dismissed !== undefined) {
      toasts.drop(dismissed)
      $.ui.invalidate('ui.render')
      return next(e)
    }
    const message = e.data as ListMessage | EntryMessage
    if (message?.type === 'select') await fillFrom($, message.index)
    if (message?.type === 'menu-entry' && message.id === 'steps-dismiss') clearSteps($)

    return next(e)
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) await $.state.set({ plugin: 'mod-nextsteps', key: 'pane' }, false)

    return next(e)
  })

  // One panel at a time: another mod's pane opening closes this one, deferred past that plugin's dispatch.
  on('state.set', async ($, e, next) => {
    if (e.key === 'pane' && e.plugin !== 'mod-nextsteps' && e.value === true) {
      $.clock.after(0, async () => {
        if (!(await isPaneOpen($))) return
        await $.ui.close({ id: PANE })
        await $.state.set({ plugin: 'mod-nextsteps', key: 'pane' }, false)
      })
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.hasSurvey) return next(e)
    const { Box, Button, Client, Text } = $.ui.resolve(e)
    // Toasts sit on top, so a tight band cuts them before anything else.
    const cards = toastCards({ Box, Client, Text }, toasts)
    // A command waiting on the person outranks suggestions: the band has few rows, and a hidden hold looks like a hang.
    const isHolding = (await $.state.get({ plugin: 'mod-blast-radius', key: 'holding' })).value === true
    if (steps.length === 0 || isHolding) {
      if (cards.length === 0) return next(e)
      return (
        <Box key="toasts-nextsteps" flexDirection="column">
          {cards}
          {await next(e)}
        </Box>
      )
    }
    const below = await next(e)

    return (
      <Box key="nextsteps" flexDirection="column">
        {cards}
        <Box key="nextsteps-rows" flexDirection="row" columnGap={1} paddingX={1} borderStyle="round" borderColor={THEME.accent} backgroundColor={THEME.surface1}>
          {actionColumn(
            { Box, Button, Text },
            'steps',
            steps.map((_, index) => ({ label: look.glyph.go, onPress: () => fillFrom($, index) })),
          )}
          <Box key="nextsteps-list" flexGrow={1} flexShrink={1}>
            <Client key="steps-list" module="./list.tsx" height={steps.length} props={{ rows: steps }} />
          </Box>
          <Box key="nextsteps-dismiss" flexShrink={0}>
            <Client key="steps-dismiss" module="./entry.tsx" height={1} props={{ id: 'steps-dismiss', label: look.glyph.close.trim() || '×', isOpen: false, bg: THEME.surface1 }} />
          </Box>
        </Box>
        {below}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const rows = (await $.config.list()).filter(row => row.key.startsWith('mod-nextsteps.'))
    // A saved change reloads this mod, which redraws the panel with the new value.
    const set = async (row: ConfigRow, value: ConfigValue) => {
      const clamped = row.key === 'mod-nextsteps.count' && typeof value === 'number' ? Math.min(3, Math.max(1, value)) : value
      const result = await $.config.set({ key: row.key, value: clamped })
      note = 'deny' in result && result.deny ? `${MARK.warn} ${result.deny}` : `${MARK.ok} ${row.label} saved`
      $.ui.invalidate('ui.render')
    }
    const run = async (action: Action) => {
      const said = action.command === 'mod-nextsteps' ? answer($, action.args ?? '') : Promise.resolve('')
      note = await said.then(text => `${MARK.ok} ${text || action.label}`).catch(error => `${MARK.warn} ${String(error)}`)
      $.ui.invalidate('ui.render')
    }

    return (
      <Box flexDirection="column" backgroundColor={THEME.bg} paddingX={1} minHeight={e.props.scroll.bodyRows}>
        {paneTitle({ Box, Text }, look, 'prompt', `mod-nextsteps ${MARK.sep} settings`)}
        <Text key="status" color={statusColor(note)}>{withMark(look, note) || `click a control to change it ${MARK.sep} saved at once, the mod reloads`}</Text>
        {settingsBody({ Box, Button, Text }, look, { rows, actions, working, set, run, previews })}
      </Box>
    )
  })
}
