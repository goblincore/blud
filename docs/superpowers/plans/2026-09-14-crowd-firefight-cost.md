# Crowd march: close the firefight gap on the owner's recording

**Goal:** on `docs/dev-notes/demos/2026-09-14T21-02-05-669Z-room1.dem.json` (56 s, room 1, 110 shots; replays 842/842 identical), make the crowd quad's `sdf:march` in the fire-heavy third (t1, frames 1123–2245) **≤ per-body's**, without moving the frozen-frame parity gate, so the default can flip on real play and not only on staged crowds.

**Where we are (dev note `## Flip decision bench`, 2026-09-14):** `sdf:march` p50 per third, ms — t0 crowd 20 / boxes 16 / per-body 36; **t1 crowd 58 / boxes 53 / per-body 42**; t2 crowd 13 / boxes 5 / per-body 0.1. t1 has 3 bodies, mostly flesh-stripped skeletons (many bone prims), 7→23 wounds. The boxes dispatch already has a per-instance raster footprint and is only 5 ms better, so the raster rect is NOT the main term; the union-field tax (every pixel folds every slot in its tile every step) and the per-pixel input setup on pixels that turn out empty are the two candidates. Measure, then fix in order of certainty.

**Architecture reminders:** kernel `src/lab/sdf-zombie/webgpu/march.wgsl.ts` (quad entry ~L2560–2640: tile header read, per-ray sphere compaction `rayCull`, `entryT`, the empty-tile discard `if (quadMode && gTileN < 0.5)`, the per-pixel slot table `gPixN/gPixSlot/gPixFirst`; per-step fold in MAP_BODY ~L1696–1720 walks `gPixN` slots); the crowd material/mesh in `crowd-type.ts` (`sync()`, `crowdScreenRect`); bench `scripts/sdf-game-bench.mjs` (`BENCH_DEMO`, legs `baseline`(=shipped default, now per-body) / `crowd-quad` / `crowd-boxes` / `crowd-off`); GPU probes `__sdfGame.occupancy()` and the MARCH_TRACE occupancy counters (march.wgsl.ts ~L3268–3310, "returned BEFORE the discard"). Gates: `MARCH_HASH_CROWD=1 MARCH_HASH_TILES=1 node scripts/march-hash.mjs` (crowd canonical `a350361d…`; a task that legitimately changes step order re-pins it and says why), `MARCH_PARITY_TILES=1 node scripts/march-parity.mjs` (PASS is mandatory), `node scripts/march-hash.mjs` default per-body `a8ab4efa…` (must never move).

**Safety:** `BENCH_FRAME_CAP_MS=250` on every bench; never `BENCH_CROWD` above 24; distinct lab ports per chain (this chain: 5323/9323, `LAB_TMP=.lab-tmp`); `uptime` load < 4 before a timing run; kill a Chrome silent for 60 s.

## Task 1: attribute the t1 cost (no kernel changes)

