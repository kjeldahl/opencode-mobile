// Pure helpers for the Markdown image gallery, kept free of react-native so
// they can run under plain node --test (they caused the gallery-gap bug and
// deserve the coverage).

import { isValidElement, type ReactNode } from "react"

// One image of a chat reply, in document order. `raw` is the untouched url
// from the Markdown (fragment included); each consumer resolves it against
// the active connection.
export interface GalleryItem {
  raw: string
  alt?: string
}

// Whitespace-only rendered nodes (soft line breaks between adjacent image
// lines) must not survive into the strip block — they render as invisible
// Text rows and push the gallery away from the text above it.
export function isWhitespaceNode(node: ReactNode): boolean {
  if (typeof node === "string") return !node.trim()
  if (isValidElement(node)) {
    const children = (node.props as { children?: ReactNode }).children
    if (children === undefined) return true
    if (Array.isArray(children)) return children.every(isWhitespaceNode)
    return isWhitespaceNode(children)
  }
  return !node
}

export function isImageElement(node: ReactNode, image: unknown): boolean {
  return isValidElement(node) && node.type === image
}

// Collect { raw, alt } for every image element inside the parsed blocks, in
// document order. The two component identities (the lone image renderer and
// the strip that holds rows of them) are passed in so this stays pure.
export function collectImages(node: ReactNode, image: unknown, strip: unknown): GalleryItem[] {
  if (!node) return []
  if (Array.isArray(node)) return node.flatMap((child) => collectImages(child, image, strip))
  if (!isValidElement(node)) return []
  const props = node.props as { uri?: string; alt?: string; images?: { uri: string; alt?: string }[]; children?: ReactNode }
  if (node.type === image) return [{ raw: props.uri ?? "", alt: props.alt }]
  if (node.type === strip) return (props.images ?? []).map((i) => ({ raw: i.uri, alt: i.alt }))
  return collectImages(props.children, image, strip)
}
