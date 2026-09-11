#!/usr/bin/env bash
# The R1 gather-dispatch evidence run. Owns its own vite + Chrome via the shared
# lifecycle (scripts/lab-servers.sh); override the ports to coexist with a
# running lab session.
#
#   scripts/sdf-gather-dispatch-check.sh --out /tmp/gather-new.json --label r1-new
#   scripts/sdf-gather-dispatch-check.sh --compare /tmp/gather-old.json --out /tmp/gather-new.json
#
# Why it exists: R1 changed the gather from one thread per probe to one thread
# per (probe, ray) with a workgroup-local reduction, and the failure modes are a
# mis-reduced probe and a race between the scratch write and the fold. Neither
# is reachable from vitest (nothing there compiles WGSL) and neither is visible
# in the rendered frame as anything but "the lighting looks a bit off". See the
# header of scripts/sdf-gather-dispatch-check.mjs for the traps it encodes.
set -euo pipefail
cd "$(dirname "$0")/.."
export LAB_VITE_PORT="${LAB_VITE_PORT:-5277}"
export LAB_CDP_PORT="${LAB_CDP_PORT:-9277}"
# shellcheck source=scripts/lab-servers.sh
. scripts/lab-servers.sh
trap lab_servers_down EXIT
lab_servers_up
node scripts/sdf-gather-dispatch-check.mjs "$@"
