# The whole frame: where the time goes, and what to do about it (2026-10-08)

The owner asked for a general optimisation pass: "the whole frame", and the head and skull work "depending on whether
that is worth time optimizing". During the pass the owner set the goal: **the heavy scenes (wounds, firefights, bodies)
at a stable 30 fps**, which is 33.3 ms a frame.

This note has the measurements, the ranking and each change's before and after. Measurements were taken on `main` at
`d6bb9967` (before the skull stack merged) unless a row says otherwise; `main` moved to `06f2ef12` during the pass
(PR 39 and PR 40 merged), and the changes are built and measured on that.

## Short version

| Heavy scene | Frame today | Over 33.3 ms by | What it is made of |
| --- | --- | --- | --- |
| Night Train, Boiler Room, after a fight (5 bodies, 24 wounds) | 39.3 ms | 6.0 | march 24.3, level polygons 5.6, CPU 16 |
| Bare page arena, after a fight (6 bodies, 46 wounds) | 37.4 ms | 4.1 | march 30.1, CPU 12 |
| Close-up at 0.8 m: 32 pellet wounds, a torso chop, the head split wide | 36.2 ms | 2.9 | march 31.2 |
| Night Train, third class, walking in (8 bodies, no wounds) | 26.7 ms | under | march 13.1, level polygons 7.2, CPU 15 |

Two hitches break "stable" even where the average holds: the first frame on entering a carriage is 170 to 220 ms, and
the first shot fired in a carriage builds 29 pipelines (worst frame 70 to 96 ms).

What was found, largest first:

1. **The held weapon and the arms shaded every light of the level** (69 lights on Night Train, 26 with a shadow map;
   the walls shade 16 to 22). 6 to 7.5 ms of a Night Train frame, 0.85 ms on the bare page. **Fixed** (§5.1): the
   frame in third class falls from 33.1 to 26.0 ms on the still frame, with no visible change.
2. **Wounds, up close.** One zombie at 0.8 m: untouched 25 ms, 32 pellet wounds 34 ms, a torso chop on top 51 ms,
   the head split wide on top of that 64 ms (per-frame fenced; §3.3). Open.
3. **The CPU on Night Train is 15 to 20 ms**: about 9 ms submitting draws and 3.5 ms posing, packing and uploading
   all 30 bodies of the level whether or not they are in view (§3.4). Open.
4. **Not worth optimising**: the post chain (FXAA, VHS and the upscale together are about 1 ms), level shadows on
   bodies, the goo, gib chunks, the bone, skull and organ meshes, and the sculpted skulls' 5 mm cell (§4).

## 1. Method

**The driver** is [`scripts/frame-cost.mjs`](../../../scripts/frame-cost.mjs) (new). One boot per scene and repeat,
the page as it ships (VHS, upscale, crowd march, no pins), a 1280 × 800 window, the 800 × 600 frame, a 400 × 300 march
target. Per boot:

1. **The bench's passes mode** (`__sdfGame.bench`, `game-bench.ts`): the scripted walk, fire and gib fight, live, so
   the CPU's share is real. Per segment: the fenced frame (4 frames a fence), every GPU pass by its label charged by
   completion order (`gpu-pass-timing.ts`), and the CPU's tick, draw and telemetry phases.
2. **Counters** that do not depend on the machine: draw calls and triangles of a frame, pipelines built, the march's
   own census (debug modes 13 and 14: texels marched, steps, primitive evaluations, wound rows).
3. **Ablations by alternation** on the frame the fight ends on, frozen: a stage switched off and on again in blocks
   of 10 fenced frames (baseline, variant, baseline, ...), each variant block scored against the mean of the baseline
   blocks either side, 8 rounds, reported as the median with its interquartile range. A no-op switch (A/A) is the
   floor. A switched-off stage is the ceiling of what optimising it could return, not a forecast.

**The noise floor.** On a clean boot the two repeats of a scene agree to about 0.5 ms (third class walking in: 26.7
and 26.6 ms; its march 13.1 and 13.1). The A/A control reads within ±0.3 ms on the Night Train scenes and within ±1.3
ms on the arena. Rows inside that are reported as "not resolved".

**Three things that made runs wrong, and the guards now in the driver.**

- **A stray page.** A killed driver left its game page open and drawing: every later run shared the GPU and a core
  with it (third class read CPU tick 16 to 19 ms against 6). The driver now closes its page when killed and refuses to
  start beside another game page on the same browser.
- **The machine's speed, not its load.** This is a fanless M3 MacBook Air, on battery, in use by the owner and by
  other agent sessions. The 1-minute load average did not show every disturbance: the same scene read a CPU tick of
  6.5 ms and 11 ms at the same load. The driver times a fixed loop in the page before and after each fight (11.5 ms
  on a quiet machine); a run whose loop reads over 1.2 times the best seen is taken again. 6 of 18 boots were retaken.
- **Pipelines built inside the timed frames.** three.js builds a material's pipeline at its first draw. The driver
  enters the room once before the fight (and reports that hitch on its own line), boots every scene once and throws
  the result away (so the browser's shader cache holds the fight's pipelines), and counts the pipelines built inside
  each fight.

