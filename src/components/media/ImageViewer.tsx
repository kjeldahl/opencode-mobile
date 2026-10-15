import { Modal, Pressable, StyleSheet } from "react-native"
import { Image } from "expo-image"

interface Props {
  visible: boolean
  uri: string
  headers?: Record<string, string>
  onClose: () => void
}

// Full-screen image shown when a chat image is tapped. Tap anywhere (or
// hardware back) closes it.
export function ImageViewer({ visible, uri, headers, onClose }: Props) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close image">
        <Image source={{ uri, headers }} style={styles.image} contentFit="contain" transition={150} />
      </Pressable>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.95)",
    alignItems: "center",
    justifyContent: "center",
  },
  image: {
    width: "100%",
    height: "100%",
  },
})
