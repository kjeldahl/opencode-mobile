import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { createMockOpencodeServer } from "../../tests/fixtures/mock-opencode-server.ts"
import { createV2Client, mapMessage, V2EventTranslator, clearRememberedSessions } from "./sdk-v2.ts"
import { detectServerMajor, clearServerMajorCache, cachedServerMajor } from "./server-version.ts"
import type { Event, MessageWithParts } from "./sdk.ts"

const capture = (name: string) => readFileSync(fileURLToPath(new URL(`../../docs/opencode-v2-port/${name}`, import.meta.url)), "utf8")

const sample = (name: string) => JSON.parse(capture(name))

/** SSE capture -> the event objects it carries. */
const sseEvents = (name: string): Array<Record<string, unknown>> =>
  capture(name)
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice(6)))

const SAMPLE_MESSAGES = sample("sample-messages.json").data
const SAMPLE_EVENTS = sseEvents("sample-events.sse")

const AUTH = { username: "opencode", password: "forge-test-pass" }

function v2Translator(): V2EventTranslator {
  return new V2EventTranslator()
}

/** Translate the whole captured 2.0.29 chat stream. */
function replay(events: Array<Record<string, unknown>>): Event[] {
  const translator = v2Translator()
  const out: Event[] = []
  for (const event of events) out.push(...translator.translate(event as never))
  return out
}

function latestPart(events: Event[], messageID: string): Record<string, unknown> | undefined {
  for (const event of [...events].reverse()) {
    const part = (event.properties as { part?: Record<string, unknown> }).part
    if (part?.messageID === messageID) return part
  }
  return undefined
}

// --- message mapping ---------------------------------------------------------

test("mapMessage: a captured user entry becomes a user message with one text part", () => {
  const user = SAMPLE_MESSAGES.find((m: Record<string, unknown>) => m.type === "user")
  const mapped = mapMessage(user as never, "ses_sample")
  assert.equal(mapped.info.id, user.id)
  assert.equal(mapped.info.sessionID, "ses_sample")
  assert.equal(mapped.info.role, "user")
  assert.equal(mapped.parts.length, 1)
  assert.equal(mapped.parts[0].id, `${user.id}:text:0`)
  assert.match(mapped.parts[0].text ?? "", /number of entries/)
})

test("mapMessage: a captured assistant entry becomes reasoning/tool/text parts", () => {
  const assistant = SAMPLE_MESSAGES.find(
    (m: Record<string, unknown>) => m.type === "assistant" && JSON.stringify(m.content).includes('"tool"'),
  )
  const mapped = mapMessage(assistant as never, "ses_sample")
  assert.equal(mapped.info.role, "assistant")
  assert.equal(mapped.info.agent, "build")
  assert.equal(mapped.info.modelID, "work")
  assert.equal(mapped.info.providerID, "dgx")

  const kinds = mapped.parts.map((p) => p.type)
  assert.deepEqual(kinds, ["reasoning", "tool"])

  const tool = mapped.parts.find((p) => p.type === "tool")
  assert.equal(tool?.id, `${assistant.id}:tool:call_792d2014cdc9167a91e4dc28`)
  assert.equal(tool?.callID, "call_792d2014cdc9167a91e4dc28")
  // 2.x renamed `shell`; the UI's tool renderers still key off `bash`.
  assert.equal(tool?.tool, "bash")
  assert.equal(tool?.state?.status, "completed")
  assert.deepEqual(tool?.state?.input, { command: "ls" })
  assert.match(String(tool?.state?.output), /CLAUDE\.md/)
})

test("mapMessage: part ids match the ids the streaming translator synthesises", () => {
  // The transcript refetch after a live run must not duplicate parts, so both
  // sides have to derive the same id.
  const translator = v2Translator()
  const messageID = "msg_stream"
  const events = replayEvents(translator, [
    ["session.step.started", { sessionID: "s", assistantMessageID: messageID, agent: "build", model: { id: "work", providerID: "dgx" } }],
    ["session.reasoning.started", { sessionID: "s", assistantMessageID: messageID, ordinal: 0 }],
    ["session.reasoning.delta", { sessionID: "s", assistantMessageID: messageID, ordinal: 0, delta: "Hi" }],
    ["session.text.started", { sessionID: "s", assistantMessageID: messageID, ordinal: 0 }],
    ["session.text.delta", { sessionID: "s", assistantMessageID: messageID, ordinal: 0, delta: " there" }],
  ])
  const parts = [...new Set(
    events
      .filter((e) => e.type === "message.part.updated")
      .map((e) => (e.properties as { part: { id: string } }).part.id),
  )]
  assert.deepEqual(parts, [`${messageID}:reasoning:0`, `${messageID}:text:0`])

  const fetched = mapMessage(
    {
      id: messageID,
      type: "assistant",
      time: { created: 1 },
      content: [
        { type: "reasoning", text: "Hi" },
        { type: "text", text: " there" },
      ],
    } as never,
    "s",
  )
  assert.deepEqual(fetched.parts.map((p) => p.id), parts)
})

