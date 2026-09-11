# R1 — widen the gather's dispatch: design + evidence, ready to implement

**Status: DESIGNED, NOT IMPLEMENTED.** The measurement that justifies it is done and
recorded below. The reason it is not implemented yet is stated at the end, honestly.

## The evidence (2026-09-10, room 4, `BENCH_PASSES=1`, within-leg pass row)

Ray count swept through `BENCH_PRELUDE="__sdfGame.setProbeRays(N)"` — note the LEG
TABLE HAS NO SUCH LEG, so `BENCH_LEGS=probe-r4,...` silently measures `baseline`
four times. A first attempt did exactly that and produced a meaningless flat
result. Use the prelude.

| rays/probe | `compute:probe-gather` p50 | vs 32 |
| --- | --- | --- |
| 32 (shipped) | 4.00 ms | — |
| 16 | 1.83 ms | 0.46x |
| 8 | 0.75 ms | 0.19x |
| 4 | 0.21 ms | 0.05x |

Per-leg repeats agree to ~2%, so despite this machine's census drift the PASS row is
sound (the documented reason: a within-leg pass row survives a busy machine).

**Interpretation.** Near-perfectly linear in ray count. If the per-ray cost were
amortised over the dispatch — one box walk shared by 32 rays — 16 rays would cost
~2.1 ms rather than 1.83. It halves, so **the cost is unshareable per-ray work
executed serially inside 448 threads.** Dispatch is `compute(call, 400, [64])` = 7
workgroups on an M3 with 1280 ALUs: ~35% of one wave, ~2 warps per core, no latency
hiding. Cross-check: the FRAME moved with it (room-4 median 17.7 ms -> 12.5 ms at 4
rays), so the gather really is a large slice of the frame.

The existing control confirms the seam and bounds the floor: `probe-norays`
(`setProbeRays(0)`) reads **0.01 ms**, i.e. dispatch + setup + blend is negligible
and essentially the whole 4 ms is ray work.

**R2's ceiling, from the same table of seams:** `probe-nolights` (~1.8 ms) against
4.0 ms implies the per-light shadow sweep is ~55%, matching the documented 56%. So
R2 targets ~2.2 ms of the 4 ms — but that target SHRINKS if R1 lands first, so R1
is the right order.

## The design

One thread per `(probe, ray)` instead of per probe: 400 x 32 = **12,800
invocations = 200 workgroups**, which is the occupancy the pass needs. It changes NO
maths — same rays, same SH weights, same blend.

The reduction is the whole difficulty, and there are two shapes:

### ✅ THE OPEN QUESTION IS ANSWERED: OPTION A IS VIABLE

The probe ran (permanently pinned now as
`src/lab/sdf-zombie/webgpu/probe-gather-workgroup.test.ts`, 4 tests):

- **`workgroupArray('float', 64)` exists and constructs.** So does `subgroupAdd`,
  the Option B reduction.
- **A `workgroupArray` node CAN be passed into a `wgslFn` and produces a node** —
  the R1 design's central assumption holds. Option A is available, and Option B
  stays as a fallback rather than a necessity.
- **The generated function parses the workgroup pointer as a DECLARED input with a
  type**, and there is no phantom — checked with the same real parser that caught
  the `deliberately` phantom (`43779459`), because that failure mode is exactly what
  an unverified WGSL signature looks like.
- ⚠ **`workgroupBarrier` is NOT a function export in this three build.** The barrier
  must come from the WGSL side (kernel text / module scope), not a TSL call. Found
  by the probe, and it would otherwise have been a silent compile failure of exactly
  the kind that cost this session an afternoon.

### Option A — workgroup-shared tree (NOW CONFIRMED VIABLE)

Each thread computes its ray's 12 floats (3 radiance vec4 + 3 visibility vec4
packed as the kernel already packs them, or 8 scalars) and writes them to a
workgroup-shared array; then a tree reduction over the workgroup folds them in a
FIXED order; lane 0 applies `(4pi / max(1, nHit))`, the blend, and writes the probe
record.

- **Pro**: ONE dispatch. No second buffer, no second kernel, no extra memory.
- **Pro**: a fixed tree IS a fixed summation order, so the result is bit-stable —
  which matters because the frame hash (and any future `.dem`) compares bit patterns.
