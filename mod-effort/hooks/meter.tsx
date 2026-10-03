import type { ClientModule } from 'claude-code'

import { LEVEL_LOOK, LEVELS } from './levels'
import { THEME } from './theme'

export type MeterProps = { effort: string | null; model: string; bg: string }

export type MeterMessage = { type: 'set'; effort: string }

// The inside of the Moonlight-claude oh-my-posh model pill; the caps come from pills.tsx.
const PILL_FG = '#7E86A4'

// Mouse-only slider: a level glyph and the space after it set that level.
const Meter: ClientModule<MeterProps> = (props, surface) => {
  const { Box, Text } = surface.elements
  const reached = props.effort ? LEVELS.indexOf(props.effort as (typeof LEVELS)[number]) : -1
  const head = ` ${props.model} `
  const start = head.length

  surface.onPointer(event => {
    if (event.type !== 'down' || event.button !== 'left') return
    const slot = event.x - start
    if (slot < 0 || slot >= LEVELS.length * 2) return
    surface.post({ type: 'set', effort: LEVELS[Math.floor(slot / 2)]! } satisfies MeterMessage)
  })

  return (
    <Box flexDirection="row">
      <Text key="head" color={PILL_FG} backgroundColor={props.bg}>{head}</Text>
      {LEVELS.map((level, index) => (
        <Text key={level} color={index <= reached ? LEVEL_LOOK[level]!.color : THEME.border} backgroundColor={props.bg}>
          {`${LEVEL_LOOK[level]!.glyph} `}
        </Text>
      ))}
    </Box>
  )
}

export default Meter
