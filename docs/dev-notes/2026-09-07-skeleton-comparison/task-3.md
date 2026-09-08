# Skeleton comparison — Task 3: sampled skeleton SDF prototype

Status: **IN PROGRESS** — started 2026-09-08, branch
`codex/dispatch/2026-09-07-skeleton-representation-comparison-task-3`,
base ff7fbd7d (Task 2 handoff). 25-minute bound; GPU captures are DEFERRED
(user vite preview pid 11290 active in the primary checkout — house rule:
defer measurements, never kill user processes).

## Design (committed to early, updated as I go)

- `volume.ts` (CPU, pure): `bakeSegmentGrid(source, cellSize)` — Float32
  distance grid per `BoneFieldSource`, nodes = EXACT `source.distance`
  values, segment-local, dims derived from contract `bounds` + margin.
  `sampleSegmentGrid` — manual trilinear; outside the node domain returns
  distance-to-domain-AABB (a PROVABLE lower bound on the true distance:
  the surface sits inside `bounds` ⊆ domain — safe for sphere tracing,
  never an edge-texel clamp). Declared conservative error bound =
  `cellSize` (trilinear error of a 1-Lipschitz field is ≤ h·√3/2 ≈ 0.87h;
  rounded up; actual error measured in tests). `SegmentVolumeCache` keyed
  `${revision}@${cellSize}` (Task 2's mesh-cache discipline), explicit
  `dispose()`, byte accounting. `buildSegmentAtlas` packs grids as z-slices
  into one Float32 3D texture payload + per-segment meta records.
- `volume.wgsl.ts`: manual-trilinear atlas sampler + a per-segment volume
  branch inside the march's MODE-2 (segment-sphere) bone path. r32float
  3D textures are NOT filterable in WebGPU → manual trilinear, exactly the
  precedent `sampleHandVolumeFrame` (X1.26) sets.
- Selector: `?skeleton=volume` added beside `mesh` (dev forward only).
- Composition semantics preserved by construction: hard min across
  segments, organs procedural, wound smax-then-min order untouched —
  sampled bone distance feeds the SAME `applyBones` fold, so normals,
  wound reveal, material selection and authored forward lighting are the
  shipped path. Fallback rule: any GPU segment without a baked grid
  (overflow past BONE_SEG_MAX, missing meta) folds procedurally; the
  fallback count is reported.

## Verification log

(pending)

## Remaining / NOT done

(pending)
