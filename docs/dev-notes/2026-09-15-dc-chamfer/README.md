# DC chamfer / groove fidelity — ground truth and a bounded fix

**Date:** 2026-09-15 · **Follow-up to:**
[`../2026-09-15-mesher-comparison/`](../2026-09-15-mesher-comparison/README.md)
**Branch:** `codex/dispatch/2026-09-15-blud-dc-chamfer`
**Base:** accepted comparison at `7f7cc9dc` (branch
`codex/dispatch/2026-09-15-blud-mesher-comparison-fix2`)
**Evidence fingerprint:** `ce0317adbbe06438:07dd327c` (also recorded in
[`results.json`](results.json))
**Preview:** open [`preview.html`](preview.html) — slice panels put the old DC,
new DC, MC/SN context and the **dense field contour** side by side, plus tight
shaded/wireframe closeups.

> **Scope.** This is one bounded experiment on the synthetic `chamfer-groove`
> fixture plus calibration/regression checks. It does **not** change the
> production mesher, the bake default, the renderer, the original comparison
> evidence, or the existing CLI. The candidate is an experimental DC option,
> not a promoted default.

---

## 1. What the user saw and what was actually wrong

The user preferred dual contouring in the original comparison
([`../2026-09-15-mesher-comparison/`](../2026-09-15-mesher-comparison/README.md))
except that it "messes up the chamfer". The follow-up brief flagged that the
earlier reviewer description of MC as "preserving the intended square outline"
was an **unverified assumption**, because the fixture's cutter is a capsule.
That assumption is now settled from the field, and it was wrong in a way that
matters.

### 1.1 The fixture is not what its name implies (ground truth)

`chamferGrooveControl()` is two lobes folded with `sminChamfer` plus a capsule
`sdGroove` cutter (`fixtures.ts`). Measuring the field directly
(`fieldContour`, dense marching-squares with bisection bracketing,
[`field-slice.ts`](../../../src/lab/sdf-zombie/mesher-comparison/field-slice.ts)) gives:

- **The chamfer fold inflates the solid far beyond the lobes.** `sminChamfer`
  uses `k * 4 = 0.12 m`, larger than the 0.075–0.085 m lobes, so the 45° bevel
  becomes the dominant surface: the top of the solid sits near **y ≈ +0.14 m**
  while the lobe tops are only ≈ +0.085 m. The original `FEATURE_REGIONS`
  `chamfer-seam` box (y ≤ 0.12) does not even contain that surface.
- **The groove cutter is buried mid-span.** It is a z-aligned capsule at
  `(x, y) = (0, 0.02)` with `r = 0.018`, while `sdGroove` only acts within
  `width = 0.011 m` of its surface. Across `|z| ≲ 0.12` the cutter surface is
  > 11 mm from the body surface, so the operator changes no crossing there.
  The only place it reaches the surface is near its **±z cap** (`|z| ≈ 0.13`),
  where it removes two side lobes and leaves a **central pillar**. The intended
  recess is therefore an **annular pit with a central tab**, not a square
  channel — so no mesher's square-looking silhouette was ever "intent".
- **The groove rim is a field DISCONTINUITY.** `sdGroove` is gated on the band
  (`if (inBand <= 0) return a`), so just outside the band the field equals the
  body `a`, and just inside it the field jumps to `>= 0`. On the pit slice,
  **206 of 732** refined crossings are jumps (`max |f| ≈ 13.97 mm` at the
  rim), while the seam slice has **0 of 1608**. The crossing *location* is
  bracketed correctly; the field simply does not go to zero there. This is a
  property of the operator and is reported, not smoothed.

### 1.2 The confined region

`CHAMFER_REGIONS` in
[`dc-chamfer.ts`](../../../src/lab/sdf-zombie/mesher-comparison/dc-chamfer.ts)
defines three slices, each with a sampling window and an inset **core** window
so a crop edge cannot be mistaken for a shape:

