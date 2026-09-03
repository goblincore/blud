#!/usr/bin/env bash
# One command to capture the zombie melt ramp and gate it on the silhouette.
#   npm run melt:shot                       # -> /tmp/melt-capture/{melt-*.png,metrics.json}
#   npm run melt:shot -- /some/out/dir
#   BLOB_DIST=2.0 npm run melt:shot
#   LAB_VITE_PORT=5244 LAB_CDP_PORT=9244 npm run melt:shot   # alongside another run
#
# Starts a Vite dev server and a Chrome IF they are not already listening, runs
# scripts/melt-capture.mjs, then stops only what it started — all of which
# lives in scripts/lab-servers.sh, shared with blob-shot.sh and
# blob-render-check.sh. Read that file for the ports, the reuse rule, the
# headless decision and the WebGPU health probe.
set -euo pipefail

OUT="${1:-/tmp/melt-capture}"
cd "$(dirname "$0")/.."

# shellcheck source=scripts/lab-servers.sh
. scripts/lab-servers.sh
trap lab_servers_down EXIT
lab_servers_up

npx tsx scripts/melt-capture.mjs "$LAB_VITE_PORT" "$OUT" "$LAB_CDP_PORT"
echo "frames: $OUT"
