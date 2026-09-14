# Merged crowd march — stage (a) dev notes

**Date:** 2026-09-13 · **Plan:** `docs/superpowers/plans/2026-09-13-merged-crowd-march-stage-a.md`
· **Spec:** `docs/superpowers/specs/2026-09-13-merged-crowd-march-design.md`

Task-by-task record for the per-type crowd march. Task 0 (this note) records the
baselines and lands the harness seams the later tasks gate against.

## Baselines (2026-09-13)

Booted through `scripts/march-hash.mjs` inside `scripts/lab-servers.sh`
(`LAB_VITE_PORT=5323 LAB_CDP_PORT=9323`, `LAB_TMP` inside the worktree). The
tiles-off run is the canonical gate; the tiles-on run asks whether the tile-list
march is already bit-identical to the cluster walk.

| configuration | room 1 `room1` | `room1-repeat` | `room1-wounded` |
| --- | --- | --- | --- |
| tiles off (canonical) | `a8ab4efac15fc0376c3e4e05420f13e34d1511bd` | `a8ab4efac15fc0376c3e4e05420f13e34d1511bd` | `da785297dcc3f677320c563501ca861bac22d6d6` |
| tiles on | `64c7bc5a1c471ca1758490af68e6c1600b12e2b8` | `64c7bc5a1c471ca1758490af68e6c1600b12e2b8` | `38fc13bfa87cb44d11fbce69b6218c9e302a1ad7` |

Commands:

```bash
# canonical (tiles off)
node scripts/march-hash.mjs

# tiles on — needs the page flag to make the controller `allowed`
MARCH_HASH_TILES=1 MARCH_HASH_QUERY='tiles-playtest' node scripts/march-hash.mjs
```

Both boots are internally deterministic (`room1 == room1-repeat`) and the
wounded variant differs from `room1` in each, so the gate is testing something.

**The two differ, so today's tile-list march is NOT bit-identical to the cluster
walk.** Per the plan, stage a-2's acceptance bar therefore becomes
**"identical to the tiles-on baseline"** (`64c7bc5a1c471ca1758490af68e6c1600b12e2b8`)
rather than "identical to the canonical tiles-off hash". The difference is
expected — tiles reorder/limit the per-step fold — but it must stay frozen while
the crowd work lands.

`MARCH_HASH_QUERY` is the new env passthrough (any extra query string is appended
to the boot URL), so later tasks can hash `?crowd=1` through this same gate.

## Crowd bench baseline (per-body path, tiles off)

```bash
BENCH_PASSES=1 BENCH_ROOMS=1 BENCH_LEGS=baseline BENCH_CROWD=24 \
  BENCH_OUT=docs/dev-notes/2026-09-13-merged-crowd-march-stage-a/crowd24-perbody \
  node scripts/sdf-game-bench.mjs 5323 9323
```

`BENCH_CROWD=24` spawns 24 zombies into room 1 through the new
`__sdfGame.spawnCrowd('zombie', 24)` seam, before the leg overrides. Three
repeats, room 1, `baseline` (upscale/refine off, tiles off).

| metric | per rep | median |
| --- | --- | --- |
| `sdf:march` p50 (ms) | 55.38 / 143.88 / 54.26 | **55.38** |
| fenced frame p50 (ms) | 84.62 / 157.04 / 85.83 | **85.83** |

Census: 24 spawned; 23–27 bodies on screen over a run (the spawned zombies
wander in and out of the room-1 view). Walk opened at 24 bodies, fire dropped it
to 5–27 depending on how many the scripted shots killed.

**Read with care.** The run reports census and frame-hash drift (`exit 1`, by
design): the spawned zombies wander with per-boot RNG, so repeats are not the
same workload. The 86% repeat spread on the fenced frame (rep1 = 143.88 ms) is
exactly that — rep1's fire segment kept 26 bodies alive where rep0/rep2 dropped
to 7/5, so the median `sdf:march` p50 above is the quiet-rep figure, not a
tight estimate. The per-body path baseline this task exists to record is
`sdf:march` ≈ 54–55 ms for ~24 co-located bodies at the room-1 close-up; treat
rep-to-rep deltas smaller than the census drift as unresolved.

Harness note: one earlier attempt at the exact command failed with
`330 hidden frames — INVALID` on a cold Chrome (immediately after two
`march-hash` boots). A re-run in a fresh lab-servers boot succeeded, and a
`BENCH_CROWD=0` control also succeeded — the failure was a flake, not the crowd
prelude. Do not treat a single hidden-frames failure as a crowd bug.

Artifacts: `crowd24-perbody/bench.{json,md}`, `crowd24-perbody/passes.{json,md}`.

## Harness changes landed by Task 0

- `scripts/march-hash.mjs` — `MARCH_HASH_QUERY` (extra URL query) and
  `MARCH_HASH_TILES=1` (`__sdfGame.setTiles(true)` after ship defaults).
- `scripts/sdf-game-bench.mjs` — `BENCH_CROWD=n` prelude
  (`__sdfGame.spawnCrowd('zombie', n)` after ship defaults, before leg
  overrides); legs `crowd-on` and `crowd-on-tiles-off`; the override applier
  skips `setCrowd` while the seam is absent, so the legs are no-ops until Task 6
  (like `setTiles` without `tiles-playtest`).
- `src/lab/sdf-zombie/webgpu/game-main.ts` — `__sdfGame.spawnCrowd(name, n)`
  next to `spawnDebugCharacter`, returning how many landed.

## Next

Task 1 (`crowd-records.ts`) — the 16-vec4 instance record and the
one-instance kernel for every body, gated by the canonical tiles-off
`room1 = a8ab4e…`.
