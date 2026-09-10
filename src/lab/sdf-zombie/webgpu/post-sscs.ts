// src/lab/sdf-zombie/webgpu/post-sscs.ts
//
// SSCS — screen-space contact shadows, the cheap "screen buffer" half of the
// 2026-09-09 shadow-continuity work. The flashlight's shadow map casts the
// INFLATED SPHERE-CHAIN hull (occluder-hull.ts), not the visible body, so
// right where a character meets a wall or the floor the cast shadow can
// detach from the silhouette (proxy coarseness, a hold-frame pose lag, a
// socket-pop). This pass closes that gap by occluding against the CAPTURE'S
// OWN DEPTH: for each level pixel it walks a short ray toward the flashlight
// through the depth buffer, and darkens where the ray is blocked. The
// occluder is the rendered silhouette itself, so the contact region reads
// exactly like the body on screen — no proxy, no lag, no pop — while the
// shadow map keeps owning everything beyond the short ray range.
//
// Boundaries (read before tuning):
//   * LEGACY PATH ONLY. The flesh mask is the legacy march target's
//     depth-in-alpha (marchTarget), which field modes repurpose at half
//     height and deferred replaces with its own G-buffer; game-main enables
//     the stage only on the legacy non-field path.
//   * It is a CONTACT term, not a shadow map: range caps at SSCS_DEFAULTS
//     .maxDist metres from the receiver, so a zombie two metres off a wall
//     still gets its wall shadow from the hull proxy. The strength cap keeps
//     it reading as contact occlusion layered under the shadow map rather
//     than a second key light.
//   * The flashlight is treated as a POINT for the ray direction; the spot
//     cone is ignored, so pixels outside the cone also darken. Where the
//     flashlight does not light, darkening a dark pixel is invisible —
//     accepted to keep the pass free of spot-axis uniforms.
//   * WGSL, three wgslFn conventions as post-vhs.ts documents: the main fn
//     is FIRST in the string (three anchors its parse at ^), helpers follow,
//     and every target-bound pass here samples its entry at (x, 1-y) so
//     sscsTarget holds the capture's orientation (post-aa ORIENTATION note).
//   * All depth/colour taps are textureLoad — the capture target is
//     NearestFilter, so no sampler binding exists to use.
//   * Occluders are NOT depth-discriminated: a level pillar blocks light
//     exactly as a zombie does, which makes this pass also a subtle contact
//     AO for the level's own crevices. Measured, not speculative — judge it
//     on captures with ?sscs=off as the control.

/** Live tuning terms, mirrored by SSCS_TERM_RANGES clamps. */
export interface SscsTerms {
  /** Peak darkening fraction at full occlusion (0.35 = −35% light). */
  strength: number;
  /** How far (view metres) the ray marches toward the light. */
  maxDist: number;
  /** Depth tolerance (view metres) — samples closer than the ray by less
   *  than this are the receiver's own surface, not occluders. */
  bias: number;
}

export type SscsTermName = keyof SscsTerms;

export const SSCS_DEFAULTS: SscsTerms = {
  strength: 0.35,
  maxDist: 0.8,
  bias: 0.02,
};

export const SSCS_TERM_RANGES: Record<SscsTermName, readonly [number, number]> = {
  strength: [0, 0.8],
  maxDist: [0.1, 2],
  bias: [0, 0.1],
};

/** Fixed tap count. Eight steps over 0.8 m is 10 cm resolution — coarse, but
 *  the occluder here is a whole-body silhouette, not a thin limb, and the
 *  count directly IS the per-pixel cost of the pass. */
export const SSCS_STEPS = 8;

/**
 * The SSCS fragment shader.
 *
 * Parameters (bound positionally by three's wgslFn — order is load-bearing):
 *   tex      — the post-aa capture (sceneTarget colour, working space).
 *   depthTex — the capture's depth attachment as a sampleable DepthTexture
 *              (the fieldFull precedent; an attachment alone is not
 *              readable). WebGPU clip z, 0..1, 1 = cleared/far.
 *   fleshTex — the legacy march target. Its alpha carries the traced clip
 *              depth with >= 1.0 = "no march hit" (sdf-layer's clear
 *              sentinel), so alpha < 1 marks a body pixel.
 *   uv       — the quad's uv, flipped once below per the ORIENTATION note.
 *   vp/invVp — this frame's view-projection and its inverse (Matrix4
 *              uniforms, fed per frame by setSscsFrame).
 *   light    — xyz: the flashlight position; w: the strength term.
 *   cfg      — x: camera near, y: camera far, z: maxDist, w: bias.
 *
 * Returns the capture colour multiplied by the contact term, alpha 1 (the
 * blend/blit contract).
 */
