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
  // depth or radius. W_BONE is 4, W_ORGAN is 5.
  //
  // BONE ALBEDO, RESTORED (head damage spec §14, 2026-09-28). 00194a001
  // deleted the bone branch below as dead code when bone tubes landed, but
  // the tubes stayed off by default: packBones stayed ON wherever the
  // procedural skeleton is drawn (?skeleton=procedural, every deferred-mode
  // actor, and every marched flesh chunk), so bone rows kept winning the fold
  // inside craters and shaded as plain meat — the procedural crown after a
  // scalp hit read 0.0036 bone share before and after. Restored as deleted
  // (the stain toward the meat, and the matte gloss in the wet block) with ONE
  // change: the stain weight is 0.22, not 0.55. The skull sits inside the
  // 0.012 m junction band everywhere, so at 0.55 the whole plate took the full
  // stain and read red-brown (crown bone share still 0.0036 -> 0.0036); 0.22
  // is the mesh skeleton's head stain strength (meshBoneSurface), and reads
  // tan (0.0036 -> 0.0159). Deep limb bone sits past the band and is clean
  // either way. The mesh skeleton path packs no bone rows on its ACTORS, so
  // its bodies never reach this branch; its marched flesh chunks still pack
  // bone rows (detached pieces keep procedural bones) and take it too.
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
  let isBone = hitMat > 3.5 && hitMat < 4.5;
  if (isBone) {
    // Stained toward the meat at the junction. A clean plate popping out of
    // red flesh reads as a decal; blood in the transition is what seats it.
    // tissueDepth is the PRE-wound flesh field, so on a bone pixel it measures
    // how deeply this bone sits beneath the original skin: bone just under
    // the muscle line is near the wall flesh and stains, a deep plate stays
    // clean.
    let boneStain = 1.0 - smoothstep(0.0, 0.012, tissueDepth - surfCfg3.z);
    albedo = mix(boneColor, deepColor * 0.8, clamp(boneStain, 0.0, 1.0) * 0.22);
  }
  // Organs share the load and the gate; only the code differs (organs r3).
  let isOrgan = hitMat > 4.5 && hitMat < 5.5;
  if (isOrgan) {
    // Pale, wet, and NOT stained toward the meat: viscera is already wet
    // and already the same family of colour as the flesh around it. organAmp
    // 0 leaves albedo untouched, which is the off-state.
    albedo = mix(albedo, organColor, organAmp);
  }`;
