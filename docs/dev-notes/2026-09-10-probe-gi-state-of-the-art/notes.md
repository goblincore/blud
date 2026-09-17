# Probe GI: the 2026 state of the art vs Blud's gather, and what to do next

**2026-09-10.** Research briefing (read-only, web + engine source) answering
"the GI is based on a paper from ~5 years ago — has the space moved?" Companion
to `docs/dev-notes/2026-09-10-probe-gather-cost/notes.md`, which has the
measured cost profile.

## Verdict up front

**The architecture is validated, not legacy.** UE 5.8 Lumen's *low-end* tier
(Medium GI, `r.Lumen.FinalGatherMethod 0`) is *"Irradiance Field Gather … places
World Space Radiance Cache probes around pixels, pre-calculates their
irradiance, and interpolates to pixels with **probe occlusion** … targeted at
low-end PC and Switch 2 at 60 fps"*. Flax Engine ships **SDF-based DDGI with
software ray tracing** for exactly the "older hardware without RTX" reason. A
world-space probe scatter-gather with occlusion is the right family.

**There is no maintained "DDGI 2.0" to adopt.** NVIDIA-RTX/RTXGI v2.x
*abandoned* DDGI — its Readme describes *"replacing traditional probe-based
irradiance caching with a world-space radiance cache"* and ships only NRC +
SHaRC, for path tracing, DXR-gated; it redirects DDGI to the **frozen** v1 repo
(last push 2024-02-05, last release v1.3.7 May 2023). The 2.x changelog has
**zero** DDGI entries. So the live references are the DDGI 2019/2021 JCGT papers
and the v1.3 SDK docs — do not go looking for a newer paper to adopt.

## The reference paper, classified honestly

**SDFDDGI** (Hu, Yip, Alonso, Gu, Tang, Jin — [arXiv:2007.14394](https://arxiv.org/abs/2007.14394),
Jul 2020) is a **[PREPRINT — never peer-reviewed]**: no journal ref, no DOI but
the arXiv one, still a submission template. Worth knowing because the design
inherits its *simplifications*, not its optimisations:

| Component | DDGI 2019/2021 / SDFDDGI | Blud's gather |
| --- | --- | --- |
| Probe cage + trilinear | 8-probe | **kept** |
| Fibonacci ray set, per-frame rotation | yes | **kept** |
| Temporal hysteresis | yes | **kept + extended** (asymmetric rise/fall afterglow) |
| Directional storage | octahedral 8×8 radiance / 16×16 visibility | **dropped → SH-L1** |
| Per-texel **distance moments** (mean + mean²) | yes — enables Chebyshev | **dropped → binary per-ray visibility** |
| Chebyshev visibility + self-shadow bias | core anti-leak | **absent** |
| Probe relocation / classification / state machine | yes — DDGI measured **30–50%** | **absent** |
| Direct light at a ray hit | **the frame's shadow map** (DDGI) / RSM (SDFDDGI) | **exact per-light capsule+box sweep** |
| Scene query | HW BVH (DDGI) / analytic SDF primitives + clusters (SDFDDGI) | **linear scan of ~1024 capsule slots** |

**The framing that matters:** this is DDGI's *cheapest* half (SH-L1 + trilinear
+ Fibonacci + hysteresis) bolted to SDFDDGI's *most expensive possible* scene
query (a linear capsule scan, re-run per light). Every fix below is "put back
something one of the two papers already had".

## Correction to my own earlier note

The capsule count is **~45 per body**, so 4–8 bodies on screen is **180–360
capsules**, not 300–900 (900 would need ~20 bodies). `maxCapsules: 1024` is a
3–5× over-allocation. This makes the 6–7 ms look *more* like latency, not less.

## Why it costs 6–7 ms: latency, not arithmetic

Dispatch is `compute(call, caps.maxProbes, [64])` and three.js computes
`ceil(count / size)` = `ceil(400/64)` = **7 workgroups / 448 threads**. An M3
10-core GPU has **1280 ALUs (160 EUs, 1400 MHz, 3.58 TFLOPS FP32, 102.4 GB/s)**
— so the gather fills ~35% of ONE wave, ~2 warps per core, effectively no
latency hiding.

A static op-count model (~95–110 ops + 3 `sqrt` + 2 `div` per capsule test;
6.2M capsule tests with one light, ~25M in a firefight) predicts **0.2–0.7 ms at
full occupancy** and **1–4 ms at 448 threads**, against **6–7 ms measured**.
The ratio is robust because the thread-count shortfall is ~28×. **[INFERRED —
a static instruction-count model, not a measurement.]**

**Calibration worth keeping:** UE 5.5 Lumen's published world-space radiance
cache budget is **300 probes × 32 rays ≈ 9,600 rays/frame**; this gather is
400 × 32 = 12,800 per gather, and at `probeGatherRate = 2` that is **~6,400
rays/frame**. **Blud is already inside Lumen's per-frame ray-budget class.** The
problem is not the ray count — it is the per-ray cost and the *all-or-nothing*
amortisation (every probe shares one phase, so the whole layer strobes and the
afterglow has to cover it).

