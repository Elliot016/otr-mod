// mod-transcript / hooks/bar.tsx, by v-amorim
// Draws a card's left strip that folds its turn or tools on click.
import type { ClientModule } from 'claude-code'

import { postTip } from './entry'
import text from './text'

export type BarProps = { kind: 'turns' | 'tools'; id: string }

export type BarMessage = { type: 'fold' } & BarProps

// Per instance, so a tip posts only when hover changes.
const isTipped = new WeakMap<object, boolean>()

const Bar: ClientModule<BarProps> = (props, surface) => {
  const { Box } = surface.elements

  surface.onPointer(event => {
    if (event.type === 'down' && event.button === 'left') {
      surface.post({ type: 'fold', ...props } satisfies BarMessage)
      return
    }
    const over = event.type !== 'leave'
    if (over === (isTipped.get(surface) ?? false)) return
    isTipped.set(surface, over)
    postTip(surface, `bar-${props.id}`, over ? { glyph: '', label: text.tipLabel[props.kind], text: text.tipBar[props.kind] } : null)
  })

  return <Box width={1} height="100%" />
}

export default Bar
