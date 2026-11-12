// opencode 2.x adapter.
//
// Keeps the `Client` surface `createClient` exposes (src/lib/sdk.ts) while
// talking to the 2.x API: everything under `/api/*`, `{"data": …}` response
// envelopes, `?location[directory]=<abs path>` scoping, cursor-paginated
// newest-first message lists, and the granular `session.*` event stream.
//
// The store-facing vocabulary stays 1.x: `Session` / `Message` / `Part` and the
// `message.updated` / `message.part.updated` / `session.status` events the
// sessions and events stores already dispatch on, so no screen or store had to
// change.
import { buildRequestHeaders } from "./headers.ts"
import { ApiError, apiErrorFor } from "./api-error.ts"
import { parseForgeState } from "./forge.ts"
import { forgePrPath, readForgePr, type ForgePr } from "./forge-pr.ts"
import type {
  Agent,
  Client,
  Command,
  Event,
  FileDiff,
  FileEntry,
  HealthResponse,
  Message,
  MessageWithParts,
  Part,
  PermissionRequest,
  Project,
  QuestionRequest,
  Session,
  VcsInfo,
  VcsMode,
} from "./sdk.ts"

export interface V2ClientConfig {
  baseUrl: string
  directory?: string
  auth?: { username: string; password: string }
}

const MAX_MESSAGE_PAGES = 20
const MAX_SESSION_PAGES = 5

// v2 renamed several tools. The UI switches on the 1.x names (ToolCallCard's
// `case "bash"` etc.), so the adapter renames back instead of touching screens.
const TOOL_NAME_TO_V1: Record<string, string> = {
  shell: "bash",
  subagent: "task",
  edit: "edit",
  write: "write",
  patch: "apply_patch",
  read: "read",
  glob: "glob",
  grep: "grep",
  list: "list",
  codesearch: "codesearch",
  webfetch: "webfetch",
  websearch: "websearch",
}

export function v2ToolName(name: string | undefined): string {
  if (!name) return ""
  return TOOL_NAME_TO_V1[name] ?? name
}

// Session ids for pending permission requests and forms. Both reply routes are
// session-scoped in 2.x (`/api/session/{sessionID}/permission/{requestID}/reply`
// and `/api/session/{sessionID}/form/{formID}/reply`) while the 1.x-shaped
// `permission.reply(requestID, …)` / `question.reply(requestID, …)` the screens
// call carry no session id, so the ids are remembered as they are seen (in
// events and in the pending lists) and looked up at reply time.
const permissionSessions = new Map<string, string>()
const formSessions = new Map<string, string>()

export function rememberPermissionSession(requestID: string, sessionID: string): void {
  permissionSessions.set(requestID, sessionID)
}

export function rememberFormSession(formID: string, sessionID: string): void {
  formSessions.set(formID, sessionID)
}

export function clearRememberedSessions(): void {
  permissionSessions.clear()
  formSessions.clear()
}

// --- mapping -----------------------------------------------------------------

interface V2Location {
  directory?: string
}

interface V2Session {
  id: string
  projectID?: string
  parentID?: string
  title?: string
  slug?: string
  subpath?: string
  version?: string
  location?: V2Location
  time?: { created?: number; updated?: number; archived?: number }
  revert?: { messageID: string; partID?: string }
  outcome?: string
}

export function mapSession(session: V2Session): Session {
  return {
    id: session.id,
    slug: session.slug ?? session.id.slice(-8),
    projectID: session.projectID ?? "",
    directory: session.location?.directory ?? "",
    parentID: session.parentID,
    title: session.title ?? "",
    version: session.version ?? "",
    time: {
      created: session.time?.created ?? 0,
      updated: session.time?.updated ?? 0,
      archived: session.time?.archived,
    },
    revert: session.revert ? { messageID: session.revert.messageID, partID: session.revert.partID } : undefined,
  }
}

interface V2ToolContent {
  type?: string
  text?: string
}

function joinContent(content: V2ToolContent[] | undefined): string {
  if (!Array.isArray(content)) return ""
  return content.map((c) => (typeof c?.text === "string" ? c.text : "")).join("")
}

function mapToolState(state: Record<string, unknown> | undefined): Part["state"] {
  if (!state) return { status: "running" }
  const status = state.status as string
  if (status === "completed") {
    return {
      status: "completed",
      input: state.input,
      output: joinContent(state.content as V2ToolContent[]),
      title: undefined,
      time: state.time as { start?: number; end?: number } | undefined,
    }
  }
  if (status === "error") {
    const error = state.error as { message?: string } | undefined
    return {
      status: "error",
      input: state.input,
      output: joinContent(state.content as V2ToolContent[]),
      error: { message: error?.message ?? "Tool failed" },
    }
  }
  return { status: "running", input: state.input }
}

