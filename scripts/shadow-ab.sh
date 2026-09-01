#!/usr/bin/env bash
# Character-shadow A/B in one page load. See scripts/shadow-ab.mjs for why a
# two-build cross-load A/B of this cannot be trusted.
#
#   scripts/shadow-ab.sh                      # -> /tmp/shadow-ab/ab-*.png
#   LOOK_DIST=2.4 LOOK_ZID=10 scripts/shadow-ab.sh
set -euo pipefail
OUT="${1:-/tmp/shadow-ab}"
cd "$(dirname "$0")/.."
# shellcheck source=scripts/lab-servers.sh
. scripts/lab-servers.sh
trap lab_servers_down EXIT
lab_servers_up
LOOK_OUT="$OUT" node scripts/shadow-ab.mjs "$LAB_VITE_PORT" "$LAB_CDP_PORT" ab
echo "shots: $OUT/ab-before.png  $OUT/ab-after.png  (floor: ab-before2, control: ab-on/ab-off)"
