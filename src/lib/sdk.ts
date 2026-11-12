// SDK client wrapper for React Native
// We create our own lightweight client that mirrors the opencode SDK patterns
// but works in React Native environment
// expo/fetch provides WinterCG-compliant fetch with ReadableStream support for SSE
import { fetch as expoFetch } from "expo/fetch"
import { buildRequestHeaders } from "./headers"
import { SSEParser } from "./sse"
import { apiErrorFor, ApiError } from "./api-error"
import { parseForgeState } from "./forge"
import { forgePrPath, readForgePr, type ForgePr } from "./forge-pr"
import { loadSessionList } from "./session-list"
import { detectServerMajor, type ServerMajor } from "./server-version"
import { createV2Client, V2EventTranslator } from "./sdk-v2"
import type { FileRoot } from "./file-roots"

export { ApiAuthError, isAuthError } from "./api-error"
export { ApiError } from "./api-error"
export { WorkspaceWakingError, isWorkspaceWakingError } from "./forge"

export interface ClientConfig {
  baseUrl: string
  directory?: string
  auth?: {
    username: string
    password: string
  }
}

export interface Session {
  id: string
  slug: string
  projectID: string
  directory: string
  parentID?: string
  title: string
  version: string
  share?: { url: string }
  time: {
    created: number
    updated: number
    compacting?: number
    archived?: number
  }
  summary?: {
    additions: number
    deletions: number
    files: number
  }
  // Present while a message (and everything after it) is pending revert —
  // the server keeps the underlying messages until the next prompt/summarize
  // call runs cleanup (or the revert is undone via session.unrevert).
  revert?: {
    messageID: string
    partID?: string
  }
}

export interface Message {
  id: string
  sessionID: string
  role: "user" | "assistant"
  parentID?: string
  time: {
    created: number
    completed?: number
  }
  // User message fields
  agent?: string
  model?: { providerID: string; modelID: string }
  // Assistant message fields
  modelID?: string
  providerID?: string
  cost?: number
  tokens?: {
    input: number
    output: number
    reasoning?: number
    cache?: { read: number; write: number }
  }
  error?: { message: string }
  finish?: string
}

// One file's change, as returned by /vcs/diff and /session/:id/diff.
export interface FileDiff {
  file: string
  patch?: string
  additions: number
  deletions: number
  status?: "added" | "deleted" | "modified"
}

// "git": working tree vs HEAD (uncommitted). "branch": working tree vs the
// merge-base with the default branch (everything on this branch).
export type VcsMode = "git" | "branch"

export interface VcsInfo {
  branch?: string
  default_branch?: string
}

// API returns messages with parts embedded
export interface MessageWithParts {
  info: Message
  parts: Part[]
}

export interface Part {
  id: string
  sessionID?: string
  messageID: string
  type:
    | "text"
    | "reasoning"
    | "tool"
    | "file"
    | "snapshot"
    | "patch"
    | "step-start"
    | "step-finish"
    | "subtask"
    | "retry"
    | "compaction"
    | "agent"
  // Text / reasoning part
  text?: string
  // Tool part
  tool?: string
  callID?: string
  state?: {
    status: "pending" | "running" | "completed" | "error"
    input?: unknown
    output?: unknown
    title?: string
    error?: { message: string }
    time?: { start?: number; end?: number }
  }
  // Timing
  time?: { start?: number; end?: number }
  // File part
  mime?: string
  url?: string
  filename?: string
}

export interface Agent {
  name: string
  description?: string
  mode: "subagent" | "primary" | "all"
  native?: boolean
  hidden?: boolean
  topP?: number
  temperature?: number
  color?: string
  model?: { modelID: string; providerID: string }
  prompt?: string
  options: Record<string, unknown>
  steps?: number
}

export interface Command {
  name: string
  description?: string
  agent?: string
  model?: string
  mcp?: boolean
  template: string
  subtask?: boolean
  hints: string[]
}