interface V2Message {
  id: string
  type: string
  time?: { created?: number; streamed?: number; completed?: number }
  text?: string
  files?: Array<{ mime?: string; data?: string; name?: string; source?: { type?: string; uri?: string } }>
  agents?: Array<{ name?: string }>
  skills?: Array<{ name?: string }>
  // assistant
  agent?: string
  model?: { id?: string; providerID?: string }
  content?: Array<Record<string, unknown>>
  finish?: string
  cost?: number
  tokens?: Message["tokens"]
  outcome?: string
}

/**
 * Map one v2 message-list entry to the 1.x `{info, parts}` pair the sessions
 * store parses. Non-chat entries (the `idle` marker, compaction/system rows)
 * return null so callers drop them.
 *
 * Part ids must be identical to the ones the streaming event translator
 * synthesises, otherwise a live-updated part would be duplicated by the next
 * refetch. Both sides therefore derive ids from the same scheme:
 * `<messageID>:<kind>:<ordinal>`, tools keyed by the provider tool-call id.
 */
export function mapMessage(entry: V2Message, sessionID = ""): MessageWithParts | null {
  if (entry.type === "user") {
    const parts: Part[] = []
    if (typeof entry.text === "string") {
      parts.push({ id: `${entry.id}:text:0`, sessionID: sessionID || undefined, messageID: entry.id, type: "text", text: entry.text })
    }
    for (const [i, file] of (entry.files ?? []).entries()) {
      const url = file.source?.uri ?? (file.data ? `data:${file.mime ?? "application/octet-stream"};base64,${file.data}` : "")
      parts.push({
        id: `${entry.id}:file:${i}`,
        sessionID: sessionID || undefined,
        messageID: entry.id,
        type: "file",
        mime: file.mime,
        url,
        filename: file.name,
      })
    }
    return {
      info: {
        id: entry.id,
        sessionID,
        role: "user",
        time: { created: entry.time?.created ?? 0, completed: entry.time?.completed },
        agent: entry.agents?.[0]?.name,
      },
      parts,
    }
  }

  if (entry.type === "assistant") {
    const parts: Part[] = []
    const ordinal: Record<string, number> = { reasoning: 0, text: 0 }
    for (const item of entry.content ?? []) {
      const kind = item.type as string
      if (kind === "reasoning" || kind === "text") {
        const index = ordinal[kind] ?? 0
        ordinal[kind] = index + 1
        parts.push({
          id: `${entry.id}:${kind}:${index}`,
          sessionID: sessionID || undefined,
          messageID: entry.id,
          type: kind as Part["type"],
          text: (item.text as string) ?? "",
          time: item.time as Part["time"],
        })
      } else if (kind === "tool") {
        const callID = item.id as string
        parts.push({
          id: `${entry.id}:tool:${callID}`,
          sessionID: sessionID || undefined,
          messageID: entry.id,
          type: "tool",
          tool: v2ToolName(item.name as string | undefined),
          callID,
          state: mapToolState(item.state as Record<string, unknown>),
          time: { start: (item.time as { created?: number } | undefined)?.created, end: (item.time as { completed?: number } | undefined)?.completed },
        })
      }
    }
    return {
      info: {
        id: entry.id,
        sessionID,
        role: "assistant",
        time: { created: entry.time?.created ?? 0, completed: entry.time?.completed },
        agent: entry.agent,
        modelID: entry.model?.id,
        providerID: entry.model?.providerID,
        cost: entry.cost,
        tokens: entry.tokens,
        finish: entry.finish,
      },
      parts,
    }
  }

  return null
}

// --- event translation -------------------------------------------------------

type V2Event = { id?: string; created?: number; type: string; data?: Record<string, unknown>; location?: V2Location }

/**
 * Accumulating translator: v2 streams granular deltas (`session.text.delta`
 * without the text seen so far), while 1.x `message.part.updated` events carry
 * a complete part the sessions store replaces wholesale. This class buffers per
 * part and emits only complete parts, so the two sides of the app cannot see
 * half a message.
 */
export class V2EventTranslator {
  private messages = new Map<string, Message>()
  private texts = new Map<string, string>()
  // Provider tool ids carry only `name` on the first frame; later progress /
  // success / error frames do not, so remember it to keep the part's tool set.
  private toolNames = new Map<string, string>()
  private toolMessages = new Map<string, string>()

  translate(event: V2Event): Event[] {
    const data = event.data ?? {}
    const type = event.type
    if (type.startsWith("session.")) return this.session(event, data)
    if (type.startsWith("permission.")) return this.permission(event, data)
    if (type.startsWith("form.")) return this.form(event, data)
    return []
  }

  private info(id: string, sessionID: string, patch: Partial<Message>): Message {
    const current = this.messages.get(id) ?? { id, sessionID, role: "assistant", time: { created: 0 } }
    const next: Message = { ...current, ...patch, sessionID: sessionID || current.sessionID }
    this.messages.set(id, next)
    return { ...next }
  }

