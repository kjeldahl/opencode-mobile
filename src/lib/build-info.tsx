// Which pull request and commit an APK was built from. All-empty in the repo;
// CI overwrites it on PR builds ("Stamp build info" in build.yml), so release
// and main builds show no stamp. Static import keeps Metro happy in every
// build (including web) — a require of a generated file would break bundling
// when the generator was never run.
import { Linking, Text, type StyleProp, type TextStyle } from "react-native"
import buildInfoJson from "./build-info.json"

export interface BuildInfo {
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

export const BUILD_INFO: BuildInfo = parse(buildInfoJson)

export function prUrl(info: BuildInfo = BUILD_INFO): string {
  return `${info.repo}/pull/${info.pr}`
}

export function commitUrl(info: BuildInfo = BUILD_INFO): string {
  return `${info.repo}/commit/${info.sha}`
}

export function prLabel(info: BuildInfo = BUILD_INFO): string {
  return info.pr ? `PR#${info.pr}` : ""
}

export function shaLabel(info: BuildInfo = BUILD_INFO): string {
  return info.sha ? info.sha.slice(0, 7) : ""
}

export function buildStamp(info: BuildInfo = BUILD_INFO): string {
  const pr = prLabel(info)
  const sha = shaLabel(info)
  return pr && sha ? `${pr} ${sha}` : ""
}

// Tappable in isolation so the version row itself can stay non-pressable.
export function BuildStampLinks({ style }: { style?: StyleProp<TextStyle> }) {
  if (!BUILD_INFO.pr || !BUILD_INFO.sha) return null
  return (
    <>
      <TextLink text={prLabel()} url={prUrl()} style={style} />
      <Text style={style}> </Text>
      <TextLink text={shaLabel()} url={commitUrl()} style={style} />
    </>
  )
}

function TextLink({ text, url, style }: { text: string; url: string; style?: StyleProp<TextStyle> }) {
  return (
    <Text style={[style, { color: "#3b82f6", textDecorationLine: "underline" }]} onPress={() => Linking.openURL(url)}>
      {text}
    </Text>
  )
}