Frame times taken per frame (`timeDraws`, one fence a frame) read 3 to 7 ms higher than the bench's (4 frames a
fence): the GPU clocks down between fenced frames. Both are given where used; compare like with like.

## 2. Where a frame goes

Each cell: repeat 1 / repeat 2, ms per frame. The full tables, with every stage, are in
[`matrix-main.md`](matrix-main.md) (and [`matrix-closeup.md`](matrix-closeup.md) for the corrected close-up).

| Scene, segment | Bodies, wounds | Frame p50 | March (bodies) | Outer shell hull | Level polygons | Upscale | Post (FXAA, VHS, blit) | CPU tick | CPU draw |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Night Train, guards' van, walking | 1, 0 | 14.2 / 13.3 | 3.8 / 3.6 | 2.2 / 2.9 | 5.0 / 3.8 | 0.3 / 0.2 | 0.5 / 0.5 | 5.2 / 5.0 | 5.2 / 5.0 |
| the same, firing | 2, 19 | 20.8 / 19.5 | 9.6 / 8.9 | 1.8 / 2.0 | 5.5 / 4.8 | 0.4 / 0.4 | 0.5 / 0.5 | 6.0 / 5.5 | 6.3 / 6.1 |
| the same, after the slug | 2, 20 | 27.2 / 24.9 | 15.4 / 13.6 | 1.7 / 1.7 | 5.4 / 5.1 | 0.5 / 0.5 | 0.5 / 0.5 | 6.0 / 6.0 | 6.6 / 6.3 |
| Night Train, third class, walking in | 8, 0 | 26.7 / 26.6 | 13.1 / 13.1 | 1.0 / 1.0 | 7.2 / 7.2 | 0.4 / 0.4 | 0.4 / 0.4 | 6.0 / 6.0 | 9.1 / 9.2 |
| the same, firing | 4, 19 | 18.9 / 18.2 | 6.2 / 6.1 | 2.7 / 2.4 | 4.2 / 4.5 | 0.4 / 0.4 | 0.5 / 0.5 | 6.2 / 6.1 | 7.7 / 7.5 |
| the same, after the slug | 4, 20 | 17.2 / 17.4 | 6.2 / 6.1 | 1.7 / 1.7 | 5.0 / 5.0 | 0.4 / 0.4 | 0.5 / 0.5 | 5.9 / 5.9 | 6.7 / 6.7 |
| Night Train, Boiler Room, walking in | 6, 0 | 28.1 / 22.6 | 9.3 / 9.2 | 4.8 / 0.8 | 3.4 / 7.1 | 0.4 / 0.4 | 0.5 / 0.5 | 10.7 / 6.1 | 11.3 / 7.2 |
| the same, firing | 7, 24 | 27.4 / 29.3 | 12.5 / 12.5 | 3.4 / 5.1 | 5.2 / 3.0 | 0.4 / 0.5 | 0.5 / 0.5 | 7.6 / 8.3 | 10.3 / 11.5 |
| the same, after the slug | 5, 24 | 39.3 / 39.5 | 24.3 / 24.2 | 2.1 / 2.3 | 5.6 / 4.9 | 0.5 / 0.6 | 0.5 / 0.5 | 7.2 / 6.8 | 9.2 / 9.0 |
| Bare page, room 4, walking | 5, 0 | 11.8 / 11.5 | 7.4 / 7.1 | 0.3 / 0.3 | 0.8 / 0.8 | 0.5 / 0.4 | 0.5 / 0.5 | 4.5 / 4.6 | 3.7 / 3.4 |
| the same, firing | 4, 16 | 16.2 / 15.7 | 10.6 / 10.2 | 0.4 / 0.4 | 0.9 / 0.8 | 0.6 / 0.4 | 0.5 / 0.5 | 5.3 / 5.1 | 5.1 / 5.2 |
| Bare page, arena, walking | 5, 0 | 10.7 / 10.3 | 5.2 / 5.2 | 0.9 / 0.8 | 0.3 / 0.3 | 0.4 / 0.4 | 0.5 / 0.5 | 5.0 / 4.7 | 3.5 / 3.3 |
| the same, after the slug | 6, 46 | 37.4 / 35.0 | 30.1 / 27.2 | 0.3 / 0.3 | 0.9 / 0.9 | 0.7 / 0.6 | 0.4 / 0.4 | 6.2 / 6.1 | 5.7 / 5.5 |
| Close-up, 0.8 m: 32 pellet wounds, a torso chop, the head split wide (frozen) | 2, 32 | 36.5 / 35.9 | 31.7 / 30.6 | 0.4 / 0.4 | 1.1 / 1.1 | 0.6 / 0.6 | 0.5 / 0.5 | 1.3 / 1.5 | 4.9 / 5.4 |

- The Boiler Room's first walk (28.1 ms, CPU tick 10.7) was a disturbed take that passed the speed check; its second
  (22.6 ms, tick 6.1) is the cleaner one. The other rows' repeats agree.
- "Level polygons" is the pass that draws the carriage, the props, the held weapon, the bone and organ meshes and
  the shadow maps. "Outer shell hull" and "level polygons" trade time between repeats because the attribution is by
  completion order and they overlap; read their sum.
