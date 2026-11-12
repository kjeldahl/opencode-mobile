// Question/form round trip against a REAL opencode 2.x server.
// Usage: node scripts/v2-live-question.ts <baseUrl> <username> <password> [directory]
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
const asked: Event[] = []
const replied: string[] = []
void (async () => {
  for await (const event of client.global.events(controller.signal)) {
    if (event.type === "question.asked") asked.push(event)
    if (event.type === "question.replied") replied.push("replied")
  }
})().catch(() => {})

const session = await client.session.create({ title: `question-check ${Date.now()}` })
console.log("session:", session.id)
await client.session.prompt(session.id, {
  parts: [{ type: "text", text: "Use your question tool to ask me ONE question: which fruit should the app icon be — apple or banana? Wait for my answer and then say thanks." }],
})

const started = Date.now()
let pending: Awaited<ReturnType<typeof client.question.list>>[number] | undefined
while (Date.now() - started < 60_000) {
  await new Promise((resolve) => setTimeout(resolve, 500))
  const list = await client.question.list()
  if (list.length) {
    pending = list[0]
    break
  }
}

if (!pending) {
  console.log("FAIL: no form/question was raised within 60s")
  process.exit(1)
}

console.log("asked:", pending.id, "header:", JSON.stringify(pending.questions[0]?.header), "options:", JSON.stringify(pending.questions[0]?.options?.map((o) => o.label)))
console.log("answered from event stream:", asked.length, "so far")
await client.question.reply(pending.id, [["Apple"]])
console.log("replied; waiting for the run to finish…")

const deadline = Date.now() + 90_000
for (;;) {
  // Any further form the agent raises while running must also be answered.
  const more = await client.question.list()
  for (const follow of more) {
    console.log("answering follow-up form:", follow.id)
    await client.question.reply(follow.id, [["Apple"]])
  }
  const messages = await client.session.messages(session.id, { limit: 10 })
  const final = messages.find((m) => m.info.role === "assistant" && m.parts.some((p) => p.type === "text"))
  if (final) {
    console.log("assistant finish:", final.info.finish, "text:", JSON.stringify((final.parts.find((p) => p.type === "text")?.text ?? "").slice(0, 80)))
    console.log("assistant messages:", messages.filter((m) => m.info.role === "assistant").length)
    break
  }
  if (Date.now() > deadline) {
    console.log("FAIL: run did not finish after answering")
    process.exit(1)
  }
  await new Promise((resolve) => setTimeout(resolve, 1000))
}
console.log("question.replied events:", replied.length)
controller.abort()
console.log("OK")
process.exit(0)
