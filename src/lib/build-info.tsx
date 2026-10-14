// Which pull request and commit an APK was built from. All-empty in the repo;
// CI overwrites it on PR builds ("Stamp build info" in build.yml), so release
// and main builds show no stamp. Static import keeps Metro happy in every
// build (including web) — a require of a generated file would break bundling
// when the generator was never run.
import { Linking, Text, type StyleProp, type TextStyle } from "react-native"
import buildInfoJson from "./build-info.json"

interface BuildInfo {
  repo: string
  pr: string
  sha: string
}

const EMPTY: BuildInfo = { repo: "", pr: "", sha: "" }

function parse(raw: unknown): BuildInfo {
  const source = (raw ?? {}) as Partial<BuildInfo>
  const repo = typeof source.repo === "string" && /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/.test(source.repo)
    ? source.repo.replace(/\/+$/, "")
    : ""
  const pr = typeof source.pr === "string" ? source.pr : ""
  const sha = typeof source.sha === "string" ? source.sha : ""
  if (!repo || !/^\d+$/.test(pr) || !/^[0-9a-f]{7,40}$/i.test(sha)) return EMPTY
  return { repo, pr, sha }
}

const info = parse(buildInfoJson)

function link(text: string, url: string, style?: StyleProp<TextStyle>) {
  return (
    <Text
      style={[style, { color: "#3b82f6", textDecorationLine: "underline" }]}
      onPress={() => Linking.openURL(url)}
    >
      {text}
    </Text>
  )
}

// PR# and short commit sha as tappable links in the version row, so a
// side-loaded CI APK says which pull request it came from. Null (the row shows
// only the version) unless this is a PR build with both stamped.
export function BuildStampLinks({ style }: { style?: StyleProp<TextStyle> }) {
  if (!info.pr || !info.sha) return null
  return (
    <Text style={style}>
      {link(`PR#${info.pr}`, `${info.repo}/pull/${info.pr}`, style)}{" "}
      {link(info.sha.slice(0, 7), `${info.repo}/commit/${info.sha}`, style)}
    </Text>
  )
}
