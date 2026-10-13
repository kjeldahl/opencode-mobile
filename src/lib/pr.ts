// Pull request state for the chat's PR button, derived from the transcript
// alone (no GitHub token in the app). The agent drives everything with the
// `gh` CLI and ends each PR reply with a status line the app parses:
//
//   PR_STATUS branch=feat url=https://github.com/o/r/pull/12 state=open checks=passing
//
// Prompts the button sends start with a `[pr:<action>]` tag so the app can
// tell which action is running while the session is busy. Pure helpers (no
// React Native imports) so node:test can cover them.
import type { FileDiff, Message, Part, VcsInfo } from "./sdk"

export type PrChecks = "pending" | "passing" | "failing" | "none" | "unknown"
export type PrState = "open" | "merged" | "closed"
export type PrAction = "create" | "status" | "watch" | "merge"

export interface PrStatus {
  url: string
  number: number
  state: PrState
  checks: PrChecks
  branch?: string
}

const MARKER = /^[ \t]*PR_STATUS\b(.*)$/gm
const MARKER_LINE = /^[ \t]*PR_STATUS\b.*(\r?\n|$)/gm
const FIELD = /(\w+)=(\S+)/g
const PR_URL = /https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/(\d+)/
const TAG = /^\[pr:(create|status|watch|merge)\]/
const STATES: PrState[] = ["open", "merged", "closed"]
const CHECKS: PrChecks[] = ["pending", "passing", "failing", "none"]

function parseMarker(fields: string): PrStatus | undefined {
  const map: Record<string, string> = {}
  for (const match of fields.matchAll(FIELD)) map[match[1].toLowerCase()] = match[2]
  const url = map.url?.match(PR_URL)
  if (!url) return undefined
  const state = STATES.find((s) => s === map.state?.toLowerCase()) ?? "open"
  const checks = CHECKS.find((c) => c === map.checks?.toLowerCase()) ?? "unknown"
  return { url: url[0], number: Number(url[1]), state, checks, branch: map.branch }
}

// Last status line in a block of text, if any.
export function lastMarker(text: string): PrStatus | undefined {
  const found = [...text.matchAll(MARKER)].map((match) => parseMarker(match[1])).filter((s) => s !== undefined)
  return found[found.length - 1]
}

// Status lines are for the app, not the reader.
export function stripMarkers(text: string): string {
  if (!text.includes("PR_STATUS")) return text
  return text.replace(MARKER_LINE, "").trimEnd()
}

function output(part: Part): string {
  const out = part.state?.output
  return typeof out === "string" ? out : ""
}

function command(part: Part): string {
  const input = part.state?.input
  if (!input || typeof input !== "object") return ""
  const cmd = (input as { command?: unknown }).command
  return typeof cmd === "string" ? cmd : ""
}

// The newest PR for `branch` in the transcript: the agent's last status line,
// or the URL printed by a `gh pr create` the agent ran without reporting one.
// Status lines for another branch are skipped (the chat switched branches).
export function prFromTranscript(
  messages: Array<Pick<Message, "id" | "role">>,
  parts: Record<string, Part[] | undefined>,
  branch: string | undefined,
): PrStatus | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message.role !== "assistant") continue
    const list = parts[message.id] ?? []
    for (let j = list.length - 1; j >= 0; j--) {
      const part = list[j]
      if (part.type === "text" && part.text) {
        const marker = lastMarker(part.text)
        if (marker && (!marker.branch || !branch || marker.branch === branch)) return marker
        continue
      }
      if (part.type !== "tool" || !command(part).includes("gh pr create")) continue
      const url = output(part).match(PR_URL)
      if (url) return { url: url[0], number: Number(url[1]), state: "open", checks: "unknown", branch }
    }
  }
  return undefined
}

// Action of the newest user message when the button sent it.
export function lastAction(
  messages: Array<Pick<Message, "id" | "role">>,
  parts: Record<string, Part[] | undefined>,
): PrAction | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message.role !== "user") continue
    const text = (parts[message.id] ?? []).find((p) => p.type === "text")?.text ?? ""
    return text.match(TAG)?.[1] as PrAction | undefined
  }
  return undefined
}

