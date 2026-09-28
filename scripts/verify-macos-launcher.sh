#!/bin/bash
set -euo pipefail
APP="$1"
LOG="$(mktemp "${TMPDIR:-/tmp}/quickcut-native.XXXXXX")"
"$APP/Contents/MacOS/QuickCut" >"$LOG" 2>&1 &
NATIVE_PID=$!
BACKEND_PID=''
cleanup() {
  [[ -z "$BACKEND_PID" ]] || kill "$BACKEND_PID" 2>/dev/null || true
  kill "$NATIVE_PID" 2>/dev/null || true
}
trap cleanup EXIT
for ((i=0; i<90; i++)); do
  if ! kill -0 "$NATIVE_PID" 2>/dev/null; then cat "$LOG"; echo 'Native APP exited before readiness' >&2; exit 1; fi
  BACKEND_PID="$(pgrep -P "$NATIVE_PID" -x node || true)"
  if [[ -n "$BACKEND_PID" ]]; then
    PORT="$(lsof -a -p "$BACKEND_PID" -iTCP -sTCP:LISTEN -Fn 2>/dev/null | sed -n 's/^n127\.0\.0\.1://p' | head -1 || true)"
    if [[ -n "$PORT" ]]; then
      curl --fail --silent "http://127.0.0.1:$PORT/health" | /usr/bin/grep '"ok":true'
      echo 'Native macOS APP launch verified'
      exit 0
    fi
  fi
  sleep 0.5
done
cat "$LOG"
echo 'Native APP did not start its packaged backend' >&2
exit 1