## Ranked work, with the cheap items first

| # | Fix | Value | Risk |
| --- | --- | --- | --- |
| 1 | `probeGatherRate` 2 → 4 (already exposed `?proberate=`, clamped 1..4) | up to **2×** frame-average, zero new code | ~zero, one value — **but it is a look trade (flash latency), so it needs the owner's gate** |
| 2 | `maxT` early-out + **boxes before capsules** in `kdShadowed` | **~1.5–2×** on the shadow sweep | very low — **DONE, commit `56da3ed3`** |
| 3 | **One thread per (probe, ray) + a reduction** | **5–20×** — the occupancy ceiling | medium-low; kernel is twinned with a tested CPU impl |
| 4 | **Per-probe round-robin budget** (~100 probes/frame, 4-frame cycle) | same average cost, **4× better temporal granularity**, no whole-grid strobe — what Lumen's `r.Lumen.ScreenProbeGather.RadianceCache.NumProbesToTraceBudget` and id Tech 8 (1 cascade of 6 per frame) do | low — a probe-index remap plus a mask |
| 5 | **Sample the shadow map the gather already has** for the flashlight | removes **~50–70%** of the work for the dominant light | medium — see caveats below |
| 6 | Per-direction visibility + distance moments (Chebyshev), and the probe state machine | quality + **20–40%** | low-medium |
| 7 | Segment-AABB cull before the capsule quadratic | 2–5× when bodies are few | low |

### R3 details, because WebGPU forbids the obvious reduction

