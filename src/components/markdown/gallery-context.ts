import { createContext } from "react"

// One image of a chat reply, in document order. `raw` is the untouched url
// from the Markdown (fragment included); each consumer resolves it against
// the active connection.
export interface GalleryItem {
  raw: string
  alt?: string
}

// Provided by <Markdown> with every image the reply contains, so one tap can
// open a viewer that pages through the whole reply, not just the tapped block.
export const GalleryContext = createContext<GalleryItem[]>([])
