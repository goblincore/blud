// src/lab/sdf-zombie/cut-wound.test.ts
import { describe, expect, it } from 'vitest';
import { CUT, CUT_SHADE, ROD_CALIBRE, cutCarve, cutExposureSpheres, cutLip, cutMask, cutsFromSweep, stampCut } from './cut-wound';
import { WOUND_PROFILES, woundDirToWorld, woundWorldPos } from './damage';
import { prim } from './head-pop';
import { sdBody, smax } from './validate';
import { cross } from './vec';
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
    let carved = 0, beyond = 0, far = 0;
    for (let a = -k.halfLen - 0.01; a <= k.halfLen + 0.01; a += 0.002) {
      for (let s = -0.02; s <= 0.2; s += 0.002) {
        for (let u = -0.03; u <= 0.03; u += 0.002) {
          const p = slotPoint(k, a, s, u);
          if (carveAt(k, p) > 0) {
            carved++;
            if (s > k.depth + k.sag + 1e-9) beyond++;
            if (-field(p) < 0.01 && s > k.depth + 0.01) far++;   // on the far skin: right at a skin, far below the slot's plane
          }
        }
      }
    }
    return { carved, beyond, far };
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
  it('an oblique 65 degree view of a +-60 degree slash across the arm still leaves the far skin alone', () => {
    const v = Math.tan((65 * Math.PI) / 180), n = Math.hypot(v, 1);
    const half = 0.05 * Math.sin(Math.PI / 3);   // chord at z = 0.05 cos 60 = 0.025
    const w = stampCut(prims, { a: [0.4 - half, 1.25, 0.025], b: [0.4 + half, 1.25, 0.025], view: [0, -v / n, -1 / n] }, ROD_CALIBRE, 0, field);
    expect(w.primIdx).toBe(1);
    const k = slotOf(w);
    const r = farSide(k);
    console.log(`far-side oblique arm: carved ${r.carved}, beyond ${r.beyond}, far-skin ${r.far}, sag ${k.sag}`);
    expect(r.carved).toBeGreaterThan(0);
    expect(r.far).toBe(0);
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
  // Max |grad| of the carve term, field gradient included (dIn comes from sdBody at each point). The 2.5 mm grid is coarse for
  // kerf 0.006; the analytical floor bound 0.7 x sqrt(1 + 2.8^2) ~ 2.08 (maxDepthPerHalfLen) backs it.
  const maxGrad = (k: ReturnType<typeof slotOf>, step: number): number => {
    const f = (p: Vec3) => carveAt(k, p);
    const h = 2e-4;
    let m = 0;
    for (let a = -k.halfLen - 0.02; a <= k.halfLen + 0.02; a += step) {
      for (let s = -0.02; s <= k.depth + k.sag + 0.02; s += step) {
        for (let u = -0.025; u <= 0.025; u += 0.001) {
          const p = slotPoint(k, a, s, u);
          const f0 = f(p);
          if (f0 < -0.003) continue;   // only the slot and its immediate surround: the steep regions are all there
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

// ---------------------------------------------------------------------------------------------------------------------
// The lip and the mask (Task 5 review): CPU mirrors of the WGSL, and the whole cut field the march sees:
//   F = smax(dBody, carve, kW) - lip,  kW = woundCfg.y (0.015) x clamp(kerf / 0.05, 0.1, 1),  lipScale = META.z.
// ---------------------------------------------------------------------------------------------------------------------
const LIP_SCALE = WOUND_PROFILES.pellet.rimSplayScale * ROD_CALIBRE.lip;   // META.z for a rod cut (character-view.ts)
const kWOf = (kerf: number) => 0.015 * Math.min(1, Math.max(0.1, kerf / 0.05));
const lipAt = (k: ReturnType<typeof slotOf>, p: Vec3, lipScale = LIP_SCALE) =>
  cutLip(p, k.mid, k.halfLen, k.along, k.inward, k.kerf, field(p), k.sag, lipScale);
const carvedAt = (k: ReturnType<typeof slotOf>, p: Vec3) => smax(field(p), carveAt(k, p), kWOf(k.kerf));
const fullAt = (k: ReturnType<typeof slotOf>, p: Vec3, lipScale = LIP_SCALE) => carvedAt(k, p) - lipAt(k, p, lipScale);
const maskAt = (k: ReturnType<typeof slotOf>, p: Vec3, nrm: Vec3) => cutMask(p, nrm, k.mid, k.halfLen, k.along, k.inward, k.depth, k.kerf, k.sag);
/** The outward normal of a back-skin sample of the capsule along +y through (cx, ., 0). */
const capsuleNormal = (cx: number, p: Vec3): Vec3 => { const x = p[0] - cx, z = p[2], l = Math.hypot(x, z); return [x / l, 0, z / l]; };
const armAlong = (cal = ROD_CALIBRE) => stampCut(prims, { a: [0.4, 1.15, 0.05], b: [0.4, 1.35, 0.05], view: [0, 0, -1] }, cal, 0, field);
const armSilhouette = (cal = ROD_CALIBRE) => stampCut(prims, { a: [0.35, 1.25, 0], b: [0.45, 1.25, 0], view: [0, 0, -1] }, cal, 0, field);
/** Skin points on the BACK of a capsule (outward normal facing away from the viewer at -z: n.z < -0.2), `inset` inside. */
const backSkin = (cx: number, r: number, inset = 0): Vec3[] => {
  const out: Vec3[] = [];
  for (let y = 1.05; y <= 1.45; y += 0.0025) {
    for (let th = Math.PI; th <= 2 * Math.PI; th += Math.PI / 180) {
      if (Math.sin(th) >= -0.2) continue;
      out.push([cx + (r - inset) * Math.cos(th), y, (r - inset) * Math.sin(th)]);
    }
  }
  return out;
};

describe('cutLip / cutMask: the lip and the mask stay on the near skin', () => {
  const cuts = () => [
    { name: 'torso along', k: slotOf(torsoCut(0.1, false)), back: backSkin(0, 0.15), cx: 0 },
    { name: 'torso around', k: slotOf(torsoCut(0.1, true)), back: backSkin(0, 0.15), cx: 0 },
    { name: 'arm along', k: slotOf(armAlong()), back: backSkin(0.4, 0.05), cx: 0.4 },
  ];
  it('(a) behind a front cut the lip lowers the far skin by < 0.05 mm and the mask is 0', () => {
    for (const { name, k, back, cx } of cuts()) {
      let lip = 0, mask = 0;
      for (const p of back) { lip = Math.max(lip, lipAt(k, p)); mask = Math.max(mask, maskAt(k, p, capsuleNormal(cx, p))); }
      console.log(`far skin ${name}: max lip ${(lip * 1000).toFixed(4)} mm, max mask ${mask.toExponential(2)}`);
      expect(lip).toBeLessThan(5e-5);
      expect(mask).toBe(0);
    }
  });
  // Thin limbs (schoolgirl forearms r 0.018-0.027, bonewalker 0.016-0.038): stampCut makes the floor 0.2 x thick above
  // the back skin, inside `far`'s 2-kerf fade, so `far` alone painted a stripe there. Measured max back-skin mask (back
  // skin = outward normal z < -0.2), `far` only -> with the normal gate:
  //   r 0.02: rod 1.000 -> 0.146, kerf 0.015 1.000 -> 0.853;  r 0.03: 0.762 -> 0, 1.000 -> 0.146;
  //   r 0.04: 0.131 -> 0, 0.957 -> 0;  r 0.045: 0 -> 0, 0.224 -> 0.
  // What remains is on the limb's SIDES (dot(nrm, inward) 0.26-0.5, i.e. 15-30 degrees past the side): a 2.2-kerf band is
  // wider than a 2 cm arm, so the cut wraps it. The back proper (dot >= 0.6, within 53 degrees of the back pole) is 0.
  for (const r of [0.02, 0.03, 0.04]) {
    it(`(a) a front cut along a ${r} m arm leaves its back unpainted (rod and kerf 0.015)`, () => {
      const thin = prim([0.4, 1.0, 0], [0.4, 1.5, 0], r, [1, 1, 1], { limb: 'armL', cluster: 2 });
      const tp: Primitive[] = [torso, thin];
      const tb = { prims: tp, clusters: [{ start: 0, count: 1, alive: true }, { start: 1, count: 1, alive: true }] } as unknown as Parameters<typeof sdBody>[1];
      const tf = (p: Vec3) => sdBody(p, tb);
      for (const [cal, sideMax] of [[ROD_CALIBRE, r <= 0.02 ? 0.2 : 1e-3], [{ ...ROD_CALIBRE, kerf: 0.015 }, r <= 0.02 ? 0.9 : r <= 0.03 ? 0.2 : 1e-3]] as const) {
        const w = stampCut(tp, { a: [0.4, 1.15, r], b: [0.4, 1.35, r], view: [0, 0, -1] }, cal, 0, tf);
        const mid = woundWorldPos(tp, w, 0), al = woundDirToWorld(tp, w, w.cutDir!, 0), inw = woundDirToWorld(tp, w, w.carveN!, 0);
        let back = 0, all = 0;
        for (const p of backSkin(0.4, r)) {
          const n = capsuleNormal(0.4, p);
          const m = cutMask(p, n, mid, w.radius, al, inw, w.carveDepth!, w.kerf!, w.sag!);
          all = Math.max(all, m);
          if (n[0] * inw[0] + n[1] * inw[1] + n[2] * inw[2] >= 0.6) back = Math.max(back, m);
        }
        console.log(`thin arm r ${r} kerf ${cal.kerf}: max mask on the back ${back.toFixed(3)}, on all back-facing skin ${all.toFixed(3)}`);
        expect(back).toBe(0);
        expect(all).toBeLessThanOrEqual(sideMax);
      }
    });
  }
  it('the mask still paints the near side: the skin on the slot line, the slot walls and floor; 0 past maskWidth x kerf', () => {
    const k = slotOf(torsoCut(0.1, false));
    const out: Vec3 = [-k.inward[0], -k.inward[1], -k.inward[2]];
    const side = cross(k.along, k.inward);
    expect(maskAt(k, slotPoint(k, 0, 0, 0), out)).toBe(1);
    expect(maskAt(k, slotPoint(k, 0, 0.01, 0.5 * k.kerf), side)).toBe(1);                 // a wall (normal ~ sideways)
    expect(maskAt(k, slotPoint(k, 0, 0.01, -0.5 * k.kerf), [-side[0], -side[1], -side[2]])).toBe(1);
    expect(maskAt(k, slotPoint(k, 0, 0.3 * k.kerf, 0.6 * k.kerf), [0.8 * side[0] + 0.2 * k.inward[0], 0.8 * side[1] + 0.2 * k.inward[1], 0.8 * side[2] + 0.2 * k.inward[2]])).toBe(1);
    expect(maskAt(k, slotPoint(k, 0, k.depth, 0), out)).toBe(1);                           // the floor
    expect(maskAt(k, slotPoint(k, 0, 0, k.kerf * CUT_SHADE.maskWidth + 1e-4), out)).toBe(0);
    expect(maskAt(k, slotPoint(k, 1.2 * k.halfLen, 0, 0), out)).toBe(0);
  });
  // The half-width is measured a fixed depth below the PRE-WOUND skin, found along `inward` at each |u| (the first form
  // probed 1 mm below the chord plane: off the slot a curved torso's skin falls away below that plane, so the carve-only
  // scan never met flesh and reported its 30 mm cap). The criterion depth is one blend width kW down: above it the
  // edge IS smax's rounded fillet (carve-only half-width 18.3 mm 1 mm down against a 10 mm kerf), which the lip, centred
  // at 1.5 kerf, everts by design. Measured (rod, torso along): carve-only 18.34 / 13.70 / 11.26 mm at 1 / 3 (= kW) /
  // 5 mm down; the old ungated lip 6.32 / 5.26 / 4.70 mm, open centre depth 47.1 of 60.0 mm; this lip 13.48 / 12.20 /
  // 11.02 mm, depth 60.0 mm. 1 mm down only the kerf is guaranteed (offKerf): the lip never narrows the slot below it.
  it('(b) with the lip on, the slot keeps >= 80% of its half-width one blend width below the skin and of its open centre depth', () => {
    for (const { name, k } of cuts()) {
      const kW = kWOf(k.kerf);
      const skinAt = (u: number) => {
        let lo = -0.05, hi = lo;
        while (hi < 0.2 && field(slotPoint(k, 0, hi, u)) >= 0) { lo = hi; hi += 0.001; }
        for (let i = 0; i < 30; i++) { const m = 0.5 * (lo + hi); if (field(slotPoint(k, 0, m, u)) >= 0) lo = m; else hi = m; }
        return hi;
      };
      const skins: number[] = [];
      for (let i = 0; i <= 1500; i++) skins.push(skinAt(i * 0.00002));
      const halfWidth = (F: (p: Vec3) => number, below: number) => {
        for (let i = 0; i <= 1500; i++) if (F(slotPoint(k, 0, skins[i]! + below, i * 0.00002)) < 0) return i * 0.00002;
        return 0.03;
      };
      const openDepth = (F: (p: Vec3) => number) => {
        for (let s = k.sag; s <= 0.2; s += 0.00002) if (F(slotPoint(k, 0, s, 0)) < 0) return s - k.sag;
        return 0.2;
      };
      const carved = (p: Vec3) => carvedAt(k, p), full = (p: Vec3) => fullAt(k, p);
      const mm = (x: number) => (x * 1000).toFixed(2);
      const w0 = halfWidth(carved, kW), w1 = halfWidth(full, kW), d0 = openDepth(carved), d1 = openDepth(full);
      const top0 = halfWidth(carved, 0.001), top1 = halfWidth(full, 0.001), low0 = halfWidth(carved, 0.005), low1 = halfWidth(full, 0.005);
      console.log(`slot ${name}: half-width carve-only -> with lip, 1 mm down ${mm(top0)} -> ${mm(top1)}, kW ${mm(kW)} mm down ${mm(w0)} -> ${mm(w1)} (${(100 * w1 / w0).toFixed(1)}%), 5 mm down ${mm(low0)} -> ${mm(low1)}; open centre depth ${mm(d0)} -> ${mm(d1)} mm (${(100 * d1 / d0).toFixed(1)}%)`);
      expect(w1).toBeGreaterThanOrEqual(0.8 * w0);
      expect(top1).toBeGreaterThanOrEqual(k.kerf);
      expect(d1).toBeGreaterThanOrEqual(0.8 * d0);
    }
  });
  it('(d) the lip still raises the near skin beside the cut: > 0.3 mm at |u| = lipOffset x kerf', () => {
    for (const { name, k } of cuts()) {
      const u = CUT_SHADE.lipOffset * k.kerf;
      const skin = (F: (p: Vec3) => number) => {
        for (let s = -0.02; s <= 0.05; s += 0.00001) if (F(slotPoint(k, 0, s, u)) < 0) return s;
        return 0.05;
      };
      const raise = skin((p) => carvedAt(k, p)) - skin((p) => fullAt(k, p));
      console.log(`lip ${name}: raises the skin at |u| = ${(u * 1000).toFixed(1)} mm by ${(raise * 1000).toFixed(3)} mm`);
      expect(raise).toBeGreaterThan(0.0003);
    }
  });
  it('the lid: the carve is closed kerf + lidSlack x halfLen outward of the anchor\'s tangent plane', () => {
    const k = slotOf(torsoCut(0.1, false));
    const lidH = k.kerf + CUT_SHADE.lidSlack * k.halfLen;
    expect(carveAt(k, slotPoint(k, 0, -0.9 * lidH, 0))).toBeGreaterThan(0);
    for (const s of [-1.01 * lidH, -0.05, -0.2]) expect(carveAt(k, slotPoint(k, 0, s, 0))).toBeLessThan(0);
  });
});

// The raw-plane lid on the owner's own surface: compare smax(dBody, carve) with and without it (cutCarve's `lid` test
// seam) at near-surface samples. On convex skin it changes no sign. In a concave crease the skin rises above the
// anchor's tangent plane; the lidSlack (0.25 halfLen) covers the ordinary creases. Measured on a fuller grid (scratch,
// 21.5M near-surface samples): 0 flips on every convex fixture (torso along / around at halfLen 0.015-0.175, arm
// along, silhouette, oblique; kerf 0.006 / 0.01 / 0.015) with or without slack; the three crease fixtures flipped
// 69882 with no slack and 1863 with 0.25 halfLen, all on the oblique armpit cut. A flip only removes carve.
describe('the lid leaves the owner\'s surface alone and closes the channel above a cut', () => {
  const smoothTorso = prim([0, 1.0, 0], [0, 1.5, 0], 0.15, [1, 1, 1], { limb: 'torso', cluster: 1, blendK: 0.03 });
  const sideArm = prim([0.1, 1.38, 0], [0.45, 1.38, 0], 0.05, [1, 1, 1], { limb: 'armL', cluster: 1, blendK: 0.03 });
  const creasePrims: Primitive[] = [smoothTorso, sideArm];
  const creaseBody = { prims: creasePrims, clusters: [{ start: 0, count: 2, alive: true }] } as unknown as Parameters<typeof sdBody>[1];
  const creaseField = (p: Vec3) => sdBody(p, creaseBody);
  const flips = (ps: Primitive[], f: (p: Vec3) => number, w: ReturnType<typeof stampCut>) => {
    const k = { mid: woundWorldPos(ps, w, 0), along: woundDirToWorld(ps, w, w.cutDir!, 0), inward: woundDirToWorld(ps, w, w.carveN!, 0), depth: w.carveDepth!, kerf: w.kerf!, sag: w.sag!, halfLen: w.radius };
    let n = 0, flip = 0;
    const step = Math.min(0.004, k.halfLen / 8);
    for (let a = -k.halfLen - 0.01; a <= k.halfLen + 0.01; a += step) {
      for (let s = -0.03; s <= k.sag + k.depth + 0.02; s += step / 2) {
        for (let u = -0.03; u <= 0.03; u += 0.001) {
          const p = slotPoint(k, a, s, u), d = f(p);
          if (Math.abs(d) > 0.02) continue;
          n++;
          const on = smax(d, cutCarve(p, k.mid, k.halfLen, k.along, k.inward, k.depth, k.kerf, d, k.sag, 0, true), kWOf(k.kerf));
          const off = smax(d, cutCarve(p, k.mid, k.halfLen, k.along, k.inward, k.depth, k.kerf, d, k.sag, 0, false), kWOf(k.kerf));
          expect(on).toBeLessThanOrEqual(off);   // the lid can only remove carve
          if ((on < 0) !== (off < 0)) flip++;
        }
      }
    }
    return { n, flip };
  };
  it('no owner sign flip on the convex fixtures (sampled), and few on concave creases', () => {
    let total = 0;
    for (const kerf of [0.006, 0.015]) {
      const cal = { ...ROD_CALIBRE, kerf };
      const convex: [string, ReturnType<typeof stampCut>][] = [
        ['torso along 0.015', torsoCut(0.015, false, cal)], ['torso around 0.05', torsoCut(0.05, true, cal)],
        ['torso around 0.1', torsoCut(0.1, true, cal)], ['torso along 0.175', torsoCut(0.175, false, cal)],
        ['arm along', armAlong(cal)], ['arm silhouette', armSilhouette(cal)],
      ];
      for (const [name, w] of convex) {
        const r = flips(prims, field, w);
        total += r.n;
        expect(r.flip, `kerf ${kerf} ${name}`).toBe(0);
      }
      const creases: [string, ReturnType<typeof stampCut>, number][] = [
        ['crease top', stampCut(creasePrims, { a: [0.08, 1.5, 0.0], b: [0.3, 1.43, 0.0], view: [0, -1, 0] }, cal, 0, creaseField), 0],
        ['crease front', stampCut(creasePrims, { a: [0.1, 1.32, 0.11], b: [0.3, 1.38, 0.05], view: [0, 0, -1] }, cal, 0, creaseField), 0],
        ['armpit', stampCut(creasePrims, { a: [0.13, 1.25, 0.06], b: [0.2, 1.33, 0.0], view: [-0.5, 0.5, -0.7] }, cal, 0, creaseField), 0.005],
      ];
      for (const [name, w, frac] of creases) {
        const r = flips(creasePrims, creaseField, w);
        total += r.n;
        console.log(`lid, kerf ${kerf} ${name}: ${r.flip} owner sign flips of ${r.n} near-surface samples`);
        expect(r.flip / r.n, `kerf ${kerf} ${name}`).toBeLessThanOrEqual(frac);
      }
    }
    console.log(`lid: ${total} near-surface samples checked`);
  }, 300000);
  it('a foreign ball lying across the channel above a chest cut is not carved (it was, before the raw-plane lid)', () => {
    const k = slotOf(torsoCut(0.05, false));
    const lidH = k.kerf + CUT_SHADE.lidSlack * k.halfLen;
    // A 3 cm ball, its bottom 5 mm above the lid.
    const c: Vec3 = [k.mid[0] - k.inward[0] * (lidH + 0.035), k.mid[1] - k.inward[1] * (lidH + 0.035), k.mid[2] - k.inward[2] * (lidH + 0.035)];
    const ball = (p: Vec3) => Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]) - 0.03;
    let inside = 0, carvedOn = 0, carvedOff = 0, maxOn = -Infinity;
    for (let x = -0.03; x <= 0.03; x += 0.002) for (let y = -0.03; y <= 0.03; y += 0.002) for (let z = -0.03; z <= 0.03; z += 0.002) {
      const p: Vec3 = [c[0] + x, c[1] + y, c[2] + z];
      if (ball(p) >= 0) continue;
      inside++;
      const dIn = Math.min(field(p), ball(p));
      const on = cutCarve(p, k.mid, k.halfLen, k.along, k.inward, k.depth, k.kerf, dIn, k.sag, 0, true);
      const off = cutCarve(p, k.mid, k.halfLen, k.along, k.inward, k.depth, k.kerf, dIn, k.sag, 0, false);
      if (on > 0) carvedOn++;
      if (off > 0) carvedOff++;
      maxOn = Math.max(maxOn, on);
    }
    console.log(`foreign ball: ${inside} points inside, carved without the lid ${carvedOff}, with it ${carvedOn} (max carve ${maxOn.toFixed(4)})`);
    expect(carvedOff).toBeGreaterThan(0);
    expect(carvedOn).toBe(0);
  });
});

describe('stampCut: a slash across a thin limb\'s silhouette leaves its back closed', () => {
  for (const [name, cal] of [['rod', ROD_CALIBRE], ['kerf 0.015', { ...ROD_CALIBRE, kerf: 0.015 }]] as const) {
    it(`${name}: depth fits between the chord and thickFrac of the flesh; no far-skin opening in the middle 70% of the chord`, () => {
      const w = armSilhouette(cal);
      const k = slotOf(w);
      expect(k.sag).toBeGreaterThan(0.045);
      expect(k.sag + k.depth).toBeLessThanOrEqual(CUT.thickFrac * 0.1 + CUT.thickFrac * 0.005 + 1e-9);   // probe step slack
      expect(k.depth).toBeGreaterThanOrEqual(cal.kerf);
      const dEff = Math.min(k.depth, CUT_SHADE.maxDepthPerHalfLen * k.halfLen);
      let opened = 0, n = 0, middle = 0, minA = Infinity, maxBelow = -Infinity;
      for (const p of backSkin(0.4, 0.05, 0.0005)) {
        n++;
        if (fullAt(k, p) < 0) continue;
        opened++;
        const rel = [p[0] - k.mid[0], p[1] - k.mid[1], p[2] - k.mid[2]];
        const a = Math.abs(rel[0]! * k.along[0] + rel[1]! * k.along[1] + rel[2]! * k.along[2]) / k.halfLen;
        const below = rel[0]! * k.inward[0] + rel[1]! * k.inward[1] + rel[2]! * k.inward[2] - k.sag;
        if (a <= 0.7) middle++;
        minA = Math.min(minA, a); maxBelow = Math.max(maxBelow, below);
      }
      console.log(`silhouette ${name}: sag ${k.sag.toFixed(4)} depth ${k.depth.toFixed(4)}, opened ${opened} of ${n} back-skin samples, ${middle} within |a| <= 0.7 h, nearest the middle at |a| = ${minA.toFixed(3)} h, deepest ${(maxBelow * 1000).toFixed(1)} mm below the chord plane`);
      expect(middle).toBe(0);
      // Pinned counts and positions (measured 234 at >= 0.904 h, 784 at >= 0.747 h; unchanged by the raw-plane lid).
      const [maxOpened, minTip] = cal.kerf === ROD_CALIBRE.kerf ? [300, 0.85] : [900, 0.7];
      expect(opened).toBeLessThanOrEqual(maxOpened);
      if (opened > 0) expect(minA).toBeGreaterThanOrEqual(minTip);
      // Every opened sample is flesh a straight blade at the slot's full depth (plus smax's blend) would sever anyway.
      if (opened > 0) expect(maxBelow).toBeLessThan(dEff + kWOf(k.kerf));
    });
  }
});

describe('cutLip + cutCarve: Lipschitz bound of the whole cut field', () => {
  // At the rod's lip scale (0.8) and at the clamp a calibre's lip is held to (maxLipScale; 1.333 measured 2.275).
  // The clamp row sweeps the short half-lengths only, where the lip's along-slot slope peaks (the 1.333 failure was at
  // 0.015); the full sweep at 1.1 measured 2.075 too (225 s, too slow to keep).
  for (const lipScale of [LIP_SCALE, CUT_SHADE.maxLipScale]) it(`max |grad| of smax(dBody, carve, kW) - lip <= 2.2 over halfLen x depth x kerf (lip scale ${lipScale})`, () => {
    let worst = 0, worstAt = '';
    const h = 2e-4, step = 0.0025;
    for (const half of lipScale === LIP_SCALE ? [0.015, 0.05, 0.1, 0.175] : [0.015, 0.05]) {
      for (const depth of [0.03, 0.06, 0.15]) {
        for (const kerf of [0.006, 0.01, 0.015]) {
          const kinds = half <= 0.1 ? [false, true] : [false];
          for (const around of kinds) {
            const k = slotOf(torsoCut(half, around, { depth, kerf, lip: 1 }));
            const F = (p: Vec3) => fullAt(k, p, lipScale);
            for (let a = -k.halfLen - 0.02; a <= k.halfLen + 0.02; a += step) {
              for (let s = -0.02; s <= k.depth + k.sag + 0.02; s += step) {
                for (let u = -0.04; u <= 0.04; u += 0.001) {
                  const p = slotPoint(k, a, s, u);
                  const f0 = F(p);
                  if (f0 < -0.003 || f0 > 0.02) continue;
                  for (const sg of [1, -1]) {
                    const g = Math.hypot(
                      (F(slotPoint(k, a + sg * h, s, u)) - f0) / h,
                      (F(slotPoint(k, a, s + sg * h, u)) - f0) / h,
                      (F(slotPoint(k, a, s, u + sg * h)) - f0) / h);
                    if (g > worst) { worst = g; worstAt = `h ${half} depth ${depth} kerf ${kerf} ${around ? 'around' : 'along'} at a ${a.toFixed(3)} s ${s.toFixed(3)} u ${u.toFixed(3)}`; }
                  }
                }
              }
            }
          }
        }
      }
    }
    console.log(`lipschitz (carve + lip, lip scale ${lipScale}) max ${worst.toFixed(3)} at ${worstAt}`);
    expect(worst).toBeLessThanOrEqual(2.2);
  }, 900000);
});
