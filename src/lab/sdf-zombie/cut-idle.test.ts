// src/lab/sdf-zombie/cut-idle.test.ts
//
// THE CUT ROW'S IDLE EXITS (cut-cost pass, docs/dev-notes/2026-10-06-cut-cost/NOTES.md). applyWounds' cut branch and
// woundMask's skip their noise (and the lip's bump) wherever the result cannot depend on it. These tests hold the
// argument on the CPU mirror: at every sample the skipped path returns what the full path returns, exactly. The slope
// sweeps live in cut-wound.test.ts (minutes); this file is the fast one.
import { describe, expect, it } from 'vitest';
import {
  CUT_JAG_MAX, CUT_JAG_SLACK, CUT_SHADE, cutBlendK, cutCarve, cutCarveIdle, cutCarveTop, cutJag, cutJagTop, cutLip,
  cutLipIdle, cutMask, cutMaskIdle, ROD_CALIBRE,
} from './cut-wound';
import { AXE_CALIBRE, AXE_CUT } from './webgpu/axe-strike';
import type { Vec3 } from './types';

/** The shader's quadratic smin / smax (march/primitives.wgsl.ts), verbatim. */
const smin = (a: number, b: number, kIn: number) => {
  const k = kIn * 4;
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
};
const smax = (a: number, b: number, k: number) => -smin(-a, -b, k);

/** mulberry32: the sweeps are seeded, so a failure names the same sample every run. */
function rng(seed: number) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/** A cut on top of a ball of radius R (a torso at 0.16, a thin limb at 0.04): anchor on the skin at +z, the slot along
 *  x, inward -z. `sag` as stampCut would store it for a chord of that half-length. */
interface Fix { name: string; R: number; halfLen: number; depth: number; kerf: number; lip: number; sag: number }
const fixtures: Fix[] = [];
for (const [name, cal, halfLen] of [
  ['axe', AXE_CALIBRE, AXE_CUT.halfLen], ['rod', ROD_CALIBRE, 0.1], ['rod short', ROD_CALIBRE, 0.03], ['axe short', AXE_CALIBRE, 0.05],
] as const) {
  for (const R of [0.16, 0.04]) {
    const kerf = Math.min(cal.kerf, CUT_SHADE.kerfPerHalfLen * halfLen);
    const h = Math.min(halfLen, 0.95 * R);
    fixtures.push({ name: `${name} on r ${R}`, R, halfLen, depth: cal.depth, kerf, lip: 0.8 * cal.lip, sag: R - Math.sqrt(R * R - h * h) });
  }
}
const along: Vec3 = [1, 0, 0], inward: Vec3 = [0, 0, -1];
const midOf = (f: Fix): Vec3 => [0, 0, f.R];
const bodyD = (f: Fix, p: Vec3) => Math.hypot(p[0], p[1], p[2]) - f.R;
/** Sample points about the cut: a box that holds the slot, its lips, the mask's tails and the air above. */
function* samples(f: Fix, n: number, seed: number): Generator<Vec3> {
  const r = rng(seed), sx = 1.6 * f.halfLen, sy = 9 * f.kerf, sz = Math.max(f.depth, 0.05) + f.sag + 0.1;
  for (let i = 0; i < n; i++) yield [(r() * 2 - 1) * sx, (r() * 2 - 1) * sy, f.R + (r() * 2 - 1) * sz];
}

describe('cutJagTop: the ceiling of the GPU\'s jag', () => {
  it('cutJag never passes cutJagTop - CUT_JAG_SLACK, and CUT_JAG_MAX is its value at a tip', () => {
    expect(cutJagTop(1) - CUT_JAG_SLACK).toBeCloseTo(CUT_JAG_MAX, 12);
    let worst = -Infinity;
    for (const f of fixtures) {
      for (const p of samples(f, 40000, 11)) {
        const tN = Math.max(-1, Math.min(1, p[0] / f.halfLen));
        worst = Math.max(worst, cutJag(p[0], p[1], -(p[2] - f.R), f.halfLen, f.kerf) - (cutJagTop(tN) - CUT_JAG_SLACK));
      }
    }
    expect(worst).toBeLessThanOrEqual(0);
  });
});

