#!/usr/bin/env bash
# M2 task 7 — material/shadow visual gate (private ports, owned lifecycle).
#   LAB_VITE_PORT=5356 LAB_CDP_PORT=9356 bash scripts/deferred-game-shadow-check.sh
# FUNCTIONAL + CAPTURE phase only — timing lives in
# scripts/deferred-game-timing-check.sh so a slow timing run cannot conceal
# completed functional evidence.
set -euo pipefail
cd "$(dirname "$0")/.."
export LAB_VITE_PORT="${LAB_VITE_PORT:-5356}"
export LAB_CDP_PORT="${LAB_CDP_PORT:-9356}"

for port in "$LAB_VITE_PORT" "$LAB_CDP_PORT"; do
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "deferred-game-shadow-check: port $port is already LISTENing — pick another owned port" >&2
    exit 3
  fi
done

. scripts/lab-servers.sh
trap lab_servers_down EXIT
lab_servers_up
TASK7_DEADLINE="${TASK7_DEADLINE_SEC:-1200}" node scripts/deferred-game-shadow-check.mjs "$LAB_VITE_PORT" "$LAB_CDP_PORT" &
node_pid=$!
(
  deadline="${TASK7_DEADLINE_SEC:-1200}"
  sleep "$deadline" && kill -TERM "$node_pid" 2>/dev/null
) &
watchdog_pid=$!
set +e
wait "$node_pid"
rc=$?
kill "$watchdog_pid" 2>/dev/null
wait "$watchdog_pid" 2>/dev/null
set -e
exit "$rc"
