// Decides what the connection banner should say. Two very different things
// used to look identical — "the network dropped and we're retrying" and "the
// workspace is starting up" — so the same "Reconnecting… (attempt 3)" text was
// shown while forge was simply booting the sandbox (issue #10).
//
// Pure module: no store imports, testable under plain `node --test`.

import type { ForgeState } from "./forge.ts"

export type BannerKind = "none" | "waking" | "stopped" | "retrying"

export interface Banner {
  kind: BannerKind
  seconds?: number
  attempt?: number
}

const NONE: Banner = { kind: "none" }

/** `workspace` is what forge reported last (or null when nothing is wrong) and
 *  `reconnectAttempts` is the retry count the events store keeps. A workspace
 *  state always wins: a dropped stream is a symptom of it, and "attempt 3"
 *  would be the wrong thing to say.
 *
 *  Retrying is keyed on the attempt count, not on `connected` — the flag is
 *  false from the moment the app starts until the stream first lands, and
 *  "Reconnecting…" at launch is a lie about something that never worked. */
export function connectionBanner(
  workspace: { state: ForgeState; wakeSeconds?: number } | null,
  reconnectAttempts: number,
): Banner {
  if (workspace) {
    return workspace.state === "off"
      ? { kind: "stopped" }
      : { kind: "waking", seconds: Math.max(1, Math.round(workspace.wakeSeconds ?? 15)) }
  }
  if (reconnectAttempts > 0) return { kind: "retrying", attempt: reconnectAttempts }
  return NONE
}
