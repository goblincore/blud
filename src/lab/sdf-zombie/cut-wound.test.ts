// src/lab/sdf-zombie/cut-wound.test.ts
import { describe, expect, it } from 'vitest';
import { CUT, CUT_SHADE, ROD_CALIBRE, cutCarve, cutExposureSpheres, cutsFromSweep, stampCut } from './cut-wound';
import { woundDirToWorld, woundWorldPos } from './damage';
import { prim } from './head-pop';
import { sdBody } from './validate';
import type { Primitive, Vec3 } from './types';

// A torso-like capsule (cluster 1) and an arm (cluster 2), both along +y.
const torso = prim([0, 1.0, 0], [0, 1.5, 0], 0.15, [1, 1, 1], { limb: 'torso', cluster: 1 });
const arm = prim([0.4, 1.0, 0], [0.4, 1.5, 0], 0.05, [1, 1, 1], { limb: 'armL', cluster: 2 });
const prims: Primitive[] = [torso, arm];
const body = { prims, clusters: [{ start: 0, count: 1, alive: true }, { start: 1, count: 1, alive: true }] } as unknown as Parameters<typeof sdBody>[1];
const field = (p: Vec3) => sdBody(p, body);
const mid: Vec3 = [0, 1.25, 0.15];
const along: Vec3 = [0, 1, 0], inward: Vec3 = [0, 0, -1];

// The WGSL-shaped call: a stamped cut on the real fixture body, carve evaluated with dIn = the pre-wound field at p.
const slotOf = (w: ReturnType<typeof stampCut>) => ({
  mid: woundWorldPos(prims, w, 0),
  along: woundDirToWorld(prims, w, w.cutDir!, 0),
  inward: woundDirToWorld(prims, w, w.carveN!, 0),
  depth: w.carveDepth!, kerf: w.kerf!, sag: w.sag!, halfLen: w.radius,
});
const carveAt = (k: ReturnType<typeof slotOf>, p: Vec3) =>
  cutCarve(p, k.mid, k.halfLen, k.along, k.inward, k.depth, k.kerf, field(p), k.sag);
const slotPoint = (k: ReturnType<typeof slotOf>, a: number, s: number, u: number): Vec3 => {
  const side = [k.along[1] * k.inward[2] - k.along[2] * k.inward[1], k.along[2] * k.inward[0] - k.along[0] * k.inward[2], k.along[0] * k.inward[1] - k.along[1] * k.inward[0]];
  return [0, 1, 2].map(i => k.mid[i]! + k.along[i]! * a + k.inward[i]! * s + side[i]! * u) as unknown as Vec3;
};
const torsoCut = (half: number, around: boolean, cal = ROD_CALIBRE) => {
  const z = Math.sqrt(0.15 * 0.15 - half * half);
  return stampCut(prims, around
    ? { a: [-half, 1.25, z], b: [half, 1.25, z], view: [0, 0, -1] }
    : { a: [0, 1.25 - half, 0.15], b: [0, 1.25 + half, 0.15], view: [0, 0, -1] }, cal, 0, field);
};

describe('cutCarve (the CPU mirror of the WGSL slot)', () => {
  // Flat-skin stand-in: dIn = -(depth below the plane through mid), sag 0.
  const flat = (a: number, s: number, u: number, depth = 0.06, h = 0.1) => {
    const p: Vec3 = [u, mid[1] + a, mid[2] - s];
    return cutCarve(p, mid, h, along, inward, depth, 0.01, -s, 0);
  };
  it('is inside (positive) along the slot centre down to most of its depth, at the middle', () => {
    expect(flat(0, 0.03, 0)).toBeGreaterThan(0);
  });
  it('is outside past the kerf, past the floor and past the ends', () => {
    expect(flat(0, 0.01, 0.02)).toBeLessThan(0);
    expect(flat(0, 0.07, 0)).toBeLessThan(0);
    expect(flat(0.11, 0.0, 0)).toBeLessThan(0);
  });
  it('is a lens: deepest at the middle, shallow near the ends', () => {
    expect(flat(0, 0.05, 0)).toBeGreaterThan(0);
    expect(flat(0.09, 0.05, 0)).toBeLessThan(0);
  });
  it('the walls close into a V: wider at the skin than near the floor', () => {
    expect(flat(0, 0.005, 0.007)).toBeGreaterThan(0);
    expect(flat(0, 0.05, 0.007)).toBeLessThan(0);
  });
  it('clamps depth to maxDepthPerHalfLen x halfLen', () => {
    expect(flat(0, 0.03, 0, 0.06, 0.015)).toBeLessThan(0);   // floor at 1.4 x 0.015 = 0.021
    expect(flat(0, 0.015, 0, 0.06, 0.015)).toBeGreaterThan(0);
  });
});

