// Interrupt + paginated-history checks against a real 2.x server.
// Usage: node scripts/v2-live-interrupt.ts <baseUrl> <username> <password> [directory]
import { createV2Client, V2EventTranslator } from "../src/lib/sdk-v2.ts"
import type { Event } from "../src/lib/sdk.ts"

const base = (process.argv[2] ?? "http://127.0.0.1:4196").replace(/\/+$/, "")
const auth = { username: process.argv[3] ?? "opencode", password: process.argv[4] ?? "forge-test-pass" }
const directory = process.argv[5]

const controller = new AbortController()
function stream(signal: AbortSignal): AsyncGenerator<Event> {
  return (async function* () {
    const translator = new V2EventTranslator()
    const response = await fetch(`${base}/api/event`, { signal, headers: { Authorization: `Basic ${btoa(`${auth.username}:${auth.password}`)}` } })
    const reader = response.body!.getReader()
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
const statuses: string[] = []
void (async () => {
  for await (const event of client.global.events(controller.signal)) {
    if (event.type === "session.status") statuses.push((event.properties as { status: { type: string } }).status.type)
    if (event.type === "session.error") console.log("session.error:", JSON.stringify(event.properties))
  }
})().catch(() => {})

const session = await client.session.create({ title: `interrupt-check ${Date.now()}` })
console.log("session:", session.id)
await client.session.prompt(session.id, {
  parts: [{ type: "text", text: "Count from 1 to 30 out loud, one number per line, in your reply text. Do not use tools." }],
})

await new Promise((resolve) => setTimeout(resolve, 2500))
console.log("aborting…", await client.session.abort(session.id))
await new Promise((resolve) => setTimeout(resolve, 3000))
console.log("status events:", statuses.join(","))

const messages = await client.session.messages(session.id, { limit: 5 })
console.log("roles:", messages.map((m) => m.info.role).join(","))
const assistant = messages.find((m) => m.info.role === "assistant")
if (assistant) {
  console.log("parts:", assistant.parts.map((p) => `${p.type}:${(p.text ?? "").length}`).join(", "))
  console.log("finish:", assistant.info.finish, "completed:", Boolean(assistant.info.time.completed))
}

const diff = await client.session.diff(session.id)
console.log("diff entries:", diff.length)

controller.abort()
console.log(statuses.includes("idle") ? "OK" : "FAIL: never went idle after abort")
process.exit(statuses.includes("idle") ? 0 : 1)
