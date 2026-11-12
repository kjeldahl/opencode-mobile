// Pure URL parsing + connection-failure classification, extracted from diagnostics.ts
// so this decision logic (which produces the user-facing "why did connecting fail"
// guidance) is unit-testable without react-native / expo-clipboard / expo-device.

export type Classification =
  | "ok"
  | "malformed-url"
  | "no-internet"
  | "server-unreachable"
  | "auth-required"
  | "auth-failed"
  | "health-failed"
  | "tls-error"
  | "timeout"
  | "unknown"

export interface ProbeAttempt {
  name: string
  target: string
  ok: boolean
  status?: number
  durationMs: number
  error?: string
  errorCause?: string
  authProvided?: boolean
  // Content type of a 2xx/4xx HTTP answer, when the probe read it. This is the
  // only reliable way to tell an API response from the web-app HTML a 1.x or
  // 2.x server serves for paths it does not implement.
  contentType?: string
  // The `version` field, for a JSON /api/info answer.
  version?: string
}

export interface ParsedUrl {
  valid: boolean
  scheme?: string
  host?: string
  port?: string
  isHostname: boolean
}

// Hermes' built-in URL is incomplete (hostname/port often unreliable), so parse
// with a regex instead of `new URL`.
export function parseUrl(url: string): ParsedUrl {
  const m = url.trim().match(/^(https?):\/\/([^/:?#]+)(?::(\d+))?/i)
  if (!m) return { valid: false, isHostname: false }
  const scheme = m[1].toLowerCase()
  const host = m[2]
  const port = m[3] || (scheme === "https" ? "443" : "80")
  const isHostname = !/^\d{1,3}(\.\d{1,3}){3}$/.test(host)
  return { valid: true, scheme, host, port, isHostname }
}

export function classify(
  parsed: ParsedUrl,
  health: ProbeAttempt,
  internet: ProbeAttempt,
  root: ProbeAttempt,
  meta: { major?: "v1" | "v2"; healthPath?: string } = {},
): { classification: Classification; summary: string } {
  const healthPath = meta.healthPath ?? "/global/health"
  if (!parsed.valid) {
    return { classification: "malformed-url", summary: "The server URL could not be parsed. Check for typos or extra characters." }
  }
  // A 200 that carries the web app instead of JSON is not a working API. Both
  // majors serve their UI for any path they do not implement (verified on
  // 1.18.32 and 2.0.29: `/global/health` answers 200 + HTML on a 2.x server),
  // so "200 OK" on its own used to report a server that was never answering
  // API calls as healthy. This is checked before the `ok` short-circuit so no
  // caller can pass an HTML answer and have it read as success.
  const answersHtml = health.contentType !== undefined && !health.contentType.includes("application/json") && (health.status ?? 0) < 400
  if (answersHtml) {
    return {
      classification: "health-failed",
      summary:
        `The server answered ${healthPath} with ${health.contentType} instead of JSON, so no opencode API is listening at ` +
        `${parsed.host}:${parsed.port}. That HTML is a web app or a proxy page, not an API response: check the port (opencode ` +
        "listens on 4096 by default), the path, or whether something else answers on that port.",
    }
  }
  if (health.ok) {
    return { classification: "ok", summary: "Health endpoint responded — connection actually works now." }
  }

  // 401/403 means the server is up, reachable, and talking to us — it just
  // rejected our credentials. That needs the opposite instruction from every
  // other failure below (fix the password, not the network), so it gets its
  // own classification rather than being folded into the generic
  // "health-failed / likely wrong path, auth, or an old server version".
  //
  // This is the tail of AGE-107: one device produced 498 `API Error: 401`
  // events over two months because v0.4.4's probe counted any HTTP response
  // as ok:true and told the user "connection actually works now" while the
  // password was wrong. `requireOk` (v0.4.8) stopped the lie; this makes the
  // remaining message actionable so the user stops retrying blind.
  // 401/403 with no credentials sent is a different problem from rejected
  // credentials: the probe never authenticated, so the server's answer says
  // nothing about the saved password. This happens when the user runs the
  // diagnostic before typing the password (Quick Connect, empty field) —
  // telling them "the server rejected your credentials" sends them
  // re-typing a password that may be perfectly fine.
  if ((health.status === 401 || health.status === 403) && !health.authProvided) {
    return {
      classification: "auth-required",
      summary:
        `The server is running and requires authentication (HTTP ${health.status}), ` +
        `but this probe sent no credentials. Enter the server password — and the username too, ` +
        `if the server sets OPENCODE_SERVER_USERNAME (it defaults to "opencode") — then retry.`,
    }
  }
  if (health.status === 401 || health.status === 403) {
    return {
      classification: "auth-failed",
      summary:
        `The server rejected your credentials (HTTP ${health.status}). ` +
        `Check the password, and the username if you set OPENCODE_SERVER_USERNAME on the server ` +
        `(it defaults to "opencode"). The server itself is running and reachable.`,
    }
  }

  const txt = `${health.error ?? ""} ${health.errorCause ?? ""}`.toLowerCase()
  const isTls = /ssl|tls|certificate|trust|handshake/.test(txt)
  const isTimeout = /timeout|timed out/.test(txt)

  if (isTls) {
    return { classification: "tls-error", summary: "TLS/certificate problem. Try http:// instead of https://, or fix the server certificate." }
  }
  // The user's own server responded to *something* (even a 401/403/404) —
  // that proves the path to the server works, so a failed public-internet
  // probe (captive portal, no WAN but Tailscale LAN still up, etc.) must not
  // override it and misreport a reachable server as "no internet".
  if (root.ok) {
    return {
      classification: "health-failed",
      summary: `Server is reachable but ${healthPath} failed (HTTP ${health.status ?? "error"}). Likely a wrong path or an old server version.`,
    }
  }
  if (!internet.ok) {
    return { classification: "no-internet", summary: "The device has no working internet/network at all (public check also failed). Check Wi-Fi/data and Tailscale (VPN) status." }
  }
  // Internet works, server does not.
  if (isTimeout) {
    return { classification: "timeout", summary: "Connection to the server timed out (dropped, not refused). Likely a firewall, wrong port, or Tailscale ACL blocking the device." }
  }
  return {
    classification: "server-unreachable",
    summary:
      `Internet works, but the server at ${parsed.host}:${parsed.port} is unreachable. ` +
      (parsed.isHostname
        ? "Hostname may not resolve from this device (MagicDNS off?). Try the raw Tailscale IP. "
        : "") +
      "Confirm the opencode server is running, the device is on the same tailnet, and the port is correct.",
  }
}
