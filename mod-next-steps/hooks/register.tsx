import type { ConfigValue, EngineInterface, Register } from 'claude-code'

import { isNerdFace, lookFor, paneTitle, terminalSettings, type IconMode, withMark } from './look'
import { settingChoice, settingsBody, type Action, type Previews } from './settings'
import { fill, MARK, statusColor, THEME } from './theme'
import type { EntryMessage } from './entry'
import type { ListMessage } from './list'
import { pillRow, splitRow, tabRow } from './pills'
import { TOAST_MS, ToastList, toastCards } from './toasts'
import text from './text'

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

// One suggestion per line, bullets and numbering stripped, first letter capitalized, long or empty lines dropped.
function parseSteps(text: string, limit: number) {
  const lines = text
    .split(/\r?\n/)
    .map(line => line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').replace(/^["'`]+|["'`]+$/g, '').trim())
    .map(line => line.charAt(0).toUpperCase() + line.slice(1))
    .filter(line => line.length > 0 && line.length <= MAX_CHARS)
  return [...new Set(lines)].slice(0, limit)
}

// True while the model writes suggestions, so the band shows they are coming.
let isSuggesting = false

async function suggest($: EngineInterface, mine: number) {
  isSuggesting = true
  $.ui.invalidate('ui.render')
  try {
    const reply = await $.model.fork({ prompt: question(count) })
    if (mine !== epoch || !reply.isAnswered) return
    const found = parseSteps(reply.text, count)
    if (found.length === 0) return
    steps = found
    $.ui.invalidate('ui.render')
  } catch {
    // A suggestion is a courtesy: any failure shows nothing.
  } finally {
    if (mine === epoch) {
      isSuggesting = false
      $.ui.invalidate('ui.render')
    }
  }
}

function clearSteps($: EngineInterface) {
  epoch += 1
  if (isSuggesting) {
    isSuggesting = false
    $.ui.invalidate('ui.render')
  }
  if (steps.length === 0) return
  steps = []
  $.ui.invalidate('ui.render')
}

async function fillFrom($: EngineInterface, index: number) {
  const text = steps[index]
  if (!text) return
  const draft = await $.prompt.read()
  // The digit that pressed it may still sit in the prompt; the suggestion takes its place.
  if (draft.text.trim() === '' || draft.text.trim() === String(index + 1)) await $.prompt.fill({ text, mode: 'replace' })
  else await $.prompt.fill({ text: ` ${text}`, mode: 'append' })
}

const isPaneOpen = async ($: EngineInterface) => (await $.ui.panes()).some(pane => pane.id === PANE && pane.isPlaced)

// `/mod-next-steps settings` toggles the panel; an unplaced pane is waiting, not open.
async function toggleSettings($: EngineInterface) {
  if (await isPaneOpen($)) {
    await $.ui.close({ id: PANE })
    await $.state.set({ plugin: 'mod-next-steps', key: 'pane' }, false)
    return
  }
  note = ''
  const showcase = await $.fs.read(`${$.plugin.root}/showcase.json`).then(text => JSON.parse(String(text))).catch(() => null)
  previews = showcase?.previews
  actions = (Array.isArray(showcase?.actions) ? showcase.actions : []).map((action: Action) => ({ ...action, isLocal: action.command === 'mod-next-steps' }))
  const opened = await $.ui.open({ id: PANE, title: 'mod-next-steps', closeOnEscape: true })
  if (!opened.isPlaced) $.ui.toast(fill(text.settingsWaiting, { reason: opened.reason }))
  await $.state.set({ plugin: 'mod-next-steps', key: 'pane' }, opened.isPlaced)
}

// What `/mod-next-steps <args>` does; the panel's own actions call it directly, since $.command.run skips the calling plugin.
async function answer($: EngineInterface, args: string) {
  if (args.trim() === 'clear') {
    clearSteps($)
    return text.suggestionsCleared
  }
  await toggleSettings($)
  return ''
}

const toasts = new ToastList('nextsteps')
// The animations setting, fixed per activation: off, every entry draws still.
let still = false

