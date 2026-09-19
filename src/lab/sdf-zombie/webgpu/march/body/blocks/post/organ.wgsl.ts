// src/lab/sdf-zombie/webgpu/march/body/blocks/post/organ.wgsl.ts
//
// Task-3 split of the march body (2026-09-19): inside-flesh material identity and organ tint (post-hit material).
// MOVE-ONLY: spliced back into its parent string by interpolation, so the
// joined WGSL is byte-identical. See docs/dev-notes/2026-09-18-march-split/.
import { ROW_PRIM_SCALE } from '../../../layout';

export const ORGAN_BLOCK = /* wgsl */ `  // NO TORN-FIBRE PASS. It shipped in wound pass r2 and was CUT on the
  // owner's playtest verdict (2026-09-02): "rather subtle... just seems to
  // make the texture a little different but not really noticeable or that
  // visibly different from default", judged with the panel slider swept to
  // its ceiling. An fbm per wound-interior pixel that nobody can see is
  // cost without a look, so it is gone rather than defaulted to 0 — a dead
  // knob invites someone to turn it back on and re-litigate this.
  // surfCfg3.w is consequently SPARE; the row map above says so.

  // Inside-flesh material (organs r3). The dominant prim carries the
  // material code in primScale.w — W_ORGAN is 5, and only applyBones can
  // claim bestIdx for an inside-flesh row because foldGroup and applyCarves
  // skip the range entirely — so this is an identity read, not a guess from
  // depth or radius. (Bone tubes: op 'bone' prims no longer reach the field
  // when packBones is off — the bone ALBEDO branch this used to feed is
  // deleted with them; a packed bone row still wins the fold identically
  // under the default packBones-on layout, it just shades as plain meat.)
  // hitBest is -1 on the baked-volume path (no dominant prim), so clamp the
  // row index and gate on it, like the painted-prim read below. Gated on wm
  // (gore r3 refinement 5): an inside-flesh prim can only ever be dominant
  // INSIDE a wound — applyBones runs only where nearWound is set — so on an
  // unwounded pixel this texel load can never change the answer. It ran on
  // every hit pixel of every body before the gate.
  var hitMat = 0.0;
  // The melt reads this too (meltCfg.x > 0): the skeleton EMERGES through
  // thinning flesh with no wound anywhere near it (the bareBones bypass), so
  // the wm gate alone would leave an exposed bone unidentified and it would
  // shade as meat — the exact pale-vs-red contrast the melt lives on lost.
  if ((wm > 0.0 || gInstMelt.x > 0.0 || gInstCounts2.y > 0.5) && hitBest >= 0) {
    hitMat = textureLoad(data, vec2<i32>(hitBest, ${ROW_PRIM_SCALE} + gBand), 0).w;
  }
  let isOrgan = hitMat > 4.5 && hitMat < 5.5;
  // W_BONE is 4 — the dominant row is a packed bone prim (bones still fold
  // under the default packBones-on layout). Only consulted by the melt ramp.
  let isBone = hitMat > 3.5 && hitMat < 4.5;
  if (isOrgan) {
    // Pale, wet, and NOT stained toward the meat: viscera is already wet
    // and already the same family of colour as the flesh around it. organAmp
    // 0 leaves albedo untouched, which is the off-state.
    albedo = mix(albedo, organColor, organAmp);
  }`;
