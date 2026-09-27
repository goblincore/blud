# Shared light list, Task 10: bodies and crowds lit by their own 4 lights

Plan 1, Task 10 (2026-09-27). With `lightlist` on by default, every SDF body and crowd member is lit
by the 4 lights it picks from the shared list. `?lightlist=0` gives the old key path
(`applyWindowKey` / `presentingLamp`).

![off | on](contact-sheet-off-on.png)

The contact sheet has one row per scene: a body under a third-class tube, a held bolt
(`holdWindowLight(32, -1)`), the flashlight on a crowd member under the next tube, and the dark coat
check (lamps killed, no picks). The left column is `?lightlist=0` and the right is the list. Each
column is a fresh boot with the clocks pinned and the train stopped. `scripts/sdf-game-light-gate.mjs` section 7 renders
it. Set `LIGHT_GATE_SHOT=<dir>` to keep the frames, or `LIGHT_GATE_ONLY_LIST=1` to run that section
alone.

## The first cut blew the bodies out; the calibration fixed it

The list's rgb is physical: colour × three.js intensity × level gain. That is tube spot 16-17.6,
window 32 while held, flashlight 90. The first cut multiplied that by the pick weight and the old
presentation gain (1.3), so keyI came out near 19 under a tube. The old key was about 2. The result
was flat white bodies under a tube, a bolt and the flashlight.

The rgb stays physical because plan 2 feeds the same list to level materials. Two things convert
it to the body key the old path gave:

- **`bodyNorm`**, packed in light v3.z, is 1 / the light's reference intensity (`refIntensity`):
  - For a tube, base × `TUBE_SPOT_GAIN` 7.
  - For a point lamp, its base.
  - For the flashlight, its base of 90.
  - For everything else, 1.

  Per light, `intensity × bodyNorm` is the lamp's live level. That is the old key's level term, so
  flicker and blackouts still ride it. A single per-kind constant could not do this, because lamp
  bases differ (a 4.9 tube in the tender).
- **Each profile's GPU `gain`** (lane a.x) is the old path's conversion. Its derivation is written
  next to the number in `light-profiles.ts`, and the old constants are pinned equal to their homes
  by `game-light-list-leaves.test.ts`.

`bodyLights` (WGSL) and `shadeBodyLights` (CPU twin) compute `c = rgb × weight × gain × bodyNorm`.
The WGSL change is one line; the march golden moved on purpose, and only `__HELPERS_joined`
changed.

