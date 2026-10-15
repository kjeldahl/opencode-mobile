// Native-only media action for the chat image viewer: share/save through the
// platform sheet (its "Save to device"/Photos/Files entries cover saving).
// Failures are thrown with a readable message — the caller shows an alert, so
// the button never spins silently.

import { Platform } from "react-native"
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
  // The timestamp keeps repeated downloads distinct — the cache file of a
  // previous share makes downloadFileAsync throw "destination exists".
  const file = new File(Paths.cache, `media-viewer-${Date.now()}-${filenameFrom(url)}`)
  try {
    await File.downloadFileAsync(url, file, headers ? { headers } : undefined)
  } catch (error) {
    throw new Error(`Could not download the image: ${error instanceof Error ? error.message : String(error)}`, {
      cause: error,
    })
  }
  return file
}

function mimeFrom(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? ""
  return (
    { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", avif: "image/avif", bmp: "image/bmp" } as Record<string, string>
  )[ext] ?? "image/png"
}

export async function shareImage(url: string, headers?: Record<string, string>): Promise<void> {
  const file = await downloadToCache(url, headers)
  const available = await Sharing.isAvailableAsync()
  if (!available) throw new Error("Sharing is not available on this device")
  await Sharing.shareAsync(file.uri, { mimeType: mimeFrom(file.name), dialogTitle: "Share image", UTI: "public.image" })
}