// A settings card's click: its row, saved through /config; a saved change reloads this mod.
async function saveSetting($: EngineInterface, key: string, value: ConfigValue) {
  const row = (await $.config.list()).find(each => each.key === key)
  if (!row) return
  const clamped = row.key === 'mod-next-steps.count' && typeof value === 'number' ? Math.min(3, Math.max(1, value)) : value
  const result = await $.config.set({ key: row.key, value: clamped })
  note = 'deny' in result && result.deny ? `${MARK.warn} ${result.deny}` : `${MARK.ok} ${fill(text.settingSaved, { label: row.label })}`
  $.ui.invalidate('ui.render')
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
  enabled = options.enabled !== false
  count = Math.min(3, Math.max(1, Math.round(Number(options.count ?? 3)) || 3))
  // A forced mode needs no detection; auto waits for session.start to read the terminal font.
  look = lookFor(iconMode === 'nerd')

  on('session.start', async ($, e, next) => {
    look = await detectLook($)
    await $.command.register({
      name: 'mod-next-steps',
      description: text.commandDescription,
      argumentHint: '[settings|clear]',
    })
    await $.state.set({ plugin: 'mod-next-steps', key: 'pane' }, await isPaneOpen($))
    $.ui.invalidate('ui.render')

    return next(e)
  })

  on('command.run', { command: 'mod-next-steps' }, async ($, e) => ({ text: await answer($, e.args ?? '') }))

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
    const change = settingChoice(e.data)
    if (change) await saveSetting($, change.key, change.value)
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
    if (e.id === PANE) await $.state.set({ plugin: 'mod-next-steps', key: 'pane' }, false)

    return next(e)
  })

  // One panel at a time: another mod's pane opening closes this one, deferred past that plugin's dispatch.
  on('state.set', async ($, e, next) => {
    if (e.key === 'pane' && e.plugin !== 'mod-next-steps' && e.value === true) {
      $.clock.after(0, async () => {
        if (!(await isPaneOpen($))) return
        await $.ui.close({ id: PANE })
        await $.state.set({ plugin: 'mod-next-steps', key: 'pane' }, false)
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
    // Joins the shared pill row's top section when other mods drew one below; wrapping it would hide the row from mods drawn around this one, which then start a second row.
    const above = (below: unknown, items: unknown[]) => {
      const { group, row, rest, tip } = splitRow(below)
      if (group.length || row.length || tip) return pillRow({ Box, Text }, look.nerd, group, row, [...items, ...rest], tip)
      return <Box key="nextsteps" flexDirection="column">{items}{below}</Box>
    }
    if (steps.length === 0 || isHolding) {
      const waiting = enabled && isSuggesting && !isHolding
      if (cards.length === 0 && !waiting) return next(e)
      return above(await next(e), [
        ...cards,
        waiting ? (
          <Box key="nextsteps-waiting" paddingX={1}>
            <Client key="steps-waiting" module="./entry.tsx" height={1} props={{ id: 'steps-waiting', label: text.thinking, isOpen: false, bg: THEME.bg, isBusy: true, still }} />
          </Box>
        ) : null,
      ])
    }
    const below = await next(e)

    return above(below, [
        ...cards,
        <Box key="nextsteps-rows" flexDirection="row" columnGap={1} paddingX={1} borderStyle="round" borderColor={THEME.accent} backgroundColor={THEME.surface1}>
          {/* Each suggestion's digit, typed alone into the empty prompt, fills it; the keycap shows it and a Button nobody sees carries the hotkey. */}
          <Box key="steps-keys" flexDirection="column" flexShrink={0}>
            {steps.map((_, index) => (
              <Box key={`steps-key-${index}`} flexDirection="row">
                <Box key={`steps-cap-${index}`} backgroundColor={THEME.surface3}>
                  <Text color={THEME.accent} bold>{` ${index + 1} `}</Text>
                </Box>
                <Box key={`steps-hotkey-${index}`} width={0} height={0} overflow="hidden">
                  <Button key={`steps-hotkey-button-${index}`} label={steps[index]} hotkey={String(index + 1)} plain onPress={() => fillFrom($, index)} />
                </Box>
              </Box>
            ))}
          </Box>
          <Box key="nextsteps-list" flexGrow={1} flexShrink={1}>
            <Client key="steps-list" module="./list.tsx" height={steps.length} props={{ rows: steps }} />
          </Box>
          <Box key="nextsteps-dismiss" flexShrink={0}>
            <Client key="steps-dismiss" module="./entry.tsx" height={1} props={{ id: 'steps-dismiss', label: look.glyph.close.trim() || '×', isOpen: false, bg: THEME.surface1, still }} />
          </Box>
        </Box>,
    ])
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE) return next(e)

    const { Box, Button, Client, Text } = $.ui.resolve(e)
    const rows = (await $.config.list()).filter(row => row.key.startsWith('mod-next-steps.'))
    // A saved change reloads this mod, which redraws the panel with the new value.
    const run = async (action: Action) => {
      const said = action.command === 'mod-next-steps' ? answer($, action.args ?? '') : Promise.resolve('')
      note = await said.then(text => `${MARK.ok} ${text || action.label}`).catch(error => `${MARK.warn} ${String(error)}`)
      $.ui.invalidate('ui.render')
    }

    return (
      <Box flexDirection="column" backgroundColor={THEME.bg} paddingX={1} minHeight={e.props.scroll.bodyRows}>
        {tabRow({ Box, Client, Text }, look.nerd, [{ id: 'mod-next-steps-settings-tab', label: `${text.paneHeading} ${MARK.sep} ${text.paneHeadingSettings}`, icon: look.glyph.gear, isOpen: true }], still)}
        <Text key="status" color={statusColor(note)}>{withMark(look, note) || `${text.statusHint} ${MARK.sep} ${text.statusReload}`}</Text>
        {settingsBody({ Box, Button, Client, Text }, look, { rows, actions, working, run, previews, still: still })}
      </Box>
    )
  })
}
