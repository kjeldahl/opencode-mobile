import type { Message } from "./sdk"
import type { Provider } from "../stores/catalog"

export interface ContextUsage {
  input: number
  output: number
  reasoning: number
  cacheRead: number
  cacheWrite: number
  total: number
  context: number
  percent: number
}

// Match TUI: last assistant message tokens (context window) vs the model's
// context limit. Unknown limit → percent 0 (neutral, no fill).
export function contextUsage(messages: Message[], providers: Provider[]): ContextUsage {
  let last: Message | null = null
  for (const msg of messages) {
    if (msg.role !== "assistant") continue
    if (msg.tokens && msg.tokens.output > 0) last = msg
  }

  const tokens = last?.tokens
  const input = tokens?.input || 0
  const output = tokens?.output || 0
  const reasoning = tokens?.reasoning || 0
  const cacheRead = tokens?.cache?.read || 0
  const cacheWrite = tokens?.cache?.write || 0
  const total = input + output + reasoning + cacheRead + cacheWrite

  let context = 0
  if (last?.providerID && last?.modelID) {
    const provider = providers.find((p) => p.id === last!.providerID)
    const model = provider?.models.find((m) => m.id === last!.modelID)
    context = model?.limit?.context || 0
  }

  const percent = context > 0 ? Math.min(100, Math.round((total / context) * 100)) : 0
  return { input, output, reasoning, cacheRead, cacheWrite, total, context, percent }
}
