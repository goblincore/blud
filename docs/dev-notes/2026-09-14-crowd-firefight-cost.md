# Crowd firefight cost — task 1: attributing the t1 window on the owner's recording

Plan: `docs/superpowers/plans/2026-09-14-crowd-firefight-cost.md`, task 1.
Recording: `docs/dev-notes/demos/2026-09-14T21-02-05-669Z-room1.dem.json`
(3368 frames, 56 s, room 1, free aim, 110 shot inputs). Window timed here:
frames **[1123, 2245)** — the plan's fire-heavy third (t1).
Ports for this chain: vite 5323 / CDP 9323, `LAB_TMP=.lab-tmp`.
Machine load at run time: `uptime` load average 2.9–4.6; repeat spreads below
are 1–3 %, so the machine was quiet enough for the deltas quoted.

## The headline

1. **The A/B this plan rests on was confounded, and is now fixed.** Any leg that
   calls `__sdfGame.setCrowd()` *after boot* respawns the cast, and `rebuildCast`
   does not reset the global spawn counter — every body gets a new
   `nextId`-derived sim seed (`game-main.ts` `spawnAll`: `seed: 1337 + nextId * 101`).
   The crowd legs therefore replayed a **different fight** from the per-body
   control (ids 1–15 vs 16–30; `wounds 7` vs `10` at frame 1300; 3 vs 5 bodies on
   screen at frame 1900). Fixed by booting each leg's own crowd flag
   (`?crowd=0` / `?crowd=1`, verified to spawn the identical cast) so the
   post-boot `setCrowd` override is a no-op. Same bug class as the pin bugs in
   `sdf-game-bench.mjs`'s own header.
2. **On the matched fight the crowd quad loses t1 by 11.5 ms of `sdf:march`**
   (46.33 vs per-body 34.83), and the per-instance-boxes dispatch loses only
   3.9 ms (38.70). The premise of the plan survives the fix.
3. **The dominant term is (A), per-pixel input setup on pixels that discard** —
   ~9.2 ms of the 11.5 ms gap. Cutting the march step budget from 96 to **1**
   (a 96× cut) moves the quad by 3.1 ms, the boxes leg by 1.3 ms and per-body by
   0.8 ms: term (B) (steps × slots, the union fold) is ≤3 ms, i.e. ≤27 % of the
   gap. The quad rasterises 1.28–2.25 screen-areas of fragments to march
   0.18–0.28 screen-areas of pixels, so **78–92 % of the quad's fragments run the
   full per-pixel setup and then discard** — measured, not modelled.

## Step 1 — the t1 window bench

```
BENCH_DEMO=<rec> BENCH_DEMO_FRAMES=1123:2245 BENCH_ROOMS=1 \
BENCH_LEGS=crowd-off,crowd-quad,crowd-boxes BENCH_PASSES=1 BENCH_REPEATS=2 \
BENCH_FRAME_CAP_MS=250 BENCH_OUT=docs/dev-notes/2026-09-14-crowd-firefight-cost/t1 \
node scripts/sdf-game-bench.mjs 5323 9323
```

Outputs: `docs/dev-notes/2026-09-14-crowd-firefight-cost/t1/{bench.md,bench.json,passes.md,passes.json}`.

`BENCH_DEMO_FRAMES=a:b` is new in this task. It is **state-preserving**: the
harness replays frames `[0,a)` with `__sdfGame.demoReplay` first (the same driver
the frame-hash gate uses), then hands the page the `[a,b)` slice as the bench
scenario. A raw slice would replay frame `a`'s *relative* mouse deltas from the
recording's frame-0 pose; the recording is free-aim, so `applyInputFrame` skips
the absolute `look` pin and the camera would point somewhere the player never
looked. The pre-replay is ~20 s per leg-run and is logged per leg.

`sdf:march` p50 (ms), median over 2 repeats; repeat spread in brackets:

| leg | `sdf:march` p50 | spread | overall frame p50 | window t0 (1123–1496) | window t1 (1497–1870) | window t2 (1871–2244) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `crowd-off` (per-body) | **34.83** | 1 % | 39.15 / 38.38 | 57.01 | 42.86 | 9.29 |
| `crowd-boxes` | **38.70** | 3 % | 42.25 / 43.37 | 50.47 | 47.24 | 8.93 |
| `crowd-quad` | **46.33** | 2 % | 44.71 / 45.35 | 52.63 | 50.06 | 8.82 |

The last three columns are fenced-frame per-segment medians (thirds of the
window), not `sdf:march`; they are here because a single number hides which third
binds. Quad − per-body = **+11.50 ms** of `sdf:march`; boxes − per-body = **+3.87 ms**.

Census and frame-hash drift: **CENSUS IDENTICAL across repeats** and
**FRAME HASH IDENTICAL across repeats** (bench report tail). Scenario census over
the window: `bodies 3→8 | 8→7 | 7→0`, `wounds 7→7 | 7→23 | 23→23`,
`256 splats` — the fire-heavy third is the middle one, as the plan says.

## Step 2 — the probe: where the fragments and steps go

```
PROBE_OUT=docs/dev-notes/2026-09-14-crowd-firefight-cost/probe.json \
node scripts/crowd-t1-probe.mjs 5323 9323      # frames 1300,1600,1900; 3 legs
```

`scripts/crowd-t1-probe.mjs` (new) boots a **fresh page per (leg, frame)** with
the leg's own crowd flag, pins the bench's ship defaults, replays frames `[0,N)`
with `demoReplay({hold:true})`, steps 2 (the canvas is stale straight after a
replay — see the 2026-09-14 capture note), then reads `occupancy()`
(march debug mode 4: raw `steps`/`hit`/`rasterised`, returned *before* the
miss-discard), `crowdInfo()`, `actorDump()`, `normalGradientPieces()` (prims per
body) and `readTileSlotMask()`. The scene descriptor comes from `demoReplay`'s
own returned census at frame N.

