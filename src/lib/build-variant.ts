// Reads the CI-generated build stamp (the same file build-info.tsx links to)
// and turns it into variant-aware defaults. Split out from build-info.tsx so
// stores/settings.ts can import it without pulling React Native into node --test.

interface Stamp {
  pr: string
  sha: string
}

export function demoSessionDefault(stamp: Stamp): boolean {
  // PR builds are stamped by CI ("Stamp build info" in build.yml): both fields
  // are set. Release, main, and local builds leave the file empty, so the demo
  // showcase session defaults off for them and on for reviewers' PR builds.
  return Boolean(stamp.pr && stamp.sha)
}
