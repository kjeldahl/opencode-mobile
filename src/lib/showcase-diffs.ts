// Showcases the full diff view (issue #32): a long session of file changes
// rendered by the SAME DiffView + diff-fold code a live session's edits use, so
// the fold/reveal behaviour and the hunk/colour styling are visible without a
// server or a real repo.
import { useMemo } from "react"

const files = [
  "src/auth/refresh.ts",
  "src/auth/session.ts",
  "src/auth/keystore.ts",
  "src/auth/token.ts",
  "src/auth/__tests__/session.test.ts",
  "src/components/auth/LoginButton.tsx",
  "src/utils/keyboard.ts",
  "src/stores/auth.ts",
]

const words = [
  "async", "const", "export", "return", "await", "promise", "token", "refresh", "storage", "keystore",
  "function", "private", "readonly", "interface", "timer", "clear", "start", "expire", "skew", "attempt",
]

// Deterministic PRNG (mulberry32) so the same file is always generated the same
// way: the showcase must never shuffle between renders.
function random(seed: number): () => number {
  let x = seed >>> 0
  return () => {
    x = (x + 0x6d2b79f5) >>> 0
    let t = x
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// git-style unified diff of `total` lines. A `@@ … @@` hunk header separates
// hunks, long unchanged runs sit between the changes, and +/- lines alternate
// per file — enough shape for DiffView's colours and diff-fold's collapse
// markers to render the way a real patch would.
function patch(seed: number, total = 260): string[] {
  const next = random(seed)
  const lines: string[] = [`--- a/${files[seed % files.length]}`, `+++ b/${files[seed % files.length]}`]
  const changes = 16 + Math.floor(next() * 6)
  let i = 2
  for (let c = 0; c < changes && i < total - 6; c++) {
    const gap = 12 + Math.floor(next() * 22)
    if (c > 0) {
      const removed = 1 + Math.floor(next() * 2)
      const added = 1 + Math.floor(next() * 3)
      const hunkStart = Math.max(1, Math.round((i / total) * 400))
      lines.push(`@@ -${hunkStart},${removed + 3} +${hunkStart},${added + 3} @@ class Session`)
      for (let k = 0; k < removed; k++) {
        lines.push(`-  ${words[Math.floor(next() * words.length)]} ${(next() * 100).toFixed(0)} = () => {`)
      }
      lines.push("+  if (state !== 'active') return")
      if (added > 1) lines.push(`+  const attempt = Math.max(1, ${Math.floor(next() * 90)})`)
      if (added > 2) lines.push("+    await withRetry(refresh, { attempts: 3, skew: skewMs })")
      if (added > 3) lines.push("+  }")
      if (added > 4) lines.push(`+  // ${files[seed % files.length].split("/").pop()}: coalesce concurrent callers`)
    }
    for (let k = 0; k < gap; k++) lines.push(`  ${words[Math.floor(next() * words.length)]}${next() < 0.4 ? ";" : " {"}`)
    i += gap + 3
  }
  lines.push("}", "}", "export default session")
  while (lines.length < total) lines.push("  return this.timer")
  return lines
}

export interface ShowcaseDiff {
  name: string
  total: number
  additions: number
  deletions: number
  lines: string[]
}

// The showcase's diff "session": one long, multi-file patch set.
export function showcaseDiffs(): ShowcaseDiff[] {
  return files.map((name, i) => {
    const lines = patch(1100 + i * 7, 240 + i * 24)
    return {
      name,
      total: lines.length,
      additions: lines.filter((l) => l.startsWith("+")).length,
      deletions: lines.filter((l) => l.startsWith("-")).length,
      lines,
    }
  })
}

// Fold/diff view for the showcase. `computeDiff` is skipped: these lines are
// already in unified-diff shape, which is what DiffRow/diff-fold render.
export function useShowcaseDiffs(): ShowcaseDiff[] {
  return useMemo(showcaseDiffs, [])
}
