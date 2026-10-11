# scripts/sdf-game-flat-gate.sh
#!/usr/bin/env bash
# Headless gate for the Flat: owns its own vite + Chrome on its own ports. NEVER kill a server you did not start.
set -euo pipefail
cd "$(dirname "$0")/.."
export LAB_VITE_PORT="${LAB_VITE_PORT:-5560}"
export LAB_CDP_PORT="${LAB_CDP_PORT:-9560}"
export LAB_TMP="${LAB_TMP:-.lab-tmp}"
. "$(dirname "$0")/lab-servers.sh"
trap lab_servers_down EXIT
lab_servers_up
node scripts/sdf-game-flat-gate.mjs "$LAB_VITE_PORT" "$LAB_CDP_PORT"
