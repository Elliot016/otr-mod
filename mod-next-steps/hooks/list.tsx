import type { ClientModule } from 'claude-code'

import { THEME } from './theme'

export type ListProps = { rows: string[] }

export type ListMessage = { type: 'select'; index: number }

// One muted line per suggestion; the row under the pointer lights up and a click on it asks to fill the prompt.
const StepList: ClientModule<ListProps, number> = (props, surface) => {
  const { Box, Text } = surface.elements
  const { rows } = props
  // A Client takes no hover prop, so it tracks the row under the pointer itself.
  const hovered = surface.state ?? -1

  surface.onPointer(event => {
    const row = event.type !== 'leave' && event.y >= 0 && event.y < rows.length ? event.y : -1
    if (row !== hovered) surface.setState(row)
    if (event.type === 'down' && event.button === 'left' && row >= 0) surface.post({ type: 'select', index: row } satisfies ListMessage)
  })

  return (
    <Box flexDirection="column">
      {rows.map((row, at) => (
        <Box key={`row-${at}`} flexDirection="row" columnGap={1}>
          <Text color={THEME.border}>│</Text>
          <Text color={at === hovered ? THEME.accent : THEME.muted} wrap="truncate-end">{row}</Text>
        </Box>
      ))}
    </Box>
  )
}

export default StepList
