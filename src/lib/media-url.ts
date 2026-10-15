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
  if (!baseUrl || !url) return url
  if (OPAQUE_SCHEMES.some((s) => url.startsWith(s))) return url
  try {
    return new URL(url, baseUrl.replace(/\/+$/, "")).toString()
  } catch {
    return url
  }
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
