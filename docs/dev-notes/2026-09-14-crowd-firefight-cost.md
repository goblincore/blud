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

## Files

- `scripts/sdf-game-bench.mjs` — `BENCH_DEMO_FRAMES=a:b` (state-preserving
  window), per-leg crowd boot flag (`legUrl`), `applyDemoPrelude`.
- `scripts/crowd-t1-probe.mjs` — new; the per-leg/frame counter probe.
- `docs/dev-notes/2026-09-14-crowd-firefight-cost/t1/`, `t1-step1/`,
  `t1-confound-repro/` — bench outputs; `probe.json` — probe outputs.
