import { test } from "node:test"
import assert from "node:assert/strict"
import { headline, lastUserMessageID, parsePatch, sortDiffs, splitPath, totals } from "./changes.ts"

const diff = (file: string, additions: number, deletions: number) => ({ file, additions, deletions })

test("totals sums files and line counts", () => {
  assert.deepEqual(totals([diff("a", 3, 1), diff("b", 2, 0)]), { files: 2, additions: 5, deletions: 1 })
  assert.deepEqual(totals(undefined), { files: 0, additions: 0, deletions: 0 })
})

test("headline prefers branch changes, falls back to uncommitted", () => {
  assert.deepEqual(headline([diff("a", 1, 1)], [diff("b", 9, 9), diff("c", 1, 0)]), { files: 1, additions: 1, deletions: 1 })
  assert.deepEqual(headline([], [diff("b", 9, 9)]), { files: 1, additions: 9, deletions: 9 })
  assert.deepEqual(headline(undefined, undefined), { files: 0, additions: 0, deletions: 0 })
})

test("sortDiffs orders by path without mutating", () => {
  const input = [diff("src/b.ts", 0, 0), diff("README.md", 0, 0), diff("src/a.ts", 0, 0)]
  assert.deepEqual(sortDiffs(input).map((d) => d.file), ["README.md", "src/a.ts", "src/b.ts"])
  assert.equal(input[0].file, "src/b.ts")
})

test("lastUserMessageID skips assistant and optimistic messages", () => {
  const messages = [
    { id: "msg_1", role: "user" },
    { id: "msg_2", role: "assistant" },
    { id: "msg_3", role: "user" },
    { id: "msg_4", role: "assistant" },
    { id: "temp-5", role: "user" },
  ]
  assert.equal(lastUserMessageID(messages), "msg_3")
  assert.equal(lastUserMessageID([{ id: "msg_1", role: "assistant" }]), undefined)
})

test("splitPath separates directory and name", () => {
  assert.deepEqual(splitPath("src/lib/a.ts"), { dir: "src/lib/", name: "a.ts" })
  assert.deepEqual(splitPath("a.ts"), { dir: "", name: "a.ts" })
})

test("parsePatch reads a git diff, dropping file headers", () => {
  const patch = [
    "diff --git a/src/a.ts b/src/a.ts",
    "index 1111111..2222222 100644",
    "--- a/src/a.ts",
    "+++ b/src/a.ts",
    "@@ -1,3 +1,3 @@",
    " keep",
    "-old",
    "+new",
    "\\ No newline at end of file",
  ].join("\n")
  assert.deepEqual(parsePatch(patch), [
    { type: "context", text: "@@ -1,3 +1,3 @@" },
    { type: "context", text: "keep" },
    { type: "remove", text: "old" },
    { type: "add", text: "new" },
  ])
})

test("parsePatch reads jsdiff output and keeps removed lines that look like headers", () => {
  const patch = [
    "Index: a.md",
    "===================================================================",
    "--- a.md",
    "+++ a.md",
    "@@ -1,2 +1,1 @@",
    "--- a yaml rule",
    "+++ added",
    "",
  ].join("\n")
  assert.deepEqual(parsePatch(patch), [
    { type: "context", text: "@@ -1,2 +1,1 @@" },
    { type: "remove", text: "-- a yaml rule" },
    { type: "add", text: "++ added" },
  ])
})

test("parsePatch handles missing patches", () => {
  assert.deepEqual(parsePatch(undefined), [])
  assert.deepEqual(parsePatch(""), [])
})
