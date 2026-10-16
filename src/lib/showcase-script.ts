// Pure, hardcoded data for the static "Showcase" session (app/showcase.tsx).
// Same isolation rules as demo-script.ts: no React Native imports, no store
// access, no network — unit-testable with node --test. The shapes match
// src/lib/sdk.ts's Message/Part exactly, so the screen renders through the
// SAME components a live session uses (TurnBubble, ToolCallCard, DiffView,
// PermissionPrompt, QuestionPrompt, SessionInfo) with zero demo branches.
import type { Message, Part } from "./sdk"

export const SHOWCASE_SESSION_ID = "showcase-session"

// Fixed clock: the whole script is anchored "now - 15m" so durations and
// elapsed times are stable across renders. Dates are relative, never absolute,
// so it never reads as a stale timestamp.
const START = 900_000
const END = 180_000

export interface ShowcasePermission {
  id: string
  permission: string
  patterns: string[]
}

export interface ShowcaseQuestion {
  id: string
  questions: Array<{
    question: string
    header: string
    options: Array<{ label: string; description: string }>
    multiple?: boolean
  }>
}

export interface ShowcaseScript {
  session: import("./sdk").Session
  messages: Message[]
  parts: Record<string, Part[]>
  permission: ShowcasePermission
  question: ShowcaseQuestion
}

// A pre-rendered screenshot stand-in: a real image so MessageBubble's gallery
// row (and the viewer) show something, with no server, asset, or file IO.
const GALLERY_URL =
  "data:image/svg+xml;base64," +
  "PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNDAiIGhlaWdodD0" +
  "iMTgwIj48cmVjdCB3aWR0aD0iMjQwIiBoZWlnaHQ9IjE4MCIgZmlsbD0iI2VkZTlmZSIvPjxyZWN0IHg" +
  "9IjE2IiB5PSIxNiIgd2lkdGg9IjIwOCIgaGVpZ2h0PSIzMiIgcng9IjYiIGZpbGw9IiM4YjVjZjYiLz4" +
  "8cmVjdCB4PSIxNiIgeT0iNjAiIHdpZHRoPSIyMDgiIGhlaWdodD0iMTIiIGZpbGw9IiNjNGI1ZmQiLz4" +
  "8cmVjdCB4PSIxNiIgeT0iODAiIHdpZHRoPSIxNzAiIGhlaWdodD0iMTIiIGZpbGw9IiNjNGI1ZmQiLz4" +
  "8cmVjdCB4PSIxNiIgeT0iMTA4IiB3aWR0aD0iOTYiIGhlaWdodD0iNTYiIGZpbGw9IiNmZmZmZmYiLz4" +
  "8L3N2Zz4="

const md = (text: string) => text

// The unified diff an edit part carries when a server sends one (see
// ParsedDiffView). Kept out of the part list so the showcase-script test can
// assert its shape without a template literal inside an object literal.

