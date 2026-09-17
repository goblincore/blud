#!/usr/bin/env bash
# scripts/neural-upscale/runpod/pull.sh — fetch exports.tar.gz from a run root's web server, install
# every export into the dev model store, and run G3 parity on each.
# Usage: pull.sh <pod id>            (fetches https://<pod id>-8080.proxy.runpod.net/exports.tar.gz)
#        pull.sh --url <base url>     (any server; the pre-flight uses a local http.server)
# Store: $UPSCALE_MODELS_DIR or <repo>/.upscale-models; an existing model of the same name is replaced.
set -euo pipefail
die() { echo "pull.sh: $*" >&2; exit 1; }

BASE=""; TAG=""
while [ $# -gt 0 ]; do
  case "$1" in
    --url) BASE=${2:?--url needs a base url}; shift 2 ;;
    --tag) TAG=${2:?--tag needs a name}; shift 2 ;;
    -h|--help) die "usage: pull.sh <pod id> | pull.sh --url <base url> [--tag <name>]" ;;
    -*) die "unknown flag $1" ;;
    *) [ -n "$BASE" ] || BASE="https://$1-8080.proxy.runpod.net"; TAG=${TAG:-$1}; shift ;;
  esac
done
[ -n "$BASE" ] || die "usage: pull.sh <pod id> | pull.sh --url <base url> [--tag <name>]"
TAG=${TAG:-local}
REPO=$(cd "$(dirname "$0")/../../.." && pwd)
DEST=${UPSCALE_MODELS_DIR:-$REPO/.upscale-models}
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

curl -fsSL "$BASE/exports.tar.gz" -o "$WORK/exports.tar.gz" || die "could not fetch $BASE/exports.tar.gz"
tar -xzf "$WORK/exports.tar.gz" -C "$WORK"
KEEP="$DEST/_pulled/$TAG"
mkdir -p "$KEEP"
for f in dashboard.json index.html GRID_DONE.json STOPPED_AT_CAP GRID_FAILED.txt PREFLIGHT.json; do
  [ -e "$WORK/$f" ] && cp "$WORK/$f" "$KEEP/"
done
[ -d "$WORK/img" ] && cp -R "$WORK/img" "$KEEP/"
CKPTS=0
for c in "$WORK"/*/ckpt-*.pt; do
  [ -e "$c" ] || continue
  run=$(basename "$(dirname "$c")")
  mkdir -p "$KEEP/checkpoints/$run"
  cp "$c" "$KEEP/checkpoints/$run/"
  CKPTS=$((CKPTS + 1))
done

INSTALLED=()
FAILED=()
for dir in "$WORK"/*/exports/*/; do
  [ -f "$dir/model.json" ] || continue
  name=$(basename "$dir")
  rm -rf "${DEST:?}/$name"
  cp -R "$dir" "$DEST/$name"
  if (cd "$REPO" && npx tsx scripts/upscale-trained-parity.ts "$DEST/$name"); then INSTALLED+=("$name"); else FAILED+=("$name"); fi
done
[ ${#INSTALLED[@]} -gt 0 ] || [ ${#FAILED[@]} -gt 0 ] || die "no exports in $BASE/exports.tar.gz"
echo "installed into $DEST: ${INSTALLED[*]:-none}"
if [ ${#FAILED[@]} -gt 0 ]; then
  echo "G3 PARITY FAILED (do not load these in-game): ${FAILED[*]}"
  exit 1
fi
echo "kept in $KEEP: $CKPTS checkpoints, dashboard $([ -e "$KEEP/index.html" ] && echo yes || echo no), grid summary $([ -e "$KEEP/GRID_DONE.json" ] && echo yes || echo "MISSING (grid did not finish)")"
echo "In-game: /sdf-game.html?upscale=trained&upscalemodel=<name>"
