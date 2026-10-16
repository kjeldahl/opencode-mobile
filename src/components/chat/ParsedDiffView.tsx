import { useMemo, useState } from "react"
import { View, ScrollView } from "react-native"
import type { DiffLine } from "./diff-compute"
import { buildDiffFoldItems, foldBlocks, type FoldBlock } from "./diff-fold"
import { DiffRow, FoldRow } from "./DiffView"
import { WIDE_CONTENT_SCROLL_CONFIG } from "../../lib/scroll-config"
import { useScrollLock } from "../../stores/scroll-lock"

// DiffView for inputs that are already unified-diff text (a server's `diff` on
// an edit/apply_patch part). DiffView has to compute a diff between two sides,
// which throws away the hunk headers and the unchanged runs the fold markers
// depend on, so a patch we were *given* is parsed instead: parsePatch keeps the
// hunk boundaries, and diff-fold then collapses the long unchanged runs between
// them exactly like the Changes view does.
export function parsePatchLines(patch: string): DiffLine[] {
  const lines: DiffLine[] = []
  let inHunk = false
  for (const raw of patch.split(/\r?\n/)) {
    if (raw.startsWith("@@")) {
      lines.push({ type: "context", text: raw })
      inHunk = true
      continue
    }
    if (!inHunk) continue
    if (raw.startsWith("+")) lines.push({ type: "add", text: raw.slice(1) })
    else if (raw.startsWith("-")) lines.push({ type: "remove", text: raw.slice(1) })
    else if (raw.startsWith("\\")) continue
    else lines.push({ type: "context", text: raw.startsWith(" ") ? raw.slice(1) : raw })
  }
  return lines
}

interface Props {
  patch: string
  isDark: boolean
}

export function ParsedDiffView({ patch, isDark }: Props) {
  const lines = useMemo(() => parsePatchLines(patch), [patch])
  const [levels, setLevels] = useState<Record<number, number>>({})

  if (lines.length === 0) return null

  const blocks = foldBlocks(buildDiffFoldItems(lines, levels))
  const expand = (id: number) => setLevels((prev) => ({ ...prev, [id]: (prev[id] ?? 0) + 1 }))

  return (
    <View style={{ borderRadius: 6, overflow: "hidden", marginTop: 6 }}>
      {blocks.map((block, idx) =>
        block.kind === "lines" ? (
          <Lines key={idx} block={block} lines={lines} isDark={isDark} />
        ) : (
          <FoldRow key={idx} hidden={block.hidden} isDark={isDark} onExpand={() => expand(block.id)} />
        ),
      )}
    </View>
  )
}

function Lines({ block, lines, isDark }: { block: FoldBlock & { kind: "lines" }; lines: DiffLine[]; isDark: boolean }) {
  const rows = []
  for (let i = block.from; i < block.to; i++) rows.push(<DiffRow key={i} line={lines[i]} isDark={isDark} />)
  return (
    <View>
      <ScrollView
        {...WIDE_CONTENT_SCROLL_CONFIG}
        testID="diff-view-scroll"
        onTouchStart={useScrollLock.getState().lock}
        onTouchEnd={useScrollLock.getState().unlock}
        onTouchCancel={useScrollLock.getState().unlock}
      >
        {rows}
      </ScrollView>
    </View>
  )
}
