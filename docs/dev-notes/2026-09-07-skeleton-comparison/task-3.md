# Skeleton comparison — Task 3: sampled skeleton SDF prototype

Status: **CPU COMPLETE / GPU NOT STARTED** — task-3a recovery on branch
`codex/dispatch/2026-09-08-skeleton-task-3a-sampler-recovery`, base
85e89288 (timed-out task-3 attempt), recovery commit 5e4b38a6.

## What ACTUALLY exists vs. what the stale draft claimed

The pre-recovery version of this note described `volume.wgsl.ts`, a
`?skeleton=volume` selector and march integration as designed-and-implied.
**None of that exists.** As of 5e4b38a6 the tree contains:

| Piece | Status |
| --- | --- |
| `volume.ts` — CPU bake/sample/cache/atlas | **Implemented + tested** |
| `volume.test.ts` — 12 tests incl. Lipschitz premise | **12/12 pass** |
| `volume.wgsl.ts` — GPU atlas sampler | **NOT WRITTEN** (task 3b) |
| `?skeleton=volume` selector branch | **NOT WRITTEN** (`resolveSkeletonMode` still returns only `procedural`/`mesh`) |
| game-main / forward-renderer wiring | **NOT WRITTEN** (task 3b) |

## Implemented CPU design (volume.ts)

- `bakeSegmentGrid(source, cellSize = VOLUME_CELL = 0.005)` — Float32
  distance grid per `BoneFieldSource`, segment-local, nodes = EXACT
  `source.distance` values; dims from contract `bounds` + 1.5-cell margin.
- `sampleSegmentGrid(grid, p)` — manual trilinear in domain. **Outside the
  node domain**: returns `interp(clamp(p)) − |p − clamp(p)| − errorBound`
  with `inside: false` — a conservative LOWER bound, never an edge-texel
  clamp. Declared `errorBound = cellSize` (theory h·√3/2 ≈ 0.87h, rounded up).
- `segmentDistance(source, grid, p)` — **the outside-domain procedural
  fallback** (new in the recovery base, previously undocumented here): on
  `inside: false` it folds the source's exact procedural prims and returns
  `fallback: true` so the caller can count fallbacks. This exists because
  hard-min composition cannot tolerate an underestimated NEIGHBOUR segment
  near a joint — it would bulge bone through intact flesh.
- `SegmentVolumeCache` — keyed `${revision}@${cellSize}`; revision is the
  contract content hash so anatomy/ratio/sever re-derives miss correctly;
  shared across actors with identical content; explicit `dispose()` only.
- `buildSegmentAtlas(entries)` — packs grids as stacked z-slices into one
  Float32 3D payload + per-segment `SegmentAtlasMeta`. No halo: the sampler
  clamps index pairs within each segment's own dims.
- `boneSegmentKeyMap(body, bound)` — segment key → applyRig's dense
  `boneSegment` int (includes `organs`, which has no grid). One rest-pose
  applyRig read; ids are pose-independent.

## 1-Lipschitz premise — VERIFIED, not assumed

The lower bound and the interpolation bound both need a 1-Lipschitz field.
It holds **by construction**: `validate.sdPrimitive` scale-divides the
sample point and multiplies the result by `minScale`, so per-prim
|∇| ≤ minScale·(1/minScale) = 1, and hard min preserves the constant.
Qualification: the bent-cone branch (ribs) is an approximation, so
`volume.test.ts` additionally MEASURES max |∇| by central differences over
every segment: **max = 1.0000** (worst `limb:armL:7-9`), asserted ≤ 1.02.

## Verification log (2026-09-08, this worktree, 5e4b38a6)

- `npx vitest run skeleton-spike/volume.test.ts` — **12/12 pass** (~57s;
  dominated by full-zombie bakes). Measured:
  - interp error @5mm: skull max 0.43mm / p95 0.11mm; pelvis max 1.25mm /
    p95 0.34mm; ribs max 1.19mm / p95 0.29mm — all ≪ 5mm declared bound.
  - joint-cloud composed (10mm grids) worst 1.64mm; **fallback rate 96.6%**
    at the pelvis/spine cloud — expected: segment-local domains are tight,
    so joint queries fall outside most neighbours' grids. The fallback is
    doing exactly its job; the GPU path must keep the procedural fold cheap.
  - thinnest authored bone radius 7.50mm (≈3 voxels at 5mm).
  - ribs 5mm grid 82×86×61 = 1680KiB, max err 1.19mm; 10mm grid 249KiB,
    max err 3.92mm (still ≤ its 10mm bound — coarse is honest, not lossy-silent).
  - **Full zombie atlas @10mm: 18 segments, 43×47×240, 1.85MiB payload,
    0.56MiB of grids, bake ≈1.5–1.7s CPU.** (5mm grids are ~8× this;
    bake time per actor spawn is the open cost question for 3b.)
  - posed limb (60 rig steps): interp strict 1.83mm ≤ 5mm; vs segment-
    attributed oracle 2.64mm ≤ budget (5mm + 1.25mm endpoint + 0 caveat).
