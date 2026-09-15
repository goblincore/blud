# Blobforge mesher comparison — surface nets vs marching cubes vs dual contouring

**Date:** 2026-09-15 · **Dispatch task:** `2026-09-15-blud-mesher-comparison-task-1`
**Question:** does marching cubes (MC) or ALICE-inspired dual contouring (DC)
offer a useful geometry-quality / extraction-cost improvement over Blud's
CURRENT surface nets (SN) for Blobforge export and baked geometry?

**Answer (short):** no single winner. Keep surface nets as the runtime/bake
default — it is 3–5× cheaper and adequate on organic flesh. For **static
export and baked geometry with authored sharp creases**, selectively use **dual
contouring**: it is the only method that preserves a crease (≈100× smaller
corner error than SN at the same cell), at a one-time 3–5× extraction cost.
Marching cubes improves smooth-surface accuracy ~2× over SN at matched cell for
~1.5–3.5× the cost, but rounds creases as badly as SN, so it is not the tool for
the sharp-feature case.

This note is the human-readable report. The numbers are regenerated into
[`summary.md`](summary.md) and [`results.json`](results.json); panels are in
[`panels/`](panels) and the preview page is [`preview.html`](preview.html).

---

## 1. What was built

An isolated CPU experiment under
`src/lab/sdf-zombie/mesher-comparison/` plus `scripts/blob-mesh-compare.ts`.
**No production mesher, renderer or bake default was changed.** The three
methods all sample the same `ScalarField.field(p)` closure on the same
`GridSpec` (identical `min`, `cell`, `dims`), with the same padded bounds.

| file | role |
| --- | --- |
| `types.ts` | `ScalarField`, `IndexedMesh`, shared `GridSpec`, eval counting |
| `marching-cubes-tables.ts` | classic 256-entry `EDGE_TABLE`/`TRI_TABLE` (provenance in header) |
| `marching-cubes.ts` | table-based MC, canonical global-edge vertex caching, integral winding |
| `dual-contouring.ts` | port of ALICE-SDF DC: QEF + Tikhonov, edge refinement, dual connectivity |
| `surface-nets-adapter.ts` | untouched `extractHullSoup` (band 0, distort 1) + correct soup weld |
| `fixtures.ts` | 2 analytic controls, 1 Blud chamfer/groove control, real goblin head region, torn chunk |
| `metrics.ts` | topology, field residual + gradient-normalised residual, point-triangle BVH, sampled bidirectional distance |
| `analysis.ts` | reference build, feature-region presence, sharp-crease probes |
| `render.ts` | tiny z-buffered CPU rasteriser (identical camera/shading panels) |
| `export.ts` | OBJ + GLB writers and read-back/inspect helpers |
| `runner.ts` | method dispatch, shared-grid harness, warmup/repeat timing with rotated order |
| `mesher-comparison.test.ts` | 29 focused tests |

## 2. How the numbers are measured (and what they are not)

- **`|field(v)|` is a field residual, not a Euclidean error.** Blud fields are
  not true distances (`march-step-soundness.test.ts`; anisotropic prim scales,
  smooth-min fillets).
- **`resid` = `|field(v)| / |grad field(v)|`** is the primary per-vertex
  geometric estimate. It needs only the field and the mesh, so it cannot favour
  a mesher. It is first-order.
- **`mesh→ref` / `ref→mesh`** is a **sampled bidirectional point-to-triangle
  distance** to a fine reference (marching cubes at `cell/2`, capped at 5 mm).
  It is approximate, is never called Hausdorff distance, and is omitted (not
  faked) where the tested cell is already 5 mm. The reference is a mesher, so it
  is itself approximate; the method-independent `resid` is the backstop.
- **`resid` alone cannot see a rounded corner**: MC reports `resid = 0` on the
  sharp box (its vertices lie *on* the box zero set) while its corners are
  rounded by ~1.4 cells. That is why every result is paired with the reference
  distance and the **sharp-crease probe** below.
- **Field evaluations** count every call through the shared counting wrapper,
  including normals and refinement. Extraction time is median of ≥3 measured
  runs after ≥1 warmup, with method order rotated per repeat.
- `|field|` on the controls is exact distance (flagged `exactDistance: true`).
- Memory is reported as working-set buffer sizes where named; no process-peak
  claim is made.

## 3. Fixtures

Validation surface: `character-head` bounds are padded >2 cells at the coarsest
ladder step. The goblin head region (~0.5 m) is used instead of the whole body;
torso/arms/hands/fingers/legs are **omitted** (documented cost control), and the
domain **cuts the neck**, so its meshes are deliberately open there (reported as
boundary edges/crossings, not a mesher defect — identical count for all three
methods). The `torn-chunk` fixture is built through the production
`chunkBakeField` with non-empty torn data.

## 4. Headline results

### 4.1 Sharp creases — the decisive difference

Nearest mesh vertex to the true box corner (`control-sharp-box`, exact analytic
field). Lower is better; cell size in mm.

