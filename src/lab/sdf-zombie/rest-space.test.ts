// src/lab/sdf-zombie/rest-space.test.ts
//
// THE pose-invariance pin for the rest-space noise anchor (motion-polish
// task 6). The owner playtest: "you can see the arms move but the texture
// doesn't" — the fbm sampled a world-frame field, so flesh slid through the
// noise on every gait bob, arm raise and jiggle. The fix samples the fbm in
// the DOMINANT prim's REST frame, which makes this true:
//
//   the SAME material point reads the SAME noise value in EVERY pose.
//
// These tests assert exactly that against the CPU mirror (validate.ts's
// restSpacePoint/surfaceNoise — the exact twins of restPoint/fbm in
// march.wgsl.ts), plus the counterfactual that the OLD world-frame sampling
// really did swim (so the pin cannot pass vacuously).

import { describe, it, expect } from 'vitest';
import { buildBody, DEFAULT_BUILD_OPTS, type BuildResult } from './build-body';
import { makeZombie } from './body';
import { DEFAULT_FACE } from './face';
import { fbm, restSpacePoint, surfaceNoise } from './validate';
import type { Primitive, Vec3 } from './types';
import type { Quat } from './vec';
import {
  add, cross, dot, len, normalize, qFromAxisAngle, qMul, qNormalize, qRotate,
  scale as vscale, sub,
} from './vec';

const rest = buildBody(makeZombie({ ...DEFAULT_FACE }), DEFAULT_BUILD_OPTS);

/** Rigidly transform one cluster's prims — the shape applyRig's output has. */
function poseCluster(body: BuildResult, limb: string, pivot: Vec3, q: Quat, shift: Vec3): BuildResult {
  const c = body.clusters.find(x => x.limb === limb)!;
  const rot = (v: Vec3): Vec3 => add(add(qRotate(q, sub(v, pivot)), pivot), shift);
  return {
    ...body,
    prims: body.prims.map((p, i) =>
      i >= c.start && i < c.start + c.count ? { ...p, a: rot(p.a), b: rot(p.b) } : p),
  };
}

/** The armL cluster's longest capsule — the forearm. */
function forearm(body: BuildResult): { idx: number; prim: Primitive } {
  const c = body.clusters.find(x => x.limb === 'armL')!;
  let idx = c.start;
  let best = -1;
  for (let i = c.start; i < c.start + c.count; i++) {
    const l = len(sub(body.prims[i]!.b, body.prims[i]!.a));
    if (l > best) { best = l; idx = i; }
  }
  return { idx, prim: body.prims[idx]! };
}

/** A material point on the forearm's surface, offset perpendicular to its axis. */
function materialPoint(prim: Primitive): Vec3 {
  const axis = sub(prim.b, prim.a);
  const mid = vscale(add(prim.a, prim.b), 0.5);
  let perp = cross(axis, [0, 0, 1]);
  if (len(perp) < 1e-6) perp = cross(axis, [0, 1, 0]);
  return add(mid, vscale(normalize(perp), prim.radius));
}