// Server shape is { id, worktree, vcs?, name?, time }. `path` is the shape this
// client used to assume; kept optional for older servers. Read the directory
// with projectDir() from ./projects.
export interface Project {
  id: string
  name?: string
  worktree?: string
  vcs?: "git"
  time?: { created: number; updated: number; initialized?: number }
  path?: {
    cwd: string
    root: string
    absolute: string
  }
}

export interface FileEntry {
  name: string
  path: string
  absolute: string
  type: "file" | "directory"
  ignored: boolean
}

export interface Event {
  type: string
  properties: Record<string, unknown>
}

export interface HealthResponse {
  healthy: boolean
  version: string
}

// A pending permission request, as both API families expose it. 1.x answers
// `tool`/`input`; 2.x answers `action`/`resources`, which the adapter maps onto
// the same `permission`/`patterns` fields the UI already renders
// (PermissionPrompt.tsx).
export interface PermissionRequest {
  id: string
  sessionID: string
  permission: string
  patterns: string[]
  metadata?: Record<string, unknown>
  tool?: { messageID?: string; callID?: string }
}

// A pending question. 1.x calls them questions, 2.x calls them forms; both map
// onto this shape. `keys` carries the 2.x answer keys so replies can be keyed
// correctly (the UI replies positionally).
export interface QuestionRequest {
  id: string
  sessionID: string
  questions: Array<{
    question: string
    header: string
    options: Array<{ label: string; description: string }>
    multiple?: boolean
    custom?: boolean
  }>
  keys?: string[]
  tool?: { messageID?: string; callID?: string }
}

const REQUEST_TIMEOUT_MS = 30_000

function createHeaders(config: ClientConfig): HeadersInit {
  return buildRequestHeaders(config)
}

// `timeoutMs` lets specific callers (e.g. the onboarding health-check) fail
// faster than the general REQUEST_TIMEOUT_MS used by real session calls.
// Leave it unset to get the default.
async function request<T>(
  config: ClientConfig,
  path: string,
  options: RequestInit = {},
  timeoutMs?: number,
): Promise<T> {
  const url = `${config.baseUrl}${path}`
  const headers = { ...createHeaders(config), ...options.headers }
  const response = await fetchWithTimeout(
    url,
    {
      ...options,
      headers,
    },
    timeoutMs,
  )

  if (!response.ok) throw await errorFor(response, "API Error")

  return response.json()
}

// Error for a failed response. A 503 that forge-front marked with
// X-Forge-State is a workspace starting or stopped, not a server failure, so
// it becomes a typed error the caller can act on (see ./forge, issue #10).
async function errorFor(response: Response, prefix: string): Promise<Error> {
  const body = await response.text()
  return parseForgeState(response.status, response.headers, body) ?? apiErrorFor(response.status, `${prefix}: ${response.status} - ${body}`)
}

async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs: number = REQUEST_TIMEOUT_MS): Promise<Response> {
  const parentSignal = options.signal
  if (parentSignal?.aborted) throw new Error("Request aborted")

  const controller = new AbortController()
  let timedOut = false
  const timeout = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  const onParentAbort = () => controller.abort()
  parentSignal?.addEventListener("abort", onParentAbort)

  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } catch (error) {
    if (timedOut) {
      throw new Error(`Request timed out after ${timeoutMs}ms`)
    }
    throw error
  } finally {
    clearTimeout(timeout)
    parentSignal?.removeEventListener("abort", onParentAbort)
  }
}

