import { test } from "node:test"
import assert from "node:assert/strict"
import { estimateTokens, formatTokens } from "./tokens.ts"
import type { Part } from "./sdk.ts"

test("formatTokens", () => {
  assert.equal(formatTokens(0), "0")
  assert.equal(formatTokens(298), "298")
  assert.equal(formatTokens(1000), "1000")
  assert.equal(formatTokens(1234), "1.2k")
  assert.equal(formatTokens(9999), "10k")
  assert.equal(formatTokens(10_000), "10k")
  assert.equal(formatTokens(189_400), "189k")
})

test("estimateTokens: text", () => {
  assert.equal(estimateTokens({ id: "1", messageID: "m", type: "text", text: "a".repeat(40) }), 10)
})

test("estimateTokens: tool", () => {
  const part: Part = {
    id: "1",
    messageID: "m",
    type: "tool",
    state: { status: "completed", input: { a: "x" }, output: "y".repeat(20) },
  }
  assert.ok(estimateTokens(part) > 5)
})
