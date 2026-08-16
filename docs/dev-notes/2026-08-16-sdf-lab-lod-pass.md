# SDF lab LOD pass — what it bought, and why the target needs compute

**Date:** 2026-08-16
**Task:** `X1.4` · follows [the WebGPU parity note](2026-08-16-sdf-lab-webgpu-parity.md)
**Machine:** Apple M3, 960x540, 15 bodies, 23 primitives, WebGPU backend

The goal was 15 bodies from ~36.8 ms to ~16 ms — a 2.3x cut. **LOD does not get
there, and the measurements say no amount of quality reduction would.** This
note records what was measured, what shipped, and what the remaining gap
actually needs, so the next attempt starts from evidence instead of from the
same guesses.

---

## First: the measurement itself

**Wall-clock frame time was hiding everything.** It pins to the vsync interval
the moment there is any headroom, so it cannot tell "twice as fast" from "still
60 fps". One body reads 16.7 ms wall — and 10.9 ms GPU.

`WebGPURenderer({ trackTimestamp: true })` plus `resolveTimestampsAsync()` gives
real GPU pass time, and the lab now shows it. Every number below is GPU time.

Two things that bit while measuring, both of which silently invalidated a run:

- **The browser pane resizing changed the pixel count between readings.** Cost
  is close to linear in pixels, so the same configuration read 63.8 ms at one
  pane size and 141.2 ms at another. Every benchmark now pins
  `renderer.setSize(960, 540, false)` first.
- **Running the test suite on the same machine.** One sweep showed a 78% spike
  on a repeat of an identical configuration. Measure with nothing else running.

Repeatability with both controlled is about **±4%**, so anything under ~8% is
not a result.

---

## What each lever is worth

15 close-packed bodies, full quality baseline, one lever at a time:

| Lever | GPU delta |
| --- | --- |
| March steps 96 → 40 | −15% |
| 23 primitives → 6 (coarse stand-in) | −11% |
| Silhouette noise off | −8% |
| Surface noise / scatter / AO / face, individually | within noise |
| **Everything at once, maximally coarse** | **−24%** |

The step-count result is the surprising one, and it reframes the problem:
cutting the limit by 58% bought 15% because **few rays ever reach the limit**.
They hit the surface or leave the proxy box first. Raising or lowering the cap
mostly changes what the worst pixels do.

### Why it is fill-bound

Sweeping resolution at fixed everything else fits cleanly:

| Pixels | GPU |
| --- | --- |
| 518k (960x540) | 141.2 ms |
| 130k (480x270) | 49.4 ms |
| 32k (240x135) | 26.7 ms |

That is **18.6 ms fixed + 0.237 ms per 1000 pixels** (the fit predicts 26.2 ms
at 32k against 26.7 measured). Cost tracks the number of fragment invocations,
not the work inside each one — which is why shrinking that work barely moves it.

And cost rises **linearly with body count even when bodies hide behind each
other**, because the shader writes `frag_depth` and calls `discard`, which
defeats early-Z. An occluded body marches every one of its pixels anyway. This
is exactly the regression the WebGPU spec flagged when it noted that WGSL has no
equivalent of `EXT_conservative_depth`.

---

## What shipped

- **`lod.ts`** — pure, tested level table. Levels are picked by **projected
  screen height in pixels**, not distance: the same body at the same metres
  deserves different detail at 540p and 1080p, or through a 60° lens versus a
  90° one, and a distance-keyed table cannot express that. Hysteresis (8%)
  stops a body on a boundary strobing between levels.
- **`simplify.ts`** — coarse stand-in, one capsule per limb.
- **Shader guards** — silhouette noise, surface noise, scatter and AO now
  branch out instead of being multiplied by zero. Without the guards, turning a
  feature "off" still paid for it in full; the silhouette fbm runs ~100 times
  per pixel.
- **A tight AABB proxy box** instead of a cube. A standing body is about
  0.6 x 1.8 x 0.35, so the cube covered roughly three times the screen area it
  needed to.
- **Change-detection on the uniform writes.** Applying LOD uniforms every frame
  made the close-packed case ~6% *slower* than no LOD at all, because each write
  dirties a uniform buffer that then has to be re-uploaded. Uniforms are now
  written only when the decision changes.
- **Instrumentation** — GPU ms in the panel, per-lever override buttons, a
  crowd-spread control, and `__sdfLab.stats()` / `resetStats()` for scripted
  sweeps.

### One quality failure worth recording

The first coarse body used the cluster's **bounding radius** as the limb's
thickness. A cluster's bounding sphere spans the limb end to end, so every limb
came out as fat as it was long and the body rendered as a **featureless
mitten** — visibly worse than the level beside it at the same size on screen,
which is the exact pop LOD exists to avoid. Thickness has to come from the
primitives (`radius x min(scale)`, matching what `sdPrim` computes); only
length comes from the bounds. Fixed, and the constant carries the warning.

