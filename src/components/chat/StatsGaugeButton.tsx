import { StyleSheet, TouchableOpacity, View } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from "react-native-reanimated"

interface Props {
  // Context window usage 0..100. The icon fills blue from the bottom.
  percent: number
  active: boolean
  isDark: boolean
  onPress: () => void
}

const SIZE = 20
const BLUE = "#3b82f6"

export function StatsGaugeButton({ percent, active, isDark, onPress }: Props) {
  const fill = Math.max(0, Math.min(100, percent))
  const glow = useSharedValue(0)

  const haloStyle = useAnimatedStyle(() => ({
    opacity: interpolate(glow.value, [0, 1], [0, 0.5]),
    transform: [{ scale: interpolate(glow.value, [0, 1], [0.8, 1.9]) }],
  }))

  const press = () => {
    glow.value = 0
    glow.value = withSequence(
      withTiming(1, { duration: 90, easing: Easing.out(Easing.quad) }),
      withTiming(0, { duration: 620, easing: Easing.out(Easing.cubic) })
    )
    onPress()
  }

  const base = active ? (isDark ? "#6f86c0" : "#7c9bd6") : isDark ? "#888888" : "#666666"

  return (
    <TouchableOpacity onPress={press} hitSlop={8} testID="header-stats">
      <View style={styles.wrap}>
        <Animated.View pointerEvents="none" style={[styles.halo, haloStyle, isDark && styles.haloDark]} />
        <View style={styles.icon} pointerEvents="none">
          <Ionicons name="stats-chart" size={SIZE} color={base} style={styles.glyph} />
          {fill > 0 && (
            <View style={[styles.clip, { height: Math.max(2, (SIZE * fill) / 100) }]} pointerEvents="none">
              <Ionicons name="stats-chart" size={SIZE} color={BLUE} style={styles.glyph} />
            </View>
          )}
        </View>
        {active && <View style={styles.underline} />}
      </View>
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  wrap: {
    width: SIZE,
    height: SIZE,
    justifyContent: "center",
    alignItems: "center",
  },
  icon: {
    width: SIZE,
    height: SIZE,
  },
  glyph: {
    position: "absolute",
    bottom: 0,
    left: 0,
  },
  clip: {
    position: "absolute",
    bottom: 0,
    left: 0,
    width: SIZE,
    overflow: "hidden",
  },
  halo: {
    position: "absolute",
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE,
    backgroundColor: BLUE,
  },
  haloDark: {
    backgroundColor: "#60a5fa",
  },
  underline: {
    position: "absolute",
    bottom: -4,
    width: 10,
    height: 2,
    borderRadius: 1,
    backgroundColor: BLUE,
  },
})