**There is no `atomic<f32>` in WGSL** ([gpuweb#4894](https://github.com/gpuweb/gpuweb/issues/4894),
open since 2024-09-24, Milestone 3) and **no global memory barrier between
workgroups within one dispatch** ([gpuweb#3774](https://github.com/gpuweb/gpuweb/issues/3774)) —
so a naive single-dispatch cross-workgroup reduction is impossible. Two safe
designs:

- **A — two dispatches.** Pass 1: `compute(fn, 400 * nRays, [64])`, one thread
  per (probe, ray), each writing its SH contribution to a ray buffer
  (400 × 32 × 8 floats ≈ **410 KB**). Pass 2: `compute(fn, 400, [64])`, one
  thread per probe accumulating its 32 records, normalising, blending. No
  atomics, no barriers. Structurally identical to RTXGI's
  `ProbeTraceRGS` → `ProbeBlendingCS`.
- **B — workgroup-per-probe with a shared-memory tree.** `compute(fn, 400, [32])`,
  `var<workgroup> sh: array<vec4<f32>, 32>` (2.5 KB, far under the guaranteed
  16 KB), log-tree with `workgroupBarrier()`, lane 0 blends. **This is Godot's
  `shared SH sh_accum[64]` pattern and DDGI 2021 §7.1's "store incoming shaded
  sample ray hits in shared memory".**

`subgroupAdd()` is a third option — **shipped in Chrome 134** behind the
`subgroups` device feature — but feature-detect it with a shared-memory
fallback; do not make it the only path.

**Do two small quality fixes while in the file:**
- The estimator divides by the **hit count** (`w = 4π·A0 / max(1, nHit)`), which
  biases probes in open space where many rays miss. DDGI divides by **2× the
  cosine-weight sum**. Few lines, improves convergence, not cost.
- `probeDynIrradianceL1`'s clamped-cosine convolution is **correct** (verified:
  `A0 = π`, `A1 = 2π/3`, negative lobes clamped). Not a bug; don't chase it. The
  only nit is that clamping at 0 loses energy where Enlighten uses a non-linear
  model to avoid negative irradiance.

### R5 caveats (shadow-map reuse), which are real

`dungeon-lighting.ts` already enables `SHADOW_HULL_LAYER` on the spotlight's
shadow camera and `deferred-shadows.ts` renders a map with level geometry plus
**inflated character proxies**; `march.wgsl.ts` `LEVEL_SHADOW` already samples
it. The gather binds nothing. Reusing it means:
1. the gather runs one frame behind, so it samples a one-frame-old map
   (acceptable for a layer that already blends — but verify);
2. bodies appear only as **inflated hulls**, so capsule-accurate self-shadowing
   degrades;
3. **muzzle-flash point lights have no shadow map** and must keep the analytic
   path — so this is a *split* path, not a deletion.

## Godot SDFGI is NOT a model for this problem

The deep-dive **denies** the hypothesis. Godot voxelises **only**
`GI_MODE_STATIC` geometry, enforced in the cull: dynamic objects can *receive*
GI but never *contribute* (`renderer_scene_cull.cpp` keeps only
`FLAG_USES_BAKED_LIGHT` instances; that flag ⇔ `gi_mode == GI_MODE_STATIC`). The
"separate dynamic-object handling" idea lives in the unrelated **VoxelGI**
path, and the transferable version of it is **DDGI 2021 §6.3** (static-AABB
probe adjustment; dynamic AABBs expanded by one cell wake Sleeping probes).

Worth taking from Godot anyway: the **scheduler** (only the dirty 8-cell slab
is re-rasterised; everything else is scrolled), **GPU-side compaction +
indirect dispatch** (`atomicAdd` per group, then `dispatchWorkgroupsIndirect` —
core WebGPU, ports directly), **probe-history inheritance on scroll** (no black
re-flash), and its **fixed-point temporal ring** (RGBA16I with 10 fractional
bits + RGBA32I running average, subtract-oldest/add-newest).

**Blocked:** a literal clipmap port. It needs `imageStore`/`imageAtomicOr` on an
`r8unorm` 3D texture plus Vulkan-style **format aliasing**; WebGPU has no
texture atomics and 8-bit read-write needs `texture-formats-tier2`.

## On-stack prior art to read before designing anything

**`speedball-gi`** — "Real-time **BVH-traced** dynamic diffuse GI for
**three.js WebGPU**", npm v0.7.0 (2026-08-20), requires **three >=0.185 <0.186**
— *the exact version this project pins*. It already ships `cascades`, explicit
dirty lanes (`markTransformsDirty` / `markDeformsDirty` / `markTopologyDirty`),
idle-gated structural rebuilds, and `jitterMode: 'gated'` which **holds a stable
sampling basis** for flicker-free lighting — the opposite of the per-frame
`frameSeed` rotation here, and a direct challenge to whether the afterglow is
still needed.

Also on point: **Flax Engine** (SDF + software RT DDGI, Global SDF + Global
Surface Atlas, 6×6/14×14 octahedral maps, 4 cascades, probe states, relocation);
**Chen et al., *Spatial MIS for Real-Time Irradiance Probes*, IEEE TVCG
2026-03-03** (reuses ray-surface intersection data *across* probes to cut
flicker — the literature answer to the afterglow); **Radiance Cascades**
(arXiv 2505.02041 / 2607.20384) — multi-level probes with falling angular
resolution beat a uniform grid at equal cost.

## Representation: L1 is the coarsest thing shipping

- **Static/precomputed probes: SH L2 is the default** (Unity light probes store
  27 floats = 9 per channel; Unity APV exposes L2_0..L2_3 and offers L1;
  Enlighten does both).
- **Dynamic probes: octahedral per-direction maps** (DDGI/RTXGI, Godot, Flax) —
  *not* SH.
- **Ours: SH-L1 radiance** — the coarsest of the three.

Ramamoorthi & Hanrahan: 9 coefficients ≈ 1% average error, and ~99% of the
clamped-cosine energy is in orders 0–2. L1 keeps ~88% of diffuse transfer
energy, so it discards ~12%, almost all the l=2 band. Memory is not the
argument (L1 ≈ 19 KB vs L2 ≈ 43 KB for 400 probes). **But do not spend effort
here before items 1–5** — the scalar-visibility limitation is far larger than
the SH order.

## Hard dead ends — do not spend time on these

- **Hardware ray tracing in WebGPU:** [gpuweb#535](https://github.com/gpuweb/gpuweb/issues/535),
  open since **2020-01-06**, milestone **"Milestone 4+"**, absent from both the
  Merged and Draft lists in the official proposals index. No timeline. Blocks
  the *reference implementations* of DDGI (`Any DXR capable GPU`) and RTXGI 2.x
  (`Any DXR GPU`).
- **`atomic<f32>`:** open, Milestone 3. (Confuse it with `float32-blendable`,
  which shipped in Chrome 132 and is *blending*, not atomics.)
- **NVIDIA NRC / SHaRC as shipped:** Tensor-Core-gated, DXR-gated, ~2.6 ms at
  1080p on desktop RTX — a whole frame budget here. (Mobile NRC *was*
  demonstrated at SIGGRAPH Asia 2025 TC, so the hardware isn't the barrier; the
  WebGPU execution model is.)
- **Godot's clipmap ported literally:** blocked on format aliasing + texture
  atomics, *and* it would not solve the dynamic-body problem anyway.
- **More rays while the dispatch stays at 448 threads**, and **denser probe
  grids** (DDGI's own rule of thumb: a probe every 2–3 m, and "sparse grids
  often look better than dense").

## Software tracing is not deprecated

Epic's docs still explicitly recommend SW RT "for games which cannot afford
Hardware Ray Tracing", and there is no published deprecation of Lumen SW RT.
Also worth noting: UE builds its RT TLAS from **auto-simplified Nanite fallback
meshes** by default, so the industry's HW-RT path traces a proxy too. This
project's SDF-native scene has **no mesh→SDF conversion loss at all** — Lumen's
SW-RT content caveats (walls ≥10 cm, no thin features) are authoring rules here,
not a discretization penalty.
