import { test } from "node:test"
import assert from "node:assert/strict"
import { lastAction, lastMarker, prFromTranscript, prPrompt, prReady, prView, stripMarkers } from "./pr.ts"
import type { Part } from "./sdk.ts"

const URL = "https://github.com/o/r/pull/12"
const line = (fields: string) => `Done.\n\nPR_STATUS ${fields}`
const text = (messageID: string, value: string): Part => ({ id: `${messageID}-t`, messageID, type: "text", text: value })
const bash = (messageID: string, cmd: string, out: string): Part => ({
  id: `${messageID}-b`,
  messageID,
  type: "tool",
  tool: "bash",
  state: { status: "completed", input: { command: cmd }, output: out },
})

test("lastMarker parses the last status line", () => {
  const value = `PR_STATUS branch=a url=${URL} state=open checks=pending\nmore\nPR_STATUS branch=a url=${URL} state=open checks=passing`
  assert.deepEqual(lastMarker(value), { url: URL, number: 12, state: "open", checks: "passing", branch: "a" })
})

test("lastMarker ignores lines without a pull request url and unknown values", () => {
  assert.equal(lastMarker("PR_STATUS url=<pull request url> state=open"), undefined)
  assert.deepEqual(lastMarker(`PR_STATUS url=${URL} state=weird checks=??`), {
    url: URL,
    number: 12,
    state: "open",
    checks: "unknown",
    branch: undefined,
  })
})

test("stripMarkers hides status lines only", () => {
  assert.equal(stripMarkers(line(`url=${URL} checks=passing`)), "Done.")
  assert.equal(stripMarkers("no marker"), "no marker")
  assert.equal(stripMarkers(`a\nPR_STATUS url=${URL}\nb`), "a\nb")
})

test("prFromTranscript takes the newest status for the branch", () => {
  const messages = [
    { id: "m1", role: "assistant" },
    { id: "m2", role: "user" },
    { id: "m3", role: "assistant" },
    { id: "m4", role: "assistant" },
  ]
  const parts = {
    m1: [text("m1", line(`branch=feat url=${URL} state=open checks=failing`))],
    m2: [text("m2", line(`branch=feat url=${URL} state=merged`))],
    m3: [text("m3", line(`branch=feat url=${URL} state=open checks=passing`))],
    m4: [text("m4", line(`branch=other url=https://github.com/o/r/pull/9 state=open checks=pending`))],
  }
  assert.equal(prFromTranscript(messages, parts, "feat")?.checks, "passing")
  assert.equal(prFromTranscript(messages, parts, "other")?.number, 9)
  assert.equal(prFromTranscript(messages.slice(0, 2), parts, "feat")?.checks, "failing")
})

test("prFromTranscript falls back to the url printed by gh pr create", () => {
  const messages = [{ id: "m1", role: "assistant" }]
  const parts = { m1: [bash("m1", "git push && gh pr create --fill", `${URL}\n`)] }
  assert.deepEqual(prFromTranscript(messages, parts, "feat"), {
    url: URL,
    number: 12,
    state: "open",
    checks: "unknown",
    branch: "feat",
  })
  const other = { m1: [bash("m1", "gh pr list", `${URL}\n`)] }
  assert.equal(prFromTranscript(messages, other, "feat"), undefined)
})

test("lastAction reads the tag of the newest user message", () => {
  const messages = [
    { id: "u1", role: "user" },
    { id: "a1", role: "assistant" },
    { id: "u2", role: "user" },
  ]
  assert.equal(lastAction(messages, { u1: [text("u1", "[pr:create]\nx")], u2: [text("u2", "[pr:watch]\nx")] }), "watch")
  assert.equal(lastAction(messages, { u1: [text("u1", "[pr:create]\nx")], u2: [text("u2", "hello")] }), undefined)
})

test("prReady needs a feature branch with changes", () => {
  const diff = [{ file: "a", additions: 1, deletions: 0 }]
  assert.equal(prReady({ branch: "feat", default_branch: "main" }, diff), true)
  assert.equal(prReady({ branch: "feat", default_branch: "main" }, []), false)
  assert.equal(prReady({ branch: "main", default_branch: "main" }, diff), false)
  assert.equal(prReady(null, diff), false)
})

test("prView maps state to label, tone and actions", () => {
  const pr = { url: URL, number: 12, state: "open" as const, checks: "passing" as const }
  assert.equal(prView({ ready: false, pr: undefined, action: undefined, busy: false }), undefined)
  assert.deepEqual(prView({ ready: true, pr: undefined, action: undefined, busy: false }), {
    label: "create",
    tone: "neutral",
    canCreate: true,
    canRefresh: false,
    canWatch: false,
    canMerge: false,
  })
  assert.equal(prView({ ready: true, pr: undefined, action: "create", busy: true })?.label, "creating")
  assert.equal(prView({ ready: false, pr: undefined, action: "create", busy: true })?.label, "creating")
  assert.deepEqual(prView({ ready: false, pr, action: undefined, busy: false }), {
    label: "passing",
    tone: "success",
    canCreate: false,
    canRefresh: true,
    canWatch: false,
    canMerge: true,
  })
  const failing = prView({ ready: false, pr: { ...pr, checks: "failing" }, action: undefined, busy: false })
  assert.equal(failing?.tone, "danger")
  assert.equal(failing?.canWatch, true)
  assert.equal(failing?.canMerge, false)
  const watching = prView({ ready: false, pr: { ...pr, checks: "failing" }, action: "watch", busy: true })
  assert.equal(watching?.label, "watching")
  assert.equal(watching?.canWatch, false)
  assert.equal(watching?.canRefresh, false)
  assert.equal(prView({ ready: true, pr: undefined, action: "status", busy: true })?.canCreate, false)
  assert.equal(prView({ ready: false, pr: { ...pr, state: "merged" }, action: undefined, busy: false })?.label, "merged")
})

test("prPrompt tags the action and asks for the status line", () => {
  const prompt = prPrompt("create", { branch: "feat", base: "main" })
  assert.ok(prompt.startsWith("[pr:create]\n"))
  assert.ok(prompt.includes("gh pr create --base main"))
  assert.ok(prompt.includes("PR_STATUS branch=<branch>"))
  assert.ok(prPrompt("merge", { branch: "feat", url: URL }).includes(URL))
  assert.ok(prPrompt("watch", { branch: "feat" }).includes("branch `feat`"))
})
