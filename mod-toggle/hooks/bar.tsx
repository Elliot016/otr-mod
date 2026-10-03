import type { ClientModule } from 'claude-code'

export type BarProps = { kind: 'turns' | 'tools'; id: string }

export type BarMessage = { type: 'fold' } & BarProps

// The card's left strip, laid over its colored bar: a click anywhere on it folds what the strip runs beside.
const Bar: ClientModule<BarProps> = (props, surface) => {
  const { Box } = surface.elements

  surface.onPointer(event => {
    if (event.type === 'down' && event.button === 'left') surface.post({ type: 'fold', ...props } satisfies BarMessage)
  })

  return <Box width={1} height="100%" />
}

export default Bar
