import { test } from "node:test"
import assert from "node:assert/strict"
import { parseForgeState, untilAwake, WAKE_DEADLINE_MS, WorkspaceWakingError, isWorkspaceWakingError } from "./forge.ts"

const headers = (map: Record<string, string>) => ({
  get: (name: string) => map[name.toLowerCase()] ?? null,
})

const WAKING_BODY = JSON.stringify({
  error: "workspace mise-test is starting",
  forge: { workspace: "mise-test", state: "waking", wake_seconds: 15 },
})

test("a 503 marked waking is the typed error with retry-after and wake_seconds", () => {
  const error = parseForgeState(503, headers({ "x-forge-state": "waking", "retry-after": "5" }), WAKING_BODY)
  assert.ok(error)
  assert.equal(error.state, "waking")
  assert.equal(error.retryAfterMs, 5000)
  assert.equal(error.wakeSeconds, 15)
  assert.equal(error.workspace, "mise-test")
})

test("the header decides the state, and the body is never trusted over it", () => {
  const lying = JSON.stringify({ forge: { state: "off", workspace: "x", wake_seconds: 1 } })
  const error = parseForgeState(503, headers({ "x-forge-state": "waking", "retry-after": "1" }), lying)
  assert.ok(error)
  assert.equal(error.state, "waking")
  assert.equal(error.workspace, "x")
})

test("an asleep stream keeps the long Retry-After so we don't wake it by polling", () => {
  const error = parseForgeState(503, headers({ "x-forge-state": "asleep", "retry-after": "30" }), "{}")
  assert.ok(error)
  assert.equal(error.state, "asleep")
  assert.equal(error.retryAfterMs, 30_000)
})

test("a hand-stopped workspace answers off with an hour, and says nothing useful in the body", () => {
  const error = parseForgeState(503, headers({ "x-forge-state": "off", "retry-after": "3600" }), "")
  assert.ok(error)
  assert.equal(error.state, "off")
  assert.equal(error.wakeSeconds, 15)
})

test("state and retry-after are read case-insensitively and with whitespace", () => {
  const error = parseForgeState(503, headers({ "x-forge-state": "  Waking ", "retry-after": " 3 " }), "")
  assert.ok(error)
  assert.equal(error.state, "waking")
  assert.equal(error.retryAfterMs, 3000)
})

test("a missing Retry-After falls back per state instead of becoming NaN", () => {
  assert.equal(parseForgeState(503, headers({ "x-forge-state": "waking" }), "")?.retryAfterMs, 5000)
  assert.equal(parseForgeState(503, headers({ "x-forge-state": "asleep" }), "")?.retryAfterMs, 30_000)
  assert.equal(parseForgeState(503, headers({ "x-forge-state": "off" }), "")?.retryAfterMs, 3_600_000)
})

test("a junk Retry-After is ignored, never trusted as a wait", () => {
  const error = parseForgeState(503, headers({ "x-forge-state": "waking", "retry-after": "soon" }), "")
  assert.equal(error?.retryAfterMs, 5000)
})

test("a proxy that eats the header is covered by the body's state", () => {
  const error = parseForgeState(503, headers({ "retry-after": "2" }), WAKING_BODY)
  assert.ok(error)
  assert.equal(error.state, "waking")
  assert.equal(error.retryAfterMs, 2000)
  assert.equal(error.workspace, "mise-test")
})

test("the same 503 from a plain server stays a plain error", () => {
  assert.equal(parseForgeState(503, headers({}), "bad gateway"), null)
  assert.equal(parseForgeState(503, headers({ "x-forge-state": "maybe" }), "{}"), null)
})

test("only a 503 can carry a forge state", () => {
  for (const status of [200, 401, 500, 502, 504]) {
    assert.equal(parseForgeState(status, headers({ "x-forge-state": "waking", "retry-after": "5" }), WAKING_BODY), null)
  }
})

test("the error names the workspace and the wait so a log says what happened", () => {
  const error = parseForgeState(503, headers({ "x-forge-state": "waking", "retry-after": "5" }), WAKING_BODY)
  assert.match(error?.message ?? "", /mise-test/)
  assert.match(error?.message ?? "", /waking/)
})

