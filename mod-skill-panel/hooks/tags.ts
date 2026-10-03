export const PERSONAL = 'personal'

type Swatch = { hex: string; icon: string }

// Hues spread away from the theme blue, each over 9:1 on bg; icons are single-width Unicode, no Nerd Font.
export const SWATCHES: Record<string, Swatch> = {
  router: { hex: '#F99BD1', icon: '\u25C6' },
  debug: { hex: '#FF9C8B', icon: '\u203C' },
  interface: { hex: '#EEB154', icon: '\u25AA' },
  writing: { hex: '#C3C55A', icon: '\u2261' },
  utility: { hex: '#7CD591', icon: '\u263C' },
  start: { hex: '#2AD7D7', icon: '\u00BB' },
  mods: { hex: '#5DCBFF', icon: '\u002B' },
  review: { hex: '#D1A8FF', icon: '\u2234' },
  personal: { hex: '#9BA3C4', icon: '\u25CF' },
}

const FALLBACK = SWATCHES[PERSONAL]!

const CHIP_TEXT = '#0D0E17'

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
