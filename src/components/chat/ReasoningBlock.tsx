import { useState } from "react"
import { View, Text, TouchableOpacity, StyleSheet, type StyleProp, type ViewStyle } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { useTranslation } from "react-i18next"
import { reasoningView } from "../../lib/reasoning"

interface Props {
  text: string
  isDark: boolean
  style?: StyleProp<ViewStyle>
}

export function ReasoningBlock({ text, isDark, style }: Props) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const { short, title, body } = reasoningView(text)

  if (short && title)
    return (
      <View style={[s.block, isDark && s.blockDark, style]}>
        <View style={s.inline}>
          <Ionicons name="bulb-outline" size={14} color="#f59e0b" style={s.icon} />
          <Text style={[s.inlineText, isDark && s.textDark]} selectable>
            {title}
          </Text>
        </View>
      </View>
    )

  return (
    <TouchableOpacity
      style={[s.block, isDark && s.blockDark, style]}
      onPress={() => setExpanded(!expanded)}
      activeOpacity={0.7}
    >
      <View style={s.header}>
        <Ionicons name="bulb-outline" size={14} color="#f59e0b" />
        <Text style={[s.label, isDark && s.labelDark]} numberOfLines={expanded ? undefined : 1}>
          {title || t("chat.reasoningBlock.label")}
        </Text>
        <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={14} color={isDark ? "#666666" : "#999999"} />
      </View>
      {expanded && body.length > 0 && (
        <Text style={[s.text, isDark && s.textDark]} selectable>
          {body}
        </Text>
      )}
    </TouchableOpacity>
  )
}

const s = StyleSheet.create({
  block: {
    backgroundColor: "#fffbeb",
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "#fef3c7",
  },
  blockDark: { backgroundColor: "#1a1a0a", borderColor: "#333300" },
  header: { flexDirection: "row", alignItems: "center", gap: 6 },
  label: { fontSize: 12, fontWeight: "600", color: "#92400e", flex: 1 },
  labelDark: { color: "#f59e0b" },
  inline: { flexDirection: "row", alignItems: "flex-start", gap: 6 },
  icon: { marginTop: 3 },
  inlineText: { flex: 1, fontSize: 13, lineHeight: 20, color: "#78350f" },
  text: { fontSize: 13, lineHeight: 20, color: "#78350f", marginTop: 8 },
  textDark: { color: "#d4a574" },
})
