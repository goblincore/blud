# CPU pass — measured 2026-09-17

**Actor stepping plus CPU packing is 14.6–15.9% faster in the offline A/B.**
Savings are 0.19 ms/update at 12 actors and 0.38–0.41 ms at 24 actors. These
are CPU-subsystem results, not an end-to-end frame-time or GPU result. The
overall approximately 5 ms target is still open.

## Changes

- `rig-bind.ts`: compute each segment rotation once per `applyRig` call,
  shared by its rib/vertebra/arm primitives. Key includes point indices and
  checks the rest direction. Cache dies with the call, so yaw, moving points,
  damage/rebind and collapse cannot reuse an old pose.
- `refitClusters`: avoid temporary member slices, endpoint lists and vector
  arithmetic arrays while retaining the arithmetic order, bend control point,
  box/strand reach, shell expansion and output shape.
- `pack.ts`: optional caller-owned scratch. Reuse its 22 typed arrays and
  clear every row and tail before writing. Default callers still receive
  independent arrays. `zombie-gpu.ts` opts each view into its own scratch;
  both its private and crowd atlas writers copy rows synchronously.

One pack contains **32,256 bytes of typed arrays**. Reuse avoids 23,224,320
bytes/s of allocation with 24 actors at 30 updates/s (22.15 MiB/s), after the
first pack. This is allocation avoided, not reduced GPU upload bandwidth;
retained scratch costs about 31.5 KiB/view. The upload format is unchanged.

Segment IDs still follow the original first-seen algorithm. No persistent
topology cache was added; remaining CPU cost was not guessed away.

## Method and limits

Apple M3, 24 GiB; Node v25.9.0. No browser, renderer, GPU adapter or GPU
submission. The other shutter-blur task was still running; this was not an
otherwise idle machine. Repeats alternate before/after to bound drift.

`scripts/sdf-cpu-bench.ts` runs the real `createZombieActor` motion/rig/AI
pipeline with equally many zombies and soldiers and the real `packBody` in
its view update. Mesh skeleton pack settings: `packBones:false`,
`boneCullMode:'segment'`. Each process warms 180 updates, then measures 900
at `dt=1/30`. Damaged runs stamp torso/arm/leg pellets after warmup; they
finish with 36 wounds (12 actors) or 73 (24 actors).

This excludes atlas copies, Three scene updates, kit/skeleton mesh posing,
encounter orchestration, projectiles, rendering and GPU stalls. Node timing
is not Chrome frame timing. The initial inspector sample identified repeated
segment calculations and packing as targets; inspector is OFF for all results
below. Hashing takes place outside measured updates, every 60 frames.

Reference sources are `rig-bind.ts` and `pack.ts` at `d2766df1`; candidate
sources are this commit. Fresh processes were run in A/B/A/B/A/B order for
each case. The runner restored the candidate files on exit. All six runs per
case have identical SHA-256 digests over sampled poses, rig state, debug state,
wounds and raw packed-array bytes. This is sampled CPU/output equivalence,
not a rendered-image comparison.

## Results

Median of three per-run percentiles, ms/update:

| Actors / scenario | p50 before | p50 after | Saved | p95 before | p95 after |
| --- | ---: | ---: | ---: | ---: | ---: |
| 12 walking | 1.238 | 1.050 | 0.188 (15.2%) | 1.673 | 1.359 |
| 12 damaged | 1.281 | 1.093 | 0.187 (14.6%) | 1.704 | 1.392 |
| 24 walking | 2.487 | 2.108 | 0.378 (15.2%) | 3.321 | 2.727 |
| 24 damaged | 2.598 | 2.186 | 0.412 (15.9%) | 3.408 | 2.844 |

Per-run p50 ranges do not overlap in any case. Largest before range is
2.455–2.525 ms (24 walking), versus candidate 2.092–2.130 ms. Full raw data
and all ranges: [cpu/summary.json](cpu/summary.json), plus 24 individual JSON
records in the same directory.

## Verification

- 281 focused tests PASS: packing, rig binding/frames/cache, extent, elbow,
  game actor, soldier damage and gib tearing. The new scratch test compares
  every byte after 54 transitions spanning three characters, populated,
  disabled-limb and empty bodies, three bone modes, and bones on/off. Arrays
  are poisoned before each call to catch stale rows; identity assertions prove
  actual buffer reuse. Separate test checks caller isolation.
- New rotation test compares each bone to an independent per-bone transform
  across changed points/yaws and a custom rest direction on a shared segment.
- `npm run build` PASS (typecheck + Vite); existing bundle-size warning only.
- No GPU job launched, no live game/visual validation claimed.

Reproduce candidate:

```bash
CPU_ACTORS=24 CPU_SCENARIO=damaged CPU_OUT=/tmp/blud-cpu \
  npx vite-node scripts/sdf-cpu-bench.ts
```

For profiling add `CPU_PROFILE=1`; those timings should not be compared with
the uninstrumented table. Compare parent/candidate game frames when the GPU
window is available. The CPU patch is a separate commit from the unvalidated
probe shader change so it can be reviewed/applied independently.
