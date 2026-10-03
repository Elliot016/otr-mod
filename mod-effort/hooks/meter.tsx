import type { ClientModule } from 'claude-code'

import { LEVEL_LOOK, LEVELS } from './levels'
import { THEME } from './theme'

export type MeterProps = { effort: string | null; model: string; bg: string }

export type MeterMessage = { type: 'set'; effort: string } | { type: 'menu-hover'; id: string; isOver: boolean } | { type: 'model-menu' }

// The inside of the Moonlight-claude oh-my-posh model pill; the caps come from pills.tsx.
const PILL_FG = '#7E86A4'

// A dialog opening under the pointer can swallow the leave event, so a hover with no pointer event for this long ends on its own.
const HOVER_QUIET_MS = 5000

type Hover = { level: number; at: number }

// Mouse-only slider: a level glyph and the space after it set that level.
const Meter: ClientModule<MeterProps, Hover> = (props, surface) => {
  const { Box, Text } = surface.elements
  const reached = props.effort ? LEVELS.indexOf(props.effort as (typeof LEVELS)[number]) : -1
  const head = ` ${props.model} `
  const start = head.length

  // The level under the pointer previews what a click would set: -1 on the model name, -2 off the pill.
  const hovered = surface.state?.level ?? -2
  if (!surface.state) {
    surface.setState({ level: -2, at: 0 })
    surface.every(1000, () => {
      if (surface.state?.level === -2 || Date.now() - (surface.state?.at ?? 0) < HOVER_QUIET_MS) return
      surface.setState({ level: -2, at: Date.now() })
      surface.post({ type: 'menu-hover', id: 'effort', isOver: false } satisfies MeterMessage)
    })
  }
  // At rest the pill shows only the current level; the pointer on it opens every level.
  const isExpanded = hovered !== -2
  surface.onPointer(event => {
    const slot = event.x - start
    // While folded the slots are not where they will be, so the first event only opens the meter.
    const level = event.type === 'leave' ? -2 : isExpanded && slot >= 0 && slot < LEVELS.length * 2 ? Math.floor(slot / 2) : -1
    // The tip above the row shows while the pointer is anywhere on the pill.
    if ((level === -2) !== (hovered === -2)) surface.post({ type: 'menu-hover', id: 'effort', isOver: level !== -2 } satisfies MeterMessage)
    surface.setState({ level, at: Date.now() })
    if (event.type === 'down' && event.button === 'left' && level >= 0) surface.post({ type: 'set', effort: LEVELS[level]! } satisfies MeterMessage)
    // The model name opens the model menu.
    if (event.type === 'down' && event.button === 'left' && slot < 0) surface.post({ type: 'model-menu' } satisfies MeterMessage)
  })
  const lit = hovered >= 0 ? hovered : reached

  return (
    <Box flexDirection="row">
      <Text key="head" color={PILL_FG} backgroundColor={props.bg}>{head}</Text>
      {LEVELS.map((level, index) =>
        isExpanded || index === Math.max(reached, 0) ? (
          <Text key={level} color={index <= lit ? LEVEL_LOOK[level]!.color : THEME.border} bold={index === hovered} backgroundColor={props.bg}>
            {`${LEVEL_LOOK[level]!.glyph} `}
          </Text>
        ) : null,
      )}
    </Box>
  )
}

export default Meter
