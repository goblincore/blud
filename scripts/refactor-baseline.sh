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
# THE PER-RUN `timeout` IS AN ORDINARY HANG GUARD AGAIN (2026-09-06).
#
# It used to be load-bearing: crowd-capture.mjs wrote its PNG, printed its
# JSON and then NEVER EXITED, because its live CDP WebSocket kept node's event
# loop alive. `rc=124` from `timeout` was this script's SUCCESS path, and a
# run that exited 0 was the surprise. The cost was not subtle — every capture
# waited out its ENTIRE budget with the work long finished, four minutes a
# shot against seven seconds of measured work, twelve shots per baseline.
#
# crowd-capture now closes the socket and exits. So 0 is success, and a 124
# means it genuinely hung and the capture must not be trusted.
set -uo pipefail

OUT="${1:?usage: refactor-baseline.sh <outdir>}"
mkdir -p "$OUT"
MANIFEST="$OUT/MANIFEST"
: > "$MANIFEST"
: > "$OUT/MANIFEST-EYEBALL"

cd "$(dirname "$0")/.."
export LAB_VITE_PORT="${LAB_VITE_PORT:-5293}"
export LAB_CDP_PORT="${LAB_CDP_PORT:-9273}"
. scripts/lab-servers.sh
trap 'lab_servers_down' EXIT
lab_servers_up

# Per-capture budget — now a hang guard with a lot of headroom, not a stopwatch
# anyone waits out. MEASURED 2026-09-06, once crowd-capture stopped hanging: a
# full unwrapped capture returns in about SEVEN SECONDS. The old comment here
# guessed "60-90 s of real work plus the hang" and was wrong about the work
# too — nearly all of that was the hang.
CAP_TIMEOUT="${CAP_TIMEOUT:-240}"

# (label CHARACTER CROWD YAW PITCH DIST WOUNDS MOTION) — several camera angles,
# crowd sizes and two characters so a regression confined to one view cannot
# hide. Single body first: it is the most sensitive to a body/material change
# and the fastest to read.
#
# THE WOUNDED VIEWS ARE NOT OPTIONAL (added 2026-09-06). Without them this gate
# is blind to the ENTIRE wound path — crowd-capture never fires a weapon, so
# the five original views contain no craters at all. A refactor touching wound
# code could pass byte-identically while changing every crater on screen, which
# is precisely what happened when the lab converged onto the shared carve
# upload: five identical hashes, and a real behaviour change invisible to all
# of them.
#
# THE GOBLIN VIEWS ARE NOT OPTIONAL EITHER (added 2026-09-06). Every view above
# them renders the ZOMBIE, and so did all four sdf-game gates — so when task 3
# visibly broke the goblin on screen, all eight views and all four gates went
# green. The goblin is the right canary because he is the only registered
# character carrying BOTH a polygon kit (which rides the rig) and a generated
# face sheet (which does not), plus SDF face primitives no other character has.
#
# AND goblin-walk IS THE POINT OF THE PAIR. Every other view here holds the
# authored REST pose, where the goblin has always looked correct — the owner
# found this himself ("the goblin looks fine if i turn off movement"). The
# defect only exists mid-gait, so a gate made only of rest poses can never see
# it no matter how many characters it renders. MOTION=walk leaves the gait and
# wander running and relies on holdStill's reseed + fixed-dt walk-in for
# repeatability, exactly as MOTION=off does.
CAPTURES=(
  "solo-front   .      0 0.6 0.12 2.4 0 off"
  "solo-side    .      0 1.9 0.10 2.4 0 off"
  "solo-close   .      0 0.6 0.30 1.4 0 off"
  "crowd6       .      6 0.6 0.12 2.4 0 off"
  "crowd6-wide  .      6 0.6 0.05 4.0 0 off"
  "goblin-rest  goblin 0 0.6 0.12 2.4 0 off"
  "goblin-close goblin 0 0.6 0.30 1.4 0 off"
  "goblin-walk  goblin 0 0.6 0.12 2.4 0 walk"
  "zombie-walk  .      0 0.6 0.12 2.4 0 walk"
  "wound-front  .      0 0.6 0.12 2.4 6 off"
  "wound-close  .      0 0.6 0.30 1.4 6 off"
  "wound-side   .      0 1.9 0.10 2.4 6 off"
)

