#!/usr/bin/env bash
# Stop an md-review server. Usage: stop-server.sh <session-dir>
SESSION_DIR="$1"
if [[ -z "$SESSION_DIR" || ! -d "$SESSION_DIR" ]]; then
  echo "{\"error\": \"usage: stop-server.sh <session-dir>\"}"
  exit 1
fi
PID_FILE="${SESSION_DIR}/state/server.pid"
if [[ -f "$PID_FILE" ]]; then
  kill "$(cat "$PID_FILE")" 2>/dev/null
  rm -f "$PID_FILE"
fi
STATE_DIR="${SESSION_DIR}/state"
if [[ -d "$STATE_DIR" ]]; then
  rm -f "$STATE_DIR/server-info"
  [[ -f "$STATE_DIR/server-stopped" ]] || printf '{"reason": "stopped by stop-server.sh", "timestamp": %s}\n' "$(date +%s)000" > "$STATE_DIR/server-stopped"
fi
# /tmp sessions are throwaway; project sessions persist for the user
case "$SESSION_DIR" in
  /tmp/md-review-*) rm -rf "$SESSION_DIR" ;;
esac
echo "{\"type\": \"server-stopped\", \"session_dir\": \"$SESSION_DIR\"}"
