// On-device model for tool card summaries (issue #30 tier 2). Android only.
// Qwen2.5-0.5B-Instruct Q4_K_M via llama.rn, downloaded on demand into the app
// document directory. The context is lazy and released after IDLE_MS so the
// ~0.5 GB of weights don't stay resident.
import { Platform } from "react-native"
import * as FileSystem from "expo-file-system/legacy"
import { create } from "zustand"
import type { LlamaContext } from "llama.rn"

export const MODEL_URL =
  "https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf"
// Sanity floor for a complete download (real file is ~490 MB).
const MIN_BYTES = 400_000_000
const IDLE_MS = 60_000

export const localLlmSupported = Platform.OS === "android"

const dir = () => `${FileSystem.documentDirectory}models/`
const path = () => `${dir()}qwen2.5-0.5b-instruct-q4_k_m.gguf`

export type ModelStatus = "none" | "downloading" | "ready" | "error"

interface ModelState {
  status: ModelStatus
  progress: number
  error?: string
  // Last summarize failure (load/inference/unusable output); shown in Settings for debugging.
  lastError?: string
  refresh: () => Promise<void>
  download: () => Promise<void>
  remove: () => Promise<void>
}

let task: FileSystem.DownloadResumable | undefined

export const useModel = create<ModelState>((set, get) => ({
  status: "none",
  progress: 0,

  refresh: async () => {
    if (!localLlmSupported || get().status === "downloading") return
    const info = await FileSystem.getInfoAsync(path())
    const ready = info.exists && info.size >= MIN_BYTES
    set({ status: ready ? "ready" : "none", progress: ready ? 1 : 0 })
  },

  download: async () => {
    if (!localLlmSupported || get().status === "downloading" || get().status === "ready") return
    set({ status: "downloading", progress: 0, error: undefined })
    await FileSystem.makeDirectoryAsync(dir(), { intermediates: true }).catch(() => undefined)
    // Download to a temp name, rename on success: a partial file never looks "ready".
    const tmp = `${path()}.part`
    task = FileSystem.createDownloadResumable(MODEL_URL, tmp, {}, (p) => {
      if (p.totalBytesExpectedToWrite > 0) set({ progress: p.totalBytesWritten / p.totalBytesExpectedToWrite })
    })
    const result = await task.downloadAsync().catch((e: unknown) => e)
    task = undefined
    if (!result || result instanceof Error) {
      set({ status: "error", error: result instanceof Error ? result.message : "Download failed" })
      return
    }
    const info = await FileSystem.getInfoAsync(tmp)
    if (!info.exists || info.size < MIN_BYTES) {
      await FileSystem.deleteAsync(tmp, { idempotent: true })
      set({ status: "error", error: "Download incomplete" })
      return
    }
    await FileSystem.moveAsync({ from: tmp, to: path() })
    set({ status: "ready", progress: 1 })
  },

  remove: async () => {
    await task?.pauseAsync().catch(() => undefined)
    task = undefined
    await release()
    await FileSystem.deleteAsync(path(), { idempotent: true })
    await FileSystem.deleteAsync(`${path()}.part`, { idempotent: true })
    set({ status: "none", progress: 0, error: undefined })
  },
}))

let ctx: LlamaContext | undefined
let loading: Promise<LlamaContext> | undefined
let idle: ReturnType<typeof setTimeout> | undefined

async function release() {
  clearTimeout(idle)
  const current = ctx
  ctx = undefined
  loading = undefined
  await current?.release().catch(() => undefined)
}

async function context(): Promise<LlamaContext> {
  if (ctx) return ctx
  loading ??= (async () => {
    // Lazy require: keeps the native module off web / non-Android bundles at runtime.
    const { initLlama } = require("llama.rn") as typeof import("llama.rn")
    const next = await initLlama({
      model: path().replace(/^file:\/\//, ""),
      n_ctx: 512,
      n_gpu_layers: 0,
      n_threads: 4,
      use_mlock: false,
    })
    ctx = next
    return next
  })()
  return loading.catch((e) => {
    loading = undefined
    throw e
  })
}

export function reportError(message: string) {
  console.warn(`[ai-summaries] ${message}`)
  useModel.setState({ lastError: message })
}

export async function complete(messages: { role: string; content: string }[]): Promise<string | undefined> {
  if (!localLlmSupported || useModel.getState().status !== "ready") return undefined
  const llama = await context()
  clearTimeout(idle)
  const out = await llama.completion({
    messages,
    n_predict: 24,
    temperature: 0,
    stop: ["<|im_end|>", "\n"],
  })
  idle = setTimeout(() => void release(), IDLE_MS)
  return out.text
}
