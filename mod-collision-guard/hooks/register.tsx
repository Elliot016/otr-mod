import type { ConfigRow, ConfigValue, EngineInterface, Register } from 'claude-code'

import { agoText, clearOwn, clockText, EDIT_TOOLS, findConflict, pathOf, recordEdit, type Io } from './guard'
import { isNerdFace, lookFor, paneTitle, terminalSettings, type IconMode, withMark } from './look'
import { settingsBody, type Action, type Previews } from './settings'
import { MARK, statusColor, THEME } from './theme'

// The person's settings (userConfig), fixed per activation: a change reloads the mod.
let enabled = true
let windowMinutes = 30
let iconMode: IconMode = 'auto'
let look = lookFor(false)

const PANE = 'collision-guard'
let actions: Action[] = []
let previews: Previews | undefined
let note = ''

const CHOICES = ['Proceed', 'Move to a worktree', 'Cancel']

// `$` cannot cross an import, so the log gets plain functions instead.
const ioOf = ($: EngineInterface): Io => ({
  read: path => $.fs.read(path),
  write: (path, text) => $.fs.write(path, text),
  list: path => $.fs.list(path),
})

async function logDir($: EngineInterface) {
  const home = ((await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '').replace(/\\/g, '/')
  return `${home}/.claude/mod-collision-guard/sessions`
}

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

const isPaneOpen = async ($: EngineInterface) => (await $.ui.panes()).some(pane => pane.id === PANE && pane.isPlaced)

// `/mod-collision-guard settings` toggles the panel; an unplaced pane is waiting, not open.
async function toggleSettings($: EngineInterface) {
  if (await isPaneOpen($)) {
    await $.ui.close({ id: PANE })
    await $.state.set({ plugin: 'mod-collision-guard', key: 'pane' }, false)
    return
  }
  note = ''
  const showcase = await $.fs.read(`${$.plugin.root}/showcase.json`).then(text => JSON.parse(String(text))).catch(() => null)
  previews = showcase?.previews
  actions = (Array.isArray(showcase?.actions) ? showcase.actions : []).map((action: Action) => ({ ...action, isLocal: action.command === 'mod-collision-guard' }))
  const opened = await $.ui.open({ id: PANE, title: 'Collision Guard', closeOnEscape: true })
  if (!opened.isPlaced) $.ui.toast(`Settings panel waiting: ${opened.reason}`)
  await $.state.set({ plugin: 'mod-collision-guard', key: 'pane' }, opened.isPlaced)
}

// What `/mod-collision-guard <args>` does; the panel's own actions call it directly, since $.command.run skips the calling plugin.
async function answer($: EngineInterface, args: string) {
  if (args.trim() === 'settings') {
    await toggleSettings($)
    return ''
  }
  if (args.trim() === 'clear') {
    await clearOwn(ioOf($), await logDir($), await $.session.id())
    return 'Recorded edits of this session forgotten'
  }
  return `${enabled ? 'On' : 'Off'}, ${windowMinutes} min window. /mod-collision-guard settings opens the panel`
}

const worktreeReason = (path: string) =>
  `The user chose to move to a worktree because another open session is editing ${path}. Call EnterWorktree, then redo this edit there.`

// The question, the dialog's choices and what each means for the call: undefined lets it run.
async function decide($: EngineInterface, path: string, at: number, now: number) {
  const question = `Another open session edited ${path} ${agoText(now - at)} (${clockText(at)}). Edit it anyway?`
  let picked = 'Cancel'
  try {
    picked = await $.ui.ask(question, { options: CHOICES, header: 'Collision' })
  } catch {
    // Dismissed, "Chat about this", or a run with nobody to ask: refuse, the safe answer.
  }
  if (picked === 'Proceed') return undefined
  if (picked === 'Move to a worktree') return { deny: worktreeReason(path) }
  if (picked === 'Cancel') return { deny: `The user cancelled this edit of ${path} because another open session is editing it. Do not retry it; ask what to do instead.` }
  return { deny: `Another open session is editing ${path}. The user says: ${picked}` }
}

export const register: Register = (on, options) => {
  enabled = options.enabled !== false
  const minutes = Number(options.window_minutes)
  windowMinutes = minutes > 0 ? minutes : 30
  iconMode = (options.icons as IconMode | undefined) ?? 'auto'
  // A forced mode needs no detection; auto waits for session.start to read the terminal font.
  look = lookFor(iconMode === 'nerd')

  on('session.start', async ($, e, next) => {
    look = await detectLook($)
    await $.command.register({
      name: 'mod-collision-guard',
      description: 'Collision Guard status; `settings` opens its panel, `clear` forgets this session\'s recorded edits',
      argumentHint: '[settings|clear]',
    })
    await $.state.set({ plugin: 'mod-collision-guard', key: 'pane' }, await isPaneOpen($))
    $.ui.invalidate('ui.render')

    return next(e)
  })

  // A closed session no longer collides with anything, so its entries go with it.
  on('session.end', async ($, e, next) => {
    await clearOwn(ioOf($), await logDir($), e.sessionId).catch(() => undefined)

    return next(e)
  })

  on('tool.call', { tool: EDIT_TOOLS }, async ($, e, next) => {
    const path = pathOf(e as unknown as Record<string, unknown>)
    if (!path) return next(e)

    const io = ioOf($)
    const dir = await logDir($)
    const session = await $.session.id()
    const windowMs = windowMinutes * 60000

    // A log that cannot be read must never block an edit.
    const clash = enabled ? await findConflict(io, dir, session, path, await $.clock.now(), windowMs).catch(() => undefined) : undefined
    if (clash) {
      const verdict = await decide($, path, clash.at, await $.clock.now())
      if (verdict) return verdict
    }

    const result = (await next(e)) as { deny?: string; isError?: boolean }
    if (!result.deny && !result.isError) await recordEdit(io, dir, session, path, await $.clock.now(), windowMs).catch(() => undefined)

    return result as never
  })

  on('command.run', { command: 'mod-collision-guard' }, async ($, e) => ({ text: await answer($, e.args) }))

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) await $.state.set({ plugin: 'mod-collision-guard', key: 'pane' }, false)

    return next(e)
  })

  // One panel at a time: another mod's pane opening closes this one, deferred past that plugin's dispatch.
  on('state.set', async ($, e, next) => {
    if (e.key === 'pane' && e.plugin !== 'mod-collision-guard' && e.value === true) {
      $.clock.after(0, async () => {
        if (!(await isPaneOpen($))) return
        await $.ui.close({ id: PANE })
        await $.state.set({ plugin: 'mod-collision-guard', key: 'pane' }, false)
      })
    }

    return next(e)
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const rows = (await $.config.list()).filter(row => row.key.startsWith('mod-collision-guard.'))
    // A saved change reloads this mod, which redraws the panel with the new value.
    const set = async (row: ConfigRow, value: ConfigValue) => {
      const result = await $.config.set({ key: row.key, value })
      note = 'deny' in result && result.deny ? `${MARK.warn} ${result.deny}` : `${MARK.ok} ${row.label} saved`
      $.ui.invalidate('ui.render')
    }
    const run = async (action: Action) => {
      note = await answer($, action.args ?? '')
        .then(text => `${MARK.ok} ${text || action.label}`)
        .catch(error => `${MARK.warn} ${String(error)}`)
      $.ui.invalidate('ui.render')
    }

    return (
      <Box flexDirection="column" backgroundColor={THEME.bg} paddingX={1} minHeight={e.props.scroll.bodyRows}>
        {paneTitle({ Box, Text }, look, 'settings', `Collision Guard ${MARK.sep} settings`)}
        <Text key="settings-note" color={statusColor(note)}>{withMark(look, note) || `click a control to change it ${MARK.sep} saved at once, the mod reloads`}</Text>
        {settingsBody({ Box, Button, Text }, look, { rows, actions, working: false, set, run, previews })}
      </Box>
    )
  })
}
