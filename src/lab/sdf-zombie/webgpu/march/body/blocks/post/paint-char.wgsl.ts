// src/lab/sdf-zombie/webgpu/march/body/blocks/post/paint-char.wgsl.ts
//
// Task-3 split of the march body (2026-09-19): painted-prim albedo overwrite and char mix (post-hit material).
// MOVE-ONLY: spliced back into its parent string by interpolation, so the
// joined WGSL is byte-identical. See docs/dev-notes/2026-09-18-march-split/.

export const PAINT_CHAR_BLOCK = /* wgsl */ `  // PER-PRIMITIVE COLOUR. The fold already reports the nearest primitive at
  // the hit (hitBest, the noise anchor); a painted one replaces the flesh
  // albedo outright, mottle and face sheet included — a lens is not tinted
  // skin. The gloss/painted VALUES were resolved — and the row read, once —
  // up above calcNormal, where the noise suppression needs them; the
  // OVERWRITE itself stays HERE, after the face pass, because a painted
  // prim replaces everything the flesh passes laid down. Char still wins
  // below, because burnt is burnt.
  //
  // GLOW PRECEDENCE (hard-surface task 3): the eye-glow kill two lines down
  // applies to the FACE glow only — the baked sheet's own emission, which is
  // zeroed on paint for the same reason the sheet is: the painted eyes sit
  // exactly where a pair of sunglasses goes, and they must not shine through
  // the lenses. Per-prim glow (primGlow, primClip.w) is AUTHORED emission on
  // the prim itself, packed per prim, and deliberately SURVIVES this kill:
  // the whole point of glow= is a prim that emits — the minotaur's red eyes
  // — and those prims are painted (glow= is parse-gated on color=). The face
  // sheet under a painted prim contributes exactly what it always did here
  // (zero); the prim's own authored emission is a separate additive term at
  // the composite. Nothing in that kill reads primGlow, so the sunglasses
  // rule is intact BY CONSTRUCTION, not by a second kill that could drift.
  if (painted > 0.0) {
    albedo = primAlbedo;
  }
  faceGlow = faceGlow * (1.0 - painted);

  albedo = mix(albedo, charColor, cm);`;
