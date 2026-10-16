import { describe, expect, test } from "bun:test"
import { estimateTokens, formatTokens } from "./tokens"
import type { Part } from "./sdk"

describe("formatTokens", () => {
  test("formats", () => {
    expect(formatTokens(0)).toBe("0")
    expect(formatTokens(298)).toBe("298")
    expect(formatTokens(1000)).toBe("1000")
    expect(formatTokens(1001)).toBe("1.0k")
    expect(formatTokens(1234)).toBe("1.2k")
    expect(formatTokens(9999)).toBe("10k")
    expect(formatTokens(10_000)).toBe("10k")
    expect(formatTokens(189_400)).toBe("189k")
  })
})

describe("estimateTokens", () => {
  test("text", () => {
    expect(estimateTokens({ id: "1", messageID: "m", type: "text", text: "a".repeat(40) })).toBe(10)
  })
  test("tool", () => {
    const part: Part = {
      id: "1",
      messageID: "m",
      type: "tool",
      state: { status: "completed", input: { a: "x" }, output: "y".repeat(20) },
    }
    expect(estimateTokens(part)).toBeGreaterThan(5)
  })
})
