// hooks/settings.tsx, by v-amorim
// Shared settings body; every mod carries the same copy.
import type { ConfigRow, ConfigValue, RenderElement } from 'claude-code'

import type { EntryProps, Tip } from './entry'
import { section, subpill, type Look, type Reveal } from './look'
import style from './style'
import { CAPS, fill, MARK, mix, THEME, WASH } from './theme'

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
  // Hover tips by setting field (the key after the dot); a setting without one shows its description's first sentence.
  tips?: Record<string, string>
  // The mod's example cards, from its showcase.json, so its own panel and mod-manager draw the same ones.
  previews?: Previews
  // The mod's plugin.json userConfig, read by its own panel and by mod-manager alike, for the min and max a number setting declares.
  fields?: Record<string, Range>
}

export type Range = { min?: number; max?: number }

// A title's trailing "(unit)" is what its number reads in; the head drops it and the value carries it.
export function splitTitle(label: string) {
  const match = /^(.*?)\s*\(([^()]+)\)$/.exec(label)
  return match ? { name: match[1]!, unit: match[2]! } : { name: label, unit: '' }
}

// Large round counts read short, in thousands or millions.
const short = (n: number) => (n >= 1_000_000 && n % 100_000 === 0 ? `${n / 1_000_000}M` : n >= 10_000 && n % 1000 === 0 ? `${n / 1000}K` : String(n))

export function showNumber(value: number, unit: string) {
  if (!unit) return String(value)
  if (unit === '%') return `${value}%`
  return `${short(value)} ${value === 1 ? unit.replace(/s$/, '') : unit}`
}

// About twenty clicks from one end of the range to the other, on a 1, 2 or 5 step; no range steps by one.
export function stepOf({ min, max }: Range = {}) {
  if (min === undefined || max === undefined || max <= min) return 1
  const raw = (max - min) / 20
  const power = 10 ** Math.floor(Math.log10(raw))
  const nearest = [1, 2, 5, 10].map(factor => factor * power).reduce((best, step) => (Math.abs(step - raw) < Math.abs(best - raw) ? step : best))
  return Math.max(1, nearest)
}

export function stepNumber(value: number, by: 1 | -1, range: Range = {}) {
  return Math.min(range.max ?? Infinity, Math.max(range.min ?? -Infinity, value + by * stepOf(range)))
}

type ThemeColor = keyof typeof THEME

// A literal run of an example line, as the mod's previews test drew it from its real tree; a color is a theme name or a #hex.
export type PreviewSpan = { text: string; color?: string; bg?: string; bold?: boolean }
export type PreviewLine = { spans: PreviewSpan[] }
export type Preview = { frame?: { border: string; bg: string }; nerd: PreviewLine[]; safe: PreviewLine[] }

// showcase.json's "previews", written by `just previews`: per setting field, per value as text ("true", "false", an option), the card in each icon mode.
export type Previews = Record<string, Record<string, Preview>>

const shade = (color: string | undefined) => (color === undefined ? undefined : color in THEME ? THEME[color as ThemeColor] : color)

// What the row's current value looks like, as a card under it; null when the mod drew none for that value.
function exampleOf({ Box, Text }: Elements, look: Look, previews: Previews | undefined, row: ConfigRow, index: number) {
  const entry = previews?.[row.key.slice(row.key.indexOf('.') + 1)]?.[String(row.value)]
  const lines = look.nerd ? entry?.nerd : entry?.safe
  if (!entry || !lines?.length) return null
  // The lines carry their own padding and strip, so the frame adds none.
  return (
    <Box key={`setting-preview-${index}`} flexDirection="column" borderStyle="round" borderColor={shade(entry.frame?.border) ?? THEME.border} backgroundColor={shade(entry.frame?.bg) ?? THEME.bg} marginTop={1}>
      {lines.map((line, index) => (
        <Text key={`line-${index}`} wrap="truncate-end">
          {line.spans.length === 0 ? ' ' : line.spans.map((span, at) => <Text key={`span-${at}`} color={shade(span.color) ?? THEME.onSurface} {...(span.bg ? { backgroundColor: shade(span.bg) } : {})} {...(span.bold ? { bold: true } : {})}>{span.text}</Text>)}
        </Text>
      ))}
    </Box>
  )
}

