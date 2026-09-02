# Hull-refine spike — phase 0 notes

**Date:** 2026-09-02 · **Spec:** [../../superpowers/specs/2026-09-02-sdf-hull-refine-renderer-design.md](../../superpowers/specs/2026-09-02-sdf-hull-refine-renderer-design.md)
**Plan:** [../../superpowers/plans/2026-09-02-sdf-hull-refine-phase0.md](../../superpowers/plans/2026-09-02-sdf-hull-refine-phase0.md)
**Branch:** `claude/sdf-raymarching-performance-3aabd2` (dispatch chain `dispatch/2026-09-02-sdf-hull-refine-phase0-task-{1..5}` merged in)

## What was built

Per-frame GPU surface-nets hull of the wounded, posed field (`surface-nets.wgsl.ts`,
`surface-nets-compute.ts`), drawn front-faced through the SHIPPED march material with
a per-fragment ray override (`createMarchMaterial(..., rays)`: start = hull point,
far bound = hull point + 2·band, a separate steps uniform), wrapped as a
`HullRefineView` that keeps the inner `ZombieGpuView` interface so `createZombieActor`
drives it unchanged. Spike page `sdf-hull-spike.html` / `hull-spike-main.ts`: one
walking, shootable, severable zombie; chunks get their own hulls; toggle + knobs +
seams on `window.__hullSpike`. `march.wgsl.ts`, `lab-main.ts`, `game-main.ts` untouched.

Plan deviations exercised: occupancy is the kernel prologue (per-thread live test —
Tint rejects a barrier behind a workgroup-memory branch, so the broadcast form died);
triangle soup + `drawIndirect`; no vertex normals; 4³ blocks; atomics via
`storage(...).toAtomic()` worked first time.

## The three bugs between "green tests" and "a zombie on screen"

Every one was invisible to the unit suite and only appeared on the page.

1. **Tint rejections at pipeline creation** (dispatch task 4): `meta` is a reserved
   WGSL identifier; `workgroupBarrier()` after a branch on a `var<workgroup>` read is
   non-uniform control flow. Both pinned in `surface-nets.wgsl.test.ts`.
2. **Relaxed step multiplier.** The hull's `marchCfg.y` copied the inner view's lab
   default 0.6. A 4-step walk from +band at 0.6 stops 0.4⁴·band = 1.28 mm short of the
   1.2 mm hit epsilon: EVERY fragment missed and discarded. Task 5 spent 35 min on
   "FrontSide culls the near wall" before it was stopped. Now 1.0 (plain sphere
   tracing, the game's GAME_OMEGA), pinned in `hull-refine-view.test.ts`.
3. **Soup stride.** three pads a `StorageBufferAttribute` of itemSize 3 to vec4 on
   upload (`WebGPUAttributeUtils.js`: "WGSL does not support packed vec3 data in
   storage buffers") and mutates the attribute to itemSize 4. The kernel wrote
   xyzxyz; the vertex stage read a 16-byte stride; the draw was garbage triangles
   spanning the bbox — the "blob" that hid the torso, and task 5's "garbage streaks"
   under a plain material. Diagnosed from the readback (soup y-range 0.18–1.76 m =
   the whole body) against the occupancy view (rasterised fragments a squat blob).
   Now `SOUP_STRIDE = 4`, pinned.

## GPU/CPU parity (unwounded, on the page, `__hullSpike.checkParity()`)

| cellVerts | bad | badFrac | dropped | overflow | grid | blocks |
| --- | --- | --- | --- | --- | --- | --- |
| 8827 | 0 | 0 | 0 | false | 92x112x88 | — |

(dispatch task 4, before the stride fix — cell positions were always right, only the
soup copy was misread.)

## Steps knob — the blend-zone finding

At steps 4 the hull renders with GAPS at the neck, shoulder and wrist: the smooth-min
blend zones, where the field under-reports distance (task 1 measured a gradient
magnitude ≈0.55 there). From +band the true distance is up to band/0.55 ≈ 36 mm and
four sphere-trace steps do not converge. Steps 8 closes every gap at this camera;
12 is indistinguishable from 8. **Default is now 8.** The 2·band far cap (40 mm) was
NOT the limiter at band 0.02 — it still bounds the walk to the band.

## The reel (owner judges)

`scripts/hull-spike-reel.sh docs/dev-notes/2026-09-02-hull-refine-spike/reel-c020-b020-s8 0.02 0.02 8`
— hull (`a-*.png`) vs march (`b-*.png`) on the same frozen scene, via
`perf-r2-parity.mjs --url /sdf-hull-spike.html --seam __hullSpike`.

| item | dir | changed px (a-1 vs b-1) | noise floor (state-1 vs state-2) |
| --- | --- | --- | --- |
| 1 wounded close-up | `reel-c020-b020-s8/1-wounded` | | |
| 2 walk phase 0..3 | `reel-c020-b020-s8/2-walk-{0..3}` | | |
| 3 sever + gib | `reel-c020-b020-s8/3-gib` | | |

Pixel diffs are a SIGNAL only; the owner's eye is the gate.

## Verdict

_pending owner_

## Cost — reported, not gated

The HUD `frameMs` is rAF wall clock and vsync-pinned; it cannot see below 16.7 ms and
is not a bench. The honest number needs the chunked+fenced bench legs on the game
page (phase 2). Phase 0 has only the single-body page and no comparable figure.
Early-Z is deliberately NOT claimed: the shipped `depthNode` + `discard` are kept.
