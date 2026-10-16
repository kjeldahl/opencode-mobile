import { test } from "node:test"
import assert from "node:assert/strict"
import { buildMessages, compactInput, sanitize, wantsSummary } from "./summary-prompt.ts"

test("compactInput trims and clips, no output", () => {
  assert.equal(compactInput("bash", { command: "  ls   -la " }), "ls -la")
  assert.equal(compactInput("bash", { command: "x".repeat(500) })?.length, 300)
  assert.equal(compactInput("grep", { pattern: "TODO", path: "src" }), "TODO in src")
  assert.equal(compactInput("bash", {}), undefined)
  assert.equal(compactInput("mcp_foo", { a: 1 }), '{"a":1}')
  assert.equal(compactInput("mcp_foo", {}), undefined)
  assert.equal(compactInput(undefined, { command: "x" }), undefined)
})

test("sanitize cleans model output and rejects junk", () => {
  assert.equal(sanitize('"Runs ESLint with auto-fix."'), "Runs ESLint with auto-fix")
  assert.equal(sanitize("\n  Lists files\nextra line"), "Lists files")
  assert.equal(sanitize(""), undefined)
  assert.equal(sanitize(undefined), undefined)
  assert.equal(sanitize("a b c d e f g h i j k l m"), undefined)
  assert.equal(sanitize("x".repeat(81)), undefined)
})

test("buildMessages carries tool + input only", () => {
  const msgs = buildMessages("bash", "ls")
  assert.equal(msgs[1].content, "Tool: bash\nInput: ls")
})

test("wantsSummary: only when tier 1 misses, unless always", () => {
  const base = { serverTitle: "", always: false }
  assert.equal(wantsSummary({ ...base, tool: "bash", input: { command: "weirdtool --x" } }), true)
  assert.equal(wantsSummary({ ...base, tool: "bash", input: { command: "npm test" } }), false)
  assert.equal(wantsSummary({ ...base, always: true, tool: "bash", input: { command: "npm test" } }), true)
  assert.equal(wantsSummary({ ...base, serverTitle: "src/a.ts", tool: "edit", input: { filePath: "a" } }), false)
  assert.equal(wantsSummary({ ...base, always: true, tool: "bash", input: {} }), false)
})
