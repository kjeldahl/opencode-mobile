// opencode **2.x** protocol stub for the adapter tests.
//
// This is the 2.x counterpart of mock-opencode-server.ts: same idea (a real
// HTTP/SSE server that only implements what the client talks to), but speaking
// the newer protocol — `/api/*` routes, `{"data": …}` envelopes,
// `?location[directory]=` scoping, newest-first cursor-paginated message lists,
// and the granular `session.*` event stream with `session.text.delta` /
// `session.reasoning.delta` / `session.tool.*` deltas.
//
// Shapes come from the captures under docs/opencode-v2-port/
// (openapi-2.0.29.json, sample-messages.json, sample-session.json,
// sample-events.sse), so the adapter is tested against real 2.0.29 bytes rather
// than a guess of them. The one thing the captures could not include — pending
// permission requests and forms — comes from a live 2.0.29 server (see
// sample-permission-events.sse / sample-form-events.sse).
import type { IncomingMessage, ServerResponse } from "node:http"
import { randomUUID } from "node:crypto"

export interface V2MockOptions {
  port: number
  failAuth?: boolean
  replyText?: string
  replyDelayMs?: number
}

// The directory the 2.x mock scopes its seeded session to. Matches the
// captured sample session's location.
export const V2_DIRECTORY = "/home/agent/work/ruby-dcb"

export const V2_SESSION_ID = "ses_mockv2000000000000000000"

interface V2MessageEntry {
  id: string
  type: string
  time?: Record<string, number>
  text?: string
  outcome?: string
  agent?: string
  model?: { id: string; providerID: string }
  content?: Array<Record<string, unknown>>
  finish?: string
  rawFinish?: string
  cost?: number
  tokens?: Record<string, unknown>
  snapshot?: { start: string; end: string; files: unknown[] }
}

interface PendingPermission {
  id: string
  sessionID: string
  action: string
  resources: string[]
  save: string[]
  source: { type: "tool"; messageID: string; id: string }
}

interface PendingForm {
  id: string
  sessionID: string
  title: string
  metadata: Record<string, unknown>
  fields: Array<Record<string, unknown>>
}

const V2_VERSION = "2.0.29-mock"
// How many transcript entries an unlimited GET /message hands back, so the
// cursor path gets exercised the way a real 2.x server exercises it.
const MESSAGE_PAGE_SIZE = 4

const DEFAULT_REPLY_TEXT = "14 — the number of entries. (mock v2 reply)"

/**
 * Wire a 2.x API surface onto an existing node http server. The caller owns
 * the server's lifecycle; this only installs a request handler.
 */
