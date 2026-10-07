import type { ClientModule } from 'claude-code'

import { postTip } from './entry'
import text from './text'
import { CAPS, fill, THEME } from './theme'

// A click on a choice: the turn and what to copy from its reply.
export type CopyMessage = { type: 'copy'; id: string; what: string }

// copied: the note a click leaves, {what} the choice's label; lead: what fills the cells left of the pill, the edge's line.
export type CopyProps = { id: string; choices: { what: string; label: string }[]; icon: string; copied: string; bg: string; nerd: boolean; lead: { char: string; color: string } }

// over: -2 off the pill, -1 on it but on no choice, else the choice under the pointer.
type State = { over: number; at: number; note: string; noteAt: number }

const TICK_MS = 250
// A dialog opening under the pointer can swallow the leave event, so a hover with no pointer event for this long ends on its own.
const QUIET_MS = 5000
const NOTE_MS = 1500

// The part under the pointer (a choice's `what`, 'icon', or none), per instance, so a tip posts only when it changes.
const under = new WeakMap<object, string | null>()

// The cells the open pill takes; the row gives the Client this width, since the pointer reaches only the cells laid out for it.
export const copyWidth = (props: Pick<CopyProps, 'choices' | 'copied' | 'nerd'>) => {
  const open = props.choices.reduce((sum, choice) => sum + choice.label.length + 2, 0)
  const note = Math.max(0, ...props.choices.map(choice => fill(props.copied, { what: choice.label }).length + 2))
  return (props.nerd ? 2 : 0) + Math.max(open, note) + 3
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

  if (!surface.state) {
    surface.setState(state)
    surface.every(TICK_MS, () => {
      const now = surface.state
      if (!now) return
      if (now.note && Date.now() - now.noteAt >= NOTE_MS) surface.setState({ ...now, note: '' })
      else if (now.over !== -2 && Date.now() - now.at >= QUIET_MS) surface.setState({ ...now, over: -2 })
    })
  }

  // The choice at cell x, in drawn order: the lead, the left cap, the choices side by side, then the icon.
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
    // While folded the choices are not where they will be, so the first event on the pill only opens it; the lead never does.
    const next = event.type === 'leave' || (!isExpanded && event.x < lead) ? -2 : isExpanded ? choiceAt(event.x) : -1
    if (event.type === 'down' && event.button === 'left' && next >= 0) {
      const choice = props.choices[next]!
      surface.post({ type: 'copy', id: props.id, what: choice.what } satisfies CopyMessage)
      surface.setState({ over: -2, at: Date.now(), note: fill(props.copied, { what: choice.label }), noteAt: Date.now() })
      return
    }
    surface.setState({ ...state, over: next, at: Date.now() })
    const now = next >= 0 ? props.choices[next]!.what : next === -1 ? 'icon' : null
    if (now === (under.get(surface) ?? null)) return
    under.set(surface, now)
    const choice = props.choices.find(each => each.what === now)
    const tip = choice
      ? { glyph: '', label: fill(text.tipCopyChoiceLabel, { what: choice.label }), text: text.tipCopyChoice[choice.what as keyof typeof text.tipCopyChoice] }
      : now === 'icon' ? { glyph: '', label: text.tipCopyLabel, text: text.tipCopyIcon } : null
    postTip(surface, `copy-${props.id}`, tip)
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
      <Text key="icon" color={isExpanded || hasNote ? THEME.muted : THEME.onSurface} backgroundColor={props.bg}>{` ${props.icon} `}</Text>
      {props.nerd ? <Text key="cap-right" color={props.bg}>{CAPS.right}</Text> : null}
    </Box>
  )
}

export default Copy
