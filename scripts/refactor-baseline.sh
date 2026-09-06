#!/usr/bin/env bash
# Pixel baseline for the character-view refactor.
#
#   scripts/refactor-baseline.sh <outdir>
#
# Writes PNGs plus a MANIFEST of sha256(png) lines. The manifest is the gate:
# a later run's manifest must be byte-identical to the baseline's, and `diff`
# on two manifests names the exact capture that moved.
#
# WHY THIS WRAPS crowd-capture.mjs RATHER THAN CAPTURING ITS OWN FRAMES.
# crowd-capture already IS a pixel-identity gate built for a refactor: it
# applies the deterministic freeze recipe (freezeCosmetics + motion freeze),
# fires three shots, checks they agree within the run, and reports a SHA-256.
# Reimplementing that would mean re-deriving the freeze recipe, which is the
# hard part and the part that makes the hashes stable.
#
# DETERMINISM IS MEASURED, NOT ASSUMED (2026-09-06). Three captures across
# three fresh page loads — and a fourth from a separate vite+Chrome lifecycle
# — all produced 77d1659d…, so byte-identity across boots holds on this
# machine. If a future run of this script produces two different hashes for
# the SAME code, that assumption has broken and the gate is invalid: stop and
# say so rather than loosening the comparison.
#
# THE PER-RUN `timeout` IS LOAD-BEARING, NOT A FLAKE GUARD. crowd-capture.mjs
# writes its PNG and prints its JSON and then NEVER EXITS — a live CDP
# WebSocket keeps node's event loop alive. A plain loop over it hangs forever
# on the first iteration (this cost two attempts on 2026-09-06 before the
# cause was found). The result is complete well before the hang, so `rc=124`
# from `timeout` is the SUCCESS path here. A run that exits 0 is the surprise.
set -uo pipefail

OUT="${1:?usage: refactor-baseline.sh <outdir>}"
mkdir -p "$OUT"
MANIFEST="$OUT/MANIFEST"
: > "$MANIFEST"

cd "$(dirname "$0")/.."
export LAB_VITE_PORT="${LAB_VITE_PORT:-5293}"
export LAB_CDP_PORT="${LAB_CDP_PORT:-9273}"
. scripts/lab-servers.sh
trap 'lab_servers_down' EXIT
lab_servers_up

# Per-capture budget. One capture is ~60-90 s of real work plus the hang.
CAP_TIMEOUT="${CAP_TIMEOUT:-240}"

# (label, CROWD, YAW, PITCH, DIST) — several camera angles and crowd sizes so
# a regression confined to one view cannot hide. Single body first: it is the
# most sensitive to a body/material change and the fastest to read.
CAPTURES=(
  "solo-front 0 0.6 0.12 2.4"
  "solo-side  0 1.9 0.10 2.4"
  "solo-close 0 0.6 0.30 1.4"
  "crowd6     6 0.6 0.12 2.4"
  "crowd6-wide 6 0.6 0.05 4.0"
)

fails=0
for row in "${CAPTURES[@]}"; do
  read -r label crowd yaw pitch dist <<< "$row"
  png="$OUT/$label.png"
  echo "[baseline] $label (crowd=$crowd yaw=$yaw pitch=$pitch dist=$dist)"
  timeout "$CAP_TIMEOUT" env \
    CROWD="$crowd" YAW="$yaw" PITCH="$pitch" DIST="$dist" MOTION=off \
    node scripts/crowd-capture.mjs "$LAB_VITE_PORT" "$LAB_CDP_PORT" "$png" \
    </dev/null > "$OUT/$label.json" 2>&1
  rc=$?
  # 124 = timeout killed the hung-but-finished process: the expected path.
  if [ "$rc" -ne 124 ] && [ "$rc" -ne 0 ]; then
    echo "[baseline] FAIL $label rc=$rc — see $OUT/$label.json"
    fails=$((fails + 1))
    continue
  fi
  if [ ! -f "$png" ]; then
    echo "[baseline] FAIL $label produced no PNG — see $OUT/$label.json"
    fails=$((fails + 1))
    continue
  fi
  # stableWithinRun false means the scene was not actually frozen; the hash is
  # then meaningless as a baseline.
  if ! grep -q '"stableWithinRun": true' "$OUT/$label.json"; then
    echo "[baseline] FAIL $label was NOT stable within its own run"
    fails=$((fails + 1))
    continue
  fi
  shasum -a 256 "$png" | awk -v l="$label" '{print l" "$1}' >> "$MANIFEST"
done

sort -o "$MANIFEST" "$MANIFEST"
echo "[baseline] $(wc -l < "$MANIFEST" | tr -d ' ') captures -> $MANIFEST"
if [ "$fails" -ne 0 ]; then
  echo "[baseline] $fails capture(s) FAILED — this baseline is incomplete, do not gate on it"
  exit 1
fi
echo "[baseline] OK"
