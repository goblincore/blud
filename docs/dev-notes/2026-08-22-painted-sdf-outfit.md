# Painted SDF characters — how the mouse got its outfit, and what it cost the engine

2026-08-22, branch `silhouette-match`. The mouse went from "rejected, scrap it"
to a character that reads as its reference mesh, and the route there changed
how characters are authored. This is the record for the next agent.

## The one idea

The reference (`docs/dev-notes/refs/maus-biped/*.glb`) is **one sculpt with
painted regions**. Nothing on it is a separate object: the sunglasses are a
glossy black bump on the face, the shoes are grey blobs the legs enter, the tee
is the torso painted red with *no drape at all*. Dressing a smooth SDF sculpt
in hard polygon lofts (the kit) was the source of every outfit defect we had —
the two-tube gap at the crotch, flesh through the shirt, facet loss, the
floating foot, the open collar.

So `.blob` primitives can now be painted: `color=rrggbb gloss=0..1`. The fold
already reports the nearest primitive at every hit (`hitBest`); colour is a
lookup at that index (`ROW_PRIM_COLOR`, w = 1 + gloss, w = 0 is flesh). The
mouse has no kit any more. The authoring skill has the full rules.

## Measure, do not look

Every number in `mouse.blob` came off the mesh, two ways:

- **Geometry** — `parseGlb` + `gltfTriangles` (`silhouette.ts`) and
  `scripts/head-profile.ts`: centreline front/back profile, plan view, width
  by height. **Frame-align on the torso first.** The maus mesh sits at
  z −0.067 in its own file; comparing absolute z read the cranium as 65 mm
  too far forward and leaned the neck back 40° to fix a head that was right.
- **Paint** — decode the GLB's embedded texture (`decodePng`) and classify
  every vertex by its texel. Black on the head = the shades (lens lobes at
  x 0.02..0.099, front 0.129, a thin 0.116 bridge, **two temple arms** at
  x ±0.085 rising to the ears — summarised per row they looked like one
  band and were authored as a unibrow once); grey = shoes (heel 0.106 wide,
  ball 0.147, axis yawing 12°); red = the torso, no drape; blue = pelvis and
  thighs to a hem at 0.19.
- Author to the mesh **surface**, not the rig's joints: the rig put the
  shoulder at 0.622 and the collar at 0.729; the skin has them at 0.53 and
  0.60.

## Engine gaps found by painting things (all fixed, all tested)

| gap | symptom | fix |
|---|---|---|
| `buildHullInstances` sized a tapered prim's far sphere from its fat end | a perfectly **round see-through hole** at the snout tip; hunted for a day as a modelling defect | per-end radius; hull test runs on every character |
| `coneBend` had no untapered (`r2 < 0`) branch | a bent capsule rendered as one sphere at its start end | `select(r2, r1, r2 < 0)` |
| `expandMirror` didn't reflect a prim's own offset/tip/bend x on `.r` | the right shoe sat on the centreline | reflect on the `.r` copy (no character relied on the old behaviour) |
| `clusterCore` = fattest prim | a shoe became the leg's fuse-probe core; the probe ran through air | explicit `core` mark on the structural prim (inferring from paint broke when the arm was painted) |
| hull test used `sdBody` for inside-ness | carves apply as `smax(d, −carve)`: interior readings become "−distance to the nearest carve" | test against the additive field plus carve clearance |
| `setStepsOverride(0)` | blanked the whole body | 0 means auto, like the panel |
| `focusBody` aimed at y 1.05 | "level" shots looked 28° down the collar; a flesh stripe hunted as three rendering bugs | uses the body's own height |

Rule that would have saved most of that day: **if a hole is round and the
CPU field (`sdBody`) is solid there, suspect the renderer, not the `.blob`.**

## State at the pause

- Head, body, shades, shoes, tee, shorts, sleeves, dished ears: done, on
  `silhouette-match`, 2045 tests green.
- Hands: enlarged to the mesh's mitt (0.068 × 0.080 × 0.096, 12 → 9 mm
  fingers) — **not yet reviewed by the owner**, who parked it.
- Whole-figure silhouette vs the front plate: 0.660 (as merged to main
  before today) → 0.774. Legs-and-shoes window 0.661 → 0.753.
- The maus-biped GLBs live in the primary checkout's refs folder (25 MB);
  whether reference meshes belong in git is the owner's call.
