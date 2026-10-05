import type { ConfigRow, ConfigValue, EngineInterface, Register } from 'claude-code'

import type { Line, ListMessage } from './list'
import { actionColumn } from './rows'
import { groupSkills, markDescription, readFrontmatter, stripBadges, type Skill } from './tags'
import { fill, MARK, statusColor, THEME } from './theme'
import text from './text'
import { tagName } from './tags'
import { cardSpace, stickyCard } from './card'
import type { EntryMessage } from './entry'
import { isNerdFace, lookFor, paneTitle, terminalSettings, withMark, type IconMode } from './look'
import { PILL, pillRow, splitRow, tipLine, titleRow } from './pills'
import { settingsBody } from './settings'
import { TOAST_MS, ToastList, toastCards } from './toasts'


// The icons setting (userConfig), fixed per activation: a change reloads the mod.
let iconMode: IconMode = 'auto'
let look = lookFor(false)

// Nerd glyphs when the setting asks for them, or on auto when Windows Terminal's font is a Nerd Font.
async function detectLook($: EngineInterface) {
  if (iconMode !== 'auto') return lookFor(iconMode === 'nerd')
  if (!(await $.env.get('WT_SESSION'))) return lookFor(false)
  const local = ((await $.env.get('LOCALAPPDATA')) ?? '').replace(/\\/g, '/')
  for (const path of terminalSettings(local)) {
    if (isNerdFace(String(await $.fs.read(path).catch(() => '')))) return lookFor(true)
  }
  return lookFor(false)
}

const PANE = 'skill-panel'
const SETTINGS = 'skill-panel-settings'

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
  const { text: current } = await $.prompt.read()
  if (!current.split(/\s+/).includes(`/${skill.name}`)) {
    const gap = current === '' || /\s$/.test(current) ? '' : ' '
    const filled = await $.prompt.fill({ text: `${gap}/${skill.name} `, mode: 'append' })
    note = filled.isFilled ? `${MARK.ok} ${fill(text.added, { name: skill.name })}` : `${MARK.warn} ${text.promptBusy}`
  }
  $.ui.invalidate('ui.render')
}

const isOpen = async ($: EngineInterface, id = PANE) => (await $.ui.panes()).some(pane => pane.id === id && pane.isPlaced)

// The command and the bar entry both toggle. An unplaced pane is waiting, not open.
async function togglePane($: EngineInterface) {
  if (await isOpen($)) {
    await $.ui.close({ id: PANE })
    await $.state.set({ plugin: 'mod-skill-panel', key: 'pane' }, false)
    return
  }
  if (await isOpen($, SETTINGS)) await $.ui.close({ id: SETTINGS })
  note = ''
  const opened = await $.ui.open({ id: PANE, title: text.paneTitle, closeOnEscape: true })
  if (!opened.isPlaced) $.ui.toast(fill(text.skillsWaiting, { reason: opened.reason }))
  await $.state.set({ plugin: 'mod-skill-panel', key: 'pane' }, opened.isPlaced)
}

// `/mod-skill-panel settings` and the title row's pill toggle the settings panel, which takes the sidebar's place.
async function toggleSettings($: EngineInterface) {
  if (await isOpen($, SETTINGS)) {
    await $.ui.close({ id: SETTINGS })
    await $.state.set({ plugin: 'mod-skill-panel', key: 'pane' }, false)
    return
  }
  if (await isOpen($)) await $.ui.close({ id: PANE })
  note = ''
  const opened = await $.ui.open({ id: SETTINGS, title: text.settingsPaneTitle, closeOnEscape: true })
  if (!opened.isPlaced) $.ui.toast(fill(text.settingsWaiting, { reason: opened.reason }))
  await $.state.set({ plugin: 'mod-skill-panel', key: 'pane' }, opened.isPlaced)
}


// True while the pointer is on this mod's pill entry, which then shows its tip under the row.
let tipShown = false

const toasts = new ToastList('skills')
// The animations setting, fixed per activation: off, every entry draws still.
let still = false

// The entry shimmers from the click until the pane draws, so a slow open never looks ignored.
const OPEN_WAIT_MS = 8000
let isOpening = false

function endOpening($: EngineInterface) {
  if (!isOpening) return
  isOpening = false
  $.ui.invalidate('ui.render')
}

async function openingPane($: EngineInterface) {
  if (!(await isOpen($))) {
    isOpening = true
    $.ui.invalidate('ui.render')
    $.clock.after(OPEN_WAIT_MS, () => endOpening($))
  }
  await togglePane($)
  if (!(await isOpen($))) endOpening($)
}