// The value as the panel shows it: on/off as words, a list as its items.
const shown = (row: ConfigRow) =>
  row.kind === 'boolean' ? (row.value === true ? style.text.on : style.text.off) : Array.isArray(row.value) ? row.value.join(', ') : String(row.value)

// Words that stay capitalized when a description follows a tip's label and colon.
const PROPER = new Set(['Claude', 'Haiku', 'Opus', 'Sonnet', 'Windows', 'Nerd'])

// A setting's description as the tip after "Label: ": its first sentence, led by a lowercase letter unless that word is a proper noun.
export function descriptionTip(description: string) {
  const sentence = description.split('. ')[0]!.replace(/\.$/, '')
  const word = /^[A-Z][a-z]+\b/.exec(sentence)?.[0]
  return word && !PROPER.has(word) ? sentence[0]!.toLowerCase() + sentence.slice(1) : sentence
}

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

// A pill on the card's tint, capped where the font has the caps; `hover` lights the caps with a Button scoped to the pill's key.
const pillOn = ({ Box, Text }: Elements, look: Look, key: string, bg: string, body: unknown, on = THEME.surface1, hover?: string) => {
  const lit = hover ? { hover: { scope: key, color: hover } } : {}
  return (
    <Box key={key} flexDirection="row" flexShrink={0}>
      {look.nerd ? <Text key={`${key}-left`} color={bg} backgroundColor={on} {...lit}>{CAPS.left}</Text> : null}
      {body}
      {look.nerd ? <Text key={`${key}-right`} color={bg} backgroundColor={on} {...lit}>{CAPS.right}</Text> : null}
    </Box>
  )
}

const actionScope = (index: number) => `action-row-${index}`

// The tip each live action shows in the pane footer on hover; a Button cannot post one, so paneFooter reveals it by the pill's hover group.
export const actionReveals = (actions: Action[], look: Look, working: boolean): Reveal[] =>
  actions.flatMap((action, index) =>
    working && !action.isLocal ? [] : [{ scope: actionScope(index), tip: { glyph: bare(look.glyph.go), label: action.label, text: fill(style.text.runsCommand, { command: [action.command, action.args].filter(Boolean).join(' ') }) } }],
  )

// Changes the row in place: on/off is one pill that flips, a choice a bar with the chosen option as its own pill, a number steps by one; text is edited in /config.
function control(elements: Elements, look: Look, row: ConfigRow, index: number, still: boolean, tips?: Record<string, string>, fields?: Record<string, Range>) {
  const { Box, Client, Text } = elements
  const key = `setting-${index}`
  const text = tips?.[row.key.slice(row.key.indexOf('.') + 1)] ?? (row.description ? descriptionTip(row.description) : '')
  // Client props refuse an undefined value, so a setting with no tip text leaves the key out.
  const tipFor = (glyph: string) => (text ? { tip: { glyph: bare(glyph), label: splitTitle(row.label).name, text } satisfies Tip } : {})
  const entry = (suffix: string, label: string, value: ConfigValue, bg: string, color: string, isOpen: boolean, glyph = look.glyph.cycle) => (
    <Client key={`${key}-${suffix}`} module="./entry.tsx" height={1} props={{ id: settingId(row, value), label, isOpen, bg, color, idle: color, still, ...tipFor(glyph) } satisfies EntryProps} />
  )
  if (row.isLocked) return <Text color={THEME.muted}>{`${shown(row)} ${bare(look.glyph.locked)} ${style.text.locked}`}</Text>
  if (row.kind === 'boolean') {
    const color = row.value === true ? THEME.good : THEME.muted
    const bg = row.value === true ? mix(THEME.good, THEME.surface1, WASH) : THEME.surface3
    return pillOn(elements, look, `${key}-flip`, bg, entry('flip', `${shown(row)} ${bare(look.glyph.cycle)}`, row.value !== true, bg, color, false))
  }
  if (row.kind === 'choice' && row.options?.length) {
    const options = row.options.map((option, at) => {
      // Idle options get caps in the bar's own color, so moving the choice never shifts a label.
      if (option !== String(row.value)) return pillOn(elements, look, `${key}-idle-${at}`, THEME.surface2, entry(`option-${at}`, option, option, THEME.surface2, THEME.muted, false), THEME.surface2)
      // The chosen option is a pill inside the bar, so its own caps sit on the bar's color.
      return pillOn(elements, look, `${key}-chosen`, THEME.surface3, entry(`option-${at}`, option, option, THEME.surface3, THEME.onSurface, true), THEME.surface2)
    })
    return pillOn(elements, look, `${key}-bar`, THEME.surface2, <Box key={`${key}-options`} flexDirection="row" backgroundColor={THEME.surface2}>{options}</Box>)
  }
  if (row.kind === 'number' && typeof row.value === 'number') {
    const range = fields?.[row.key.slice(row.key.indexOf('.') + 1)]
    return (
      <Box key={key} flexDirection="row" columnGap={1}>
        <Text color={THEME.secondary}>{showNumber(row.value, splitTitle(row.label).unit)}</Text>
        {pillOn(elements, look, `${key}-down`, THEME.surface3, entry('down', bare(look.glyph.down), stepNumber(row.value, -1, range), THEME.surface3, THEME.onSurface, false, look.glyph.down))}
        {pillOn(elements, look, `${key}-up`, THEME.surface3, entry('up', bare(look.glyph.up), stepNumber(row.value, 1, range), THEME.surface3, THEME.onSurface, false, look.glyph.up))}
      </Box>
    )
  }
  return <Text color={THEME.secondary}>{shown(row)}</Text>
}

