import { useEffect, useMemo, useRef } from "react"
import { create } from "zustand"
import { useConnections } from "./connections"
import { useEvents } from "./events"
import type { FileDiff, VcsInfo, VcsMode } from "../lib/sdk"
import { branchOffered, headline, type ChangeTotals } from "../lib/changes"

// Diffs for the Changes view and the change counts in the session list and
// chat header. Branch/uncommitted diffs are per directory (every chat in a
// repo shares them); "this turn" is per session. Every request carries the
// chat's own directory: without one the server answers for its default folder.

export interface ChangeEntry {
  diffs?: FileDiff[]
  error?: string
  loading: boolean
  at: number
}

const STALE_MS = 60_000

interface ChangesState {
  entries: Record<string, ChangeEntry>
  // /vcs per directory (branch, default_branch); null when it failed.
  info: Record<string, VcsInfo | null>
  loadInfo: (directory: string) => Promise<VcsInfo | null>
  loadVcs: (directory: string, mode: VcsMode, force?: boolean) => Promise<void>
  loadTurn: (sessionID: string, directory: string, messageID: string | undefined, force?: boolean) => Promise<void>
  // /vcs, then uncommitted (and branch, when off the default branch) diffs
  // for each directory, skipping fresh entries.
  prefetch: (directories: string[], force?: boolean) => Promise<void>
}

function base(): string {
  return useConnections.getState().clientBase?.baseUrl ?? ""
}

export function vcsKey(directory: string, mode: VcsMode): string {
  return `${base()}|${mode}|${directory}`
}

export function infoKey(directory: string): string {
  return `${base()}|${directory}`
}

export function turnKey(sessionID: string): string {
  return `${base()}|turn|${sessionID}`
}

export const useChanges = create<ChangesState>((set, get) => {
  const load = async (key: string, force: boolean | undefined, fetch: () => Promise<FileDiff[]> | null) => {
    const current = get().entries[key]
    if (current?.loading) return
    if (!force && current && !current.error && Date.now() - current.at < STALE_MS) return
    const request = fetch()
    if (!request) return
    set((state) => ({ entries: { ...state.entries, [key]: { ...current, loading: true, at: current?.at ?? 0 } } }))
    const result = await request.then(
      (diffs) => ({ diffs: Array.isArray(diffs) ? diffs : [], error: undefined }),
      (err: unknown) => ({ diffs: current?.diffs, error: err instanceof Error ? err.message : String(err) }),
    )
    set((state) => ({ entries: { ...state.entries, [key]: { ...result, loading: false, at: Date.now() } } }))
  }

  return {
    entries: {},
    info: {},

    loadInfo: async (directory) => {
      const client = useConnections.getState().clientForDirectory(directory)
      if (!client) return null
      const info = await client.vcs.get().catch(() => null)
      set((state) => ({ info: { ...state.info, [infoKey(directory)]: info } }))
      return info
    },

    loadVcs: (directory, mode, force) =>
      load(vcsKey(directory, mode), force, () => {
        const client = useConnections.getState().clientForDirectory(directory)
        return client ? client.vcs.diff(mode) : null
      }),

    loadTurn: (sessionID, directory, messageID, force) =>
      load(turnKey(sessionID), force, () => {
        const client = useConnections.getState().clientForDirectory(directory)
        return client ? client.session.diff(sessionID, messageID) : null
      }),

    prefetch: async (directories, force) => {
      const unique = [...new Set(directories.filter(Boolean))]
      await Promise.all(
        unique.map(async (directory) => {
          const info = await get().loadInfo(directory)
          await Promise.all([
            get().loadVcs(directory, "git", force),
            branchOffered(info) ? get().loadVcs(directory, "branch", force) : undefined,
          ])
        }),
      )
    },
  }
})

export function useHeadline(directory: string | undefined): ChangeTotals | null {
  const info = useChanges((state) => (directory ? state.info[infoKey(directory)] : undefined))
  const branch = useChanges((state) => (directory ? state.entries[vcsKey(directory, "branch")]?.diffs : undefined))
  const git = useChanges((state) => (directory ? state.entries[vcsKey(directory, "git")]?.diffs : undefined))
  return useMemo(() => (branch || git ? headline(info, branch, git) : null), [info, branch, git])
}

// Calls `run` when the session finishes a turn (busy/retry -> idle).
export function useOnTurnEnd(sessionID: string | undefined, run: () => void) {
  const status = useEvents((state) => (sessionID ? state.sessionStatus[sessionID]?.type : undefined))
  const previous = useRef(status)
  const latest = useRef(run)
  latest.current = run
  useEffect(() => {
    const before = previous.current
    previous.current = status
    if (status === "idle" && before !== undefined && before !== "idle") latest.current()
  }, [status])
}
