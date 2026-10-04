import { describe, expect, it } from 'vitest';
import {
  HEAD_SPLIT, REGION_MARGIN, choosePreset, kickSplit, makeSplitState, splitField, splitWarpOf, stepSplit, unwarpDir,
  unwarpPoint,
  type HeadFrame, type SplitWarp,
} from './head-split';
import type { Vec3 } from './types';
import { qFromAxisAngle, qRotate } from './vec';

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
/** Rodrigues, written out independently of the module. */
const rot = (v: Vec3, ax: Vec3, t: number): Vec3 => {
  const c = Math.cos(t), s = Math.sin(t), k = dot(ax, v), x = cross(ax, v);
  return [v[0] * c + x[0] * s + ax[0] * k * (1 - c), v[1] * c + x[1] * s + ax[1] * k * (1 - c), v[2] * c + x[2] * s + ax[2] * k * (1 - c)];
};
const moveOpen = (w: SplitWarp, q: Vec3, theta: number): Vec3 => add(w.h, rot(sub(q, w.h), w.a, theta));

// A head: a sphere of radius 0.11 at (0, 1.7, 0) on a neck capsule down to (0, 1.45, 0). Head frame = identity.
const FRAME: HeadFrame = { centre: [0, 1.7, 0], quat: [0, 0, 0, 1], radius: 0.11 };
const sdCapsule = (p: Vec3, a: Vec3, b: Vec3, r: number) => {
  const pa = sub(p, a), ba = sub(b, a); const t = Math.max(0, Math.min(1, dot(pa, ba) / dot(ba, ba)));
  return len(sub(pa, [ba[0] * t, ba[1] * t, ba[2] * t])) - r;
};
const head = (p: Vec3) => Math.min(len(sub(p, FRAME.centre)) - 0.11, sdCapsule(p, [0, 1.45, 0], [0, 1.62, 0], 0.05));
// The same head with a crest (a hair crest / horn) running up and back off the crown, ON the old middle plane and
// reaching past rho: inside rho it splits and turns with the halves, beyond rho it stays put. This is what pins the
// ball caps (dh - rho on the halves, rho - dh on the rest); the plain head has nothing above the hinge beyond rho.
const CREST_A: Vec3 = [0, 1.75, -0.02], CREST_B: Vec3 = [0, 1.97, -0.06], CREST_R = 0.03;
const headCrest = (p: Vec3) => Math.min(head(p), sdCapsule(p, CREST_A, CREST_B, CREST_R));
const openIn = (frame: HeadFrame, preset: 'middle' | 'face', impactLocal: Vec3, angleFrac = 1): SplitWarp => {
  const st = { ...makeSplitState(), ...choosePreset(preset === 'middle' ? [1, 0, 0] : [0, 0, 1], impactLocal, frame.radius) };
  const p = HEAD_SPLIT.presets[st.preset!];
  return splitWarpOf({ ...st, angle: angleFrac * (st.sides === 0 ? p.maxBoth : p.maxOne) }, frame)!;
};
const open = (preset: 'middle' | 'face', impactLocal: Vec3, angleFrac = 1) => openIn(FRAME, preset, impactLocal, angleFrac);
const CASES = [
  ['middle both', open('middle', [0, 0, 0.1])],
  ['middle one side', open('middle', [0.06, 0, 0.1])],
  ['middle one side (-)', open('middle', [-0.06, 0, 0.1])],
  ['face', open('face', [0, 0, 0.1])],
] as const;

describe('choosePreset: the blade plane picks the preset; the impact sets the offset and the side that moves', () => {
  it('a sagittal blade plane (normal ~ head x) -> middle; a coronal one (normal ~ head z) -> face', () => {
    expect(choosePreset([0.95, 0.1, 0.3], [0, 0, 0.1], 0.11).preset).toBe('middle');
    expect(choosePreset([0.2, 0.1, 0.97], [0, 0, 0.1], 0.11).preset).toBe('face');
    expect(choosePreset([-0.95, 0.1, 0.3], [0, 0, 0.1], 0.11).preset).toBe('middle');   // any sign
  });
  it('middle: a centred impact opens both halves; off-centre opens only the smaller side, offset clamped to 40% R', () => {
    expect(choosePreset([1, 0, 0], [0.005, 0, 0.1], 0.11).sides).toBe(0);
    expect(choosePreset([1, 0, 0], [0.005, 0, 0.1], 0.11).offset).toBe(0);
    const r = choosePreset([1, 0, 0], [0.06, 0, 0.1], 0.11);
    expect(r.sides).toBe(1);
    expect(r.offset).toBeCloseTo(0.4 * 0.11, 9);
    const m = choosePreset([1, 0, 0], [-0.03, 0, 0.1], 0.11);
    expect(m.sides).toBe(-1);
    expect(m.offset).toBeCloseTo(-0.03, 12);
  });
  it('face always opens its face side only', () => {
    expect(choosePreset([0, 0, 1], [0, 0, 0.1], 0.11).sides).toBe(1);
  });
});

