// Media URL resolution + auth scoping for images embedded in Markdown.
//
// The forge front-end serves agent pictures at GET /__forge/file?path=... on
// the same base URL and Basic auth as the opencode API, and agents reference
// them with a RELATIVE url (`/__forge/file?path=...`) in their replies. The
// app must resolve that against the active connection's baseUrl and send the
// Authorization header the SDK already uses — but only to that same origin,
// never to an unrelated https:// host that happens to appear in the Markdown.

import { buildRequestHeaders } from "./headers.ts"

export interface MediaAuth {
  username: string
  password: string
}

// Non-resolvable schemes that must survive resolution untouched.
const OPAQUE_SCHEMES = ["data:", "file:", "blob:", "content:", "asset:", "ph://", "zip://"]

export function mediaUrl(url: string, baseUrl?: string): string {
  url = splitCrop(url).url
  if (!baseUrl || !url) return url
  if (OPAQUE_SCHEMES.some((s) => url.startsWith(s))) return url
  try {
    return new URL(url, baseUrl.replace(/\/+$/, "")).toString()
  } catch {
    return url
  }
}

// Agents pick the interesting part of a tall screenshot with a crop fragment:
//   ![log](/__forge/file?path=/tmp/log.png#crop=x,y,w,h)
// All four values are fractions of the image (0..1): the region's top-left
// corner (x, y) and size (w, h). Anything malformed is ignored, the fragment
// is always stripped so it never reaches the server.
export interface Crop {
  x: number
  y: number
  w: number
  h: number
}

const CROP_RE = /#crop=([^#]+)$/

function parseCrop(fragment: string): Crop | undefined {
  const nums = fragment.split(",").map((n) => Number(n))
  if (nums.length !== 4 || nums.some((n) => !Number.isFinite(n))) return undefined
  const [x, y, w, h] = nums
  if (!(w > 0 && h <= 1 && w <= 1 && h > 0 && x >= 0 && y >= 0 && x + w <= 1.0001 && y + h <= 1.0001)) {
    return undefined
  }
  return { x: Math.min(x, 1), y: Math.min(y, 1), w, h }
}

export function splitCrop(url: string): { url: string; crop?: Crop } {
  if (OPAQUE_SCHEMES.some((s) => url.startsWith(s))) return { url }
  const hash = url.indexOf("#")
  const bare = hash === -1 ? url : url.slice(0, hash)
  const fragment = hash === -1 ? "" : url.slice(hash)
  const m = CROP_RE.exec(fragment)
  if (!m) return { url: bare }
  const crop = parseCrop(m[1])
  return crop ? { url: bare, crop } : { url: bare }
}

// Only the Authorization header — an image GET needs no Content-Type.
// Returns undefined when the URL is not on our connection's origin, so the
// forge password can never leak to a third-party host.
export function mediaHeaders(
  url: string,
  baseUrl: string | undefined,
  auth?: MediaAuth | null,
): Record<string, string> | undefined {
  if (!auth || !baseUrl) return undefined
  try {
    const isOurs = new URL(url).origin === new URL(baseUrl).origin
    if (!isOurs) return undefined
  } catch {
    return undefined
  }
  const { Authorization } = buildRequestHeaders({ auth })
  return Authorization ? { Authorization } : undefined
}
