import { useEffect, useState } from "react"
import { Keyboard, Platform } from "react-native"

// Android IME height, 0 elsewhere. Under edge-to-edge Android no longer resizes
// the window for the keyboard, so screens pad themselves by this amount. Same
// listener pattern as the chat composer (#201): keyboardDidHide resets to 0, so
// no stale padding survives the keyboard closing.
export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(() => (Platform.OS === "android" ? (Keyboard.metrics()?.height ?? 0) : 0))

  useEffect(() => {
    if (Platform.OS !== "android") return
    const show = Keyboard.addListener("keyboardDidShow", (event) => setHeight(event.endCoordinates.height))
    const hide = Keyboard.addListener("keyboardDidHide", () => setHeight(0))
    setHeight(Keyboard.metrics()?.height ?? 0)
    return () => {
      show.remove()
      hide.remove()
    }
  }, [])

  return height
}
