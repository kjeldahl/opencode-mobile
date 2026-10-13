#!/usr/bin/env bash
# One-time per container: web deps (not saved to package.json) + secure-store shim.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
here=.claude/skills/run-web
[ -d node_modules ] || npm ci --ignore-scripts
[ -d node_modules/react-native-web ] || npm i --no-save --ignore-scripts \
  react-native-web@~0.21.0 react-dom@19.1.0 @expo/metro-runtime@~6.1.2 || true
test -d node_modules/react-native-web || { echo "react-native-web install failed" >&2; exit 1; }
target=node_modules/expo-secure-store/build/ExpoSecureStore.web.js
[ -f "$target.orig" ] || cp "$target" "$target.orig"
cp "$here/securestore.web.js" "$target"
git status --short package.json package-lock.json
echo "setup ok"
