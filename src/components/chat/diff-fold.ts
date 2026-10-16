// Pure (no React Native imports) presentational collapse layer for the diff
// view, per issue #34. It takes the intact `computeDiff` output and groups
// unchanged runs into tappable fold gaps by index range — it never edits the
// DiffLine[] model, it only decides which indices are shown as DiffRows and
// which are hidden behind a `⋯ N unchanged lines` marker.
//
// Same node:test-ability as diff-compute.ts / scroll-config.ts: a plain module
// both the inline tool-card DiffView and the fullscreen Changes view render,
// so the unit test can't drift from the real component.
import type { DiffLine } from "./diff-compute"

// Unchanged context lines kept on each side of a gap while collapsed. Each
// tap doubles this (context << level), so the reveal goes 3 → 6 → 12 … until
// the doubled context covers the whole gap and the fold disappears.
export const FOLD_CONTEXT = 3

export type DiffFoldItem = { kind: "line"; index: number } | { kind: "fold"; id: number; hidden: number }

// A context line that isn't a `@@ … @@` hunk header. Hunk headers stay pinned
// (never folded) so the jumps between hunks remain visible.
function isPlainContext(line: DiffLine): boolean {
  return line.type === "context" && !line.text.startsWith("@@")
}

// Walk the diff and emit, per gap, either the contiguous DiffRow indices or a
// single fold item. `levels` maps a gap id (its start index) to how many times
// it has been expanded; absent = collapsed (level 0).
export function buildDiffFoldItems(lines: DiffLine[], levels: Record<number, number> = {}): DiffFoldItem[] {
  const items: DiffFoldItem[] = []
  let index = 0

  while (index < lines.length) {
    if (!isPlainContext(lines[index])) {
      items.push({ kind: "line", index })
      index++
      continue
    }

    const start = index
    while (index < lines.length && isPlainContext(lines[index])) index++
    const length = index - start

    if (length <= 2 * FOLD_CONTEXT) {
      for (let i = start; i < index; i++) items.push({ kind: "line", index: i })
      continue
    }

    const context = FOLD_CONTEXT << (levels[start] ?? 0)
    const hidden = length - 2 * context
    if (hidden <= 0) {
      for (let i = start; i < index; i++) items.push({ kind: "line", index: i })
      continue
    }

    for (let i = start; i < start + context; i++) items.push({ kind: "line", index: i })
    items.push({ kind: "fold", id: start, hidden })
    for (let i = index - context; i < index; i++) items.push({ kind: "line", index: i })
  }

  return items
}

// Group consecutive line items into render blocks so the inline DiffView can
// wrap each contiguous run of DiffRows in one horizontal ScrollView while
// fold rows stay full-width (out of the horizontal scroll).
export type FoldBlock = { kind: "lines"; from: number; to: number } | { kind: "fold"; id: number; hidden: number }

export function foldBlocks(items: DiffFoldItem[]): FoldBlock[] {
  const blocks: FoldBlock[] = []
  for (const item of items) {
    if (item.kind === "line") {
      const last = blocks[blocks.length - 1]
      if (last && last.kind === "lines" && last.to === item.index) last.to = item.index + 1
      else blocks.push({ kind: "lines", from: item.index, to: item.index + 1 })
      continue
    }
    blocks.push({ kind: "fold", id: item.id, hidden: item.hidden })
  }
  return blocks
}
