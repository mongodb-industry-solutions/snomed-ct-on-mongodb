#!/usr/bin/env bash
# Start the SNOMED CT on MongoDB demo locally.
# Runs the Next.js demo in the foreground after selecting an available port.
# Ctrl-C in the frontend pane cleans up the pid file too.
# Manual stop: scripts/stop-demo.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_ROOT="$REPO_ROOT"
LOGS="$REPO_ROOT/logs"
PIDS="$LOGS/pids"
FRONTEND_PORT="${PORT:-3015}"
RESERVED_PORTS=()
CLAIMED_PORT=""

port_is_listening() {
  local port="$1"
  lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
}

port_is_reserved() {
  local port="$1"
  local reserved_port=""

  if [ "${#RESERVED_PORTS[@]}" -eq 0 ]; then
    return 1
  fi

  for reserved_port in "${RESERVED_PORTS[@]}"; do
    if [ "$reserved_port" = "$port" ]; then
      return 0
    fi
  done

  return 1
}

find_available_port() {
  local preferred_port="$1"
  local candidate="$preferred_port"
  local offset=0

  while [ "$offset" -lt 50 ]; do
    if ! port_is_listening "$candidate" && ! port_is_reserved "$candidate"; then
      printf '%s\n' "$candidate"
      return 0
    fi
    candidate=$((preferred_port + offset + 1))
    offset=$((offset + 1))
  done

  return 1
}

claim_port() {
  local requested_port="$1"
  local service_name="$2"
  local selected_port=""

  selected_port="$(find_available_port "$requested_port")" || {
    echo "ERROR: could not find an available port for $service_name starting at $requested_port." >&2
    exit 1
  }

  if [ "$selected_port" != "$requested_port" ]; then
    echo "NOTE: port $requested_port is already in use. Starting $service_name on $selected_port instead." >&2
  fi

  RESERVED_PORTS+=("$selected_port")
  CLAIMED_PORT="$selected_port"
}

cleanup() {
  trap - EXIT
  echo
  echo "Stopping demo services..."
  "$REPO_ROOT/scripts/stop-demo.sh" || true
}

echo "Checking demo prerequisites..."
if [ ! -f "$APP_ROOT/.env.local" ]; then
  echo "ERROR: missing config file: .env.local" >&2
  echo "       Start from .env.example, then re-run this script." >&2
  exit 1
fi

if [ ! -f "$APP_ROOT/package.json" ]; then
  echo "ERROR: missing package.json; repo layout is not what this script expects." >&2
  exit 1
fi

if [ ! -d "$APP_ROOT/node_modules" ]; then
  echo "ERROR: frontend dependencies are not installed." >&2
  echo "       Run 'npm install' once, then re-run this script." >&2
  exit 1
fi

if [ ! -x "$APP_ROOT/node_modules/.bin/next" ]; then
  echo "ERROR: Next.js runtime is missing." >&2
  echo "       Run 'npm install' once, then re-run this script." >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: node is not installed or not on PATH." >&2
  exit 1
fi

claim_port "$FRONTEND_PORT" "frontend"
FRONTEND_PORT="$CLAIMED_PORT"

mkdir -p "$LOGS" "$PIDS"
rm -f "$PIDS/frontend.pid" "$PIDS/frontend.port"
printf '%s\n' "$FRONTEND_PORT" >"$PIDS/frontend.port"

echo "Starting Next.js on http://localhost:${FRONTEND_PORT} (Ctrl-C to stop everything)..."
echo

trap cleanup EXIT

(
  cd "$APP_ROOT"
  export PORT="$FRONTEND_PORT"
  bash -c '
    printf "%s\n" "$$" > "$1"
    exec ./node_modules/.bin/next dev --hostname 0.0.0.0 --port "$2"
  ' bash "$PIDS/frontend.pid" "$FRONTEND_PORT"
)