describe('the idle carve: where it holds, the row\'s smax returns the running field to the bit', () => {
  for (const f of fixtures) it(`${f.name}: carve <= carveTop at every sample, and smax(d, carve, k) === d wherever cutCarveIdle`, () => {
    const mid = midOf(f), k = cutBlendK(f.kerf, f.depth, f.halfLen), r = rng(29);
    let idle = 0, n = 0, idleShell = 0, shell = 0;
    for (const p of samples(f, 60000, 23)) {
      const dIn = bodyD(f, p);
      const jag = cutJag(p[0], p[1], -(p[2] - f.R), f.halfLen, f.kerf);
      const carve = cutCarve(p, mid, f.halfLen, along, inward, f.depth, f.kerf, dIn, f.sag, jag);
      const top = cutCarveTop(p, mid, f.halfLen, along, inward, f.depth, f.kerf, dIn, f.sag);
      expect(carve).toBeLessThanOrEqual(top);
      // The running field: the pre-wound field, or one an earlier row has already raised or lowered a little.
      for (const d of [dIn, dIn + (r() * 2 - 1) * 0.02]) {
        n++;
        const onShell = Math.abs(dIn) < 0.003;
        if (onShell) shell++;
        if (!cutCarveIdle(d, top, k)) continue;
        idle++;
        if (onShell) idleShell++;
        expect(Object.is(smax(d, carve, k), d)).toBe(true);
      }
    }
    // Not vacuous: most samples of the box are idle, and so is a share of the skin shell itself (the skin beyond
    // the slot's fillet).
    expect(idle / n).toBeGreaterThan(0.5);
    // (Asked of the torso only: on the thin limb the box holds little skin, nearly all of it slot and lip.)
    if (f.R > 0.1) {
      expect(shell).toBeGreaterThan(200);
      expect(idleShell / shell).toBeGreaterThan(0.2);
    }
  });

  it('a field with no fillet (k = 0) is plain max: idle there means d >= carveTop', () => {
    expect(cutCarveIdle(0.01, 0.01, 0)).toBe(true);
    expect(smax(0.01, 0.0099, 0)).toBe(0.01);
    expect(cutCarveIdle(0.0099, 0.01, 0)).toBe(false);
  });
});

describe('the idle lip: where it holds, cutLip is exactly 0', () => {
  for (const f of fixtures) it(`${f.name}: cutLip === 0 wherever cutLipIdle; the lip's crest is not idle`, () => {
    const mid = midOf(f);
    let idle = 0, n = 0;
    for (const p of samples(f, 80000, 37)) {
      const dIn = bodyD(f, p);
      n++;
      if (!cutLipIdle(p, mid, f.halfLen, along, inward, f.depth, f.kerf, dIn, f.sag, f.lip)) continue;
      idle++;
      expect(cutLip(p, mid, f.halfLen, along, inward, f.depth, f.kerf, dIn, f.sag, f.lip)).toBe(0);
    }
    expect(idle / n).toBeGreaterThan(0.3);
    // On the skin at the lip's crest, mid-slot, the bump is live (where the limb is wide enough to carry a crest).
    const y = f.kerf * CUT_SHADE.lipOffset;
    if (y > 0.5 * f.R) return;
    const crest: Vec3 = [0, y, Math.sqrt(f.R * f.R - y * y)];
    expect(cutLipIdle(crest, mid, f.halfLen, along, inward, f.depth, f.kerf, bodyD(f, crest), f.sag, f.lip)).toBe(false);
    expect(cutLip(crest, mid, f.halfLen, along, inward, f.depth, f.kerf, bodyD(f, crest), f.sag, f.lip)).toBeGreaterThan(0);
  });
});

describe('the idle band: where it holds, cutMask is 0 whatever its noise reads', () => {
  for (const f of fixtures) it(`${f.name}: cutMask === 0 at every jag in [-maskJag, maskJag] wherever cutMaskIdle; the slot line is not idle`, () => {
    const mid = midOf(f), r = rng(41);
    let idle = 0, n = 0;
    for (const p of samples(f, 60000, 43)) {
      // Any unit normal: the mask runs on shaded surface points, whose normals the walls, floor and lips spread wide.
      const z = r() * 2 - 1, ph = r() * Math.PI * 2, q = Math.sqrt(1 - z * z);
      const nrm: Vec3 = [q * Math.cos(ph), q * Math.sin(ph), z];
      n++;
      if (!cutMaskIdle(p, nrm, mid, f.halfLen, along, inward, f.depth, f.kerf, f.sag)) continue;
      idle++;
      for (const jag of [-CUT_SHADE.maskJag, 0, CUT_SHADE.maskJag, (r() * 2 - 1) * CUT_SHADE.maskJag]) {
        expect(cutMask(p, nrm, mid, f.halfLen, along, inward, f.depth, f.kerf, f.sag, jag)).toBe(0);
      }
    }
    expect(idle / n).toBeGreaterThan(0.3);
    const top: Vec3 = [0, 0, f.R];
    expect(cutMaskIdle(top, [0, 0, 1], mid, f.halfLen, along, inward, f.depth, f.kerf, f.sag)).toBe(false);
    expect(cutMask(top, [0, 0, 1], mid, f.halfLen, along, inward, f.depth, f.kerf, f.sag)).toBe(1);
  });
});
