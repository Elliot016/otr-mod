// mod-menu / types/index.d.ts, by v-amorim
// Declares the plugin state shape for hidden and icon mode flags.
declare module 'claude-code' {
  interface PluginState {
    'mod-menu': { hidden: boolean; nerd: boolean }
  }
}
