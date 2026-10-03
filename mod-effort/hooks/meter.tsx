import type { ClientModule } from 'claude-code'

import { LEVEL_LOOK, LEVELS } from './levels'
import { THEME } from './theme'

export type MeterProps = { effort: string | null; model: string; bg: string }

export type MeterMessage = { type: 'set'; effort: string } | { type: 'menu-hover'; id: string; isOver: boolean }

// The inside of the Moonlight-claude oh-my-posh model pill; the caps come from pills.tsx.
const PILL_FG = '#7E86A4'

// Mouse-only slider: a level glyph and the space after it set that level.
const Meter: ClientModule<MeterProps, number> = (props, surface) => {
  const { Box, Text } = surface.elements
  const reached = props.effort ? LEVELS.indexOf(props.effort as (typeof LEVELS)[number]) : -1
  const head = ` ${props.model} `
  const start = head.length

  // The level under the pointer previews what a click would set: -1 on the model name, -2 off the pill.
  const hovered = surface.state ?? -2
  surface.onPointer(event => {
    const slot = event.x - start
    const level = event.type === 'leave' ? -2 : slot >= 0 && slot < LEVELS.length * 2 ? Math.floor(slot / 2) : -1
    if (level !== hovered) {
      surface.setState(level)
      // The tip above the row shows while the pointer is anywhere on the pill.
      if ((level === -2) !== (hovered === -2)) surface.post({ type: 'menu-hover', id: 'effort', isOver: level !== -2 } satisfies MeterMessage)
    }
    if (event.type === 'down' && event.button === 'left' && level >= 0) surface.post({ type: 'set', effort: LEVELS[level]! } satisfies MeterMessage)
  })
  const lit = hovered >= 0 ? hovered : reached

  return (
    <Box flexDirection="row">
      <Text key="head" color={PILL_FG} backgroundColor={props.bg}>{head}</Text>
      {LEVELS.map((level, index) => (
        <Text key={level} color={index <= lit ? LEVEL_LOOK[level]!.color : THEME.border} bold={index === hovered} backgroundColor={props.bg}>
          {`${LEVEL_LOOK[level]!.glyph} `}
        </Text>
      ))}
    </Box>
  )
}

export default Meter