- `contract.test.ts` 15/15, `mesh.test.ts` 13/13 — no regressions.
- `npx tsc --noEmit` — clean repo-wide (the timed-out base did NOT compile:
  readonly-Vec3 writes, bogus `BuildOpts.ratio`; fixed in 5e4b38a6).

### Failure diagnosed during recovery

The posed-limb test compared the single-segment grid against an oracle
folded over **all** segments' prims; a neighbour bone near the joint won
the min and produced a bogus 19mm "error". The sampled field itself was
exact (0.00mm vs `leg.distance` at the worst point). Fix: attribute oracle
prims to the sampled segment via the segKey ladder. A sampler defect would
have shown up in the strict interp check first — it didn't.

## Task 3b API handoff (GPU integration contract)

**Atlas layout.** `SegmentAtlas.data`: Float32Array, `dims = [maxNx, maxNy, totalZ]`,
x-fastest, grids stacked along z with no halo. Segment grid occupies
slices `[meta.z0, meta.z0 + grid.dims[2])`; within a slice the grid sits at
rows `y ∈ [0, grid.dims[1])`, `x ∈ [0, grid.dims[0])` of the maxNx×maxNy
slice. Node value at local `(x,y,z)`: `data[x + maxNx*(y + maxNy*(z0+z))]`.
Upload as `r32float` 3D — **not filterable in WebGPU**, so the WGSL sampler
must reimplement `trilinear()` with manual index-pair clamping to each
segment's own dims (precedent: `sampleHandVolumeFrame`, X1.26).

**Segment mapping.** `boneSegmentKeyMap(body, bound)` gives segment key →
dense `boneSegment` id, the SAME id pack.ts buckets ascending by. Meta
records must be row-aligned to that id order; `organs` has an id but no
grid — the GPU loop must skip/fall back for it (organs stay procedural by
contract). BONE_SEG_MAX overflow or missing meta ⇒ procedural fold +
increment a fallback counter (mirror `segmentDistance`'s rule).

**Lifetime/disposal.** `SegmentVolumeCache` is explicit-dispose only;
grids are shared across actors by revision key. Sever/anatomy re-derive
changes the contract `revision` ⇒ new key, stale grid unreachable. The GPU
texture must be rebuilt (or slice ranges re-uploaded) on atlas rebuild;
owning code must destroy the old 3D texture — nothing in volume.ts holds
GPU objects.

**Transform obligations.** Grid coordinates are SEGMENT-LOCAL. GPU must
map world → local per segment with `pose()` (origin + quat; inverse is
conjugate-rotate then subtract origin — `toLocal`). Sources are created
against a REST bind and must receive a live `rig: () => currentRig`
accessor or `pose()` reads the rest pose forever (contract.test caught a
~1cm phantom error from exactly this). Head origin uses the bounded-drift
rule; arm limb segments rotate with `armFrame`, other limbs are
identity-rotation + endpoint-A anchor.

**Known unsupported / intentional differences.** (1) Limb squash stays
world-axis in the shipped oracle but rotates with the rigid bake —
documented contract caveat 3, owner-approved art difference, bounded by
`(maxScale−minScale)·r + |bend|`; (2) limb endpoint B tracks up to
`poseEndpointError()` (measured 1.25mm after 60 settle steps); (3) bend
vectors rotate with the segment in the bake (ribs) — contract caveat 1;
(4) expect HIGH fallback rates near joints (~97% at the pelvis cloud) —
budget the procedural fold accordingly; (5) 5mm full-zombie bake cost/bytes
unmeasured end-to-end (only ribs measured: 1.68MiB); measure before
choosing the shipped cell size.

**Commands.** `npx vitest run src/lab/sdf-zombie/webgpu/skeleton-spike/volume.test.ts`
(~57s), `…/contract.test.ts`, `…/mesh.test.ts`; `npx tsc --noEmit`.
No GPU boot, shader compile, or browser capture has been run for the
volume path — there is nothing to run yet.

## Remaining / NOT done

All GPU work: `volume.wgsl.ts` sampler + MODE-2 volume branch,
`resolveSkeletonMode` 'volume' case, game-main wiring, fallback-count
diagnostics (`__sdfGame.skeletonVolume()`?), GPU boot/shader-compile check,
matched baseline/volume captures, and a bake-cost decision for the shipped
cell size. Deferred-mode refusal should mirror the mesh selector.
