# Blobforge mesher comparison — surface nets vs marching cubes vs dual contouring

**Date:** 2026-09-15 · **Dispatch task:** `2026-09-15-blud-mesher-comparison-task-1`
**Review fix-up:** Codex review `c9258e21` corrections in
`2026-09-15-blud-mesher-comparison-fix1`, plus the final CLI/output-ownership
corrections in `2026-09-15-blud-mesher-comparison-fix2` (this branch).
**Question:** does marching cubes (MC) or ALICE-inspired dual contouring (DC)
offer a useful geometry-quality / extraction-cost improvement over Blud's
CURRENT surface nets (SN) for Blobforge export and baked geometry?

**Answer (short, measured):** no universal winner, and the honest result is
narrower than a first pass suggested. Keep surface nets as the runtime/bake
default. For **static export and baked geometry with authored sharp creases on
this fixture set**, dual contouring is the only method that puts geometry at a
true box corner; on a 20 mm cell its triangle-surface corner error is
**0.229 mm** vs **23.09 mm** for both SN and MC. That direction survives grid
phase shifts and a 20° rotated frame, but the absolute advantage is
**fixture- and alignment-specific** (see §4.2), not a universal 100×. MC is
~2× more accurate than SN on smooth surfaces at matched cell and is often the
cheapest of the two high-accuracy methods, but it rounds creases just as SN
does.

This note is the human-readable report. The numbers are regenerated into
[`summary.md`](summary.md) and [`results.json`](results.json); phase/rotation
evidence is in [`sensitivity.md`](sensitivity.md); panels are in
[`panels/`](panels) and the preview page is [`preview.html`](preview.html).

> **Evidence provenance.** Every number below comes from the current
> `summary.md`/`results.json`, generated on this fix branch. The summary header
> records the worktree HEAD, whether the tree was dirty at generation time, and
> a content fingerprint of the comparison sources. The earlier `c9258e21` run
> used the same fixtures but a different timing pass and the pre-fix (incorrect)
> vertex-only sharp probe; its numbers are superseded and are not reused here.

---

## 1. What was built

An isolated CPU experiment under
`src/lab/sdf-zombie/mesher-comparison/` plus `scripts/blob-mesh-compare.ts`.
**No production mesher, renderer or bake default was changed.** The three
methods all sample the same `ScalarField.field(p)` closure on the same
`GridSpec` (identical `min`, `cell`, `dims`), with the same padded bounds.

| file | role |
| --- | --- |
| `types.ts` | `ScalarField`, `IndexedMesh`, shared `GridSpec`, eval + non-finite counting |
| `marching-cubes-tables.ts` | classic 256-entry `EDGE_TABLE`/`TRI_TABLE` (MIT notice in `LICENSE-ALICE-SDF-MIT.txt`) |
| `marching-cubes.ts` | table-based MC, canonical global-edge vertex caching, fixed winding |
| `dual-contouring.ts` | port of ALICE-SDF DC: QEF + Tikhonov, edge refinement, dual connectivity |
| `surface-nets-adapter.ts` | untouched `extractHullSoup` (band 0, distort 1) + correct soup weld |
| `fixtures.ts` | 2 analytic controls, 1 Blud chamfer/groove control, real goblin head region, torn chunk |
| `metrics.ts` | topology, field residual + gradient-normalised residual, point-triangle BVH, sampled bidirectional distance |
| `analysis.ts` | reference build, feature-region presence, triangle-surface sharp probes |
| `sensitivity.ts` | sharp-box grid-phase and rotated-frame sensitivity |
| `render.ts` | tiny z-buffered CPU rasteriser (identical camera/shading panels) |
| `export.ts` | OBJ + GLB writers and read-back/inspect helpers |
| `runner.ts` | method dispatch, shared-grid harness, warmup/repeat timing with rotated order |
| `mesher-comparison.test.ts` | 35 focused tests |
| `LICENSE-ALICE-SDF-MIT.txt` | verbatim upstream MIT permission notice for the ported tables/DC |

### 1.1 Invalid-output contract (review fix 1)