- Within the post chain: FXAA 0.21 to 0.23 ms, VHS 0.11 to 0.13 ms (its input and its pass), the final blits 0.13 to
  0.15 ms. The upscale's eight passes are 0.25 to 0.7 ms together. The goo's surface pass is 0.1 ms; the tile-bin
  compute 0.1 to 0.25 ms; the probe gather 0.02 to 0.04 ms.
- The march is ONE pass in these scenes (`sdf:march`): the cone, depth pre-pass, far and chunk passes did not run.

### 2.1 Counters and hitches

| Scene | Draw calls, a live frame | Triangles | Entering the room: pipelines built, first frame | The fight: pipelines built, worst firing frame |
| --- | --- | --- | --- | --- |
| Guards' van | 119 | 71,803 | 2, 167 to 174 ms | 7, 26 to 28 ms |
| Third class | 169 | 180,109 | 3, 174 to 184 ms | 29, 70 to 78 ms |
| Boiler Room | 219 | 233,682 | 4, 166 to 222 ms | 29, 94 to 96 ms |
| Bare page, room 4 | 193 | 218,105 | 12, 101 to 105 ms | 28, 40 to 42 ms |
| Bare page, arena | 146 | 203,399 | 17, 133 to 137 ms | 37, 47 to 50 ms |

The entry hitch is with a warm shader cache: it is three.js building the pipelines (and whatever else the first draw
of a room's materials does), not the driver compiling shaders. The first shot's 28 to 37 pipelines are built every
boot, in play.

### 2.2 Ablations on the frame the fight ends on (frozen; median of 8 alternations, ms; repeat 1 / repeat 2)

| Switched off | Guards' van | Third class | Boiler Room | Bare room 4 | Bare arena |
| --- | --- | --- | --- | --- | --- |
| A/A control (the floor) | −0.12 / −0.02 | +0.12 / +0.05 | +0.25 / −0.43 | −0.25 / −0.35 | −1.33 / −0.83 |
| The held weapon and arms (meshes hidden) | **−5.93 / −6.95** | **−6.45 / −6.43** | −1.23 / −1.60 | −0.85 / −0.55 | −1.02 / −1.30 |
| Every level mesh | −5.30 / −6.35 | −7.20 / −9.13 | −4.03 / −3.93 | not resolved | −1.30 / −2.92 |
| The level's art alone | −1.05 / −0.70 | −1.20 / −1.05 | +2.55 / +2.35 | not resolved | not resolved |
| Bone, eye and organ meshes | not resolved | −0.42 / −0.57 | −0.95 / −0.97 | −1.47 / −0.63 | −0.45 / −0.58 |
| Eyes alone | not resolved | −0.42 / −0.13 | not resolved | not resolved | not resolved |
| VHS | not resolved | −0.13 / −0.13 | not resolved | not resolved | not resolved |
| FXAA | −0.08 / −0.25 | −0.23 / −0.15 | not resolved | −0.33 / −0.38 | not resolved |
| Goo | not resolved | −0.63 / −0.47 | −0.52 / −0.85 | not resolved | not resolved |
| Gib chunks | not resolved | not resolved | not resolved | not resolved | not resolved |
| Level shadows on bodies | not resolved | not resolved | not resolved | not resolved | not resolved |
| The shared light list on bodies | not resolved | not resolved | not resolved | −0.58 / −0.60 | not resolved |
| March: wound cull | not resolved | not resolved | −0.50 / −0.32 | not resolved | not resolved |
| March: miss cull | not resolved | not resolved | not resolved | not resolved | +2.78 / +0.42 |
| March: the outer shell (off costs) | +12.4 / +12.7 | +1.85 / +2.25 | +1.88 / +1.98 | +2.27 / +2.08 | +25.7 / +22.5 |
| March: the occluder | not resolved | not resolved | not resolved | not resolved | not resolved |

- The Boiler Room's end frame has the gun low in a reload, which is why hiding it returns 1.2 to 1.6 ms there and 6 ms
  in the other carriages. §5.1's whole-fight numbers are the measure for that room.
- The outer shell bound is carrying the frame: off, the same frames cost 12 to 26 ms more wherever a body is close.
- Hiding the Boiler Room's art makes the frame slower (+2.5 ms): the art hides bodies and level behind it.

## 3. What the big items are made of

### 3.1 The held weapon, the props and the kit shade the whole level's lights

`scratch probe, third class, frozen frame, 8 alternations each; frame and CPU-submit change`

| | Frame | CPU submit |
| --- | --- | --- |
| A/A | −0.25 ms (IQR −0.55 to +0.65) | −0.10 |
| The held weapon and arms hidden (101 meshes, 22,488 triangles) | **−7.53 ms** (−7.70 to −7.30) | −0.90 |
| the arms alone | −2.87 ms | −0.20 |
| the gun alone | −3.33 ms | −0.40 |
| The other meshes on the default light list (58: light fixtures, pickups, spent shells; 1,964 triangles) | −1.50 ms (−1.60 to −1.45) | −0.70 |
| The same held meshes hidden, with every light out of the lists | −0.17 ms (−1.40 to +0.10) | −0.17 |
| The other default-list meshes hidden, with every light out | −0.27 ms | −0.10 |

- three.js's default light list on Night Train: **69 lights** (36 point, 24 spot of which 20 cast a shadow, 7
  directional of which 6 cast a shadow, the ambient and the hemisphere). The level's walls carry their room's own list:
  16 to 22 lights.
