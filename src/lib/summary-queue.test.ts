import { test } from "node:test"
import assert from "node:assert/strict"
import { createQueue } from "./summary-queue.ts"

const tick = () => new Promise((r) => setTimeout(r, 5))

test("runs serially, newest first, ignores duplicates, survives failures", async () => {
  const q = createQueue()
  const order: string[] = []
  let active = 0
  let peak = 0
  const job = (name: string, fail = false) => async () => {
    active++
    peak = Math.max(peak, active)
    await tick()
    order.push(name)
    active--
    if (fail) throw new Error("boom")
  }
  q.enqueue("a", job("a"))
  q.enqueue("b", job("b", true))
  q.enqueue("b", job("b-dup"))
  q.enqueue("c", job("c"))
  await new Promise((r) => setTimeout(r, 60))
  assert.equal(peak, 1)
  assert.deepEqual(order, ["a", "c", "b"])
  q.enqueue("b", job("b2"))
  await new Promise((r) => setTimeout(r, 20))
  assert.deepEqual(order, ["a", "c", "b", "b2"])
})

test("drops oldest past max", async () => {
  const q = createQueue(2)
  const order: string[] = []
  const job = (n: string) => async () => {
    await tick()
    order.push(n)
  }
  for (const n of ["a", "b", "c", "d", "e"]) q.enqueue(n, job(n))
  await new Promise((r) => setTimeout(r, 80))
  assert.deepEqual(order, ["a", "e", "d"])
})