| cell | surface nets | marching cubes | dual contouring |
| ---: | ---: | ---: | ---: |
| 20 mm | 23.09 mm | 28.28 mm | **0.229 mm** |
| 10 mm | 11.55 mm | 14.14 mm | **0.114 mm** |
| 5 mm | 5.77 mm | 7.07 mm | **0.057 mm** |

SN/MC round the corner by ~1.2–1.4 cells (they place no vertex off a grid edge);
DC places a QEF vertex essentially at the corner (~0.011 cell). This is the
same effect the `chamfer-groove` control shows for a Blud `chamfer` fold and
`groove` channel: the crease is present in all three, but only DC keeps it
sharp.

### 4.2 Smooth-surface accuracy at matched cell (sampled mesh→reference median, mm)

| fixture | cell | SN | MC | DC |
| --- | ---: | ---: | ---: | ---: |
| control-sphere | 20 | 0.597 | 0.244 | **0.200** |
| control-sphere | 10 | 0.150 | 0.062 | **0.049** |
| chamfer-groove | 20 | 0.756 | **0.258** | 0.274 |
| chamfer-groove | 10 | 0.538 | **0.286** | 0.325 |
| character-head | 20 | 1.02 | **0.373** | 0.448 |
| character-head | 10 | 0.271 | 0.109 | **0.119** |
| torn-chunk | 20 | 1.92 | **0.727** | 0.840 |
| torn-chunk | 10 | 0.521 | 0.211 | 0.204 |

SN is ~1.4–2.6× worse than MC/DC at matched cell on smooth surfaces; MC and DC
are close, each winning some rows.

**Mechanism, measured:** SN vertices sit systematically **inside** the surface
(e.g. sphere 20 mm: 1856 of 1868 vertices have `field < 0`; DC is the opposite —
24 inside / 1844 outside), because `extractHullSoup`'s Newton pull targets
`field = band*0.6 = 0` and breaks immediately when the value is already ≤ the
target inside. At band 0 the pull therefore does not project inside-starting
vertices. The sphere volume error at 20 mm is −1.15 % (SN), −0.60 % (MC),
+0.24 % (DC) — a real quality gap, not a measurement artefact.

### 4.3 Extraction cost (median ms; identical grids; node v22.22.1)

| fixture | cell | SN | MC | DC | SN field evals | MC | DC |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| character-head | 20 mm | **150** | 177 | 396 | 22 249 | 26 937 | 60 609 |
| character-head | 10 mm | **534** | 1051 | 1923 | 80 448 | 160 165 | 287 593 |
| character-head | 5 mm | **2059** | 6914 | 10 298 | 307 441 | 1 069 713 | 1 563 017 |
| control-sharp-box | 10 mm | **27** | 32 | 55 | 94 395 | 179 153 | 290 165 |
| chamfer-groove | 5 mm | **74** | 136 | 233 | 208 344 | 599 469 | 1 009 189 |
| torn-chunk | 5 mm | **24** | 73 | 105 | 43 078 | 181 785 | 253 293 |

SN is ~3.4× faster than MC and ~5× faster than DC on the head at 5 mm. DC's
extra cost is the per-cell Hermite gather (up to 12 refined intersections +
normal samples) plus the QEF solve.

### 4.4 Topology

All three produce **closed, manifold, single-component, positive-volume** meshes
on every closed fixture (0 boundary edges, 0 non-manifold edges, 0 degenerate
triangles, 0 orientation flips at every cell tested). No method produced an
invalid, empty, truncated or non-finite mesh. On `character-head` all three
report the identical **boundary edge count from the neck cut** (52 / 106 / 230 at
20 / 10 / 5 mm), confirming that the open boundary is the fixture, not a mesher.

### 4.5 The baseline is not handicapped by block pruning

A labelled **unpruned control** (`distort: Infinity`, production is `distort: 1`)
was run at 20/10 mm on every fixture: vertex counts, triangle counts, boundary
edges and non-manifold edges are **identical** to the pruned baseline, while the
unpruned run costs up to ~2× more. Block-live pruning culls no surface on these
fixtures.

## 5. Visual evidence

`panels/*.png` are CPU-rendered with the **same camera per row and one neutral
material** (`render.ts`): a main shaded view per method, a wireframe view for
surface nets, and closeups of the thin ears, the box corner, the chamfer seam,
the groove and the crater rim. `preview.html` lays them out with labels and the
tris per panel. These resolve geometry, not baked chunk material parity —
material/albedo is out of scope.

## 6. Verdict

The three axes are separated deliberately:

- **Implementation correctness:** all three are genuine, vetted implementations
  (table-based MC with interpolated edge vertices and shared-edge welding; a
  faithful DC port with regularized QEF and robust singular/non-finite fallback;
  the untouched production SN extractor). Evidence: §4.4 topology, §4.5 unpruned
  control, and 29 focused tests.
