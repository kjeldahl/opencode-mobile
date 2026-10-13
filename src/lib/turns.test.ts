import { test } from "node:test"
import assert from "node:assert/strict"
import { buildRows, buildTurn, sameTurn, summarize, type Entry } from "./turns.ts"
import type { Message, Part } from "./sdk.ts"

const msg = (id: string, role: "user" | "assistant", extra: Partial<Message> = {}): Message => ({
  id,
  sessionID: "s",
  role,
  time: { created: 0 },
  ...extra,
})
const text = (id: string, value: string): Part => ({ id, messageID: "m", type: "text", text: value })
const think = (id: string, value: string): Part => ({ id, messageID: "m", type: "reasoning", text: value })
const tool = (id: string, name: string, status: "pending" | "running" | "completed" | "error", input: unknown = {}): Part => ({
  id,
  messageID: "m",
  type: "tool",
  tool: name,
  state: { status, input },
})

test("consecutive assistant messages collapse into one turn per user message", () => {
  const entries: Entry[] = [
    { message: msg("u1", "user"), parts: [text("t0", "hi")] },
    { message: msg("a1", "assistant", { tokens: { input: 10, output: 5 } }), parts: [think("r1", "hmm"), tool("x1", "edit", "error")] },
    { message: msg("a2", "assistant", { tokens: { input: 1, output: 1 }, cost: 0.5 }), parts: [tool("x2", "read", "completed")] },
    { message: msg("a3", "assistant", { modelID: "m3" }), parts: [think("r3", "ok"), text("t3", "Done.")] },
    { message: msg("u2", "user"), parts: [text("t4", "again")] },
  ]
  const rows = buildRows(entries, false)
  assert.deepEqual(rows.map((r) => `${r.kind}:${r.id}`), ["user:u1", "turn:a1", "user:u2"])
  const row = rows[1]
  assert.ok(row.kind === "turn")
  const turn = row.turn
  assert.deepEqual(turn.work.map((p) => p.id), ["r1", "x1", "x2"])
  assert.deepEqual(turn.thinking.map((p) => p.id), ["r3"])
  assert.deepEqual(turn.final.map((p) => p.id), ["t3"])
  assert.deepEqual(turn.live, [])
  assert.equal(turn.tokens, 17)
  assert.equal(turn.cost, 0.5)
  assert.equal(turn.modelID, "m3")
})

test("intermediate text goes to the work pane, trailing text stays", () => {
  const turn = buildTurn([{ message: msg("a", "assistant"), parts: [text("t1", "Let me look"), tool("x", "bash", "completed"), text("t2", "Answer")] }], false)
  assert.deepEqual(turn.work.map((p) => p.id), ["t1", "x"])
  assert.deepEqual(turn.final.map((p) => p.id), ["t2"])
})

test("busy turn shows running tools live, not in the summary", () => {
  const parts = [tool("x1", "read", "completed"), tool("x2", "bash", "running")]
  const busy = buildTurn([{ message: msg("a", "assistant"), parts }], true)
  assert.deepEqual(busy.work.map((p) => p.id), ["x1"])
  assert.deepEqual(busy.live.map((p) => p.id), ["x2"])
  const idle = buildTurn([{ message: msg("a", "assistant"), parts }], false)
  assert.deepEqual(idle.work.map((p) => p.id), ["x1", "x2"])
  assert.deepEqual(idle.live, [])
})

test("only the last turn is treated as in flight", () => {
  const entries: Entry[] = [
    { message: msg("a1", "assistant"), parts: [tool("x1", "bash", "running")] },
    { message: msg("u", "user"), parts: [] },
    { message: msg("a2", "assistant"), parts: [tool("x2", "bash", "running")] },
  ]
  const rows = buildRows(entries, true)
  assert.ok(rows[0].kind === "turn" && rows[2].kind === "turn")
  assert.deepEqual(rows[0].turn.live, [])
  assert.deepEqual(rows[2].turn.live.map((p) => p.id), ["x2"])
})

test("empty text and step markers are ignored", () => {
  const turn = buildTurn(
    [{ message: msg("a", "assistant"), parts: [{ id: "s", messageID: "a", type: "step-start" }, text("t", "  "), text("t2", "x")] }],
    false,
  )
  assert.deepEqual(turn.work, [])
  assert.deepEqual(turn.final.map((p) => p.id), ["t2"])
})

test("summary counts tools, unique files, and failures", () => {
  const work = [
    tool("1", "edit", "error", { filePath: "README.md" }),
    tool("2", "edit", "completed", { filePath: "README.md" }),
    tool("3", "read", "completed", { filePath: "a.ts" }),
    tool("4", "bash", "completed"),
    tool("5", "apply_patch", "completed", { patch: "*** Begin Patch\n*** Update File: b.ts\n*** Add File: c.ts\n*** End Patch" }),
    think("r", "hm"),
  ]
  assert.deepEqual(summarize(work), [
    { key: "tools", count: 5 },
    { key: "edited", count: 3 },
    { key: "read", count: 1 },
    { key: "ran", count: 1 },
    { key: "failed", count: 1 },
  ])
})

test("summary falls back to steps without tool calls", () => {
  assert.deepEqual(summarize([think("r", "a"), text("t", "b")]), [{ key: "steps", count: 2 }])
  assert.deepEqual(summarize([]), [])
})

test("sameTurn compares by reference", () => {
  const parts = [tool("x", "bash", "completed"), text("t", "a")]
  const entries = [{ message: msg("a", "assistant"), parts }]
  assert.ok(sameTurn(buildTurn(entries, false), buildTurn(entries, false)))
  const changed = [{ message: entries[0].message, parts: [parts[0], text("t", "ab")] }]
  assert.ok(!sameTurn(buildTurn(entries, false), buildTurn(changed, false)))
})