export function buildShowcaseScript(now: number = Date.now()): ShowcaseScript {
  const t = (offset: number) => now - (START - offset)

  const ids = {
    u1: "showcase-msg-u1",
    u2: "showcase-msg-u2",
    u3: "showcase-msg-u3",
    u4: "showcase-msg-u4",
    a1: "showcase-msg-a1",
    a2: "showcase-msg-a2",
    a3: "showcase-msg-a3",
    a4: "showcase-msg-a4",
  }

  const messages: Message[] = [
    { id: ids.u1, sessionID: SHOWCASE_SESSION_ID, role: "user", time: { created: t(0) }, model: { providerID: "anthropic", modelID: "claude-opus-4-6" } },
    { id: ids.a1, sessionID: SHOWCASE_SESSION_ID, role: "assistant", time: { created: t(15), completed: t(240) }, modelID: "claude-opus-4-6", providerID: "anthropic", tokens: { input: 15800, output: 720, reasoning: 210, cache: { read: 9400, write: 1200 } }, cost: 0.186, finish: "stop" },
    { id: ids.u2, sessionID: SHOWCASE_SESSION_ID, role: "user", time: { created: t(260) }, model: { providerID: "anthropic", modelID: "claude-opus-4-6" } },
    { id: ids.a2, sessionID: SHOWCASE_SESSION_ID, role: "assistant", time: { created: t(275), completed: t(560) }, modelID: "claude-opus-4-6", providerID: "anthropic", tokens: { input: 17100, output: 1180, reasoning: 380, cache: { read: 12600, write: 900 } }, cost: 0.221, finish: "stop" },
    { id: ids.u3, sessionID: SHOWCASE_SESSION_ID, role: "user", time: { created: t(590) }, model: { providerID: "anthropic", modelID: "claude-opus-4-6" } },
    { id: ids.a3, sessionID: SHOWCASE_SESSION_ID, role: "assistant", time: { created: t(605), completed: t(780) }, modelID: "claude-opus-4-6", providerID: "anthropic", tokens: { input: 19400, output: 960, reasoning: 260, cache: { read: 15200, write: 0 } }, cost: 0.219, finish: "stop" },
    { id: ids.u4, sessionID: SHOWCASE_SESSION_ID, role: "user", time: { created: t(800) }, model: { providerID: "anthropic", modelID: "claude-opus-4-6" } },
    { id: ids.a4, sessionID: SHOWCASE_SESSION_ID, role: "assistant", time: { created: t(815), completed: t(END) }, modelID: "claude-opus-4-6", providerID: "anthropic", tokens: { input: 20300, output: 640, reasoning: 150, cache: { read: 18100, write: 0 } }, cost: 0.209, finish: "stop" },
  ]

  const text = (id: string, messageID: string, offset: number, value: string): Part => ({
    id,
    sessionID: SHOWCASE_SESSION_ID,
    messageID,
    type: "text",
    text: value,
  })

  const reasoning = (id: string, messageID: string, start: number, end: number, value: string): Part => ({
    id,
    sessionID: SHOWCASE_SESSION_ID,
    messageID,
    type: "reasoning",
    text: value,
    time: { start: t(start), end: t(end) },
  })

  const tool = (
    id: string,
    messageID: string,
    name: string,
    start: number,
    end: number,
    state: Omit<NonNullable<Part["state"]>, "time">,
  ): Part => ({
    id,
    sessionID: SHOWCASE_SESSION_ID,
    messageID,
    type: "tool",
    tool: name,
    callID: id,
    state: { ...state, time: { start: t(start), end: t(end) } },
  })

  const parts: Record<string, Part[]> = {
    [ids.u1]: [
      text("showcase-part-u1-text", ids.u1, 0, "The login button doesn't respond on Android when the keyboard is open — can you fix it? I'm sure it worked last release."),
      { id: "showcase-part-u1-file", sessionID: SHOWCASE_SESSION_ID, messageID: ids.u1, type: "file", mime: "image/png", filename: "login-keyboard-bug.png", url: GALLERY_URL },
    ],
    [ids.a1]: [
      reasoning("showcase-part-a1-reasoning", ids.a1, 20, 28, "The tap handler isn't firing while the keyboard is up — classic Android behavior: the scroll view swallows the first tap to dismiss the keyboard instead of forwarding it. Let me read the component and confirm."),
      text("showcase-part-a1-note", ids.a1, 40, "Let me look at the login form and find where the taps go."),
      tool("showcase-part-a1-read", ids.a1, "read", 45, 52, {
        status: "completed",
        title: "src/components/auth/LoginButton.tsx",
        input: { filePath: "src/components/auth/LoginButton.tsx" },
        output: "1: import { Pressable, Text, View } from 'react-native';\n2: import { useState } from 'react';\n3: import { styles } from './styles';\n18: <ScrollView contentContainerStyle={styles.form}>\n19:   <Pressable onPress={handleLogin}>",
      }),
      tool("showcase-part-a1-grep", ids.a1, "grep", 55, 61, {
        status: "completed",
        title: "Search: keyboardShouldPersistTaps",
        input: { pattern: "keyboardShouldPersistTaps", path: "src/components/auth" },
        output: "src/components/auth/SignupForm.tsx:15: <ScrollView keyboardShouldPersistTaps=\"handled\">\nsrc/components/auth/LoginButton.tsx: (no match)",
      }),
      tool("showcase-part-a1-error", ids.a1, "read", 62, 66, {
        status: "error",
        title: "src/components/auth/LoginForm.styles.ts",
        input: { filePath: "src/components/auth/LoginForm.styles.ts" },
        error: { message: "File not found: src/components/auth/LoginForm.styles.ts" },
      }),
      text("showcase-part-a1-note2", ids.a1, 75, "Found the cause. `keyboardShouldPersistTaps` isn't set on the form's scroll view, so Android eats the first tap."),
      tool("showcase-part-a1-write", ids.a1, "write", 80, 90, {
        status: "completed",
        title: "src/utils/keyboard.ts",
        input: {
          filePath: "src/utils/keyboard.ts",
          content: md(`import { Platform } from 'react-native';

// Android consumes the first tap after the keyboard opens unless the
// enclosing scroll view opts out. Keep the behavior opt-in so iOS,
// which forwards taps, is unaffected.
export const keyboardPersistTaps = Platform.select({
  android: 'handled' as const,
  default: undefined,
});`),
        },
        output: "wrote 312 bytes to src/utils/keyboard.ts",
      }),
      tool("showcase-part-a1-bash", ids.a1, "bash", 95, 112, {
        status: "completed",
        title: "pnpm test auth/LoginButton",
        input: { command: "pnpm vitest run src/components/auth/LoginButton.test.tsx" },
        output: md(`RUN  v3.2.4 /home/dana/mobile

 ✓ src/components/auth/LoginButton.test.tsx (7 tests) 812ms

 Test Files  1 passed (1)
      Tests  7 passed (7)
   Duration  1.9s`),
      }),
    ],
    [ids.u2]: [
      text("showcase-part-u2-text", ids.u2, 260, "Now the whole auth flow has a leak — every sign-in re-reads the token from disk, and there's a 1900-line refactor on the branch that I want to review before I merge."),
    ],
    [ids.a2]: [
      reasoning("showcase-part-a2-reasoning", ids.a2, 280, 295, "Before touching the refactor, read it. 1900 lines is too big to review line-by-line — split it by concern, fan out two agents (token refresh, storage), then review the union of their findings myself."),
      text("showcase-part-a2-note", ids.a2, 300, "Big diff — I'll run two subagents over it and merge their findings."),
      tool("showcase-part-a2-task", ids.a2, "task", 305, 388, {
        status: "completed",
        title: "Review token refresh path",
        input: {
          description: "Review token refresh path",
          prompt: md(`Read the diff for src/auth/refresh.ts and src/auth/session.ts.
Find:
- double refresh (two timers, two writers)
- missing cancellation on logout
Return file:line citations only.`),
        },
        output: md(`### Findings (2)

1. **Double refresh** — \`refresh.ts:88\` schedules the same refresh from
   both the mount hook and the focus listener. No coalescing, so a
   focus event after mount fires two refreshes.

2. **No cancellation** — \`session.ts:213\` clears \`timer\` only on
   unmount. Logout leaves it running, and it re-persists the token
   after \`clear()\`.
`),
      }),
      tool("showcase-part-a2-todo", ids.a2, "todowrite", 392, 395, {
        status: "completed",
        title: "todos",
        input: {
          todos: [
            { id: "1", content: "Read the branch diff and split by concern", status: "completed" },
            { id: "2", content: "Review token refresh path (subagent)", status: "completed" },
            { id: "3", content: "Review storage layer (subagent)", status: "completed" },
            { id: "4", content: "Fix double refresh + logout race", status: "completed" },
            { id: "5", content: "Add regression test for the focus-listener race", status: "in_progress" },
            { id: "6", content: "Run full auth suite", status: "pending" },
          ],
        },
      }),
      tool("showcase-part-a2-webfetch", ids.a2, "webfetch", 396, 404, {
        status: "completed",
        title: "fetch: oauth.net token revocation",
        input: { url: "https://datatracker.ietf.org/doc/html/rfc7009#section-2.1" },
      }),
      text("showcase-part-a2-note2", ids.a2, 415, "Confirmed both issues. Fixing — the storage diff is a plain string swap, the refresh diff is the structural one:"),
      tool("showcase-part-a2-edit", ids.a2, "edit", 420, 432, {
        status: "completed",
        title: "Edit src/components/auth/LoginButton.tsx",
        input: {
          filePath: "src/components/auth/LoginButton.tsx",
          oldString: "    <View style={styles.container}>\n      <Pressable\n        onPress={handleLogin}\n        disabled={submitting || disabled}\n        style={s.button}\n      >",
          newString: "    <View style={styles.container}>\n      <Pressable\n        onPress={() => void handleLogin()}\n        disabled={submitting || disabled}\n        style={s.button}\n      >",
        },
      }),
  tool("showcase-part-a2-apply", ids.a2, "apply_patch", 434, 448, {
    status: "completed",
    title: "Apply patch: src/auth/keystore.ts",
    input: {
      patch: md(`--- a/src/auth/keystore.ts
+++ b/src/auth/keystore.ts
@@ -12,24 +12,28 @@ export class Keystore {
   private readonly cache = new Map<string, Token>()
 
   async get(key: string): Promise<Token | null> {
-    const hit = this.cache.get(key)
-    if (hit && hit.exp > Date.now()) return hit
-    return this.read(key)
-  }
-
-  async set(key: string, token: Token): Promise<void> {
-    await this.write(key, token)
-    this.cache.set(key, token)
-  }
+    const hit = await this.entry(key)
+    if (hit && hit.exp > Date.now()) return hit
+    const fallback = await this.fallback.read(key)
+    if (fallback) this.cache.set(key, fallback)
+    return fallback
+  }
+
+  async set(key: string, token: Token): Promise<void> {
+    await this.entry(key)
+    await this.fallback.write(key, token)
+    this.cache.set(key, token)
+  }
 
   async delete(key: string): Promise<void> {
     this.cache.delete(key)
     await this.fallback.delete(key)
   }
 
   // The OS keystore is the fast path; an encrypted file under the app's
-  // private dir is the fallback so sign-in never hard-fails on devices
-  // where the hardware keystore is wedged.
+  // private dir is the fallback so sign-in never hard-fails on devices
+  // where the hardware keystore is wedged. Both paths now share the same
+  // cache map, which the old set() bypassed.
 
   private async read(key: string): Promise<Token | null> {
     try {
@@ -38,9 +42,11 @@ export class Keystore {
       return this.fallback.read(key)
     }
   }
+
+  private async entry(key: string): Promise<Token | null> {
+    return this.cache.get(key) ?? null
+  }
 }
 
 export function createKeystore(fallback: Storage): Keystore {
   return new Keystore(fallback)
 }
`),
    },
  }),
      tool("showcase-part-a2-edit2", ids.a2, "edit", 450, 466, {
        status: "completed",
        title: "Edit src/auth/session.ts",
        input: {
          filePath: "src/auth/session.ts",
          diff: `--- a/src/auth/session.ts\n+++ b/src/auth/session.ts\n@@ -1,6 +1,62 @@\n export class Session {\n   constructor(private readonly storage: Storage) {}\n \n+  // Every token read/write now goes through one place, so the logout race\n+  // that shipped last release cannot come back.\n+  private timer: Timer | null = null\n+  private inflight: Promise<Token> | null = null\n+\n   start(): void {\n     this.state = 'active'\n+    this.arm()\n   }\n+\n+  async refresh(): Promise<Token> {\n+    if (this.inflight) return this.inflight\n+    this.inflight = this.fetch()\n+      .then((token) => {\n+        this.token = token\n+        this.expiresAt = token.exp\n+        this.arm()\n+        return token\n+      })\n+      .finally(() => {\n+        this.inflight = null\n+      })\n+    return this.inflight\n+  }\n+\n+  logout(): void {\n+    this.clear()\n+    this.state = 'logged-out'\n+    void this.storage.clear()\n+  }\n+\n+  private arm(): void {\n+    const skew = Math.min(this.skewMs, Math.max(1, this.expiresAt - Date.now()))\n+    this.timer = setTimeout(() => {\n+      if (this.state === 'active') void this.refresh()\n+    }, skew)\n+  }\n+\n+  private clear(): void {\n+    if (this.timer) {\n+      clearTimeout(this.timer)\n+      this.timer = null\n+    }\n+  }\n+\n+  private async fetch(): Promise<Token> {\n+    const stored = await this.storage.read()\n+    if (stored && stored.exp > Date.now()) return stored\n+    const issued = await this.provider.issue()\n+    await this.storage.write(issued)\n+    return issued\n+  }\n }\n \n export function createSession(app: App, storage: Storage) {\n   return new Session(app, storage)\n }`,
        },
      }),
      tool("showcase-part-a2-bash", ids.a2, "bash", 470, 505, {
        status: "completed",
        title: "pnpm test auth --coverage",
        input: { command: "pnpm vitest run src/auth --coverage" },
        output: md(` ✓ src/auth/refresh.test.ts (14 tests) 2.1s
 ✓ src/auth/session.test.ts (21 tests) 3.4s
 ✓ src/auth/keystore.test.ts (9 tests) 1.1s

 Test Files  3 passed (3)
      Tests  44 passed (44)
   Duration  7.2s
   Coverage: 91.2% (lines) / 87.5% (branches)`),
      }),
      text("showcase-part-a2-final", ids.a2, 540, md(`**Both issues are fixed and the auth suite is green.**

1. *Double refresh* — \`refresh.ts\` now coalesces concurrent callers onto one
   in-flight promise, so the mount hook and the focus listener can't fire two
   refreshes.
2. *Logout race* — \`session.logout()\` clears the timer *before* wiping storage,
   so no late refresh can re-persist a token.

I'd still add a regression test for the focus-listener race before you merge —
it's the only path the current tests don't cover.`),
      ),
    ],
    [ids.u3]: [
      text("showcase-part-u3-text", ids.u3, 590, "Wait — before that lands, which storage backend does the new keystore fall back to when the OS keystore is unavailable?"),
    ],
    [ids.a3]: [
      text("showcase-part-a3-answer", ids.a3, 610, "It falls back to encrypted file storage, and I'd rather keep that behavior explicit — which backend to ship is your call."),
    ],
    [ids.u4]: [
      text("showcase-part-u4-text", ids.u4, 800, "Alright, ship OS keystore + file fallback. Anything else the suite doesn't cover?"),
    ],
    [ids.a4]: [
      reasoning("showcase-part-a4-reasoning", ids.a4, 820, 830, "The fallback path is covered. The remaining gap is what the gallery shows: a run that ends with no diff at all. One screenshot settles it."),
      tool("showcase-part-a4-glob", ids.a4, "glob", 832, 836, {
        status: "completed",
        title: "glob src/auth/**/*.test.ts",
        input: { pattern: "src/auth/**/*.test.ts" },
        output: "src/auth/refresh.test.ts\nsrc/auth/session.test.ts\nsrc/auth/keystore.test.ts",
      }),
      {
        id: "showcase-part-a4-file",
        sessionID: SHOWCASE_SESSION_ID,
        messageID: ids.a4,
        type: "file",
        mime: "image/svg+xml",
        filename: "auth-flow.png",
        url: GALLERY_URL,
      },
      text("showcase-part-a4-final", ids.a4, 880, md(`That's the last of it — OS keystore with an encrypted-file fallback, and
\`keystore.test.ts\` covers the fallback path. The session above is the full
showcase: text, reasoning, code, errors, bash, read/write/edit/apply-patch
diffs, search, a subagent, todos, webfetch, gallery, permissions and questions.
All of it rendered by the same components your real sessions use.
`),
      ),
    ],
  }

  return {
    session: {
      id: SHOWCASE_SESSION_ID,
      title: "Auth flow — showcase",
      directory: "/home/dana/mobile",
      version: "1.15.12",
      slug: "auth-flow-showcase",
      projectID: "demo",
      time: { created: now - START, updated: now - (END - 12_000) },
    },
    messages,
    parts,
    permission: {
      id: "showcase-permission-1",
      permission: "bash",
      patterns: ["git push origin feat/auth-refresh"],
    },
    question: {
      id: "showcase-question-1",
      questions: [
        {
          question: "Which storage backend should the keystore fall back to?",
          header: "Fallback",
          options: [
            { label: "OS keystore only", description: "Fail the sign-in when the keystore is unavailable" },
            { label: "Encrypted file", description: "Write to app storage, encrypted with a device key" },
            { label: "Memory only", description: "Keep the token in memory; lose it when the app restarts" },
          ],
        },
      ],
    },
  }
}
