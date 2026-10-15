// mod-prompts / hooks/timeline.tsx, by v-amorim
// Draws the timeline rail of prompt stops with dots, times and click handling.
import type { ClientModule, ClientSurface } from 'claude-code'

import { HOVER_STEPS, HOVER_TICK_MS, postTip, stepToward } from './entry'
import { mix, THEME } from './theme'

// time is the clock time the prompt was sent, empty when the transcript has none; index is its place in the whole list; label and tip fill the pane footer.
export type Stop = { index: number; time: string; text: string; label: string; tip: string }

// railFirst: the stops follow the open prompt's details, so a rail line comes before each one instead of after.
export type TimelineProps = { stops: Stop[]; selected: number; railFirst: boolean; glyph: string; dot: string; openDot: string; rail: string; still: boolean }

export type TimelineMessage = { type: 'select'; index: number }

// Cells before the dot: the clock time and a space, or the same width blank.
export const GUTTER = 6

// The rows a run of stops takes: each stop, and a rail line between it and the next.
export const timelineRows = (count: number, railFirst: boolean) => (railFirst ? count * 2 : Math.max(0, count * 2 - 1))

// at: the stop under the pointer; fading: the stop it just left, and level: how much of its light is left.
type State = { at: number; fading: number; level: number }

const fades = new WeakMap<object, () => void>()

// A stop the pointer left dims over HOVER_STEPS ticks instead of switching off.
const startFade = (surface: ClientSurface<State>) => {
  if (fades.has(surface)) return
  const stop = surface.every(HOVER_TICK_MS, () => {
    const state = surface.state
    if (!state || state.fading < 0) return
    const level = stepToward(state.level, false)
    surface.setState(level === 0 ? { ...state, fading: -1, level: 0 } : { ...state, level })
    if (level === 0) {
      stop()
      fades.delete(surface)
    }
  })
  fades.set(surface, stop)
}

// Prompts as stops on a rail: time, a dot, the text. A click opens one; the stop under the pointer lifts and turns accent.
const Timeline: ClientModule<TimelineProps, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  const { stops, selected, railFirst, glyph, dot, openDot, rail, still } = props
  const state = surface.state ?? { at: -1, fading: -1, level: 0 }
  const hovered = state.at
  // Stops sit on even rows (odd when the rail comes first); the rest are rail lines.
  const at = (y: number) => (railFirst ? (y % 2 === 1 ? stops[(y - 1) / 2] : undefined) : y % 2 === 0 ? stops[y / 2] : undefined)

  surface.onPointer(event => {
    const stop = event.type === 'leave' ? undefined : at(event.y)
    const index = stop?.index ?? -1
    const isClick = event.type === 'down' && event.button === 'left' && index >= 0
    if (index !== hovered) {
      const isDimming = hovered >= 0 && !still
      surface.setState({ at: index, fading: isDimming ? hovered : -1, level: isDimming ? HOVER_STEPS : 0 })
      if (isDimming) startFade(surface)
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
        const lit = stop.index === hovered ? HOVER_STEPS : stop.index === state.fading ? state.level : 0
        const on = mix(THEME.surface1, THEME.lifted, lit / HOVER_STEPS)
        const line = (
          <Box key={`stop-${stop.index}`} flexDirection="row" backgroundColor={on}>
            <Text color={THEME.muted}>{(stop.time || '').padEnd(GUTTER)}</Text>
            <Text color={isOpen ? THEME.accent : THEME.border}>{isOpen ? openDot : dot}</Text>
            <Text color={isOpen ? THEME.accent : mix(THEME.onSurface, THEME.accent, lit / HOVER_STEPS)} bold={isOpen}>{` ${stop.text}`}</Text>
          </Box>
        )
        if (railFirst) return [railLine(`rail-${stop.index}`), line]
        return n < stops.length - 1 ? [line, railLine(`rail-${stop.index}`)] : [line]
      })}
    </Box>
  )
}

export default Timeline
