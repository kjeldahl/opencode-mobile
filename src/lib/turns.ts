// Groups a session's messages into chat rows: each user message is its own
// row, and every run of assistant messages between two user messages is one
// "turn". A turn keeps its answer text visible and collapses the work (tool
// calls, reasoning) behind summary lines; text the agent writes between tool
// calls stays in chat and splits the work into separate summaries. No React
// Native imports — unit-testable with node --test.
import type { Message, Part } from "./sdk"

export interface Entry {
  message: Message
  parts: Part[]
}

// A run of collapsed work followed by the text the agent wrote after it.
export interface Segment {
  id: string
  // Collapsed into the work pane, chronological.
  work: Part[]
  // Intermediate text, shown in chat.
  text: Part[]
}

export interface Turn {
  id: string
  messages: Message[]
  // Work and intermediate text before the answer, chronological.
  segments: Segment[]
  // Running/pending tools of the in-flight turn, shown in full.
  live: Part[]
  // Reasoning outside tool runs, behind the brain toggle.
  thinking: Part[]
  // Trailing answer text, shown in chat.
  final: Part[]
  // Image attachments, shown in chat.
  files: Part[]
  tokens: number
  cost: number
  modelID?: string
}

export type Row = { kind: "user"; id: string; entry: Entry } | { kind: "turn"; id: string; turn: Turn }

function isImage(part: Part): boolean {
  return part.type === "file" && !!part.mime && part.mime.startsWith("image/")
}

function visible(part: Part): boolean {
  if (part.type === "tool") return true
  if (part.type === "text" || part.type === "reasoning") return !!part.text && part.text.trim().length > 0
  return false
}

function pending(part: Part): boolean {
  const status = part.state?.status
  return part.type === "tool" && (status === "running" || status === "pending")
}

/** Splits work at intermediate text: each text run closes a segment. */
function split(parts: Part[]): Segment[] {
  const segments: Segment[] = []
  for (const part of parts) {
    const last = segments[segments.length - 1]
    const text = part.type === "text"
    if (last && (text || last.text.length === 0)) {
      if (text) last.text.push(part)
      if (!text) last.work.push(part)
      continue
    }
    segments.push({ id: part.id, work: text ? [] : [part], text: text ? [part] : [] })
  }
  return segments
}

/** Builds one turn from consecutive assistant entries. `busy` marks it in flight. */
// Tokens the group added. Every step's input re-sends the whole context (some
// providers don't split it into cache reads), so summing inputs re-counts it.
// Context growth first -> last step covers earlier outputs and tool results;
// the last step's own output/reasoning is added on top.
function context(m: Message): number {
  const t = m.tokens
  if (!t) return 0
  return t.input + (t.cache?.read || 0) + (t.cache?.write || 0)
}

export function newTokens(messages: Message[]): number {
  const list = messages.filter((m) => m.tokens && m.tokens.output > 0)
  const first = list[0]
  const last = list[list.length - 1]
  if (!first || !last?.tokens) return 0
  const own = last.tokens.output + (last.tokens.reasoning || 0)
  return Math.max(0, context(last) - context(first)) + own
}

export function buildTurn(entries: Entry[], busy: boolean): Turn {
  const all = entries.flatMap((e) => e.parts)
  const flow = all.filter(visible)

  // Trailing text/reasoning after the last tool is the answer.
  let cut = flow.length
  while (cut > 0 && flow[cut - 1].type !== "tool") cut--
  const head = flow.slice(0, cut)
  const tail = flow.slice(cut)

  // Segments without tool calls hold only reasoning: no summary line, their
  // reasoning joins the answer's behind the brain toggle.
  const segments = split(head)
  const tooled = (seg: Segment) => seg.work.some((p) => p.type === "tool")
  const loose = segments.filter((seg) => !tooled(seg)).flatMap((seg) => seg.work)

  const messages = entries.map((e) => e.message)
  const last = messages[messages.length - 1]
  return {
    id: messages[0].id,
    messages,
    segments: segments.map((seg) => ({ ...seg, work: tooled(seg) ? seg.work.filter((p) => !(busy && pending(p))) : [] })),
    live: busy ? head.filter(pending) : [],
    thinking: [...loose, ...tail.filter((p) => p.type === "reasoning")],
    final: tail.filter((p) => p.type === "text"),
    files: all.filter(isImage),
    tokens: newTokens(messages),
    cost: messages.reduce((n, m) => n + (m.cost || 0), 0),
    modelID: last.modelID,
  }
}

