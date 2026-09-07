# Per-pass GPU attribution — first table (2026-09-07)

**Question:** where does the frame go, pass by pass? Every prior study sliced
the march shader; none measured it against the rest of the frame.

## Instrument

`src/lab/sdf-zombie/webgpu/gpu-pass-timing.ts` + `__sdfGame.bench({ mode: 'passes' })`
+ `BENCH_PASSES=1 scripts/sdf-game-bench.sh`. three already timestamps every
render/compute pass (trackTimestamp); this labels them by site (sdf-layer,
post-aa, goo-layer, tile-bin-compute, character-effects), snapshots three's
uid→query map at resolve, reads the raw u64 boundaries out of its resolve
buffer, and attributes by COMPLETION ORDER.

**Why completion order:** on the Apple GPU passes overlap — the next pass's
vertex stage starts before the previous pass's fragments finish — so wall
durations are pipeline time, not cost: the first read showed the fullscreen
blit at 8.7 ms inside a 7.9 ms frame. Charging each pass the time the GPU
timeline advanced since the previous pass ended partitions the frame's span
exactly. Check: room 3 exclusive sum 7.97 vs fenced frame 8.12 vs span 8.51.
`passes.md` keeps the wall column too, as the overlap it reveals.

## Result (baseline, ship defaults, 3 reps, quiet machine, load ~3.7)

Exclusive GPU ms, median over reps of per-frame p50, whole scenario:

| pass | room 1 | room 2 | room 3 | room 4 |
| --- | ---: | ---: | ---: | ---: |
| sdf:march | 5.39 | 6.09 | 9.41 | 13.12 |
| goo:density | 0.62 | 2.58 | 3.43 | 9.64 |
| sdf:polys (level + shadow) | 1.40 | 0.54 | 0.53 | 0.53 |
| post:fxaa | 0.24 | 0.22 | 0.23 | 0.23 |
| everything else combined | ~0.4 | ~0.3 | ~0.4 | ~0.3 |

Per segment, room 4 (all three reps agree):

| segment | GPU span | sdf:march | goo:density |
| --- | ---: | ---: | ---: |
| walk | 7.8–8.6 | 5.8–6.1 | 0.0 |
| fire | 24–26 | 13.1–13.4 | 11.3–12.9 |
| gib | 33–49 | 16–25 | 17–24 |

## Reading

1. **The frame is two passes.** The march and the goo DENSITY pass are the
   whole budget; every other pass together is under 0.5 ms. Hull raster,
   composite, FXAA, smear, blit, occluder, effects: all noise. There is no
   hidden fixed cost to find.
2. **goo:density is the unmeasured half.** Zero while walking, then equal to
   the march the moment blood flies: 12 ms in room 4 fire, 17–24 ms in gib.
   That is goo-layer.ts Pass A — the additive droplet/splat quads into the
   density target — scaling with droplet count and overdraw. Nobody has
   benched it as a cost; Question A's close-up staging had spillChance 0, so
   it was invisible there by construction.
3. **The march's own growth in fire/gib** (6 → 13 → 16–25 ms in room 4) is
   the wound-adjacent walk Question A found, now measured in the live
   scenario rather than a frozen close-up.
4. **The old "walk share 16%" reading was scene-bound.** In the walk
   segment the march IS the frame (~75%), which is why the depth prepass and
   today's tile compaction moved nothing: they shave step count, and the
   room-4 walk is 4 bodies at 8 ms already under the 30 fps line. The fire
   and gib segments are where 30 fps is lost, and half of that loss is
   not the march at all.

## Next (not started)

- Bench the goo density pass directly: droplet count vs ms, quad size,
  overdraw. Obvious levers: half-res density target (goo already has a
  low-res surface path), cap live droplets, cull sub-texel quads harder
  (minTexelRadius exists), sort/merge splats.
- Split `sdf:march` by body vs chunks (front-to-back path already
  renders them as separate passes when the depth gate is on) and by
  wounded vs clean bodies, in the passes mode — labels are one line each.
