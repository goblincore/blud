// src/lab/sdf-zombie/webgpu/march/body/blocks/post/prim-material.wgsl.ts
//
// Task-3 split of the march body (2026-09-19): per-primitive material read (post-hit).
// MOVE-ONLY: spliced back into its parent string by interpolation, so the
// joined WGSL is byte-identical. See docs/dev-notes/2026-09-18-march-split/.
import { ROW_PRIM_CLIP, ROW_PRIM_COLOR, ROW_PRIM_SHAPE } from '../../../layout';

export const PRIM_MATERIAL_BLOCK = /* wgsl */ `  // PER-PRIMITIVE MATERIAL READ — hoisted above the noise (hard-surface
  // task 1). gloss must be known BEFORE the shading normal exists: both
  // flesh-noise paths below scale by (1 - gloss), because a polished prim
  // has no pores. This is the SAME single texel the per-prim colour block
  // below used to read (hitBest row, ROW_PRIM_COLOR) — hoisted, not
  // repeated, so no hit pixel pays for it twice. hitBest is -1 on the
  // baked-volume path; there gloss stays 0 and every noise term runs at
  // full flesh amplitude exactly as before.
  // METAL (task 2) rides the same hoist: prof bit 4 (16), read off
  // ROW_PRIM_SHAPE only inside the painted branch (metal is parse-gated on
  // color=, so an unpainted pixel can never change the answer — one extra
  // texel load on painted hit pixels only). metal implies the same noise
  // suppression with no gloss set: a machined surface has no pores either,
  // so both sites below take (1 - max(gloss, metal)).
  var gloss = 0.0;
  var painted = 0.0;
  var metal = 0.0;
  var primGlow = 0.0;
  var primAlbedo = vec3<f32>(0.0);
  if (hitBest >= 0) {
    let PC = textureLoad(data, vec2<i32>(hitBest, ${ROW_PRIM_COLOR} + gBand), 0);
    if (PC.w > 0.0) {
      primAlbedo = PC.xyz;
      gloss = clamp(PC.w - 1.0, 0.0, 1.0);
      painted = 1.0;
      let PS = textureLoad(data, vec2<i32>(hitBest, ${ROW_PRIM_SHAPE} + gBand), 0);
      if ((i32(PS.y) & 16) != 0) { metal = 1.0; }
      // GLOW (hard-surface task 3): primClip.w, the lane that was documented
      // spare until now. Loaded ONLY inside the painted branch — glow is
      // parse-gated on color=, so an unpainted pixel can never author one,
      // and this is the third texel a painted hit pixel pays for (colour,
      // shape, clip) and the last.
      primGlow = clamp(textureLoad(data, vec2<i32>(hitBest, ${ROW_PRIM_CLIP} + gBand), 0).w, 0.0, 1.0);
    }
  }`;
