#!/usr/bin/env bash
# Stops Expo web and restores the original secure-store web module.
cd "$(git rev-parse --show-toplevel)"
lsof -ti:"${PORT:-8081}" -sTCP:LISTEN | xargs -r kill
target=node_modules/expo-secure-store/build/ExpoSecureStore.web.js
[ -f "$target.orig" ] && mv "$target.orig" "$target"
echo "teardown ok"
