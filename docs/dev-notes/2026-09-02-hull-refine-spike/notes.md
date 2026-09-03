# Hull-refine spike — phase 0 notes

**Date:** 2026-09-02 · **Spec:** [../../superpowers/specs/2026-09-02-sdf-hull-refine-renderer-design.md](../../superpowers/specs/2026-09-02-sdf-hull-refine-renderer-design.md)
**Plan:** [../../superpowers/plans/2026-09-02-sdf-hull-refine-phase0.md](../../superpowers/plans/2026-09-02-sdf-hull-refine-phase0.md)
**Branch:** `claude/sdf-raymarching-performance-3aabd2` (dispatch chain `dispatch/2026-09-02-sdf-hull-refine-phase0-task-{1..5}` merged, then eight fix commits)

## What was built

Per-frame GPU surface-nets hull of the wounded, posed field (`surface-nets.wgsl.ts`,
`surface-nets-compute.ts`), drawn front-faced through the SHIPPED march material with
a per-fragment ray override (`createMarchMaterial(..., rays)`: start = hull point,
far bound = hull point + 2·band, its own steps uniform), wrapped as a `HullRefineView`
so `createZombieActor` drives it unchanged. Spike page `sdf-hull-spike.html`: one
walking, shootable, severable zombie with the game's flesh + light presets; chunks get
their own hulls; toggle, knobs and seams on `window.__hullSpike` (`setRenderer`,
`setKnobs`, `slugAt/pelletAt/severLimb`, `setCam`, `freeze`, `stepOnce`, `stats`,
`checkParity`, `bench`, `setDebugOcc`). `scripts/hull-spike-drive.mjs` scripts a
headless-Chrome session (js / shot / sleep steps) — every capture below came from it.
`march.wgsl.ts`, `lab-main.ts`, `game-main.ts` untouched.

## Bugs between "green suite" and "a zombie on screen" — all invisible to vitest

1. **Tint rejections** (task 4): `meta` is reserved; a barrier behind a branch on a
   `var<workgroup>` read is non-uniform control flow. Pinned.
2. **Relaxed step multiplier**: the hull copied the inner view's lab default 0.6; a
   4-step walk from +band at 0.6 stops 1.28 mm short of the 1.2 mm hit epsilon and
   EVERY fragment discarded (task 5 burned 35 min on "FrontSide culls"). Now 1.0
   (GAME_OMEGA), pinned.
3. **Soup stride**: three pads itemSize-3 storage attributes to vec4 on upload and
   mutates the attribute; the kernel wrote xyz-packed; the draw was garbage triangles
   (the "blob"). `SOUP_STRIDE = 4`, pinned.
4. **Chunk hulls never extracted** (frozen sever showed legs on the march, nothing on
   the hull): extraction only ran inside `update`; chunks now extract on spawn and in
   the frozen branch.
5. **Extraction order**: the actor uploads wounds + head rotation AFTER `view.update`,
   so hulls carried last frame's craters. `autoExtract=false` + `view.extract()` once
   after `actor.step`.
6. **Extraction cost** (the reason the owner felt "no faster"): task 4's per-thread
   live test = 64 field evals per block, and the nets kernel was dispatched at the
   64 000-block CAPACITY → ~4M field evals/frame deciding emptiness, more than the
   march spends drawing. Now one eval per block broadcast via `workgroupUniformLoad`
   (the builtin that makes the branch provably uniform), dispatch = this frame's
   block/cell counts. Then task 1's vertex pull: 10 iterations × 7 evals (central
   differences) per surface cell = up to 620k evals/frame; now the cell's free
   corner gradient × 4 iterations × 1 eval.

## Steps knob

At 4 steps the hull has gaps at neck/shoulder/wrist (smooth-min blend zones
under-report distance, gradient ≈0.55) and beside craters (the wound zone steps at
0.6·d by design). **8 closes them**; 12/20 indistinguishable. Default 8.

## Parity and look evidence (all A/B on the same page, headless, 1280×800)

- `checkParity()` unwounded: cellVerts 8827, bad 0, dropped 0, overflow false.
- `reel-c020-b020-s8/` (harness A/B/A/B, wounded close-up, walk ×4 phases, sever+gib):
  a-vs-b changed pixels 0.4–0.5 %, hot cells = the HUD text + the crater rim; hull
  repeat pairs at the noise floor (0.01 %).
