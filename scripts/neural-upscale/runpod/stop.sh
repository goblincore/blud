#!/usr/bin/env bash
# scripts/neural-upscale/runpod/stop.sh — stop the training pod and show its state (OWNER ONLY; uses the API key).
# Usage: stop.sh <pod id>
set -euo pipefail
POD_ID=${1:?usage: stop.sh <pod id>}
runpodctl pod stop "$POD_ID"
runpodctl pod get "$POD_ID"
cat <<EOF
Stopped. A stopped pod still bills for its volume disk.
  once the exports are pulled and checked: runpodctl pod delete $POD_ID
  check actual spend:                     runpodctl billing
EOF
