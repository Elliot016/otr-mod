// hooks/entry.tsx, by v-amorim
// Shared pill entry. Master in mod-menu; copy unchanged into every mod that draws a menu entry.
import type { ClientModule, ClientSurface } from 'claude-code'

import style from './style'
import { CAPS, mix, THEME, WASH } from './theme'

// color: open text (a red Run); idle: closed text, muted unless set; isBusy shimmers the label until the click's result lands.
// still: the mod's animations setting is off, so nothing shimmers and the hover color switches at once.
// lead: a bare glyph before the label in leadColor; subLead: an icon before it as a rounded subpill in subLeadColor;
// badge: a count after it in its own pill. Subpills are capped where `nerd` has the caps.
// tight: no label padding; tip: posts `tip` instead of `menu-hover`; rail: a divider (a Text between Clients squeezes them).
export type EntryProps = {
  id: string
  label: string
  isOpen: boolean
  bg: string
  color?: string
  idle?: string
  isBusy?: boolean
  still?: boolean
  lead?: string
  leadColor?: string
  subLead?: string
  subLeadColor?: string
  badge?: { text: string; color: string; bg: string }
  nerd?: boolean
  tight?: boolean
  tip?: Tip
  rail?: boolean
}

// A hovered control's glyph, label and what it does; the pane footer and the band's tip row both show it.
export type Tip = { glyph: string; label: string; text: string }

// Posted to the owning mod's ui.message when the pointer enters a control (id set) or leaves it (id null).
export type TipMessage = { type: 'tip'; id: string | null; glyph?: string; label?: string; text?: string }

export const isTipMessage = (data: unknown): data is TipMessage => (data as TipMessage | undefined)?.type === 'tip'

// The band's tip row text for a tip message: "Label: what it does", or '' once the pointer left.
export const tipText = (message: TipMessage | null | undefined) => (message?.id && message.label ? `${message.label}: ${message.text ?? ''}` : '')

// A control calls this from onPointer, with its tip on enter and null on leave; never also `menu-hover`, one post per frame lands.
export const postTip = (surface: { post: (data: any) => void }, id: string, tip: Tip | null) => {
  surface.post((tip ? { type: 'tip', id, glyph: tip.glyph, label: tip.label, text: tip.text } : { type: 'tip', id: null }) satisfies TipMessage)
}

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

// The pointer lights a control at once and its color fades out over this many steps, one every HOVER_TICK_MS.
export const HOVER_STEPS = 2

export const HOVER_TICK_MS = 60

export { mix }

// One step of a hover fade: full at once while the pointer is on, one step toward 0 once it left.
export const stepToward = (level: number, isOver: boolean) => (isOver ? HOVER_STEPS : Math.max(0, level - 1))

// Even steps: an eased last step barely moves the color, so the fade seemed to hang at its end.
export const hoverMix = (from: string, to: string, level: number) => mix(from, to, level / HOVER_STEPS)

// A click shimmers the entry until the mod answers with new props, or this long at most.
const PRESS_MS = 1200

// pressed: the props a click saw and when it came, cleared once the mod answers.
type State = { isOver: boolean; at: number; phase: number; level?: number; pressed?: { props: string; at: number } }

const isPressed = (state: State | undefined, props: EntryProps | undefined) =>
  Boolean(state?.pressed && Date.now() - state.pressed.at < PRESS_MS && state.pressed.props === JSON.stringify(props))

// Each instance's running fade-out timer, started by the leave event and stopped at 0 or when the pointer returns.
const fades = new WeakMap<object, () => void>()

const startFade = (surface: ClientSurface<State>) => {
  if (fades.has(surface)) return
  const stop = surface.every(HOVER_TICK_MS, () => {
    const state = surface.state
    if (!state) return
    const level = stepToward(state.level ?? 0, state.isOver)
    if (level !== (state.level ?? 0)) surface.setState({ ...state, level })
    if (state.isOver || level === 0) {
      stop()
      fades.delete(surface)
    }
  })
  fades.set(surface, stop)
}

// The ticker starts once per instance and reads the latest props from here, since its closure keeps the first ones.
const latest = new WeakMap<object, EntryProps>()

