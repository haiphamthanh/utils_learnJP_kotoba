#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_FILE="$ROOT_DIR/.server.pid"
PORT_FILE="$ROOT_DIR/.server.port"

read_port() {
  if [[ -f "$PORT_FILE" ]]; then
    cat "$PORT_FILE"
  else
    printf "8000"
  fi
}

if [[ ! -f "$PID_FILE" ]]; then
  echo "No PID file found. Server may already be stopped."
  exit 0
fi

SERVER_PID="$(cat "$PID_FILE")"
SERVER_PORT="$(read_port)"

if kill -0 "$SERVER_PID" >/dev/null 2>&1; then
  kill "$SERVER_PID"

  for _ in 1 2 3 4 5; do
    if ! kill -0 "$SERVER_PID" >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done

  if kill -0 "$SERVER_PID" >/dev/null 2>&1; then
    kill -9 "$SERVER_PID"
    echo "Process $SERVER_PID did not stop gracefully. Sent SIGKILL."
  else
    echo "Stopped server PID $SERVER_PID"
  fi
else
  echo "Process $SERVER_PID is not running"
fi

PORT_LISTENER="$(lsof -tiTCP:"$SERVER_PORT" -sTCP:LISTEN || true)"
if [[ -n "$PORT_LISTENER" ]]; then
  echo "Warning: port $SERVER_PORT is still being used by PID $PORT_LISTENER"
else
  echo "Port $SERVER_PORT is free"
fi

rm -f "$PID_FILE" "$PORT_FILE"