| profile | gain | derivation |
|---|---|---|
| tube | 3.276 | lightCfg.x 2.4 × BODY_LAMP_GAIN 1.5 × PRESENT.gain 1.3 × LAMP_LIST_TRIM 0.7, bodyNorm 1/(base × 7) |
| lamp | 2.772 | 2.4 × 1.5 × 1.1 (the lamp's own presentation gain) × 0.7 (tube-measured trim; no warm lamp measured), bodyNorm 1/base |
| window | 0.1092 | 2.4 × BODY_WINDOW_GAIN 0.035 × WINDOW_LIST_TRIM 1.3, on the raw intensity (bodyNorm 1) |
| flashlight | 11.2 | beam gain (spotCfg2.x) 4 × FLASHLIGHT_LIST_TRIM 2.8, bodyNorm 1/90 |
| muzzle | 0.0387 | bodyFlashGain 0.06: old I·0.06/d², list I·g/(1+0.2d²), equal at 1.5 m (not measured) |
| fire | 0.0327 | the same, with fire's distFall 0.1 (not measured) |

**The trims are measured, not derived.** The old key was one lamp. The list adds up to three more
lights, each light's backRim, the wrap floor and the highlight shoulder. The shoulder compresses, so
the mean moves slowly with gain. Body-box mean against today's at the gate pose, by trim:

- **Tube:**
  - 0.45 gives 0.90×.
  - 0.6 gives 0.99×, with the std 4% under today's.
  - 0.7 gives 1.01-1.04×, with the std at or above today's.
- **Flashlight** (the old beam replaced the key direction with a frontal lambert; the list's
  flashlight is one wrapped light of four):
  - 2.4 gives 0.99×.
  - 2.8 gives 1.00×.
- **Window** (held bolt):
  - 1.0 gives 0.96×.
  - 1.3 gives 0.99×.

This is a baseline that reproduces today's brightness. The owner tunes the look from here.

## A/B, body box (0.38-0.62 × 0.2-0.8 of the frame), final constants, full gate run

| scene | on mean / std / near-black | off mean / std / near-black | on/off mean |
|---|---|---|---|
| tube | 0.350 / 0.306 / 0.8% | 0.337 / 0.296 / 0.8% | 1.04× |
| bolt | 0.376 / 0.335 / 0.0% | 0.381 / 0.345 / 0.0% | 0.99× |
| flashlight | 0.595 / 0.356 / 1.8% | 0.596 / 0.366 / 2.0% | 1.00× |
| dark coat check (no picks) | 0.051 / 0.052 / 60.0% | 0.053 / 0.057 / 58.6% | — |

The std is at or above today's under a tube. It is 2.6-2.9% under today's for the bolt and the
flashlight, which is within run-to-run noise (about 0.01).

**The gate** requires the tube, bolt and flashlight means to be within 0.9×..1.2× of
`?lightlist=0`. It also requires the near-black share to be ≤ 15% in those three scenes, and the
dark scene to stay within today's value + 5 points.

**Determinism.** Each boot pins the scene before the A/B:

- The train is stopped (`setTrainSpeed(0)`), so the tubes hang still. The old key's direction
  follows the tube's swing: frozen mid-swing with the tube behind the body, today's tube mean fell
  to 0.16 against 0.34 at rest. The list stayed at about 0.24-0.35 there, which is the point of
  the list.
- The A/B body stands 0.6 m past its tube as the camera sees it, so the pool presents its front.
- The coat check's `die` script is stepped to its end, so the dark scene has no picks. The gate
  checks this.
- The flicker clock is pinned only when the third-class tubes are at full level.
- The clock is re-pinned after the torch ramps on.

## How the list looks against today (by eye)

At this pose today's path is itself a bright, pale body, and the list now matches it.

- **Tube.** Close to today. The list is a little smoother, with a soft sheen on the shoulders and
  chest. The limbs, chest and head still read as modelled. It is not flat and not black.
- **Bolt.** Close to today. The list is slightly softer, and the cold rim reads on the edges.
- **Flashlight.** Both are very pale on the torso. The list keeps a little more pink relief there
  and lights the face, where today leaves the face and scalp darker. The crowd member behind is lit
  differently from the one in front: each has its own picks.
- **Dark coat check.** Essentially identical: a dark body carried by the blue fresnel rim and the
  red eyes. There is no flat black. There is no visible (0,1,0) highlight from the empty slot 0.
- **No NaN speckles** in any frame.

**For the owner.** "Match today" means matching today's pale look at a front-lit pose. The first
uncalibrated cut was flat white, and that is gone.

## Deviations from the task text (approved by the coordinator)

- **`applyRoomFill` is kept in list mode.** It is the fill, not the key. It makes blackouts go
  dark, and BODY_DARK_FLOOR is the floor for bodies no light picks.
- **`applyStormBodyKey` is kept at spawn.** It sets keyColor to COLD_FILL on storm levels, and the
  watch items say to keep keyColor as the fill colour. `releaseWindowKey` hands back a key that the
  old path steered, for the live `setLightList` switch.

## Watch items (Task 9 review)

- **keyColor stays the fill colour.** It is COLD_FILL on Night Train and is never steered in list
  mode.
- **`lightListCfg.x = 1`** is set on every crowd type's uniforms and on single views. It is not set
  on chunks or hands (Task 12).
- **`spotCfg2.w` and `bodyFlash.w` are 0** in list mode. `spotCfg` and `levelShadowCfg` are left
  alone (shader-gated).
- **Never black in a dark corridor.** The body box is 60.5% near-black with no picks, against
  57.3% today. The rim and the room fill (BODY_DARK_FLOOR) carry it, the same as today.
- **Flat-lit face against the body in a dark carriage.** The face is no brighter or flatter than the
  body there. Lit, the face reads better than today under the flashlight.
- **Shine and fresnel on a dim dominant.** keyC is normalised to peak 1, so the wet shine and the
  fresnel do not dim with the key. This is the likely source of the smoother sheen under a tube. It
  is a look item for the owner.

## Cost (indicative only: the machine was loaded, load average 10-70)

Rounds interleave on and off via `__sdfGame.setLightList`, with 8 rounds of `timeDraws(9)` and the
`passTimings` march passes. There were two runs, minutes apart:

| scene | run 1 frame off→on | run 1 march GPU off→on | run 2 frame | run 2 march GPU |
|---|---|---|---|---|
| third class, refine off | 31.8 → 34.0 | 7.30 → 10.70 | 32.0 → 31.7 | 6.06 → 6.65 |
| Boiler Room, refine off | 34.2 → 35.3 | 14.81 → 12.60 (inverted) | 27.0 → 28.0 | 10.57 → 12.18 |
| third class, `?refine=1` | 63.0 → 64.1 | 8.69 → 8.86 | 50.4 → 50.6 | 7.65 → 8.20 |
| Boiler Room, `?refine=1` | 67.2 → 68.9 | 14.72 → 12.24 (inverted) | 55.6 → 55.3 | 11.11 → 12.97 |

Run 1 disagrees with itself: +3.4 ms in third class, and inverted in the Boiler Room. Run 2 is
steadier: march GPU +0.6 ms in third class and **+1.6 / +1.9 ms in the Boiler Room**. That is over
the 1.5 ms flag, but the Boiler Room strobes and the machine was busy. Task 13 needs the real
measurement on a quiet machine.

`?refine=1` puts the game on the per-body path (the crowd path falls back), so its rows measure the
refine twin's list loop at output resolution.

## Task 10 review fixes

**Ranking is on delivered light.** `lightRank` (and the pick) now rank on presence × lum(rgb) ×
profile gain × bodyNorm, the same scalar the shader multiplies rgb by. Before this, rgb was
physical, and gain × bodyNorm varies about 6× by kind (lit tube ≈0.19, flashlight 0.124, window
0.109, muzzle 0.039, fire 0.033). So a 35-intensity muzzle flash 1.5 m from a body under a lit tube
outranked the tube and took slot 0 (the dominant: scatter, the wound shadow, the shine). A
light-pick test pins this case. The packed weight is still absolute presence. `RANK_FLOOR` (1e-4)
now applies to the delivered scale.

**Fire-mood lamps are not normalised twice.** The fire profile's gain converts raw intensity
(bodyNorm 1), and burning-body flashes use it the same way. `collectLightSources` and the reader
no longer set a reference intensity for fire-mood lamps.

**Pinned mirrors.** `OLD_BEAM_GAIN` and `OLD_BODY_FLASH_GAIN` are test-pinned to
`makeVfxState().beamTuning.gain` and `makeLightingState().bodyFlashGain`. The lamp's 1.1 is now
`LAMP_PRESENT_GAIN`. The plan chose it and nobody has measured it; a warm bulb keys about 15% under
the old path's 1.3.

**Allocation-free pick path.** `pickBodyFor` takes an `out`, and the actor loop reuses one scratch
body. `pickLights` keeps its rank and presence scratch at module level, and it packs the presence
from the ranking pass instead of recomputing it. A spot's cover-zero cosine is computed once per
light in `buildLightList` (`ListLight.coverZero`, CPU-only). List mode skips the bodyFlash
best-flash scan, since that slot is zeroed anyway. Everything else behaves the same.

**`a.room` keeps `||`.** In `game-actor.ts`, `roomAt(pos) || opts.room` stays as it is. Room id 0
is never valid: `level-json.ts` rejects ids below 1, and the three levels use 1..8. Navigation's
`roomAt` returns 0 to mean "in no room or tunnel". `||` falls back to the spawn room there. `??`
would keep 0, and a room-0 body would then match no room-masked light.

**The gate's dark scene is checked.** The framed actor must be in room 6 and within 2 m of the
target (both boots).

### Gate after the fixes (loaded machine, load average 27-95)

```
shared list: 15 lights in third class; crowd actors 27/28 (room 1, 8.2 m apart) dominants 0 (w 0.901) / 1 (w 0.497); 26/30 bodies picked
tube       on  mean 0.349 std 0.306 dark 0.9% | off mean 0.331 std 0.290 dark 0.9%
bolt       on  mean 0.375 std 0.335 dark 0.0% | off mean 0.373 std 0.336 dark 0.0%
flashlight on  mean 0.595 std 0.357 dark 1.8% | off mean 0.593 std 0.364 dark 2.0%
dark       on  mean 0.051 std 0.053 dark 60.3% | off mean 0.054 std 0.056 dark 57.9%
shared list look: on/off mean tube 1.05x bolt 1.00x flashlight 1.00x
PASS sdf-game-light-gate (wall 404 s)
```

The ratios are unchanged within noise (they were 1.04 / 0.99 / 1.00). The first run failed in section
4 ("the glass did not flash: 0.2719 -> 0.3839"). That section comes before any list code, and the
bolt flickers. The rerun passed.

### Known gaps (for the owner)

- **Muzzle and fire gains are derived only, never measured.** The old flash curve (I × 0.06 / d²)
  and the list's (I × gain / (1 + distFall d²)) cross at 1.5 m. The list is about 3× brighter than
  the old flash at 3 m and dimmer inside 1 m.
- **The live tuning seams stop reaching bodies in list mode.** `setBodyFlash` / `bodyFlashGain` and
  `beamTuning` no longer affect list-lit bodies. The profile gains bake in their defaults.
- **BODY_DARK_FLOOR** still leaves about 60% of a body with no picks near-black (the dark coat
  check: 60.3% against 57.9% today), the same as today.
- **Non-storm levels keep the preset's warm keyColor as fill in list mode.** Only storm levels set
  it to COLD_FILL at spawn. This needs a look on a non-storm level.
- **Boiler Room cost.** +1.6 to 1.9 ms march GPU, measured on a loaded machine (see Cost). Deferred
  to Task 13.

### Cold boot, bodyLights WGSL (scripts/boot-time.mjs, fresh profile each run)

The runs alternate head and base. Head is this commit (bodyLights WGSL from 6540bd05). Base is
17b7ffe4 (before it), in a temporary worktree. The machine was loaded.

```
HEAD run 1: {"drawOnce":3364.5,"warmMs":4825}
BASE run 1: {"drawOnce":3992.3,"warmMs":68570}
HEAD run 2: {"drawOnce":3710.5,"warmMs":5471}
BASE run 2: {"drawOnce":3727.3,"warmMs":5451}
```

drawOnce is within run-to-run noise: head 3.36 / 3.71 s against base 3.99 / 3.73 s. No cold-boot
regression shows. Base run 1's 68.6 s warmMs is an outlier from the fresh worktree's first Vite
dependency pre-bundle. Its second run is 5.45 s, level with head.

## Task 11: bones read the same lights

- **How owner picks reach an instance.** Tubes: each `update` source carries `lights` (the owner
  view's `bodyLights` Vector4, by reference); rows remember it, and `syncLights()` copies it into
  the row's iLights (floats 18..21, `INSTANCE_FLOATS` 22). Bone meshes: `push` records the owner
  per batch instance; `syncLights(ownerBodyLights)` copies each owner's `bodyLights` into the
  batch geometry's iLights `InstancedBufferAttribute` (grown with the batch). The copy runs in
  game-main after the actor light loop, because both renderers' `update` runs earlier in the
  frame (a direct write there would lag the flash by one frame).
- **No owner = -2.** Chunk bones and ejected eyes (their own geometry) pack -2 and keep the old
  key even in list mode, so the old key is still steered (`applyWindowKey`) on both uniform sets.
  `?lightlist=0` sets `lightListCfg.x = 0`: exactly the old path.
- **Compose.** Only the key changes: `albedo * (ambient + bl.diffuse) * ao + wetTint * (bl.spec *
  look.z * mix(1.3, 0.7, expo) + rimC * fres * (0.5 + 0.5 * peak)) + bl.rim`, `rimC` the dominant's
  colour (the key colour when nothing is picked), as the march's fresnel does. The plan's
  `diffuse * deepColor` read as albedo, the march's compose.
- **Gate.** Coat check (no picks), `hitMeshSkull` crater, `muzzleFlash()` held at dt 0: all 18
  bone-mesh instances pick the muzzle light; crater crop 0.091 -> 0.550 (list) against 0.092 ->
  0.683 (`?lightlist=0`). The list skull is modelled by the muzzle (sockets shaded) and a little
  darker than its blown-out flesh; the old one is flatter and pinker. With no flash both paths show
  the same pale skull in a near-black body (bone ambient is seeded once from the spawn fill).
- **Draws.** Unchanged by construction: an attribute on existing meshes, no new mesh or material.
- **Cold boot** (loaded machine, alternating): head drawOnce 1608 / 1903 / 3539 / 2239 / 3028 ms,
  base 1400 / 1655 / 2147 / 2432 / 3973 ms; medians 2239 vs 2147, inside the noise.

## Task 11b: bone fill follows the owner's room

- **The bug (review I1).** Bone `ambient` is a uniform seeded once at spawn, while the body's fill
  is rescaled every frame by `applyRoomFill`. In a dead carriage the skull glowed pale inside a
  near-black body.
- **Fix, list mode only.** `roomFillFactor(ctx, x, z)` returns the factor `applyRoomFill` uses:
  `fillFactorOf(roomLight)`, which is `BODY_DARK_FLOOR + (1 - floor) * lit` (pure, unit-tested).
  `applyRoomFill` now calls it, so its behaviour is unchanged. game-main writes each actor's factor,
  taken at its root, into a WeakMap during the actor light loop. `syncLights(..., ownerFill)`
  copies it into iFill. For tubes that is float 22 (`INSTANCE_FLOATS` 23; the `probe-dynamic`
  mirror follows, and the test now uses the imported constant). For bone meshes it is a 1-float
  `InstancedBufferAttribute` per batch, eyes included, grown alongside iLights. Instances with no
  owner get 1. `boneShade`'s list branch uses `ambient * fill`, and the old branch is untouched,
  so `?lightlist=0` is exact.
- **Minors.** `ownerBodyLights` reads `?.view?.` (M1). M3: in r186, three uploads a
  `DynamicDrawUsage` attribute every frame, and without update ranges it uploads the whole buffer.
  The WebGPU backend honours `updateRanges` on both `InstancedBufferAttribute` and
  `InstancedInterleavedBuffer` (element units, cleared after each write). The tube buffer and the
  mesh iLights/iFill now set `[0, live * itemSize)`.
- **Gate.** Coat check, no flash, list on. Every bone instance carries fill 0.250. The regions are
  centred on the projected head bound, because the crater box sits off the skull's centre: a skull
  disc (0.7 x the projected half-width) and a hood ring (1.25..1.6). Skull/flesh reads 0.070 /
  0.059 = 1.18x; the bound is 1.5x. With the fill forced to 1 (the pre-fix look) it read 0.118 /
  0.069 = 1.73x. `?lightlist=0` reads 0.116 / 0.064 = 1.81x (the old path, left alone on purpose).
  The flash check still passes: crater 0.062 -> 0.539 (8.7x; it was 0.091 -> 0.550, and the
  darker start is the fix).

## Task 12: gib chunks pick their lights

![gibs, off | on: tube (top), tube + flashlight (bottom)](gibs-off-on.png)

Left column `?lightlist=0`, right the list; each a fresh boot, clocks pinned, the train stopped, a
zombie blown up (`__sdfGame.detonate`, gibs and all) under the z -4 third-class tube. The piles
differ boot to boot (the pieces fly on the hand-stepped clock), so the gate judges the gib pixels
only (the ones that change when `setChunksVisible(false)` hides the pieces in the same frame).

- **Baked gibs (one pick per MATERIAL).** A `litChunkMaterials` entry's uniforms are shared by
  every mesh drawn with it, so each entry picks once, at the **centroid of its visible pieces**.
  **Deviation from spec §4** ("pick at the chunk's own position"). `gatherChunkCentroids`
  (game-bake-leaves) keys the pieces by drawn material: settled bakes (`centre`), soldier corpses
  (they share `ctx.bake.mat`; geometry bounding-sphere centre), sprite-set pieces drawn as meshes
  (carved, asset, asset-head materials; `state.pos`), the gore showcase. Room: `roomIdAt` at the
  centroid (-1 in a tunnel matches every light); facing `[0, 1]` (not neutral: a light on the -z
  side takes its profile's backKey falloff). An entry with pieces is list-lit whatever it picks
  (like an actor: no picks = fill + fresnel on keyColor, never body 0's global key); with none it
  stays on the old path. Pure part: `chunk-light-pick.ts` (tested).
- **Ambient, list mode.** Today's per-frame chunk ambient is `fill x key + bounce` with body 0's
  `lightCfg.y`, which carries body 0's room factor. List mode re-bases the fill on the pieces' room
  (`fill / f(body 0) x f(centroid)`, the Task 11b bone rule); the bounce is left as today.
- **Shader** (`chunkShade`, both face variants): `picks`, `lights`, `listOn`, `listGain` after
  `fresnelGain`. List on: the key is `bodyLights(p, nrm, V, picks, lights, false)`, compose as the
  bones' (ambient, baked AO, wet tint, fresnel on the dominant's colour), the face's flat term
  takes `0.30 x domC`, and the soft shoulder runs whenever the list is on, as the march's does.
  Uniforms `chunkLights` (-1s) and `lightListCfg` (0s). `?lightlist=0` writes x = 0: the old path.
- **CHUNK_LIST_GAIN 0.4 (measured; `__sdfGame.setChunkListGain`).** At the list's full level
  (calibrated on the march, whose soft shoulder flattens a big key) a baked gib face-up under the
  tube read 0.44 and in the beam 0.69 with 19.8% of its pixels over 0.95. Anchor: the MARCHED gib
  under the list (`GIB_RENDER=march`), 0.316 tube / 0.482 torch. Sweep (baked): 0.3 0.255 / 0.485,
  0.5 0.324 / 0.578. 0.4 splits the tube match (0.5) and the torch match (0.3).
- **Marched chunk views (per view).** Each owns a record slot, so it picks at its own position like
  an actor (`applyBodyLights`, room at the view, facing [0, 1]), `bodyFlash.w = 0`, no
  `applyWindowKey`; new `ChunkGpuView.syncRecord()` re-writes the record after the pick (update()
  wrote it earlier in the frame). Chunk views are list-lit whatever they pick, like actors (the
  coordinator's draft said "x = 0 without picks"; consistency with actors won). The shared chunk
  march material now binds the real list node (`createSharedChunkGpuMaterial(prev, opts, list)`).
- **The ratio band was dropped.** The plan asked for on/off within ~0.8-1.25x. `?lightlist=0`
  lights gibs by body 0's key (a direction and colour from wherever body 0 stands), and its beam
  path barely reaches a gib either, so the old pile is near-black under a lit tube: measured
  on/off 1.64-1.81x under the tube, 2.1-3.3x in the beam (marched views: 2.47x). Matching the band
  would mean matching the global key. Section 9 of the light gate judges instead: list >= the old
  key, <= 10% near-black, <= 2% blown under the tube, <= 10% blown in the beam (the marched anchor
  itself reads 11.5%), every drawn gib material / view list-lit with a third-class tube picked.

### Gate (full run, `LIGHT_GATE_SHOT` kept the frames)

```
     gibs       on  mean 0.259 (7.0% of frame, 14 sprite pieces) dark 0.1% blown 0.0% | off mean 0.158 (5.0% of frame, 14 sprite pieces) dark 4.7% blown 0.0%
     gibs+torch on  mean 0.569 dark 0.0% blown 5.3% | off mean 0.175 dark 3.0% blown 0.0%
ok   gibs lit by the tube: on/off gib mean tube 1.64x torch 3.26x; 2 list-lit gib material(s), 0 chunk view(s); material picks [[0.583,-1,-1,-1],[0.289,-1,-1,-1]]
ok   shared list look: on/off mean tube 1.07x bolt 1.01x flashlight 1.00x; near-black tube 0.8% bolt 0.0% flashlight 1.8% dark-corridor 59.4%
PASS sdf-game-light-gate (wall 64 s)
```

`LIGHT_GATE_ONLY_GIBS=1` runs section 9 alone (about 25 s). `GIB_RENDER=march`: views 1, 2, 4, 5...
all list-lit, the tube (index 0) picked at 0.20-0.32 around the pool, plus the one settled bake.

### By eye

Off: the pile under the tube is near-black grey, and the beam hardly lifts it. On: the pieces read
fleshy (pink with dark mottling) in the tube's pool, with a cool rim from the tube's colour on the
fresnel and its back rim; in the beam they go pink-white with wet highlights, not flat white.

### Cold boot (scripts/boot-time.mjs, fresh profile, alternating)

```
HEAD run 1: {"drawOnce":1505.1,"warmMs":2090}
BASE run 1: {"drawOnce":1698.6,"warmMs":2456}
HEAD run 2: {"drawOnce":1710.4,"warmMs":2327}
BASE run 2: {"drawOnce":1641.7,"warmMs":2302}
```

Within noise. The boot warms the marched chunk view (same WGSL; only the bound list node changed);
the baked-chunk shader compiles on the first gib, which this number does not cover.

### Known gaps

- A chunk view's BONES reach the tube instancer with no owner (game-main, `posedBones()` sources
  carry no `lights`: -2), so they keep the old key even in list mode.
- One pick per material: a pile spread across two pools takes the centroid's lights.
- Facing [0, 1] biases the pick against lights on the -z side (backKey).
