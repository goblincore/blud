# Neural upscale for the flesh layer (ESPCN family) — design

**Date:** 2026-09-11 · **Status:** approved design, owner "lgtm" 2026-09-11
**Supersedes:** the architecture of `docs/superpowers/plans/2026-09-08-neural-upscaling-experiment.md`
(its pairing/capture thinking still applies). The 09-08 "lost to bicubic" result came
from a 1,425-parameter pilot and is **not** a verdict on this approach (owner, 2026-09-11).
**Research write-up:** Obsidian `Claude Notes/Blud/2026-09-11-realtime-neural-upscaling-espcn.md`.

## Goal

March the SDF flesh layer at **400×300** (`sdfScale` 0.5, fields off) and reconstruct it
at **800×600** with a small learned network, so that the result is **as close as possible
to a native progressive 800×600 march** while spending well under the ~8 ms a half-scale
march saves (commit 8140dbdf: fenced frame 16.64 → 8.51 ms, room 4).

The upscaler is a **pipeline stage**, not a mode: fields, temporal accumulation and later
techniques must be able to stack before or after it.

## Background (why this family)

- **SRCNN** convolves after a bicubic upscale, at output resolution — ~3.9B
  multiply-adds/frame at 800×600. Rejected.
- **ESPCN** (Shi et al., CVPR 2016) convolves at the low resolution; the last layer
  emits r²·C channels and **pixel shuffle** places them in 2×2 blocks. Exact 2× here.
- **Colbert et al.** (IEEE Access 2021, arXiv 2107.07647) show the same trained weights
  can run as a **per-output-pixel deconvolution**: identical maths, no r²·C intermediate.
  Their speedups are a cost model only, so both layouts are measured here.

## Architecture

### 1. The stage contract

```
flesh texture (low-res)  ──►  UpscaleStage  ──►  flesh texture (output-res)
  RGBA float                                      RGBA32Float
  rgb = lit linear colour                         same convention
  a   = clip depth; a >= 1.0 means "no flesh"
+ optional aux textures (same size as input)
```

- Input and output use **the convention the composite already reads**
  (`sdf-layer.ts` `COMPOSITE_WGSL`, discard on `w >= 1.0`). The composite reads the
  stage output exactly as it reads `accumTex` today (`sdf-layer.ts:474-478`).
- The layer's post-march work is an **ordered chain of stages**:
  `march → [field weave] → [upscale] → [accumulate] → composite`.
- **Scope of this design's first plan:** only `march → upscale → composite`. While
  `?upscale` is on, fields are forced off and temporal accumulation is refused (console
  warning), mirroring how `setTemporalAccum` forces fields off (`sdf-layer.ts:2041`).
  Stacking is phase P5; the contract is what makes it possible.
- **Depth is never produced by the network.** See §4.

### 2. Network family

All convolutions 3×3, stride 1, **edge-clamped (replicate) borders**, ReLU after every
layer except the last. Cross-correlation with PyTorch index order
`W[out, in, ky, kx]` applied at `F[in](y + ky − 1, x + kx − 1)`.

| Model id | Layers (channels) | MACs/frame at 400×300, colour input |
|---|---|---|
| `s8`  | in → 8 → 8 → 16  | ~0.24B |
| `s16` | in → 16 → 16 → 16 | ~0.62B |
| `s32` | in → 32 → 32 → 16 | ~1.80B |

(`rgb` input set = 4 channels. Both layouts do the same MACs; they differ in memory
traffic. Unmeasured on our GPU.)

- The **last layer emits 16 channels** = 4 sub-pixels × (3 colour residual + 1 coverage
  residual).
- **Pixel-shuffle order is PyTorch's:** `out[c, 2y+i, 2x+j] = last[c·4 + i·2 + j](y, x)`,
  `i` = row offset, `j` = column offset, `c ∈ {r, g, b, coverage}`.
- **Input sets:**
  - `rgb` (4 channels): `rgb` (zeroed where no flesh), `hit` (0/1).
  - `rgbd` (5 channels): `rgb`, `hit`, linear view depth (0 where no hit). The depth
    comes free from the march target's alpha, linearized in the first pass:
    `near·far / (far − d·(far − near))` (WebGPU [0, 1] clip depth, no reversed depth).
  - *(amended 2026-09-11)* The richer `aux` set (normal, albedo, wound mask) moved to a
    P3-prep decision — see §5.
