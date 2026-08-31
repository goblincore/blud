# Game perf baseline (Phase 0) — harness built, baseline NOT taken

**Date:** 2026-08-31 · **Branch:** `claude/sdf-rendering-improvements-b3b219`
**Spec:** [2026-08-31-sdf-crowd-perf-investigation-design.md](../../superpowers/specs/2026-08-31-sdf-crowd-perf-investigation-design.md)
**Plan:** [2026-08-31-game-perf-baseline.md](../../superpowers/plans/2026-08-31-game-perf-baseline.md)

## Verdict

**The harness is built, unit-tested and behaviourally correct. The baseline
number was NOT taken, because this machine cannot currently produce one that
repeats.** Three identical runs of the same scenario, back to back in one
browser session, returned overall medians of **10.1 / 5.6 / 56.1 ms**. That
spread is larger than every delta Phase 1 would want to measure, so any table
taken here would be decoration.

Do not quote a number from this session. The next step is a re-run on a quiet
machine, not more harness work.

## Why the numbers do not repeat

The machine was not quiet: the owner's own Chrome was live at ~32% CPU (58
Chrome processes) alongside the agent session, both contending for the GPU.

This is not a new discovery so much as a confirmation. The wound-hull work
(2026-08-27) already recorded that the occluder A/B "could not be resolved on
this machine — within-config noise > every delta". This session put a
controlled experiment behind that: same scenario, same page, three runs in a
row, 10x spread.

What was ruled OUT, with evidence:

- **Not a missing GPU fence.** The adapter is real Apple Metal-3 and
  `timestamp-query` IS supported. A direct probe timed 20 submitted frames at
  30-40 ms of submission against 165-172 ms of fence, i.e. ~10.0-10.7 ms/frame
  — and that figure repeated across five consecutive chunks (10.24, 10.01,
  10.06, 10.66, 9.78). The fence works, and short interleaved measurements are
  stable. It is the longer, leg-switching matrix that drifts.
- **Not a hidden page.** Every leg reported `valid: true`; zero hidden frames.
  (A hidden page has no swapchain texture, resolves to ~0.065 ms of nothing,
  and reads as a 70x speedup — the harness fails the run on any such frame.)
- **Not a WebGL fallback.** Backend asserted `webgpu` on every run.

## What the census caught — three scenario bugs, each of which produced a plausible table

The per-segment scene census (bodies / wounds / chunks at each segment's start
and end) is the most valuable thing built here. Every bug below shipped a
perfectly readable-looking result table, and none would have been caught by
looking at timings alone.

**1. The firefight annihilated its own subjects.** The first scenario fired
both barrels every 20 frames — six double blasts that shredded all of room 4's
zombies into collapsed corpses inside the first second. The table then read
`fire` and `gib` at ~9 ms against `walk` at ~40 ms, which looks like firing is
cheap. It was timing an empty floor. Now: one barrel every 40 frames.

**2. The shots never landed at all.** Teleporting the player to the room
centre put a zombie **0.97 m** away — the spawn table clusters bodies near the
centre too. `aimAtNearestSurface` pitched 26 degrees *down* into it,
`predictSlugHit` returned `actorId: -1`, and all eight pellets expired within
15 frames having hit nothing. The census read `wounds 0 -> 0` through a
segment named "fire". A second attempt (stand in the outer corner) faced a
wall instead: `bodies 1 -> 0`. The fix is goal-directed rather than heuristic —
back off 4 m from the room's **actual body centroid**, facing it. Census now
reads `wounds 0 -> 16` across the fire segment.

**3. `p95` over six samples is just the max.** 120 frames / 20-frame chunks =
6 samples per segment, and `floor(0.95 * 6) = 5` — the last index. Every "p95"
in the first table was a maximum wearing a percentile's name, which is why the
first segment (carrying each leg's setup cost) dominated every row. Throughput
now reports the **median of ~12 chunk means**; p95 is answered by the spike
pass, which has real per-frame samples.

## A fourth finding, which changes the plan

**The rooms are not a 1/2/3/4 crowd ladder.** The spec assumed benching per
room would give a free 1→4 body curve from `ROOMS[].zombies`. The census says
otherwise: standing in room 4, `bodiesOnScreen` reads **9**, not 4. The
tunnels give sightlines into the neighbouring rooms, so almost the whole
10-body population is in frustum from one position.

That is worth knowing for its own sake — it means the game's worst case is
already ~9 bodies on screen, not 4 — but it also means the crowd curve Phase 1
needs has to come from a deliberate spawn ladder, not from room choice. The
spec's crowd-ladder paragraph should be corrected before Phase 1 reads it.

## Known remaining gap

`chunks 0 -> 0` in the gib segment: the slug lands a wound (`16 -> 17`) but
does not sever, so the segment does not yet contain flying gib chunks. The
segment is therefore currently a second firing segment. Either raise the
damage or stage the sever explicitly before the gib segment is quoted.

## What was built

| File | What it is |
| --- | --- |
| `src/lab/sdf-zombie/webgpu/game-bench-scenario.ts` | Pure: the firefight as timed actions + named segments. 7 tests. |
| `src/lab/sdf-zombie/webgpu/game-bench.ts` | The harness. Injected deps, throughput + spike modes, per-segment aggregation, census. 10 tests. |
| `src/lab/sdf-zombie/webgpu/game-main.ts` | `__sdfGame.bench`, `resolveGpu`, `setCone`/`setFxaa`/`setSmear`, `aimSurface`; `predictSlugHitNow` lifted so aim and the placement gate share one predictor. |
| `scripts/sdf-game-bench.mjs` + `.sh` | CDP driver: interleaved legs, throughput matrix, census table, spike pass. |

Gates: `npx tsc --noEmit` clean; `npx vitest run src/lab` 1685 tests across 93
files, 17 of them new.

## Next step

Re-run on a quiet machine:

```bash
LAB_VITE_PORT=5277 LAB_CDP_PORT=9277 BENCH_REPEATS=3 scripts/sdf-game-bench.sh
```

Close other browsers first. Check the census table before reading any timing:
if `bodies` falls through a run, or `wounds` stays 0 through `fire`, the
numbers describe something other than a firefight and should be discarded.