test("mapMessage: the idle marker and unknown entry types are dropped", () => {
  assert.equal(mapMessage({ id: "x", type: "idle", outcome: "succeeded" } as never, "s"), null)
  assert.equal(mapMessage({ id: "x", type: "compaction" } as never, "s"), null)
})

function replayEvents(translator: V2EventTranslator, frames: Array<[string, Record<string, unknown>]>): Event[] {
  const out = [] as Event[]
  for (const [type, data] of frames) out.push(...translator.translate({ id: `e-${type}`, created: 1, type, data } as never))
  return out
}

// --- event mapping -----------------------------------------------------------

test("V2EventTranslator: the captured chat stream ends with the text part the transcript shows", () => {
  const events = replay(SAMPLE_EVENTS)
  const created = events.find((e) => e.type === "session.created")
  assert.equal(
    (created?.properties as { info: { id: string } }).info.id,
    "ses_e3472121affe4vLPUtwHxSd4xs",
  )

  const statuses = events.filter((e) => e.type === "session.status")
  assert.deepEqual(
    statuses.map((e) => (e.properties as { status: { type: string } }).status.type),
    ["busy", "idle"],
  )

  // The last streamed text delta ("14") must have accumulated into a complete
  // part, exactly like the GET /message response for the same chat.
  const finalMessage = "msg_1cb8e4e8c001r25R4wH8JiB79T"
  const part = latestPart(events, finalMessage)
  assert.equal(part?.type, "text")
  assert.equal(part?.id, `${finalMessage}:text:0`)
  assert.equal(part?.text, "14")
})

test("V2EventTranslator: deltas accumulate; the ended frame's authoritative text wins", () => {
  const events = replayEvents(new V2EventTranslator(), [
    ["session.text.started", { sessionID: "s", assistantMessageID: "m", ordinal: 0 }],
    ["session.text.delta", { sessionID: "s", assistantMessageID: "m", ordinal: 0, delta: "He" }],
    ["session.text.delta", { sessionID: "s", assistantMessageID: "m", ordinal: 0, delta: "llo" }],
    ["session.text.ended", { sessionID: "s", assistantMessageID: "m", ordinal: 0, text: "Hello!" }],
  ])
  const last = latestPart(events, "m")
  assert.equal(last?.text, "Hello!")
})

test("V2EventTranslator: reasoning deltas stream into a reasoning part", () => {
  const events = replayEvents(new V2EventTranslator(), [
    ["session.reasoning.started", { sessionID: "s", assistantMessageID: "m", ordinal: 0 }],
    ["session.reasoning.delta", { sessionID: "s", assistantMessageID: "m", ordinal: 0, delta: "thin" }],
    ["session.reasoning.delta", { sessionID: "s", assistantMessageID: "m", ordinal: 0, delta: "king" }],
  ])
  const part = latestPart(events, "m")
  assert.equal(part?.type, "reasoning")
  assert.equal(part?.text, "thinking")
})

test("V2EventTranslator: tool events become a running part, then a completed one", () => {
  const events = replayEvents(new V2EventTranslator(), [
    ["session.step.started", { sessionID: "s", assistantMessageID: "m", agent: "build", model: { id: "work", providerID: "dgx" } }],
    ["session.tool.input.started", { sessionID: "s", assistantMessageID: "m", id: "c1", name: "shell" }],
    ["session.tool.input.ended", { sessionID: "s", assistantMessageID: "m", id: "c1", text: '{"command":"ls"}' }],
    ["session.tool.success", { sessionID: "s", assistantMessageID: "m", id: "c1", content: [{ type: "text", text: "out" }] }],
  ])
  const part = latestPart(events, "m")
  assert.equal(part?.type, "tool")
  assert.equal(part?.tool, "bash")
  assert.equal(part?.state?.status, "completed")
  assert.equal((part?.state?.output as string), "out")

  const running = events.find((e) => {
    const p = (e.properties as { part?: { state?: { status?: string } } }).part
    return p?.state?.status === "running"
  })
  assert.ok(running)
})

