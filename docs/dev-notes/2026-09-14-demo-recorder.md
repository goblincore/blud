# Deterministic demo recorder — Stage 1 (sim purity) results

**Date:** 2026-09-14
**Plan:** `docs/superpowers/plans/2026-09-14-deterministic-demo-recorder.md` (Task D1)
**Predecessor:** `docs/superpowers/plans/2026-09-10-deterministic-demo-recordings.md` (stage 2, the frame hash — shipped with live runs failing)

## Result

The stage-1 gate now exits 0 **with 3 repeats**, and does so on a loaded
machine (load ~3–13 during the runs):

```
$ BENCH_PASSES=1 BENCH_REPEATS=3 BENCH_ROOMS=2 BENCH_LEGS=baseline \
    BENCH_QUERY='seed=4242' node scripts/sdf-game-bench.mjs 5326 9326
$ node scripts/census-diff.mjs docs/dev-notes/2026-09-14-demo-recorder/bench.json
    3 leg-runs, 1 leg/room group(s)
    CENSUS IDENTICAL across repeats — the scenario is repeatable.
    FRAME HASH IDENTICAL across repeats — the same leg rendered the same frame.
PASS: 0 drifted field(s) across 1 document(s).
```

Frozen gates:

- `node scripts/march-hash.mjs` → `room1: a8ab4efac15fc0376c3e4e05420f13e34d1511bd`
  (the canonical per-body hash named by the harness), `room1-repeat` identical,
  `room1-wounded` different.
- `npx tsc --noEmit -p .` clean.
- `npx vitest run` → **317 files, 5012 tests, 0 failed.**

## What changed

### The sim side (the plan's D1)

- **`webgpu/sim-clock.ts` (new).** `simTimeMs()` / `advance(dt)` / `resetSimClock()`.
  The cull dwell was already on a sim-clock local (commit `92636fae`); it now
  lives in a module the demo player can reset. `tick(dt)` calls `advance` first.
- **`webgpu/rng.ts` (new) + `rng.test.ts`.** `createRngStreams(seed)` →
  `{ bleed, fx, reload, misc }`, four independent `mulberry32` streams salted
  from ONE demo seed; a module-level `rngStreams` the game reseeds at boot from
  `?seed=` (default `Date.now() & 0x7fffffff`, logged, exposed as
  `__sdfGame.demoSeed`). The fire path's old single inline LCG (`lcgNext`/
  `lcgUnit`) and the hard-coded `bleedRng` are gone; `reloadSeed` uses
  `rngStreams.reload`, muzzle flash/smoke use `fx`, pellet seeds and gore/chunk
  tumble use `misc`, and the blood sim draws `rngStreams.bleed`.
- **`game-main.ts` — bake swap pinned to a sim frame.** `simFrame` increments at
  the top of `tick`; at submit the frame is recorded and `finishChunkBake`
  refuses to take the worker result until `simFrame >= bakeSubmitFrame + 1`. The
  landing frame is reported in `chunkStats().bakeSwapFrame`.

### The bench side (what the plan did NOT name, and the gate needed)

Three separate wall-clock leaks made the *bench itself* non-deterministic even
after the sim was pure. Each was measured, not guessed:

1. **The page's rAF loop ticks the sim during boot settle.**
   `bootPage()` waits 2.5 s for pipelines with the loop running, and the loop's
   `tick` advances the cast a wall-clock-dependent number of frames. Measured:
   `__sdfGame.probeDynamic.frames` 11 → 26 → 41 over 2 s, `bodiesOnScreen`
   2 → 3. The bench then drove its scenario from a different scene every run,
   which cascaded into `walk.droplets 0/18/19` and `fire.wounds 25/31/32`.
   Fix: **`?simidle=1`** boots with the task-6 render lock ON (`simLocked`), so
   `tick` mutates nothing while the page settles. The bench URL always carries
   it; `bench()` clears the lock and **restores it in the `finally`** (it also
   restarts the rAF loop, which would otherwise tick the sim freely between the
   probe and the measured run).

