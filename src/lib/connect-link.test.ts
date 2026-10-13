import { test } from "node:test"
import assert from "node:assert/strict"
import { connectLinkFromParams, findConnection, normalizeServerUrl, parseConnectLink } from "./connect-link.ts"

const url = encodeURIComponent("https://Ruby-DCB.tail1234.ts.net/ws/alpha/")

test("parses the opencode:// form", () => {
  assert.deepEqual(parseConnectLink(`opencode://connect?url=${url}&name=alpha&user=opencode&dir=%2Fhome%2Fwork%2Frepo%2F&session=ses_1`), {
    url: "https://ruby-dcb.tail1234.ts.net/ws/alpha",
    name: "alpha",
    user: "opencode",
    dir: "/home/work/repo",
    session: "ses_1",
  })
})

test("parses the intent:// form only when it targets the opencode scheme", () => {
  const link = `intent://connect?url=${url}&name=alpha#Intent;scheme=opencode;package=it.kjeldahl.opencode;end`
  assert.equal(parseConnectLink(link)?.url, "https://ruby-dcb.tail1234.ts.net/ws/alpha")
  assert.equal(parseConnectLink(`intent://connect?url=${url}#Intent;scheme=https;end`), null)
})

test("rejects links without a usable http(s) url", () => {
  assert.equal(parseConnectLink("opencode://connect?name=alpha"), null)
  assert.equal(parseConnectLink("opencode://connect?url=ftp%3A%2F%2Fhost"), null)
  assert.equal(parseConnectLink("opencode://session/abc"), null)
})

test("ignores a password parameter", () => {
  const link = parseConnectLink(`opencode://connect?url=${url}&password=secret`)
  assert.ok(link)
  assert.equal(Object.values(link).includes("secret"), false)
})

test("reads expo-router params, empty values as absent", () => {
  assert.deepEqual(connectLinkFromParams({ url: "http://10.0.0.2:4096", name: "", dir: ["/repo", "/other"] }), {
    url: "http://10.0.0.2:4096",
    name: undefined,
    user: undefined,
    dir: "/repo",
    session: undefined,
  })
})

test("normalizeServerUrl drops trailing slash, query and fragment", () => {
  assert.equal(normalizeServerUrl("HTTP://Host:4096/"), "http://host:4096")
  assert.equal(normalizeServerUrl("https://host/a/b/?x=1#y"), "https://host/a/b")
  assert.equal(normalizeServerUrl("host:4096"), null)
})

test("findConnection matches stored urls after normalising", () => {
  const list = [{ id: "a", url: "http://host:4096/" }, { id: "b", url: "https://other" }]
  assert.equal(findConnection(list, "http://host:4096")?.id, "a")
  assert.equal(findConnection(list, "https://none"), undefined)
})
