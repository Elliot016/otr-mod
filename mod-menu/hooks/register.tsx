import type { EngineInterface, Register } from 'claude-code'

// Only Windows Terminal says its font; anywhere else the pills stay plain.
async function hasNerdFont($: EngineInterface) {
  if (!(await $.env.get('WT_SESSION'))) return false
  const local = ((await $.env.get('LOCALAPPDATA')) ?? '').replace(/\\/g, '/')
  for (const path of [
    `${local}/Packages/Microsoft.WindowsTerminal_8wekyb3d8bbwe/LocalState/settings.json`,
    `${local}/Microsoft/Windows Terminal/settings.json`,
  ]) {
    const text = String(await $.fs.read(path).catch(() => ''))
    if (/"face"\s*:\s*"[^"]*(nerd|\bNFM?\b)/i.test(text)) return true
  }
  return false
}

// Panel mods draw their own entries in the band above the prompt and read `hidden` and `nerd`; this mod owns both.
export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'mod-menu', description: 'Hide or show the panel pills above the prompt' })
    await $.state.set({ plugin: 'mod-menu', key: 'hidden' }, (await $.store.get('hidden')) === true)
    await $.state.set({ plugin: 'mod-menu', key: 'nerd' }, await hasNerdFont($))

    return next(e)
  })

  on('command.run', { command: 'mod-menu' }, async $ => {
    const hidden = (await $.state.get({ plugin: 'mod-menu', key: 'hidden' })).value !== true
    await $.state.set({ plugin: 'mod-menu', key: 'hidden' }, hidden)
    await $.store.set('hidden', hidden)

    return { text: '' }
  })
}
