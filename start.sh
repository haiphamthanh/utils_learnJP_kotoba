#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_FILE="$ROOT_DIR/.server.pid"
PORT_FILE="$ROOT_DIR/.server.port"
LOG_FILE="$ROOT_DIR/.server.log"
PORT="${PORT:-8000}"
HOST="${HOST:-127.0.0.1}"
EXPRESS_PACKAGE="$ROOT_DIR/node_modules/express/package.json"

cleanup_stale_pid() {
  if [[ -f "$PID_FILE" ]]; then
    local existing_pid
    existing_pid="$(cat "$PID_FILE")"

    if kill -0 "$existing_pid" >/dev/null 2>&1; then
      echo "Server is already running on PID $existing_pid"
      exit 0
    fi

    rm -f "$PID_FILE"
  fi
}

ensure_port_is_free() {
  local listener_pid
  listener_pid="$(lsof -tiTCP:"$PORT" -sTCP:LISTEN || true)"

  if [[ -n "$listener_pid" ]]; then
    echo "Port $PORT is already in use by PID $listener_pid"
    echo "Run ./stop.sh if this is your server, or use ./port_menu.sh to inspect it."
    exit 1
  fi
}

ensure_dependencies() {
  if [[ -f "$EXPRESS_PACKAGE" ]]; then
    return
  fi

  echo "Dependencies not found. Running yarn install..."
  if ! yarn install; then
    echo "Failed to install dependencies."
    echo "Please check your network connection and Yarn setup, then run ./start.sh again."
    exit 1
  fi

  if [[ ! -f "$EXPRESS_PACKAGE" ]]; then
    echo "Dependencies still missing after yarn install."
    exit 1
  fi
}

server_is_ready() {
  node -e "
    const http = require('http');
    const request = http.get(
      { host: process.env.HOST, port: process.env.PORT, path: '/api/health', timeout: 800 },
      (response) => process.exit(response.statusCode === 200 ? 0 : 1),
    );
    request.on('timeout', () => request.destroy(new Error('timeout')));
    request.on('error', () => process.exit(1));
  " >/dev/null 2>&1
}

cd "$ROOT_DIR"
cleanup_stale_pid
ensure_port_is_free
ensure_dependencies

PORT="$PORT" yarn build
nohup env HOST="$HOST" PORT="$PORT" node server.js >"$LOG_FILE" 2>&1 &
SERVER_PID=$!
echo "$SERVER_PID" >"$PID_FILE"
echo "$PORT" >"$PORT_FILE"

for _ in 1 2 3 4 5 6 7 8 9 10; do
  if ! kill -0 "$SERVER_PID" >/dev/null 2>&1; then
    break
  fi

  if HOST="$HOST" PORT="$PORT" server_is_ready; then
    echo "Server started"
    echo "PID: $SERVER_PID"
    echo "URL: http://$HOST:$PORT"
    echo "Log: $LOG_FILE"
    exit 0
  fi

  sleep 1
done

if ! kill -0 "$SERVER_PID" >/dev/null 2>&1 || ! HOST="$HOST" PORT="$PORT" server_is_ready; then
  echo "Failed to start server on port $PORT"
  echo "Recent log:"
  sed -n '1,40p' "$LOG_FILE"
  rm -f "$PID_FILE" "$PORT_FILE"
  exit 1
fi
