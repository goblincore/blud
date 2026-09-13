# Neural upscale run 5 — one-step SDF refinement at output resolution

**Date:** 2026-09-13 · **Status:** approved (brainstorm 2026-09-13) · **Owner verdict on run 4:** head kept, "subtle,
not a regression". This spec is the next input on the same head plumbing.

## 1. Problem

The march finds the surface at 400×300 with tens of SDF evaluations per texel. Run 3 showed the s32 net saturating
on that input; run 4 added an output-res *noise* field through a full-res head and moved the picture only subtly,
because skin noise is the smallest relief in the image. The net cannot reconstruct geometry the march never sampled.

Higher target resolution or a different scale factor does not help: the target is already a 16-sample average, and
2× is the sweet spot for single-frame nets (Qualcomm, arXiv 2308.01483; see Obsidian
`Research/2026-09-13-upscaler-sample-the-surface-not-the-march.md`).

## 2. Idea

Finding a surface is expensive; evaluating on a found surface is cheap. Per **output** pixel, interpolate the hit
point from the surrounding march texels, Newton-step onto the true surface with one or two SDF evaluations, take a
finite-difference normal, and re-light it with the march's own lighting. Feed the refined normal and re-lit colour to
the existing full-res head. ~6 SDF evaluations per accepted output pixel versus 60–100 per march texel.

Chosen approach (over refining inside the march kernel): a **separate per-body pass**. Same look on the body
interior; keeps the march kernel's register pressure and its 100-parameter parity contract untouched; costs and
toggles independently. The refinement is a pure WGSL function (hit point, ray, bindings in; refined point and normal
out) so it can move in-kernel later if pass overhead ever becomes the bottleneck.

Rejected: a single fullscreen pass over all bodies — each body binds its own prim data texture, face texture and
segment-volume atlas; fifteen bodies' bindings do not fit one pass.

## 3. Decisions (brainstorm)

- **Head input = refined normal + re-lit colour (+ gate).** The re-lit candidate doubles as a conventional look
  check before any training.
- **Cost: look first, budget later.** Build unbounded with the free gating (hit, detail gate, SDF reject), measure,
  then choose the normal stencil (6-eval central vs 3-eval tetrahedral).
- **Keep bar: two gates, look first.** Gate 1: the raw re-lit view shows relief the shipped image lacks, by the
  owner's eye — else stop before capture. Gate 2: trained head not a regression by eye, interior metric not worse
  than the control.

## 4. Render side — `sdf:refine`

Per-body pass after the march and the detail pass, before the upscale stage; only on normals boots (same
condition as `sdf:detail`). For each body in the march's nearest-first list, draw its proxy box at output
resolution with that body's march bindings. Per output pixel:

1. Ray through the pixel centre from the camera.
2. Gather the 4 surrounding march texels; world hit = march depth along the texel's ray, gated on hit. Bilinear
   interpolation across hit texels only.
3. Evaluate the body's SDF (`mapBody`) at the interpolated point. `|d| > refineReject` (default: one march texel's
   world footprint at that depth) → discard (another body, or an edge — the net keeps owning edges).
4. Newton: advance along the pixel's ray by the signed distance; evaluate; advance once more (2 evals).
5. Normal: central differences at half an output pixel's footprint, the march's `ngBody` code (4 evals).
6. Light the refined point with the march's own lighting fragment (`MARCH_BODY_LIGHT` path) on the refined normal
   so wounds, skin and face terms match the shipped image.
7. Write two rgba16f output-res targets under a depth test (nearest body wins):
   `refineN` = world normal xyz, w = 1 accepted; `refineC` = re-lit linear rgb, w = refined view depth.

Controls: `__sdfGame.setRefine(on)`, `?refine=1`, a frame-stats timer for the pass, and a debug view that shows
`refineC` in place of the shipped image (**Gate 1**). `__sdfGameDebug.readRefine()` returns both targets.

## 5. Capture — dataset v3.2

Two new per-pair files from the same frozen frame, cropped like the target and `detail.npy`:
`refine_n.npy` (2h, 2w, 4) and `refine_c.npy` (2h, 2w, 4). Capture boots `upscale=0&upscalenormals=1&refine=1`.
Loader: optional `Pair.refineN`, `Pair.refineC`; contracts §1 gets two rows; the chain's dataset check requires both
on every pair. ~11 MB/pair → run with `UPSCALE_CAP_GB=9` for ~800 pairs (20 GB free on 2026-09-13).

**Capture smoke (4 pairs), stop gate:** accepted pixels overlap the target flesh mask ≥ 95 %; mean |refine_c −
target| over accepted pixels < mean |nearest-upsampled input − target| over the same pixels. If the candidate is not
already closer to the target than the input, stop.

## 6. Net and training

Head input grows from 10 to 17 channels: shuffled residual (4) ⊕ detail (3) ⊕ nearest input rgb (3) ⊕ refined
normal (3) ⊕ re-lit rgb (3) ⊕ accept gate (1). Same 8-wide 3×3 layer, rgb residual out, last layer zero-init (step 0
= the run-4 head). Flag `head_inputs: "detail" | "detail+refine"` in PyTorch, the TS twin (`assembleHeadInput`) and
WGSL (pass H1 gains two taps), exported in `model.json`; the loader binds the two extra textures only when asked.
Parity fixtures add `refine_n-k.npy`, `refine_c-k.npy`.

Grid on v3.2, same recipe as run 4 (seed, steps, interior weight 2):
- `s32-rgbn-head-int2` — control, detail only, retrained on v3.2.
- `s32-rgbn-headr-int2` — detail + refine.

Gates: G3 (PyTorch vs twin) at the existing 1e-6 class; compile smoke; trained smoke with the bar left at 2e-3 and
the head's known f16 reading (~3e-3, run 4) noted, not hidden. **Gate 2** as in §3.

Non-goals this run: no loss change, no target-filter change — the only variable is the refine input.

## 7. Testing and error handling

- Source-text pins on the refine WGSL: no write on a march miss; reject test precedes any Newton step; normal
  stencil is `ngBody`.
- `scripts/refine-smoke.mjs`: boot with refine on, read both targets back; accepted ⊆ march hits; unit normals;
  compiles on every layout.
- Twin unit tests for the 17-channel assembly and hash; `upscale-trained-parity.ts` on the new fixtures.
- Bench leg `upscale-refine` in `scripts/sdf-game-bench.mjs`, 3 repeats, reported next to `march-half`.
- A model asking for refine on a boot without the pass logs `not loaded` and leaves the stage off (missing-model
  path). The pass is off by default; the shipped boot is untouched until a model that needs it ships.

## 8. Sequence

1. Pass + debug view + toggle + smoke → **Gate 1 (owner look)**.
2. Capture v3.2 + 4-pair smoke with the closeness check → stop if the candidate is not closer than the input.
3. Head inputs in PyTorch / twin / WGSL; parity.
4. Grid, stage `r5-*` → **Gate 2 (owner look + interior metric)**.
5. Bench leg; next-steps note §14; ship decision.

Temporal accumulation (motion vectors from the anchor, warped history, learned blend) is the *following* spec; it
shares the motion-vector work with shutter motion blur, which the owner wants built conventionally first.