export function createV1Client(config: ClientConfig) {
  // Normalize once: a trailing slash on baseUrl (e.g. pasted into Advanced
  // mode or the Edit screen) would otherwise survive into every
  // `${config.baseUrl}${path}` concatenation below as a double slash, which
  // every request then fails against (while the diagnostics probe, which
  // reconstructs a clean URL, reports "works now"). A bare URL with no
  // trailing slash is untouched.
  config = { ...config, baseUrl: config.baseUrl.replace(/\/+$/, "") }
  return {
    global: {
      // `timeoutMs` overrides the default REQUEST_TIMEOUT_MS — used by the
      // onboarding connection test to fail fast on a bad/unreachable IP
      // instead of hanging for the full 30s (issue: first-run bounce).
      health: (timeoutMs?: number) => request<HealthResponse>(config, "/global/health", {}, timeoutMs),

      // Probe of which API family this server speaks, cached per server.
      // `force` re-probes — used by the SSE reconnect loop. See ./server-version.
      detect: async (force?: boolean) => await detectServerMajor(config, { force }),
      // SSE event stream - returns async iterator
      // Pass an AbortSignal to cancel the connection
      async *events(signal?: AbortSignal): AsyncGenerator<Event> {
        const url = `${config.baseUrl}/global/event`
        const headers = createHeaders(config)
        // Remove Content-Type for SSE (it's text/event-stream)
        delete (headers as Record<string, string>)["Content-Type"]

        // Must use expo/fetch for ReadableStream support on native
        const response = await expoFetch(url, { headers, signal })
        if (!response.ok || !response.body) {
          // A sleeping workspace answers the stream with 503 + X-Forge-State
          // and does NOT wake on it — the typed error lets the reconnect loop
          // wait out Retry-After instead of reporting a connection failure.
          const waking = parseForgeState(response.status, response.headers, "")
          if (waking) throw waking
          throw apiErrorFor(response.status, `Failed to connect to event stream: ${response.status}`)
        }

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        const parser = new SSEParser()

        let receivedFirstByte = false
        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) {
              console.log("[SSE] stream ended")
              break
            }

            if (!receivedFirstByte) {
              receivedFirstByte = true
              console.log(`[SSE] first byte received (${value?.byteLength ?? 0} bytes)`)
            }

            for (const data of parser.push(decoder.decode(value, { stream: true }))) {
              try {
                yield JSON.parse(data)
              } catch (err) {
                console.warn("[SSE] Failed to parse event", {
                  length: data.length,
                  error: err instanceof Error ? err.message : String(err),
                })
              }
            }
          }
        } finally {
          reader.releaseLock()
        }
      },
    },

    project: {
      list: () => request<Project[]>(config, "/project"),
      current: () => request<Project>(config, "/project/current"),
    },

    // Server-side filesystem browsing, scoped to this client's directory
    // (see ClientConfig.directory / x-opencode-directory header). Use
    // clientForDirectory(dir) to get a client rooted at a specific folder,
    // then list("." ) to enumerate its immediate children.
    file: {
      list: (params: { path?: string } = {}) => {
        const query = new URLSearchParams({ path: params.path ?? "." })
        return request<FileEntry[]>(config, `/file?${query.toString()}`)
      },
      // Enumerate the server's filesystem roots (mounted drives, home dir)
      // to seed the directory browser's pinned top-level entries. Resolves
      // to null on servers that don't yet expose GET /file/roots (older
      // opencode builds) so callers fall back to manual path entry instead
      // of crashing; other errors propagate like any other request.
      roots: async (): Promise<FileRoot[] | null> => {
        try {
          return await request<FileRoot[]>(config, "/file/roots")
        } catch (err) {
          if (err instanceof ApiError && err.status === 404) return null
          throw err
        }
      },
    },

    // Version control state of this client's directory. The directory also
    // goes in the query: a request without one is answered (200) for the
    // server's default folder, i.e. silently the wrong repo.
    vcs: {
      get: () => {
        const query = config.directory ? `?${new URLSearchParams({ directory: config.directory }).toString()}` : ""
        return request<VcsInfo>(config, `/vcs${query}`)
      },
      diff: (mode: VcsMode) => {
        const query = new URLSearchParams({ mode })
        if (config.directory) query.set("directory", config.directory)
        return request<FileDiff[]>(config, `/vcs/diff?${query.toString()}`)
      },
    },

    // forge-only endpoints (issue #15). A plain opencode server answers 404,
    // which readForgePr turns into `supported: false`.
    forge: {
      pr: async (directory: string, refresh?: boolean): Promise<ForgePr> => {
        const response = await fetchWithTimeout(`${config.baseUrl}${forgePrPath(directory, refresh)}`, {
          headers: createHeaders(config),
        })
        const body = await response.text()
        const waking = parseForgeState(response.status, response.headers, body)
        if (waking) throw waking
        return readForgePr(response.status, body)
      },
    },

    path: {
      get: () =>
        request<{ home: string; state: string; config: string; worktree: string; directory: string }>(config, "/path"),
    },

    session: {
      // Prefer the GLOBAL experimental endpoint (all sessions across every
      // directory) so the Recent Sessions list works without the user first
      // picking a folder — a directory-less GET /session is directory-scoped
      // and returns [] on servers whose active dir has no sessions. Shaping
      // (roots filter, search, sort-by-updated, limit) happens client-side in
      // loadSessionList; we fetch /experimental/session with no query params
      // because the server applies `limit` before we can filter to roots.
      // Falls back to the legacy /session path only on 404 (older servers).
      list: (params?: { roots?: boolean; limit?: number; search?: string }): Promise<Session[]> =>
        loadSessionList(
          {
            getExperimental: async (): Promise<Session[] | null> => {
              const response = await fetchWithTimeout(`${config.baseUrl}/experimental/session`, {
                headers: createHeaders(config),
              })
              // Older servers lack this route — signal fallback to legacy /session.
              if (response.status === 404) return null
              if (!response.ok) throw await errorFor(response, "API Error")
              return response.json()
            },
            getLegacy: (query) => request<Session[]>(config, `/session${query}`),
          },
          params,
        ),

      get: (sessionID: string) => request<Session>(config, `/session/${sessionID}`),

      create: (params?: { title?: string }) =>
        request<Session>(config, "/session", {
          method: "POST",
          body: JSON.stringify(params || {}),
        }),

      delete: (sessionID: string) => request<void>(config, `/session/${sessionID}`, { method: "DELETE" }),

      update: (sessionID: string, params: { title?: string; time?: { archived?: number } }) =>
        request<Session>(config, `/session/${sessionID}`, {
          method: "PATCH",
          body: JSON.stringify(params),
        }),

      messages: (sessionID: string, params?: { limit?: number }) => {
        const query = new URLSearchParams()
        if (params?.limit) query.set("limit", String(params.limit))
        const qs = query.toString()
        return request<MessageWithParts[]>(config, `/session/${sessionID}/message${qs ? `?${qs}` : ""}`)
      },

      // Sends a message and returns the response
      // Fire-and-forget async prompt - SSE events drive all real-time updates
      prompt: async (
        sessionID: string,
        params: {
          parts: Array<{ type: "text"; text: string } | { type: "file"; mime: string; url: string; filename?: string }>
          model?: { providerID: string; modelID: string }
          agent?: string
          variant?: string
        },
      ): Promise<void> => {
        const url = `${config.baseUrl}/session/${sessionID}/prompt_async`
        const headers = createHeaders(config)
        const body = JSON.stringify(params)
        const response = await fetchWithTimeout(url, {
          method: "POST",
          headers,
          body,
        })

        if (!response.ok) throw await errorFor(response, "Failed to send message")
      },

      command: async (
        sessionID: string,
        params: {
          command: string
          arguments: string
          agent?: string
          model?: string
          variant?: string
          parts?: Array<{ type: "file"; mime: string; url: string; filename?: string }>
        },
      ): Promise<void> => {
        const url = `${config.baseUrl}/session/${sessionID}/command`
        const headers = createHeaders(config)

        const response = await fetchWithTimeout(url, {
          method: "POST",
          headers,
          body: JSON.stringify({ ...params, sessionID }),
        })

        if (!response.ok) throw await errorFor(response, "Failed to run command")
      },

      abort: (sessionID: string) => request<boolean>(config, `/session/${sessionID}/abort`, { method: "POST" }),

      diff: (sessionID: string, messageID?: string) => {
        const query = new URLSearchParams()
        if (messageID) query.set("messageID", messageID)
        if (config.directory) query.set("directory", config.directory)
        const qs = query.toString()
        return request<FileDiff[]>(config, `/session/${sessionID}/diff${qs ? `?${qs}` : ""}`)
      },

      // Marks messageID (and everything after it) as pending revert. The
      // underlying messages aren't deleted until the next prompt runs
      // cleanup, or the revert is undone with unrevert() below.
      revert: (sessionID: string, messageID: string, partID?: string) =>
        request<Session>(config, `/session/${sessionID}/revert`, {
          method: "POST",
          body: JSON.stringify(partID ? { messageID, partID } : { messageID }),
        }),

      unrevert: (sessionID: string) =>
        request<Session>(config, `/session/${sessionID}/unrevert`, {
          method: "POST",
        }),
    },

    permission: {
      list: () => request<PermissionRequest[]>(config, "/permission"),

      reply: (requestID: string, reply: "once" | "always" | "reject") =>
        request<boolean>(config, `/permission/${requestID}/reply`, {
          method: "POST",
          body: JSON.stringify({ reply }),
        }),
    },

    question: {
      list: () => request<QuestionRequest[]>(config, "/question"),

      reply: (requestID: string, answers: string[][]) =>
        request<boolean>(config, `/question/${requestID}/reply`, {
          method: "POST",
          body: JSON.stringify({ answers }),
        }),

      reject: (requestID: string) =>
        request<boolean>(config, `/question/${requestID}/reject`, {
          method: "POST",
        }),
    },

    agent: {
      list: () => request<Agent[]>(config, "/agent"),
    },

    command: {
      list: () => request<Command[]>(config, "/command"),
    },

    provider: {
      list: () =>
        request<{
          all: Array<{
            id: string
            name: string
            models: Record<
              string,
              {
                id: string
                name: string
                attachment: boolean
                reasoning: boolean
                tool_call: boolean
                cost?: { input: number; output: number }
                limit: { context: number; output: number }
                status?: "alpha" | "beta" | "deprecated" | "active"
                variants?: Record<string, { reasoningEffort?: string }>
              }
            >
          }>
          default: Record<string, string>
          connected: string[]
        }>(config, "/provider"),
    },

    config: {
      get: () => request<unknown>(config, "/config"),
    },
  }
}

