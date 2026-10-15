import { useEffect, useMemo, useState } from "react"
import { Pressable, StyleSheet, Text, View, useColorScheme } from "react-native"
import { Image } from "expo-image"
import { useConnections } from "../../stores/connections"
import { mediaHeaders, mediaUrl } from "../../lib/media-url"
import { ImageViewer } from "../media/ImageViewer"

// Cap very tall screenshots at a few bubbles of height; the aspect ratio
// still decides the final box, contentFit keeps it undistorted.
const MAX_HEIGHT = 340

interface Props {
  uri: string
  alt?: string
  // Overrides the default "open full-screen" tap (used for linked images).
  onPress?: () => void
}

// One `![](...)` block from an assistant reply. Relative URLs (the forge
// `/__forge/file` pattern) are resolved against the active connection and
// carry its Basic-auth header; foreign hosts get the image without our auth.
export function MarkdownImage({ uri, alt, onPress }: Props) {
  const isDark = useColorScheme() === "dark"
  const baseUrl = useConnections((s) => s.clientBase?.baseUrl)
  const auth = useConnections((s) => s.clientBase?.auth)
  const workspace = useConnections((s) => s.workspace)

  const resolved = useMemo(() => mediaUrl(uri, baseUrl), [uri, baseUrl])
  const headers = useMemo(() => mediaHeaders(resolved, baseUrl, auth), [resolved, baseUrl, auth])

  const [aspect, setAspect] = useState<number | undefined>(undefined)
  const [failed, setFailed] = useState(false)
  const [reload, setReload] = useState(0)
  const [full, setFull] = useState(false)

  useEffect(() => {
    setAspect(undefined)
    setFailed(false)
  }, [resolved])

  // A sleeping workspace answers 503 + Retry-After; when the store already
  // knows it is starting up, retry quietly instead of blaming the image.
  useEffect(() => {
    if (!failed || !workspace) return
    const delay = workspace.state === "waking" ? 5_000 : workspace.state === "asleep" ? 30_000 : 0
    if (!delay) return
    const timer = setTimeout(() => {
      setFailed(false)
      setReload((n) => n + 1)
    }, delay)
    return () => clearTimeout(timer)
  }, [failed, workspace])

  const retry = () => {
    setFailed(false)
    setReload((n) => n + 1)
  }

  const tap = () => {
    if (failed) {
      retry()
      return
    }
    if (onPress) {
      onPress()
      return
    }
    setFull(true)
  }

  if (failed) {
    return (
      <Pressable onPress={retry} style={[styles.box, styles.errorBox, isDark && styles.errorBoxDark]} accessibilityRole="button">
        <Text style={[styles.errorText, isDark && styles.errorTextDark]}>Image failed to load — tap to reload</Text>
      </Pressable>
    )
  }

  return (
    <Pressable onPress={tap} style={styles.box} accessibilityRole="image" accessibilityLabel={alt || "Image"}>
      <Image
        key={reload}
        source={{ uri: resolved, headers }}
        style={[styles.image, aspect ? { aspectRatio: aspect } : undefined]}
        contentFit="contain"
        transition={120}
        onLoad={(event) => {
          const size = event.source
          if (size && size.width > 0 && size.height > 0) setAspect(size.width / size.height)
        }}
        onError={() => setFailed(true)}
      />
      <ImageViewer visible={full} uri={resolved} headers={headers} onClose={() => setFull(false)} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  box: {
    width: "100%",
    minHeight: 80,
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: "rgba(128,128,128,0.12)",
    marginVertical: 4,
  },
  errorBox: {
    minHeight: 44,
    padding: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(128,128,128,0.35)",
    borderStyle: "dashed",
  },
  errorBoxDark: {
    borderColor: "rgba(255,255,255,0.2)",
  },
  errorText: {
    fontSize: 13,
    color: "#666666",
  },
  errorTextDark: {
    color: "#aaaaaa",
  },
  image: {
    width: "100%",
    minHeight: 80,
    maxHeight: MAX_HEIGHT,
  },
})
