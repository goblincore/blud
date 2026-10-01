// src/lab/sdf-zombie/webgpu/earlyz/seed-depth.wgsl.ts
//
// EARLY-Z LEVEL-DEPTH SEED (spec 2026-10-01 D6). A depth-only full-screen pass
// draws first in the march target and writes, per march texel, the FARTHEST level
// depth of the output pixels the texel covers. Conservative: a texel is pre-occluded
// only when ALL its pixels have level geometry nearer than the body, so the composite's
// per-pixel depth test still owns every edge. The loop is capped at 4x4 pixels per texel:
// exact for any ratio up to 3x and for integer ratios up to 4x. A fractional ratio between
// 3x and 4x can touch 5 pixels on an axis and the cap drops the last one (not conservative
// there; the shipped boot is 2x, native is 1x). Above 4x the cap keeps only the first 4x4.
// `uv` is three's screenUV: render-target space, origin top-left like textureLoad.
// IF Task 9's doorway parity shows bodies vanishing in a vertically mirrored band, the
// uv origin is flipped on this path; fix with `st.y = 1.0 - st.y` as post-sscs.ts does.
export const EARLYZ_SEED_WGSL = /* wgsl */ `fn earlyzSeedDepth(levelDepth: texture_depth_2d, uv: vec2<f32>, marchSize: vec2<f32>) -> f32 {
  let dims = vec2<f32>(textureDimensions(levelDepth, 0));
  let texel = floor(uv * marchSize);
  let k = dims / max(marchSize, vec2<f32>(1.0));
  let lo = vec2<i32>(floor(texel * k));
  let hi = vec2<i32>(ceil((texel + vec2<f32>(1.0)) * k)) - vec2<i32>(1);
  let maxI = vec2<i32>(dims) - vec2<i32>(1);
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

/** CPU twin of the block maths: inclusive pixel range a march texel covers. */
export function seedBlock(
  texel: [number, number], marchSize: [number, number], dims: [number, number],
): { lo: [number, number]; hi: [number, number] } {
  const kx = dims[0] / Math.max(marchSize[0], 1), ky = dims[1] / Math.max(marchSize[1], 1);
  return {
    lo: [Math.floor(texel[0] * kx), Math.floor(texel[1] * ky)],
    hi: [Math.ceil((texel[0] + 1) * kx) - 1, Math.ceil((texel[1] + 1) * ky) - 1],
  };
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
