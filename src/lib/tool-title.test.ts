import { test } from "node:test"
import assert from "node:assert/strict"
import { bashTitle, cardTitle, isGeneric, toolTitle } from "./tool-title.ts"

test("bash heuristics", () => {
  assert.equal(bashTitle("npm test"), "Runs tests")
  assert.equal(bashTitle("cd app && npm run lint"), "Runs linter")
  assert.equal(bashTitle("npx eslint src --fix"), "Runs ESLint with auto-fix")
  assert.equal(bashTitle('git commit -m "fix: crash on load"'), "Commits: fix: crash on load")
  assert.equal(bashTitle("git status"), "Checks git status")
  assert.equal(bashTitle("grep -rn TODO src"), "Searches for TODO")
  assert.equal(bashTitle("npm install"), "Installs dependencies")
  assert.equal(bashTitle("weirdtool --x"), undefined)
})

test("bash prefers input.description, falls back to clipped command", () => {
  assert.equal(toolTitle("bash", { description: "Run unit tests", command: "npm test" }), "Run unit tests")
  assert.equal(toolTitle("bash", { command: "weirdtool --x" }), "weirdtool --x")
  assert.equal(toolTitle("bash", {}), undefined)
})

test("cardTitle keeps descriptive server titles", () => {
  assert.equal(cardTitle("edit", "src/a.ts", {}), "src/a.ts")
  assert.equal(cardTitle("bash", "", { command: "npm test" }), "Runs tests")
  assert.equal(cardTitle("bash", "bash", { command: "npm test" }), "Runs tests")
  assert.equal(cardTitle("read", undefined, {}), "read")
})

test("cardTitle bash: description beats server title equal to command", () => {
  assert.equal(cardTitle("bash", "npm test", { command: "npm test", description: "Run unit tests" }), "Run unit tests")
})

test("cardTitle bash: no description keeps server title", () => {
  assert.equal(cardTitle("bash", "npm test", { command: "npm test" }), "npm test")
  assert.equal(cardTitle("bash", "", { command: "npm test", description: "  " }), "Runs tests")
})

test("cardTitle other tools ignore description", () => {
  assert.equal(cardTitle("edit", "src/a.ts", { description: "x" }), "src/a.ts")
  assert.equal(cardTitle("grep", "", { pattern: "foo", description: "x" }), "Searches for foo")
})

test("isGeneric", () => {
  assert.ok(isGeneric(undefined, "bash"))
  assert.ok(isGeneric("Bash", "bash"))
  assert.ok(!isGeneric("Run tests", "bash"))
})