export type Client = ReturnType<typeof createV1Client>

// SSE stream against the 2.x `/api/event` endpoint. 2.x frames are
// `data: {"id","created","type","location","data"}` plus `: heartbeat` comments,
// and every event is granular (a `session.text.delta` is one chunk, not the
// whole part). V2EventTranslator accumulates them into the complete
// `message.part.updated`-style events the stores already dispatch on.
async function* eventsV2(config: ClientConfig, signal?: AbortSignal): AsyncGenerator<Event> {
  const translator = new V2EventTranslator()
  const url = `${config.baseUrl}/api/event`
  const headers = createHeaders(config)
  delete (headers as Record<string, string>)["Content-Type"]

  const response = await expoFetch(url, { headers, signal })
  if (!response.ok || !response.body) {
    const waking = parseForgeState(response.status, response.headers, "")
    if (waking) throw waking
    throw apiErrorFor(response.status, `Failed to connect to event stream: ${response.status}`)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const parser = new SSEParser()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        console.log("[SSE] v2 stream ended")
        break
      }
      for (const data of parser.push(decoder.decode(value, { stream: true }))) {
        let raw: unknown
        try {
          raw = JSON.parse(data)
        } catch (err) {
          console.warn("[SSE] Failed to parse v2 event", {
            length: data.length,
            error: err instanceof Error ? err.message : String(err),
          })
          continue
        }
        const event = raw as { id?: string; created?: number; type: string; data?: Record<string, unknown> }
        for (const mapped of translator.translate(event)) yield mapped
      }
    }
  } finally {
    reader.releaseLock()
  }
}

