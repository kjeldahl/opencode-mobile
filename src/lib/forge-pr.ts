// PR state read straight from forge (issue #15): forge-front runs fixed `git`
// and `gh` commands in the workspace and answers
//
//   GET /__forge/pr?directory=<repo>[&refresh=1]
//   { directory, branch, pr: { number, url, state, draft, checks, failing } | null, checked_at }
//
// A plain opencode server answers 404, which tells the app to fall back to the
// PR_STATUS lines in the transcript (lib/pr.ts). A sleeping workspace answers
// 503 + X-Forge-State, the typed error from ./forge (the endpoint never wakes
// it; sdk.ts raises that before calling readForgePr). Pure module (no RN
// imports) so node:test covers it.
import type { PrChecks, PrState, PrStatus } from "./pr"

export interface ForgePrResponse {
  directory?: string
  branch?: string
  pr?: {
    number?: number
    url?: string
    state?: string
    draft?: boolean
    checks?: string
    failing?: unknown
  } | null
  checked_at?: number
}

// What the endpoint said. `supported: false` is a server without it (404).
export type ForgePr =
  | { supported: false }
  | { supported: true; branch?: string; pr: PrStatus | undefined; checkedAt?: number }

const PR_URL = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/(\d+)/
const STATES: PrState[] = ["open", "merged", "closed"]
const CHECKS: PrChecks[] = ["pending", "passing", "failing", "none"]

export function forgePrPath(directory: string, refresh?: boolean): string {
  const query = new URLSearchParams({ directory })
  if (refresh) query.set("refresh", "1")
  return `/__forge/pr?${query.toString()}`
}

// Response body -> what the PR button shows. Undefined when the branch has no
// PR (or the body is not one we understand).
export function prFromForge(body: ForgePrResponse): PrStatus | undefined {
  const pr = body.pr
  if (!pr || typeof pr.url !== "string") return undefined
  const url = pr.url.match(PR_URL)
  if (!url) return undefined
  const number = typeof pr.number === "number" ? pr.number : Number(url[1])
  const state = STATES.find((s) => s === pr.state) ?? "open"
  const checks = CHECKS.find((c) => c === pr.checks) ?? "unknown"
  const failing = Array.isArray(pr.failing) ? pr.failing.filter((f): f is string => typeof f === "string") : []
  return { url: pr.url, number, state, checks, branch: body.branch, draft: pr.draft === true, failing }
}

function body(raw: string): ForgePrResponse | undefined {
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === "object" ? (parsed as ForgePrResponse) : undefined
  } catch {
    return undefined
  }
}

function message(raw: string): string {
  const error = (body(raw) as { error?: unknown } | undefined)?.error
  return typeof error === "string" ? error : raw.slice(0, 200)
}

// Read one response (status + body text). Throws for 400/502/anything else.
export function readForgePr(status: number, raw: string): ForgePr {
  if (status === 404) return { supported: false }
  if (status < 200 || status >= 300) throw new Error(`PR status ${status}: ${message(raw)}`)
  const parsed = body(raw)
  if (!parsed) throw new Error("PR status: invalid response")
  const checkedAt = typeof parsed.checked_at === "number" ? parsed.checked_at : undefined
  return { supported: true, branch: parsed.branch, pr: prFromForge(parsed), checkedAt }
}
