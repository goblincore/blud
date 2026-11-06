// src/lab/sdf-zombie/collapse-body.test.ts
//
// THE CORPSE IS SOLID (collapse.ts relaxBodyCollisions), pure: the zombie's capsules and pairs, the rest pose left
// alone, a hand pushed out of the chest, legs pushed apart, the per-pass cap, no speed added.
import { describe, expect, it } from 'vitest';
import { BODY_COLLIDE, relaxBodyCollisions, relaxSpineCones, SPINE_CONES } from './collapse';
import { makeActorMotion } from './actor';
import { buildBody, DEFAULT_BUILD_OPTS } from './build-body';
import { ZOMBIE } from './body';
import type { RigPoint } from './rig';
import type { Vec3 } from './types';
import { len, sub } from './vec';

const body = buildBody(ZOMBIE, DEFAULT_BUILD_OPTS);
const m = makeActorMotion(body, { seed: 1 })!;
const joints = m.motionJoints!;
const idx = joints.index, rest = joints.base;
const cb = joints.corpseBody!;

const pts = (pos: readonly Vec3[]): RigPoint[] => pos.map(p => ({ pos: [...p] as Vec3, prev: [...p] as Vec3, pinned: false }));
/** Distance from point q to the pelvis-chest axis. */
const toTrunk = (p: readonly RigPoint[], q: Vec3) => {
  const a = p[idx.pelvis!]!.pos, b = p[idx.chest!]!.pos, ab = sub(b, a), aq = sub(q, a);
  const t = Math.max(0, Math.min(1, (aq[0] * ab[0] + aq[1] * ab[1] + aq[2] * ab[2]) / (ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2)));
  return len(sub(q, [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t]));
};
const solve = (p: RigPoint[], passes: number, limits = BODY_COLLIDE) => {
  for (let k = 0; k < passes; k++) p = relaxBodyCollisions(p, cb, limits);
  return p;
};

describe('collapseBody (the zombie)', () => {
  it('has a capsule per trunk, head, arm, leg and foot bone, each with flesh-sized radius', () => {
    expect(cb.capsules).toHaveLength(12);
    for (const c of cb.capsules) { expect(c.r).toBeGreaterThan(0.03); expect(c.r).toBeLessThanOrEqual(0.2); }
  });

  it('gives the trunk its width: wider side to side than front to back', () => {
    const t = cb.capsules[0]!;
    expect(t.w).toBeGreaterThan(t.r + 0.03);
  });

  it('never has a pair in contact in the rest pose', () => {
    const p = pts(rest);
    expect(relaxBodyCollisions(p, cb)).toBe(p);
  });
});

