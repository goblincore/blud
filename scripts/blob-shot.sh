#!/usr/bin/env bash
# One command to get turntable frames of a .blob character.
#   npm run blob:shot -- mouse                 # -> /tmp/blob-shot/mouse/index.html
#   npm run blob:shot -- mouse /some/out/dir 12
#   BLOB_DIST=2.0 npm run blob:shot -- goblin
#
# Starts a Vite dev server on port 5233 and a Chrome on debug port 9223 IF they
# are not already listening, runs scripts/blob-turntable.mjs, then stops only
# what it started. Reusing an existing server is deliberate — the owner's lab
# session and an agent's shot can share one.
#
# CHROME MODE: the default is HEADLESS. Verified on this machine 2026-08-22
# (macOS 25.3, Apple GPU, Chrome stable): `--headless=new --enable-unsafe-webgpu`
# boots the lab, reports `backend: webgpu`, and shoots frames with luma std well
# above the blank-frame floor — no --use-angle=metal or --enable-features=Vulkan
# needed. Headless is the right default because it does not steal window focus
# from whoever is at the keyboard. Set BLOB_HEADED=1 to watch a real window
# instead, which is useful when the lab itself is what you are debugging.
set -euo pipefail

NAME="${1:?usage: blob-shot <character> [outDir] [frames]}"
OUT="${2:-/tmp/blob-shot/$NAME}"; FRAMES="${3:-8}"; VITE_PORT=5233; CDP_PORT=9223
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
cd "$(dirname "$0")/.."

started_vite=""; started_chrome=""

# Job control so each background launch lands in its OWN process group, which
# is what makes `kill -- -$pid` reach the real server and not just the `npx`
# wrapper that would otherwise be reaped while vite kept holding the port.
set -m

kill_group() {
  local pid="$1"
  [ -n "$pid" ] || return 0
  kill -- -"$pid" 2>/dev/null || kill "$pid" 2>/dev/null || true
  # `kill` only DELIVERS the signal — it does not wait for the process to go.
  # Reap it here, otherwise this script can exit while its own Chrome is still
  # mid-shutdown and still bound to the debug port.
  wait "$pid" 2>/dev/null || true
}

# ...and being reaped is still not the same as the port being free: the socket
# unbinds a beat later. Without this poll, two blob-shot runs chained back to
# back would let the second one `curl` the first one's dying browser, print
# "reusing", and then drive a browser that is on its way out.
wait_port_closed() {
  local url="$1" i
  for i in $(seq 1 25); do            # 25 * 0.2s = 5s ceiling
    curl -sf "$url" >/dev/null || return 0
    sleep 0.2
  done
  echo "blob-shot: warning — $url still answering 5s after we stopped it" >&2
  return 0
}

# Only ever wait on the ports WE opened. A server someone else owns is supposed
# to still be answering when we leave.
cleanup() {
  kill_group "$started_vite"
  kill_group "$started_chrome"
  if [ -n "$started_vite" ]; then wait_port_closed "http://localhost:$VITE_PORT/"; fi
  if [ -n "$started_chrome" ]; then wait_port_closed "http://localhost:$CDP_PORT/json/version"; fi
  return 0
}
trap cleanup EXIT

# Poll a URL until it answers, or die saying which thing never came up. Running
# the turntable against a port that never opened produces a confusing
# "lab never booted" 80 seconds later instead of the real cause.
wait_for() {
  local url="$1" what="$2" log="$3" i
  for i in $(seq 1 40); do
    curl -sf "$url" >/dev/null && return 0
    sleep 0.5
  done
  echo "blob-shot: $what never came up at $url (waited 20s). Last log lines:" >&2
  tail -n 20 "$log" >&2 || true
  exit 1
}

if ! curl -sf "http://localhost:$VITE_PORT/" >/dev/null; then
  npx vite --port $VITE_PORT --strictPort >/tmp/blob-shot-vite.log 2>&1 &
  started_vite=$!
  wait_for "http://localhost:$VITE_PORT/" "vite dev server" /tmp/blob-shot-vite.log
else
  echo "blob-shot: reusing the vite server already on port $VITE_PORT"
fi

if ! curl -sf "http://localhost:$CDP_PORT/json/version" >/dev/null; then
  # `&& HEADLESS=` alone would return 1 in the common (unset) case and `set -e`
  # would kill the script before Chrome ever launched — hence the explicit if.
  HEADLESS="--headless=new"
  if [ "${BLOB_HEADED:-}" = "1" ]; then HEADLESS=""; fi
  "$CHROME" $HEADLESS --remote-debugging-port=$CDP_PORT --enable-unsafe-webgpu \
    --user-data-dir=/tmp/chrome-blob-shot --no-first-run --no-default-browser-check \
    --window-size=1380,820 about:blank >/tmp/blob-shot-chrome.log 2>&1 &
  started_chrome=$!
  wait_for "http://localhost:$CDP_PORT/json/version" "chrome (debug port)" /tmp/blob-shot-chrome.log
else
  echo "blob-shot: reusing the chrome already on debug port $CDP_PORT"
fi

BLOB_CHARACTER="$NAME" node scripts/blob-turntable.mjs $VITE_PORT "$OUT" "$FRAMES" $CDP_PORT
echo "frames: $OUT/index.html"