- With the lights out of the list the same 101 meshes cost 0.2 ms. So it is the lights per pixel. Merging the 101
  meshes into a few would return under 1 ms of CPU; fewer triangles, normal maps or parallax would return nothing.
- The flail and the axe had their own list (`viewmodel-lights.ts`), but it mirrored the default one, so they paid the
  same. The soldiers' kit has a third list (`kit-lights.ts`) that mirrors it too.

### 3.2 The level's polygons and the CPU's draw submission

A sampling CPU profile of 300 live frames in third class (`main`, 7 bodies in view, 16.2 ms of CPU a frame):

| CPU work | ms / frame | What it is |
| --- | --- | --- |
| three.js drawing objects one at a time | 5.9 | `_renderObjectDirect`: per draw, re-checking bindings and uploading its uniform buffer (`writeBuffer` 1.0 ms) |
| World matrices | 1.1 | `updateMatrixWorld` over all 652 meshes each frame; the carriage never moves |
| Stepping bodies | 3.6 | `game-actor.ts` `step()` for all 30 actors of the level: rig bind 1.1, re-pack and upload 1.9, motion and constraints 0.9 |
| Encounter sight and path checks | 0.6 | `clearSight`, `canTravel` |
| The march's hulls (outer shell, occluder) | 0.8 | rebuilt each frame for the visual set |
| Shadow-map re-renders | 0.15 | every other step for the lit tubes of the player's carriage |

- The visual set (`visual-actor-set.ts`) gates a body's upkeep (skeleton meshes, hulls, wound exclusions) but not
  the body: `step()` ends with re-pose, re-pack, upload and the wound rows for every actor, in view or not. About
  0.12 ms a body: 3.5 ms for Night Train's 30, 2.8 ms for the bare page's 23.
- Level shadows cost nothing that can be resolved: shadow re-renders 0.15 ms of CPU, shadow sampling on bodies
  under the floor in every scene. The "4 to 9 ms per carriage for tube shadows" of 2026-09-28 was already corrected
  by the notes of 2026-09-29 (it is the tube spots shaded in the level's materials); these numbers agree.

**The level's meshes by room** (`main` at `06f2ef12`, frozen frame, 8 alternations a leg; the level is 205 meshes
and 119,897 triangles over 8 rooms, every one frustum-culled by three.js and none culled by room):

| Hidden | Third class: frame | CPU submit | Draw calls | Boiler Room: frame | CPU submit | Draw calls |
| --- | --- | --- | --- | --- | --- | --- |
| A/A | −0.38 ms | −0.03 | | −0.45 ms | +0.15 | |
| Every level mesh | −3.95 (IQR −4.30 to −3.75) | −2.90 | 425 → 211 | −2.67 (−3.00 to −2.15) | −1.87 | 289 → 139 |
| The level meshes of OTHER rooms | **−3.02** (−3.15 to −2.50) | −2.13 | 425 → 233 | −1.02 (−1.85 to −0.25) | −0.82 | 289 → 173 |
| Those beyond the player's room and its neighbours | **−3.10** (−3.20 to −2.60) | −1.90 | 425 → 260 | −0.85 (−1.25 to −0.40) | −0.28 | 289 → 193 |
| The player's own room's | −0.78 | −0.27 | 425 → 379 | −1.23 | −1.38 | 289 → 188 |
| Static matrices (`matrixAutoUpdate` off on the level) | +0.25, not resolved | +0.15 | | +0.05, not resolved | −0.07 | |

- **Standing in third class, 165 to 192 of the frame's 425 draw calls are other carriages' walls and art**, straight
  ahead down the train, inside the view frustum and behind the end wall. Not drawing them returns 3 ms there (2 ms of
  it CPU) and about 1 ms in the Boiler Room. The carriages' doorways line up, so "beyond the neighbours" is not a
  safe rule by itself: a far carriage can show as a sliver through two doorways. A portal test (a room is drawn
  only if the view through the chain of doorways to it is not empty) is the exact form.
- Freezing the level's matrices returns nothing: the cost in `updateMatrixWorld` is the walk, not the flag.

### 3.3 Wounds, up close

One ring zombie, the eye 0.8 m from its chest, frozen, wounded step by step. Frame time is `timeDraws` (one fence a
frame; read the steps). The counters are exact and the same in every run.

| Stage | Frame (3 runs) | Marched texels | Steps | Walk: primitives / wound rows | After the hit: primitives / wound rows |
| --- | --- | --- | --- | --- | --- |
| Untouched | 25.2, 25.6, 32.5 ms | 56,420 | 304k | 1.71M / 0 | 1.23M / 0 |
| + one double-barrel volley (16 wounds) | 27.8, 28.8 | 53,075 | 285k | 1.73M / 4.93M | 1.22M / 2.83M |
| + a second volley (32 wounds) | 34.2, 35.6, 38.4 | 68,716 | 405k | 2.60M / 7.79M | 1.92M / 4.10M |
| + a torso chop | 50.5, 51.9, 57.3 | 45,232 | 235k | 3.81M / 6.55M | 2.76M / 3.48M |
| + head chop 1 (a crack) | 37.7, 40.0, 41.5 | 27,479 | 119k | 2.68M / 5.01M | 2.07M / 2.84M |
| + head chop 2 (split wide) | 64.1, 69.9, 62.6 | 30,484 | 102k | 1.97M / 3.11M | 2.90M / 4.36M |

