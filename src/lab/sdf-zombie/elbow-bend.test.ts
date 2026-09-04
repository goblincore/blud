import { describe, expect, it } from 'vitest';
import { buildBody } from './build-body';
import { parseBlob } from './blob-parse';
import { compileBlob, compileFace } from './blob-compile';
import zombieSource from './characters/zombie.blob?raw';
import { bindRig, impulseAt } from './rig-bind';
import { constrainRigBends, makeRig, stepRig } from './rig';
import { add, cross, dot, len, normalize, scale, sub } from './vec';
import { rotateYaw } from './gait';
import { severDistal } from './sever';
import type { Vec3 } from './types';
import type { BuildResult } from './build-body';
import type { RigState } from './rig';

function zombie() {
  const doc = parseBlob(zombieSource);
  return buildBody(compileBlob(doc, compileFace(doc)));
}
function joints(body: BuildResult, rig: RigState, side: 'l' | 'r') {
  const upper = body.bones.get(`upperArm.${side}`)!;
  const fore = body.bones.get(`foreArm.${side}`)!;
  return [upper.head, upper.tail, fore.tail].map(p =>
    rig.restPose.findIndex(q => len(sub(p, q)) < 1e-6));
}
function signedBend(rig: RigState, ids: number[], normal: Vec3) {
  const [s, e, w] = ids.map(i => rig.points[i]!.pos);
  return dot(cross(sub(e!, s!), sub(w!, e!)), normal);
}

