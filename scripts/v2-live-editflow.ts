// Live check for the "edit a sent message" flow on a real 2.x server: the
// pending-revert marker must arrive over the stream (staged -> committed),
// because 2.x commits it itself when the re-sent prompt lands.
// Usage: node scripts/v2-live-editflow.ts <baseUrl> <username> <password> [directory]
import { createV2Client, V2EventTranslator } from "../src/lib/sdk-v2.ts"
import type { Event } from "../src/lib/sdk.ts"

const base = (process.argv[2] ?? "http://127.0.0.1:4196").replace(/\/+$/, "")
const auth = { username: process.argv[3] ?? "opencode", password: process.argv[4] ?? "forge-test-pass" }
const directory = process.argv[5] ?? process.cwd()

const controller = new AbortController()
function stream(signal: AbortSignal): AsyncGenerator<Event> {
  return (async function* () {
    const translator = new V2EventTranslator()
    const response = await fetch(`${base}/api/event`, { signal, headers: { Authorization: `Basic ${btoa(`${auth.username}:${auth.password}`)}` } })
    const reader = (response.body as ReadableStream<Uint8Array>).getReader()
    const decoder = new TextDecoder()
    let buffer = ""
    for (;;) {
      const { done, value } = await reader.read()
      if (done) return
      buffer += decoder.decode(value, { stream: true })
      const frames = buffer.split("\n\n")
      buffer = frames.pop() ?? ""
      for (const frame of frames) {
        for (const line of frame.split("\n")) {
          if (!line.startsWith("data: ")) continue
          try {
            yield* translator.translate(JSON.parse(line.slice(6)) as never)
          } catch {
            // ignore
          }
        }
      }
    }
  })()
}

const client = createV2Client({ baseUrl: base, directory, auth }, (signal) => stream(signal ?? controller.signal))
const seen: Event[] = []
void (async () => {
  for await (const event of client.global.events(controller.signal)) seen.push(event)
})().catch(() => {})

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const revertEvents = () => seen.filter((e) => e.type === "session.revert")
const settle = async (sessionID: string, ms = 180_000) => {
  const started = Date.now()
  for (;;) {
    const list = await client.session.messages(sessionID)
    const last = list[list.length - 1]
    if (last?.info.role === "assistant" && last.info.finish) return list
    if (Date.now() - started > ms) throw new Error("session never settled")
    await wait(1000)
  }
}

const session = await client.session.create({ title: `edit-flow ${Date.now()}` })
console.log("session:", session.id)
await client.session.prompt(session.id, { parts: [{ type: "text", text: "Say OK. Do not use tools." }] })
const first = await settle(session.id)
console.log("transcript:", first.map((m) => `${m.info.role}:${(m.parts[0]?.text ?? "").slice(0, 8)}`).join(", "))

const userMessage = first.find((m) => m.info.role === "user")
if (!userMessage) {
  console.log("FAIL: no user message to edit")
  process.exit(1)
}

// 1) "Edit message" stages the revert.
await wait(800)
seen.length = 0
await client.session.revert(session.id, userMessage.info.id)
await wait(1500)
const staged = revertEvents()
console.log("after revert():", JSON.stringify(staged.map((e) => ({ ...e.properties, revert: (e.properties as { revert?: { messageID: string } }).revert }))))
if (!staged.some((e) => (e.properties as { revert?: { messageID: string } }).revert?.messageID === userMessage.info.id)) {
  console.log("FAIL: staged revert never reached the stream")
  process.exit(1)
}

// 2) The user edits and re-sends. 2.x commits the revert without being asked.
const before = revertEvents().length
await client.session.prompt(session.id, { parts: [{ type: "text", text: "Say DONE. Do not use tools." }] })
const after = await settle(session.id)
await wait(1200)
const committed = revertEvents().slice(before)
console.log("after re-send:", JSON.stringify(committed.map((e) => ({ id: e.type, ...e.properties }))))
const cleared = committed.find((e) => (e.properties as { revert?: unknown }).revert === undefined)
if (!cleared) {
  console.log("FAIL: the committed revert never cleared the marker — the banner would stay")
  process.exit(1)
}
if ((cleared.properties as { droppedFrom?: string }).droppedFrom !== userMessage.info.id) {
  console.log("FAIL: commit did not name the first dropped message")
  process.exit(1)
}
console.log("new transcript:", after.map((m) => `${m.info.role}:${(m.parts[0]?.text ?? "").slice(0, 8)}`).join(", "))
if (after.some((m) => m.info.id === userMessage.info.id)) {
  console.log("FAIL: the edited message is still in the transcript")
  process.exit(1)
}
controller.abort()
console.log("OK")
process.exit(0)