(The body moves with each blow, so the marched texels change from stage to stage; the frame is re-aimed each time.)

- **With 32 wounds a march step folds 19 wound rows and 6 body primitives.** Every wound's reach carries a fixed
  0.25 m of slack (`wounds.wgsl.ts`: a bound on how deep inside a limb a sample can be), so on a torso most wounds
  reach most samples.
- **Removing rows per sample does not return time; removing them for everything does.** The existing exact-reach
  switch (`setWoundExact`, ships off) cuts the walk's rows from 7.79M to 1.88M and the post-hit rows from 4.10M to
  0.96M, and the frame reads 33.6 ms against 33.4 before and 38.0 in the A/A after it: not resolved. Turning the
  coarse early-out OFF adds 25% rows (9.76M) and costs 10 ms. Both earlier cost passes found the same shape (a 78%
  cut in organ evaluations bought a quarter of their time; −36% primitives bought −1.5 ms). The likely reason is that
  fragments are shaded in groups and a group pays for its slowest member, so an exit only pays when its neighbours
  take it too. *This is an inference from three measurements, not something verified in the GPU.*
- **Cuts and the split cost more than their counters.** The split-wide frame folds fewer rows and primitives than the
  32-pellet frame and costs 27 ms more. The census does not count a cut row's noise (a `noise3` and two `hash13`) or
  the split's per-piece set-up (PR 35's notes, §5 item 3).
- The per-ray wound list (`setWoundList`, ships off) changes no counter here and costs 17 ms more.

**PR 35 (the open head's cost pass) on current `main`.** It merges without a text conflict onto `d6bb9967` (the code
reorganisation of PR 36 included). The same sequence on the merged tree, interleaved with `main`, two rounds:

| Stage | Walk primitives, `main` → merged | Post-hit primitives | Frame, `main` (3 runs) | Frame, merged (3 runs) |
| --- | --- | --- | --- | --- |
| + a torso chop | 3.81M → 2.92M (−23%) | 2.76M → 2.25M | 50.5, 51.9, 57.3 | 61.4, 55.0, 66.8 |
| + head chop 1 | 2.68M → 1.90M (−29%) | 2.07M → 1.60M | 37.7, 40.0, 41.5 | 39.2, 36.1, 42.5 |
| + head chop 2 (split wide) | 1.97M → 1.39M (−29%) | 2.90M → 2.23M | 64.1, 69.9, 62.6 | 64.5, 59.9, 65.3 |

Its counters hold. On this heavily wounded body the time difference is inside the spread of the runs (split wide:
65.5 against 63.2 ms on average, runs spread over 7 ms), so it is confirmed as work removed and not as a time gain
here; its own interleaved measure on a clean body was −1.5 ms. Wound rows barely move (3.11M → 3.02M), and rows are
most of what this body pays.

### 3.4 Bodies at distance (noted, not ranked)

Twelve extra zombies packed 8 to 13 m from the eye on the bare page's arena (28 bodies in the frustum, frozen): 63 to
70 ms a frame, the march nearly all of it. No level today holds a crowd like that, so it is not in the ranking; it
is the number the merged crowd march and the baked mesh LOD tasks are for.

## 4. The head and the skull

Measured on PR 39 (`447cf859`, now merged) against `main` before it, interleaved boots, the bare page's arena with
extra zombies, frozen.

| | `main` before | PR 39, 5 mm (the default) | PR 39, 1 cm (`?sculpt=full-1cm`) |
| --- | --- | --- | --- |
| Triangles a frame, 18 bodies at 3 to 9 m, skeleton meshes hidden | 643,753 | 643,753 | 643,753 |
| the same, as shipped | 747,317 | 968,885 | 748,085 |
| of which eyes | 25,920 | 25,920 | 25,920 |
| Triangles a frame, 28 bodies at 8 to 13 m, as shipped | 1,409,386 | 1,907,914 | n/a |
| The polygon pass's GPU time there, meshes shown / hidden | 1.26 / 1.24 ms | 1.23 / 1.16 and 1.22 / 1.14 ms | 1.17 / 1.15 ms |

- **Every zombie and soldier head in view is drawn every frame, exposed or not, on both trees**: 16 zombie heads
  and 2 soldier heads in the first scene. 5 mm adds exactly 13,848 triangles a zombie head (221,568 for 16).
- **It cannot be measured in the frame.** Half a million more triangles change the polygon pass by under 0.1 ms; in
  the fights of §2.2 hiding every bone, eye and organ mesh returns 0.4 to 1.5 ms on `main`, and the eyes alone are
  not resolved.
