// mod-transcript / hooks/number.tsx, by v-amorim
// Draws the prompt number pill and measures its width in cells.
import type { ClientModule } from 'claude-code'

import { postTip } from './entry'
import text from './text'
import { CAPS, fill, mix, THEME, WASH } from './theme'

export type NumberProps = { id: string; n: number; nerd: boolean }

// The pill's cells: both ends (a space each without caps) around `#N`.
export const pillWidth = (n: number) => fill(text.promptNumber, { n }).length + 2

const isTipped = new WeakMap<object, boolean>()

// The prompt's number outside its bubble, in the turn pill's look; the pointer over it shows its tip.
const PromptNumber: ClientModule<NumberProps> = (props, surface) => {
  const { Box, Text } = surface.elements

  surface.onPointer(event => {
    const over = event.type !== 'leave'
    if (over === (isTipped.get(surface) ?? false)) return
    isTipped.set(surface, over)
    postTip(surface, `prompt-${props.id}`, over ? { glyph: '', label: fill(text.tipPromptLabel, { n: props.n }), text: fill(text.tipPrompt, { n: props.n }) } : null)
  })

  const wash = mix(THEME.accent, THEME.bg, WASH)
  const label = fill(text.promptNumber, { n: props.n })
  return (
    <Box flexDirection="row" paddingTop={1}>
      {props.nerd ? <Text color={wash} backgroundColor={THEME.bg}>{CAPS.left}</Text> : null}
      <Text color={THEME.accent} backgroundColor={wash} bold>{props.nerd ? label : ` ${label} `}</Text>
      {props.nerd ? <Text color={wash} backgroundColor={THEME.bg}>{CAPS.right}</Text> : null}
    </Box>
  )
}

export default PromptNumber
