// Demo screens reuse the live components' own provider-shaped context limits
// so SessionInfo's token/% math renders the same bars as a real session.

export interface DemoProvider {
  id: string
  name: string
  connected: boolean
  models: Array<{ id: string; name: string; reasoning: boolean; attachment: boolean; limit?: { context: number; output: number } }>
}

export const DEMO_PROVIDERS: DemoProvider[] = [
  {
    id: "anthropic",
    name: "Anthropic",
    connected: true,
    models: [{ id: "claude-opus-4-6", name: "Claude Opus 4.6", reasoning: true, attachment: true, limit: { context: 200000, output: 32000 } }],
  },
  {
    id: "github-copilot",
    name: "GitHub Copilot",
    connected: true,
    models: [{ id: "gpt-5.4", name: "GPT-5.4", reasoning: true, attachment: true, limit: { context: 195000, output: 32000 } }],
  },
]
