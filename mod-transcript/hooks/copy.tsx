// mod-transcript / hooks/copy.tsx, by v-amorim
// Draws the copy pill whose choices copy parts of a reply on click.
import type { ClientModule } from 'claude-code'

import type { Tip, TipMessage } from './entry'
import { subpill } from './look'
import text from './text'
import { CAPS, fill, THEME } from './theme'

export type CopyMessage = { type: 'copy'; id: string; what: string }

// The choice whose characters the reply row marks while it is hovered or just copied; `what` is null when none is.
export type CopyHoverMessage = { type: 'copy-hover'; id: string; what: string | null }

// One post lands per frame, so a hover change that comes with a tip change rides on the tip message.
export type CopyTipMessage = TipMessage & { mark?: CopyHoverMessage }

// copied: the note a click leaves, {what} the choice's label; lead: what fills the cells left of the pill, the edge's line.
export type CopyProps = { id: string; choices: { what: string; label: string }[]; icon: string; copied: string; bg: string; nerd: boolean; lead: { char: string; color: string } }

// over: -2 off the pill, -1 on it but on no choice, else the choice under the pointer.
type State = { over: number; at: number; note: string; noteAt: number; noteWhat?: string }

const TICK_MS = 250
// A dialog opening under the pointer can swallow the leave event, so a hover with no pointer event for this long ends on its own.
const QUIET_MS = 5000
const NOTE_MS = 1500

// The part under the pointer (a choice's `what`, 'icon', or none), per instance, so a tip posts only when it changes.
const under = new WeakMap<object, string | null>()

// The choice last announced to the reply row, so a hover message posts only when it changes.
const marked = new WeakMap<object, string>()

type Surface = Parameters<ClientModule<CopyProps, State>>[1]

// The choice the reply row should mark for a state: the one under the pointer, or the one a click just copied while its note shows.
const markOf = (props: Pick<CopyProps, 'choices'>, state: State) =>
  state.note && Date.now() - state.noteAt < NOTE_MS ? (state.noteWhat ?? '') : state.over >= 0 ? (props.choices[state.over]?.what ?? '') : ''

const markChange = (surface: Surface, props: Pick<CopyProps, 'id' | 'choices'>, state: State): CopyHoverMessage | null => {
  const what = markOf(props, state)
  if (what === (marked.get(surface) ?? '')) return null
  marked.set(surface, what)
  return { type: 'copy-hover', id: props.id, what: what || null }
}

const tipMessage = (id: string, tip: Tip | null, mark: CopyHoverMessage | null): CopyTipMessage => ({
  ...(tip ? { type: 'tip', id, glyph: tip.glyph, label: tip.label, text: tip.text } : { type: 'tip', id: null }),
  ...(mark ? { mark } : {}),
})

// The cells the open pill takes; the row gives the Client this width, since the pointer reaches only the cells laid out for it.
export const copyWidth = (props: Pick<CopyProps, 'choices' | 'copied' | 'nerd'>) => {
  const open = props.choices.reduce((sum, choice) => sum + choice.label.length + 2, 0)
  const note = Math.max(0, ...props.choices.map(choice => fill(props.copied, { what: choice.label }).length + 2))
  return (props.nerd ? 2 : 0) + Math.max(open, note) + 3
}

// Each pill's timer runs from the pointer's first event until the pill is at rest again: every reply of a long session ticking kept the process busy.
const timers = new WeakMap<object, () => void>()

const wake = (surface: Surface, props: CopyProps) => {
  if (timers.has(surface)) return
  const stop = surface.every(TICK_MS, () => {
    const now = surface.state
    if (!now) return
    if (now.note && Date.now() - now.noteAt >= NOTE_MS) {
      const ended = { ...now, note: '', noteWhat: '' }
      surface.setState(ended)
      const change = markChange(surface, props, ended)
      if (change) surface.post(change)
    } else if (now.over !== -2 && Date.now() - now.at >= QUIET_MS) {
      const quiet = { ...now, over: -2 }
      surface.setState(quiet)
      const change = markChange(surface, props, quiet)
      if (change) surface.post(change)
    } else if (!now.note && now.over === -2) {
      stop()
      timers.delete(surface)
    }
  })
  timers.set(surface, stop)
}

