// src/lab/sdf-zombie/webgpu/flail-strike.test.ts
//
import { describe, expect, it } from 'vitest';
import { FLAIL_ARC_DEG, FLAIL_HEAD, FLAIL_STRIKE, flailWound, headNeck, inStrikeArc, isHeadRegion, resolveStrike, snapToSurface, snapToSurfaceResidual, viewToWorld, type StrikeActor } from './flail-strike';
import type { Primitive, Vec3 } from '../types';
import { HEAD_LEAF } from './game-head-damage';
import flailSrc from './game-flail.ts?raw';
import { FLESH_BITS, craterFleshBits, fleshRand } from '../flesh-bits';

/** Standard polynomial smooth-min (k = blend radius). */
const smin = (a: number, b: number, k: number) => {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - (h * h * k) / 4;
};

const EYE: Vec3 = [0, 1.62, 0];
const len = (v: readonly number[]) => Math.hypot(v[0]!, v[1]!, v[2]!);
const ball = (id: number, c: Vec3, r = 0.3): StrikeActor => ({
  id, centre: c, field: p => Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]) - r,
});
/** A vertical capsule from a to b, radius r. */
const capsule = (id: number, a: Vec3, b: Vec3, r: number): StrikeActor => ({
  id, centre: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2],
  field: (p) => {
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
    const t = Math.max(0, Math.min(1, (ap[0]! * ab[0]! + ap[1]! * ab[1]! + ap[2]! * ab[2]!) / (ab[0]! ** 2 + ab[1]! ** 2 + ab[2]! ** 2)));
    return Math.hypot(ap[0]! - ab[0]! * t, ap[1]! - ab[1]! * t, ap[2]! - ab[2]! * t) - r;
  },
});

describe('viewToWorld', () => {
  it('maps view −z to the facing, x to the right, y to up (yaw 0, pitch 0)', () => {
    const f0 = viewToWorld(EYE, 0, 0, [0, 0, -1]);
    expect(f0[0]).toBeCloseTo(0, 9); expect(f0[1]).toBeCloseTo(1.62, 9); expect(f0[2]).toBeCloseTo(-1, 9);
    const r = viewToWorld(EYE, 0, 0, [1, 0, 0]);
    expect(r[0]).toBeCloseTo(1, 9); expect(r[2]).toBeCloseTo(0, 9);
    expect(viewToWorld(EYE, 0, 0, [0, 1, 0])[1]).toBeCloseTo(2.62, 9);
  });
  it('turns with yaw (yaw π/2 faces +x) and pitches with pitch', () => {
    const f = viewToWorld(EYE, Math.PI / 2, 0, [0, 0, -1]);
    expect(f[0]).toBeCloseTo(1, 9); expect(f[2]).toBeCloseTo(0, 9);
    const up = viewToWorld(EYE, 0, Math.PI / 2, [0, 0, -1]);
    expect(up[1]).toBeCloseTo(2.62, 9);
  });
});

describe('inStrikeArc', () => {
  it('takes a zombie in front within reach, and one hugging the player', () => {
    expect(inStrikeArc(EYE, 0, [0, 1.1, -1.5], FLAIL_ARC_DEG.R)).toBe(true);
    expect(inStrikeArc(EYE, 0, [0, 1.1, -0.03], FLAIL_ARC_DEG.R)).toBe(true);
  });
  it('refuses one too far or too wide', () => {
    expect(inStrikeArc(EYE, 0, [0, 1.1, -2.2], FLAIL_ARC_DEG.R)).toBe(false);
    const a = (70 * Math.PI) / 180;
    expect(inStrikeArc(EYE, 0, [Math.sin(a) * 1.2, 1.1, -Math.cos(a) * 1.2], FLAIL_ARC_DEG.R)).toBe(false);
    const b = ((FLAIL_ARC_DEG.R - 5) * Math.PI) / 180;
    expect(inStrikeArc(EYE, 0, [Math.sin(b) * 1.2, 1.1, -Math.cos(b) * 1.2], FLAIL_ARC_DEG.R)).toBe(true);
  });
});