The fixes that make the rows comparable: **all three legs now read the same sim**
(bodies 4/4/3, wounds 7/7/23, prims 364/334/243 — identical across legs at every
frame), and **`stepped` pixels are identical across legs** (134 647 / 87 306 /
89 117), because the bodies and the resulting rays are the same.

| leg | frame | bodies | wounds | prims (visible) | stepped px | coverage | quad frag px (Σ rectFrac·px) | quad rectFrac | setup-no-step UB | steps/stepped px | miss step share | tileMulti |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| crowd-off | 1300 | 4 | 7 | 364 | 134 647 | 28.1 % | – | – | – | 4.77 | 44.3 % | 50.4 % |
| crowd-boxes | 1300 | 4 | 7 | 364 | 134 647 | 28.1 % | – | – | – | 4.74 | 44.8 % | 50.4 % |
| crowd-quad | 1300 | 4 | 7 | 364 | 132 966 | 27.7 % | 613 737 | 1.279 | 480 771 | 6.18 | 43.2 % | 50.4 % |
| crowd-off | 1600 | 4 | 7 | 334 | 87 306 | 18.2 % | – | – | – | 4.09 | 50.5 % | 39.2 % |
| crowd-boxes | 1600 | 4 | 7 | 334 | 87 306 | 18.2 % | – | – | – | 4.13 | 51.1 % | 39.2 % |
| crowd-quad | 1600 | 4 | 7 | 334 | 87 306 | 18.2 % | 940 351 | 1.959 | 853 045 | 5.86 | 43.9 % | 39.2 % |
| crowd-off | 1900 | 3 | 23 | 243 | 89 117 | 18.6 % | – | – | – | 5.82 | 50.5 % | 10.3 % |
| crowd-boxes | 1900 | 3 | 23 | 243 | 89 117 | 18.6 % | – | – | – | 6.36 | 47.9 % | 10.3 % |
| crowd-quad | 1900 | 3 | 23 | 243 | 89 117 | 18.6 % | 1 077 401 | 2.245 | 988 284 | 7.32 | 48.5 % | 10.3 % |

Reading the columns:

- **quad frag px** = Σ over live types of `rectFrac × screenPx` (the target is
  800×600 = 480 000 px at scale 1.0). Each type draws its own quad, so this is
  the fragment-invocation count that runs the per-pixel setup. `1.279`…`2.245`
  screen-areas — the plan's note said 45/71/81 %; on the matched fight the three
  *visible* types' rects sum to 128–225 %. The rect is inflated by
  `maxBlendK·4 + RAY_CULL_SLACK + QUAD_ENTRY_SLACK` and clamped outward to whole
  tiles.
- **setup-no-step UB** = quad frag px − stepped px: an **upper bound** on
  fragments that ran the setup and did not step (the mode-4 readback is
  front-most-only, so a fragment that stepped and then lost the depth test is
  counted here too). 78 % / 91 % / 92 % of the quad's fragments.
- **tileMulti** is the fraction of tiles where ≥2 same-kind proxy boxes overlap
  (`readTileSlotMask`). It is a property of the bodies, identical across legs —
  a tile-granular bound on the union fold, **not** `gPixN`, which no exposed
  seam reports.
- The quad's stepping pixels take 1.2–1.4× more steps than per-body's
  (6.18/4.77, 5.86/4.09, 7.32/5.82) and hit *more* pixels (e.g. 87 917 vs 64 530
  at frame 1300): one ray per pixel over the union of a tile's bodies finds
  flesh the per-body box-clamped ray cannot. That is the quad dispatch's benefit,
  and it is also why its step term is not zero.

## Step 3 — the attribution: (A) vs (B) vs (C)

The counters show the two candidate costs exist; they cannot by themselves price
them, because the mode-4 readback is front-most-only and no seam counts
per-fragment discards (Task 2's change is what will). The step budget is the
seam that separates them without a kernel change — it scales the per-STEP term
and leaves the per-pixel setup untouched. Same window, `BENCH_PRELUDE` applied
after the leg overrides so it wins over `setMarchSteps(96)`, 1 repeat, outputs in
`t1-step1/`:

```
BENCH_DEMO_FRAMES=1123:2245 BENCH_LEGS=crowd-off,crowd-boxes,crowd-quad \
BENCH_PRELUDE='__sdfGame.setMarchSteps(1)' BENCH_PASSES=1 BENCH_REPEATS=1 \
BENCH_OUT=docs/dev-notes/2026-09-14-crowd-firefight-cost/t1-step1 \
node scripts/sdf-game-bench.mjs 5323 9323
```

`sdf:march` p50 (ms) at 96 vs 1 march steps, and the per-step term:

| leg | 96 steps | 1 step | step/shading term (96−1) |
| --- | ---: | ---: | ---: |
| `crowd-off` (per-body) | 34.83 | 34.02 | **0.81** |
| `crowd-boxes` | 38.70 | 37.45 | **1.25** |
| `crowd-quad` | 46.33 | 43.25 | **3.08** |

Decomposition of the matched-fight quad − per-body gap (+11.50 ms):

| term | ms | evidence |
| --- | ---: | --- |
| **(A) per-pixel setup on pixels that discard** | **≈ 9.2** | quad(1) − per-body(1) = 43.25 − 34.02 |
| — of which the crowd material's own per-fragment setup tax | ≈ 3.4 | boxes(1) − per-body(1) = 37.45 − 34.02 |
| — of which the quad's over-coverage (setup on empty/entry-miss fragments) | ≈ 5.8 | quad(1) − boxes(1) = 43.25 − 37.45 |
| **(B) steps × slots (union fold) + the shading a hit enables** | **≈ 2.3** | (quad(96)−quad(1)) − (per-body(96)−per-body(1)) = 3.08 − 0.81 |

Rounding accounts for the rest (9.2 + 2.3 = 11.5). **The dominant term is (A):
per-pixel input setup on pixels that turn out empty — 80 % of the gap.** The
union-field tax is real but small on this recording: t1 has at most three bodies
on screen, `tileMulti` is 10–50 %, and cutting the whole step budget by 96× buys
only 3 ms.

### (C) something else found — the confound (the important one)

`setCrowd()` mid-session is not sim-neutral. `rebuildCast()` respawns every body
and `spawnAll` seeds each actor from the global spawn counter
(`seed: 1337 + nextId * 101`, `game-main.ts`), which rebuild does not reset. So a
crowd toggle gives every body a new wander seed and a different fight. Direct
probe (ad-hoc, not committed — the reproduction below is the durable artifact):

```
boot(per-body default)  ids 1..15   at (-4.8,-4.8) (4.8,-4.8) ...
after setCrowd(true)    ids 16..30  at (-4.8,-4.8) (4.8,-4.8) ...   # same poses, new integer key
after setCrowd(false)   ids 31..45  ...
```

and it is not cosmetic: on the recording, per-body (`?crowd=0` boot, ids 1–15)
read `wounds 7 / bodies 4` at frame 1300 while a leg that toggled the crowd on
after boot (ids 16–30) read `wounds 10 / bodies 5`.

**Reproduced through the repo's own tool** (committed artifact,
`t1-confound-repro/`): `BENCH_QUERY=crowd=1` boots the page as a crowd page, so
`crowd-off` reaches per-body by toggling mid-session while `crowd-quad` keeps the
boot cast. One run, same recording, same window:

