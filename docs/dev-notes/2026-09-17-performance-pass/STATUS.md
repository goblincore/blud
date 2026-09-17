# Default-graphics performance pass — 2026-09-17

**Performance pass validated against the accepted shutter-blur merge.** Target:
recover approximately 5 ms without reducing default graphics quality. That
whole-frame target was not established; report the measured gains below. Primary
checkout unchanged.

**CPU follow-up:** [CPU.md](CPU.md) records a measured 14.6–15.9% reduction in
offline actor-step plus packing cost (0.19–0.41 ms/update), byte-identical sampled
output and 281 passing focused tests. Its commit is separate from the shader
candidate below. The full-game 5 ms target remains open.

Branch: `codex/perf-pass-2026-09-17`, now includes main `4ce1e826` (accepted
offline gib assets and shutter blur). Worktree: `.claude/worktrees/perf-pass-2026-09-17`.

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
isolates runtime work. A separate run of the original compiled shader from main confirms the small
probe-pass improvement in the blast fixture; see GPU.md for limits.

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

## GPU and shutter verdict

[GPU.md](GPU.md) contains the results, evidence and reproduction commands.

- GPU readback parity passes in rooms 1/3/5 at all eleven ray counts, and with
  705 capsules plus flashlight/muzzle lighting at six ray counts. No shader errors.
- Probe savings scale with capsule occupancy; the small blast fixture saves only
  about 0.02 ms of amortized GPU pass time. Do not equate this with frame latency.
  At 705 capsules / two lights the gather drops 70% (1.844→0.547 ms per dispatch,
  about 0.65 ms amortized); the full-frame result is still inconclusive.
- The accepted blood + gib blur adds 0–0.5 ms to the median frame in the frozen
  28-piece blast test. Exposure, trail, taps, seed resolution and occlusion stay intact.
- Goo buffers now upload only live instances. Real sync tests preserve drawn
  bytes through partition/count transitions; CPU preparation saves 0.01–0.02 ms
  and the synthetic blast transfers 66% fewer attribute bytes. Full-frame deltas
  remain below the measurement noise.
- The initial six full-fight legs had different scene censuses and are discarded
  for attribution. Character marching remains the largest measured GPU cost.

Focused tests and the final build are recorded in GPU.md. CPU results from the
prior commit remain in CPU.md; do not sum numbers across different scenarios.

## Owner-accepted baseline and GPU follow-up

The owner manually reviewed `cd2ded50` and reported no visual or performance
regression. The subsequent [upscaler pass](GPU-UPSCALING.md) skips convolution
work outside a conservative occupied-tile halo, with the same weights and
settings. Eighteen GPU comparisons are byte-identical; 117 focused tests and the
production build pass. Isolated stage savings are 0.3–0.5 ms, with 0.4–0.7 ms
less GPU attribution in the profiled views. Whole-frame results vary between
runs; this does not close the 5 ms target. Full-coverage stress adds about 0.2 ms.