describe('per-swing arc', () => {
  it('R and L reach ±50°, H ±70°', () => {
    expect(FLAIL_ARC_DEG).toEqual({ R: 50, L: 50, H: 70 });
    const eye: Vec3 = [0, 1.6, 0];
    const at = (deg: number): Vec3 => [Math.sin(deg * Math.PI / 180) * 1.2, 1.2, -Math.cos(deg * Math.PI / 180) * 1.2];
    expect(inStrikeArc(eye, 0, at(60), FLAIL_ARC_DEG.R)).toBe(false);
    expect(inStrikeArc(eye, 0, at(60), FLAIL_ARC_DEG.H)).toBe(true);
    expect(inStrikeArc(eye, 0, at(-60), FLAIL_ARC_DEG.H)).toBe(true);
    expect(inStrikeArc(eye, 0, at(80), FLAIL_ARC_DEG.H)).toBe(false);
  });
});

describe('snapToSurface', () => {
  it('lands on the skin of a sphere and of a capsule (within 5 mm)', () => {
    const s = ball(1, [0, 1.1, -1.5]);
    const p = snapToSurface(s.field, [0.1, 1.3, -1.0]);
    expect(Math.abs(s.field(p))).toBeLessThan(0.005);
    const c = capsule(2, [0, 0.4, -1.5], [0, 1.4, -1.5], 0.18);
    const q = snapToSurface(c.field, [0.3, 1.0, -1.2]);
    expect(Math.abs(c.field(q))).toBeLessThan(0.005);
  });
});

describe('resolveStrike', () => {
  it('hits every actor in the arc, at a surface point, with a unit direction from the eye', () => {
    const impact: Vec3 = [0, 1.2, -1.2];
    const hits = resolveStrike(EYE, 0, impact, [
      ball(1, [0, 1.1, -1.5]), ball(2, [0.6, 1.1, -1.4]), ball(3, [0, 1.1, -3]),
    ], FLAIL_ARC_DEG.R);
    expect(hits.map(h => h.actorId)).toEqual([1, 2]);
    for (const h of hits) expect(len(h.dir)).toBeCloseTo(1, 9);
    expect(Math.abs(Math.hypot(hits[0]!.point[0], hits[0]!.point[1] - 1.1, hits[0]!.point[2] + 1.5) - 0.3)).toBeLessThan(0.005);
  });
  it('hits nothing when nothing is in the arc (a whoosh)', () => {
    expect(resolveStrike(EYE, 0, [0, 1.2, -1.2], [ball(1, [0, 1.1, 1.5])], FLAIL_ARC_DEG.R)).toEqual([]);
  });
  it('returns no hit for an actor whose field goes non-finite', () => {
    const broken: StrikeActor = { id: 9, centre: [0, 1.1, -1.5], field: () => NaN };
    expect(resolveStrike(EYE, 0, [0, 1.2, -1.2], [broken], FLAIL_ARC_DEG.R)).toEqual([]);
  });
});

describe('snapToSurfaceResidual on a LOOSE field (gradient magnitude != 1)', () => {
  it('converges within 5 mm from 1 m out on a 0.4x-scaled sphere field', () => {
    const c: Vec3 = [0, 1.1, -1.5], r = 0.3;
    const trueField = (p: Vec3) => Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]) - r;
    const loose = (p: Vec3) => 0.4 * trueField(p);
    const start: Vec3 = [c[0], c[1] + r + 1.0, c[2]]; // 1 m out from the skin
    const { point, residual } = snapToSurfaceResidual(loose, start);
    expect(residual).toBeLessThan(0.01);
    expect(Math.abs(trueField(point))).toBeLessThan(0.005);
  });
  it('converges on a smooth union of two spheres (smin, k = 0.1)', () => {
    const c1: Vec3 = [0, 1.1, -1.5], c2: Vec3 = [0.3, 1.1, -1.5], r = 0.25;
    const field = (p: Vec3) => smin(
      Math.hypot(p[0] - c1[0], p[1] - c1[1], p[2] - c1[2]) - r,
      Math.hypot(p[0] - c2[0], p[1] - c2[1], p[2] - c2[2]) - r,
      0.1,
    );
    const { point, residual } = snapToSurfaceResidual(field, [0.15, 1.1, -1.0]);
    expect(residual).toBeLessThan(0.005);
    expect(Math.abs(field(point))).toBeLessThan(0.005);
  });
  it('reports an infinite residual (never a NaN point) when the field goes non-finite', () => {
    const { residual } = snapToSurfaceResidual(() => NaN, [0, 1, 0]);
    expect(residual).toBe(Infinity);
  });
});