/**
 * Chronological entries -> chronological rows. Only the last turn can be
 * in flight, and only when the session is busy.
 */
export function buildRows(entries: Entry[], busy: boolean): Row[] {
  const rows: Row[] = []
  let run: Entry[] = []
  const flush = (live: boolean) => {
    if (run.length === 0) return
    const turn = buildTurn(run, live)
    rows.push({ kind: "turn", id: turn.id, turn })
    run = []
  }
  for (const entry of entries) {
    if (entry.message.role === "assistant") {
      run.push(entry)
      continue
    }
    flush(false)
    rows.push({ kind: "user", id: entry.message.id, entry })
  }
  flush(busy)
  return rows
}

function sameList<T>(a: T[], b: T[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

/**
 * Reference-equality check for memo comparators. The store replaces changed
 * parts/messages with new objects, so this catches every real change while
 * letting completed turns skip re-rendering during streaming.
 */
function sameSegments(a: Segment[], b: Segment[]): boolean {
  if (a.length !== b.length) return false
  return a.every((seg, i) => sameList(seg.work, b[i].work) && sameList(seg.text, b[i].text))
}

export function sameTurn(a: Turn, b: Turn): boolean {
  return (
    sameList(a.messages, b.messages) &&
    sameSegments(a.segments, b.segments) &&
    sameList(a.live, b.live) &&
    sameList(a.thinking, b.thinking) &&
    sameList(a.final, b.final) &&
    sameList(a.files, b.files)
  )
}

export type SummaryKey = "tools" | "edited" | "read" | "searched" | "ran" | "fetched" | "delegated" | "failed" | "steps"

export interface SummaryItem {
  key: SummaryKey
  count: number
}

function input(part: Part): Record<string, unknown> {
  const value = part.state?.input
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {}
}

function patchFiles(part: Part): string[] {
  const patch = input(part).patch
  if (typeof patch !== "string") return []
  return [...patch.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)].map((m) => m[1].trim())
}

const SEARCH = new Set(["glob", "grep", "list", "codesearch", "websearch"])

/**
 * Summary of collapsed work, e.g. [tools 3, edited 1, ran 2, failed 1].
 * Zero counts are dropped; "steps" stands in when there are no tool calls.
 */
export function summarize(work: Part[]): SummaryItem[] {
  const tools = work.filter((p) => p.type === "tool")
  if (tools.length === 0) return work.length > 0 ? [{ key: "steps", count: work.length }] : []

  const edited = new Set<string>()
  const read = new Set<string>()
  const counts = { searched: 0, ran: 0, fetched: 0, delegated: 0, failed: 0 }
  for (const tool of tools) {
    const name = tool.tool || ""
    const file = input(tool).filePath
    const key = typeof file === "string" ? file : tool.id
    if (tool.state?.status === "error") counts.failed++
    if (name === "edit" || name === "write") edited.add(key)
    if (name === "apply_patch") {
      const files = patchFiles(tool)
      if (files.length === 0) edited.add(tool.id)
      for (const f of files) edited.add(f)
    }
    if (name === "read") read.add(key)
    if (SEARCH.has(name)) counts.searched++
    if (name === "bash") counts.ran++
    if (name === "webfetch") counts.fetched++
    if (name === "task") counts.delegated++
  }

  const items: SummaryItem[] = [
    { key: "tools", count: tools.length },
    { key: "edited", count: edited.size },
    { key: "read", count: read.size },
    { key: "searched", count: counts.searched },
    { key: "ran", count: counts.ran },
    { key: "fetched", count: counts.fetched },
    { key: "delegated", count: counts.delegated },
    { key: "failed", count: counts.failed },
  ]
  return items.filter((i) => i.count > 0)
}
