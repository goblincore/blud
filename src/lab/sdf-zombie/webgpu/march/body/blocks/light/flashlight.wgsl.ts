// src/lab/sdf-zombie/webgpu/march/body/blocks/light/flashlight.wgsl.ts
//
// Task-3 split of the march body (2026-09-19): analytic flashlight.
// MOVE-ONLY: spliced back into its parent string by interpolation, so the
// joined WGSL is byte-identical. See docs/dev-notes/2026-09-18-march-split/.

export const FLASHLIGHT_BLOCK = /* wgsl */ `  // ---- ANALYTIC FLASHLIGHT ----------------------------------------------
  // The world's SpotLight is invisible to the march — SDF bodies are shaded
  // here, not by three — so the beam is re-evaluated analytically per pixel.
  //
  // PER-PIXEL, not per-body, so the cone edge cuts ACROSS a figure instead of
  // the whole zombie popping on at once.
  //
  // ZERO field taps: a normalise, two dots and a divide. This is the
  // constraint that let character self-shadowing be cut rather than paid for.
  //
  // It drives L and keyColor — NOT albedo. ambientAt renormalises bounce to
  // unit luminance, so an albedo boost would change hue and leave brightness
  // untouched. Brightness must ride the key.
  var L = normalize(lightDir);
  var keyC = keyColor;
  var keyI = lightCfg.x;
  var beamAmt = 0.0;
  if (spotCfg.x > 0.0) {
    let toLamp = spotPos - p;
    let dist = length(toLamp);
    let Ls = toLamp / max(dist, 1e-4);
    let cone = dot(-Ls, normalize(spotAxis));
    let coneFall = clamp((cone - spotCfg.z) / max(spotCfg.y - spotCfg.z, 1e-4), 0.0, 1.0);
    let distFall = clamp(1.0 - dist / max(spotCfg.w, 1e-4), 0.0, 1.0);
    let beam = coneFall * coneFall * distFall * distFall * spotCfg.x;
    // Blend the key TOWARD the beam. At beam 0 this is exactly the old key,
    // which keeps the lab and every existing preset bit-identical.
    L = normalize(mix(L, Ls, clamp(beam, 0.0, 1.0)));
    keyC = mix(keyColor, spotColor, clamp(beam, 0.0, 1.0));
    // spotCfg2.x is the beam's KEY GAIN, a live knob. The 2.2 it replaces
    // blew a lit body clean past 1.0 on every channel, and a clipped
    // body has no wound in it: crater, lip and char all saturate to the
    // same white. See the shoulder below.
    // THE BEAM IS THE KEY, NOT A BONUS ON TOP OF IT (spotCfg2.z).
    //
    // This used to be lightCfg.x + beam*gain, which left the preset's own key
    // — 2.4 for practical-hard-key — burning at full strength from a fixed
    // direction that nothing could switch off. So a character standing in an
    // unlit corridor was still brightly lit from nowhere (owner, 2026-09-01:
    // "the unlit characters seem still to be lit ... bright in the darkness
    // without light"). In a dungeon the lamp you carry has to be the reason a
    // body is visible.
    //
    // spotCfg2.z is what survives of the preset key when the beam is off: a
    // floor, not a fill. It is NOT zero on purpose — ambientAt carries hue
    // rather than brightness (bounce is renormalised to unit luminance), so a
    // character lit by nothing but bounce has no level at all and disappears
    // completely rather than reading as a shape in the dark.
    keyI = lightCfg.x * spotCfg2.z + beam * spotCfg2.x;
    beamAmt = beam;
  }
  // ---- END ANALYTIC FLASHLIGHT --------------------------------------------`;