```
BENCH_DEMO=<rec> BENCH_DEMO_FRAMES=1123:2245 BENCH_QUERY='crowd=1' \
BENCH_LEGS=crowd-off,crowd-quad BENCH_PASSES=1 BENCH_REPEATS=1 BENCH_FRAME_CAP_MS=250 \
BENCH_OUT=docs/dev-notes/2026-09-14-crowd-firefight-cost/t1-confound-repro \
node scripts/sdf-game-bench.mjs 5323 9323
```

| leg | t0 bodies/wounds | t1 bodies/wounds | t2 bodies/wounds | `sdf:march` |
| --- | --- | --- | --- | ---: |
| `crowd-off` (toggled mid-session) | 3→8 / 11→11 | 8→8 / 11→**26** | 8→1 / 26→26 | 33.19 |
| `crowd-quad` (boot cast) | 3→8 / 7→7 | 8→7 / 7→23 | 7→0 / 23→23 | 44.20 |

versus the fixed harness (`t1/bench.json`, all three legs): t0 `3→8 / 7→7`,
t1 `8→7 / 7→23`, t2 `7→0 / 23→23`. The confounded per-body leg takes 11 wounds
where the real fight takes 7. The boot-flag fix is what the other tables here use.

**Consequence for earlier numbers.** Any A/B in this repo whose legs differ in
`setCrowd` must be re-read with this in mind — including the `## Flip decision
bench` table this plan's premise quotes (`t1 crowd 58 / boxes 53 / per-body 42`),
because at that time the default *was* crowd and the `crowd-off` leg reached
per-body by toggling mid-session. The plan's *direction* survives (the matched
A/B still shows the quad losing t1), but the absolute per-leg numbers were taken
on different fights. The harness fix here is the boot flag, not a sim change:
`rebuildCast` deliberately respawns, and changing `spawnAll`'s seed derivation
would move every recorded demo's trajectory.

**Fixed in this task:** `scripts/sdf-game-bench.mjs` now boots each leg with its
own crowd flag (`legUrl()`; `bootPage(settleMs, legName)`), and
`scripts/crowd-t1-probe.mjs` does the same and asserts `crowdInfo().on` matches
the boot flag. Non-crowd legs keep the bare URL, so no other leg's boot changes.

