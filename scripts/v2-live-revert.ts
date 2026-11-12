// What does 2.x do when an edited message is re-sent with a revert still
// staged? The app stages (revert), edits, then prompts — 2.x has a third
// operation (revert/commit) the 1.x flow never needed.
const base = process.argv[2] ?? "http://127.0.0.1:4196"
const auth = "Basic " + Buffer.from(`${process.argv[3] ?? "opencode"}:${process.argv[4] ?? "forge-test-pass"}`).toString("base64")
const dir = process.argv[5] ?? "/tmp/oc2-home"

const q = (p: string): string => `${base}${p}${p.includes("?") ? "&" : "?"}location%5Bdirectory%5D=${encodeURIComponent(dir)}`
const H = { Authorization: auth }

async function call(method: string, path: string, body?: unknown): Promise<{ status: number; json: AnyBody }> {
  const res = await fetch(q(path), {
    method,
    headers: { ...H, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  return { status: res.status, json: safe(text) as AnyBody }
}
type AnyBody = Record<string, any>

function safe(t: string): unknown { try { return JSON.parse(t) } catch { return t.slice(0, 80) } }

const created = await call("POST", "/api/session", { title: `revert-probe ${Date.now()}`, location: { directory: dir } })
const id = created.json?.data?.id ?? created.json?.id
if (!id) { console.log("create failed:", JSON.stringify(created)); process.exit(1) }
console.log("session:", id)

function waitIdle(minutes = 1) {
  return new Promise((resolve) => {
    const started = Date.now()
    const tick = async (): Promise<void> => {
      const active = await call("GET", "/api/session/active")
      if (!active.json?.data?.[id]) return resolve(true)
      if (Date.now() - started > minutes * 60_000) return resolve(false)
      setTimeout(tick, 700)
    }
    tick()
  })
}

async function prompt(text: string): Promise<void> {
  const r = await call("POST", `/api/session/${id}/prompt`, { text })
  console.log(`  prompt -> HTTP ${r.status}`)
  await waitIdle()
}

async function dump(label: string): Promise<void> {
  const { json } = await call("GET", `/api/session/${id}/message?order=asc`)
  const rows = (json?.data ?? json ?? []).map((m: any) => ({
    type: m.type,
    id: m.id.slice(-6),
    outcome: m.outcome ?? undefined,
    revert: m.revert ?? undefined,
    parts: (m.content ?? []).map((c: any) => `${c.type}${c.tool ? `:${c.tool}` : ""}${c.state ? `/${c.state.status}` : ""}`),
    text: (m.text ?? "").slice(0, 30),
  }))
  console.log(`${label}\n  ` + JSON.stringify(rows))
  const s = await call("GET", `/api/session/${id}`)
  console.log("  session.revert:", JSON.stringify(s.json?.data?.revert ?? null))
}

await prompt("Say OK. Do not use tools.")
await dump("after first prompt:")

const first = (await call("GET", `/api/session/${id}/message?order=asc`)).json?.data.find((m: any) => m.type === "user")
console.log("staging revert of user message", first.id)
console.log("  stage ->", JSON.stringify(await call("POST", `/api/session/${id}/revert/stage`, { messageID: first.id })))
await dump("after stage:")

await prompt("Say DONE. Do not use tools.")
await dump("after re-prompt (revert still staged):")

console.log("commit ->", JSON.stringify(await call("POST", `/api/session/${id}/revert/commit`)))
await dump("after commit:")

const cleared = await call("DELETE", `/api/session/${id}/revert`)
console.log("clear ->", cleared.status)
await dump("after clear:")
process.exit(0)
