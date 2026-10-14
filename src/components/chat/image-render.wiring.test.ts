import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"
import { clearLog, getLogEntries } from "../../lib/logbuffer.ts"
import { imageError, imageLoad } from "../../lib/image-diagnostics.ts"

// Android blank-grey-box investigation: every chat image render site must pass
// the part URL straight to expo-image (source={{ uri }}), not a rewritten or
// truncated form, and must report load failures/loads as breadcrumbs so a phone
// session yields forensics. Guards against silent regressions.

function read(name: string): string {
  const dir = path.dirname(fileURLToPath(import.meta.url))
  return readFileSync(path.join(dir, name), "utf8")
}

const SITES = ["./MessageBubble.tsx", "./TurnBubble.tsx", "./ImageAttachments.tsx"]

test("every image site renders via expo-image with the part URL", () => {
  for (const file of SITES) {
    const src = read(file)
    assert.match(src, /from "expo-image"/, `${file} must render images with expo-image`)
    assert.doesNotMatch(src, /Image,|Image .*from "react-native"|Image \} from "react-native"/, `${file} must not import RN Image`)
    assert.match(src, /<Image[\s>][\s\S]{0,160}?source=\{\{ uri: /, `${file} must pass the part URL straight to expo-image`)
  }
})

test("every image site breadcrumbs load errors and successful loads", () => {
  for (const file of SITES) {
    const src = read(file)
    assert.match(src, /onError=\{\(e\) => imageError\(/, `${file} must breadcrumb onError`)
    assert.match(src, /onLoad=\{\(e\) => imageLoad\(/, `${file} must breadcrumb onLoad with width/height`)
    assert.match(src, /imageError\("(bubble|turn|composer)"/, `${file} must identify the render site`)
  }
})

test("imageError logs a breadcrumb with scheme and length but not the payload", () => {
  clearLog()
  const url = "data:image/png;base64," + "AA".repeat(500)
  imageError("bubble", url, "decode failed")
  const entries = getLogEntries()
  const crumb = entries.find((e) => e.tag === "image")
  assert.ok(crumb, "breadcrumb must land in the log buffer")
  assert.equal(crumb.level, "error")
  assert.match(crumb.message, /bubble: load error/)
  const data = JSON.parse(crumb.message.slice(crumb.message.indexOf("{")))
  assert.equal(data.scheme, url.slice(0, 30))
  assert.ok(data.scheme.startsWith("data:image/png;base64,"))
  assert.equal(data.length, url.length)
  assert.ok(!crumb.message.includes("A".repeat(16)), "must not log the base64 payload beyond the 30-char scheme")
})

test("imageLoad logs a breadcrumb with the decoded dimensions", () => {
  clearLog()
  imageLoad("turn", "file:///data/cache/x.jpg", 824, 1830)
  const crumb = getLogEntries().find((e) => e.tag === "image")
  assert.ok(crumb)
  assert.match(crumb.message, /turn: loaded/)
  const data = JSON.parse(crumb.message.slice(crumb.message.indexOf("{")))
  assert.equal(data.width, 824)
  assert.equal(data.height, 1830)
  assert.equal(data.scheme, "file:///data/cache/x.jpg")
})