**Measurement gap, stated honestly.** "Pixels that ran the fragment" is only
reported by a seam for the quad (`rectFrac × screenPx`); the per-body/boxes
census publishes no raster footprint (the tile-mask probe is tile-granular and
only returns the ≥2-box mask). The mode-4 `rasterised` count is front-most-only,
so the quad's setup-discard figure is an upper bound, and the split of (A) between
**empty-tile** and **entry-miss** discards is **not observable without a kernel
counter** — the plan's Task 2 (move the empty-tile discard before the per-pixel
setup) is exact and cheap to verify by timing, and its number is the missing
piece. What is already established: the addressable area is 481 k–988 k
fragments/frame (78–92 % of the quad's raster), and the whole (A) term is ~9 ms.

## Gates (no kernel file changed in this task; run to prove it)

```
$ MARCH_HASH_CROWD=1 MARCH_HASH_TILES=1 node scripts/march-hash.mjs
{"room1":"a350361d6a223946a4cb8aac9bc2a3a70ee15bfd","room1-repeat":"a350361d6a223946a4cb8aac9bc2a3a70ee15bfd","room1-wounded":"07f60ecfd4e1e1cac9e26b8527d50abc74894e95"}
exit=0

$ MARCH_PARITY_TILES=1 node scripts/march-parity.mjs
{"room":1,"tiles":true,"dispatch":"quad",...}
{"room":2,"tiles":true,"dispatch":"quad",...}
PASS
exit=0

$ node scripts/march-hash.mjs        # default = per-body
{"room1":"a8ab4efac15fc0376c3e4e05420f13e34d1511bd","room1-repeat":"a8ab4efac15fc0376c3e4e05420f13e34d1511bd","room1-wounded":"da785297dcc3f677320c563501ca861bac22d6d6"}
exit=0
```

Crowd canonical `a350361d…` and per-body canonical `a8ab4efa…` are both
unmoved, and `MARCH_PARITY_TILES=1` PASSes. Only scripts changed, so this is the
expected result; it is recorded rather than assumed.

## Task 2 — empty-tile discard ahead of the per-pixel input setup (2026-09-14)

**What changed.** The quad crowd material rasterises the union rect, and the
only discard that ran before the march was on the *post-cull* `gTileN`, inside
`MARCH_TRACE_SETUP` — after the material had already evaluated its
`occFetch` / two `shellFetch`es / `prevFetch` / temporal / depth-pre call
arguments and after `loadInstance`'s record load. Task 2 hoists the gate ahead
of all of them:

- `march.wgsl.ts` exports `QUAD_TILE_EMPTY_WGSL` (`quadTileEmpty`), the
  tile-header read keyed by the SAME `gx`/`gy`/`floored-screenUV`/clamp index
  formula the preload uses. A test pins the three index lines in both texts.
- `zombie-gpu.ts` `createMarchMaterial` wraps the whole march call in a TSL
  `Fn` for the quad crowd material only (guarded by an explicit `rays.rayDir`,
  which the hull-refine twin does not set — it passes `rays` but no `tiles`),
  whose FIRST statement is
  `If(instCfg.y > 1.5 && tileCfg.x > 0.5 && quadTileEmpty(...)) { Discard(); }`.
  Because the fetches are argument nodes of the wrapped `marchBody` call, they
  are generated after the gate — an empty-tile fragment discards before any of
  them, and before the record load and the wound list. The existing
  `gTileN < 0.5` discard stays and still covers tiles-off callers. Per-body and
  box materials generate byte-identical source (the guard is false).

**Why it is exact.** The gate fires only when the header count is 0, i.e. the
tile can hold no surface; discarding such a fragment writes nothing. Proven
three ways, not argued:

1. **Liveness.** Temporarily replacing the condition with a literal `true` and
   re-running the crowd hash FAILs with `room1=b6422b4193e56385a0f2df5ec4c8f3c1cbaf1f2c`
   — the gate is wired into the output and does discard pixels. Reverted.
2. **Non-interference.** With the real condition the crowd canonical is
   unmoved (`a350361d…`), so it discards only tiles that were empty.
3. **Parity.** `MARCH_PARITY_TILES=1` PASS, lines identical to Task 1.

### Gates (after the change)

```
$ MARCH_HASH_CROWD=1 MARCH_HASH_TILES=1 node scripts/march-hash.mjs
{"room1":"a350361d6a223946a4cb8aac9bc2a3a70ee15bfd","room1-repeat":"a350361d6a223946a4cb8aac9bc2a3a70ee15bfd","room1-wounded":"07f60ecfd4e1e1cac9e26b8527d50abc74894e95"}
exit=0

$ MARCH_PARITY_TILES=1 node scripts/march-parity.mjs
{"room":1,"tiles":true,"dispatch":"quad","flat":false,"hitA":33344,"hitB":33344,"maskDiff":0,...,"maxDz":0.0009889602661132812,...}
{"room":2,"tiles":true,"dispatch":"quad","flat":false,"hitA":30561,"hitB":30562,"maskDiff":1,"maskDiffFrac":0.000032721442361179283,"maxDz":0.0021837353706359863,...}
PASS
exit=0

$ node scripts/march-hash.mjs        # default = per-body
{"room1":"a8ab4efac15fc0376c3e4e05420f13e34d1511bd","room1-repeat":"a8ab4efac15fc0376c3e4e05420f13e34d1511bd","room1-wounded":"da785297dcc3f677320c563501ca861bac22d6d6"}
exit=0

$ npx vitest run march.wgsl.test.ts deferred-sdf.test.ts crowd-type.test.ts zombie-gpu.test.ts
Test Files  4 passed (4) / Tests  295 passed (295)
```

### t1 bench, before vs after (`sdf:march` p50 ms, 2 repeats)

```
BENCH_DEMO=<rec> BENCH_DEMO_FRAMES=1123:2245 BENCH_ROOMS=1 \
BENCH_LEGS=crowd-off,crowd-quad BENCH_PASSES=1 BENCH_REPEATS=2 \
BENCH_FRAME_CAP_MS=250 BENCH_OUT=<dir> node scripts/sdf-game-bench.mjs 5323 9323
```

Machine load 2.6 (before) / 2.25 (after); both runs report identical census and
frame hashes across repeats.

| run | leg | rep0 | rep1 | mean |
| --- | --- | ---: | ---: | ---: |
| before | `crowd-off` | 28.28 | 28.36 | 28.32 |
| before | `crowd-quad` | 37.69 | 37.77 | **37.73** |
| after | `crowd-off` | 28.99 | 28.61 | 28.80 |
| after | `crowd-quad` | 36.75 | 36.82 | **36.79** |

Raw quad delta **−0.95 ms**; the control leg drifted **+0.48 ms** slower, so the
machine-relative saving is **≈1.4 ms** (quad − off: 9.41 → 7.99 ms).

**Reading.** The gate is exact and helps, but only ~1.4 ms — much less than the
~9 ms Task 1 attributed to "setup on discarded pixels". So the empty-tile
fraction of the quad's raster is small: the union rect is clamped to whole tiles
plus one lit-tile margin, so most discarded fragments sit in NON-empty tiles and
discard later on the entry test (`bodyEntry > 1e8`) or the miss. The remaining
lever for that ~8 ms is Task 4 (per-instance raster rects) — Task 2 does not close
the t1 gap, and the default still cannot flip. This is the empty-tile vs
entry-miss split Task 1 said was the missing number: empty-tile ≈ 1.4 ms of it.

## Task 3 — per-step slot sphere skip: investigated, **rejected** (2026-09-14)

**Verdict: the plan's clamp cannot be made sound, and the sound exact forms do
not pay. The kernel is unchanged; `sdf:march` on the t1 window is not improved
by any variant tried. Do not retry Task 3; Task 4 is the remaining lever.**

Task 1 priced the union/step term at only ~2.3 ms of the ~11.5 ms quad gap
(cutting the whole 96-step budget to 1 buys 3.08 ms on the quad), so this was
never going to close the gap — but four variants were built and measured to
settle it. All four touched only `MAP_BODY`'s tiled per-slot fold, gated to the
quad dispatch (`instCfg.y > 1.5`); per-body (cluster walk) and the box dispatch
were left byte-identical.

### (a) The plan's literal clamp — unsound, parity FAIL

`ds = length(p - centre) - (b.w + reach * max(g.z, 1) + slack)` (the inflated
clearance), skip the fold when `ds > 0`, `d = min(d, ds)`.

Root cause of the failure: **`d` is both the step length and the hit test**
(`if (d < hitEps) { hit; }` in `MARCH_TRACE_LOOP`). The inflated sphere sits
`reach * distort + slack` OUTSIDE the body's bound sphere, so the clamp reads
~0 there — a virtual surface in empty space. Every grazing ray inside an
inflated sphere but outside the body reports a hit.

```
$ MARCH_HASH_CROWD=1 MARCH_HASH_TILES=1 node scripts/march-hash.mjs
{"room1":"6efd9d9f5b824d57b4a0cf6167916a28933e6369","room1-repeat":"6efd9d9f5b824d57b4a0cf6167916a28933e6369","room1-wounded":"8b18b690f42ba037267317331a0b5e1d6a1e1e2a"}   # deterministic

$ MARCH_PARITY_TILES=1 node scripts/march-parity.mjs
room1 maxDz 0.0458, maskDiffFrac 0.1419 (hitA 33344 / hitB 38077)
room2 maxDz 0.0863, maskDiffFrac 0.1893 (hitA 30561 / hitB 36345)
FAIL (18): maskDiffFrac(hard) > 0.005 and maxDz(hard) > 0.02 on both rooms
exit=1
```

14–19 % **phantom hits** (flat-albedo RGB still 0 channels — extra surfaces, not
material changes). Hash and parity were both reverted; the pin was never kept.

### (b) A field-units clamp — still flips rim pixels

`ds = (length(p - centre) - b.w) / max(g.z, 1) - reach`, applied only above
`RAY_CULL_SLACK`. This is the correct *field* lower bound (reported sd under-
reports Euclid by the distortion factor), but it still tends to 0 at the
inflated boundary, so it stays a soft virtual surface. Room 1 passed; room 2
flipped 28 rim pixels — `maskDiffFrac 0.0009162` against the ratified `7e-5`
(≈2 px); `maxDz 0.00237` was inside `4e-3`. Reverted.

### (c) Exact pre-cull against the running union min — correct, but slower

A construction that cannot change the field: use `foldGroup`'s own cull
(`sphereDist > (d + counts.w * 4.0) * grp.z`) but evaluate it against the
running union `dUnion` instead of the per-slot `1e9`. A group that fails it
cannot beat `dUnion`, so skipping it leaves the union, the winning slot and the
argmin bit-identical. Confirmed exact:

```
$ MARCH_HASH_CROWD=1 MARCH_HASH_TILES=1 node scripts/march-hash.mjs
{"room1":"a350361d6a223946a4cb8aac9bc2a3a70ee15bfd","room1-repeat":"a350361d6a223946a4cb8aac9bc2a3a70ee15bfd",...}

$ MARCH_PARITY_TILES=1 node scripts/march-parity.mjs
PASS   # byte-identical metrics to the Task-2 baseline
```

The crowd canonical did **not** move (no re-pin needed) — and the bench says
why that is not a win: `foldGroup`'s cull needs a small `d`, so skipping the
first group of a slot just makes the *second* group the first and it folds from
`1e9` anyway. The union tax is mostly **live** folds, not dead slots.

| run | `crowd-off` (mean) | `crowd-quad` (mean) | quad − off |
| --- | ---: | ---: | ---: |
| before (HEAD, Task 2) | 28.32 | 36.59 | **8.27** |
| (c) exact pre-cull | 28.02 | 37.30 | **9.28** |

Regression ≈ **+1.0 ms** machine-relative (`t1-task3-before/`,
`t1-task3-after/`). Reverted.

### (d) Bound-sphere clearance — parity PASS, effect unresolved

`sd = length(p - centre) - b.w` (clearance to the **bound** sphere, which
contains the prims), skip when `sd > reach * max(g.z, 1) + QUAD_ENTRY_SLACK`,
`d = min(d, sd)`. Unlike (a)/(b), the injected value is `≥ reach + slack` at the
skip boundary — far above any `hitEps` — so no virtual surface; and `sd` is a
lower bound of the Euclid clearance, so `min` over groups stays under the union
clearance and cannot overshoot, while `sd` is often a larger step than the
folded (distortion-under-reported) field.

```
$ MARCH_PARITY_TILES=1 node scripts/march-parity.mjs
PASS   # room1 maskDiff 0 maxDz 0.0009889602661132812; room2 maskDiff 1 maxDz 0.0021837353706359863

$ MARCH_HASH_QUERY=crowd=1 MARCH_HASH_TILES=1 node scripts/march-hash.mjs
{"room1":"127ccc0e43377be84825f3f20312aea3fcb4d2dd","room1-repeat":"127ccc0e43377be84825f3f20312aea3fcb4d2dd",...}
```

Parity passed with the *same* metrics as the baseline, but the canonical moved
(step lengths changed), so this variant would need a re-pin. The bench does not
justify one: `t1-task3-boundsphere/` (2 repeats) reads `crowd-off` 28.39 /
30.09 and `crowd-quad` 36.16 / 38.64 — the control drifted 1.7 ms between
identical repeats (6 %), i.e. larger than the ~0.5 ms best-case delta
(quad − off 7.77 / 8.55 vs baseline 8.27). **Unresolved, not a win.** Reverted
rather than re-pin the crowd canonical for noise.

### Why this is the end of the line for Task 3

- The addressable term is ~2.3 ms of an ~8 ms post-Task-2 gap; even a perfect
  union-fold removal cannot flip the default.
- The only sound field-preserving form (c) makes things worse, because the
  per-slot fold's cost is dominated by genuine live folds, which Task 1 already
  saw as "steps × slots" (≤27 % of the original gap).
- The only form that both skipped work and lengthened steps (d) is within
  measurement noise on this machine and would churn the crowd canonical for it.

**Next:** Task 4 — per-instance raster rects for the ~5.8 ms of entry-miss
setup-on-discard. Task 1's bar for starting it (setup on discarded pixels ≥3 ms)
is met.

### Gates on the final (reverted) tree

```
$ MARCH_HASH_CROWD=1 MARCH_HASH_TILES=1 node scripts/march-hash.mjs
{"room1":"a350361d6a223946a4cb8aac9bc2a3a70ee15bfd","room1-repeat":"a350361d6a223946a4cb8aac9bc2a3a70ee15bfd","room1-wounded":"07f60ecfd4e1e1cac9e26b8527d50abc74894e95"}
exit=0

$ node scripts/march-hash.mjs        # default per-body
{"room1":"a8ab4efac15fc0376c3e4e05420f13e34d1511bd","room1-repeat":"a8ab4efac15fc0376c3e4e05420f13e34d1511bd","room1-wounded":"da785297dcc3f677320c563501ca861bac22d6d6"}
exit=0

$ MARCH_PARITY_TILES=1 node scripts/march-parity.mjs
room1 tiles=1 dispatch=quad flat=0: hitA 33344 hitB 33344 maskDiff 0 maxDz 0.0009889602661132812 rgbMax 0.294435515999794
room2 tiles=1 dispatch=quad flat=0: hitA 30561 hitB 30562 maskDiff 1 maxDz 0.0021837353706359863 rgbMax 0.1492014229297638
PASS
exit=0

$ npx vitest run march.wgsl.test.ts deferred-sdf.test.ts crowd-type.test.ts zombie-gpu.test.ts
Test Files  4 passed (4) / Tests  295 passed (295)
```

Crowd canonical `a350361d…` and per-body `a8ab4efa…` are both unmoved — the
committed kernel is byte-identical to Task 2. **No hash re-pin was made: the
plan's clamp was not kept, and the one hash-moving variant was rejected.**

## Files

- `scripts/sdf-game-bench.mjs` — `BENCH_DEMO_FRAMES=a:b` (state-preserving
  window), per-leg crowd boot flag (`legUrl`), `applyDemoPrelude`.
- `scripts/crowd-t1-probe.mjs` — new; the per-leg/frame counter probe.
- `src/lab/sdf-zombie/webgpu/march.wgsl.ts` — `QUAD_TILE_EMPTY_WGSL`.
- `src/lab/sdf-zombie/webgpu/zombie-gpu.ts` — quad-only TSL `Fn` gate in
  `createMarchMaterial` (`quadTileEmptyNode`).
- `src/lab/sdf-zombie/webgpu/march.wgsl.test.ts` — tile-index text pin.
- `docs/dev-notes/2026-09-14-crowd-firefight-cost/t1/`, `t1-step1/`,
  `t1-confound-repro/`, `t1-task2-before/`, `t1-task2-after/` — bench outputs;
  `probe.json` — probe outputs.

### Task 3 (rejected — no code kept)

- `src/lab/sdf-zombie/webgpu/march.wgsl.ts` — four per-step fold variants built
  and measured, all reverted; the file is byte-identical to Task 2. The
  variants and their parity/bench numbers are recorded in the Task 3 section
  above so they are not retried.
- `docs/dev-notes/2026-09-14-crowd-firefight-cost/t1-task3-before/` — t1 baseline
  bench (HEAD). `t1-task3-after/` — variant (c) exact pre-cull (regression).
  `t1-task3-boundsphere/` — variant (d) bound-sphere clamp (noise).
- `scripts/march-hash.mjs` — pin restored to `a350361d…`; no re-pin made.

## Task 4 — per-instance raster rects: built, measured, **no-op on this fight** (2026-09-15, branch `dispatch/2026-09-14-crowd-t1-task45`, not merged)

Per-instance clipped rects with a disjoint decomposition (so a pixel is shaded once per type; stencil cannot skip the fragment shader when the march writes depth). The probe reported `unionFrac == bboxFrac` on every sampled t1 frame: the instances' inflated rects overlap into one blob, so the union of per-instance rects IS the union bbox and the fragment count cannot fall. Bench before 39.15 vs after 38.92 ms frame p50 (within spread). Reverted; the branch keeps the code and outputs for reference. Task 5 (the full-recording bar) timed out before running.

**Where the ~8 ms actually is.** After Task 2, discarded fragments sit in NON-empty tiles and discard on the entry test (`bodyEntry > 1e8`) or the miss, having already paid the occ/shell/prev fetches and the record load. The next exact lever is the same move as Task 2 for the entry miss: preload the tile list and run the per-ray sphere entry test before the per-pixel fetches, and discard there.

**Caveat on the earlier flip table** (`## Flip decision bench` in the stage-a note): its `crowd-off` leg reached per-body by toggling `setCrowd` mid-session while the default was crowd, which respawns the cast with new seeds — the legs fought different fights. The matched-fight numbers here supersede it (t1 window: quad 46.3 / boxes 38.7 / per-body 34.8 ms of march before Task 2). The direction and the hold-the-flip decision stand.

## Task 5 — the bar on the full recording, matched fights (2026-09-15, main at 773af1e1, Task 2 in)

`BENCH_DEMO=<rec> BENCH_ROOMS=1 BENCH_LEGS=crowd-off,crowd-quad,crowd-boxes BENCH_PASSES=1 BENCH_REPEATS=2 BENCH_FRAME_CAP_MS=250`, ports 5325/9325, `LAB_TMP` OUTSIDE the worktree (a profile under `.lab-tmp` inside the worktree made vite reload the page mid-bench and all three legs failed). Census identical across legs and repeats (bodies 0→3→0→1, wounds 0→7→23→23, no gibs in this fight); frame hash identical across repeats; worst spread 12 %.

| leg | frame p50 (rep0 / rep1) | `sdf:march` t0 | t1 | t2 | overall march |
| --- | ---: | ---: | ---: | ---: | ---: |
| `crowd-off` (per-body) | 19.8 / 19.2 | 16.3 / 16.1 | 39.5 / 39.1 | 3.9 / 4.6 | 12.0 / 12.2 |
| `crowd-quad` | 20.3 / 20.2 | 19.4 / 17.3 | 46.9 / 39.2 | 11.6 / 11.3 | 20.3 / 19.5 |
| `crowd-boxes` | **17.3 / 15.4** | **12.5 / 12.2** | 48.2 / 40.1 | 4.2 / 4.3 | 13.4 / 14.0 |

Bar (t1 ≤ per-body, overall ≤, t2 ≤ 5 ms): **quad** fails t1 (rep0) and t2 (11.5 ms — the blend-reach rect beside the camera); **boxes** meets overall (wins by 2–4 ms of frame) and t2, and is within repeat spread on t1. So the crowd march with the *boxes* dispatch is already at parity-or-better with per-body on this real run, and the quad's remaining deficit is the raster footprint the box dispatch does not have. Task 6 (entry-miss discard before setup) targets exactly that; if it lands, quad ≈ boxes and the default choice becomes crowd (either dispatch) vs per-body on the many-body scenes, not this one.

Note the earlier confounded table showed per-body with a 10–16 ms `sdf:march-chunks` pass in t0 (gibs). The matched fight has no gibs, so per-body's chunk cost is absent here; a gib-heavy recording would tilt further toward crowd.

## Task 6 — entry-miss discard before the per-pixel setup: investigated, **rejected** (2026-09-15)

**Verdict: the entry-miss hoist is implementable and semantically exact, but it
MOVES the byte-exact crowd canonical `a350361d…` to `fb09bda0…` by GPU
floating-point scheduling, and its t1 gain is inside repeat noise. Following
Task 3, no code is kept and the canonical is not re-pinned. The kernel tree is
byte-identical to Task 2/3.**

Task 2 bought ~1.4 ms by hoisting the *empty-tile* discard (pure integer) ahead
of the fetches; Task 1 priced the whole setup-on-discard term at ~9 ms, so
~8 ms was expected to sit in NON-empty tiles that discard later on the entry
test. Task 6 was to do for the entry miss what Task 2 did for the empty tile.

### What was tried

Two implementations, both guarded to the quad crowd material only.

1. **Second copy (rejected immediately).** A pure `quadEntryMiss` predicate
   duplicating the preload's ray-vs-inflated-sphere loop, called from the
   material gate after `quadTileEmpty`. This is the shape the plan allows only
   "if the reorder is impossible"; it was measured to prove the mechanism and
   then dropped. Liveness was proven (`return true` → all-discard hash
   `b6422b41…`). With the real condition the canonical moved to `fb09bda0…`.

2. **The reorder (the plan's preferred form).** `TILE_PRELOAD_WGSL` /
   `quadTilePreload` moves the ACTUAL preload out of `MARCH_TRACE_SETUP` into
   a function the material gate calls BEFORE the occ/shell/prev fetches, the
   record load and the wound list. It writes the existing `gTile*`/`gPix*`
   globals and `gTileEntryT`, sets a new `gTilePreloaded` flag, and returns
   `entryT > 1e8` — the trace's own discard bound. `MARCH_TRACE_SETUP`'s
   preload is wrapped in `if (gTilePreloaded < 0.5)`, so per-body, box and
   refine callers (which never call the gate) run it exactly as before. This
   introduces NO new march arithmetic and no duplicated loop: the FP work is
   relocated, not repeated. The generated WGSL was dumped and inspected:
   `quadTilePreload(&NodeBuffer_1882, &NodeBuffer_1883, …)` runs before
   `marchBody(...)`, and the trace's copy is inside
   `if (gTilePreloaded < 0.5)`.

### Why it is exact in hit-set but not byte-exact

Liveness (both forms): replacing the return with a literal `true` moves the
crowd hash to the all-discard `b6422b41…`, so the gate is wired and discards.

Parity is unchanged: `MARCH_PARITY_TILES=1` PASS with the same metrics as the
Task-2 baseline (room1 maskDiff 0 maxDz 0.00098896; room2 maskDiff 1
maskDiffFrac 3.27e-5 maxDz 0.00218374). Reading the raw march target with the
hoist vs the un-hoisted tree and decoding both float buffers in Node gives:

| metric | hoist vs no-gate |
| --- | ---: |
| differing pixels | 5918 / 480000 |
| hit mask difference | **0** (hitA = hitB = 33344) |
| max \|Δdepth\| | 0.0008773 |
| max \|Δrgb\| | 0.01095 |

So the hoist discards only pixels the trace already discarded — the hit SET is
identical. The hash moves because adding the gate's FP (the sphere tests, and
even a relocated copy of them) changes how the GPU compiler schedules /
contracts the march's own FP: ~1 % of pixels shift by a few ULPs (the first
one differs only in the last mantissa bit, with identical alpha). It is not an
over-discard and not a semantics bug.