test("V2EventTranslator: a user inbox item replaces the optimistic message", () => {
  const events = replayEvents(new V2EventTranslator(), [
    [
      "session.inbox.enqueued",
      { sessionID: "s", inboxID: "msg_u1", item: { type: "user", payload: { text: "run ls" }, delivery: "steer" } },
    ],
    ["session.inbox.delivered", { sessionID: "s", inboxID: "msg_u1" }],
  ])
  const updated = events.find((e) => e.type === "message.updated")
  assert.equal((updated?.properties as { info: { id: string; role: string } }).info.id, "msg_u1")
  assert.equal((updated?.properties as { info: { role: string } }).info.role, "user")
  const part = (events.find((e) => e.type === "message.part.updated")?.properties as { part: { text: string } }).part
  assert.equal(part.text, "run ls")
})

test("V2EventTranslator: execution failure surfaces session.error plus idle", () => {
  const events = replayEvents(new V2EventTranslator(), [
    ["session.execution.failed", { sessionID: "s", error: { message: "boom" } }],
  ])
  assert.deepEqual(events.map((e) => e.type), ["session.error", "session.status"])
  assert.equal((events[0].properties as { error: { message: string } }).error.message, "boom")
  assert.equal((events[1].properties as { status: { type: string } }).status.type, "idle")
})

test("V2EventTranslator: permission.asked maps onto the 1.x prompt shape", () => {
  const events = replay(sseEvents("sample-permission-events.sse"))
  const event = events.find((e) => e.type === "permission.asked")
  const props = event?.properties as Record<string, unknown>
  assert.equal(props.permission, "shell")
  assert.deepEqual(props.patterns, ["echo hello"])
  assert.ok((props.tool as { messageID: string }).messageID)
})

test("V2EventTranslator: form.created maps onto question.asked with answer keys", () => {
  const events = replay(sseEvents("sample-form-events.sse"))
  const event = events.find((e) => e.type === "question.asked")
  const props = event?.properties as {
    id: string
    sessionID: string
    questions: Array<{ header: string; question: string; options: Array<{ label: string }> }>
    keys: string[]
  }
  assert.ok(props.id.startsWith("frm_"))
  assert.equal(props.keys[0], "q0")
  assert.equal(props.questions[0].header, "Logo color")
  assert.deepEqual(
    props.questions[0].options.map((o) => o.label),
    ["Red", "Blue"],
  )
})

// --- version detection -------------------------------------------------------

test("detectServerMajor: 2.x JSON is v2", async () => {
  clearServerMajorCache()
  const mock = createMockOpencodeServer({ port: 4211, apiVersion: "v2" })
  await mock.listen()
  try {
    assert.equal(await detectServerMajor({ baseUrl: mock.url, auth: AUTH }, { force: true }), "v2")
  } finally {
    await mock.close()
  }
})

test("detectServerMajor: a 1.x server answering with HTML stays v1", async () => {
  clearServerMajorCache()
  const { createServer } = await import("node:http")
  const html = createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/html" })
    res.end("<!doctype html><title>opencode</title>")
  })
  await new Promise<void>((resolve) => html.listen(4212, "127.0.0.1", resolve))
  try {
    assert.equal(await detectServerMajor({ baseUrl: "http://127.0.0.1:4212", auth: AUTH }, { force: true }), "v1")
  } finally {
    await new Promise((resolve) => html.close(resolve))
  }
})

test("detectServerMajor: a 1.x server that 404s the probe is v1", async () => {
  clearServerMajorCache()
  const mock = createMockOpencodeServer({ port: 4213 })
  await mock.listen()
  try {
    assert.equal(await detectServerMajor({ baseUrl: mock.url, auth: AUTH }, { force: true }), "v1")
  } finally {
    await mock.close()
  }
})