- **Normalization:** the model manifest carries a per-input-channel `scale` and
  `offset`, applied in the first pass. Output residuals are in the input's colour units.
- **Weights are baked into generated WGSL as constants.** A different model is a
  different material. Weights are `Float32Array` in a model object with a manifest
  (id, layer shapes, input set, normalization, weight hash). Random models are seeded
  with `mulberry32`.

### 3. The two inference layouts (same weights)

- **`sp` (sub-pixel):** every layer runs as a fullscreen fragment pass at 400×300.
  The last layer writes 16 channels to 4 RGBA16F targets. A **shuffle pass** at 800×600
  selects the sub-pixel's 4 channels and applies §4.
- **`dc` (deconvolution / per-output-pixel):** hidden layers as in `sp`. The last layer
  runs **at 800×600**: each output pixel computes only its own sub-pixel's 4 channels
  directly from the previous layer's 3×3 low-res neighbourhood, then applies §4 in the
  same pass.
- **WebGPU limit:** the game device uses default limits
  (`maxColorAttachmentBytesPerSample` 32; see `deferred-layer.test.ts:102-121`), so a
  pass writes at most 4 RGBA16F targets = **16 channels**. A 32-channel hidden layer
  is **two passes** (channels 0-15 and 16-31, same inputs). Raising device limits is out
  of scope.
- Intermediate feature targets are RGBA16F, Nearest filtering, no depth buffer. The
  output target is RGBA32Float (depth rides alpha).
- **Fallback, not built:** compute shaders over storage buffers. Recorded risk: compute
  dispatched inside the post-aa render callback stalled the loop (`game-main.ts:1062-1070`),
  and this stage runs inside it.

### 4. Reconstruction of one output pixel (shared by both layouts)

For output pixel `(X, Y)`: `x = ⌊X/2⌋, y = ⌊Y/2⌋, j = X mod 2, i = Y mod 2`;
`sx = j == 1 ? +1 : −1`, `sy = i == 1 ? +1 : −1`.

1. **Candidate texels**, in fixed order: `(x, y)`, `(x+sx, y)`, `(x, y+sy)`,
   `(x+sx, y+sy)`, clamped to the input.
2. **Coverage:** `cov = hit(x, y) + residualCoverage`. Covered iff `cov > 0.5`.
   If not covered → output sentinel `(0, 0, 0, 1.0)`.
3. **Source texel:** the first candidate with `hit = 1`. If none → sentinel.
4. **Depth** = that texel's alpha, verbatim. **Never interpolated.**
5. **Colour** = source texel rgb + `residualRgb`, clamped to ≥ 0.

With all-zero weights and biases this reproduces today's nearest upscale **exactly**
(the zero-model invariant used in tests).

### 5. Richer aux inputs (normal, albedo, wound) — deferred to P3-prep

*(Amended 2026-09-11 while planning.)* Writing aux MRT targets from the lit march
means every material that renders into the march target must write every
attachment. The target is shared by per-body passes, chunks and several material
variants, so a single material without the MRT would make its pipeline invalid.
Getting that right is real work, and it only pays off if aux inputs beat `rgbd`.

- P1/P2 use `rgb` and `rgbd`, which need **no change to the march**. Depth and hit
  (the silhouette signal) are already in the march target.
- P3-prep decides whether richer inputs are worth it, and picks the source: the lit
  march with an optional `mrtNode` (template: `sdfSurfaceMrtNodes`,
  `zombie-gpu.ts:1253-1273`), or the existing deferred G-buffer
  (`deferred-surface.ts`: `albedoRoughness`, `normalMetalness`).
- The shading variables exist in `march.wgsl.ts`: `n` (:3103/3121), `albedo` (:3174),
  `wm` (:3130).

### 6. Integration and flags

New module directory `src/lab/sdf-zombie/webgpu/upscale/`:

| File | Responsibility |
|---|---|
| `upscale-model.ts` | Model type, ladder definitions, seeded random/zero models, manifest + weight hash |
| `upscale-reference.ts` | CPU twin: conv, ReLU, both layouts, §4 reconstruction, on `Float32Array` images |
| `upscale-wgsl.ts` | WGSL generators: hidden conv pass (≤16 out; layer 1 reads the march + aux textures directly and applies normalization — no separate input pass), `sp` last pass, shuffle pass, `dc` last pass |
| `upscale-stage.ts` | three.js wiring: targets sized from input, materials, `render(renderer, inputs) → texture`, pass labels, dispose |