- **Geometric quality:** MC/DC beat SN by ~2× on smooth surfaces; DC is
  essentially alone on sharp creases (§4.1). But DC has a measured weakness at
  **coarse cells on concave features**: on `chamfer-groove` at 20 mm its
  residual max is 12.9 mm (worse than SN 6.3 / MC 6.4) and its reference max
  8.3 mm, because a clamped QEF vertex can sit a full cell from a concave
  channel. At 10 mm and below DC is comparable. Use DC at ≤10 mm when a
  concave channel matters.
- **CPU extraction cost:** SN ≪ MC < DC (roughly 1 : 3.4 : 5 on the head at
  5 mm).
- **Visual confidence:** panels are consistent with the numbers, but they are
  static CPU renders, not gameplay.

**Recommendation.** Keep surface nets for runtime marching and for bakes where
only smooth flesh is involved. Add dual contouring as a **selective** path for
Blobforge static export and baked geometry that carries authored sharp features
(`chamfer` folds, `groove` channels, box parts, panel lines), invoked at ≤10 mm.
Do not adopt MC as a general replacement: it is ~2× more accurate than SN on
smooth surfaces but ~3.4× the cost and rounds creases exactly as SN does. There
is no universal winner; the value in DC is confined to sharp features.

## 7. Limitations / not established

- Region approximation: the head fixture omits the body (documented above).
- The reference surface is a marching-cubes mesh; distances to it are sampled,
  approximate and labelled. No exact Hausdorff distance is claimed.
- At 5 mm the reference would not be finer than the tested mesh, so reference
  distances are **not established** there; only `resid` and the sharp probes are
  reported at 5 mm.
- Timings are single-process TS on one machine (node v22.22.1); they are not a
  GPU or FPS claim, and native ALICE/Rust timings are explicitly out of scope.
- DC's concave-channel behaviour at coarse cells is measured but not tuned;
  the QEF is upstream's (λ = 0.01, clamp to cell), not a re-optimisation.
- The chamfer-groove fixture uses a synthetic Blud body (documented primitives),
  not a shipped `.blob`.

## 8. Reproduce

```
# focused tests + the production tests the comparison leans on
npx vitest run src/lab/sdf-zombie/mesher-comparison/mesher-comparison.test.ts
npx vitest run src/lab/sdf-zombie/webgpu/surface-nets-cpu.test.ts \
                src/lab/sdf-zombie/chunk-bake-field.test.ts \
                src/lab/sdf-zombie/webgpu/chunk-bake-buffers.test.ts \
                src/lab/sdf-zombie/webgpu/chunk-bake-jobs.test.ts
npx tsc --noEmit

# smoke, then the bounded ladder + committed evidence
npx tsx scripts/blob-mesh-compare.ts --smoke
npx tsx scripts/blob-mesh-compare.ts --cells 20,10,5 --repeats 3 --warmups 1 \
    --out .scratch/mesher-comparison \
    --evidence docs/dev-notes/2026-09-15-mesher-comparison

# labelled unpruned control (baseline fairness check)
npx tsx scripts/blob-mesh-compare.ts --methods surface-nets,surface-nets-unpruned \
    --cells 20,10 --repeats 1 --warmups 0 --out .scratch/mesher-unpruned
```

`npx tsx scripts/blob-mesh-compare.ts --help` documents all options. Large
generated data (full ladder meshes at 20/10/5 mm) lives in the gitignored
`.scratch/mesher-comparison/`; only the compact representative set is committed
here (GLB for every fixture/method at 20 mm, OBJ for the head and box, plus the
panels, `results.json` and `summary.md`).

## 9. Upstream provenance and licensing

- **ALICE-SDF**, pinned `1e85ab3591600bd316e3ceaa33df8dbd06cb3219` (v1.12.0),
  MIT OR Apache-2.0, © 2025-2026 Moroya Sakamoto — source of the marching-cubes
  tables (`src/mesh/sdf_to_mesh.rs`) and the dual-contouring algorithm
  (`src/mesh/dual_contouring.rs`). `src/mesh/manifold.rs` was inspected for the
  manifold/watertightness vocabulary. Copied/translated code carries the
  notice, and `ATTRIBUTIONS.md` records the derivation.
- **alice-view**, pinned `a05c803fc8440a07186179e9f1c74baf14b9e85a`, MIT,
  © 2024-2026 Moroya Sakamoto — `src/ui/export.rs` was inspected for the
  OBJ/GLB export entry point only; no code or text was copied from it.
- ALICE-SDF's separate editor/integration licensing categories (VRChat,
  Unreal, Unity, mobile) were **not** consulted or imported.
- The experiments live outside the production tree and ship nothing.

## 10. Handoff

- Branch: `codex/dispatch/2026-09-15-blud-mesher-comparison` (isolated
  worktree). Not merged or pushed.
- Codex review: rerun §8 and inspect `summary.md` / `results.json` / panels.
