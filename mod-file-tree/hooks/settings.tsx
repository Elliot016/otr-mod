// Shared settings body, see mod-builder/references/standard.md. Master in templates/cli-mod; copy unchanged into every mod with settings or actions.
import type { ConfigRow, ConfigValue, RenderElement } from 'claude-code'

import { mix, type EntryProps } from './entry'
import { section, type Look } from './look'
import style from './style'
import { CAPS, MARK, THEME } from './theme'

// A button a mod offers beside its settings: runs `/<command> <args>`, declared in its showcase.json.
// isLocal marks the drawing mod's own command, which it calls directly, so Claude working does not hold it.
export type Action = { label: string; command: string; args?: string; isLocal?: boolean }

type Elements = { Box: (props: any) => RenderElement; Button: (props: any) => RenderElement; Client: (props: any) => RenderElement; Text: (props: any) => RenderElement }

export type SettingsProps = {
  // The mod's own /config rows (`<plugin>.<field>`), as $.config.list() returns them.
  rows: ConfigRow[]
  actions: Action[]
  // Another mod's command run while Claude works only queues as a prompt, so those actions go inert.
  working: boolean
  run: (action: Action) => unknown
  // The animations setting is off: a clicked control does not shimmer.
  still?: boolean
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
  row.kind === 'boolean' ? (row.value === true ? style.text.on : style.text.off) : Array.isArray(row.value) ? row.value.join(', ') : String(row.value)

// A control is an Entry pill posting `setting:<key>=<value as JSON>`; the mod's ui.message hook saves it with settingChoice.
const SETTING = 'setting:'
const settingId = (row: ConfigRow, value: ConfigValue) => `${SETTING}${row.key}=${JSON.stringify(value)}`

// The change a clicked settings control asks for, or null when the message is something else.
export function settingChoice(data: unknown): { key: string; value: ConfigValue } | null {
  const message = data as { type?: string; id?: string } | undefined
  if (message?.type !== 'menu-entry' || !message.id?.startsWith(SETTING)) return null
  const rest = message.id.slice(SETTING.length)
  const at = rest.indexOf('=')
  return { key: rest.slice(0, at), value: JSON.parse(rest.slice(at + 1)) as ConfigValue }
}

// A control glyph without the brackets and padding it has as a standalone button (safe `[↻]`), since a pill already frames it.
const bare = (glyph: string) => glyph.replace(/[[\]\s]/g, '')

// The share of a value's own color left in its pill, as the turn-fold chips tint their counts.
const WASH = 0.72

// A pill on the card's tint, capped where the font has the caps.
const pillOn = ({ Box, Text }: Elements, look: Look, key: string, bg: string, body: unknown, on = THEME.surface1) => (
  <Box key={key} flexDirection="row" flexShrink={0}>
    {look.nerd ? <Text key={`${key}-left`} color={bg} backgroundColor={on}>{CAPS.left}</Text> : null}
    {body}
    {look.nerd ? <Text key={`${key}-right`} color={bg} backgroundColor={on}>{CAPS.right}</Text> : null}
  </Box>
)

// Changes the row in place: on/off is one pill that flips, a choice a bar with the chosen option as its own pill, a number steps by one; text is edited in /config.
function control(elements: Elements, look: Look, row: ConfigRow, index: number, still: boolean) {
  const { Box, Client, Text } = elements
  const key = `setting-${index}`
  const entry = (suffix: string, label: string, value: ConfigValue, bg: string, color: string, isOpen: boolean) => (
    <Client key={`${key}-${suffix}`} module="./entry.tsx" height={1} props={{ id: settingId(row, value), label, isOpen, bg, color, idle: isOpen ? color : THEME.muted, still } satisfies EntryProps} />
  )
  if (row.isLocked) return <Text color={THEME.muted}>{`${shown(row)} ${bare(look.glyph.locked)} ${style.text.locked}`}</Text>
  if (row.kind === 'boolean') {
    const color = row.value === true ? THEME.good : THEME.muted
    const bg = row.value === true ? mix(THEME.good, THEME.surface1, WASH) : THEME.surface3
    return pillOn(elements, look, `${key}-flip`, bg, entry('flip', `${shown(row)} ${bare(look.glyph.cycle)}`, row.value !== true, bg, color, false))
  }
  if (row.kind === 'choice' && row.options?.length) {
    const options = row.options.map((option, at) => {
      if (option !== String(row.value)) return entry(`option-${at}`, option, option, THEME.surface3, THEME.muted, false)
      // The chosen option is a pill inside the bar, so its own caps sit on the bar's color.
      return pillOn(elements, look, `${key}-chosen`, THEME.lifted, entry(`option-${at}`, option, option, THEME.lifted, THEME.accent, true), THEME.surface3)
    })
    return pillOn(elements, look, `${key}-bar`, THEME.surface3, <Box key={`${key}-options`} flexDirection="row" backgroundColor={THEME.surface3}>{options}</Box>)
  }
  if (row.kind === 'number' && typeof row.value === 'number') {
    return (
      <Box key={key} flexDirection="row" columnGap={1}>
        <Text color={THEME.secondary}>{shown(row)}</Text>
        {pillOn(elements, look, `${key}-down`, THEME.surface3, entry('down', bare(look.glyph.down), row.value - 1, THEME.surface3, THEME.onSurface, false))}
        {pillOn(elements, look, `${key}-up`, THEME.surface3, entry('up', bare(look.glyph.up), row.value + 1, THEME.surface3, THEME.onSurface, false))}
      </Box>
    )
  }
  return <Text color={THEME.secondary}>{shown(row)}</Text>
}

// The Settings and Actions sections of a mod's panel or page: one tinted card per setting.
export function settingsBody(elements: Elements, look: Look, { rows, actions, working, run, previews, still = false }: SettingsProps) {
  const { Box, Button, Text } = elements
  const settings = [
    rows.length === 0 ? <Text key="settings-none" color={THEME.muted}>{style.text.noSettings}</Text> : null,
    ...rows.map((row, index) => {
      const example = exampleOf(elements, previews, row)
      return (
        <Box key={`setting-row-${index}`} flexDirection="column" backgroundColor={THEME.surface1} paddingX={1} marginTop={index === 0 ? 0 : 1}>
          <Box key={`setting-head-${index}`} flexDirection="row" columnGap={2}>
            <Text color={THEME.onSurface} bold>{row.label}</Text>
            {control(elements, look, row, index, still)}
          </Box>
          {row.description ? (
            <Text color={THEME.muted}>{row.kind === 'text' ? `${row.description} ${MARK.sep} ${style.text.editInConfig}` : row.description}</Text>
          ) : null}
          {/* The page's own background sets the example apart from the tinted card around it. */}
          {example ? (
            <Box key={`setting-preview-${index}`} flexDirection="column" borderStyle="round" borderColor={THEME.border} backgroundColor={THEME.bg} paddingX={1} marginTop={1}>
              {example}
            </Box>
          ) : null}
        </Box>
      )
    }),
  ]
  const buttons = actions.map((action, index) =>
    working && !action.isLocal ? (
      <Text key={`action-${index}`} color={THEME.muted}>{`${look.glyph.go} ${action.label} ${MARK.sep} ${style.text.idleOnly}`}</Text>
    ) : (
      <Box key={`action-row-${index}`}>
        <Button key={`action-${index}`} label={`${look.glyph.go} ${action.label}`} plain hover={{ scope: `action-row-${index}`, color: THEME.accent }} onPress={() => run(action)} />
      </Box>
    ),
  )
  return (
    <Box key="settings" flexDirection="column">
      {/* The cards carry their own tint, and the panel's open Settings tab already names them. */}
      <Box key="settings-cards" flexDirection="column" marginTop={1}>
        {settings}
      </Box>
      {actions.length > 0 ? section(elements, look, 'actions', 'actions', style.text.actions, buttons) : null}
    </Box>
  )
}

