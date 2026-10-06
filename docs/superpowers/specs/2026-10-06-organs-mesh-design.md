# Organs as mesh — design

**Date:** 2026-10-06 · **Branch:** `claude/organs-mesh` · **Owner decision (2026-10-06):** "we def should convert
them to mesh. they aren't even really that visible or noticeable atm".

## 1. Why

With the default `skeleton=mesh`, the only inside-flesh rows a body still packs are its organs. `applyBones` folds
them at every march sample inside any wound's near zone. Measured 2026-10-06 with `scripts/cut-cost.mjs` (ring page,
three axe chops on one torso at 0.9 m, 400x300 march target): switching `applyBones` off removes about 2.0 ms (IQR
1.35 to 2.4) of the 4.8 ms the chops cost; debug mode 5 counts 869,704 inside-flesh prim evaluations a frame over
19,878 texels. The fold runs in every crater's near zone, so this is a general wound cost.

## 2. What exists (read from the code, 2026-10-06)

- **Only the zombie has organs:** 8 prims in `characters/zombie.blob` (4 bent gut bars, 4 haustra blobs), all `torso`.
- **They are already rigid.** `bindRig` gives every torso inside-flesh prim an axial `BoneFrame`, organs included, and
  `applyRig` poses them by it. The `'organs'` boneSegment tag is only the pack's cull group. The contract's "ride no
  rigid frame" is out of date.
- **They fold with a hard min** (`foldBoneRange`; the blobs' `blend=` is never read), the same as bone.
- **The march shades them** in `organ.wgsl.ts`: `albedo = mix(albedo, organColor, organAmp)` (salmon `0.72, 0.32,
  0.30`, amp 1) and `wet *= 1.8`; they are left out of the torn-wound smear.
- **Nothing else reads organ rows.** The `cavity` wound flag is set at stamp time from the hit prim's limb
  (`game-weapon.ts`, `explosion-aoe.ts`) and feeds the tissue ramp's viscera stop and `shouldSpill`. Entrails never
  read `bonePrims`. `gib-parts.ts` builds its `organ.gut` piece from `body.bonePrims` on the CPU.

## 3. Design

**3.1 Organ segments in the mesh contract.** `createSkeletonSources` gains `organs?: boolean`. When on, organ prims
are grouped by the axial frame `applyRig` poses them by, into sources keyed `organ:axial:<head>-<tail>` with
`kind: 'organ'` (every existing source gets `kind: 'bone'`). Same local frame, `distance()` (hard min), bounds,
revision, `isLive()` and `pose()` as an axial bone segment. They go through the same `SegmentMeshCache` extraction,
at a finer cell (5 mm against the bones' 1 cm: a 2.2 cm tube is too few cells across at 1 cm), and the same
instanced batches.

**3.2 The pack drops the rows.** `PackOpts.packOrgans` (default true, rows byte-identical) and `view.setPackOrgans`.
A mesh-skeleton actor sets both `packBones` and `packOrgans` off, so `boneCount` is 0, `counts2.x` is 0 and
`applyBones` is never called. **No march WGSL changes**, so the golden snapshot and the `march-hash` pins cannot move.

**3.3 What exposes an organ mesh.** The same rule as mesh bone: the organ meshes write depth, the marched flesh
writes depth, the nearest surface wins. That is the field's hard min, so an organ shows exactly where a carve
reached it. Two culls decide whether the instance is drawn at all:
- the existing owner cull (`boneExposedActors`: a non-decal wound, or a sever);
- new, per organ segment: at least one of the owner's exposure spheres (`boneExposureOf`, which is
  `cutExposureSpheres` per wound) reaches the segment's posed bound sphere. A zombie shot in the head draws no guts.
  This is a pure function with its own test.
The exposure spheres also drive the organ's blood stain and fake cavity AO, as they do for bone.

**3.4 Shading.** A third material in `mesh-renderer.ts` (bone, eye, organ), hand-written WGSL
(`MESH_ORGAN_SURFACE_WGSL`, a gloss function) composed with the shared `boneShade`, so key, flashlight, light list
and room fill match bone. It reads the march's own values: `organColor` and `organAmp` are copied from the body
view's uniforms each frame (the wound panel's "organ tint" knob keeps working), and the gloss is a wet-all-over
term standing for the march's `wet * 1.8`. Variation is in segment-local space, so it rides the pose. The owner
picks the look from a sheet (section 5).