describe('cut depth is bounded by the slot\'s own plane (sag), never the far skin', () => {
  const farSide = (k: ReturnType<typeof slotOf>) => {
    let carved = 0, beyond = 0;
    for (let a = -k.halfLen - 0.01; a <= k.halfLen + 0.01; a += 0.002) {
      for (let s = -0.02; s <= 0.2; s += 0.002) {
        for (let u = -0.03; u <= 0.03; u += 0.002) {
          if (carveAt(k, slotPoint(k, a, s, u)) > 0) { carved++; if (s > k.depth + k.sag + 1e-9) beyond++; }
        }
      }
    }
    return { carved, beyond };
  };
  it('a cut along the arm (0.1 m across) carves nothing past depth + sag, and the far skin stays', () => {
    const w = stampCut(prims, { a: [0.4, 1.15, 0.05], b: [0.4, 1.35, 0.05], view: [0, 0, -1] }, ROD_CALIBRE, 0, field);
    expect(w.primIdx).toBe(1);
    const k = slotOf(w);
    const r = farSide(k);
    console.log(`far-side arm: carved ${r.carved}, beyond ${r.beyond}, sag ${k.sag}`);
    expect(r.carved).toBeGreaterThan(0);
    expect(r.beyond).toBe(0);
    for (const y of [1.2, 1.25, 1.3]) expect(carveAt(k, [0.4, y, -0.05])).toBeLessThan(0);   // the arm's far skin
  });
  it('a cut around the torso carves nothing past depth + sag', () => {
    const k = slotOf(torsoCut(0.1, true));
    const r = farSide(k);
    console.log(`far-side torso: carved ${r.carved}, beyond ${r.beyond}, sag ${k.sag}`);
    expect(k.sag).toBeGreaterThan(0.03);
    expect(r.carved).toBeGreaterThan(0);
    expect(r.beyond).toBe(0);
  });
  it('the slot follows curvature: a 0.2 m cut around the torso reaches ~0.02 below the real skin at a/h = 0.85', () => {
    const k = slotOf(torsoCut(0.1, true));
    const a = 0.85 * k.halfLen;
    let reach = 0;
    for (let s = -0.02; s <= 0.1; s += 0.0005) {
      const p = slotPoint(k, a, s, 0);
      if (carveAt(k, p) > 0 && field(p) <= 0) reach = Math.max(reach, -field(p));
    }
    // the same, measured along the inward axis from the real skin
    let skinS = 0;
    for (let s = -0.02; s <= 0.1; s += 0.0001) { if (field(slotPoint(k, a, s, 0)) <= 0) { skinS = s; break; } }
    let floorS = skinS;
    for (let s = skinS; s <= 0.1; s += 0.0001) { if (carveAt(k, slotPoint(k, a, s, 0)) > 0) floorS = s; }
    console.log(`curvature reach along axis ${(floorS - skinS).toFixed(4)} (field-depth ${reach.toFixed(4)})`);
    expect(floorS - skinS).toBeGreaterThan(0.015);
    expect(floorS - skinS).toBeLessThan(0.03);
  });
});

describe('cutCarve: Lipschitz bound (WGSL-shaped call on the curved fixture)', () => {
  // Max |grad| of the carve term, field gradient included (dIn comes from sdBody at each point).
  const maxGrad = (k: ReturnType<typeof slotOf>, step: number): number => {
    const f = (p: Vec3) => carveAt(k, p);
    const h = 2e-4;
    let m = 0;
    for (let a = -k.halfLen - 0.02; a <= k.halfLen + 0.02; a += step) {
      for (let s = -0.02; s <= k.depth + k.sag + 0.02; s += step) {
        for (let u = -0.025; u <= 0.025; u += 0.001) {
          const p = slotPoint(k, a, s, u);
          const f0 = f(p);
          for (const sg of [1, -1]) {
            const g = Math.hypot(
              (f(slotPoint(k, a + sg * h, s, u)) - f0) / h,
              (f(slotPoint(k, a, s + sg * h, u)) - f0) / h,
              (f(slotPoint(k, a, s, u + sg * h)) - f0) / h);
            if (g > m) m = g;
          }
        }
      }
    }
    return m;
  };
  it('max |grad| <= 2.2 over halfLen x depth x kerf (straight along the torso, and around it)', () => {
    let worst = 0, worstAt = '';
    for (const h of [0.015, 0.05, 0.1, 0.175]) {
      for (const depth of [0.03, 0.06, 0.15]) {
        for (const kerf of [0.006, 0.01, 0.015]) {
          const cal = { depth, kerf, lip: 1 };
          const kinds = h <= 0.1 ? [false, true] : [false];
          for (const around of kinds) {
            const m = maxGrad(slotOf(torsoCut(h, around, cal)), 0.0025);
            if (m > worst) { worst = m; worstAt = `h ${h} depth ${depth} kerf ${kerf} ${around ? 'around' : 'along'}`; }
          }
        }
      }
    }
    console.log(`lipschitz max ${worst.toFixed(3)} at ${worstAt}`);
    expect(worst).toBeLessThanOrEqual(2.2);
  }, 600000);
});

