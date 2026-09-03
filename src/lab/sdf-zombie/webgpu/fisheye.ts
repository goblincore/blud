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
// The two centre guards below (JS 1e-9, WGSL 1.0e-6) are a deliberate
// exception to that pairing, not a drift to fix — see FISHEYE_WGSL's doc.
//
// A SECOND radial warp lives at src/vfx/post-fx/barrel-pass.ts, for the
// WebGL path (src/main.ts). That is not duplication to fold in here: it
// belongs to a different renderer stack, and its map is strictly worse for
// this job — it clamps out-of-range samples to black, which is exactly the
// failure this module eliminates by construction (see the corner-pinning
// property above).

/** A 2D point in normalised device coordinates, -1..1 on both axes. */
export interface Ndc {
  x: number;
  y: number;
}

/**
 * A lens resolved for one display aspect and one render FOV. `k = 0` is an
 * exact identity.
 */
export interface Lens {
  /** Cubic coefficient of the radial map. 0 = off. */
  k: number;
  /** Corner radius in half-height units, sqrt(aspect^2 + 1). */
  rmax: number;
  /**
   * The display aspect (width / height) this lens was built for. Must be
   * strictly positive: 0 divides by zero in reticleNdc/warpUv, and a
   * negative value mirrors the reticle.
   */
  aspect: number;
  /**
   * The render FOV actually used to build this lens, in vertical degrees,
   * AFTER makeLens's [1, 179] clamp — not the raw value the caller passed
   * in. Carried on the lens (rather than left for the caller to remember
   * and re-supply) so visibleFovDeg cannot be handed a stale or mismatched
   * FOV by a seam that stores its own copy elsewhere.
   */
  renderFovDeg: number;
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
 * Clamp a FOV in degrees to [1, 179] — 0/180 degenerate the tangent. Does
 * NOT guard against NaN: `Math.max(1, NaN)` is `NaN`, so a NaN FOV passes
 * straight through unchanged. That is the caller's to avoid, not this
 * function's — see makeLens below and the call sites in game-main.ts.
 */
export function clampFovDeg(deg: number): number {
  return Math.min(179, Math.max(1, deg));
}

/**
 * Build the lens. Both FOVs are VERTICAL degrees: `renderFovDeg` is what the
 * camera draws, `centerFovDeg` what the middle of the screen should read as.
 * A centre FOV that is not narrower than the render FOV yields k = 0 — the
 * off switch, and an exact identity rather than an approximate one.
 *
 * Both FOVs are clamped (clampFovDeg) before use — a runtime tuning seam can
 * hand this a value with no upstream validation of its own. See
 * clampFovDeg's own doc for the NaN caveat, which applies here unchanged.
 */
export function makeLens(
  renderFovDeg: number, centerFovDeg: number, aspect: number,
): Lens {
  const rmax = cornerRadius(aspect);
  const rf = clampFovDeg(renderFovDeg);
  const cf = clampFovDeg(centerFovDeg);
  if (cf >= rf) return { k: 0, rmax, aspect, renderFovDeg: rf };
  const ratio = Math.tan((rf * Math.PI) / 360) / Math.tan((cf * Math.PI) / 360);
  return { k: (ratio - 1) / (rmax * rmax), rmax, aspect, renderFovDeg: rf };
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
 * overestimate) converges monotonically. The real exit is the `1e-13` step
 * tolerance, reached in a handful of iterations for every case this module
 * exercises; `24` is not the expected iteration count, it is an unreachable
 * safety stop against a stalled loop.
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
export function reticleNdc(aim: Ndc, lens: Lens): Ndc {
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
 * player sees rather than what the camera draws. Reads `renderFovDeg` off
 * the lens itself, rather than taking it as a second argument, so this
 * report cannot silently drift from the FOV the lens was actually built
 * with.
 */
export function visibleFovDeg(lens: Lens): number {
  const tanR = Math.tan((lens.renderFovDeg * Math.PI) / 360);
  return (360 / Math.PI) * Math.atan(sampleRadius(1, lens) * tanR);
}

/**
 * The JS half of the UV<->half-height conversion that wraps sampleRadius in
 * FISHEYE_WGSL. This is the EXECUTABLE MIRROR of that shader function — it
 * exists so the UV<->radius plumbing (not just the radial curve itself) has
 * a test-covered JS twin, not because production code calls it; the blit
 * calls the WGSL directly. `st` is a UV coordinate, 0..1 on both axes.
 */
export function warpUv(st: Ndc, lens: Lens): Ndc {
  if (lens.k <= 0) return { x: st.x, y: st.y };
  const qx = (st.x - 0.5) * 2 * lens.aspect;
  const qy = (st.y - 0.5) * 2;
  const r = Math.hypot(qx, qy);
  if (r < 1e-6) return { x: st.x, y: st.y };
  const scale = (1 + lens.k * r * r) / (1 + lens.k * lens.rmax * lens.rmax);
  const wx = qx * scale;
  const wy = qy * scale;
  return { x: wx / (2 * lens.aspect) + 0.5, y: wy * 0.5 + 0.5 };
}

/**
 * The shader half of the same map, appended to the blit's WGSL. `lens` is
 * (k, rmax, aspect) — aspect is passed rather than derived from
 * textureDimensions, because under a 'fixed' cap the content target is
 * letterboxed and its dimensions are not the display aspect.
 *
 * Mirrors sampleRadius() exactly, as the ratio (1 + k*r^2)/(1 + k*rmax^2) so
 * no divide by r is needed at the centre. Its own UV<->radius conversion is
 * mirrored in JS by warpUv(), above.
 *
 * The centre guard here is `1.0e-6`, wider than the JS `1e-9` used
 * elsewhere in this file (in reticleNdc). That is deliberate, not drift: f32
 * loses precision far sooner than f64 does near the centre, so the shader
 * needs a looser threshold to avoid an unstable divide. Edit the shader and
 * its JS mirrors together; do not tighten this constant to match `1e-9`.
 */
export const FISHEYE_WGSL = /* wgsl */ `fn fisheyeWarp(st: vec2<f32>, lens: vec3<f32>) -> vec2<f32> {
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