Controls that pin the mechanism (each a full crowd-hash run):

- A pure-integer gate function in the same position (`return head.y < 1u`,
  `return false`, a coin-flip look using only `tileEnt[0].x`) leaves the
  canonical `a350361d…` UNMOVED — integer/pointer work does not perturb it.
- Any version whose gate body contains the FP sphere loop moves it, even with
  the return forced false (`var entryT = 0.0;`) and even with the rayCull and
  sphere reach neutralised (`reach = 1000`, `rayCull = false`).
- Passing the ray directly (`rd`) instead of recomputing
  `normalize(worldPos - camPos)` in the gate does NOT help (`fb09bda0…`). The
  duplicate normalize is not the cause; the relocated FP is.
- The generated shader text for the `fb09bda0` tree differs from the
  `a350361d` tree by exactly the gate function and its call — the march body is
  byte-identical. The move is a scheduling perturbation, not a code change.

**This is why the plan insists the preload be MOVED and not copied, and why
even moving it does not clear a byte gate here: the byte-exact hash is
sensitive to FP instruction scheduling, not only to correct arithmetic. Task 2
survived only because the empty-tile gate is integer-only.**

### t1 window bench (frames 1123:2245, 2 repeats)

```
BENCH_DEMO=<rec> BENCH_DEMO_FRAMES=1123:2245 BENCH_ROOMS=1 \
BENCH_LEGS=crowd-off,crowd-quad BENCH_PASSES=1 BENCH_REPEATS=2 \
BENCH_FRAME_CAP_MS=250 BENCH_OUT=…/t1-task6-after \
node scripts/sdf-game-bench.mjs 5333 9333
```

