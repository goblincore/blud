#!/usr/bin/env bash
# The MELEE close-up perf harness: several bodies close to the camera,
# wounded, FX running — the owner's GPU-bound play scenario, on demand.
# Owns its own vite + Chrome via the shared lifecycle (scripts/lab-servers.sh);
# override ports to coexist.
#
#   LAB_TMP=.lab-tmp LAB_VITE_PORT=5412 LAB_CDP_PORT=9412 \
#     scripts/sdf-game-melee-bench.sh
#
# (Under a sandbox, LAB_TMP must point INSIDE the worktree — see
# lab-servers.sh's header; the default /tmp is read-only there.)
#
# Tuning is env-driven (defaults in parentheses): MELEE_BODIES (6),
# MELEE_NEAREST (1.4), MELEE_SPACING (0.9), MELEE_ROOM (6, the arena),
# MELEE_CHARACTER (zombie), MELEE_REPS (3), MELEE_FRAMES (60),
# MELEE_LEGS='name=<page js>;...' for extra A/B seams,
# MELEE_SETTLE_TRIES (30 — set 2400 for a FIRST cold-cache boot; the cold
# march compile can cost minutes), BENCH_OUT (/tmp/sdf-melee).
#
# Output: $BENCH_OUT/melee.json + melee.md + per-phase PNGs.
# Keep the machine QUIET while this runs; every row records the 1-minute
# load average and a run over 4.0 is flagged loadSuspect in the report.
set -euo pipefail
cd "$(dirname "$0")/.."
export LAB_VITE_PORT="${LAB_VITE_PORT:-5421}"
export LAB_CDP_PORT="${LAB_CDP_PORT:-9421}"
# shellcheck source=scripts/lab-servers.sh
. scripts/lab-servers.sh
trap lab_servers_down EXIT
lab_servers_up
node scripts/sdf-game-melee-bench.mjs "$LAB_VITE_PORT" "$LAB_CDP_PORT"
