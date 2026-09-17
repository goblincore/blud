#!/usr/bin/env bash
# scripts/neural-upscale/runpod/watch-pull.sh — unattended pull. Polls the pod's dashboard server
# for exports.tar.gz and runs pull.sh the moment it appears (install + G3 parity per export).
# With --stop it then stops the pod, so an AFK run does not burn the whole grace window.
#
# Usage: watch-pull.sh <pod id> [--stop | --delete] [--interval 60] [--timeout-h 8] [--url <base>]
# --stop   releases the GPU; a stopped pod still bills for its volume (pennies a day).
# --delete also destroys the pod and its volume. Only after the pull verifies: every export's G3
#          parity passed, the grid finished, and the checkpoints are local. Irreversible.
# Keep the Mac awake for it:  caffeinate -i scripts/neural-upscale/runpod/watch-pull.sh <pod id> --stop
# Log: ~/blud-upscale-data/watch-pull-<tag>.log   Marker: PULLED / PULL-FAILED / TIMED-OUT next to it.
set -uo pipefail

POD=""; BASE=""; STOP=0; DELETE=0; INTERVAL=60; TIMEOUT_H=8
die() { echo "watch-pull.sh: $*" >&2; exit 2; }
while [ $# -gt 0 ]; do
  case "$1" in
    --stop) STOP=1; shift ;;
    --delete) DELETE=1; STOP=1; shift ;;
    --interval) INTERVAL=${2:?}; shift 2 ;;
    --timeout-h) TIMEOUT_H=${2:?}; shift 2 ;;
    --url) BASE=${2:?}; shift 2 ;;
    -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
    -*) die "unknown flag $1" ;;
    *) POD=$1; shift ;;
  esac
done
[ -n "$POD" ] || [ -n "$BASE" ] || die "usage: watch-pull.sh <pod id> [--stop | --delete] [--interval 60] [--timeout-h 8]"
[ -n "$BASE" ] || BASE="https://$POD-8080.proxy.runpod.net"
[ "$STOP" -eq 0 ] || [ -n "$POD" ] || die "--stop/--delete needs a pod id"

HERE=$(cd "$(dirname "$0")" && pwd)
TAG=${POD:-local}
LOG_DIR=${UPSCALE_DATA_ROOT:-$HOME/blud-upscale-data}
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/watch-pull-$TAG.log"
say() { echo "[$(date -u +%FT%TZ)] $*" | tee -a "$LOG"; }
notify() { osascript -e "display notification \"$1\" with title \"Blud upscale\"" 2>/dev/null || true; }
mark() { : > "$LOG_DIR/$1-$TAG"; }

deadline=$(( $(date +%s) + TIMEOUT_H * 3600 ))
say "watching $BASE/exports.tar.gz every ${INTERVAL}s, giving up in ${TIMEOUT_H}h (stop after pull: $([ "$STOP" -eq 1 ] && echo yes || echo no))"
while :; do
  if curl -fsI --max-time 20 "$BASE/exports.tar.gz" >/dev/null 2>&1; then
    say "exports are up — pulling"
    # Pull from exactly the URL this watcher verified, tagged by pod id.
    if bash "$HERE/pull.sh" --url "$BASE" --tag "$TAG" >>"$LOG" 2>&1; then
      say "PULL OK — models installed and G3 parity passed"
      mark PULLED
      notify "Models pulled and parity-checked"
      STORE=${UPSCALE_MODELS_DIR:-$(cd "$HERE/../../.." && pwd)/.upscale-models}
      KEEP="$STORE/_pulled/$TAG"
      MODELS=$(find "$STORE" -maxdepth 2 -name model.json -not -path "*/_pulled/*" 2>/dev/null | wc -l | tr -d ' ')
      CKPTS=$(find "$KEEP/checkpoints" -name 'ckpt-*.pt' 2>/dev/null | wc -l | tr -d ' ')
      say "local copy: $MODELS models, $CKPTS checkpoints, grid summary $([ -e "$KEEP/GRID_DONE.json" ] && echo present || echo MISSING)"
      if [ "$DELETE" -eq 1 ] && { [ "$MODELS" -lt 1 ] || [ "$CKPTS" -lt 1 ] || [ ! -e "$KEEP/GRID_DONE.json" ]; }; then
        say "NOT deleting: the local copy is incomplete. Stopping only; inspect $KEEP and delete by hand."
        notify "Pull incomplete — pod stopped, not deleted"
        DELETE=0
      fi
      if [ "$STOP" -eq 1 ]; then
        say "stopping pod $POD"
        runpodctl pod stop "$POD" >>"$LOG" 2>&1 || runpodctl stop pod "$POD" >>"$LOG" 2>&1 \
          || { say "COULD NOT STOP THE POD — do it in the console"; notify "Pod did NOT stop — check the console"; exit 1; }
        say "pod stopped"
        if [ "$DELETE" -eq 1 ]; then
          say "deleting pod $POD (checkpoints and dashboard are local, in $KEEP)"
          runpodctl pod delete "$POD" >>"$LOG" 2>&1 || runpodctl remove pod "$POD" >>"$LOG" 2>&1 \
            || { say "COULD NOT DELETE — the pod is stopped; delete it in the console"; notify "Pod stopped but NOT deleted"; exit 1; }
          say "pod deleted"
          notify "Pod deleted — models are local"
        else
          say "it still bills for its volume (pennies a day): runpodctl pod delete $POD when you are done"
          notify "Pod stopped"
        fi
      fi
      exit 0
    fi
    say "PULL FAILED — see $LOG. The pod is left alone so you can retry."
    mark PULL-FAILED
    notify "Pull FAILED — see the log"
    exit 1
  fi
  if [ "$(date +%s)" -ge "$deadline" ]; then
    say "TIMED OUT after ${TIMEOUT_H}h — no exports.tar.gz. The pod may have stopped already."
    mark TIMED-OUT
    notify "Pull timed out — no exports"
    exit 1
  fi
  sleep "$INTERVAL"
done