| region | plane | what it isolates |
| --- | --- | --- |
| `seam` | z = 0 | the flat chamfer bevel (smooth; cutter does not reach) |
| `notch-plus-z` | y = 0.02, z ∈ [0.09, 0.17] | the +z groove pit |
| `notch-minus-z` | y = 0.02, z ∈ [−0.17, −0.09] | the −z groove pit |

Distances in this note are **2-D polyline-to-polyline nearest-segment
distances on one plane, restricted to the core window** (`sliceSymDistance`).
`t2r` = tested mesh → reference; `r2t` = reference → tested (coverage). They are
regional diagnostics, not a surface error and not a Hausdorff bound.

---

## 2. Hypotheses and what the controlled sweep found

Three suspected causes were named in the brief; none was assumed. The sweep ran
in [`dc-variants.ts`](../../../src/lab/sdf-zombie/mesher-comparison/dc-variants.ts):

| variant | Hermite normal step | cell clamp |
| --- | --- | --- |
| `dc-baseline` (**shipped port**) | `cell * 0.5` | yes |
| `dc-eps-002cell` | `cell * 0.02` | yes |
| `dc-eps-1mm` | fixed `0.001 m` (upstream-like) | yes |
| `dc-eps-candidate` (**selected**) | `clamp(0.1 * cell, 0.1 mm, 2 mm)` | yes |
| `dc-baseline-noclamp` (diagnostic) | `cell * 0.5` | **no** |
| `dc-candidate-noclamp` (diagnostic) | `clamp(0.1 * cell, …)` | **no** |

