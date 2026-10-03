import type { ClientModule } from 'claude-code'

import { THEME } from './theme'

export type Row = { number: string; text: string }

export type ListProps = { rows: Row[]; selected: number }

export type ListMessage = { type: 'select'; index: number }

// The text of each prompt row; a click anywhere on it selects. The [↵] jump sits in the pane's action column.
const PromptList: ClientModule<ListProps> = (props, surface) => {
  const { Box, Text } = surface.elements
  const { rows, selected } = props

  surface.onPointer(event => {
    if (event.type !== 'down' || event.button !== 'left' || event.y < 0 || event.y >= rows.length) return
    surface.post({ type: 'select', index: event.y } satisfies ListMessage)
  })

  return (
    <Box flexDirection="column">
      {rows.map((row, index) => {
        const isSelected = index === selected
        return (
          <Box key={`row-${index}`} flexDirection="row" columnGap={1}>
            <Text color={THEME.muted}>{row.number}</Text>
            <Text color={isSelected ? THEME.accent : THEME.onSurface} bold={isSelected}>{row.text}</Text>
          </Box>
        )
      })}
    </Box>
  )
}

export default PromptList