The shared field wrapper (`countedField`) counts **every** evaluation,
including grid corners, DC edge refinement and per-vertex normals, and counts
how many returned non-finite. Any non-finite sample marks **all** of the
affected meshers invalid even when fallback geometry is finite, because
fallback geometry must not be ranked as a success. `IndexedMesh.dropped` now
means **dropped intended geometry**; benign finite fallbacks (e.g. a singular
QEF falling back to its mass point) are reported separately as `fallbacks`.
DC connectivity that cannot find a dual vertex for a sign-changing interior
grid edge is an internal omission and invalidates; intentionally clipped
domain boundaries are classified separately for surface nets via a
boundary-crossing probe. Invalid rows keep their diagnostics but get no
reference comparison, feature probes or export, and the CLI exits **non-zero**
when a requested comparison is incomplete. JSON is written with an explicit
`NaN`/`Infinity` replacer so nothing silently becomes `null`.

### 1.2 CLI path + input safety (review fixes 2 and 3)

`scripts/blob-mesh-compare.ts` validates fixture/method names, finite positive
cell sizes, positive-integer repeats, non-negative-integer warmups, panel cell
sizes and per-fixture `minCell` **before** any mutation. Grid cell and corner
counts are checked against a conservative budget before any large allocation.

**Output ownership contract.** The CLI never recursively deletes a directory
and never infers ownership from a directory *name* (`meshes` is not proof of
anything).

- **Run output (`--out`)** must be empty/nonexistent for a fresh run. To reuse
  a run dir it must carry the tool marker `.blob-mesh-compare-run` **and** the
  exact-file manifest `.blob-mesh-compare-generated.json` written by a previous
  run. Only the regular files named in that manifest are deleted (exact paths,
  no globbing, no first-component collapsing), then the `meshes`/`panels`
  directories are removed **only if now empty**. A populated dir without a
  valid marker+manifest, a corrupt marker, or a dir containing files the
  manifest does not list is rejected untouched with a message telling you to
  use a fresh output directory. Human files are therefore never collateral.
- **Shared evidence (`--evidence`)** is cleaned using the exact-file manifest
  `.blob-mesh-compare-manifest.json` (the committed folder's tracked manifest
  enumerates its current generated files). Only manifest entries that also
  match the allowed generated grammar (`meshes/*.obj|glb`, `panels/*.png`,
  `results.json`, `summary.md`, `preview.html`, `sensitivity.json`,
  `sensitivity.md`) are removed. `README.md`, stray files and any unowned file
  survive. A corrupt manifest or an entry that is absolute, contains `..`, or
  names a non-generated file aborts the cleanup **without deleting anything**.
  Before writing, a generated filename that already exists but is not
  tool-owned is treated as a collision and rejected.
- **Paths** are resolved canonically and must stay inside the repository, avoid
  the root/ancestors and the protected source trees, and the `--out` and
  `--evidence` canonical paths must be disjoint. Symlinked path components are
  refused — including an in-repo alias whose target is a protected tree, and a
  symlinked `meshes`/`panels` inside an otherwise-owned dir — so deletion can
  never escape through a link.

Every run writes an exact-file run manifest for the next regeneration.
`scripts/blob-mesh-compare.test.ts` proves all of the above against throwaway
`mkdtemp` sandboxes with sentinel files, including both reported sentinel
reproductions (an unowned `meshes/human-authored.obj` with no manifest, and an
unowned populated run dir), an unknown nested file inside a genuinely owned
`meshes` dir, README preservation, symlink escape/alias, malformed manifests,
repeated generation, output/evidence overlap and a generated-name collision.

> **Fingerprint note.** These ownership changes are CLI-only and postdate the
extraction fingerprint recorded in `summary.md`/`results.json`. The mesher
algorithms, fixtures and measured geometry/timing numbers are unchanged, so the
committed evidence was **not** regenerated.

## 2. How the numbers are measured (and what they are not)

- **`|field(v)|` is a field residual, not a Euclidean error.** Blud fields are
  not true distances (`march-step-soundness.test.ts`; anisotropic prim scales,
  smooth-min fillets).
