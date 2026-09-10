# Shadow continuity — disconnected character shadows (2026-09-09)

Owner report: character shadows "often disconnected"; zombie shoulder joints
visibly separate in some animations; asked whether a cheap screen-buffer fake
could do better. This task shipped three root fixes plus the screen-space
fake, all on the legacy ship path.

## Diagnosis (code-verified, not speculative)

Character shadows are cast by the INFLATED SPHERE-CHAIN hull
(`occluder-hull.ts`, `SHADOW_HULL_INFLATE 1.15` + `SHADOW_SPAN_STEP 0.75`)
rasterised into the flashlight's spot shadow map — never by the visible body.
Four mechanisms produced "disconnected":

1. **Half-rate desync.** On hold frames the visible marched flesh is the
   previous frame reprojected, but `occluderHull.update()` rebuilt the shadow
   twin from the CURRENT rig pose every tick (`posed()` is always current).
   The shadow led the body by one sub-frame — most visible mid-animation.
2. **Wound over-exclusion.** Hull spheres near a wound were dropped from BOTH
   hulls. Correct for the march-bound occluder hull; wrong for the shadow
   twin, where the sphere is pure depth coverage and the drop bites a hole in
   the silhouette right where the body is wounded.
3. **Shoulder socket pop.** Gait counter-sway (shoulders −0.55·sway vs chest
   +0.6·sway, opposite signs), attack `shoulderDrive` (±0.06, off shoulder
   ~0.162 m from the chest offset at strike — measured), stagger full-amp vs
   0.6× chest, and hop +0.06 all TRANSLATE the shoulder points against the
   chest anchor. The torso silhouette only just contains the shoulder ball at
   rest, so the extremes pop the ball out — in the mesh, and in the shadow
   hull built from the same posed points.
4. **Proxy silhouette mismatch.** The bead-chain at grazing angles (the
   documented SHADOW_SPAN_STEP limit) — addressed only indirectly, by the
   contact term below carrying the near-contact region.

## Shipped

- **Task 1** `occluder-hull.ts` `update(..., { shadow })`: `shadow: false`
  holds the twin at its previous instances; `game-main.ts` tick passes
  `!(sdfLayer.halfRate && sdfLayer.willHold)` — the same condition the visual
  pose holds under. `outerHull` (the march bound) still updates every tick.
- **Task 2** The shadow twin builds with `wounds = []` inside `update()`;
  callers unchanged, occluder half keeps its exclusions.
- **Task 3** `motion.ts`: after the torso-lean block and before the
  reach/carry pivots, each shoulder target is clamped to
  `MOTION_TUNING.shoulderSocket` (0.05 m) displacement relative to its
  authored chest-relative offset (yaw-rotated, plus the lean rotation when
  that block ran — a pivot rotation maps a relative vector by the rotation
  alone). Below the cap: exact no-op. Recoil deliberately lands after the
  clamp (a shot impulse may briefly stretch the socket; verlet reads it as
  impact). Seam: `__sdfGame.setShoulderSocket(cap)` — 0 disables.
- **Task 4** `post-sscs.ts` + post-aa stage: screen-space contact shadows.
  Each level pixel reconstructs its world pos from the capture depth
  (`sceneTarget` gained a sampleable `DepthTexture` — the fieldFull
  precedent) and marches 8 taps toward the flashlight over ≤0.8 m,
  darkening where a tap's depth beats the ray by more than the bias.
  Marched flesh is excluded via `sdfLayer.marchTarget` alpha (< 1 = body
  pixel). Runs BEFORE FXAA (pre-lens, pre-encode), VHS-safe, all-off parity
  untouched (post-aa itself stays neutral; the game page enables it).
  Default ON; `?sscs=off` disables. Legacy path only (the flesh mask is the
  march target's depth-in-alpha; deferred has its own G-buffer, field modes
  repurpose it at half height).

## Verification

- `tsc --noEmit` clean. Full `vitest run src/lab/sdf-zombie`: 3757 pass.
  Two unrelated failures: `surface-nets.wgsl.test.ts` (documented
  pre-existing) and `pack.test.ts`'s glow-count test (fails on clean HEAD —
  the concurrent cyberbride character workstream, not this task).
- Live GPU (vite :5488, frozen scene): game boots, SSCS pipeline builds,
  `__sdfGame.setSscs(false)` A/B is decisively different — the pass renders.
  VHS + SSCS coexist.