- So: 5 mm against 1 cm is a look and boot-time choice, not a frame-time one. Not drawing intact heads would save
  triangles nobody is paying for. The fitted skulls' draw cost and the larger slug craters were not measured
  separately: the first is the same kind of mesh draw (9,947 triangles a head, under the floor); the second is a
  wound, and §3.3 is where wounds are counted.

### 4.1 Cold boot

`scripts/boot-time.mjs` (its own dev server and a fresh Chrome profile per boot), `main` before the skull stack
(`d6bb9967`) against `main` after it (`06f2ef12`), alternated, two rounds:

| | `drawOnce` (the first real march draw), before | after | The whole warm-up, before | after |
| --- | --- | --- | --- | --- |
| Bare page | 1752, 2042 ms | 1983, 2309 ms | 47.5 s (the first boot of the session), 3.4 s | 2.8, 3.6 s |
| Night Train | 4496, 4385 ms | 4397, 4701 ms | 17.3, 6.1 s | 5.5, 6.3 s |

- **The skull stack adds about 0.25 s to the bare page's first draw** (+231 and +267 ms in the two rounds), which is
  the notes' own figure for the two carved heads at 5 mm. On Night Train the difference is inside the spread (300 ms).
- **Only the first boot of the session was cold**: 47.5 s of warm-up, nearly all pipeline compile. Every later boot,
  fresh profile or not, warmed in 3 to 17 s: the system keeps compiled shaders outside the browser's profile. So a
  truly cold boot is about 48 s on the bare page, measured once, and a "fresh profile" does not reproduce it. A
  second cold pair was not available without clearing the system's cache, which I did not do.
- The 1.3 MB skull asset's load was not separated from the rest (26 to 107 ms from the local dev server in PR 39's
  notes and in this pass's boots; a real network would add the download).

## 5. Changes

### 5.1 The held weapons and the arms shade the lights near the eye (built; branch `claude/near-lights`)

**What changed.** A held weapon's light list is now: the scene's ambient and hemisphere lights, a FIXED set of proxy
lights (6 point, 4 spot, 2 directional) and the torch. Every frame the proxies copy the point and spot lights that
can deliver the most at the eye, from the player's room and its neighbours (`near-light-pick.ts`, pure and tested;
`near-lights.ts`, the three.js side). The shotgun, the arms, the shells in hand and anything else under the
view-model anchor adopt that list (`viewmodel-lights.ts` `lightHeldMeshes`); the flail's and the axe's own lists use
the same proxies in place of "every light the camera sees". 16 lights where there were 69, none of the proxies with
a shadow map.

**Why proxies and not a list per room.** A material's light list is part of its pipeline's key: swap the list when
the player changes carriage and every held material is rebuilt in that frame (the re-key trap the muzzle flash's
comment in `game-main.ts` documents). The proxies' membership never changes, only their contents, so nothing is
rebuilt. It is the per-room list, delivered through fixed slots.

**Before and after** (`main` at `06f2ef12` against the branch; two dev servers, one browser, the boots interleaved,
two repeats, the scripted fight; frame p50 in ms; full table in [`matrix-near-lights.md`](matrix-near-lights.md)):

| Scene, segment | `main` (rep 1 / rep 2) | Branch | Change | Level-polygon pass, GPU |
| --- | --- | --- | --- | --- |
| Guards' van, walking | 13.2 / 13.8 | 10.6 / 10.9 | −2.8 | 4.6 → 0.8 |
| Guards' van, firing | 19.4 / 19.7 | 15.1 / 15.3 | −4.3 | 5.0 → 0.8 |
| Guards' van, after the slug | 24.7 / 25.2 | 19.1 / 19.1 | **−5.9** | 5.2 → 1.0 |
| Third class, walking in | 26.0 / 25.9 | 20.1 / 19.6 | **−6.1** | 7.5 → 1.7 |
| Third class, firing | 17.8 / 17.9 | 15.5 / 15.2 | −2.5 | 4.4 → 0.3 |
| Third class, after the slug | 17.0 / 16.9 | 13.3 / 13.2 | −3.7 | 4.9 → 0.2 |
| Boiler Room, walking in | 21.9 / 21.6 | 16.6 / 17.0 | **−5.0** | 7.2 → 2.1 |
| Boiler Room, firing | 25.6 / 25.2 | 19.8 / 24.4 | −5.8 / −0.8 | 7.1 → 2.1 |
| Boiler Room, after the slug | 37.9 / 37.3 | 33.3 / 32.8 | **−4.5** | 6.6 → 1.9 |
| Bare page, room 4, walking / firing / after the slug | 11.3 / 15.5 / 12.8 | 11.2 / 15.5 / 12.8 | 0 | 0.8 → 0.8 |

- The branch's second Boiler Room firing take read CPU tick 9.0 and draw 10.5 ms against 6.7 and 8.0 in its first:
  a disturbed take that passed the speed check. Its other segments agree with the first repeat.
- The bare page's second `main` repeat was a disturbed take (marked in the full table); its first is used.
- **The hitch on entering a carriage more than halves**: the first frame in the room reads 159 to 202 ms on `main`
  and 51 to 84 ms on the branch (van 159, 167 → 51, 62; third class 182, 178 → 80, 84; Boiler Room 202, 183 → 68,
  82). Not looked into further: fewer and far smaller pipelines are built for the held meshes.
