import type { ConfigValue, EngineInterface, Register, RenderElement } from 'claude-code'

import { displayName, LEVEL_LOOK, LEVELS, withEffort, withModel } from './levels'
import { isTipMessage, tipText, type EntryMessage, type EntryProps, type Tip, type TipMessage } from './entry'
import { FOOTER_ROWS, isNerdFace, lookFor, paneFooter, paneTitle, terminalSettings, type IconMode, withMark } from './look'
import type { MeterMessage } from './meter'
import { settingChoice, settingsBody } from './settings'
import { fill, MARK, statusColor, THEME } from './theme'
import { fitFor, PILL, pill, pillRow, splitRow, tabRow, tipLine } from './pills'
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


// The pill part or model menu entry under the pointer, shown in the tip row above the pill row.
let bandTip: TipMessage | null = null

// The settings pane's control under the pointer, shown in its footer.
let paneTip: Tip | null = null

// The level under the pointer, named beside the pill like a clicked level is.
const hoveredLevel = () => (bandTip?.id?.startsWith('effort-level-') ? bandTip.id.slice('effort-level-'.length) : null)

// The model menu above the pill, opened by a click on the model name.
let isModelMenuOpen = false

// The models used here before, newest first, as the menu last drew them; an entry's id is its index.
let menuModels: string[] = []

// Switches through Claude Code's own `/model`, then shows the pick at once instead of after the next request.
async function switchModel($: EngineInterface, id: string) {
  isModelMenuOpen = false
  bandTip = null
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
  bandTip = null
  $.ui.invalidate('ui.render')
  await $.command.run({ command: 'model', args: '' }).catch(error => $.ui.toast(fill(text.pickerFailed, { mark: MARK.warn, error: String(error) })))
}

type Elements = { Box: (props: any) => RenderElement; Client: (props: any) => RenderElement; Text: (props: any) => RenderElement }

// A model entry as its own pill on the card; `entry` holds what differs between the current model, the others and the picker.
const menuEntry = ({ Box, Client, Text }: Elements, id: string, fill: string, entry: Omit<EntryProps, 'id' | 'bg'>) =>
  pill({ Box, Text }, look.nerd, fill, <Client key={id} module="./entry.tsx" height={1} props={{ id, bg: fill, nerd: look.nerd, still, ...entry } satisfies EntryProps} />, `${id}-pill`, THEME.surface1)

// A control glyph without the brackets and padding it carries as a Button label, for drawing as a subpill.
const bare = (glyph: string) => glyph.replace(/[[\]\s]/g, '')

// The models used before, the current one on surface3 with a ✓ subpill, then the full picker; a card right-aligned over the pill.
function modelMenu(elements: Elements, currentId: string) {
  const { Box } = elements
  const ok = bare(look.glyph.ok)
  // The others start with blanks as wide as the ✓ subpill, so every name lines up.
  const blank = ' '.repeat([...ok].length + 2)
  const entries = menuModels.map((id, index) =>
    id === currentId
      ? menuEntry(elements, `effort-model-${index}`, THEME.surface3, { label: displayName(id), isOpen: true, idle: THEME.muted, subLead: ok, subLeadColor: THEME.good, tip: { glyph: ok, label: displayName(id), text: text.tipModelEntry } })
      : menuEntry(elements, `effort-model-${index}`, THEME.surface2, { label: `${blank}${displayName(id)}`, isOpen: true, tip: { glyph: ok, label: displayName(id), text: text.tipModelEntry } }),
  )
  // The × closes the menu without a pick, as on a toast card; it shares the first entry's row.
  const close = menuEntry(elements, 'effort-model-close', THEME.surface3, { label: bare(look.glyph.close), isOpen: false, tip: { glyph: bare(look.glyph.close), label: text.labelClose, text: text.tipModelClose } })
  return (
    <Box key="effort-models-row" flexDirection="row" justifyContent="flex-end">
      <Box key="effort-models" flexDirection="column" alignItems="flex-start" paddingX={1} borderStyle="round" borderColor={THEME.accent} backgroundColor={THEME.surface1}>
        <Box key="effort-models-head" flexDirection="row" columnGap={1}>
          {entries[0] ?? null}
          {close}
        </Box>
        {entries.slice(1)}
        {menuEntry(elements, 'effort-model-all', THEME.surface2, { label: text.allModels, isOpen: false, subLead: bare(look.glyph.go), tip: { glyph: bare(look.glyph.go), label: text.allModels, text: text.tipAll } })}
      </Box>
    </Box>
  )
}

const toasts = new ToastList('effort')
// The animations setting, fixed per activation: off, every entry draws still.
let still = false