- `step-diag/sheet.png`: eight stepped poses, hull vs march — match.
- `live-diag/sheet.png`: six live-loop instants, last live hull vs re-extracted — match
  (rules out a loop-timing mismatch).
- `wound-diag/sheet.png`: rest pose without / with a torso crater + occupancy — match,
  occupancy all hits.
- `bench/hull-after-pull.png` vs `march-after-pull.png`: the "stubby arms" are the
  pose (bent arms, fists up, foreshortened) — identical on the march.

Owner (manual, own tab, 2026-09-02): "pretty impressive… slightly less jiggly… pretty
close". Also reported gaps at 20 steps that no headless capture reproduced after fix
5 — needs a re-check on a hard-reloaded tab.

**Not the hull:** wounds on torso SPHERE prims stay viewer-fixed when the body yaws
("billboarding") on BOTH renderers and in the game — a pre-existing `damage.ts
frame()` / `game-actor refreshWounds` yaw-0 contract conflict. Spun off as its own task.

## Cost — reported, not gated. ONE body, close camera, fenced bench

`__hullSpike.bench(90, 15, 3)`: hand-stepped frames, GPU fence per 15, alternating
legs. **Machine load during every run was 15–110** (other agents, Chrome, vitest) —
per the 2026-08-31 warning these deltas are within their own spread. Treat as
indicative only.

| build | march ms/frame | hull ms/frame |
| --- | --- | --- |
| before fix 6 | 32.4 / 28.8 / 29.6 | 41.2 / 41.4 / 40.8 |
| after live-test + dispatch fix | 25.7 / 24.9 / 25.7 | 36.0 / 30.8 / 32.7 |
| after pull rework | 27.6 / 22.3 / 21.8 | 25.4 / 25.4 / 26.8 |
| hull, extraction OFF (draw only) | — | 22.1 / 22.2 |

Reading: at one body the hull is now a WASH — extraction ≈3–4 ms, and the hull draw
costs about what the march costs, because the shipped march already has shell
bounds + omega 1.0 (few miss pixels, ~6 steps/hit) and the post-hit shading (calcNormal,
AO, scatter, wound shadow) is identical on both paths. The spec's crowd win needs
early-Z, which phase 0 deliberately does not claim (shipped `depthNode` + `discard`
kept), and the per-hit shading reduction (tier-2 post-hit prim narrowing) helps both
renderers equally.

## The glitch the owner sees — grazing limbs and the far cap

Owner screenshot (own tab, steps 20): the forearm pointing AT the camera is missing
between elbow and fist; the march twin has it. That is the failure the spec named and
phase 0 never tested: along a limb aligned with the view ray the hull face is grazed,
the walk needs band/sin(theta) of travel to reach flesh, and the far bound
hull + 2·band ends it — steps cannot help, only the cap. `capMul` knob added (far bound
= hull + capMul·band), default **6**; cost lands only on true misses since hits still
break in a few steps. Headless captures (`cap-diag*/sheet.png`, side and follow cameras,
ten instants) never landed the exact arm-forward pose. **Owner confirmed on their own
tab (2026-09-02): fixed at capMul 6, and "clean such that I don't notice" needs
steps 16.** Defaults are now capMul 6 / steps 16.

## Verdict — PARKED (owner, 2026-09-02)

"The hull still has annoying visual glitches so I think we might have to park it for
now since it doesn't seem to offer much benefit at the moment. Maybe with crowds yes…
we can wrap up for now and revisit later." The one-body bench is a wash and the
owner's own tab still showed glitches the headless captures did not; nothing here
justifies phase 2 work today. Everything stays on the branch behind the page toggle
(`march` default) — the renderer, kernels, seams, driver and reel are ready if the
crowd case (early-Z) is ever worth building.

## If it continues (phase 2 candidates, in order of expected value)

1. **Early-Z**: write the hull's raster depth, no frag_depth, and turn misses into a
   band-slack fill instead of `discard` — the only route to the crowd occlusion win.
2. **Amortised extraction**: skip re-extraction for bodies whose pose + wounds are
   unchanged (statues, far crowd).
3. **Post-hit prim narrowing** (tier 2) — helps both paths.
