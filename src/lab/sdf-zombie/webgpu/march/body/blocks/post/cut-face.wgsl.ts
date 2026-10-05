// src/lab/sdf-zombie/webgpu/march/body/blocks/post/cut-face.wgsl.ts
//
// THE CUT FACE'S LOOK (the head split; head-split.ts SPLIT_SHADE holds its numbers). One block, spliced into
// MARCH_TRACE_POST right after the tissue ramp, where the albedo exists and nothing has yet read the masks' side
// outputs. What it has in hand from split-hit.wgsl.ts: cutFace (the gate: 0 on skin and on every closed body, 1 on a
// cut face), cutDepth (how deep inside the closed head, as it is now with its wounds, the face lies there) and pS (the
// un-warped point, where the closed head's bones and wounds are). The walk's hitField.w is that depth before the wounds.
//
// Three terms of a cut face are NOT here, each where it must be, and each points back:
//   * wound-masks.wgsl.ts raises the one wound mask to the gate, on the vector before it is taken apart (the three
//     masks stay single-assignment, and the cavity share keeps its one sink: entrails-gates.test.ts);
//   * tissue.wgsl.ts reads the ramp at cutDepth, so the face is a cross-section (skin, fat, red, clot) and the albedo
//     this block starts from is already the wound interior's;
//   * face.wgsl.ts takes the face sheet, the glow and the gore protection off it (that layer is also the mesh head's,
//     by renames: baked-chunks.ts).
//
// WHAT RUNS AFTER THIS BLOCK, on the albedo it leaves: the organ block (bone and organ prims only), the mottle
// (ungated: it blotches every albedo), the face layer (off a cut face), the body grain (masked by the wound mask), the
// gore (a doomed or detached body), the soldier's meat (soldiers), the paint and char mix, the burn's soot, the melt;
// and in the surface prep the wetness. A term written here that is NOT flesh (a ring of cut bone) would be mottled,
// gored and wet as flesh. So the block also gives cutKeep, the share of this texel that is such a term (the bone
// ring's band): the mottle, the gore and the wound wetness leave that share alone. The soot, the char and the
// melt still take it, as they take bone.
import { SPLIT_SHADE } from '../../../../../head-split';

/** A number as a WGSL float literal (sums of the constants rounded to the nanometre: 0.013 + 0.0015 is not 0.0145 in binary). */
const f = (v0: number) => { const v = +v0.toFixed(9); return Number.isInteger(v) ? `${v}.0` : `${v}`; };
const B = SPLIT_SHADE.bone, L = SPLIT_SHADE.layers, C = SPLIT_SHADE.cavity;
// The layers' and the cavity's lines are written only while each is on. A mix by 0 leaves the albedo as it was, but
// with the lines in the text the compiler rounds the ring's own mix after them another way (measured: 403 ring texels
// of 25 views differed by up to 3e-7 from the build without them). Strength 0 is the text without them: exact.
const LAYERS = L.strength > 0 ? `    // THE LAYERS OUTSIDE THE RING (SPLIT_SHADE.layers): a pale line of fat under the skin's edge, then dark muscle up
    // to the ring. The torn edge: their depth is pushed in and out by a noise of the rest anchor (it rides the half),
    // and where that noise runs high the fat line is clotted over. Strength 0 = the material's ramp.
    let cutRag = noise3(anchor * ${f(L.ragScale)});
    let cutFat = 1.0 - smoothstep(${f(L.fat - L.soft)}, ${f(L.fat + L.soft)}, cutSection + cutRag * ${f(L.rag)});
    let cutClot = smoothstep(0.1, 0.5, cutRag) * ${f(L.clot)};
    let cutLayers = mix(deepColor * ${f(L.muscle)}, mix(fatColor * vec3<f32>(${L.fatColour.map(f).join(', ')}), deepColor * ${f(L.clotColour)}, cutClot), cutFat);
    albedo = mix(albedo, cutLayers, cutFace * (1.0 - smoothstep(${f(B.lo - B.soft)}, ${f(B.lo + B.soft)}, cutSection)) * ${f(L.strength)});
` : '';
const CAVITY = C.strength > 0 ? `    // THE CAVITY INSIDE THE RING (SPLIT_SHADE.cavity): a dark lining, darker toward the middle, blotched by a slow
    // noise of the rest anchor. Strength 0 = the material's ramp.
    let cutCavity = deepColor * mix(${f(C.rim)}, ${f(C.centre)}, smoothstep(${f(B.hi)}, ${f(B.hi + C.reach)}, cutSection)) * (1.0 + ${f(C.blotch)} * noise3(anchor * ${f(C.scale)}));
    albedo = mix(albedo, cutCavity, cutFace * smoothstep(${f(B.hi - B.soft)}, ${f(B.hi + B.soft)}, cutSection) * ${f(C.strength)});
` : '';

export const CUT_FACE_BLOCK = /* wgsl */ `  // THE CUT FACE'S LOOK (head-split.ts SPLIT_SHADE). Everything is behind the gate: a closed body runs none of it.
  // cutWet is the face's wetness at every depth (the wet block lifts its lip term to it; 0 off a cut face).
  var cutWet = 0.0;
  // cutKeep is the share of the albedo written here that is not flesh (see the header): the bone ring.
  var cutKeep = 0.0;
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
    // THE SECTION'S DEPTH: how deep inside the closed head the face lies, BEFORE the head's wounds (hitField.w, the
    // hit piece's pre-wound field at its un-warped point: what the tissue ramp reads off a cut face). The anatomy
    // drawn on the face (the layers, the bone ring, the cavity) is the closed head's, so it must not bend round a crater or round the face
    // cuts' own slots; cutDepth, the depth as the head is now, does (the tissue ramp keeps it).
    let cutSection = max(0.0, -hitField.w);
${LAYERS}${CAVITY}    // THE BONE RING (SPLIT_SHADE.bone): the skull in section, a band of the material's bone colour where the face
    // lies between two depths inside the closed head. It is not flesh: cutKeep is its share. Strength 0 = no ring.
    let boneRing = smoothstep(${f(B.lo - B.soft)}, ${f(B.lo + B.soft)}, cutSection) * (1.0 - smoothstep(${f(B.hi - B.soft)}, ${f(B.hi + B.soft)}, cutSection));
    cutKeep = cutFace * boneRing * ${f(B.strength)};
    albedo = mix(albedo, boneColor * vec3<f32>(${B.colour.map(f).join(', ')}), cutKeep);
  }`;
