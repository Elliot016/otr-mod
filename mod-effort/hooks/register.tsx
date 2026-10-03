import type { EngineInterface, Register, RenderElement } from 'claude-code'

import { displayName, LEVEL_LOOK, withEffort, withModel } from './levels'
import type { EntryMessage } from './entry'
import type { MeterMessage } from './meter'
import { MARK, THEME } from './theme'
import { PILL, pill, pillRow, splitRow, tipLine } from './pills'
import { TOAST_MS, ToastList, toastCards } from './toasts'

const homeOf = async ($: EngineInterface) => ((await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '').replace(/\\/g, '/')

let nerd = false
let flash: string | null = null
// The clicked level and the level before it; a saved level other than these means Alt+P or /effort took over.
let override: { effort: string; before: string } | null = null

// Only Windows Terminal says its font; anywhere else the pill stays plain.
async function hasNerdFont($: EngineInterface) {
  if (!(await $.env.get('WT_SESSION'))) return false
  const local = ((await $.env.get('LOCALAPPDATA')) ?? '').replace(/\\/g, '/')
  for (const path of [
    `${local}/Packages/Microsoft.WindowsTerminal_8wekyb3d8bbwe/LocalState/settings.json`,
    `${local}/Microsoft/Windows Terminal/settings.json`,
  ]) {
    const text = String(await $.fs.read(path).catch(() => ''))
    if (/"face"\s*:\s*"[^"]*(nerd|\bNFM?\b)/i.test(text)) return true
  }
  return false
}

// Saves the clicked level for the main model, as Alt+P does; the next request's effort shows whether it took.
async function setEffort($: EngineInterface, effort: string) {
  const current = (await $.state.get({ plugin: 'mod-effort', key: 'current' })).value
  if (!current) {
    $.ui.toast('mod-effort: send a message first, so the meter knows the model')
    return
  }
  const path = `${await homeOf($)}/.claude/settings.json`
  const text = String(await $.fs.read(path))
  const out = withEffort(text, current.model, effort)
  if (!out) {
    $.ui.toast(`mod-effort: ${MARK.warn} settings.json left untouched, it is not valid JSON`)
    return
  }
  await $.fs.write(`${path}.mod-effort.bak`, text)
  await $.fs.write(path, out)
  override = { effort, before: current.effort }
  await $.state.set({ plugin: 'mod-effort', key: 'current' }, { model: current.model, effort })
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
    $.ui.toast(`mod-effort: ${MARK.warn} Could not switch to ${displayName(id)}: ${String(error)}`)
    return
  }
  const current = (await $.state.get({ plugin: 'mod-effort', key: 'current' })).value
  await $.state.set({ plugin: 'mod-effort', key: 'current' }, { model: id, effort: current?.effort ?? 'medium' })
  await $.store.set('model', id)
  await $.store.set('models', withModel(await $.store.get('models'), id))
  $.ui.invalidate('ui.render')
}

// Claude Code's own picker has every model, new ones included.
async function openPicker($: EngineInterface) {
  isModelMenuOpen = false
  $.ui.invalidate('ui.render')
  await $.command.run({ command: 'model', args: '' }).catch(error => $.ui.toast(`mod-effort: ${MARK.warn} Could not open /model: ${String(error)}`))
}

type Elements = { Box: (props: any) => RenderElement; Client: (props: any) => RenderElement }

const menuEntry = ({ Box, Client }: Elements, id: string, label: string, isOpen: boolean) => (
  <Box key={`${id}-pad`}>
    <Client key={id} module="./entry.tsx" height={1} props={{ id, label, isOpen, bg: THEME.surface1 }} />
  </Box>
)

// The models used before, the current one marked, then the full picker; a card right-aligned over the pill.
const modelMenu = ({ Box, Client }: Elements, currentId: string) => (
  <Box key="effort-models-row" flexDirection="row" justifyContent="flex-end">
    <Box key="effort-models" flexDirection="column" paddingX={1} borderStyle="round" borderColor={THEME.accent} backgroundColor={THEME.surface1}>
      {menuModels.map((id, index) => menuEntry({ Box, Client }, `effort-model-${index}`, `${id === currentId ? MARK.ok : ' '} ${displayName(id)}`, id === currentId))}
      {menuEntry({ Box, Client }, 'effort-model-all', `${MARK.stage} All models…`, false)}
    </Box>
  </Box>
)

const toasts = new ToastList('effort')

export const register: Register = on => {
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
    nerd = await hasNerdFont($)
    // Before the first request, the last session's model and its saved level stand in.
    const model = await $.store.get('model')
    if (typeof model === 'string') {
      const settings = await $.settings.read()
      const effort = settings.modelSettings?.[model]?.effortLevel ?? settings.effortLevel
      if (typeof effort === 'string') await $.state.set({ plugin: 'mod-effort', key: 'current' }, { model, effort })
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
    const current = (await $.state.get({ plugin: 'mod-effort', key: 'current' })).value
    if (current?.model !== e.model || current?.effort !== effort) {
      await $.state.set({ plugin: 'mod-effort', key: 'current' }, { model: e.model, effort })
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
      const current = (await $.state.get({ plugin: 'mod-effort', key: 'current' })).value
      menuModels = withModel(await $.store.get('models'), current?.model ?? (await $.session.model()))
      $.ui.invalidate('ui.render')
    }
    if (message?.type === 'set') await setEffort($, message.effort)
    if (message?.type === 'menu-hover') {
      tipShown = message.isOver
      $.ui.invalidate('ui.render')
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.hasSurvey) return next(e)

    const { Box, Client, Text } = $.ui.resolve(e)
    const current = await $.state.get({ plugin: 'mod-effort', key: 'current' })
    const modelId = current.value?.model ?? (await $.session.model())
    const model = displayName(modelId)
    const { group, row, rest, tip } = splitRow(await next(e))
    const meter = <Client key="meter" module="./meter.tsx" height={1} props={{ effort: current.value?.effort ?? null, model, bg: PILL.secondary }} />
    // The level word follows the pill, so it never moves the glyphs under the pointer.
    const word = flash ? <Text key="menu-flash" color={LEVEL_LOOK[flash]?.color}>{flash}</Text> : null

    const level = current.value?.effort ?? null
    const hint = `Effort: ${model}${level ? ` at ${level}` : ''}. Click the name to change the model, a level to set it`
    const menu = isModelMenuOpen ? [modelMenu({ Box, Client }, modelId)] : []
    return pillRow({ Box, Text }, nerd, group, [...row, pill({ Box, Text }, nerd, PILL.secondary, meter), word], [...toastCards({ Box, Client, Text }, toasts), ...rest, ...menu], tipShown ? tipLine({ Box, Text }, hint) : tip)
  })
}
