import type { EngineInterface, Register } from 'claude-code'

import { discover, featuresOf, setEnabled, type Io, type ModInfo } from './registry'
import { MARK, statusColor, THEME } from './theme'
import { cardSpace, stickyCard } from './card'
import { actionColumn } from './rows'
import { pillRow, splitRow } from './pills'
import type { ListMessage } from './list'

// `$` cannot cross an import, so the registry gets plain functions instead.
const ioOf = ($: EngineInterface): Io => ({
  read: path => $.fs.read(path),
  write: (path, text) => $.fs.write(path, text),
  list: path => $.fs.list(path),
  home: async () => (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '',
})

// Lines the card gives a description before cutting it.
const DESC_ROWS = 2

let mods: ModInfo[] = []
let selected = 0
let note = ''
let working = false

async function toggleMod($: EngineInterface, index: number) {
  const mod = mods[index]
  if (!mod) return
  const outcome = await setEnabled(ioOf($), mod, !mod.enabled)
  // Only a folder new to the dirs list waits for a restart; every other toggle lands with /reload-plugins.
  const howToApply = outcome.ok && outcome.needsRestart ? 'new folder, restart with claude -c once to load it' : 'Apply to reload'
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
  selected = 0
  note = ''
  const opened = await $.ui.open({ id: 'manager', title: 'Mods', closeOnEscape: true })
  if (!opened.isPlaced) $.ui.toast(`Mods panel waiting: ${opened.reason}`)
  await $.state.set({ plugin: 'mod-manager', key: 'pane' }, opened.isPlaced)
}


export const register: Register = on => {
  on('session.start', async ($, e, next) => {
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
    if (e.surface !== 'terminal' || e.props.hasSurvey || hidden.value === true) return next(e)
    const nerd = (await $.state.get({ plugin: 'mod-menu', key: 'nerd' })).value === true

    const { Box, Button, Text } = $.ui.resolve(e)
    // Reading the value subscribes the bar to redraws; the look trusts the pane list itself.
    await $.state.get({ plugin: 'mod-manager', key: 'pane' })
    const shown = await isOpen($)
    const { group, row, rest } = splitRow(await next(e))
    // Buttons take no color, so closed is dim; opening the pane here queues nothing, so it stays live mid-turn.
    const entry = (
      <Box key="menu-pad" paddingX={1}>
        <Button key="menu-entry" label="Mods" plain dimColor={!shown} hover={{ scope: 'menu-entry', color: THEME.accent }} onPress={() => togglePane($)} />
      </Box>
    )

    return pillRow({ Box, Text }, nerd, [entry, ...group], row, rest)
  })

  // The list reports clicks on a mod's text, which select it into the card.
  on('ui.message', { requestId: 'manager' }, async ($, e, next) => {
    const message = e.data as ListMessage
    if (message.type === 'select' && message.index !== selected) {
      selected = message.index
      $.ui.invalidate('ui.render')
    }

    return next(e)
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== 'manager') return next(e)

    // A reload resets module state while the pane stays open, so reload the list.
    if (mods.length === 0) mods = await discover(ioOf($))

    const { Box, Button, Client, Text } = $.ui.resolve(e)
    const redraw = () => $.ui.invalidate('ui.render')
    const current = mods[selected]
    const features = current ? featuresOf(current) : []
    // One height for every mod, set by the one with most features, so the list below never moves.
    const cardRows = 2 + 1 + DESC_ROWS + 1 + 1 + Math.max(1, ...mods.map(mod => featuresOf(mod).length))

    const apply = async () => {
      await settingsCaughtUp($)
      note = await $.command
        .run({ command: 'reload-plugins' })
        .then(() => `${MARK.ok} reloading plugins`)
        .catch(error => `${MARK.warn} reload failed: ${String(error)}`)
      redraw()
    }

    return (
      <Box flexDirection="column" backgroundColor={THEME.bg} paddingX={1} minHeight={e.props.scroll.bodyRows}>
        <Text color={THEME.accent} bold>{`${MARK.stage} Mods ${MARK.sep} ${mods.length}`}</Text>
        <Text color={statusColor(note)}>
          {note || `click [◉] to turn a mod on or off ${MARK.sep} click a name to read it`}
        </Text>
        {mods.length === 0 ? <Text color={THEME.muted}>No mods found.</Text> : null}
        {current ? cardSpace({ Box }, cardRows) : null}
        <Box marginTop={1} flexDirection="row" columnGap={1}>
          {actionColumn(
            { Box, Button, Text },
            'mods',
            mods.map((mod, index) => ({ label: mod.enabled ? '[◉]' : '[○]', isInactive: !mod.enabled, onPress: () => toggleMod($, index) })),
          )}
          <Client
            key="list"
            module="./list.tsx"
            height={mods.length}
            props={{ rows: mods.map(mod => ({ name: mod.name, enabled: mod.enabled, source: mod.source, commands: mod.commands })), selected }}
          />
        </Box>
        <Box marginTop={1}>
          {/* While Claude works, a command run would only queue as a prompt, so Apply goes inert. */}
          {working ? (
            <Text color={THEME.muted}>{`Apply: reload plugins ${MARK.sep} Claude is working, available once it is idle`}</Text>
          ) : (
            <Button key="apply" label="Apply: reload plugins" onPress={apply} />
          )}
        </Box>
        {current
          ? stickyCard({ Box }, e.props.scroll.offset, e.props.bodyColumns, cardRows, (
              <Box key="card-body" flexDirection="column">
                <Box flexDirection="row" columnGap={2} flexShrink={0}>
                  <Text color={THEME.onSurface} bold>{`${current.name} ${current.version}`}</Text>
                  <Text color={current.enabled ? THEME.good : THEME.muted}>{current.enabled ? 'On' : 'Off'}</Text>
                </Box>
                <Box height={DESC_ROWS} overflow="hidden" flexShrink={0}>
                  <Text color={THEME.muted}>{current.description}</Text>
                </Box>
                <Box height={1} overflow="hidden" flexShrink={0}>
                  {current.showcase?.tagline ? <Text color={THEME.secondary}>{current.showcase.tagline}</Text> : null}
                </Box>
                {/* Read-only: a feature is information, so it adds no focus stop. */}
                <Box flexDirection="column" marginTop={1} flexShrink={0}>
                  {features.length === 0 ? <Text color={THEME.muted}>No features detected.</Text> : null}
                  {features.map((item, index) => (
                    <Box key={`feature-${index}`} flexDirection="row" columnGap={1}>
                      <Text color={THEME.accent}>{MARK.bullet}</Text>
                      <Box flexShrink={0}>
                        <Text color={THEME.onSurface}>{item.title}</Text>
                      </Box>
                      <Text color={THEME.muted} wrap="truncate-end">{item.detail}</Text>
                    </Box>
                  ))}
                </Box>
              </Box>
            ))
          : null}
      </Box>
    )
  })
}