  private session(event: V2Event, data: Record<string, unknown>): Event[] {
    const type = event.type
    const sessionID = data.sessionID as string | undefined
    switch (type) {
      case "session.created": {
        // The 2.x event names the id `sessionID` (and carries no time), unlike
        // the session GET — normalise so mapSession produces a real Session.
        const created = data as Record<string, unknown>
        return [
          {
            type: "session.created",
            properties: {
              info: mapSession({
                ...created,
                id: (created.sessionID as string) ?? (created.id as string),
                time: { created: event.created, updated: event.created },
              } as unknown as V2Session),
            },
          },
        ]
      }

      case "session.inbox.enqueued": {
        const item = data.item as { type?: string; payload?: { text?: string } } | undefined
        const inboxID = data.inboxID as string | undefined
        if (!sessionID || !inboxID || item?.type !== "user") return []
        const info = this.info(inboxID, sessionID, {
          role: "user",
          time: { created: event.created ?? 0 },
        })
        return [
          { type: "message.updated", properties: { info } },
          {
            type: "message.part.updated",
            properties: { part: { id: `${inboxID}:text:0`, sessionID, messageID: inboxID, type: "text", text: item.payload?.text ?? "" } },
          },
        ]
      }

      case "session.execution.started":
        return [{ type: "session.status", properties: { sessionID, status: { type: "busy" } } }]

      case "session.execution.succeeded":
        return [{ type: "session.status", properties: { sessionID, status: { type: "idle" } } }]

      case "session.execution.failed": {
        const error = data.error as { message?: string } | undefined
        return [
          { type: "session.error", properties: { sessionID, error: { message: error?.message ?? "Session failed" } } },
          { type: "session.status", properties: { sessionID, status: { type: "idle" } } },
        ]
      }

      case "session.execution.interrupted":
        return [{ type: "session.status", properties: { sessionID, status: { type: "idle" } } }]

      // 2.x keeps a pending revert across the "edit message" pause and commits
      // it itself when the next prompt arrives, so the transcript is rewritten
      // without any API call the app made. The transcript hides everything after
      // the pending revert point, so these must reach the store: staged sets the
      // marker, committed/cleared drop it — otherwise the banner stays up and
      // the re-sent message plus its reply stay hidden.
      case "session.revert.staged": {
        const staged = data.revert as { messageID?: string; partID?: string } | undefined
        if (!sessionID || !staged?.messageID) return []
        return [{ type: "session.revert", properties: { sessionID, revert: { messageID: staged.messageID, partID: staged.partID } } }]
      }

      case "session.revert.committed": {
        const to = data.to as string | undefined
        if (!sessionID) return []
        return [
          {
            type: "session.revert",
            properties: { sessionID, revert: undefined, ...(to ? { droppedFrom: to } : {}) },
          },
        ]
      }

      case "session.revert.cleared":
        return sessionID ? [{ type: "session.revert", properties: { sessionID, revert: undefined } }] : []

      case "session.step.started":
        return [
          {
            type: "message.updated",
            properties: {
              info: this.info(data.assistantMessageID as string, sessionID ?? "", {
                role: "assistant",
                agent: data.agent as string | undefined,
                modelID: (data.model as { id?: string } | undefined)?.id,
                providerID: (data.model as { providerID?: string } | undefined)?.providerID,
                time: { created: (data.started as number | undefined) ?? event.created ?? 0 },
              }),
            },
          },
        ]

      case "session.step.streamed":
        return [
          {
            type: "message.updated",
            properties: {
              info: this.info(data.assistantMessageID as string, sessionID ?? "", {
                role: "assistant",
                time: { created: 0, completed: undefined },
              }),
            },
          },
        ]

      case "session.step.ended":
        return [
          {
            type: "message.updated",
            properties: {
              info: this.info(data.assistantMessageID as string, sessionID ?? "", {
                role: "assistant",
                finish: data.finish as string | undefined,
                cost: data.cost as number | undefined,
                tokens: data.tokens as Message["tokens"],
                time: { created: 0, completed: event.created ?? 0 },
              }),
            },
          },
        ]

      case "session.text.started":
      case "session.reasoning.started": {
        const kind = type === "session.text.started" ? "text" : "reasoning"
        return this.part(data, kind, event.type, "")
      }
      case "session.text.delta":
      case "session.reasoning.delta": {
        const kind = type === "session.text.delta" ? "text" : "reasoning"
        const id = this.partID(data, kind)
        if (!id) return []
        this.texts.set(id, (this.texts.get(id) ?? "") + String(data.delta ?? ""))
        return this.part(data, kind, event.type, this.texts.get(id) ?? "")
      }
      case "session.text.ended":
      case "session.reasoning.ended": {
        const kind = type === "session.text.ended" ? "text" : "reasoning"
        const id = this.partID(data, kind)
        if (id) this.texts.set(id, String(data.text ?? ""))
        return this.part(data, kind, event.type, String(data.text ?? ""))
      }

      case "session.tool.input.started":
        return this.toolPart(data, event.type, { status: "running" })
      case "session.tool.input.ended":
        return this.toolPart(data, event.type, { status: "running", input: parseJson(String(data.text ?? "")) })
      case "session.tool.called":
        return this.toolPart(data, event.type, { status: "running", input: data.input })
      case "session.tool.progress":
        return this.toolPart(data, event.type, { status: "running" })
      case "session.tool.success":
        return this.toolPart(data, event.type, { status: "completed", output: joinContent(data.content as V2ToolContent[]) })
      case "session.tool.error": {
        const error = data.error as { message?: string } | undefined
        return this.toolPart(data, event.type, { status: "error", error: { message: error?.message ?? "Tool failed" } })
      }

      case "session.usage.updated":
      case "session.instructions.updated":
      case "session.inbox.delivered":
        return []

      default:
        return []
    }
  }

