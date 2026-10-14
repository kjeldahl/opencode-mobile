import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import { forgePrPath, prFromForge, readForgePr, type ForgePr } from "./forge-pr.ts"
import { parseForgeState, isWorkspaceWakingError } from "./forge.ts"
import { prView } from "./pr.ts"
import { createMockOpencodeServer, DEFAULT_DIRECTORY, FORGE_PR } from "../../tests/fixtures/mock-opencode-server.ts"

const URL = "https://github.com/kjeldahl/ruby-dcb/pull/71"
const BODY = {
  directory: "/home/agent/work/ruby-dcb",
  branch: "forge/fix-readme",
  pr: { number: 71, url: URL, state: "open", draft: false, checks: "passing", failing: [] },
  checked_at: 1791990000,
}

test("forgePrPath encodes the directory and only adds refresh when asked", () => {
  assert.equal(forgePrPath("/home/agent/work/a b"), "/__forge/pr?directory=%2Fhome%2Fagent%2Fwork%2Fa+b")
  assert.equal(forgePrPath("/w", true), "/__forge/pr?directory=%2Fw&refresh=1")
})

test("prFromForge maps the response to the button's PR state", () => {
  assert.deepEqual(prFromForge(BODY), {
    url: URL,
    number: 71,
    state: "open",
    checks: "passing",
    branch: "forge/fix-readme",
    draft: false,
    failing: [],
  })
})

test("prFromForge keeps failing check names and merged/closed states", () => {
  const failing = prFromForge({ ...BODY, pr: { ...BODY.pr, checks: "failing", failing: ["lint", 3, "test"] } })
  assert.equal(failing?.checks, "failing")
  assert.deepEqual(failing?.failing, ["lint", "test"])
  assert.equal(prFromForge({ ...BODY, pr: { ...BODY.pr, state: "merged" } })?.state, "merged")
  assert.equal(prFromForge({ ...BODY, pr: { ...BODY.pr, state: "closed" } })?.state, "closed")
})

test("prFromForge: no PR, a bad url, or unknown values", () => {
  assert.equal(prFromForge({ ...BODY, pr: null }), undefined)
  assert.equal(prFromForge({ ...BODY, pr: { ...BODY.pr, url: "https://example.com/x" } }), undefined)
  const odd = prFromForge({ ...BODY, pr: { url: URL, state: "weird", checks: "??" } })
  assert.equal(odd?.number, 71)
  assert.equal(odd?.state, "open")
  assert.equal(odd?.checks, "unknown")
  assert.deepEqual(odd?.failing, [])
})

test("each check value drives the matching button view", () => {
  const view = (checks: string) =>
    prView({ ready: true, pr: prFromForge({ ...BODY, pr: { ...BODY.pr, checks } }), action: undefined, busy: false })
  assert.equal(view("pending")?.label, "pending")
  assert.equal(view("passing")?.canMerge, true)
  assert.equal(view("failing")?.canWatch, true)
  assert.equal(view("none")?.label, "none")
  assert.equal(prView({ ready: true, pr: prFromForge({ ...BODY, pr: null }), action: undefined, busy: false })?.label, "create")
})

test("readForgePr: 404 means a plain opencode server (use the transcript)", () => {
  assert.deepEqual(readForgePr(404, "Not Found"), { supported: false })
})

test("readForgePr: 200 parses, 400/502 throw with the server's error", () => {
  const ok = readForgePr(200, JSON.stringify(BODY))
  assert.equal(ok.supported, true)
  assert.equal(ok.supported && ok.pr?.number, 71)
  assert.equal(ok.supported && ok.checkedAt, 1791990000)
  assert.deepEqual(readForgePr(200, JSON.stringify({ ...BODY, pr: null })), {
    supported: true,
    branch: "forge/fix-readme",
    pr: undefined,
    checkedAt: 1791990000,
  })
  assert.throws(() => readForgePr(400, JSON.stringify({ error: "unknown directory" })), /400: unknown directory/)
  assert.throws(() => readForgePr(502, JSON.stringify({ error: "gh: not logged in" })), /502: gh: not logged in/)
  assert.throws(() => readForgePr(200, "<html>"), /invalid response/)
})

// Against the mock server over HTTP, with the same steps sdk.ts's forge.pr
// takes: the forge 503 first, then readForgePr.
async function fetchPr(base: string, directory: string, refresh?: boolean): Promise<ForgePr> {
  const response = await fetch(`${base}${forgePrPath(directory, refresh)}`)
  const body = await response.text()
  const waking = parseForgeState(response.status, response.headers, body)
  if (waking) throw waking
  return readForgePr(response.status, body)
}

const PLAIN = 45081
const FORGE = 45082
const ASLEEP = 45083
const servers = [
  createMockOpencodeServer({ port: PLAIN }),
  createMockOpencodeServer({ port: FORGE, forgePr: { [DEFAULT_DIRECTORY]: FORGE_PR } }),
  createMockOpencodeServer({ port: ASLEEP, forgeAsleep: true }),
]

before(async () => {
  await Promise.all(servers.map((s) => s.listen()))
})

after(async () => {
  await Promise.all(servers.map((s) => s.close()))
})

test("a plain opencode server falls back (404)", async () => {
  assert.deepEqual(await fetchPr(`http://localhost:${PLAIN}`, DEFAULT_DIRECTORY), { supported: false })
})

test("forge answers the PR for one of its repos, with or without refresh", async () => {
  for (const refresh of [false, true]) {
    const result = await fetchPr(`http://localhost:${FORGE}`, DEFAULT_DIRECTORY, refresh)
    assert.equal(result.supported, true)
    if (!result.supported) return
    assert.equal(result.branch, "forge/mock-branch")
    assert.equal(result.pr?.number, 71)
    assert.equal(result.pr?.checks, "pending")
  }
})

test("forge refuses a directory that is not one of its repos (400)", async () => {
  await assert.rejects(fetchPr(`http://localhost:${FORGE}`, "/etc"), /400: unknown directory/)
})

test("an asleep workspace is the typed forge error, not a failure", async () => {
  await assert.rejects(fetchPr(`http://localhost:${ASLEEP}`, DEFAULT_DIRECTORY), (error: unknown) => {
    assert.ok(isWorkspaceWakingError(error))
    assert.equal(error.state, "asleep")
    return true
  })
})
