// mod-transcript / hooks/dot.tsx, by v-amorim
// Draws a running command's dot, blinking between two colors until it finishes.
import type { ClientModule } from 'claude-code'

import { MARK } from './theme'

export type DotProps = { color: string; dim: string; still: boolean }

// How often a running command's dot swaps between its two colors.
const BLINK_MS = 500

// The running command's dot, blinking as Claude Code's own does; a still dot stays lit.
const Dot: ClientModule<DotProps, boolean> = (props, surface) => {
  const { Text } = surface.elements
  if (surface.state === undefined) {
    surface.setState(true)
    if (!props.still) surface.every(BLINK_MS, () => surface.setState(!surface.state))
  }
  return <Text color={surface.state === false ? props.dim : props.color}>{MARK.stopOpen}</Text>
}

export default Dot
