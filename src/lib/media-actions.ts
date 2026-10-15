// Save / share / copy for full-screen images. All native-only: the web build
// hides these buttons (no file system or native share sheet there).

import { Platform } from "react-native"
import * as Clipboard from "expo-clipboard"
import * as Sharing from "expo-sharing"
import { File, Paths } from "expo-file-system"

export const mediaActionsAvailable = Platform.OS !== "web"

// The forge url keeps the real filename in the ?path= query; fall back to the
// last path segment, then to a generic name.
export function filenameFrom(url: string): string {
  try {
    const parsed = new URL(url)
    const path = parsed.searchParams.get("path")
    if (path) {
      const leaf = path.split("/").pop()
      if (leaf) return leaf
    }
    const leaf = parsed.pathname.split("/").pop()
    if (leaf) return leaf
  } catch {
    const leaf = url.split(/[?#]/)[0].split("/").pop()
    if (leaf) return leaf
  }
  return "image.png"
}

async function downloadToCache(url: string, headers?: Record<string, string>): Promise<File> {
  const file = new File(Paths.cache, `media-viewer-${filenameFrom(url)}`)
  await File.downloadFileAsync(url, file, headers ? { headers } : undefined)
  return file
}

function mimeFrom(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? ""
  return ({ png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", avif: "image/avif", bmp: "image/bmp" } as Record<string, string>)[ext] ?? "application/octet-stream"
}

// Copies the decoded bitmap to the system clipboard.
export async function copyImage(url: string, headers?: Record<string, string>): Promise<void> {
  const file = await downloadToCache(url, headers)
  await Clipboard.setImageAsync(await file.base64())
}

// Downloads with auth and opens the platform sheet, which carries the
// "Save to device"/Photos/Files entries as well as plain sharing.
export async function shareImage(url: string, headers?: Record<string, string>): Promise<void> {
  const file = await downloadToCache(url, headers)
  await Sharing.shareAsync(file.uri, { mimeType: mimeFrom(file.name), dialogTitle: "Share image", UTI: "public.image" })
}