// The Settings and Actions sections of a mod's panel or page: one round-bordered card per setting.
export function settingsBody(elements: Elements, look: Look, { rows, actions, working, run, previews, tips, fields, still = false }: SettingsProps) {
  const { Box, Button, Text } = elements
  const settings = [
    rows.length === 0 ? <Text key="settings-none" color={THEME.muted}>{style.text.noSettings}</Text> : null,
    ...rows.map((row, index) => {
      const example = exampleOf(elements, look, previews, row, index)
      return (
        <Box key={`setting-row-${index}`} flexDirection="column" borderStyle="round" borderColor={THEME.border} backgroundColor={THEME.surface1} paddingX={1} marginTop={index === 0 ? 0 : 1}>
          <Box key={`setting-head-${index}`} flexDirection="row" columnGap={2}>
            <Text color={THEME.onSurface} bold>{splitTitle(row.label).name}</Text>
            {control(elements, look, row, index, still, tips, fields)}
          </Box>
          {row.description ? (
            <Text color={THEME.muted}>{row.kind === 'text' ? `${row.description} ${MARK.sep} ${style.text.editInConfig}` : row.description}</Text>
          ) : null}
          {example}
        </Box>
      )
    }),
  ]
  const buttons = actions.map((action, index) =>
    working && !action.isLocal ? (
      <Text key={`action-${index}`} color={THEME.muted}>{`${look.glyph.go} ${action.label} ${MARK.sep} ${style.text.idleOnly}`}</Text>
    ) : (
      // A pill around a plain Button, since an action needs the person's press behind it.
      pillOn(
        elements,
        look,
        actionScope(index),
        THEME.surface3,
        <Box key={`action-body-${index}`} flexDirection="row" backgroundColor={THEME.surface3}>
          {subpill(elements, look.nerd, THEME.surface3, bare(look.glyph.go), `action-go-${index}`)}
          <Button key={`action-${index}`} label={look.nerd ? ` ${action.label}` : ` ${action.label} `} plain hover={{ scope: actionScope(index), color: THEME.accent, inverse: true }} onPress={() => run(action)} />
        </Box>,
        THEME.surface1,
        THEME.accent,
      )
    ),
  )
  return (
    <Box key="settings" flexDirection="column">
      {/* The cards carry their own border, and the panel's open Settings tab already names them. */}
      <Box key="settings-cards" flexDirection="column" marginTop={1}>
        {settings}
      </Box>
      {actions.length > 0 ? section(elements, look, 'actions', 'actions', style.text.actions, buttons) : null}
    </Box>
  )
}