describe('the spring: kick, overshoot, settle exactly on the target', () => {
  it('kicked to 0.6, it overshoots and settles at 0.6', () => {
    let st = kickSplit({ ...makeSplitState(), preset: 'middle', sides: 0, offset: 0 }, 0.6);
    let peak = 0;
    for (let i = 0; i < 240; i++) { st = stepSplit(st, 1 / 60); peak = Math.max(peak, st.angle); }
    expect(peak).toBeGreaterThan(0.6 * 1.05);
    expect(st.angle).toBe(0.6);
    expect(st.vel).toBe(0);
  });
  it('a closed state (no preset) does not move', () => {
    const st = makeSplitState();
    expect(stepSplit(st, 1 / 60)).toEqual(st);
  });
});

describe('the warp: rigid pieces about the hinge', () => {
  it('a closed split (angle 0) is no warp at all', () => {
    expect(splitWarpOf(makeSplitState(), FRAME)).toBeNull();
    expect(splitWarpOf({ ...makeSplitState(), preset: 'middle' }, FRAME)).toBeNull();
    expect(splitField(null, head, [0.01, 1.7, 0])).toBe(head([0.01, 1.7, 0]));
  });
  it('unwarpPoint inverts the opening: a point on the opened + half maps back onto the un-warped head', () => {
    const w = open('middle', [0, 0, 0.1]);
    const q: Vec3 = [0.11, 1.72, 0];   // on the un-warped + half's skin
    const moved = moveOpen(w, q, w.thetaP);
    expect(Math.abs(splitField(w, head, moved) - head(q))).toBeLessThan(1e-9);   // the skin moved with the half
    const back = unwarpPoint(w, moved, head);
    expect(len(sub(back.q, q))).toBeLessThan(1e-9);
    expect(back.piece).toBe(1);
  });
  it('unwarpPoint on the - half returns piece 2; below the hinge it returns the point itself, piece 0', () => {
    const w = open('middle', [0, 0, 0.1]);
    const q: Vec3 = [-0.11, 1.72, 0];
    const back = unwarpPoint(w, moveOpen(w, q, w.thetaM), head);
    expect(len(sub(back.q, q))).toBeLessThan(1e-9);
    expect(back.piece).toBe(2);
    const neck: Vec3 = [0.05, 1.5, 0];
    expect(unwarpPoint(w, neck, head)).toEqual({ q: neck, piece: 0 });
  });
  it('unwarpDir takes a direction on a moved half back into the un-warped frame', () => {
    const w = open('middle', [0, 0, 0.1]);
    const v: Vec3 = [0.3, 0.8, -0.52];
    const back = unwarpDir(w, 1, rot(v, w.a, w.thetaP));
    expect(len(sub(back, v))).toBeLessThan(1e-12);
    expect(len(sub(unwarpDir(w, 2, rot(v, w.a, w.thetaM)), v))).toBeLessThan(1e-12);
    expect(unwarpDir(w, 0, v)).toBe(v);
  });
  it('u = n x a points up from the hinge into the head, and a x u = +n', () => {
    const w = open('middle', [0, 0, 0.1]);
    const u = cross(w.n, w.a);
    expect(dot(u, sub([0.01, 1.8, 0], w.h))).toBeGreaterThan(0);
    expect(len(sub(cross(w.a, u), w.n))).toBeLessThan(1e-12);
  });
  // The direction proof. Written without w.a: for the identity frame, n = +x and up = +y, so "away from the plane" for
  // the + half means its crown swings toward +x, i.e. a clockwise turn seen from +z. Flip the sign of a (or of the
  // un-warp) and the moved crown point is empty and the solid's +x extent does not grow, so both checks fail.
  it('the + half moves AWAY from the plane: its crown swings toward +n (fails with the wrong rotation sign)', () => {
    const w = open('middle', [0, 0, 0.1]);
    const t = w.thetaP, c = Math.cos(t), s = Math.sin(t);
    const q0: Vec3 = [0.05, 1.75, 0];   // inside the closed + half, near the crown
    const v = sub(q0, w.h);
    const m: Vec3 = add(w.h, [v[0] * c + v[1] * s, -v[0] * s + v[1] * c, v[2]]);   // clockwise about +z
    expect(m[0]).toBeGreaterThan(q0[0]);
    expect(head(q0)).toBeLessThan(0);
    expect(splitField(w, head, m)).toBeLessThan(0);
    expect(splitField(w, head, m)).toBeCloseTo(head(q0), 9);
    // The solid's extent along n grows on both sides when both halves open.
    let maxX = -Infinity, minX = Infinity;
    for (let x = -0.3; x <= 0.3; x += 0.005) for (let y = 1.4; y <= 2.0; y += 0.005) {
      if (splitField(w, head, [x, y, 0]) < 0) { maxX = Math.max(maxX, x); minX = Math.min(minX, x); }
    }
    expect(maxX).toBeGreaterThan(0.11 + 0.02);
    expect(minX).toBeLessThan(-0.11 - 0.02);
  });
  it('a rotated, moved head frame splits the same head in world space', () => {
    const q = qFromAxisAngle([0.3, 1, -0.2], 1.1);
    const c: Vec3 = [2, 0.4, -1];
    const toWorld = (pl: Vec3): Vec3 => add(c, qRotate(q, sub(pl, FRAME.centre)));
    const qc: typeof q = [-q[0], -q[1], -q[2], q[3]];
    const toLocal = (pw: Vec3): Vec3 => add(FRAME.centre, qRotate(qc, sub(pw, c)));
    const headW = (pw: Vec3) => head(toLocal(pw));
    for (const preset of ['middle', 'face'] as const) for (const imp of [[0, 0, 0.1], [0.06, 0, 0.1], [0, 0, 0.11]] as Vec3[]) {
      const wl = open(preset, imp);
      const ww = openIn({ centre: c, quat: q, radius: FRAME.radius }, preset, imp);
      for (const pl of [[0.05, 1.75, 0], [-0.09, 1.71, 0.03], [0.02, 1.62, 0.1], [0, 1.82, -0.02], [0.2, 1.9, 0.1]] as Vec3[]) {
        expect(splitField(ww, headW, toWorld(pl))).toBeCloseTo(splitField(wl, head, pl), 9);
      }
    }
  });
  it('the neck below the hinge does not move: splitField == head there', () => {
    for (const [, w] of CASES) {
      for (const p of [[0, 1.5, 0.04], [0.04, 1.52, 0], [0, 1.47, -0.05]] as Vec3[]) expect(splitField(w, head, p)).toBeCloseTo(head(p), 9);
    }
  });
  it('a gap opens: the old plane between the halves is empty above the hinge', () => {
    const w = open('middle', [0, 0, 0.1]);
    expect(head([0, 1.78, 0.02])).toBeLessThan(0);                      // inside the closed head
    expect(splitField(w, head, [0, 1.78, 0.02])).toBeGreaterThan(0);      // in the gap once open
  });
  it('off-centre: only the smaller (+) side moves; the larger side is exactly where it was', () => {
    const w = open('middle', [0.06, 0, 0.1]);
    expect(w.thetaM).toBe(0);
    expect(w.thetaP).toBeGreaterThan(0);
    for (const p of [[-0.08, 1.72, 0], [-0.05, 1.78, 0.04]] as Vec3[]) expect(splitField(w, head, p)).toBeCloseTo(head(p), 9);
    const wm = open('middle', [-0.06, 0, 0.1]);
    expect(wm.thetaP).toBe(0);
    expect(wm.thetaM).toBeLessThan(0);
    for (const p of [[0.08, 1.72, 0], [0.05, 1.78, 0.04]] as Vec3[]) expect(splitField(wm, head, p)).toBeCloseTo(head(p), 9);
  });
  it('outside the region the field is the body field or the region bound, never larger than the true union', () => {
    const w = open('middle', [0, 0, 0.1]);
    const far: Vec3 = [0.6, 1.7, 0];
    expect(splitField(w, head, far)).toBeLessThanOrEqual(head(far) + 1e-12);
    expect(splitField(w, head, far)).toBeGreaterThan(0.2);
    expect(w.r).toBeGreaterThan(len(sub(FRAME.centre, w.h)) + FRAME.radius + REGION_MARGIN * 0.99);
  });
});

