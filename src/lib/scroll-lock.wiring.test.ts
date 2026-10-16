import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"

// GitHub issue #14 (part 2): nestedScrollEnabled alone lets Android route the
// horizontal drag to the child but the parent FlatList still scrolls alongside
// it, so wide content still "scrolls the chat". The fix locks the parent's
// scrollEnabled off while the child is dragged. This test guards the wiring so
// the fix can't silently regress (see src/stores/scroll-lock.ts).

function read(relativePath: string): string {
  const dir = path.dirname(fileURLToPath(import.meta.url))
  return readFileSync(path.join(dir, relativePath), "utf8")
}

test("inner horizontal ScrollViews lock the parent during touch", () => {
  for (const file of ["components/chat/DiffView.tsx", "components/markdown/CodeBlock.tsx"]) {
    const src = read(`../${file}`)
    assert.match(src, /onTouchStart=\{useScrollLock\.getState\(\)\.lock\}/, `${file} must lock on touch start`)
    assert.match(src, /onTouchEnd=\{useScrollLock\.getState\(\)\.unlock\}/, `${file} must unlock on touch end`)
    assert.match(src, /onTouchCancel=\{useScrollLock\.getState\(\)\.unlock\}/, `${file} must unlock on touch cancel`)
  }
})

test("the parent lists disable scrolling while locked", () => {
  const chat = read("../../app/session/[id].tsx")
  const work = read("../components/chat/WorkPane.tsx")
  assert.match(chat, /scrollEnabled=\{!scrollLocked\}/, "chat FlatList must honor the lock")
  assert.match(work, /scrollEnabled=\{!scrollLocked\}/, "WorkPane ScrollView must honor the lock")
})

test("ToolCallCard taps only the header, not the code/diff", () => {
  const card = read("../components/chat/ToolCallCard.tsx")
  // The card is a plain View (not one big TouchableOpacity), and the press is
  // bound to the header only — otherwise a drag meant to scroll code would
  // collapse the card and no inner scroll view could win the gesture.
  assert.match(card, /<View\s+style=\{\[\s*s\.card/, "card must be a View, not a touchable")
  assert.match(card, /<TouchableOpacity style=\{s\.header\} onPress=\{toggle\}/, "only the header toggles")
  assert.doesNotMatch(card, /<TouchableOpacity\s+style=\{\[\s*s\.card/, "the whole card must not be pressable")
})

test("ToolCallCard detail locks the parent while an overflowing detail is dragged (issue #38)", () => {
  const card = read("../components/chat/ToolCallCard.tsx")
  assert.match(card, /onTouchStart=\{overflows \? useScrollLock\.getState\(\)\.lock : undefined\}/)
  assert.match(card, /onTouchEnd=\{useScrollLock\.getState\(\)\.unlock\}/)
  assert.match(card, /onTouchCancel=\{useScrollLock\.getState\(\)\.unlock\}/)
})

test("subagent card shows the full prompt and the response (issue #38)", () => {
  const card = read("../components/chat/ToolCallCard.tsx")
  const task = card.slice(card.indexOf("function TaskDetail"), card.indexOf("function TodoDetail"))
  assert.doesNotMatch(task, /numberOfLines/, "prompt must not be truncated")
  assert.match(task, /taskResult\(output\)/, "response must be rendered")
  assert.match(card, /<TaskDetail input=\{input\} output=\{output\}/)
})