- **`resid` = `|field(v)| / |grad field(v)|`** is a per-vertex first-order
  geometric estimate. It needs only the field and the mesh, so it is a
  **field-based** estimate rather than a method-specific one, but it is
  **vertex-distribution-biased**: each mesher distributes vertices differently
  (DC concentrates them at creases), so it is not a uniform surface sample and
  dividing by `|grad|` does not remove that bias or account for
  triangle-interior error.
- **`surf resid`** adds **triangle-centroid** samples to the vertices. For the
  analytic controls the field is exact distance, so these samples are exact
  distances at those points; for Blud-composed fields it is still a residual.
- **`mesh→ref` / `ref→mesh`** is a **sampled bidirectional point-to-triangle
  distance** to a reference (marching cubes at `cell/2`, capped at 5 mm). It is
  approximate, is never called Hausdorff distance, and is omitted (not faked)
  where the tested cell is already 5 mm.
- **Matched-error cost is NOT established.** The reference resolution differs
  per ladder step (20→10 mm, 10→5 mm), so comparing a method's cost at one
  error level against another's at a different error level is not supported by
  this data. Only equal-cell-size cost/geometry comparisons are made.
- **Sharp-crease probes now use nearest TRIANGLE SURFACE distance** (via the
  same `TriBvh`) as the headline; nearest-vertex distance is kept in
  parentheses because it is biased by each mesher's vertex layout.
- **Field evaluations** count every call through the shared counting wrapper,
  including normals and refinement. Extraction time is median of ≥3 measured
  runs after ≥1 warmup, with method order rotated per repeat.
- **Normals differ by method and are not a comparison target.** MC and SN
  evaluate a central-difference field gradient at the final vertex; DC averages
  the Hermite normals gathered from its refined edge intersections. The CPU
  panels shade with **face normals** from the exported triangles, so the panels
  are consistent across methods despite the exported per-vertex normal
  differences.
- **DC departs from upstream's normal gradient epsilon.** This port uses
  `cell * 0.5` (so the gradient step scales with resolution); upstream defaults
  to a fixed `0.001 m`. This is a deliberate departure recorded in
  `dual-contouring.ts`, not a faithful native-runtime reproduction. Native
  ALICE timings are out of scope.

## 3. Fixtures

Validation surface: `character-head` bounds are padded >2 cells at the coarsest
ladder step. The goblin head region (~0.5 m) is used instead of the whole body;
torso/arms/hands/fingers/legs are **omitted** (documented cost control), and the
domain **cuts the neck**, so its meshes are deliberately open there (reported as
boundary edges/crossings, not a mesher defect — identical count for all three
methods). The `torn-chunk` fixture is built through the production
`chunkBakeField` with non-empty torn data.

## 4. Headline results

### 4.1 Sharp creases — the one clear, fixture-specific difference

Nearest **triangle-surface** distance from the true box corner on
`control-sharp-box` (exact analytic field), mm. Vertex-only distance in
parentheses. Lower is better.

| cell | surface nets | marching cubes | dual contouring |
| ---: | ---: | ---: | ---: |
| 20 mm | 23.094 (23.094) | 23.094 (28.284) | **0.229** |
| 10 mm | 11.547 (11.547) | 11.547 (14.142) | **0.114** |
| 5 mm | 5.774 (5.774) | 5.774 (7.071) | **0.057** |

Reading: both SN and MC round the corner by roughly a cell; the vertex-only
probe previously used in `c9258e21` understated MC (28.28 mm) because MC's
nearest vertex is further away even though its surface passes closer. On the
triangle surface SN and MC are identical here, and only DC places geometry at
the corner. The same qualitative effect appears on the synthetic
`chamfer-groove` Blud control (a `sminChamfer` fold and a `groove` channel):
the crease exists in all three, but only DC keeps it sharp.

### 4.2 Sharp-box phase/rotation sensitivity — fixture-specific, not universal

Re-running the analytic box with the grid origin shifted by a fraction of a
cell and with a rotated sampling frame (`sensitivity.md`, `sensitivity.json`).
Triangle-surface corner error, mm:

| 20 mm variant | SN | MC | DC |
| --- | ---: | ---: | ---: |
| phase (0,0,0) | 23.094 | 23.094 | 0.229 |
| phase (+0.23,0,0) | 21.470 | 20.833 | 0.213 |
| phase (+0.5,+0.5,+0.5) | 11.547 | 11.547 | 0.114 |
| phase (+0.25,+0.25,+0.25) | 17.321 | 17.321 | 0.171 |
| rotated 20° about (1,1,0) | 14.691 | 12.326 | 3.085 |

The **direction** (DC closest) is robust across all of these, but the
**absolute** SN/MC error swings from ~11.5 to ~23 mm on a sub-cell shift, and
in the rotated frame DC's error rises to ~3.1 mm — a ~5× rather than ~100×
advantage. No "100× better" claim generalises beyond this axis-aligned box
fixture; treat §4.1 as a measured property of this box at these alignments.

### 4.3 Smooth-surface accuracy at matched cell (sampled mesh→reference median, mm)

| fixture | cell | SN | MC | DC | winner (median) |
| --- | ---: | ---: | ---: | ---: | --- |
| control-sphere | 20 | 0.597 | 0.244 | **0.200** | DC |
| control-sphere | 10 | 0.150 | 0.062 | **0.049** | DC |
| chamfer-groove | 20 | 0.756 | **0.258** | 0.274 | MC |
| chamfer-groove | 10 | 0.179 | **0.062** | 0.073 | MC |
| character-head | 20 | 1.025 | **0.373** | 0.448 | MC |
| character-head | 10 | 0.271 | **0.109** | 0.119 | MC |
| torn-chunk | 20 | 1.918 | **0.727** | 0.840 | MC |
| torn-chunk | 10 | 0.521 | 0.211 | **0.204** | DC |

SN is ~1.4–2.6× worse than MC/DC at matched cell on smooth surfaces. MC and DC
trade rows: on `character-head` at 10 mm MC has the lower median (0.109 vs
0.119) but DC has the lower p95 (0.637 vs 0.743) and lower `surf resid` median
(0.060 vs 0.125 mm). There is no clean aggregate winner between MC and DC on
smooth organic geometry.

**Mechanism, measured:** SN vertices sit systematically **inside** the surface
(e.g. sphere 20 mm: 1856 of 1868 vertices have `field < 0`; DC is the opposite —
24 inside / 1844 outside), because `extractHullSoup`'s Newton pull targets
`field = band*0.6 = 0` and breaks immediately when the value is already ≤ the
target inside. At band 0 the pull therefore does not project inside-starting
vertices. This is a real quality gap, not a measurement artefact.

### 4.4 Extraction cost (median ms; identical grids; node v22.22.1)

| fixture | cell | SN | MC | DC | SN evals | MC | DC |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| character-head | 20 mm | **150** | 178 | 400 | 22 249 | 26 937 | 60 609 |
| character-head | 10 mm | **542** | 1060 | 1910 | 80 448 | 160 165 | 287 593 |
| character-head | 5 mm | **2078** | 7091 | 10 344 | 307 441 | 1 069 713 | 1 563 017 |
| chamfer-groove | 10 mm | **31** | 42 | 91 | 51 452 | 92 393 | 200 025 |
| torn-chunk | 10 mm | **6** | 11 | 19 | 11 713 | 27 049 | 45 853 |
| control-sphere | 20 mm | 13 | **3** | 10 | 27 734 | 47 133 | 98 841 |
| control-sharp-box | 10 mm | 31 | 41 | 67 | 94 395 | 179 153 | 290 165 |

On the character meshes SN is ~3.4× faster than MC and ~5× faster than DC at
5 mm. It is **not universally cheapest**: on the small analytic controls MC is
often faster than SN (sphere 20 mm: 3 ms vs 13 ms; the sub-10 ms rows are noisy
run-to-run). DC's extra cost is the
per-cell Hermite gather (up to 12 refined intersections + normal samples) plus
the QEF solve. These are single-process TypeScript timings on one machine, not
a GPU or FPS claim.

### 4.5 Topology

