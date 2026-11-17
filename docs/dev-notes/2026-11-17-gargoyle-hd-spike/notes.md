# Gargoyle HD spike: how far can an SDF character go with 1–2 enemies on screen?

**Date:** 2026-11-17 · **Branch:** `claude/sdf-gargoyle-hd` · **Status:** offline proof done, engine integration not started

## Question

If the game only ever shows one or two enemies at a time, how close can an SDF body get
to a detailed sculpt, while keeping the blended-primitive body the damage model depends on?
Reference: a Meshy "upscale and enhance" gargoyle. It is the same creature as
`docs/dev-notes/refs/gargoyle-mesh/gargoyle.glb` (identical bounding box), at 83k vertices,
unrigged, with one material and a far more detailed surface.

## What was built (all offline, `scripts/gargoyle-hd/`)

| script | does |
| --- | --- |
| `sample_sdf.py` | mesh to ~1.45M signed-distance samples in the engine frame (feet at y 0, x1.103, the `gargoyle.blob` convention). The mesh is not watertight, so signs come from libigl's winding-number-based `signed_distance` |
| `fit.py` | fits N primitives with **the engine's own** round cone and **sequential quadratic smin** (`smin`: k = 4·kIn, kIn = blend·0.5). Initial spheres come from the medial axis of a 6 mm SDF grid, then densification adds primitives where the error is worst, then unused ones are pruned. Uses the 24 nearest primitives per sample, kept in fold order. Torch on MPS, about 10 it/s, roughly independent of N |
| `residual.py` | approach C: `final = prims + clamp(mesh_sdf − prim_sdf)`, with the residual on a coarse narrow-band grid (6 mm, ±40 mm band) |
| `sheets.py` | finds thin, flat SHEET regions (wing membrane, ears) as opposed to rods (fingers, claws), for a triangle-slab primitive |
| `mesh_fit.py`, `render_ply.py`, `sheet.py` | marching cubes of a fitted field, plus Blender clay renders from fixed views beside the reference |

## Findings

1. **Primitives alone, 256 (a quick 200-iteration run):** pose, wing fingers, tail spines, claws and
   horns all come through, already well beyond the hand-authored 59-primitive `gargoyle.blob`.
   Mean surface error 5.7 mm, p90 13.5 mm. It still reads as crude next to the mesh
   (`sheet-smoke.png`). The **wing membrane turns into a fence of needles**: capsules cannot make a sheet.
2. **The membrane is 16–46 mm thick** (median 24 mm at engine scale), not paper-thin. About 77% of the
   sheet-like surface is wing, so a triangle-slab primitive (three points plus a thickness) is the missing shape.
3. **Primitives plus a 6 mm baked residual are almost indistinguishable from the mesh** (`sheet-res.png`, bottom row),
   even on top of the crude 256-primitive fit. The residual is cheap: a ±40 mm band holds about 2.3M voxels at 6 mm,
   and a ±12 mm band would be about 0.7M (≈0.7 MB at 8 bits).
4. **The clamp on the residual is the risk dial** (`sheet-clamp.png`). At ±15 mm it still looks like the mesh.
   At ±8 mm the body holds but the wings break, because the primitives under them are poor. Better primitives
   (a bigger budget, triangle slabs) mean a smaller residual. A smaller residual means less rigid baked data
   to go wrong when a joint bends or a wound opens. That is the August failure
   (`X1.humanoid-sever-spike`, where whole baked bricks were the body); here the bake is only a thin offset
   on a primitive body that still bends.

## Engine notes for integration (not done yet)

- `MAX_CLUSTER_PRIMS = 64` looks partly stale: a cluster folds **groups** (up to 64 per cluster, loop in
  `map-body.wgsl.ts`), and each group folds up to 64 primitives (`foldGroup`). `boundGroups` (`pack.ts`)
  splits groups by radius only (`GROUP_RADIUS_MAX` 0.16 m), with **no cap on primitives per group**, so dense
  small primitives could silently truncate at 64 per group. Cap groups at about 32 before raising the limits.
