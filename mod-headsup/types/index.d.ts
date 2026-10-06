declare module 'claude-code' {
  interface PluginState {
    'mod-headsup': { pane: boolean }
    'mod-menu': { hidden: boolean; nerd: boolean }
    // Read only: true while mod-blast-radius holds a command on its card.
    'mod-blast-radius': { holding: boolean }
  }
}
