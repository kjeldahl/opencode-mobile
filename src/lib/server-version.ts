// Per-connection server major-version detection.
//
// The same URL is answered by two incompatible API families: opencode 1.x
// exposes `/global/health`, `/session/...`; opencode 2.x moved everything under
// `/api/*`. The only cheap, reliable discriminator is `GET /api/info`:
//
//   * a 2.x server answers `application/json` with `{"version":"2.0.29",...}`
//   * a 1.x server answers 200 with its web app's HTML (checked on 1.18.32)
//
// So the decision is made on the content type + parse result, never on the
// status code — and anything that is not 2.x JSON is treated as 1.x.
import { buildRequestHeaders } from "./headers.ts"

export type ServerMajor = "v1" | "v2"

export interface VersionProbeConfig {
  baseUrl: string
  auth?: { username: string; password: string }
}

// Cached per server. `baseUrl` alone is not enough: the same host can be
// migrated in place, and a connection edited to point at a different major on
// the same URL must re-probe.
const cache = new Map<string, ServerMajor>()

// How long the probe waits for /api/info before it is treated as unreachable.
const PROBE_TIMEOUT_MS = 10_000

function key(config: VersionProbeConfig): string {
  return `${config.baseUrl.replace(/\/+$/, "")}::${config.auth?.username ?? ""}:${config.auth?.password ?? ""}`
}

/**
 * Decide whether `baseUrl` speaks the 2.x API. Falls back to "v1" for anything
 * that is not 2.x JSON (HTML page, unknown shape, network failure), so a
 * half-working probe can never hide a 1.x server.
 */
export async function detectServerMajor(
  config: VersionProbeConfig,
  init: { force?: boolean; timeoutMs?: number } = {},
): Promise<ServerMajor> {
  const id = key(config)
  if (!init.force) {
    const cached = cache.get(id)
    if (cached) return cached
  }

  const verdict = await attempt(config, init.timeoutMs ?? PROBE_TIMEOUT_MS)
  // A workspace that is only still starting gives no verdict — do not cache
  // "v1" for it, or it would keep the wrong API family after it wakes.
  if (verdict !== "waking") cache.set(id, verdict)
  return verdict === "waking" ? cache.get(id) ?? "v1" : verdict
}

export function clearServerMajorCache(): void {
  cache.clear()
}

export function cachedServerMajor(config: VersionProbeConfig): ServerMajor | undefined {
  return cache.get(key(config))
}

async function attempt(config: VersionProbeConfig, timeoutMs: number): Promise<ServerMajor | "waking"> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(`${config.baseUrl.replace(/\/+$/, "")}/api/info`, {
      headers: buildRequestHeaders({ auth: config.auth }),
      signal: controller.signal,
    })
    if (!response.ok) return isWaking(response.status, response.headers) ? "waking" : "v1"

    // A 1.x server answers this exact request with 200 + HTML, so the content
    // type is the check; a JSON body that is not 2.x is a 1.x (or future-shape)
    // server we must keep talking to over the 1.x routes.
    const contentType = response.headers.get("content-type") || ""
    if (!contentType.includes("application/json")) return "v1"

    const body = (await response.json()) as { version?: unknown }
    const version = typeof body?.version === "string" ? body.version : ""
    return /^([2-9])\./.test(version) ? "v2" : "v1"
  } catch {
    return "v1"
  } finally {
    clearTimeout(timer)
  }
}

function isWaking(status: number, headers: Headers): boolean {
  if (status !== 503) return false
  return headers.get("x-forge-state") !== null
}