// A branch is ready for a PR when it is off the default branch (same rule as
// branchOffered in changes.ts) and has changes.
export function prReady(info: VcsInfo | null | undefined, branch: FileDiff[] | undefined): boolean {
  if (!info?.branch || !info.default_branch || info.branch === info.default_branch) return false
  return !!branch && branch.length > 0
}

export type PrLabel =
  | "create"
  | "creating"
  | "checking"
  | "watching"
  | "merging"
  | "merged"
  | "closed"
  | PrChecks

export type PrTone = "neutral" | "success" | "danger" | "warning" | "merged" | "busy"

export interface PrView {
  label: PrLabel
  tone: PrTone
  canCreate: boolean
  canRefresh: boolean
  canWatch: boolean
  canMerge: boolean
}

const RUNNING: Record<PrAction, PrLabel> = {
  create: "creating",
  status: "checking",
  watch: "watching",
  merge: "merging",
}

const TONES: Record<PrChecks, PrTone> = {
  passing: "success",
  failing: "danger",
  pending: "warning",
  none: "neutral",
  unknown: "neutral",
}

// What the button shows. Undefined: hide it (no PR and nothing to open one for).
export function prView(input: {
  ready: boolean
  pr: PrStatus | undefined
  action: PrAction | undefined
  busy: boolean
}): PrView | undefined {
  const { ready, pr, action, busy } = input
  if (!pr && !ready && !(busy && action === "create")) return undefined
  const open = pr?.state === "open"
  const idle = !busy
  const view = {
    canCreate: idle && !pr && ready,
    canRefresh: idle && !!pr,
    canWatch: idle && open && pr?.checks !== "passing",
    canMerge: idle && open && pr?.checks === "passing",
  }
  if (busy && action) return { ...view, label: RUNNING[action], tone: "busy" }
  if (!pr) return { ...view, label: "create", tone: "neutral" }
  if (pr.state === "merged") return { ...view, label: "merged", tone: "merged" }
  if (pr.state === "closed") return { ...view, label: "closed", tone: "neutral" }
  return { ...view, label: pr.checks, tone: TONES[pr.checks] }
}

const REPORT = [
  "Finish your reply with exactly one status line on its own (plain text, not in a code block), filled in from `gh`:",
  "PR_STATUS branch=<branch> url=<pull request url> state=<open|merged|closed> checks=<pending|passing|failing|none>",
].join("\n")

export function prPrompt(action: PrAction, input: { branch: string; base?: string; url?: string }): string {
  const { branch, base, url } = input
  const target = url ?? `the pull request for branch \`${branch}\``
  const body: Record<PrAction, string> = {
    create: [
      `Open a GitHub pull request for branch \`${branch}\`${base ? ` into \`${base}\`` : ""}:`,
      "1. Commit any uncommitted changes that belong to this work, with a clear message.",
      "2. Push the branch (set the upstream if needed).",
      `3. If a pull request already exists for the branch, reuse it. Otherwise run \`gh pr create${base ? ` --base ${base}` : ""}\` with a concise title and a body summarizing the changes (follow the repository's PR template if it has one).`,
      "4. Check CI with `gh pr checks`.",
    ].join("\n"),
    status: `Report the state and CI checks of ${target} using \`gh pr view\` and \`gh pr checks\`. Do not change any code.`,
    watch: [
      `Watch ${target} until all its checks pass, fixing failures as they come:`,
      "1. Run `gh pr checks --watch` (give the command a long timeout).",
      "2. If a check fails, read its logs (`gh run view <run-id> --log-failed`), find the root cause, fix it, run the relevant checks locally, then commit and push.",
      "3. Repeat until every check passes. Never skip, disable or weaken tests. If a failure is unrelated to this pull request or cannot be fixed, stop and explain why.",
    ].join("\n"),
    merge: `Merge ${target} with \`gh pr merge\` (squash if the repository allows it). Only merge when all required checks pass; otherwise do not merge and explain why.`,
  }
  return `[pr:${action}]\n${body[action]}\n\n${REPORT}`
}
