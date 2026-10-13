import { useMemo } from "react"
import { View, Text, FlatList, StyleSheet, TouchableOpacity, useColorScheme } from "react-native"
import { Stack, router, useLocalSearchParams } from "expo-router"
import { Ionicons } from "@expo/vector-icons"
import { useTranslation } from "react-i18next"
import { useChanges } from "../../src/stores/changes"
import { parsePatch, sortDiffs, splitPath } from "../../src/lib/changes"
import { DiffRow } from "../../src/components/chat"

// Fullscreen diff of one file from the Changes view. Long lines wrap; the
// patch comes from the Changes store entry (`key`) the file list was showing;
// the header arrows step through that list in the same order.
export default function ChangeFileScreen() {
  const { key, file } = useLocalSearchParams<{ key: string; file: string }>()
  const isDark = useColorScheme() === "dark"
  const { t } = useTranslation()
  const diffs = useChanges((s) => s.entries[key]?.diffs)
  const files = useMemo(() => sortDiffs(diffs ?? []), [diffs])
  const index = files.findIndex((item) => item.file === file)
  const diff = index === -1 ? undefined : files[index]
  const go = (step: number) => {
    const next = files[index + step]
    if (next) router.setParams({ file: next.file })
  }
  const color = (enabled: boolean) => (enabled ? (isDark ? "#ffffff" : "#0a0a0a") : isDark ? "#444444" : "#cccccc")
  const lines = useMemo(() => parsePatch(diff?.patch), [diff?.patch])
  const { dir, name } = splitPath(file ?? "")

  return (
    <View style={[s.container, isDark && s.containerDark]}>
      <Stack.Screen
        options={{
          title: name,
          headerRight: () =>
            files.length > 1 ? (
              <View style={s.nav}>
                <TouchableOpacity onPress={() => go(-1)} disabled={index <= 0} hitSlop={8} testID="change-file-prev">
                  <Ionicons name="chevron-back" size={24} color={color(index > 0)} />
                </TouchableOpacity>
                <Text style={[s.count, isDark && s.metaDark]}>
                  {index + 1}/{files.length}
                </Text>
                <TouchableOpacity
                  onPress={() => go(1)}
                  disabled={index === -1 || index >= files.length - 1}
                  hitSlop={8}
                  testID="change-file-next"
                >
                  <Ionicons name="chevron-forward" size={24} color={color(index !== -1 && index < files.length - 1)} />
                </TouchableOpacity>
              </View>
            ) : undefined,
        }}
      />
      <View style={[s.header, isDark && s.headerDark]}>
        <Text style={[s.path, isDark && s.metaDark]} numberOfLines={2}>
          {dir}
          {name}
        </Text>
        {diff && (
          <>
            {diff.status && <Text style={[s.status, isDark && s.metaDark]}>{t(`changes.status.${diff.status}`)}</Text>}
            <Text style={s.add}>+{diff.additions}</Text>
            <Text style={s.del}>-{diff.deletions}</Text>
          </>
        )}
      </View>
      <FlatList
        key={file}
        data={lines}
        keyExtractor={(_, index) => String(index)}
        renderItem={({ item }) => <DiffRow line={item} isDark={isDark} wrap />}
        initialNumToRender={60}
        windowSize={11}
        ListEmptyComponent={<Text style={[s.empty, isDark && s.metaDark]}>{t("changes.noPatch")}</Text>}
        contentContainerStyle={s.list}
        testID="change-file-diff"
      />
    </View>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f8f8f8" },
  containerDark: { backgroundColor: "#1a1a1a" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: "#ffffff",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e5e5e5",
  },
  headerDark: { backgroundColor: "#0a0a0a", borderBottomColor: "#262626" },
  path: { flex: 1, fontSize: 12, color: "#666666" },
  nav: { flexDirection: "row", alignItems: "center", gap: 12 },
  count: { fontSize: 13, color: "#666666", minWidth: 32, textAlign: "center" },
  metaDark: { color: "#888888" },
  status: { fontSize: 12, color: "#666666" },
  add: { fontSize: 12, fontWeight: "700", color: "#16a34a" },
  del: { fontSize: 12, fontWeight: "700", color: "#dc2626" },
  list: { paddingVertical: 4, paddingBottom: 32 },
  empty: { textAlign: "center", marginTop: 32, paddingHorizontal: 24, fontSize: 14, color: "#666666" },
})
