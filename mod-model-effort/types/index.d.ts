// mod-model-effort / types/index.d.ts, by v-amorim: plugin state shape
declare module 'claude-code' {
  interface PluginState {
    'mod-model-effort': { current: { model: string; effort: string } | null; pane: boolean }
    'mod-menu': { hidden: boolean; labels: 'always' | 'never' }
  }
}
