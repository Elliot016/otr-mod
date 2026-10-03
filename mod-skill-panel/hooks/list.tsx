import type { ClientModule } from 'claude-code'

import { MARK, THEME } from './theme'

export type Line =
  | { kind: 'header'; tag: string; count: number; hex: string }
  | { kind: 'skill'; index: number; name: string; hex: string; icon: string }

export type ListProps = { lines: Line[]; selected: number }

export type ListMessage = { type: 'select'; index: number }

// The text of each row; a click anywhere on a skill selects it. The [↵] action sits in the pane's action column.
const SkillList: ClientModule<ListProps> = (props, surface) => {
  const { Box, Text } = surface.elements
  const { lines, selected } = props

  surface.onPointer(event => {
    if (event.type !== 'down' || event.button !== 'left') return
    const line = lines[event.y]
    if (line?.kind !== 'skill') return
    surface.post({ type: 'select', index: line.index } satisfies ListMessage)
  })

  return (
    <Box flexDirection="column">
      {lines.map((line, row) => {
        if (line.kind === 'header') {
          return (
            <Box key={`line-${row}`} flexDirection="row" columnGap={1}>
              <Text color={line.hex} bold>{line.tag}</Text>
              <Text color={THEME.muted}>{`${MARK.sep} ${line.count}`}</Text>
            </Box>
          )
        }
        const isSelected = line.index === selected
        return (
          <Box key={`line-${row}`} flexDirection="row" columnGap={1}>
            <Text backgroundColor={line.hex} color={THEME.bg}>{` ${line.icon} `}</Text>
            <Text color={isSelected ? THEME.accent : THEME.onSurface} bold={isSelected}>{`/${line.name}`}</Text>
          </Box>
        )
      })}
    </Box>
  )
}

export default SkillList
