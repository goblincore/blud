# Skeleton comparison — Task 3b: volume GPU integration

Status: **IN PROGRESS** — branch `codex/dispatch/2026-09-08-skeleton-task-3b-volume-integration`,
base = task-3a recovery (5e4b38a6). Started 2026-09-08.

## Plan (bounded slice)

1. `volume.wgsl.ts` — WGSL manual-trilinear r32float atlas sampler mirroring
   `sampleSegmentGrid` semantics exactly (domain check → clamped-index
   trilinear inside; outside ⇒ caller falls back to the procedural
   `foldBoneRange` and counts it). Not filterable ⇒ manual interp, per the
   X1.26 `sampleHandVolumeFrame` precedent.
2. Host-side packing (pure CPU, vitest): per-segId meta rows (origin,
   spacing, dims, z0) aligned to pack.ts's ascending `boneSegment` order via
   `boneSegmentKeyMap`; per-frame pose rows (world quat + origin, live flag)
   from `source.pose()`/`isLive()`. Organs row = disabled (procedural by
   contract).
3. CPU twin `sampleAtlasTrilinear` + parity test against
   `sampleSegmentGrid` (validates atlas addressing `x + maxNx*(y +
   maxNy*(z0+z))`, the error-prone part) on a small synthetic grid — fast,
   no 57s bake.
4. `resolveSkeletonMode` 'volume' case (dev, forward only) + tests;
   game-main warns and keeps procedural until wiring lands (mirrors the
   mesh-deferred refusal).
5. Commit this interface milestone BEFORE attempting march.wgsl/zombie-gpu
   wiring. GPU boot only if trivially bounded; Task 4 owns captures.

## Log

- (start) Read task-3.md, fixture-contract.md, volume.ts, selector.ts,
  foldBoneRange/APPLY_BONES in march.wgsl.ts. MODE-2 per-segment sphere path
  (tail.w > 1.5) is the natural fold insertion point: one bound per segment
  already, so a volume branch can replace `foldBoneRange` per surviving
  segment with an atlas sample + fallback.