- **`sdf-layer.ts`:** runs the stage after the march and hull passes, before the
  composite (where the accumulation resolve runs, `sdf-layer.ts:1857-1874`). The
  composite reads the stage output by **rebinding the `accumTex` TextureNode's value**
  and setting `accumOn`. The composite shader itself is unchanged, so the default path
  stays bit-identical.
- **`game-main.ts` boot flags** (via `boot-params.ts`, placed like the `?accum` block at
  `game-main.ts:1895-1916`; the scale is set through the game's own `sdfScale` variable,
  per b9fad129):
  - `?upscale=<s8|s16|s32|zero>` enables the stage and sets scale 0.5.
  - `?upscalelayout=<sp|dc>` (default `sp`).
  - `?upscaleinputs=<rgb|rgbd>` (default `rgb`).
  - `?upscaleseed=<int>` (default 1).
- **`__sdfGame` seams:**
  - `setUpscale({model, layout, inputs, seed} | null)` (enabling also sets scale 0.5).
  - `upscaleInfo()` → `{on, model, layout, inputs, seed, weightHash, inSize, outSize, near, far}`.
  - `upscaleSelfCheck({compareLayouts})` compares the GPU output with the CPU twin
    in-page and returns statistics only.
- GPU pass labels: `sdf:upscale:<pass>` via `setPassLabel`.
- **Frame hash** (upscaled layer added when on, per
  `docs/dev-notes/2026-09-10-temporal-accumulation-frame-hash-DECISION.md`) moves to P5.
  Nothing in P1/P2 records hashes with the stage on.

### 7. Paired capture (training data)

Script `scripts/upscale-pairs-capture.mjs`, built from `scripts/sdf-accum-convergence.mjs`
(already renders one frozen state at scales 1.0 and 0.5 via `?frozen=1&vhs=off`,
`freeze`, `setPose`, `step`, `setSdfScale`, pinned clocks).

- Per frame, same frozen simulation state (`setRenderLock(true)` makes `step(n)`
  pure re-renders):
  - **input:** scale 0.5, fields off, lit march target (rgb + clip depth).
  - **target:** scale 1.0, fields off, lit march target at 800×600 — the native
    progressive reference.
  - The manifest records camera `near`/`far`, so depth can be linearized exactly as
    the shader does.
- Readbacks are float (`readRenderTargetPixelsAsync(..., textureIndex)`), with row-stride
  padding removed (`game-main.ts:7887-7909`). **Row 0 = top** in saved files.
- Storage: `.npy` (`<f4`, shape `H×W×C`) per buffer + `manifest.json` (checkout SHA,
  adapter, sizes, channel layout, room, pose/camera, frame ids, simulation hash,
  conventions). Written under a gitignored `.upscale-data/` in the repo root.
- Only tracked `public/assets/lab/*` content is rendered (flesh layer, `vhs=off`), so the
  data may be uploaded to rented compute (RunPod). Pilot cap 5 GB.

## Gates

**Default path:** without `?upscale`, the rendered frame is unchanged. This is
established **by construction** rather than by a before/after GPU hash:
- `COMPOSITE_WGSL` is untouched, and `accumTex` stays bound to `accumNext`.
- No stage passes run (pinned by a fake-renderer pass-sequence test).
- All existing tests and `npm run build` pass.

**G1 — cost (end of P1).** Bench legs in `scripts/sdf-game-bench.mjs`, room 4, median
of 3, repeat-spread section read first:

- **Baselines:**
  - `native-progressive`: scale 1.0, fields off
  - `shipped-default`: today's game
  - `half-nearest`: scale 0.5, fields off
- **Ladder:** `s8/s16/s32 × sp/dc` with `rgb` inputs, plus `s16 × sp/dc` with `rgbd`
  inputs (random weights — cost only, never quality).
- **Headroom** `H = frame(native-progressive) − frame(half-nearest)`.
- **Pass:** at least one ladder leg has `frame ≤ frame(half-nearest) + 0.5·H`, beyond
  repeat spread.
- If `native-progressive` p50 sits within 0.2 ms of a refresh-interval multiple, report it
  as a possible vsync bound and re-measure in a heavier room before judging.

**G1-parity (P1):** in the browser, on a staged frozen frame, for each ladder model and
input set:
- **GPU vs CPU twin, each layout.** The twin emulates the GPU's RGBA16F feature
  storage. Colour relative difference ≤ 2e-3 on pixels covered in both, zero depth
  mismatches, and zero coverage mismatches outside the ±4e-3 band around the coverage
  threshold. Half-float rounding legitimately flips decisions inside that band.
