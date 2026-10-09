// mod-transcript / hooks/fold.tsx, by v-amorim
// Draws the fold pill that lightens under the pointer and folds on click.
import type { ClientModule } from 'claude-code'

import type { BarMessage, BarProps } from './bar'
import { HOVER_STEPS, HOVER_TICK_MS, hoverMix, mix, postTip, stepToward } from './entry'
import text from './text'
import { CAPS, THEME } from './theme'

// color: the pill's fill at rest; the whole pill, ends included, lightens under the pointer.
export type FoldProps = BarProps & { color: string; isOpen: boolean; nerd: boolean; still: boolean }

type State = { isOver: boolean; at: number; level: number }

// A pointer that left without a leave event stops lighting the pill after this long.
const QUIET_MS = 5000

const latest = new WeakMap<object, FoldProps>()

// The + / − fold chip: a Button would invert only its own cell under the pointer, never the caps.
const Fold: ClientModule<FoldProps, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  latest.set(surface, props)

  if (!surface.state) {
    surface.setState({ isOver: false, at: 0, level: 0 })
    surface.every(HOVER_TICK_MS, () => {
      const state = surface.state
      if (!state) return
      if (state.level !== (state.isOver ? HOVER_STEPS : 0)) surface.setState({ ...state, level: stepToward(state.level, state.isOver) })
      else if (state.isOver && Date.now() - state.at >= QUIET_MS) surface.setState({ ...state, isOver: false })
    })
  }

  surface.onPointer(event => {
    const over = event.type !== 'leave'
    const base = surface.state ?? { isOver: false, at: 0, level: 0 }
    const level = over === base.isOver ? base.level : latest.get(surface)?.still ? (over ? HOVER_STEPS : 0) : over ? HOVER_STEPS : base.level
    surface.setState({ isOver: over, at: Date.now(), level })
    if (event.type === 'down' && event.button === 'left') surface.post({ type: 'fold', kind: props.kind, id: props.id } satisfies BarMessage)
    else if (over !== base.isOver) postTip(surface, `fold-${props.id}`, over ? { glyph: '', label: text.tipLabel[props.kind], text: text.tipFold[props.kind] } : null)
  })

  const fill = hoverMix(props.color, mix(props.color, THEME.onSurface, 0.35), surface.state?.level ?? 0)
  const mark = props.isOpen ? '−' : '+'
  return (
    <Box flexDirection="row">
      {props.nerd ? <Text color={fill}>{CAPS.left}</Text> : null}
      <Text color={THEME.onSurface} backgroundColor={fill}>{props.nerd ? mark : ` ${mark} `}</Text>
      {props.nerd ? <Text color={fill}>{CAPS.right}</Text> : null}
    </Box>
  )
}

export default Fold
