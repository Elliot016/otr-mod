// mod-manager / hooks/register.tsx, by v-amorim
// Registers the mod manager pane, pill, command and toggle actions with the engine.
import type { ConfigValue, EngineInterface, Register, RenderChildren } from 'claude-code'

import { discover, featuresOf, setEnabled, type Io, type ModInfo } from './registry'
import { CAPS, fill, MARK, statusColor, THEME } from './theme'
import text from './text'
import { isTipMessage, mix, type EntryMessage, type EntryProps, type Tip } from './entry'
import { labelsOf, menuEntry, pill, pillRow, splitRow, tabRow, tipLine } from './pills'
import { TOAST_MS, ToastList, toastCards } from './toasts'
import { cardStrip, detectNerd, FOOTER_ROWS, lookFor, paneFooter, section, type IconMode, type Reveal, withMark } from './look'
import { actionReveals, settingChoice, settingsBody, type Action } from './settings'
import { cardSpace, stickyCard } from './card'
import { type ListMessage, type ListProps } from './list'

// `$` cannot cross an import, so the registry gets plain functions instead.
const ioOf = ($: EngineInterface): Io => ({
  read: path => $.fs.read(path),
  write: (path, text) => $.fs.write(path, text),
  list: path => $.fs.list(path),
  home: async () => (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '',
})

// The icons setting (userConfig), fixed per activation: a change reloads the mod.
let iconMode: IconMode = 'auto'
let look = lookFor(false)

// Nerd glyphs when the setting asks for them, or on auto when the terminal's font is a Nerd Font.
async function detectLook($: EngineInterface) {
  if (iconMode !== 'auto') return lookFor(iconMode === 'nerd')
  const env = {
    WT_SESSION: await $.env.get('WT_SESSION'),
    TERM_PROGRAM: await $.env.get('TERM_PROGRAM'),
    ITERM_PROFILE: await $.env.get('ITERM_PROFILE'),
    KITTY_WINDOW_ID: await $.env.get('KITTY_WINDOW_ID'),
    ALACRITTY_WINDOW_ID: await $.env.get('ALACRITTY_WINDOW_ID'),
    GNOME_TERMINAL_SCREEN: await $.env.get('GNOME_TERMINAL_SCREEN'),
    KONSOLE_VERSION: await $.env.get('KONSOLE_VERSION'),
  }
  const host = {
    localAppData: ((await $.env.get('LOCALAPPDATA')) ?? '').replace(/\\/g, '/'),
    home: ((await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '').replace(/\\/g, '/'),
    read: (path: string) => $.fs.read(path).then(String),
    run: async (argv: string[]) => {
      const result = await $.process.run(argv, { timeoutMs: 5000 })
      if (result.exitCode !== 0) throw new Error(result.stderr)
      return result.stdout
    },
  }
  return lookFor(await detectNerd(env, host))
}

// Reading the terminal's settings takes a while, so on auto the last answer, kept in this mod's store, draws until it returns.
async function savedLook($: EngineInterface) {
  if (iconMode !== 'auto') return look
  try {
    const nerd = await $.store.get('look-nerd')
    return typeof nerd === 'boolean' ? lookFor(nerd) : look
  } catch {
    return look
  }
}

async function saveLook($: EngineInterface) {
  try {
    await $.store.set('look-nerd', look.nerd)
  } catch {
    // Without a store the mod still draws; it only starts from safe again next time.
  }
}

// Hooks of one event run in turn, so the slow font check runs beside them instead of holding up every mod after this one.
let lookLoad: Promise<void> | null = null

function loadLook($: EngineInterface) {
  lookLoad ??= (async () => {
    look = await savedLook($)
    void detectLook($).then(async found => {
      const isChanged = found.nerd !== look.nerd
      look = found
      await saveLook($)
      if (isChanged) $.ui.invalidate('ui.render')
    }).catch(() => {
      // A failed check keeps the icons drawn now.
    })
  })()
  return lookLoad
}

let mods: ModInfo[] = []
// Mods toggled since the last reload, by name, with the state they had then; toggling back drops one.
const changed = new Map<string, boolean>()
// The mod whose page fills the pane, or -1 for the list.
let page = -1
// The mod under the pointer in the list, whose description shows in a card at the bottom of the pane.
let hovering = -1
let note = ''
// The page's Features card shows every line in full.
let featuresOpen = false
let working = false

// Toggles run in turn, as two read-edit-writes of settings.json would cross; a queued click names its mod, since a landed toggle re-sorts the rows.
let toggling: Promise<void> = Promise.resolve()
const queueToggle = ($: EngineInterface, index: number) => {
  const name = mods[index]?.name
  return (toggling = toggling.then(() => (name ? toggleMod($, name) : undefined)).catch(() => {}))
}

async function toggleMod($: EngineInterface, name: string) {
  const mod = mods.find(each => each.name === name)
  if (!mod) return
  const outcome = await setEnabled(ioOf($), mod, !mod.enabled)
  if (outcome.ok) {
    if (changed.get(mod.name) === !mod.enabled) changed.delete(mod.name)
    else if (!changed.has(mod.name)) changed.set(mod.name, mod.enabled)
  }
  // Only a folder new to the dirs list waits for a restart; every other toggle lands with /reload-plugins.
  const howToApply = outcome.ok && outcome.needsRestart ? text.howRestart : text.howReload
  note = outcome.ok
    ? `${MARK.ok} ${fill(mod.enabled ? text.modDisabled : text.modEnabled, { name: shownName(mod.name), how: howToApply })}`
    : `${MARK.warn} ${outcome.reason}`
  if (outcome.ok) mods = await discover(ioOf($))
  $.ui.invalidate('ui.render')
}

// Claude Code picks up a settings.json write a moment later; a reload before that applied the old toggles.
// The pending toggles take effect through a plugin reload, once the settings file has every one.
// A second Apply while one runs would reload twice.
let isApplying = false

async function applyChanges($: EngineInterface) {
  if (isApplying) return
  isApplying = true
  try {
    await toggling
    await settingsCaughtUp($).catch(() => {})
    note = await $.command
      .run({ command: 'reload-plugins' })
      .then(() => {
        changed.clear()
        return `${MARK.ok} ${text.reloading}`
      })
      .catch(error => `${MARK.warn} ${fill(text.reloadFailed, { error: String(error) })}`)
    $.ui.invalidate('ui.render')
  } finally {
    isApplying = false
  }
}

async function settingsCaughtUp($: EngineInterface) {
  const home = ((await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '').replace(/\\/g, '/')
  const onDisk = JSON.stringify(JSON.parse(String(await $.fs.read(`${home}/.claude/settings.json`))).enabledPlugins ?? {})
  for (let tries = 0; tries < 30; tries++) {
    const loaded = await $.settings.read({ source: 'user' })
    if (JSON.stringify(loaded.enabledPlugins ?? {}) === onDisk) return
    await $.clock.sleep(100)
  }
}

// `mod-skill-panel` reads `Skill Panel`: the package name is for commands, people read this.
const shownName = (name: string) => name.replace(/^mod-/, '').split('-').map(word => (word ? `${word[0]!.toUpperCase()}${word.slice(1)}` : word)).join(' ')
const isOpen = async ($: EngineInterface) => (await $.ui.panes()).some(pane => pane.id === 'manager' && pane.isPlaced)

// The command and the bar entry both toggle. An unplaced pane is waiting, not open.
async function togglePane($: EngineInterface) {
  if (await isOpen($)) {
    await $.ui.close({ id: 'manager' })
    await $.state.set({ plugin: 'mod-manager', key: 'pane' }, false)
    return
  }
  mods = await discover(ioOf($))
  page = -1
  note = ''
  const opened = await $.ui.open({ id: 'manager', title: text.paneTitle, closeOnEscape: true })
  if (!opened.isPlaced) $.ui.toast(fill(text.panelWaiting, { reason: opened.reason }))
  await $.state.set({ plugin: 'mod-manager', key: 'pane' }, opened.isPlaced)
}

const openPage = ($: EngineInterface, index: number) => {
  page = index
  note = ''
  $.ui.invalidate('ui.render')
}

// The panel's title: the list as a tab with its count; on a mod's page a click on it goes back.
const listTab = (isShown: boolean) => ({ id: 'manager-tab', label: text.paneTitle, icon: look.glyph.icon.mod ?? look.glyph.title, isOpen: isShown, count: mods.length, tip: { glyph: look.glyph.title, label: text.paneTitle, text: isShown ? text.tipTabList : text.tipTabBack } })

// A saved change reloads that mod, which redraws its page with the new value.
async function saveSetting($: EngineInterface, key: string, value: ConfigValue) {
  const row = (await $.config.list()).find(each => each.key === key)
  const result = await $.config.set({ key, value })
  note = 'deny' in result && result.deny ? `${MARK.warn} ${result.deny}` : `${MARK.ok} ${fill(text.settingSaved, { label: row?.label ?? key })}`
  $.ui.invalidate('ui.render')
}

// True while the pointer is on this mod's pill entry, which then shows its tip under the row.
let tipShown = false

// The control the pointer is on in the pane, shown in its footer.
let paneTip: Tip | null = null
// The toast × under the pointer, shown in the band's tip row.
let toastTip = ''

const toasts = new ToastList('manager')
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

// The icons switch: every mod keeps its own icons setting, and this writes the same value into each, as a person would in its panel.
const ICON_MODES = ['auto', 'nerd', 'safe'] as const

// The hover card's own rows, border included.
const CARD_ROWS = 5

// The share of green left in the on count's pill, as the legend pills tint theirs.
const COUNT_WASH = 0.72

// A control glyph without the brackets and padding it carries as a Button label.
const bare = (glyph: string) => glyph.replace(/[[\]\s]/g, '')

const iconRowsOf = async ($: EngineInterface) => (await $.config.list()).filter(row => row.key.startsWith('mod-') && row.key.endsWith('.icons'))

async function setAllIcons($: EngineInterface, mode: string) {
  const rows = await iconRowsOf($)
  // A saved change reloads that mod, this one included, so this mod's own setting goes last.
  const ordered = [...rows.filter(row => !row.key.startsWith('mod-manager.')), ...rows.filter(row => row.key.startsWith('mod-manager.'))]
  const changing = ordered.filter(row => row.value !== mode)
  note = `${MARK.ok} ${fill(text.iconsSaved, { mode: (text.iconModes as Record<string, string>)[mode] ?? mode, n: changing.length })}`
  $.ui.invalidate('ui.render')
  for (const row of changing) {
    const result = await $.config.set({ key: row.key, value: mode })
    if ('deny' in result && result.deny) {
      note = `${MARK.warn} ${result.deny}`
      $.ui.invalidate('ui.render')
      return
    }
  }
}

export const register: Register = (on, options) => {
  still = options.animations === false
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

  iconMode = (options.icons as IconMode | undefined) ?? 'auto'
  // A forced mode needs no detection; auto loads the saved answer, then checks the terminal font beside the hooks.
  look = lookFor(iconMode === 'nerd')

  on('session.start', async ($, e, next) => {
    await loadLook($)
    await $.command.register({ name: 'mod-manager', description: text.commandDescription })
    // The bar entry reads this; an unload drops the pane without raising ui.close here.
    await $.state.set({ plugin: 'mod-manager', key: 'pane' }, await isOpen($))
    // A hot reload leaves an open pane on its old drawing until something redraws it.
    $.ui.invalidate('ui.render')

    return next(e)
  })

  // Subagent turns carry agentId and say nothing about the main prompt being free.
  on('turn.start', async ($, e, next) => {
    if (!(e as { agentId?: string }).agentId) {
      working = true
      $.ui.invalidate('ui.render')
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (!e.agentId) {
      working = false
      $.ui.invalidate('ui.render')
    }

    return next(e)
  })

  on('command.run', { command: 'mod-manager' }, async $ => {
    await togglePane($)

    return { text: '' }
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === 'manager') await $.state.set({ plugin: 'mod-manager', key: 'pane' }, false)

    return next(e)
  })

  // One panel at a time: another mod's pane opening closes this one.
  on('state.set', async ($, e, next) => {
    // Deferred past this dispatch, so this mod's own state write is not nested in another plugin's.
    // The declared state names no other mod's pane, so the types narrow this event to never.
    if (e.key === 'pane' && e.plugin !== 'mod-manager' && (e as { value?: unknown }).value === true) {
      $.clock.after(0, async () => {
        if (!(await isOpen($))) return
        await $.ui.close({ id: 'manager' })
        await $.state.set({ plugin: 'mod-manager', key: 'pane' }, false)
      })
    }

    return next(e)
  })

  // The bar entry lives here, not in mod-menu: only a press in this mod counts as the person asking for this pane.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    await loadLook($)
    const hidden = await $.state.get({ plugin: 'mod-menu', key: 'hidden' })
    const labels = labelsOf((await $.state.get({ plugin: 'mod-menu', key: 'labels' })).value)
    if (e.surface !== 'terminal' || e.props.hasSurvey) return next(e)
    if (hidden.value === true) {
      if (toasts.items.length === 0) return next(e)
      const { Box, Client, Text } = $.ui.resolve(e)
      return <Box key="toasts-manager" flexDirection="column">{toastCards({ Box, Client, Text }, toasts, look, text.tipToast)}{await next(e)}</Box>
    }
    const { Box, Client, Text } = $.ui.resolve(e)
    // Reading the value subscribes the bar to redraws; the look trusts the pane list itself.
    await $.state.get({ plugin: 'mod-manager', key: 'pane' })
    const shown = await isOpen($)
    const { group, row, rest, tip } = splitRow(await next(e))
    // Opening the pane from here queues nothing, so the entry stays live mid-turn.
    const entry = menuEntry({ Box, Client, Text }, look.nerd, 'manager', { label: look.glyph.gear, isOpen: shown, idle: THEME.pill, isBusy: isOpening, still, labels })

    return pillRow({ Box, Client, Text }, look.nerd, [entry, ...group], row, [...toastCards({ Box, Client, Text }, toasts, look, text.tipToast), ...rest], toastTip ? tipLine({ Box, Text }, toastTip) : tipShown ? tipLine({ Box, Text }, text.pillTip) : tip, e.props.bodyColumns)
  })

  on('ui.message', async ($, e, next) => {
    const clicked = e.data as EntryMessage
    const dismissed = clicked?.type === 'menu-entry' ? toasts.idOf(clicked.id) : undefined
    if (dismissed !== undefined) {
      toasts.drop(dismissed)
      $.ui.invalidate('ui.render')
      return next(e)
    }
    if (isTipMessage(e.data)) {
      const tip = e.data
      const isToast = Boolean(tip.id?.startsWith('toast-manager-'))
      toastTip = isToast ? `${tip.label}: ${tip.text}` : ''
      paneTip = tip.id && !isToast ? { glyph: tip.glyph ?? '', label: tip.label ?? '', text: tip.text ?? '' } : null
      // The list's tip carries the row under the pointer, whose card shows above the list.
      hovering = tip.id?.startsWith('manager-row-') ? Number(tip.id.slice('manager-row-'.length)) : -1
      $.ui.invalidate('ui.render')
      return next(e)
    }
    const hover = e.data as { type?: string; id?: string; isOver?: boolean }
    if (hover?.type === 'menu-hover' && hover.id === 'manager') {
      tipShown = hover.isOver === true
      $.ui.invalidate('ui.render')
    }
    const message = e.data as EntryMessage
    if (message?.type === 'menu-entry' && message.id === 'manager') await openingPane($)
    if (message?.type === 'menu-entry' && message.id === 'manager-features') {
      featuresOpen = !featuresOpen
      $.ui.invalidate('ui.render')
    }
    if (message?.type === 'menu-entry' && message.id.startsWith('icons-')) await setAllIcons($, message.id.slice('icons-'.length))
    if (message?.type === 'menu-entry' && message.id === 'manager-apply') await applyChanges($)
    // The Mods tab on a mod's page goes back to the list; the open tab does nothing.
    if (message?.type === 'menu-entry' && message.id === 'manager-tab' && page >= 0) openPage($, -1)
    const change = settingChoice(e.data)
    if (change) await saveSetting($, change.key, change.value)

    return next(e)
  })

  // A click on a mod's name opens its page.
  on('ui.message', { requestId: 'manager' }, async ($, e, next) => {
    const message = e.data as ListMessage
    // A click posts only its own message, so a toggle also says which row the pointer is on.
    if (message.type === 'toggle') {
      hovering = message.index
      await queueToggle($, message.index)
    }
    if (message.type === 'select') {
      hovering = -1
      paneTip = null
      openPage($, message.index)
    }

    return next(e)
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    await loadLook($)
    if (e.requestId !== 'manager') return next(e)
    if (isOpening) $.clock.after(0, () => endOpening($))

    // A reload resets module state while the pane stays open, so reload the list.
    if (mods.length === 0) mods = await discover(ioOf($))

    // @ts-expect-error The host's types omit Client from a Pane's elements, yet a Pane draws it.
    const { Box, Button, Client, Text } = $.ui.resolve(e)
    const redraw = () => $.ui.invalidate('ui.render')
    const frame = (children: RenderChildren, reveals: Reveal[] = []) => (
      <Box flexDirection="column" backgroundColor={THEME.bg} paddingX={1} minHeight={e.props.scroll.bodyRows}>
        {children}
        <Box key="footer-space" height={FOOTER_ROWS} flexShrink={0} />
        {paneFooter({ Box, Text }, paneTip, e.props.bodyColumns, e.props.scroll, reveals)}
      </Box>
    )

    const mod = mods[page]
    if (mod) {
      // /config lists a plugin's settings as `<plugin>.<field>`, and only while the plugin is on.
      const rows = mod.enabled ? (await $.config.list()).filter(row => row.key.startsWith(`${mod.name}.`)) : []
      const actions: Action[] = mod.enabled ? (mod.showcase?.actions ?? []) : []
      const run = async (action: Action) => {
        note = await $.command
          .run({ command: action.command, args: action.args ?? '' })
          .then(() => `${MARK.ok} ${fill(text.actionRan, { command: [action.command, action.args].filter(Boolean).join(' ') })}`)
          .catch(error => `${MARK.warn} ${String(error)}`)
        redraw()
      }
      const hint = rows.length || actions.length ? fill(text.pageHint, { sep: MARK.sep }) : text.pageHintBack
      const listed = featuresOf(mod)
      // The card's border and padding take two columns a side; the title, its gap and the separator come before the detail.
      const room = e.props.bodyColumns - 4
      const isCut = listed.some(item => item.title.length + 3 + item.detail.length > room)
      // Closed, one cut row each; open, the name on its own row with its text two cells in, so every wrapped line hangs at one indent.
      const features = listed.map((item, index) =>
        featuresOpen ? (
          <Box key={`feature-${index}`} flexDirection="column" marginTop={index === 0 ? 0 : 1}>
            <Text key={`feature-${index}-name`} color={THEME.onSurface} bold>{item.title}</Text>
            <Box key={`feature-${index}-detail`} paddingLeft={2}>
              <Text color={THEME.muted} wrap="wrap">{item.detail}</Text>
            </Box>
          </Box>
        ) : (
          <Box key={`feature-${index}`} flexDirection="row" columnGap={1}>
            <Box flexShrink={0}>
              <Text color={THEME.onSurface} bold>{item.title}</Text>
            </Box>
            <Text color={THEME.muted} wrap="truncate-end">{`${MARK.sep} ${item.detail}`}</Text>
          </Box>
        ),
      )
      const label = featuresOpen ? text.featuresLess : text.featuresAll
      const featuresIcon = look.nerd ? { subLead: look.glyph.icon.features ?? look.glyph.title, subLeadColor: THEME.accent } : {}
      const more = isCut
        ? pill({ Box, Text }, look.nerd, THEME.surface3, <Client key="manager-features" module="./entry.tsx" height={1} props={{ id: 'manager-features', label, isOpen: true, bg: THEME.surface3, color: THEME.onSurface, nerd: look.nerd, still, ...featuresIcon, tip: { glyph: look.glyph.icon.features ?? look.glyph.title, label, text: featuresOpen ? text.tipFeaturesLess : text.tipFeaturesAll } } satisfies EntryProps} />, 'features-more', THEME.surface1)
        : null

      return frame([
        <Box key="page-head" flexDirection="row" columnGap={1}>
          {tabRow({ Box, Client, Text }, look.nerd, [listTab(false), { id: 'manager-page', label: shownName(mod.name), icon: look.glyph.icon.mod ?? look.glyph.title, isOpen: true, tip: { glyph: look.glyph.title, label: shownName(mod.name), text: text.tipTabPage } }], still)}
          <Text color={mod.enabled ? THEME.good : THEME.muted}>{`${MARK.sep} ${mod.enabled ? text.stateOn : text.stateOff}`}</Text>
        </Box>,
        <Text key="page-note" wrap="truncate-end" color={statusColor(note)}>{withMark(look, note) || hint}</Text>,
        <Box key="page-about" flexDirection="column" marginTop={1} paddingX={1} borderStyle="round" borderColor={THEME.border} backgroundColor={THEME.surface1}>
          {cardStrip({ Box, Text }, 'page-about')}
          <Text color={THEME.onSurface} bold>{fill(text.pageTitle, { name: shownName(mod.name), sep: MARK.sep, version: mod.version })}</Text>
          <Text color={THEME.muted}>{mod.description}</Text>
          {mod.showcase?.tagline ? <Text color={THEME.secondary}>{mod.showcase.tagline}</Text> : null}
        </Box>,
        mod.enabled || mod.settings === 0 ? (
          settingsBody({ Box, Button, Client, Text }, look, { rows, actions, working, run, previews: mod.showcase?.previews, fields: mod.fields, still })
        ) : (
          <Box key="page-off" marginTop={1}>
            <Text color={THEME.muted}>{fill(text.turnOnFirst, { name: shownName(mod.name) })}</Text>
          </Box>
        ),
        section({ Box, Text }, look, 'features', 'features', text.sectionFeatures, features.length ? [...features, more && <Box key="features-more-row" marginTop={featuresOpen ? 1 : 0}>{more}</Box>] : <Text color={THEME.muted}>{text.noFeatures}</Text>),
      ], actionReveals(actions, look, working))
    }

    // One section per source, so a row needs no "yours" or "installed" label of its own.
    const group = (source: ModInfo['source'], title: string, icon: string) => {
      const members = mods.map((item, index) => ({ item, index })).filter(({ item }) => item.isOwn === (source === 'dir'))
      if (members.length === 0) return null
      return section(
        { Box, Text },
        look,
        `list-${source}`,
        icon,
        title,
        <Client
          key={`list-${source}`}
          module="./list.tsx"
          height={members.length}
          props={{
            rows: members.map(({ item, index }) => ({
              index,
              name: shownName(item.name),
              slug: item.name,
              version: item.version,
              enabled: item.enabled,
              // A command named after its mod repeats the folder, so only other commands show.
              commands: item.commands.filter(name => name !== item.name),
              hasSettings: item.settings > 0,
            })),
            gear: look.glyph.gear,
            still,
            nameWidth: Math.max(...members.map(({ item }) => shownName(item.name).length)),
            slugWidth: Math.max(...members.map(({ item }) => item.name.length)),
            icon: look.glyph.icon[icon] ?? '',
            nerd: look.nerd,
            on: text.stateOn,
            off: text.stateOff,
            switchTip: { glyph: bare(look.glyph.on), label: '', text: text.tipSwitch },
            openTip: text.tipOpen,
          } satisfies ListProps}
        />,
      )
    }
    const pending = changed.size
    const applyLabel = fill(pending === 1 ? text.applyOne : text.applyMany, { n: pending })
    const onCount = mods.filter(item => item.enabled).length

    // The sticky card above the list keeps its space while nothing is hovered, so the list never jumps.
    const hoverCard = () => {
      const hovered = mods[hovering]
      return stickyCard(
        { Box, Text },
        e.props.scroll.offset,
        e.props.bodyColumns,
        CARD_ROWS,
        hovered ? (
          <Box key="hover-card" flexDirection="column">
            <Box key="hover-card-title" flexShrink={0}>
              <Text color={THEME.onSurface} bold>{fill(text.pageTitle, { name: shownName(hovered.name), sep: MARK.sep, version: hovered.version })}</Text>
            </Box>
            <Box key="hover-card-text" height={CARD_ROWS - 3} overflow="hidden" flexShrink={0}>
              <Text color={THEME.muted}>{hovered.description || text.noDescription}</Text>
            </Box>
          </Box>
        ) : (
          <Text key="hover-card-empty" color={THEME.muted}>{text.cardEmpty}</Text>
        ),
      )
    }

    // One switch for every mod's icons; Mixed when they differ, and nothing at all when no mod has the setting.
    const iconRows = await iconRowsOf($)
    const iconValues = new Set(iconRows.map(row => String(row.value)))
    const iconsNow = iconValues.size === 1 ? [...iconValues][0] : ''
    // A choice bar as the settings cards draw one: the options on surface 2, the chosen one on its own surface 3 pill.
    const iconOption = (mode: (typeof ICON_MODES)[number]) => {
      const isChosen = iconsNow === mode
      const bg = isChosen ? THEME.surface3 : THEME.surface2
      const entry = <Client key={`icons-${mode}`} module="./entry.tsx" height={1} props={{ id: `icons-${mode}`, label: (text.iconModes as Record<string, string>)[mode]!, isOpen: isChosen, bg, idle: THEME.muted, still, tip: { glyph: look.glyph.title, label: text.iconsLabel, text: fill(text.tipIcons, { mode: (text.iconModes as Record<string, string>)[mode]! }) } } satisfies EntryProps} />
      // Idle options get caps in the bar's own color, so moving the choice never shifts a label.
      return pill({ Box, Text }, look.nerd, bg, entry, isChosen ? `icons-${mode}-pill` : `icons-${mode}-idle`, THEME.surface2)
    }
    const iconsSwitch = iconRows.length ? (
      <Box key="icons-switch" flexDirection="column" marginTop={1} paddingX={1} borderStyle="round" borderColor={THEME.border} backgroundColor={THEME.surface1}>
        {cardStrip({ Box, Text }, 'icons-switch')}
        <Box key="icons-switch-row" flexDirection="row" columnGap={1}>
          <Text color={THEME.onSurface} bold>{text.iconsLabel}</Text>
          {pill({ Box, Text }, look.nerd, THEME.surface2, ICON_MODES.map(iconOption), 'icons-bar', THEME.surface1)}
          {iconsNow ? null : <Text color={THEME.muted}>{`${MARK.sep} ${text.iconsMixed}`}</Text>}
        </Box>
        <Text color={THEME.muted}>{text.iconsDescription}</Text>
      </Box>
    ) : null

    const goLead = { subLead: bare(look.glyph.go), subLeadColor: THEME.accent }
    return frame([
      <Box key="list-head" flexDirection="row" columnGap={1}>
        {tabRow({ Box, Client, Text }, look.nerd, [listTab(true)], still)}
        {pill({ Box, Text }, look.nerd, mix(THEME.good, THEME.bg, COUNT_WASH), <Text color={THEME.good}>{look.nerd ? fill(text.onCount, { on: onCount }) : ` ${fill(text.onCount, { on: onCount })} `}</Text>, 'on-count', THEME.bg)}
      </Box>,
      <Text key="list-note" wrap="truncate-end" color={statusColor(note)}>{withMark(look, note) || fill(text.listHint, { sep: MARK.sep })}</Text>,
      cardSpace({ Box }, CARD_ROWS),
      iconsSwitch,
      mods.length === 0 ? <Text key="list-empty" color={THEME.muted}>{text.noMods}</Text> : null,
      group('dir', text.sectionYours, 'mod'),
      group('installed', text.sectionInstalled, 'installed'),
      <Box key="list-apply" flexDirection="row" marginTop={1}>
        {/* Nothing pending means nothing to reload; while Claude works, a reload would only queue as a prompt. */}
        {pending === 0 ? (
          <Text color={THEME.muted}>{text.noChanges}</Text>
        ) : working ? (
          <Text color={THEME.muted}>{fill(text.applyBusy, { label: applyLabel, sep: MARK.sep })}</Text>
        ) : (
          [
            <Text key="apply-count" color={THEME.muted}>{applyLabel}</Text>,
            <Box key="apply-gap" flexGrow={1} />,
            pill({ Box, Text }, look.nerd, THEME.surface3, <Client key="manager-apply" module="./entry.tsx" height={1} props={{ id: 'manager-apply', label: text.applyAction, isOpen: true, bg: THEME.surface3, nerd: look.nerd, still, ...goLead, tip: { glyph: bare(look.glyph.cycle), label: text.applyAction, text: text.tipApply } }} />, 'manager-apply-pill', THEME.bg),
          ]
        )}
      </Box>,
      hoverCard(),
    ])
  })
}