describe('resolveStrike placement on a two-part body (torso + forward-hanging head)', () => {
  // A vertical torso capsule with a head sphere drooping forward (toward the
  // player, +z) and low, its jaw jutting out near chest height — the shape
  // that made the old nearest-Euclidean-point snap land on the face.
  const torsoA: Vec3 = [0, 0.9, -1.5], torsoB: Vec3 = [0, 1.6, -1.5], torsoR = 0.28;
  const headC: Vec3 = [0, 1.55, -1.05], headR = 0.22;
  const torsoSdf = (p: Vec3) => {
    const ab: Vec3 = [torsoB[0] - torsoA[0], torsoB[1] - torsoA[1], torsoB[2] - torsoA[2]];
    const ap: Vec3 = [p[0] - torsoA[0], p[1] - torsoA[1], p[2] - torsoA[2]];
    const t = Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / (ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2)));
    return Math.hypot(ap[0] - ab[0] * t, ap[1] - ab[1] * t, ap[2] - ab[2] * t) - torsoR;
  };
  const headSdf = (p: Vec3) => Math.hypot(p[0] - headC[0], p[1] - headC[1], p[2] - headC[2]) - headR;
  const bodySdf = (p: Vec3) => Math.min(torsoSdf(p), headSdf(p));
  const zombie: StrikeActor = { id: 7, centre: [0, 1.25, -1.5], field: bodySdf };

  it('lands a chest-height strike on the torso, not the head', () => {
    // 0.36 m in front of the torso's front face (z = -1.5 + 0.28 = -1.22).
    const impact: Vec3 = [0, 1.25, -0.86];
    const hits = resolveStrike(EYE, 0, impact, [zombie], FLAIL_ARC_DEG.R);
    expect(hits).toHaveLength(1);
    expect(Math.abs(torsoSdf(hits[0]!.point))).toBeLessThan(0.02);
    expect(headSdf(hits[0]!.point)).toBeGreaterThan(0.05);
  });

  it('lands a hit on the front of a hugging actor, not its back', () => {
    const a: Vec3 = [0, 0.9, -0.2], b: Vec3 = [0, 1.6, -0.2], r = 0.28;
    const hugger = capsule(8, a, b, r);
    const impact: Vec3 = [0, 1.25, -0.36];
    const hits = resolveStrike(EYE, 0, impact, [hugger], FLAIL_ARC_DEG.R);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.point[2]).toBeGreaterThan(-0.2); // front half, not the -0.48 back wall
  });
});