All three produce **closed, manifold, single-component, positive-volume** meshes
on every closed fixture (0 boundary edges, 0 non-manifold edges, 0 degenerate
triangles, 0 orientation flips at every cell tested). No method produced an
invalid, empty, truncated or non-finite mesh on the shipped fixtures. On
`character-head` all three report the identical **boundary edge count from the
neck cut** (52 / 106 / 230 at 20 / 10 / 5 mm), confirming the open boundary is
the fixture, not a mesher. Surface nets reports 52/106/230 dropped quads on the
head; these are the same boundary clip and are classified as boundary drops, not
internal omissions.

### 4.6 The baseline is not handicapped by block pruning

A fresh labelled **unpruned control** (`distort: Infinity`, production is
`distort: 1`) was run at 20/10 mm on every fixture (`.scratch/mesher-unpruned-fix1`):
vertex counts, triangle counts, boundary edges and non-manifold edges are
**identical** to the pruned baseline. Block-live pruning culls no surface on
these fixtures.

## 5. Visual evidence

`panels/*.png` are CPU-rendered with the **same camera per row and one neutral
material** (`render.ts`), shaded with **face normals** so the three methods are
consistent: a main shaded view per method, a wireframe view for surface nets,
and closeups of the thin ears, the box corner, the chamfer seam, the groove and
the crater rim. Panels are rendered at 20 mm for every fixture and additionally
at **10 mm for the sharp/concave fixtures** (`control-sharp-box`,
`chamfer-groove`) via `--panels-extra 10`. `preview.html` lays them out with
labels, cell size and tris per panel. These resolve geometry, not baked chunk
material parity — material/albedo is out of scope.

## 6. Verdict

The axes are separated deliberately:

- **Implementation correctness:** all three are genuine, vetted implementations
  (table-based MC with interpolated edge vertices and shared-edge welding; a
  faithful DC port with regularized QEF and robust singular/non-finite fallback;
  the untouched production SN extractor). The invalid-output contract (§1.1)
  was added so incomplete/fabricated meshes cannot rank as successes.
- **Geometric quality:** MC is ~2× more accurate than SN on smooth surfaces at
  matched cell; MC and DC trade wins there. On sharp creases **on this box
  fixture**, DC is essentially alone (§4.1), but the magnitude is
  alignment-specific (§4.2). DC also has a measured weakness at **coarse cells
  on the synthetic concave `chamfer-groove` control**: at 20 mm its `resid` max
  is 12.87 mm (worse than SN 6.33 / MC 6.42) and its reference max 8.31 mm,
  because a clamped QEF vertex can sit a full cell from a concave channel. At
  10 mm DC is comparable on that fixture.
- **CPU extraction cost:** SN is fastest on the character/chamfer/torn
  fixtures (~1 : 3.4 : 5 at head 5 mm), but not on the small analytic controls
  where MC is often fastest.
- **Visual confidence:** panels are consistent with the numbers, but they are
  static CPU renders, not gameplay.

**Recommendation (bounded).** Keep surface nets for runtime marching and for
bakes where only smooth flesh is involved. Consider dual contouring as a
**selective, still-tentative** candidate for Blobforge static export and baked
geometry that carries authored sharp features (`chamfer` folds, `groove`
channels, box parts, panel lines) at ≤10 mm; its sharp-crease benefit is real
on this fixture, but the review-scale magnitude needs a real `.blob` character
with authored creases before adoption. Do not adopt MC as a general
replacement: it is ~2× more accurate than SN on smooth surfaces but ~3.4× the
cost and rounds creases like SN. There is no universal winner.

## 7. Limitations / not established

- Region approximation: the head fixture omits the body (documented above).
- The reference surface is a marching-cubes mesh; distances to it are sampled,
  approximate and labelled. No exact Hausdorff distance is claimed.
- At 5 mm the reference would not be finer than the tested mesh, so reference
  distances are **not established** there; only `resid`, `surf resid` and the
  sharp probes are reported at 5 mm.
- **Matched-error extraction cost is not established** (reference resolution
  varies per ladder step).
- Sharp-crease magnitude is fixture/alignment-specific; §4.1 is a box-control
  number, not a universal guarantee.
- `resid`/`surf resid` remain sampling diagnostics; they do not bound
  triangle-interior error for non-analytic fields.
