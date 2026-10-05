import type { ConfigRow, ConfigValue, EngineInterface, Register, RenderElement } from 'claude-code'

import { displayName, LEVEL_LOOK, withEffort, withModel } from './levels'
import type { EntryMessage } from './entry'
import { isNerdFace, lookFor, paneTitle, terminalSettings, type IconMode, withMark } from './look'
import type { MeterMessage } from './meter'
import { settingsBody } from './settings'
import { fill, MARK, statusColor, THEME } from './theme'
import { PILL, pill, pillRow, splitRow, tipLine } from './pills'
import text from './text'
import { TOAST_MS, ToastList, toastCards } from './toasts'

const homeOf = async ($: EngineInterface) => ((await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '').replace(/\\/g, '/')

const PANE = 'model-effort-settings'

// The icons setting (userConfig), fixed per activation: a change reloads the mod.
let iconMode: IconMode = 'auto'
let look = lookFor(false)
let note = ''
let flash: string | null = null
// The clicked level and the level before it; a saved level other than these means Alt+P or /effort took over.
let override: { effort: string; before: string } | null = null

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

// `/mod-model-effort settings` toggles the panel. An unplaced pane is waiting, not open.
async function togglePane($: EngineInterface) {
  if (await isPaneOpen($)) {
    await $.ui.close({ id: PANE })
    await $.state.set({ plugin: 'mod-model-effort', key: 'pane' }, false)
    return
  }
  note = ''
  const opened = await $.ui.open({ id: PANE, title: text.paneName, closeOnEscape: true })
  if (!opened.isPlaced) $.ui.toast(fill(text.settingsWaiting, { reason: opened.reason }))
  await $.state.set({ plugin: 'mod-model-effort', key: 'pane' }, opened.isPlaced)
}

// Saves the clicked level for the main model, as Alt+P does; the next request's effort shows whether it took.
async function setEffort($: EngineInterface, effort: string) {
  const current = (await $.state.get({ plugin: 'mod-model-effort', key: 'current' })).value
  if (!current) {
    $.ui.toast(text.sendFirst)
    return
  }
  const path = `${await homeOf($)}/.claude/settings.json`
  const raw = String(await $.fs.read(path))
  const out = withEffort(raw, current.model, effort)
  if (!out) {
    $.ui.toast(fill(text.settingsNotJson, { mark: MARK.warn }))
    return
  }
  await $.fs.write(`${path}.mod-model-effort.bak`, raw)
  await $.fs.write(path, out)
  override = { effort, before: current.effort }
  await $.state.set({ plugin: 'mod-model-effort', key: 'current' }, { model: current.model, effort })
  // The level's word shows only briefly after a click.
  flash = effort
  $.ui.invalidate('ui.render')
  $.clock.after(2000, () => {
    if (flash !== effort) return
    flash = null
    $.ui.invalidate('ui.render')
  })
}


// True while the pointer is on the effort pill, which then shows its tip above the row.
let tipShown = false

// The level under the pointer, named beside the pill like a clicked level is.
let hoveredLevel: string | null = null

// The model menu above the pill, opened by a click on the model name.
let isModelMenuOpen = false

// The models used here before, newest first, as the menu last drew them; an entry's id is its index.
let menuModels: string[] = []

// Switches through Claude Code's own `/model`, then shows the pick at once instead of after the next request.
async function switchModel($: EngineInterface, id: string) {
  isModelMenuOpen = false
  try {
    await $.command.run({ command: 'model', args: id })
  } catch (error) {
    $.ui.toast(fill(text.switchFailed, { mark: MARK.warn, model: displayName(id), error: String(error) }))
    return
  }
  const current = (await $.state.get({ plugin: 'mod-model-effort', key: 'current' })).value
  await $.state.set({ plugin: 'mod-model-effort', key: 'current' }, { model: id, effort: current?.effort ?? 'medium' })
  await $.store.set('model', id)
  await $.store.set('models', withModel(await $.store.get('models'), id))
  $.ui.invalidate('ui.render')
}

// Claude Code's own picker has every model, new ones included.
async function openPicker($: EngineInterface) {
  isModelMenuOpen = false
  $.ui.invalidate('ui.render')
  await $.command.run({ command: 'model', args: '' }).catch(error => $.ui.toast(fill(text.pickerFailed, { mark: MARK.warn, error: String(error) })))
}

type Elements = { Box: (props: any) => RenderElement; Client: (props: any) => RenderElement }

const menuEntry = ({ Box, Client }: Elements, id: string, label: string, isOpen: boolean) => (
  <Box key={`${id}-pad`}>
    <Client key={id} module="./entry.tsx" height={1} props={{ id, label, isOpen, bg: THEME.surface1, still }} />
  </Box>
)

// The models used before, the current one marked, then the full picker; a card right-aligned over the pill.
const modelMenu = ({ Box, Client }: Elements, currentId: string) => (
  <Box key="effort-models-row" flexDirection="row" justifyContent="flex-end">
    <Box key="effort-models" flexDirection="column" paddingX={1} borderStyle="round" borderColor={THEME.accent} backgroundColor={THEME.surface1}>
      {menuModels.map((id, index) => menuEntry({ Box, Client }, `effort-model-${index}`, `${id === currentId ? MARK.ok : ' '} ${displayName(id)}`, id === currentId))}
      {menuEntry({ Box, Client }, 'effort-model-all', `${MARK.stage} ${text.allModels}`, false)}
    </Box>
  </Box>
)

const toasts = new ToastList('effort')
// The animations setting, fixed per activation: off, every entry draws still.
let still = false

export const register: Register = (on, options) => {
  still = options.animations === false
  toasts.isStill = still
  iconMode = (options.icons as IconMode | undefined) ?? 'auto'
  // A forced mode needs no detection; auto waits for session.start to read the terminal font.
  look = lookFor(iconMode === 'nerd')
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
    look = await detectLook($)
    await $.command.register({ name: 'mod-model-effort', description: text.commandDescription, argumentHint: '[settings]' })
    await $.state.set({ plugin: 'mod-model-effort', key: 'pane' }, await isPaneOpen($))
    // Before the first request, the last session's model and its saved level stand in.
    const model = await $.store.get('model')
    if (typeof model === 'string') {
      const settings = await $.settings.read()
      const effort = settings.modelSettings?.[model]?.effortLevel ?? settings.effortLevel
      if (typeof effort === 'string') await $.state.set({ plugin: 'mod-model-effort', key: 'current' }, { model, effort })
    }

    return next(e)
  })

  on('command.run', { command: 'mod-model-effort' }, async ($, e) => {
    if (e.args.trim() !== 'settings') return { text: text.usage }
    await togglePane($)
    return { text: '' }
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) await $.state.set({ plugin: 'mod-model-effort', key: 'pane' }, false)

    return next(e)
  })

  on('state.set', async ($, e, next) => {
    if (e.key === 'pane' && e.plugin !== 'mod-model-effort' && e.value === true) {
      $.clock.after(0, async () => {
        if (!(await isPaneOpen($))) return
        await $.ui.close({ id: PANE })
        await $.state.set({ plugin: 'mod-model-effort', key: 'pane' }, false)
      })
    }

    return next(e)
  })

  // Each main request carries the real model id and effort, so the meter always shows what went out.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId || typeof e.effort !== 'string') return yield* next(e)

    // Claude Code reads the saved level only at startup, so a clicked level rides on each request until Alt+P or /effort saves another.
    if (override) {
      const settings = await $.settings.read({ source: 'user' })
      const saved = settings.modelSettings?.[e.model]?.effortLevel
      if (saved !== override.effort && saved !== override.before) override = null
    }
    const effort = override?.effort ?? e.effort
    const current = (await $.state.get({ plugin: 'mod-model-effort', key: 'current' })).value
    if (current?.model !== e.model || current?.effort !== effort) {
      await $.state.set({ plugin: 'mod-model-effort', key: 'current' }, { model: e.model, effort })
      await $.store.set('model', e.model)
      await $.store.set('models', withModel(await $.store.get('models'), e.model))
    }

    return yield* next(effort === e.effort ? e : { ...e, effort: effort as typeof e.effort })
  })

  on('ui.message', async ($, e, next) => {
    const clicked = e.data as EntryMessage
    const dismissed = clicked?.type === 'menu-entry' ? toasts.idOf(clicked.id) : undefined
    if (dismissed !== undefined) {
      toasts.drop(dismissed)
      $.ui.invalidate('ui.render')
      return next(e)
    }
    if (clicked?.type === 'menu-entry' && clicked.id === 'effort-model-all') {
      await openPicker($)
      return next(e)
    }
    const picked = clicked?.type === 'menu-entry' && clicked.id.startsWith('effort-model-') ? menuModels[Number(clicked.id.slice('effort-model-'.length))] : undefined
    if (picked) {
      await switchModel($, picked)
      return next(e)
    }
    const message = e.data as MeterMessage
    if (message?.type === 'model-menu') {
      isModelMenuOpen = !isModelMenuOpen
      const current = (await $.state.get({ plugin: 'mod-model-effort', key: 'current' })).value
      menuModels = withModel(await $.store.get('models'), current?.model ?? (await $.session.model()))
      $.ui.invalidate('ui.render')
    }
    if (message?.type === 'set') await setEffort($, message.effort)
    if (message?.type === 'menu-hover') {
      tipShown = message.isOver
      hoveredLevel = message.level ?? null
      $.ui.invalidate('ui.render')
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.hasSurvey) return next(e)

    const { Box, Client, Text } = $.ui.resolve(e)
    const current = await $.state.get({ plugin: 'mod-model-effort', key: 'current' })
    const modelId = current.value?.model ?? (await $.session.model())
    const model = displayName(modelId)
    const { group, row, rest, tip } = splitRow(await next(e))
    const meter = <Client key="meter" module="./meter.tsx" height={1} props={{ effort: current.value?.effort ?? null, model, bg: PILL.secondary, still }} />
    // The level word follows the pill, so it never moves the glyphs under the pointer.
    const shownWord = hoveredLevel ?? flash
    const word = shownWord ? <Text key="menu-flash" color={LEVEL_LOOK[shownWord]?.color}>{(text.levelNames as Record<string, string>)[shownWord] ?? shownWord}</Text> : null

    const level = current.value?.effort ?? null
    const hint = level ? fill(text.hintAtLevel, { model, level }) : fill(text.hintBase, { model })
    const menu = isModelMenuOpen ? [modelMenu({ Box, Client }, modelId)] : []
    return pillRow({ Box, Text }, look.nerd, group, [...row, pill({ Box, Text }, look.nerd, PILL.secondary, meter), word], [...toastCards({ Box, Client, Text }, toasts), ...rest, ...menu], tipShown ? tipLine({ Box, Text }, hint) : tip)
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const rows = (await $.config.list()).filter(row => row.key.startsWith('mod-model-effort.'))
    const set = async (row: ConfigRow, value: ConfigValue) => {
      const result = await $.config.set({ key: row.key, value })
      note = 'deny' in result && result.deny ? `${MARK.warn} ${result.deny}` : `${MARK.ok} ${fill(text.settingSaved, { label: row.label })}`
      $.ui.invalidate('ui.render')
    }

    return (
      <Box flexDirection="column" backgroundColor={THEME.bg} paddingX={1} minHeight={e.props.scroll.bodyRows}>
        {paneTitle({ Box, Text }, look, 'settings', `${text.paneName} ${MARK.sep} ${text.paneSettings}`)}
        <Text color={statusColor(note)}>{withMark(look, note) || `${text.statusHint} ${MARK.sep} ${text.statusHintSaved}`}</Text>
        {settingsBody({ Box, Button, Text }, look, { rows, actions: [], working: false, set, run: async () => {}, previews: undefined })}
      </Box>
    )
  })
}
