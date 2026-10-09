// mod-transcript / hooks/edge.tsx, by v-amorim
// Draws one row's share of a reply bubble's top, bottom or side border.
import type { ClientModule } from 'claude-code'

// A Box border is all four sides or none, and a reply's bubble spans many rows, so each row draws its own share.
export type EdgeProps = { kind: 'top' | 'bottom' | 'side'; color: string; wedge?: string; open?: 'start' | 'end' } // open: a bottom edge cut there, for the copy pill

const Edge: ClientModule<EdgeProps, number> = (props, surface) => {
  const { Text } = surface.elements
  const size = props.kind === 'top' || props.kind === 'bottom' ? surface.columns : surface.rows
  // The first call comes before layout; one more call once the size is known, and again only when it changes.
  if (size && surface.state !== size) surface.setState(size)
  const run = Math.max(0, size - 2)
  if (props.kind === 'top') return <Text color={props.color}>{`${props.wedge ?? '╭'}${'─'.repeat(run)}╮`}</Text>
  if (props.kind === 'bottom') return <Text color={props.color}>{`${props.open === 'start' ? '─' : '╰'}${'─'.repeat(run)}${props.open === 'end' ? '─' : '╯'}`}</Text>
  return <Text color={props.color}>{Array.from({ length: Math.max(1, size) }, () => '│').join('\n')}</Text>
}

export default Edge
