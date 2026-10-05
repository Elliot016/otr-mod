import type { ConfigRow, ConfigValue, EngineInterface, Register } from 'claude-code'

import { discover, featuresOf, setEnabled, type Io, type ModInfo } from './registry'
import { MARK, statusColor, THEME } from './theme'
import { actionColumn } from './rows'
import type { EntryMessage } from './entry'
import { PILL, pillRow, splitRow, tipLine } from './pills'
import { TOAST_MS, ToastList, toastCards } from './toasts'
import { isNerdFace, lookFor, paneTitle, section, terminalSettings, type IconMode, withMark } from './look'
import { settingsBody, type Action } from './settings'
import type { ListMessage } from './list'

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

let mods: ModInfo[] = []
// Mods toggled since the last reload, by name, with the state they had then; toggling back drops one.
const changed = new Map<string, boolean>()
// The mod whose page fills the pane, or -1 for the list.
let page = -1
let note = ''
let working = false

async function toggleMod($: EngineInterface, index: number) {
  const mod = mods[index]
  if (!mod) return
  const outcome = await setEnabled(ioOf($), mod, !mod.enabled)
  if (outcome.ok) {
    if (changed.get(mod.name) === !mod.enabled) changed.delete(mod.name)
    else if (!changed.has(mod.name)) changed.set(mod.name, mod.enabled)
  }
  // Only a folder new to the dirs list waits for a restart; every other toggle lands with /reload-plugins.
  const howToApply = outcome.ok && outcome.needsRestart ? 'new folder, restart with claude -c once to load it' : 'reload plugins to apply'
  note = outcome.ok
    ? `${MARK.ok} ${mod.name} ${mod.enabled ? 'disabled' : 'enabled'}, ${howToApply}`
    : `${MARK.warn} ${outcome.reason}`
  if (outcome.ok) mods = await discover(ioOf($))
  $.ui.invalidate('ui.render')
}

// Claude Code picks up a settings.json write a moment later; a reload before that applied the old toggles.
async function settingsCaughtUp($: EngineInterface) {
  const home = ((await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '').replace(/\\/g, '/')
  const onDisk = JSON.stringify(JSON.parse(String(await $.fs.read(`${home}/.claude/settings.json`))).enabledPlugins ?? {})
  for (let tries = 0; tries < 30; tries++) {
    const loaded = await $.settings.read({ source: 'user' })
    if (JSON.stringify(loaded.enabledPlugins ?? {}) === onDisk) return
    await $.clock.sleep(100)
  }
}

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
  const opened = await $.ui.open({ id: 'manager', title: 'Mods', closeOnEscape: true })
  if (!opened.isPlaced) $.ui.toast(`Mods panel waiting: ${opened.reason}`)
  await $.state.set({ plugin: 'mod-manager', key: 'pane' }, opened.isPlaced)
}

const openPage = ($: EngineInterface, index: number) => {
  page = index
  note = ''
  $.ui.invalidate('ui.render')
}

// True while the pointer is on this mod's pill entry, which then shows its tip under the row.
let tipShown = false

