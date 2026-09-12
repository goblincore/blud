# G1 cost — the deferred P1 Task 6, run on trained weights (2026-09-12)

Legs added to `scripts/sdf-game-bench.mjs`: `march-half` (0.5 march, zero model = nearest), `upscale-s8`,
`upscale-s32`, `upscale-s32-rgbd` (trained exports from `.upscale-models/`). Reset block pins
`setUpscale(null)`. Rooms 1 and 5, 1280×800, 3 repeats. Reports: `/tmp/sdf-game-bench-upscale-clean/`.

**Verdict: UNRESOLVED on this machine state.** Repeat spread was 39–63 % on eight of ten leg/rooms
(WindowServer 43 %, two chat-app renderers >20 % CPU during the run — the 2026-08-31 lesson again).
Only `upscale-s8` room 1 (4 %) and `upscale-s32-rgbd` room 5 (8 %) measured anything. Frame-hash drift
on 30 layers between repeats, so the workload itself also differed (probe dynamics, instances).

Per-leg **minimum** overall median (the least-contaminated sample; still not a measurement):

| leg | room 1 | room 5 |
|---|---:|---:|
| baseline (march 1.0) | 9.48 | 13.16 |
| march-half (nearest) | 9.05 | 11.37 |
| upscale-s8 | 9.94 | 11.12 |
| upscale-s32 | 10.46 | 14.39 |
| upscale-s32-rgbd | 10.77 | 15.04 |

What survives the noise: s8 sits on top of march-half (the stage is ~free at 8 wide); s32 reads
1–3 ms above march-half, which would be more than the 0.2–0.5 ms the handoff assumed and would matter
for s64. **Re-run on a quiet machine before sizing the s64 runtime budget** — `BENCH_LEGS=march-half,upscale-s8,upscale-s32,upscale-s32-rgbd BENCH_ROOMS=1,5 BENCH_REPEATS=3 scripts/sdf-game-bench.sh`,
after `ps -Ao pcpu,comm | sort -rn | head` shows nothing but Chrome/node above 20 %.

An earlier 2-repeat run the same morning (`/tmp/sdf-game-bench-upscale/`) had its second repeat
contaminated by a pytest run in parallel; its rep0 agrees with the minima above.
