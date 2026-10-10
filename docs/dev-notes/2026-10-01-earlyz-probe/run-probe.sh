#!/usr/bin/env bash
# Owns its own vite + headless Chrome. DRIVER=earlyz-drive.mjs (default) times the
# early-Z micro-benchmark; DRIVER=wgsl-features.mjs checks shader acceptance.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE" && git rev-parse --show-toplevel)"
cd "$ROOT"
export LAB_VITE_PORT="${LAB_VITE_PORT:-5398}" LAB_CDP_PORT="${LAB_CDP_PORT:-9398}"
. scripts/lab-servers.sh
trap lab_servers_down EXIT
lab_servers_up
node "$HERE/${DRIVER:-earlyz-drive.mjs}" "$LAB_VITE_PORT" "$LAB_CDP_PORT"