- **The binding question is RESOLVED** (see above): passing a `workgroupArray` into a
  `wgslFn` works. The remaining unknown is only the BARRIER, which must be declared
  in WGSL text since `workgroupBarrier` is not a TSL export here.

### Option B — two-pass, workgroup-per-probe (safe fallback)

Workgroup k handles probes `[k*L, (k+1)*L)` with `L = threads/raysPerProbe` (64/32 = 2,
so 2 probes per workgroup, 200 workgroups), reduces across the lane group with
`subgroupAdd` or a shared tree, and lane 0 writes the probe record. Still one
dispatch, still no extra buffer, and no shared-array function parameter.

- **Pro**: avoids the unknown in Option A entirely.
- **Con**: `subgroupAdd` carries a floating-point summation-order caveat across
  hardware; if that matters for the hash, use the shared tree from Option A instead
  and pay its verification cost.

### What must not change

- **The blend reads previous state.** Each probe's record is
  `mix(prev, new, rate)` where `rate` depends on the L00 luminance comparison of new
  vs prev. Whatever shape the reduction takes, exactly ONE thread per probe must do
  that read-modify-write. Two threads writing one probe record is a race that would
  show up as flicker, not as a compile error.
- **`nHit` floors at 1** in the `(4pi / N)` weight so an all-miss probe writes zeros
  rather than NaN. Preserve that exactly.
- **`readback()` and `probeDynNode`** (the march's read-only view) must keep working:
  they read the SAME buffer, written by the reduction. Do not introduce a second
  output buffer for the dispatch and forget to point these at it.

## Verification (all of it already exists)

1. **Correctness, exactly:** `probe-dynamic-cull.test.ts` has a CPU twin. The
   strongest check is not equivalence-to-the-old-shader (summation order legitimately
   differs) but **equivalence within tolerance against the CPU twin** for a fixed
   scene, plus a bit-stability check: two gathers at the same state must produce the
   same buffer.
2. **The `?dynrays` control stays the oracle.** After R1, the ray sweep must still
   scale — if 4 rays stops being ~0.2 ms, the dispatch change broke the ray gating.
3. **The frame hash** (`__sdfGame.frameHash()`) will show the probeDyn layer change.
   A deliberate change is expected (different summation order); it must be STABLE
   across repeats within one boot, which is the thing that failed all session for
   other reasons — so check `repeated`, not cross-boot.
4. **Perf:** `BENCH_LEGS=baseline BENCH_ROOMS=4 BENCH_PASSES=1 BENCH_PRELUDE=
   '__sdfGame.setOccluder(false);__sdfGame.setHullExitBound(true)'` and read the
   `compute:probe-gather` row. Target: 4.00 -> 1.0-2.0 ms (the notes' inferred
   full-occupancy floor is 0.2-0.7 ms; treat that as INFERRED, not promised).

## Status: READY TO IMPLEMENT (probe passed 2026-09-10)

Option A it is. The next concrete steps, in order:

1. Declare the shared scratch array and the barrier **in the WGSL kernel text**,
   since `workgroupBarrier` has no TSL export.
2. Restructure `K_PROBE_GATHER` to one thread per `(probe, ray)`: compute the ray's
   SH contribution, write it into the shared array at the thread's lane, barrier,
   tree-reduce over the workgroup, and let ONE thread per probe do the projection,
   the `nHit` floor, the luminance comparison and the read-modify-write blend.
3. Dispatch `compute(call, probes * rays, [64])` and make the probe index
   `gi / nRays`, the lane `gi % nRays`.
4. Verify against the CPU twin and the `?dynrays` oracle, then bench the
   `compute:probe-gather` row against 4.00 ms.

## Why this was not implemented in the R1 session, stated plainly

The remaining unknown is a **TSL/WGSL capability question** (Option A's shared-array
parameter), and resolving it requires a GPU round trip. Writing 150 lines of WGSL on
top of an unverified binding mechanism is exactly the failure mode that cost this
session an afternoon: a WGSL change landed without a gate, the pipeline silently
failed to compile, and the flesh vanished at every setting — see `43779459` and the
"ONE COMMENT" section of the perf handoff. **Verify the binding support first, then
write the kernel.** That is a 10-minute probe and it decides between Options A and B.
