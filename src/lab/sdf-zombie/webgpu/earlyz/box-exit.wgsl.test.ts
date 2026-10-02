import { describe, it, expect } from 'vitest';
import { EARLYZ_BOX_EXIT_WGSL, boxExitT } from './box-exit.wgsl';
import { RAY_WINDOW_BLOCK } from '../march/body/blocks/setup/ray-window.wgsl';

/** Seeded PRNG, uniform in [0, 1). (`1 << 31` is negative in JS, so no LCG with that modulus.) */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** INDEPENDENT reference: intersect the six face planes, keep hits inside that face's
 *  rectangle, take the farthest t (then the same 1e-4 clamp). No slab algebra. */
function faceExitT(cam: number[], rd: number[], c: number[], h: number[]): number {
  let best = -Infinity;
  for (let a = 0; a < 3; a++) {
    if (rd[a] === 0) continue;
    for (const s of [-1, 1]) {
      const t = (c[a]! + s * h[a]! - cam[a]!) / rd[a]!;
      let inside = true;
      for (let b = 0; b < 3; b++) {
        if (b === a) continue;
        if (Math.abs(cam[b]! + rd[b]! * t - c[b]!) > h[b]! + 1e-9) { inside = false; break; }
      }
      if (inside && t > best) best = t;
    }
  }
  return Math.max(best, 1e-4);
}