describe('cutsFromSweep', () => {
  const view: Vec3 = [0, 0, -1];
  const sample = (x: number, y: number, z = 0.15) => ({ point: [x, y, z] as Vec3, view });
  const T = (y: number) => sample(0, y);              // on the torso (cluster 1)
  const A = (y: number) => sample(0.4, y, 0.05);      // on the arm (cluster 2)
  const lenOf = (g: { a: Vec3; b: Vec3 }) => Math.hypot(g.b[0] - g.a[0], g.b[1] - g.a[1], g.b[2] - g.a[2]);
  it('one segment from first to last sample on one cluster, carrying the averaged view', () => {
    const segs = cutsFromSweep(prims, [sample(0, 1.15), sample(0, 1.25), sample(0, 1.35)]);
    expect(segs).toHaveLength(1);
    expect(segs[0]!.a[1]).toBeCloseTo(1.15, 9);
    expect(segs[0]!.b[1]).toBeCloseTo(1.35, 9);
    expect(segs[0]!.view[2]).toBeCloseTo(-1, 6);
    expect('normal' in segs[0]!).toBe(false);
  });
  it('splits by cluster: a sweep across the arm and the torso is two cuts', () => {
    const segs = cutsFromSweep(prims, [sample(0.4, 1.2, 0.05), sample(0.4, 1.3, 0.05), sample(0, 1.25), sample(0, 1.35)]);
    expect(segs).toHaveLength(2);
  });
  it('drops segments shorter than CUT.minLen and clamps to CUT.maxLen about the midpoint', () => {
    expect(cutsFromSweep(prims, [sample(0, 1.25), sample(0, 1.26)])).toHaveLength(0);
    const long = cutsFromSweep(prims, [sample(0, 0.9), sample(0, 1.6)])[0]!;
    expect(lenOf(long)).toBeCloseTo(CUT.maxLen, 6);
  });
  it('a lone mislabelled sample between two of the same cluster does not split the cut (jitter)', () => {
    // T T A T T A T T A T: the A samples are nearer the arm but sit between torso neighbours.
    const ys = [1.10, 1.13, 1.16, 1.19, 1.22, 1.25, 1.28, 1.31, 1.34, 1.37];
    const lone = new Set([2, 5, 8]);
    const samples = ys.map((y, i) => (lone.has(i) ? sample(0.3, y, 0) : T(y)));
    const segs = cutsFromSweep(prims, samples);
    expect(segs).toHaveLength(1);
    expect(segs[0]!.a[1]).toBeCloseTo(1.10, 9);
    expect(segs[0]!.b[1]).toBeCloseTo(1.37, 9);
  });
  it('keeps the longest CUT.maxPerSlash cuts, not the first ones', () => {
    expect(CUT.maxPerSlash).toBe(3);
    const segs = cutsFromSweep(prims, [T(1.10), T(1.15), A(1.10), A(1.15), T(1.20), T(1.25), A(1.10), A(1.30)]);
    expect(segs).toHaveLength(3);
    expect(segs.some(g => Math.abs(lenOf(g) - 0.2) < 1e-6)).toBe(true);
  });
});