**3.5 The selector.** `?organs=sdf` keeps SDF organs on a mesh skeleton (today's default: the A/B "before"), and
`__sdfGame.setOrgans('mesh' | 'sdf')` flips it at runtime for in-page cost alternation. Default: `mesh` when the
skeleton mode is `mesh`. `?skeleton=procedural`, `?skeleton=volume` and deferred rendering always pack organs, as
today. Detached chunks (including the `organ.gut` piece) keep procedural organs, as today.

**3.6 Unchanged.** The `cavity` flag, the viscera stop, entrails, gib parts, the melt (lab only), `applyBones` and
`organ.wgsl.ts` (still used by procedural, deferred and chunks).

## 4. Known differences from SDF organs

- The march's shadows and AO no longer see organs (the same limitation the mesh skeleton has: wrap-up 2026-09-08,
  "torso wound cavity still appears brighter"). The mesh organ gets the faked exposure AO instead.
- Wound overlays that the march paints on organ pixels (gore, mottle, the wet film) do not reach the mesh.
- Organ meshes are polygons at the polygon pass's resolution, like bone; the flesh round them is marched.
- During a body tear (`setBonesBare`) SDF organs folded bare through the thinning flesh. Mesh organs show by depth
  instead, if the owner is in the exposed set (the rule mesh bone already has).

## 5. Verification

1. **Unit tests:** pack (`packOrgans` off with `packBones` off gives `boneCount` 0; on is byte-identical), contract
   (organ source keys, rest identity, pose follows the axial frame, `distance` equals the hard min of the organ
   prims), the reach cull, the selector, the renderer's organ batch.
2. **March untouched:** `npx vitest run march-golden` (no snapshot change expected; `-u` only if it moves, and then
   explain why), `node scripts/compile-census.mjs`, `march-hash` (the pins must not move), the vitest tree, `tsc`.
3. **A capture gate, `scripts/organs-mesh-gate.mjs`** (ring page, pinned like `march-hash`), `organs=sdf` against
   `organs=mesh` in one session:
   - unwounded: the float march target is bit-identical between the two, and no organ instance is drawn;
   - open torso wounds (a slug crater, three axe chops): with `mesh`, `counts2.x` is 0 and debug mode 5 counts 0
     inside-flesh evaluations; with `sdf`, organ-dominant texels exist (the positive control: the scene really
     exposes organs); with `mesh`, organ pixels exist on screen (a shown / hidden pair of the same frame) and their
     area and mean colour sit within a stated tolerance of the SDF organ pixels;
   - a head-only wound draws no organ instance.
4. **Frame cost:** `scripts/cut-cost.mjs` with `VARIANTS=';organs=sdf'` (before / after / delta, census) and a
   selector run alternating `setOrgans` in page. Expected: about 2 ms back on three chops, minus the mesh draw.
5. **Boot:** cold-boot `drawOnce` against main; the organ pipeline must be in the warm path, with no hitch at the
   first exposing wound.
6. **The three capture gates** with `OUT` set: `head-split-gate`, `axe-gate`, `cut-wound-gate`.
7. **Owner look sheet:** `docs/dev-notes/2026-10-06-organs-mesh/look/`, before (SDF) beside the mesh candidates, on
   the same frames (a slug crater, three chops, a blast), with the torch on and off. The owner picks.

## 6. Out of scope

New organ shapes (a liver, a heart, longer loops): cheap once organs are meshes, but a separate look task.
Mesh organs for chunks and deferred rendering.