describe('analytic box exit (spec D4)', () => {
  it('exit along the axis is the far face', () => {
    expect(boxExitT([0, 0, 0], [0, 0, -1], [0, 0, -4], [0.5, 1, 0.5])).toBeCloseTo(4.5, 6);
  });
  it('camera inside the box exits forward (never clamped if far enough)', () => {
    // Camera at box centre [0,0,-4], ray aimed at -z, exits at near face
    // Box centre [0, 0, -4], halfExt [0.5, 1, 0.5]; z in [-4.5, -3.5]
    // rel = 0, invRd[z] = -1, lo.z = 0.5, hi.z = -0.5, max = 0.5
    expect(boxExitT([0, 0, -4], [0, 0, -1], [0, 0, -4], [0.5, 1, 0.5])).toBeCloseTo(0.5, 6);
  });
  it('box entirely behind camera returns exactly the 1e-4 clamp', () => {
    // Box centre at [0, 0, +4] (behind camera at origin), ray aimed at -z
    // Box z in [3.5, 4.5]; camera at 0, ray direction -z
    // rel.z = 4 - 0 = 4; lo.z = (4 - 0.5) / (-1) = -3.5, hi.z = (4 + 0.5) / (-1) = -4.5
    // max(lo.z, hi.z) = -3.5, tExit = -3.5, clamped to 1e-4
    expect(boxExitT([0, 0, 0], [0, 0, -1], [0, 0, 4], [0.5, 1, 0.5])).toBe(1e-4);
  });
  it('oblique ray where the x and z exit roots tie (corner exit)', () => {
    const d = Math.SQRT1_2;
    // Camera [0, 0, -4] (at box centre), ray (d, 0, -d), unit length
    // rel = [0, 0, 0], invRd = [1/d, 1e9, -1/d]
    // x: lo.x = -0.5/d, hi.x = 0.5/d, max = 0.5/d
    // z: lo.z = 0.5*(-1/d) = -0.5/d, hi.z = -0.5*(-1/d) = 0.5/d, max = 0.5/d
    // tExit = min(0.5/d, 1e9, 0.5/d) = 0.5/d = sqrt(2)/2 (the two roots TIE)
    expect(boxExitT([0, 0, -4], [d, 0, -d], [0, 0, -4], [0.5, 1, 0.5])).toBeCloseTo(0.5 / d, 6);
  });
  it('z-limited oblique ray (unit rd, roots do not tie): exits the far z face before the x face', () => {
    // Camera [-2.25, 0, -1], rd = (0.6, 0, -0.8) (0.36 + 0.64 = 1, unit),
    // box centre [0, 0, -4], halfExt [0.5, 1, 0.5]: x in [-0.5, 0.5], z in [-4.5, -3.5]
    // rel = [2.25, 0, -3], invRd = [1/0.6, 1e9, -1/0.8 = -1.25]
    // x: lo = (2.25 - 0.5)/0.6 = 2.9167, hi = (2.25 + 0.5)/0.6 = 4.5833, max = 4.5833
    // y: lo = (0 - 1)*1e9 = -1e9, hi = 1e9, max = 1e9 (parallel-axis guard, drops out of the min)
    // z: lo = (-3 - 0.5)*(-1.25) = 4.375, hi = (-3 + 0.5)*(-1.25) = 3.125, max = 4.375
    // tExit = min(4.5833, 1e9, 4.375) = 4.375 (z-limited; ray enters the z slab at t = 3.125 with
    // x = -2.25 + 0.6*3.125 = -0.375 and leaves it at t = 4.375 with x = 0.375, both inside x)
    expect(boxExitT([-2.25, 0, -1], [0.6, 0, -0.8], [0, 0, -4], [0.5, 1, 0.5])).toBeCloseTo(4.375, 6);
  });
  it('y-limited oblique ray (unit rd): exits the top face before the far z face', () => {
    // Camera [0, -3, -3], rd = (0, 0.96, -0.28) (0 + 0.9216 + 0.0784 = 1, unit),
    // box centre [0, 0, -4], halfExt [0.5, 1, 0.5]: y in [-1, 1], z in [-4.5, -3.5]
    // rel = [0, 3, -1], invRd = [1e9, 1/0.96 = 1.041667, -1/0.28 = -3.571429]
    // x: lo = (0 - 0.5)*1e9, hi = (0 + 0.5)*1e9, max = 5e8 (parallel-axis guard, drops out)
    // y: lo = (3 - 1)*1.041667 = 2.083333, hi = (3 + 1)*1.041667 = 4.166667, max = 4.166667
    // z: lo = (-1 - 0.5)*(-3.571429) = 5.357143, hi = (-1 + 0.5)*(-3.571429) = 1.785714, max = 5.357143
    // tExit = min(5e8, 4.166667, 5.357143) = 4/0.96 = 25/6 (y-limited; z at that t is
    // -3 - 0.28*4.166667 = -4.166667, inside [-4.5, -3.5])
    expect(boxExitT([0, -3, -3], [0, 0.96, -0.28], [0, 0, -4], [0.5, 1, 0.5])).toBeCloseTo(25 / 6, 6);
  });
  it('axis-aligned ray from outside the box toward +z', () => {
    // Camera [0, 0, -5], ray [0, 0, 1], box centre [0, 0, -4], halfExt [0.5, 1, 0.5]
    // Box z in [-4.5, -3.5]
    // rel.z = -4 - (-5) = 1; lo.z = (1 - 0.5) * 1 = 0.5, hi.z = (1 + 0.5) * 1 = 1.5
    // max(lo.z, hi.z) = 1.5
    expect(boxExitT([0, 0, -5], [0, 0, 1], [0, 0, -4], [0.5, 1, 0.5])).toBeCloseTo(1.5, 6);
  });
  it('laterally off-centre axis-aligned ray: the 1e9 guard with a lateral offset still exits the z face', () => {
    // Camera [0.3, -0.4, 0], ray [0, 0, -1], box centre [0, 0, -4], halfExt [0.5, 1, 0.5]
    // The ray passes through the box (|0.3| <= 0.5, |-0.4| <= 1), z in [-4.5, -3.5]
    // rel = [-0.3, 0.4, -4], invRd = [1e9, 1e9, -1]
    // x: lo = (-0.3 - 0.5)*1e9 = -8e8, hi = (-0.3 + 0.5)*1e9 = 2e8, max = 2e8
    // y: lo = (0.4 - 1)*1e9 = -6e8, hi = (0.4 + 1)*1e9 = 1.4e9, max = 1.4e9
    // z: lo = (-4 - 0.5)*(-1) = 4.5, hi = (-4 + 0.5)*(-1) = 3.5, max = 4.5
    // tExit = min(2e8, 1.4e9, 4.5) = 4.5
    expect(boxExitT([0.3, -0.4, 0], [0, 0, -1], [0, 0, -4], [0.5, 1, 0.5])).toBeCloseTo(4.5, 6);
  });
  it('asymmetric oblique ray (unit rd): x-limited exit', () => {
    // (d, 0, 1) with d = sqrt(1/2) has length sqrt(1.5), so rd = (d, 0, 1)/sqrt(1.5)
    //   = (1/sqrt(3), 0, sqrt(2/3)) = (0.57735, 0, 0.81650), unit length.
    const rd = [1 / Math.sqrt(3), 0, Math.sqrt(2 / 3)];
    // Camera [-0.5, 0, -5], box centre [0, 0, -4], halfExt [0.5, 1, 0.5]
    // Box x in [-0.5, 0.5], z in [-4.5, -3.5]
    // rel = [0.5, 0, 1], invRd = [sqrt(3), 1e9, sqrt(3/2) = 1.224745]
    // x: lo = (0.5 - 0.5)*sqrt(3) = 0, hi = (0.5 + 0.5)*sqrt(3) = 1.732051, max = sqrt(3)
    // y: lo = -1e9, hi = 1e9, max = 1e9 (guard, drops out)
    // z: lo = (1 - 0.5)*1.224745 = 0.612372, hi = (1 + 0.5)*1.224745 = 1.837117, max = 1.837117
    // tExit = min(1.732051, 1e9, 1.837117) = sqrt(3) = 1.732051 (x-limited; z at that t is
    // -5 + 0.8165*1.732051 = -3.585786, still inside the box)
    expect(boxExitT([-0.5, 0, -5], rd, [0, 0, -4], [0.5, 1, 0.5])).toBeCloseTo(Math.sqrt(3), 6);
  });
  it('the WGSL uses the same slab algebra and parallel-axis guard as ray-window', () => {
    expect(RAY_WINDOW_BLOCK).toContain('let invRd = select(vec3<f32>(1e9), 1.0 / rd, abs(rd) > vec3<f32>(1e-8));');
    expect(EARLYZ_BOX_EXIT_WGSL).toContain('let invRd = select(vec3<f32>(1e9), 1.0 / rd, abs(rd) > vec3<f32>(1e-8));');
    expect(EARLYZ_BOX_EXIT_WGSL).toContain('let rel = centre - camPos;');
    expect(EARLYZ_BOX_EXIT_WGSL).toContain('let lo = (rel - halfExt) * invRd;');
    expect(EARLYZ_BOX_EXIT_WGSL).toContain('let hi = (rel + halfExt) * invRd;');
    expect(EARLYZ_BOX_EXIT_WGSL).toContain('let tExit = min(min(max(lo.x, hi.x), max(lo.y, hi.y)), max(lo.z, hi.z));');
    expect(EARLYZ_BOX_EXIT_WGSL).toContain('return camPos + rd * max(tExit, 1e-4);');
    expect(EARLYZ_BOX_EXIT_WGSL).toMatch(/^fn earlyzBoxExitPoint\(camPos: vec3<f32>, rd: vec3<f32>, centre: vec3<f32>, halfExt: vec3<f32>\) -> vec3<f32> \{/);
  });

  it('matches an independent six-face-plane reference over 2000 seeded rays from outside the box', () => {
    const r = mulberry32(20261001);
    let n = 0;
    let guard = 0;
    while (n < 2000) {
      if (++guard > 100000) throw new Error('sampler starved');
      const c = [(r() - 0.5) * 40, (r() - 0.5) * 4, -r() * 140];
      const h = [0.2 + r(), 0.5 + r(), 0.2 + r()];
      const cam = [c[0]! + (r() - 0.5) * 20, c[1]! + (r() - 0.5) * 6, c[2]! + (r() - 0.5) * 20];
      if ([0, 1, 2].every((a) => Math.abs(cam[a]! - c[a]!) <= h[a]!)) continue; // camera inside: not this test
      const target = [0, 1, 2].map((a) => c[a]! + (r() - 0.5) * 2 * h[a]!);
      const d = target.map((v, a) => v - cam[a]!);
      const L = Math.hypot(d[0]!, d[1]!, d[2]!);
      const rd = d.map((v) => v / L);
      expect(boxExitT(cam, rd, c, h)).toBeCloseTo(faceExitT(cam, rd, c, h), 9);
      n++;
    }
  });
});