describe('stampCut', () => {
  const seg = { a: [0, 1.15, 0.15] as Vec3, b: [0, 1.35, 0.15] as Vec3, view: [0, 0, -1] as Vec3 };
  const w = stampCut(prims, seg, ROD_CALIBRE, 0, field);
  it('is a cut on the torso: midpoint anchor, half-length radius, no sever, wet lip', () => {
    expect(w.shape).toBe('cut');
    expect(w.primIdx).toBe(0);
    expect(w.radius).toBeCloseTo(0.1, 6);
    expect(w.severRadius).toBe(0);
    expect(w.wetLip).toBe(1);
    const p = woundWorldPos(prims, w, 0);
    expect(p[1]).toBeCloseTo(1.25, 3);
    expect(Math.abs(field(p))).toBeLessThan(0.002);           // on the skin
  });
  it('its along direction is the sweep, its inward points into the body, depth is capped', () => {
    const along = woundDirToWorld(prims, w, w.cutDir!, 0);
    expect(Math.abs(along[1])).toBeCloseTo(1, 3);
    const inw = woundDirToWorld(prims, w, w.carveN!, 0);
    expect(inw[2]).toBeLessThan(-0.9);
    expect(w.carveDepth!).toBeLessThanOrEqual(Math.min(ROD_CALIBRE.depth, CUT.maxDepth) + 1e-9);
    expect(w.kerf).toBe(ROD_CALIBRE.kerf);
    expect(w.rimScale).toBe(ROD_CALIBRE.lip);
  });
  it('depth comes from the flesh and obeys the depth/length clamp: a 0.12 m cut gets the full calibre depth, a 0.03 m cut 1.4 x its half-length', () => {
    const cut = (half: number) => stampCut(prims, { a: [0, 1.25 - half, 0.15], b: [0, 1.25 + half, 0.15], view: [0, 0, -1] }, ROD_CALIBRE, 0, field);
    expect(cut(0.06).carveDepth).toBe(ROD_CALIBRE.depth);
    expect(cut(0.015).carveDepth).toBeCloseTo(CUT_SHADE.maxDepthPerHalfLen * 0.015, 9);
    expect(cut(0.015).carveDepth).toBeCloseTo(0.021, 9);
  });
  it('a slash across the arm silhouette (chord midpoint on its axis) anchors on the skin facing the viewer', () => {
    const g = stampCut(prims, { a: [0.35, 1.25, 0], b: [0.45, 1.25, 0], view: [0, 0, -1] }, ROD_CALIBRE, 0, field);
    expect(g.primIdx).toBe(1);
    const p = woundWorldPos(prims, g, 0);
    expect(p[2]).toBeGreaterThan(0.045);
    expect(p[2]).toBeLessThan(0.055);
    expect(p[1]).toBeCloseTo(1.25, 2);
    expect(Math.abs(field(p))).toBeLessThan(0.002);
    const inw = woundDirToWorld(prims, g, g.carveN!, 0);
    expect(inw[2]).toBeLessThan(-0.9);
  });
});

describe('cutExposureSpheres (for the sphere-only bone exposure)', () => {
  it('a chain of spheres along the slot, a single sphere for a crater', () => {
    const seg = { a: [0, 1.15, 0.15] as Vec3, b: [0, 1.35, 0.15] as Vec3, view: [0, 0, -1] as Vec3 };
    const w = stampCut(prims, seg, ROD_CALIBRE, 0, field);
    const s = cutExposureSpheres(prims, w, 0);
    expect(s.length).toBeGreaterThanOrEqual(3);
    expect(Math.min(...s.map(x => x.pos[1]))).toBeLessThan(1.18);
    expect(Math.max(...s.map(x => x.pos[1]))).toBeGreaterThan(1.32);
    // radius follows the lens, centres sit inward at interior points (z < the skin's 0.15)
    const mids = s.filter(x => Math.abs(x.pos[1] - 1.25) < 0.01);
    expect(mids.length).toBeGreaterThan(0);
    // r = depth x profile = 0.06 at the middle: radius max(2 kerf, r/2 + kerf) = 0.04, centred r/2 = 0.03 inward
    expect(mids[0]!.radius).toBeCloseTo(ROD_CALIBRE.depth / 2 + ROD_CALIBRE.kerf, 3);
    expect(mids[0]!.pos[2]).toBeCloseTo(0.15 - ROD_CALIBRE.depth / 2, 3);
    expect(s[0]!.radius).toBeCloseTo(2 * ROD_CALIBRE.kerf, 6);
    const crater = { primIdx: 0, local: w.local, radius: 0.05, type: 'pellet' as const, ageSec: 0, axis0: w.axis0 };
    expect(cutExposureSpheres(prims, crater, 0)).toEqual([{ pos: woundWorldPos(prims, crater, 0), radius: 0.05 }]);
  });
});
