// src/lab/sdf-zombie/webgpu/march/body/blocks/surface/wet.wgsl.ts
//
// Task-3 split of the march body (2026-09-19): wetness, melt wetness and the shared specular exponent.
// MOVE-ONLY: spliced back into its parent string by interpolation, so the
// joined WGSL is byte-identical. See docs/dev-notes/2026-09-18-march-split/.

export const WET_BLOCK = /* wgsl */ `  // Wounds are wetter than the surrounding skin; char is dead matte. Gore
  // rides the same boost: bloody chunk regions glisten like open wounds.
  // gloss pulls a painted surface toward a tight, fully wet highlight
  // whatever the flesh preset says: a lens on a matte clay character still
  // has to glint.
  //
  // Wound pass r2: wetness peaks at the fat/muscle boundary — the lip
  // glistens, the floor does not — instead of wetting the whole crater
  // uniformly. At woundDepthAmp 0 tissueDepth is 0, so lip is 1 and
  // wetWound is exactly the old max(wm, gore): the amp-0 guarantee survives
  // this line. Bone is matte — wet skin reflects, wet bone just looks
  // polished.
  let lip = 1.0 - smoothstep(surfCfg3.z, surfCfg3.z * 3.0, tissueDepth);
  let wetWound = max(wm * lip, gore);
  let woundWetBoost = mix(1.6, 2.15, faceGlowRedOnly);
  var wet = mix(surfCfg2.x * mix(1.0, woundWetBoost, wetWound) * (1.0 - cm) * select(1.0, 1.8, isOrgan), 1.0, gloss);
  // Melt wetness (task 6): liquefying flesh goes FULLY wet — the puddle
  // glistens. FLESH ONLY: bone stays matte (the anchor comment above — wet
  // skin reflects, wet bone just looks polished), and that matte-vs-wet
  // contrast is what makes pale bones read inside the red puddle. The same
  // branch now covers a RUPTURING body's bare bones (bareBoneU), so exposed
  // ribs read matte there too.
  // 1.6, the wound-wetness precedent: 2.2 was the first guess and the
  // near-level capture showed the whole grazing-angle puddle clipping to
  // paper white — wet, yes; blown out, no.
  if (bonePaleU > 0.0) {
    wet = mix(wet, select(1.6, 0.45, isBone), bonePaleU);
  }
  // The legacy shine exponent, named so the lighting tail and the deferred
  // surface output share one definition: the surface's roughness inverts the
  // shared light pass's exponent mapping against exactly this value.
  let specPow = mix(mix(128.0, 4.0, surfCfg.y), 220.0, gloss);`;
