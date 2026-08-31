# C2 — temporal amortisation (half-rate SDF layer): spike note

**Date:** 2026-08-31 · **Branch:** `dispatch/temporal-c2-spike` · **Deliverable: a
look verdict, not a number.** The shell march landed first (`af1e664`), so C2
is no longer a perf necessity; it survives because a low-framerate flesh
composite over a 60 fps world might be exactly the degraded look Blud wants.
The reel below exists so the owner can judge that. Per the spec: no measured
win justifies it if the smear reads as broken, and no measured cost condemns
it if the smear reads as intentional.

## What was built

Half-rate lives in `sdf-layer.ts` (compositing side only — `march.wgsl.ts`,
the shell hull and `lab-main.ts` untouched). The mechanism is deliberately
boring:

- The march (pass 2) leaves its result in the layer's float target, and
  nothing between frames clears a render target. So a **hold frame skips the
  pre-passes and the march entirely** and composites the same texture again.
  No copy pass, no new pass — the composite quad is the same single pass it
  always was, so the odd/even pass-count Y-flip trap is avoided by
  construction.
- A `holdMode` uniform selects the composite behaviour: `0` fresh/classic,
  `1` raw hold, `2` **per-pixel reprojection** — the brief's stretch goal.
  Reprojection unprojects each held pixel through the HELD camera's inverse
  view-projection (the march's alpha-channel depth is the depth), then
  projects the world point with the CURRENT camera and samples there. A
  full-screen homography is the special case where every depth is equal; the
  per-pixel version subsumes it and handles camera translation.
- The depth fed to `depthNode` on a reprojected hold is **recomputed for the
  current camera** (clip z/w), so occlusion against the full-rate polygonal
  pass tracks camera motion instead of lagging. On a RAW hold (mode 0) the
  held frame's stale alpha-depth is fed through unchanged, per the brief —
  occlusion errors where geometry newly occludes held flesh are expected
  there and were not fixed.
- Frame parity: even frames fresh, odd frames hold, forever
  (`isHoldFrame`, pure + unit-tested). Any (re)allocation or enable forces a
  fresh frame first, because the target's backing memory is garbage then.

**Seams (default OFF everywhere):** `__sdfGame.setHalfRate(on)` /
`get halfRate` / `setHalfRateMode(n)` (`0` = raw hold, `1` = per-pixel
reproject, the default) / `get halfRateMode`. The HUD shows `HALF30
reproj|hold` when on. Driver: `scripts/sdf-game-half-rate.mjs` (subcommands
`parity`, `parity-cycle`, `reproj-check`, `reproj-probe`, `shift-scan`,
`phase`, `gate500`, `bench`, `reel`).

## Gates

- **Toggle OFF is bit-identical — proven within one page load** (the only
  place "pixel-diff zero" is achievable): settled frozen frame → halfRate
  on → 31 steps → off → 30 steps → capture; diff vs the first capture:
  **0 pixels, max channel delta 0**
  (`evidence/cycle-c2-off0.png` vs `cycle-c2-off1.png`).
- **Cross-load captures can never be pixel-identical on this page** — the
  render loop runs during the whole boot before `__sdfGame` exists, so the
  frozen zombies' walk-cycle poses and the pinned shader clock freeze at
  wall-clock-dependent values. Measured noise floor, two loads, identical
  protocol: 1.23 % pixels / 0.75 % >2 / 0.46 % >8. The after-change capture
  lands inside that floor (1.21 % / 0.75 % / 0.47 % vs before-a; 0.85 %
  vs before-b). Evidence: `evidence/parity-before-*.png`, `parity-after.png`.
  (Also: fresh frames under halfRate are bit-identical to the full-rate twin
  *within* a load — see the probe table below — which is the same statement
  at the per-frame level.)
- `npx tsc --noEmit` clean; `npx vitest run src/lab` **1699 passed**
  (baseline 1696 + 3 new parity tests); production build passes.
- **500-frame stepped run with the toggle on: zero console errors** (250 at
  reproject mode 1, 249 at mode 0, a slug fired mid-run, live wanderers).
  18 reel page-loads also ran error-free.

## Does the reprojection actually reproject? (measured, not assumed)

Scripted lateral camera sweep past a frozen zombie, smear 0, all variants in
ONE load so cross-load noise cannot pollute (`reproj-probe`; full tables in
`evidence/phase-and-shift-scan.txt`):

| frame | fresh frames vs full | raw hold vs full | reproject vs full |
| --- | --- | --- | --- |
| even (hold) | — | **6.0–7.9 %**, best-aligned at **dx = +21 px** | **5.2–6.6 %**, best-aligned at **dx = 0** |
| odd (fresh) | **0.0000 %, max Δ 0** | — | — |

Read: a raw hold's flesh lags exactly one frame of sweep (21 px at 6 m/s,
2 m); the reprojection cancels the lag — best alignment at zero shift, with
the sign and orientation verified (an inverted v-mapping would overshoot to
the *opposite* side, dx ≈ −2×, which is not what happened). The same check
on the reel itself (`shift-scan` on `seq/strafe-*-smear0`): raw hold dx = +12
px at the reel's 3.3 m/s sweep, reproject dx = 0.

