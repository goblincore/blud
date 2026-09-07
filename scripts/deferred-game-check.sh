#!/usr/bin/env bash
# M2 task 6 — real-game producer/lifecycle GPU regression gate (private
# ports, own servers):
#   LAB_VITE_PORT=5326 LAB_CDP_PORT=9326 scripts/deferred-game-check.sh
#
# OUTER DEADLINE: TASK6_DEADLINE_SEC (default 1500s = 25min; the full phase
# list P0..P8 needs more than the core run's 10). The deadline kills a stuck
# browser evaluation — `timeout` terminates the NODE process, the trap still
# runs lab_servers_down, and the driver's own saveEvidence-on-finally has
# already persisted latest progress at every check. Kills only OUR process
# tree (the node gate below), never another task's browser.
#
# Owns/stops only what it starts (lab-servers.sh ownership rules).
set -euo pipefail
cd "$(dirname "$0")/.."
export LAB_VITE_PORT="${LAB_VITE_PORT:-5326}"
export LAB_CDP_PORT="${LAB_CDP_PORT:-9326}"

# Owned private ports must actually be free BEFORE anything starts: silently
# driving a foreign server on our nominal port is how evidence gets polluted.
for port in "$LAB_VITE_PORT" "$LAB_CDP_PORT"; do
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "deferred-game-check: port $port is already LISTENing — pick another" \
      "owned port (LAB_VITE_PORT / LAB_CDP_PORT)" >&2
    exit 3
  fi
done

. scripts/lab-servers.sh
trap lab_servers_down EXIT
lab_servers_up
TASK6_DEADLINE="${TASK6_DEADLINE_SEC:-1500}" node scripts/deferred-game-check.mjs "$LAB_VITE_PORT" "$LAB_CDP_PORT" &
node_pid=$!
(
  deadline="${TASK6_DEADLINE_SEC:-1500}"
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
