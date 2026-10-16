import { View, Text, StyleSheet, Platform, Pressable, useWindowDimensions } from "react-native"

interface Props {
  title: string
  location?: string | null
  isDark: boolean
  // Width of the headerRight content; the native header doesn't shrink a
  // custom title, so cap it ourselves to keep it clear of the buttons.
  right: number
  // Room taken by anything rendered in the same header row before the title
  // (the connection indicator), so the cap stays honest.
  leading?: number
  onPress?: () => void
}

// Back button + Material title inset on Android; iOS centers the title.
const LEFT = 72
const GAP = 16

// Two-line header title: session title on top, location as small text below (#19).
export function SessionTitle({ title, location, isDark, right, leading = 0, onPress }: Props) {
  const { width } = useWindowDimensions()
  const side = Math.max(LEFT, right + GAP)
  const max = Platform.OS === "ios" ? width - 2 * side : width - LEFT - right - leading - GAP * 2
  return (
    <Pressable
      style={[s.container, { maxWidth: Math.max(max, 80) }]}
      onPress={onPress}
      hitSlop={8}
      testID="header-title"
    >
      <Text style={[s.title, isDark && s.titleDark]} numberOfLines={1}>
        {title}
      </Text>
      {location && (
        <Text style={[s.location, isDark && s.locationDark]} numberOfLines={1}>
          {location}
        </Text>
      )}
    </Pressable>
  )
}

interface FullProps {
  title: string
  directory?: string
  isDark: boolean
  onPress: () => void
}

// The native header has a fixed height, so the expanded title drops down as a
// band right under it, showing the full title and path. Tap to collapse.
export function SessionTitleFull({ title, directory, isDark, onPress }: FullProps) {
  return (
    <Pressable style={[s.full, isDark && s.fullDark]} onPress={onPress} testID="header-title-full">
      <Text style={[s.title, isDark && s.titleDark]}>{title}</Text>
      {directory && <Text style={[s.location, isDark && s.locationDark]}>{directory}</Text>}
    </Pressable>
  )
}

const s = StyleSheet.create({
  container: { justifyContent: "center" },
  title: { fontSize: 17, fontWeight: "600", color: "#0a0a0a" },
  titleDark: { color: "#ffffff" },
  location: { fontSize: 12, color: "#666666", fontWeight: "500" },
  locationDark: { color: "#888888" },
  full: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 2,
    backgroundColor: "#ffffff",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e5e5e5",
  },
  fullDark: { backgroundColor: "#0a0a0a", borderBottomColor: "#262626" },
})
