#!/usr/bin/env bash
# scripts/neural-upscale/runpod/pull.sh — fetch exports.tar.gz from a run root's web server, install
# every export into the dev model store, and run G3 parity on each.
# Usage: pull.sh <pod id>            (fetches https://<pod id>-8080.proxy.runpod.net/exports.tar.gz)
#        pull.sh --url <base url>     (any server; the pre-flight uses a local http.server)
# Store: $UPSCALE_MODELS_DIR or <repo>/.upscale-models; an existing model of the same name is replaced.
set -euo pipefail
die() { echo "pull.sh: $*" >&2; exit 1; }

case "${1:-}" in
  --url) BASE=${2:?usage: pull.sh --url <base url>}; TAG=local ;;
  ""|-h|--help) die "usage: pull.sh <pod id> | pull.sh --url <base url>" ;;
  *) BASE="https://$1-8080.proxy.runpod.net"; TAG=$1 ;;
esac
REPO=$(cd "$(dirname "$0")/../../.." && pwd)
DEST=${UPSCALE_MODELS_DIR:-$REPO/.upscale-models}
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

curl -fsSL "$BASE/exports.tar.gz" -o "$WORK/exports.tar.gz" || die "could not fetch $BASE/exports.tar.gz"
tar -xzf "$WORK/exports.tar.gz" -C "$WORK"
mkdir -p "$DEST/_pulled/$TAG"
for f in dashboard.json GRID_DONE.json STOPPED_AT_CAP GRID_FAILED.txt PREFLIGHT.json; do
  [ -e "$WORK/$f" ] && cp "$WORK/$f" "$DEST/_pulled/$TAG/"
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
echo "summaries kept in $DEST/_pulled/$TAG/. In-game: /sdf-game.html?upscale=trained&upscalemodel=<name>"