**Normal epsilon (confirmed, bounded).** A coarser-than-feature gradient step
averages the normal across the pit's discontinuous rim, so the QEF is solved
against a blended direction. A finer relative step fixes most of it. At the
focus 10 mm cell (`dc-eps-candidate` = 1 mm = upstream's fixed step):

| notch-plus-z @ 10 mm (mm) | t2r med/p95/max | r2t med/p95/max | QEF clamps | clamps in region |
| --- | --- | --- | ---: | ---: |
| DC baseline | 0.274 / 3.938 / 5.690 | 0.369 / 6.764 / 8.701 | 72 | 10 / 26 |
| **DC candidate** | **0.094 / 1.873 / 2.354** | **0.096 / 2.319 / 2.914** | 32 | 3 / 26 |
| DC eps 0.02·cell | 0.071 / 1.781 / 2.211 | 0.073 / 2.033 / 2.461 | 24 | 1 / 26 |
| DC baseline, no clamp | 0.277 / 4.207 / 5.789 | 0.395 / 6.994 / 8.885 | 0 | 0 / 26 |
| marching cubes (context) | 0.702 / 3.534 / 4.479 | 1.366 / 5.721 / 7.353 | — | — |
| surface nets (context) | 0.467 / 4.167 / 4.584 | 0.975 / 5.289 / 6.883 | — | — |

The candidate cuts the pit coverage tail ~2.1× (p95) / ~2.4× (max) and
`r2t` ~2.9× / ~3.0×, and most QEF clamps **inside the pit** disappear
(10/26 → 3/26). The seam slice is unchanged (`0.012 / 0.096 / 0.156` for both).

**Cell clamp (rejected as the cause).** Removing the post-solve component clamp
makes the pit **worse** (`r2t` p95 8.885 vs 8.701, `t2r` p95 4.207 vs 3.938) and
can emit spikes (`dc-candidate-noclamp` `t2r` max 25.9 mm at 20 mm). The clamp
is protective, so **no cell-constrained solver was implemented** — the evidence
does not support it.

**One-vertex-per-cell resolution (the residual limit).** At 20 mm the pit is a
14 mm-wide tab with 22 mm-wide side pits — sub-cell geometry. Here even the
candidate leaves a coverage gap (`r2t` p95 9.83 mm vs MC 5.39 mm) because a
single dual vertex cannot represent the pillar; MC covers better only by
rounding. Refining the cell fixes it for both DC variants:

| cell | notch-plus-z `r2t` med/p95/max (mm) | | | |
| --- | --- | --- | --- | --- |
| | **DC baseline** | **DC candidate** | MC | SN |
| 20 mm | 4.385 / 10.759 / 11.285 | 2.487 / 9.832 / 9.847 | 3.595 / 5.392 / 6.207 | 3.435 / 10.794 / 10.808 |
| 10 mm | 0.369 / 6.764 / 8.701 | **0.096 / 2.319 / 2.914** | 1.366 / 5.721 / 7.353 | 0.975 / 5.289 / 6.883 |
| 5 mm | 0.022 / 0.574 / 1.261 | **0.017 / 0.409 / 0.688** | 0.107 / 2.923 / 3.973 | 0.211 / 1.405 / 2.022 |

So the honest verdict is two-part: **the pit error is dominated by resolution
and by the operator's discontinuous rim, which a finer cell fixes; within that
limit the finer Hermite step is a real, safe, local improvement.**

---

## 3. Calibration and regressions (no trade on the sharp-feature win)

All DC variants are closed, manifold, single-component meshes with 0 boundary
edges, 0 non-manifold edges, 0 degenerate triangles and 0 orientation flips on
every fixture/cell tested, and none is invalid.

**Sharp box (`control-sharp-box`, exact analytic field).** Worst
triangle-surface distance from the four true corners (mm):

| cell | DC baseline | DC candidate | marching cubes |
| ---: | ---: | ---: | ---: |
| 20 mm | 0.229 | **0.229** | 23.094 |
| 10 mm | 0.114 | **0.114** | 11.547 |
| 5 mm | 0.057 | **0.057** | 5.774 |

The normal step does not touch the box corner at all — QEF on three orthogonal
planes is insensitive to the gradient step — so **DC's sharp-box advantage is
preserved exactly**, and the candidate is not a smoothing fix.

**Sphere (`control-sphere`, exact distance).** `normalizedResidual` med/p95 is
identical between baseline and candidate at 20/10/5 mm
(0.470/0.599 → 0.470/0.598; 0.103/0.147 → 0.103/0.147; 0.026/0.036 unchanged),
topology closed, 0 boundary/non-manifold edges.

**Real fixtures @ 10 mm.**

| fixture | method | verts | boundary edges | non-manifold | `resid` med (mm) | ref→mesh med (mm) |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| character-head | DC baseline | 4550 | 106 | 0 | 0.185 | 0.119 |
| character-head | DC candidate | 4550 | 106 | 0 | 0.194 | 0.125 |
| character-head | marching cubes | 4602 | 106 | 0 | 0.043 | 0.109 |
| torn-chunk | DC baseline | 656 | 0 | 0 | 0.352 | 0.204 |
| torn-chunk | DC candidate | 656 | 0 | 0 | 0.332 | 0.204 |
| torn-chunk | marching cubes | 654 | 0 | 0 | 0.090 | 0.211 |

The 106 boundary edges on the head are the fixture's neck cut, identical for
every method (as in the original note). The candidate is neutral-to-better on
the torn chunk and **slightly worse on the head** (`ref` median 0.119 → 0.125 mm,
`resid` 0.185 → 0.194 mm): on a smooth non-distance field, a precise local
gradient tracks the field's own small-scale error that the coarse step averaged
out. That is the trade, and it is recorded rather than hidden.

**Phase/rotation.** The original sharp-box phase/rotation sensitivity is
re-emitted unchanged in [`results.json`](results.json)
(`calibration.sensitivity`): at 20 mm the DC corner error is 0.229 mm at phase
(0,0,0) and 3.085 mm in the 20°-rotated frame, versus SN 23.094/14.691 and MC
23.094/12.326 — the direction still holds, the magnitude is alignment-specific,
exactly as the original note reported. The candidate does not alter it because
it does not alter box corners.

**Shading cannot hide a defect.** The 3-D closeups in `panels/` are rendered by
the shared [`render.ts`](../../../src/lab/sdf-zombie/mesher-comparison/render.ts)
rasteriser with **face normals** and one neutral material, so the three methods
are shaded identically; the exported per-vertex normals (DC's averaged Hermite
normals vs MC/SN's field gradient) are not used for these panels. The slice
panels are unshaded geometry against the field contour.

---

## 4. Decision

- **Promote nothing to production.** Surface nets remains the runtime/bake
  default. The candidate is an experimental DC option for static export/bake of
  authored sharp/concave features at ≤10 mm.
- **Keep `dc-baseline` explicit and reproducible.** It is the shipped port
  (`cell * 0.5`, clamp), and all original evidence/results are untouched.
- **Selected candidate:** `normalEpsilon = clamp(0.1 * cell, 0.1 mm, 2 mm)`,
  `clampToCell = true` (`dc-eps-candidate`). It is a single-parameter change, at
  10 mm it equals upstream ALICE-SDF's fixed 1 mm step, and it is bounded so it
  neither over-smooths a coarse grid nor under-samples a fine one.
- **Reported, not "fixed":** the groove pit at 20 mm and the discontinuous
  `sdGroove` rim. If a future task needs the pit correct at coarse cells, the
  lever is resolution or a different mesher, not the normal step.

## 5. Limitations / not established

- The reference is a **dense field contour on one plane** per region, not a
  surface. `t2r`/`r2t` are 2-D polyline distances and are labelled that way;
  no Hausdorff or global surface error is claimed.
- The pit rim is a **field discontinuity**; 206 of 732 crossings there are
  jumps. A mesh cannot be "exactly" on a discontinuous zero set, so the pit
  numbers include an irreducible component from the operator itself.
- The candidate **does not fix** the 20 mm pit (coverage gap remains). The
  improvement is ≈2–3× at 10 mm and ≈1.3–1.4× at 5 mm, not universal.
- The head regression is a **small increase** in median residual/reference
  error; it is reported as a cost, not waved away.
- The fixture is synthetic. Before adopting the option, re-check a real `.blob`
  with authored `chamfer`/`groove` features.
- Timings are not re-measured here; this note is about geometry. The candidate
  costs the same field-evaluation structure as the baseline (the step size does
  not change the number of samples).

## 6. Reproduce

```
# focused geometry + slice + variant tests, and the untouched CLI safety suite
npx vitest run src/lab/sdf-zombie/mesher-comparison/dc-chamfer.test.ts \
               src/lab/sdf-zombie/mesher-comparison/mesher-comparison.test.ts \
               scripts/blob-mesh-compare.test.ts
npx tsc --noEmit

# regenerate this directory's evidence (README.md is preserved; only
# manifest-owned files are replaced)
npx tsx scripts/dc-chamfer-probe.ts --out .scratch/dc-chamfer-run \
    --evidence docs/dev-notes/2026-09-15-dc-chamfer

# fast end-to-end check
npx tsx scripts/dc-chamfer-probe.ts --smoke --out .scratch/dc-chamfer-smoke --evidence ''
```

`preview.html` is written into both the run dir and this evidence dir. The
original comparison's CLI (`scripts/blob-mesh-compare.ts`) is unchanged except
for `encodePng` becoming an export; its ownership guards are **reused** by the
follow-up generator (`resolveWithinRoot`, `cleanEvidenceDir`,
`assertEvidencePlan`, marker + exact-file manifest, no recursive delete).

## 7. Files

| file | role |
| --- | --- |
| `field-slice.ts` | dense, bisection-bracketed field contours; mesh plane slicing; slice distance |
| `dc-variants.ts` | named DC variants + option resolution |
| `dc-chamfer.ts` | ground-truth regions, per-region metrics, clamp tallies, slice rasteriser |
| `dc-chamfer-probe.ts` (script) | evidence generator (slices, closeups, calibration, regressions) |
| `dual-contouring.ts` (extended) | `normalEpsilon`, per-cell diagnostic, clamped/residual counters |
| `panels/`, `meshes/`, `results.json`, `preview.html` | generated evidence |

Upstream provenance/licensing is unchanged from the original comparison note:
the DC port and MC tables remain ALICE-SDF (MIT), see
[`LICENSE-ALICE-SDF-MIT.txt`](../../../src/lab/sdf-zombie/mesher-comparison/LICENSE-ALICE-SDF-MIT.txt).
