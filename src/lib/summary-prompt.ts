// GitHub issue #30 tier 2: on-device model writes a short card title.
// Pure helpers (prompt, sanitizer, policy) so they are testable without RN.
import { hasHeuristic, isGeneric } from "./tool-title.ts"

type Input = Record<string, unknown>

const MAX_INPUT = 300
const MAX_WORDS = 12
const MAX_CHARS = 80

function record(v: unknown): Input {
  return typeof v === "object" && v !== null ? (v as Input) : {}
}

function clip(text: string, max = MAX_INPUT): string {
  const one = text.replace(/\s+/g, " ").trim()
  return one.length > max ? `${one.slice(0, max - 1)}…` : one
}

// Compact, output-free description of the call. Undefined = nothing to summarize.
export function compactInput(tool: string | undefined, raw: unknown): string | undefined {
  if (!tool) return undefined
  const input = record(raw)
  const pick = (key: string) => (typeof input[key] === "string" && input[key].trim() ? (input[key] as string) : undefined)
  if (tool === "bash") {
    const command = pick("command")
    return command ? clip(command) : undefined
  }
  if (tool === "grep" || tool === "glob") {
    const pattern = pick("pattern")
    if (!pattern) return undefined
    const path = pick("path")
    return clip(path ? `${pattern} in ${path}` : pattern)
  }
  if (tool === "webfetch") {
    const url = pick("url")
    return url ? clip(url) : undefined
  }
  if (Object.keys(input).length === 0) return undefined
  return clip(JSON.stringify(input))
}

export function buildMessages(tool: string, compact: string): { role: "system" | "user"; content: string }[] {
  return [
    {
      role: "system",
      content:
        "You label tool calls of a coding agent. Reply with ONE short phrase, at most 8 words, present tense, no quotes, no trailing period. Example: Runs ESLint with auto-fix",
    },
    { role: "user", content: `Tool: ${tool}\nInput: ${compact}` },
  ]
}

// Model output -> card title, or undefined when unusable (caller keeps fallback).
export function sanitize(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  const line = raw.split("\n").find((l) => l.trim())
  if (!line) return undefined
  const text = line
    .replace(/^["'`*\s]+|["'`*\s]+$/g, "")
    .replace(/[.。]+$/, "")
    .replace(/\s+/g, " ")
    .trim()
  if (!text || text.length > MAX_CHARS) return undefined
  if (text.split(" ").length > MAX_WORDS) return undefined
  return text
}

// Should this card get a model summary? `always` (testing) overrides tier 1.
export function wantsSummary(opts: {
  tool: string | undefined
  serverTitle: string | undefined
  input: unknown
  always: boolean
}): boolean {
  const { tool, serverTitle, input, always } = opts
  if (!tool || !isGeneric(serverTitle, tool)) return false
  if (compactInput(tool, input) === undefined) return false
  return always || !hasHeuristic(tool, input)
}
