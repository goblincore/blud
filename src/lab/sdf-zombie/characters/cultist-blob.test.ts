// src/lab/sdf-zombie/characters/cultist-blob.test.ts
//
// Pins the cultist's DESIGN INTENT and the SDF-cloth machinery the spike
// added for him (2026-09-23). No reference mesh — the brief was prose ("a
// cloaked zombie figure, basically like the cultists in Blood") — so these
// are STRUCTURAL PINS, each naming a decision from the .blob header:
//
//   * the costume is SHELLS: skirt, capelet, hood, two bell cuffs;
//   * the hood rides the rigid head, and its face opening turns with it;
//   * the skirt rides the `hem` pendulum as ONE piece (`rigid`), not an ankle;
//   * the pendulum SWINGS under the real motion pipeline and never becomes
//     the rig's floor pin;
//   * wind (rig clothForce) pushes the hem downwind and touches no joint.
//
// What this file cannot check is whether he reads as a cultist, or whether
// the swing reads as cloth. That took frames and GIFs
// (docs/dev-notes/2026-09-23-cultist/).
import { describe, it, expect } from 'vitest';
import src from './cultist.blob?raw';
import { parseBlob } from '../blob-parse';
import { compileBlob, compileFace } from '../blob-compile';
import { buildBody } from '../build-body';
import { fusedOf } from '../blob-checks';
import { characterEntry } from '../character-registry';
import { bindRig, applyRig, HEM_REST_SCALE } from '../rig-bind';
import { stepRig } from '../rig';
import { makeActorMotion, stepActorMotion, emptyActorSignals } from '../actor';
import { motionProfileFor } from '../motion-profile';
import { makeRng } from '../wander';
import { dot, len, sub } from '../vec';
import type { Vec3 } from '../types';

const doc = parseBlob(src);
const built = () => buildBody(compileBlob(doc, compileFace(doc)));
const body = built();
const shells = () => body.prims.map((p, i) => ({ p, i })).filter(({ p }) => p.shell);
const skirtIndex = body.prims.findIndex(p => p.shell && p.bone === 'hem');
const tiltDeg = (a: Vec3, b: Vec3) => {
  const d = sub(b, a);
  return Math.acos(-d[1] / len(d)) * 180 / Math.PI;
};

describe('cultist — build', () => {
  it('compiles clean and is registered', () => {
    expect(body.errors).toEqual([]);
    expect(characterEntry('cultist').name).toBe('cultist');
  });

  it('is dressed in SHELLS: skirt, capelet, hood and a mirrored pair of cuffs', () => {
    const s = shells().map(({ p }) => `${p.limb}:${p.bone}`).sort();
    expect(s).toEqual(['armL:foreArm.l', 'armR:foreArm.r', 'head:skull', 'torso:hem', 'torso:spine']);
  });

  it('has exactly two glowing eyes', () => {
    expect(body.prims.filter(p => (p.glow ?? 0) > 0)).toHaveLength(2);
  });

  it('is one body — arms and legs fuse to the torso', () => {
    const limb = (l: string) => body.clusters.find(c => c.limb === l)!;
    for (const l of ['armL', 'armR', 'legL', 'legR', 'head'])
      expect(fusedOf(body, limb(l), limb('torso')), l).toBeLessThan(0);
  });

  it('the skirt reaches the boots: hem below the shins, above the floor pin', () => {
    const skirt = body.prims[skirtIndex]!;
    const hemY = -skirt.shell!.clipOffset; // clip=(0,-1,0): keeps y > -clipd
    const shinTop = Math.min(...body.prims.filter(p => p.bone?.startsWith('shin')).map(p => Math.min(p.a[1], p.b[1])));
    expect(hemY).toBeLessThan(shinTop + 0.1);
    expect(hemY).toBeGreaterThan(0.15);
  });
});