// A settings card's click: its row, saved through /config; a saved change reloads this mod.
async function saveSetting($: EngineInterface, key: string, value: ConfigValue) {
  const row = (await $.config.list()).find(each => each.key === key)
  if (!row) return
  const result = await $.config.set({ key: row.key, value })
  note = 'deny' in result && result.deny ? `${MARK.warn} ${result.deny}` : `${MARK.ok} ${fill(text.settingSaved, { label: row.label })}`
  $.ui.invalidate('ui.render')
}

export const register: Register = (on, options) => {
  still = options.animations === false
  toasts.isStill = still
  iconMode = (options.icons as IconMode | undefined) ?? 'auto'
  // A forced mode needs no detection; auto loads the saved answer, then checks the terminal font beside the hooks.
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
    await loadLook($)
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
    if (isTipMessage(e.data)) {
      const tip = e.data
      const own = Boolean(tip.id?.startsWith('effort-') || tip.id?.startsWith('toast-effort-'))
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
    if (clicked?.type === 'menu-entry' && clicked.id === 'effort-model-close') {
      isModelMenuOpen = false
      bandTip = null
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
      bandTip = null
      const current = (await $.state.get({ plugin: 'mod-model-effort', key: 'current' })).value
      menuModels = withModel(await $.store.get('models'), current?.model ?? (await $.session.model()))
      $.ui.invalidate('ui.render')
    }
    if (message?.type === 'set') await setEffort($, message.effort)

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    await loadLook($)
    if (e.surface !== 'terminal' || e.props.hasSurvey) return next(e)

    const { Box, Client, Text } = $.ui.resolve(e)
    const current = await $.state.get({ plugin: 'mod-model-effort', key: 'current' })
    const modelId = current.value?.model ?? (await $.session.model())
    const model = displayName(modelId)
    const { group, row, rest, tip } = splitRow(await next(e))
    const meter = <Client key="meter" module="./meter.tsx" height={1} props={{ effort: current.value?.effort ?? null, model, bg: PILL.secondary, still, nerd: look.nerd, compact: fitFor(e.props.bodyColumns).effortOnly, tipModel: { glyph: look.glyph.title, label: text.labelModel, text: text.tipModel }, tipRest: { glyph: look.glyph.title, label: text.paneName, text: text.tipRest }, tipLevels: LEVELS.map(level => ({ glyph: LEVEL_LOOK[level]!.glyph, label: text.paneName, text: fill(text.tipLevel, { level: (text.levelNames as Record<string, string>)[level]! }) })) }} />
    // The level word follows the pill, so it never moves the glyphs under the pointer.
    const shownWord = hoveredLevel() ?? flash
    const word = shownWord ? <Text key="menu-flash" color={LEVEL_LOOK[shownWord]?.color}>{(text.levelNames as Record<string, string>)[shownWord] ?? shownWord}</Text> : null

    const menu = isModelMenuOpen ? [modelMenu({ Box, Client, Text }, modelId)] : []
    return pillRow({ Box, Client, Text }, look.nerd, group, [...row, <Box key="menu-pill" flexDirection="row">{meter}</Box>, word], [...toastCards({ Box, Client, Text }, toasts, look, text.tipToast), ...rest, ...menu], bandTip?.id ? tipLine({ Box, Text }, tipText(bandTip)) : tip, e.props.bodyColumns)
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    await loadLook($)
    if (e.requestId !== PANE) return next(e)

    const { Box, Button, Client, Text } = $.ui.resolve(e)
    const rows = (await $.config.list()).filter(row => row.key.startsWith('mod-model-effort.'))

    return (
      <Box flexDirection="column" backgroundColor={THEME.bg} paddingX={1} minHeight={e.props.scroll.bodyRows}>
        {tabRow({ Box, Client, Text }, look.nerd, [{ id: 'mod-model-effort-settings-tab', label: `${text.paneName} ${MARK.sep} ${text.paneSettings}`, icon: look.glyph.gear, isOpen: true, tip: { glyph: look.glyph.gear, label: text.paneSettings, text: text.tipTab } }], still)}
        <Text wrap="truncate-end" color={statusColor(note)}>{withMark(look, note) || `${text.statusHint} ${MARK.sep} ${text.statusHintSaved}`}</Text>
        {settingsBody({ Box, Button, Client, Text }, look, { rows, actions: [], working: false, run: async () => {}, previews: undefined, still: still })}
        <Box key="footer-space" height={FOOTER_ROWS} />
        {paneFooter({ Box, Text }, paneTip, e.props.bodyColumns, e.props.scroll)}
      </Box>
    )
  })
}
