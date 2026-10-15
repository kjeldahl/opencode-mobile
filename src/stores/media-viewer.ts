import { router } from "expo-router"
import { create } from "zustand"
import type { GalleryItem } from "../components/markdown/gallery-context"

interface MediaViewerState {
  items: GalleryItem[]
  index: number
  open: (items: GalleryItem[], index: number) => void
  setIndex: (index: number) => void
}

// The full-screen image gallery lives as a real screen (app/image-viewer.tsx)
// rather than a Modal: gesture handlers inside Modals are a known crash zone
// on Android, and a screen gives the pager the same chrome as other viewers.
export const useMediaViewer = create<MediaViewerState>((set) => ({
  items: [],
  index: 0,
  open: (items, index) => {
    set({ items, index })
    router.push("/image-viewer")
  },
  setIndex: (index) => set({ index }),
}))
