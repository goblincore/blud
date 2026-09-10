#!/usr/bin/env bash
# The frame hash: same-build, same-machine frame reproducibility for
# sdf-game.html. Owns its own vite + Chrome via the shared lifecycle
# (scripts/lab-servers.sh); override ports to coexist.
#
#   scripts/sdf-demo-hash.sh ab            # record the spec twice, compare
#   scripts/sdf-demo-hash.sh negative      # control on the control: must fail
#   scripts/sdf-demo-hash.sh record        # write a baseline for later verify
#   scripts/sdf-demo-hash.sh verify        # replay against the stored baseline
#   scripts/sdf-demo-hash.sh ab '{"frames":48,"every":2,"room":3}'
#
# Why it exists: two 2026-09-10 bugs (the zeroed dynamic probe layer that
# rendered characters as black silhouettes, and the tracer-light slots that
# defaulted to 0) were caught by the owner PLAYTESTING. Both change rendered
# pixels and neither is visible to any CPU test.
#
# Determinism makes both legs do the same WORK. It cannot make the GPU run at
# the same SPEED, so this does NOT replace the bench's Repeatability discipline
# — read that section first for anything timed. See scripts/sdf-demo-hash.mjs
# for the full HONEST LIMITS block.
set -euo pipefail
cd "$(dirname "$0")/.."
export LAB_VITE_PORT="${LAB_VITE_PORT:-5277}"
export LAB_CDP_PORT="${LAB_CDP_PORT:-9277}"
# shellcheck source=scripts/lab-servers.sh
. scripts/lab-servers.sh
trap lab_servers_down EXIT
lab_servers_up
node scripts/sdf-demo-hash.mjs "$LAB_VITE_PORT" "$LAB_CDP_PORT" "$@"