  private partID(data: Record<string, unknown>, kind: string): string {
    const messageID = data.assistantMessageID as string | undefined
    return messageID ? `${messageID}:${kind}:${(data.ordinal as number | undefined) ?? 0}` : ""
  }

  private part(data: Record<string, unknown>, kind: "text" | "reasoning", via: string, text: string): Event[] {
    const messageID = data.assistantMessageID as string | undefined
    const sessionID = data.sessionID as string | undefined
    if (!messageID) return []
    const id = this.partID(data, kind)
    if (!id) return []
    return [
      {
        type: "message.part.updated",
        properties: {
          part: {
            id,
            sessionID,
            messageID,
            type: kind,
            text,
            time: { start: via.endsWith("started") ? Date.now() : undefined },
          },
        },
      },
    ]
  }

  private toolPart(data: Record<string, unknown>, via: string, state: NonNullable<Part["state"]>): Event[] {
    const callID = data.id as string | undefined
    if (!callID) return []
    const known = this.toolNames.get(callID)
    if (data.name) this.toolNames.set(callID, String(data.name))
    const messageID = (data.assistantMessageID as string | undefined) ?? this.toolMessages.get(callID)
    if (!messageID) return []
    this.toolMessages.set(callID, messageID)
    const sessionID = (data.sessionID as string | undefined) ?? ""
    return [
      {
        type: "message.part.updated",
        properties: {
          part: {
            id: `${messageID}:tool:${callID}`,
            sessionID,
            messageID,
            type: "tool",
            tool: v2ToolName((data.name as string | undefined) ?? known),
            callID,
            state,
            time: { start: via.endsWith("started") ? Date.now() : undefined },
          },
        },
      },
    ]
  }

  private permission(event: V2Event, data: Record<string, unknown>): Event[] {
    if (event.type === "permission.asked") {
      const source = data.source as { messageID?: string; id?: string } | undefined
      if (data.id && data.sessionID) rememberPermissionSession(String(data.id), String(data.sessionID))
      return [
        {
          type: "permission.asked",
          properties: {
            id: data.id,
            sessionID: data.sessionID,
            permission: data.action,
            patterns: data.resources ?? [],
            metadata: { save: data.save ?? [] },
            tool: source?.messageID ? { messageID: source.messageID, callID: source.id } : undefined,
          },
        },
      ]
    }
    if (event.type === "permission.replied") {
      return [{ type: "permission.replied", properties: { sessionID: data.sessionID, requestID: data.requestID } }]
    }
    return []
  }

