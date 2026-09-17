/**
 * NEURAL UPSCALE P3 — supersampled training targets
 * (spec docs/superpowers/specs/2026-09-11-neural-upscale-p3-training-design.md §1).
 *
 * The 800x600 target is the mean of grid*grid renders of one frozen state, each with a
 * sub-pixel march jitter. The offsets form a CENTRED stratified grid, so they average to
 * zero and the target stays registered to the 400x300 input. (Not accumJitter: its Halton
 * offsets lie in [0, 1) and average +0.5 px.)
 *
 * Pure TypeScript, so it is unit-testable without a GPU.
 */

/** Centred stratified offsets in output px: (i + 0.5) / n - 0.5 on each axis, row by row. */
export function jitterGrid(n: number): Array<[number, number]> {
  if (!Number.isInteger(n) || n < 1) throw new Error(`jitterGrid: n must be a positive integer, got ${n}`);
  const axis = Array.from({ length: n }, (_, i) => (i + 0.5) / n - 0.5);
  const out: Array<[number, number]> = [];
  for (const y of axis) for (const x of axis) out.push([x, y]);
  return out;
}

/** Centre-most first (by |x| + |y|), ties by y then x. The first hit in this order supplies
 *  the target's depth. */
export function sampleOrder(offsets: ReadonlyArray<readonly [number, number]>): Array<[number, number]> {
  return offsets
    .map((o) => [o[0], o[1]] as [number, number])
    .sort((a, b) => (Math.abs(a[0]) + Math.abs(a[1])) - (Math.abs(b[0]) + Math.abs(b[1])) || a[1] - b[1] || a[0] - b[0]);
}

export interface SupersampledTarget {
  /** w*h*4. rgb = mean of the hit samples; alpha = clip depth of the first hit in sample
   *  order. Uncovered pixels are (0, 0, 0, 1.0). */
  target: Float32Array;
  /** w*h. Hit fraction k / n. */
  coverage: Float32Array;
}

/**
 * Accumulate `samples` (each w*h*4 RGBA float, alpha >= 1 = no flesh), in sampleOrder order.
 * A pixel is covered iff k >= ceil(n / 2) — majority, with ties counted as covered.
 */
export function accumulateSamples(samples: readonly Float32Array[], w: number, h: number): SupersampledTarget {
  const n = samples.length;
  if (n === 0) throw new Error('accumulateSamples: no samples');
  samples.forEach((s, k) => {
    if (s.length !== w * h * 4) throw new Error(`accumulateSamples: sample ${k} has ${s.length} floats, expected ${w * h * 4}`);
  });
  const need = Math.ceil(n / 2);
  const target = new Float32Array(w * h * 4);
  const coverage = new Float32Array(w * h);
  for (let p = 0; p < w * h; p++) {
    const o = p * 4;
    let k = 0;
    let r = 0;
    let g = 0;
    let b = 0;
    let depth = 1;
    for (let s = 0; s < n; s++) {
      const d = samples[s]!;
      if (d[o + 3]! < 1) {
        if (k === 0) depth = d[o + 3]!;
        k++;
        r += d[o]!;
        g += d[o + 1]!;
        b += d[o + 2]!;
      }
    }
    coverage[p] = k / n;
    if (k >= need) {
      target[o] = r / k;
      target[o + 1] = g / k;
      target[o + 2] = b / k;
      target[o + 3] = depth;
    } else {
      target[o + 3] = 1;
    }
  }
  return { target, coverage };
}

/** Float32Array -> base64 of its little-endian bytes, chunked so large frames don't
 *  overflow the call stack. */
export function float32ToBase64(data: Float32Array): string {
  const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
