// src/lab/sdf-zombie/webgpu/march/body/blocks/post/cut-face.wgsl.ts
//
// THE CUT FACE'S LOOK (the head split; head-split.ts SPLIT_SHADE holds its numbers). One block, spliced into
// MARCH_TRACE_POST right after the tissue ramp, where the albedo exists and nothing has yet read the masks' side
// outputs. What it has in hand from split-hit.wgsl.ts: cutFace (the gate: 0 on skin and on every closed body, 1 on a
// cut face), cutDepth (how deep inside the closed head the face lies there) and pS (the un-warped point, where the
// closed head's bones and wounds are).
//
// Three terms of a cut face are NOT here, each where it must be, and each points back:
//   * wound-masks.wgsl.ts raises the one wound mask to the gate, on the vector before it is taken apart (the three
//     masks stay single-assignment, and the cavity share keeps its one sink: entrails-gates.test.ts);
//   * tissue.wgsl.ts reads the ramp at cutDepth, so the face is a cross-section (skin, fat, red, clot) and the albedo
//     this block starts from is already the wound interior's;
//   * face.wgsl.ts takes the face sheet, the glow and the gore protection off it (that layer is also the mesh head's,
//     by renames: baked-chunks.ts).
import { SPLIT_SHADE } from '../../../../../head-split';

const f = (v: number) => (Number.isInteger(v) ? `${v}.0` : `${v}`);

export const CUT_FACE_BLOCK = /* wgsl */ `  // THE CUT FACE'S LOOK (head-split.ts SPLIT_SHADE). Everything is behind the gate: a closed body runs none of it.
  // cutWet is the face's wetness at every depth (the wet block lifts its lip term to it; 0 off a cut face).
  var cutWet = 0.0;
  if (cutFace > 0.0) {
    // What the masks found at pS is not on this surface: the footprints the closed body's wounds and burns throw
    // THROUGH the solid (char, a tear's red, a wet-only band, a hole, a cloth mark or stain) are dropped.
    cm = cm * (1.0 - cutFace);
    gWoundTear = gWoundTear * (1.0 - cutFace);
    gWoundWetOnly = gWoundWetOnly * (1.0 - cutFace);
    gWoundHole = gWoundHole * (1.0 - cutFace);
    gClothMark = gClothMark * (1.0 - cutFace);
    gClothStain = gClothStain * (1.0 - cutFace);
    // Wet all over: a flat face laid open, not a crater whose floor lies under its lip.
    cutWet = cutFace * ${f(SPLIT_SHADE.wet)};
  }`;