export function installV2Api(server: import("node:http").Server, options: V2MockOptions) {
  const { port, failAuth = false, replyText = DEFAULT_REPLY_TEXT, replyDelayMs = 30 } = options

  const sessions = new Map<string, { data: Record<string, unknown>; messages: V2MessageEntry[] }>()
  const sse = new Set<ServerResponse>()
  const permissions = new Map<string, PendingPermission>()
  const forms = new Map<string, PendingForm>()
  let seq = 0

  // The session every scripted reply/permission/form is attached to, so tests
  // can rely on one known id instead of creating one first.
  seedSession(V2_SESSION_ID, V2_DIRECTORY, "mock v2 session")

  function seedSession(id: string, directory: string, title: string) {
    const now = Date.now()
    sessions.set(id, {
      data: {
        id,
        projectID: "mock-project",
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { created: now, updated: now },
        title,
        location: { directory },
      },
      messages: [],
    })
  }

  function nextID(prefix: string): string {
    seq += 1
    return `${prefix}_${Date.now().toString(36)}${seq.toString(36)}`
  }

  function broadcast(event: Record<string, unknown>) {
    const line = `data: ${JSON.stringify(event)}\n\n`
    for (const res of sse) {
      try {
        res.write(line)
      } catch {
        sse.delete(res)
      }
    }
  }

  function emit(type: string, data: Record<string, unknown>, directory = V2_DIRECTORY) {
    broadcast({
      id: nextID("evt"),
      created: Date.now(),
      type,
      location: { directory },
      data,
      durable: { aggregateID: data.sessionID ?? type, seq, version: 1 },
    })
  }

  function locationDirectory(url: URL): string {
    return url.searchParams.get("location[directory]") || V2_DIRECTORY
  }

  function json(res: ServerResponse, status: number, body: unknown) {
    const data = JSON.stringify(body)
    res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) })
    res.end(data)
  }

  function data(res: ServerResponse, body: unknown, extra: Record<string, unknown> = {}) {
    json(res, 200, { location: { directory: V2_DIRECTORY }, data: body, ...extra })
  }

  function messages(sessionID: string): V2MessageEntry[] {
    return sessions.get(sessionID)?.messages ?? []
  }

  // The whole point of the v2 stream: one text reply is delivered as several
  // granular events, not a single whole-part update.
  function scriptAssistantReply(sessionID: string, directory: string) {
    const assistantID = nextID("msg")
    const userText = "Run `ls` and give me the count."
    const step = { sessionID, assistantMessageID: assistantID }

    emit("session.execution.started", step, directory)

    const entries = messages(sessionID)
    entries.unshift({ id: nextID("msg"), time: { created: Date.now() }, type: "user", text: userText })

    emit("session.inbox.enqueued", {
      inboxID: entries[0].id,
      sessionID,
      item: { type: "user", payload: { text: userText }, delivery: "steer" },
    }, directory)
    emit("session.inbox.delivered", { sessionID, inboxID: entries[0].id }, directory)

    setTimeout(() => {
      const started = Date.now()
      emit(
        "session.step.started",
        { sessionID, agent: "build", model: { id: "mock-model", providerID: "mock" }, assistantMessageID: assistantID, started },
        directory,
      )

      const reasoningChunks = ["The user wants a count. ", "I will answer directly."]
      emit("session.reasoning.started", { ...step, ordinal: 0, state: { reasoningField: "reasoning_content" } }, directory)
      for (const chunk of reasoningChunks) {
        emit("session.reasoning.delta", { ...step, ordinal: 0, delta: chunk }, directory)
      }
      const reasoningText = reasoningChunks.join("")
      emit("session.reasoning.ended", { ...step, ordinal: 0, text: reasoningText, state: { reasoningField: "reasoning_content" } }, directory)

      // A tool round trip, so the adapter's tool-part mapping is exercised too.
      const callID = nextID("call")
      emit("session.tool.input.started", { ...step, id: callID, name: "shell" }, directory)
      emit("session.tool.input.ended", { ...step, id: callID, text: '{"command":"ls"}' }, directory)
      emit("session.tool.called", { ...step, id: callID, input: { command: "ls" }, executed: false }, directory)
      emit("session.tool.success", {
        ...step,
        id: callID,
        content: [{ type: "text", text: "CLAUDE.md\nGemfile\nREADME.md\n" }],
        metadata: { status: "completed", truncated: false, exit: 0 },
        executed: false,
      }, directory)

      const textChunks = replyText.match(/.{1,12}/g) ?? [replyText]
      emit("session.text.started", { ...step, ordinal: 0 }, directory)
      for (const chunk of textChunks) {
        emit("session.text.delta", { ...step, ordinal: 0, delta: chunk }, directory)
      }
      emit("session.text.ended", { ...step, ordinal: 0, text: replyText }, directory)

      emit("session.step.streamed", step, directory)
      emit(
        "session.step.ended",
        {
          sessionID,
          assistantMessageID: assistantID,
          finish: "stop",
          rawFinish: "stop",
          cost: 0,
          tokens: { input: 10, output: 4, reasoning: 2, cache: { read: 0, write: 0 } },
          snapshot: "mock-snapshot",
          files: [],
        },
        directory,
      )
      emit("session.execution.succeeded", { sessionID }, directory)

      const content = [
        { type: "reasoning", text: reasoningText, state: { reasoningField: "reasoning_content" }, time: { created: started } },
        {
          type: "tool",
          id: callID,
          name: "shell",
          executed: false,
          state: {
            status: "completed",
            input: { command: "ls" },
            content: [{ type: "text", text: "CLAUDE.md\nGemfile\nREADME.md\n" }],
            metadata: { status: "completed", truncated: false, exit: 0 },
          },
          time: { created: started, ran: started + 5, completed: started + 10 },
        },
        { type: "text", text: replyText },
      ]
      entries.unshift({
        id: assistantID,
        time: { created: started, streamed: Date.now(), completed: Date.now() },
        type: "assistant",
        agent: "build",
        model: { id: "mock-model", providerID: "mock" },
        content,
        finish: "stop",
        rawFinish: "stop",
        cost: 0,
        tokens: { input: 10, output: 4, reasoning: 2, cache: { read: 0, write: 0 } },
        snapshot: { start: "mock-snapshot", end: "mock-snapshot", files: [] },
      })
      entries.unshift({ id: nextID("msg"), time: { created: Date.now() }, type: "idle", outcome: "succeeded" })
    }, replyDelayMs)
  }

  /**
   * Emit a `permission.asked` event for `sessionID` and keep the request
   * pending until the client replies (or `settlePermission` is called).
   */
  function askPermission(sessionID = V2_SESSION_ID, action = "shell", resource = "rm -rf /tmp/mock") {
    const request: PendingPermission = {
      id: nextID("per"),
      sessionID,
      action,
      resources: [resource],
      save: ["rm -rf /tmp/*"],
      source: { type: "tool", messageID: nextID("msg"), id: nextID("call") },
    }
    permissions.set(request.id, request)
    emit("permission.asked", {
      id: request.id,
      sessionID,
      action: request.action,
      resources: request.resources,
      save: request.save,
      source: request.source,
    })
    return request.id
  }

  /**
   * Emit a `form.created` event (the 2.x name for a question) and keep the form
   * pending until the client replies.
   */
  function askForm(sessionID = V2_SESSION_ID) {
    const form: PendingForm = {
      id: nextID("frm"),
      sessionID,
      title: "Questions",
      metadata: { kind: "question", tool: { messageID: nextID("msg"), id: nextID("call") } },
      fields: [
        {
          key: "q0",
          title: "Logo color",
          description: "What color should the logo be?",
          type: "string",
          options: [
            { value: "Red", label: "Red", description: "Use red for the logo." },
            { value: "Blue", label: "Blue", description: "Use blue for the logo." },
          ],
          custom: true,
        },
      ],
    }
    forms.set(form.id, form)
    emit("form.created", { form })
    return form.id
  }

  function readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve) => {
      let body = ""
      req.on("data", (chunk) => (body += chunk))
      req.on("end", () => resolve(body))
    })
  }

  // Mirrors how a 2.x server answers unknown routes: the web app's HTML, with a
  // 200. Tests must never mistake that for JSON.
  function html(res: ServerResponse, status: number) {
    const body = "<!doctype html><html><body>opencode 2 mock web app</body></html>"
    res.writeHead(status, { "Content-Type": "text/html; charset=utf-8", "Content-Length": Buffer.byteLength(body) })
    res.end(body)
  }

  server.on("request", async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url || "/", `http://localhost:${port}`)
    const path = url.pathname
    const method = req.method || "GET"

    if (failAuth) {
      res.setHeader("WWW-Authenticate", 'Basic realm="Secure Area"')
      return json(res, 401, { error: "Unauthorized", message: "mock-opencode-server: --fail-auth" })
    }

    if (method === "GET" && path === "/api/info") {
      return json(res, 200, {
        version: V2_VERSION,
        pid: process.pid,
        urls: [`http://127.0.0.1:${port}`],
        paths: { tmp: "/tmp/opencode-mock" },
        capabilities: { persistentPty: true },
      })
    }

    if (method === "GET" && path === "/api/event") {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" })
      res.write(`data: ${JSON.stringify({ id: nextID("evt"), type: "server.connected", data: {} })}\n\n`)
      sse.add(res)
      const heartbeat = setInterval(() => {
        try {
          res.write(": heartbeat\n\n")
        } catch {
          clearInterval(heartbeat)
        }
      }, 1000)
      req.on("close", () => {
        clearInterval(heartbeat)
        sse.delete(res)
      })
      return
    }

    if (method === "GET" && path === "/api/session") {
      const list = Array.from(sessions.values()).map((s) => s.data)
      const limit = Number(url.searchParams.get("limit") ?? "50")
      return data(res, list.slice(0, Number.isFinite(limit) ? limit : 50), { cursor: { previous: null, next: null } })
    }

    if (method === "POST" && path === "/api/session") {
      let body = ""
      req.on("data", (chunk) => (body += chunk))
      req.on("end", () => {
        const parsed = safeParse(body)
        const directory = (parsed?.location as { directory?: string } | undefined)?.directory ?? locationDirectory(url)
        const id = nextID("ses")
        seedSession(id, directory, (parsed?.title as string) ?? "mock v2 session")
        emit("session.created", {
          sessionID: id,
          slug: "mock-slug",
          version: V2_VERSION,
          projectID: "mock-project",
          location: { directory },
          subpath: "",
          title: (parsed?.title as string) ?? "mock v2 session",
        }, directory)
        data(res, sessions.get(id)?.data)
      })
      return
    }

    if (method === "GET" && path === "/api/permission/request") {
      return data(res, Array.from(permissions.values()))
    }

    if (method === "GET" && path === "/api/form") {
      return data(res, Array.from(forms.values()))
    }

    const sessionMatch = path.match(/^\/api\/session\/([^/]+)$/)
    if (sessionMatch) {
      const session = sessions.get(sessionMatch[1])
      if (!session) return json(res, 404, { _tag: "SessionNotFoundError" })
      if (method === "GET") return data(res, session.data)
      if (method === "DELETE") {
        sessions.delete(sessionMatch[1])
        res.writeHead(204)
        return res.end()
      }
      if (method === "PATCH") {
        let body = ""
        req.on("data", (chunk) => (body += chunk))
        req.on("end", () => {
          const parsed = safeParse(body)
          if (parsed?.title) session.data.title = parsed.title
          res.writeHead(204)
          res.end()
        })
        return
      }
    }

    const messageListMatch = path.match(/^\/api\/session\/([^/]+)\/message$/)
    if (messageListMatch && method === "GET") {
      const session = sessions.get(messageListMatch[1])
      if (!session) return json(res, 404, { _tag: "SessionNotFoundError" })
      const cursor = url.searchParams.get("cursor")
      // Same rule as the real 2.x server: a cursor already carries its
      // direction, so `order` must not be sent with it.
      if (cursor && url.searchParams.get("order")) {
        return json(res, 400, { _tag: "InvalidCursorError", message: "Cursor cannot be combined with order" })
      }
      const order = url.searchParams.get("order") === "asc" ? "asc" : "desc"
      // The real server answers an unlimited read with a bounded page, so the
      // mock does too — otherwise "read the whole transcript" never pages and
      // the cursor path goes untested.
      const limit = Number(url.searchParams.get("limit") ?? String(MESSAGE_PAGE_SIZE))
      // The mock stores entries newest-first (like a 2.x session's own history),
      // so the chronological view is its reverse. Paging is counted from the
      // newest end of that view, which is what a 2.x cursor means.
      const ascending = [...session.messages].reverse()
      const taken = cursor ? Number(cursor.replace("cursor-", "").split("-")[0]) : 0
      const size = Number.isFinite(limit) && limit > 0 ? limit : ascending.length
      const from = Math.max(0, ascending.length - taken - size)
      const to = ascending.length - taken
      const page = order === "asc" ? ascending.slice(from, to) : ascending.slice(from, to).reverse()
      const hasMore = from > 0
      return json(res, 200, {
        data: page,
        cursor: {
          previous: hasMore ? `cursor-${ascending.length - from}-previous` : null,
          next: null,
        },
      })
    }

    const promptMatch = path.match(/^\/api\/session\/([^/]+)\/prompt$/)
    if (promptMatch && method === "POST") {
      let body = ""
      req.on("data", (chunk) => (body += chunk))
      req.on("end", () => {
        const parsed = safeParse(body)
        const text = (parsed?.text as string) ?? ""
        const userID = nextID("msg")
        const directory = locationDirectory(url)
        data(res, { id: userID, sessionID: promptMatch[1], time: { created: Date.now() }, type: "user", text, delivery: "steer" })
        scriptAssistantReply(promptMatch[1], directory)
      })
      return
    }

    const interruptMatch = path.match(/^\/api\/session\/([^/]+)\/interrupt$/)
    if (interruptMatch && method === "POST") {
      emit("session.execution.interrupted", { sessionID: interruptMatch[1] })
      res.writeHead(204)
      return res.end()
    }

    const permissionReplyMatch = path.match(/^\/api\/session\/([^/]+)\/permission\/([^/]+)\/reply$/)
    if (permissionReplyMatch && method === "POST") {
      let body = ""
      req.on("data", (chunk) => (body += chunk))
      req.on("end", () => {
        const parsed = safeParse(body)
        const requestID = permissionReplyMatch[2]
        const pending = permissions.get(requestID)
        permissions.delete(requestID)
        if (pending) {
          emit("permission.replied", { sessionID: pending.sessionID, requestID, reply: parsed?.decision })
        }
        res.writeHead(204)
        res.end()
      })
      return
    }

    const formReplyMatch = path.match(/^\/api\/session\/([^/]+)\/form\/([^/]+)\/reply$/)
    if (formReplyMatch && method === "POST") {
      let body = ""
      req.on("data", (chunk) => (body += chunk))
      req.on("end", () => {
        const parsed = safeParse(body)
        const formID = formReplyMatch[2]
        const form = forms.get(formID)
        forms.delete(formID)
        if (form) emit("form.replied", { id: formID, sessionID: form.sessionID, answer: parsed?.answer })
        res.writeHead(204)
        res.end()
      })
      return
    }

    const formDeleteMatch = path.match(/^\/api\/session\/([^/]+)\/form\/([^/]+)$/)
    if (formDeleteMatch && method === "DELETE") {
      const form = forms.get(formDeleteMatch[2])
      forms.delete(formDeleteMatch[2])
      if (form) emit("form.cancelled", { id: form.id, sessionID: form.sessionID })
      res.writeHead(204)
      return res.end()
    }

    const stageMatch = path.match(/^\/api\/session\/([^/]+)\/revert\/stage$/)
    if (stageMatch && method === "POST") {
      let body = ""
      req.on("data", (chunk) => (body += chunk))
      req.on("end", () => {
        const parsed = safeParse(body)
        const session = sessions.get(stageMatch[1])
        if (session) session.data.revert = { messageID: parsed?.messageID, files: [] }
        json(res, 200, { location: { directory: locationDirectory(url) }, data: { messageID: parsed?.messageID, files: [] } })
      })
      return
    }

    const revertMatch = path.match(/^\/api\/session\/([^/]+)\/revert$/)
    if (revertMatch && method === "DELETE") {
      const session = sessions.get(revertMatch[1])
      if (session) delete session.data.revert
      res.writeHead(204)
      return res.end()
    }

    const diffMatch = path.match(/^\/api\/session\/([^/]+)\/diff$/)
    if (diffMatch && method === "GET") {
      return data(res, [{ file: "src/mock.ts", patch: "@@ -1 +1 @@\n-old\n+new\n", additions: 1, deletions: 1, status: "modified" }])
    }

    if (method === "GET" && path === "/api/project") {
      return data(res, [{ id: "mock-project", canonical: V2_DIRECTORY, vcs: "git", time: { created: Date.now(), updated: Date.now() } }])
    }

    if (method === "GET" && path === "/api/location") {
      const directory = locationDirectory(url)
      return json(res, 200, { directory, project: { id: "mock-project", directory, canonical: directory } })
    }

    if (method === "GET" && path === "/api/vcs") {
      return data(res, { provider: "git", branch: { current: "mock-branch", default: "main" } })
    }

    if (method === "GET" && path === "/api/vcs/diff") {
      return data(res, [{ file: "README.md", patch: "@@ -1 +1 @@\n-a\n+b\n", additions: 1, deletions: 1, status: "modified" }])
    }

    if (method === "GET" && path === "/api/fs/list") {
      return data(res, [
        { path: "src", type: "directory" },
        { path: "README.md", type: "file" },
      ])
    }

    if (method === "GET" && path === "/api/agent") {
      return data(res, [{ id: "build", name: "Build", description: "mock build agent", mode: "primary", hidden: false }])
    }

    if (method === "GET" && path === "/api/command") {
      return data(res, [{ name: "review", description: "review changes" }])
    }

    if (method === "GET" && path === "/api/provider") {
      return data(res, [{ id: "mock", name: "Mock Provider", activation: "enabled" }])
    }

    if (method === "GET" && path === "/api/model") {
      return data(res, [
        {
          id: "mock-model",
          modelID: "mock-model",
          providerID: "mock",
          name: "Mock Model",
          capabilities: { tools: true, input: ["text", "image"], output: ["text"] },
          variants: [
            { id: "low", settings: { reasoningEffort: "low" } },
            { id: "high", settings: { reasoningEffort: "high" } },
          ],
          limit: { context: 200000, output: 8192 },
        },
      ])
    }

    if (method === "GET" && path === "/api/model/default") {
      return data(res, { id: "mock-model", modelID: "mock-model", providerID: "mock", name: "Mock Model" })
    }

    // forge's own routes are shared by both majors (issue #15).
    if (method === "GET" && path === "/__forge/pr") {
      return json(res, 200, { directory: locationDirectory(url), branch: "forge/mock", pr: { number: 1, state: "open" }, checked_at: 1 })
    }

    if (path.startsWith("/api/")) return json(res, 404, { _tag: "NotFoundError", message: `no v2 handler for ${method} ${path}` })

    return html(res, 200)
  })

  /**
   * Prepend `pairs` older user/assistant exchanges to a session's transcript so
   * a full read needs several cursor pages. Returns the oldest user message id.
   */
  function seedHistory(sessionID: string, pairs: number): string | undefined {
    const session = sessions.get(sessionID)
    if (!session) return undefined
    const block: V2MessageEntry[] = []
    let firstUserID: string | undefined
    for (let i = 0; i < pairs; i++) {
      const userID = nextID("msg")
      const assistantID = nextID("msg")
      if (i === 0) firstUserID = userID
      block.push(
        { id: userID, type: "user", text: `older question ${i}`, time: { created: Date.now() - (pairs - i) * 1000 } },
        {
          id: assistantID,
          type: "assistant",
          finish: "stop",
          content: [{ type: "text", text: `older answer ${i}` }],
          time: { created: Date.now() - (pairs - i) * 1000, completed: Date.now() - (pairs - i) * 900 },
        } as unknown as V2MessageEntry,
      )
    }
    // Storage is newest-first, and this block is older than everything already
    // there, so it goes on the tail in newest-first order.
    session.messages.push(...block.reverse())
    return firstUserID
  }

  return {
    /** SSE listeners currently attached — lets a test wait until the stream is live. */
    connected: () => sse.size,
    askPermission,
    askForm,
    seedHistory,
    pendingPermissions: () => Array.from(permissions.keys()),
    pendingForms: () => Array.from(forms.keys()),
    sessionDirectory: () => V2_DIRECTORY,
  }
}

function safeParse(text: string): Record<string, unknown> | null {
  try {
    return JSON.parse(text || "{}")
  } catch {
    return null
  }
}
