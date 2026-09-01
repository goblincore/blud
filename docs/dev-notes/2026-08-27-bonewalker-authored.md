# Bonewalker authored — and the first from-scratch `blob:rings` trial

**2026-08-27, worktree `2026-08-27-bonewalker-character`, branch `dispatch/bonewalker-character`.**

The sixth `.blob` character: a horned skeletal undead ("Rusted Bonewalker",
Meshy) authored at **1.30 m** against `docs/dev-notes/refs/bonewalker-mesh/bonewalker.glb`
(1.700 m bind T-pose, 21k verts, 67% reaching a measurable bone — mouse 40%,
schoolgirl 79%). This run was also the first time `blob:rings` was used for
its actual purpose: authoring a new character from scratch rather than
retrofitting one that predated it.

## What was built

- `src/lab/sdf-zombie/characters/bonewalker.blob` — 60 prims: horned skull
  (face = baked decal off the mesh's own head), exposed painted spine ridge
  + segmentation grooves, wasp waist, ribcage deeper than wide, lanky
  measured limbs, claw fingers, paw feet with claws.
- Registered in the lab (`?character=bonewalker`), face bake at
  `public/assets/lab/faces/bonewalker-face.png`.
- `characters/bonewalker-blob.test.ts` — 11 pins: every measured bone
  length, the lankiness relations (legs 47.6%, arms 36% of height), floor
  contact + ankle band, waist pinch as a relation, ribcage depth, claw
  paint counts, palette relations, decal presence.

## Gates

`tsc --noEmit` clean; `npx vitest run src/lab/sdf-zombie/` **1715 passed**;
`blob:render-check` 0 hole clusters; turntable shot at 1.35 m and read
(horned skull, grin, lanky arms with claws, wide paw stance, exposed spine
present in the field probe: backmost −0.100..−0.111 vs mesh −0.073..−0.121).

## The skeleton did its job

Every `len=` came from the brief's table (the reference rig's own
joint-to-joint distances × 0.7647). Consequence: **no `BONE LENGTH IS OFF`
block ever printed** — the failure class that drowned every mouse/schoolgirl
fit (their skeletons predate the tool) was absent by construction. Final
bone-length table: all mapped bones within 5.2% (the max is the reference's
own .l/.r asymmetry, upperarm 0.336 vs 0.320 ref).

## Where blob:rings helped (the honest list)

1. **Radius/scale/offset findings were real.** Round-1 blocks 3-12 (waist
   pinch to a thread r 0.024 between two caps; ribcage fatter + forward;
   calf narrower/deeper; deltoid fatter at the shoulder; thigh slimmer and
   forward) were applied as printed and survived every cross-check. Three
   rounds converged: mean residuals ≤14 mm everywhere measurable, most
   ≤10 mm (≈1% of standing height).
2. **The flags earned their place.** `IMPOSSIBLE` correctly stopped me
   typing a negative radius on the blend-buried spine ridge; `TAPER REFUSED
   ... NOT A LINE` correctly identified the calf/forearm bulges as
   non-linear (they're two-bar constructions, not tapers); `t 0.00-0.42
   only` correctly marked the shoulder-ball fit as partial-support;
   `off-ends dropped` + `cross-bone dropped` counts predicted which blocks
   were soft before I acted on them.
3. **The "one block is one edit" rule is right.** The waist block (r+r2+
   deep+offset together) produced exactly the pinch the mesh has; the
   round-2 chest ask (r 0.0914 + offset z +0.0215) matched the mesh's
   forward-heavy ribcage.

## Where blob:rings misled me (the honest list)

1. **The pelvis.** It asked — three rounds running — for semi-axis 52 mm.
   The mesh's pelvis-vertex cloud is a wide bowl (75-90 mm halfW) with
   blade-like iliac wings spiking to 119 mm. The fit reads the bowl MASS
   (rho is a radial average dominated by many mid-radius points) and drops
   the sparse wing points as off-ends. Applying 52 mm starved the hips on
   screen — the render and the mesh's own width profile overruled the fit.
   Lesson: **a radial ring fit cannot see blades**; features that live at
   the rho extremes need their own prims (the hip wings got two).
2. **The foot is confounded and the tool half-knows it.** The reference
   rig's foot bone runs 45° down-forward while ours is horizontal, and the
   toe-claw fan (separate prims) rides the same bone. Every round asked for
   r2 ≈ 0.12 — the claw fan measured as one toe mass. `off-ends dropped
   219-333` was the tell. I left the paw as authored and judged by render.
3. **It is paint-blind.** The painted spine ridge (the character's
   signature) was twice asked to shrink to r ≈ 0.011 — the fit sees the
   field, not the dbc0a0 paint, and the ridge's own points are
   30-46% blend-dominated. Painted features are visual-judgement territory.
4. **It cannot see the head, hands, or claws** (as documented): horn shape,
   ear size, claw splay, the whole face — all render-judged.
5. **`blob:measure` was nearly useless on this reference** — even the legs
   are posed (a wide crouch: knee +0.077 forward, ankles x ±0.19), so no
   clean `--range` window exists; the whole-figure number is POSE MISMATCH
   by construction. Its one useful output: `row jerk` ref 0.017 vs ours
   0.006 — the mesh's bony, knobbly outline read is a real remaining gap
   (our surface is smoother than the reference's).

## Tool lessons for the next author

- **A capsule's bottom cap is a half-radius hemisphere.** A ribcage bar
  starting at its bone's head fills a waist pinch 2 cm below it (measured
  80 mm where the mesh is 33-40 mm). Start flare bars AT the flare; let a
  neighbouring blob carry the max band. The test pin caught this.
- **High-Hips rigs vs the surface.** Meshy put this rig's Hips joint at
  58.1% while the surface crotch sits at 49.7%. Chaining the spine from a
  pelvis rooted at the crotch (required for measured-length legs to reach
  the floor) rides the whole upper chain ~0.108 m below the rig's joints.
  Handle it by parenting the clavicle to `neck` (tail = the mesh's shoulder
  line) and letting the unmapped `skull` bone absorb the offset (len 0.362
  puts the face block's cranium centre at the measured 1.203).
- **Decal aim beats decal proportions.** The head box is horn-wide
  (0.475 m); literal scaling is meaningless. Aim two features (eyes row +
  chin row) and let the teeth land between — and remember unpainted head
  prims within decal reach pick up the bake's pixels (the ears went
  horn-cream until painted).

## Frames

- Final turntable: `/tmp/blob-shot/final2/` (12 yaws)
- Head close-up: `/tmp/blob-shot/head-final/`
- Reference renders (Blender): `/tmp/bonewalker-ref/`