- **`sp` vs `dc`:** colour relative difference ≤ 2e-3; coverage mismatches ≤ 0.5% of
  pixels.
- **The zero model:** coverage and depth identical to the twin (itself identical to a
  nearest upscale by unit test), colour ≤ 1e-6.

**G2 — pairs (end of P2).**
- **Determinism:** rendering the same state twice at the same scale gives max abs
  difference ≤ 1e-6 and identical coverage.
- **Alignment** *(amended 2026-09-11 after the first capture runs)*: registration of
  **linear depth** on interior flesh (`scripts/lib/upscale-registration.mjs`, `mode: 'depth'`).
  - Each input texel's linear depth is compared with the mean linear depth of the 2×2 output
    block it should sample, for output shifts of −2..+2 px, using only texels whose whole
    candidate window is flesh.
  - *Why depth, not colour:* lit colour has HDR highlights (~28) and sub-texel detail whose
    variance inside a 2×2 block exceeds the best-shift colour error, so colour registration
    read a false (0, +1) on a frame whose depth registered at (0.0002, 0.003) px. Colour
    registration is still reported, ungated.
  - The best whole-pixel shift must be (0, 0), and the 2-D quadratic vertex must lie within
    0.25 output px on both axes, with at least 500 interior texels.
  - Coverage IoU (target downsampled by 2×2 majority) stays ≥ 0.85.
  - *Why not the original centroid check:* a coverage-centroid offset is dominated by
    silhouette aliasing between a 400×300 and an 800×600 march (1–3 px measured with no
    misregistration). A centroid over the shared mask is equal by construction, so it
    cannot detect anything. The centroid offset is still reported, but it no longer gates.
- **Orientation:** readbacks preserve texel row order (no flip in the capture code).
  With the camera pitched so the body sits below screen centre, the coverage centroid
  row is > H/2, confirming row 0 = top (the composite's convention, `sdf-layer.ts`
  `TEMPORAL_ACCUM_WGSL` note). The manifest records it.
- A smoke dataset of 3 sequences × 20 frames round-trips through a Python `.npy` loader.

## Testing strategy

- **CPU twin as the reference** (`upscale-reference.test.ts`):
  - `sp` and `dc` agree to 1e-5.
  - The zero model equals nearest.
  - Pixel-shuffle order matches the PyTorch formula on a hand-built tensor.
  - Replicate borders, and the §4 candidate order and sentinel rules.
- **WGSL source tests** (`upscale-wgsl.test.ts`), in the style of `sdf-layer.test.ts`:
  - Generated functions parse with three's `WGSLNodeFunction`.
  - No comments in `wgslFn` parameter lists.
  - Depth is never mixed.
  - Discard/sentinel rule present; flipY present where textures are sampled by texCoord.
- **GPU truth only from the browser scripts:** `scripts/upscale-parity.mjs` (G1-parity),
  the bench legs (G1) and the capture script's checks (G2). Vitest passing is not a GPU
  claim.

## Phases

| Phase | Content | Plan |
|---|---|---|
| **P1** | Stage, model, CPU twin, WGSL both layouts, flags, parity script, bench legs → **G1** | first plan |
| **P2** | Capture script, npy/manifest, determinism/alignment/orientation checks, smoke set → **G2** | first plan |
| P3 | Training: PyTorch (device-agnostic CUDA/MPS; local M3 for overfit/sanity, **RunPod** for volume), ICNR init, L1 + gradient loss, `rgb` vs `rgbd` (+ the §5 richer-aux decision), export to model manifest, PyTorch↔CPU-twin parity | own plan, after G1 picks sizes |
| P4 | Full-res guide: outer shell hull rasterized at 800×600 as a coverage input to the per-output-pixel step | own plan |
| P5 | Live play build with trained weights; stacking (fields on top, accumulation after); owner verdict vs native progressive | own plan |
| later | Temporal reconstruction (VESPCN-style), only if single-frame flicker dominates | — |

## Out of scope

- Raising WebGPU device limits.
- Compute-shader inference.
- ONNX Runtime Web.
- FSR 1 (reference arm in P5 only if needed).
- Changing the march itself beyond the optional aux MRT.
- Any training in P1/P2.
- Shipping anything on by default.
