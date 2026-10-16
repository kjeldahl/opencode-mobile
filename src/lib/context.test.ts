import { test } from "node:test"
import assert from "node:assert/strict"
import { contextUsage } from "./context.ts"
import type { Message } from "./sdk.ts"
import type { Provider } from "../stores/catalog.ts"

function assistant(tokens: Partial<NonNullable<Message["tokens"]>>): Message {
  return {
    id: "m1",
    sessionID: "s1",
    role: "assistant",
    providerID: "p1",
    modelID: "m1",
    tokens: { input: 0, output: 0, ...tokens },
  } as Message
}

const providers: Provider[] = [
  {
    id: "p1",
    name: "P",
    connected: true,
    models: [{ id: "m1", name: "M", reasoning: false, attachment: false, limit: { context: 100_000, output: 8192 } }],
  },
]

test("percent is total tokens over context limit", () => {
  const usage = contextUsage([assistant({ input: 40_000, output: 10_000, cache: { read: 1_000, write: 1_000 } })], providers)
  assert.equal(usage.total, 52_000)
  assert.equal(usage.percent, 52)
  assert.equal(usage.context, 100_000)
})

test("no assistant messages yet -> 0%", () => {
  const usage = contextUsage([], providers)
  assert.equal(usage.total, 0)
  assert.equal(usage.percent, 0)
  assert.equal(usage.context, 0)
})

test("unknown context limit -> neutral 0% but total still counted", () => {
  const usage = contextUsage([assistant({ input: 500, output: 10 })], [])
  assert.equal(usage.total, 510)
  assert.equal(usage.percent, 0)
})

test("percent is clamped at 100", () => {
  const usage = contextUsage([assistant({ input: 90_000, output: 90_000 })], providers)
  assert.equal(usage.percent, 100)
})

test("last assistant message with output>0 wins", () => {
  const usage = contextUsage(
    [assistant({ input: 80_000, output: 1 }), { ...assistant({ input: 10_000, output: 2 }), id: "m2" }],
    providers,
  )
  assert.equal(usage.total, 10_002)
  assert.equal(usage.percent, 10)
})