2. **The interlaced field is a two-state function of an absolute render
   counter.** `sdf-layer.ts`'s `frameIndex` picks the marched scanline band, so
   the `marchTarget`/`instances` end-of-run hashes flapped between the two
   parity states (measured: rep0 differed, rep1 == rep2). Fix:
   `sdfLayer.resetFieldPhase()` (new seam) resets `frameIndex` at the start of
   every bench run, so the RUN's frame count, not the page's, decides the phase.

3. **The probe gather is a function of the dispatch count.** Its `blend`/`fall`
   EMA makes the packed instance buffer and the dynamic layer depend on which
   tick they were last built on and on everything accumulated since boot. Fix:
   `probeGatherTick = 0` and `probeGather.reset()` (new seam on the gather
   binding, zeroes the dynamic buffer) at the start of every bench run, plus
   `demoHold = true` + `postAa.setTimeFrozen(true)` under `?simidle` so the
   gather's `frameSeed` is pinned and `view.setTime` comes off the sim clock.

The frame-hash pins are inert for normal play: they are inside
`if (new URLSearchParams(location.search).has('simidle'))`, and `simidle` is only
ever added by `scripts/sdf-game-bench.mjs`.

## Honest limits

- **Same build, same machine.** The hash is bit-pattern; it is not portable
  across GPUs or drivers.
- **The bake worker is still async.** The pin makes the swap land on the first
  frame after submit, but the worker message is only processed when JS yields
  (`resolveGpu` every `chunkFrames`). The census was identical across every run
  in this session, so it is not currently observable — but a worker slower than
  a chunk boundary can still shift the landing frame. Stage 3's recorded swap
  frame is the durable fix.
- **Determinism is not quiet.** It makes both legs do the same WORK; it cannot
  make the GPU run at the same SPEED. A millisecond A/B still needs a quiet
  machine.
- **One repeat aborted on a CDP hang** in an earlier attempt (`rep2 probe …
  never answered in 60 s`) — the known intermittent headless-Chrome hang, not a
  determinism failure. The re-run completed all three.

## Why this unblocks the crowd flip

The crowd-vs-per-body bench legs were shooting **different fights** because the
scripted scenario's aim depends on where the wall-clock-advanced cast happened to
be at the teleport. With `?seed=` + `simidle`, both legs now play the same fight,
so a fire/gib delta measures the renderer and not the scenario.

## Stage 3 — F7 recorder and replay (2026-09-14, D3, commit d755b689)

Verified on main after the merge (scratch worktree, ports 5325/9325):

- `tsc --noEmit` clean; `demo-recorder.test.ts` 3/3 pass.
- `scripts/march-hash.mjs` crowd `a8ab4efac15fc0376c3e4e05420f13e34d1511bd`, `MARCH_HASH_PERBODY=1` identical — the input seam refactor (`readInputFrame` / `applyInputFrame`, edge-derived key handling) does not touch the shipped frozen frame.
- `DEMO_HASH_DEM=docs/dev-notes/demos/synthetic-firefight-room2.dem.json node scripts/sdf-demo-hash.mjs ab`: 128/128 sampled frames identical across two fresh-page replays of the same recording (601 frames, 300 gather dispatches each).

How to use it:

- In play, press **F7** to start recording (HUD shows `REC ● frames: N`), F7 again to stop. The page POSTs the `.dem.json` to `/__lab/save-demo`; the dev server writes `docs/dev-notes/demos/<startedAt>-room<N>.dem.json` (never overwrites).
- Replay + hash: `DEMO_HASH_DEM=<file> node scripts/sdf-demo-hash.mjs ab|record|verify`.
- Bench on a recording: `BENCH_DEMO=<file> node scripts/sdf-game-bench.mjs <vite> <cdp>` — every leg replays the same fight; segments are equal thirds t0/t1/t2. The page boots with the recording's seed.
- `scripts/sdf-demo-synth.mjs` makes a synthetic recording from the scripted firefight through the same input seam (determinism fixture, not a play-feel source).

Not yet done: an equal-workload fire/gib crowd-vs-per-body bench on a recording (the flip is held on it), and a real owner recording.