(Ports: this chain's plan ports 5323/9323 were held by the concurrent
`2026-09-14-crowd-t1-task45` lab for the whole run — a stale/again-live vite
serving a different worktree, which would have silently answered the gates
against the wrong tree — so every task-6 gate and bench here used 5333/9333
with `LAB_TMP=.lab-tmp`.)

`sdf:march` p50 (ms) per repeat, from `bench.json`:

| run | leg | rep0 | rep1 | mean | mean quad − off |
| --- | --- | ---: | ---: | ---: | ---: |
| before (Task-3 HEAD, `t1-task3-before/`) | `crowd-off` | 28.28 | 28.36 | 28.32 | — |
| before | `crowd-quad` | 37.69 | 36.75 | 36.59 | **8.27** |
| after (hoist, `t1-task6-after/`) | `crowd-off` | 28.02 | 28.49 | 28.25 | — |
| after | `crowd-quad` | **35.56** | 39.82 | 37.69 | **9.44** |

Census and frame hashes are identical across repeats in both runs. The quad's
own repeat spread is 12 % (35.56 vs 39.82), larger than the ~1 ms the hoist
could have bought: the quad − per-body gap is **unresolved** (rep0 improved
2.1 ms, rep1 regressed 3.2 ms). Machine load ~1.9 at run time.