// The un-merged reference, straight from the header formula: three pieces, three f evaluations, its own Rodrigues.
const refPieces = (w: SplitWarp, f: (q: Vec3) => number, p: Vec3) => {
  const u = cross(w.n, w.a), rho = w.r - REGION_MARGIN, dh = len(sub(p, w.h));
  const s = (q: Vec3) => dot(w.n, q) - w.d0, up = (q: Vec3) => dot(u, sub(q, w.h));
  const qp = moveOpen(w, p, -w.thetaP), qm = moveOpen(w, p, -w.thetaM);
  const d = [
    Math.max(f(p), Math.min(up(p), rho - dh)),
    Math.max(f(qp), -s(qp), -up(qp), dh - rho),
    Math.max(f(qm), s(qm), -up(qm), dh - rho),
  ] as const;
  return { rho, dh, s, up, qp, qm, d };
};
const refField = (w: SplitWarp, f: (q: Vec3) => number, p: Vec3) => {
  const r = refPieces(w, f, p), shell = REGION_MARGIN + Math.abs(r.dh - w.r);
  return r.dh > w.r ? Math.min(r.d[0], shell) : Math.min(r.d[0], r.d[1], r.d[2], shell);
};
/** Exact union membership: the material that stays (body, and below the hinge plane or at least rho from h), plus each
 *  half's material (body on its side of the plane, above the hinge plane, within rho of h), taken through its turn. */
