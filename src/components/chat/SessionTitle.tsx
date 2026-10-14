import { View, Text, StyleSheet, Platform, useWindowDimensions } from "react-native"

interface Props {
  title: string
  location?: string | null
  isDark: boolean
  // Width of the headerRight content; the native header doesn't shrink a
  // custom title, so cap it ourselves to keep it clear of the buttons.
  right: number
}

// Back button + Material title inset on Android; iOS centers the title.
const LEFT = 72
const GAP = 16

// Two-line header title: session title on top, location as small text below (#19).
export function SessionTitle({ title, location, isDark, right }: Props) {
  const { width } = useWindowDimensions()
  const side = Math.max(LEFT, right + GAP)
  const max = Platform.OS === "ios" ? width - 2 * side : width - LEFT - right - GAP * 2
  return (
    <View style={[s.container, { maxWidth: Math.max(max, 80) }]} testID="header-title">
      <Text style={[s.title, isDark && s.titleDark]} numberOfLines={1}>
        {title}
      </Text>
      {location && (
        <Text style={[s.location, isDark && s.locationDark]} numberOfLines={1}>
          {location}
        </Text>
      )}
    </View>
  )
}

const s = StyleSheet.create({
  container: { justifyContent: "center" },
  title: { fontSize: 17, fontWeight: "600", color: "#0a0a0a" },
  titleDark: { color: "#ffffff" },
  location: { fontSize: 12, color: "#666666", fontWeight: "500" },
  locationDark: { color: "#888888" },
})
