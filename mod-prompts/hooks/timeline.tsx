// mod-prompts / hooks/timeline.tsx, by v-amorim
// Draws the timeline rail of prompt stops with dots, times and click handling.
import type { ClientModule } from 'claude-code'

import { postTip } from './entry'
import { THEME } from './theme'

// time is the clock time the prompt was sent, empty when the transcript has none; index is its place in the whole list; label and tip fill the pane footer.
export type Stop = { index: number; time: string; text: string; label: string; tip: string }

// railFirst: the stops follow the open prompt's details, so a rail line comes before each one instead of after.
export type TimelineProps = { stops: Stop[]; selected: number; railFirst: boolean; glyph: string; dot: string; openDot: string; rail: string }

export type TimelineMessage = { type: 'select'; index: number }

// Cells before the dot: the clock time and a space, or the same width blank.
export const GUTTER = 6

// The rows a run of stops takes: each stop, and a rail line between it and the next.
export const timelineRows = (count: number, railFirst: boolean) => (railFirst ? count * 2 : Math.max(0, count * 2 - 1))

// Prompts as stops on a rail: time, a dot, the text. A click opens one; the stop under the pointer lights up.
const Timeline: ClientModule<TimelineProps, number> = (props, surface) => {
  const { Box, Text } = surface.elements
  const { stops, selected, railFirst, glyph, dot, openDot, rail } = props
  const hovered = surface.state ?? -1
  // Stops sit on even rows (odd when the rail comes first); the rest are rail lines.
  const at = (y: number) => (railFirst ? (y % 2 === 1 ? stops[(y - 1) / 2] : undefined) : y % 2 === 0 ? stops[y / 2] : undefined)

  surface.onPointer(event => {
    const stop = event.type === 'leave' ? undefined : at(event.y)
    const index = stop?.index ?? -1
    const isClick = event.type === 'down' && event.button === 'left' && index >= 0
    if (index !== hovered) {
      surface.setState(index)
      if (!isClick) postTip(surface, 'stop', stop ? { glyph, label: stop.label, text: stop.tip } : null)
    }
    if (isClick) surface.post({ type: 'select', index } satisfies TimelineMessage)
  })

  const railLine = (key: string) => (
    <Box key={key} flexDirection="row">
      <Text>{' '.repeat(GUTTER)}</Text>
      <Text color={THEME.border}>{rail}</Text>
    </Box>
  )

  return (
    <Box flexDirection="column">
      {stops.flatMap((stop, n) => {
        const isOpen = stop.index === selected
        const isLit = stop.index === hovered
        const line = (
          <Box key={`stop-${stop.index}`} flexDirection="row">
            <Text color={THEME.muted}>{(stop.time || '').padEnd(GUTTER)}</Text>
            <Text color={isOpen ? THEME.accent : THEME.border}>{isOpen ? openDot : dot}</Text>
            <Text color={isOpen ? THEME.onSurface : isLit ? THEME.accent : THEME.secondary} bold={isOpen}>{` ${stop.text}`}</Text>
          </Box>
        )
        if (railFirst) return [railLine(`rail-${stop.index}`), line]
        return n < stops.length - 1 ? [line, railLine(`rail-${stop.index}`)] : [line]
      })}
    </Box>
  )
}

export default Timeline
