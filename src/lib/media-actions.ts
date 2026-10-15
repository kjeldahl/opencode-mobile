// Native-only media actions for the chat image viewer: copy, save to the
// device photo library, and share through the platform sheet. Every failure
// is thrown with a readable message — the caller turns it into an alert, so
// a button never spins silently.

import { Platform } from "react-native"
import * as Clipboard from "expo-clipboard"
import * as MediaLibrary from "expo-media-library"
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

export async function copyImage(url: string, headers?: Record<string, string>): Promise<void> {
  const file = await downloadToCache(url, headers)
  await Clipboard.setImageAsync(await file.base64())
}

// Saves into the device gallery. The first attempt rides the photos access
// MediaLibrary already has; if that fails, ask for read/write and retry once.
export async function saveImage(url: string, headers?: Record<string, string>): Promise<void> {
  const file = await downloadToCache(url, headers)
  try {
    await MediaLibrary.saveToLibraryAsync(file.uri)
    return
  } catch {
    // fall through to the permission request below
  }
  const permission = await MediaLibrary.requestPermissionsAsync(true)
  if (!permission.granted) throw new Error("Photo library permission was denied")
  await MediaLibrary.saveToLibraryAsync(file.uri)
}

export async function shareImage(url: string, headers?: Record<string, string>): Promise<void> {
  const file = await downloadToCache(url, headers)
  const available = await Sharing.isAvailableAsync()
  if (!available) throw new Error("Sharing is not available on this device")
  await Sharing.shareAsync(file.uri, { mimeType: mimeFrom(file.name), dialogTitle: "Share image", UTI: "public.image" })
}