test("detectServerMajor: a waking forge workspace gets no verdict", async () => {
  clearServerMajorCache()
  const { createServer } = await import("node:http")
  const waking = createServer((_req, res) => {
    res.writeHead(503, { "X-Forge-State": "waking", "Retry-After": "5", "Content-Type": "application/json" })
    res.end(JSON.stringify({ forge: { state: "waking" } }))
  })
  await new Promise<void>((resolve) => waking.listen(4214, "127.0.0.1", resolve))
  try {
    // Must not settle on v1: the same URL answers 2.x once it is awake.
    assert.equal(cachedServerMajor({ baseUrl: "http://127.0.0.1:4214", auth: AUTH }), undefined)
    await detectServerMajor({ baseUrl: "http://127.0.0.1:4214", auth: AUTH }, { force: true })
    assert.equal(cachedServerMajor({ baseUrl: "http://127.0.0.1:4214", auth: AUTH }), undefined)
  } finally {
    await new Promise((resolve) => waking.close(resolve))
  }
})

// --- client round trips against the 2.x mock ---------------------------------

async function* openEvents(url: string, signal: AbortSignal): AsyncGenerator<Event> {
  const translator = new V2EventTranslator()
  const response = await fetch(`${url}/api/event`, { signal, headers: { Authorization: `Basic ${btoa("opencode:forge-test-pass")}` } })
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const frames = buffer.split("\n\n")
    buffer = frames.pop() ?? ""
    for (const frame of frames) {
      for (const line of frame.split("\n")) {
        if (!line.startsWith("data: ")) continue
        yield* translator.translate(JSON.parse(line.slice(6)))
      }
    }
  }
}

