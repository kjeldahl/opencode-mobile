import { useEffect, useRef, useState } from "react"
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { useTranslation } from "react-i18next"
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
} from "react-native-reanimated"
import {
  connectionIndicator,
  restoredFlash,
  type Banner,
  type Indicator,
  type IndicatorState,
} from "../../lib/connection-status"

// The full width of the header slot so a state swap never reflows the title.
// Exported so the title knows how much room the indicator takes when visible.
export const CONNECTION_SLOT = 24
const SLOT = CONNECTION_SLOT
const SIZE = 16
// How long the "we're back" check stays up. Short enough to read as a nod,
// long enough to notice without blocking anything.
const RESTORED_MS = 1500

const TINT: Record<IndicatorState, string> = {
  none: "transparent",
  retrying: "#d97706",
  waking: "#0284c7",
  stopped: "#6366f1",
  restored: "#22c55e",
}

const ICON = {
  none: "ellipse-outline",
  retrying: "sync",
  waking: "hourglass-outline",
  stopped: "power-outline",
  restored: "checkmark-circle",
} as const

interface Props {
  indicator: Indicator
  isDark: boolean
  // True while the reason line under the header is open.
  expanded: boolean
  onPress: () => void
}

// Compact connection state for the header (issue #35). A routine, self-healing
// drop used to render a full-width banner that pushed the whole chat down; the
// same states now live in a 16px icon that never blocks the header.
export function ConnectionIndicator({ indicator, isDark, expanded, onPress }: Props) {
  const { t } = useTranslation()
  const { state } = indicator
  const visible = state !== "none"
  const tint = isDark && state === "restored" ? "#4ade80" : TINT[state]

  const slot = useSharedValue(visible ? 1 : 0)
  const pop = useSharedValue(1)
  const flash = useSharedValue(0)
  const pulse = useSharedValue(1)

  useEffect(() => {
    slot.value = withTiming(visible ? 1 : 0, { duration: 180, easing: Easing.out(Easing.cubic) })
  }, [visible, slot])

  useEffect(() => {
    if (state !== "restored") {
      pop.value = 1
      flash.value = 0
      return
    }
    // One window, two effects: a spring scale-in over the first third, then a
    // gentle fade for the last third. The whole thing is over on its own.
    pop.value = 0.4
    pop.value = withSpring(1, { damping: 9, stiffness: 220, mass: 0.6 })
    flash.value = 0
    flash.value = withTiming(1, { duration: RESTORED_MS, easing: Easing.linear })
  }, [state, pop, flash])

  useEffect(() => {
    // Waking is a slow wait, not a fast retry — a lazy breath, no spinner.
    if (state !== "waking") {
      pulse.value = 1
      return
    }
    pulse.value = 0.4
    pulse.value = withRepeat(withTiming(1, { duration: 1100, easing: Easing.inOut(Easing.quad) }), -1, true)
  }, [state, pulse])

  const slotStyle = useAnimatedStyle(() => ({
    width: SLOT * slot.value,
    opacity: slot.value,
  }))

  const glyphStyle = useAnimatedStyle(() =>
    state === "restored"
      ? {
          opacity: interpolate(flash.value, [0, 0.08, 0.65, 1], [0, 1, 1, 0]),
          transform: [{ scale: pop.value }],
        }
      : {
          opacity: interpolate(pulse.value, [0.4, 1], [0.45, 1]),
          transform: [{ scale: 1 }],
        },
  )

  return (
    <Animated.View style={[s.slot, slotStyle]} pointerEvents={visible ? "auto" : "none"}>
      <Pressable
        style={s.hit}
        onPress={onPress}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={t(`connection.indicator.a11y.${state}`)}
        testID="connection-indicator"
      >
        {state === "retrying" ? (
          <ActivityIndicator size="small" color={tint} />
        ) : (
          <Animated.View style={[s.glyph, glyphStyle]}>
            <Ionicons name={ICON[state]} size={state === "restored" ? SIZE + 4 : SIZE} color={tint} />
          </Animated.View>
        )}
        {expanded && <View style={[s.underline, { backgroundColor: tint }]} />}
      </Pressable>
    </Animated.View>
  )
}

interface ReasonProps {
  indicator: Indicator
  isDark: boolean
  onDismiss: () => void
}

// Tap the icon → this line appears under the header instead of a modal.
export function ConnectionReason({ indicator, isDark, onDismiss }: ReasonProps) {
  const { t } = useTranslation()
  const params = { seconds: indicator.seconds, attempt: indicator.attempt }
  return (
    <Pressable style={[s.reason, isDark && s.reasonDark]} onPress={onDismiss} testID="connection-reason">
      <Text style={[s.reasonText, isDark && s.reasonTextDark]}>{t(`connection.indicator.reason.${indicator.state}`, params)}</Text>
      <Ionicons name="close" size={14} color={isDark ? "#888888" : "#999999"} />
    </Pressable>
  )
}

/** Indicator + the tap-to-expand line, wired up. Both screens that used the
 *  banner render the icon and open the reason under the header. The restored
 *  flash is derived here so both screens agree on what "we're back" means:
 *  reconnectAttempts resetting to 0 — the flag is reset in the same store
 *  write, so nothing else can tell the two apart. */
export function useConnectionIndicator(banner: Banner, reconnectAttempts: number) {
  const [expanded, setExpanded] = useState(false)
  const [restored, setRestored] = useState(false)
  const prevAttempts = useRef(reconnectAttempts)
  const indicator = connectionIndicator(banner, restored)
  const state = indicator.state

  useEffect(() => {
    const healed = restoredFlash(prevAttempts.current, reconnectAttempts)
    prevAttempts.current = reconnectAttempts
    if (!healed) {
      // Back to retrying (or never dropped) — no green check may linger.
      if (reconnectAttempts > 0) setRestored(false)
      return
    }
    setRestored(true)
    const timer = setTimeout(() => setRestored(false), RESTORED_MS)
    return () => clearTimeout(timer)
  }, [reconnectAttempts])

  // Any state change closes the line — the answer the user opened it for has
  // already changed under them.
  useEffect(() => setExpanded(false), [state])

  useEffect(() => {
    if (!expanded) return
    const timer = setTimeout(() => setExpanded(false), 6000)
    return () => clearTimeout(timer)
  }, [expanded])

  return {
    indicator,
    expanded,
    toggle: () => setExpanded((v) => !v),
    close: () => setExpanded(false),
  }
}

const s = StyleSheet.create({
  slot: { height: 32, justifyContent: "center", overflow: "hidden" },
  hit: { paddingHorizontal: 4, alignItems: "center", justifyContent: "center", gap: 2 },
  glyph: { width: SIZE + 4, alignItems: "center" },
  underline: { width: 10, height: 2, borderRadius: 1 },
  reason: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: "#f5f5f5",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e5e5e5",
  },
  reasonDark: { backgroundColor: "#111111", borderBottomColor: "#262626" },
  reasonText: { flex: 1, fontSize: 13, color: "#333333" },
  reasonTextDark: { color: "#d4d4d4" },
})
