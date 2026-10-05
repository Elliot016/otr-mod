// Shared pill entry, see mod-builder/references/standard.md. Master in mod-menu; copy unchanged into every mod that draws a menu entry.
import type { ClientModule } from 'claude-code'

import style from './style'
import { THEME } from './theme'

// color: open text (a red Run); idle: closed text, muted unless set; isBusy shimmers the label until the click's result lands.
// still: the mod's animations setting is off, so nothing shimmers and the hover color switches at once.
export type EntryProps = { id: string; label: string; isOpen: boolean; bg: string; color?: string; idle?: string; isBusy?: boolean; still?: boolean }

// menu-hover tells the owning mod the pointer arrived or left, so it can show its tip under the row.
export type EntryMessage = { type: 'menu-entry'; id: string } | { type: 'menu-hover'; id: string; isOver: boolean }

// A dialog opening under the pointer can swallow the leave event, so a hover with no pointer event for this long ends on its own.
const HOVER_QUIET_MS = 5000

export const TICK_MS = 140

// Like Claude Code's "Thinking…": a soft band sweeps the dim text, its edge halfway between secondary and muted.
const BAND = style.colors.shimmer
const SWEEP_PAUSE = 8

export const shimmerColor = (at: number, phase: number, length: number) => {
  const period = length + BAND.length * 2 + SWEEP_PAUSE
  const head = (phase % period) - BAND.length
  return BAND[Math.abs(at - head)] ?? THEME.muted
}

// Hover colors ease in and out over this many ticks instead of switching at once.
export const HOVER_STEPS = 2

const channels = (hex: string) => [1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16))
const isHex = (color: string) => /^#[0-9a-f]{6}$/i.test(color)

// The color `t` of the way from `from` to `to`; a color that is not #RRGGBB switches halfway.
export function mix(from: string, to: string, t: number) {
  if (t <= 0) return from
  if (t >= 1) return to
  if (!isHex(from) || !isHex(to)) return t < 0.5 ? from : to
  const end = channels(to)
  return `#${channels(from).map((value, at) => Math.round(value + (end[at]! - value) * t).toString(16).padStart(2, '0')).join('')}`
}

// One tick of a hover fade: toward HOVER_STEPS while the pointer is on, toward 0 once it left.
export const stepToward = (level: number, isOver: boolean) => (isOver ? Math.min(HOVER_STEPS, level + 1) : Math.max(0, level - 1))

// Even steps: an eased last step barely moves the color, so the fade seemed to hang at its end.
export const hoverMix = (from: string, to: string, level: number) => mix(from, to, level / HOVER_STEPS)

// A click shimmers the entry until the mod answers with new props, or this long at most.
const PRESS_MS = 1200

// pressed: the props a click saw and when it came, cleared once the mod answers.
type State = { isOver: boolean; at: number; phase: number; level?: number; pressed?: { props: string; at: number } }

const isPressed = (state: State | undefined, props: EntryProps | undefined) =>
  Boolean(state?.pressed && Date.now() - state.pressed.at < PRESS_MS && state.pressed.props === JSON.stringify(props))

// The ticker starts once per instance and reads the latest props from here, since its closure keeps the first ones.
const latest = new WeakMap<object, EntryProps>()

// A Button inverts under the pointer, so the entry is plain text that lights up like a sidebar row.
const Entry: ClientModule<EntryProps, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  const hovered = surface.state?.isOver === true
  latest.set(surface, props)

  if (!surface.state) {
    surface.setState({ isOver: false, at: 0, phase: 0 })
    // Redraws only while busy, fading or ending a stale hover; an idle entry's tick changes nothing.
    surface.every(TICK_MS, () => {
      const state = surface.state
      if (!state) return
      const now = latest.get(surface)
      if (!now?.still && (now?.isBusy || isPressed(state, now))) surface.setState({ ...state, phase: state.phase + 1 })
      else if (state.pressed) surface.setState({ ...state, pressed: undefined })
      else if ((state.level ?? 0) !== (state.isOver ? HOVER_STEPS : 0)) surface.setState({ ...state, level: stepToward(state.level ?? 0, state.isOver) })
      else if (state.isOver && Date.now() - state.at >= HOVER_QUIET_MS) {
        surface.setState({ ...state, isOver: false, at: Date.now() })
        surface.post({ type: 'menu-hover', id: latest.get(surface)?.id ?? props.id, isOver: false } satisfies EntryMessage)
      }
    })
  }

  surface.onPointer(event => {
    const over = event.type !== 'leave'
    if (over !== hovered) surface.post({ type: 'menu-hover', id: props.id, isOver: over } satisfies EntryMessage)
    const isClick = event.type === 'down' && event.button === 'left'
    const base = surface.state ?? { phase: 0, isOver: false, at: 0 }
    const level = over === base.isOver ? base.level : props.still ? (over ? HOVER_STEPS : 0) : stepToward(base.level ?? 0, over)
    surface.setState({ ...base, isOver: over, at: Date.now(), level, pressed: isClick ? { props: JSON.stringify(props), at: Date.now() } : base.pressed })
    if (isClick) surface.post({ type: 'menu-entry', id: props.id } satisfies EntryMessage)
  })

  const text = ` ${props.label} `
  if (!props.still && (props.isBusy || isPressed(surface.state, props))) {
    const phase = surface.state?.phase ?? 0
    return (
      <Box flexDirection="row">
        {[...text].map((char, at) => (
          <Text key={`c${at}`} color={shimmerColor(at, phase, text.length)} backgroundColor={props.bg}>
            {char}
          </Text>
        ))}
      </Box>
    )
  }

  return (
    <Text color={hoverMix(props.isOpen ? (props.color ?? THEME.onSurface) : (props.idle ?? THEME.muted), THEME.accent, surface.state?.level ?? 0)} bold={props.isOpen && Boolean(props.idle)} backgroundColor={props.bg}>
      {text}
    </Text>
  )
}

export default Entry
