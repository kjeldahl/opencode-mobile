import { Modal, View, Text, TouchableOpacity, Pressable, ScrollView, StyleSheet } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { useTranslation } from "react-i18next"
import { Markdown } from "../markdown"
import { ToolCallCard } from "./ToolCallCard"
import { ReasoningBlock } from "./ReasoningBlock"
import { useScrollLock } from "../../stores/scroll-lock"
import type { Part } from "../../lib/sdk"
import { estimateTokens, formatTokens } from "../../lib/tokens"

interface Props {
  visible: boolean
  title: string
  work: Part[]
  isDark: boolean
  onClose: () => void
}

// Floating pane listing a turn's collapsed work in order. Each tool card
// starts collapsed and expands in place to show its input and output.
export function WorkPane({ visible, title, work, isDark, onClose }: Props) {
  const { t } = useTranslation()
  const insets = useSafeAreaInsets()
  const scrollLocked = useScrollLock((s) => s.locked)

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.root}>
        <Pressable style={s.backdrop} onPress={onClose} accessibilityLabel={t("chat.turn.close")} />
        <View style={[s.pane, isDark && s.paneDark, { paddingBottom: insets.bottom + 12 }]} testID="work-pane">
          <View style={s.header}>
            <Text style={[s.title, isDark && s.titleDark]} numberOfLines={2}>
              {title}
            </Text>
            <TouchableOpacity onPress={onClose} hitSlop={8} testID="work-pane-close">
              <Ionicons name="close" size={22} color={isDark ? "#ffffff" : "#0a0a0a"} />
            </TouchableOpacity>
          </View>
          <ScrollView scrollEnabled={!scrollLocked} contentContainerStyle={s.list}>
            {work.map((part) => {
              const count = formatTokens(estimateTokens(part))
              const badge = (
                <Text style={[s.tokens, isDark && s.tokensDark]} testID="work-pane-tokens">
                  {t("chat.turn.tokens", { count })}
                </Text>
              )
              if (part.type === "tool")
                return (
                  <View key={part.id}>
                    <ToolCallCard tool={part} isDark={isDark} />
                    {badge}
                  </View>
                )
              if (part.type === "reasoning")
                return (
                  <View key={part.id}>
                    <ReasoningBlock text={part.text || ""} isDark={isDark} style={s.reasoning} />
                    {badge}
                  </View>
                )
              return (
                <View key={part.id} style={s.note}>
                  <Markdown>{part.text || ""}</Markdown>
                  {badge}
                </View>
              )
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  )
}

const s = StyleSheet.create({
  root: { flex: 1, justifyContent: "flex-end" },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.5)" },
  pane: {
    maxHeight: "80%",
    backgroundColor: "#ffffff",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 16,
    paddingTop: 14,
  },
  paneDark: { backgroundColor: "#141414" },
  header: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 6 },
  title: { flex: 1, fontSize: 15, fontWeight: "600", color: "#0a0a0a" },
  titleDark: { color: "#ffffff" },
  list: { paddingBottom: 8, gap: 2 },
  // Every item gets the same top margin as ToolCallCard (marginTop 8) so
  // gaps are even; ReasoningBlock's own bottom margin is dropped here.
  reasoning: { marginTop: 8, marginBottom: 0 },
  note: { marginTop: 8, paddingHorizontal: 6 },
  tokens: { alignSelf: "flex-end", marginTop: 2, paddingHorizontal: 6, fontSize: 11, color: "#999999" },
  tokensDark: { color: "#666666" },
})