- The first shot's hitch is unchanged (29 pipelines; worst frame 98 to 151 ms in these runs).
- On the still frame of §3.1 (third class, per-frame fenced): 33.1 → 26.0 ms; hiding the held meshes now returns 0.3
  ms where it returned 7.8; `?nearlights=0` on the branch reads 32.8 ms.

**The picture.** [`near-lights-look.jpg`](near-lights-look.jpg): eight cases, before, after, and the difference
times 8 (VHS off and the light clock pinned so both trees draw the same instant).

| Case | Held weapon's region: mean difference of 255 | Pixels differing by 8 or more | Mean colour before → after |
| --- | --- | --- | --- |
| Third class, shotgun | 0.22 | 0.84% | 60.8, 56.9, 57.8 → 60.6, 56.7, 57.6 |
| Third class, the firing frame | 0.01 | 0% | the same |
| Boiler Room, shotgun | 0.18 | 0.25% | 63.2, 65.6, 67.0 → 63.0, 65.5, 66.8 |
| Sleeper, shotgun | 0.39 | 1.48% | 42.2, 41.4, 39.6 → 41.9, 41.0, 39.2 |
| Guards' van, flail | 0.00 | 0% | the same |
| Third class, axe | 0.00 | 0% | the same |
| Bare page, room 4, shotgun | 0.13 | 0.29% | 84.0, 73.2, 70.7 → 83.7, 73.2, 70.6 |

What differs is thin highlights along the barrels: lights of rooms that are not the player's or a neighbour's no
longer glint on the metal (they did, through the walls), and a tube's shadow map no longer falls on the gun. I could
not see either without the difference map.

**How to put it back.** `?nearlights=0`: the held meshes shade three's default list again and the flail and axe
their old mirror of it. `__sdfGame.nearLights()` reports which real light each proxy holds.

**Checks** (on the branch, 2026-10-08):

