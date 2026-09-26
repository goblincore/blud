// src/lab/sdf-zombie/webgpu/march/body/blocks/light/compose.wgsl.ts
//
// Task-3 split of the march body (2026-09-19): metal tint, muzzle flash, lit compose, face flat-lit, highlight shoulder.
// MOVE-ONLY: spliced back into its parent string by interpolation, so the
// joined WGSL is byte-identical. See docs/dev-notes/2026-09-18-march-split/.

export const COMPOSE_BLOCK = /* wgsl */ `  // HIGHLIGHT SHOULDER (spotCfg2.y). A body standing in the beam used to run
  // past 1.0 on every channel and hard-clip, which does not just look blown —
  // it DELETES the wounds: crater, lip, char and clean skin all clamp to the
  // same white, so a shot enemy reads identical to an unshot one exactly when
  // you are close enough to aim. The shoulder compresses [knee, inf) into
  // [knee, 1) monotonically, so those differences survive as differences.
  //
  // Gated on the beam existing at all, so the lab and every stock preset keep
  // their old arithmetic bit-for-bit.
  //
  // METAL (hard-surface task 2), at metal 1:
  //  - the whole diffuse FAMILY (ambient bounce + key diffuse) scales to a
  //    0.45 floor — bounce IS diffuse, and leaving it full would keep the
  //    plate reading as paint. NOT zero: with no environment map the lab
  //    has one key, and a true-zero diffuse goes black wherever the
  //    highlight is not. Rendered curve, 2026-09-03 (12-frame turntable,
  //    front and plate-bearing yaws): 0.25 went BLACK at the front yaw;
  //    0.35 kept the slab forms but the front still read near-black; 0.45
  //    keeps the greave's specular gradient AND a readable front face. 0.45
  //    ships; the owner can pull it darker now that the word exists.
  //  - the specular AND the fresnel rim are tinted by the prim's own
  //    albedo instead of shining the light's colour — the single change
  //    that makes steel differ from white plastic under the same light.
  //    The tint is the albedo's HUE with its luminance renormalised to
  //    steel's F0: multiplying by the RAW albedo (this line's first
  //    version) rendered the minotaur's plates BLACK — 0.17 linear
  //    luminance times the highlight is no highlight (frame-00 A/B,
  //    2026-09-03). Polished steel reflects ~56% at normal incidence
  //    however dark its paint reads (iron F0 = 0.56, standard metals
  //    table), so the scale renormalises luminance, and the min() caps the
  //    blow-up on near-black paint (dark chrome should stay dark).
  //  - wet, scatter and the wound terms are untouched: scope discipline,
  //    and the floor above keeps the plate readable without them.
  // At metal 0 both factors are exactly 1.0 — bit-identical to the old sum
  // (multiplication by 1.0 is exact), so every non-metal character shades
  // byte-for-byte as before.
  // (Task 3's merge removed a STALE duplicate of this block left by task 2's
  // tuning pass — it claimed the 0.25 floor this curve superseded.)
  //
  // THE mix() IS LEAD, NOT TRIM (regression fixed 2026-09-04). The sentence
  // above was the INTENT; for one merge the tint below did not implement it.
  // It shipped as the bare min(), and primAlbedo is vec3(0) on every
  // UNPAINTED pixel — flesh never enters the 'PC.w > 0.0' branch that fills
  // it. So metalTintLum sat on its 1e-3 floor, the tint evaluated to vec3(0),
  // and it multiplied the ENTIRE specular + fresnel line to nothing: every
  // zombie lost its highlight and its rim at once, in the lab and in the
  // game. The diagnostic tell is that the specular slider went dead — surfCfg.x
  // lives inside those parentheses, so nothing it does survives a zero
  // common factor.
  //
  // Gate it the same way the diffuse floor beside it is gated. A PAINTED
  // non-metal wants the untinted white highlight too (polished plastic, not
  // coloured chrome), which 'metal' - not 'painted' - is exactly the flag for.
  let metalTintLum = max(dot(primAlbedo, vec3<f32>(0.2126, 0.7152, 0.0722)), 1e-3);
  let metalTint = mix(vec3<f32>(1.0), min(primAlbedo * (0.56 / metalTintLum), vec3<f32>(1.5)), metal);
  // DIRECT MUZZLE FLASH (owner, 2026-09-09: "the soldier's flash should light
  // them up briefly"). The nearest burning muzzle — this body's own or a
  // neighbour's, the game picks the strongest by I/d² — as a warm point
  // light with a 0.2 m floor on the distance so a muzzle against the flesh
  // does not blow it out. bodyFlash.w = 0 skips it: bit-identical.
  var flashDirect = vec3<f32>(0.0, 0.0, 0.0);
  if (gInstFlash.w > 0.0) {
    let fv = gInstFlash.xyz - p;
    let fd2 = max(dot(fv, fv), 0.04);
    let fl = fv * inverseSqrt(fd2);
    flashDirect = vec3<f32>(1.0, 0.72, 0.45) * (gInstFlash.w * max(dot(n, fl), 0.0) / fd2);
  }
  // THE RIM FOLLOWS THE LIGHT in the dungeon (owner, 2026-09-26: "turn off the fresnel rim so
  // they don't look outlined in the dark"): fresnel is an environment term, and in the dark there
  // is no environment. It scales with the key (the beam, a flash); the lab (spotCfg.x = 0) keeps it.
  let rimLit = select(1.0, clamp(keyI, 0.0, 1.0), spotCfg.x > 0.0);
  var fleshLit = albedo * (amb + flashDirect + diff * wShadow * lvl * keyI * keyC) * ao * mix(1.0, 0.45, metal)
               // * woundGlint: MEAT DETAIL (soldierWound block) — the wet highlight broken into glints,
               // soldier wounds only; applied at the consumer so the hoisted wet statement stays pinned.
               + metalTint * keyC * (shine * wShadow * lvl * mix(surfCfg.x, 1.5, gloss) + fres * rimLit * mix(1.0, 2.5, gloss)) * wet * mix(1.0, woundGlint, soldierWound)
               + scatter;
  // FLAT-LIT decal: where the baked face covers the surface, relight it with
  // a fixed favourable diffuse and no AO/spec/fresnel — the image carries its
  // own shading, and real shading on top drew hard shadow lines from the
  // fringe and killed the mouth on the down-sloping jaw. 0.85 keeps a whisper
  // of real light so the head still turns.
  //
  // The DIFFUSE CONSTANT was 0.52 and is 0.30 (2026-09-04). At 0.52 the decal
  // rendered effectively UNLIT: measured on the soldier, face #cc9f69 --
  // almost exactly his raw atlas skin -- against a correctly-lit body at
  // #954821, a 1.83x mismatch that read as a pale card stuck on the head.
  // 0.30 brings it to 1.22x, about right for a face catching light. The 0.85
  // MIX is deliberately untouched: that is what keeps the fringe shadow off
  // the mouth, which is the failure this comment records. Swept for
  // regressions -- the zombie sits at 1.18x face/torso, contrast sd 41.4.
  fleshLit = mix(fleshLit,
                 albedo * (amb + 0.30 * lightCfg.x * keyColor),
                 faceFlat * 0.85);
  if (spotCfg.x > 0.0 && spotCfg2.y > 0.0) {
    let knee = clamp(1.0 - spotCfg2.y, 0.05, 0.99);
    fleshLit = vec3<f32>(softShoulder(fleshLit.x, knee),
                         softShoulder(fleshLit.y, knee),
                         softShoulder(fleshLit.z, knee));
  }`;