- The `GPU span > fenced frame` in throughput mode is adjacent-frame
  overlap (frames pipeline); ratios within a frame are unaffected.

---

## CORRECTION (same day, runs 2–4): goo:density was an attribution artefact

The first table's `goo:density` column was WRONG. Three follow-up runs
(run2-goo-levers, run3-cpu-phases, run4-crossframe) and a raw timestamp
dump established:

1. **Density-target resolution did not move it.** densityScale 0.5 → 0.125
   (1/16 the texels) left "goo:density" at 10–15 ms. A fill-bound pass
   cannot do that. Capping quads to 300 and the sub-texel cull: same.
2. **Turning the pass OFF moved the charge to the next pass.** With
   `passGate.density=false`, `sdf:polys` (now the frame's first pass) read
   37–43 ms in gib. The time belonged to the FRAME BOUNDARY, not the pass.
3. **Not CPU either.** Per-frame CPU in passes mode: tick 4.5–6 ms, draw
   2.5 ms, wound-hit phase 5.5 ms during fire. gpu:idle 1–3 ms.
4. **The cause: frames pipeline, and the per-frame cursor charged frame N's
   first pass with frame N-1's tail.** Fixed in attributePassSamples — one
   completion-order timeline across the whole batch.
5. **Raw dump (Apple GPU / Dawn):** every pass in a frame reports the SAME
   start (command-buffer schedule); only ENDs are real. So `ms` is queue
   residency, and the non-empty density pass "takes" 15–33 ms wall only
   because it completes alongside the march it runs concurrently with —
   nothing reads it until the surface pass. Its exclusive charge is 0.01 ms.
   An EMPTY pass (no blood) returns a stale end before its start; collect()
   now drops those (they had produced a bogus 54 ms "idle" in walk).

### Corrected table (run 4, baseline, exclusive ms per frame, 2 reps, spread 5–8%)

| room | segment | GPU span | sdf:march | goo:density | cpu:tick | cpu:draw |
| ---: | --- | ---: | ---: | ---: | ---: | ---: |
| 3 | fire | 18.5 | 12.9 | 0.01 | 6.0 | 3.1 |
| 3 | gib | 26.7 | 20.8 | 0.02 | 5.1 | 2.7 |
| 4 | walk | ~8 | 8.1 | 0 | 4.4 | 2.4 |
| 4 | fire | 27.6 | 19.2 | 0.01 | 5.5 | 2.6 |
| 4 | gib | 37.7 | 31.4 | 0.02 | 5.2 | 2.5 |

Everything else (polys, composite, fxaa, smear, blit, surface, shell, occluder)
stays under ~1.5 ms combined.

### The real reading

**The march is the entire GPU budget, in every segment.** It grows from
~8 ms (walk, 4 bodies, no wounds) to 19 ms (fire: wounds carved, blood mist)
to 31 ms (gib: wounds + severed chunks marched as extra bodies). The goo
density pass is free; making it blurrier buys nothing. The frame is GPU
bound on `sdf:march`; CPU is ~8 ms and not on the critical path.

What grows the march under fire/gib is the thing Question A already
measured: wound-adjacent evaluation (wound fold + near-wound stepping) and,
in gib, the extra chunk bodies. Next attribution step: split `sdf:march`
into bodies vs chunks (a second render call for chunks, autoClear off, one
label each) and A/B the wound levers (near-wound step multiplier, wound
early-out perfCfg.y, bleed off) in passes mode. The lever legs
`goo-dens-*`, `goo-cap-*`, `goo-mintexel-*` stay in the bench for the
record; none should ship for perf.

## Run 5 — march split (bodies vs chunks) + wound levers (run5-wound-levers/)

`__sdfGame.setChunkPass('split'|'skip'|'merged')` (sdf-layer.ts) marches the
gib chunks in a second labelled pass; passes mode uses 'split'. Legs:
wstep-0.6 (old near-wound step), wound-earlyout-off, wound-cull-off,
bleed-off, chunks-skip. Rooms 3/4, 2 reps. Exclusive GPU ms:

| leg | r3 fire | r3 gib | r4 fire | r4 gib | note |
| --- | ---: | ---: | ---: | ---: | --- |
| baseline march | 14.5 | 14.7 | 15.6 | 25.9 | walk 6.4–9.2 |
| sdf:march-chunks | 0 | 0 | 0 | 0 | **census: chunks 0→0 in every run** |
| wstep-0.6 | 13.9 | 20.9 | 20.5 | 30.6 | old value: slower, as expected |
| wound-earlyout-off | 13.1 | 17.3 | 15.3 | 27.6 | no effect (matches r2 task 3) |
| wound-cull-off | 13.5 | 23.9 | 19.6 | **54.8** | the shipped cull is worth 2x in gib |
| bleed-off | 10.7 | 13.2 | 14.7 | 26.8 | room 3 only; room 4 unchanged — noise-class |
| chunks-skip | 14.0 | 13.7 | 16.3 | 27.6 | nothing to skip |

### Reading

1. **There are no live chunks in the firefight scenario.** The "gib"
   segment carves wounds (16, the MAX_WOUNDS cap) but spawns no marched
   chunks — corpse/chunk baking moves them to the polygon pass, where
   `sdf:polys` stays at ~0.5 ms. Chunk attribution is therefore already
   answered: chunks are not a march cost in the current game. The split
   pass stays as a seam for a scenario that keeps chunks live.
2. **The march's growth is WOUNDS, full stop.** 6.4 ms with none, 15.6 with
   16 fresh, 25.9 once the same 16–17 have been shot over and stacked at the
   crosshair. ~1.2 ms per wound at the cap, after the union-reach cull that
   already halves it (cull off: 54.8).
3. **The existing levers are exhausted.** Early-out does nothing, the step
   multiplier already ships at its fast value, the cull already ships on.
4. **Not blood.** bleed-off moved room 3 and not room 4; the goo/density and
   mist are billboards outside the march.

### Where the wound cost can still go

- **The per-limb owner re-fold** (march.wgsl.ts ~L1505: when a pixel is
  near a wound owned by another cluster, the limb's whole group list is
  folded AGAIN and wounds re-applied). No seam exists; it is the one
  wound-path mechanism never priced. Needs a compile-time gate to A/B.
- **Wound count at the cap.** MAX_WOUNDS 16 all evaluated per near-wound
  step; a per-pixel wound list (tile bin the wound spheres like the group
  spheres) or merging old craters into the baked/bounded torso regions
  would cut the loop.
- **Near-wound step 1.0 is already the fast end**; the remaining lever is
  fewer steps near craters via a wound-aware entry bound.

## Run 6 — the per-limb owner re-fold, gated (run6-owner-refold/)

Gate: `counts2.z` (spare channel, preserved across uploads in zombie-gpu.ts),
`__sdfGame.setOwnerRefold(false)` → march.wgsl.ts skips the re-fold block.
Wrong frame on purpose (a raised arm's crater can erase the jaw again).
Rooms 3/4, 3 reps, exclusive `sdf:march` ms per rep:

| | r3 fire | r3 gib | r4 fire | r4 gib |
| --- | ---: | ---: | ---: | ---: |
| baseline | 13.2 / 12.9 / 10.6 | 12.7 / 12.7 / 13.0 | 14.3 / 15.6 / 10.5 | 27.2 / 25.1 / 16.9 |
| owner-refold-off | 10.1 / 10.8 / 8.7 | 10.8 / 10.4 / 10.2 | 13.8 / 16.3 / 14.2 | 29.4 / 23.7 / 26.0 |

**Verdict: 2–3 ms in room 3 (−20%), nothing measurable in room 4.** The
re-fold only fires where a pixel is near a wound owned by a cluster other
than the one it is folding, so its cost depends on where the craters landed
relative to limb joints — room 3's spread hit shoulders, room 4's stacked on
torsos. Real but not the big number; not the mechanism behind 6 → 26 ms.

### Why the bounded / prebaked-wound experiment showed little benefit (owner's question)

`docs/dev-notes/2026-09-07-bounded-torso-regions/README.md` measured it:
+9% SLOWER than procedural wounds, one actor at 1 m, frozen, blood off,
fewer uploaded cutters (2–8 vs 16). Consistent with everything above:

- The cost is NOT the number of wound rows. The union-reach cull already
  prunes the loop to the wounds a pixel can reach (cull off = 2x), so
  going from 16 rows to 8 removes rows the cull was already skipping.
- What a near-wound pixel pays is the near-wound STATE: the wound loop on
  every step, the inside-flesh rows (organs/bones) the nearWound gate
  opens, the owner re-fold, and the smaller steps. A bounded region still
  raises nearWound over the same screen area — the same pixels enter the
  same expensive path, just with different cutters.
- Each bounded cutter was a hard-capped subtraction with an analytic
  gradient and a cusp fallback: more work per evaluation than a stock
  crater, which is where the +9% came from.

So "fewer, prebaked wounds" attacks the wrong term. The term that scales is
the per-step work INSIDE the near-wound zone, times that zone's pixel area.
The levers that address it: (a) a per-pixel/per-tile wound list so a pixel
evaluates only the 1–3 wounds it can see rather than all 16 — that is the
tile-bin idea applied to wound spheres; (b) shrinking what nearWound opens
(bones out via tubes — run 7; organs only where a crater is actually deep);
(c) fewer steps in the zone via a wound-aware entry bound.

## Run 7 — bone tubes ON (inside-flesh rows out of the field) — UNRESOLVED

Leg `bone-mesh-on` (`__sdfGame.setBoneMesh(true)`), rooms 3/4, 3 reps. The
machine was NOT quiet (1-min load 10.8 at the end; two Chrome helpers at
47%/36% CPU outside the bench): baseline spread 57–61%, the leg 105–334%.
Nothing in run7-bone-tubes-UNRESOLVED/ may be read as a delta. Rerun on a
quiet machine:

```sh
BENCH_PASSES=1 BENCH_LEGS=baseline,bone-mesh-on BENCH_ROOMS=3,4 BENCH_REPEATS=3 scripts/sdf-game-bench.sh
```

## Run 8 — bone tubes ON, quiet machine (run8-bone-tubes/)

`sdf:march` exclusive ms per rep (walk / fire / gib), load < 4.5 at start:

| | room 3 | room 4 |
| --- | --- | --- |
| baseline | 8.0/8.7/10.5 · 10.8/12.1/13.3 · 13.4/17.2/26.7 | 6.1/7.1/7.1 · 13.9/11.9/11.5 · 21.0/20.6/22.6 |
| bone-mesh-on | 7.8/7.1/7.0 · 10.2/9.5/9.7 · 9.9/12.4/12.4 | 6.1/7.2/6.7 · 12.8/11.0/9.7 · 20.9/16.0/15.7 |

Baseline spread 32–58%, the leg 15%; but the direction is the same in all
six wounded comparisons: **fire −15–20%, gib −25–30%**, polys +0.3 ms for the
tubes. Walk unchanged (no wound, gate closed, bones never folded). This is
the largest single lever measured today, and it is a mechanism that already
exists (`setBoneMesh`, default OFF pending the owner's look verdict on the
tubes).

### The root cause, stated once

`nearWound` (1 within 2× a crater's radius) switches a pixel into a
different, much heavier field evaluation on EVERY march step and every
post-hit probe: (a) the wound loop, (b) `applyBones` — every bone AND organ
prim (zombie: 68–90 rows) folded with NO spatial cull, (c) the owner
re-fold. Run 5 priced (a) at ~0 (earlyout-off), run 6 priced (c) at 0–20%,
run 8 priced (b) at 25–30% of the wounded march by removing bones from the
field. What remains after (b) is the zone itself: more pixels in the zone
and more steps per pixel as craters stack. Levers, in order: ship bone
tubes (or a spatially-culled bone fold: cluster/group spheres for bones the
way flesh has them); organs only under deep craters; then the zone's step
count via a wound-aware entry bound.
