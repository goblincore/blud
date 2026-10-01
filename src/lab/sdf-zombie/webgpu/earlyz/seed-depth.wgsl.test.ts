// src/lab/sdf-zombie/webgpu/earlyz/seed-depth.wgsl.test.ts
import { describe, it, expect } from 'vitest';
import { EARLYZ_SEED_WGSL, seedBlock, seedDepthCpu, seedScaleSupported } from './seed-depth.wgsl';

/** INDEPENDENT oracle for the block maths, in exact integer arithmetic: pixel p (cell [p, p+1))
 *  is covered by texel t (span [t*dims/march, (t+1)*dims/march)) iff the two half-open intervals
 *  overlap, i.e. (p+1)*march > t*dims and p*march < (t+1)*dims. No floor/ceil, no float ratio. */
function coveredPixels(t: number, march: number, dims: number): number[] {
  const out: number[] = [];
  for (let p = 0; p < dims; p++) {
    if ((p + 1) * march > t * dims && p * march < (t + 1) * dims) out.push(p);
  }
  return out;
}

describe('seed block (spec D6)', () => {
  it('upscaler boot: a 400x300 texel covers a 2x2 block of the 800x600 level depth', () => {
    expect(seedBlock([0, 0], [400, 300], [800, 600])).toEqual({ lo: [0, 0], hi: [1, 1] });
    expect(seedBlock([399, 299], [400, 300], [800, 600])).toEqual({ lo: [798, 598], hi: [799, 599] });
  });
  it('native scale covers exactly one pixel', () => {
    expect(seedBlock([5, 7], [800, 600], [800, 600])).toEqual({ lo: [5, 7], hi: [5, 7] });
  });
  it('a non-integer ratio covers every touched pixel', () => {
    // 3 texels over 8 pixels: texel 1 spans [2.67, 5.33) -> pixels 2..5
    expect(seedBlock([1, 0], [3, 1], [8, 1])).toEqual({ lo: [2, 0], hi: [5, 0] });
  });
  it('the vertical axis rounds the same way (floor on lo, ceil on hi)', () => {
    expect(seedBlock([0, 1], [1, 3], [1, 8])).toEqual({ lo: [0, 2], hi: [0, 5] });
    expect(seedBlock([0, 2], [1, 3], [1, 8])).toEqual({ lo: [0, 5], hi: [0, 7] });
  });
  it('matches the exact integer-arithmetic overlap oracle, per axis, for integer and fractional ratios', () => {
    const cases: Array<[number, number]> = [[4, 8], [3, 8], [5, 17], [3, 7], [7, 7], [1, 4], [6, 20], [400, 800], [300, 600]];
    for (const [march, dims] of cases) {
      for (let t = 0; t < march; t++) {
        const want = coveredPixels(t, march, dims);
        const b = seedBlock([t, t], [march, march], [dims, dims]);
        expect([b.lo[0], b.hi[0]], `x ${march}->${dims} texel ${t}`).toEqual([want[0], want[want.length - 1]]);
        expect([b.lo[1], b.hi[1]], `y ${march}->${dims} texel ${t}`).toEqual([want[0], want[want.length - 1]]);
      }
    }
  });
  it('matches the overlap oracle for EVERY march 1..40 over EVERY dims 1..120 (one axis)', () => {
    for (let march = 1; march <= 40; march++) {
      for (let dims = 1; dims <= 120; dims++) {
        for (let t = 0; t < march; t++) {
          const want = coveredPixels(t, march, dims);
          const b = seedBlock([t, 0], [march, 1], [dims, 1]);
          if (b.lo[0] !== want[0] || b.hi[0] !== want[want.length - 1]) {
            throw new Error(`${march}->${dims} texel ${t}: got ${b.lo[0]}..${b.hi[0]}, want ${want[0]}..${want[want.length - 1]}`);
          }
        }
      }
    }
  });
  it('an exact 4x ratio is exactly 4 pixels wide at every texel, for every width 1..600', () => {
    // The shader once used a float ratio that came out 1.5000001 for 90/60 and broke exact 4x widths; the
    // integer maths must give lo = 4t and hi = 4t + 3 for all of them.
    for (let march = 1; march <= 600; march++) {
      for (const t of [0, 1, march >> 1, march - 1]) {
        expect(seedBlock([t, 0], [march, 1], [march * 4, 1]), `${march} texel ${t}`).toEqual({ lo: [4 * t, 0], hi: [4 * t + 3, 0] });
      }
    }
  });
  it('the shipped 90/60 ratio (1.5x) gives exact 1-or-2 pixel blocks', () => {
    // 60 texels over 90 pixels: texel 0 -> 0..1, texel 1 -> 1..2, texel 2 -> 3..4 (spans [3,4.5)), texel 59 -> 88..89
    expect(seedBlock([0, 0], [60, 1], [90, 1])).toEqual({ lo: [0, 0], hi: [1, 0] });
    expect(seedBlock([1, 0], [60, 1], [90, 1])).toEqual({ lo: [1, 0], hi: [2, 0] });
    expect(seedBlock([2, 0], [60, 1], [90, 1])).toEqual({ lo: [3, 0], hi: [4, 0] });
    expect(seedBlock([59, 0], [60, 1], [90, 1])).toEqual({ lo: [88, 0], hi: [89, 0] });
  });
  it('a march size below 1 is treated as 1 (the shader floors it), and a fractional size truncates', () => {
    expect(seedBlock([0, 0], [0, 0], [4, 4])).toEqual({ lo: [0, 0], hi: [3, 3] });
    expect(seedBlock([1, 0], [2.9, 1], [8, 8])).toEqual(seedBlock([1, 0], [2, 1], [8, 8]));
  });
  it('lo <= hi always holds (the first loop iteration always reads a pixel)', () => {
    for (let march = 1; march <= 40; march++) {
      for (let dims = 1; dims <= 120; dims++) {
        for (let t = 0; t < march; t++) {
          const b = seedBlock([t, 0], [march, 1], [dims, 1]);
          if (b.lo[0] > b.hi[0]) throw new Error(`${march}->${dims} texel ${t}: ${b.lo[0]}..${b.hi[0]}`);
        }
      }
    }
  });
  it('the blocks of all texels together cover every output pixel (conservative precondition)', () => {
    for (const [march, dims] of [[3, 8], [5, 17], [4, 8], [3, 7]] as Array<[number, number]>) {
      const seen = new Array<boolean>(dims).fill(false);
      for (let t = 0; t < march; t++) {
        const b = seedBlock([t, 0], [march, 1], [dims, 1]);
        for (let p = b.lo[0]; p <= b.hi[0]; p++) seen[p] = true;
      }
      expect(seen.every(Boolean), `${march}->${dims}`).toBe(true);
    }
  });
});

