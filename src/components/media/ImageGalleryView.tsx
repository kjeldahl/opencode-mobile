import { useMemo } from "react"
import { Alert, Pressable, StyleSheet, Text, View } from "react-native"
import { Gesture, GestureDetector } from "react-native-gesture-handler"
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated"
import { Image } from "expo-image"
import { Ionicons } from "@expo/vector-icons"
import { router } from "expo-router"
import { useConnections } from "../../stores/connections"
import { useMediaViewer } from "../../stores/media-viewer"
import { mediaHeaders, mediaUrl, splitCrop } from "../../lib/media-url"
import { copyImage, mediaActionsAvailable, saveImage, shareImage } from "../../lib/media-actions"

// Full-screen gallery: "2/4" pager with chevrons, pinch/double-tap zoom with
// pan, and copy/save/share of the authenticated image bytes.
export function ImageGalleryView() {
  const items = useMediaViewer((s) => s.items)
  const index = useMediaViewer((s) => s.index)
  const setIndex = useMediaViewer((s) => s.setIndex)
  const baseUrl = useConnections((s) => s.clientBase?.baseUrl)
  const auth = useConnections((s) => s.clientBase?.auth)

  const image = useMemo(() => {
    const item = items[index]
    if (!item) return undefined
    const bare = splitCrop(item.raw).url
    const resolved = mediaUrl(bare, baseUrl)
    return { resolved, headers: mediaHeaders(resolved, baseUrl, auth) }
  }, [index, items, baseUrl, auth])

  const go = (delta: number) => setIndex(Math.max(0, Math.min(items.length - 1, index + delta)))

  const act = (kind: "copy" | "save" | "share") => {
    if (!image) return
    const run = kind === "copy" ? copyImage(image.resolved, image.headers) : kind === "save" ? saveImage(image.resolved, image.headers) : shareImage(image.resolved, image.headers)
    run.catch((error: unknown) =>
      Alert.alert(
        kind === "copy" ? "Could not copy" : kind === "save" ? "Could not save" : "Could not share",
        error instanceof Error ? error.message : String(error),
      ),
    )
  }

  return (
    <View style={styles.root} testID="image-viewer">
      <View style={styles.bar}>
        <Pressable onPress={() => router.back()} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close image" testID="viewer-close">
          <Ionicons name="close" size={26} color="#ffffff" />
        </Pressable>
        <View style={styles.barRight}>
          {mediaActionsAvailable ? (
            <>
              <Pressable onPress={() => act("copy")} hitSlop={8} accessibilityRole="button" accessibilityLabel="Copy image" testID="viewer-copy">
                <Ionicons name="copy-outline" size={22} color="#ffffff" />
              </Pressable>
              <Pressable onPress={() => act("save")} hitSlop={8} accessibilityRole="button" accessibilityLabel="Save to photo library" testID="viewer-save">
                <Ionicons name="download-outline" size={22} color="#ffffff" />
              </Pressable>
              <Pressable onPress={() => act("share")} hitSlop={8} accessibilityRole="button" accessibilityLabel="Share image" testID="viewer-share">
                <Ionicons name="share-outline" size={22} color="#ffffff" />
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
    </View>
  )
}

// Pinch to zoom, double-tap toggle, one-finger pan while zoomed.
//
// Why this is Reanimated-only: with react-native-reanimated 4,
// babel-preset-expo applies the worklets plugin, which AUTO-WORKLETIZES every
// callback chained on `Gesture.*`. Callbacks therefore run on the UI thread,
// where plain JS objects are inaccessible: touching a react-native `Animated.Value`
// (`setValue` / `__getValue`) or a hook ref from one crashes a release build
// on the first touch (that was the zoom crash). Only shared values may be
// touched here; reach JS via runOnJS/scheduleOnRN if that ever changes.
function ZoomPane({ resolved, headers }: { resolved: string; headers?: Record<string, string> }) {
  const scale = useSharedValue(1)
  const offsetX = useSharedValue(0)
  const offsetY = useSharedValue(0)
  const savedScale = useSharedValue(1)
  const savedX = useSharedValue(0)
  const savedY = useSharedValue(0)

  const pinch = useMemo(
    () =>
      Gesture.Pinch()
        .onBegin(() => {
          "worklet"
          savedScale.value = scale.value
        })
        .onUpdate((event) => {
          "worklet"
          scale.value = Math.min(Math.max(savedScale.value * event.scale, 1), 4)
          if (scale.value === 1) {
            offsetX.value = 0
            offsetY.value = 0
          }
        }),
    [],
  )

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .onBegin(() => {
          "worklet"
          savedX.value = offsetX.value
          savedY.value = offsetY.value
        })
        .onUpdate((event) => {
          "worklet"
          if (scale.value <= 1) return
          offsetX.value = savedX.value + event.translationX
          offsetY.value = savedY.value + event.translationY
        }),
    [],
  )

  const doubleTap = useMemo(
    () =>
      Gesture.Tap()
        .numberOfTaps(2)
        .onStart(() => {
          "worklet"
          scale.value = withTiming(scale.value > 1 ? 1 : 2.5)
          offsetX.value = withTiming(0)
          offsetY.value = withTiming(0)
        }),
    [],
  )

  // Double-tap wins over the pinch+pan pair; the pair is simultaneous so pan
  // keeps working during a pinch.
  const combined = useMemo(() => Gesture.Exclusive(doubleTap, Gesture.Simultaneous(pinch, pan)), [])

  const zoomStyle = useAnimatedStyle(() => ({
    flex: 1,
    transform: [{ translateX: offsetX.value }, { translateY: offsetY.value }, { scale: scale.value }],
  }))

  return (
    <GestureDetector gesture={combined}>
      <Animated.View style={styles.zoomWrap}>
        <Animated.View style={zoomStyle}>
          <Image source={{ uri: resolved, headers }} style={StyleSheet.absoluteFill} contentFit="contain" />
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#000000",
  },
  bar: {
    position: "absolute",
    zIndex: 10,
    left: 0,
    right: 0,
    top: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 60,
    paddingBottom: 8,
  },
  barRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  pager: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  count: {
    color: "#ffffff",
    fontSize: 14,
  },
  zoomWrap: {
    flex: 1,
  },
})