### The bar

**Not met, and the hoist cannot meet it.**

- t1 `sdf:march` crowd-quad (35.56–39.82) is far above per-body (28.0–28.5);
  the gap is 7.5–11.6 ms, not ≤ 0.
- overall, the earlier flip-decision bench already had quad above per-body
  (44.7 vs 39.2 frame p50), so the overall bar fails too.
- t2 is the cleared room; there the quad's union walk is not the binding term
  but per-body is near-free, so the "t2 ≤ 5 ms" bar is likewise not met.

The full-recording bench was **not run**: the t1 window is the binding third,
it already refutes the within-run bar (quad > per-body), and the tree is
reverted — a full-recording run of a rejected, uncommitted change would not add
information. Stated plainly rather than papered over.

### Gates on the final tree (code reverted to Task 2/3 HEAD)

```
$ MARCH_HASH_CROWD=1 MARCH_HASH_TILES=1 node scripts/march-hash.mjs
{"room1":"a350361d6a223946a4cb8aac9bc2a3a70ee15bfd","room1-repeat":"a350361d6a223946a4cb8aac9bc2a3a70ee15bfd","room1-wounded":"07f60ecfd4e1e1cac9e26b8527d50abc74894e95"}
crowd_exit=0

$ node scripts/march-hash.mjs        # default per-body
{"room1":"a8ab4efac15fc0376c3e4e05420f13e34d1511bd","room1-repeat":"a8ab4efac15fc0376c3e4e05420f13e34d1511bd","room1-wounded":"da785297dcc3f677320c563501ca861bac22d6d6"}
perbody_exit=0

$ MARCH_PARITY_TILES=1 node scripts/march-parity.mjs
room1 tiles=1 dispatch=quad flat=0: hitA 33344 hitB 33344 maskDiff 0 maxDz 0.0009889602661132812
room2 tiles=1 dispatch=quad flat=0: hitA 30561 hitB 30562 maskDiff 1 maxDz 0.0021837353706359863
PASS

$ npx vitest run march.wgsl.test.ts deferred-sdf.test.ts crowd-type.test.ts zombie-gpu.test.ts
Test Files  4 passed (4) / Tests  295 passed (295)
```

Crowd `a350361d…`, per-body `a8ab4efa…` and the parity gate are all unmoved:
the committed kernel is byte-identical to Task 2. **No re-pin was made: the
hash-moving form was rejected, exactly as in Task 3.**

### Consequence for the chain

Task 2 (empty tile, integer) is the last exact, committed win; the entry-miss
term is not addressable through this gate without moving a byte-exact hash, and
even a perfect entry-miss discard would leave the t1 gap (the fetches Task 2
already skips for empty tiles are not where the remaining ~7 ms lives). The
default stays per-body; the quad dispatch's remaining t1 cost needs a different
lever (fewer/cheaper per-pixel fetches, not a better entry test).

### Files (task 6 — none kept)

- `docs/dev-notes/2026-09-14-crowd-firefight-cost/t1-task6-after/` — the t1
  window bench of the attempted reorder (before = `t1-task3-before/`).
- The reorder implementation (`TILE_PRELOAD_WGSL`, `quadTilePreload`,
  `gTilePreloaded`, the material gate) was built, dumped, gated and measured,
  then reverted; it is described above and can be reconstructed from this note.
