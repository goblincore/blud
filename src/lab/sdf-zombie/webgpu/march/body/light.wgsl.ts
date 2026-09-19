// src/lab/sdf-zombie/webgpu/march/body/light.wgsl.ts
//
// Phase-1 split of march.wgsl.ts (2026-09-18): march lighting tail.
// MOVE-ONLY: the WGSL text below is byte-identical to the original
// file; see docs/dev-notes/2026-09-18-march-split/.
import { DISPLAY_DEBUG_BLOCK } from './blocks/light/display-debug.wgsl';
import { COMPOSE_BLOCK } from './blocks/light/compose.wgsl';
import { AMBIENT_BLOCK } from './blocks/light/ambient.wgsl';
import { OCCLUSION_BLOCK } from './blocks/light/occlusion.wgsl';

export const MARCH_BODY_LIGHT = /* wgsl */ `  // Runtime normal out (MARCH_NORMAL_OUT): world-space unit n, before any early return below.
  // Run 5b: the normal attachment's alpha carries a per-body KEY (gInstCentre is the record's per-body centre, read from the
  // same record by the march and by the refine twin, so it compares exactly). +1 keeps it off the cleared 0.
  // No reader of the attachment consumes .w except the refine twin (pinned).
  let bodyKey = dot(gInstCentre, vec3<f32>(1.0, 7.31, 13.7)) + 1.0;
  gMarchNormal = vec4<f32>(normalize(n), bodyKey);
  // NORMAL-OUTPUT MODE (debugCfg.x == 9, neural upscale normals capture,
  // 2026-09-12). The final shading normal (after the face bump) in WORLD space,
  // depth in alpha exactly as the lit output, so the same readback and crop
  // apply. Read-back only, like the counters above; the capture script
  // (scripts/upscale-capture-v2.mjs) rotates it into view space. The runtime
  // stage gets normals from an MRT attachment later — this mode is the
  // TRAINING-side source and must compute the same n the lit path shades with.
  if (debugCfg.x > 8.5 && debugCfg.x < 9.5) {
    return vec4<f32>(normalize(n), t);
  }
  // ---- ANALYTIC FLASHLIGHT ----------------------------------------------
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
  // ---- END ANALYTIC FLASHLIGHT --------------------------------------------
  let V = -rd;
  let H = normalize(L + V);
  let diff = max(dot(n, L), 0.0);

  // wet, specPow and glow now live ABOVE the flashlight in
  // MARCH_BODY_SURFACE_PREP (the task-2 section split — see its header).
  // shine's exponent IS specPow, the legacy inline mix given a name; the
  // arithmetic is unchanged.
  let shine = pow(max(dot(n, H), 0.0), specPow);
  // Fresnel fades out INSIDE wounds rather than riding the wet boost: it is
  // environment rim-light, and inside a cavity the "environment" is the wound
  // itself. At full strength it maxes out on the grazing-heavy rim geometry,
  // the 1.6x wound wetness lands on top, and whole patches clip to white and
  // sweep across the cavity as the camera moves (X1.17). The wet glisten a
  // wound SHOULD have is the tight specular term, which keeps the boost.
  let fres = pow(1.0 - max(dot(n, V), 0.0), 4.0) * surfCfg.z * (1.0 - wmRim);

${OCCLUSION_BLOCK}

${AMBIENT_BLOCK}
${COMPOSE_BLOCK}

  // Each emission source fades the lit term by its own amount, mirroring the
  // face path's fleshLit * (1 - faceGlow): a surface that IS the light
  // should not ALSO carry the key's full diffuse on top — that add-then-clamp
  // is exactly how the face glow used to render pale cream (comment above).
  // At primGlow 0 the factor is exactly 1.0 — bit-identical to the old line
  // (multiplication by 1.0 is exact), so every non-glowing pixel everywhere
  // shades byte-for-byte as before.
  // gBurnEmit is 0 on every non-burning body, so this line is bit-identical to
  // the old one everywhere burn is off (adding 0.0 is exact).
  var lit = fleshLit * (1.0 - faceGlow) * (1.0 - primGlow) + glow + gBurnEmit;

${DISPLAY_DEBUG_BLOCK}

  return vec4<f32>(lit, t);
}`;