export const POST_SSCS_WGSL = /* wgsl */ `fn postSscs(
  tex: texture_2d<f32>,
  depthTex: texture_depth_2d,
  fleshTex: texture_2d<f32>,
  uv: vec2<f32>,
  vp: mat4x4<f32>,
  invVp: mat4x4<f32>,
  light: vec4<f32>,
  cfg: vec4<f32>
) -> vec4<f32> {
  // Entry flip: this pass's target-bound write inverts Y, so sampling the
  // capture orientation keeps the module invariant (see post-aa.ts).
  let tc = vec2<f32>(uv.x, 1.0 - uv.y);
  let dims = vec2<f32>(textureDimensions(tex, 0));
  let maxP = vec2<i32>(i32(dims.x) - 1, i32(dims.y) - 1);
  let pix = clamp(vec2<i32>(floor(tc * dims)), vec2<i32>(0, 0), maxP);
  let base = textureLoad(tex, pix, 0).rgb;

  // No drawn geometry under this pixel (depth cleared to far): nothing to
  // ground, nothing to darken.
  let clipZ = textureLoad(depthTex, pix, 0);
  if (clipZ >= 1.0) { return vec4<f32>(base, 1.0); }
  // Marched flesh never self-darkens: alpha >= 1 is the march's "no hit"
  // sentinel, so alpha < 1 is a body pixel, and the caster does not pay its
  // own shadow term (the hull shadow map already excludes it the same way).
  let flesh = textureLoad(fleshTex, pix, 0);
  if (flesh.w < 1.0) { return vec4<f32>(base, 1.0); }
  // The pass's own off switch — a zero strength is an exact passthrough.
  if (light.w <= 0.0) { return vec4<f32>(base, 1.0); }

  // Pixel -> world, exactly the composite's convention: ndc from the capture
  // orientation (sdf-layer COMPOSITE_WGSL), then through the inverse of this
  // frame's view-projection.
  let ndc = vec3<f32>(tc.x * 2.0 - 1.0, 1.0 - tc.y * 2.0, clipZ);
  let world4 = invVp * vec4<f32>(ndc, 1.0);
  let world = world4.xyz / world4.w;

  let toLight = light.xyz - world;
  let dist = length(toLight);
  if (dist < 1e-4) { return vec4<f32>(base, 1.0); }
  let dir = toLight / dist;
  let stepLen = min(dist, cfg.z) / ${SSCS_STEPS}.0;

  var hits = 0.0;
  for (var i = 1; i <= ${SSCS_STEPS}; i = i + 1) {
    let sp = world + dir * (stepLen * f32(i));
    let clip = vp * vec4<f32>(sp, 1.0);
    if (clip.w <= 0.0) { break; }
    let sNdcXy = clip.xy / clip.w;
    if (max(abs(sNdcXy.x), abs(sNdcXy.y)) > 1.0) { continue; }
    let st = vec2<f32>((sNdcXy.x + 1.0) * 0.5, (1.0 - sNdcXy.y) * 0.5);
    let spix = clamp(vec2<i32>(floor(st * dims)), vec2<i32>(0, 0), maxP);
    let sClip = textureLoad(depthTex, spix, 0);
    if (sClip >= 1.0) { continue; }
    // Clip depths -> view metres (the march's own unproject, zombie-gpu
    // prevFetch), so the bias is a distance in metres rather than a clip
    // unit that swings nonlinearly with range.
    let rayZ = (cfg.x * cfg.y) / (cfg.y - (clip.z / clip.w) * (cfg.y - cfg.x));
    let smpZ = (cfg.x * cfg.y) / (cfg.y - sClip * (cfg.y - cfg.x));
    if (rayZ - smpZ > cfg.w) { hits = hits + 1.0; }
  }

  // Saturate at three hits: a pixel whose short ray is mostly blocked reads
  // fully occluded; the tap distribution over a silhouette gives the
  // penumbra for free.
  let occ = min(hits / 3.0, 1.0);
  let k = 1.0 - occ * light.w;
  return vec4<f32>(base * k, 1.0);
}`;