describe('the head magnet (spec §13.1)', () => {
  // A zombie 1.3 m out with its forearm raised across its face (the live finding: the ray through the head
  // centre met the forearm first, 53 cm from the head).
  const H: Vec3 = [0, 1.62, -1.3], headR = 0.11;
  const headSdf = (p: Vec3) => Math.hypot(p[0] - H[0], p[1] - H[1], p[2] - H[2]) - headR;
  const torso = capsule(0, [0, 0.9, -1.3], [0, 1.28, -1.3], 0.22).field;   // shoulders below the head
  const forearm = capsule(0, [-0.25, 1.6, -1.05], [0.25, 1.6, -1.05], 0.05).field;
  const withArm: StrikeActor = { id: 3, centre: [0, 1.2, -1.3], field: p => Math.min(torso(p), forearm(p), headSdf(p)), head: { centre: H, field: headSdf } };
  const noArm: StrikeActor = { ...withArm, field: p => Math.min(torso(p), headSdf(p)) };
  /** The aim point 1 m down the ray from the eye towards `target`. */
  const aimAt = (target: Vec3): Vec3 => {
    const d: Vec3 = [target[0] - EYE[0], target[1] - EYE[1], target[2] - EYE[2]], l = len(d);
    return [EYE[0] + d[0] / l, EYE[1] + d[1] / l, EYE[2] + d[2] / l];
  };
  const one = (a: StrikeActor, target: Vec3) => {
    const hits = resolveStrike(EYE, 0, aimAt(target), [a], FLAIL_ARC_DEG.R);
    expect(hits).toHaveLength(1);
    return hits[0]!;
  };

  it('a ray through the head centre hits the head, not the forearm in front of it', () => {
    const { head: _h, ...plain } = withArm;
    expect(forearm(one(plain, H).point)).toBeLessThan(0.02);     // without the magnet: the forearm
    const h = one(withArm, H);
    expect(Math.abs(headSdf(h.point))).toBeLessThan(0.01);
    expect(h.point[2]).toBeGreaterThan(H[2]);                     // the face, not the back of the head
    expect(h.magnet).toBe(true);
    const v: Vec3 = [h.point[0] - EYE[0], h.point[1] - EYE[1], h.point[2] - EYE[2]];   // dir: eye → the new point
    for (let i = 0; i < 3; i++) expect(h.dir[i]!).toBeCloseTo(v[i]! / len(v), 9);
  });
  it('a ray 15 cm off the head centre hits the head; 25 cm off does not', () => {
    const near = one(withArm, [H[0] + 0.15, H[1], H[2]]);
    expect(Math.abs(headSdf(near.point))).toBeLessThan(0.01);
    expect(near.magnet).toBe(true);
    const far = one(withArm, [H[0] + 0.25, H[1], H[2]]);
    expect(headSdf(far.point)).toBeGreaterThan(0.05);
    expect(forearm(far.point)).toBeLessThan(0.02);
    expect(far.magnet).toBeFalsy();
  });
  it('a ray already on the head is unchanged; no head is the old behaviour', () => {
    const { head: _h, ...plainNoArm } = noArm;
    const withHead = one(noArm, H), without = one(plainNoArm, H);
    expect(withHead.point).toEqual(without.point);
    expect(withHead.magnet).toBeFalsy();
    expect(FLAIL_STRIKE.headMagnetR).toBe(0.18);
  });
});

