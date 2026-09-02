#!/usr/bin/env bash
# Frozen in-page A/B/A/B capture + pixel-diff parity harness for the SDF perf
# round-2 plan. Every task's parity gate runs through here:
#
#   scripts/perf-r2-parity.sh capture <outDir> --room <3|4> --on "<js>" --off "<js>" [--occupancy]
#   scripts/perf-r2-parity.sh diff <pngA> <pngB>
#
# Owns its vite + Chrome via the shared lifecycle (scripts/lab-servers.sh);
# override ports to coexist with other chains:
#
#   LAB_VITE_PORT=5297 LAB_CDP_PORT=9297 scripts/perf-r2-parity.sh ...
#
# NEVER kill a server you did not start — if the default ports belong to
# another chain's worktree, export a free pair instead (5297/9297 is the
# plan's fallback). Occupancy counters and pixel diffs stay valid while
# another chain holds status: running; TIMED results do not (machine-load
# rule in the plan).
set -euo pipefail
cd "$(dirname "$0")/.."
export LAB_VITE_PORT="${LAB_VITE_PORT:-5299}"
export LAB_CDP_PORT="${LAB_CDP_PORT:-9299}"

case "${1:-}" in
  capture|diff) ;;
  *) sed -n '2,7p' "$0" | sed 's/^# \{0,1\}//' >&2; exit 2 ;;
esac

# shellcheck source=scripts/lab-servers.sh
. scripts/lab-servers.sh
trap lab_servers_down EXIT
lab_servers_up

# lab-servers' reuse guard only proves /sdf-lab-webgpu.html; THIS harness needs
# the game page. A foreign server on the port (another chain's worktree, another
# project) must fail here, loudly, instead of 150 s later as "page boot: never
# became ready".
if ! curl -sf "http://localhost:$LAB_VITE_PORT/sdf-game.html" >/dev/null; then
  echo "perf-r2-parity: port $LAB_VITE_PORT is up but does not serve /sdf-game.html." >&2
  echo "  Another chain's worktree or a non-Blud server owns it. Re-run with a free" >&2
  echo "  pair exported, e.g.: LAB_VITE_PORT=5297 LAB_CDP_PORT=9297 $0 $*" >&2
  exit 1
fi

node scripts/perf-r2-parity.mjs "$@"
