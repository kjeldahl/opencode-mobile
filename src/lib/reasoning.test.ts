import { test } from "node:test"
import assert from "node:assert/strict"
import { reasoningView } from "./reasoning.ts"

test("one short line is inline", () => {
  assert.deepEqual(reasoningView("  Checking the config file.  "), { short: true, title: "Checking the config file.", body: "" })
})

test("long single line collapses, title is the line, no body", () => {
  const line = "a".repeat(81)
  assert.deepEqual(reasoningView(line), { short: false, title: line, body: "" })
})

test("multi-line collapses, title is first line without markdown, body excludes it", () => {
  assert.deepEqual(reasoningView("\n**Planning the fix**\n\nFirst I will read the store.\nThen patch."), {
    short: false,
    title: "Planning the fix",
    body: "First I will read the store.\nThen patch.",
  })
  assert.deepEqual(reasoningView("## Heading\nbody"), { short: false, title: "Heading", body: "body" })
})

test("empty text has empty title", () => {
  assert.deepEqual(reasoningView(""), { short: true, title: "", body: "" })
})