- `MAX_PRIMS` (256) sizes the data texture width and `MAX_GROUPS`. Raising it widens the per-type crowd atlas,
  which is acceptable with one or two enemies.
- Fitted primitives should be emitted in a spatially coherent order inside each limb, so the greedy groups stay tight.
- Residual sampling should hook into `mapBody` after the primitive fold and before carves and wounds: `d += residual(restPoint(p)) * fade`.
  - `restPoint` (`fields/carves.wgsl.ts`) already maps a world point back to rest pose through the dominant
    primitive. That makes the residual ride the bone that owns that patch of skin.
  - Fade the residual out inside the wound mask, so craters bulge and tear exactly as they do now.
  - Fade it out in the joint smin band.
  - `volumeTex` (the X1.26 hand-volume binding) is already bound to every body view and could carry the
    residual atlas for a first test.
- The upper-bound and Lipschitz culls assume the primitive field. A residual of ±r needs that much slack in the
  cull margins, or the culls must be off for this body.

## Next steps

1. A skeleton in the mesh's pose, plus a limb label per primitive (nearest bone).
2. The triangle-slab primitive in the fitter, then the full budget sweep (512 / 1024 / 2048) with residual magnitude per budget.
3. Engine: raise the limits behind a per-body opt-in, add the residual texture, fade it with wounds, then render in the lab and the arena.
4. Judge damage and animation in game, especially joints and craters.

## Update 2026-11-17 (later): in engine

**Status:** renders in the WebGPU lab with the residual, takes wounds, holds walk and run poses. The game (`sdf-game.html?spawn=gargoyle-hd`) has not been seen booting yet: the probe ran while the machine was under heavy load and was stopped.

### Budget sweep (fit.py, primitives only)

| prims | mean surface error | p90 | p99 |
| ---: | ---: | ---: | ---: |
| 256 | 5.7 mm | 13.5 mm | 38.0 mm |
| 512 | 2.4 mm | 5.6 mm | 11.9 mm |
| 1024 | 1.3 mm | 3.1 mm | 6.9 mm |

At 1024, 99% of the surface already lies within ±7 mm, so a ±8 mm residual covers almost everything. That is the setting where the residual is smallest and should be least fragile under deformation.
The fits are in `assets-source/gargoyle-hd/prims-*.npz`. The in-engine body currently uses **256** (the first rung).

### What changed in the engine (all uncommitted on `claude/sdf-gargoyle-hd`)

