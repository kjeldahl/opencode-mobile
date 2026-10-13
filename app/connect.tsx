import { useEffect, useMemo, useRef, useState } from "react"
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  useColorScheme,
  ActivityIndicator,
} from "react-native"
import { Stack, router, useLocalSearchParams } from "expo-router"
import { Ionicons } from "@expo/vector-icons"
import { useTranslation } from "react-i18next"
import { useConnections } from "../src/stores/connections"
import { connectLinkFromParams, findConnection, type ConnectLink } from "../src/lib/connect-link"
import { useKeyboardHeight } from "../src/lib/use-keyboard-height"

// Target of opencode://connect links (see src/lib/connect-link.ts). A known
// server is activated without questions; a new one asks for its password once,
// which then lives in SecureStore like any other connection's.
export default function ConnectScreen() {
  const params = useLocalSearchParams()
  const link = useMemo(() => connectLinkFromParams(params), [JSON.stringify(params)])
  const isDark = useColorScheme() === "dark"
  const { t } = useTranslation()
  const keyboardHeight = useKeyboardHeight()

  const existing = useConnections((s) => (link ? findConnection(s.connections, link.url) : undefined))
  const [name, setName] = useState(link?.name ?? "")
  const [user, setUser] = useState(link?.user ?? "opencode")
  const [password, setPassword] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const started = useRef(false)

  // Known server: switch to it right away.
  useEffect(() => {
    if (!link || !existing || started.current) return
    started.current = true
    void activateExisting(existing.id, link)
  }, [link, existing])

  const onConnect = async () => {
    if (!link || busy) return
    // The store update below makes `existing` match; don't let the effect
    // above activate (and navigate) a second time.
    started.current = true
    setBusy(true)
    setError(null)
    const store = useConnections.getState()
    const connection = {
      name: name.trim() || link.name || hostOf(link.url),
      type: "tunnel" as const,
      url: link.url,
      username: user.trim() || undefined,
      directory: link.dir,
    }
    const result = await store.testConnection({ id: "", ...connection }, "onboarding", password || undefined)
    if (!result.ok) {
      started.current = false
      setBusy(false)
      setError(result.error || t("connect.failed"))
      return
    }
    const id = await store.addConnection(connection, password || undefined)
    await useConnections.getState().setActiveConnection(id)
    open(link)
  }

  if (!link) {
    return (
      <View style={[s.center, isDark && s.containerDark]}>
        <Stack.Screen options={{ title: t("connect.title") }} />
        <Ionicons name="link-outline" size={48} color={isDark ? "#444444" : "#cccccc"} />
        <Text style={[s.hint, isDark && s.metaDark]}>{t("connect.invalid")}</Text>
        <TouchableOpacity style={[s.button, isDark && s.buttonDark]} onPress={() => router.replace("/")}>
          <Text style={[s.buttonText, isDark && s.buttonTextDark]}>{t("connect.home")}</Text>
        </TouchableOpacity>
      </View>
    )
  }

  if (existing) {
    return (
      <View style={[s.center, isDark && s.containerDark]}>
        <Stack.Screen options={{ title: t("connect.title") }} />
        <ActivityIndicator size="large" color={isDark ? "#ffffff" : "#0a0a0a"} />
        <Text style={[s.hint, isDark && s.metaDark]}>{t("connect.opening", { name: existing.name })}</Text>
      </View>
    )
  }

  return (
    <View style={[s.container, isDark && s.containerDark, { paddingBottom: keyboardHeight }]}>
      <Stack.Screen options={{ title: t("connect.title") }} />
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <Text style={[s.intro, isDark && s.textDark]}>{t("connect.newIntro")}</Text>

        <Text style={[s.label, isDark && s.metaDark]}>{t("connect.server")}</Text>
        <Text style={[s.value, isDark && s.textDark]} selectable>
          {link.url}
        </Text>
        {link.dir && (
          <>
            <Text style={[s.label, isDark && s.metaDark]}>{t("connect.directory")}</Text>
            <Text style={[s.value, isDark && s.textDark]} selectable>
              {link.dir}
            </Text>
          </>
        )}

        <Text style={[s.label, isDark && s.metaDark]}>{t("connect.name")}</Text>
        <TextInput
          style={[s.input, isDark && s.inputDark]}
          value={name}
          onChangeText={setName}
          placeholder={hostOf(link.url)}
          placeholderTextColor={isDark ? "#666666" : "#999999"}
        />

        <Text style={[s.label, isDark && s.metaDark]}>{t("connect.user")}</Text>
        <TextInput
          style={[s.input, isDark && s.inputDark]}
          value={user}
          onChangeText={setUser}
          autoCapitalize="none"
          autoCorrect={false}
        />

        <Text style={[s.label, isDark && s.metaDark]}>{t("connect.password")}</Text>
        <TextInput
          style={[s.input, isDark && s.inputDark]}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus
          onSubmitEditing={onConnect}
          testID="connect-password"
        />

        {error && <Text style={s.error}>{error}</Text>}

        <TouchableOpacity
          style={[s.button, isDark && s.buttonDark, busy && s.buttonDisabled]}
          onPress={onConnect}
          disabled={busy}
          testID="connect-submit"
        >
          {busy ? (
            <ActivityIndicator size="small" color={isDark ? "#0a0a0a" : "#ffffff"} />
          ) : (
            <Text style={[s.buttonText, isDark && s.buttonTextDark]}>{t("connect.submit")}</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </View>
  )
}

async function activateExisting(id: string, link: ConnectLink) {
  const store = useConnections.getState()
  const current = store.connections.find((c) => c.id === id)
  if (link.dir && current?.directory !== link.dir) await store.updateConnection(id, { directory: link.dir })
  if (useConnections.getState().activeConnection?.id !== id) await useConnections.getState().setActiveConnection(id)
  open(link)
}

// Sessions list, then the chat when the link names one.
function open(link: ConnectLink) {
  router.replace("/")
  if (!link.session) return
  router.push({ pathname: "/session/[id]", params: { id: link.session, ...(link.dir ? { directory: link.dir } : {}) } })
}

function hostOf(url: string): string {
  return url.replace(/^https?:\/\//, "").split("/")[0]
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#ffffff" },
  containerDark: { backgroundColor: "#0a0a0a" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16, padding: 24, backgroundColor: "#ffffff" },
  content: { padding: 16, paddingBottom: 32 },
  intro: { fontSize: 15, color: "#0a0a0a", marginBottom: 8 },
  hint: { fontSize: 14, color: "#666666", textAlign: "center" },
  label: { fontSize: 13, fontWeight: "600", color: "#666666", marginTop: 16, marginBottom: 6 },
  value: { fontSize: 14, color: "#0a0a0a" },
  textDark: { color: "#ffffff" },
  metaDark: { color: "#888888" },
  input: {
    borderWidth: 1,
    borderColor: "#e5e5e5",
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    color: "#0a0a0a",
    backgroundColor: "#ffffff",
  },
  inputDark: { borderColor: "#333333", color: "#ffffff", backgroundColor: "#1a1a1a" },
  error: { color: "#ef4444", fontSize: 13, marginTop: 12 },
  button: {
    marginTop: 24,
    backgroundColor: "#0a0a0a",
    borderRadius: 8,
    padding: 14,
    alignItems: "center",
    alignSelf: "stretch",
  },
  buttonDark: { backgroundColor: "#ffffff" },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: "#ffffff", fontSize: 16, fontWeight: "600" },
  buttonTextDark: { color: "#0a0a0a" },
})
