// Tier 2 tool-card summaries (issue #30): partId -> short model-written title.
// Display-only: never sent back to the server/model (see persisted-keys.test.ts).
import { create } from "zustand"
import AsyncStorage from "@react-native-async-storage/async-storage"
import { buildMessages, compactInput, sanitize } from "../lib/summary-prompt"
import { createQueue } from "../lib/summary-queue"
import { complete, reportError, useModel } from "../lib/local-llm"

const SUMMARIES_KEY = "opencode_tool_summaries"
const MAX_ENTRIES = 500

const queue = createQueue()
const attempted = new Set<string>() // per-launch: a failed part is not retried in a loop

interface SummariesState {
  items: Record<string, string>
  load: () => Promise<void>
  request: (partId: string, tool: string, input: unknown) => void
}

let saveTimer: ReturnType<typeof setTimeout> | undefined

export const useSummaries = create<SummariesState>((set, get) => {
  const save = () => {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      void AsyncStorage.setItem(SUMMARIES_KEY, JSON.stringify(get().items)).catch(() => undefined)
    }, 1000)
  }

  return {
    items: {},

    load: async () => {
      const raw = await AsyncStorage.getItem(SUMMARIES_KEY).catch(() => null)
      if (!raw) return
      const parsed = JSON.parse(raw) as Record<string, string>
      set({ items: { ...parsed, ...get().items } })
    },

    request: (partId, tool, input) => {
      if (get().items[partId] || attempted.has(partId)) return
      const compact = compactInput(tool, input)
      if (!compact) return
      attempted.add(partId)
      queue.enqueue(partId, async () => {
        const raw = await complete(buildMessages(tool, compact)).catch((e: unknown) => {
          reportError(`inference failed: ${e instanceof Error ? e.message : String(e)}`)
          return undefined
        })
        const text = sanitize(raw)
        if (!text) {
          if (raw !== undefined) reportError(`unusable output: ${JSON.stringify(raw.slice(0, 80))}`)
          return
        }
        if (useModel.getState().lastError) useModel.setState({ lastError: undefined })
        const items = { ...get().items, [partId]: text }
        const keys = Object.keys(items)
        for (const key of keys.slice(0, Math.max(0, keys.length - MAX_ENTRIES))) delete items[key]
        set({ items })
        save()
      })
    },
  }
})
