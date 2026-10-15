// mod-manager / hooks/cost.tsx, by v-amorim
// The cost pill that marks a mod with a cost, drawn the same in the list and on the mod's page.
import type { RenderElement } from 'claude-code'

import { CAPS, mix, THEME, WASH } from './theme'

type Elements = { Box: (props: any) => RenderElement; Text: (props: any) => RenderElement }

// Cells a pill takes: its two ends and the glyph, on Nerd and safe alike.
export const COST_CELLS = 3

// The glyph in ok on a fill washed from ok into `on`, the row or card it sits on; caps on Nerd, a space each side on safe.
export function costPill({ Box, Text }: Elements, nerd: boolean, glyph: string, on: string, key: string) {
  const bg = mix(THEME.ok, on, WASH)
  return (
    <Box key={key} flexDirection="row" flexShrink={0}>
      {nerd ? <Text key={`${key}-left`} color={bg} backgroundColor={on}>{CAPS.left}</Text> : null}
      <Text key={`${key}-body`} color={THEME.ok} backgroundColor={bg} bold>{nerd ? glyph : ` ${glyph} `}</Text>
      {nerd ? <Text key={`${key}-right`} color={bg} backgroundColor={on}>{CAPS.right}</Text> : null}
    </Box>
  )
}
