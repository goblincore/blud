# Tesla arc: the zap state — build notes

2026-11-17. Plan: `docs/superpowers/plans/2026-11-17-tesla-1-zap-state.md`. Spec:
`docs/superpowers/specs/2026-11-17-tesla-arc-design.md` (brought in line with what was built).

## Summary

Plan 1 of 3 is built: the zap state on a body, fired from a placeholder on slot 9. Holding fire on a body puts it
in a rigid star pose with a trembling trunk, glowing blue-white with its mesh skeleton showing dark inside the
glow (bright on a jolt). The flesh chars from a cook of 0.6. On a full cook (1.6 to 2.2 s by default, rolled per
body) the body stands as a charred statue for 0.8 s (`ZAP.statueSec`) and then dies its ordinary death. Releasing
before that lets it recover over 0.6 s; the char it had stays. No arc is drawn between the prop and the body (plan
2), and there is no ash death (plan 3). Neither plan is written.

New modules (all paths under `src/lab/sdf-zombie/`):

- `zap.ts`: the zap clock. Cook, the glow's envelope and flicker, jolts, char, the statue's time. Pure.
- `zap-pose.ts`: the star pose (three arm variants) and the tremor, as hand targets and trunk angles. Pure.
- `webgpu/game-zap.ts`: starts a zap on a body (`zapActor`), copies each body's zap look to its view each tick
  (`stepZapLook`), hands each bone instance its owner's glow (`syncZapXray`), and the `zaps()` readout.
- `webgpu/game-tesla.ts`: slot 9's harness. The placeholder prop and the one verb: find, hold or drop the target,
  re-derived every tick.
- `webgpu/tesla-stick.ts`: the reach (12 m) and the stick angle (8 degrees), numbers only.
- `webgpu/skeleton-spike/zap-xray.ts`: the bone pull toward the eye and the flat bone colour, in TS and WGSL.
- `webgpu/march/body/blocks/post/zap.wgsl.ts`: `ZAP_BLOCK` (the terms, beside the burn block), `ZAP_LIGHT_BLOCK`
  (the flesh colour, at the end of the lighting tail) and `ZAP_LOOK`.
- `scripts/zap-trace.mjs`: the headless trace every number below comes from.

Edited to carry it: `motion-profile.ts` (`ZapTier`; the gorehound and the gutcrawler set `star: false`),
`motion.ts` (`cfg.zapPose`), `webgpu/game-actor.ts` (the zap slot and override), `webgpu/crowd-records.ts` and
`webgpu/zombie-gpu.ts` (the record's zap lane, the view's `zapChar`), `skeleton-spike/mesh-renderer.ts` and
`segment-instance.ts` (`iZap`, the un-pulled world position), `webgpu/game-crowd-queries.ts` (a glowing body's
whole skeleton is drawn), `webgpu/game-weapon-slots.ts` (key 9).

