import type { ClientModule } from 'claude-code'

import style from './style'
import { CAPS, THEME } from './theme'

export type Chip = { kind: keyof typeof style.colors.kinds; mark: string; label: string; count: number; added: number; removed: number; isOpen: boolean }

export type ChipsProps = { id: string; chips: Chip[]; nerd: boolean }

export type ChipsMessage = { type: 'chip'; id: string; kind: Chip['kind'] }

const stat = (chip: Chip) => [chip.added ? `+${chip.added}` : '', chip.removed ? `−${chip.removed}` : ''].filter(Boolean).join(' ')

// Cells a chip takes: its two ends, mark, label, the count badge with its two ends, and the counts after it.
const widthOf = (chip: Chip) => 1 + [...chip.mark].length + 1 + chip.label.length + 1 + (2 + String(chip.count).length) + (stat(chip) ? 1 + stat(chip).length : 0) + 1

// The open turn's kinds as one line of pills; a click on one asks the hooks module to show its calls below.
const Chips: ClientModule<ChipsProps> = (props, surface) => {
  const { Box, Text } = surface.elements
  const { chips, nerd } = props
  // Without a Nerd Font the pill ends are plain spaces in the pill's color.
  const left = nerd ? CAPS.left : ' '
  const right = nerd ? CAPS.right : ' '

  surface.onPointer(event => {
    if (event.type !== 'down' || event.button !== 'left') return
    let x = 0
    for (const chip of chips) {
      const width = widthOf(chip)
      if (event.x >= x && event.x < x + width) {
        surface.post({ type: 'chip', id: props.id, kind: chip.kind } satisfies ChipsMessage)
        return
      }
      x += width + 1
    }
  })

  return (
    <Box flexDirection="row" columnGap={1}>
      {chips.map(chip => {
        const fill = chip.isOpen ? THEME.lifted : THEME.surface3
        const { hue, wash } = style.colors.kinds[chip.kind]
        const cap = (side: string, key: string, color: string) => nerd ? <Text key={key} color={color}>{side}</Text> : <Box key={key} backgroundColor={color}><Text> </Text></Box>
        return (
          <Box key={chip.kind} flexDirection="row" flexShrink={0}>
            {cap(left, `${chip.kind}-left`, fill)}
            <Box key={`${chip.kind}-body`} flexDirection="row" backgroundColor={fill}>
              <Text color={hue}>{`${chip.mark} `}</Text>
              <Text color={chip.isOpen ? THEME.onSurface : THEME.muted} bold={chip.isOpen}>{`${chip.label} `}</Text>
              {cap(left, `${chip.kind}-badge-left`, wash)}
              <Box key={`${chip.kind}-badge`} backgroundColor={wash}><Text color={hue} bold>{String(chip.count)}</Text></Box>
              {cap(right, `${chip.kind}-badge-right`, wash)}
              {stat(chip) ? (
                <Text key={`${chip.kind}-stat`}>
                  <Text color={THEME.good}>{chip.added ? ` +${chip.added}` : ''}</Text>
                  <Text color={THEME.alert}>{chip.removed ? ` −${chip.removed}` : ''}</Text>
                </Text>
              ) : null}
            </Box>
            {cap(right, `${chip.kind}-right`, fill)}
          </Box>
        )
      })}
    </Box>
  )
}

export default Chips
