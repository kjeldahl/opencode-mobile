import { test } from "node:test"
import assert from "node:assert/strict"
import { demoSessionDefault } from "./build-variant.ts"

const PR = { pr: "47", sha: "860fa02a1234567" }

test("demoSessionDefault is true for a stamped PR build", () => {
  assert.equal(demoSessionDefault(PR), true)
})

test("demoSessionDefault is false for release/main/local builds (empty stamp)", () => {
  assert.equal(demoSessionDefault({ pr: "", sha: "" }), false)
})

test("demoSessionDefault needs both pr and sha — a half-stamped build is not a PR build", () => {
  assert.equal(demoSessionDefault({ pr: "47", sha: "" }), false)
  assert.equal(demoSessionDefault({ pr: "", sha: "860fa02" }), false)
})
