#!/usr/bin/env bash
# Live cloth frames of a wandering .blob character (see cloth-capture.mjs).
#   LAB_TMP=.lab-tmp CLOTH_PRIM=12 npm run blob:cloth -- cultist [outDir] [frames]
set -euo pipefail
NAME="${1:?usage: cloth-capture <character> [outDir] [frames]}"
OUT_ARG="${2:-}"; FRAMES="${3:-40}"
cd "$(dirname "$0")/.."
# shellcheck source=scripts/lab-servers.sh
. scripts/lab-servers.sh
OUT="${OUT_ARG:-$LAB_TMP/cloth/$NAME}"
trap lab_servers_down EXIT
lab_servers_up
BLOB_CHARACTER="$NAME" node scripts/cloth-capture.mjs "$LAB_VITE_PORT" "$OUT" "$FRAMES" "$LAB_CDP_PORT"
