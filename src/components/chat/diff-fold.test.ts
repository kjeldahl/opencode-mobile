import { test } from "node:test"
import assert from "node:assert/strict"
import { buildDiffFoldItems, foldBlocks, FOLD_CONTEXT } from "./diff-fold.ts"
import type { DiffLine } from "./diff-compute.ts"

const ctx = (n: number): DiffLine[] => Array.from({ length: n }, () => ({ type: "context", text: "same" }))
const add = (n = 1): DiffLine[] => Array.from({ length: n }, (_, i) => ({ type: "add", text: `+${i}` }))
const del = (n = 1): DiffLine[] => Array.from({ length: n }, (_, i) => ({ type: "remove", text: `-${i}` }))
const foldCount = (lines: DiffLine[], levels: Record<number, number> = {}) =>
  buildDiffFoldItems(lines, levels).filter((i) => i.kind === "fold").length

// A run longer than 2x context collapses into one fold that hides exactly
// run - 2*context lines and keeps `context` lines on each side.
test("a long unchanged run folds once, showing context lines on each side", () => {
  const lines = [...ctx(3), ...add(), ...ctx(11), ...del(), ...ctx(3)]
  const items = buildDiffFoldItems(lines)
  const folds = items.filter((i) => i.kind === "fold")
  assert.equal(folds.length, 1, "the single long context run collapses once")

  const fold = folds[0]
  assert.ok(fold && fold.kind === "fold")
  assert.equal(fold.hidden, 11 - 2 * FOLD_CONTEXT, "hides only what the two context edges don't cover")

  const kinds = items.map((i) => i.kind)
  assert.ok(kinds.indexOf("fold") > 0 && kinds.indexOf("fold") < kinds.length - 1, "fold sits interior to the diff")

  // The fold row must keep 3 context lines immediately before and after it.
  const first = items[0]
  assert.ok(first.kind === "line" && lines[first.index].type === "context")
})

// Each tap doubles the revealed context; a gap is fully expanded (no fold
// chrome) once the doubled context covers the whole run.
test("expanding doubles the shown context, and the gap disappears when it covers the run", () => {
  const run = 24
  const lines = [...add(), ...ctx(run), ...add()]
  const gapStart = 1
  const start = buildDiffFoldItems(lines)
  const firstFold = start.find((i) => i.kind === "fold")
  assert.ok(firstFold && firstFold.kind === "fold", "starts collapsed at the run")
  assert.equal(firstFold.id, gapStart)
  assert.equal(firstFold.hidden, run - 2 * FOLD_CONTEXT)

  const visible = (levels: Record<number, number>) =>
    buildDiffFoldItems(lines, levels).filter((i) => i.kind === "line").length

  const l0 = visible({})
  const l1 = visible({ [gapStart]: 1 })
  assert.ok(l1 > l0 && l1 <= 2 * l0, `one expand roughly doubles visible lines (${l0} -> ${l1})`)

  assert.equal(visible({ [gapStart]: 2 }), run + 2, "level 2 covers the whole run")
  assert.equal(foldCount(lines, { [gapStart]: 3 }), 0, "fully expanded gap renders no fold chrome")
})

// Two independent gaps remember their own expansion state, so expanding one
// never changes what the other shows.
test("collapse state is per-gap, not global", () => {
  const lines = [...add(), ...ctx(20), ...add(), ...ctx(20), ...add()]
  const gaps = buildDiffFoldItems(lines).filter((i) => i.kind === "fold")
  assert.equal(gaps.length, 2, "two separate long runs")
  const ids = gaps.map((g) => (g.kind === "fold" ? g.id : -1))

  const expanded = buildDiffFoldItems(lines, { [ids[1]]: 3 })
  const stillFolded = expanded.filter((i) => i.kind === "fold")
  assert.equal(stillFolded.length, 1, "only the untouched gap stays collapsed")
  assert.ok(stillFolded[0] && stillFolded[0].kind === "fold" && stillFolded[0].id === ids[0])
})

// A run of exactly 2*context is fully shown, and a diff with no long run
// renders with no fold chrome at all.
test("short diffs render with no fold chrome", () => {
  assert.equal(foldCount([...ctx(FOLD_CONTEXT * 2), ...add(), ...ctx(1)]), 0, "run of exactly 2*context is shown")
  assert.equal(foldCount([...add(), ...ctx(2), ...del()]), 0, "short diff is untouched")
})

// `@@ hunk @@` lines (from parsePatch) separate hunks and stay pinned — they
// are always emitted as DiffRows, so the jump between hunks is never buried.
test("hunk-header context lines stay pinned and never get folded away", () => {
  const lines: DiffLine[] = [
    { type: "context", text: "@@ -1,9 +1,9 @@" },
    ...ctx(10),
    { type: "context", text: "@@ -20,9 +20,9 @@" },
  ]
  const items = buildDiffFoldItems(lines)
  const shown = new Set(items.filter((i) => i.kind === "line").map((i) => (i.kind === "line" ? i.index : -1)))
  assert.ok(shown.has(0) && shown.has(lines.length - 1), "both hunk headers remain visible")
  assert.equal(foldCount(lines), 1, "the unchanged run between the hunks still folds")
})

// The inline view groups contiguous line items into blocks so each block wraps
// in one horizontal ScrollView, with folds left as full-width rows between.
test("foldBlocks groups contiguous lines and keeps folds as standalone blocks", () => {
  const lines = [...add(), ...ctx(10), ...add(), ...ctx(10), ...add()]
  const blocks = foldBlocks(buildDiffFoldItems(lines))
  assert.equal(blocks.filter((b) => b.kind === "fold").length, 2, "two gaps -> two fold blocks")

  const folded = foldBlocks(buildDiffFoldItems([...add(), ...ctx(10), ...add()]))
  assert.equal(folded.filter((b) => b.kind === "lines").length, 2, "collapsed run yields a block before and after")

  const flat = foldBlocks(buildDiffFoldItems([...add(), ...del()]))
  assert.ok(flat.every((b) => b.kind === "lines" && b.to - b.from >= 1), "no-gaps diff stays as line blocks")
})
