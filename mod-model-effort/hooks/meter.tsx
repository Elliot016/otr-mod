import type { ClientModule } from 'claude-code'

import { HOVER_STEPS, hoverMix, stepToward, TICK_MS } from './entry'
import { LEVEL_LOOK, LEVELS } from './levels'
import style from './style'
import { THEME } from './theme'

// still: the animations setting is off, so the level icons switch at once.
export type MeterProps = { effort: string | null; model: string; bg: string; still?: boolean }

export type MeterMessage = { type: 'set'; effort: string } | { type: 'menu-hover'; id: string; isOver: boolean; level?: string } | { type: 'model-menu' }

// The inside of the Moonlight-claude oh-my-posh model pill; the caps come from pills.tsx.
const PILL_FG = style.colors.pills.readout

// A dialog opening under the pointer can swallow the leave event, so a hover with no pointer event for this long ends on its own.
const HOVER_QUIET_MS = 5000

// lights: each glyph's fade from dark (0) to its level color (HOVER_STEPS).
type Hover = { level: number; at: number; lights?: number[] }

const litOf = (props: MeterProps, level: number) => (level >= 0 ? level : props.effort ? LEVELS.indexOf(props.effort as (typeof LEVELS)[number]) : -1)

const targets = (lit: number) => LEVELS.map((_, index) => (index <= lit ? HOVER_STEPS : 0))

// The ticker reads the latest props from here, since its closure keeps the first ones.
const latest = new WeakMap<object, MeterProps>()

// Mouse-only slider: a level glyph and the space after it set that level.
const Meter: ClientModule<MeterProps, Hover> = (props, surface) => {
  const { Box, Text } = surface.elements
  const reached = props.effort ? LEVELS.indexOf(props.effort as (typeof LEVELS)[number]) : -1
  const head = ` ${props.model} `
  const start = head.length

  // The level under the pointer previews what a click would set: -1 on the model name, -2 off the pill.
  const hovered = surface.state?.level ?? -2
  latest.set(surface, props)
  if (!surface.state) {
    surface.setState({ level: -2, at: 0, lights: targets(reached) })
    // Redraws only while a glyph fades or a stale hover needs ending.
    surface.every(TICK_MS, () => {
      const state = surface.state
      const now = latest.get(surface)
      if (!state || !now) return
      const goal = targets(litOf(now, state.level))
      const lights = state.lights ?? goal
      if (lights.some((light, index) => light !== goal[index])) {
        surface.setState({ ...state, lights: now.still ? goal : lights.map((light, index) => stepToward(light, goal[index]! > 0)) })
        return
      }
      if (state.level === -2 || Date.now() - state.at < HOVER_QUIET_MS) return
      surface.setState({ ...state, level: -2, at: Date.now() })
      surface.post({ type: 'menu-hover', id: 'effort', isOver: false } satisfies MeterMessage)
    })
  }
  // At rest the pill shows only the current level; the pointer on it opens every level.
  const isExpanded = hovered !== -2
  surface.onPointer(event => {
    const slot = event.x - start
    // While folded the slots are not where they will be, so the first event only opens the meter.
    const level = event.type === 'leave' ? -2 : isExpanded && slot >= 0 && slot < LEVELS.length * 2 ? Math.floor(slot / 2) : -1
    // The tip above the row shows while the pointer is on the pill; the level under it names itself beside the pill.
    if (level !== hovered) surface.post({ type: 'menu-hover', id: 'effort', isOver: level !== -2, level: LEVELS[level] } satisfies MeterMessage)
    const lights = surface.state?.lights ?? targets(reached)
    // The first fade step lands with the pointer, so the meter answers at once.
    const stepped = targets(litOf(props, level)).map((goal, index) => stepToward(lights[index] ?? 0, goal > 0))
    surface.setState({ ...surface.state, level, at: Date.now(), lights: props.still ? targets(litOf(props, level)) : level !== hovered ? stepped : lights })
    if (event.type === 'down' && event.button === 'left' && level >= 0) surface.post({ type: 'set', effort: LEVELS[level]! } satisfies MeterMessage)
    // The model name opens the model menu.
    if (event.type === 'down' && event.button === 'left' && slot < 0) surface.post({ type: 'model-menu' } satisfies MeterMessage)
  })
  const lights = surface.state?.lights ?? targets(litOf(props, hovered))

  return (
    <Box flexDirection="row">
      <Text key="head" color={PILL_FG} backgroundColor={props.bg}>{head}</Text>
      {LEVELS.map((level, index) =>
        isExpanded || index === Math.max(reached, 0) ? (
          <Text key={level} color={hoverMix(THEME.border, LEVEL_LOOK[level]!.color, lights[index] ?? 0)} bold={index === hovered} backgroundColor={props.bg}>
            {`${LEVEL_LOOK[level]!.glyph} `}
          </Text>
        ) : null,
      )}
    </Box>
  )
}

export default Meter
