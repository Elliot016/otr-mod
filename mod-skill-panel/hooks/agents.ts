// mod-skill-panel / hooks/agents.ts, by v-amorim
// Reads agent files and groups agents by model with a color for each.
import style from './style'

export type Agent = { name: string; model: string; description: string; tools: number }

// Models in the order the tab groups them; an agent without a model runs on the session's, so it is "inherit".
export const MODEL_ORDER = ['opus', 'sonnet', 'haiku', 'inherit']

const MODELS = style.colors.models as Record<string, string>

export const modelHue = (model: string) => MODELS[model] ?? MODELS.inherit!

// An agent file's name, model, description and tool count (0 when it lists none, so it gets every tool).
export function readAgent(text: string, fallbackName: string): Agent | null {
  const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1]
  if (block === undefined) return null
  const field = (key: string) => new RegExp(`^${key}:[ \\t]*(.+?)[ \\t]*$`, 'm').exec(block)?.[1]?.replace(/^(["'])(.*)\1$/, '$2')
  const model = field('model')?.toLowerCase()
  const tools = field('tools')
  return {
    name: field('name') ?? fallbackName,
    model: model && MODEL_ORDER.includes(model) ? model : 'inherit',
    description: field('description') ?? '',
    tools: tools ? tools.split(',').filter(tool => tool.trim()).length : 0,
  }
}

export const groupAgents = (agents: Agent[]) =>
  MODEL_ORDER.map(model => ({ model, agents: agents.filter(agent => agent.model === model).sort((a, b) => a.name.localeCompare(b.name)) })).filter(group => group.agents.length > 0)
