// Pure helpers for the Changes view (no React Native imports, so node:test can
// cover them). Patch parsing follows chliny's patch-compute from upstream
// PR #192 (MIT).
import type { DiffLine } from "../components/chat/diff-compute"
import type { FileDiff } from "./sdk"

export type ChangeTab = "branch" | "git" | "turn"

export interface ChangeTotals {
  files: number
  additions: number
  deletions: number
}

export function totals(diffs: FileDiff[] | undefined): ChangeTotals {
  const list = diffs ?? []
  return {
    files: list.length,
    additions: list.reduce((sum, diff) => sum + (diff.additions || 0), 0),
    deletions: list.reduce((sum, diff) => sum + (diff.deletions || 0), 0),
  }
}

// Counts for the session list and chat header: everything on the branch, or,
// on the default branch (where branch mode is empty), the uncommitted edits.
export function headline(branch: FileDiff[] | undefined, git: FileDiff[] | undefined): ChangeTotals {
  if (branch && branch.length > 0) return totals(branch)
  return totals(git)
}

export function sortDiffs(diffs: FileDiff[]): FileDiff[] {
  return [...diffs].sort((a, b) => a.file.localeCompare(b.file))
}

// Last user message, i.e. the start of the current turn. Temp (optimistic)
// ids are skipped: the server does not know them yet.
export function lastUserMessageID(messages: Array<{ id: string; role: string }>): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message.role === "user" && !message.id.startsWith("temp-")) return message.id
  }
  return undefined
}

export function splitPath(file: string): { dir: string; name: string } {
  const index = file.lastIndexOf("/")
  if (index === -1) return { dir: "", name: file }
  return { dir: file.slice(0, index + 1), name: file.slice(index + 1) }
}

const MAX_PATCH_LINES = 5000

// Unified diff (git or jsdiff output) to the DiffView line model. File
// headers (diff --git, index, ---/+++, Index:, ====) are dropped; hunk headers
// stay as context lines so the jumps between hunks remain visible.
export function parsePatch(patch: string | undefined): DiffLine[] {
  if (!patch) return []
  const source = patch.split(/\r?\n/)
  const lines: DiffLine[] = []
  let inHunk = false
  for (const text of source) {
    if (lines.length >= MAX_PATCH_LINES) {
      lines.push({ type: "context", text: `… patch too large to display in full (${source.length} lines)` })
      break
    }
    if (text.startsWith("@@")) {
      lines.push({ type: "context", text })
      inHunk = true
      continue
    }
    if (!inHunk) continue
    if (text.startsWith("diff --git ")) {
      inHunk = false
      continue
    }
    if (text.startsWith("\\")) continue
    if (text.startsWith("+")) {
      lines.push({ type: "add", text: text.slice(1) })
      continue
    }
    if (text.startsWith("-")) {
      lines.push({ type: "remove", text: text.slice(1) })
      continue
    }
    if (text.startsWith(" ")) {
      lines.push({ type: "context", text: text.slice(1) })
      continue
    }
    if (text === "") continue
    inHunk = false
  }
  return lines
}
