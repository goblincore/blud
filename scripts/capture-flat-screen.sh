# scripts/capture-flat-screen.sh
#!/usr/bin/env bash
# Saves one frame of Night Train (the game's own level) as the Flat's screen source. NEVER kill a server you did not start.
set -euo pipefail
cd "$(dirname "$0")/.."
export LAB_VITE_PORT="${LAB_VITE_PORT:-5565}"
export LAB_CDP_PORT="${LAB_CDP_PORT:-9565}"
export LAB_TMP="${LAB_TMP:-.lab-tmp}"
. "$(dirname "$0")/lab-servers.sh"
trap lab_servers_down EXIT
lab_servers_up
node scripts/capture-flat-screen.mjs "$LAB_VITE_PORT" "$LAB_CDP_PORT"
