// forge-front marks its sleeping workspaces in the response itself, so the app
// can tell "starting up" apart from "server is down". A plain opencode server
// never sends X-Forge-State, which is what makes the header usable as the
// marker (issue #10).
//
// Pure module — no expo/RN imports, same pattern as api-error.ts, so it stays
// unit-testable under plain `node --test`.

export type ForgeState = "waking" | "asleep" | "off"

// What forge answers when it has no Retry-After to offer for the state.
const FALLBACK_RETRY_AFTER_MS: Record<ForgeState, number> = {
  waking: 5_000,
  asleep: 30_000,
  off: 3_600_000,
}

// `wake_seconds` is an estimate, so it is only ever used for the countdown
// text. The wake itself is proven by the next successful request.
const DEFAULT_WAKE_SECONDS = 15

// Retry waking probes for at most this long, then surface the error instead of
// spinning forever. A real wake is ~10-15s.
export const WAKE_DEADLINE_MS = 120_000

export interface WorkspaceWakeInfo {
  state: ForgeState
  retryAfterMs: number
  wakeSeconds: number
  workspace?: string
}

/** Thrown by sdk.ts on a 503 that carries X-Forge-State, so call sites can
 *  tell a starting/stopped workspace from a dead server without parsing the
 *  status code or the message string. */
export class WorkspaceWakingError extends Error {
  readonly state: ForgeState
  readonly retryAfterMs: number
  readonly wakeSeconds: number
  readonly workspace?: string

  constructor(info: WorkspaceWakeInfo) {
    super(
      `Workspace${info.workspace ? ` ${info.workspace}` : ""} is ${info.state}` +
        ` (retry in ${Math.round(info.retryAfterMs / 1000)}s)`,
    )
    this.name = "WorkspaceWakingError"
    this.state = info.state
    this.retryAfterMs = info.retryAfterMs
    this.wakeSeconds = info.wakeSeconds
    this.workspace = info.workspace
  }
}

export function isWorkspaceWakingError(error: unknown): error is WorkspaceWakingError {
  return error instanceof WorkspaceWakingError
}

export interface HeaderReader {
  get(name: string): string | null
}

function readState(raw: string | null): ForgeState | null {
  const value = raw?.trim().toLowerCase()
  if (value === "waking" || value === "asleep" || value === "off") return value
  return null
}

function readRetryAfter(raw: string | null, state: ForgeState): number {
  if (raw === null) return FALLBACK_RETRY_AFTER_MS[state]
  const seconds = Number(raw.trim())
  if (!Number.isFinite(seconds) || seconds < 0) return FALLBACK_RETRY_AFTER_MS[state]
  return Math.round(seconds * 1000)
}

function readBody(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** Build the typed error for a response forge-front marked with X-Forge-State.
 *  Returns null for anything else — most importantly a bare 503, which is an
 *  ordinary server failure and must keep its old generic handling. */
export function parseForgeState(status: number, headers: HeaderReader, body: string): WorkspaceWakingError | null {
  if (status !== 503) return null

  const payload = readBody(body)
  const forge = payload?.forge
  const details = forge && typeof forge === "object" ? (forge as Record<string, unknown>) : null

  // The header is what forge-front always sends. The body's state is the
  // fallback for the case where a proxy ate the header, which still beats
  // reading a starting workspace as a dead server.
  const state = readState(headers.get("x-forge-state")) ?? readState(typeof details?.state === "string" ? details.state : null)
  if (!state) return null

  return new WorkspaceWakingError({
    state,
    retryAfterMs: readRetryAfter(headers.get("retry-after"), state),
    wakeSeconds: typeof details?.wake_seconds === "number" ? details.wake_seconds : DEFAULT_WAKE_SECONDS,
    workspace: typeof details?.workspace === "string" ? details.workspace : undefined,
  })
}

/** A workspace is reachable again as soon as a real request succeeds — that's
 *  the only proof worth acting on. Keep calling `probe` until it does, waiting
 *  `retryAfterMs` between the 503s and giving up after `deadlineMs`.
 *
 *  `asleep` gets retried too: the probe is what wakes it, so every answer here
 *  is progress. `off` never recovers on its own (it needs the forge hub), so it
 *  is thrown immediately instead of burning two minutes of retries. */
export async function untilAwake<T>(
  probe: () => Promise<T>,
  options: {
    sleep: (ms: number) => Promise<void>
    now?: () => number
    deadlineMs?: number
    onState?: (info: { state: ForgeState; wakeSeconds: number }) => void
  },
): Promise<T> {
  const now = options.now ?? Date.now
  const deadline = now() + (options.deadlineMs ?? WAKE_DEADLINE_MS)

  for (;;) {
    try {
      return await probe()
    } catch (error) {
      if (!isWorkspaceWakingError(error) || error.state === "off") throw error
      if (now() >= deadline) throw error
      options.onState?.({ state: error.state, wakeSeconds: error.wakeSeconds })
      await options.sleep(Math.max(1, Math.min(error.retryAfterMs, deadline - now())))
    }
  }
}