To try it: `npm run dev:arena`, wait for the warm-up, key `9`, hold fire on the body. `-` and `=` cycle characters,
`` ` `` respawns.

Console seams, all on `__sdfGame`:

- `zapActor(id?)`: put the arc on one body, or on every body; returns how many started.
- `unzapActor(id?)`: take the arc off.
- `zaps()`: `{ id, phase, glow, invert, char }` for every body the arc has touched.
- `fireTesla(on)`: hold or release slot 9's fire. `tesla()`: `{ held, target }` (target -1 with no body).
- `boneZap(id?)`: the `iZap` of one body's drawn bone and eye instances.

## Not verified

- The look in motion. Every judgement below is from stills of headless captures; nobody has played it.
- Any character but the zombie in a capture. The `star: false` bodies (gorehound, gutcrawler) are covered by
  `zap-pose.test.ts` only. No character sets `dies: false`, so a tier that does not die is covered by
  `zap.test.ts` only.
- The procedural-skeleton bone probe (`?skeleton=procedural`). Not run.
- Bullet time.
- Night Train, and any sector level.
- Slot 9's wall test in a real level. `game-tesla.test.ts` stubs `sightBlocked`; the arena trace has no wall
  between the player and the body.
- A zapped body with a wall, a pillar or another body within 0.6 m in front of it (the pull puts the bones in
  front of anything that close). The arena is empty.
- A wounded body with organs showing, under the zap.
- A burning body under the zap, and a soldier's death by the zap, in a capture. The actor tests cover the burning
  body; the soldier has no zap test.
- Two of the actor rules added in review have no test of their own: the floater's suppressed idle drift and the
  downed soldier's refusal.
- The split-PLATE pipeline (the anatomical skull's split copies, 8 of 8 vertex buffers) on a GPU with `iZap`. The
  arena zombie's skull is the sculpted one, so the trace exercises `skeleton-bone-split` and `skeleton-eye-split`
  only.
- The crowd draw, beyond the two-body scenario. The trace's single-body series and its split scenario run on the
  per-body fallback (they do not wait for the crowd program).
- The two-body glow gate has little margin: +7.0 on the neighbour against a gate of 8 in the last run, because
  the neighbour walks while it is measured.

## Known limits

- A pulled bone writes depth up to 0.6 m in front of its body: anything that close in front of a zapped body
  (another body, a pillar, a door frame) is drawn over by the skeleton. Plan 2's arc ends on the chest, inside
  that range.
- Inside about 0.8 m the pull is held to a quarter of the bone's distance, so a very near body's bones stand
  at a quarter of their distance from the eye.
- During the fade (glow under 0.25) the lit part of the bone's mix is lit at its true place (the second review
  pass gave that), but it is still a bone drawn in front of flesh it would normally be behind.
- The bones nearly fill the flesh, so the glow shows as a rim round the skeleton, not as a body with bones in it.
- From 1.1 m the flat skull is a featureless dark oval (no sockets, teeth or jaw line).
- The statue is a glossy dark brown figure with bright highlights (the burn block's char look), not matte ash.
- The jolts land 0.33 to 0.78 s apart, start to start, not the spec's first 0.25 to 0.7 s: the gap timer
  (`ZAP.joltGapSec`, 0.25 to 0.7 s) does not run during the 0.08 s jolt.
- Cook rises at 1 / `cookSec` and falls at 0.5 a second, so a body whose roll is under 2.0 s still cooks through
  under an arc that is on half the time: tapping the trigger does not save it.
- A tier that does not die holds at a full cook, which is a char of 1: it recovers fully charred.
- A statue still takes hits; killed another way it drops its zap and takes that death.
- The split batches have no vertex buffer left (8 of 8): the next per-instance value there has to ride an
  existing buffer.
- The burn's own ramp and char have the bleed the zap had (`max(burnCfg, record)` in `burn.wgsl.ts`); out of
  scope here.

## Task 4: the glow on the flesh

The glow rides `burnCfg.w` per view and `REC_BURN.w` per crowd record, signed (negative = bones inverted).
`ZAP_BLOCK` (trace post, after the burn block) gathers the terms into the private `gZap`; `ZAP_LIGHT_BLOCK`
(end of the lighting tail) mixes the lit colour toward the flat glow. `game-zap.ts` copies each actor's
`zapLook()` to its view after the burn step.

### The trace (`node scripts/zap-trace.mjs`)

Arena, one zombie about 2.6 m away in the flashlight, `__sdfGame.zapActor()`, a sample every 0.25 s of sim
time (15 steps of 1/60 s) for 4 s. Numbers from the last run (`zap-trace.json`); three runs agreed to within
a few luminance units.

| t (s) | phase | glow | char | centre 30% luma | chest box luma |
| --- | --- | --- | --- | --- | --- |
| before | none | – | – | 74.70 | 197.72 |
| 0.25 | zapped | 0.735 | 0 | 84.89 | 227.49 |
| 0.50 | zapped | 0.931 | 0 | 81.55 | 222.61 |
| 0.75 | zapped, inverted (a jolt) | 0.697 | 0 | 43.35 | 75.30 |
| 1.00 | zapped | 0.638 | 0 | 101.98 | 228.32 |
| 1.25 | zapped | 0.969 | 0.026 | 95.96 | 218.65 |
| 1.50 | zapped | 0.789 | 0.376 | 88.61 | 222.68 |
| 1.75 | zapped | 0.559 | 0.828 | 84.76 | 218.28 |
| 2.00 | statue | 0 | 1 | 59.26 | 149.72 |
| 2.25 | statue | 0 | 1 | 60.09 | 152.02 |
| 2.50 | statue | 0 | 1 | 61.38 | 155.01 |
| 2.75 | statue | 0 | 1 | 60.60 | 153.28 |
| 3.00 | none (dead, falling) | 0 | 1 | 46.43 | 111.98 |
| 3.25 | none | 0 | 1 | 32.41 | 81.35 |
| 3.50 | none | 0 | 1 | 25.24 | 24.83 |
| 3.75 | none | 0 | 1 | 25.28 | 24.83 |
| 4.00 | none | 0 | 1 | 25.36 | 24.96 |

- Pipelines (`pipelineLog().totalPipelines`): 120 before, 120 after (121 and 121 in the two earlier runs).
  The zap compiles nothing.
- **The plan's 1.5x on the centre crop is not met: 1.20x** (mean of the six un-inverted zapped samples
  against the frame before). Two reasons, both about the measurement: the arena zombie stands in the
  flashlight with a chest luminance of 198 of 255 before the zap, so nothing can be 1.5x brighter; and at
  2.6 m the centre 30% crop is mostly the dark room, with the star's raised arms outside it. The script
  reports that ratio and gates on a chest box instead (6% x 11% of the frame, flesh only): every un-inverted
  zapped sample is brighter than before (min 218.28 against 197.72, mean 1.13x) and the colour turns from
  warm to blue-white (blue minus red: -23.7 before, +22.8 zapped).
- The last crop is darker than the first (25 against 75), but that is the empty room: the statue has
  fallen out of the crop by 3.5 s. The statue itself, standing, has a chest luminance of 152 against 198.

### What the frames show

- Zapped: a flat blue-white figure in the star (arms up and out, legs under it), edges clipped to white,
  no shading, wounds or face visible. The eye glow is gone under it. No skeleton (Task 5).
- The jolt at 0.75 s: the flesh goes DARK grey, dimmer than the unzapped body. That is `gZap.y` swapping
  flesh and bone colours; with no skeleton drawn yet the frame reads as the glow switching off for a
  moment. It needs Task 5's bright bones to read as an inversion.
- Statue: a dark brown charred figure holding the star, still carrying bright specular highlights from
  the flashlight (the burn block's char look at burn 0). Not ash-grey.
- From 3.0 s the dead statue falls over backward as a ragdoll; the last frame, looking down, shows the
  charred corpse on the floor.

PNGs under `docs/dev-notes` are gitignored; the script rewrites them and the contact sheet on each run.

### Boot time (`node scripts/boot-time.mjs`, fresh Chrome profile each run, interleaved)

| run | branch `drawOnce` (ms) | `main` `drawOnce` (ms) | branch warmMs | main warmMs |
| --- | --- | --- | --- | --- |
| 1 | 974.9 | 981.8 | 24308 | 23783 |
| 2 | 1022.3 | 1092.0 | 1394 | 1517 |

`main` was the primary checkout at e8fb57110 (ahead of this branch's base c7242cfb6). The branch is inside
`main`'s run-to-run spread. The drop in warmMs between run 1 and run 2 is on both checkouts.

### Departures from the plan's code

- `prim-material.wgsl.test.ts` pinned "primGlow is assigned exactly three times"; the zap fade is a fourth,
  so the pin is now four and names both fades.
- `ZAP_LOOK` colours are written through the float formatter (`1.0`, not `1`) in the WGSL.
- `zaps()` also returns `invert`, which the trace needs to tell a jolt from the glow.

## Task 5: the skeleton in the glow

Each bone and eye instance of the mesh skeleton carries `iZap`, its owner's signed glow (`syncZap`, driven by
`game-zap.ts syncZapXray` once a frame from `game-main.ts`, outside the light-list `if`). Where it is not zero
`segmentInstance` pulls the vertex toward the eye along its own ray (`zap-xray.ts`, 0.6 m, never under a quarter
of its distance) and the fragment's lit colour is mixed toward the flat bone colour (dark in the glow, the
glow's colour on a jolt). No new batch, material or pipeline.

### What had to be checked, and what was found

- **An intact body does not draw its skeleton.** The bone exposure cull (`segmentNeeded`) draws only the head
  segment (it carries the eyes) of a body with no carving wound: 3 instances for the arena zombie. The plan did
  not cover this. `boneExposedActors` (`game-crowd-queries.ts`) now adds every body that is `zapping()`, so its
  22 bone and eye instances are in the batches. The batches were pre-warmed at boot, so nothing compiles.
- **Organs stay as they were.** `syncZap` writes 0 to an organ batch whatever its owner's glow: an organ is never
  pulled or flattened, and it is still drawn only where a wound's exposure sphere reaches it (the exposed set
  alone does not draw one). **Eyes take the zap** like bone: pulled with the skull and shaded flat, so the red
  pupil is gone and the eye is part of the skull's shape.
- **Vertex buffers (limit 8 a pipeline).** With `iZap`: closed bone 7 (position, normal, meshFeature, instance
  matrix, iLights, iFill, iZap), closed plate 7 (uv in meshFeature's place), eye 6, organ 7 (organTube), split
  bone and split plate **8** (the split record), split eye 7. Nothing is over, so `iZap` is its own buffer as the
  plan has it, but the split batches have no room left: the next per-instance value there has to ride an existing
  buffer (the comment above `splitRows` says so). The split pipelines were run on the GPU with a forced split
  under the arc (below): no pipeline error.
- **Where `iZap` is created:** `ensureLights` (every batch, and the three debris makers: a released plate, a
  sculpted skull's fragments, the melt's dropped segments) and `debrisEyeGeometry`. Those are every site that
  creates an `iFill`; nothing outside `mesh-renderer.ts` draws on a segment material (`bone-instancer.ts` has an
  `iFill` of its own, on its own material). The level batches and the shotgun casings use `useSegmentInstance`
  with no `iZap`: `segmentInstance` takes the plain path for them (`hasGeometryAttribute`).
- **World space:** the group is made in `createSegmentMeshRenderer`, never moved, and added to the scene root
  (`game-main.ts`, `scene.add(ctx.render.segMeshRenderer.object)`); the instance matrix is the world matrix.
- **Owners** are the actors (`update(..., ctx.world.actors, ...)`); the renderer's owner-less fallback slot has
  no `zapLook`, which reads as 0.
- **Stale rows.** A batch remembers how many of its `iZap` rows may hold a glow; `syncZap` clears rows the batch
  no longer draws, so a body that leaves mid-zap cannot hand its glow to the next instance in that row. An
  unchanged sync uploads nothing.
- **The colour wrap** runs after every material's `colorNode` is assigned and keeps its alpha. Tests that walk a
  material's paint graph read it through `segmentLitColour(material)` (the colour under the wrap).
- `stepZapLook` prunes `glowing` of bodies that left the world.

### The trace (`node scripts/zap-trace.mjs`)

Same series as Task 4, plus: on the first zapped sample and on the first jolt, the same instant is drawn three
times under `setRenderLock` (bones shown, bones and eyes hidden with `meshSkeletonShow`, shown again) and the
mean absolute difference over the body's box (28% x 80% of the frame) is taken; then a second boot forces the
head open (`forceSplit`), zaps the body and looks at it from 1.1 m. Last run (three runs agreed):

| | iZap on its 22 instances | shown vs hidden (of 255) | shown vs shown again (noise) | body box luma shown / hidden |
| --- | --- | --- | --- | --- |
| glow, t = 0.25 s | +0.735 | 11.49 | 3.88 | 72.82 / 81.30 |
| jolt, t = 0.75 s | -0.697 | 17.40 | 3.30 | 74.22 / 58.75 |

(10.21 and 14.89 in the first run, at 3.0 m instead of 2.65 m; 11.74 and 17.61 in the second.) Before the zap
and at the end the body's instances read `[0, 0, 0]`. The plan's floor was 8. The noise floor is high because
two draws of one instant differ by the VHS pass.

- Pipelines: 121 before, 121 after (120 and 120 in the two earlier runs).
- Split head under the arc: 3 bone copies on `skeleton-bone-split` and 2 eye copies on `skeleton-eye-split`,
  24 instances, all at iZap 0.735, no renderer error.
- **The Task 4 chest gate was changed.** The ribcage now stands in front of the chest box, so its luminance
  falls in the glow (198 before, 119 to 169 zapped with bones). The flesh is gated on the bones-hidden frame
  instead (chest 230, blue minus red +16 against -26 before); the bones-and-all series is reported, not gated.

### What the frames show

- Glow: the skeleton is there and in register with the body: skull, ribs and sternum, spine, pelvis, both arms
  to the hands, the thighs down to where the gun hides them. Hidden, the same frame is the flat blue-white
  figure of Task 4.
- **The bones are not dark at these glows.** The colour is a mix by the glow (0.56 to 0.97 in this zap), and
  the bone under it is lit by the flashlight, so at 0.74 the skeleton reads as mid brown-grey bone with its own
  shading, and only near 0.93 to 0.97 as a dark purple-grey figure. It never reaches the near-black of
  `ZAP_LOOK.bone`. It is clearly a skeleton in a bright body, but it flickers between "lit bone" and "dark
  bone" with the glow. From 1.1 m (glow 0.59) the skull is a plainly lit brown skull with teeth and dark
  sockets.
- **The bones nearly fill the flesh.** The glow shows as a rim round the skeleton (wide at the torso, a thin
  line along the arms), not as a body with bones inside it.
- Jolt: a clean bright white skeleton in a dark grey body. This reads best of the three.
- Eyes: no red pupil; the sockets are dark.
- Nothing draws over the first-person gun at 2.65 m or at 1.1 m. No z-fighting between bones. The statue and the
  corpse show no skeleton.
- Not looked at: a zapped body with a wall, a pillar or another body within 0.6 m in front of it (the arena is
  empty; the pull would put the bones in front of anything that close), a wounded body with organs showing, a
  second body beside the zapped one (the unit tests pin its instances at 0), and Night Train.

### Boot time (`node scripts/boot-time.mjs`, fresh profile each run, interleaved)

| run | branch `drawOnce` (ms) | `main` `drawOnce` (ms) | branch warmMs | main warmMs |
| --- | --- | --- | --- | --- |
| 1 | 944.1 | 944.9 | 1739 | 21488 |
| 2 | 1055.4 | 1059.1 | 1450 | 1464 |

`main` at e8fb57110. No difference outside the run-to-run spread.

### Departures from the plan's code

- `boneExposedActors` adds zapping bodies (above); without it only the skull shows.
- `syncZap` writes 0 to organ batches, clears rows a batch stopped drawing, and skips the upload when nothing
  changed; `ownerZap(owner)` and the `__sdfGame.boneZap(id)` seam read the values back.
- `segmentLitColour(material)` exported from `mesh-renderer.ts`; `mesh-renderer.test.ts`,
  `sculpt-renderer.test.ts` and `sculpt-default-pin.test.ts` read the paint graph through it. One text pin
  grew: the organ batch's attribute list in `mesh-renderer.test.ts` now includes `iZap`.
- `xrayColour` is written as WGSL's mix (`c * (1 - k) + to * k`), exact at both ends; the plan's form was off
  by a rounding at k = 1 and failed its own test.
- The WGSL numbers go through the float formatter, as in `zap.wgsl.ts`.

## Fixes after review

### The glow bled across a crowd type

Every frame the crowd material's uniform block is copied whole from its source view (the first body of the
type in the room: `copyUniformValues`, `game-main.ts`), `burnCfg` included, and `ZAP_BLOCK` took the larger of
`burnCfg.w` and the record's `gInstBurn.w`. With the arc on the source body every body of the type glowed and
inverted with it. `ZAP_BLOCK` now reads the record alone (`let zapRaw = gInstBurn.w;`). Every draw has a
record: a body's `syncRecord`, a chunk's `syncChunkRecord` and the first-person view all go through
`writeViewRecord`, which carries `burnCfg.w` as `zap`, and `game-main.ts` syncs each actor's record every
frame after the tick. The burn and gore blocks, which have the same shape, are untouched.

The trace has a scenario for it (first in the run; `ZAP_TRACE_BLEED_ONLY=1` runs it alone): a second zombie
spawned 1.4 m beside the arena's own (`spawnDebugCharacter`), the arc on the first, bones hidden, each body's
chest box read with the camera turned to it. **It only catches the bleed once the crowd program has compiled**
(`__sdfGame.warmBackground().crowd === 'ready'`): until then the game draws each body through its own view,
which cannot bleed, and the first attempt at this scenario passed for that reason. The script now waits for it
and fails if it is not ready. Both bodies are in type `zombie@1`; the zapped one is its source.

| chest blue minus red | before | arc on the first body | shift |
| --- | --- | --- | --- |
| un-zapped body, WITHOUT the shader fix | -13.1 | +7.9 | **+21.0** (the frame shows it as a blue-white figure) |
| un-zapped body, with the fix | -13.4 / -26.6 | -11.6 / -30.5 | **+1.8 / -3.9** (two runs) |
| zapped body, with the fix | -43.7 / -24.5 | +48.8 / +18.6 | +92.5 / +43.1 |

The gate is |shift| < 8 for the un-zapped body and > 20 for the zapped one. (The run-to-run spread is the
bodies' positions: they walk while the script waits for the crowd program.)

**The older scenarios still run on the per-body fallback** (they do not wait for the crowd program), so the
series below is the fallback's picture; the two-body scenario is the one that draws through the crowd material.

### The bones go flat as soon as the arc is on

`zapXrayColour` mixed by |zap|, so under a glow of 0.56 to 0.97 the skeleton was lit brown bone. The mix is
now |zap| x `ZAP_XRAY.saturate` (4): flat from a glow of 0.25, still fading over the attack and recovery. TS
and WGSL both. The flesh's mix is unchanged.

| | shown vs hidden (of 255) | noise | body box luma shown / hidden |
| --- | --- | --- | --- |
| glow, t = 0.25 s (iZap +0.735) | 16.59 (was 11.49) | 4.04 | 67.66 / 81.81 |
| jolt, t = 0.75 s (iZap -0.697) | 18.05 (was 17.40) | 3.48 | 75.22 / 59.13 |

The chest box through the zap (bones shown) is now steady: 114, 109, (jolt 182), 116, 108, 113, 108, against
158, 129, (178), 169, 119, 152, 168 before. Pipelines 125 before, 125 after.

What the frames show: in every zapped sample the skeleton is one flat dark blue-black figure in the bright
body, with no shading of its own; on the jolt, a flat white one in a dark body. At 1.75 s (glow 0.56, char
0.83) it is as dark as at 0.5 s. The cost of flat: **from 1.1 m the skull is a featureless dark oval** (the
eyes are the same flat colour, so there are no sockets, teeth or jaw line), and the ribs and arm bones are
plain dark bars. At 2.65 m the ribs, spine and pelvis still read by their outline.

### Also

- `crowd-records.test.ts`: `write()` puts `zap`, signed, at `REC_BURN * 4 + 3`, and 0 when absent (over a
  glow the slot held).
- `game-zap.test.ts` (new): the view lane, the one sync after the last glow, and that a cast rebuild
  (`actors.length = 0`) empties `glowing`, by the prune at the top of `stepZapLook`.

## Task 6: slot 9, the placeholder coil

Key 9 selects `tesla` (`game-weapon-slots.ts`), a dev harness in the melter's mould (`game-tesla.ts`): a
primitive prop on `aimRig` and one verb. While fire is held, the body under the crosshair is zapped
(`zapActor`), and it stays zapped while the crosshair is on it or within `TESLA.stickDeg` (8 degrees) of its
centre (`tesla-stick.ts`). Seams: `__sdfGame.fireTesla(on)`, `__sdfGame.tesla()` (`{ held, target }`).

### Where the code departs from the plan

- **A straight trace, not the slug's.** The plan handed the harness `traceSlugHitFrom`. That is a ballistic
  march (30 m/s, gravity -6, 240 steps of 1/120 s, bodies with a torso within 20 m): it drops about 0.5 m at
  12 m, so a re-trace toward a body's centre can pass under a small body, and it has no reach argument. The
  harness takes `traceMeleeHitFrom` instead (the rod's: one straight segment capped at a reach), with
  `TESLA.rangeM` (12 m) as the reach. Both traces see bodies only.
- **Walls.** Neither trace stops at level geometry, so the plan's "line of sight" was "no other body in the
  way". The harness takes a second dep, `sightBlocked(a, b)`: `ctx.world.colliders` through
  `segmentHitsBox`, or `sectorHitBetween` on a sector level. It gates acquiring a body and holding one.
- **The hold rule.** The plan held a target only while the aim was inside 8 degrees of its centre. From 1.2 m
  a body's arm is 30 degrees off its centre: the arc would land on the arm, drop on the next tick, and land
  again, every tick. The rule is now: the crosshair is on the target itself (this tick's aim trace names it),
  OR the aim is inside the stick angle of its centre with the centre in sight.
- **The centre** is the posed body's torso cluster centre (any live cluster if the torso is gone; 1 m over the
  feet with none), not `pose().pos + 1.0 m`.
- **"Can it still be zapped"** is `beginZap()` (true on a body already zapping; false for a statue, a corpse,
  a melt, a tear, a body going down) plus the pending-gib check, not `zapPhase() !== 'statue' && zapping()`.
- Refuses under `loopBlocksInput` (dead / done / a sequence) and `ctx.demo.replayActive`; `blur` and
  `pointerlockchange` listeners clear the held button (the rod's); a `dispose()`; a `debug()`.
- The copper is metalness 0.45, not 0.9: no envMap on these props (the rod's note), so 0.9 reads black.

### The arc comes off on every exit

`setArc` is sticky, so `tick` re-derives the arc from scratch each tick and calls `setArc(false)` in every
other case. `tick` runs from `game-tick.ts` beside the melter's cooldown, at the top level of `tick()`: every
tick, whatever the live slot (the only early return above it is `ctx.demo.simLocked`, under which no body
steps either). `game-tesla.test.ts` (stub ctx and bodies, 25 tests) covers: fire released; the seam's
release; the slot starting to lower; another slot live; the aim out of the stick angle; out of range; a wall;
another body on the line to the centre; the body refusing the zap; queued to gib; gone from
`ctx.world.actors`; the loop blocking input; a demo replay; window blur; pointer lock lost; dispose.

`shotAlert` is set every held tick. It is a boolean the encounter director reads and the tick clears once a
tick (`game-tick.ts`), so nothing accumulates.

### The trace (`node scripts/zap-trace.mjs`, the slot 9 scenario; `ZAP_TRACE_TESLA_ONLY=1` runs it alone)

The real slot path: `selectSlot('tesla')` (26 frames to come up), `aimSurface('torso', id)` from 2.6 m,
`fireTesla(true)`. `*` = `tesla().target` is the body.

| | phases |
| --- | --- |
| hold 0.6 s | 0.1 zapped* 0.2 zapped* 0.3 zapped* 0.4 zapped* 0.5 zapped* 0.6 zapped* |
| release, 1.2 s | 0.1 to 0.6 recovering, 0.7 to 1.2 none (glow 0, char 0) |
| (a) fire held, aim turned 34 degrees off | zapped* before; 2 frames after: recovering, no target, still held; 8 frames after: recovering |
| (b) fire held, `selectSlot('shotgun')` | zapped* before; 2 frames after (slot `lowering`): recovering, no target, still held |
| back to slot 9, fire never released | zapped* again |

Pipelines 125 before, 125 after. One thing the first run of the scenario found: a recovered zombie walks up
to the player, and `aimSurface` refuses a body inside its 1.5 m standoff, so the scenario stands the player
2.6 m off before each aim.

### What the frames show

`zap-tesla-01-held.png`: the prop sits low and right of centre, the way the melter's does: a pale grey
barrel pointing up-screen with five rings round it that read bright orange-yellow (blown out in the
flashlight), a grey grip below. It does not clip the camera and does not cover the crosshair or the body.
The blue-white ball on the tip is hidden behind the rings from the eye. Nothing is drawn between the prop and
the body (plan 2). The HUD reads `[9 TESLA (hold to zap)]`. `zap-tesla-04-switched.png` (slot 2 up, the body
recovering at glow 0.1) shows the lit brown skeleton through pale flesh for the length of the fade.

## Fixes after review, second pass

### A zapped split head drew a closed skull

The split materials clip each copy of the skull to its piece at the fragment's world position, and they read
three's `positionWorld`, which on a zapped instance is the x-ray's PULLED place (up to 0.6 m toward the eye).
There the clip's region test fails for both halves: they were discarded whole and the unclipped rest drew an
intact skull inside flesh that was split open; the eye copies on the halves went too.

Every segment material now reads `segmentWorldPosition` (`segment-instance.ts`): the vertex placed by its
instance matrix and its object's world matrix, without the pull, as a varying of its own. `mesh-renderer.ts`
binds its `positionWorld` name to it, so the clip, the wound exposure, the paint's tilt, the plate normal, the
organ surface and the lights all take the bone's true place. No material reads three's `positionWorld` any
more (a test walks every material's graph for it), so the varying count is unchanged; no vertex buffer is
added. With no zap the two are the same point by the same arithmetic.

The trace's split scenario now measures the x-ray skull's footprint: the pixels of a head box (12% x 10% of the
frame, round the crosshair) that are at least 60 of 255 darker with the bones shown than hidden, as an area
and as a width (columns holding three or more). It gates the width at 57 columns and at 1.15x the closed
skull's from the main series. (`ZAP_TRACE_SPLIT_ONLY=1` runs the scenario alone.)

| x-ray skull footprint | width (columns) | area (px) |
| --- | --- | --- |
| split head, WITHOUT the fix | **49** | 950 |
| split head, with the fix | **64 / 67** (two runs) | 1318 / 1604 |
| closed head (main series, same distance and glow) | 48 | 1884 |

Without the fix the split head's footprint is the closed skull's width. The frames: before, one dark oval
between the two flared halves of glowing flesh; after, the skull is in two halves opened in a V along the
split, each inside its half of the flesh, at 2.65 m and at 1.1 m.

### The zap's char bled across a crowd type

Same shape as the glow: the zap's char was written into the view's `burnCfg.z`, the crowd material copies its
source view's `burnCfg`, and the burn block takes `max(burnCfg.z, record)`. The view now has a holding slot,
`zapChar` (not bound to the march, like `bodyLights`); `stepZapLook` writes the char there and
`writeViewRecord` puts `max(burnCfg.z, zapChar)` in the body's own record. `game-burning.ts` writes the burn's
own char again (still preserving `.w`). The burn block is untouched. A body whose `zapLook()` is null has its
holding slot cleared, so char no longer stays on a body after `endTear` resets its zap.

The two-body scenario holds the arc on the source body until it has cooked (char 0.949 when read) and reads
the neighbour's flesh as the 90th-percentile luminance of a wide box round it. (Its chest box is no use: the
neighbour walks toward the player the whole time and the box drifts onto the gun and the room; the chest
number fell 18% with the fix in place and the frame showed a clean pale body. It is still reported.)

| neighbour's flesh (P90 luma) | before | arc on, no char | first body charred | fall |
| --- | --- | --- | --- | --- |
| WITHOUT the fix | 235 | 243 | **145** | **38.3%** (chest box: 204 -> 122, a dark brown body in the frame) |
| with the fix | 235 | 243 | **250** | **-6.4%** |

The gate is a fall under 12%.

### Smaller

- `boneExposedActors` adds a body only while it glows (`zapLook().glow > 0`), not through the statue. The
  trace reads the statue's bones at 2.0 s: 3 instances (the head and its eyes, as any intact body), all at
  iZap 0; the end-of-run read is `[0, 0, 0]` as before.
- Guard tests: `segmentInstance` takes `zapXrayPull` only for geometry with `iZap` (its body run against a
  fake builder); `boneExposedActors` includes a glowing body and excludes the statue and the charred corpse
  (`game-crowd-queries.test.ts`, new); a skull fragment, a dropped segment, a released plate and an ejected
  eye each carry a zero `iZap`.
- Text pin updated: `zombie-gpu-burn.test.ts` pinned `charAmount: u.burnCfg.value.z`; it is now the max with
  `zapChar`.

### The whole trace, last run

Two bodies: glow shift +7.0 on the neighbour (gate 8; it was -3.9 to +5.8 in other runs, so this gate is
close to the walking body's own drift) and +40.3 on the zapped one. Glow: skeleton 16.32 of 255 (noise 4.08);
jolt 18.05 (3.47). Pipelines 126 before, 126 after; slot 9's scenario 125 and 125. No renderer error.

### Boot time (`node scripts/boot-time.mjs`, fresh profile each run, interleaved)

| run | branch `drawOnce` (ms) | `main` `drawOnce` (ms) |
| --- | --- | --- |
| 1 | 957.6 | 944.2 |
| 2 | 1019.8 | 965.9 |

`main` at e8fb57110; the branch now carries Task 6 as well. The branch is 13 and 54 ms over `main` in these
two pairs. Earlier pairs on the same day had `main` between 944 and 1092, so this is inside what one checkout
spreads over, but it is the first time the branch is the slower of both pairs.
