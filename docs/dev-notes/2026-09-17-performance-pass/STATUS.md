# Default-graphics performance pass — 2026-09-17

**GPU candidate implemented; GPU validation and performance verdict pending. No
game frame-time improvement claimed.** Target: recover approximately 5 ms without
reducing the default graphics quality. Primary checkout unchanged.

**CPU follow-up:** [CPU.md](CPU.md) records a measured 14.6–15.9% reduction in
offline actor-step plus packing cost (0.19–0.41 ms/update), byte-identical sampled
output and 281 passing focused tests. Its commit is separate from the shader
candidate below. The full-game 5 ms target remains open.

Branch: `codex/perf-pass-2026-09-17`, based on `761cf8d3` (includes accepted
offline gib assets). Worktree: `.claude/worktrees/perf-pass-2026-09-17`.

## Candidate

The dynamic probe gather performed three avoidable kinds of work:

1. The primary ray found the nearest capsule and computed its normal, although
   its caller only consumed whether any capsule preceded the wall. Reuse the
   existing bounded any-hit query; preserve its inside-capsule semantics.
2. Flashlight samples traced shadows before rejecting positions outside the
   spotlight cone. Reject those zero-contribution samples first.
3. Every ray scanned every capsule. Add a conservative sphere for each 16
   consecutive capsules; reject whole groups before exact capsule tests.

Group spheres are appended to the existing capsule storage allocation (2 KB at
the 2,048-capsule cap), with their vec4 offset in header y. No additional GPU
binding or dispatch. Bounds use the rounded capsule records and rounded centre,
with an outward numerical margin. Capsule records and ordering are unchanged.
Building bounds allocates no per-group arrays. This is a coarse broad phase;
it does not reduce capsule count, ray count, lighting, or update cadence.

`?probeopt=0` or `__sdfGame.setProbeOptimization(false)` selects the original
queries for comparison. `true` selects the candidate. The switch is reset by
the bench before each leg; `probeCostSplit.optimized` reports it. The shader's
reference and candidate share one compiled pipeline, so this first comparison
isolates runtime work. A final comparison against the parent checkout is still
needed to detect any shader-compilation/register-pressure cost of the switch.

## Completed verification

- 79 tests across probe-dynamic, independent capsule reference/cull, WGSL
  parser/workgroup, and the new capsule-group suite: PASS.
- New group suite: 5,760 seeded ray queries across 24 random scenes against
  exhaustive nearest-hit queries, including inside and axis-parallel rays.
  Broad-phase calculations rounded to f32. Full capsule containment and
  unchanged records checked at counts 0, 1, 15, 16, 17, 2,047, 2,048 and reused
  buffers. These tests do **not** compile or execute WGSL.
- `npm run build` (`tsc --noEmit && vite build`): PASS, existing large-bundle warning.
- Both edited JavaScript harnesses pass `node --check`.
- Warm CPU microbenchmark, 21 batches of 1,000 bounds builds, median per build:
  128 capsules 0.00062 ms; 790 capsules 0.00373 ms; 2,048 capsules 0.00968 ms.
  These are bounds-construction costs, **not** GPU or game-frame improvements.

## Outstanding GPU window

The dispatch task `2026-09-17-shutter-blur-game-task-1` was actively running its
GPU checker on 5484/9484. Its processes were left alone; no GPU work launched
by this task. Subsequent shutter tasks are pending. Do not measure concurrently.

After an exclusive window is available, run from this worktree:

```bash
LAB_VITE_PORT=5492 LAB_CDP_PORT=9492 LAB_TMP=/tmp/blud-perf-20260917 \
  bash -c '. scripts/lab-servers.sh; trap lab_servers_down EXIT; lab_servers_up;
    for room in 1 3 5; do
      node scripts/sdf-gather-dispatch-check.mjs --optimization-ab --room "$room" \
        --out "/tmp/blud-perf-parity-room$room.json" || exit;
    done'

LAB_VITE_PORT=5492 LAB_CDP_PORT=9492 LAB_TMP=/tmp/blud-perf-20260917 \
  BENCH_QUERY='seed=4242&res=800' BENCH_PASSES=1 BENCH_REPEATS=3 \
  BENCH_ROOMS=1,3,5 BENCH_LEGS=probe-reference-ship,upscale-ship \
  BENCH_OUT=/tmp/blud-perf-20260917-ab bash scripts/sdf-game-bench.sh
```

The parity option compares reference/candidate in **one frozen boot**, requires
identical dynamic-layer digests and floats, repeats both, and saves a mismatch
payload on failure. It sweeps 0/1/2/3/5/8/16/31/32/47/64 rays. This also catches
WGSL compilation errors, which CPU tests and Vite cannot catch. Repeat with
live point lights/flashlight and increased capsule occupancy before accepting.

Measure both fenced frame time and `compute:probe-gather`, with matched census
and frame hashes. Gather runs every second frame: do not equate its pass timing
with per-frame savings. Keep repeat ranges visible. Then compare parent versus
candidate default boots and perform a visual gameplay check. If savings are
below 5 ms, report the actual result and use the new pass breakdown to decide
whether wounded-character rendering has a worthwhile next target.
