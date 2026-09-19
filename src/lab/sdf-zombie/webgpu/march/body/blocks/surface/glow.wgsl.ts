// src/lab/sdf-zombie/webgpu/march/body/blocks/surface/glow.wgsl.ts
//
// Task-3 split of the march body (2026-09-19): face and per-prim glow emission term.
// MOVE-ONLY: spliced back into its parent string by interpolation, so the
// joined WGSL is byte-identical. See docs/dev-notes/2026-09-18-march-split/.

export const GLOW_BLOCK = /* wgsl */ `  // The eye REPLACES the flesh rather than adding to it.
  //
  // This used to be a pure addition, and it could not produce a red eye. Lit
  // flesh is already bright — roughly (1.16, 0.60, 0.62) with the key on it —
  // so adding a red emissive on top gives something like (4.2, 0.62, 0.63).
  // The output sRGB encode then clamps red at 1.0 while lifting the low
  // channels hard (0.62 encodes to 0.81), and the eye lands at RGB(255, 206,
  // 208): a pale cream, with the red only visible where it spilled onto the
  // darker skin around the socket. Exactly the reported symptom.
  //
  // Fading the flesh out under the glow also matches what the GLSL header
  // always claimed — "an eye should not be lit by the key light at all" — a
  // statement the code never actually implemented.
  let glow = faceGlowColor * faceGlow * faceCfg2.w
           * flicker(faceCfg3.y, faceCfg3.x) * (1.0 - cm)
           // PER-PRIM GLOW (hard-surface task 3): the same two lines keyed
           // off the prim row instead of the face texture. The colour is the
           // prim's OWN albedo (design C — a prim with color=ff2200 glow=0.9
           // glows red because it IS red), the strength is the authored
           // 0..1 from primClip.w. No faceCfg2.w global (the authored value
           // IS the strength) and no flicker (that is the face sheet's
           // heartbeat). Char kills it exactly as it kills the face glow:
           // burnt is burnt.
           + primAlbedo * primGlow * (1.0 - cm);`;
