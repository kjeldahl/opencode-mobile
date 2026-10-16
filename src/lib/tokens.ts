import type { Part } from "./sdk.ts"

// 298, 1.2k, 10k, 189k. Context is < 1M so no M formatting.
export function formatTokens(n: number): string {
  const v = Math.max(0, Math.round(n))
  if (v <= 1000) return String(v)
  if (v < 9950) return `${(v / 1000).toFixed(1)}k`
  return `${Math.round(v / 1000)}k`
}

function chars(value: unknown): number {
  if (value === undefined || value === null) return 0
  if (typeof value === "string") return value.length
  return JSON.stringify(value)?.length ?? 0
}

// The API reports tokens per message, not per part, so estimate (~4 chars
// per token) from the content the part adds to context.
export function estimateTokens(part: Part): number {
  if (part.type === "tool") {
    const total = chars(part.state?.input) + chars(part.state?.output) + chars(part.state?.error?.message)
    return Math.ceil(total / 4)
  }
  return Math.ceil(chars(part.text) / 4)
}
