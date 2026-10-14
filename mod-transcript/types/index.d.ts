// mod-transcript / types/index.d.ts, by v-amorim
// Declares the mod's shared plugin state shape for folded turns, tools, pane and the copy choice being marked.
declare module 'claude-code' {
  interface PluginState {
    'mod-transcript': { turns: string[]; tools: string[]; pane: boolean; 'copy-hover': string }
  }
}
