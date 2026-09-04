#!/usr/bin/env bash
# The vite + Chrome lifecycle both lab capture commands need. SOURCE this, do
# not execute it:
#
#   . "$(dirname "$0")/lab-servers.sh"
#   trap lab_servers_down EXIT
#   lab_servers_up
#   ... drive the lab on $LAB_VITE_PORT / $LAB_CDP_PORT ...
#
# WHY IT IS ITS OWN FILE. This lived inside blob-shot.sh, and because
# blob-shot.sh stops what it started on exit, the advice "run blob:shot in
# another shell so render-check has servers" was simply false — the servers were
# gone by the time you read the frames, and `npm run blob:render-check` on a
# fresh machine exited 2 with "no Chrome on debug port 9223". A capture command
# that cannot start its own servers is a capture command an agent cannot run.
# So the lifecycle is shared and every command owns its own.
#
# PORTS are overridable so two runs can coexist:
#   LAB_VITE_PORT=5244 LAB_CDP_PORT=9244 npm run blob:render-check -- goblin
# Each Chrome also gets its own --user-data-dir, keyed by port; two Chromes
# sharing a profile directory is how you get one that silently refuses to start.
#
# REUSE IS DELIBERATE: a server already listening is left alone and left running
# — the owner's lab session and an agent's shot can share one. Only what WE
# started is stopped.

LAB_VITE_PORT="${LAB_VITE_PORT:-5233}"
LAB_CDP_PORT="${LAB_CDP_PORT:-9223}"
export LAB_VITE_PORT LAB_CDP_PORT
LAB_CHROME="${LAB_CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"

lab_started_vite=""; lab_started_chrome=""

# Poll a URL until it answers, or die saying which thing never came up. Running
# the capture against a port that never opened produces a confusing
# "lab never booted" 80 seconds later instead of the real cause.
lab__wait_for() {
  local url="$1" what="$2" log="$3" i
  for i in $(seq 1 40); do
    curl -sf "$url" >/dev/null && return 0
    sleep 0.5
  done
  echo "lab-servers: $what never came up at $url (waited 20s). Last log lines:" >&2
  tail -n 20 "$log" >&2 || true
  return 1
}

# Is ANYTHING listening on this URL? Not the same question as "does it answer
# 200", and the difference cost a confusing failure: the guard below asked with
# `curl -sf`, so a foreign dev server that 404s our path read as an empty port,
# and vite was launched straight into an EADDRINUSE stack trace followed by a
# 20-second readiness wait. curl exits 7 for "could not connect" and something
# else entirely (0, 22, 52...) whenever a socket answered at all, which is the
# distinction that matters here.
lab__is_listening() {
  local url="$1"
  curl -s -o /dev/null --max-time 5 "$url"
  [ "$?" -ne 7 ]
}

lab__kill_group() {
  local pid="$1"
  [ -n "$pid" ] || return 0
  kill -- -"$pid" 2>/dev/null || kill "$pid" 2>/dev/null || true
  # `kill` only DELIVERS the signal — it does not wait for the process to go.
  # Reap it here, otherwise this script can exit while its own Chrome is still
  # mid-shutdown and still bound to the debug port.
  wait "$pid" 2>/dev/null || true
}

# ...and being reaped is still not the same as the port being free: the socket
# unbinds a beat later. Without this poll, two runs chained back to back would
# let the second one `curl` the first one's dying browser, print "reusing", and
# then drive a browser that is on its way out.
lab__wait_port_closed() {
  local url="$1" i
  for i in $(seq 1 25); do            # 25 * 0.2s = 5s ceiling
    curl -sf "$url" >/dev/null || return 0
    sleep 0.2
  done
  echo "lab-servers: warning — $url still answering 5s after we stopped it" >&2
  return 0
}

