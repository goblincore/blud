// src/lab/sdf-zombie/webgpu/temporal-start.ts
//
// TEMPORAL REPROJECTION START for the march (plan
// docs/superpowers/plans/2026-09-10-temporal-march-start.md). Last frame's
// hit depth at this screen position, unprojected with the inverse
// view-projection of the frame that wrote it, measured along the CURRENT
// ray, minus a margin for flesh that moved toward the camera and a slope
// term for the surface not being flat across the pixel. A fourth LOWER
// BOUND for the march's start, folded by max like the cone, hull and
// depth-prepass bounds; 0 is the identity, so every off path returns 0.
//
// The maths lives twice — temporalStart is the tested CPU twin of
// temporalStartFetch — and temporal-start.test.ts pins both.
import type * as THREE from 'three/webgpu';

export interface TemporalCfg {
  /** 1 = on; anything under 0.5 returns 0 (bit-identical march). */
  enabled: number;
  /** Metres subtracted from the reprojected distance: how far flesh may
   *  move TOWARD the camera in one frame. 0.25 m covers 7.5 m/s at 30 Hz. */
  margin: number;
  /** Fraction of the distance subtracted for surface slope across a pixel. */
  slope: number;
  /** Cap on the start, metres — a bad reprojection can never skip a body. */
  maxStart: number;
}

export const TEMPORAL_START_DEFAULTS: TemporalCfg = { enabled: 1, margin: 0.25, slope: 0.02, maxStart: 50 };

/**
 * Floor for the ADAPTIVE margin, metres — parked at the shipped constant
 * after the owner playtest (2026-09-10): 0.15 was pixel-clean on the frozen
 * closeup bisect but showed glitches in real play (motion, grazing
 * silhouettes, the field weave — none of which that static scene covers),
 * while the shipped 0.25 read clean. Floor == cap means the margin rides at
 * 0.25 and the measurement machinery is parked, live for a future attempt
 * with better scene coverage. Floor == cap also means the function below
 * returns the constant for every input; the tests pin exactly that.
 */
export const TEMPORAL_MARGIN_FLOOR = 0.25;

/**
 * The adaptive start margin for a measured worst-body translation of
 * `maxDisp` metres over one history interval (fresh frame to fresh frame,
 * measured by sdf-layer). 1.5x slack for inter-interval acceleration,
 * floored at TEMPORAL_MARGIN_FLOOR, capped at the shipped constant. With
 * floor == cap the margin is the shipped figure for every input (parked —
 * see TEMPORAL_MARGIN_FLOOR). Pure — the layer calls this per fresh frame.
 */
export function temporalMarginForMotion(maxDisp: number, cap = TEMPORAL_START_DEFAULTS.margin): number {
  return Math.min(cap, Math.max(TEMPORAL_MARGIN_FLOOR, 1.5 * maxDisp));
}

/**
 * The CPU twin. `d` is last frame's NDC depth at this pixel (>= 1 = nothing),
 * `ndc` the pixel's clip-space xy in [-1, 1] (convention-free: the caller
 * maps uv to ndc), `lastInvVp` the inverse view-projection of the frame that
 * wrote `d`, `camPos` / `rayDir` the CURRENT camera and unit ray.
 */
export function temporalStart(
  d: number,
  lastInvVp: THREE.Matrix4,
  ndc: [number, number],
  camPos: [number, number, number],
  rayDir: [number, number, number],
  cfg: TemporalCfg,
): number {
  if (cfg.enabled < 0.5 || d >= 1.0) return 0;
  const e = lastInvVp.elements; // column-major
  const x = ndc[0], y = ndc[1], z = d;
  const wx = e[0]! * x + e[4]! * y + e[8]! * z + e[12]!;
  const wy = e[1]! * x + e[5]! * y + e[9]! * z + e[13]!;
  const wz = e[2]! * x + e[6]! * y + e[10]! * z + e[14]!;
  const ww = e[3]! * x + e[7]! * y + e[11]! * z + e[15]!;
  if (Math.abs(ww) < 1e-12) return 0;
  const px = wx / ww - camPos[0], py = wy / ww - camPos[1], pz = wz / ww - camPos[2];
  const t = px * rayDir[0] + py * rayDir[1] + pz * rayDir[2];
  if (t <= 0) return 0;
  const start = t - cfg.margin - t * cfg.slope;
  return Math.min(cfg.maxStart, Math.max(0, start));
}

/**
 * The WGSL twin. `cfg = (enabled, margin, slope, maxStart)`. `ndc` is the
 * pixel's clip xy under the convention the layer was rendered with — the
 * caller (MARCH_BODY) derives it from screenUV; see the plan's flip note.
 * Returns vec2(start, t): .x is the CPU twin's value, .y the RAW reprojected
 * distance along the ray (0 on every off path) so the march can test whether
 * that point lies inside the body it is marching — the layer's depth is the
 * NEAREST body at the pixel, and a body behind it must not start past its
 * own surface (the 2026-09-10 see-through). Inputs stay comment-free: the
 * wgslFn parser reads `name: type` pairs.
 */
export const TEMPORAL_START_WGSL = /* wgsl */ `fn temporalStartFetch(
  lastTex: texture_2d<f32>,
  ndc: vec2<f32>,
  lastInvVp: mat4x4<f32>,
  camPos: vec3<f32>,
  rayDir: vec3<f32>,
  cfg: vec4<f32>
) -> vec2<f32> {
  if (cfg.x < 0.5) { return vec2<f32>(0.0, 0.0); }
  let dims = vec2<f32>(textureDimensions(lastTex, 0));
  let uv = vec2<f32>(ndc.x * 0.5 + 0.5, ndc.y * 0.5 + 0.5);
  let c = clamp(vec2<i32>(floor(uv * dims)), vec2<i32>(0, 0), vec2<i32>(dims) - vec2<i32>(1, 1));
  let d = textureLoad(lastTex, c, 0).a;
  if (d >= 1.0) { return vec2<f32>(0.0, 0.0); }
  let w = lastInvVp * vec4<f32>(ndc, d, 1.0);
  if (abs(w.w) < 1e-12) { return vec2<f32>(0.0, 0.0); }
  let p = w.xyz / w.w - camPos;
  let t = dot(p, rayDir);
  if (t <= 0.0) { return vec2<f32>(0.0, 0.0); }
  let start = t - cfg.y - t * cfg.z;
  return vec2<f32>(clamp(start, 0.0, cfg.w), t);
}`;