/**
 * Build a client for `config.baseUrl`, transparently speaking the 1.x or the
 * 2.x API.
 *
 * The first call probes `GET /api/info` (see ./server-version) and every
 * request afterwards goes to whichever implementation answered for that
 * server, so the 1.x path keeps working exactly as before and 2.x workspaces
 * need nothing special from the screens or stores. `global.detect(true)` is
 * called by the SSE reconnect loop so a server upgraded in place is picked up
 * without restarting the app.
 */
export function createClient(config: ClientConfig): Client {
  const scoped: ClientConfig = { ...config, baseUrl: config.baseUrl.replace(/\/+$/, "") }
  const v1 = createV1Client(scoped)
  let current: { major: ServerMajor; client: Client } | null = null

  const resolve = async (force = false): Promise<Client> => {
    if (force || !current) {
      const major = await detectServerMajor(scoped, { force })
      current = {
        major,
        client: major === "v2" ? createV2Client(scoped, (signal) => eventsV2(scoped, signal)) : v1,
      }
    }
    return current.client
  }

  return {
    global: {
      health: (timeoutMs?: number) => resolve().then((c) => c.global.health(timeoutMs)),
      events: async function* (signal?: AbortSignal) {
        const client = await resolve()
        yield* client.global.events(signal)
      },
      detect: async (force?: boolean) => {
        await resolve(force)
        return (await current)?.major ?? "v1"
      },
    },
    project: {
      list: () => resolve().then((c) => c.project.list()),
      current: () => resolve().then((c) => c.project.current()),
    },
    file: {
      list: (params?: { path?: string }) => resolve().then((c) => c.file.list(params)),
      roots: () => resolve().then((c) => c.file.roots()),
    },
    vcs: {
      get: () => resolve().then((c) => c.vcs.get()),
      diff: (mode: VcsMode) => resolve().then((c) => c.vcs.diff(mode)),
    },
    forge: {
      pr: (directory: string, refresh?: boolean) => resolve().then((c) => c.forge.pr(directory, refresh)),
    },
    path: {
      get: () => resolve().then((c) => c.path.get()),
    },
    session: {
      list: (params?: { roots?: boolean; limit?: number; search?: string }) => resolve().then((c) => c.session.list(params)),
      get: (sessionID: string) => resolve().then((c) => c.session.get(sessionID)),
      create: (params?: { title?: string }) => resolve().then((c) => c.session.create(params)),
      delete: (sessionID: string) => resolve().then((c) => c.session.delete(sessionID)),
      update: (sessionID: string, params: { title?: string; time?: { archived?: number } }) =>
        resolve().then((c) => c.session.update(sessionID, params)),
      messages: (sessionID: string, params?: { limit?: number }) => resolve().then((c) => c.session.messages(sessionID, params)),
      prompt: (sessionID: string, params: Parameters<Client["session"]["prompt"]>[1]) =>
        resolve().then((c) => c.session.prompt(sessionID, params)),
      command: (sessionID: string, params: Parameters<Client["session"]["command"]>[1]) =>
        resolve().then((c) => c.session.command(sessionID, params)),
      abort: (sessionID: string) => resolve().then((c) => c.session.abort(sessionID)),
      diff: (sessionID: string, messageID?: string) => resolve().then((c) => c.session.diff(sessionID, messageID)),
      revert: (sessionID: string, messageID: string, partID?: string) =>
        resolve().then((c) => c.session.revert(sessionID, messageID, partID)),
      unrevert: (sessionID: string) => resolve().then((c) => c.session.unrevert(sessionID)),
    },
    permission: {
      list: () => resolve().then((c) => c.permission.list()),
      reply: (requestID: string, reply: "once" | "always" | "reject") => resolve().then((c) => c.permission.reply(requestID, reply)),
    },
    question: {
      list: () => resolve().then((c) => c.question.list()),
      reply: (requestID: string, answers: string[][]) => resolve().then((c) => c.question.reply(requestID, answers)),
      reject: (requestID: string) => resolve().then((c) => c.question.reject(requestID)),
    },
    agent: {
      list: () => resolve().then((c) => c.agent.list()),
    },
    command: {
      list: () => resolve().then((c) => c.command.list()),
    },
    provider: {
      list: () => resolve().then((c) => c.provider.list()),
    },
    config: {
      get: () => resolve().then((c) => c.config.get()),
    },
  }
}