const member = (w: SplitWarp, f: (q: Vec3) => number, p: Vec3) => {
  const r = refPieces(w, f, p);
  return (f(p) <= 0 && (r.up(p) <= 0 || r.dh >= r.rho))
    || (r.dh <= r.rho && f(r.qp) <= 0 && r.s(r.qp) >= 0 && r.up(r.qp) >= 0)
    || (r.dh <= r.rho && f(r.qm) <= 0 && r.s(r.qm) <= 0 && r.up(r.qm) >= 0);
};
/** Deterministic points: half spread over the head's box, half packed about the crest (where rho cuts it). */
const samples = (n: number): Vec3[] => {
  let st = 0x9e3779b9;
  const rnd = () => { st = (st + 0x6d2b79f5) | 0; let t = Math.imul(st ^ (st >>> 15), 1 | st); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const out: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    out.push(i % 2 === 0
      ? [-0.32 + 0.64 * rnd(), 1.35 + 0.75 * rnd(), -0.32 + 0.64 * rnd()]
      : [-0.07 + 0.14 * rnd(), 1.72 + 0.27 * rnd(), -0.12 + 0.14 * rnd()]);
  }
  return out;
};
const FIXTURES = [['head', head], ['head + crest', headCrest]] as const;

describe('the ball caps: what moves is above the hinge AND within rho of h; the rest stays (pinned by the crest)', () => {
  // occlusion.wgsl.ts samples AO as clamp(mapBody(p + n * 0.06) / 0.06, 0.35, 1). Near the region sphere the field is
  // capped at C = REGION_MARGIN + |dh - r|, so a margin below that 0.06 probe distance darkens open-air surface (at
  // 0.03, 14-20% of surface samples, by up to 0.48). Keep the margin at least the AO probe distance.
  it('REGION_MARGIN is at least the AO probe distance (0.06)', () => {
    expect(REGION_MARGIN).toBeGreaterThanOrEqual(0.06);
  });
  it('the crest fixture straddles rho in every case (so the caps decide where it tears)', () => {
    for (const [, w] of CASES) {
      const rho = w.r - REGION_MARGIN;
      expect(len(sub(CREST_A, w.h))).toBeLessThan(rho - CREST_R);
      expect(len(sub(CREST_B, w.h)) + CREST_R).toBeGreaterThan(rho + 0.02);
      expect(dot(cross(w.n, w.a), sub(CREST_A, w.h))).toBeGreaterThan(0);   // above the hinge plane
    }
  });
  for (const [fname, f] of FIXTURES) for (const [name, w] of CASES) {
    it(`${fname}, ${name}: the field's sign is exact union membership, and it equals the un-merged three-piece field`, () => {
      let mism = 0, worstRef = 0, inside = 0;
      for (const p of samples(30000)) {
        const F = splitField(w, f, p);
        if (Math.abs(F) > 1e-9 && (F <= 0) !== member(w, f, p)) mism++;
        if (F <= 0) inside++;
        worstRef = Math.max(worstRef, Math.abs(F - refField(w, f, p)));
      }
      console.log(`caps ${fname}, ${name}: ${mism} sign mismatches, ${inside} inside, max |F - ref| ${worstRef.toExponential(2)}`);
      expect(inside).toBeGreaterThan(300);
      expect(mism).toBe(0);
      expect(worstRef).toBeLessThan(1e-12);
    });
  }
  it('cost: a one-sided split evaluates f twice inside the region, a two-sided one three times, once outside', () => {
    const count = (w: SplitWarp, p: Vec3) => { let n = 0; splitField(w, (q) => { n++; return headCrest(q); }, p); return n; };
    const inR: Vec3 = [0.02, 1.76, 0.01], far: Vec3 = [0.7, 1.7, 0];
    expect(count(CASES[0][1], inR)).toBe(3);
    expect(count(CASES[1][1], inR)).toBe(2);
    expect(count(CASES[2][1], inR)).toBe(2);
    expect(count(CASES[3][1], inR)).toBe(2);
    for (const [, w] of CASES) expect(count(w, far)).toBe(1);
  });
});

