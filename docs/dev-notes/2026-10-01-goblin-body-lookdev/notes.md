# Goblin body variants: look-dev (2026-10-01)

Three wiry bodies for the [goblin refinement pass](../../superpowers/specs/2026-10-01-goblin-refinement-design.md),
written as scratch copies of `goblin.blob`. Each replaces the torso, neck, arms and legs and keeps everything else. They
are meshed from the game's own CPU SDF and rendered in the 90s ray-tracer mode. **The owner picked A, "sinew".**

![Current, A sinew, B knuckle, C gnarled: 3/4 front, side, 3/4 back](variants.jpg)

| File | What |
| --- | --- |
| `variants.jpg` | Current, then A, B and C, from three yaws |
| `goblin-a-sinew.blob` | The chosen variant as a whole `.blob` (orphaned comments from the old body are left in): phase 1's starting point |
| `variants.py` | Writes the three variant `.blob`s from `goblin.blob` (`python3 variants.py REPO OUTDIR`) |
| `turn.py` | The turnaround: PLYs in a row, three yaws, the 90s look (`blender -b --factory-startup --python turn.py -- OUTDIR a.ply ...`; `RES_Y=880` for a 1.3 m figure) |

Mesh each with `../2026-10-01-flat-emergence-lookdev/blob-mesh.ts <file.blob> <out.ply> 0.005`.

## The variants

- **A, sinew:** three continuous tapered torso bars, tapered limbs, no joint orbs but the hands, spine beads and neck cords. 41 prims.
- **B, knuckle:** wiry shafts with modest early-3D joint orbs, raised ribs (bent prims), shoulder blades, a small pot gut and two-toed feet.
  - The first pass detached both arms: the shoulder blob was too small for the narrower chest. That is the race the skill describes.
- **C, gnarled:** skeletal shafts, knobbly joints, elbow spurs, a keeled breastbone over a pot gut, five ribs and three toes.

**Known flaw, all three:** `deep=` scales front and back alike, so the torso bulges at the back of the waist in profile.
The spec's phase 1 fixes it in A.
