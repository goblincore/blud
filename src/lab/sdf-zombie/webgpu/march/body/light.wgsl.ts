// src/lab/sdf-zombie/webgpu/march/body/light.wgsl.ts
//
// Phase-1 split of march.wgsl.ts (2026-09-18): march lighting tail.
// MOVE-ONLY: the WGSL text below is byte-identical to the original
// file; see docs/dev-notes/2026-09-18-march-split/.
import { FLASHLIGHT_BLOCK } from './blocks/light/flashlight.wgsl';
import { OCCLUSION_BLOCK } from './blocks/light/occlusion.wgsl';
import { AMBIENT_BLOCK } from './blocks/light/ambient.wgsl';
import { COMPOSE_BLOCK } from './blocks/light/compose.wgsl';
import { DISPLAY_DEBUG_BLOCK } from './blocks/light/display-debug.wgsl';

export const MARCH_BODY_LIGHT = /* wgsl */ `  // Runtime normal out (MARCH_NORMAL_OUT): world-space unit n, before any early return below.
  // Run 5b: the normal attachment's alpha carries a per-body KEY (gInstCentre is the record's per-body centre, read from the
  // same record by the march and by the refine twin, so it compares exactly). +1 keeps it off the cleared 0.
  // No reader of the attachment consumes .w except the refine twin (pinned).
  let bodyKey = dot(gInstCentre, vec3<f32>(1.0, 7.31, 13.7)) + 1.0;
  gMarchNormal = vec4<f32>(normalize(n), bodyKey);
  // MOTION VECTORS step 2: the object-motion attachment for temporal accumulation. Off (one branch)
  // unless the per-instance switch gInstMelt.y (meltCfg.y, spare until 2026-09-22) is set — the
  // layer sets it only while accumulation is on, so the ship path never pays for prevPosed.
  gMarchMotion = vec4<f32>(0.0);
  if (gInstMelt.y > 0.5) {
    let mvPrev = prevPosed(anchor, data, hitBest, gBand);
    if (mvPrev.w > 0.5) { gMarchMotion = vec4<f32>(mvPrev.xyz - p, 1.0); }
  }
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
  // MOTION-VECTOR VIEW (debugCfg.x == 16, 2026-09-22, MOTION-VECTORS-PLAN.md step 1): the hit
  // point's OBJECT motion since last frame, prevPosed(anchor) - p, in world metres, as colour:
  // 0.5 grey = still, each channel +-0.5 per 1/40 m (1.25 cm/frame = full swing: a walk at 60 fps
  // is ~1.7 cm/frame); magenta = no valid prev rows. Depth in alpha as mode 9. (debugCfg is a vec2 —
  // no spare lane for a gain uniform, so the gain is a literal.)
  if (debugCfg.x > 15.5 && debugCfg.x < 16.5) {
    let prev = prevPosed(anchor, data, hitBest, gBand);
    if (prev.w < 0.5) { return vec4<f32>(1.0, 0.0, 1.0, t); }
    return vec4<f32>(clamp(vec3<f32>(0.5) + (prev.xyz - p) * 40.0, vec3<f32>(0.0), vec3<f32>(1.0)), t);
  }
${FLASHLIGHT_BLOCK}
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
