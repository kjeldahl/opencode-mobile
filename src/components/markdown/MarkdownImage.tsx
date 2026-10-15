import { useContext, useEffect, useMemo, useState } from "react"
import { Pressable, ScrollView, StyleSheet, Text, View, useColorScheme, type ViewStyle } from "react-native"
import { Image } from "expo-image"
import { useConnections } from "../../stores/connections"
import { mediaHeaders, mediaUrl, splitCrop, type Crop } from "../../lib/media-url"
import { coverCrop, coverRegion, regionStyle } from "../../lib/media-crop"
import { useMediaViewer } from "../../stores/media-viewer"
import { GalleryContext } from "./gallery-context"

// Tall screenshots are center-cropped to this box unless the agent names a
// region with the #crop=x,y,w,h fragment (see media-url / media-crop).
const WIDE_BOX = 16 / 11
const MAX_HEIGHT = 340
const THUMB = 96

interface Loader {
  resolved: string
  headers?: Record<string, string>
  failed: boolean
  reload: number
  retry: () => void
}

// Resolve + auth-gate a raw Markdown image url, with the "sleeping workspace
// answered 503" retry the chat needs.
function useMediaLoader(raw: string): Loader {
  const baseUrl = useConnections((s) => s.clientBase?.baseUrl)
  const auth = useConnections((s) => s.clientBase?.auth)
  const workspace = useConnections((s) => s.workspace)

  const bare = useMemo(() => splitCrop(raw).url, [raw])
  const resolved = useMemo(() => mediaUrl(bare, baseUrl), [bare, baseUrl])
  const headers = useMemo(() => mediaHeaders(resolved, baseUrl, auth), [resolved, baseUrl, auth])

  const [failed, setFailed] = useState(false)
  const [reload, setReload] = useState(0)
  const retry = () => {
    setFailed(false)
    setReload((n) => n + 1)
  }

  useEffect(() => setFailed(false), [resolved])

  // While the store reports the workspace waking/asleep, retry quietly
  // instead of blaming the image (the 503 + Retry-After case). `retry` is
  // stable (setState only), so [failed, workspace] covers the inputs.
  useEffect(() => {
    if (!failed || !workspace) return
    const delay = workspace.state === "waking" ? 5_000 : workspace.state === "asleep" ? 30_000 : 0
    if (!delay) return
    const timer = setTimeout(retry, delay)
    return () => clearTimeout(timer)
  }, [failed, workspace, retry])

  return { resolved, headers, failed, reload, retry }
}

// Per-render image state both the full block and the strip thumb need:
// natural aspect, failure flag, and a reset whenever the resolved url moves.
function useImageState(resolved: string) {
  const [aspect, setAspect] = useState<number | undefined>(undefined)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setAspect(undefined)
    setFailed(false)
  }, [resolved])

  const noteAspect = (event: { source?: { width?: number; height?: number } }) => {
    const size = event.source
    if (size && size.width && size.height) setAspect(size.width / size.height)
  }

  return { aspect, failed, setFailed, noteAspect }
}

interface Props {
  uri: string
  alt?: string
  // Overrides the default "open viewer" tap (used for linked images).
  onPress?: () => void
}