| Check | Result |
| --- | --- |
| `march-hash`, three modes | **no pin moved**: default `d7392d52…` / wounded `76bd51aa…`, crowd `0c71e712…` / `bf6836cd…`, per-body `470ff0b3…` / `f618070e…` (the body march is not touched) |
| `scripts/flail-gate.mjs` (`OUT=` scratch) | 47 passes, 0 failed (it measures the haft's and the ball's clipping under the torch's fill) |
| `scripts/axe-gate.mjs` (`OUT=` scratch) | 29 checks, 0 failed |
| `scripts/sdf-game-train-gate.mjs` | passed |
| `scripts/sdf-game-light-gate.mjs` | every check passes but one, **which fails on `main` too**: "skull glows in the dark: skull 0.083 vs surrounding flesh 0.053 (1.56x > 1.5x)" on pristine `06f2ef12`, 1.55x on the branch. It came in with the sculpted skull's second paint; flagged as its own task, not touched here |
| `npm run typecheck`, `npm run test:changed` | clean; 6 files, 33 tests (the new `near-light-pick.test.ts` among them) |
| Console errors over the eight look boots and the 16 matrix boots | 0 |

**Not verified.** The torch on Night Train (my two captures did not light it; the torch-lit case in the sheet is the
bare page's, where it is on from boot, and the flail and axe gates run under it). Outdoor levels (the moon is a
directional light and takes a directional slot; not captured). A weapon picked up in play after the gun loaded is
adopted within 2 s (120 frames), not at once: for that long it keeps the default list, as before. The owner has not
seen it in play.

## 6. The ranking: what closes the gap to 33.3 ms

Where the heavy scenes stand with §5.1 in:

| Heavy scene | Before | With §5.1 | Still over by | What is left in it |
| --- | --- | --- | --- | --- |
| Boiler Room, after a fight | 37.6 ms | 33.1 ms | 0 (no margin) | march 23.5 of it: wounds |
| Bare arena, after a fight (46 wounds) | 37.4 ms | 37.4 ms (no Night Train lights there) | 4.1 | march 30.1: wounds |
| Close-up, 32 wounds + a torso chop + the head split wide | 36.2 ms | about the same | 2.9 | march 31.2: cuts and the split |
| Third class, walking in | 26.0 ms | 19.9 ms | under by 13 | |

So everything that is still over is the march on wounded bodies. In order of evidence:

| # | Candidate | Helps | Expected | Evidence | Risk | What changes on screen |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | **Near lights for the held meshes** (§5.1) | Night Train | −2.5 to −6.1 ms; entry hitch halved | built, measured | low | thin far glints on the barrels go; no tube shadow on the gun |
| 2 | **The props and the kit on their room's lights** (fixtures, pickups, spent shells: 58 meshes on the default list; the soldiers' kit mirrors it too) | Night Train | −1 to −1.5 ms (the 58 meshes' ceiling is 1.5 ms; the kit is not measured) | §3.1 | low: they do not move between rooms, so a fixed list per room rebuilds nothing | none expected |
| 3 | **Merge PR 35** (the open head's and the cuts' bounds) | cuts, open heads | −23 to −29% of the march's primitive folds on a chopped or split body; −1.5 ms on a clean open head by its own measure; not resolved on a heavily wounded one | §3.3 | low to medium: it predates the skull stack; its three gates and `march-hash` must be re-run on the merge | none (the same picture to the bit, or the same solid inside a smaller hull) |
| 4 | **Find the cut's and the split's uncounted cost** (a torso chop adds 16 ms to a body with 32 wounds, the split wide another 26 ms, and neither shows in rows or primitives) | the close-up, any chopped body | unknown until attributed; the largest unexplained item | §3.3 | none to measure; the fixes it points at (the cut's noise confined to its rim, the split's per-piece set-up reused) are exact or near-exact | none intended |
| 5 | **Fold wound rows for a region, not a sample** (a per-tile or per-cluster mask of which wounds can reach it, written when a wound is stamped) | every wounded body | bracketed by two measurements: all rows for everyone costs +10 ms (the early-out off), per-sample removal of 76% returns nothing resolved. A regional cut should land between | §3.3 | medium: a bound that is too tight is a hole in a body | none if the bound is exact |
| 6 | **Bake craters into a rest-space volume per body** (the research pass's only route to a cost that does not grow with the count) | every wounded body | removes the dependence on count for craters | published practice (Claybook, Dreams); nothing measured here | high: days of work; rims limited by the volume's cell; cuts are too thin for it | crater rims softer unless the noise stays procedural |
| 7 | **Pose, pack and upload only the bodies in view** | every level's CPU | −1 to −2.5 ms of tick | §3.2 | medium: the posed body has about 30 readers inside `game-actor.ts`; demos must replay to the same hash | none |
| 8 | **Draw only the rooms the doorways show** (a portal test over the level's rooms; today every carriage ahead is drawn) | Night Train | −3 ms in third class (2 of it CPU), −1 ms in the Boiler Room | §3.2 | medium: a wrong test is a carriage popping in at a doorway | none if the test is exact |
| 9 | **The first shot's 29 pipelines** (70 to 150 ms, once a boot) and the rest of the entry hitch (50 to 85 ms) | stability | removes two visible stalls | §2.1, §5.1 | medium: the warm-up has to draw what a first shot creates without showing it; cold boot grows by whatever it compiles | none |

The CPU items (7, and the CPU share of 8) return less in the heavy scenes than their milliseconds: those
frames are bound by the GPU (the GPU waits on the CPU for 0.8 to 2.4 ms after the slug, 3 to 6 ms while firing).

**Not worth doing** (measured, with the number):

| Idea | Why not |
| --- | --- |
| The post chain (FXAA, VHS, the upscale) | about 1 ms together; FXAA 0.1 to 0.4, VHS under the floor |
| Fewer or baked shadow maps; shadows off on bodies | re-renders 0.15 ms of CPU; sampling on bodies under the floor in all six scenes |
| A level distance field or light cookies, for time | there is no shadow-map time to win back (above). Both may be worth having for the look (soft shadows and AO from the carriage on bodies without the 16-texture limit; shaped beams), judged as look work |
| Not drawing intact heads; 1 cm skulls | half a million triangles change the polygon pass by under 0.1 ms |
| Freezing the level's matrices | not resolved (+0.25 ms): the cost is the scene walk, not the flag |
| Merging the gun's and the arms' 101 meshes; normal maps or parallax on them | under 1 ms of CPU; their cost was the light list, now fixed. Worth folding into the shotgun's own clean-up, not a perf item |
| Early-Z (`?earlyz=1`) on the train scenes | third class walking in: march 12.5 → 12.0 ms, frame inside the floor; Boiler Room after the slug: march 23.1 → 24.6 ms. Its notes already say it only pays where bodies hide behind walls or each other |
| The exact wound reach (`setWoundExact`), the per-ray wound list | −76% rows, no time resolved; the list costs 17 ms more here |
| Goo, gib chunks, the bone and organ meshes | 0.3 to 1.5 ms, mostly under the floor |

**One wider observation.** Three of today's findings have the same shape: a system grew its own answer to "what is
relevant right now" and its neighbours never got it. The walls had a per-room light list, the gun and the props did
not. The visual set gates a body's hulls and bones but not its pose. The warm-up compiles the pipelines it can see
and not the 29 a first shot makes. One shared answer per tick (which room, which bodies, which lights) would replace
several partial ones; that is a direction to grow into while fixing these, not a rewrite to schedule.

## 7. How to re-run

```bash
# one GPU job at a time on this machine: take the shared lock first
until mkdir /tmp/blud-gpu-timing.lock 2>/dev/null; do sleep 10; done
bash -c 'export LAB_TMP=.lab-tmp LAB_VITE_PORT=5261 LAB_CDP_PORT=9261; . scripts/lab-servers.sh
  trap "lab_servers_down; rm -rf /tmp/blud-gpu-timing.lock" EXIT; lab_servers_up
  node scripts/frame-cost.mjs 5261 9261'
# two trees, interleaved (a second dev server on 5267 serving the other tree):
#   SCENES=train-third@5261,train-third@5267 ABLATE=0 node scripts/frame-cost.mjs 5261 9261
```

The driver's header lists every option. Never edit `src/` under a dev server a run is using: the page reloads.
