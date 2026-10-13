import { useMemo, useState } from "react"
import { View, Text, StyleSheet, TouchableOpacity, Modal, Pressable, ActivityIndicator, Alert, Linking } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { useTranslation } from "react-i18next"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import type { Message, Part } from "../../lib/sdk"
import { lastAction, prFromTranscript, prPrompt, prReady, prView, type PrAction, type PrLabel, type PrTone } from "../../lib/pr"
import { infoKey, useChanges, vcsKey } from "../../stores/changes"

interface Props {
  directory: string | undefined
  messages: Message[]
  parts: Record<string, Part[]>
  busy: boolean
  isDark: boolean
  onSend: (text: string) => void
}

const COLORS: Record<PrTone, string> = {
  neutral: "#666666",
  success: "#16a34a",
  danger: "#dc2626",
  warning: "#d97706",
  merged: "#8b5cf6",
  busy: "#3b82f6",
}

const ICONS: Partial<Record<PrLabel, string>> = {
  passing: "checkmark-circle",
  failing: "close-circle",
  pending: "time-outline",
  merged: "git-merge-outline",
  closed: "close-circle-outline",
}

// Split button in the chat toolbar: opens a PR for the chat's branch, then
// shows its CI checks. The chevron menu links to GitHub and asks the agent to
// refresh, watch-and-fix, or merge. All GitHub work is done by the agent via
// `gh`; state comes from the status lines it prints (see lib/pr.ts).
export function PrButton({ directory, messages, parts, busy, isDark, onSend }: Props) {
  const { t } = useTranslation()
  const info = useChanges((state) => (directory ? state.info[infoKey(directory)] : undefined))
  const branch = useChanges((state) => (directory ? state.entries[vcsKey(directory, "branch")]?.diffs : undefined))
  const insets = useSafeAreaInsets()
  const [menu, setMenu] = useState(false)

  const pr = useMemo(() => prFromTranscript(messages, parts, info?.branch), [messages, parts, info?.branch])
  const action = useMemo(() => lastAction(messages, parts), [messages, parts])
  const view = prView({ ready: prReady(info, branch), pr, action, busy })
  if (!view || !info?.branch) return null

  const send = (next: PrAction) => {
    setMenu(false)
    onSend(prPrompt(next, { branch: info.branch!, base: info.default_branch, url: pr?.url }))
  }

  const openMenu = () => setMenu(true)

  const merge = () => {
    setMenu(false)
    Alert.alert(t("chat.prButton.mergeConfirm.title"), t("chat.prButton.mergeConfirm.message", { number: pr?.number }), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("chat.prButton.mergeConfirm.confirm"), onPress: () => send("merge") },
    ])
  }

  const color = COLORS[view.tone]
  const label = t(`chat.prButton.labels.${view.label}`)
  const text = pr && view.label !== "create" ? `#${pr.number} ${label}` : label
  const icon = ICONS[view.label] ?? "git-pull-request-outline"

  const items: Array<{ key: string; icon: string; label: string; enabled: boolean; onPress: () => void }> = [
    {
      key: "github",
      icon: "logo-github",
      label: t("chat.prButton.menu.openGithub"),
      enabled: !!pr,
      onPress: () => {
        setMenu(false)
        if (pr) void Linking.openURL(pr.url)
      },
    },
    {
      key: "status",
      icon: "refresh-outline",
      label: t("chat.prButton.menu.refresh"),
      enabled: !!pr && !busy,
      onPress: () => send("status"),
    },
    {
      key: "watch",
      icon: "eye-outline",
      label: t("chat.prButton.menu.watch"),
      enabled: view.canWatch,
      onPress: () => send("watch"),
    },
    {
      key: "merge",
      icon: "git-merge-outline",
      label: t("chat.prButton.menu.merge"),
      enabled: view.canMerge,
      onPress: merge,
    },
  ]

  return (
    <View style={[s.split, { borderColor: color + "66" }]}>
      <TouchableOpacity
        style={s.main}
        onPress={() => (view.primary ? send(view.primary) : openMenu())}
        testID="pr-button"
        accessibilityLabel={text}
      >
        {view.tone === "busy" ? (
          <ActivityIndicator size="small" color={color} />
        ) : (
          <Ionicons name={icon as never} size={14} color={color} />
        )}
        <Text style={[s.label, { color }]} numberOfLines={1}>
          {text}
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[s.chevron, { borderLeftColor: color + "66" }]}
        onPress={openMenu}
        hitSlop={6}
        testID="pr-button-menu"
      >
        <Ionicons name="chevron-up" size={14} color={color} />
      </TouchableOpacity>

      <Modal visible={menu} transparent animationType="fade" onRequestClose={() => setMenu(false)}>
        <Pressable style={[s.backdrop, { paddingBottom: insets.bottom + 112 }]} onPress={() => setMenu(false)}>
          <View style={[s.menu, isDark && s.menuDark]}>
            <Text style={[s.title, isDark && s.titleDark]} numberOfLines={1}>
              {pr ? `#${pr.number} · ${info.branch}` : info.branch}
            </Text>
            {items.map((item) => (
              <TouchableOpacity
                key={item.key}
                style={[s.item, !item.enabled && s.itemDisabled]}
                onPress={item.onPress}
                disabled={!item.enabled}
                testID={`pr-menu-${item.key}`}
              >
                <Ionicons name={item.icon as never} size={16} color={isDark ? "#e5e5e5" : "#0a0a0a"} />
                <Text style={[s.itemLabel, isDark && s.itemLabelDark]}>{item.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </Pressable>
      </Modal>
    </View>
  )
}

const s = StyleSheet.create({
  split: {
    flexDirection: "row",
    alignItems: "center",
    marginLeft: "auto",
    borderWidth: 1,
    borderRadius: 12,
  },
  main: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingLeft: 8,
    paddingRight: 6,
    paddingVertical: 4,
  },
  label: { fontSize: 12, fontWeight: "600" },
  chevron: {
    borderLeftWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  backdrop: {
    flex: 1,
    justifyContent: "flex-end",
    alignItems: "flex-end",
    paddingHorizontal: 12,
    backgroundColor: "rgba(0,0,0,0.25)",
  },
  menu: {
    minWidth: 220,
    borderRadius: 12,
    paddingVertical: 6,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#e5e5e5",
  },
  menuDark: { backgroundColor: "#1a1a1a", borderColor: "#2a2a2a" },
  title: { fontSize: 11, color: "#999999", paddingHorizontal: 14, paddingVertical: 6 },
  titleDark: { color: "#666666" },
  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  itemDisabled: { opacity: 0.35 },
  itemLabel: { fontSize: 14, color: "#0a0a0a" },
  itemLabelDark: { color: "#e5e5e5" },
})