describe('relaxBodyCollisions', () => {
  it('pushes a hand out of the chest', () => {
    const pos = rest.map(v => [...v] as Vec3);
    const chest = rest[idx.chest!]!, pelvis = rest[idx.pelvis!]!;
    pos[idx.handL!] = [(chest[0] + pelvis[0]) / 2, (chest[1] + pelvis[1]) / 2, (chest[2] + pelvis[2]) / 2];
    const before = toTrunk(pts(pos), pos[idx.handL!]!);
    const out = solve(pts(pos), 20);
    expect(before).toBeLessThan(0.01);
    expect(toTrunk(out, out[idx.handL!]!.pos)).toBeGreaterThan(0.1);
  });

  it('keeps a forearm lying along the flank out of the trunk width, not just its depth', () => {
    const pos = rest.map(v => [...v] as Vec3);
    const chest = rest[idx.chest!]!, pelvis = rest[idx.pelvis!]!;
    const w = cb.capsules[0]!.w!;
    // The forearm laid along the left flank, half sunk into it.
    pos[idx.elbowL!] = [chest[0] + w * 0.6, chest[1] - 0.05, chest[2]];
    pos[idx.handL!] = [pelvis[0] + w * 0.6, pelvis[1] + 0.05, pelvis[2]];
    const out = solve(pts(pos), 30);
    expect(toTrunk(out, out[idx.handL!]!.pos)).toBeGreaterThan(w * 0.92 + 0.03);
  });

  it('pushes a hand out of the head', () => {
    const pos = rest.map(v => [...v] as Vec3);
    const neck = rest[idx.neck!]!, head = rest[idx.head!]!;
    pos[idx.handR!] = [(neck[0] + head[0]) / 2 + 0.01, (neck[1] + head[1]) / 2, (neck[2] + head[2]) / 2];
    const out = solve(pts(pos), 30);
    const h = out[idx.handR!]!.pos, m = out[idx.neck!]!.pos, top = out[idx.head!]!.pos;
    const mid: Vec3 = [(m[0] + top[0]) / 2, (m[1] + top[1]) / 2, (m[2] + top[2]) / 2];
    expect(len(sub(h, mid))).toBeGreaterThan(0.1);
  });

  it('pushes a knee crossed through the other one apart', () => {
    const pos = rest.map(v => [...v] as Vec3);
    const kr = rest[idx.kneeR!]!;
    pos[idx.kneeL!] = [kr[0], kr[1], kr[2] + 0.01];
    const out = solve(pts(pos), 20);
    expect(len(sub(out[idx.kneeL!]!.pos, out[idx.kneeR!]!.pos))).toBeGreaterThan(0.08);
  });

  it('moves no point further than maxStep in a pass, and adds no speed', () => {
    const pos = rest.map(v => [...v] as Vec3);
    const chest = rest[idx.chest!]!;
    pos[idx.handR!] = [...chest] as Vec3;
    const before = pts(pos);
    const out = relaxBodyCollisions(before, cb, { iterations: 1, maxStep: 0.01 });
    out.forEach((p, i) => {
      expect(len(sub(p.pos, before[i]!.pos))).toBeLessThanOrEqual(0.01 + 1e-9);
      expect(len(sub(sub(p.pos, p.prev), sub(before[i]!.pos, before[i]!.prev)))).toBeLessThan(1e-9);
    });
  });

  it('drops the closing speed of a hand driving into the chest', () => {
    const pos = rest.map(v => [...v] as Vec3);
    const chest = rest[idx.chest!]!, pelvis = rest[idx.pelvis!]!;
    const mid: Vec3 = [(chest[0] + pelvis[0]) / 2, (chest[1] + pelvis[1]) / 2, (chest[2] + pelvis[2]) / 2];
    pos[idx.handL!] = [mid[0] + 0.05, mid[1], mid[2]];
    const p = pts(pos);
    p[idx.handL!] = { ...p[idx.handL!]!, prev: [mid[0] + 0.1, mid[1], mid[2]] };  // moving -x, into the trunk
    const out = relaxBodyCollisions(p, cb);
    const v = sub(out[idx.handL!]!.pos, out[idx.handL!]!.prev);
    expect(v[0]).toBeGreaterThan(-0.01);
  });

  it('leaves pinned points where they are', () => {
    const pos = rest.map(v => [...v] as Vec3);
    pos[idx.kneeL!] = [...rest[idx.kneeR!]!] as Vec3;
    const p = pts(pos).map((q, i) => i === idx.kneeR || i === idx.footR ? { ...q, pinned: true } : q);
    const out = solve(p, 5);
    expect(out[idx.kneeR!]!.pos).toEqual(p[idx.kneeR!]!.pos);
    expect(out[idx.footR!]!.pos).toEqual(p[idx.footR!]!.pos);
  });

  it('is a no-op without a body', () => {
    const p = pts(rest);
    expect(relaxBodyCollisions(p, null)).toBe(p);
  });
});