describe('seedScaleSupported (the cap is exact iff every block is at most 4 pixels wide)', () => {
  it('the shipped boot and native are supported', () => {
    expect(seedScaleSupported([800, 600], [400, 300])).toBe(true);
    expect(seedScaleSupported([800, 600], [800, 600])).toBe(true);
  });
  it('an exact 4x ratio is supported, on every width 1..600', () => {
    expect(seedScaleSupported([800, 600], [200, 150])).toBe(true);
    for (let march = 1; march <= 600; march++) {
      expect(seedScaleSupported([march * 4, march * 4], [march, march]), `${march}`).toBe(true);
    }
  });
  it('1.5x, 2.5x, 3x, 8/3 and a march grid larger than the depth (below 1x) are supported', () => {
    expect(seedScaleSupported([90, 90], [60, 60])).toBe(true);
    expect(seedScaleSupported([20, 20], [8, 8])).toBe(true);
    expect(seedScaleSupported([300, 300], [100, 100])).toBe(true);
    expect(seedScaleSupported([8, 8], [3, 3])).toBe(true); // 2.67x: blocks of 3, 4, 3
    expect(seedScaleSupported([400, 300], [800, 600])).toBe(true);
  });
  it('3.4x (17 over 5) and 5x are not supported', () => {
    expect(seedScaleSupported([17, 17], [5, 5])).toBe(false);
    expect(seedScaleSupported([1000, 750], [200, 150])).toBe(false);
    expect(seedScaleSupported([5, 5], [1, 1])).toBe(false);
  });
  it('a march size below 1 counts as one texel and a fractional size truncates, like the shader', () => {
    expect(seedScaleSupported([8, 8], [0, 0])).toBe(false); // one texel over 8 pixels
    expect(seedScaleSupported([4, 4], [0, 0])).toBe(true); // one texel over 4 pixels
    expect(seedScaleSupported([3, 3], [0.5, 0.5])).toBe(true);
    expect(seedScaleSupported([8, 8], [2.9, 2.9])).toBe(true); // truncates to 2: 4x
  });
  it('both axes must pass', () => {
    expect(seedScaleSupported([800, 1000], [400, 200])).toBe(false); // x 2x ok, y 5x not
    expect(seedScaleSupported([1000, 600], [200, 300])).toBe(false); // x 5x not, y 2x ok
    expect(seedScaleSupported([17, 8], [5, 4])).toBe(false);
    expect(seedScaleSupported([8, 17], [4, 5])).toBe(false);
  });
  it('agrees with the overlap oracle (max block width <= 4) for every march 1..30 over every dims 1..90', () => {
    for (let march = 1; march <= 30; march++) {
      for (let dims = 1; dims <= 90; dims++) {
        let widest = 0;
        for (let t = 0; t < march; t++) widest = Math.max(widest, coveredPixels(t, march, dims).length);
        expect(seedScaleSupported([dims, dims], [march, march]), `${march}->${dims} widest ${widest}`).toBe(widest <= 4);
      }
    }
  });
  it('supported means the capped CPU seed always sees the block\'s farthest pixel; unsupported means some texel loses it', () => {
    for (const [dims, march, supported] of [[16, 5, true], [90, 60, true], [17, 5, false], [40, 8, false]] as Array<[number, number, boolean]>) {
      expect(seedScaleSupported([dims, 1], [march, 1]), `${dims}/${march}`).toBe(supported);
      let lost = 0;
      for (let t = 0; t < march; t++) {
        const b = seedBlock([t, 0], [march, 1], [dims, 1]);
        const depth = new Float32Array(dims).fill(0.25);
        depth[b.hi[0]] = 0.5; // the farthest pixel sits at the block's last pixel
        if (seedDepthCpu(depth, dims, 1, [t, 0], [march, 1]) !== 0.5) lost++;
      }
      expect(lost > 0, `${dims}/${march} lost ${lost}`).toBe(!supported);
    }
  });
});