// At rest only the icon at the right end; the pointer opens the choices to its left, so the icon stays put, and lights the one under it.
const Copy: ClientModule<CopyProps, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  const state = surface.state ?? { over: -2, at: 0, note: '', noteAt: 0 }
  const hasNote = Boolean(state.note) && Date.now() - state.noteAt < NOTE_MS
  const isExpanded = state.over !== -2 && !hasNote
  const caps = props.nerd ? 2 : 0
  const bodyWidth = hasNote ? state.note.length + 2 : isExpanded ? props.choices.reduce((sum, choice) => sum + choice.label.length + 2, 0) : 0
  const lead = Math.max(0, (surface.columns || copyWidth(props)) - caps - bodyWidth - 3)

  if (!surface.state) surface.setState(state)

  const choiceAt = (x: number) => {
    let start = lead + (props.nerd ? 1 : 0)
    for (const [index, choice] of props.choices.entries()) {
      const end = start + choice.label.length + 2
      if (x >= start && x < end) return index
      start = end
    }
    return -1
  }

  surface.onPointer(event => {
    wake(surface, props)
    // While folded the choices are not where they will be, so the first event on the pill only opens it; the lead never does.
    const next = event.type === 'leave' || (!isExpanded && event.x < lead) ? -2 : isExpanded ? choiceAt(event.x) : -1
    if (event.type === 'down' && event.button === 'left' && next >= 0) {
      const choice = props.choices[next]!
      surface.post({ type: 'copy', id: props.id, what: choice.what } satisfies CopyMessage)
      const copied = { over: -2, at: Date.now(), note: fill(props.copied, { what: choice.label }), noteAt: Date.now(), noteWhat: choice.what }
      surface.setState(copied)
      markChange(surface, props, copied)
      return
    }
    const moved = { ...state, over: next, at: Date.now() }
    surface.setState(moved)
    const change = markChange(surface, props, moved)
    const now = next >= 0 ? props.choices[next]!.what : next === -1 ? 'icon' : null
    if (now === (under.get(surface) ?? null)) {
      if (change) surface.post(change)
      return
    }
    under.set(surface, now)
    const choice = props.choices.find(each => each.what === now)
    const tip = choice
      ? { glyph: '', label: fill(text.tipCopyChoiceLabel, { what: choice.label }), text: text.tipCopyChoice[choice.what as keyof typeof text.tipCopyChoice] }
      : now === 'icon' ? { glyph: '', label: text.tipCopyLabel, text: text.tipCopyIcon } : null
    surface.post(tipMessage(`copy-${props.id}`, tip, change))
  })

  const body = hasNote
    ? [<Text key="note" color={THEME.muted} backgroundColor={props.bg}>{` ${state.note} `}</Text>]
    : isExpanded
      ? props.choices.map((choice, index) => (
          <Text key={`choice-${choice.what}`} color={index === state.over ? THEME.accent : THEME.pill} backgroundColor={props.bg}>{` ${choice.label} `}</Text>
        ))
      : []
  return (
    <Box flexDirection="row">
      {lead ? <Text key="lead" color={props.lead.color}>{props.lead.char.repeat(lead)}</Text> : null}
      {props.nerd ? <Text key="cap-left" color={props.bg}>{CAPS.left}</Text> : null}
      {body}
      {subpill({ Box, Text }, props.nerd, props.bg, props.icon, 'copy-icon', isExpanded || hasNote ? THEME.muted : THEME.accent)}
      {props.nerd ? <Text key="cap-right" color={props.bg}>{CAPS.right}</Text> : null}
    </Box>
  )
}

export default Copy
