import { Stack } from "expo-router"
import { ImageGalleryView } from "../src/components/media/ImageGalleryView"

export default function ImageViewerScreen() {
  return (
    <>
      <Stack.Screen options={{ headerShown: false, animation: "fade" }} />
      <ImageGalleryView />
    </>
  )
}
