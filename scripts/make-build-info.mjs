// Writes src/lib/build-info.json. Empties in the repo mean release/main builds
// show only the version; CI fills it in on PR builds so the About screen can
// link the PR and the commit the APK was built from.
import { writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const out = join(here, "..", "src", "lib", "build-info.json")
const data = {
  repo: process.env.BUILD_INFO_REPO || "",
  pr: process.env.BUILD_INFO_PR || "",
  sha: process.env.BUILD_INFO_SHA || "",
}
writeFileSync(out, `${JSON.stringify(data, null, 2)}\n`)
