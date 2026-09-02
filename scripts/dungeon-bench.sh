#!/usr/bin/env bash
# The dungeon relighting cost gate (plan task 9, 2026-09-01): benches the
# three lighting legs of src/lab/sdf-zombie/webgpu/game-bench-scenario.ts
# against sdf-game.html —
#
#   dungeon-off         gallery rig, no flashlight, no shadows  (off-state)
#   dungeon-no-shadow   dungeon rig, flashlight, castShadow=0   (baseline)
#   dungeon-shadow      dungeon rig, flashlight, shadows        (what ships)
#
# Same firefight script (room 4) on every leg, so deltas are LIGHTING ONLY.
# The gate: dungeon-shadow must not cost more than +40% over
# dungeon-no-shadow; if it does, the number goes to the owner with the
# 512² trade rather than shipping silently.
#
#   LAB_VITE_PORT=5279 LAB_CDP_PORT=9279 scripts/dungeon-bench.sh
#
# BENCH_LEGS=dungeon|wounds (default dungeon — the original gate, invocation
# unchanged). 'wounds' runs the wound-pass-r2 measurement legs: wounds-off /
# wounds-no-bone / wounds-bone, spec §4 gate 7 — a MEASUREMENT, not a gate.
# BENCH_REPEATS (default 3) tunes the repeat count; legs alternate across
# repeats. Writes docs/dev-notes/2026-09-01-dungeon-relight/baselines.json
# (+ bench.md) unless BENCH_OUT overrides. Keep the machine quiet.
set -euo pipefail
cd "$(dirname "$0")/.."
export LAB_VITE_PORT="${LAB_VITE_PORT:-5279}"
export LAB_CDP_PORT="${LAB_CDP_PORT:-9279}"
export BENCH_OUT="${BENCH_OUT:-docs/dev-notes/2026-09-01-dungeon-relight}"
# shellcheck source=scripts/lab-servers.sh
. scripts/lab-servers.sh
trap lab_servers_down EXIT
lab_servers_up
node scripts/dungeon-bench.mjs "$LAB_VITE_PORT" "$LAB_CDP_PORT"
