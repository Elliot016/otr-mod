// mod-wrap-up / types/index.d.ts, by v-amorim
// Declares the plugin state shape for the settings pane and the menu's hidden flag.
declare module 'claude-code' {
  interface PluginState {
    'mod-wrap-up': { pane: boolean }
    'mod-menu': { hidden: boolean }
  }
}
