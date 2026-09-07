# M2 composition review fix — evidence and status (continue-2, 2026-09-07)

Branch `codex/dispatch/2026-09-06-hybrid-deferred-m2-game-composition-review-fix-continue-2`,
base `daaac40f`, head `4237e5df`. Scope: the review-fix correction only (tasks 6/7 untouched).

## Gate result

`LAB_VITE_PORT=5350 LAB_CDP_PORT=9350 scripts/deferred-game-composition-check.sh`
→ **PASS, 16/16 checks, exit 0** (twice: 4237e5df and final artifacts). Plus
`deferred-game-boot-check.sh` 12/12 (incl. legacy), 96/96 focused deferred
Vitest (`NODE_OPTIONS=--no-experimental-webstorage --maxWorkers=2 --minWorkers=1`),
`npx tsc --noEmit` clean.

## The tuning-check root cause (the timeout's open question)

The adapter-refresh chain was **never broken**. Proven with a new raw-G-buffer
seam (`game-deferred-renderer.readSurfaceAt`, one full-attachment read per
attachment, 256-byte row padding respected, half + r32f decode) exposed as
`__sdfGame.readSurfaceAt(ndcX, ndcY)`:

- At the named breech texel (cls 17 = mesh/level-only, depth 0.9664 constant,
  albedo invariant): roughness 0.220 authored → **0.04999** after
  `setGunTuning({roughness:.05, metalness:1})` → exactly **0.5 / 0.2** forced.
- `handNormalScale` 2→6 moves the hand texel's raw normal (L1 0.37) — the map
  re-copy reaches the G-buffer.

The old `fpv` band-mean assertion was the faulty probe: the viewmodel is a
small dark fraction of the 480×290 band, and its metalness is authored at 1
already, so a roughness-only nudge measures band delta 0 while an 80×80 box at
the gun's actual screen position moves 50 lum (post-on) / 18 lum (null path).
The rebuilt stage uses a matte/mirror contrast on BOTH scalars + raw asserts.

## Depth acceptance strengthened (replaces the wall-push claim)

`spawnDepthProbes/clearDepthProbes` (`__sdfGame`): up to three UNREGISTERED
blended depth-tested sprites (R/G/B) — the router leaves unregistered
renderables alone in the forward route, so they only ever composite. Plus
`screenRayToWorld` (exact inverse of `screenPosOf`).

Per stage (null path AND post-aa redirect path — `fxaa+smear on, fisheye 90`
keeps positions unwarped): raw depth at the probe pixels is read back FIRST;
front (0.55 m from body centre) composites → RED (201,9,10); behind (0.12 m
past centre) is depth-rejected → pixel stays flesh (246,201,202); far probe on
the deepest scanned background ray draws → BLUE. `wall-push` is kept only as
an explicitly-labelled image-change sanity.

Honest limits:
- **farCase = deepest-background, not the far sentinel**: the rooms are fully
  enclosed — no sentinel pixel exists in-frame (coarse scan). The strict
  empty-far leg stays conditional in the check; it never fired here.
- Blue probe uses a dominance signature (b>60, b>r+40, b>g+40): the far spot
  varies with pose jitter and the 7×7 sample can straddle the sprite edge.
- The redirect pass uses fxaa+smear only (lens at k=0) — the authored 60°
  lens warps pixel positions and is not probe-compatible.

## Cone-edge

The stage as inherited FIRED the gun per edge shot; each shot painted fresh
random pellet wounds on the measured torso (measured 40-lum confound). Firing
removed; the shoulder-before-cone-gates fix is exactly testable on beam-lit
flesh: **delta 11 ≤ 18 across the ±0.025 rad boundary sweep**. A muzzle-
practical-lit variant needs a wound-free practical-light seam — not built.

## Artifacts

All PNGs + `composition-review-fix-check.json` (pass: true, 16 checks)
regenerated on this HEAD under `docs/dev-notes/2026-09-06-hybrid-deferred-m2/`.
Visual inspection: matte tuning shows the diffuse wood/steel finish, mirror
collapses to spec-only; FPV composite readable in both.

## Known limits / follow-ups (task 6/7 scope, not started here)

- Empty-far-sentinel probe leg needs a scene with visible void (or a seam to
  clear depth) — conditional in the check, unexercised.
- Muzzle-practical cone-edge variant (wound-free practical light).
- setGunTuning restores the authored finish; envMapIntensity has no G-buffer
  effect BY DESIGN (unlit G-buffer rule — env is a lit-stage term the
  deferred frame does not reproduce for the viewmodel; the composed gun is
  correspondingly darker than legacy in equal lighting).
- GAME_DEFERRED_LIGHT_GAIN stays 0.5 (no contrary evidence).
