// mod-next-steps / types/index.d.ts, by v-amorim
// Declares the mod's plugin state type and a read-only flag from another mod.
declare module 'claude-code' {
  interface PluginState {
    'mod-next-steps': { pane: boolean }
    // Read only: true while mod-blast-radius holds a command on its card.
    'mod-blast-radius': { holding: boolean }
  }
}
