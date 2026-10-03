import type { ClientModule } from 'claude-code'

import { THEME } from './theme'

export type Row = { number: string; text: string }

export type ListProps = { rows: Row[]; selected: number }

export type ListMessage = { type: 'select'; index: number }

// The text of each prompt row; a click anywhere on it selects, and the row under the pointer lights up. The [↵] jump sits in the pane's action column.
const PromptList: ClientModule<ListProps, number> = (props, surface) => {
  const { Box, Text } = surface.elements
  const { rows, selected } = props

  // A Client takes no hover prop, so it tracks the row under the pointer itself.
  const hovered = surface.state ?? -1

  surface.onPointer(event => {
    const row = event.type !== 'leave' && event.y >= 0 && event.y < rows.length ? event.y : -1
    if (row !== hovered) surface.setState(row)
    if (event.type === 'down' && event.button === 'left' && row >= 0) surface.post({ type: 'select', index: row } satisfies ListMessage)
  })

  return (
    <Box flexDirection="column">
      {rows.map((row, index) => {
        const isSelected = index === selected
        return (
          <Box key={`row-${index}`} flexDirection="row" columnGap={1}>
            <Text color={THEME.muted}>{row.number}</Text>
            <Text color={isSelected || index === hovered ? THEME.accent : THEME.onSurface} bold={isSelected}>{row.text}</Text>
          </Box>
        )
      })}
    </Box>
  )
}

export default PromptList
