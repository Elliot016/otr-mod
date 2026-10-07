// Shared sticky card. Copy unchanged into every mod whose pane has a card.
import type { RenderElement } from 'claude-code'

import { THEME } from './theme'

// Rows above the card: the heading, the status line and the gap under them.
export const HEAD_ROWS = 3

type Elements = { Box: (props: any) => RenderElement }

// The space the card holds in the pane's flow, so the list starts under it.
export const cardSpace = ({ Box }: Elements, rows: number) => <Box key="card-space" height={rows} marginTop={1} flexShrink={0} />

// The card itself, drawn over the list at the top of the view however far the pane has scrolled; draw it last so it covers the rows.
export function stickyCard({ Box }: Elements, offset: number, columns: number, rows: number, body: unknown) {
  return (
    <Box
      key="card"
      position="absolute"
      top={Math.max(HEAD_ROWS, offset)}
      left={1}
      width={Math.max(10, columns - 2)}
      height={rows}
      flexDirection="column"
      paddingX={1}
      overflow="hidden"
      borderStyle="round"
      borderColor={THEME.border}
      backgroundColor={THEME.surface1}
    >
      {body}
    </Box>
  )
}
