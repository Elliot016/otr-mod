// mod-model-effort / types/index.d.ts, by v-amorim
// Declares the mod's shared plugin state type for the model and effort.
declare module 'claude-code' {
  interface PluginState {
    'mod-model-effort': { current: { model: string; effort: string } | null; pane: boolean }
  }
}
