# Default GPU follow-up — 2026-09-17

The owner accepted `cd2ded50` visually and requested another GPU pass. This
follow-up keeps the existing t16 RGB weights (`7ab8f2fe`), 400×300 march,
800×600 output, and CAS 0.5. It enables conservative empty-tile culling in the
shipped t16/RGB/subpixel upscaler. Marching and shutter blur are unchanged.

## Result

The repeatable win is **about 0.3–0.5 ms in isolated upscaler fences**, including
submission and the new mask passes. A separate pass-profile run attributes
**0.4–0.7 ms less GPU time** to the upscaler. This is not a demonstrated 5 ms
whole-frame saving. Whole-frame timing has noticeable run-to-run variation.

| Frozen view | Isolated stage, dense → culled | GPU upscale attribution, dense → culled | GPU march (dense baseline) |
| --- | --- | --- | --- |
| Room 1, medium, 1 visible body | 1.5 → 1.0 ms | 1.286 → 0.714 ms | 2.733 ms |
| Room 1, close, 1 visible body | 1.6 → 1.3 ms | 1.780 → 1.378 ms | 8.654 ms |
| Room 2, 3 visible bodies | 1.5 → 1.0 ms | 2.039 → 1.303 ms | 2.923 ms |

Marching remains the largest individual GPU pass, particularly in the close-up.
These are different instruments: isolated fences include CPU submission;
completion-order GPU attribution measures incremental timeline cost and depends
on overlap. Do not subtract one column from another or add pass wall durations.

The main six-pair full-frame run (60 frames per leg, alternating AB/BA) had pooled
medians of 11.8 → 10.6 ms, 18.4 → 17.9 ms, and 12.2 → 11.8 ms respectively.
The shorter two-pair profiling follow-up had 9.8 → 10.4 ms, 16.7 → 16.9 ms,
and 12.6 → 11.8 ms. Those reversals are why the claimed improvement is the
repeatable upscaler saving, not a guaranteed full-frame/FPS gain. Both runs and
all per-leg timings are in [results.json](gpu-upscale/results.json).

**Worst case:** when every march texel is covered, there is no work to cull;
the synthetic full-coverage stage went from 1.9 to 2.1 ms. The synthetic empty
stage improved from 1.6 to 1.2 ms, including deliberately nonzero RGB in empty
texels. Culling is limited to t16/RGB/sp without a full-resolution head. Other
models, normal inputs, high graphics and deconvolution retain their pipelines.

## Why the output is preserved

`upReconstruct` can only emit a covered output if the own march texel or a
neighbor in its 3×3 neighborhood has depth < 1. The network can change the
coverage decision, but it cannot create a depth source beyond that neighborhood.
Working backward through the convolutions, L1 outputs can influence a covered
result only within `1 + sum(dilation of layers after L1)` texels of a hit.
For the default [1, 2, 1, 1] dilations, that radius is 5.

A first pass marks occupied 8×8 tiles. A second pass expands that tiny mask by
one neighboring tile in every direction. All convolution passes use this same
conservative mask. The retained tile region contains the full dependency set;
extra retained values are harmless. Skipped fragments write zero to every MRT
attachment, so no target clear or stale-history assumption is required. The
visible arithmetic, weights, feature precision, reconstruction and sharpening
are unchanged.

Both mask targets are 50×38 RGBA8 at the default resolution (15,200 bytes total).
The first prototype scanned an expanded 18×18 source neighborhood per tile;
it passed parity but cost too much on noisy empty inputs. The final two-pass
mask scans each input texel at most once, then expands the small mask texture.

## Verification

- **18 byte-exact GPU comparisons:** three captured game inputs plus five
  synthetic coverage patterns at 35×27, 3×5, and 400×300. Synthetic cases cover
  empty/full images, edge hits, isolated hits and holes, with HDR color values.
  Zero differing output words, coverage mismatches, depth mismatches or nonfinite
  values. The comparison includes CAS 0.5 and uses original, branch-free dense
  shaders as the reference, not merely the candidate with its flag disabled.
- All 18 cases also replace the input with an empty image and reuse the same
  targets; every output returns to exact `(0,0,0,1)` with no stale pixels.
- **117 focused tests passed** across the upscaler, SDF layer and pass timing.
- **Production build passed** (`tsc --noEmit && vite build`); existing bundle-size
  warning only. GPU shader compilation passed with no console errors in the
  successful runs.
- GPU jobs ran alone. No benchmark browser remains; the review Vite server on
  port 5492 is still available.

## Measurement details and reproduction

MacBook Air M3, Chrome 152, actual WebGPU, tracked shipped weights. The simulation,
light clock and random render seed are pinned; VHS is off for stable comparisons.
This is a frozen-view experiment, not an active firefight FPS benchmark.

The debug seam can reconstruct the stage with the **original generated shader**
(`__sdfGameDebug.setUpscaleCullingPipeline(false)`). The live
`__sdfGame.setUpscaleEmptyTileCulling(false)` switch is convenient for inspection,
but keeps a disabled branch in the shader and is not the whole-frame baseline.

```sh
LAB_VITE_PORT=5492 LAB_CDP_PORT=9493 LAB_TMP=/tmp/blud-upscale-culling \
UPSCALE_CULL_OUT=/tmp/blud-upscale-culling/run \
bash -c '. scripts/lab-servers.sh; trap lab_servers_down EXIT; lab_servers_up; node scripts/upscale-culling-perf.mjs'
```

`UPSCALE_CULL_QUICK=1` runs the medium-input parity and isolated timing checks.
`UPSCALE_CULL_PROFILE=1` shortens timing and synthetic coverage for the profiling
follow-up. The normal script also collects valid per-frame pass profiles now.

Two harness traps were caught rather than treated as optimization wins:

1. Backend readiness is earlier than pipeline warm-up completion. A frame can
   show the mesh skeleton while its flesh shader is still pending. Wait for
   `__warmDone`, then verify actual march-depth coverage before measuring.
   Synchronous `step(60)` alone is insufficient.
2. `resolveGpu()` reuses the raw timestamp buffer. Collecting raw boundaries only
   after many separately fenced frames pairs earlier query offsets with the last
   buffer and produces bogus exclusive attribution. The original full-frame
   fences remain valid, but that run's raw pass attribution is discarded.
   The profile run drains `passTimings()` after **each** profiled frame, outside
   the primary fence-timing loop. Its `gpu:idle` includes instrumentation waits
   and must not be interpreted as live gameplay CPU cost.

## March review

The prior empty-tile march gate is already present. Previous entry-miss hoists
and per-step sphere-skip variants were rejected on image parity or performance;
this pass does not reintroduce them. The authored-carve helper still uses
`select(sdPrim(...), sdPrimO(...), ori)` where the main group fold branches.
That is a possible follow-up, but it is gated by authored carves and has not been
measured or changed here. The close-up march budget is the strongest remaining
target for a larger gain.
