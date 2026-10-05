// Shared mod theme, see mod-builder/references/standard.md. Copy unchanged; edit the template first. Colors, marks and glyphs live in style.ts.
import style from './style'

export const THEME = style.colors.theme

// Shell command roles: what runs, its options, quoted text, variables, numbers and the glue between steps.
export const SYNTAX = style.colors.syntax

// One cell each and never an emoji: ⚠ switches to its emoji form in some fonts and draws two cells wide.
export const MARK = style.marks

// style.ts writes Nerd glyphs as {U+XXXX}: Write and Edit drop private-use characters typed into a file.
const decode = (text: string) => text.replace(/\{U\+([0-9A-F]+)\}/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))

export function decodeAll<T>(value: T): T {
  if (typeof value === 'string') return decode(value) as T
  if (Array.isArray(value)) return value.map(decodeAll) as T
  return Object.fromEntries(Object.entries(value as object).map(([key, inner]) => [key, decodeAll(inner)])) as T
}

// A pill's rounded ends, drawn only where the font has them.
export const CAPS = decodeAll(style.caps)

export const statusColor = (note: string) =>
  note.startsWith(MARK.ok) ? THEME.good : note.startsWith(MARK.warn) ? THEME.alert : THEME.muted

// A text.ts string with its {name} slots filled; a slot with no value stays as written, so a missing one shows.
export const fill = (template: string, values: Record<string, string | number> = {}) =>
  template.replace(/\{(\w+)\}/g, (slot, name: string) => (name in values ? String(values[name]) : slot))
