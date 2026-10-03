import type { EngineInterface, Register } from 'claude-code'

import type { Line, ListMessage } from './list'
import { actionColumn } from './rows'
import { groupSkills, markDescription, readFrontmatter, stripBadges, type Skill } from './tags'
import { MARK, statusColor, THEME } from './theme'
import { cardSpace, stickyCard } from './card'
import type { EntryMessage } from './entry'
import { PILL, pillRow, splitRow, tipLine } from './pills'

const PANE = 'skill-panel'

// The row action: add the skill to the prompt.
const ADD = '[↵]'

// Border, title and three lines of description.
const CARD_ROWS = 6

let skills: Skill[] = []
let mods = new Set<string>()
let note = ''
let selected = 0

// Skills the panel lists: model-invocable ones, plus routers, which are the entry points even when flagged.
const listed = () => skills.filter(skill => !skill.hidden || skill.tag === 'router')

// Appends `/name ` to the prompt unless it is already there.
async function addSkill($: EngineInterface, index: number) {
  const skill = groupSkills(listed()).flatMap(group => group.skills)[index]
  if (!skill) return
  const { text } = await $.prompt.read()
  if (!text.split(/\s+/).includes(`/${skill.name}`)) {
    const gap = text === '' || /\s$/.test(text) ? '' : ' '
    const filled = await $.prompt.fill({ text: `${gap}/${skill.name} `, mode: 'append' })
    note = filled.isFilled ? `${MARK.ok} Added /${skill.name}` : `${MARK.warn} The prompt is busy, try again`
  }
  $.ui.invalidate('ui.render')
}

const isOpen = async ($: EngineInterface) => (await $.ui.panes()).some(pane => pane.id === PANE && pane.isPlaced)

// The command and the bar entry both toggle. An unplaced pane is waiting, not open.
async function togglePane($: EngineInterface) {
  if (await isOpen($)) {
    await $.ui.close({ id: PANE })
    await $.state.set({ plugin: 'mod-skill-panel', key: 'pane' }, false)
    return
  }
  note = ''
  const opened = await $.ui.open({ id: PANE, title: 'Skills', closeOnEscape: true })
  if (!opened.isPlaced) $.ui.toast(`Skills panel waiting: ${opened.reason}`)
  await $.state.set({ plugin: 'mod-skill-panel', key: 'pane' }, opened.isPlaced)
}


