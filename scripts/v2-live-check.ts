// Drives the 2.x adapter (src/lib/sdk-v2.ts) against a real opencode 2.0.29
// server, end to end: detection, sessions, prompt, the live event stream, and
// the mapped transcript.
//
// Usage: node scripts/v2-live-check.ts <baseUrl> <username> <password> [directory]
import { createV2Client, V2EventTranslator } from "../src/lib/sdk-v2.ts"
import { detectServerMajor } from "../src/lib/server-version.ts"
import type { Event } from "../src/lib/sdk.ts"

const base = (process.argv[2] ?? "http://127.0.0.1:4196").replace(/\/+$/, "")
const auth = { username: process.argv[3] ?? "opencode", password: process.argv[4] ?? "" }
const directory = process.argv[5]

function streamEvents(signal: AbortSignal): AsyncGenerator<Event> {
  return (async function* () {
    const translator = new V2EventTranslator()
    const response = await fetch(`${base}/api/event`, { signal, headers: { Authorization: `Basic ${btoa(`${auth.username}:${auth.password}`)}` } })
    if (!response.ok || !response.body) throw new Error(`event stream ${response.status}`)
    const reader = response.body.getReader()
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
            // ignore malformed frames
          }
        }
      }
    }
  })()
}

const major = await detectServerMajor({ baseUrl: base, auth }, { force: true })
console.log("detected:", major)
if (major !== "v2") {
  console.log("FAIL: not a 2.x server")
  process.exit(1)
}

const controller = new AbortController()
const client = createV2Client({ baseUrl: base, directory, auth }, (signal) => streamEvents(signal ?? controller.signal))

console.log("health:", JSON.stringify(await client.global.health()))

const sessions = await client.session.list({ roots: true, limit: 5 })
console.log(`sessions: ${sessions.length}; first:`, sessions[0]?.id, JSON.stringify(sessions[0]?.title))

const created = await client.session.create({ title: `live-check ${new Date().toISOString()}` })
console.log("created:", created.id, "directory:", created.directory)

const seen: string[] = []
const pump = (async () => {
  for await (const event of client.global.events(controller.signal)) {
    if (event.type === "message.part.updated") {
      const part = (event.properties as { part: { type: string; text?: string; tool?: string; state?: { status?: string } } }).part
      seen.push(`part:${part.type}${part.tool ? `/${part.tool}` : ""}:${part.state?.status ?? ""}:${(part.text ?? "").length}`)
    } else if (event.type === "message.updated") {
      const info = (event.properties as { info: { role: string } }).info
      seen.push(`message:${info.role}`)
    } else {
      seen.push(event.type)
    }
  }
})().catch((err) => console.log("stream ended:", String(err).slice(0, 80)))

await client.session.prompt(created.id, { parts: [{ type: "text", text: "Reply with exactly OK, no tools." }] })

let done = false
for (let i = 0; i < 160 && !done; i++) {
  await new Promise((resolve) => setTimeout(resolve, 500))
  const messages = await client.session.messages(created.id, { limit: 5 })
  const assistant = messages.find((m) => m.info.role === "assistant")
  const textPart = assistant?.parts.find((p) => p.type === "text")
  if (assistant?.info.finish && textPart) {
    console.log("transcript roles:", messages.map((m) => m.info.role).join(","))
    console.log("assistant parts:", assistant.parts.map((p) => `${p.type}${p.tool ? `(${p.tool})` : ""}`).join(", "))
    console.log("assistant text:", JSON.stringify(textPart.text))
    console.log("assistant model:", assistant.info.modelID, assistant.info.providerID, "finish:", assistant.info.finish)
    done = true
  }
}

const idle = seen.filter((s) => s === "session.status").length
console.log("stream event kinds:", [...new Set(seen)].join(" | "))
console.log(`status transitions seen: ${idle}`)
controller.abort()
await pump
await client.session.delete(created.id)
console.log(done ? "OK" : "FAIL: no completed assistant reply")
process.exit(done ? 0 : 1)
