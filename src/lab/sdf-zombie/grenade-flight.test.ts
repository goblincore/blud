import { describe, it, expect } from 'vitest';
import { GRENADE, grenadeVelocity, makeGrenade, stepGrenade, grenadeFragments, stepGrenadeFragment, type GrenadeWorld } from './grenade-flight';
import { sweepGrenade, type GrenadeBody } from './grenade-collision';
import { bindGrenade, attachedGrenade } from './grenade-attachment';
import type { Vec3, Primitive } from './types';
import type { BuildResult } from './build-body';
import { len, sub } from './vec';

const ball = (center: Vec3, metal = false): BuildResult => {
  const p: Primitive = { a: center, b: center, radius: .3, scale: [1, 1, 1],
    blendK: 0, limb: 'torso', cluster: 1, metal };
  return { prims: [p], clusters: [{ id: 1, limb: 'torso', start: 0, count: 1, center, radius: .3, alive: true }],
    bones: new Map(), bonePrims: [], errors: [] };
};
const entry = (x: number, id: number, metal = false): GrenadeBody => ({ id, body: ball([x, 1, 0], metal), yaw: 0, flesh: true });
const empty: GrenadeWorld = { sweep: () => null };
const floor: GrenadeWorld = { sweep: (a, b, r) => sweepGrenade(a, b, r, [], Infinity) };
describe('grenade flight and collision', () => {
  it('rises visibly, then drops under gravity at room range', () => {
    const s = makeGrenade([0, 1, 0], grenadeVelocity([0, 0, -1]));
    const early = stepGrenade(s, .1, empty);
    expect(early.pos[1]).toBeGreaterThan(1.1);
    let later = s;
    for (let i = 0; i < 3; i++) later = stepGrenade(later, .2, empty);
    expect(later.pos[1]).toBeLessThan(.1);
    expect(later.pos[2]).toBeCloseTo(-9.6);
  });
  it('gives the same fixed-step trajectory across frame partitions', () => {
    const s = makeGrenade([0, 1, 0], [3, -4, 2]);
    const a = stepGrenade(s, .2, floor);
    let b = s;
    for (let i = 0; i < 20; i++) b = stepGrenade(b, .01, floor);
    expect(b.pos).toEqual(a.pos); expect(b.vel).toEqual(a.vel);
    expect(b.fuse).toBe(a.fuse); expect(b.bounces).toBe(a.bounces);
  });
  it('bounces and damps against the floor without stopping the fuse', () => {
    const s = stepGrenade(makeGrenade([0, .1, 0], [5, -3, 0]), .05, floor);
    expect(s.vel[1]).toBeGreaterThan(0); expect(s.vel[0]).toBeLessThan(5);
    expect(s.pos[1]).toBeGreaterThanOrEqual(GRENADE.radiusM);
    expect(s.bounces).toBe(1); expect(s.fuse).toBeCloseTo(1.55);
  });
  it('sweeps through a thin wall instead of tunnelling and returns the nearest surface', () => {
    const box = { min: [.2, 0, -1] as Vec3, max: [.21, 2, 1] as Vec3 };
    const hit = sweepGrenade([0, 1, 0], [2, 1, 0], .035, [box], 3, [entry(1, 7)]);
    expect(hit?.actorId).toBeUndefined(); expect(hit?.normal).toEqual([-1, 0, 0]);
    expect(hit?.center[0]).toBeCloseTo(.165);
  });
  it('orders actors by contact distance, regardless of iteration order', () => {
    const hit = sweepGrenade([0, 1, 0], [3, 1, 0], .035, [], 3, [entry(2, 2), entry(1, 1)]);
    expect(hit?.actorId).toBe(1); expect(hit?.point[0]).toBeCloseTo(.7, 2);
  });
  it('embeds at point blank with no grace/standoff gate and holds its fuse', () => {
    const w: GrenadeWorld = { sweep: (a, b, r) => sweepGrenade(a, b, r, [], 3, [entry(.35, 8)]),
      attached: () => ({ pos: [.072, 1, 0], direction: [1, 0, 0] }) };
    let s = stepGrenade(makeGrenade([0, 1, 0], [16, 0, 0]), 1 / 120, w);
    expect(s.embedded).toBe(8); expect(s.age).toBeLessThan(.01);
    for (let i = 0; i < 8; i++) s = stepGrenade(s, .2, w);
    expect(s.detonated).toBe(true); expect(s.pos).toEqual([.072, 1, 0]);
    expect(stepGrenade(s, .1, w)).toBe(s);
  });
  it('releases a lost attachment and preserves the remaining fuse', () => {
    const s = { ...makeGrenade([0, 1, 0], [0, 0, 0]), embedded: 7, fuse: .5 };
    const next = stepGrenade(s, .1, { ...empty, attached: () => null });
    expect(next.embedded).toBeNull(); expect(next.pos[1]).toBeLessThan(1);
    expect(next.fuse).toBeCloseTo(.4);
  });
  it('holds an embedded static target when no pose provider is needed', () => {
    const s = { ...makeGrenade([0, 1, 0], [0, 0, 0]), embedded: 7 };
    const next = stepGrenade(s, .1, empty);
    expect(next.embedded).toBe(7); expect(next.pos).toEqual(s.pos);
    expect(next.fuse).toBeCloseTo(1.5);
  });
  it('bounces from metal and skeletal actor surfaces instead of embedding', () => {
    for (const e of [entry(1, 7, true), { ...entry(1, 7), flesh: false }]) {
      const w: GrenadeWorld = { sweep: (a, b, r) => sweepGrenade(a, b, r, [], 3, [e]) };
      const s = stepGrenade(makeGrenade([0, 1, 0], [16, 0, 0]), .06, w);
      expect(s.embedded).toBeNull(); expect(s.bounces).toBe(1); expect(s.vel[0]).toBeLessThan(0);
    }
  });
  it('expires a resting grenade exactly once and rejects invalid time', () => {
    const initial = makeGrenade([0, GRENADE.radiusM, 0], [0, 0, 0]);
    expect(stepGrenade(initial, NaN, floor)).toBe(initial);
    let s = initial;
    for (let i = 0; i < 8; i++) s = stepGrenade(s, .2, floor);
    expect(s.detonated).toBe(true); expect(s.bounces).toBe(0);
    expect(s.pos[1]).toBeCloseTo(GRENADE.radiusM, 3);
  });
  it('produces repeatable unit fragment directions covering both hemispheres', () => {
    const dirs = grenadeFragments(3);
    expect(dirs).toHaveLength(32); expect(dirs).toEqual(grenadeFragments(3));
    expect(dirs).not.toEqual(grenadeFragments(4));
    expect(dirs.filter(d => d[1] > 0)).toHaveLength(16);
    for (const d of dirs) expect(len(d)).toBeCloseTo(1);
  });
  it('limits fragment travel to its damage range even on a long frame', () => {
    const s = { pos: [0, 1, 0] as Vec3, vel: [38, 0, 0] as Vec3, age: 0 };
    const next = stepGrenadeFragment(s, .25, { sweep: (a, b, r) => sweepGrenade(a, b, r, [], 3, [entry(8, 7)]) });
    expect(next.hit).toBeNull(); expect(next.expired).toBe(true);
    expect(next.state.pos[0]).toBeCloseTo(7);
  });
  it('blocks damaging fragments at a wall before the target behind it', () => {
    const s = { pos: [0, 1, 0] as Vec3, vel: [38, 0, 0] as Vec3, age: 0 };
    const boxes = [{ min: [.5, 0, -1] as Vec3, max: [.51, 2, 1] as Vec3 }];
    const next = stepGrenadeFragment(s, .1, { sweep: (a, b, r) => sweepGrenade(a, b, r, boxes, 3, [entry(1, 7)]) });
    expect(next.hit?.actorId).toBeUndefined(); expect(next.expired).toBe(true);
    const clear = stepGrenadeFragment(s, .1, { sweep: (a, b, r) => sweepGrenade(a, b, r, [], 3, [entry(1, 7)]) });
    expect(clear.hit?.actorId).toBe(7);
  });
});
describe('grenade flesh attachment', () => {
  it('moves and turns with the bound flesh primitive', () => {
    const body = ball([0, 1, 0]), pos: Vec3 = [0, 1, .27];
    const anchor = bindGrenade(body, 0, pos, [0, 0, -1]);
    expect(len(sub(attachedGrenade(body, 0, anchor)!.pos, pos))).toBeCloseTo(0);
    const moved = ball([2, 1, 3]);
    const attached = attachedGrenade(moved, Math.PI / 2, anchor)!;
    expect(attached.pos[0]).toBeCloseTo(2.27); expect(attached.pos[2]).toBeCloseTo(3);
    expect(attached.direction[0]).toBeCloseTo(-1);
  });
  it('releases when the hit cluster is severed', () => {
    const body = ball([0, 1, 0]);
    const anchor = bindGrenade(body, 0, [0, 1, .27], [0, 0, -1]);
    body.clusters[0]!.alive = false;
    expect(attachedGrenade(body, 0, anchor)).toBeNull();
  });
});