**Files:** modify `scripts/sdf-game-bench.mjs` (add `BENCH_DEMO_FRAMES=a:b` — slice the recording's frames to `[a,b)` after loading; the page still boots with the recording's seed and start pose, and the replay's segments become thirds of the window), new `scripts/crowd-t1-probe.mjs`, note `docs/dev-notes/2026-09-14-crowd-firefight-cost.md`.

- [ ] Bench the t1 window: `BENCH_DEMO=<rec> BENCH_DEMO_FRAMES=1123:2245 BENCH_ROOMS=1 BENCH_LEGS=crowd-off,crowd-quad,crowd-boxes BENCH_PASSES=1 BENCH_REPEATS=2 BENCH_FRAME_CAP_MS=250 BENCH_OUT=docs/dev-notes/2026-09-14-crowd-firefight-cost/t1 node scripts/sdf-game-bench.mjs 5323 9323`. Record `sdf:march` p50 and repeat spread per leg.
- [ ] Probe three frames (1300, 1600, 1900): replay the recording sliced to N frames on each leg (`__sdfGame.demoReplay(file, {hold:true})`, then `__sdfGame.step(2)` before any capture — the canvas is stale right after a replay), then read the occupancy/step counters (`__sdfGame.occupancy()` and whatever MARCH_TRACE counters the kernel exports; read their headers) and the crowd census (`crowdInfo().types[]` rect/rectFrac/visible, `actorDump()`). Produce, per leg and frame: pixels that ran the fragment, pixels that discarded before stepping (empty tile / entry miss), pixels that stepped, mean steps per stepping pixel, mean slots folded per step (crowd), and the sum of prims across visible bodies.
- [ ] Write the attribution table and name the dominant term with numbers: (A) per-pixel input setup on pixels that discard, (B) steps × slots-per-step (union tax), (C) something else you found. Commit: `bench(crowd): t1 window + attribution probe`.

## Task 2: empty-tile discard before the per-pixel input setup (exact)

**Files:** modify `src/lab/sdf-zombie/webgpu/march.wgsl.ts` and the material assembly that calls `marchBody` (find it: grep the WGSL/TSL that builds the crowd material's fragment — `sdf-layer.ts` / the deferred producer; `march-wound-list.test.ts` shows the call shape).

- [ ] In quad mode, read the tile header (count for this pixel's tile) as the FIRST thing the fragment does and `discard` when it is zero, before the cone/occ/shell/prev fetches, the record load and the wound list. The existing discard inside the trace setup stays (it also covers tiles-off callers).
- [ ] Gates: crowd hash unchanged (`a350361d…` — a discard reorder cannot change any written pixel), parity PASS, per-body hash unchanged. Re-run the Task 1 t1 bench for `crowd-quad`; record before/after. Commit.

## Task 3: per-step slot sphere skip with a conservative clamp (exact by construction)

**Files:** `march.wgsl.ts` MAP_BODY per-step fold.

- [ ] For each slot in the pixel's table, before folding its groups at the current point `p`: `ds = length(p - centre) - rInflated` using the slot's bound sphere already in `gTileBounds` (inflate exactly as the entry test does: `b.w + reach * max(g.z,1) + slack`). If `ds > 0`, skip the fold and instead `d = min(d, ds)` — the sphere distance is a lower bound of that slot's field, so the step can never overshoot that slot's surface. If a slot has several groups, apply per group (each `gTileBounds[e]` is a group sphere).
- [ ] Gates: parity PASS is the correctness bar (the hash WILL move if step lengths change; re-pin `CROWD_HASH` in `scripts/march-hash.mjs` and in the dev note with the reason). Per-body hash unchanged. Re-run the t1 bench; record. Commit.

## Task 4: per-instance raster footprint (only if Task 1 says setup on discarded pixels ≥ 3 ms of t1 after Task 2)

**Files:** `crowd-type.ts`, `crowd-rect.ts`, `march.wgsl.ts` (quad vertex path).

- [ ] Replace the one union-rect quad with one clipped rect per visible instance (instanced quad, per-instance `[x0,y0,x1,y1]` from `crowdScreenRect` on that instance alone), and mark shaded pixels so a pixel covered by two instance rects of the same type is shaded ONCE: use the stencil buffer (three WebGPU `stencilWrite/stencilFunc/stencilRef/stencilZPass`; check the SDF target has a stencil attachment or add one) or, if stencil is unavailable in the pass, a per-type 1-bit "shaded" texture written by the first fragment and tested by later ones. Parity PASS; crowd hash re-pinned only if pixels change (they must not).
- [ ] If Task 1 says the term is < 3 ms, write that down in the note and skip this task explicitly.

## Task 5: the bar, full recording

- [ ] `BENCH_DEMO=<rec> BENCH_ROOMS=1 BENCH_LEGS=crowd-off,crowd-quad,crowd-boxes BENCH_PASSES=1 BENCH_REPEATS=2` on a quiet machine. Bar: t1 `sdf:march` crowd-quad ≤ crowd-off, overall frame median crowd-quad ≤ crowd-off, and the t2 (cleared room) crowd cost ≤ 5 ms. Append the table to the note, update `TASKS.md`, and state plainly whether the default can flip. Do NOT flip the default in this chain.
