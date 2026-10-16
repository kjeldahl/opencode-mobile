import { test } from "node:test"
import assert from "node:assert/strict"
import { buildRows, buildTurn, sameTurn, summarize, type Entry, type Turn } from "./turns.ts"
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
const work = (turn: Turn) => turn.segments.map((s) => s.work.map((p) => p.id))
const notes = (turn: Turn) => turn.segments.map((s) => s.text.map((p) => p.id))

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
  assert.deepEqual(work(turn), [["r1", "x1", "x2"]])
  assert.deepEqual(turn.thinking.map((p) => p.id), ["r3"])
  assert.deepEqual(turn.final.map((p) => p.id), ["t3"])
  assert.deepEqual(turn.live, [])
  assert.equal(turn.tokens, 1)
  assert.equal(turn.cost, 0.5)
  assert.equal(turn.modelID, "m3")
})

test("intermediate text stays in chat, trailing text is the answer", () => {
  const turn = buildTurn([{ message: msg("a", "assistant"), parts: [text("t1", "Let me look"), tool("x", "bash", "completed"), text("t2", "Answer")] }], false)
  assert.deepEqual(work(turn), [[], ["x"]])
  assert.deepEqual(notes(turn), [["t1"], []])
  assert.deepEqual(turn.final.map((p) => p.id), ["t2"])
})

test("intermediate text splits the work into separate segments", () => {
  const parts = [
    think("r1", "plan"),
    tool("x1", "read", "completed"),
    tool("x2", "grep", "completed"),
    text("t1", "Found it, fixing now."),
    think("r2", "how"),
    tool("x3", "edit", "completed"),
    text("t2", "Done."),
  ]
  const turn = buildTurn([{ message: msg("a", "assistant"), parts }], false)
  assert.deepEqual(turn.segments.map((s) => s.id), ["r1", "r2"])
  assert.deepEqual(work(turn), [["r1", "x1", "x2"], ["r2", "x3"]])
  assert.deepEqual(notes(turn), [["t1"], []])
  assert.deepEqual(turn.final.map((p) => p.id), ["t2"])
})

test("busy turn shows running tools live, not in the summary", () => {
  const parts = [tool("x1", "read", "completed"), tool("x2", "bash", "running")]
  const busy = buildTurn([{ message: msg("a", "assistant"), parts }], true)
  assert.deepEqual(work(busy), [["x1"]])
  assert.deepEqual(busy.live.map((p) => p.id), ["x2"])
  const idle = buildTurn([{ message: msg("a", "assistant"), parts }], false)
  assert.deepEqual(work(idle), [["x1", "x2"]])
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
  assert.deepEqual(turn.segments, [])
  assert.deepEqual(turn.final.map((p) => p.id), ["t2"])
})

test("reasoning-only segments go behind the brain toggle, not a summary", () => {
  const parts = [think("r1", "plan"), text("t1", "Looking."), think("r2", "how"), tool("x", "read", "completed"), think("r3", "done"), text("t2", "Answer")]
  const turn = buildTurn([{ message: msg("a", "assistant"), parts }], false)
  assert.deepEqual(work(turn), [[], ["r2", "x"]])
  assert.deepEqual(notes(turn), [["t1"], []])
  assert.deepEqual(turn.thinking.map((p) => p.id), ["r1", "r3"])
})

test("a running tool keeps its segment's reasoning in the work pane", () => {
  const parts = [think("r", "try"), tool("x", "bash", "running")]
  const turn = buildTurn([{ message: msg("a", "assistant"), parts }], true)
  assert.deepEqual(work(turn), [["r"]])
  assert.deepEqual(turn.live.map((p) => p.id), ["x"])
  assert.deepEqual(turn.thinking, [])
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
  const middle = [{ message: entries[0].message, parts: [text("n", "a"), ...parts] }]
  const edited = [{ message: entries[0].message, parts: [text("n", "ab"), ...parts] }]
  assert.ok(sameTurn(buildTurn(middle, false), buildTurn(middle, false)))
  assert.ok(!sameTurn(buildTurn(middle, false), buildTurn(edited, false)))
})

test("turn tokens count context growth, not re-sent input per step", () => {
  const entries: Entry[] = [
    { message: msg("u1", "user"), parts: [text("t0", "hi")] },
    { message: msg("a1", "assistant", { tokens: { input: 1000, output: 10 } }), parts: [tool("x1", "read", "completed")] },
    { message: msg("a2", "assistant", { tokens: { input: 1100, output: 20 } }), parts: [tool("x2", "read", "completed")] },
    { message: msg("a3", "assistant", { tokens: { input: 1300, output: 30, reasoning: 5 } }), parts: [text("t3", "Done.")] },
  ]
  const row = buildRows(entries, false)[1]
  assert.ok(row.kind === "turn")
  assert.equal(row.turn.tokens, 300 + 35)
})
