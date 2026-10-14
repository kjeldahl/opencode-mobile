import { test } from "node:test"
import assert from "node:assert/strict"
import { reasoningView } from "./reasoning.ts"

test("one short line is inline", () => {
  assert.deepEqual(reasoningView("  Checking the config file.  "), { short: true, title: "Checking the config file." })
})

test("long single line collapses, title is the line", () => {
  const line = "a".repeat(81)
  assert.deepEqual(reasoningView(line), { short: false, title: line })
})

test("multi-line collapses, title is first non-empty line without markdown", () => {
  assert.deepEqual(reasoningView("\n**Planning the fix**\n\nFirst I will read the store."), {
    short: false,
    title: "Planning the fix",
  })
  assert.deepEqual(reasoningView("## Heading\nbody"), { short: false, title: "Heading" })
})

test("empty text has empty title", () => {
  assert.deepEqual(reasoningView(""), { short: true, title: "" })
})