describe('relaxSpineCones', () => {
  /** Degrees between bone pivot -> tip now and at rest (the rest of the body is left at rest, so its frame is too). */
  const offRest = (p: readonly RigPoint[], pivot: number, tip: number) => {
    const d = sub(p[tip]!.pos, p[pivot]!.pos), r = sub(rest[tip]!, rest[pivot]!);
    return Math.acos(Math.min(1, (d[0] * r[0] + d[1] * r[1] + d[2] * r[2]) / len(d) / len(r))) * 180 / Math.PI;
  };
  /** The rest pose with bone pivot -> tip swung `deg` off its rest direction toward +x, keeping its length. */
  const swung = (pivot: number, tip: number, deg: number) => {
    const pos = rest.map(v => [...v] as Vec3);
    const pv = rest[pivot]!, d = sub(rest[tip]!, pv), L = len(d), u = [d[0] / L, d[1] / L, d[2] / L];
    // Turn u toward +x in the plane of u and x.
    const xPerp = [1 - u[0]! * u[0]!, -u[0]! * u[1]!, -u[0]! * u[2]!], xl = Math.hypot(xPerp[0]!, xPerp[1]!, xPerp[2]!);
    const r = deg * Math.PI / 180;
    pos[tip] = [0, 1, 2].map(k => pv[k]! + (u[k]! * Math.cos(r) + xPerp[k]! / xl * Math.sin(r)) * L) as unknown as Vec3;
    return pts(pos);
  };
  const P = () => [idx.hips!, idx.pelvis!] as const;
  const N = () => [idx.neck!, idx.head!] as const;

  it('has a pelvis cone and two neck cones', () => {
    expect(cb.cones.map(c => c.maxDeg)).toEqual([SPINE_CONES.pelvisDeg, SPINE_CONES.neckDeg, SPINE_CONES.neckDeg]);
  });

  it('swings a pelvis folded over to one hip back to the cone, its length kept and no speed added', () => {
    const before = swung(...P(), 85);
    const out = relaxSpineCones(before, cb);
    expect(offRest(out, ...P())).toBeCloseTo(SPINE_CONES.pelvisDeg, 3);
    const L0 = len(sub(rest[idx.pelvis!]!, rest[idx.hips!]!));
    expect(len(sub(out[idx.pelvis!]!.pos, out[idx.hips!]!.pos))).toBeCloseTo(L0, 6);
    expect(len(sub(out[idx.pelvis!]!.pos, out[idx.pelvis!]!.prev))).toBeLessThan(1e-9);
    out.forEach((p, i) => { if (i !== idx.pelvis) expect(p).toBe(before[i]); });
  });

  it('turns a pelvis pointing straight back up the spine out of it', () => {
    expect(offRest(relaxSpineCones(swung(...P(), 180), cb), ...P())).toBeCloseTo(SPINE_CONES.pelvisDeg, 3);
  });

  it('lifts a head lolled 100 degrees over at the top of the neck back to the neck range', () => {
    const out = relaxSpineCones(swung(...N(), 100), cb);
    expect(offRest(out, ...N())).toBeCloseTo(SPINE_CONES.neckDeg, 3);
  });

  it('carries the head with the neck when the neck base is turned back', () => {
    const before = swung(idx.chest!, idx.neck!, 80);
    // The head rides along, rigid on the swung neck: neck -> head keeps its rest direction relative to the neck.
    const nk = before[idx.neck!]!.pos, hd: Vec3 = [nk[0] + 0.05, nk[1] + 0.15, nk[2]];
    before[idx.head!] = { ...before[idx.head!]!, pos: hd, prev: hd };
    const gap = len(sub(hd, nk));
    const out = relaxSpineCones(before, cb);
    expect(offRest(out, idx.chest!, idx.neck!)).toBeCloseTo(SPINE_CONES.neckDeg, 3);
    expect(len(sub(out[idx.head!]!.pos, out[idx.neck!]!.pos))).toBeCloseTo(gap, 6);
  });

  it('leaves joints inside their cones alone, and caps the tip move per call', () => {
    const ok = swung(...P(), 15);
    expect(relaxSpineCones(ok, cb)).toBe(ok);
    expect(relaxSpineCones(pts(rest), cb)).toEqual(pts(rest));
    const before = swung(...P(), 90);
    const out = relaxSpineCones(before, cb, { maxStep: 0.02 });
    expect(len(sub(out[idx.pelvis!]!.pos, before[idx.pelvis!]!.pos))).toBeCloseTo(0.02, 9);
  });
});