- Pin updates required by the intended pose change (all commented in place):
  - `gait-pins.test.ts` stepMotion checksum re-recorded
    (`372401.420656677|444572.567802363`; pre-clamp value kept in a comment).
  - `game-actor-elbow.test.ts` elbow-plane tolerance −1e-6 → −0.05 dot
    (measured −0.021 ≈ 1.2° past straight; the regression class this pins
    reads ~−1), and slug-l may now sever (stored surface hit lands a few cm
    differently; `severs <= 1`).

## Follow-up (same day, owner LGTM + two more asks)

### Junction bridges — the residual shoulder pinch
The clamp fixed the shoulder *position* pop; the owner still saw the shadow
pinch apart at the shoulder. Root: spanning guarantees overlap ALONG a prim,
but where two prims MEET the end spheres fuse in a thin ~2 cm lens (zombie
arm-root sphere vs torso chest sphere) — a pinch a 1024² map rasterises away
at grazing angles. Fix: `buildHullInstances(..., bridges)` — for every
same-body sphere pair that touches in a thin lens or near-misses
(lens < 0.5·rMin AND lens < 0.25·d AND d < rA+rB+0.35·rMin, not contained,
**no third sphere covering the waist between them**), emit one midpoint
sphere overlapping both ends by 0.25·rMin. The intermediateness check is
load-bearing: without it, skip-one pairs along tapered limbs fire ~31 useless
bridges on the zombie (measured 51 → 86 spheres before adding it); with it
the count lands just over the spanned hull and every character stays one
component. Span+bridges only — the occlusion hull stays bit-identical.
Seams: `__sdfGame.setShadowBridges(on)` (pair with `refreshHull()`),
tests in `occluder-hull.test.ts` (junction fixture, cone/doubled no-fire,
wound-respect, zombie budget+component, seam round-trip).

### Shadow hardness — `__sdfGame.setShadowRadius(v)`
The game ran `PCFSoftShadowMap`, whose kernel is fixed and ignores
`shadow.radius` — no hardness knob existed. Switched to `PCFShadowMap`
(game-main): on the WebGPU node path that filter is a 5-tap IGN-rotated
Vogel disk whose radius is a live reference uniform (ShadowFilterNode), so
`__sdfGame.setShadowRadius(v)` tunes edge hardness at runtime, 0 = crisp,
SHADOW_RADIUS = 2 shipped default (dungeon-lighting.ts), clamp 0..8.
Type change needs one reload; radius changes after that are free. Scope:
shapes the shadow MAP only — flesh-side shadows go through the march's own
LEVEL_SHADOW PCF, and the contact term's softness is the SSCS terms' job.
Deferred mode's kernel radius (FLASHLIGHT_SHADOW_KERNEL_RADIUS) unchanged.

### Verification of the follow-up
tsc clean; occluder-hull 36/36; full suite 3778/3780 with only the
documented pre-existing surface-nets failure and one probe-grid TIMING flake
(524 ms vs a 500 ms budget under full-suite parallel load; passes in
isolation at ~210 ms with these changes — confirmed both stashed and
restored). Live on :5488 frozen scene: `setShadowBridges(false)` +
`refreshHull()` A/B runs clean; radius 0 vs 6 visibly changes edge spread.

## Owner tuning surface (live, no rebuild)

- `__sdfGame.setSscs(bool)` / `__sdfGame.setSscsTerm('strength'|'maxDist'|'bias', v)`
  / `__sdfGame.sscsTerms` — contact shadow.
- `__sdfGame.setShoulderSocket(cap)` — socket clamp (0 disables).
- `__sdfGame.setShadowSpan(on, inflate)` + `refreshHull()` — spanning A/B.
- `__sdfGame.setShadowBridges(on)` + `refreshHull()` — junction bridges A/B.
- `__sdfGame.setShadowRadius(v)` / `shadowRadius` — shadow-map edge hardness
  (0 crisp, 2 shipped, 6+ very soft; one reload needed for the PCF type
  switch itself, then live).

## Known limitations / next knobs

- At strength 0.8 the contact term reads as broad dimming: grazing-angle
  surfaces (cobbles, ceiling) self-occlude. At the shipped 0.35 it is
  modest; if the owner wants it tighter, raise `bias` (0.02 → 0.05) or cut
  `maxDist` (0.8 → 0.5) live and judge on a frozen A/B. A slope-scaled
  threshold (bias + k·t) is the next structural fix if bias alone can't
  separate grazing self-hits from real silhouette blocks.
- The pass treats the flashlight as a point (spot cone ignored) — darkening
  outside the cone is invisible in practice.
- The flesh mask is the full-rate march target: stale by one frame on hold
  frames (soft mask, accepted).
- Character-to-character shadows on flesh remain out of scope (unchanged
  spec boundary).