const toasts = new ToastList('manager')

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
  // A forced mode needs no detection; auto waits for session.start to read the terminal font.
  look = lookFor(iconMode === 'nerd')

  on('session.start', async ($, e, next) => {
    look = await detectLook($)
    await $.command.register({ name: 'mod-manager', description: 'Open the mod manager' })
    // The bar entry reads this; an unload drops the pane without raising ui.close here.
    await $.state.set({ plugin: 'mod-manager', key: 'pane' }, await isOpen($))
    // A hot reload leaves an open pane on its old drawing until something redraws it.
    $.ui.invalidate('ui.render')

    return next(e)
  })

  // Subagent turns carry agentId and say nothing about the main prompt being free.
  on('turn.start', async ($, e, next) => {
    if (!e.agentId) {
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
    if (e.key === 'pane' && e.plugin !== 'mod-manager' && e.value === true) {
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
    const hidden = await $.state.get({ plugin: 'mod-menu', key: 'hidden' })
    if (e.surface !== 'terminal' || e.props.hasSurvey) return next(e)
    if (hidden.value === true) {
      if (toasts.items.length === 0) return next(e)
      const { Box, Client, Text } = $.ui.resolve(e)
      return <Box key="toasts-manager" flexDirection="column">{toastCards({ Box, Client, Text }, toasts)}{await next(e)}</Box>
    }
    const { Box, Client, Text } = $.ui.resolve(e)
    // Reading the value subscribes the bar to redraws; the look trusts the pane list itself.
    await $.state.get({ plugin: 'mod-manager', key: 'pane' })
    const shown = await isOpen($)
    const { group, row, rest, tip } = splitRow(await next(e))
    // Opening the pane from here queues nothing, so the entry stays live mid-turn.
    const entry = (
      <Box key="menu-pad-manager">
        <Client key="menu-entry-manager" module="./entry.tsx" height={1} props={{ id: 'manager', label: look.glyph.gear, isOpen: shown, bg: PILL.primary, idle: THEME.pill, isBusy: isOpening }} />
      </Box>
    )

    return pillRow({ Box, Text }, look.nerd, [entry, ...group], row, [...toastCards({ Box, Client, Text }, toasts), ...rest], tipShown ? tipLine({ Box, Text }, 'Mods: turn each mod on or off and open its settings') : tip)
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
    if (hover?.type === 'menu-hover' && hover.id === 'manager') {
      tipShown = hover.isOver === true
      $.ui.invalidate('ui.render')
    }
    const message = e.data as EntryMessage
    if (message?.type === 'menu-entry' && message.id === 'manager') await openingPane($)

    return next(e)
  })

  // A click on a mod's name opens its page.
  on('ui.message', { requestId: 'manager' }, async ($, e, next) => {
    const message = e.data as ListMessage
    if (message.type === 'select') openPage($, message.index)

    return next(e)
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== 'manager') return next(e)
    if (isOpening) $.clock.after(0, () => endOpening($))

    // A reload resets module state while the pane stays open, so reload the list.
    if (mods.length === 0) mods = await discover(ioOf($))

    const { Box, Button, Client, Text } = $.ui.resolve(e)
    const redraw = () => $.ui.invalidate('ui.render')
    const frame = (children: unknown) => (
      <Box flexDirection="column" backgroundColor={THEME.bg} paddingX={1} minHeight={e.props.scroll.bodyRows}>
        {children}
      </Box>
    )

    const mod = mods[page]
    if (mod) {
      // /config lists a plugin's settings as `<plugin>.<field>`, and only while the plugin is on.
      const rows = mod.enabled ? (await $.config.list()).filter(row => row.key.startsWith(`${mod.name}.`)) : []
      const actions: Action[] = mod.enabled ? (mod.showcase?.actions ?? []) : []
      // A saved change reloads that mod, which redraws this page with the new value.
      const set = async (row: ConfigRow, value: ConfigValue) => {
        const result = await $.config.set({ key: row.key, value })
        note = 'deny' in result && result.deny ? `${MARK.warn} ${result.deny}` : `${MARK.ok} ${row.label} saved`
        redraw()
      }
      const run = async (action: Action) => {
        note = await $.command
          .run({ command: action.command, args: action.args ?? '' })
          .then(() => `${MARK.ok} Ran /${[action.command, action.args].filter(Boolean).join(' ')}`)
          .catch(error => `${MARK.warn} ${String(error)}`)
        redraw()
      }
      const back = () => {
        page = -1
        note = ''
        redraw()
      }
      const hint = rows.length || actions.length ? `click a control to change it ${MARK.sep} saved at once, the mod reloads` : 'click Back to return to the list'
      const features = featuresOf(mod).map((item, index) => (
        <Box key={`feature-${index}`} flexDirection="row" columnGap={1}>
          <Text color={THEME.accent}>{MARK.bullet}</Text>
          <Box flexShrink={0}>
            <Text color={THEME.onSurface}>{item.title}</Text>
          </Box>
          <Text color={THEME.muted} wrap="truncate-end">{item.detail}</Text>
        </Box>
      ))

      return frame([
        <Box key="back-row">
          <Button key="back" label={`${look.glyph.back} Back`} plain hover={{ scope: 'back-row', color: THEME.accent }} onPress={back} />
        </Box>,
        <Box key="page-head" flexDirection="row" columnGap={2} marginTop={1}>
          {paneTitle({ Box, Text }, look, 'mod', `${mod.name} ${MARK.sep} ${mod.version}`)}
          <Text color={mod.enabled ? THEME.good : THEME.muted}>{mod.enabled ? 'On' : 'Off'}</Text>
        </Box>,
        <Text key="page-note" color={statusColor(note)}>{withMark(look, note) || hint}</Text>,
        <Box key="page-about" flexDirection="column" marginTop={1}>
          <Text color={THEME.onSurface}>{mod.description}</Text>
          {mod.showcase?.tagline ? <Text color={THEME.secondary}>{mod.showcase.tagline}</Text> : null}
        </Box>,
        mod.enabled || mod.settings === 0 ? (
          settingsBody({ Box, Button, Text }, look, { rows, actions, working, set, run, previews: mod.showcase?.previews })
        ) : (
          <Box key="page-off" marginTop={1}>
            <Text color={THEME.muted}>{`Turn ${mod.name} on to change its settings and run its actions.`}</Text>
          </Box>
        ),
        section({ Box, Text }, look, 'features', 'features', 'Features', features.length ? features : <Text color={THEME.muted}>No features detected.</Text>),
      ])
    }

    const apply = async () => {
      await settingsCaughtUp($)
      note = await $.command
        .run({ command: 'reload-plugins' })
        .then(() => {
          changed.clear()
          return `${MARK.ok} Reloading plugins`
        })
        .catch(error => `${MARK.warn} Reload failed: ${String(error)}`)
      redraw()
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
        <Box key={`rows-${source}`} flexDirection="row" columnGap={1}>
          {actionColumn(
            { Box, Button, Text },
            `mods-${source}`,
            members.map(({ item, index }) => ({ label: item.enabled ? look.glyph.on : look.glyph.off, isInactive: !item.enabled, onPress: () => toggleMod($, index) })),
          )}
          <Client
            key={`list-${source}`}
            module="./list.tsx"
            height={members.length}
            props={{
              rows: members.map(({ item, index }) => ({
                index,
                name: item.name,
                enabled: item.enabled,
                // A command named after its mod repeats the name, so only other commands show.
                commands: item.commands.filter(name => name !== item.name),
                hasSettings: item.settings > 0,
              })),
              gear: look.glyph.gear,
              icon: look.glyph.icon[icon] ?? '',
            }}
          />
        </Box>,
      )
    }
    const pending = changed.size
    const applyLabel = `Reload plugins to apply ${pending} ${pending === 1 ? 'change' : 'changes'}`
    const onCount = mods.filter(item => item.enabled).length

    return frame([
      paneTitle({ Box, Text }, look, 'mod', `Mods ${MARK.sep} ${onCount} of ${mods.length} on`),
      <Text key="list-note" color={statusColor(note)}>{withMark(look, note) || `click ${look.glyph.on.trim()} to turn a mod on or off ${MARK.sep} click a name to open its page`}</Text>,
      mods.length === 0 ? <Text key="list-empty" color={THEME.muted}>No mods found.</Text> : null,
      group('dir', 'Yours', 'mod'),
      group('installed', 'Installed', 'installed'),
      <Box key="list-apply" marginTop={1}>
        {/* Nothing pending means nothing to reload; while Claude works, a reload would only queue as a prompt. */}
        {pending === 0 ? (
          <Text color={THEME.muted}>No changes to apply</Text>
        ) : working ? (
          <Text color={THEME.muted}>{`${applyLabel} ${MARK.sep} available once Claude is idle`}</Text>
        ) : (
          <Button key="apply" label={applyLabel} onPress={apply} />
        )}
      </Box>,
    ])
  })
}