  private form(event: V2Event, data: Record<string, unknown>): Event[] {
    if (event.type === "form.created") {
      const form = (data.form ?? data) as {
        id?: string
        sessionID?: string
        fields?: Array<{
          key?: string
          title?: string
          description?: string
          type?: string
          options?: Array<{ value?: string; label?: string; description?: string }>
          custom?: boolean
        }>
      }
      if (form.id && form.sessionID) rememberFormSession(form.id, form.sessionID)
      return [
        {
          type: "question.asked",
          properties: {
            id: form.id,
            sessionID: form.sessionID,
            questions: (form.fields ?? []).map((field) => ({
              question: field.description ?? field.title ?? "",
              header: field.title ?? "",
              options: (field.options ?? []).map((option) => ({
                label: option.label ?? option.value ?? "",
                description: option.description ?? "",
              })),
              multiple: field.type === "multiselect",
              custom: field.custom ?? false,
            })),
            // 2.x keys answers by field key; the UI replies with positional
            // answer arrays, so keep the key order for the reply mapping.
            keys: (form.fields ?? []).map((field) => field.key),
            tool: (form as { metadata?: { tool?: { messageID?: string; id?: string } } }).metadata?.tool
              ? {
                  messageID: (form as { metadata: { tool: { messageID?: string } } }).metadata.tool.messageID,
                  callID: (form as { metadata: { tool: { id?: string } } }).metadata.tool.id,
                }
              : undefined,
          },
        },
      ]
    }
    if (event.type === "form.replied" || event.type === "form.cancelled") {
      return [{ type: "question.replied", properties: { sessionID: data.sessionID ?? (data.form as { sessionID?: string } | undefined)?.sessionID, requestID: (data.id ?? data.formID) as string } }]
    }
    return []
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

// --- HTTP --------------------------------------------------------------------

async function request<T>(config: V2ClientConfig, path: string, init: RequestInit = {}, timeoutMs = 30_000): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let response: Response
  try {
    response = await fetch(`${config.baseUrl}${path}`, {
      ...init,
      headers: { ...buildRequestHeaders(config), ...(init.headers as Record<string, string> | undefined) },
      signal: init.signal ?? controller.signal,
    })
  } finally {
    clearTimeout(timer)
  }
  if (!response.ok) {
    const body = await response.text()
    throw (parseForgeState(response.status, response.headers, body) ?? apiErrorFor(response.status, `API Error: ${response.status} - ${body}`))
  }
  if (response.status === 204) return undefined as T
  const contentType = response.headers.get("content-type") || ""
  // Never treat a 200 blindly as JSON: 2.x answers unknown paths with the web
  // app's HTML.
  if (!contentType.includes("application/json")) return undefined as T
  return (await response.json()) as T
}

function unwrap<T>(body: unknown): T {
  return (body as { data: T }).data
}

// `location[directory]=` (deepObject) — the 2.x way to scope a request. Brackets
// must be percent-encoded.
function locationQuery(directory?: string): string {
  if (!directory) return ""
  const params = new URLSearchParams({ "location[directory]": directory })
  return params.toString()
}

function withLocation(base: string, directory?: string): string {
  const qs = locationQuery(directory)
  if (!qs) return base
  return `${base}${base.includes("?") ? "&" : "?"}${qs}`
}

/**
 * Build a client that speaks the opencode 2.x API. `events` is supplied by the
 * caller (src/lib/sdk.ts) because streaming needs expo/fetch on native; every
 * other call is plain JSON over the runtime `fetch`.
 */
export function createV2Client(config: V2ClientConfig, eventsFor: (signal?: AbortSignal) => AsyncGenerator<Event>): Client {
  const directory = config.directory

  const formKeys = new Map<string, string[]>()
  const keysFor = async (formID: string, sessionID: string): Promise<string[]> => {
    const known = formKeys.get(formID)
    if (known) return known
    const body = await request<{ data?: Array<{ id?: string; fields?: Array<{ key?: string }> }> }>(
      config,
      withLocation("/api/form", directory),
    ).catch(() => null)
    const found = (body?.data ?? []).find((form) => form.id === formID)
    const keys = (found?.fields ?? []).map((field) => field.key ?? "")
    formKeys.set(formID, keys)
    if (sessionID) rememberFormSession(formID, sessionID)
    return keys
  }

  return {
    global: {
      health: async (timeoutMs?: number) => {
        const info = await request<{ version?: string }>(config, "/api/info", {}, timeoutMs)
        return { healthy: true, version: info?.version ?? "" }
      },

      events: (signal) => eventsFor(signal),

      // A 2.x server is, by construction, 2.x — kept for the shared `Client`
      // shape the dispatcher builds on.
      detect: async () => "v2" as const,
    },

    project: {
      list: async (): Promise<Project[]> => {
        const body = await request<unknown>(config, "/api/project")
        const projects = unwrap<Array<Record<string, unknown>>>(body) ?? []
        return projects.map((p) => mapProject(p))
      },
      current: async (): Promise<Project> => {
        const body = await request<unknown>(config, withLocation("/api/location", directory))
        const project = (body as { project?: Record<string, unknown> })?.project
        if (!project) throw new ApiError(404, "location has no project")
        return mapProject(project)
      },
    },

    file: {
      list: async ({ path = "." }: { path?: string } = {}): Promise<FileEntry[]> => {
        const params = new URLSearchParams({ path })
        const base = withLocation(`/api/fs/list?${params.toString()}`, directory)
        const body = await request<unknown>(config, base)
        const entries = unwrap<Array<{ path?: string; type?: string }>>(body) ?? []
        const root = directory ?? ""
        return entries.map((entry) => {
          const relative = (entry.path ?? "").replace(/^\//, "")
          return {
            name: relative.split("/").filter(Boolean).pop() ?? relative,
            path: relative,
            absolute: root ? `${root.replace(/\/+$/, "")}/${relative}` : relative,
            type: entry.type === "directory" ? "directory" : "file",
            ignored: false,
          } satisfies FileEntry
        })
      },
      // 2.x has no roots endpoint; callers fall back to manual path entry.
      roots: async () => null,
    },

    vcs: {
      get: async (): Promise<VcsInfo> => {
        const body = await request<unknown>(config, withLocation("/api/vcs", directory))
        const data = unwrap<{ provider?: string; branch?: { current?: string; default?: string } }>(body)
        return { branch: data?.branch?.current, default_branch: data?.branch?.default }
      },
      diff: async (mode: VcsMode): Promise<FileDiff[]> => {
        const params = new URLSearchParams({ mode: mode === "git" ? "working" : "branch" })
        const body = await request<unknown>(config, withLocation(`/api/vcs/diff?${params.toString()}`, directory))
        return mapDiffs(unwrap<FileDiff[]>(body) ?? [])
      },
    },

    // forge's own routes are identical across majors (issue #15) — the v2
    // client answers them the same way the 1.x client does.
    forge: {
      pr: async (dir: string, refresh?: boolean): Promise<ForgePr> => {
        const response = await fetch(`${config.baseUrl}${forgePrPath(dir, refresh)}`, {
          headers: buildRequestHeaders(config),
        })
        const body = await response.text()
        const waking = parseForgeState(response.status, response.headers, body)
        if (waking) throw waking
        return readForgePr(response.status, body)
      },
    },

    path: {
      get: async () => {
        const body = await request<unknown>(config, withLocation("/api/location", directory))
        const location = body as { directory?: string; project?: { canonical?: string; directory?: string } }
        return {
          home: "",
          state: "",
          config: "",
          worktree: location?.project?.canonical ?? location?.directory ?? "",
          directory: location?.directory ?? directory ?? "",
        }
      },
    },

    session: {
      list: async (): Promise<Session[]> => {
        const sessions: Session[] = []
        let cursor: string | undefined
        for (let page = 0; page < MAX_SESSION_PAGES; page++) {
          const params = new URLSearchParams({ order: "desc", limit: "50" })
          if (cursor) {
            params.delete("order")
            params.set("cursor", String(cursor))
          }
          const body = await request<unknown>(config, withLocation(`/api/session?${params.toString()}`, directory))
          const pageData = (body ?? {}) as { data?: V2Session[]; cursor?: { previous?: string | null; next?: string | null } }
          sessions.push(...(pageData.data ?? []).map(mapSession))
          cursor = pageData.cursor?.previous ?? undefined
          if (!cursor) break
        }
        return sessions
      },

      get: async (sessionID: string) => mapSession(await request<unknown>(config, `/api/session/${sessionID}`).then((body) => unwrap<V2Session>(body))),

      create: async (params?: { title?: string }) => {
        const body = { ...(directory ? { location: { directory } } : {}), title: params?.title }
        const created = await request<unknown>(config, "/api/session", { method: "POST", body: JSON.stringify(body) })
        return mapSession(unwrap<V2Session>(created))
      },

      delete: async (sessionID: string) => {
        await request<void>(config, `/api/session/${sessionID}`, { method: "DELETE" })
      },

      update: async (sessionID: string, params: { title?: string; time?: { archived?: number } }) => {
        await request<void>(config, `/api/session/${sessionID}`, { method: "PATCH", body: JSON.stringify({ title: params.title }) })
        return mapSession(await request<unknown>(config, `/api/session/${sessionID}`).then((body) => unwrap<V2Session>(body)))
      },

      // Newest-first + cursor pagination is 2.x's shape; the stores expect a
      // plain, oldest-first array, so pages are followed and the order flipped.
      messages: async (sessionID: string, params?: { limit?: number }) => {
        const limit = params?.limit
        const items: MessageWithParts[] = []
        const query = new URLSearchParams({ order: "desc" })
        if (limit) query.set("limit", String(limit))
        let cursor: string | undefined
        for (let page = 0; page < MAX_MESSAGE_PAGES; page++) {
          const query = new URLSearchParams({ order: "desc" })
          if (limit) query.set("limit", String(limit))
          if (cursor) {
            // 2.x rejects a cursor combined with `order` (InvalidCursorError);
            // the cursor already carries the direction it was taken in.
            query.delete("order")
            query.set("cursor", cursor)
          }
          const body = await request<unknown>(config, `/api/session/${sessionID}/message?${query.toString()}`)
          const pageData = (body ?? {}) as { data?: V2Message[]; cursor?: { previous?: string | null } }
          // `order=desc` hands us newest-first; unshifting each entry turns
          // that back into the oldest-first order the transcripts expect.
          for (const entry of pageData.data ?? []) {
            const mapped = mapMessage(entry, sessionID)
            if (mapped) items.unshift(mapped)
          }
          cursor = pageData.cursor?.previous ?? undefined
          if (limit || !cursor) break
        }
        return items
      },

      prompt: async (sessionID: string, params: Parameters<Client["session"]["prompt"]>[1]) => {
        const text = params.parts.filter((p) => p.type === "text").map((p) => (p as { text: string }).text).join("\n")
        const files = params.parts
          .filter((p) => p.type === "file")
          .map((p) => {
            const file = p as unknown as { mime: string; url: string; filename?: string }
            return { uri: file.url, ...(file.filename ? { name: file.filename } : {}) }
          })
        await request(config, `/api/session/${sessionID}/prompt`, {
          method: "POST",
          body: JSON.stringify({
            text,
            ...(files.length ? { files } : {}),
            ...(params.agent ? { agents: [{ name: params.agent }] } : {}),
          }),
        })
      },

      command: async (sessionID: string, params: Parameters<Client["session"]["command"]>[1]) => {
        await request(config, `/api/session/${sessionID}/command`, {
          method: "POST",
          body: JSON.stringify({ name: params.command, arguments: params.arguments, agent: params.agent, model: params.model }),
        })
      },

      abort: async (sessionID: string) => {
        await request<void>(config, `/api/session/${sessionID}/interrupt`, { method: "POST" })
        return true
      },

      diff: async (sessionID: string, messageID?: string) => {
        const params = new URLSearchParams()
        if (messageID) params.set("from", messageID)
        const qs = params.toString()
        const body = await request<unknown>(config, `/api/session/${sessionID}/diff${qs ? `?${qs}` : ""}`)
        return mapDiffs(unwrap<FileDiff[]>(body) ?? [])
      },

      // 1.x `revert` marked the message pending in one call and returned the
      // session. 2.x splits staging from committing, so stage then read back
      // the session (the app only ever stages, then re-prompts or unreverts).
      revert: async (sessionID: string, messageID: string, partID?: string) => {
        await request(config, `/api/session/${sessionID}/revert/stage`, {
          method: "POST",
          body: JSON.stringify(partID ? { messageID, partID } : { messageID }),
        })
        const body = await request<unknown>(config, `/api/session/${sessionID}`)
        return mapSession(unwrap<V2Session>(body))
      },

      unrevert: async (sessionID: string) => {
        await request<void>(config, `/api/session/${sessionID}/revert`, { method: "DELETE" })
        const body = await request<unknown>(config, `/api/session/${sessionID}`)
        return mapSession(unwrap<V2Session>(body))
      },
    },

    permission: {
      list: async (): Promise<PermissionRequest[]> => {
        const body = await request<{ data?: Array<Record<string, unknown>> }>(config, withLocation("/api/permission/request", directory))
        return (body?.data ?? []).map((item) => {
          const source = item.source as { messageID?: string; id?: string } | undefined
          const id = String(item.id)
          const sessionID = String(item.sessionID)
          rememberPermissionSession(id, sessionID)
          return {
            id,
            sessionID,
            permission: String(item.action ?? ""),
            patterns: (item.resources as string[]) ?? [],
            metadata: { save: item.save ?? [] },
            tool: source ? { messageID: source.messageID, callID: source.id } : undefined,
          }
        })
      },

      reply: async (requestID: string, reply: "once" | "always" | "reject") => {
        const sessionID = permissionSessions.get(requestID)
        if (!sessionID) throw new ApiError(404, `unknown permission request ${requestID}`)
        await request<void>(config, `/api/session/${sessionID}/permission/${requestID}/reply`, {
          method: "POST",
          body: JSON.stringify({ decision: reply }),
        })
        permissionSessions.delete(requestID)
        return true
      },
    },

    question: {
      list: async (): Promise<QuestionRequest[]> => {
        const body = await request<{ data?: Array<Record<string, unknown>> }>(config, withLocation("/api/form", directory))
        return (body?.data ?? []).map((form) => {
          const fields = (form.fields as Array<Record<string, unknown>> | undefined) ?? []
          const id = String(form.id)
          const sessionID = String(form.sessionID)
          rememberFormSession(id, sessionID)
          const keys = fields.map((field) => (field.key as string) ?? "")
          formKeys.set(id, keys)
          return {
            id,
            sessionID,
            questions: fields.map((field) => ({
              question: (field.description as string) ?? (field.title as string) ?? "",
              header: (field.title as string) ?? "",
              options: ((field.options as Array<Record<string, string>>) ?? []).map((option) => ({
                label: option.label ?? option.value ?? "",
                description: option.description ?? "",
              })),
              multiple: field.type === "multiselect",
              custom: field.custom === true,
            })),
            keys,
            tool: (form.metadata as { tool?: { messageID?: string; id?: string } } | undefined)?.tool,
          }
        })
      },

      reply: async (requestID: string, answers: string[][]) => {
        const sessionID = formSessions.get(requestID)
        if (!sessionID) throw new ApiError(404, `unknown form ${requestID}`)
        const keys = await keysFor(requestID, sessionID)
        const answer: Record<string, string | string[]> = {}
        answers.forEach((values, index) => {
          const key = keys[index] ?? `q${index}`
          answer[key] = values.length > 1 ? values : values[0] ?? ""
        })
        await request<void>(config, `/api/session/${sessionID}/form/${requestID}/reply`, {
          method: "POST",
          body: JSON.stringify({ answer }),
        })
        formSessions.delete(requestID)
        return true
      },

      reject: async (requestID: string) => {
        const sessionID = formSessions.get(requestID)
        if (!sessionID) throw new ApiError(404, `unknown form ${requestID}`)
        await request<void>(config, `/api/session/${sessionID}/form/${requestID}`, { method: "DELETE" })
        formSessions.delete(requestID)
        return true
      },
    },

    agent: {
      list: async (): Promise<Agent[]> => {
        const body = await request<unknown>(config, withLocation("/api/agent", directory))
        return (unwrap<Array<Record<string, unknown>>>(body) ?? []).map((agent) => ({
          name: String(agent.id ?? agent.name ?? ""),
          description: agent.description as string | undefined,
          mode: (agent.mode as Agent["mode"]) ?? "primary",
          hidden: agent.hidden as boolean | undefined,
          native: agent.native as boolean | undefined,
          options: {},
        }))
      },
    },

    command: {
      list: async (): Promise<Command[]> => {
        const body = await request<unknown>(config, withLocation("/api/command", directory))
        return (unwrap<Array<Record<string, unknown>>>(body) ?? []).map((command) => ({
          name: String(command.name ?? ""),
          description: command.description as string | undefined,
          template: "",
          hints: [],
        }))
      },
    },

    provider: {
      list: async () => {
        const [providerBody, modelBody] = await Promise.all([
          request<unknown>(config, withLocation("/api/provider", directory)),
          request<unknown>(config, withLocation("/api/model", directory)).catch(() => null),
        ])
        const providers = unwrap<Array<Record<string, unknown>>>(providerBody) ?? []
        const models = unwrap<Array<Record<string, unknown>>>(modelBody) ?? []
        const defaultBody = await request<unknown>(config, withLocation("/api/model/default", directory)).catch(() => null)
        const defaults = unwrap<{ modelID?: string; providerID?: string }>(defaultBody)

        return {
          all: providers.map((provider) => {
            const owned: Record<string, V2ModelShape> = {}
            for (const model of models.filter((m) => m.providerID === provider.id)) {
              owned[String(model.modelID ?? model.id)] = mapV2Model(model)
            }
            return {
              id: String(provider.id),
              name: String(provider.name ?? provider.id),
              models: owned,
            }
          }),
          default: defaults?.providerID && defaults.modelID ? { [defaults.providerID]: defaults.modelID } : {},
          connected: providers.filter((p) => models.some((m) => m.providerID === p.id)).map((p) => String(p.id)),
        }
      },
    },

    config: {
      get: async () => await request<unknown>(config, "/api/config"),
    },
  }
}

function mapProject(project: Record<string, unknown>): Project {
  const canonical = (project.canonical as string) ?? (project.directory as string) ?? (project.worktree as string) ?? ""
  return {
    id: String(project.id ?? ""),
    name: canonical.split("/").filter(Boolean).pop() ?? canonical,
    worktree: canonical,
    vcs: project.vcs === "git" ? "git" : undefined,
    time: project.time as Project["time"],
  }
}

function mapDiffs(diffs: FileDiff[]): FileDiff[] {
  return (diffs ?? []).map((diff) => ({
    file: diff.file,
    patch: diff.patch,
    additions: diff.additions ?? 0,
    deletions: diff.deletions ?? 0,
    status: diff.status,
  }))
}

interface V2ModelShape {
  id: string
  name: string
  attachment: boolean
  reasoning: boolean
  tool_call: boolean
  limit: { context: number; output: number }
  status?: "alpha" | "beta" | "deprecated" | "active"
  variants?: Record<string, { reasoningEffort?: string }>
}

function mapV2Model(model: Record<string, unknown>): V2ModelShape {
  const capabilities = (model.capabilities as { input?: string[]; output?: string[]; tools?: boolean } | undefined) ?? {}
  const variants = (model.variants as Array<{ id?: string; settings?: Record<string, unknown> }> | undefined) ?? []
  const variantMap: Record<string, { reasoningEffort?: string }> = {}
  for (const variant of variants) {
    if (!variant?.id) continue
    variantMap[String(variant.id)] = { reasoningEffort: variant.settings?.reasoningEffort as string | undefined }
  }
  const id = String(model.modelID ?? model.id)
  const limit = (model.limit as { context?: number; output?: number } | undefined) ?? {}
  return {
    id,
    name: String(model.name ?? id),
    attachment: (capabilities.input ?? []).includes("image"),
    reasoning: variants.some((variant) => variant?.settings && "reasoningEffort" in variant.settings),
    tool_call: capabilities.tools === true,
    limit: { context: limit.context ?? 0, output: limit.output ?? 0 },
    variants: variantMap,
  }
}
