import { test } from "node:test"
import assert from "node:assert/strict"
import { buildShowcaseScript, SHOWCASE_SESSION_ID } from "./showcase-script.ts"

const script = buildShowcaseScript(1_000_000)

test("showcase: user messages and turns alternate", () => {
  assert.equal(script.messages.length, 8)
  assert.deepEqual(
    script.messages.map((m) => m.role),
    ["user", "assistant", "user", "assistant", "user", "assistant", "user", "assistant"],
  )
  for (const message of script.messages) assert.equal(message.sessionID, SHOWCASE_SESSION_ID)
})

test("showcase: messages are chronologically ordered", () => {
  const times = script.messages.map((m) => m.time.created)
  assert.deepEqual(
    times,
    [...times].sort((a, b) => a - b),
  )
})

test("showcase: covers text, reasoning, and every card type the chat UI has", () => {
  const all = Object.values(script.parts).flat()
  assert.ok(all.some((p) => p.type === "text"))
  assert.ok(all.some((p) => p.type === "reasoning"))
  assert.ok(all.some((p) => p.type === "file" && p.mime?.startsWith("image/")))

  const tools = all.filter((p) => p.type === "tool")
  const names = new Set(tools.map((p) => p.tool))
  for (const name of ["bash", "read", "write", "edit", "apply_patch", "grep", "glob", "task", "todowrite", "webfetch"]) {
    assert.ok(names.has(name), `missing tool card: ${name}`)
  }
  assert.ok(tools.some((p) => p.state?.status === "error"), "showcase must include a failed tool card")
})

test("showcase: every tool call is completed or errored, never stuck pending/running", () => {
  for (const part of Object.values(script.parts).flat()) {
    if (part.type !== "tool") continue
    assert.ok(part.state?.status === "completed" || part.state?.status === "error")
    assert.ok(part.state?.time?.start && part.state?.time?.end)
    assert.ok(part.state.time.end >= part.state.time.start)
  }
})

test("showcase: diff-bearing edits are non-trivial (fold markers need unchanged context)", () => {
  const edits = Object.values(script.parts)
    .flat()
    .filter((p) => p.type === "tool" && (p.tool === "edit" || p.tool === "apply_patch"))
  assert.ok(edits.length >= 2)
  let wide = 0
  for (const edit of edits) {
    const value = (edit.state?.input as Record<string, unknown>) || {}
    const body =
      typeof value.diff === "string" ? value.diff : typeof value.patch === "string" ? value.patch : `${String(value.oldString || "")}\n${String(value.newString || "")}`
    assert.ok(body.length > 40, `diff for ${edit.id} is too small to demo the diff view`)
    // Only a patch with unchanged runs between its changes folds in the first
    // place — that is what the fold view in the showcase demonstrates.
    if (body.split("\n").filter((line) => line.startsWith(" ")).length > 6) wide++
  }
  assert.ok(wide > 0, "expected at least one patch with unchanged context to fold")
})

test("showcase: every part references a real message id", () => {
  const ids = new Set(script.messages.map((m) => m.id))
  for (const [key, list] of Object.entries(script.parts)) {
    assert.ok(ids.has(key))
    for (const part of list) assert.equal(part.messageID, key)
  }
})

test("showcase: header stats are derivable — costs and last-turn tokens are populated", () => {
  assert.ok(script.messages.filter((m) => m.role === "assistant").every((m) => (m.cost || 0) > 0))
  const last = script.messages.filter((m) => m.role === "assistant").at(-1)
  assert.ok((last?.tokens?.input || 0) > 0)
  assert.ok((last?.tokens?.output || 0) > 0)
})

test("showcase: gallery image urls are self-contained data urls", () => {
  const files = Object.values(script.parts)
    .flat()
    .filter((p) => p.type === "file")
  assert.ok(files.length >= 1)
  for (const file of files) {
    assert.ok(file.url?.startsWith("data:image/"))
    assert.ok(file.filename?.length)
  }
})

test("showcase: prompts are shaped like the live permission/question payloads", () => {
  assert.ok(script.permission.id.length > 0)
  assert.ok(script.permission.permission.length > 0)
  assert.ok(script.permission.patterns.length > 0)
  assert.ok(script.question.id.length > 0)
  assert.ok(script.question.questions.length > 0)
  for (const q of script.question.questions) {
    assert.ok(q.options.length > 0)
    for (const option of q.options) assert.ok(option.label.length > 0 && option.description.length > 0)
  }
})

test("showcase: is deterministic for a fixed `now` and relative for a moving one", () => {
  assert.deepEqual(buildShowcaseScript(42), buildShowcaseScript(42))
  const before = buildShowcaseScript(1_000_000).messages[0].time.created
  const after = buildShowcaseScript(1_000_000 + 60_000).messages[0].time.created
  assert.equal(after - before, 60_000)
})

test("showcase: the wide apply_patch renders as a folded unified diff", () => {
  const patches = Object.values(script.parts)
    .flat()
    .filter((p) => p.type === "tool" && p.tool === "apply_patch")
    .map((p) => (p.state?.input as { patch?: string }).patch || "")
  assert.ok(patches.length > 0)
  for (const body of patches) {
    assert.ok(body.includes("\n@@"), "apply_patch must be a unified diff so PatchDetail folds it")
    assert.ok(body.startsWith("--- a/"), `apply_patch needs a --- a/ header: ${body.slice(0, 24)}`)
    assert.ok(body.split("\n").length > 40, "apply_patch should be long enough to demo folding")
  }
})
