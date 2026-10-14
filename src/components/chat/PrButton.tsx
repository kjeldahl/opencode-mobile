import { useCallback, useEffect, useMemo, useState } from "react"
import { View, Text, StyleSheet, TouchableOpacity, Pressable, ActivityIndicator, Linking, AppState } from "react-native"
import { useFocusEffect } from "expo-router"
import { Ionicons } from "@expo/vector-icons"
import { useTranslation } from "react-i18next"
import type { Message, Part, VcsInfo } from "../../lib/sdk"
import {
  lastAction,
  prFromTranscript,
  prPrompt,
  prReady,
  prView,
  type PrAction,
  type PrLabel,
  type PrStatus,
  type PrTone,
  type PrView,
} from "../../lib/pr"
import { infoKey, useChanges, useOnTurnEnd, vcsKey } from "../../stores/changes"
import { prKey, usePrStore } from "../../stores/pr"

// PR button in the chat toolbar plus its menu: opens a PR for the chat's
// branch, then shows its CI checks. The menu links to GitHub and asks the
// agent to create, watch-and-fix, or merge (it writes code, via `gh`). On
// forge the state is read from GET /__forge/pr and "Refresh" queries it
// directly (issue #15); on a plain opencode server the state comes from the
// status lines the agent prints and "Refresh" asks the agent (see lib/pr.ts).

export interface PrModel {
  info: VcsInfo & { branch: string }
  pr: PrStatus | undefined
  view: PrView
  // State comes from forge, not the transcript.
  forge: boolean
  // Query forge again; `manual` bypasses its cache and shows "Checking…".
  sync: (manual?: boolean) => void
}

// Re-poll while checks run and the chat is on screen.
const POLL_MS = 45_000

// Undefined: no button (no PR and nothing to open one for).
export function usePr(
  directory: string | undefined,
  sessionID: string | undefined,
  messages: Message[],
  parts: Record<string, Part[]>,
  busy: boolean,
): PrModel | undefined {
  const info = useChanges((state) => (directory ? state.info[infoKey(directory)] : undefined))
  const branch = useChanges((state) => (directory ? state.entries[vcsKey(directory, "branch")]?.diffs : undefined))
  const entry = usePrStore((state) => (directory ? state.entries[prKey(directory)] : undefined))
  const forge = entry?.result?.supported ? entry.result : undefined
  const transcript = useMemo(
    () => (forge ? undefined : prFromTranscript(messages, parts, info?.branch)),
    [forge, messages, parts, info?.branch],
  )
  const pr = forge ? forge.pr : transcript
  const action = useMemo(() => lastAction(messages, parts), [messages, parts])

  const sync = useCallback(
    (manual?: boolean) => {
      if (directory) void usePrStore.getState().load(directory, { refresh: manual, manual })
    },
    [directory],
  )
  useFocusEffect(useCallback(() => sync(), [sync]))
  useOnTurnEnd(sessionID, () => {
    if (directory) void usePrStore.getState().load(directory, { refresh: true })
  })
  const pending = !!forge && pr?.state === "open" && pr.checks === "pending"
  useFocusEffect(
    useCallback(() => {
      if (!directory || !pending) return
      const timer = setInterval(() => {
        if (AppState.currentState === "active") void usePrStore.getState().load(directory)
      }, POLL_MS)
      return () => clearInterval(timer)
    }, [directory, pending]),
  )

  const view = prView({ ready: prReady(info, branch), pr, action, busy, checking: entry?.refreshing })
  if (!view || !info?.branch) return undefined
  return { info: { ...info, branch: info.branch }, pr, view, forge: !!forge, sync }
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

interface ButtonProps {
  model: PrModel
  open: boolean
  onPress: () => void
}

export function PrButton({ model, open, onPress }: ButtonProps) {
  const { t } = useTranslation()
  const { pr, view } = model
  const color = COLORS[view.tone]
  const label = t(`chat.prButton.labels.${view.label}`)
  const text = pr && view.label !== "create" ? `#${pr.number} ${label}` : label
  const icon = ICONS[view.label] ?? "git-pull-request-outline"

  return (
    <TouchableOpacity
      style={[s.button, { borderColor: color + "66" }]}
      onPress={onPress}
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
      <Ionicons name={open ? "chevron-down" : "chevron-up"} size={14} color={color} />
    </TouchableOpacity>
  )
}

interface MenuProps {
  model: PrModel
  // Height of the area above the toolbar. The menu covers only that, so the
  // composer keeps focus and the keyboard stays up (a Modal takes focus).
  height: number
  isDark: boolean
  onClose: () => void
  onSend: (text: string) => void
}

export function PrMenu({ model, height, isDark, onClose, onSend }: MenuProps) {
  const { t } = useTranslation()
  const { info, pr, view, forge, sync } = model
  // Fresh state while the menu is open (forge's 20 s cache is fine here).
  useEffect(() => sync(), [sync])
  // Merge asks for a second tap instead of an Alert, which would also take focus.
  const [confirm, setConfirm] = useState(false)
  useEffect(() => {
    if (!view.canMerge) setConfirm(false)
  }, [view.canMerge])

  const send = (action: PrAction) => {
    onClose()
    onSend(prPrompt(action, { branch: info.branch, base: info.default_branch, url: pr?.url, report: !forge }))
  }

  const create = {
    key: "create",
    icon: "git-pull-request-outline",
    label: t("chat.prButton.menu.create"),
    enabled: view.canCreate,
    onPress: () => send("create"),
  }
  const items: Array<{ key: string; icon: string; label: string; enabled: boolean; confirm?: boolean; onPress: () => void }> = [
    ...(pr ? [] : [create]),
    {
      key: "github",
      icon: "logo-github",
      label: t("chat.prButton.menu.openGithub"),
      enabled: !!pr,
      onPress: () => {
        onClose()
        if (pr) void Linking.openURL(pr.url)
      },
    },
    {
      key: "status",
      icon: "refresh-outline",
      label: t("chat.prButton.menu.refresh"),
      enabled: view.canRefresh,
      onPress: () => {
        if (!forge) return send("status")
        onClose()
        sync(true)
      },
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
      label: confirm ? t("chat.prButton.menu.confirmMerge", { number: pr?.number }) : t("chat.prButton.menu.merge"),
      enabled: view.canMerge,
      confirm,
      onPress: () => (confirm ? send("merge") : setConfirm(true)),
    },
  ]

  return (
    <Pressable style={[s.overlay, { height }]} onPress={onClose} testID="pr-menu-backdrop">
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
            <Ionicons
              name={item.icon as never}
              size={16}
              color={item.confirm ? COLORS.merged : isDark ? "#e5e5e5" : "#0a0a0a"}
            />
            <Text style={[s.itemLabel, isDark && s.itemLabelDark, item.confirm && s.itemConfirm]}>{item.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </Pressable>
  )
}

const s = StyleSheet.create({
  button: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginLeft: "auto",
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  label: { fontSize: 12, fontWeight: "600" },
  overlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    justifyContent: "flex-end",
    alignItems: "flex-end",
    padding: 12,
    paddingBottom: 6,
    backgroundColor: "rgba(0,0,0,0.25)",
    elevation: 10,
    zIndex: 10,
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
  itemConfirm: { color: COLORS.merged, fontWeight: "600" },
})
