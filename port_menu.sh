#!/usr/bin/env bash
set -euo pipefail

print_header() {
  echo
  echo "=============================="
  echo " Port Utility Menu"
  echo "=============================="
}

prompt_port() {
  local port
  read -r -p "Nhap port: " port

  if [[ ! "$port" =~ ^[0-9]+$ ]]; then
    echo "Port khong hop le."
    return 1
  fi

  printf "%s" "$port"
}

show_port_info() {
  local port
  if ! port="$(prompt_port)"; then
    return
  fi

  echo
  echo "Thong tin process dang bind port $port:"
  if ! lsof -nP -iTCP:"$port" -sTCP:LISTEN; then
    echo "Khong co process nao dang LISTEN tren port $port."
  fi
}

kill_port_process() {
  local port
  local pids

  if ! port="$(prompt_port)"; then
    return
  fi

  pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN || true)"
  if [[ -z "$pids" ]]; then
    echo "Khong co process nao dang LISTEN tren port $port."
    return
  fi

  echo
  echo "Process se bi dung tren port $port:"
  lsof -nP -iTCP:"$port" -sTCP:LISTEN
  echo
  read -r -p "Xac nhan kill process nay? [y/N]: " confirm

  if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
    echo "Da huy."
    return
  fi

  while IFS= read -r pid; do
    if [[ -n "$pid" ]]; then
      kill "$pid"
      echo "Da gui SIGTERM toi PID $pid"
    fi
  done <<< "$pids"
}

main() {
  while true; do
    print_header
    echo "1. Check port hien tai dang chay chuong trinh nao"
    echo "2. End process theo port"
    echo "3. Thoat"
    echo
    read -r -p "Chon chuc nang [1-3]: " choice

    case "$choice" in
      1)
        show_port_info
        ;;
      2)
        kill_port_process
        ;;
      3)
        echo "Thoat."
        exit 0
        ;;
      *)
        echo "Lua chon khong hop le."
        ;;
    esac
  done
}

main
