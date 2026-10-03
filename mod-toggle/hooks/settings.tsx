// Shared settings body, see mod-builder/references/standard.md. Copy unchanged into every mod with settings or actions.
import type { ConfigRow, ConfigValue, RenderElement } from 'claude-code'

import { MARK, THEME } from './theme'

// A button a mod offers beside its settings: runs `/<command> <args>`, declared in its showcase.json.
// isLocal marks the drawing mod's own command, which it calls directly, so Claude working does not hold it.
export type Action = { label: string; command: string; args?: string; isLocal?: boolean }

type Elements = { Box: (props: any) => RenderElement; Button: (props: any) => RenderElement; Text: (props: any) => RenderElement }

export type SettingsProps = {
  // The mod's own /config rows (`<plugin>.<field>`), as $.config.list() returns them.
  rows: ConfigRow[]
  actions: Action[]
  // Another mod's command run while Claude works only queues as a prompt, so those actions go inert.
  working: boolean
  set: (row: ConfigRow, value: ConfigValue) => unknown
  run: (action: Action) => unknown
  // The mod's example cards, from its showcase.json, so its own panel and mod-manager draw the same ones.
  previews?: Previews
}

type ThemeColor = keyof typeof THEME

// One line of an example card: colored pieces of text, and with `bar`, the tint and left strip of a transcript card.
export type PreviewLine = { bar?: ThemeColor; spans: { text: string; color?: ThemeColor; bg?: ThemeColor }[] }

// showcase.json's "previews": per setting field, per value as text ("true", "false", an option), the card's lines.
export type Previews = Record<string, Record<string, PreviewLine[]>>

// What the row's current value looks like, as a card under it; null when the mod drew none for that value.
function exampleOf({ Box, Text }: Elements, previews: Previews | undefined, row: ConfigRow) {
  const lines = previews?.[row.key.slice(row.key.indexOf('.') + 1)]?.[String(row.value)]
  if (!lines?.length) return null
  return lines.map((line, index) => {
    const spans = line.spans.map((span, at) => (
      <Box key={`span-${at}`} flexShrink={span.bg ? 0 : 1} {...(span.bg ? { backgroundColor: THEME[span.bg] } : {})}>
        <Text color={THEME[span.color ?? 'onSurface']}>{span.text}</Text>
      </Box>
    ))
    if (!line.bar) {
      return (
        <Box key={`line-${index}`} flexDirection="row">
          {spans}
        </Box>
      )
    }
    return (
      <Box key={`line-${index}`} flexDirection="row" backgroundColor={THEME.surface1}>
        <Box key={`line-${index}-bar`} width={1} flexShrink={0} backgroundColor={THEME[line.bar]} />
        <Box key={`line-${index}-body`} flexDirection="row" flexGrow={1} paddingX={1}>
          {spans}
        </Box>
      </Box>
    )
  })
}

// The value as the panel shows it: on/off as words, a list as its items.
const shown = (row: ConfigRow) =>
  row.kind === 'boolean' ? (row.value === true ? 'On' : 'Off') : Array.isArray(row.value) ? row.value.join(', ') : String(row.value)

const valueColor = (row: ConfigRow) => (row.kind === 'boolean' ? (row.value === true ? THEME.good : THEME.muted) : THEME.secondary)

// Changes the row in place: on/off flips, a choice steps to its next option, a number steps by one; text is edited in /config.
function control({ Box, Button, Text }: Elements, row: ConfigRow, index: number, set: SettingsProps['set']) {
  const key = `setting-${index}`
  const button = (suffix: string, label: string, value: ConfigValue, isInactive = false) => (
    <Button
      key={`${key}-${suffix}`}
      label={label}
      plain
      dimColor={isInactive}
      hover={{ scope: `${key}-${suffix}`, color: THEME.accent }}
      onPress={() => set(row, value)}
    />
  )
  if (row.isLocked) return <Text color={THEME.muted}>[■]</Text>
  if (row.kind === 'boolean') return button('flip', row.value === true ? '[◉]' : '[○]', row.value !== true, row.value !== true)
  if (row.kind === 'choice' && row.options?.length) {
    const at = row.options.indexOf(String(row.value))
    return button('next', '[↻]', row.options[(at + 1) % row.options.length]!)
  }
  if (row.kind === 'number' && typeof row.value === 'number') {
    return (
      <Box key={key} flexDirection="row">
        {button('down', '[−]', row.value - 1)}
        {button('up', '[+]', row.value + 1)}
      </Box>
    )
  }
  return <Text color={THEME.muted}>{'   '}</Text>
}

// The Settings and Actions sections of a mod's panel or page.
export function settingsBody(elements: Elements, { rows, actions, working, set, run, previews }: SettingsProps) {
  const { Box, Button, Text } = elements
  return (
    <Box key="settings" flexDirection="column">
      <Text color={THEME.accent} bold>
        Settings
      </Text>
      {rows.length === 0 ? <Text color={THEME.muted}>No settings.</Text> : null}
      {rows.map((row, index) => {
        const example = exampleOf(elements, previews, row)
        return (
          <Box key={`setting-row-${index}`} flexDirection="row" columnGap={1} marginTop={index === 0 ? 0 : 1}>
            <Box key={`setting-control-${index}`} width={6} flexShrink={0}>
              {control(elements, row, index, set)}
            </Box>
            <Box key={`setting-text-${index}`} flexDirection="column" flexGrow={1}>
              <Box key={`setting-head-${index}`} flexDirection="row" columnGap={2}>
                <Text color={THEME.onSurface}>{row.label}</Text>
                <Text color={valueColor(row)}>{row.isLocked ? `${shown(row)} ${MARK.sep} locked` : shown(row)}</Text>
              </Box>
              {row.description ? (
                <Text color={THEME.muted}>{row.kind === 'text' ? `${row.description} ${MARK.sep} edit it in /config` : row.description}</Text>
              ) : null}
              {example ? (
                <Box key={`setting-preview-${index}`} flexDirection="column" borderStyle="round" borderColor={THEME.border} paddingX={1} marginTop={1}>
                  {example}
                </Box>
              ) : null}
            </Box>
          </Box>
        )
      })}
      {actions.length > 0 ? (
        <Box key="actions" flexDirection="column" marginTop={1}>
          <Text color={THEME.accent} bold>
            Actions
          </Text>
          {actions.map((action, index) =>
            working && !action.isLocal ? (
              <Text key={`action-${index}`} color={THEME.muted}>{`[↵] ${action.label} ${MARK.sep} available once Claude is idle`}</Text>
            ) : (
              <Box key={`action-row-${index}`}>
                <Button
                  key={`action-${index}`}
                  label={`[↵] ${action.label}`}
                  plain
                  hover={{ scope: `action-row-${index}`, color: THEME.accent }}
                  onPress={() => run(action)}
                />
              </Box>
            ),
          )}
        </Box>
      ) : null}
    </Box>
  )
}
