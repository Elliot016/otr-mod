// Shared row actions, see mod-builder/references/standard.md. Copy unchanged into every mod whose pane lists rows.
import type { RenderElement } from 'claude-code'

import { THEME } from './theme'

// One action per row, or null for a row that has none (a section header), which keeps its cells empty.
export type RowAction = { label: string; isInactive?: boolean; onPress: () => void } | null

type Elements = { Box: (props: any) => RenderElement; Button: (props: any) => RenderElement; Text: (props: any) => RenderElement }

// The 3-cell action column left of a pane's list: plain Buttons, so an action has the person's press behind it; dim when inactive, accent under the pointer.
export function actionColumn({ Box, Button, Text }: Elements, prefix: string, actions: RowAction[]) {
  return (
    <Box key={`${prefix}-actions`} flexDirection="column" flexShrink={0}>
      {actions.map((action, index) =>
        action ? (
          <Button
            key={`${prefix}-action-${index}`}
            label={action.label}
            plain
            dimColor={action.isInactive === true}
            hover={{ scope: 'row-action', color: THEME.accent }}
            onPress={action.onPress}
          />
        ) : (
          <Text key={`${prefix}-gap-${index}`}>{'   '}</Text>
        ),
      )}
    </Box>
  )
}
