declare module 'claude-code' {
  interface PluginState {
    'mod-next-steps': { pane: boolean }
    // Read only: true while mod-blast-radius holds a command on its card.
    'mod-blast-radius': { holding: boolean }
  }
}
