// scripts/lib/upscale-registration.mjs — sub-pixel registration of a 2x-downscaled march
// against its native march (neural upscale gate G2,
// docs/superpowers/specs/2026-09-11-neural-upscale-espcn-design.md).
//
// WHY NOT THE COVERAGE CENTROID. The first G2 alignment check compared flesh-coverage
// centroids and failed at 1.16 output px (docs/dev-notes/2026-09-11-neural-upscale/g2-pairs.md).
// That metric is dominated by silhouette aliasing: a 400x300 ray legitimately catches or
// misses edge pixels an 800x600 ray does not, and a few dozen of them at the head and feet
// move the centroid by a pixel or more. Restricting both centroids to the SHARED mask does
// not rescue it — computed over the same input texels, the two are equal by construction,
// so that version can never fail.
//
// WHAT THIS MEASURES INSTEAD. An aligned input ray for texel (x, y) passes through the centre
// of the output block (2x..2x+1, 2y..2y+1), so its colour should match that block's mean.
// Shifting the block by (ox, oy) output px worsens the match; the error surface's minimum
// says where the input really sits, and a 2-D quadratic through the 3x3 errors around
// (0, 0) gives a sub-pixel estimate. Only INTERIOR texels count — the whole output window any
// candidate shift reads is flesh in the native image — so silhouettes cannot enter, and
// every shift is scored on the same texels.
//
// DEPTH, NOT COLOUR, IS WHAT GATES G2 ({ mode: 'depth', near, far }). Measured on the first
// staged frame (docs/dev-notes/2026-09-11-neural-upscale/g2-pairs.md): lit colour carries HDR
// highlights up to ~28 and sub-texel detail whose variance INSIDE a 2x2 output block (8.9e-2)
// exceeds the colour error at the best shift (3.6e-2), so colour registration read a false
// (0, +1). Linear depth is geometry only and registered the same frame at (0.0002, 0.003) px
// with a clean, symmetric error surface. 'rgb' mode stays available as a reported number.

const isFlesh = (img, x, y) => img.data[(y * img.w + x) * 4 + 3] < 1;

/**
 * @param {{w:number,h:number,data:Float32Array}} lr input march (RGBA, alpha >= 1 = no flesh)
 * @param {{w:number,h:number,data:Float32Array}} hr native march at exactly 2x
 * @param {{radius?: number, mode?: 'rgb' | 'depth', near?: number, far?: number}} [opts]
 *   radius: search radius in output px (default 2, minimum 1).
 *   mode: 'rgb' compares lit colour; 'depth' compares linear view depth from the clip depth in
 *   alpha, near*far / (far - d*(far - near)), and requires near and far.
 * @returns {{ texels: number, mse: number[][], argmin: {ox:number, oy:number}, subpixel: {x:number, y:number} }}
 *   mse[oy + radius][ox + radius]. subpixel > 0 means the input sits toward +x / +y (down).
 */
export function registerHalfRes(lr, hr, { radius = 2, mode = 'rgb', near, far } = {}) {
  if (hr.w !== 2 * lr.w || hr.h !== 2 * lr.h) {
    throw new Error(`registerHalfRes: ${hr.w}x${hr.h} is not 2x ${lr.w}x${lr.h}`);
  }
  if (radius < 1) throw new Error('registerHalfRes: radius must be >= 1');
  if (mode !== 'rgb' && mode !== 'depth') throw new Error(`registerHalfRes: unknown mode ${mode}`);
  if (mode === 'depth' && !(Number.isFinite(near) && Number.isFinite(far) && far > near && near > 0)) {
    throw new Error('registerHalfRes: depth mode needs near and far (0 < near < far)');
  }
  const linear = (clip) => (near * far) / (far - clip * (far - near));
  const texels = [];
  for (let y = 0; y < lr.h; y++) {
    for (let x = 0; x < lr.w; x++) {
      if (!isFlesh(lr, x, y)) continue;
      const X0 = 2 * x - radius, X1 = 2 * x + 1 + radius;
      const Y0 = 2 * y - radius, Y1 = 2 * y + 1 + radius;
      if (X0 < 0 || Y0 < 0 || X1 >= hr.w || Y1 >= hr.h) continue;
      let interior = true;
      for (let Y = Y0; Y <= Y1 && interior; Y++) {
        for (let X = X0; X <= X1 && interior; X++) if (!isFlesh(hr, X, Y)) interior = false;
      }
      if (interior) texels.push(x, y);
    }
  }
  const n = texels.length / 2;
  const size = 2 * radius + 1;
  const mse = Array.from({ length: size }, () => new Array(size).fill(Infinity));
  let best = { ox: 0, oy: 0, e: Infinity };
  for (let oy = -radius; oy <= radius; oy++) {
    for (let ox = -radius; ox <= radius; ox++) {
      let sum = 0;
      for (let k = 0; k < n; k++) {
        const x = texels[2 * k], y = texels[2 * k + 1];
        const l = (y * lr.w + x) * 4;
        const a = ((2 * y + oy) * hr.w + 2 * x + ox) * 4;
        const b = a + 4, c = a + hr.w * 4, d = c + 4;
        if (mode === 'depth') {
          const diff = linear(lr.data[l + 3])
            - 0.25 * (linear(hr.data[a + 3]) + linear(hr.data[b + 3]) + linear(hr.data[c + 3]) + linear(hr.data[d + 3]));
          sum += diff * diff;
        } else {
          for (let ch = 0; ch < 3; ch++) {
            const diff = lr.data[l + ch] - 0.25 * (hr.data[a + ch] + hr.data[b + ch] + hr.data[c + ch] + hr.data[d + ch]);
            sum += diff * diff;
          }
        }
      }
      const e = n ? sum / ((mode === 'depth' ? 1 : 3) * n) : Infinity;
      mse[oy + radius][ox + radius] = e;
      if (e < best.e) best = { ox, oy, e };
    }
  }
  const at = (ox, oy) => mse[oy + radius][ox + radius];
  // SUB-PIXEL: the vertex of the 2-D quadratic e = A x^2 + B y^2 + C xy + D x + E y + F,
  // fitted by central differences on the 3x3 errors around (0, 0). NOT two independent
  // axis parabolas: when image gradients correlate across axes (any diagonal texture), a
  // pure vertical shift also pulls the x-axis parabola sideways — a false horizontal offset.
  const e00 = at(0, 0);
  const A = (at(1, 0) - 2 * e00 + at(-1, 0)) / 2;
  const B = (at(0, 1) - 2 * e00 + at(0, -1)) / 2;
  const C = (at(1, 1) - at(1, -1) - at(-1, 1) + at(-1, -1)) / 4;
  const D = (at(1, 0) - at(-1, 0)) / 2;
  const E = (at(0, 1) - at(0, -1)) / 2;
  const det = 4 * A * B - C * C;
  // A minimum needs a positive-definite Hessian [[2A, C], [C, 2B]]; otherwise report NaN
  // (callers treat NaN as a failed registration, never as "aligned").
  const subpixel = det > 0 && A > 0
    ? { x: (C * E - 2 * B * D) / det, y: (C * D - 2 * A * E) / det }
    : { x: NaN, y: NaN };
  return { texels: n, mse, argmin: { ox: best.ox, oy: best.oy }, subpixel };
}
