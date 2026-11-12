// Confirms the per-connection version probe against real servers of both majors.
// Usage: node scripts/v2-live-detect.ts <baseUrl> <username> <password>
import { detectServerMajor, clearServerMajorCache } from "../src/lib/server-version.ts"

const base = (process.argv[2] ?? "http://127.0.0.1:4196").replace(/\/+$/, "")
const auth = { username: process.argv[3] ?? "opencode", password: process.argv[4] ?? "" }
const expected = process.argv[5] as "v1" | "v2" | undefined

const probe = await fetch(`${base}/api/info`, {
  headers: { Authorization: `Basic ${btoa(`${auth.username}:${auth.password}`)}` },
})
console.log(`GET ${base}/api/info -> ${probe.status} ${probe.headers.get("content-type")}`)

clearServerMajorCache()
const major = await detectServerMajor({ baseUrl: base, auth }, { force: true })
console.log("detected:", major, expected ? `(expected ${expected})` : "")

if (expected && major !== expected) {
  console.log("FAIL")
  process.exit(1)
}
console.log("OK")