export function MarkdownImage({ uri, alt, onPress }: Props) {
  const isDark = useColorScheme() === "dark"
  const loader = useMediaLoader(uri)
  const agentCrop = useMemo(() => splitCrop(uri).crop, [uri])
  const gallery = useContext(GalleryContext)

  const openViewer = useMediaViewer((s) => s.open)
  const { aspect, failed, setFailed, noteAspect } = useImageState(loader.resolved)

  const region = useMemo(() => {
    if (!aspect) return undefined
    if (agentCrop) return coverRegion(agentCrop, aspect, WIDE_BOX)
    if (aspect < 1) return coverCrop(aspect, WIDE_BOX)
    return undefined
  }, [aspect, agentCrop])

  const items = gallery.length ? gallery : [{ raw: uri, alt }]

  const tap = () => {
    if (failed) {
      loader.retry()
      return
    }
    if (onPress) {
      onPress()
      return
    }
    openViewer(items, Math.max(0, items.findIndex((i) => i.raw === uri)))
  }

  if (failed || loader.failed) {
    return (
      <Pressable
        onPress={() => {
          setFailed(false)
          loader.retry()
        }}
        style={[styles.box, styles.errorBox, isDark && styles.errorBoxDark]}
        accessibilityRole="button"
      >
        <Text style={[styles.errorText, isDark && styles.errorTextDark]}>Image failed to load — tap to reload</Text>
      </Pressable>
    )
  }

  return (
    <Pressable
      onPress={tap}
      style={[
        styles.box,
        boxAspectStyle(region, aspect),
      ]}
      accessibilityRole="image"
      accessibilityLabel={alt || "Image"}
    >
      {!aspect ? (
        <Image
          key={loader.reload}
          source={{ uri: loader.resolved, headers: loader.headers }}
          style={styles.image}
          contentFit="contain"
          transition={120}
          onLoad={noteAspect}
          onError={() => setFailed(true)}
        />
      ) : region ? (
        <Image
          key={loader.reload}
          source={{ uri: loader.resolved, headers: loader.headers }}
          style={[StyleSheet.absoluteFill, regionStyle(region)]}
          contentFit="fill"
          onError={() => setFailed(true)}
        />
      ) : (
        <Image
          key={loader.reload}
          source={{ uri: loader.resolved, headers: loader.headers }}
          style={StyleSheet.absoluteFill}
          contentFit="contain"
          transition={120}
          onError={() => setFailed(true)}
        />
      )}
    </Pressable>
  )
}

function boxAspectStyle(region: Crop | undefined, aspect?: number): ViewStyle | undefined {
  if (region) return { aspectRatio: WIDE_BOX, minHeight: 72, maxHeight: MAX_HEIGHT }
  if (aspect) return { aspectRatio: aspect, minHeight: 72, maxHeight: MAX_HEIGHT }
  return undefined
}

// Two or more adjacent images render as a horizontal thumbnail strip.
export function MarkdownImageStrip({ images }: { images: Props[] }) {
  const isDark = useColorScheme() === "dark"
  const gallery = useContext(GalleryContext)
  const items = gallery.length ? gallery : images.map((i) => ({ raw: i.uri, alt: i.alt }))
  const openViewer = useMediaViewer((s) => s.open)

  const open = (i: number) => openViewer(items, Math.max(0, items.findIndex((it) => it.raw === images[i]?.uri)))

  return (
    <View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.strip} contentContainerStyle={styles.stripRow}>
        {images.map((img, i) => (
          <StripThumb key={`${img.uri}-${i}`} img={img} isDark={isDark} onOpen={() => open(i)} />
        ))}
      </ScrollView>
    </View>
  )
}

function StripThumb({ img, isDark, onOpen }: { img: Props; isDark: boolean; onOpen: () => void }) {
  const loader = useMediaLoader(img.uri)
  const agentCrop = useMemo(() => splitCrop(img.uri).crop, [img.uri])
  const { aspect, failed, setFailed, noteAspect } = useImageState(loader.resolved)

  const region = useMemo(() => {
    if (!aspect) return undefined
    if (agentCrop) return coverRegion(agentCrop, aspect, THUMB / 72)
    return coverCrop(aspect, THUMB / 72)
  }, [aspect, agentCrop])

  return (
    <Pressable
      onPress={() => (failed ? loader.retry() : onOpen())}
      style={[styles.thumb, failed && styles.thumbError, isDark && styles.thumbErrorDark]}
      accessibilityRole="image"
      accessibilityLabel={img.alt || "Image"}
    >
      {region ? (
        <Image
          key={loader.reload}
          source={{ uri: loader.resolved, headers: loader.headers }}
          style={[StyleSheet.absoluteFill, regionStyle(region)]}
          contentFit="fill"
        />
      ) : (
        <Image
          key={loader.reload}
          source={{ uri: loader.resolved, headers: loader.headers }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          onLoad={noteAspect}
          onError={() => setFailed(true)}
        />
      )}
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
  image: {
    width: "100%",
    minHeight: 80,
    maxHeight: MAX_HEIGHT,
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
  strip: {
    flexGrow: 0,
    marginVertical: 4,
  },
  stripRow: {
    gap: 8,
  },
  thumb: {
    width: THUMB,
    height: 72,
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: "rgba(128,128,128,0.12)",
  },
  thumbError: {
    borderWidth: 1,
    borderColor: "rgba(128,128,128,0.35)",
    borderStyle: "dashed",
  },
  thumbErrorDark: {
    borderColor: "rgba(255,255,255,0.2)",
  },
})
