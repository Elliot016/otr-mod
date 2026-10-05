import type { ClientModule } from 'claude-code'

import type { EntryMessage } from './entry'
import style from './style'
import { CAPS, THEME } from './theme'

// mode: the id of the option the open card is in, drawn lifted and keeping the pill open; isIdle false mutes it while Claude works.
// The pill's own caps are drawn here too, so the pointer on a cap is still on the pill and the options stay open.
export type ChoiceProps = { id: string; label: string; options: { id: string; label: string }[]; mode: string | null; bg: string; nerd: boolean; isIdle: boolean }

// A dialog opening under the pointer can swallow the leave event, so a hover with no pointer event for this long ends on its own.
const HOVER_QUIET_MS = 5000
const TICK_MS = 500

// over: -2 off the pill, -1 on its label, else the option under the pointer.
type Hover = { over: number; at: number }

// Each option's cells: its label padded by one, plus room for the lifted pill's caps where the font has them.
const widthOf = (label: string, nerd: boolean) => label.length + 2 + (nerd ? 2 : 0)

// Like the effort pill: at rest only the label, the pointer opens the options and lights the one under it.
const Choice: ClientModule<ChoiceProps, Hover> = (props, surface) => {
  const { Box, Text } = surface.elements
  const over = surface.state?.over ?? -2
  const isExpanded = props.isIdle && (over !== -2 || props.mode !== null)
  const head = ` ${props.label} `

  if (!surface.state) {
    surface.setState({ over: -2, at: 0 })
    surface.every(TICK_MS, () => {
      const state = surface.state
      if (!state || state.over === -2 || Date.now() - state.at < HOVER_QUIET_MS) return
      surface.setState({ over: -2, at: Date.now() })
      surface.post({ type: 'menu-hover', id: props.id, isOver: false } satisfies EntryMessage)
    })
  }

  // The option at cell x, from the drawn order: the head, then each option with a one-cell dot between.
  const optionAt = (x: number) => {
    let start = (props.nerd ? 1 : 0) + head.length
    for (const [index, option] of props.options.entries()) {
      const end = start + widthOf(option.label, props.nerd)
      if (x >= start && x < end) return index
      start = end + 1
    }
    return -1
  }

  surface.onPointer(event => {
    // While folded the options are not where they will be, so the first event only opens the pill.
    const next = event.type === 'leave' ? -2 : isExpanded ? optionAt(event.x) : -1
    if ((next === -2) !== (over === -2)) surface.post({ type: 'menu-hover', id: props.id, isOver: next !== -2 } satisfies EntryMessage)
    surface.setState({ over: next, at: Date.now() })
    if (event.type !== 'down' || event.button !== 'left') return
    surface.post({ type: 'menu-entry', id: next >= 0 ? props.options[next]!.id : props.id } satisfies EntryMessage)
  })

  const option = (index: number) => {
    const { id, label } = props.options[index]!
    // As in the menu group: the pointer turns an option accent, and only the card's mode lifts, as an open panel's entry does.
    const isLifted = props.isIdle && id === props.mode
    const color = !props.isIdle ? THEME.muted : index === over ? THEME.accent : isLifted ? THEME.onSurface : THEME.pill
    const body = <Text key={`${id}-label`} color={color} bold={isLifted} backgroundColor={isLifted ? THEME.lifted : props.bg}>{` ${label} `}</Text>
    if (!props.nerd) return <Box key={id} flexDirection="row">{body}</Box>
    return (
      <Box key={id} flexDirection="row">
        <Text key={`${id}-left`} color={THEME.lifted} backgroundColor={props.bg}>{isLifted ? CAPS.left : ' '}</Text>
        {body}
        <Text key={`${id}-right`} color={THEME.lifted} backgroundColor={props.bg}>{isLifted ? CAPS.right : ' '}</Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="row">
      {props.nerd ? <Text key="cap-left" color={props.bg}>{CAPS.left}</Text> : null}
      <Text key="head" color={props.isIdle ? (isExpanded ? THEME.muted : THEME.onSurface) : THEME.muted} backgroundColor={props.bg}>{head}</Text>
      {isExpanded
        ? props.options.flatMap((_, index) => [
            ...(index > 0 ? [<Text key={`dot-${index}`} color={style.colors.pills.separator} backgroundColor={props.bg}>{style.marks.bullet}</Text>] : []),
            option(index),
          ])
        : null}
      {props.nerd ? <Text key="cap-right" color={props.bg}>{CAPS.right}</Text> : null}
    </Box>
  )
}

export default Choice
