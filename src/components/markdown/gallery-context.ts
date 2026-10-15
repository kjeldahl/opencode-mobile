import { createContext } from "react"
import type { GalleryItem } from "../../lib/markdown-gallery"

export type { GalleryItem }

// Provided by <Markdown> with every image the reply contains, so one tap can
// open a viewer that pages through the whole reply, not just the tapped block.
export const GalleryContext = createContext<GalleryItem[]>([])
