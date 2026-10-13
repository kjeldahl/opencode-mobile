import { memo, useState } from "react"
import { View, Text, Image, StyleSheet, ScrollView, TouchableOpacity, Dimensions } from "react-native"
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons"
import { useTranslation } from "react-i18next"
import { Markdown } from "../markdown"
import { ToolCallCard } from "./ToolCallCard"
import { WorkPane } from "./WorkPane"
import { sameTurn, summarize, type Turn } from "../../lib/turns"

const SCREEN_WIDTH = Dimensions.get("window").width

interface Props {
  turn: Turn
  isDark: boolean
}

// One assistant turn: the work before the answer collapses to a single
// summary line (tap -> WorkPane), reasoning hides behind a brain icon, and
// only the answer text plus any running tool stays in full.
export const TurnBubble = memo(
  function TurnBubble({ turn, isDark }: Props) {
    const { t } = useTranslation()
    const [paneOpen, setPaneOpen] = useState(false)
    const [thinkingOpen, setThinkingOpen] = useState(false)

    const items = summarize(turn.work)
    const summary = items.map((i) => t(`chat.turn.${i.key}${i.count === 1 ? "One" : "Many"}`, { count: i.count })).join(", ")
    const failed = items.some((i) => i.key === "failed")
    const text = turn.final.map((p) => p.text).join("\n")
    const thinking = turn.thinking.map((p) => p.text).join("\n")
    const muted = isDark ? "#888888" : "#666666"

    return (
      <View style={[s.bubble, isDark && s.bubbleDark]} testID="chat-bubble-assistant">
        <View style={s.header}>
          <Ionicons name="sparkles" size={14} color="#8b5cf6" />
          <Text style={[s.role, isDark && s.textWhite]}>{t("chat.turn.assistant")}</Text>
          {turn.modelID && <Text style={[s.modelTag, isDark && s.modelTagDark]}>{turn.modelID}</Text>}
          <View style={s.spacer} />
          {thinking.length > 0 && (
            <TouchableOpacity
              onPress={() => setThinkingOpen((v) => !v)}
              hitSlop={8}
              style={[s.brain, thinkingOpen && s.brainOpen, thinkingOpen && isDark && s.brainOpenDark]}
              accessibilityLabel={t("chat.reasoningBlock.label")}
              testID="turn-thinking-toggle"
            >
              <MaterialCommunityIcons name="brain" size={16} color="#f59e0b" />
            </TouchableOpacity>
          )}
        </View>

        {summary.length > 0 && (
          <TouchableOpacity
            style={[s.summary, isDark && s.summaryDark]}
            onPress={() => setPaneOpen(true)}
            activeOpacity={0.7}
            testID="turn-summary"
          >
            <Ionicons name="layers-outline" size={14} color={failed ? "#ef4444" : muted} />
            <Text style={[s.summaryText, { color: muted }]} numberOfLines={1}>
              {summary}
            </Text>
            <Ionicons name="chevron-forward" size={14} color={muted} />
          </TouchableOpacity>
        )}

        {thinkingOpen && thinking.length > 0 && (
          <Text style={[s.thinking, isDark && s.thinkingDark]} selectable>
            {thinking}
          </Text>
        )}

        {turn.live.map((tool) => (
          <ToolCallCard key={tool.id} tool={tool} isDark={isDark} />
        ))}

        {turn.files.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.imageRow} style={s.imageScroll}>
            {turn.files.map((fp) => (
              <Image key={fp.id} source={{ uri: fp.url }} style={s.image} resizeMode="cover" />
            ))}
          </ScrollView>
        )}

        {text.length > 0 && (
          <View style={s.markdownWrap}>
            <Markdown>{text}</Markdown>
          </View>
        )}

        {turn.tokens > 0 && (
          <Text style={[s.tokens, isDark && s.tokensDark]}>
            {t("chat.turn.tokens", { count: turn.tokens })}
            {turn.cost ? ` · $${turn.cost.toFixed(4)}` : ""}
          </Text>
        )}

        <WorkPane visible={paneOpen} title={summary} work={turn.work} isDark={isDark} onClose={() => setPaneOpen(false)} />
      </View>
    )
  },
  (prev, next) => prev.isDark === next.isDark && sameTurn(prev.turn, next.turn),
)

const s = StyleSheet.create({
  bubble: { marginBottom: 16, padding: 12, borderRadius: 12, maxWidth: "100%", backgroundColor: "#f0f0ff" },
  bubbleDark: { backgroundColor: "#1a1a2e" },

  header: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 },
  role: { fontSize: 13, fontWeight: "600", color: "#666666" },
  textWhite: { color: "#ffffff" },
  spacer: { flex: 1 },
  modelTag: {
    fontSize: 11,
    color: "#999999",
    backgroundColor: "#e5e5e5",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: "hidden",
  },
  modelTagDark: { backgroundColor: "#2a2a2a", color: "#888888" },

  brain: { padding: 4, borderRadius: 6 },
  brainOpen: { backgroundColor: "#fef3c7" },
  brainOpenDark: { backgroundColor: "#333300" },
  thinking: { fontSize: 13, lineHeight: 20, color: "#78350f", marginBottom: 8 },
  thinkingDark: { color: "#d4a574" },

  summary: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 8,
    backgroundColor: "rgba(0,0,0,0.04)",
    marginBottom: 6,
  },
  summaryDark: { backgroundColor: "rgba(255,255,255,0.05)" },
  summaryText: { flex: 1, fontSize: 13 },

  markdownWrap: { marginHorizontal: -4 },

  tokens: { fontSize: 11, color: "#999999", marginTop: 8 },
  tokensDark: { color: "#666666" },

  imageScroll: { marginBottom: 8 },
  imageRow: { gap: 8 },
  image: {
    width: Math.min(200, SCREEN_WIDTH * 0.5),
    height: Math.min(200, SCREEN_WIDTH * 0.5),
    borderRadius: 8,
    backgroundColor: "#e5e5e5",
  },
})
