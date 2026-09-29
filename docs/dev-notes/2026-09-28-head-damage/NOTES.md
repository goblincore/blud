# Melee head damage model — notes (2026-09-28/29)

Spec: `docs/superpowers/specs/2026-09-28-melee-head-damage-design.md` (§15 is the v2 model, as built).
Plan: `docs/superpowers/plans/2026-09-28-melee-head-damage.md`. Gate: `scripts/head-damage-gate.mjs`; photos
in `gate/`. The flail gate (`scripts/flail-gate.mjs`) asserts the head contract with real flail clicks.

## For the owner: what to try

The flail only; zombies only.
- **Hit the head repeatedly.** It squashes about 40% along the blow, bounces like jelly for about a second,
  and rocks with the hit. It also keeps dents.
- **Flesh wears away region by region** (the two orbits, the brow, the crown, the two cheeks). Each region
  keeps one crater that grows where you first struck it.
- **The eye:** 3 or so hits on an eye strip the orbit to bone. The painted glow goes out and a real 3D eye
  sits in the orbit. The next hit there pops it: it springs out, swells to a cartoon eyeball and dangles on a
  pink stalk. The socket is a dark hole. The next head hit snaps the eye off.
- **The skull:** hits on the brow, crown or either cheek strip it to the skull. About two more there crack
  it: a modelled brain flies out with skull chips and lumps, and the zombie dies. The head stays on; the flail
  never decapitates. It takes about 5–7 hits to one spot; the front sequence (eye, then brow) took 8.
- **The body** still takes about 8 hits to drop.

Feel questions:
- Is the wobble big enough now?
- Is 3–4 hits to strip a spot right?
- Does the dangling eye read? Its socket is dark but still has a grey rim while the eye dangles.
- Does the skull read as bone? It is tan/brown in the crater light.
- Is the blood still hiding the stages?

## Built (v1 → v2)

- **v1** (Tasks 1–11) was a fixed four-hit ladder: eye, cave, scalp, brain. Owner playtest: the popped eye's
  painted glow stayed; the eye should pop only once the orbit is bone; the flesh should wear away over many
  hits, not on exact hit numbers; and the wobble was too weak. That led to v2.
- **Kept from v1:**
  - the skull deforms with the flesh on both skeleton paths (`headAffine`);
  - the stalk rope;
  - the modelled brain mesh (`scripts/model_brain.py`, 7,268 tris, a Gray-Scott gyri pattern, a wet
    physical material) riding the gib physics;
  - attached pieces (`ctx.boot.attachPiece` and `ChunkGpuView.morph`, one draw per eye state);
  - head crater slots (`Wound.headRegion` replaces its predecessor, `MAX_HEAD_WOUNDS` 7);
  - `forceCollapse`;
  - bone colour restored on the procedural path, plus the bone colour in settled-gib bakes (merged from
    `claude/bone-bake-albedo`).
- **v2** (Tasks 13–19): the region damage model (`head-damage.ts`), a per-eye glow mask in the face shader
  (`faceEyeMask`, packed per zombie in the view record), the in-orbit eye and the socket plug, and anchored
  region craters. Any non-orbit region can crack the skull.

## Numbers (head gate, final run)

| | |
| --- | --- |
| Orbit exposed | after 3 hits |
| Pop | hit 4 |
| Snap | hit 5 |
| Skull (brow) | hit 6 |
| Brain and kill | hit 8 |
| Side of head (flail gate) | skull on hit 3, kill on hit 5; craters within 0.4–2.1 cm of the strike |
| Glow at the exposed eye | drops 100% (0.086 → 0); the other eye is unchanged |
| Wobble | peak 0.358, rebound 0.221 at +6 frames, settled (4.6e-4) at 1.4 s; no bone shows through intact flesh at peak |
| Dent | 1.9 cm at the face pole |
| Head wound slots | 6 of 7 |
| Eye cost | about 1.3 ms measured by hiding it. The gate's A/B is noise-dominated (−1.55 to +2.35 ms across 13 runs) |

## Measurements

- **Eye centroids** (`zombie-face.png`, luma ≥ 0.9, through the planar face projection `faceProj 0.45, 0.58,
  0.5, 0.56`):
  - UV L (0.276, 0.616), R (0.703, 0.664), with v counted from the bottom (flipY);
  - `hs` L (−0.498, 0.096), R (0.451, 0.179).
  - 'L' is the image-left eye, which is the zombie's own right eye.
- **Skin to skull** along each region's ray: brow 5 mm, orbit 6 mm, crown 20 mm. The carve is held `skullGap`
  (6 mm) short of the skull until the region crosses its threshold.

## Open

- While the eye dangles, the socket reads as crater-dark, not black: the plug has a lit rim and the stalk
  fringe shows grey. The gate's pop-darkness check fails at 28.0 against a bar of 19.2.
- The skull reads tan/brown rather than ivory in crater light. The procedural path's crater bone is darker
  still.
- Blood still covers much of each stage in photos.
- The eye's leftover cost when it overlaps the face: splitting the chunk pass halves it, but that is shared
  `sdf-layer` code.
- Deferred-renderer mode is not exercised by the gates.
