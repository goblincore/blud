import { describe, expect, it } from 'vitest';
import {
  HEAD_SPLIT, REGION_MARGIN, choosePreset, forcedSplit, headFrameOf, headLocalDir, headLocalPoint, kickSplit, makePointMotion,
  makeSplitState, openSplit, pointAccel, punchSplit, skullFollow, skullFollowOk, skullPieceAngle, skullPieceAt, skullPieces, skullSplitOf, skullWarpPoint,
  splitFaceSegs, splitField, splitMassPoint, splitMaxAngle, splitWarpOf, stepSplit, unwarpDir, unwarpPoint, warpDir, warpPoint, widenSplit,
  wobbleDrive, wobbleLimits,
  type HeadFrame, type SplitState, type SplitWarp, type WobbleDrive, type WobbleParams,
} from './head-split';
import type { Vec3 } from './types';
import { AXE_HEAD, chopKick, chopOpenFrac } from './webgpu/axe-head';
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
  const angle = angleFrac * (st.sides === 0 ? p.maxBoth : p.maxOne);
  return splitWarpOf({ ...st, angle, target: angle, stage: angle }, frame)!;   // at rest on its target
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
  it('THE STAGE is the furthest the spring has opened, no further than its target, and it only ever advances', () => {
    let st = kickSplit({ ...makeSplitState(), preset: 'middle', sides: 0, offset: 0 }, 0.3);
    expect(st.stage).toBe(0);
    let prev = 0, dipped = false, rose = false;
    for (let i = 0; i < 240; i++) {
      st = stepSplit(st, 1 / 60);
      expect(st.stage).toBeGreaterThanOrEqual(prev);
      expect(st.stage).toBeLessThanOrEqual(st.target);
      // On the way up it is the angle itself; from the first pass over the target on, the target.
      if (!rose && st.angle < st.target) expect(st.stage).toBe(st.angle);
      rose ||= st.angle >= st.target;
      if (rose) { expect(st.stage).toBe(0.3); dipped ||= st.angle < 0.3 - 1e-3; }
      prev = st.stage;
    }
    expect(dipped).toBe(true);   // the swing back went under the target, and the stage did not follow it
    // A later chop takes it on from where it stands; a kick with nowhere further to go leaves it.
    st = kickSplit(st, 0.5);
    expect(st.stage).toBe(0.3);
    st = stepSplit(st, 1 / 60);
    expect(st.stage).toBe(st.angle);
    for (let i = 0; i < 240; i++) st = stepSplit(st, 1 / 60);
    expect(st.stage).toBe(0.5);
    for (let i = 0, k = punchSplit(st, 0.4); i < 240; i++) { k = stepSplit(k, 1 / 60); expect(k.stage).toBe(0.5); }
  });
  it('punchSplit: a hit on a split already at its angle throws it frac x its max past, and the spring brings it back', () => {
    for (const [sides, frac] of [[0, 0.3], [1, 0.3], [0, 0.1]] as const) {
      const full = splitMaxAngle({ preset: 'middle', sides });
      let st = forcedSplit('middle', sides, 0, 1)!;
      const hit = punchSplit(st, frac);
      expect(hit).toMatchObject({ angle: full, target: full, stage: full });
      expect(hit.vel).toBeGreaterThan(0);
      st = hit;
      let peak = 0, peakAt = 0, trough = Infinity;
      for (let i = 1; i <= 240; i++) { st = stepSplit(st, 1 / 60); if (st.angle > peak) { peak = st.angle; peakAt = i; } trough = Math.min(trough, st.angle); }
      // The peak the frames see (the spring's own is between two of them): within a tenth of what was asked.
      expect((peak - full) / (frac * full)).toBeGreaterThan(0.9);
      expect((peak - full) / (frac * full)).toBeLessThan(1.05);
      expect(peakAt).toBeLessThanOrEqual(3);
      expect(trough).toBeLessThan(full);
      expect(st).toMatchObject({ angle: full, vel: 0, target: full, stage: full });
    }
    // Twice the share, twice the rate; none, and a closed state: untouched.
    const st = forcedSplit('middle', 0, 0, 1)!;
    expect(punchSplit(st, 0.6).vel).toBeCloseTo(2 * punchSplit(st, 0.3).vel, 12);
    expect(punchSplit(st, 0)).toBe(st);
    expect(punchSplit(makeSplitState(), 0.3)).toEqual(makeSplitState());
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

describe('open, widen, force: the state a chop or the seam leaves', () => {
  it('splitMaxAngle: both halves vs one side, per preset; 0 when closed', () => {
    expect(splitMaxAngle(makeSplitState())).toBe(0);
    expect(splitMaxAngle({ ...makeSplitState(), preset: 'middle', sides: 0 })).toBe(HEAD_SPLIT.presets.middle.maxBoth);
    expect(splitMaxAngle({ ...makeSplitState(), preset: 'middle', sides: -1 })).toBe(HEAD_SPLIT.presets.middle.maxOne);
    expect(splitMaxAngle({ ...makeSplitState(), preset: 'face', sides: 1 })).toBe(HEAD_SPLIT.presets.face.maxOne);
  });
  it('openSplit: the chop\'s preset, kicked toward frac x its max from angle 0', () => {
    const st = openSplit([1, 0, 0], [0.005, 0, 0.1], 0.09, 0.55);
    expect(st).toMatchObject({ preset: 'middle', sides: 0, offset: 0, angle: 0 });
    expect(st.target).toBeCloseTo(0.55 * HEAD_SPLIT.presets.middle.maxBoth, 12);
    expect(st.vel).toBeGreaterThan(0);
    const one = openSplit([1, 0, 0], [0.05, 0, 0.1], 0.09, 0.55);
    expect(one.sides).toBe(1);
    expect(one.target).toBeCloseTo(0.55 * HEAD_SPLIT.presets.middle.maxOne, 12);
    expect(openSplit([0, 0, 1], [0, 0, 0.02], 0.09, 0.55).preset).toBe('face');
  });
  it('widenSplit keeps the preset, the side and the offset, raises the target and never lowers it; a closed state stays closed', () => {
    let st = openSplit([1, 0, 0], [0.05, 0, 0.1], 0.09, 0.55);
    for (let i = 0; i < 240; i++) st = stepSplit(st, 1 / 60);
    const w = widenSplit(st, 0.8);
    expect(w).toMatchObject({ preset: st.preset, sides: st.sides, offset: st.offset, angle: st.angle });
    expect(w.target).toBeCloseTo(0.8 * HEAD_SPLIT.presets.middle.maxOne, 12);
    expect(w.vel).toBeGreaterThan(0);
    expect(widenSplit(widenSplit(st, 1), 0.8).target).toBeCloseTo(HEAD_SPLIT.presets.middle.maxOne, 12);
    expect(widenSplit(makeSplitState(), 0.8)).toEqual(makeSplitState());
  });
  it('forcedSplit sits at angleFrac x the max at once (no spring); angleFrac 0 is the closed state', () => {
    const st = forcedSplit('face', 1, 0.02, 0.5)!;
    const half = 0.5 * HEAD_SPLIT.presets.face.maxOne;
    expect(st).toEqual({ preset: 'face', sides: 1, offset: 0.02, angle: half, vel: 0, target: half, stage: half, wobP: 0, wobVP: 0, wobM: 0, wobVM: 0 });
    expect(stepSplit(st, 1 / 60)).toEqual(st);
    expect(forcedSplit('middle', 0, 0, 0)).toEqual(makeSplitState());
  });
  it('forcedSplit refuses what is not a split (null): an unknown preset, a side that is not -1 / 0 / 1, a non-finite number', () => {
    expect(forcedSplit('sideways' as never, 0, 0, 1)).toBeNull();
    expect(forcedSplit('toString' as never, 0, 0, 1)).toBeNull();
    expect(forcedSplit('middle', 2 as never, 0, 1)).toBeNull();
    expect(forcedSplit('middle', 0, NaN, 1)).toBeNull();
    expect(forcedSplit('middle', 0, 0, NaN)).toBeNull();
    expect(forcedSplit('sideways' as never, 0, 0, 0)).toBeNull();
  });
});

describe('the wobble: an opened half swings with the body and comes back to rest (HEAD_SPLIT.wobble)', () => {
  const W = HEAD_SPLIT.wobble, dt = 1 / 60, deg = 180 / Math.PI;
  const split = (sides: -1 | 0 | 1 = 0, frac = 1, preset: 'middle' | 'face' = 'middle') => forcedSplit(preset, sides, 0, frac)!;
  /** The halves' total openings (rad, both >= 0), as the warp carries them. */
  const totals = (st: SplitState) => { const w = splitWarpOf(st, FRAME)!; return { p: w.thetaP, m: -w.thetaM }; };
  /** Every limit, on a state: the offsets inside wobbleLimits, never shut, never past the over-open margin. */
  const expectInside = (st: SplitState, tag = '') => {
    const [lo, hi] = wobbleLimits(st), full = splitMaxAngle(st), eps = 1e-12;
    for (const [side, x] of [[1, st.wobP], [-1, st.wobM]] as const) {
      if (st.sides !== 0 && st.sides !== side) { expect(x, tag).toBe(0); continue; }
      expect(Number.isFinite(x), tag).toBe(true);
      expect(x, tag).toBeGreaterThanOrEqual(lo - eps);
      expect(x, tag).toBeLessThanOrEqual(hi + eps);
      expect(Math.abs(x), tag).toBeLessThanOrEqual(W.max * st.angle + eps);
      expect(st.angle + x, tag).toBeGreaterThanOrEqual(Math.min(st.angle, W.minOpen) - eps);
      expect(st.angle + x, tag).toBeLessThanOrEqual(Math.max(st.angle, full * (1 + W.over)) + eps);
    }
  };
  /** The frames it takes an offset at its limit to be exactly at rest with no drive: the envelope's decay to restA. */
  const settleFrames = (angle: number) => Math.ceil(1.25 * Math.log(W.max * angle / HEAD_SPLIT.restA) / (W.zeta * 2 * Math.PI * W.hz) / dt);
  /** The shipped parameters with both gains at 0: the wobble off. Passed in; the constant is never written to. */
  const OFF: WobbleParams = { ...W, gainSide: 0, gainBob: 0 };

  it('the constants: softer and slower than the chop\'s spring, visible gains, limits that leave the split open', () => {
    expect(W.hz).toBeLessThan(HEAD_SPLIT.hz);
    expect(W.zeta).toBeGreaterThan(0.1);
    expect(W.zeta).toBeLessThan(1);
    expect(W.gainSide).toBeGreaterThan(0);
    expect(W.gainBob).toBeGreaterThan(0);
    expect(W.max).toBeGreaterThan(0);
    expect(W.max).toBeLessThan(1);
    expect(W.minOpen).toBeGreaterThan(0);
    expect(W.over).toBeGreaterThanOrEqual(0);
    expect(W.accelClamp).toBeGreaterThan(9.8);
  });
  it('a state made closed, opened, forced or widened has no offset; the warp\'s angles are the spring\'s', () => {
    const none = { wobP: 0, wobVP: 0, wobM: 0, wobVM: 0 };
    expect(makeSplitState()).toMatchObject(none);
    expect(openSplit([1, 0, 0], [0, 0, 0.1], 0.09, 0.8)).toMatchObject(none);
    expect(widenSplit(split(), 1)).toMatchObject(none);
    const st = split(0, 0.8), w = splitWarpOf(st, FRAME)!;
    expect(w.thetaP).toBe(st.angle);
    expect(w.thetaM).toBe(-st.angle);
  });
  it('the warp carries each half\'s own angle: the spring\'s and that half\'s offset; a side that does not turn has neither', () => {
    const st = { ...split(0, 0.8), wobP: 0.05, wobM: -0.11 }, w = splitWarpOf(st, FRAME)!;
    expect(w.thetaP).toBe(st.angle + 0.05);
    expect(w.thetaM).toBe(-(st.angle - 0.11));
    expect(w.stage).toBe(st.stage);
    const one = splitWarpOf({ ...split(1, 0.8), wobP: 0.05, wobM: 0.2 }, FRAME)!;
    expect(one.thetaP).toBeCloseTo(0.8 * HEAD_SPLIT.presets.middle.maxOne + 0.05, 12);
    expect(one.thetaM).toBe(0);
    expect(splitWarpOf({ ...split(-1, 0.8), wobP: 0.2, wobM: 0.05 }, FRAME)!.thetaP).toBe(0);
  });
  it('pointAccel: no acceleration from the first two samples, then the second difference over dt^2', () => {
    let m = makePointMotion();
    const at = (t: number): Vec3 => [0.5 * 3 * t * t, 1.5 + 2 * t, -t];   // 3 m/s^2 along x
    const accs: Vec3[] = [];
    for (let i = 0; i < 5; i++) { const r = pointAccel(m, at(i * 0.25), 0.25); m = r.motion; accs.push(r.acc); }
    expect(accs[0]).toEqual([0, 0, 0]);
    expect(accs[1]).toEqual([0, 0, 0]);     // one velocity: not an acceleration from rest
    for (const a of accs.slice(2)) { expect(a[0]).toBeCloseTo(3, 9); expect(a[1]).toBeCloseTo(0, 9); expect(a[2]).toBeCloseTo(0, 9); }
    expect(m.p).toEqual(at(1));
  });
  it('pointAccel: a point that does not move accelerates by exactly nothing; no time is no sample; no point forgets', () => {
    let m = makePointMotion();
    const p: Vec3 = [0.123456789, 1.61803, -2.71828];
    for (let i = 0; i < 6; i++) {
      const r = pointAccel(m, [...p], 1 / 60);
      m = r.motion;
      for (const c of r.acc) expect(Object.is(c, 0)).toBe(true);
    }
    // A step of no time (the gates' camera syncs) neither moves the record nor reads as a stop.
    const moving = pointAccel(pointAccel(makePointMotion(), [0, 0, 0], 0.1).motion, [1, 0, 0], 0.1).motion;
    for (const dt0 of [0, -1, NaN]) {
      const r = pointAccel(moving, [5, 5, 5], dt0);
      expect(r.motion).toBe(moving);
      expect(r.acc).toEqual([0, 0, 0]);
    }
    // No split on the pose (null), or a point that is not one: start again, and the next two samples give nothing.
    for (const bad of [null, [NaN, 0, 0], [0, Infinity, 0]] as (Vec3 | null)[]) {
      const r = pointAccel(moving, bad, 0.1);
      expect(r.motion).toEqual(makePointMotion());
      expect(r.acc).toEqual([0, 0, 0]);
      const a1 = pointAccel(r.motion, [9, 9, 9], 0.1), a2 = pointAccel(a1.motion, [9, 9, 10], 0.1);
      expect(a1.acc).toEqual([0, 0, 0]);
      expect(a2.acc).toEqual([0, 0, 0]);
    }
  });
  it('pointAccel: each difference over its own step\'s time (a frame that ran long does not read as a jolt)', () => {
    // 3 m/s^2 along x again, sampled at uneven times: the velocities are the intervals' own, and the acceleration is
    // their difference over the time between the intervals' middles.
    const at = (t: number): Vec3 => [0.5 * 3 * t * t, 0, 2 * t];
    const times = [0, 0.25, 0.375, 0.875, 1, 1.5];
    let m = makePointMotion();
    const accs: Vec3[] = [];
    for (let i = 0; i < times.length; i++) { const r = pointAccel(m, at(times[i]!), i === 0 ? 0.25 : times[i]! - times[i - 1]!); m = r.motion; accs.push(r.acc); }
    for (const a of accs.slice(2)) { expect(a[0]).toBeCloseTo(3, 9); expect(a[1]).toBe(0); expect(a[2]).toBeCloseTo(0, 9); }
    // With the current step's time under both differences the third sample (0.125 s after a 0.25 s step) read 4.5.
  });
  it('pointAccel: A JUMP IS NOT A MOTION: a sample faster than jumpSpeed from the last is dropped and the history starts again from it', () => {
    const still = (p: Vec3) => { let m = makePointMotion(); for (let i = 0; i < 3; i++) m = pointAccel(m, p, dt).motion; return m; };
    const at: Vec3 = [1, 1.6, -2], far: Vec3 = [1 + 2 * W.jumpSpeed * dt, 1.6, -2];
    // A teleport: no acceleration on the jump, none on the two samples after it (a position, then one velocity).
    let m = still(at);
    const jump = pointAccel(m, far, dt);
    expect(jump.acc).toEqual([0, 0, 0]);
    expect(jump.motion).toMatchObject({ p: far, v: null });
    const a1 = pointAccel(jump.motion, far, dt), a2 = pointAccel(a1.motion, far, dt);
    expect(a1.acc).toEqual([0, 0, 0]);
    expect(a2.acc).toEqual([0, 0, 0]);
    // So a split head carried through a teleport does not move at all.
    let st = split(), mo = still(at);
    const w = splitWarpOf(st, FRAME)!;
    for (const p of [far, far, far, at, at, at]) { const r = pointAccel(mo, p, dt); mo = r.motion; st = stepSplit(st, dt, wobbleDrive(w, r.acc)); expect(st).toMatchObject({ wobP: 0, wobM: 0 }); }
    // Just under the limit it is a motion: the fastest thing a body does (the corpse's head whips down at 11 m/s) is far under.
    const near: Vec3 = [1 + 0.99 * W.jumpSpeed * dt, 1.6, -2];
    expect(pointAccel(still(at), near, dt).acc[0]).toBeCloseTo(0.99 * W.jumpSpeed / dt, 6);
    expect(W.jumpSpeed).toBeGreaterThan(2 * 11);
    expect(pointAccel(still(at), far, dt, { ...W, jumpSpeed: 1000 }).acc[0]).toBeGreaterThan(0);
  });
  it('the mass point is `arm` up from the hinge into the head; the drive is its acceleration across the split and up, clamped', () => {
    for (const frame of [FRAME, { ...FRAME, quat: qFromAxisAngle([0.3, 0.8, 0.52], 0.9) }]) {
      const w = splitWarpOf(split(0, 0.8), frame)!, u = cross(w.n, w.a);
      expect(len(sub(splitMassPoint(w), add(w.h, [u[0] * W.arm, u[1] * W.arm, u[2] * W.arm])))).toBeLessThan(1e-12);
      const acc: Vec3 = add(add([w.n[0] * 3, w.n[1] * 3, w.n[2] * 3], [u[0] * -2, u[1] * -2, u[2] * -2]), [w.a[0] * 7, w.a[1] * 7, w.a[2] * 7]);
      const d = wobbleDrive(w, acc);
      expect(d.side).toBeCloseTo(3, 9);
      expect(d.bob).toBeCloseTo(-2, 9);      // along the hinge axis: no drive at all
      // A teleport, a torn frame: held to accelClamp either way; what is not a number is no drive.
      const huge = wobbleDrive(w, [w.n[0] * 1e9 - u[0] * 1e9, w.n[1] * 1e9 - u[1] * 1e9, w.n[2] * 1e9 - u[2] * 1e9]);
      expect(huge).toEqual({ side: W.accelClamp, bob: -W.accelClamp });
      expect(wobbleDrive(w, [NaN, 0, 0])).toEqual({ side: 0, bob: 0 });
      expect(wobbleDrive(w, [Infinity, Infinity, Infinity])).toEqual({ side: 0, bob: 0 });
    }
  });
  it('NO DRIVE, NO OFFSET: a split whose body does not move is stepped to the bit as one with no wobble at all', () => {
    for (const drive of [undefined, null, { side: 0, bob: 0 }, { side: -0, bob: 0 }] as (WobbleDrive | null | undefined)[]) {
      let st = openSplit([1, 0, 0], [0, 0, 0.1], 0.09, 0.8);
      for (let i = 0; i < 200; i++) {
        st = drive === undefined ? stepSplit(st, dt) : stepSplit(st, dt, drive);
        expect(Object.is(st.wobP, 0) && Object.is(st.wobM, 0) && Object.is(st.wobVP, 0) && Object.is(st.wobVM, 0)).toBe(true);
        if (st.angle > 0) { const w = splitWarpOf(st, FRAME)!; expect(w.thetaP).toBe(st.angle); expect(w.thetaM).toBe(-st.angle); }
      }
      expect(st.angle).toBe(st.target);
    }
  });
  it('OFF (both gains 0): whatever the body does, the halves stand at the spring\'s angle, to the bit', () => {
    let st = split(), ref = split();
    for (let i = 0; i < 300; i++) {
      if (i === 100) { st = punchSplit(st, 0.3); ref = punchSplit(ref, 0.3); }
      st = stepSplit(st, dt, { side: 30 * Math.sin(i), bob: 40 * Math.cos(i * 0.7) }, OFF);
      ref = stepSplit(ref, dt);
      expect(st).toEqual(ref);
      expect(totals(st)).toEqual({ p: st.angle, m: st.angle });
    }
  });
  it('THE PARAMETERS ARE PASSED IN: another set steps another wobble, and the shipped constant is the default', () => {
    const drive = { side: 3, bob: 2 };
    const run = (P?: WobbleParams) => { let st = split(); for (let i = 0; i < 20; i++) st = P ? stepSplit(st, dt, drive, P) : stepSplit(st, dt, drive); return st; };
    expect(run({ ...W })).toEqual(run());
    expect(Math.abs(run({ ...W, gainSide: 2 * W.gainSide, gainBob: 2 * W.gainBob }).wobP)).toBeGreaterThan(1.5 * Math.abs(run().wobP));
    // A tighter stop holds where the shipped one would not, and the limits are the parameters'.
    const tight: WobbleParams = { ...W, max: 0.02 };
    let st = split();
    for (let i = 0; i < 60; i++) { st = stepSplit(st, dt, { side: 30, bob: 0 }, tight); expect(Math.abs(st.wobP)).toBeLessThanOrEqual(0.02 * st.angle + 1e-12); }
    expect(st.wobP).toBe(-0.02 * st.angle);
    expect(wobbleLimits(st, tight)[0]).toBe(-0.02 * st.angle);
    expect(splitMassPoint(splitWarpOf(st, FRAME)!, { ...W, arm: 0.3 })[1] - splitWarpOf(st, FRAME)!.h[1]).toBeCloseTo(0.3, 12);
    expect(wobbleDrive(splitWarpOf(st, FRAME)!, [1e9, 0, 0], { ...W, accelClamp: 7 }).side).toBe(7);
  });
  it('THE STEP DOES NOT TRUST ITS DRIVE: one that is not a number is no drive, one past accelClamp is held to it, and a state that is not a number goes back to rest', () => {
    const bads: WobbleDrive[] = [{ side: NaN, bob: 0 }, { side: 0, bob: NaN }, { side: Infinity, bob: -Infinity }, { side: NaN, bob: NaN }];
    for (const bad of bads) {
      // Mid-swing: the bad tick is stepped as one with that component at 0, and nothing after it is poisoned.
      let st = split(), ref = split();
      for (let i = 0; i < 10; i++) { st = stepSplit(st, dt, { side: 4, bob: 2 }); ref = stepSplit(ref, dt, { side: 4, bob: 2 }); }
      st = stepSplit(st, dt, bad);
      ref = stepSplit(ref, dt, { side: Number.isFinite(bad.side) ? bad.side : 0, bob: Number.isFinite(bad.bob) ? bad.bob : 0 });
      expect(st).toEqual(ref);
      for (let i = 0; i < 200; i++) { st = stepSplit(st, dt, i < 5 ? bad : null); expectInside(st); }
      expect(st).toMatchObject({ wobP: 0, wobVP: 0, wobM: 0, wobVM: 0 });
    }
    // A drive past the clamp is the clamp's (the leaf's wobbleDrive holds it already; a caller that does not is held here).
    const push = (d: WobbleDrive) => stepSplit(split(), dt, d);
    expect(push({ side: 1e30, bob: -1e30 })).toEqual(push({ side: W.accelClamp, bob: -W.accelClamp }));
    expect(push({ side: 1e308, bob: 1e308 })).toEqual(push({ side: W.accelClamp, bob: W.accelClamp }));
    // A state that has been poisoned (not by this step) is not carried: both halves start again from rest.
    for (const poison of [{ wobP: NaN }, { wobVM: Infinity }, { wobM: NaN, wobVP: NaN }]) {
      const st = stepSplit({ ...split(), wobP: 0.1, wobVP: 1, wobM: -0.1, wobVM: -1, ...poison }, dt);
      expect(st).toMatchObject({ wobP: 0, wobVP: 0, wobM: 0, wobVM: 0 });
      expect(totals(st)).toEqual({ p: st.angle, m: st.angle });
      const driven = stepSplit({ ...split(), ...poison }, dt, { side: 4, bob: 2 });
      expect(driven).toEqual(stepSplit(split(), dt, { side: 4, bob: 2 }));
    }
  });
  it('thrown ACROSS the split the halves lag: one closes and the other opens; thrown UP out of the hinge both open', () => {
    const push = (drive: WobbleDrive) => { let st = split(); for (let i = 0; i < 6; i++) st = stepSplit(st, dt, drive); return st; };
    // The head accelerates toward +n: the + half (which opens toward +n) is left behind, closing; the - half opens.
    const side = push({ side: 5, bob: 0 });
    expect(side.wobP).toBeLessThan(-0.005);
    expect(side.wobM).toBeCloseTo(-side.wobP, 12);
    expect(push({ side: -5, bob: 0 }).wobP).toBeCloseTo(-side.wobP, 12);
    // The head accelerates up: both halves sink, which opens them; down, both close.
    const up = push({ side: 0, bob: 5 });
    expect(up.wobP).toBeGreaterThan(0.005);
    expect(up.wobM).toBe(up.wobP);
    expect(push({ side: 0, bob: -5 }).wobP).toBeCloseTo(-up.wobP, 12);
    // The spring's own angle is not touched by any of it.
    for (const st of [side, up]) expect(st).toMatchObject({ angle: split().angle, vel: 0, stage: split().stage });
    // One side: only the half that turns swings.
    const one = (() => { let st = split(1); for (let i = 0; i < 6; i++) st = stepSplit(st, dt, { side: 5, bob: 3 }); return st; })();
    expect(one.wobP).not.toBe(0);
    expect(one).toMatchObject({ wobM: 0, wobVM: 0 });
    const other = (() => { let st = split(-1); for (let i = 0; i < 6; i++) st = stepSplit(st, dt, { side: 5, bob: 3 }); return st; })();
    expect(other.wobM).not.toBe(0);
    expect(other).toMatchObject({ wobP: 0, wobVP: 0 });
  });
  it('a half less far open is driven in proportion to its angle', () => {
    const after = (frac: number) => { let st = split(0, frac); for (let i = 0; i < 4; i++) st = stepSplit(st, dt, { side: 0, bob: 2 }); return st.wobP; };
    expect(after(0.5) / after(1)).toBeCloseTo(0.5, 9);
    expect(after(0.8) / after(1)).toBeCloseTo(0.8, 9);
  });
  it('A WALK: a steady bob and sway of a few m/s^2 swings the halves a few degrees; when the body stops they are at rest within about half a second, and exactly so soon after', () => {
    // The walking zombie, measured (NOTES, the traces): the mass point bobs +-2 m/s^2 at 2.1 Hz and is thrown about
    // 2 m/s^2 across the split as the body turns.
    let st = split();
    const peak = { p: 0, m: 0, apart: 0 };
    for (let i = 0; i < 300; i++) {
      const t = i * dt;
      st = stepSplit(st, dt, { side: -1.9, bob: 2 * Math.sin(2 * Math.PI * 2.1 * t) });
      expectInside(st);
      if (i >= 120) {
        peak.p = Math.max(peak.p, Math.abs(st.wobP)); peak.m = Math.max(peak.m, Math.abs(st.wobM));
        peak.apart = Math.max(peak.apart, Math.abs(st.wobP - st.wobM));
      }
    }
    for (const x of [peak.p, peak.m]) { expect(x * deg).toBeGreaterThan(2); expect(x * deg).toBeLessThan(10); }
    expect(peak.apart * deg).toBeGreaterThan(2);       // the two halves are not at the same angle
    // The body stops.
    let within = -1, exact = -1;
    for (let i = 1; i <= 240 && exact < 0; i++) {
      st = stepSplit(st, dt, { side: 0, bob: 0 });
      if (Math.max(Math.abs(st.wobP), Math.abs(st.wobM)) * deg > 1) within = -1; else if (within < 0) within = i;
      if (st.wobP === 0 && st.wobM === 0 && st.wobVP === 0 && st.wobVM === 0) exact = i;
    }
    expect(within).toBeGreaterThan(0);
    expect(within * dt).toBeLessThan(0.6);
    expect(exact).toBeGreaterThan(0);
    expect(exact).toBeLessThanOrEqual(settleFrames(st.angle));
    expect(totals(st)).toEqual({ p: st.angle, m: st.angle });
    console.log(`wobble, a steady walk (bob +-2 m/s^2 at 2.1 Hz, 1.9 m/s^2 across): +half +-${(peak.p * deg).toFixed(1)} deg, -half +-${(peak.m * deg).toFixed(1)}; `
      + `stopped: within 1 degree after ${within} frames, exactly at rest after ${exact} (bound ${settleFrames(st.angle)})`);
  });
  it('THE LIMITS hold on every tick, whatever is thrown at it: any preset, any stage, huge and broken drives, chops and kicks on the way', () => {
    const rnd = (() => { let s = 12345; return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296; })();
    let hitLo = 0, hitHi = 0;
    for (const [preset, sides] of [['middle', 0], ['middle', 1], ['middle', -1], ['face', 1]] as const) {
      for (const frac of [0.04, 0.3, 0.55, 0.8, 1]) {
        let st = forcedSplit(preset, sides, 0, frac)!;
        for (let i = 0; i < 1500; i++) {
          const kind = rnd();
          const drive: WobbleDrive = kind < 0.05 ? { side: NaN, bob: Infinity }
            : kind < 0.25 ? { side: (rnd() - 0.5) * 1e7, bob: (rnd() - 0.5) * 1e7 }
            : { side: (rnd() - 0.5) * 2 * W.accelClamp, bob: (rnd() - 0.5) * 2 * W.accelClamp };
          // The drive the leaf hands over is always wobbleDrive's: clamped, finite.
          const w = splitWarpOf(st, FRAME)!, u = cross(w.n, w.a);
          const held = wobbleDrive(w, [w.n[0] * drive.side + u[0] * drive.bob, w.n[1] * drive.side + u[1] * drive.bob, w.n[2] * drive.side + u[2] * drive.bob]);
          if (i % 400 === 150) st = widenSplit(st, Math.min(1, frac + 0.2));
          if (i % 400 === 350) st = punchSplit(st, 0.3);
          st = stepSplit(st, i % 7 === 0 ? 1 / 30 : dt, held);
          expectInside(st, `${preset} ${sides} ${frac} tick ${i}`);
          const [lo, hi] = wobbleLimits(st);
          for (const x of [st.wobP, st.wobM]) { if (lo < 0 && x === lo) hitLo++; if (hi > 0 && x === hi) hitHi++; }
          const t = splitWarpOf(st, FRAME)!;
          if (sides >= 0) expect(t.thetaP).toBeGreaterThan(0);
          if (sides <= 0) expect(t.thetaM).toBeLessThan(0);
        }
        // Left alone it comes to rest, exactly, the spring on its target and each half on the spring.
        for (let i = 0; i < settleFrames(st.target) + 60; i++) st = stepSplit(st, dt);
        expect(st).toMatchObject({ angle: st.target, vel: 0, wobP: 0, wobVP: 0, wobM: 0, wobVM: 0 });
      }
    }
    // The abuse did reach both stops (so the limits were what held it).
    expect(hitLo).toBeGreaterThan(50);
    expect(hitHi).toBeGreaterThan(50);
  });
  it('the limits themselves: within max x the angle, never shut past minOpen, never over the preset\'s full angle by more than `over`', () => {
    const full = HEAD_SPLIT.presets.middle.maxBoth;
    const lim = (angle: number) => wobbleLimits({ preset: 'middle', sides: 0, angle });
    for (const k of [1, 0.8]) {
      expect(lim(k * full)[0]).toBe(-W.max * k * full);
      expect(lim(k * full)[1]).toBeCloseTo(Math.min(W.max * k, 1 + W.over - k) * full, 12);
    }
    // A split that has barely begun to open is not closed again, and one past its full angle (a kick) is not thrown on.
    expect(lim(0.5 * W.minOpen)[0]).toBe(-0);
    expect(lim(W.minOpen + 0.004)[0]).toBeCloseTo(-0.004, 12);
    expect(lim(full * (1 + W.over) - 0.01)[1]).toBeCloseTo(0.01, 12);
    expect(lim(full * (1 + W.over) + 0.2)[1]).toBe(0);
    for (const a of [0, 0.01, 0.2, full, 2 * full]) { const [lo, hi] = lim(a); expect(lo).toBeLessThanOrEqual(0); expect(hi).toBeGreaterThanOrEqual(0); }
  });
  it('A CHOP DURING A WALK: the spring is the same to the bit with the body moving or still, and the kick and the wobble stay inside the limits together', () => {
    const walk = (i: number): WobbleDrive => ({ side: 6 * Math.sin(i * 0.31), bob: 3 * Math.sin(i * 0.22) });
    let st = openSplit([1, 0, 0], [0, 0, 0.1], 0.09, chopOpenFrac(1)), still = st;
    let peakTotal = 0;
    for (let i = 0; i < 360; i++) {
      if (i === 90) { st = widenSplit(st, chopOpenFrac(2)); still = widenSplit(still, chopOpenFrac(2)); }
      if (i === 180) { st = punchSplit(widenSplit(st, chopOpenFrac(3)), chopKick(3)); still = punchSplit(widenSplit(still, chopOpenFrac(3)), chopKick(3)); }
      st = stepSplit(st, dt, walk(i));
      still = stepSplit(still, dt);
      // The wobble never feeds the spring.
      expect([st.angle, st.vel, st.target, st.stage]).toEqual([still.angle, still.vel, still.target, still.stage]);
      expectInside(st, `tick ${i}`);
      peakTotal = Math.max(peakTotal, totals(st).p, totals(st).m);
    }
    const full = HEAD_SPLIT.presets.middle.maxBoth;
    expect(peakTotal).toBeGreaterThan(full * 1.2);                       // the kick showed
    expect(peakTotal).toBeLessThanOrEqual(full * (1 + W.over) + 1e-12);   // and the two together stopped at the margin
    for (let i = 0; i < settleFrames(full) + 30; i++) st = stepSplit(st, dt);
    expect(st).toMatchObject({ angle: full, vel: 0, wobP: 0, wobM: 0 });
  });
  it('THE SKULL rides each half\'s own wobble in proportion, and its stage does not move', () => {
    let st = split(0, 0.8);
    const share = skullFollow(0.8);
    let apart = 0;
    for (let i = 0; i < 240; i++) {
      st = stepSplit(st, dt, { side: 8 * Math.sin(i * 0.3), bob: 4 * Math.cos(i * 0.21) });
      const w = splitWarpOf(st, FRAME)!, s = skullSplitOf(w)!;
      expect(s.frac).toBeCloseTo(0.8, 12);
      expect(s.follow).toBeCloseTo(share, 12);
      expect(s.angleP).toBeCloseTo(share * w.thetaP, 12);
      expect(s.angleM).toBeCloseTo(share * w.thetaM, 12);
      expect(s.angleP).toBeLessThanOrEqual(w.thetaP);
      apart = Math.max(apart, Math.abs(s.angleP + s.angleM));
    }
    expect(apart * deg).toBeGreaterThan(0.5);          // the two halves of the bone stood at different angles
  });
  it('is deterministic: the same drives give the same angles', () => {
    const run = () => { let st = split(); const out: number[] = []; for (let i = 0; i < 200; i++) { st = stepSplit(st, dt, { side: 9 * Math.sin(i * 0.4), bob: 5 * Math.cos(i * 0.13) }); out.push(st.wobP, st.wobM); } return out; };
    expect(run()).toEqual(run());
  });
});

describe('the head frame', () => {
  it('headFrameOf: the radius is the skull\'s LARGEST semi-axis (the hold ball must cover the whole cranium)', () => {
    const q = qFromAxisAngle([0, 1, 0], 0.7);
    expect(headFrameOf({ centre: [1, 2, 3], axes: [0.09, 0.137, 0.105] }, q)).toEqual({ centre: [1, 2, 3], quat: q, radius: 0.137 });
  });
  it('headLocalPoint / headLocalDir undo the frame (x right, y up, z face-forward)', () => {
    const q = qFromAxisAngle([0.3, 1, -0.2], 1.1);
    const f: HeadFrame = { centre: [2, 0.4, -1], quat: q, radius: 0.11 };
    const l: Vec3 = [0.03, -0.02, 0.09];
    const back = headLocalPoint(f, add(f.centre, qRotate(q, l)));
    expect(len(sub(back, l))).toBeLessThan(1e-12);
    expect(len(sub(headLocalDir(f, qRotate(q, [0, 0, 1])), [0, 0, 1]))).toBeLessThan(1e-12);
  });
});

describe('the forward warp: where a closed-head point is on the open head', () => {
  it('each piece\'s skin goes out with its half and unwarpPoint brings it back (the round trip)', () => {
    for (const [name, w] of CASES) {
      const u = cross(w.n, w.a);
      // Closed-head skin points: both sides of the plane high on the skull, and the neck below the hinge.
      const skin: Vec3[] = [];
      for (const d of [[0.9, 0.4, 0.1], [-0.9, 0.4, 0.1], [0.5, 0.8, 0.3], [-0.4, 0.7, -0.5], [0.3, 0.6, 0.7], [-0.2, 0.5, 0.8]] as Vec3[]) {
        const l = len(d);
        skin.push(add(FRAME.centre, [d[0] / l * 0.11, d[1] / l * 0.11, d[2] / l * 0.11]));
      }
      skin.push([0.05, 1.5, 0], [0, 1.52, -0.05]);
      const seen = new Set<number>();
      for (const q of skin) {
        expect(Math.abs(head(q))).toBeLessThan(1e-9);
        const m = warpPoint(w, q);
        const above = dot(u, sub(q, w.h)) >= 0;
        const want = !above ? 0 : dot(w.n, q) - w.d0 >= 0 ? 1 : 2;
        expect(m.piece, name).toBe(want);
        seen.add(m.piece);
        const theta = m.piece === 1 ? w.thetaP : m.piece === 2 ? w.thetaM : 0;
        expect(len(sub(m.p, moveOpen(w, q, theta))), name).toBeLessThan(1e-12);
        expect(Math.abs(splitField(w, head, m.p)), name).toBeLessThan(1e-9);   // still on the skin, of the open head
        const back = unwarpPoint(w, m.p, head);
        expect(len(sub(back.q, q)), name).toBeLessThan(1e-9);
        expect(back.piece, name).toBe(m.piece);
        // A direction goes with its piece and comes back.
        const v: Vec3 = [0.3, 0.8, -0.52];
        expect(len(sub(unwarpDir(w, m.piece, warpDir(w, m.piece, v)), v))).toBeLessThan(1e-12);
        if (m.piece === 0) expect(warpDir(w, 0, v)).toBe(v);
      }
      expect([...seen].sort()).toEqual([0, 1, 2]);
    }
  });
  it('a point beyond rho of the hinge, or with no split, stays put (piece 0)', () => {
    const w = open('middle', [0, 0, 0.1]);
    const tip: Vec3 = [0.01, 1.99, -0.06];   // the crest's tip: above the hinge, past rho
    expect(len(sub(tip, w.h))).toBeGreaterThan(w.r - REGION_MARGIN);
    expect(warpPoint(w, tip)).toEqual({ p: tip, piece: 0 });
    expect(warpPoint(null, tip)).toEqual({ p: tip, piece: 0 });
  });
});

describe('the cut faces: one cut segment per half that opens, along the plane over the crown', () => {
  const stOf = (preset: 'middle' | 'face', impact: Vec3) => ({ ...makeSplitState(), ...choosePreset(preset === 'middle' ? [1, 0, 0] : [0, 0, 1], impact, FRAME.radius) });
  it('both halves: two segments, each inset into its own half, along the hinge axis, seen from above the crown', () => {
    const st = stOf('middle', [0, 0, 0.1]);
    const w = splitWarpOf({ ...st, angle: 0.3 }, FRAME)!;
    const segs = splitFaceSegs(st, FRAME);
    expect(segs.map(s => s.side)).toEqual([1, -1]);
    for (const s of segs) {
      const mid: Vec3 = [(s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2, (s.a[2] + s.b[2]) / 2];
      expect((dot(w.n, mid) - w.d0) * s.side).toBeCloseTo(HEAD_SPLIT.faceCut.inset, 12);
      expect(Math.abs(dot(sub(s.b, s.a), w.a))).toBeCloseTo(2 * HEAD_SPLIT.faceCut.lenFrac * FRAME.radius, 12);
      expect(len(sub(s.view, [0, -1, 0]))).toBeLessThan(1e-12);
      expect(mid[1]).toBeCloseTo(FRAME.centre[1] + FRAME.radius, 12);
    }
  });
  it('one side: one segment, on the side that moves, at the plane\'s offset; closed: none', () => {
    const st = stOf('middle', [-0.04, 0, 0.1]);
    expect(st.sides).toBe(-1);
    const segs = splitFaceSegs(st, FRAME);
    expect(segs).toHaveLength(1);
    expect(segs[0]!.side).toBe(-1);
    expect((segs[0]!.a[0] + segs[0]!.b[0]) / 2).toBeCloseTo(st.offset - HEAD_SPLIT.faceCut.inset, 12);
    const face = splitFaceSegs(stOf('face', [0, 0, 0.03]), FRAME);
    expect(face).toHaveLength(1);
    expect(Math.abs(face[0]!.b[0] - face[0]!.a[0])).toBeCloseTo(2 * HEAD_SPLIT.faceCut.lenFrac * FRAME.radius, 12);   // across the head
    expect(splitFaceSegs(makeSplitState(), FRAME)).toEqual([]);
  });
  it('the segments follow a turned, moved head', () => {
    const q = qFromAxisAngle([0.3, 1, -0.2], 1.1);
    const f: HeadFrame = { centre: [2, 0.4, -1], quat: q, radius: FRAME.radius };
    const st = stOf('middle', [0, 0, 0.1]);
    const local = splitFaceSegs(st, FRAME), world = splitFaceSegs(st, f);
    local.forEach((s, i) => {
      for (const k of ['a', 'b'] as const) expect(len(sub(world[i]![k], add(f.centre, qRotate(q, sub(s[k], FRAME.centre)))))).toBeLessThan(1e-12);
      expect(len(sub(world[i]!.view, qRotate(q, s.view)))).toBeLessThan(1e-12);
    });
  });
});

describe('the skull split: the bone opens LESS than the flesh, in stages (the mesh skull, mesh-renderer.ts)', () => {
  const S = HEAD_SPLIT.skull;
  const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
  /** A seeded value in [0, 1) per (index, lane). */
  const hash = (i: number, lane: number): number => { const x = Math.sin(i * 127.1 + lane * 311.7) * 43758.5453; return x - Math.floor(x); };
  const both = (angleFrac: number) => open('middle', [0, 0, 0.1], angleFrac);
  it('the warp carries its preset\'s full angle: both halves vs one side', () => {
    expect(both(0.5).full).toBe(HEAD_SPLIT.presets.middle.maxBoth);
    expect(open('middle', [0.06, 0, 0.1], 0.5).full).toBe(HEAD_SPLIT.presets.middle.maxOne);
    expect(open('face', [0, 0, 0.1], 0.5).full).toBe(HEAD_SPLIT.presets.face.maxOne);
  });
  it('skullFollow: the table\'s knots, straight lines between them, flat outside', () => {
    for (const [frac, k] of S.follow) expect(skullFollow(frac)).toBeCloseTo(k, 12);
    const [[f0, k0], [f1, k1]] = S.follow;
    expect(skullFollow(0)).toBe(k0);
    expect(skullFollow((f0 + f1) / 2)).toBeCloseTo((k0 + k1) / 2, 12);
    expect(skullFollow(7)).toBe(S.follow[S.follow.length - 1]![1]);
    // It never falls as the head opens, and never passes the flesh.
    let prev = 0;
    for (let i = 0; i <= 100; i++) { const k = skullFollow(i / 100); expect(k).toBeGreaterThanOrEqual(prev); expect(k).toBeLessThanOrEqual(1); prev = k; }
    expect(skullFollow(0.5, [[0, 0], [1, 1]])).toBeCloseTo(0.5, 12);
  });
  it('skullSplitOf: each half\'s bone angle is its flesh angle x follow(flesh angle / the preset\'s full angle)', () => {
    expect(skullSplitOf(null)).toBeNull();
    for (const frac of [0.3, 0.55, 0.7, 0.8, 0.9, 1]) {
      const w = both(frac), s = skullSplitOf(w)!;
      expect(s.frac).toBeCloseTo(frac, 12);
      expect(s.follow).toBeCloseTo(skullFollow(frac), 12);
      expect(s.angleP).toBeCloseTo(w.thetaP * skullFollow(frac), 12);
      expect(s.angleM).toBeCloseTo(w.thetaM * skullFollow(frac), 12);
      expect(s.frame.w).toBe(w);
    }
    // One side: the still side's bone does not turn either.
    // A piece's copy is turned by its own bone angle: the rest by none, a half that does not turn by none.
    const two = skullSplitOf(both(1))!;
    expect(([0, 1, 2] as const).map(piece => skullPieceAngle(two, piece))).toEqual([0, two.angleP, two.angleM]);
    expect(two.angleP).toBeGreaterThan(0);
    expect(two.angleM).toBe(-two.angleP);
    const one = skullSplitOf(open('middle', [0.06, 0, 0.1], 0.8))!;
    expect(([0, 1, 2] as const).map(piece => skullPieceAngle(one, piece))).toEqual([0, one.angleP, 0]);
    expect(one.angleP).toBeGreaterThan(0);
    expect(one.angleM).toBe(0);
    expect(skullSplitOf(open('middle', [-0.06, 0, 0.1], 0.8))!.angleP).toBe(0);
  });
  it('the three chop stages widen the bone: a crack, a wider crack, split wide', () => {
    const a = [0.55, 0.8, 1].map(f => skullSplitOf(both(f))!.angleP);
    expect(a[0]!).toBeGreaterThan(0);
    expect(a[1]!).toBeGreaterThan(2 * a[0]!);
    expect(a[2]!).toBeGreaterThan(1.5 * a[1]!);
    expect(a[2]!).toBeLessThan(both(1).thetaP);
  });
  it('at the axe\'s own chops the table reads as a WIDE CRACK on chop 1 and a SPLIT from chop 2 on, for every preset; the thin crack stays below them', () => {
    // The stages are the axe's opening fractions (webgpu/axe-head.ts AXE_HEAD.openAngles, then the kill at 1). The owner
    // (2026-10-05): the thin crack is too timid for an axe, so its first chop is the table's second stage, wider than
    // the thin crack (over 3.5 degrees a half) and not yet a split (under 15), and its second is the split (over 20).
    // A retuned angle, spring or table has to keep that, or change this on purpose.
    const CRACK_MAX = 0.06, WIDE_MAX = 0.26, SPLIT_MIN = 0.35, opens = [1, 2, 3].map(c => chopOpenFrac(c));
    expect(opens).toEqual([...AXE_HEAD.openAngles, 1]);
    for (const [preset, impact] of [['middle', [0, 0, 0.1]], ['middle', [0.06, 0, 0.1]], ['face', [0, 0, 0.1]]] as const) {
      const boneAt = (f: number) => { const s = skullSplitOf(open(preset, [...impact], f))!; return Math.max(s.angleP, -s.angleM); };
      const bone = opens.map(boneAt);
      expect(bone[0]!, `${preset} chop 1`).toBeGreaterThan(CRACK_MAX);
      expect(bone[0]!, `${preset} chop 1`).toBeLessThan(WIDE_MAX);
      expect(bone[1]!, `${preset} chop 2`).toBeGreaterThan(SPLIT_MIN);
      for (let i = 1; i < bone.length; i++) expect(bone[i]!, `${preset} chop ${i + 1}`).toBeGreaterThanOrEqual(bone[i - 1]!);
      // The table's first stage is still there for a lighter weapon (and the seam's forceSplit(..., 0.55)).
      expect(boneAt(S.follow[0][0]), `${preset} the thin crack`).toBeLessThan(CRACK_MAX);
    }
  });
  it('the warp carries the spring\'s stage, and the table is read there: whatever the flesh does, the bone takes the stage\'s share of it', () => {
    const st = { ...makeSplitState(), ...choosePreset([1, 0, 0], [0, 0, 0.1], FRAME.radius) };
    const full = HEAD_SPLIT.presets.middle.maxBoth, target = 0.8 * full;
    const at = (angle: number, stage = target) => skullSplitOf(splitWarpOf({ ...st, angle, target, stage }, FRAME))!;
    expect(splitWarpOf({ ...st, angle: 0.1, target, stage: 0.07 }, FRAME)!.stage).toBe(0.07);
    // Past the target, and back under it: the stage's share, whatever the angle.
    for (const k of [0.7, 0.9, 1, 1.1, 1.3]) {
      expect(at(k * target).frac).toBeCloseTo(0.8, 12);
      expect(at(k * target).angleP).toBeCloseTo(k * target * skullFollow(0.8), 12);
      expect(at(k * target).angleM).toBeCloseTo(-k * target * skullFollow(0.8), 12);
    }
    // On the way up the stage is the flesh's own opening: the table there.
    expect(at(0.6 * full, 0.6 * full).follow).toBeCloseTo(skullFollow(0.6), 12);
    // Each half's bone turns by its OWN flesh angle's share: unequal halves, one stage.
    const w = { ...splitWarpOf({ ...st, angle: target, target, stage: target }, FRAME)!, thetaP: 0.5, thetaM: -0.2 };
    const s = skullSplitOf(w)!;
    expect(s.frac).toBeCloseTo(0.8, 12);
    expect(s.angleP).toBeCloseTo(0.5 * skullFollow(0.8), 12);
    expect(s.angleM).toBeCloseTo(-0.2 * skullFollow(0.8), 12);
  });
  it('THE REAL SPRING through chop 1, chop 2 and the kill: the bone moves without a jump, swings no wider than its flesh does, and never passes it', () => {
    let st = openSplit([1, 0, 0], [0, 0, 0.1], 0.09, 0.55);
    const full = HEAD_SPLIT.presets.middle.maxBoth, dt = 1 / 60;
    let prevBone = 0, maxStep = 0, maxFleshStep = 0;
    for (const [chop, frac] of [[1, 0.55], [2, 0.8], [3, 1]] as const) {
      if (chop > 1) st = widenSplit(st, frac);
      const restFlesh = frac * full, restBone = restFlesh * skullFollow(frac);
      let peakFlesh = 0, peakBone = 0, prevFlesh = st.angle, troughFlesh = Infinity, troughBone = Infinity, past = false;
      for (let i = 0; i < 180; i++) {
        st = stepSplit(st, dt);
        const s = skullSplitOf(splitWarpOf(st, FRAME));
        const bone = s ? s.angleP : 0;
        expect(bone).toBeLessThanOrEqual(st.angle + 1e-12);
        expect(s ? -s.angleM : 0).toBeCloseTo(bone, 12);
        maxStep = Math.max(maxStep, Math.abs(bone - prevBone));
        maxFleshStep = Math.max(maxFleshStep, Math.abs(st.angle - prevFlesh));
        peakFlesh = Math.max(peakFlesh, st.angle); peakBone = Math.max(peakBone, bone);
        // After the first pass over the target: how far the swing back dips under the rest angles.
        past ||= st.angle >= restFlesh;
        if (past) { troughFlesh = Math.min(troughFlesh, st.angle); troughBone = Math.min(troughBone, bone); }
        prevBone = bone; prevFlesh = st.angle;
      }
      // Settled on the stage's rest angles.
      expect(st.angle).toBe(restFlesh);
      expect(prevBone).toBeCloseTo(restBone, 12);
      // The bone's overshoot, as a share of its rest angle, is the flesh's.
      expect(peakFlesh).toBeGreaterThan(1.05 * restFlesh);
      expect(peakBone / restBone).toBeLessThanOrEqual(peakFlesh / restFlesh + 1e-9);
      // And so is its swing back under the rest angle: the stage stays the target's, so the bone dips with its flesh
      // and no further (read at the flesh's own angle, the table's slope took it down 7% where its flesh went 2%).
      expect(troughFlesh).toBeLessThan(restFlesh);
      expect(troughBone / restBone).toBeGreaterThanOrEqual(troughFlesh / restFlesh - 1e-9);
      // Measured (degrees, rest -> peak -> trough): chop 1 flesh 17.33 -> 22.56 -> 15.86, bone 1.73 -> 2.26 -> 1.59;
      // chop 2 flesh 25.21 -> 27.59 -> 24.53, bone 7.56 -> 8.28 -> 7.36; the kill flesh 31.51 -> 33.42 -> 30.97, bone
      // 26.79 -> 28.40 -> 26.33.
    }
    // No jump. The bone's fastest tick is on the kill, where it goes from 7.6 to 26.8 degrees while its flesh rises
    // 6.3: a tick moves it no more than 1.2 x what the fastest tick moves the flesh (9.4 against 8.3 degrees).
    expect(maxStep).toBeLessThanOrEqual(1.2 * maxFleshStep);
  });
  /** The steepest the bone angle can rise with its flesh angle while the target stands: the bone is
   *  flesh x follow(flesh / full) under the target, so its slope is follow(x) + x x follow'(x), largest at the top
   *  end of a table segment; past the target it is the target's share (at most 1). */
  const boneSlope = (knots: readonly (readonly [number, number])[] = S.follow): number => {
    let L = 1;
    for (let i = 1; i < knots.length; i++) {
      const [xa, ka] = knots[i - 1]!, [xb, kb] = knots[i]!, m = (kb - ka) / (xb - xa);
      L = Math.max(L, ka + xa * m, kb + xb * m);
    }
    return L;
  };
  it('EVERY TICK of the axe\'s own chops, landing settled: the bone moves no more than the table\'s steepest slope x what its flesh moves', () => {
    const L = boneSlope(), eps = 1e-9, dt = 1 / 60;
    let st = openSplit([1, 0, 0], [0, 0, 0.1], 0.09, chopOpenFrac(1));
    let prevBone = 0, prevFlesh = st.angle, worst = 0, ticks = 0;
    for (let chop = 1; chop <= AXE_HEAD.chopsToKill; chop++) {
      // The chop lands on a settled spring (play's strikes are at least 0.6 s apart, webgpu/axe-swing.ts): the tick
      // that takes the new target, or the kill's kick, is in the bound too.
      if (chop > 1) { expect(st.vel).toBe(0); expect(st.angle).toBe(st.target); st = punchSplit(widenSplit(st, chopOpenFrac(chop)), chopKick(chop)); }
      for (let i = 0; i < 180; i++) {
        st = stepSplit(st, dt);
        const s = skullSplitOf(splitWarpOf(st, FRAME)), bone = s ? s.angleP : 0;
        const dBone = Math.abs(bone - prevBone), dFlesh = Math.abs(st.angle - prevFlesh);
        expect(dBone, `chop ${chop} tick ${i}`).toBeLessThanOrEqual(L * dFlesh + eps);
        if (dFlesh > 1e-6) worst = Math.max(worst, dBone / dFlesh);
        prevBone = bone; prevFlesh = st.angle; ticks++;
      }
    }
    expect(ticks).toBe(180 * AXE_HEAD.chopsToKill);
    // The bound is what chop 2 does on its way up the table's last segment, not slack: the tick that ends just under
    // the target moves the bone 3.14 x its flesh (the slope there is L = 3.6, and a tick is a chord of it). Through
    // the kill's kick the bone is the stage's share of its flesh: 0.85 x.
    expect(worst).toBeGreaterThan(0.85 * L);
    expect(worst).toBeLessThanOrEqual(L);
  });
  it('a chop landing ABOVE the old target steps the stage, and the bone\'s share with it, on the next tick', () => {
    // KNOWN, and accepted for now: the stage is the high-water mark of min(flesh, target), so a chop that lands while
    // the flesh is past the old target takes the stage up to the flesh at the next step. Play cannot do it (the spring
    // is at rest 0.6 s on); the axeChop seam can. With the axe's own table it is a large step: chop 2 landing 3 to 5
    // frames after chop 1 finds the flesh past the wide crack's target, and the bone's share goes at once from the
    // wide crack's 0.3 to the split's 0.85 (0.80 at 5 frames): 20.6, 18.3 and 14.4 degrees of bone in one tick, with
    // 5.2, 0.3 and -1.7 degrees of flesh. (Landing 2 frames after, the flesh is still under the target and rising:
    // 23.4 degrees of bone with 11.3 of flesh, steep but inside the per-tick bound above.)
    const L = boneSlope(), dt = 1 / 60, full = HEAD_SPLIT.presets.middle.maxBoth, deg = 180 / Math.PI;
    const steps: number[] = [];
    for (let after = 3; after <= 5; after++) {
      let st = openSplit([1, 0, 0], [0, 0, 0.1], 0.09, chopOpenFrac(1));
      for (let i = 0; i < after; i++) st = stepSplit(st, dt);
      expect(st.angle, `${after} frames on`).toBeGreaterThan(st.target);
      const before = skullSplitOf(splitWarpOf(st, FRAME))!;
      const chopped = widenSplit(st, chopOpenFrac(2));
      // The chop itself moves nothing: the stage is the step's to advance.
      expect(skullSplitOf(splitWarpOf(chopped, FRAME))!.angleP).toBe(before.angleP);
      const next = stepSplit(chopped, dt), now = skullSplitOf(splitWarpOf(next, FRAME))!;
      expect(before.follow).toBeCloseTo(skullFollow(chopOpenFrac(1)), 12);
      expect(now.follow).toBeCloseTo(skullFollow(next.stage / full), 12);
      expect(now.follow - before.follow).toBeGreaterThan(0.4);
      // Past the per-tick bound: the bone moves with little or no flesh behind it.
      expect(now.angleP - before.angleP).toBeGreaterThan(L * Math.abs(next.angle - st.angle) + 1e-9);
      steps.push((now.angleP - before.angleP) * deg);
    }
    expect(Math.min(...steps)).toBeGreaterThan(14);
    expect(Math.max(...steps)).toBeLessThan(21);
  });
  it('THE AXE\'S OWN CHOPS through the real spring: a wide crack, a split with the zombie alive, and a kill that kicks the split without moving its stage', () => {
    const full = HEAD_SPLIT.presets.middle.maxBoth, dt = 1 / 60, deg = 180 / Math.PI;
    const boneOf = (s: typeof st) => skullSplitOf(splitWarpOf(s, FRAME))?.angleP ?? 0;
    let st = openSplit([1, 0, 0], [0, 0, 0.1], 0.09, chopOpenFrac(1));
    const rest: number[] = [];
    for (let chop = 1; chop <= 2; chop++) {
      if (chop > 1) st = punchSplit(widenSplit(st, chopOpenFrac(chop)), chopKick(chop));
      for (let i = 0; i < 180; i++) st = stepSplit(st, dt);
      expect(st).toMatchObject({ angle: chopOpenFrac(chop) * full, vel: 0 });
      rest.push(boneOf(st) * deg);
    }
    // Chop 1 is the table's second stage (7.56 degrees a half), chop 2 its third (26.79): the head is split wide before
    // the kill, and chop 2 gave no kick of its own.
    expect(chopKick(1)).toBe(0);
    expect(chopKick(2)).toBe(0);
    expect(rest[0]!).toBeCloseTo(0.8 * full * skullFollow(0.8) * deg, 9);
    expect(rest[1]!).toBeCloseTo(full * skullFollow(1) * deg, 9);
    expect(st.angle).toBe(full);
    // THE KILL lands on a split already at its full angle: the target does not move, the spring is kicked.
    expect(chopOpenFrac(3)).toBe(1);
    expect(chopKick(3)).toBe(AXE_HEAD.killKick);
    st = punchSplit(widenSplit(st, chopOpenFrac(3)), chopKick(3));
    expect(st).toMatchObject({ angle: full, target: full, stage: full });
    expect(st.vel).toBeGreaterThan(0);
    const share = skullFollow(1);
    let peak = 0, trough = Infinity, bonePeak = 0, boneTrough = Infinity, prevBone = boneOf(st), prevFlesh = st.angle;
    for (let i = 0; i < 180; i++) {
      st = stepSplit(st, dt);
      const bone = boneOf(st);
      // No step, no flap: on every tick of the kick the bone is the stage's share of its flesh, so it moves in
      // proportion and never further in a tick than its flesh.
      expect(st.stage).toBe(full);
      expect(bone).toBeCloseTo(share * st.angle, 12);
      expect(Math.abs(bone - prevBone)).toBeLessThanOrEqual(Math.abs(st.angle - prevFlesh) + 1e-12);
      peak = Math.max(peak, st.angle); trough = Math.min(trough, st.angle);
      bonePeak = Math.max(bonePeak, bone); boneTrough = Math.min(boneTrough, bone);
      prevBone = bone; prevFlesh = st.angle;
    }
    // It reads as a hit: the halves snap wider by about killKick x the full angle, swing back under it, and settle.
    expect((peak - full) / (AXE_HEAD.killKick * full)).toBeGreaterThan(0.9);
    expect((peak - full) / (AXE_HEAD.killKick * full)).toBeLessThan(1.05);
    expect(trough).toBeLessThan(full - 0.2 * AXE_HEAD.killKick * full);
    expect(st).toMatchObject({ angle: full, vel: 0, target: full, stage: full });
    expect(boneTrough / (share * full)).toBeCloseTo(trough / full, 9);
    console.log(`the kill's kick (middle, both): flesh ${(full * deg).toFixed(2)} -> ${(peak * deg).toFixed(2)} -> ${(trough * deg).toFixed(2)} degrees a half, `
      + `bone ${(share * full * deg).toFixed(2)} -> ${(bonePeak * deg).toFixed(2)} -> ${(boneTrough * deg).toFixed(2)}`);
  });
  it('a spring overshoot never opens the bone past its flesh: frac is held at 1, follow at 1', () => {
    const w = both(1.4), s = skullSplitOf(w)!;
    expect(s.frac).toBe(1);
    expect(s.angleP).toBeLessThanOrEqual(w.thetaP);
    expect(-s.angleM).toBeLessThanOrEqual(-w.thetaM);
    const over = skullSplitOf(both(0.8), 3)!;   // a follow set by hand above 1
    expect(over.follow).toBe(1);
    expect(over.angleP).toBe(both(0.8).thetaP);
  });
  it('a follow set by hand replaces the table: 1 rides the flesh, 0 is the whole skull (no split at all)', () => {
    const w = both(0.8);
    expect(skullSplitOf(w, 1)!.angleP).toBe(w.thetaP);
    expect(skullSplitOf(w, 1)!.angleM).toBe(w.thetaM);
    expect(skullSplitOf(w, 0)).toBeNull();
    expect(skullSplitOf(w, null)!.follow).toBeCloseTo(skullFollow(0.8), 12);
    expect(skullSplitOf(w, null, 5)!.seed).toBe(5);
    // Another table in place of HEAD_SPLIT's.
    expect(skullSplitOf(w, [[0, 0.5], [1, 0.5]])!.angleP).toBeCloseTo(0.5 * w.thetaP, 12);
    expect(skullSplitOf(w, [[0.8, 0.2], [1, 0.9]])!.follow).toBeCloseTo(0.2, 12);
  });
  it('skullFollowOk: a finite share, or a table of finite knots with rising openings; nothing else', () => {
    for (const ok of [0, 0.3, 1, [[0.5, 0.1]], [[0.55, 0.1], [0.8, 0.3], [1, 0.85]], S.follow]) expect(skullFollowOk(ok), JSON.stringify(ok)).toBe(true);
    for (const bad of [NaN, Infinity, '0.3', null, undefined, [], [[0.5]], [[0.5, NaN]], [[0.8, 0.1], [0.8, 0.3]], [[0.8, 0.1], [0.5, 0.3]], [0.5, 0.1], {}]) {
      expect(skullFollowOk(bad), JSON.stringify(bad)).toBe(false);
    }
  });
  it('skullPieceAt: the flesh\'s ownership (warpPoint), but a side whose bone does not turn belongs to the rest', () => {
    for (const [name, w] of CASES) {
      const s = skullSplitOf(w)!;
      let seen = 0;
      for (let i = 0; i < 4000; i++) {
        const q: Vec3 = [(hash(i, 1) - 0.5) * 0.5, 1.45 + hash(i, 2) * 0.45, (hash(i, 3) - 0.5) * 0.5];
        const flesh = warpPoint(w, q).piece;
        const want = flesh === 1 && w.thetaP === 0 ? 0 : flesh === 2 && w.thetaM === 0 ? 0 : flesh;
        expect(skullPieceAt(s, q), `${name} ${q}`).toBe(want);
        seen |= 1 << want;
      }
      expect(seen & 1, name).toBe(1);
      expect(seen & 6, name).not.toBe(0);
    }
  });
  it('skullPieceAt: the fracture offset moves the edge between the halves, for both of them alike', () => {
    const s = skullSplitOf(both(1))!, w = s.frame.w;
    const onPlane: Vec3 = [0, 1.75, 0];
    const q: Vec3 = add(onPlane, [0.002, 0, 0]);   // 2 mm on the + side
    expect(skullPieceAt(s, q)).toBe(1);
    expect(skullPieceAt(s, q, -0.003)).toBe(2);
    expect(skullPieceAt(s, add(onPlane, [-0.002, 0, 0]), 0.003)).toBe(1);
    // The hinge plane and the hold ball stay clean: no offset moves them.
    const below: Vec3 = add(w.h, [0.05, -0.01, 0]);
    expect(skullPieceAt(s, below, 0.05)).toBe(0);
    expect(skullPieceAt(s, add(w.h, [0.02, w.r, 0]), 0.05)).toBe(0);
  });
  it('skullWarpPoint: a bone point turns about the hinge by its piece\'s BONE angle; the rest stays', () => {
    const w = both(0.8), s = skullSplitOf(w)!;
    const qp: Vec3 = [0.05, 1.75, 0.02], qm: Vec3 = [-0.05, 1.75, 0.02], q0: Vec3 = [0.05, 1.5, 0];
    expect(skullWarpPoint(s, qp).piece).toBe(1);
    expect(len(sub(skullWarpPoint(s, qp).p, moveOpen(w, qp, s.angleP)))).toBeLessThan(1e-12);
    expect(len(sub(skullWarpPoint(s, qm).p, moveOpen(w, qm, s.angleM)))).toBeLessThan(1e-12);
    expect(skullWarpPoint(s, q0)).toEqual({ p: q0, piece: 0 });
    // The bone lags its flesh half: it is nearer the old plane than the flesh point it sat under.
    expect(Math.abs(skullWarpPoint(s, qp).p[0])).toBeLessThan(Math.abs(warpPoint(w, qp).p[0]));
  });
  it('skullPieces: the pieces a sphere of the closed skull can have bone of (bit 0 the rest, 1 the + half, 2 the - half)', () => {
    for (const [name, w] of CASES) {
      const s = skullSplitOf(w)!;
      for (let k = 0; k < 300; k++) {
        const c: Vec3 = [(hash(k, 7) - 0.5) * 0.4, 1.45 + hash(k, 8) * 0.45, (hash(k, 9) - 0.5) * 0.4];
        const r = 0.01 + hash(k, 10) * 0.12, slack = 0.004;
        const mask = skullPieces(s, c, r + slack);
        let seen = 0;
        for (let i = 0; i < 200; i++) {
          let d: Vec3 = [hash(k * 977 + i, 11) - 0.5, hash(k * 977 + i, 12) - 0.5, hash(k * 977 + i, 13) - 0.5];
          d = scale(d, r * Math.cbrt(hash(k * 977 + i, 14)) / (len(d) || 1));
          seen |= 1 << skullPieceAt(s, add(c, d), (hash(k * 977 + i, 15) - 0.5) * 2 * slack);
        }
        expect(seen & ~mask, `${name} sphere ${c} r ${r}`).toBe(0);
      }
      // Tight where it matters: a sphere deep in one half is that half's alone; one below the hinge is the rest's.
      const u = cross(w.n, w.a), up = (d: number, side: number): Vec3 => add(add(w.h, scale(u, d)), scale(w.n, side));
      if (w.thetaP !== 0) expect(skullPieces(s, up(0.12, 0.06), 0.02), name).toBe(2);
      if (w.thetaM !== 0) expect(skullPieces(s, up(0.12, -0.06), 0.02), name).toBe(4);
      if (w.thetaM === 0) expect(skullPieces(s, up(0.12, -0.06), 0.02), name).toBe(1);
      expect(skullPieces(s, up(-0.08, 0.03), 0.02), name).toBe(1);
      expect(skullPieces(s, up(0.12, 0), 0.02) & 1, name).toBe(w.thetaP !== 0 && w.thetaM !== 0 ? 0 : 1);
    }
  });
});