describe('intact elbow bend direction', () => {
  for (const side of ['l', 'r'] as const) for (const yaw of [0, Math.PI / 2, Math.PI]) {
    it(`${side} at yaw ${yaw}: stops a wrist hit before the next simulation tick`, () => {
      const body = zombie();
      // Rotate the fixture itself: the allowed side must rotate with the arm.
      body.prims = body.prims.map(p => ({ ...p, a: rotateYaw(p.a, yaw), b: rotateYaw(p.b, yaw) }));
      body.bones = new Map([...body.bones].map(([k, b]) => [k, {
        head: rotateYaw(b.head, yaw), tail: rotateYaw(b.tail, yaw),
      }]));
      const bound = bindRig(body);
      const ids = joints(body, bound.rig, side);
      const [s, e, w] = ids.map(i => bound.rig.points[i]!.pos);
      const u = normalize(sub(e!, s!));
      const fore = sub(w!, e!);
      const flex = normalize(sub(fore, scale(u, dot(fore, u))));
      const normal = normalize(cross(u, flex));
      const before = JSON.stringify(bound);
      const hit = impulseAt(bound, w!, scale(flex, -0.18));
      expect(signedBend(hit.rig, ids, normal)).toBeGreaterThanOrEqual(-1e-8);
      expect(len(sub(hit.rig.points[ids[2]!]!.pos, hit.rig.points[ids[1]!]!.pos)))
        .toBeCloseTo(len(sub(add(w!, scale(flex, -0.18)), e!)), 8);
      expect(JSON.stringify(bound)).toBe(before); // correction stays pure
      expect(hit.rig.points[ids[0]!]!.pos).toEqual(s);
      expect(hit.rig.points[ids[1]!]!.pos).toEqual(e);
    });
  }

  it('keeps permitted flexion and recoil instead of freezing the arm', () => {
    const body = zombie(), bound = bindRig(body);
    const ids = joints(body, bound.rig, 'l');
    const [s, e, w] = ids.map(i => bound.rig.points[i]!.pos);
    const u = normalize(sub(e!, s!));
    const fore = sub(w!, e!);
    const flex = normalize(sub(fore, scale(u, dot(fore, u))));
    const delta = scale(flex, 0.07);
    const hit = impulseAt(bound, w!, delta);
    expect(hit.rig.points[ids[2]!]!.pos).toEqual(add(w!, delta));
    expect(hit.rig.points[ids[2]!]!.prev).toEqual(w);
  });

  it('enforces the stop during integration and stays finite near full extension', () => {
    const body = zombie(), bound = bindRig(body);
    const ids = joints(body, bound.rig, 'l');
    const [s, e, w] = ids.map(i => bound.rig.points[i]!.pos);
    const u = normalize(sub(e!, s!)), fore = sub(w!, e!);
    const flex = normalize(sub(fore, scale(u, dot(fore, u))));
    const normal = normalize(cross(u, flex));
    let rig = { ...bound.rig, points: bound.rig.points.map((p, i) => i === ids[2]
      ? { ...p, prev: add(p.pos, scale(flex, 0.18)) } : p) };
    for (let frame = 0; frame < 60; frame++) {
      rig = stepRig(rig, 1 / 60, { gravity: [0, 0, 0], damping: 0.06, iterations: 4, restStiffness: 0.18 });
      expect(signedBend(rig, ids, normal), `frame ${frame}`).toBeGreaterThanOrEqual(-1e-7);
      expect(rig.points.every(p => [...p.pos, ...p.prev].every(Number.isFinite))).toBe(true);
    }
  });

  it('does not reverse the stop when a flinch target crosses behind the elbow', () => {
    const body = zombie(), bound = bindRig(body);
    const ids = joints(body, bound.rig, 'l');
    const [s, e, w] = ids.map(i => bound.rig.points[i]!.pos);
    const u = normalize(sub(e!, s!)), fore = sub(w!, e!);
    const flex = normalize(sub(fore, scale(u, dot(fore, u))));
    const normal = normalize(cross(u, flex));
    let rig = { ...bound.rig, restPose: bound.rig.restPose.map((p, i) => i === ids[2]
      ? add(p, scale(flex, -0.4)) : p) };
    for (let f = 0; f < 12; f++) {
      rig = stepRig(rig, 1 / 60, { gravity: [0, 0, 0], damping: 0.06, iterations: 4, restStiffness: 0.18 });
      expect(signedBend(rig, ids, normal)).toBeGreaterThanOrEqual(-1e-7);
    }
  });

  it('keeps the allowed side after a live body turn and translation', () => {
    const body = zombie(), bound = bindRig(body);
    const ids = joints(body, bound.rig, 'r');
    const yaw = Math.PI, offset: Vec3 = [4, 0, -3];
    const world = (p: Vec3) => add(rotateYaw(p, yaw), offset);
    bound.rig = { ...bound.rig, bodyYaw: yaw,
      restPose: bound.rig.restPose.map(world),
      points: bound.rig.points.map(p => ({ ...p, pos: world(p.pos), prev: world(p.prev) })) };
    const [s, e, w] = ids.map(i => bound.rig.points[i]!.pos);
    const u = normalize(sub(e!, s!)), fore = sub(w!, e!);
    const flex = normalize(sub(fore, scale(u, dot(fore, u))));
    const hit = impulseAt(bound, w!, scale(flex, -0.18));
    expect(signedBend(hit.rig, ids, normalize(cross(u, flex)))).toBeGreaterThanOrEqual(-1e-8);
    const v = sub(hit.rig.points[ids[2]!]!.pos, hit.rig.points[ids[2]!]!.prev);
    expect(dot(v, flex)).toBeGreaterThanOrEqual(-1e-8);
  });

  it('respects a pinned wrist and preserves allowed tangential velocity', () => {
    const rig = makeRig([{pos: [0, 1, 0], pinned: true},
      {pos: [0, 0.7, 0], pinned: false}, {pos: [0, 0.4, -0.1], pinned: false}], []);
    rig.bends = [{root: 0, mid: 1, end: 2, restUpper: [0, -1, 0], restPole: [0, 0, 1]}];
    rig.points[2]!.prev = [-0.02, 0.4, 0];
    const solved = constrainRigBends(rig);
    const velocity = sub(solved.points[2]!.pos, solved.points[2]!.prev);
    expect(velocity[0]).toBeCloseTo(0.02, 8);
    expect(velocity[2]).toBeGreaterThanOrEqual(-1e-8);
    rig.points[2]!.pinned = true;
    expect(constrainRigBends(rig).points[2]).toEqual(rig.points[2]);
  });

  it('cannot undo floor contact when stopping a collapsed arm', () => {
    const rig = makeRig([{pos: [-1, 1, 0], pinned: false},
      {pos: [0, 0.1, 0], pinned: false}, {pos: [1, 0, 0], pinned: false}], []);
    rig.bends = [{root: 0, mid: 1, end: 2,
      restUpper: normalize([1, -0.9, 0]), restPole: normalize([-0.9, -1, 0])}];
    const solved = constrainRigBends(rig, 0);
    expect(solved.points[2]!.pos[1]).toBeGreaterThanOrEqual(0);
    const fore = sub(solved.points[2]!.pos, solved.points[1]!.pos);
    expect(len(fore)).toBeCloseTo(Math.sqrt(1.01), 8);
    expect(dot(fore, rig.bends[0]!.restPole)).toBeGreaterThanOrEqual(-1e-8);
  });

  it('does not constrain an elbow whose forearm has already detached', () => {
    const body = zombie();
    const firstFore = body.prims.findIndex(p => p.bone === 'foreArm.l');
    const severed = severDistal(body, { limb: 'armL', fromPrim: firstFore }).body;
    const bound = bindRig(severed);
    const ids = joints(severed, bound.rig, 'l');
    const [s, e, w] = ids.map(i => bound.rig.points[i]!.pos);
    const u = normalize(sub(e!, s!)), fore = sub(w!, e!);
    const flex = normalize(sub(fore, scale(u, dot(fore, u))));
    const delta = scale(flex, -0.18);
    expect(impulseAt(bound, w!, delta).rig.points[ids[2]!]!.pos).toEqual(add(w!, delta));
  });
});
