import { create } from "zustand"
import { useConnections } from "./connections"
import { isWorkspaceWakingError } from "../lib/forge"
import type { ForgePr } from "../lib/forge-pr"

// PR state per directory from GET /__forge/pr (issue #15). `result` stays
// unset until the server first answers, so the button falls back to the
// transcript meanwhile; `{ supported: false }` (404) keeps that fallback for
// good on a plain opencode server.

export interface PrEntry {
  result?: ForgePr
  error?: string
  loading: boolean
  // An explicit refresh from the PR menu: the button shows "Checking…".
  refreshing: boolean
}

interface PrStoreState {
  entries: Record<string, PrEntry>
  load: (directory: string, options?: { refresh?: boolean; manual?: boolean }) => Promise<void>
}

export function prKey(directory: string): string {
  return `${useConnections.getState().clientBase?.baseUrl ?? ""}|${directory}`
}

export const usePrStore = create<PrStoreState>((set, get) => ({
  entries: {},

  load: async (directory, options = {}) => {
    const key = prKey(directory)
    const current = get().entries[key]
    // A cache-bypassing refresh (turn end, menu) still goes out while a plain
    // query is in flight: it may be the one that sees the new PR.
    if (current?.loading && !options.refresh) return
    // A server without the endpoint never grows one mid-connection.
    if (current?.result?.supported === false) return
    const client = useConnections.getState().clientForDirectory(directory)
    if (!client) return
    const update = (entry: Partial<PrEntry>) =>
      set((state) => {
        const before: PrEntry = state.entries[key] ?? { loading: false, refreshing: false }
        return { entries: { ...state.entries, [key]: { ...before, ...entry } } }
      })
    update({ loading: true, refreshing: !!options.manual })
    const next = await client.forge.pr(directory, options.refresh).then(
      (result): Partial<PrEntry> => ({ result, error: undefined }),
      (err: unknown): Partial<PrEntry> => {
        // Asleep: keep what we had. The endpoint does not wake the workspace,
        // and the connection banner already says what is going on (#12).
        if (isWorkspaceWakingError(err)) return {}
        return { error: err instanceof Error ? err.message : String(err) }
      },
    )
    update({ ...next, loading: false, refreshing: false })
  },
}))
