#!/usr/bin/env bash
# Starts Expo web on :8081 (background, --clear so the shim is picked up) and waits.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
port=${PORT:-8081}
log=${LOG:-/tmp/expo-web.log}
{ lsof -ti:"$port" -sTCP:LISTEN || true; } | xargs -r kill
sleep 1
(CI=1 nohup npx expo start --web --port "$port" --clear > "$log" 2>&1 &)
timeout 180 bash -c "until curl -sf http://localhost:$port >/dev/null; do sleep 2; done"
echo "expo web up on :$port (log $log)"
