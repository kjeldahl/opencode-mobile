import { useCallback, useEffect, useMemo, useState } from "react"
import { View, Text, FlatList, TouchableOpacity, StyleSheet, useColorScheme, RefreshControl, ActivityIndicator } from "react-native"
import { Stack, router, useLocalSearchParams } from "expo-router"
import { Ionicons } from "@expo/vector-icons"
import { useTranslation } from "react-i18next"
import { useChanges, useOnTurnEnd, turnKey, vcsKey } from "../../src/stores/changes"
import { useConnections } from "../../src/stores/connections"
import { useSessions } from "../../src/stores/sessions"
import { lastUserMessageID, sortDiffs, splitPath, totals, type ChangeTab } from "../../src/lib/changes"
import type { FileDiff, VcsInfo } from "../../src/lib/sdk"

const TABS: ChangeTab[] = ["branch", "git", "turn"]

export default function ChangesScreen() {
  const { id, directory, tab: initial } = useLocalSearchParams<{ id: string; directory?: string; tab?: ChangeTab }>()
  const isDark = useColorScheme() === "dark"
  const { t } = useTranslation()
  const [tab, setTab] = useState<ChangeTab>(initial && TABS.includes(initial) ? initial : "branch")
  const [info, setInfo] = useState<VcsInfo | null>(null)

  const messageID = useSessions((s) => (s.currentSession?.id === id ? lastUserMessageID(s.messages) : undefined))
  const { loadVcs, loadTurn } = useChanges()
  const key = tab === "turn" ? turnKey(id) : directory ? vcsKey(directory, tab) : ""
  const entry = useChanges((s) => s.entries[key])

  const load = useCallback(
    (which: ChangeTab, force?: boolean) => {
      if (which === "turn") return loadTurn(id, directory, messageID, force)
      if (!directory) return Promise.resolve()
      return loadVcs(directory, which, force)
    },
    [id, directory, messageID, loadTurn, loadVcs],
  )

  useEffect(() => {
    void load(tab)
  }, [tab, load])

  useEffect(() => {
    if (!directory) return
    const client = useConnections.getState().clientForDirectory(directory)
    client?.vcs
      .get()
      .then(setInfo)
      .catch(() => setInfo(null))
  }, [directory])

  useOnTurnEnd(id, () => {
    for (const which of TABS) void load(which, true)
  })

  const diffs = useMemo(() => sortDiffs(entry?.diffs ?? []), [entry?.diffs])
  const sum = totals(diffs)
  const onDefault = !!info?.branch && info.branch === info.default_branch

  const emptyText =
    tab === "branch" ? (onDefault ? t("changes.empty.defaultBranch") : t("changes.empty.branch")) : t(`changes.empty.${tab}`)

  return (
    <View style={[s.container, isDark && s.containerDark]}>
      <Stack.Screen options={{ title: t("changes.title") }} />

      <View style={[s.tabs, isDark && s.tabsDark]}>
        {TABS.map((item) => (
          <TouchableOpacity
            key={item}
            style={[s.tab, tab === item && s.tabActive]}
            onPress={() => setTab(item)}
            testID={`changes-tab-${item}`}
          >
            <Text style={[s.tabText, isDark && s.textDark, tab === item && s.tabTextActive]}>{t(`changes.tabs.${item}`)}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={s.summary}>
        <Text style={[s.summaryText, isDark && s.metaDark]} numberOfLines={1}>
          {tab === "branch" && info?.branch && info.default_branch
            ? `${t("changes.branchVs", { branch: info.branch, base: info.default_branch })} · `
            : ""}
          {t("changes.summary", { count: sum.files })}
        </Text>
        <Text style={s.add}>+{sum.additions}</Text>
        <Text style={s.del}>-{sum.deletions}</Text>
      </View>

      {entry?.error && (
        <Text style={s.error} testID="changes-error">
          {t("changes.error", { message: entry.error })}
        </Text>
      )}

      <FlatList
        data={diffs}
        keyExtractor={(item) => item.file}
        refreshControl={<RefreshControl refreshing={!!entry?.loading && !!entry?.diffs} onRefresh={() => void load(tab, true)} />}
        renderItem={({ item }) => (
          <FileRow
            diff={item}
            isDark={isDark}
            onPress={() => router.push({ pathname: "/changes/file", params: { key, file: item.file } })}
          />
        )}
        ListEmptyComponent={
          entry?.loading || !entry ? (
            <ActivityIndicator style={s.loading} color={isDark ? "#ffffff" : "#0a0a0a"} />
          ) : entry.error ? null : (
            <Text style={[s.empty, isDark && s.metaDark]}>{emptyText}</Text>
          )
        }
        contentContainerStyle={s.list}
        testID="changes-list"
      />
    </View>
  )
}

function FileRow({ diff, isDark, onPress }: { diff: FileDiff; isDark: boolean; onPress: () => void }) {
  const { dir, name } = splitPath(diff.file)
  const icon = diff.status === "added" ? "add-circle-outline" : diff.status === "deleted" ? "remove-circle-outline" : "document-text-outline"
  const color = diff.status === "added" ? "#16a34a" : diff.status === "deleted" ? "#dc2626" : isDark ? "#a3a3a3" : "#666666"
  return (
    <TouchableOpacity style={[s.row, isDark && s.rowDark]} onPress={onPress} testID={`changes-file-${diff.file}`}>
      <Ionicons name={icon} size={18} color={color} />
      <View style={s.rowText}>
        <Text style={[s.name, isDark && s.textDark]} numberOfLines={1}>
          {name}
        </Text>
        {dir ? (
          <Text style={[s.dir, isDark && s.metaDark]} numberOfLines={1} ellipsizeMode="head">
            {dir}
          </Text>
        ) : null}
      </View>
      <Text style={s.add}>+{diff.additions}</Text>
      <Text style={s.del}>-{diff.deletions}</Text>
      <Ionicons name="chevron-forward" size={16} color={isDark ? "#666666" : "#999999"} />
    </TouchableOpacity>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#ffffff" },
  containerDark: { backgroundColor: "#0a0a0a" },
  tabs: { flexDirection: "row", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#e5e5e5" },
  tabsDark: { borderBottomColor: "#262626" },
  tab: { flex: 1, alignItems: "center", paddingVertical: 12, borderBottomWidth: 2, borderBottomColor: "transparent" },
  tabActive: { borderBottomColor: "#3b82f6" },
  tabText: { fontSize: 14, fontWeight: "500", color: "#0a0a0a" },
  tabTextActive: { color: "#3b82f6", fontWeight: "600" },
  textDark: { color: "#ffffff" },
  metaDark: { color: "#888888" },
  summary: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingVertical: 10 },
  summaryText: { flex: 1, fontSize: 13, color: "#666666" },
  add: { fontSize: 12, fontWeight: "700", color: "#16a34a" },
  del: { fontSize: 12, fontWeight: "700", color: "#dc2626" },
  error: { color: "#ef4444", fontSize: 13, paddingHorizontal: 16, paddingBottom: 8 },
  list: { paddingBottom: 32, flexGrow: 1 },
  loading: { marginTop: 32 },
  empty: { textAlign: "center", marginTop: 32, paddingHorizontal: 24, fontSize: 14, color: "#666666" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#eeeeee",
  },
  rowDark: { borderBottomColor: "#1f1f1f" },
  rowText: { flex: 1 },
  name: { fontSize: 14, fontWeight: "500", color: "#0a0a0a" },
  dir: { fontSize: 12, color: "#888888", marginTop: 2 },
})
