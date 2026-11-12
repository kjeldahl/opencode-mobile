// Permission + interrupt round trip against a REAL opencode 2.x server.
// Run against a server whose config asks before running shell commands.
//
// Usage: node scripts/v2-live-permission.ts <baseUrl> <username> <password> <directory>
import { createV2Client, V2EventTranslator } from "../src/lib/sdk-v2.ts"
import { detectServerMajor } from "../src/lib/server-version.ts"
import type { Event } from "../src/lib/sdk.ts"

const base = (process.argv[2] ?? "http://127.0.0.1:4197").replace(/\/+$/, "")
const auth = { username: process.argv[3] ?? "opencode", password: process.argv[4] ?? "forge-test-pass" }
const directory = process.argv[5] ?? "/tmp/permtest"

const controller = new AbortController()

function stream(signal: AbortSignal): AsyncGenerator<Event> {
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
            // ignore
          }
        }
      }
    }
  })()
}

console.log("detected:", await detectServerMajor({ baseUrl: base, auth }, { force: true }))
const client = createV2Client({ baseUrl: base, directory, auth }, (signal) => stream(signal ?? controller.signal))

const seen: Event[] = []
void (async () => {
  for await (const event of client.global.events(controller.signal)) seen.push(event)
})().catch(() => {})

const session = await client.session.create({ title: `permission-check ${Date.now()}` })
console.log("session:", session.id)
await client.session.prompt(session.id, {
  parts: [{ type: "text", text: "Use your shell tool to run: echo hello-from-permission-check. Then say DONE." }],
})

const waited = (ms: number) => {
  const started = Date.now()
  return () => Date.now() - started < ms
}

// Wait for the permission request the server raises when it wants to run a tool.
const pending = await (async () => {
  const still = waited(60_000)
  for (;;) {
    const list = await client.permission.list()
    if (list.length) return list[0]
    if (!still()) throw new Error("no permission request within 60s")
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
})()

console.log("asked:", pending.id, "action:", pending.permission, "resources:", JSON.stringify(pending.patterns))
console.log("replying once…")
await client.permission.reply(pending.id, "once")

const still = waited(90_000)
for (;;) {
  // A single run can raise more than one request (the agent re-asks after an
  // interrupt or for a second command) — keep answering whatever is pending.
  const more = await client.permission.list()
  for (const request of more) {
    console.log("answering follow-up:", request.id)
    await client.permission.reply(request.id, "once")
  }
  const messages = await client.session.messages(session.id, { limit: 10 })
  const tool = messages.flatMap((m) => m.parts).find((p) => p.type === "tool")
  const text = messages.flatMap((m) => m.parts).find((p) => p.type === "text" && p.text)
  if (tool?.state?.status === "completed" && text) {
    console.log("tool:", tool.tool, "state:", tool.state?.status, "output:", JSON.stringify(String(tool.state.output).trim().slice(0, 60)))
    console.log("text:", JSON.stringify(String(text.text).slice(0, 60)))
    break
  }
  if (!still()) {
    console.log("FAIL: tool did not complete", JSON.stringify(tool?.state))
    process.exit(1)
  }
  await new Promise((resolve) => setTimeout(resolve, 1000))
}

console.log("permission events:", seen.filter((e) => e.type.startsWith("permission")).map((e) => e.type).join(","))
controller.abort()
console.log("OK")
process.exit(0)
