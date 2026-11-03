// src/lab/sdf-zombie/collapse-body.test.ts
//
// THE CORPSE IS SOLID (collapse.ts relaxBodyCollisions), pure: the zombie's capsules and pairs, the rest pose left
// alone, a hand pushed out of the chest, legs pushed apart, the per-pass cap, no speed added.
import { describe, expect, it } from 'vitest';
import { BODY_COLLIDE, relaxBodyCollisions } from './collapse';
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
  it('has a capsule per trunk, arm and leg bone, each with flesh-sized radius', () => {
    expect(cb.capsules).toHaveLength(9);
    for (const c of cb.capsules) { expect(c.r).toBeGreaterThan(0.03); expect(c.r).toBeLessThanOrEqual(0.16); }
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
