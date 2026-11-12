// Records the raw 2.x event stream across an "edit an old message" sequence:
// stage the revert, then re-prompt. The app's transcript is driven only by
// these events, so this shows what the UI can possibly see.
const base = process.argv[2] ?? "http://127.0.0.1:4196"
const auth = "Basic " + Buffer.from(`opencode:${process.argv[3] ?? "forge-test-pass"}`).toString("base64")
const dir = process.argv[4] ?? "/tmp/oc2-home"
const H = { Authorization: auth }

const res = await fetch(`${base}/api/event?location%5Bdirectory%5D=${encodeURIComponent(dir)}`, { headers: H })
const reader = (res.body as ReadableStream<Uint8Array>).getReader()
const decoder = new TextDecoder()
let buffer = ""
const events: Record<string, unknown>[] = []
const pump = (async () => {
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
          events.push(JSON.parse(line.slice(6)))
        } catch {
          /* heartbeat/comment lines are not data */
        }
      }
    }
  }
})()

async function call(method: string, path: string, body?: unknown) {
  const r = await fetch(base + path, {
    method,
    headers: { ...H, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  })
  const t = await r.text()
  try {
    return JSON.parse(t)
  } catch {
    return t
  }
}
const waitIdle = async (id: string) => {
  for (;;) {
    const a = await call("GET", "/api/session/active")
    if (!(a.data ?? a)?.[id as string]) return
    await new Promise((r) => setTimeout(r, 600))
  }
}

const created = await call("POST", "/api/session", { title: `edit-flow ${Date.now()}`, location: { directory: dir } })
const id = String((created as { data?: { id?: string } }).data?.id ?? (created as { id?: string }).id)
console.log("session:", id)

await call("POST", `/api/session/${id}/prompt`, { text: "Say OK. No tools." })
await waitIdle(String(id))
const first = ((await call("GET", `/api/session/${id}/message?order=asc`)) as { data: { type: string; id: string }[] }).data.find(
  (m) => m.type === "user",
)!
console.log("\n=== events during: stage revert of", first.id)
events.length = 0
await call("POST", `/api/session/${id}/revert/stage`, { messageID: first.id })
await new Promise((r) => setTimeout(r, 1500))
console.log(events.map((e) => JSON.stringify({ t: (e as { type?: string }).type, id: (e as { data?: Record<string, unknown> })?.data?.sessionID, keys: Object.keys((e as { data?: object }).data ?? {}) })).join("\n"))

console.log("\n=== events during: re-prompt with revert staged")
events.length = 0
await call("POST", `/api/session/${id}/prompt`, { text: "Say DONE. No tools." })
await waitIdle(id)
await new Promise((r) => setTimeout(r, 1500))
for (const e of events) {
  const data = (e as { data?: Record<string, unknown> }).data ?? {}
  const t = (e as { type?: string }).type ?? ""
  if (/inbox|revert/.test(t)) console.log(JSON.stringify(e).slice(0, 600))
  else if (/step.started|execution.succeeded/.test(t)) console.log(t)
}
console.log("\nsession:", JSON.stringify(((await call("GET", `/api/session/${id}`)) as { data?: any }).data?.revert ?? null).slice(0, 120))
reader.cancel()
process.exit(0)
