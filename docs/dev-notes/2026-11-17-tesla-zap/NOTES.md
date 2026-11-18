# Tesla arc: the zap state — build notes

2026-11-17. Plan: `docs/superpowers/plans/2026-11-17-tesla-1-zap-state.md`.

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