fails=0
for row in "${CAPTURES[@]}"; do
  read -r label character crowd yaw pitch dist wounds motion <<< "$row"
  # "." is the placeholder for "the lab's own default character" so the table
  # stays a fixed-width read; an empty column would shift every field after it.
  [ "$character" = "." ] && character=""
  png="$OUT/$label.png"
  echo "[baseline] $label (char=${character:-zombie} crowd=$crowd yaw=$yaw pitch=$pitch dist=$dist wounds=$wounds motion=$motion)"
  timeout "$CAP_TIMEOUT" env \
    CROWD="$crowd" YAW="$yaw" PITCH="$pitch" DIST="$dist" \
    MOTION="$motion" WOUNDS="$wounds" CHARACTER="$character" \
    node scripts/crowd-capture.mjs "$LAB_VITE_PORT" "$LAB_CDP_PORT" "$png" \
    </dev/null > "$OUT/$label.json" 2>&1
  rc=$?
  if [ "$rc" -ne 0 ]; then
    # 124 now means a REAL hang (it used to be the success path — see the note
    # at the top), so it fails like any other bad exit rather than passing.
    [ "$rc" -eq 124 ] && echo "[baseline] $label HUNG — ${CAP_TIMEOUT}s budget exhausted"
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
  # THE GOBLIN VIEWS ARE NOT HASH-GATED EITHER, AND THAT IS THE BUG THEY WERE
  # ADDED TO EXPOSE (measured 2026-09-06). Three boots of goblin-rest on
  # UNCHANGED code gave 2646cd27 / 97c1c11f / 631ecac1, and three of
  # goblin-walk gave three more — while zombie-walk, same recipe, same
  # holdStill, gave 90d3fcc6 three times out of three. The variation is not
  # sub-pixel: on some boots the goblin's armour hangs off the body entirely
  # and a kit piece floats beside his head; on others it fits.
  #
  # So the goblin's own render is nondeterministic per page load, and it is
  # NOT the walk mode (the zombie walks bit-stably) and NOT task 3 (this
  # reproduces on the reverted lab, which is what the revert was supposed to
  # fix). Until that is fixed these two are EYEBALL evidence. When it IS
  # fixed they must move back into MANIFEST — a stable goblin that is not
  # hash-gated is the blindness this whole exercise was about.
  # WOUNDED VIEWS ARE NOT HASH-GATED — they go to MANIFEST-EYEBALL instead.
  #
  # They are NOT reproducible run to run (measured 2026-09-06: the same code
  # gave wound-close 5fc7f17c then b16b928d). The stamp has to happen while the
  # render loop is LIVE, because pauseLoop's contract is that nothing reaches
  # the framebuffer after it — so the body pose at stamp time varies with
  # timing, stampWounds' raycast lands slightly differently, and the craters
  # move. holdStill()'s resetMotion() canonicalises the pose AFTERWARDS, which
  # is too late for wounds already stamped against the old one.
  #
  # Leaving them in MANIFEST would be worse than useless: every future run
  # would report three CHANGED views and train the reader to ignore the gate.
  # They stay as EYEBALL evidence — which is what they were wanted for, since
  # the carve-cap difference is sub-perceptual anyway.
  if [ "$wounds" -gt 0 ] || [ "$character" = "goblin" ]; then
    shasum -a 256 "$png" | awk -v l="$label" '{print l" "$1}' >> "$OUT/MANIFEST-EYEBALL"
  else
    shasum -a 256 "$png" | awk -v l="$label" '{print l" "$1}' >> "$MANIFEST"
  fi
done

sort -o "$MANIFEST" "$MANIFEST"
sort -o "$OUT/MANIFEST-EYEBALL" "$OUT/MANIFEST-EYEBALL"
echo "[baseline] $(wc -l < "$MANIFEST" | tr -d ' ') captures -> $MANIFEST"
if [ "$fails" -ne 0 ]; then
  echo "[baseline] $fails capture(s) FAILED — this baseline is incomplete, do not gate on it"
  exit 1
fi
echo "[baseline] OK"
