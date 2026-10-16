import { useCallback, useMemo, useState } from "react"
import { View, Text, FlatList, StyleSheet, useColorScheme, TouchableOpacity } from "react-native"
import { Stack, router } from "expo-router"
import { Ionicons } from "@expo/vector-icons"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { useTranslation } from "react-i18next"
import { MessageBubble, TurnBubble, SessionInfo, StatsGaugeButton, PermissionPrompt, QuestionPrompt } from "../src/components/chat"
import { buildRows } from "../src/lib/turns"
import { contextUsage } from "../src/lib/context"
import { buildShowcaseScript } from "../src/lib/showcase-script"
import { DEMO_PROVIDERS } from "../src/lib/demo-providers"

// Static, read-only showcase of every chat surface: a single seeded
// conversation rendered through the SAME components a live session uses
// (MessageBubble, TurnBubble, ToolCallCard, DiffView, WorkPane, SessionInfo).
// ISOLATION: nothing here touches useSessions/useConnections/useEvents or any
// sdk.ts method — the data is hardcoded in src/lib/showcase-script.ts, so this
// screen can't create a session, hit a network, or leak state.
export default function ShowcaseScreen() {
  const colorScheme = useColorScheme()
  const isDark = colorScheme === "dark"
  const insets = useSafeAreaInsets()
  const { t } = useTranslation()
  const [showInfo, setShowInfo] = useState(false)
  const [resolved, setResolved] = useState({ permission: false, question: false })

  const script = useMemo(() => buildShowcaseScript(), [])

  const rows = useMemo(
    () =>
      buildRows(
        script.messages.map((message) => ({ message, parts: script.parts[message.id] || [] })),
        false,
      ).reverse(),
    [script],
  )

  const usagePercent = useMemo(() => contextUsage(script.messages, DEMO_PROVIDERS).percent, [script])

  const dismissPermission = useCallback(() => setResolved((v) => ({ ...v, permission: true })), [])
  const dismissQuestion = useCallback(() => setResolved((v) => ({ ...v, question: true })), [])

  return (
    <>
      <Stack.Screen
        options={{
          title: script.session.title,
          headerRight: () => (
            <StatsGaugeButton percent={usagePercent} active={showInfo} isDark={isDark} onPress={() => setShowInfo((v) => !v)} />
          ),
        }}
      />
      <View style={[s.container, isDark && s.containerDark]} testID="showcase-screen">
        <View style={[s.banner, isDark && s.bannerDark]} testID="showcase-banner">
          <Ionicons name="eye-outline" size={15} color="#8b5cf6" />
          <Text style={[s.bannerText, isDark && s.bannerTextDark]} numberOfLines={1}>
            {t("showcase.banner")}
          </Text>
        </View>

        <SessionInfo
          session={script.session}
          messages={script.messages}
          providers={[]}
          providersOverride={DEMO_PROVIDERS}
          visible={showInfo}
          isDark={isDark}
          hasMore={false}
          loadingAll={false}
          onLoadAll={() => {}}
          onScrollToTop={() => {}}
          onClose={() => setShowInfo(false)}
        />

        <FlatList
          data={rows}
          inverted
          keyExtractor={(row) => row.id}
          renderItem={({ item }) =>
            item.kind === "turn" ? (
              <TurnBubble turn={item.turn} isDark={isDark} />
            ) : (
              <MessageBubble message={item.entry.message} parts={item.entry.parts} isDark={isDark} />
            )
          }
          contentContainerStyle={s.list}
        />

        {!resolved.permission && (
          <View style={s.prompt}>
            <PermissionPrompt permission={script.permission} isDark={isDark} onReply={dismissPermission} />
          </View>
        )}
        {!resolved.question && (
          <View style={s.prompt}>
            <QuestionPrompt request={script.question} isDark={isDark} onReply={dismissQuestion} onReject={dismissQuestion} />
          </View>
        )}

        <View style={[s.footer, isDark && s.footerDark, { paddingBottom: Math.max(12, insets.bottom) }]}>
          <Ionicons name="lock-closed-outline" size={14} color={isDark ? "#888888" : "#666666"} />
          <Text style={[s.footerText, isDark && s.metaDark]}>{t("showcase.readOnly")}</Text>
          <TouchableOpacity onPress={() => router.push("/connection/add")} testID="showcase-connect-button">
            <Text style={s.footerLink}>{t("showcase.connect")}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#ffffff" },
  containerDark: { backgroundColor: "#0a0a0a" },

  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: "#f5f3ff",
    borderBottomWidth: 1,
    borderBottomColor: "#e9d5ff",
  },
  bannerDark: { backgroundColor: "#1a1030", borderBottomColor: "#2a1a4a" },
  bannerText: { fontSize: 13, fontWeight: "600", color: "#6d28d9", flex: 1 },
  bannerTextDark: { color: "#a78bfa" },

  list: { padding: 16, paddingBottom: 8 },

  prompt: { paddingHorizontal: 12 },

  footer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: "#e5e5e5",
    backgroundColor: "#ffffff",
  },
  footerDark: { borderTopColor: "#1a1a1a", backgroundColor: "#0a0a0a" },
  footerText: { fontSize: 13, color: "#666666", flex: 1 },
  footerLink: { fontSize: 13, fontWeight: "700", color: "#6366f1" },
  metaDark: { color: "#666666" },
})
