import type { EngineInterface, Register } from 'claude-code'

import { displayName, LEVEL_LOOK, withEffort } from './levels'
import type { MeterMessage } from './meter'
import { MARK } from './theme'
import { PILL, pill, pillRow, splitRow } from './pills'

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


export const register: Register = on => {
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
    }

    return yield* next(effort === e.effort ? e : { ...e, effort: effort as typeof e.effort })
  })

  on('ui.message', async ($, e, next) => {
    const message = e.data as MeterMessage
    if (message?.type === 'set') await setEffort($, message.effort)

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.hasSurvey) return next(e)

    const { Box, Client, Text } = $.ui.resolve(e)
    const current = await $.state.get({ plugin: 'mod-effort', key: 'current' })
    const model = displayName(current.value?.model ?? (await $.session.model()))
    const { group, row, rest } = splitRow(await next(e))
    const meter = <Client key="meter" module="./meter.tsx" height={1} props={{ effort: current.value?.effort ?? null, model, bg: PILL.secondary }} />
    // The level word follows the pill, so it never moves the glyphs under the pointer.
    const word = flash ? <Text key="menu-flash" color={LEVEL_LOOK[flash]?.color}>{flash}</Text> : null

    return pillRow({ Box, Text }, nerd, group, [...row, pill({ Box, Text }, nerd, PILL.secondary, meter), word], rest)
  })
}
