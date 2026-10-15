import { test } from "node:test"
import assert from "node:assert/strict"
import { mediaHeaders, mediaUrl } from "./media-url.ts"

const BASE = "http://100.108.64.76:4096"
const AUTH = { username: "opencode", password: "sekret" }

test("relative /__forge/file url resolves against the connection baseUrl", () => {
  const url = mediaUrl("/__forge/file?path=/home/agent/forge-media/settings.png", BASE)
  assert.equal(url, "http://100.108.64.76:4096/__forge/file?path=/home/agent/forge-media/settings.png")
})

test("absolute urls stay untouched", () => {
  assert.equal(mediaUrl("https://cdn.example.com/a.png", BASE), "https://cdn.example.com/a.png")
})

test("trailing slash on baseUrl does not produce a double slash", () => {
  const url = mediaUrl("/__forge/file?path=x.png", `${BASE}/`)
  assert.equal(url, "http://100.108.64.76:4096/__forge/file?path=x.png")
})

test("opaque schemes (data:) are never resolved", () => {
  const uri = "data:image/png;base64,AAAA"
  assert.equal(mediaUrl(uri, BASE), uri)
})

test("without a baseUrl the url passes through unchanged", () => {
  assert.equal(mediaUrl("/__forge/file?path=x.png", undefined), "/__forge/file?path=x.png")
})

test("auth header is added for our own origin", () => {
  const url = mediaUrl("/__forge/file?path=x.png", BASE)
  assert.deepEqual(mediaHeaders(url, BASE, AUTH), {
    Authorization: `Basic ${Buffer.from("opencode:sekret").toString("base64")}`,
  })
})

test("auth header is added for an absolute url on the same origin", () => {
  assert.deepEqual(mediaHeaders("http://100.108.64.76:4096/__forge/file?path=x.png", BASE, AUTH), {
    Authorization: `Basic ${Buffer.from("opencode:sekret").toString("base64")}`,
  })
})

test("no auth header for a foreign https host", () => {
  assert.equal(mediaHeaders("https://evil.example.com/a.png", BASE, AUTH), undefined)
})

test("no auth header for the same host on a different port (different origin)", () => {
  assert.equal(mediaHeaders("http://100.108.64.76:9999/a.png", BASE, AUTH), undefined)
})

test("protocol-relative url resolves to another host and gets no auth header", () => {
  const url = mediaUrl("//evil.example.com/a.png", BASE)
  assert.equal(url, "http://evil.example.com/a.png")
  assert.equal(mediaHeaders(url, BASE, AUTH), undefined)
})

test("no auth header for data: URIs", () => {
  assert.equal(mediaHeaders("data:image/png;base64,AAAA", BASE, AUTH), undefined)
})

test("no auth header when the connection has no password", () => {
  assert.equal(mediaHeaders("/__forge/file?path=x.png", BASE, undefined), undefined)
})
