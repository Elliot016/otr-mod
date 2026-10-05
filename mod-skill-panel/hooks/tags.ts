import style from './style'
import text from './text'
import { THEME } from './theme'

export const PERSONAL = 'personal'

type Swatch = { hex: string; icon: string }

// Hues spread away from the theme blue, each over 9:1 on bg; icons are single-width Unicode, no Nerd Font.
export const SWATCHES: Record<string, Swatch> = Object.fromEntries(Object.entries(style.tags).map(([tag, { color, icon }]) => [tag, { hex: color, icon }]))

const FALLBACK = SWATCHES[PERSONAL]!

const CHIP_TEXT = THEME.bg

export const tagName = (tag: string) => (text.tagNames as Record<string, string>)[tag] ?? tag

export const swatchFor = (tag: string) => SWATCHES[tag] ?? FALLBACK

export function readFrontmatter(text: string): { name?: string; tag: string; description?: string; hidden: boolean } | null {
  const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1]
  if (block === undefined) return null
  const field = (key: string) => {
    const raw = new RegExp(`^${key}:[ \\t]*(.+?)[ \\t]*$`, 'm').exec(block)?.[1]
    return raw?.replace(/^(["'])(.*)\1$/, '$2')
  }
  return { name: field('name'), tag: field('color-tag')?.toLowerCase() ?? PERSONAL, description: field('description'), hidden: field('disable-model-invocation') === 'true' }
}

export type Skill = { name: string; tag: string; description: string; hidden: boolean }

export const TAG_ORDER = ['router', 'start', 'debug', 'review', 'interface', 'writing', 'utility', 'mods', PERSONAL]

export const groupSkills = (skills: Skill[]) => {
  const known = skills.map(skill => ({ skill, tag: TAG_ORDER.includes(skill.tag) ? skill.tag : PERSONAL }))
  known.sort((a, b) => TAG_ORDER.indexOf(a.tag) - TAG_ORDER.indexOf(b.tag) || a.skill.name.localeCompare(b.skill.name))
  const groups = new Map<string, Skill[]>()
  for (const { skill, tag } of known) groups.set(tag, [...(groups.get(tag) ?? []), skill])
  return [...groups].map(([tag, members]) => ({ tag, swatch: swatchFor(tag), skills: members }))
}

const rgb = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(';')

const bgChip = (s: Swatch) => `\x1b[48;2;${rgb(s.hex)}m\x1b[38;2;${rgb(CHIP_TEXT)}m ${s.icon} \x1b[39m\x1b[49m`

export const stripBadges = (text: string) =>
  text.replace(/\x1b\[48;2;[\d;]+m\x1b\[38;2;[\d;]+m [^ ]+ \x1b\[39m\x1b\[49m /g, '')

// The typeahead draws the name and description only, so the badge rides on the description.
export const markDescription = (description: string, tag: string) => `${bgChip(swatchFor(tag))} ${description}`
