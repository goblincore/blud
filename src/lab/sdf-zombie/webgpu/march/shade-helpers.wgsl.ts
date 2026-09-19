// src/lab/sdf-zombie/webgpu/march/shade-helpers.wgsl.ts
//
// Small shading helpers — texel fetch, soft shoulder, flicker and the
// level-only shadow lookup — split out of march.wgsl.ts (phase 1,
// move-only).

// Nearest-neighbour fetch by uv.
//
// textureLoad rather than textureSample, deliberately: the face sheet is
// authored as chunky NearestFilter art on both paths, so a sampler would buy
// nothing but a second binding to declare — and wgslFn's `sampler` parameter
// has no TSL node to feed it that the data-texture path already proves out.
// Clamp-to-edge is done here by hand, which is what the GLSL sampler's default
// wrap mode was doing implicitly.
export const TEXEL = /* wgsl */ `fn texel(tex: texture_2d<f32>, uv: vec2<f32>) -> vec4<f32> {
  let dims = vec2<f32>(textureDimensions(tex, 0));
  let c = clamp(vec2<i32>(floor(uv * dims)), vec2<i32>(0, 0), vec2<i32>(dims) - vec2<i32>(1, 1));
  return textureLoad(tex, c, 0);
}`;

// Irregular flicker. Three incommensurate sines rather than one, because a
// single sine reads as a machine pulsing and the eye picks the period out
// immediately; overlapping periods never quite repeat.
export const SOFT_SHOULDER = /* wgsl */ `fn softShoulder(x: f32, knee: f32) -> f32 {
  // Below the knee, identity — the whole midtone range is untouched, so a
  // body out of the beam shades exactly as it always did. Above it, compress
  // [knee, inf) into [knee, 1) with an exponential that is C1 at the join and
  // strictly monotonic, which is the property that matters here: monotonic
  // means two surfaces that differed in brightness still differ afterwards.
  // That is what keeps a wound crater darker than the skin around it when the
  // flashlight is pointed straight at the body, instead of both clipping to
  // white and the damage vanishing at exactly the range you aim from.
  if (x <= knee) { return x; }
  let head = max(1.0 - knee, 1e-4);
  return knee + head * (1.0 - exp(-(x - knee) / head));
}`;

export const FLICKER = /* wgsl */ `fn flicker(t: f32, amt: f32) -> f32 {
  let a = sin(t * 11.3) * 0.5 + 0.5;
  let b = sin(t * 23.7 + 1.3) * 0.5 + 0.5;
  let c = sin(t * 3.1 + 0.7) * 0.5 + 0.5;
  let f = a * 0.35 + b * 0.25 + c * 0.40;
  // Biased upward so it mostly burns and only occasionally dips, rather than
  // spending half its time dark.
  return mix(1.0, 0.45 + f * 0.75, amt);
}`;

// Level-only shadow map lookup (perf round 2 task 7). cfg = (enabled,
// normalBias m, depthBias, spare). The map comes from a twin spotlight that
// renders layer 0 only, so a body never sees its own hull in it. The
// projection is three's `shadow.matrix` (bias * proj * view), whose output
// is [0,1] uv with depth in .z — the same contract three's own ShadowNode
// samples. 4-tap PCF on the texel grid; the owner's PSX look wants soft
// edges, not hard ones.
export const LEVEL_SHADOW = /* wgsl */ `fn levelShadow(p: vec3<f32>, n: vec3<f32>, shadowTex: texture_depth_2d, shadowMat: mat4x4<f32>, cfg: vec4<f32>) -> f32 {
  if (cfg.x < 0.5) { return 1.0; }
  let sp = shadowMat * vec4<f32>(p + n * cfg.y, 1.0);
  let uv = sp.xy / sp.w;
  let z = sp.z / sp.w - cfg.z;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0 || z > 1.0) { return 1.0; }
  let dims = vec2<f32>(textureDimensions(shadowTex, 0));
  let base = uv * dims - vec2<f32>(0.5, 0.5);
  var lit = 0.0;
  for (var dy = 0; dy < 2; dy = dy + 1) {
    for (var dx = 0; dx < 2; dx = dx + 1) {
      let c = clamp(vec2<i32>(floor(base)) + vec2<i32>(dx, dy), vec2<i32>(0, 0), vec2<i32>(dims) - vec2<i32>(1, 1));
      let d = textureLoad(shadowTex, c, 0);
      lit = lit + select(0.0, 1.0, z <= d);
    }
  }
  return lit * 0.25;
}`;
