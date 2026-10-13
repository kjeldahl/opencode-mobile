---
name: run-web
description: Run the Expo app as a web build in headless Chromium and screenshot/drive screens (no Android emulator needed). Use to visually check UI changes in a cloud container, e.g. the demo screen, chat components, settings.
---

# Run app on web + screenshot

No emulator in cloud containers. Expo web + Playwright Chromium is the fastest visual check.
Web ≠ Android: layout/fonts close, not identical. Still run Maestro/CUA before merge (see AGENTS.md).

## Steps (from repo root)

```bash
S=.claude/skills/run-web
OUT=${OUT:-/tmp/shots}; mkdir -p $OUT
bash $S/setup.sh            # npm ci if needed, web deps --no-save, secure-store shim
bash $S/start.sh            # expo web :8081, waits until served (~60s first bundle)
node $S/shot.mjs /demo $OUT $S/examples/demo-steps.mjs
bash $S/teardown.sh         # kill server, restore secure-store module
```

Then **Read the PNGs** — a red "Uncaught Error" overlay or blank frame = failure; `pageerror:` lines print to stdout.

## Writing steps

`shot.mjs <route> <outDir> [steps.mjs]` — phone viewport 412x915 @2x, dark (`SCHEME=light` to switch).
Steps module: `export default async (page, shot) => { ...; await shot("name") }`.
RN `testID` → `data-testid`, so `page.getByTestId("turn-summary")` works; `getByText` for labels.

## Gotchas

- `react-native-web`, `react-dom`, `@expo/metro-runtime` are installed `--no-save`: never commit package.json/lockfile changes from setup (setup prints git status for both — must be empty).
- `expo-secure-store` web build is `{}` → `SecureStore.getItemAsync is not a function` crash in settings store. setup.sh copies `securestore.web.js` (localStorage shim) over it; teardown restores. Metro caches modules → start.sh uses `--clear`.
- Playwright lives at `/opt/node-tools/node_modules` (global); browsers at `/opt/pw-browsers`. Don't `playwright install`.
- `/demo` is fully offline. Screens needing a server (sessions/chat): not verified on web; try `node tests/fixtures/mock-opencode-server.ts --port 4100 --seed-diff` and add connection `127.0.0.1:4100` via UI (CORS untested).
- Kill server by port (`lsof -ti:8081`), not `pkill -f`.