describe('seed depth', () => {
  it('takes the farthest depth of the block (conservative)', () => {
    const W = 4, H = 2;
    const d = new Float32Array([0.2, 0.9, 0.3, 0.3,
                                0.2, 0.2, 0.3, 0.3]);
    expect(seedDepthCpu(d, W, H, [0, 0], [2, 1])).toBeCloseTo(0.9, 6);
    expect(seedDepthCpu(d, W, H, [1, 0], [2, 1])).toBeCloseTo(0.3, 6);
  });

  it('seedDepthCpu and seedBlock agree for every texel of a 2x case (4x2 march over 8x4 depth)', () => {
    const W = 8, H = 4, MW = 4, MH = 2;
    // Distinct-ish depths so the farthest pixel lands at different offsets inside different blocks.
    const d = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) d[y * W + x] = (((x * 3 + y * 5) * 7) % 23 + 1) / 24;
    const argmaxOffsets = new Set<string>();
    for (let ty = 0; ty < MH; ty++) {
      for (let tx = 0; tx < MW; tx++) {
        const b = seedBlock([tx, ty], [MW, MH], [W, H]);
        expect(b, `block ${tx},${ty}`).toEqual({ lo: [tx * 2, ty * 2], hi: [tx * 2 + 1, ty * 2 + 1] });
        let want = 0, at = '';
        for (let y = b.lo[1]; y <= b.hi[1]; y++) {
          for (let x = b.lo[0]; x <= b.hi[0]; x++) {
            const v = d[y * W + x]!;
            if (v > want) { want = v; at = `${x - b.lo[0]},${y - b.lo[1]}`; }
          }
        }
        argmaxOffsets.add(at);
        expect(seedDepthCpu(d, W, H, [tx, ty], [MW, MH]), `texel ${tx},${ty}`).toBe(want);
      }
    }
    // Guard against a vacuous fixture: the max must not always sit at the same corner of the block.
    expect(argmaxOffsets.size).toBeGreaterThanOrEqual(3);
  });

  it('an exact 4x ratio reads the whole 4x4 block, including its far corner', () => {
    // 2x1 march over 8x4: texel 1 covers x 4..7, y 0..3 (a full 4x4).
    const W = 8, H = 4;
    const d = new Float32Array(W * H).fill(0.1);
    d[3 * W + 7] = 0.95; // the block's far corner
    d[0 * W + 4] = 0.2; // its near corner
    expect(seedBlock([1, 0], [2, 1], [W, H])).toEqual({ lo: [4, 0], hi: [7, 3] });
    expect(seedDepthCpu(d, W, H, [1, 0], [2, 1])).toBeCloseTo(0.95, 6);
    // and nothing from texel 0's block (x 0..3) leaks in
    d[0] = 0.99;
    expect(seedDepthCpu(d, W, H, [1, 0], [2, 1])).toBeCloseTo(0.95, 6);
  });

  it('never reads outside its own block (a nearer-block max must not leak into a farther-block texel)', () => {
    const W = 8, H = 4;
    const d = new Float32Array(W * H).fill(0.3);
    for (let y = 0; y < H; y++) for (let x = 0; x < 6; x++) d[y * W + x] = 0.99; // everything left of texel 3
    // texel 3 of a 4x2 march: x 6..7, y 0..1
    expect(seedDepthCpu(d, W, H, [3, 0], [4, 2])).toBeCloseTo(0.3, 6);
    // texel (0,0) of the same march must not see the 0.3 below/right of its 2x2 block
    const e = new Float32Array(W * H).fill(0.99);
    e[0] = 0.1; e[1] = 0.1; e[W] = 0.1; e[W + 1] = 0.1;
    expect(seedDepthCpu(e, W, H, [0, 0], [4, 2])).toBeCloseTo(0.1, 6);
  });

  it('caps the block at 4x4: a block wider than 4 only reads its first 4 pixels per axis', () => {
    // 1 texel over 8x8: block is 0..7 on both axes, the cap stops at 3.
    const d8 = new Float32Array(64).fill(0.1);
    d8[3 * 8 + 3] = 0.5; // last pixel inside the cap
    d8[7 * 8 + 7] = 0.99; // outside the cap
    expect(seedBlock([0, 0], [1, 1], [8, 8])).toEqual({ lo: [0, 0], hi: [7, 7] });
    expect(seedDepthCpu(d8, 8, 8, [0, 0], [1, 1])).toBeCloseTo(0.5, 6);
  });

  it('the 4-wide cap applies per axis (a block that is wide on only one axis is still capped there)', () => {
    const col = new Float32Array(8).fill(0.1); // 1 wide, 8 tall: only y is capped
    col[3] = 0.5; col[7] = 0.99;
    expect(seedDepthCpu(col, 1, 8, [0, 0], [1, 1])).toBeCloseTo(0.5, 6);
    const row = new Float32Array(8).fill(0.1); // 8 wide, 1 tall: only x is capped
    row[3] = 0.5; row[7] = 0.99;
    expect(seedDepthCpu(row, 8, 1, [0, 0], [1, 1])).toBeCloseTo(0.5, 6);
  });

  it('documents the limit: a fractional ratio in (3, 4) can touch 5 pixels, and the 4-wide cap drops the last', () => {
    // 5 texels over 17 pixels is a 3.4x ratio. Texel 2 spans [6.8, 10.2) -> pixels 6..10 (five), but the
    // cap reads 6..9. NOT conservative there; the shipped boot is 2x. If this is ever widened, update the header too.
    const d = new Float32Array(17).fill(0.3);
    d[10] = 0.9;
    expect(seedBlock([2, 0], [5, 1], [17, 1])).toEqual({ lo: [6, 0], hi: [10, 0] });
    expect(seedDepthCpu(d, 17, 1, [2, 0], [5, 1])).toBeCloseTo(0.3, 6);
    expect(seedBlock([0, 2], [1, 5], [1, 17])).toEqual({ lo: [0, 6], hi: [0, 10] });
    expect(seedDepthCpu(d, 1, 17, [0, 2], [1, 5])).toBeCloseTo(0.3, 6);
  });

  it('clamps a block that runs past the texture to the last row/column', () => {
    // 1 texel over a 2x2 depth is a 2x ratio. Texel index 1 (one past the grid, e.g. a uv of exactly 1.0)
    // has its block at pixels 2..3, entirely past the edge; the clamp pins the read to the last pixel.
    const d = new Float32Array([0.1, 0.2, 0.3, 0.7]);
    expect(seedBlock([1, 1], [1, 1], [2, 2])).toEqual({ lo: [2, 2], hi: [3, 3] });
    expect(seedDepthCpu(d, 2, 2, [1, 1], [1, 1])).toBeCloseTo(0.7, 6);
    expect(seedDepthCpu(d, 2, 2, [5, 5], [1, 1])).toBeCloseTo(0.7, 6);
  });

  it('the WGSL caps the block at 4x4 and clamps to the texture', () => {
    expect(EARLYZ_SEED_WGSL).toMatch(/^fn earlyzSeedDepth\(levelDepth: texture_depth_2d, uv: vec2<f32>, marchSize: vec2<f32>\) -> f32 \{/);
    expect(EARLYZ_SEED_WGSL).toContain('for (var y = 0; y < 4; y++) {');
    expect(EARLYZ_SEED_WGSL).toContain('d = max(d, textureLoad(levelDepth, clamp(p, vec2<i32>(0), maxI), 0));');
  });

  it('the WGSL block maths mirrors seedBlock: exact i32 maths, farthest (max) over the block', () => {
    expect(EARLYZ_SEED_WGSL).toContain('let dI = vec2<i32>(textureDimensions(levelDepth, 0));');
    expect(EARLYZ_SEED_WGSL).toContain('let m = vec2<i32>(max(marchSize, vec2<f32>(1.0)));');
    expect(EARLYZ_SEED_WGSL).toContain('let t = vec2<i32>(floor(uv * marchSize));');
    expect(EARLYZ_SEED_WGSL).toContain('let lo = (t * dI) / m;');
    expect(EARLYZ_SEED_WGSL).toContain('let hi = ((t + vec2<i32>(1)) * dI + m - vec2<i32>(1)) / m - vec2<i32>(1);');
    expect(EARLYZ_SEED_WGSL).toContain('let maxI = dI - vec2<i32>(1);');
    expect(EARLYZ_SEED_WGSL).toContain('var d = 0.0;');
    expect(EARLYZ_SEED_WGSL).toContain('for (var x = 0; x < 4; x++) {');
    expect(EARLYZ_SEED_WGSL).toContain('let p = lo + vec2<i32>(x, y);');
    expect(EARLYZ_SEED_WGSL).toContain('if (p.x > hi.x || p.y > hi.y) { continue; }');
    expect(EARLYZ_SEED_WGSL).toContain('return d;');
    expect(EARLYZ_SEED_WGSL).not.toMatch(/\bmin\(d,/);
  });
  it('the WGSL block maths uses no float ratio (f32 division is ~2.5 ULP: 90/60 gave 1.5000001)', () => {
    expect(EARLYZ_SEED_WGSL).not.toContain('let k =');
    expect(EARLYZ_SEED_WGSL).not.toMatch(/dims\s*\//);
    expect(EARLYZ_SEED_WGSL).not.toMatch(/\b(floor|ceil)\(texel/);
    expect(EARLYZ_SEED_WGSL).not.toMatch(/ceil\(/);
    expect(EARLYZ_SEED_WGSL).not.toMatch(/textureDimensions\([^)]*\)\)?\s*\/\s*(max\(|marchSize)/);
  });

  it('the WGSL string carries no comments (they live in the TS header)', () => {
    expect(EARLYZ_SEED_WGSL).not.toContain('//');
    expect(EARLYZ_SEED_WGSL).not.toContain('/*');
  });
});