export const register: Register = (on, options) => {
  still = options.animations === false
  iconMode = (options.icons as IconMode | undefined) ?? 'auto'
  // A forced mode needs no detection; auto waits for session.start to read the terminal font.
  look = lookFor(iconMode === 'nerd')
  toasts.isStill = still
  // This mod's toasts draw as cards in the band; Claude Code's own box is narrow and cuts them.
  on('ui.toast', async ($, e) => {
    const id = toasts.add(e.text)
    $.ui.invalidate('ui.render')
    $.clock.after(e.timeoutMs ?? TOAST_MS, () => {
      toasts.drop(id)
      $.ui.invalidate('ui.render')
    })
    return { value: undefined }
  })

  on('session.start', async ($, e, next) => {
    look = await detectLook($)
    await $.command.register({ name: 'mod-skill-panel', description: text.commandDescription, argumentHint: '[settings]' })
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

  on('command.run', { command: 'mod-skill-panel' }, async ($, e) => {
    if ((e.args ?? '').trim() === 'settings') await toggleSettings($)
    else await togglePane($)

    return { text: '' }
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE || e.id === SETTINGS) await $.state.set({ plugin: 'mod-skill-panel', key: 'pane' }, await isOpen($, e.id === PANE ? SETTINGS : PANE))

    return next(e)
  })

  // One panel at a time: another mod's pane opening closes this one.
  on('state.set', async ($, e, next) => {
    // Deferred past this dispatch, so this mod's own state write is not nested in another plugin's.
    if (e.key === 'pane' && e.plugin !== 'mod-skill-panel' && e.value === true) {
      $.clock.after(0, async () => {
        const wasOpen = (await isOpen($)) || (await isOpen($, SETTINGS))
        if (!wasOpen) return
        await $.ui.close({ id: PANE })
        await $.ui.close({ id: SETTINGS })
        await $.state.set({ plugin: 'mod-skill-panel', key: 'pane' }, false)
      })
    }

    return next(e)
  })

  // The bar entry lives here, not in mod-menu: only a press in this mod counts as the person asking for this pane.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const hidden = await $.state.get({ plugin: 'mod-menu', key: 'hidden' })
    if (e.surface !== 'terminal' || e.props.hasSurvey) return next(e)
    if (hidden.value === true) {
      if (toasts.items.length === 0) return next(e)
      const { Box, Client, Text } = $.ui.resolve(e)
      return <Box key="toasts-skills" flexDirection="column">{toastCards({ Box, Client, Text }, toasts)}{await next(e)}</Box>
    }
    const nerd = look.nerd

    const { Box, Client, Text } = $.ui.resolve(e)
    // Reading the value subscribes the bar to redraws; the look trusts the pane list itself.
    await $.state.get({ plugin: 'mod-skill-panel', key: 'pane' })
    const shown = await isOpen($)
    const { group, row, rest, tip } = splitRow(await next(e))
    // Opening the pane from here queues nothing, so the entry stays live mid-turn.
    const entry = (
      <Box key="menu-pad-skills">
        <Client key="menu-entry-skills" module="./entry.tsx" height={1} props={{ id: 'skills', label: text.pillLabel, isOpen: shown, bg: PILL.primary, idle: THEME.pill, isBusy: isOpening, still }} />
      </Box>
    )

    return pillRow({ Box, Text }, nerd, [entry, ...group], row, [...toastCards({ Box, Client, Text }, toasts), ...rest], tipShown ? tipLine({ Box, Text }, text.pillTip) : tip)
  })

  on('ui.message', async ($, e, next) => {
    const clicked = e.data as EntryMessage
    const dismissed = clicked?.type === 'menu-entry' ? toasts.idOf(clicked.id) : undefined
    if (dismissed !== undefined) {
      toasts.drop(dismissed)
      $.ui.invalidate('ui.render')
      return next(e)
    }
    const hover = e.data as { type?: string; id?: string; isOver?: boolean }
    if (hover?.type === 'menu-hover' && hover.id === 'skills') {
      tipShown = hover.isOver === true
      $.ui.invalidate('ui.render')
    }
    const message = e.data as EntryMessage
    if (message?.type === 'menu-entry' && message.id === 'skills') await openingPane($)
    // The title row's pill swaps the sidebar and its settings.
    if (message?.type === 'menu-entry' && message.id === 'skills-settings') await toggleSettings($)
    if (message?.type === 'menu-entry' && message.id === 'skills-back') await togglePane($)

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
    if (e.requestId !== PANE && e.requestId !== SETTINGS) return next(e)
    if (isOpening) $.clock.after(0, () => endOpening($))

    const { Box, Button, Client, Text } = $.ui.resolve(e)

    if (e.requestId === SETTINGS) {
      const rows = (await $.config.list()).filter(row => row.key.startsWith('mod-skill-panel.'))
      // A saved change reloads this mod, which redraws the panel with the new value.
      const set = async (row: ConfigRow, value: ConfigValue) => {
        const result = await $.config.set({ key: row.key, value })
        note = 'deny' in result && result.deny ? `${MARK.warn} ${result.deny}` : `${MARK.ok} ${fill(text.settingSaved, { label: row.label })}`
        $.ui.invalidate('ui.render')
      }
      return (
        <Box flexDirection="column" backgroundColor={THEME.bg} paddingX={1} minHeight={e.props.scroll.bodyRows}>
          {titleRow({ Box, Client, Text }, look.nerd, paneTitle({ Box, Text }, look, 'settings', text.settingsHeading), 'skills-back', `${look.glyph.back} ${text.backPill}`, still)}
          <Text color={statusColor(note)}>{withMark(look, note) || fill(text.settingsHint, { sep: MARK.sep })}</Text>
          <Box marginTop={0}>{settingsBody({ Box, Button, Text }, look, { rows, actions: [], working: false, set, run: async () => {} })}</Box>
        </Box>
      )
    }

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
        {titleRow({ Box, Client, Text }, look.nerd, <Text color={THEME.accent} bold>{`${MARK.stage} ${fill(text.paneHeading, { sep: MARK.sep, count: ordered.length })}`}</Text>, 'skills-settings', `${look.glyph.gear} ${text.settingsPill}`, still)}
        <Text color={statusColor(note)}>{note || fill(text.hint, { add: ADD, sep: MARK.sep })}</Text>
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
                  <Text color={current.swatch.hex}>{tagName(current.skill.tag)}</Text>
                </Box>
                <Box height={CARD_ROWS - 3} overflow="hidden" flexShrink={0}>
                  <Text color={THEME.muted}>{current.skill.description || text.noDescription}</Text>
                </Box>
              </Box>
            ))
          : null}
      </Box>
    )
  })
}