// True while the pointer is on this mod's pill entry, which then shows its tip under the row.
let tipShown = false

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'mod-skill-panel', description: 'Open the skills sidebar' })
    const home = ((await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '').replace(/\\/g, '/')
    const root = `${home}/.claude/skills`
    const found: Skill[] = []
    for (const entry of await $.fs.list(root).catch(() => [])) {
      if (entry.kind !== 'dir') continue
      const text = await $.fs.read(`${root}/${entry.name}/SKILL.md`).catch(() => '')
      const meta = readFrontmatter(String(text))
      if (!meta) continue
      found.push({ name: meta.name ?? entry.name, tag: meta.tag, description: meta.description ?? '', hidden: meta.hidden })
    }
    skills = found
    const modDirs = await $.fs.list(`${home}/.claude/mods`).catch(() => [])
    mods = new Set(modDirs.filter(entry => entry.kind === 'dir').map(entry => entry.name))
    // The typeahead caches each answer for the session, so ask it to list again.
    $.ui.invalidate('command.describe')
    // The bar entry reads this; an unload drops the pane without raising ui.close here.
    await $.state.set({ plugin: 'mod-skill-panel', key: 'pane' }, await isOpen($))
    // A hot reload leaves an open pane on its old drawing until something redraws it.
    $.ui.invalidate('ui.render')

    return next(e)
  })

  on('command.describe', async ($, e, next) => {
    const answer = await next(e)
    const tag = skills.find(skill => skill.name === e.command)?.tag ?? (mods.has(e.provider.plugin.split('@')[0]!) ? 'mods' : undefined)
    if (!tag) return answer

    return { ...answer, description: markDescription(answer.description, tag) }
  })

  // The model reads the same descriptions in its skill list; the badge is only for the typeahead.
  on('prompt.attachment', { type: 'skill_listing' }, async ($, e, next) => next({ ...e, text: stripBadges(e.text) }))

  on('command.run', { command: 'mod-skill-panel' }, async $ => {
    await togglePane($)

    return { text: '' }
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) await $.state.set({ plugin: 'mod-skill-panel', key: 'pane' }, false)

    return next(e)
  })

  // One panel at a time: another mod's pane opening closes this one.
  on('state.set', async ($, e, next) => {
    // Deferred past this dispatch, so this mod's own state write is not nested in another plugin's.
    if (e.key === 'pane' && e.plugin !== 'mod-skill-panel' && e.value === true) {
      $.clock.after(0, async () => {
        if (!(await isOpen($))) return
        await $.ui.close({ id: PANE })
        await $.state.set({ plugin: 'mod-skill-panel', key: 'pane' }, false)
      })
    }

    return next(e)
  })

  // The bar entry lives here, not in mod-menu: only a press in this mod counts as the person asking for this pane.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const hidden = await $.state.get({ plugin: 'mod-menu', key: 'hidden' })
    if (e.surface !== 'terminal' || e.props.hasSurvey || hidden.value === true) return next(e)
    const nerd = (await $.state.get({ plugin: 'mod-menu', key: 'nerd' })).value === true

    const { Box, Client, Text } = $.ui.resolve(e)
    // Reading the value subscribes the bar to redraws; the look trusts the pane list itself.
    await $.state.get({ plugin: 'mod-skill-panel', key: 'pane' })
    const shown = await isOpen($)
    const { group, row, rest, tip } = splitRow(await next(e))
    // Opening the pane from here queues nothing, so the entry stays live mid-turn.
    const entry = (
      <Box key="menu-pad-skills">
        <Client key="menu-entry-skills" module="./entry.tsx" height={1} props={{ id: 'skills', label: 'Skills', isOpen: shown, bg: PILL.primary, idle: THEME.pill }} />
      </Box>
    )

    return pillRow({ Box, Text }, nerd, [entry, ...group], row, rest, tipShown ? tipLine({ Box, Text }, 'Skills: browse your skills and add one to the prompt') : tip)
  })

  on('ui.message', async ($, e, next) => {
    const hover = e.data as { type?: string; id?: string; isOver?: boolean }
    if (hover?.type === 'menu-hover' && hover.id === 'skills') {
      tipShown = hover.isOver === true
      $.ui.invalidate('ui.render')
    }
    const message = e.data as EntryMessage
    if (message?.type === 'menu-entry' && message.id === 'skills') await togglePane($)

    return next(e)
  })

  // The list reports clicks: the add glyph adds, the rest of the row shows the skill in the card.
  on('ui.message', { requestId: 'skill-panel' }, async ($, e, next) => {
    const message = e.data as ListMessage
    if (message.type === 'select' && message.index !== selected) {
      selected = message.index
      $.ui.invalidate('ui.render')
    }

    return next(e)
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE) return next(e)

    const { Box, Button, Client, Text } = $.ui.resolve(e)
    const groups = groupSkills(listed())
    const ordered = groups.flatMap(group => group.skills.map(skill => ({ skill, swatch: group.swatch })))
    const current = ordered[selected]

    // Whole groups pack into as many columns as fit, so a header never sits apart from its skills.
    const cellWidth = Math.max(...ordered.map(entry => entry.skill.name.length), 1) + 10
    const columnCount = Math.max(1, Math.floor((e.props.bodyColumns - 2) / (cellWidth + 2)))
    const totalLines = groups.reduce((sum, group) => sum + group.skills.length + 1, 0)
    const target = Math.ceil(totalLines / columnCount)
    const columns: Line[][] = [[]]
    let index = 0
    for (const group of groups) {
      const block: Line[] = [{ kind: 'header', tag: group.tag, count: group.skills.length, hex: group.swatch.hex }]
      for (const skill of group.skills) {
        block.push({ kind: 'skill', index: index++, name: skill.name, hex: group.swatch.hex, icon: group.swatch.icon })
      }
      const last = columns[columns.length - 1]!
      if (last.length > 0 && last.length + block.length > target && columns.length < columnCount) columns.push([...block])
      else last.push(...block)
    }

    return (
      <Box flexDirection="column" backgroundColor={THEME.bg} paddingX={1} minHeight={e.props.scroll.bodyRows}>
        <Text color={THEME.accent} bold>{`${MARK.stage} Skills ${MARK.sep} ${ordered.length}`}</Text>
        <Text color={statusColor(note)}>{note || `click [↵] to add to the prompt ${MARK.sep} click a name to read it`}</Text>
        {current ? cardSpace({ Box }, CARD_ROWS) : null}
        <Box marginTop={1} flexDirection="row" columnGap={2}>
          {columns.map((column, c) => (
            <Box key={`column-${c}`} flexDirection="row" columnGap={1}>
              {actionColumn(
                { Box, Button, Text },
                `column-${c}`,
                column.map(line => (line.kind === 'skill' ? { label: ADD, onPress: () => addSkill($, line.index) } : null)),
              )}
              <Client key={`list-${c}`} module="./list.tsx" height={column.length} props={{ lines: column, selected }} />
            </Box>
          ))}
        </Box>
        {current
          ? stickyCard({ Box }, e.props.scroll.offset, e.props.bodyColumns, CARD_ROWS, (
              <Box key="card-body" flexDirection="column">
                <Box flexDirection="row" columnGap={1} flexShrink={0}>
                  <Text backgroundColor={current.swatch.hex} color={THEME.bg}>{` ${current.swatch.icon} `}</Text>
                  <Text color={THEME.onSurface} bold>{`/${current.skill.name}`}</Text>
                  <Text color={current.swatch.hex}>{current.skill.tag}</Text>
                </Box>
                <Box height={CARD_ROWS - 3} overflow="hidden" flexShrink={0}>
                  <Text color={THEME.muted}>{current.skill.description || 'This skill has no description.'}</Text>
                </Box>
              </Box>
            ))
          : null}
      </Box>
    )
  })
}
