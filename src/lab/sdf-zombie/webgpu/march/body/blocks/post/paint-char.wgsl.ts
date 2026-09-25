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
  //
  // CLOTH REVEALS THE WOUND (cultist, 2026-09-23). The overwrite used to be
  // unconditional, so a crater whose nearest prim was painted showed the
  // PAINT all the way down: a shot robe hid its own wound. A painted prim is
  // cloth (or a lens, a shoe) — a hole in it should show what is under it.
  // wm (the one wound mask; do not add a second, see TISSUE_BLOCK) is ~0.35
  // at the crater lip (1 - smoothstep(0, 1.6r, r)), so:
  //   wm > ~0.36 ... inside the hole: keep the flesh/tissue albedo the
  //                  passes above laid down (the wound, as on bare skin);
  //   0.14..0.30 ... just outside the lip: the paint FRAYED — scorched to a
  //                  quarter of its value, a burnt edge round the hole;
  //   beyond ....... the paint, exactly as before (wm 0 -> bit-identical).
  // METAL is exempt: a plate is not cloth, and a crater in armour keeps its
  // steel. The same rule covers painted flesh (the cultist's robe-coloured
  // torso and sleeves) and shells, since both are "the cloth" to a player.
  if (painted > 0.0) {
    let clothy = 1.0 - metal;
    let reveal = smoothstep(0.30, 0.42, wm) * clothy;
    let fray = smoothstep(0.14, 0.30, wm) * (1.0 - reveal) * clothy;
    // A cloth BULLET HOLE (small calibre, gWoundHole — same footprint as wm)
    // shows DARK inside, a hole into shadow, not tissue: holeness is how much
    // of this pixel's wound mask belongs to a hole.
    let holeness = clamp(gWoundHole / max(wm, 1e-4), 0.0, 1.0);
    let inside = mix(albedo, vec3<f32>(0.012, 0.008, 0.006), holeness);
    albedo = mix(mix(primAlbedo, primAlbedo * 0.28, fray), inside, reveal);
    // CLOTH DECALS (soft targets, 2026-09-24; WOUND_MASK bit 2). Nothing is
    // carved: the robe is marked where the round went through.
    //   stain ... blood soaking out from a torn dark core (heavy rounds);
    //   mark .... a scorched ring round a dark bullet hole (small calibre).
    // Both masks peak at 1 on the hit and reach 0 at 1.6 x the radius, and
    // follow the ragged edge, so the core and the soak are not circles.
    let stain = gClothStain * clothy;
    let mark = gClothMark * clothy;
    albedo = mix(albedo, vec3<f32>(0.075, 0.008, 0.006), smoothstep(0.02, 0.55, stain) * 0.9);
    albedo = mix(albedo, albedo * 0.3, smoothstep(0.15, 0.45, mark));
    let core = max(smoothstep(0.80, 0.88, stain), smoothstep(0.55, 0.65, mark));
    albedo = mix(albedo, vec3<f32>(0.012, 0.008, 0.006), core);
  }
  faceGlow = faceGlow * (1.0 - painted);

  albedo = mix(albedo, charColor, cm);`;
