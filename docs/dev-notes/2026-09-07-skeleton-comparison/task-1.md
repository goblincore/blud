# Skeleton comparison — Task 1: field contract & fixtures

Status: **COMPLETE (handoff)** — contract implemented, all focused tests green,
handoff documents written. Recovery task 2026-09-08 finished the doc/spec
updates the original 25-min run did not reach.

## What exists

- `src/lab/sdf-zombie/webgpu/skeleton-spike/contract.ts` — `BoneFieldSource`
  per rigid segment + `composedBoneDistance` world-space reference. See file
  header for the three documented rigid-frame caveats (world-axis bend,
  two-anchor limbs, world-axis limb squash).
- `src/lab/sdf-zombie/webgpu/skeleton-spike/contract.test.ts` — 15 tests
  against the real zombie (no synthetic stand-ins).
- `src/lab/sdf-zombie/webgpu/skeleton-spike/segment-diagnostics.test.ts` —
  measurement/diagnostic file (renamed from scratch `zz-measure.test.ts`):
  prints the segment census, per-segment endpoint error, bounds, and the
  bent-rib world-axis gap. Console output, not assertions.
- `fixture-contract.md` (same directory) — exported API, invalidation
  obligations, fixture states, and what Task 2 must implement.

## Verification (this session, worktree 68c2d695)

```
npx vitest run src/lab/sdf-zombie/webgpu/skeleton-spike/contract.test.ts \
  src/lab/sdf-zombie/webgpu/skeleton-spike/segment-diagnostics.test.ts \
  --maxWorkers=2 --minWorkers=1
# 2 files, 17 tests, all passed (~0.6 s)
npx tsc --noEmit   # exit 0 (clean)
```

Pre-existing failure fixed in this recovery: the base commit 68c2d695 did
NOT typecheck — `contract.ts` declared the bounds accumulators as the
readonly `Vec3` type (2 × TS2542 at the mutation site). Fixed by typing them
as mutable `[number, number, number]` tuples; behaviour unchanged, tests
re-verified after the fix.

No GPU/browser work was run or claimed. No build was required (no runtime
code paths changed — `skeleton-spike/` is new and opt-in only).

## Measured numbers (zombie, 60-step gravity settle pose)

- 18 segments: 4 rigid (head unit + 3 axial: pelvis/spine), 14 limb
  segments; 60 bone prims, 8 organ prims excluded, 23 flesh prims untouched.
- Rigid segment endpoint error under pose: 0.000 mm (exact, as designed).
- Limb two-anchor endpoint error: 1.249–1.256 mm on the left leg only in
  this pose; all other limbs 0. Test budget: 5 mm.
- Bent-rib world-axis bend gap: **0.000 mm measured at this pose** — the
  gravity-settle leaves the spine nearly upright, so `Primitive.bend` (a
  world-axis vector applyRig never rotates) barely diverges from the rotated
  rigid-frame version. This is a *measurement limitation*: the gap scales
  with pose tilt (|bend| up to 0.162 m on the widest ribs), so Tasks 2/3
  must re-measure on a tilted/bent pose before trusting rib parity under
  animation. Test budget: 3 mm.
- Segment-local bounds: all within ±0.42 m of the segment anchor, suitable
  for small per-segment extraction grids.

## Contract blockers review

None found. Live rig access is explicit (`SkeletonSourceOpts.rig` accessor —
the stale-rig failure mode is documented in the opts comment and covered by
a test), bounds and revisions are per-segment content hashes (stale-cache
hits are the documented failure mode), and organs are excluded by
construction with a census test proving the partition.

## Remaining / NOT done here (Task 2+ scope)

- No mesh extraction, no volume sampling, no GPU or visual evidence.
- Fixture states are pinned in `fixture-contract.md` but there is no capture
  harness yet (Task 4).
- Bent-pose rib gap re-measurement on a genuinely tilted pose.
- Soldier transfer check is Task 4 scope; contract is character-agnostic
  (takes `BuildResult` + `BoundRig`), only the zombie is exercised today.
