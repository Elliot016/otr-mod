// mod-blast-radius / types/index.d.ts, by v-amorim
// Declares the mod's plugin state type with pane and holding flags.
declare module 'claude-code' {
  interface PluginState {
    'mod-blast-radius': { pane: boolean; holding: boolean }
  }
}
