// src/lab/sdf-zombie/webgpu/fisheye.ts
//
// THE LENS. A radial magnifying warp applied at the canvas blit: the middle of
// the screen samples a small patch of the rendered frame (magnified, bulging)
// and the periphery samples a wide one (squeezed). Straight lines bend, which
// is the whole point.
//
// Everything is expressed in HALF-HEIGHT UNITS: a point at NDC (x, y) sits at
// q = (x * aspect, y), so the screen's vertical edge is at radius 1 and its
// corner at rmax = sqrt(aspect^2 + 1). Working here rather than in UV keeps
// the map circular on screen instead of elliptical.
//
//   sampleRadius(r) = r * (1 + k*r^2) / (1 + k*rmax^2)
//   k               = (tan(render/2) / tan(centre/2) - 1) / rmax^2
//
// Two properties do the load-bearing work, and both are pinned by tests:
//
//   * sampleRadius(r) <= r everywhere for k >= 0, so every sample lands inside
//     the source rect. NO BLACK CORNERS, at any aspect, by construction.
//   * sampleRadius(rmax) = rmax, so the corner is a fixed point. Pinning there
//     retains the most field a radial warp can. The MID-EDGES are still pulled
//     in — a radial map on a rectangle cannot keep both — which is why the
//     render FOV goes UP to pay for it. See visibleFovDeg().
//
// THIS FILE IS THE ONE DEFINITION. The blit shader (FISHEYE_WGSL, below) and
// the DOM reticle (reticleNdc) must agree on the curve to the pixel, so they
// import it rather than each spelling it out. If you edit one, edit the other
// in the same commit — fisheye.test.ts and post-aa.test.ts both guard it.

/** A lens resolved for one display aspect. `k = 0` is an exact identity. */
export interface Lens {
  /** Cubic coefficient of the radial map. 0 = off. */
  k: number;
  /** Corner radius in half-height units, sqrt(aspect^2 + 1). */
  rmax: number;
  /** The display aspect (width / height) this lens was built for. */
  aspect: number;
}

/** The owner-approved look: render 90 vertical, read 60 at screen centre. */
export const FISHEYE_DEFAULTS = {
  renderFovDeg: 90,
  centerFovDeg: 60,
} as const;

/** Half the screen diagonal, in half-height units. */
export function cornerRadius(aspect: number): number {
  return Math.hypot(aspect, 1);
}

/**
 * Build the lens. Both FOVs are VERTICAL degrees: `renderFovDeg` is what the
 * camera draws, `centerFovDeg` what the middle of the screen should read as.
 * A centre FOV that is not narrower than the render FOV yields k = 0 — the
 * off switch, and an exact identity rather than an approximate one.
 */
export function makeLens(
  renderFovDeg: number, centerFovDeg: number, aspect: number,
): Lens {
  const rmax = cornerRadius(aspect);
  const clampFov = (d: number) => Math.min(179, Math.max(1, d));
  const rf = clampFov(renderFovDeg);
  const cf = clampFov(centerFovDeg);
  if (cf >= rf) return { k: 0, rmax, aspect };
  const ratio = Math.tan((rf * Math.PI) / 360) / Math.tan((cf * Math.PI) / 360);
  return { k: (ratio - 1) / (rmax * rmax), rmax, aspect };
}

/** Forward map: the source radius a screen radius samples from. */
export function sampleRadius(r: number, lens: Lens): number {
  if (lens.k <= 0) return r;
  return (r * (1 + lens.k * r * r)) / (1 + lens.k * lens.rmax * lens.rmax);
}

/**
 * Inverse map: the screen radius at which source radius `s` appears. Content
 * moves OUTWARD, because the centre is magnified.
 *
 * Solves k*r^3 + r - C = 0 with C = s * (1 + k*rmax^2). The cubic is strictly
 * increasing and convex for k > 0, so Newton from r = C (always an
 * overestimate) converges monotonically in a handful of steps.
 */
export function screenRadius(s: number, lens: Lens): number {
  if (lens.k <= 0) return s;
  const c = s * (1 + lens.k * lens.rmax * lens.rmax);
  let r = c;
  for (let i = 0; i < 24; i++) {
    const step = (lens.k * r * r * r + r - c) / (3 * lens.k * r * r + 1);
    r -= step;
    if (Math.abs(step) < 1e-13) break;
  }
  return r;
}

/**
 * Where to DRAW a reticle that marks the true-frustum aim point `aim` (NDC,
 * -1..1 on both axes). The world moves under the crosshair when the lens is
 * on, so the crosshair has to move with it or it stops telling the truth.
 */
export function reticleNdc(
  aim: { x: number; y: number }, lens: Lens,
): { x: number; y: number } {
  if (lens.k <= 0) return { x: aim.x, y: aim.y };
  const qx = aim.x * lens.aspect;
  const qy = aim.y;
  const s = Math.hypot(qx, qy);
  if (s < 1e-9) return { x: 0, y: 0 };
  const scale = screenRadius(s, lens) / s;
  return { x: (qx * scale) / lens.aspect, y: qy * scale };
}

/**
 * The vertical FOV actually VISIBLE on screen, degrees — smaller than the
 * render FOV, because the warp pulls the vertical mid-edge (radius 1) in.
 * Reported by the __sdfGame seam so the knob can be tuned against what the
 * player sees rather than what the camera draws.
 */
export function visibleFovDeg(renderFovDeg: number, lens: Lens): number {
  const tanR = Math.tan((renderFovDeg * Math.PI) / 360);
  return (360 / Math.PI) * Math.atan(sampleRadius(1, lens) * tanR);
}

/**
 * The shader half of the same map, appended to the blit's WGSL. `lens` is
 * (k, rmax, aspect) — aspect is passed rather than derived from
 * textureDimensions, because under a 'fixed' cap the content target is
 * letterboxed and its dimensions are not the display aspect.
 *
 * Mirrors sampleRadius() exactly, as the ratio (1 + k*r^2)/(1 + k*rmax^2) so
 * no divide by r is needed at the centre.
 */
export const FISHEYE_WGSL = /* wgsl */ `
fn fisheyeWarp(st: vec2<f32>, lens: vec3<f32>) -> vec2<f32> {
  let k = lens.x;
  if (k <= 0.0) { return st; }
  let rmax = lens.y;
  let aspect = lens.z;
  let q = (st - vec2<f32>(0.5, 0.5)) * vec2<f32>(2.0 * aspect, 2.0);
  let r = length(q);
  if (r < 1.0e-6) { return st; }
  let scale = (1.0 + k * r * r) / (1.0 + k * rmax * rmax);
  let w = q * scale;
  return vec2<f32>(w.x / (2.0 * aspect), w.y * 0.5) + vec2<f32>(0.5, 0.5);
}`;
