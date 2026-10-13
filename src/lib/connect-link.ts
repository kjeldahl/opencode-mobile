// Workspace links from the forge hub:
//   opencode://connect?url=<base url>&name=<ws>&user=opencode&dir=<repo dir>[&session=<id>]
// Chrome opens the intent:// form reliably (and only in this app, via package=):
//   intent://connect?url=...#Intent;scheme=opencode;package=it.kjeldahl.opencode;end
// Android hands the app the opencode:// form either way; the intent form is
// accepted here too so a pasted or forwarded link still works. The password is
// never part of a link.

export interface ConnectLink {
  url: string
  name?: string
  user?: string
  dir?: string
  session?: string
}

export const APP_PACKAGE = "it.kjeldahl.opencode"

type Params = Record<string, string | string[] | undefined>

function first(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value
  const trimmed = raw?.trim()
  return trimmed ? trimmed : undefined
}

// Base URL normalised for comparison and storage: lower-case scheme and host,
// no trailing slash, no query or fragment. Null for anything but http(s).
export function normalizeServerUrl(raw: string | undefined): string | null {
  const match = raw?.trim().match(/^(https?):\/\/([^/?#]+)([^?#]*)/i)
  if (!match) return null
  const path = match[3].replace(/\/+$/, "")
  return `${match[1].toLowerCase()}://${match[2].toLowerCase()}${path}`
}

// From expo-router search params (the /connect route).
export function connectLinkFromParams(params: Params): ConnectLink | null {
  const url = normalizeServerUrl(first(params.url))
  if (!url) return null
  return {
    url,
    name: first(params.name),
    user: first(params.user),
    dir: first(params.dir)?.replace(/\/+$/, "") || undefined,
    session: first(params.session),
  }
}

// From a raw link string (opencode:// or intent://).
export function parseConnectLink(link: string): ConnectLink | null {
  const match = link.trim().match(/^(opencode|intent):\/\/connect\/?\?([^#]*)(#.*)?$/i)
  if (!match) return null
  if (match[1].toLowerCase() === "intent" && !/;scheme=opencode;/i.test(match[3] ?? "")) return null
  const params: Params = {}
  for (const [key, value] of new URLSearchParams(match[2])) {
    if (params[key] === undefined) params[key] = value
  }
  return connectLinkFromParams(params)
}

export function findConnection<T extends { url: string }>(connections: T[], url: string): T | undefined {
  return connections.find((connection) => normalizeServerUrl(connection.url) === url)
}