describe('cultist — rigging the cloth', () => {
  const bound = bindRig(body);
  const hem = body.bones.get('hem')!;
  const pointAt = (p: Vec3) => bound.rig.points.findIndex(q => len(sub(q.pos, p)) < 1e-4);

  it('the hood rides the rigid head (so the face stays in the opening)', () => {
    const hood = body.prims.findIndex(p => p.shell && p.limb === 'head');
    expect(bound.head!.prims.has(hood)).toBe(true);
  });

  it('`rigid`: BOTH skirt ends bind to the hem bone head, not the nearest joint (an ankle)', () => {
    const b = bound.binding[skirtIndex]!;
    expect(b.a.point).toBe(pointAt(hem.head));
    expect(b.b.point).toBe(pointAt(hem.head));
    expect(b.armFrame?.tail).toBe(pointAt(hem.tail));
  });

  it('the hem pendulum point is loose and is NOT the floor pin', () => {
    const i = pointAt(hem.tail);
    expect(bound.rig.restScale![i]).toBe(HEM_REST_SCALE);
    expect(bound.rig.points[i]!.pinned).toBe(false);
    expect(bound.rig.restScale!.filter(k => k !== 1)).toHaveLength(1);
  });

  it('the face opening turns with the head: the hood clip normal follows a 90 degree body yaw', () => {
    const hood = body.prims.findIndex(p => p.shell && p.limb === 'head');
    const n0 = body.prims[hood]!.shell!.clipNormal;
    const n1 = applyRig(body, bound, Math.PI / 2).prims[hood]!.shell!.clipNormal;
    // Rest opening faces +z; a +90 degree yaw faces +x (gait.ts rotateYaw).
    expect(n0[2]).toBeGreaterThan(0.9);
    expect(n1[0]).toBeGreaterThan(0.9);
    expect(Math.abs(n1[2])).toBeLessThan(0.05);
  });
});

describe('cultist — the hem swings', () => {
  it('walking through the real motion pipeline swings the skirt, and the knees stay (all but) inside it', () => {
    const m = makeActorMotion(body, { seed: 11 });
    expect(m.motionJoints, 'the hem joint must not cost him his motion joints').not.toBeNull();
    expect(m.motionJoints!.names).toContain('hem');
    const rng = makeRng(11);
    const profile = motionProfileFor('cultist');
    const tilts: number[] = [];
    let worst = 0;
    const J = m.motionJoints!.index;
    for (let i = 0; i < 360; i++) {
      stepActorMotion(m, {
        current: body, dt: 1 / 60, wander: true, armStyle: undefined,
        headingFollow: 1, gazeFollow: 1, bounds: { minX: -50, maxX: 50, minZ: -50, maxZ: 50 },
        rng, signals: emptyActorSignals(), profile, forceSpeed: profile.cruise,
      });
      if (i < 60) continue;
      const posed = applyRig(body, m.bound, m.lastBodyYaw);
      const skirt = posed.prims[skirtIndex]!;
      tilts.push(tiltDeg(skirt.a, skirt.b));
      // A knee's horizontal distance from the skirt axis against the cone's
      // radius at that height (linear r -> r2 along the axis).
      for (const k of [J.kneeL!, J.kneeR!]) {
        const q = m.bound.rig.points[k]!.pos;
        const ax = sub(skirt.b, skirt.a), t = dot(sub(q, skirt.a), ax) / dot(ax, ax);
        const onAxis: Vec3 = [skirt.a[0] + ax[0] * t, skirt.a[1] + ax[1] * t, skirt.a[2] + ax[2] * t];
        const rB = skirt.radiusB ?? skirt.radius;
        const r = (skirt.radius + (rB - skirt.radius) * t) * Math.min(skirt.scale[0], skirt.scale[2]);
        worst = Math.max(worst, len(sub(q, onAxis)) - r);
      }
    }
    const swing = Math.max(...tilts) - Math.min(...tilts);
    expect(swing, 'the skirt tilt range while walking, degrees').toBeGreaterThan(1.5);
    expect(Math.max(...tilts), 'but it never flies out').toBeLessThan(25);
    // The knee JOINT may graze the cone by a couple of centimetres at the
    // front of a stride: the robe-painted thigh then shows as a cloth bulge,
    // which is the read we want. The SHAMBLE put it 13.7 cm out (a leg through
    // the cloth); GLIDE plus a deeper skirt brought it to 1.7 cm.
    expect(worst, 'worst knee excursion past the skirt cone, metres').toBeLessThan(0.03);
  });

  it('wind (clothForce) pushes the hem downwind and moves no joint', () => {
    const bound = bindRig(body);
    const opts = { gravity: [0, -2.2, 0] as Vec3, damping: 0.06, iterations: 4, restStiffness: 0.18 };
    let calm = bound.rig, windy = { ...bound.rig, clothForce: [8, 0, 0] as Vec3 };
    for (let i = 0; i < 180; i++) {
      calm = stepRig(calm, 1 / 60, opts);
      windy = { ...stepRig(windy, 1 / 60, opts), clothForce: windy.clothForce };
    }
    const hemI = bound.rig.restScale!.findIndex(k => k !== 1);
    const dx = windy.points[hemI]!.pos[0] - calm.points[hemI]!.pos[0];
    expect(dx, 'hem moved downwind, metres').toBeGreaterThan(0.03);
    for (let i = 0; i < calm.points.length; i++) {
      if (i === hemI) continue;
      expect(len(sub(windy.points[i]!.pos, calm.points[i]!.pos)), `point ${i}`).toBeLessThan(0.01);
    }
  });
});
