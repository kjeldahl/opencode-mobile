import { test } from "node:test"
import assert from "node:assert/strict"
import { connectionBanner, connectionIndicator } from "./connection-status.ts"

test("nothing is said about a connection that never dropped", () => {
  assert.deepEqual(connectionBanner(null, 0), { kind: "none" })
})

test("a dropped stream says it is retrying, with the attempt count", () => {
  assert.deepEqual(connectionBanner(null, 3), { kind: "retrying", attempt: 3 })
})

test("a waking workspace is named as such, with its estimate", () => {
  assert.deepEqual(connectionBanner({ state: "waking", wakeSeconds: 12 }, 2), { kind: "waking", seconds: 12 })
})

test("a missing estimate still says how long, not zero", () => {
  assert.deepEqual(connectionBanner({ state: "waking" }, 0), { kind: "waking", seconds: 15 })
})

test("an asleep workspace is the same message — it is coming up", () => {
  assert.equal(connectionBanner({ state: "asleep", wakeSeconds: 30 }, 1).kind, "waking")
})

test("a workspace state outranks the retry counter", () => {
  assert.deepEqual(connectionBanner({ state: "waking", wakeSeconds: 15 }, 4), { kind: "waking", seconds: 15 })
})

test("a stopped workspace is told apart, because retrying cannot fix it", () => {
  assert.deepEqual(connectionBanner({ state: "off" }, 9), { kind: "stopped" })
})

test("fractional estimates round instead of showing '0s'", () => {
  assert.equal(connectionBanner({ state: "waking", wakeSeconds: 0.4 }, 0).seconds, 1)
})

test("the retry counter is the only trigger — a stream that never connected is not a reconnect", () => {
  assert.deepEqual(connectionBanner(null, 0), { kind: "none" })
  assert.deepEqual(connectionBanner(null, 1), { kind: "retrying", attempt: 1 })
})

test("an idle connection shows nothing", () => {
  assert.deepEqual(connectionIndicator(connectionBanner(null, 0)), { state: "none" })
})

test("a reconnect succeeding shows the restored check", () => {
  assert.deepEqual(connectionIndicator(connectionBanner(null, 0), true), { state: "restored" })
})

test("the indicator keeps the banner kind and its numbers", () => {
  assert.deepEqual(connectionIndicator(connectionBanner(null, 3)), { state: "retrying", attempt: 3 })
  assert.deepEqual(connectionIndicator(connectionBanner({ state: "waking", wakeSeconds: 9 }, 0)), {
    state: "waking", seconds: 9,
  })
  assert.deepEqual(connectionIndicator(connectionBanner({ state: "off" }, 2)), { state: "stopped" })
})

test("the restored flash never hides a live failure", () => {
  assert.equal(connectionIndicator(connectionBanner(null, 4), true).state, "retrying")
  assert.equal(connectionIndicator(connectionBanner({ state: "waking" }, 0), true).state, "waking")
  assert.equal(connectionIndicator(connectionBanner({ state: "off" }, 0), true).state, "stopped")
})