---

## What LOD is actually worth

LOD can only pay where bodies are small enough to demote:

| Scene | LOD off | LOD on | Delta |
| --- | --- | --- | --- |
| Close pack (all ≥150 px, nothing to demote) | 93.4 ms | 95.2 ms | none |
| Mid spread (levels 0–1) | 68.7 ms | 67.7 ms | within noise |
| Distributed crowd (levels 0–2 in play) | 46.3 ms | 41.5 ms | **−10%** |

The distributed row is three alternating repeats of each condition with nothing
else running; all three "on" readings sit below all three "off" readings, so
the separation is clean even though the effect is close to the noise floor of a
single pair.

An earlier sweep of the same scene showed −19%, and that number is **wrong** —
it was measured against the mitten-shaped coarse body described above. The fat
stand-in was cheaper because it converged in fewer steps, so the extra saving
was paid for entirely in the quality failure. −10% is the figure with a coarse
body that actually looks like the thing it replaces.

This is honest rather than flattering: in the shoulder-to-shoulder bench scene
the whole crowd is close and large, LOD correctly chooses full quality for all
fifteen, and it changes nothing. It earns its keep in a real encounter, where
most of the crowd is at a distance.

---

## Raymarching techniques not yet used

Three from the literature, prompted by
[batchmarching](https://github.com/maximecb/batchmarching/) and
[the partial-evaluation post](https://pointersgonewild.com/2016/05/08/optimizing-ray-marching-through-partial-evaluation/).
ARBM itself is a CPU algorithm and does not port, but its references do.

**1. Relaxed sphere tracing — DONE.** ([Keinert et al. 2014;
Bálint & Valasek 2018](https://people.inf.elte.hu/csabix/publications/articles/eurographics-2018-shortpaper.pdf).)
Plain sphere tracing advances by the full unbounding radius; over-relaxation
advances further and backtracks when the new sphere fails to reach the
previous one. This shader was doing the *opposite* — `stepMul` 0.6, i.e.
**under**-relaxation costing ~1.67x the textbook iteration count — because the
silhouette fbm breaks the Lipschitz bound and a full step can tunnel through
the surface. So the relaxation is conditional on the noise being off, which is
already true of every distant body under LOD. Tunable via `woundCfg2.y`.

**2. Partial evaluation — the best untried idea.** The blog's own proposal is
to specialise the shader per frustum quadrant as the camera moves, and the
author is openly unsure that recompiling on every camera move is viable. It is
not, for us. But the *idea* applies in a form that suits this code far better:
specialise on the body's **structure** rather than on the camera.

The inner loop currently does three `textureLoad`s per primitive per step,
under dynamic loop bounds, with a branch to skip carves. All of that is
interpreter overhead over data that barely changes: which primitives exist,
which are carves, and the cluster ranges change only on a sever or a rebuild.
Generating WGSL with that loop **unrolled and the carve decisions baked in**
removes the branches, the bounds checks and the indirection, leaving only the
endpoint fetches — and those could become uniforms. Regenerate the shader on
structural change, which is rare; the per-frame rig jiggle changes endpoint
VALUES, not structure, so it does not trigger a rebuild.

Worth trying before polygonisation, because it is much smaller and the two are
not exclusive.

**3. Cone marching / multi-resolution.** Bálint & Valasek's second
contribution, and what ARBM builds on. A cheap low-resolution pre-pass marches
with a cone radius equal to the pixel footprint and records a conservative
starting `t` per tile; the full pass starts from there instead of from the
camera. This subsumes the "start at the proxy box entry" idea — it starts at
the last provably-empty distance, which is much further along — and it
composes directly with the half-resolution layer already built, since that
pass is a natural place to hang the pre-pass off.

## The remaining gap

Quality LOD tops out at −24%. Reaching 16 ms needs **fewer fragment
invocations**, not cheaper ones. In rough order of effort:

1. **Render distant bodies at reduced resolution** into a separate target and
   composite by depth. Cost is linear in pixels, so a half-res crowd pass is
   close to a 4x cut on everything it covers — and it follows directly from the
   resolution fit above. This is the cheapest thing with a real shot at the
   target, and it does not need compute.
2. **Compute-based polygonisation** (marching cubes / surface nets). Turns the
   field into a mesh, which gets early-Z, instancing and hardware LOD for free
   — and early-Z is precisely what the raymarcher gives up. This is the reason
   the migration happened; it is still unwritten.
3. **GPU culling**, so occluded bodies stop paying at all.

`EXT_conservative_depth` would have helped and has no WGSL equivalent, so the
occlusion problem cannot be solved in the fragment path. That is a real cost of
the migration and it is now measured rather than predicted.