- **`.blob` grammar:** bones take `vec=(x,y,z)` (an explicit direction, replacing dir/pitch/tilt) and `off=(x,y,z)` (a head offset from the parent's tail).
  Inside a mirror block they also take `vecR=`/`offR=`, so a generated skeleton can follow an ASYMMETRIC pose.
  Files: `types.ts` BoneDef `offset`/`dirR`/`offsetR`, `mirror.ts`, `resolve.ts`, `body-scale.ts`, `blob-ast.ts`, `blob-parse.ts`, `blob-compile.ts`.
- **Limits:** `MAX_PRIMS` 256 to 1024. Groups are capped at `MAX_GROUP_PRIMS` 32 (`pack.ts` boundGroups, plus the gib-chunk singleGroup path split into runs).
  A cluster may hold up to `MAX_CLUSTER_GROUPS` 256 groups: the map-body/normal-gradient `gi` loops are now templated, and pack throws past that.
  The WebGL lab keeps 256 (`march.glsl.ts`).
  **This changes WGSL text**, so `march-golden` snapshots will need re-pinning.
- **Residual:** `webgpu/residual-volume.ts` loads an r8 3D texture.
  - `sampleResidual` in `fields/volume.wgsl.ts` reads it, and `mapBody` adds it after the prim fold, before carves and wounds, sampled at `restPoint(p, dominant prim)`.
  - Selected by `volumePose0.w == 2`. The hand-volume branch is now `0.5 < w < 1.5`.
  - Lab hero: `character-view.ts`. Game crowd types: `CrowdMaterialSources.volumeTex` via `game-crowd-types.ts`.
- **Character:** `characters/gargoyle-hd.blob` is GENERATED by `scripts/gargoyle-hd/emit_blob.py` (skeleton joints, limb and wing region rules, spatially ordered prims, core prims).
  The residual is baked by `scripts/gargoyle-hd/bake-residual.ts` against the engine's own CPU `sdBody`.
  Its manifest is `characters/gargoyle-hd-residual.json`; its data is `public/assets/lab/gargoyle-hd-residual.bin` (35 MB, dense, 6 mm).

### Observed

- `ingame-residual-256.png`: wing membranes, ribs and muscle all present through the stock marcher.
- `ingame-wounds.png`: 12 pellet and 3 blast wounds land, and the craters cut into the detailed surface with the normal interiors.
- `ingame-walk.png`: the walk pose shows no visible tearing at turntable range. Not yet inspected close up at the joints.

### Open

1. Boot the game with `?spawn=gargoyle-hd` and capture it (`CHARACTER=gargoyle-hd node scripts/bride-game-frames.mjs`), and measure frame cost against `gargoyle`.
2. Move to the 1024 fit with a ±8 mm residual.
3. Store the residual as sparse bricks (the band is ~6% of the dense grid; ~1–2 MB instead of 35 MB).
4. Close-up joint check in walk and run poses; fade the residual where the dominant prim's bone changes, if seams show.
5. Re-pin the goldens, then run typecheck and `test:changed`.
6. The triangle-slab primitive for membranes, now less urgent because the residual covers the wings.

## Update 2026-11-17 (evening): in the GAME

`sdf-game.html?spawn=gargoyle-hd` boots, and 15 gargoyle-hd actors spawn in place of the zombies. They draw through the crowd path with the residual on (`ingame-game-room2.png`).

Two fixes were needed:

1. **"zombie N: no motion joints".** `bindRig` makes a rig point for every bone end, but `gait.ts` `jointNamesForBody` names only the humanoid set, so any extra bone (a tail or wing chain) fails `makeMotionJoints`.
   **The stock `gargoyle` fails in the game the same way** (and the dragon, per memory). This predates the spike.
   For gargoyle-hd, the emitter now hangs the tail on the pelvis and the folded wings on the chest, with no bones of their own.
   The real fix belongs in `makeMotionJoints`: let unnamed rig points ride their parent.
2. **The residual read 0 in the game.** Game bodies are built at the spawn point (`translateBody`), so `restPoint` returns rest positions offset by the spawn location.
   The view now stores the spawn origin in `volumePose0.xyz` (per instance, so it carries into crowds), and the shader subtracts it before sampling.

**Frame time:** the HUD's frame EMA reads the same for spawn=zombie and spawn=gargoyle-hd at all 8 camera stops, ±0–4 ms with 3–9 bodies on screen (`hud-zombie-vs-hd.png`).
That is NOT a GPU cost measurement: frozen, headless and EMA-smoothed, it says only that nothing blew up.
A paired, interleaved march-cost A/B (the 2026-09-11 piece-cost note's method) is still owed.

## Update 2026-11-17 (arena, 512 fit)

The owner saw the 512 body broken in the arena: lumpy, with missing legs and a floating wing. The cause was not the residual: `?residual=0` (new switch) looked the same.

**The world shell hull's 4096-sphere cap.** `buildOuterHullInstances` chains spheres along every prim, and thin fitted prims chain densely: the 512 body needs **4947** spheres (256 body 2826, gargoyle 315, zombie 101). `createOuterHull()` silently truncated past 4096, so those prims were never marched.
Now `createOuterHull(16384)` in game-main, and overflow logs a warning once. The lab has no shell pass, which is why it never showed there.

Also changed, as precautions that turned out not to be the cause:
- Bodies over 256 prims skip the crowd batch and draw per-body (game-spawn.ts). The crowd's per-tile list holds 64 groups and the 512 body has 250.
- The residual's rest point undoes the body yaw first (`restPointYaw`, carves.wgsl.ts): a twist about an upright prim's axis is invisible to the swing-only `restPoint`. The arena actor spawns at yaw ~0, so this path is **not yet exercised** with a turned body.

Sphere count is now a real budget for fitted bodies: ~10 spheres per prim here. Fewer, fatter prims, or a coarser chain for thin prims, would cut it.

## Update 2026-11-17 (night): close-up glitches fixed, symmetric posable redo

### The two residual glitches (owner: "weird artefacting of texture and clipping up close")

1. **Seams along every capsule once the body moved** (`glitch-seams-before.png` vs `glitch-seams-after.png`). `restPoint` recovers each capsule's SWING only, so two capsules on one rigid bone mapped the same skin point to different rest points; the residual tore wherever the dominant prim flipped. Exact at rest, which is why turntables never showed it.
   Fix: gargoyle-hd prims are `rigid` (ride their declared bone whole), applyRig stamps the bone's rest->posed rotation as `Primitive.skinQuat`, packed in the new **`ROW_PRIM_FRAME` = 26** (`DATA_ROWS` 27, `WG_ROW0` 27), and `restPointSkin` (carves.wgsl.ts) inverts it exactly.
   The rigid-head pass and the head-membership rule had to agree: a `rigid` prim declared on a non-skull bone no longer rides the head (rig-bind.ts `ridesHead`). That was a 12 cm disagreement on the neck.
   `.lab-tmp/check-skin.ts` poses the body and checks every bone's prims agree (now 0.00 mm).
2. **Stripes on the wing membrane.** 16-bit storage did not change them: a baked difference (mesh - prims) on a 6 mm grid cannot cancel prim creases finer than the grid (the wing's fence of needle capsules).
   Fix: the volume now stores the **mesh SDF itself** (half float, / band; manifest `format: 'mesh'`), and `sampleResidual` takes `clamp(mesh - livePrims, ±clamp)` live, faded at the band edge.

### The redo: symmetric, posable rest pose (owner: "needs a do over so it's symmetrical and posable")

Done in SDF space, no mesh rigging:
- `repose.py`: rigid per-bone moves (FK in `skel.py`) applied to the reference's distance field. Each bone claims its own region plus 2.5 cm of slack so joints overlap rather than crack. Then a fold about x = 0.12 that keeps the +x half (hanging arm, planted leg, folded wing).
  - `fit_planes.py`: the torso and the head each get their own symmetry plane (mismatch 16.8 -> 3.9 mm and 69 -> 5.7 mm; the head sat turned 12.6 deg and rolled 8.8 deg on the neck).
  - The spine is straightened sideways. The tail chain was traced through the interior voxels, then swung onto the midline. The thighs splay 7 deg so the feet clear their mirror. The rest pose is re-grounded.
  - Cleanup on the grid: 26 floating fragments dropped, sealed voids filled, grey closing for pinholes, gaussian 0.6 voxel.
- `fit.py --mirror 0.12`: half the prims free, each evaluated with its mirror copy. **499 per side (998 + 2 eyes)**: mean 1.04 mm, p90 2.4 mm, p99 5.1 mm, better than the old 1024-prim asymmetric fit.
- `emit_blob.py`:
  - The skeleton is fully symmetric (no vecR/offR). Prims are `mirror` on .l/.r bones and `both` on centreline bones.
  - **The tail is the `hem`/`hem2`/`hem3` pendulum chain.** The wings have `wing1`/`wing2` chains with new gait joint names `wingL`/`wingTipL`/`wingR`/`wingTipR` (gait.ts), so winged bodies get motion joints (the stock gargoyle and the dragon could use this too).
- `MAX_PRIMS` 2048 (a ceiling only; textures are per-body): 1002 flesh + 346 derived bones.

### Skin
- Glowing red eyes: two `glow=1` beads in the sockets (found from a depth map of the reposed face).
- Free CAVITY term (occlusion.wgsl.ts): `gResidualOff < 0` means the sculpt sits below the prim body (a groove), so AO darkens. It fades out again near a saturated residual, which is a joint-bend mismatch, not a crease.

### Observed / open
- `sym-walk-front.png`, `sym-walk-side.png`: the face, eyes, tail and wings all hold through the walk. `sym-arena.png`: boots and renders whole (8268 hull spheres, under the 16384 cap).
- **Wrist lump**: in the walk the forearm's end capsule overshoots into the bent hand. Joint blending (blend the two bones' rest points across the joint) is the next fix.
- Residual volume is 84 MB dense; sparse bricks still owed. The paired GPU cost A/B is still owed.
- The grey-closing + blur softens the face a little.

## Update 2026-11-17 (late): joints

The walk's wrist lump and the seams it left are fixed in three layers (`sym-walk-joints.png`).

1. **Joint-crossing endpoints** (rig-bind.ts `EndpointBind.frame`):
   - The problem: a `rigid` prim's endpoint that lies past its own bone's end (u outside 0..1 along the bone) rides the NEIGHBOURING bone across that joint (the bone sharing the joint whose segment is nearest), with its offset turned by that bone's frame. Before, a forearm capsule reaching past the wrist stayed straight while the hand bent: a 5 cm lump at a 50 deg bend (`.lab-tmp/check-joints.ts`).
   - Count: 2 endpoints per forearm cross; spine, chest, neck, clavicle and wing-root prims cross too.
2. **Two-frame rest point for joint-spanning prims**: `Primitive.skinQuatB` -> **`ROW_PRIM_FRAME_B` = 27** (`DATA_ROWS` 28, `WG_ROW0` 28). `restPointSkin` maps through each end's bone frame anchored at that end and blends along the capsule, so it agrees exactly with the prims of both bones.
3. **Runner-up blend**: the fold now tracks the second-nearest prim (`gFoldSecond`/`gFoldSecondIdx`, groups.wgsl.ts; one compare per prim for every body). Within 2 cm of it, the residual samples the mesh SDF through both prims' frames and blends the distances (weight 0.5 at a tie, 0 at 2 cm).
   - Same-frame prims give equal samples, so it only acts across a joint.
   - Refactor: `sampleResidual` became `sampleMeshSdf` + `residualOffset`.

Residue: a faint ragged patch can show at the shoulder in some walk phases (clavicle/chest/upperarm meet there: three frames, and the blend only uses two).

## Update 2026-11-17 (late): skin pass

- **Palette, stone-flesh** (`skin-palette-ab.png`, A beat B's bruised red-brown, which read as raw meat): warm grey base, mottle 0.6 at scale 1.6 toward a moss/soot dark, surfaceNoise 0.05 (normal-only), spec 0.30 / roughness 0.55, wetness 0.08. Now in emit_blob.py.
- **`grain` 0**: the albedo speckle hashes per cell and read as blocky compression noise up close (`skin-grain-vs-noise.png`).
- **Quilting** on smooth skin was the 6 mm sculpt grid: trilinear's gradient kinks at every cell face. Smooth (cubic) weights made it worse (terraces). Instead, calcNormal widens its stencil to 4 mm for residual bodies (`gInstVolPose0.w > 1.5`, map-body.wgsl.ts): `skin-normal-eps.png`.
- Final look: `skin-turntable.png`, `skin-face.png`.

## Reproducing (committed 2026-11-17)

- Re-emit the character from the committed fit (no refit needed):
  `GHD_EYE=0.058,1.394,0.586 GHD_EYE_R=0.014 python scripts/gargoyle-hd/emit_blob.py assets-source/gargoyle-hd/sym-prims-250.npz src/lab/sdf-zombie/characters/gargoyle-hd.blob`
- Full pipeline from the reference mesh (the Meshy .glb, not in the repo):
  1. `sample_sdf.py` -> samples.npz.
  2. A 6 mm grid -> grid6.npz.
  3. `fit_planes.py` -> planes.json (committed).
  4. `repose.py` -> sym/{grid6, samples}.npz.
  5. `medial.py`.
  6. `fit.py ... 250 --mirror 0.12` (250 per side; the 500 fit is kept as sym-prims-500.npz).
  7. `emit_blob.py`.
  8. grid6 -> .f32/.json -> `bake-residual.ts` -> `public/assets/lab/gargoyle-hd-residual.binz` (gzipped, 4.7 MB).
- Python deps: torch, libigl, trimesh, scikit-image, scipy, pillow. Blender for the clay renders.
- `skinned` is a new opt-in prim word (joint-crossing ends, no rigid-head capture). Every shipped character packs byte-identically to its old pin; that was checked before re-pinning `pack-golden`.

## Update 2026-11-17: performance pass

Owner: "the performance is way worse with the gargoyle". Measured in the arena (headless Chrome, frozen close-up at
3 m, `__sdfGame.bench({ kind: 'closeup' })`, per-pass GPU timestamps in `mode: 'passes'`):

| | frame | march (GPU) |
|---|---|---|
| zombie | 3.9-4.9 ms | 1.0 ms (crowd compute march) |
| gargoyle-hd, 500/side fit, per-body | 21.5 ms | 22.6 ms (fragment march) |
| same, residual off (`?residual=0`) | 20.8 ms | |
| old asymmetric 511-prim fit, residual off | 18.2 ms | |
| **250/side fit, hero groups, crowd compute** | **13.1 ms** | **8.9 ms** |

What it was NOT: the residual layer and the joint fixes cost ~0.7 ms.

What it was:
1. **The draw path.** The spike's own gate sent any body over 256 prims to the per-body fragment march, because the
   crowd path's tile lists clamped. The gargoyle never used the compute march, even in its glitchy first version.
2. **Tiny bound groups.** pack.ts cuts a group where its sphere passes 0.16 m, tuned for zombie-scale prims. The
   scan-fitted prims are fat, so a single prim's sphere is already 8-19 cm. The result was 286 groups of 1-2 prims,
   over the crowd path's 256-group index (TILE_REF_GROUPS). Reordering the fold did not help; the sphere size did.
3. **Prim count.** The symmetric redo fitted 500 per side, about 1000 in all, against the old 511.

Fixes:
- `pack.ts` HERO_GROUPS / HERO_GROUP_RADIUS: a body past 128 groups is regrouped at 0.28 m (286 -> 94 groups). The
  next-largest cast body has 88 groups, so every other character packs byte-identically (pack-golden).
  0.22 m and 0.28 m march about the same (9.0 and 8.9 ms); 0.35 m is slower (11.3 ms).
- `game-spawn.ts`: the hero gate counts bound groups against TILE_REF_GROUPS instead of prims.
- Refit at 250 per side: surface error 2.1 mm mean, 9 mm p99 (1.0 / 5 mm at 500). Both are inside the residual's
  15 mm clamp, so the detail layer covers the difference; the residual needs no re-bake (it stores the mesh SDF).
- `emit_blob.py` orders the fold by recursive spatial bisection instead of a Morton walk.
- A sweep of 20 camera positions (0.9-6 m, five angles) clamped no tiles.

Still ~9 ms of march against the zombie's 1 ms: about 600 prims (with bones) plus the residual, filling most of the
screen at 3 m.