describe('head damage (no decapitation, spec §12.3)', () => {
  const HEAD_C: Vec3 = [0, 1.6, 0], NECK: Vec3 = [0, 1.42, 0];
  it('a head prim, a point near the head centre, or a point near the neck root is the head region', () => {
    expect(isHeadRegion('head', [0, 0, 0], null, null)).toBe(true);
    expect(isHeadRegion('torso', [0, 1.4, 0], HEAD_C, null)).toBe(true);          // < regionDist of the head
    expect(isHeadRegion('torso', [0, 1.28, 0.05], HEAD_C, NECK)).toBe(true);      // 0.15 m from the neck root
    expect(isHeadRegion('torso', [0, 1.2, 0.1], HEAD_C, NECK)).toBe(false);       // 0.24 m from the neck root
    expect(isHeadRegion('armL', [0, 1.0, 0], null, null)).toBe(false);
  });
  it('a head-region hit is always a face crater with no sever, however many came before', () => {
    for (let n = 0; n < 20; n++) expect(flailWound(true, 0.09, 1.3)).toEqual({ radius: FLAIL_HEAD.faceCraterR, severRadius: 0, meterScale: FLAIL_HEAD.meterScale, flesh: 'head' });
  });
  it('a body hit is the full crater with its sever calibre', () => {
    const w = flailWound(false, 0.09, 1.3);
    expect(w.radius).toBe(0.09);
    expect(w.severRadius).toBeCloseTo(0.117, 9);
  });
  it('a head-region hit credits the head\'s share of the collapse meter and throws head flesh, whoever stamps it', () => {
    // The head damage leaf's own hits and the plain crater the flail stamps when that leaf declines (a split head)
    // read ONE scale: a split head is not beaten down four times as fast as a whole one.
    expect(FLAIL_HEAD.meterScale).toBe(0.3);
    expect(HEAD_LEAF.meterScale).toBe(FLAIL_HEAD.meterScale);
    expect(flailWound(false, 0.09, 1.3)).toMatchObject({ meterScale: 1, flesh: 'body' });
    expect(flailWound(true, 0.09, 1.3)).toMatchObject({ meterScale: FLAIL_HEAD.meterScale, flesh: 'head' });
    expect(flailSrc).toContain('meterCredit: f.meterCredit * spec.meterScale,');
    expect(flailSrc).toContain('craterFleshBits(spec.flesh, side, h.point,');
    // What that kind throws: a head crater more and bigger bits than a body crater, from the same stream.
    const throwOf = (kind: 'body' | 'head') => craterFleshBits(kind, 'R', [0, 1.6, 0], [0, 0, -1], [0, 0, 1], fleshRand(14));
    const body = throwOf('body'), head = throwOf('head');
    expect(body.length).toBeGreaterThanOrEqual(FLESH_BITS.body[0]);
    expect(body.length).toBeLessThanOrEqual(FLESH_BITS.body[1]);
    expect(head.length).toBeGreaterThanOrEqual(FLESH_BITS.head[0]);
    expect(head.length).toBeLessThanOrEqual(FLESH_BITS.head[1]);
    const gob = (p: (typeof body)[number]) => p.prims[0]!.radius;
    for (const p of body) { expect(gob(p)).toBeGreaterThanOrEqual(FLESH_BITS.size[0] - 1e-12); expect(gob(p)).toBeLessThanOrEqual(FLESH_BITS.size[1] + 1e-12); }
    for (const p of head) { expect(gob(p)).toBeGreaterThanOrEqual(FLESH_BITS.size[0] * FLESH_BITS.headScale - 1e-12); expect(gob(p)).toBeLessThanOrEqual(FLESH_BITS.size[1] * FLESH_BITS.headScale + 1e-12); }
    // Every seed: the head's throw is never the smaller one, and its smallest gob is bigger than a body's smallest could be.
    for (let seed = 1; seed <= 40; seed++) {
      const b = craterFleshBits('body', 'L', [0, 1.6, 0], [0, 0, -1], [0, 0, 1], fleshRand(seed)), h = craterFleshBits('head', 'L', [0, 1.6, 0], [0, 0, -1], [0, 0, 1], fleshRand(seed));
      expect(h.length, `seed ${seed}`).toBeGreaterThanOrEqual(b.length);
      expect(Math.min(...h.map(gob)), `seed ${seed}`).toBeGreaterThanOrEqual(FLESH_BITS.size[0] * FLESH_BITS.headScale - 1e-12);
    }
  });
  it('headNeck finds the head chain root and neck midpoint on live prims, null once the head is gone', () => {
    const prims = [
      { limb: 'torso', op: 'union', a: [0, 1.1, 0], b: [0, 1.3, 0] },
      { limb: 'head', op: 'union', a: [0, 1.38, 0], b: [0, 1.5, 0] },
      { limb: 'head', op: 'union', a: [0, 1.5, 0], b: [0, 1.7, 0] },
    ] as unknown as Primitive[];
    expect(headNeck(prims)).toEqual({ root: [0, 1.38, 0], mid: [0, 1.44, 0] });
    expect(headNeck(prims.map(p => ({ ...p, dead: p.limb === 'head' })) as Primitive[])).toBeNull();
  });
});