describe('rest-space noise anchor — pose invariance (the whole feature)', () => {
  const { prim } = forearm(rest);
  const axis = sub(prim.b, prim.a);
  const mid = vscale(add(prim.a, prim.b), 0.5);
  const mRest = materialPoint(prim);
  // The swing axis is PERPENDICULAR to the forearm, so raising/lowering the
  // arm is a pure shortest-arc swing with no roll component — the rest-frame
  // mapping is then an exact inverse (the roll caveat below covers why this
  // matters).
  const perp0 = cross(axis, [0, 0, 1]);
  const swingAxis = normalize(len(perp0) < 1e-6 ? cross(axis, [1, 0, 0]) : perp0);
  const shoulder = prim.a; // swing the whole arm cluster about the shoulder

  const RAISED = qFromAxisAngle(swingAxis, 0.6);   // ~34°
  const LOWERED = qFromAxisAngle(swingAxis, -0.4); // ~-23°
  const poseRaised = poseCluster(rest, 'armL', shoulder, RAISED, [0.3, 0, -0.2]);
  const poseLowered = poseCluster(rest, 'armL', shoulder, LOWERED, [-0.1, 0, 0.4]);

  // The same material point, carried by each pose's rigid transform.
  const carry = (pivot: Vec3, q: Quat, shift: Vec3) =>
    add(add(qRotate(q, sub(mRest, pivot)), pivot), shift);
  const mRaised = carry(shoulder, RAISED, [0.3, 0, -0.2]);
  const mLowered = carry(shoulder, LOWERED, [-0.1, 0, 0.4]);

  it('maps the same material point back to the same rest point in both poses', () => {
    const backRaised = restSpacePoint(mRaised, poseRaised, rest);
    const backLowered = restSpacePoint(mLowered, poseLowered, rest);
    for (let k = 0; k < 3; k++) {
      expect(backRaised[k]!).toBeCloseTo(mRest[k]!, 6);
      expect(backLowered[k]!).toBeCloseTo(mRest[k]!, 6);
    }
  });

  it('reads IDENTICAL noise at that point across poses — the regression pin', () => {
    const nRest = surfaceNoise(mRest, rest, rest);
    const nRaised = surfaceNoise(mRaised, poseRaised, rest);
    const nLowered = surfaceNoise(mLowered, poseLowered, rest);
    expect(nRaised).toBeCloseTo(nRest, 6);
    expect(nLowered).toBeCloseTo(nRest, 6);
    expect(nRaised).toBeCloseTo(nLowered, 6);
  });

  it('the OLD world-frame sampling swam — the counterfactual this fix kills', () => {
    // Sampled at the raw world point (the pre-task-6 behaviour at zero root
    // shift), the same material point reads DIFFERENT noise in the two
    // poses. If this ever passes vacuously (poses too small to matter), the
    // pin above proves nothing.
    const oldRaised = fbm(vscale(mRaised, 3));
    const oldLowered = fbm(vscale(mLowered, 3));
    expect(Math.abs(oldRaised - oldLowered)).toBeGreaterThan(1e-3);
  });

  it('is invariant under root translation exactly (the gait-bob case)', () => {
    const walked = poseCluster(rest, 'armL', shoulder, [0, 0, 0, 1], [1.7, 0.02, -0.9]);
    const mWalked = add(mRest, [1.7, 0.02, -0.9]);
    expect(surfaceNoise(mWalked, walked, rest)).toBeCloseTo(surfaceNoise(mRest, rest, rest), 6);
  });

  it('frame-derived points stay pinned even through a rolled pose (documented caveat)', () => {
    // A general rigid pose includes ROLL about the capsule axis, which the
    // shortest-arc swing does not track — the anchor picks a consistent but
    // arbitrary roll (accepted: the noise is statistical). What must still
    // hold is SELF-CONSISTENCY: a material point derived FORWARD through the
    // prim's frame maps back to the identical rest point in any pose, so the
    // texture is glued to the flesh (never to the world) everywhere.
    const rollPose = qNormalize(qMul(qFromAxisAngle(axis, 0.9), RAISED));
    const posed = poseCluster(rest, 'armL', shoulder, rollPose, [0.2, 0, 0.1]);
    // Derive the posed point the way the shader will map it back: midpoint
    // translation + shortest-arc axis swing (the forward twin of restPoint).
    const pp = posed.prims[rest.prims.indexOf(prim)]!;
    const axP = normalize(sub(pp.b, pp.a));
    const axR = normalize(sub(prim.b, prim.a));
    const d = Math.max(-1, Math.min(1, dot(axR, axP)));
    const cr = cross(axR, axP);
    const swing = qNormalize([cr[0], cr[1], cr[2], 1 + d]);
    const midP = vscale(add(pp.a, pp.b), 0.5);
    const mPosed = add(midP, qRotate(swing, sub(mRest, mid)));
    const back = restSpacePoint(mPosed, posed, rest);
    for (let k = 0; k < 3; k++) expect(back[k]!).toBeCloseTo(mRest[k]!, 5);
    expect(surfaceNoise(mPosed, posed, rest)).toBeCloseTo(surfaceNoise(mRest, rest, rest), 5);
  });
});

describe('rest-space anchor — oriented prims use the exact frame', () => {
  // The skull case: applyRig rotates a face prim's endpoints by the rigid
  // head quat AND stamps it as orient. The conjugate-orient frame is then
  // EXACT (the axis swing is the identity), including roll — a turned head
  // keeps its skin without any ambiguity.
  const capsule: Primitive = {
    a: [0, 0, 0], b: [0, 0.3, 0], radius: 0.08,
    scale: [1, 1, 1], blendK: 0.02, limb: 'head', cluster: 0,
  };
  const mini = {
    prims: [capsule],
    clusters: [{
      id: 0, limb: 'head' as const, start: 0, count: 1,
      center: [0, 0.15, 0] as Vec3, radius: 0.5, alive: true,
    }],
  };
  const O = qFromAxisAngle(normalize([1, 1, 0.4]), 0.9); // swing AND roll
  const mid = vscale(add(capsule.a, capsule.b), 0.5);
  const shift: Vec3 = [0.05, 0.02, -0.03];
  const posedPrim: Primitive = {
    ...capsule,
    a: add(add(qRotate(O, sub(capsule.a, mid)), mid), shift),
    b: add(add(qRotate(O, sub(capsule.b, mid)), mid), shift),
    orient: O,
  };
  const posedMini = { prims: [posedPrim], clusters: mini.clusters };

  it('recovers the exact rest point through an arbitrary rigid head turn', () => {
    // A point at a known offset from the capsule — deliberately off-axis, so
    // only an exact (roll-aware) frame can recover it.
    const off: Vec3 = [0.06, 0.01, -0.04];
    const mRest = add(mid, off);
    const mPosed = add(add(qRotate(O, sub(mRest, mid)), mid), shift);
    const back = restSpacePoint(mPosed, posedMini, mini);
    for (let k = 0; k < 3; k++) expect(back[k]!).toBeCloseTo(mRest[k]!, 6);
    expect(surfaceNoise(mPosed, posedMini, mini)).toBeCloseTo(surfaceNoise(mRest, mini, mini), 6);
  });

  it('falls back to p when no prim is live (gibbed corpse)', () => {
    const dead = {
      prims: [{ ...capsule, dead: true }],
      clusters: mini.clusters,
    };
    const p: Vec3 = [0.3, 0.4, 0.5];
    expect(restSpacePoint(p, dead, mini)).toEqual(p);
  });
});