# Does the Chrome on $LAB_CDP_PORT actually have WebGPU? A browser answering
# /json/version is not a browser that can render the lab: a Chrome started
# without --enable-unsafe-webgpu (by a person, by another tool, by an older
# version of this script) answers the debug port perfectly and then produces a
# black canvas, which every downstream check reports as some invented geometry
# problem. Ask navigator.gpu directly, on a real localhost page — about:blank is
# not a good place to ask about a GPU adapter — and refuse to proceed if the
# answer is no.
lab__probe_webgpu() {
  LAB_PROBE_URL="http://localhost:$LAB_VITE_PORT/" \
  LAB_PROBE_CDP="$LAB_CDP_PORT" \
  node --input-type=module -e "$(cat <<'JS'
const cdp = process.env.LAB_PROBE_CDP;
const url = process.env.LAB_PROBE_URL;
const die = (m) => { console.error(m); process.exit(1); };
// One try/catch around the whole handshake: a `.catch(die)` on the tail of the
// chain leaves a rejected fetch and a non-JSON body reporting differently, and
// `die` returning undefined would hand the next line an undefined `tab`.
let tab;
try {
  tab = await (await fetch(
    `http://localhost:${cdp}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' },
  )).json();
} catch {
  die('could not open a CDP target');
}
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok, err) => { ws.onopen = ok; ws.onerror = () => err(new Error('ws')); });
let seq = 0; const pending = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
const send = (method, params = {}) => new Promise((r) => {
  const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params }));
});
const timer = setTimeout(() => die('WebGPU probe timed out'), 15000);
const r = await send('Runtime.evaluate', {
  expression: `(async () => {
    if (!navigator.gpu) return 'no navigator.gpu';
    const a = await navigator.gpu.requestAdapter();
    return a ? 'ok' : 'no adapter';
  })()`,
  awaitPromise: true, returnByValue: true,
});
clearTimeout(timer);
const verdict = r.result?.result?.value ?? 'probe returned nothing';
await fetch(`http://localhost:${cdp}/json/close/${tab.id}`).catch(() => {});
ws.close();
if (verdict !== 'ok') die(verdict);
process.exit(0);
JS
)"
}

lab_servers_up() {
  # Job control so each background launch lands in its OWN process group, which
  # is what makes `kill -- -$pid` reach the real server and not just the `npx`
  # wrapper that would otherwise be reaped while vite kept holding the port.
  # This is a sourced file, so `set -m` stays on in the calling script — that is
  # deliberate: lab_servers_down needs those process groups to still exist.
  set -m

  if ! lab__is_listening "http://localhost:$LAB_VITE_PORT/"; then
    echo "lab-servers: starting vite on $LAB_VITE_PORT"
    npx vite --port "$LAB_VITE_PORT" --strictPort >"/tmp/lab-vite-$LAB_VITE_PORT.log" 2>&1 &
    lab_started_vite=$!
    lab__wait_for "http://localhost:$LAB_VITE_PORT/" "vite dev server" \
      "/tmp/lab-vite-$LAB_VITE_PORT.log" || exit 1
  else
    # Something answering on the port is not proof it is OUR dev server — any
    # other project's vite would serve `/` happily and then 404 the lab, which
    # surfaces 80s later as the capture's confusing "lab never booted". Ask for
    # the page we actually need before deciding this server is reusable.
    if ! curl -sf "http://localhost:$LAB_VITE_PORT/sdf-lab-webgpu.html" >/dev/null; then
      echo "lab-servers: port $LAB_VITE_PORT is busy but is not the Blud lab" >&2
      echo "  (it does not serve /sdf-lab-webgpu.html — stop whatever owns that port," \
        "or set LAB_VITE_PORT to a free one)" >&2
      exit 1
    fi
    echo "lab-servers: reusing the vite server already on port $LAB_VITE_PORT"
  fi

  # CHROME MODE: the default is HEADLESS. Verified on this machine 2026-08-22
  # (macOS 25.3, Apple GPU, Chrome stable): `--headless=new --enable-unsafe-webgpu`
  # boots the lab, reports `backend: webgpu`, and shoots frames with luma std well
  # above the blank-frame floor — no --use-angle=metal or --enable-features=Vulkan
  # needed. Headless is the right default because it does not steal window focus
  # from whoever is at the keyboard. Set BLOB_HEADED=1 to watch a real window
  # instead, which is useful when the lab itself is what you are debugging.
  if ! lab__is_listening "http://localhost:$LAB_CDP_PORT/json/version"; then
    # `&& HEADLESS=` alone would return 1 in the common (unset) case and `set -e`
    # would kill the script before Chrome ever launched — hence the explicit if.
    local headless="--headless=new"
    if [ "${BLOB_HEADED:-}" = "1" ]; then headless=""; fi
    echo "lab-servers: starting chrome ($([ -n "$headless" ] && echo headless || echo headed))" \
      "on debug port $LAB_CDP_PORT"
    # $headless is deliberately unquoted: it must vanish entirely when empty, and
    # quoting it would pass an empty string as a real (invalid) argv entry.
    "$LAB_CHROME" $headless --remote-debugging-port="$LAB_CDP_PORT" --enable-unsafe-webgpu \
      --user-data-dir="/tmp/chrome-lab-$LAB_CDP_PORT" --no-first-run --no-default-browser-check \
      --window-size=1380,820 about:blank >"/tmp/lab-chrome-$LAB_CDP_PORT.log" 2>&1 &
    lab_started_chrome=$!
    lab__wait_for "http://localhost:$LAB_CDP_PORT/json/version" "chrome (debug port)" \
      "/tmp/lab-chrome-$LAB_CDP_PORT.log" || exit 1
  else
    # Listening is not the same as being a Chrome. Ask for the version endpoint
    # specifically, so a stray server on this port says so here instead of
    # surfacing as an inexplicable CDP failure later.
    if ! curl -sf "http://localhost:$LAB_CDP_PORT/json/version" >/dev/null; then
      echo "lab-servers: port $LAB_CDP_PORT is busy but is not a Chrome debug port" >&2
      echo "  (no /json/version — stop whatever owns that port, or set LAB_CDP_PORT)" >&2
      exit 1
    fi
    echo "lab-servers: reusing the chrome already on debug port $LAB_CDP_PORT"
    if ! lab__probe_webgpu; then
      echo "lab-servers: Chrome on $LAB_CDP_PORT has no working WebGPU — kill it or set" \
        "LAB_CDP_PORT to another port" >&2
      exit 1
    fi
  fi
}

# Remove the --user-data-dir of a Chrome WE started, once it is actually gone.
#
# WHY THIS EXISTS: every run gets a profile keyed by port, and until 2026-09-03
# nothing ever removed one. Sixty-six of them had accumulated in /tmp on the
# owner's machine — ports 9223 through 9411, 5.3 GB — because each run that
# picks a fresh port leaves a fresh profile behind. Captures are about to get
# more frequent (the melt ramp shoots seven frames a run), so this had to stop
# growing.
#
# THE TWO ORDER CONSTRAINTS, both learned from the failure modes above:
#   1. Only ever our own. The reuse rule means the Chrome on this port may be
#      the owner's own lab session; deleting a running browser's profile is how
#      you get a browser that silently refuses to start next time.
#   2. Only AFTER the port is confirmed closed. lab__kill_group delivers the
#      signal and reaps, but the file comment above records that being reaped
#      is still not the same as being finished — pulling the profile out from
#      under a browser mid-shutdown gets you crash-restore state at best.
#
# The path guard is not paranoia theatre: an empty LAB_CDP_PORT would make this
# `rm -rf /tmp/chrome-lab-`, and a typo'd one would delete a profile that is
# not ours. Refuse anything that is not a plain port number.
lab__clean_profile() {
  local port="$1" dir
  case "$port" in
    '' | *[!0-9]* ) return 0 ;;
  esac
  dir="/tmp/chrome-lab-$port"
  [ -d "$dir" ] || return 0
  rm -rf "$dir"
}

# Only ever stop, and only ever wait on, the servers WE started. One someone
# else owns is supposed to still be answering when we leave.
lab_servers_down() {
  local rc=$?
  lab__kill_group "$lab_started_vite"
  lab__kill_group "$lab_started_chrome"
  if [ -n "$lab_started_vite" ]; then
    lab__wait_port_closed "http://localhost:$LAB_VITE_PORT/"
  fi
  if [ -n "$lab_started_chrome" ]; then
    lab__wait_port_closed "http://localhost:$LAB_CDP_PORT/json/version"
    lab__clean_profile "$LAB_CDP_PORT"
  fi
  lab_started_vite=""; lab_started_chrome=""
  return $rc
}