describe('the split field is a sound, continuous distance bound (the march relies on it)', () => {
  for (const [fname, fx] of FIXTURES) for (const [name, w] of CASES) {
    it(`${fname}, ${name}: |grad| <= 1.05 and no jump across the old plane, the hinge plane, the rho or region sphere`, () => {
      // The Lipschitz constant, measured as difference quotients |F(p + e d) - F(p)| / e along the three axes and one
      // quasi-random unit direction per point (the spread of directions over the grid finds any |grad| > 1.05). Not
      // hypot of the three axis differences: at a convex crease (a max of caps, the neck capsule's axis) each axis
      // difference is <= 1 but their hypot reaches sqrt(3), and the UN-split fixture alone scores sqrt(3) that way.
      const F = (p: Vec3) => splitField(w, fx, p);
      const e = 1e-4; let worst = 0, jump = 0, i = 0;
      for (let x = -0.3; x <= 0.3; x += 0.01) for (let y = 1.35; y <= 2.05; y += 0.01) for (let z = -0.3; z <= 0.3; z += 0.02) {
        const p: Vec3 = [x, y, z], f = F(p);
        const ct = 1 - 2 * ((i * 0.618033988749895) % 1), st = Math.sqrt(1 - ct * ct), ph = (i++) * 2.399963229728653;
        const d: Vec3 = [st * Math.cos(ph) * e, ct * e, st * Math.sin(ph) * e];
        const g = Math.max(
          Math.abs(F([x + e, y, z]) - f), Math.abs(F([x, y + e, z]) - f), Math.abs(F([x, y, z + e]) - f), Math.abs(F(add(p, d)) - f),
        ) / e;
        worst = Math.max(worst, g);
        jump = Math.max(jump, Math.abs(F([x + 1e-6, y, z]) - f));
      }
      // The grid rarely lands within 1e-6 of a seam, so straddle each seam on purpose: the old plane (s = 0), the hinge
      // plane (u.(p - h) = 0), the rho sphere (the ball caps) and the region sphere (|p - h| = r), each at +-eps along
      // its own normal.
      const u = cross(w.n, w.a), eps = 1e-7, rho = w.r - REGION_MARGIN;
      let seam = 0;
      for (let i = 0; i < 4000; i++) {
        // A deterministic spread of points through the region.
        const t = i / 4000, ph = Math.acos(1 - 2 * t), th = i * 2.399963229728653;
        const d: Vec3 = [Math.sin(ph) * Math.cos(th), Math.cos(ph), Math.sin(ph) * Math.sin(th)];
        const rr = w.r * ((i * 0.618033988749895) % 1);
        const base = add(w.h, [d[0] * rr, d[1] * rr, d[2] * rr]);
        const sh = dot(w.n, base) - w.d0, uh = dot(u, sub(base, w.h));
        const onPlane = sub(base, [w.n[0] * sh, w.n[1] * sh, w.n[2] * sh]);
        const onHinge = sub(base, [u[0] * uh, u[1] * uh, u[2] * uh]);
        const onSphere = add(w.h, [d[0] * w.r, d[1] * w.r, d[2] * w.r]);
        const onRho = add(w.h, [d[0] * rho, d[1] * rho, d[2] * rho]);
        for (const [pt, nn] of [[onPlane, w.n], [onHinge, u], [onSphere, d], [onRho, d]] as const) {
          const lo = F(sub(pt, [nn[0] * eps, nn[1] * eps, nn[2] * eps]));
          const hi = F(add(pt, [nn[0] * eps, nn[1] * eps, nn[2] * eps]));
          seam = Math.max(seam, Math.abs(hi - lo));
        }
      }
      console.log(`split ${fname}, ${name}: max |grad| ${worst.toFixed(3)}, max 1e-6 jump ${jump.toExponential(2)}, max seam straddle (2e-7) ${seam.toExponential(2)}`);
      expect(worst).toBeLessThanOrEqual(1.05);
      expect(jump).toBeLessThan(1e-4);
      expect(seam).toBeLessThan(1e-5);
    }, 120000);
  }
});
