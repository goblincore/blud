// src/lab/sdf-zombie/webgpu/earlyz/seed-depth.wgsl.ts
//
// EARLY-Z LEVEL-DEPTH SEED (spec 2026-10-01 D6). A depth-only full-screen pass
// draws first in the march target and writes, per march texel, the FARTHEST level
// depth of the output pixels the texel covers. Conservative: a texel is pre-occluded
// only when ALL its pixels have level geometry nearer than the body, so the composite's
// per-pixel depth test still owns every edge.
//
// BLOCK MATHS IS EXACT INTEGER ARITHMETIC. For texel t of m over d pixels the block is
// lo = floor(t * d / m) .. hi = ceil((t + 1) * d / m) - 1, computed as (t * d) / m and
// ((t + 1) * d + m - 1) / m - 1 on i32 (all operands are non-negative, so integer division
// floors). A float ratio dims / marchSize is NOT used: WGSL f32 division is only ~2.5 ULP
// accurate (90 / 60 came out as 1.5000001 on Metal), which moved `lo` down by one at an exact
// 4x ratio for many widths, widened the block to 5 and made the cap drop a true pixel.
// lo <= hi always holds (d >= 1), so the first loop iteration always reads a pixel; the
// `var d = 0.0` start never leaks into a result and `max` with a depth in [0, 1] is safe.
//
// THE LOOP IS CAPPED AT 4x4 PIXELS PER TEXEL. The cap is exact (the block is never truncated)
// if and only if seedScaleSupported(dims, march) is true: every texel's block is at most 4
// pixels wide on both axes. That holds for 1x, 2x, 3x, 4x, 1.5x, 2.5x and 8/3, and fails for
// e.g. 3.4x (17 over 5: five pixels on some texels) and 5x. THE RENDERER MUST NOT DRAW THE
// SEED when it is false (a truncated block is not conservative, bodies could vanish). Call it
// only when the sizes change, not per frame. The shipped boot is 2x (400x300 over 800x600).
//
// `uv` is three's screenUV: render-target space, origin top-left like textureLoad.
// If the parity check (spec docs/superpowers/specs/2026-10-01-sdf-march-early-z-design.md,
// section 7 "Parity") shows bodies vanishing in a vertically mirrored band, the uv origin is
// flipped on this path; fix with `st.y = 1.0 - st.y` as post-sscs.ts does.
export const EARLYZ_SEED_WGSL = /* wgsl */ `fn earlyzSeedDepth(levelDepth: texture_depth_2d, uv: vec2<f32>, marchSize: vec2<f32>) -> f32 {
  let dI = vec2<i32>(textureDimensions(levelDepth, 0));
  let m = vec2<i32>(max(marchSize, vec2<f32>(1.0)));
  let t = vec2<i32>(floor(uv * marchSize));
  let lo = (t * dI) / m;
  let hi = ((t + vec2<i32>(1)) * dI + m - vec2<i32>(1)) / m - vec2<i32>(1);
  let maxI = dI - vec2<i32>(1);
  var d = 0.0;
  for (var y = 0; y < 4; y++) {
    for (var x = 0; x < 4; x++) {
      let p = lo + vec2<i32>(x, y);
      if (p.x > hi.x || p.y > hi.y) { continue; }
      d = max(d, textureLoad(levelDepth, clamp(p, vec2<i32>(0), maxI), 0));
    }
  }
  return d;
}`;

/** Marching extent is at least 1 texel and integral, like `vec2<i32>(max(marchSize, 1.0))`. */
function marchCount(m: number): number {
  return Math.trunc(Math.max(m, 1));
}

/** One axis of the block maths: inclusive pixel range of texel `t` of `m` over `d` pixels. */
function blockAxis(t: number, m: number, d: number): [number, number] {
  return [Math.floor((t * d) / m), Math.floor(((t + 1) * d + m - 1) / m) - 1];
}

/** CPU twin of the block maths (exact integers, same as the WGSL): inclusive pixel range a march texel covers. */
export function seedBlock(
  texel: [number, number], marchSize: [number, number], dims: [number, number],
): { lo: [number, number]; hi: [number, number] } {
  const x = blockAxis(texel[0], marchCount(marchSize[0]), dims[0]);
  const y = blockAxis(texel[1], marchCount(marchSize[1]), dims[1]);
  return { lo: [x[0], y[0]], hi: [x[1], y[1]] };
}

/** True iff, on BOTH axes, every march texel's block is at most 4 pixels wide, so the 4x4 cap
 *  never truncates and the seed is conservative. Exact; O(march size), call it on resize only. */
export function seedScaleSupported(dims: [number, number], march: [number, number]): boolean {
  for (let axis = 0; axis < 2; axis++) {
    const m = marchCount(march[axis]!);
    for (let t = 0; t < m; t++) {
      const [lo, hi] = blockAxis(t, m, dims[axis]!);
      if (hi - lo + 1 > 4) return false;
    }
  }
  return true;
}

/** CPU twin of the whole seed: farthest depth over the block (row-major `depth`). */
export function seedDepthCpu(
  depth: Float32Array, w: number, h: number, texel: [number, number], marchSize: [number, number],
): number {
  const { lo, hi } = seedBlock(texel, marchSize, [w, h]);
  let d = 0;
  for (let y = lo[1]; y <= Math.min(hi[1], lo[1] + 3); y++) {
    for (let x = lo[0]; x <= Math.min(hi[0], lo[0] + 3); x++) {
      const cx = Math.min(Math.max(x, 0), w - 1), cy = Math.min(Math.max(y, 0), h - 1);
      d = Math.max(d, depth[cy * w + cx]!);
    }
  }
  return d;
}