## The reel — what to look at

`seq/<moment>-<rate>-<smear>/fNN.png`, 800×600, adaptive OFF, HUD hidden.
16–20 frames each, captured at a stepped 60 Hz sim (the sim runs at full
rate in all variants; only the flesh composites at half rate). Full = full
rate, half = half-rate reproject (mode 1), halfhold = half-rate raw hold
(mode 0, strafe only). Smear = post-aa temporal smear at its 0.25 default
and at 0. **Which frames are holds varies per page load** (parity phase is
arbitrary at boot); `phase` classifies them where cross-load noise allows —
cleanest at smear 0 (e.g. `strafe-half-smear0`: `..H.H.H.H.H.H.H.`).

- **`strafe-*` — the double-image worst case.** Camera strafing 3.3 m/s past
  a zombie at ~2 m. Raw hold: the flesh visibly detaches from the world, lagging
  12 px and snapping back every other frame — a classic double image. Reproject:
  the body tracks; what remains is **pale streaking at silhouette edges**
  (disocclusion: the held frame has no data for newly revealed background, the
  edge-clamped texels stretch) and a faint resample roughness. With smear 0.25
  both get softer and trail more; **half + smear compounds into a heavy motion
  smear** (compare `strafe-full-smear25` vs `strafe-half-smear25` f05) — the
  frames read like deliberate PSX video blur, but it is twice the smear the
  owner approved for full rate.
- **`walk-*` — object motion, camera still.** A zombie crossing the view in
  room 2. The gait is what degrades: under half rate each pose HELDS for a
  frame then jumps two gait-steps — a subtle stop-motion judder in the limbs.
  (The strong body lean in these frames is genuine gait, present identically
  in the full-rate twin.) At smear 0.25 the judder reads as soft foot/limb
  trails; honestly the least damaged moment.
- **`fire-*` — wounds land late.** A pellet volley into a body at ~3 m (the
  volley severed an arm at this range — more stress than planned). Under half
  rate the impact result — crater, detached piece — appears up to one FLESH
  frame (1/30 s) late and **pops on a fresh frame**: `fire-half-smear0` f07
  shows the severed stub with no piece, f08 shows the piece mid-air. At full
  rate the piece is already flying one frame earlier. Fast pellets themselves
  are main-pass and stay full rate.
- **`sever-*` — fast movers under half rate.** Slug to the shoulder, chunks
  flying. Chunks are SDF-layer content, so they hold-and-snap like the bodies:
  ballistic arcs become slightly steppy, and a chunk near the frame edge can
  streak vertically where the reproject runs out of held data (edge clamp).
  The vertical streak at the top-right corner in these scenes is **pre-existing
  — it is identical in the full-rate captures** and not a C2 artifact.
- **Occlusion.** With reproject, held-flesh depth is recomputed for the
  current camera, so walls keep cutting into flesh correctly during camera
  motion. Raw hold keeps the stale alpha-depth, as instructed; artifacts from
  newly-occluding geometry were not hunted further.

## Frame-time delta (footnote, as ordered)

Interleaved throughput legs on the page's chunked+fenced bench
(`__sdfGame.bench`, room-4 firefight, adaptive suspended), 3 off/on pairs:

| leg | p50 (ms) | p95 (ms) |
| --- | --- | --- |
| off | 8.31 / 9.47 / 4.72 | 17.71 / 23.78 / 13.59 |
| **on** | **5.53 / 5.60 / 2.42** | **14.84 / 16.07 / 12.04** |

Half-rate was faster in 3/3 pairs (medians: p50 −33 %, p95 −16 %). Same-config
legs disagree by up to 2× on this machine (the spec's known measurement
problem), so treat the magnitude as indicative only; the direction is
structurally expected — half the march+pre-pass work, zero added passes.

## Reproducing

```
. scripts/lab-servers.sh && trap lab_servers_down EXIT
export LAB_VITE_PORT=5277 LAB_CDP_PORT=9277
lab_servers_up
node scripts/sdf-game-half-rate.mjs reel      # the 18 sequences
node scripts/sdf-game-half-rate.mjs gate500   # console-error gate
node scripts/sdf-game-half-rate.mjs parity-cycle c2   # the zero gate
node scripts/sdf-game-half-rate.mjs bench     # interleaved legs
```

## Owner verdict checklist

1. `strafe-half-smear25` vs `strafe-full-smear25` — is the compounded smear
   the degraded LOOK, or broken?
2. `strafe-half-smear0` (reproject) vs `strafe-halfhold-smear0` (raw hold) —
   is tracking worth keeping, or is the raw hold's honest double-image more
   in-style?
3. `fire-half-smear0` f07→f08 and the sever chunks — does the 1/30 s wound
   lag read as weight (hit-lag) or as lag?
4. If the verdict is yes: mode (0 vs 1), smear interaction, and whether
   chunks should opt out (render at full rate) are the follow-up decisions —
   none were tuned here, per the brief.