- Timings are single-process TS on one machine (node v22.22.1); native
  ALICE/Rust timings are explicitly out of scope.
- DC's concave-channel behaviour at coarse cells and its `cell*0.5` gradient
  epsilon are measured/documented, not tuned.
- The chamfer-groove fixture uses a synthetic Blud body, not a shipped `.blob`.

## 8. Reproduce

```
# focused tests (comparison + CLI safety) and the production tests it leans on
npx vitest run src/lab/sdf-zombie/mesher-comparison/mesher-comparison.test.ts \
               scripts/blob-mesh-compare.test.ts
npx vitest run src/lab/sdf-zombie/webgpu/surface-nets-cpu.test.ts \
                src/lab/sdf-zombie/chunk-bake-field.test.ts \
                src/lab/sdf-zombie/webgpu/chunk-bake-buffers.test.ts \
                src/lab/sdf-zombie/webgpu/chunk-bake-jobs.test.ts
npx tsc --noEmit

# smoke, then the bounded ladder + committed evidence (incl. 10 mm sharp panels)
npx tsx scripts/blob-mesh-compare.ts --smoke
npx tsx scripts/blob-mesh-compare.ts --cells 20,10,5 --repeats 3 --warmups 1 \
    --panels-cell 20 --panels-extra 10 \
    --out .scratch/mesher-comparison \
    --evidence docs/dev-notes/2026-09-15-mesher-comparison

# labelled unpruned control (baseline fairness check)
npx tsx scripts/blob-mesh-compare.ts --methods surface-nets,surface-nets-unpruned \
    --cells 20,10 --repeats 1 --warmups 0 --out .scratch/mesher-unpruned
```

`npx tsx scripts/blob-mesh-compare.ts --help` documents all options. Large
generated data lives in the gitignored `.scratch/mesher-comparison/`; rerunning
into that path is safe because each run writes the marker + exact-file run
manifest, and only those files are replaced. A `.scratch` dir left by a
pre-manifest (legacy) run is rejected — point `--out` at a fresh directory for
that first rerun. The committed evidence dir holds the compact representative
set (GLB for every fixture/method at 20 mm, OBJ for the head and box, panels
including the 10 mm sharp/concave set, `sensitivity.*`, `results.json`,
`summary.md`, `preview.html`) plus the exact-file manifest
`.blob-mesh-compare-manifest.json`; `README.md` and any unowned file survive
regeneration.

## 9. Upstream provenance and licensing

- **ALICE-SDF**, pinned `1e85ab3591600bd316e3ceaa33df8dbd06cb3219` (v1.12.0),
  MIT OR Apache-2.0, © 2025-2026 Moroya Sakamoto — source of the marching-cubes
  tables (`src/mesh/sdf_to_mesh.rs`) and the dual-contouring algorithm
  (`src/mesh/dual_contouring.rs`). `src/mesh/manifold.rs` was inspected for the
  manifold/watertightness vocabulary. The transcribed tables and DC port are
  used under the **MIT** option; the complete upstream MIT permission notice is
  reproduced verbatim in
  [`src/lab/sdf-zombie/mesher-comparison/LICENSE-ALICE-SDF-MIT.txt`](../../../src/lab/sdf-zombie/mesher-comparison/LICENSE-ALICE-SDF-MIT.txt)
  and recorded in `ATTRIBUTIONS.md`.
- **alice-view**, pinned `a05c803fc8440a07186179e9f1c74baf14b9e85a`, MIT,
  © 2024-2026 Moroya Sakamoto — `src/ui/export.rs` was inspected for the
  OBJ/GLB export entry point only; no code or text was copied from it.
- ALICE-SDF's separate editor/integration licensing categories (VRChat,
  Unreal, Unity, mobile) were **not** consulted or imported.
- The experiments live outside the production tree and ship nothing.

## 10. Handoff

- Branch: `codex/dispatch/2026-09-15-blud-mesher-comparison-fix2` (isolated
  worktree). Not merged or pushed.
- Codex review: rerun §8 and inspect `summary.md` / `sensitivity.md` /
  `results.json` / panels. The evidence header records the worktree HEAD,
  dirty state and source fingerprint.
