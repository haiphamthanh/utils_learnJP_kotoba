#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_FILE="$ROOT_DIR/.server.pid"
LOG_FILE="$ROOT_DIR/.server.log"
PORT="${PORT:-8000}"
EXPRESS_PACKAGE="$ROOT_DIR/node_modules/express/package.json"

if [[ -f "$PID_FILE" ]]; then
  EXISTING_PID="$(cat "$PID_FILE")"
  if kill -0 "$EXISTING_PID" >/dev/null 2>&1; then
    echo "Server is already running on PID $EXISTING_PID"
    exit 0
  fi
  rm -f "$PID_FILE"
fi

cd "$ROOT_DIR"
if [[ ! -f "$EXPRESS_PACKAGE" ]]; then
  echo "Missing dependencies. Run: yarn install"
  exit 1
fi

PORT="$PORT" yarn build
nohup env PORT="$PORT" node server.js >"$LOG_FILE" 2>&1 &
SERVER_PID=$!
echo "$SERVER_PID" >"$PID_FILE"
sleep 1

if ! kill -0 "$SERVER_PID" >/dev/null 2>&1; then
  echo "Failed to start server on port $PORT"
  echo "Recent log:"
  sed -n '1,40p' "$LOG_FILE"
  rm -f "$PID_FILE"
  exit 1
fi

echo "Server started"
echo "PID: $SERVER_PID"
echo "URL: http://localhost:$PORT"
echo "Log: $LOG_FILE"