// A Button inverts under the pointer, so the entry is plain text that lights up like a sidebar row.
const Entry: ClientModule<EntryProps, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  if (props.rail) return <Text color={THEME.border} backgroundColor={props.bg}>{style.marks.rail}</Text>
  const hovered = surface.state?.isOver === true
  latest.set(surface, props)

  if (!surface.state) {
    surface.setState({ isOver: false, at: 0, phase: 0 })
    // Redraws only while busy or ending a stale hover; an idle entry's tick changes nothing.
    surface.every(TICK_MS, () => {
      const state = surface.state
      if (!state) return
      const now = latest.get(surface)
      if (!now?.still && (now?.isBusy || isPressed(state, now))) surface.setState({ ...state, phase: state.phase + 1 })
      else if (state.pressed) surface.setState({ ...state, pressed: undefined })
      else if (state.isOver && Date.now() - state.at >= HOVER_QUIET_MS) {
        surface.setState({ ...state, isOver: false, at: Date.now() })
        if (!now?.still) startFade(surface)
        const id = latest.get(surface)?.id ?? props.id
        if (latest.get(surface)?.tip) postTip(surface, id, null)
        else surface.post({ type: 'menu-hover', id, isOver: false } satisfies EntryMessage)
      }
    })
  }

  surface.onPointer(event => {
    const over = event.type !== 'leave'
    if (over !== hovered) {
      if (props.tip) postTip(surface, props.id, over ? props.tip : null)
      else surface.post({ type: 'menu-hover', id: props.id, isOver: over } satisfies EntryMessage)
    }
    const isClick = event.type === 'down' && event.button === 'left'
    const base = surface.state ?? { phase: 0, isOver: false, at: 0 }
    const level = over === base.isOver ? base.level : over ? HOVER_STEPS : props.still ? 0 : base.level
    if (!over && !props.still) startFade(surface)
    surface.setState({ ...base, isOver: over, at: Date.now(), level, pressed: isClick ? { props: JSON.stringify(props), at: Date.now() } : base.pressed })
    if (isClick) surface.post({ type: 'menu-entry', id: props.id } satisfies EntryMessage)
  })

  const pad = props.tight ? (props.isOpen && !props.nerd ? ' ' : '') : ' '
  const text = `${pad}${props.label}${props.tight && props.badge ? ' ' : pad}`
  const isShimmering = !props.still && (props.isBusy || isPressed(surface.state, props))
  const phase = surface.state?.phase ?? 0
  const label = isShimmering ? (
    <Box key="label" flexDirection="row">
      {[...text].map((char, at) => (
        <Text key={`c${at}`} color={shimmerColor(at, phase, text.length)} backgroundColor={props.bg}>
          {char}
        </Text>
      ))}
    </Box>
  ) : (
    <Text key="label" color={hoverMix(props.isOpen ? (props.color ?? THEME.onSurface) : (props.idle ?? THEME.muted), THEME.accent, surface.state?.level ?? 0)} bold={props.isOpen && Boolean(props.idle)} backgroundColor={props.bg}>
      {text}
    </Text>
  )
  if (!props.lead && !props.subLead && !props.badge) return isShimmering ? <Box flexDirection="row">{label}</Box> : label

  // A rounded subpill on the entry's own fill: caps where the font has them, padded otherwise.
  const sub = (key: string, text: string, color: string, bg: string) => (
    <Box key={key} flexDirection="row">
      {props.nerd ? <Text key={`${key}-left`} color={bg} backgroundColor={props.bg}>{CAPS.left}</Text> : null}
      <Text key={`${key}-text`} color={color} backgroundColor={bg} bold>{props.nerd ? text : ` ${text} `}</Text>
      {props.nerd ? <Text key={`${key}-right`} color={bg} backgroundColor={props.bg}>{CAPS.right}</Text> : null}
    </Box>
  )
  const subHue = props.subLeadColor ?? THEME.accent
  const { badge } = props
  return (
    <Box flexDirection="row">
      {props.lead ? <Text key="lead" color={props.leadColor ?? THEME.accent} backgroundColor={props.bg}>{` ${props.lead}`}</Text> : null}
      {props.subLead ? sub('sub-lead', props.subLead, subHue, mix(subHue, props.bg, WASH)) : null}
      {label}
      {badge ? sub('badge', badge.text, badge.color, badge.bg) : null}
    </Box>
  )
}

export default Entry
