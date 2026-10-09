// mod-collision-guard / types/index.d.ts, by v-amorim
// Declares the mod's plugin state type with a pane flag.
declare module 'claude-code' {
  interface PluginState {
    'mod-collision-guard': { pane: boolean }
  }
}