test("the guard only accepts the typed error", () => {
  const error = parseForgeState(503, headers({ "x-forge-state": "waking", "retry-after": "5" }), WAKING_BODY)
  assert.equal(isWorkspaceWakingError(error), true)
  assert.equal(isWorkspaceWakingError(new Error("boom")), false)
  assert.equal(isWorkspaceWakingError(undefined), false)
  assert.equal(isWorkspaceWakingError("waking"), false)
  assert.ok(error instanceof WorkspaceWakingError)
})

// untilAwake --------------------------------------------------------------

const sleep = async (_ms: number) => {}

test("a workspace that answers is used once, with no waiting", async () => {
  let calls = 0
  const value = await untilAwake(
    async () => {
      calls += 1
      return "ok"
    },
    { sleep, now: () => 0 },
  )
  assert.equal(value, "ok")
  assert.equal(calls, 1)
})

test("a waking workspace is retried at Retry-After and reported the whole way", async () => {
  let clock = 0
  let calls = 0
  const waited: number[] = []
  const states: string[] = []

  const value = await untilAwake(
    async () => {
      calls += 1
      if (calls < 3) {
        const error = parseForgeState(503, headers({ "x-forge-state": "waking", "retry-after": "5" }), WAKING_BODY)
        assert.ok(error)
        throw error
      }
      return "ready"
    },
    {
      sleep: async (ms) => {
        waited.push(ms)
        clock += ms
      },
      now: () => clock,
      onState: (info) => {
        states.push(info.state)
        assert.equal(info.wakeSeconds, 15)
      },
    },
  )

  assert.equal(value, "ready")
  assert.equal(calls, 3)
  assert.deepEqual(waited, [5000, 5000])
  assert.deepEqual(states, ["waking", "waking"])
})

test("the deadline is the promise to the user: two minutes, then the last error", async () => {
  let calls = 0
  let clock = 0
  const error = await untilAwake(
    async () => {
      calls += 1
      const waking = parseForgeState(503, headers({ "x-forge-state": "waking", "retry-after": "10" }), WAKING_BODY)
      assert.ok(waking)
      throw waking
    },
    { sleep: async (ms) => { clock += ms }, now: () => clock },
  ).catch((e) => e)

  assert.ok(isWorkspaceWakingError(error))
  assert.equal(calls, WAKE_DEADLINE_MS / 10_000 + 1)
  assert.equal(clock, WAKE_DEADLINE_MS)
})

test("the last wait is clipped so the deadline is never overshot", async () => {
  let clock = 0
  const waited: number[] = []
  const error = await untilAwake(
    async () => {
      const waking = parseForgeState(503, headers({ "x-forge-state": "waking", "retry-after": "10" }), WAKING_BODY)
      assert.ok(waking)
      throw waking
    },
    {
      sleep: async (ms) => {
        waited.push(ms)
        clock += ms
      },
      now: () => clock,
      deadlineMs: 100,
    },
  ).catch((e) => e)

  assert.ok(isWorkspaceWakingError(error))
  assert.deepEqual(waited, [100])
  assert.equal(clock, 100)
})

test("a stopped workspace is not retried — only the hub can start it", async () => {
  let calls = 0
  const error = await untilAwake(
    async () => {
      calls += 1
      const stopped = parseForgeState(503, headers({ "x-forge-state": "off", "retry-after": "3600" }), "")
      assert.ok(stopped)
      throw stopped
    },
    { sleep, now: () => 0 },
  ).catch((e) => e)

  assert.ok(isWorkspaceWakingError(error))
  assert.equal(error.state, "off")
  assert.equal(calls, 1)
})

test("any other failure is the caller's problem immediately", async () => {
  let calls = 0
  const error = await untilAwake(
    async () => {
      calls += 1
      throw new Error("401 unauthorized")
    },
    { sleep, now: () => 0 },
  ).catch((e) => e)

  assert.match(error.message, /401/)
  assert.equal(calls, 1)
})
