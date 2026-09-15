# DC chamfer / groove fidelity — ground truth and a bounded fix

**Date:** 2026-09-15 · **Follow-up to:**
[`../2026-09-15-mesher-comparison/`](../2026-09-15-mesher-comparison/README.md)
**Branch:** `codex/dispatch/2026-09-15-blud-dc-chamfer-fix2` (final review
corrections)
**Base:** accepted comparison at `7f7cc9dc` (branch
`codex/dispatch/2026-09-15-blud-mesher-comparison-fix3`)
**Evidence fingerprint:** `7118f04ae0925328:12ba5bb3` (also recorded in
[`results.json`](results.json))
**Preview:** open [`preview.html`](preview.html) — slice panels put the old DC,
new DC, MC/SN context and the **dense field contour** side by side, plus tight
shaded/wireframe closeups.

> **Scope.** This is one bounded experiment on the synthetic `chamfer-groove`
> fixture plus calibration/regression checks. It does **not** change the
> production mesher, the bake default, the renderer, the original comparison
> evidence, or the existing CLI. The candidate is an experimental DC option,
> not a promoted default.

> **Corrections in this revision (Codex review, 2026-09-15).** The first review
> had six correctness problems (fixed in `…-fix1`); the final narrow review
> added a seventh (fixed in `…-fix2`). The original comparison evidence is
> untouched.
> 1. `fieldContour` was false-position mislabelled as bisection and returned a
>    **stale endpoint residual**, so its "jump" classification measured the
>    wrong point. It is now safeguarded false-position/bisection with forced
>    contraction, an explicit `spatialTol`, evaluation at the **returned**
>    crossing, and hard rejection (`FieldContourError`) of any non-finite grid
>    or refinement sample. §1.1 states the corrected rim result.
> 2. The candidate's box behaviour was **assumed** from axis-aligned rows. It is
>    now measured under the original 20° frame (§3): the candidate *helps*
>    (3.085 → 0.132 mm at 20 mm).
> 3. "All variants closed on every fixture" implied the real head too; limited
>    to the synthetic fixtures. The head's 106-edge neck cut is per-method.
> 4. The real-fixture table labelled `aToB` as "ref→mesh"; it is
>    **mesh→reference**. Both directions are now stored and labelled.
> 5. "Clamp rejected as the cause" overstated it; the honest statement is that
>    **dropping the clamp was not helpful** and a constrained solve was not
>    tested (deferred).
> 6. The head-increase "field error" explanation and the "irreducible operator
>    component" in the pit were unproved causal claims; the first is now
>    labelled speculation, the second is withdrawn (§1.1, §5).
> 7. (fix2) `refineCrossing` treated `|f| <= tol` as convergence and collapsed
>    `lo = hi`. A small residual does **not** bound spatial error for an
>    arbitrary field, so this fabricated a zero-width bracket — the Codex repro
>    (`f = 1e-9·(x − 0.9)` over a 1 m edge) reported x = 0.5 with
>    `maxBracketWidth` 0, a 0.4 m location error sold as 1 µm certainty.
>    Refinement now stops only on the **actual** bracket width (`spatialTol`),
>    `maxIters` exhaustion **throws**, and `maxEndpointJump` uses the **final**
>    one-sided samples. The repro is a regression test in `dc-chamfer.test.ts`.
> Also: the base is the accepted comparison branch `…-blud-mesher-comparison-fix3`,
> and the candidate-vs-`0.02·cell` selection rationale is stated in §2 without
> implying global optimality.

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
(`fieldContour`, dense marching squares with safeguarded false-position/
bisection bracketing and an explicit `spatialTol`,
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
- **The groove rim is a one-sided SIGN BOUNDARY, not a residual-limited
  zero set.** `sdGroove` is gated on the band (`if (inBand <= 0) return a`),
  so just outside the band the field equals the body `a` (here ≈ −14 mm),
  while just inside it the value is `max(a, min(a + depth, inBand))` and
  approaches `0` as `inBand → 0`. The two one-sided bracket samples therefore
  differ by **13.97 mm** even though the refined crossing is spatially
  resolvable. With correct bracketing the reference drives every crossing
  residual to **≤ 0.001 mm** (0 unresolved of 1608 seam / 732 pit crossings),
  and the bracket is pinned to the 1 µm `spatialTol`. The earlier follow-up
  reported "206 of 732 jumps, max |f| ≈ 13.97 mm": that was a bug — the old
  refinement returned a **stale bracket-endpoint value** for `fv`, so its
  reported residual was in fact close to the one-sided jump (≈ 13.97 mm) and
  did not measure the returned point. It is corrected here; the rim still needs
  the operator's band-gate formula plus the one-sided jump to be *classified*,
  but it is **not** an irreducible geometric error.
  A true no-zero jump (a hard step) is a different case, tested separately in
  [`dc-chamfer.test.ts`](../../../src/lab/sdf-zombie/mesher-comparison/dc-chamfer.test.ts).

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
averages the normal across the pit's one-sided rim, so the QEF is solved
against a blended direction. A finer relative step fixes most of it. At the
focus 10 mm cell (`dc-eps-candidate` = 1 mm = upstream's fixed step; measured
with the corrected 0.2 mm reference contour):

| notch-plus-z @ 10 mm (mm) | t2r med/p95/max | r2t med/p95/max | QEF clamps | clamps in region |
| --- | --- | --- | ---: | ---: |
| DC baseline | 0.275 / 3.938 / 5.690 | 0.389 / 6.785 / 8.701 | 72 | 10 / 26 |
| **DC candidate** | **0.042 / 1.873 / 2.360** | **0.044 / 2.323 / 2.914** | 32 | 3 / 26 |
| DC eps 0.02·cell | 0.036 / 1.781 / 2.211 | 0.038 / 2.033 / 2.461 | 24 | 1 / 26 |
| DC baseline, no clamp | 0.289 / 4.251 / 5.789 | 0.409 / 7.009 / 8.900 | 0 | 0 / 26 |
| marching cubes (context) | 0.652 / 3.592 / 4.479 | 1.371 / 5.792 / 7.408 | — | — |
| surface nets (context) | 0.494 / 4.104 / 4.522 | 0.983 / 5.281 / 6.883 | — | — |

The candidate cuts the pit `t2r` tail **2.10×** (p95) / **2.41×** (max) and
`r2t` **2.92×** / **2.99×**, and most QEF clamps **inside the pit** disappear
(10/26 → 3/26). The seam slice is essentially unchanged (`0.012 / 0.096 / 0.156`
for both at 10 mm).

**Reference resolution is not the driver (convergence check).** The reference
is a fixed dense field contour at **0.2 mm** spacing. Re-running the 10 mm
baseline/candidate against a finer **0.1 mm** contour leaves the pit ratios
unchanged: `r2t` p95 ratio 0.342 → 0.343, `t2r` p95 ratio 0.476 → 0.476
(`results.json → referenceConvergence`). The ~2–3× conclusion therefore rests
on a stable reference, not on the contour spacing.

**Cell clamp — dropped, not "rejected".** Removing the post-solve component
clamp makes the pit **worse** (`r2t` p95 7.009 vs 6.785, `t2r` p95 4.251 vs
3.938; at 20 mm `r2t` p95 11.131 vs 10.759). So **dropping the clamp was not
helpful**, and the measured evidence does not motivate a *constrained* QEF
solve. That solver was **not tested** here and is deferred — "dropping the
clamp is worse" does not rule it out.

**Why the bounded `0.1·cell` candidate and not the better-scoring `0.02·cell`.**
`dc-eps-002cell` does score better in the pit at 10 mm (`r2t` p95 2.033 vs
2.323) and 5 mm (0.436 vs 0.501), and ties at 20 mm (9.836 vs 9.832). It was
not selected because it is a 5× finer, **unbounded** relative step with no
independent calibration, while `clamp(0.1·cell, 0.1 mm, 2 mm)` reproduces
upstream ALICE-SDF's fixed 1 mm exactly at the 10 mm focus cell, keeps the
port's resolution-scaling philosophy, and is bounded at both ends. This is a
conservative **provisional** candidate, not a proven global optimum;
`0.02·cell` is a recorded sweep point and a reasonable follow-up.

**One-vertex-per-cell resolution (the residual limit).** At 20 mm the pit is a
14 mm-wide tab with 22 mm-wide side pits — sub-cell geometry. Here even the
candidate leaves a coverage gap (`r2t` p95 9.83 mm vs MC 5.39 mm) because a
single dual vertex cannot represent the pillar; MC covers better only by
rounding. Refining the cell fixes it for both DC variants:

| cell | notch-plus-z `r2t` med/p95/max (mm) | | | |
| --- | --- | --- | --- | --- |
| | **DC baseline** | **DC candidate** | MC | SN |
| 20 mm | 4.385 / 10.759 / 11.285 | 2.487 / 9.832 / 9.847 | 3.603 / 5.392 / 6.207 | 3.435 / 10.794 / 10.808 |
| 10 mm | 0.389 / 6.785 / 8.701 | **0.044 / 2.323 / 2.914** | 1.372 / 5.792 / 7.408 | 0.983 / 5.281 / 6.883 |
| 5 mm | 0.022 / 0.658 / 1.392 | **0.017 / 0.501 / 0.794** | 0.107 / 2.944 / 4.076 | 0.225 / 1.414 / 2.022 |

So the honest verdict is two-part: **the pit error is dominated by resolution
and by the operator's one-sided rim, which a finer cell fixes; within that
limit the finer Hermite step is a real, safe, local improvement.**

---

## 3. Calibration and regressions (no trade on the sharp-feature win)

All DC variants on the synthetic fixtures (`chamfer-groove`, `control-sharp-box`,
`control-sphere`) **pass the closed-edge-incidence checks**: 0 boundary edges,
0 non-manifold edges, 0 orientation flips and no invalidity. This is the edge
incidence result only; it excludes the real head, whose fixture-level neck cut
leaves **106 boundary edges for every method**.

**Sharp box (`control-sharp-box`, exact analytic field).** Worst
triangle-surface distance from the four true corners (mm):

| cell | DC baseline | DC candidate | marching cubes |
| ---: | ---: | ---: | ---: |
| 20 mm | 0.229 | **0.229** | 23.094 |
| 10 mm | 0.114 | **0.114** | 11.547 |
| 5 mm | 0.057 | **0.057** | 5.774 |

On the **axis-aligned** frame the normal step does not touch the box corner at
all — QEF on three orthogonal planes is insensitive to the gradient step — so
DC's sharp-box advantage is preserved exactly there. That does **not** extend
to a rotated frame; see the phase/rotation paragraph below.

**Sphere (`control-sphere`, exact distance).** `normalizedResidual` med/p95 is
unchanged at 10/5 mm (0.103/0.147; 0.026/0.036) and differs only in the 4th
decimal at 20 mm (med 0.470 both; p95 0.599 baseline vs 0.598 candidate),
topology closed, 0 boundary/non-manifold edges.

**Real fixtures @ 10 mm.** Both distance directions are stored and labelled
(`analyzeMesh` calls `bidirectionalDistance(mesh, reference)`, so `aToB` is
**mesh→reference** and `bToA` is **reference→mesh** — the earlier note labelled
`aToB` as "ref→mesh", which was wrong):

| fixture | method | verts | boundary | non-mf | `resid` med | `surf` med | mesh→ref med | ref→mesh med |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| character-head | DC baseline | 4550 | 106 | 0 | 0.185 | 0.060 | 0.119 | 0.125 |
| character-head | DC candidate | 4550 | 106 | 0 | 0.194 | 0.060 | 0.125 | 0.129 |
| character-head | marching cubes | 4602 | 106 | 0 | 0.043 | 0.125 | 0.109 | 0.163 |
| torn-chunk | DC baseline | 656 | 0 | 0 | 0.352 | 0.078 | 0.204 | 0.200 |
| torn-chunk | DC candidate | 656 | 0 | 0 | 0.332 | 0.076 | 0.204 | 0.196 |
| torn-chunk | marching cubes | 654 | 0 | 0 | 0.090 | 0.263 | 0.211 | 0.286 |

The 106 boundary edges on the head are the fixture's neck cut, identical for
every method (as in the original note). The candidate is neutral-to-better on
the torn chunk and **slightly worse on the head** (`resid` 0.185 → 0.194 mm,
mesh→ref median 0.119 → 0.125 mm, ref→mesh median 0.125 → 0.129 mm). **That
increase is a measured fact; the explanation below is speculation, not a
result.** A plausible mechanism is that a precise local gradient tracks
small-scale structure the coarse step averaged out — but no experiment here
isolates field error from sampling/vertex-placement effects, so it is recorded
as an open cost rather than a cause.

**Phase/rotation — candidate MEASURED, not assumed.** The original
`sharpBoxSensitivity` output is re-emitted unchanged (`calibration.sensitivity`,
same phases and 20° frame). A separate `sharpBoxSensitivityVariants` run
(`calibration.candidateSensitivity`) measures the candidate on the same rows.
Axis-aligned phases are step-insensitive, but the **rotated** frame is not, so
the earlier statement that "the candidate does not alter it because it does not
alter box corners" was wrong for rotation:

| cell | frame | DC baseline surf (mm) | DC candidate surf (mm) |
| ---: | --- | ---: | ---: |
| 20 mm | phase (0,0,0) | 0.228662 | 0.228662 |
| 20 mm | 20° about (1,1,0) | 3.084904 | **0.132159** |
| 10 mm | 20° about (1,1,0) | 0.929542 | **0.034262** |
| 5 mm | 20° about (1,1,0) | 0.710533 | **0.062985** |

So the finer step also *helps* the rotated sharp corner (≈23× at 20 mm), and
both paths are confirmed to build with their named step
(`dualContouring.detail.normalEpsilon` = 0.005 vs 0.001 at 10 mm). The direction
of the SN/MC comparison in the original rotated row is unchanged.

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
  neither over-smooths a coarse grid nor under-samples a fine one. It is a
  **provisional** choice, not a proven optimum: `dc-eps-002cell` scores better
  in the pit (see §2) but is finer, unbounded and uncalibrated.
- **Constrained QEF solve: deferred, not ruled out.** Dropping the clamp is
  worse, so there is no measured case *for* a constrained solve here; none was
  attempted and the clamp wording above must not be read as rejecting it.
- **Reported, not "fixed":** the sub-cell pit at 20 mm. The `sdGroove` rim is a
  one-sided sign boundary, but with correct bracketing it is resolvable to
  ≤0.001 mm and is **not** an irreducible geometric error (see §1.1).

## 5. Limitations / not established

- The reference is a **dense field contour on one plane** per region, not a
  surface. `t2r`/`r2t` are 2-D polyline distances and are labelled that way;
  no Hausdorff or global surface error is claimed. It is a fixed **0.2 mm**
  spacing; a 0.1 mm re-run reproduces the pit ratios (see §2).
- The `sdGroove` rim is a **one-sided sign boundary** (the two bracket samples
  differ by ~13.97 mm), but the refined crossing residual is ≤0.001 mm, so the
  pit numbers here do **not** include an irreducible operator component. A true
  hard-step discontinuity (no zero) is a separate tested case: it is still
  spatially bracketed to `spatialTol`, but its returned residual stays above
  `tol`, so it is reported as `unresolvedCrossings`, never as a resolved zero.
- A signed field jump is **not** by itself evidence of irreducible geometric
  error: the boundary can still be approximated to the reference's spatial
  precision.
- The candidate **does not fix** the 20 mm pit (coverage gap remains: `r2t` p95
  9.83 mm vs baseline 10.76 mm, MC 5.39 mm). The improvement is ≈2.9–3.0× at the
  reference→mesh tail and ≈2.1–2.4× at mesh→reference at 10 mm; ≈1.3× (p95) /
  ≈1.8× (max) at 5 mm; not universal.
- The head increase is a **measured cost**; the mechanism offered for it is
  **speculation** and is not established by any experiment here.
- The fixture is synthetic. Before adopting the option, re-check a real `.blob`
  with authored `chamfer`/`groove` features.
- Timings are not re-measured here; this note is about geometry. The candidate
  costs the same field-evaluation structure as the baseline (the step size does
  not change the number of samples).

## 6. Reproduce

```
# focused geometry + slice + variant tests, the probe generator tests, and the
# untouched CLI safety suite
npx vitest run src/lab/sdf-zombie/mesher-comparison/dc-chamfer.test.ts \
               src/lab/sdf-zombie/mesher-comparison/mesher-comparison.test.ts \
               scripts/dc-chamfer-probe.test.ts \
               scripts/blob-mesh-compare.test.ts
npx tsc --noEmit

# regenerate this directory's evidence (README.md is preserved; only
# manifest-owned files are replaced). ~65 s on this machine; includes the
# 0.1 mm reference-convergence pass.
npx tsx scripts/dc-chamfer-probe.ts --out .scratch/dc-chamfer-run \
    --evidence docs/dev-notes/2026-09-15-dc-chamfer

# fast end-to-end check (20 mm only; skips the convergence pass)
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
| `field-slice.ts` | safe field contours (safeguarded false-position/bisection, `spatialTol`, non-finite rejection) + mesh plane slicing + slice distance |
| `dc-variants.ts` | named DC variants + option resolution |
| `dc-chamfer.ts` | ground-truth regions, per-region metrics, clamp tallies, slice rasteriser |
| `sensitivity.ts` | original sharp-box phase/rotation rows (unchanged) + `sharpBoxSensitivityVariants` for the candidate |
| `dc-chamfer-probe.ts` (script) | evidence generator (slices, closeups, calibration, regressions, phase/rotation, reference convergence) |
| `dual-contouring.ts` (extended) | `normalEpsilon`, per-cell diagnostic, clamped/residual counters |
| `panels/`, `meshes/`, `results.json`, `preview.html` | generated evidence |

Upstream provenance/licensing is unchanged from the original comparison note:
the DC port and MC tables remain ALICE-SDF (MIT), see
[`LICENSE-ALICE-SDF-MIT.txt`](../../../src/lab/sdf-zombie/mesher-comparison/LICENSE-ALICE-SDF-MIT.txt).