/** Polls a (possibly async) predicate until it yields a defined value. */
async function waitFor<T>(what: () => T | undefined | Promise<T | undefined>, ms = 3000): Promise<T> {
  const started = Date.now()
  for (;;) {
    const value = await what()
    if (value) return value
    if (Date.now() - started > ms) throw new Error("timed out waiting for condition")
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

let nextPort = 4230

/**
 * Boots the 2.x mock, builds a client whose event stream is translated through
 * V2EventTranslator, and records every translated event. The stream is aborted
 * and the server closed afterwards, so no test leaves a connection open.
 */
async function withV2Mock<T>(run: (ctx: { url: string; mock: ReturnType<typeof createMockOpencodeServer>; client: ReturnType<typeof createV2Client>; seen: Event[] }) => Promise<T>): Promise<T> {
  const port = nextPort++
  const mock = createMockOpencodeServer({ port, apiVersion: "v2" })
  await mock.listen()
  const controller = new AbortController()
  const seen: Event[] = []
  const client = createV2Client({ baseUrl: mock.url, directory: "/tmp", auth: AUTH }, (signal) => openEvents(mock.url, signal ?? controller.signal))
  const pump = (async () => {
    for await (const event of client.global.events(controller.signal)) seen.push(event)
  })()
  pump.catch(() => {})
  // The mock only broadcasts to sockets that are already attached, so tests
  // that script an ask must not race the stream opening.
  await waitFor(() => (mock.v2?.connected() ? mock.v2.connected() : undefined))
  try {
    return await run({ url: mock.url, mock, client, seen })
  } finally {
    controller.abort()
    await Promise.race([pump.catch(() => {}), new Promise((resolve) => setTimeout(resolve, 200))])
    await mock.close()
  }
}

test("client: creates a session, streams the reply, and ends idle", async () => {
  clearServerMajorCache()
  await withV2Mock(async ({ client, seen }) => {
    const session = await client.session.create({ title: "streaming" })
    assert.ok(session.id.startsWith("ses_"))
    assert.equal(session.directory, "/tmp")

    await client.session.prompt(session.id, { parts: [{ type: "text", text: "how many files?" }] })

    const messages = await waitFor(async () => {
      const list = await client.session.messages(session.id, { limit: 10 })
      return list.some((m) => m.info.role === "assistant") ? list : undefined
    })

    // newest-first paging comes back oldest-first to the stores
    assert.deepEqual(
      messages.map((m) => m.info.role),
      ["user", "assistant"],
    )
    const parts = messages.find((m) => m.info.role === "assistant")!.parts
    assert.deepEqual(
      parts.map((p) => p.type),
      ["reasoning", "tool", "text"],
    )
    assert.equal(parts.find((p) => p.type === "tool")?.tool, "bash")

    // The granular stream must land on the events the stores dispatch on.
    await waitFor(() => seen.find((e) => e.type === "session.status" && (e.properties as { status: { type: string } }).status.type === "idle"))
    assert.ok(seen.some((e) => e.type === "session.created"))
    assert.ok(seen.some((e) => e.type === "message.updated"))
    assert.ok(seen.some((e) => e.type === "message.part.updated"))
  })
})

test("client: refresh picks up parts delivered while the stream was down", async () => {
  clearServerMajorCache()
  await withV2Mock(async ({ client }) => {
    const session = await client.session.create({ title: "reconnect" })
    await client.session.prompt(session.id, { parts: [{ type: "text", text: "count them" }] })
    const list = await waitFor(async () => {
      const fetched = await client.session.messages(session.id)
      return fetched.some((m) => m.info.role === "assistant") ? fetched : undefined
    })
    const assistant = list.find((m) => m.info.role === "assistant")!
    assert.ok(assistant.parts.some((p) => p.type === "text" && (p.text ?? "").length > 0))
  })
})

test("client: revert stages and unstages the session", async () => {
  clearServerMajorCache()
  await withV2Mock(async ({ client }) => {
    const session = await client.session.create({ title: "revert" })
    const staged = await client.session.revert(session.id, "msg_1")
    assert.equal(staged.revert?.messageID, "msg_1")
    const restored = await client.session.unrevert(session.id)
    assert.equal(restored.revert, undefined)
  })
})

test("client: provider and agent catalogues map onto the 1.x shapes", async () => {
  clearServerMajorCache()
  await withV2Mock(async ({ client }) => {
    const providers = await client.provider.list()
    assert.equal(providers.all[0]?.id, "mock")
    assert.equal(providers.connected.includes("mock"), true)
    const model = providers.all[0]?.models["mock-model"]
    assert.equal(model?.reasoning, true)
    assert.deepEqual(Object.keys(model?.variants ?? {}), ["low", "high"])
    assert.equal(providers.default.mock, "mock-model")

    const agents = await client.agent.list()
    assert.equal(agents[0]?.name, "build")
    const commands = await client.command.list()
    assert.equal(commands[0]?.name, "review")
  })
})

test("client: vcs and file listings map onto the 1.x shapes", async () => {
  clearServerMajorCache()
  await withV2Mock(async ({ client }) => {
    const vcs = await client.vcs.get()
    assert.equal(vcs.branch, "mock-branch")
    assert.equal(vcs.default_branch, "main")
    const diff = await client.vcs.diff("git")
    assert.equal(diff[0]?.file, "README.md")

    const files = await client.file.list({ path: "." })
    assert.deepEqual(files.map((f) => f.name), ["src", "README.md"])
    assert.equal(files[0]?.type, "directory")
    assert.equal(await client.file.roots(), null)
  })
})

test("permission round trip: asked -> list -> reply -> replied", async () => {
  clearServerMajorCache()
  clearRememberedSessions()
  await withV2Mock(async ({ mock, client, seen }) => {
    const askedID = mock.v2?.askPermission(V2_SEED_SESSION)
    assert.ok(askedID)

    // The event is what teaches the client which session owns the request —
    // 2.x replies are session-scoped, unlike 1.x.
    const askedEvent = await waitFor(() => seen.find((e) => e.type === "permission.asked"))
    assert.equal((askedEvent.properties as { id: string }).id, askedID)

    const pending = await client.permission.list()
    assert.equal(pending[0]?.id, askedID)
    assert.equal(pending[0]?.permission, "shell")
    assert.deepEqual(pending[0]?.patterns, ["rm -rf /tmp/mock"])

    assert.equal(await client.permission.reply(askedID as string, "once"), true)
    await waitFor(() => seen.find((e) => e.type === "permission.replied"))
    assert.deepEqual(mock.v2?.pendingPermissions(), [])
  })
})

test("question round trip: form created -> list -> answer -> replied", async () => {
  clearServerMajorCache()
  clearRememberedSessions()
  await withV2Mock(async ({ mock, client, seen }) => {
    const formID = mock.v2?.askForm(V2_SEED_SESSION)
    assert.ok(formID)

    const asked = await waitFor(() => seen.find((e) => e.type === "question.asked"))
    const props = asked.properties as { id: string; questions: Array<{ options: Array<{ label: string }> }> }
    assert.equal(props.id, formID)
    assert.deepEqual(
      props.questions[0].options.map((o) => o.label),
      ["Red", "Blue"],
    )

    const pending = await client.question.list()
    assert.equal(pending[0]?.id, formID)
    assert.equal(pending[0]?.questions[0]?.header, "Logo color")

    assert.equal(await client.question.reply(formID as string, [["Red"]]), true)
    await waitFor(() => seen.find((e) => e.type === "question.replied"))
    assert.deepEqual(mock.v2?.pendingForms(), [])
  })
})

const V2_SEED_SESSION = "ses_mockv2000000000000000000"
