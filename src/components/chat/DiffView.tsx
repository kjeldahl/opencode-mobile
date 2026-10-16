import { useMemo, useState } from "react"
import { View, Text, StyleSheet, Platform, ScrollView, TouchableOpacity } from "react-native"
import { WIDE_CONTENT_SCROLL_CONFIG } from "../../lib/scroll-config"
import { useScrollLock } from "../../stores/scroll-lock"
import { computeDiff, type DiffLine } from "./diff-compute"
import { buildDiffFoldItems, foldBlocks, type FoldBlock } from "./diff-fold"

const mono = Platform.OS === "ios" ? "Menlo" : "monospace"

interface Props {
  before: string
  after: string
  isDark: boolean
}

export function DiffView({ before, after, isDark }: Props) {
  const lines = useMemo(() => computeDiff(before, after), [before, after])
  const [levels, setLevels] = useState<Record<number, number>>({})

  if (lines.length === 0) return null

  const blocks = foldBlocks(buildDiffFoldItems(lines, levels))
  const expand = (id: number) => setLevels((prev) => ({ ...prev, [id]: (prev[id] ?? 0) + 1 }))

  return (
    <View style={[s.container, isDark && s.containerDark]}>
      {blocks.map((block, idx) =>
        block.kind === "lines" ? (
          <LinesBlock key={idx} block={block} lines={lines} isDark={isDark} />
        ) : (
          <FoldRow key={idx} hidden={block.hidden} isDark={isDark} onExpand={() => expand(block.id)} />
        ),
      )}
    </View>
  )
}

// One contiguous run of diff lines. Wrapped in a single horizontal ScrollView
// so wide lines scroll sideways (issue #21) without nesting one ScrollView per
// row inside the parent FlatList (issue #14). Fold rows live OUTSIDE this —
// they stay full-width so they're a simple, wide tap target.
function LinesBlock({ block, lines, isDark }: { block: FoldBlock & { kind: "lines" }; lines: DiffLine[]; isDark: boolean }) {
  const rows = []
  for (let index = block.from; index < block.to; index++) rows.push(<DiffRow key={index} line={lines[index]} isDark={isDark} />)
  return (
    <View key={`${block.from}-${block.to}`}>
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

export function FoldRow({ hidden, isDark, onExpand }: { hidden: number; isDark: boolean; onExpand: () => void }) {
  return (
    <TouchableOpacity
      style={[s.fold, isDark && s.foldDark]}
      onPress={onExpand}
      accessibilityRole="button"
      accessibilityLabel={`Show ${hidden} more unchanged lines`}
      testID="diff-fold"
    >
      <Text style={[s.foldText, isDark && s.foldTextDark]}>⋯ {hidden} unchanged line{hidden === 1 ? "" : "s"}</Text>
    </TouchableOpacity>
  )
}

// One diff line. `wrap` breaks long lines instead of relying on a horizontal
// scroll (the fullscreen Changes view).
export function DiffRow({ line, isDark, wrap }: { line: DiffLine; isDark: boolean; wrap?: boolean }) {
  const hunk = line.type === "context" && line.text.startsWith("@@")
  return (
    <View
      style={[
        s.line,
        line.type === "add" && (isDark ? s.addDark : s.add),
        line.type === "remove" && (isDark ? s.removeDark : s.remove),
        hunk && (isDark ? s.hunkDark : s.hunk),
      ]}
    >
      <Text style={[s.prefix, isDark && s.prefixDark]}>
        {line.type === "add" ? "+" : line.type === "remove" ? "-" : " "}
      </Text>
      <Text
        style={[
          s.text,
          isDark && s.textDark,
          line.type === "add" && s.addText,
          line.type === "remove" && s.removeText,
          hunk && s.hunkText,
          wrap && s.wrap,
        ]}
        selectable
      >
        {line.text}
      </Text>
    </View>
  )
}

const s = StyleSheet.create({
  container: {
    borderRadius: 6,
    overflow: "hidden",
    backgroundColor: "#f8f8f8",
    marginTop: 6,
  },
  containerDark: { backgroundColor: "#1a1a1a" },

  line: {
    flexDirection: "row",
    paddingHorizontal: 8,
    paddingVertical: 1,
  },
  add: { backgroundColor: "#dcfce7" },
  addDark: { backgroundColor: "#052e16" },
  remove: { backgroundColor: "#fee2e2" },
  removeDark: { backgroundColor: "#2a0a0a" },

  prefix: {
    width: 16,
    fontSize: 12,
    fontFamily: mono,
    color: "#999999",
    lineHeight: 20,
  },
  prefixDark: { color: "#666666" },

  text: {
    fontSize: 12,
    fontFamily: mono,
    color: "#0a0a0a",
    lineHeight: 20,
  },
  textDark: { color: "#e5e5e5" },
  addText: { color: "#16a34a" },
  removeText: { color: "#dc2626" },
  hunk: { backgroundColor: "#eef2ff" },
  hunkDark: { backgroundColor: "#1e1b4b" },
  hunkText: { color: "#6366f1" },
  wrap: { flex: 1 },

  fold: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: "#eef2ff",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#e0e7ff",
    borderBottomColor: "#e0e7ff",
  },
  foldDark: { backgroundColor: "#1e1b4b", borderTopColor: "#312e81", borderBottomColor: "#312e81" },
  foldText: { fontSize: 12, fontFamily: mono, color: "#6366f1", textAlign: "center" },
  foldTextDark: { color: "#818cf8" },
})
