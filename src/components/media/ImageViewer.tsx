import { useEffect, useMemo, useRef, useState } from "react"
import {
  ActivityIndicator,
  Animated,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler"
import { Image } from "expo-image"
import { Ionicons } from "@expo/vector-icons"
import { useConnections } from "../../stores/connections"
import { mediaHeaders, mediaUrl, splitCrop } from "../../lib/media-url"
import { copyImage, mediaActionsAvailable, shareImage } from "../../lib/media-actions"
import type { GalleryItem } from "../markdown/gallery-context"

interface Props {
  visible: boolean
  items: GalleryItem[]
  startIndex: number
  onClose: () => void
}

// Full-screen gallery: pager ("2/4" with chevrons, like the changes viewer),
// pinch/double-tap zoom with pan, and copy/save-share of the authenticated
// image bytes.
export function ImageViewer({ visible, items, startIndex, onClose }: Props) {
  const [index, setIndex] = useState(startIndex)
  const [busy, setBusy] = useState<"none" | "copy" | "share">("none")
  const baseUrl = useConnections((s) => s.clientBase?.baseUrl)
  const auth = useConnections((s) => s.clientBase?.auth)

  useEffect(() => {
    if (visible) setIndex(Math.max(0, Math.min(startIndex, items.length - 1)))
  }, [visible, startIndex, items.length])

  const image = useMemo(() => {
    const item = items[index]
    if (!item) return undefined
    const bare = splitCrop(item.raw).url
    const resolved = mediaUrl(bare, baseUrl)
    return { resolved, headers: mediaHeaders(resolved, baseUrl, auth), alt: item.alt }
  }, [index, items, baseUrl, auth])

  const go = (delta: number) => setIndex((i) => Math.max(0, Math.min(items.length - 1, i + delta)))

  const act = async (kind: "copy" | "share") => {
    if (!image) return
    setBusy(kind)
    const run = kind === "copy" ? copyImage(image.resolved, image.headers) : shareImage(image.resolved, image.headers)
    run.catch(() => undefined).finally(() => setBusy("none"))
  }

  if (!visible) return null

  return (
    <Modal visible onRequestClose={onClose} transparent animationType="fade">
      <GestureHandlerRootView style={styles.root}>
        <View style={styles.bar}>
          <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close image">
            <Ionicons name="close" size={26} color="#ffffff" />
          </Pressable>
          <View style={styles.barRight}>
            {mediaActionsAvailable ? (
              <>
                <Pressable onPress={() => act("copy")} disabled={busy !== "none"} hitSlop={8} accessibilityRole="button" accessibilityLabel="Copy image">
                  {busy === "copy" ? <ActivityIndicator color="#ffffff" /> : <Ionicons name="copy-outline" size={22} color="#ffffff" />}
                </Pressable>
                <Pressable
                  onPress={() => act("share")}
                  disabled={busy !== "none"}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Save or share image"
                  testID="viewer-share"
                >
                  {busy === "share" ? <ActivityIndicator color="#ffffff" /> : <Ionicons name="download-outline" size={22} color="#ffffff" />}
                </Pressable>
              </>
            ) : null}
            {items.length > 1 ? (
              <View style={styles.pager} testID="viewer-pager">
                <Pressable onPress={() => go(-1)} disabled={index <= 0} hitSlop={8} accessibilityRole="button" accessibilityLabel="Previous image" testID="viewer-prev">
                  <Ionicons name="chevron-back" size={24} color={index > 0 ? "#ffffff" : "#ffffff55"} />
                </Pressable>
                <Text style={styles.count} testID="viewer-count">
                  {index + 1}/{items.length}
                </Text>
                <Pressable
                  onPress={() => go(1)}
                  disabled={index >= items.length - 1}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Next image"
                  testID="viewer-next"
                >
                  <Ionicons name="chevron-forward" size={24} color={index < items.length - 1 ? "#ffffff" : "#ffffff55"} />
                </Pressable>
              </View>
            ) : null}
          </View>
        </View>
        {image ? <ZoomPane key={`${index}-${image.resolved}`} resolved={image.resolved} headers={image.headers} /> : null}
      </GestureHandlerRootView>
    </Modal>
  )
}

// Pinch to zoom, double-tap toggle, one-finger pan while zoomed.
function ZoomPane({ resolved, headers }: { resolved: string; headers?: Record<string, string> }) {
  const scale = useRef(new Animated.Value(1)).current
  const tx = useRef(new Animated.Value(0)).current
  const ty = useRef(new Animated.Value(0)).current
  const base = useRef({ s: 1, tx: 0, ty: 0 })

  const reset = () => {
    base.current = { s: 1, tx: 0, ty: 0 }
    scale.setValue(1)
    tx.setValue(0)
    ty.setValue(0)
  }

  const pinch = useMemo(
    () =>
      Gesture.Pinch()
        .onBegin(() => {
          base.current = { s: current(scale), tx: current(tx), ty: current(ty) }
        })
        .onUpdate((e) => {
          const next = Math.min(Math.max(base.current.s * e.scale, 1), 4)
          scale.setValue(next)
          if (next === 1) {
            tx.setValue(0)
            ty.setValue(0)
          }
        }),
    [],
  )

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .maxPointers(1)
        .onBegin(() => {
          base.current = { ...base.current, tx: current(tx), ty: current(ty) }
        })
        .onUpdate((e) => {
          if (current(scale) <= 1) return
          tx.setValue(base.current.tx + e.translationX)
          ty.setValue(base.current.ty + e.translationY)
        }),
    [],
  )

  const doubleTap = useMemo(
    () =>
      Gesture.Tap()
        .numberOfTaps(2)
        .onStart(() => {
          if (current(scale) > 1) reset()
          else {
            base.current = { s: 2.5, tx: 0, ty: 0 }
            scale.setValue(2.5)
            tx.setValue(0)
            ty.setValue(0)
          }
        }),
    [],
  )

  const combined = useMemo(() => Gesture.Race(doubleTap, Gesture.Race(pinch, pan)), [])

  return (
    <GestureDetector gesture={combined}>
      <Animated.View style={styles.zoomWrap}>
        <Animated.View
          style={{
            flex: 1,
            transform: [
              { translateX: tx },
              { translateY: ty },
              { scale },
            ],
          }}
        >
          <Image source={{ uri: resolved, headers }} style={StyleSheet.absoluteFill} contentFit="contain" />
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  )
}

function current(value: Animated.Value): number {
  return (value as unknown as { __getValue(): number }).__getValue()
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.96)",
  },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: Platform.OS === "android" ? 48 : 64,
    paddingBottom: 8,
  },
  barRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 18,
  },
  pager: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  count: {
    color: "#ffffff",
    fontSize: 14,
    fontVariant: ["tabular-nums"],
  },
  zoomWrap: {
    flex: 1,
  },
})
