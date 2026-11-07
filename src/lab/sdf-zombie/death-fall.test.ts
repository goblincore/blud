// src/lab/sdf-zombie/death-fall.test.ts
import { describe, expect, it } from 'vitest';
import { buildBody } from './build-body';
import { makeZombie } from './body';
import { DEFAULT_FACE } from './face';
import { bindRig } from './rig-bind';
import { makeMotionJoints } from './motion';
import { canDeathFall, CORPSE_LOOSE_SEC, CORPSE_SLACK_M, corpseHoldStep, DEATH_FALL, DEATH_FALL_KINDS, FALLS, deathFallPose, deathFallPull, fallLength, pickDeathFall, SETTLE_SEC, type DeathFallChoice, type DeathFallKind } from './death-fall';
import { makeRng } from './wander';
import type { Vec3 } from './types';

const body = buildBody(makeZombie({ ...DEFAULT_FACE }), undefined!, undefined!);
const j = makeMotionJoints(body, bindRig(body).rig.restPose)!;
const at = (name: string, pose: readonly Vec3[]) => pose[j.names.indexOf(name as never)]!;
// Facing +Z (yaw 0), shot from the front: the shot travels -Z.
const frame = (impact: Vec3 = [0, 0, -1]) => ({
  base: j.base, names: j.names, start: j.base, pivot: [j.pelvis[0], 0, j.pelvis[2]] as Vec3, shift: [0, 0, 0] as Vec3,
  yaw: 0, floor: 0, impact,
});
const end = (kind: DeathFallKind, impact?: Vec3) => deathFallPose({ kind, strength: 1, side: 1 }, frame(impact), fallLength(kind) + 0.5);

describe('deathFallPose', () => {
  it('the zombie can play the falls', () => expect(canDeathFall(j.names)).toBe(true));

  it('starts from the pose he died in', () => {
    const p = deathFallPose({ kind: 'crumple', strength: 1, side: 1 }, frame(), 0);
    p.forEach((q, i) => q.forEach((v, c) => expect(v).toBeCloseTo(j.base[i]![c]!, 6)));
  });

  it.each(DEATH_FALL_KINDS)('%s ends lying on the floor, nothing under it', kind => {
    const p = end(kind);
    expect(at('chest', p)[1]).toBeLessThan(0.3);
    expect(at('head', p)[1]).toBeLessThan(0.35);
    for (const q of p) expect(q[1]).toBeGreaterThan(-0.02);
  });

  it('blown and backward land face up and along the shot; crumple face down toward the shooter', () => {
    const faceUp = (p: Vec3[]) => at('toeL', p)[1] - at('footL', p)[1];
    for (const kind of ['blown', 'backward'] as const) {
      const p = end(kind);
      expect(at('head', p)[2]).toBeLessThan(at('pelvis', p)[2]);   // head away from the shooter
    }
    const c = end('crumple');
    expect(at('head', c)[2]).toBeGreaterThan(at('pelvis', c)[2]);   // head toward the shooter
    expect(faceUp(end('blown'))).toBeGreaterThan(faceUp(c));
  });

  it('blown travels far and leaves the floor; a crumple stays put', () => {
    const mid = deathFallPose({ kind: 'blown', strength: 1, side: 1 }, frame(), 0.3);
    expect(Math.min(...mid.map(q => q[1]))).toBeGreaterThan(0.1);
    expect(-at('pelvis', end('blown'))[2]).toBeGreaterThan(1.2);
    expect(Math.abs(at('pelvis', end('crumple'))[2])).toBeLessThan(0.6);
  });

  it('follows the shot direction', () => {
    const p = end('blown', [1, 0, 0]);
    expect(at('pelvis', p)[0]).toBeGreaterThan(1.2);
  });
});

describe('the drape', () => {
  it.each(DEATH_FALL_KINDS)('%s: once settled every hand, elbow, knee and foot lies on the floor', kind => {
    const p = deathFallPose({ kind, strength: 1, side: 1 }, frame(), fallLength(kind) + SETTLE_SEC);
    for (const n of ['handL', 'handR', 'elbowL', 'elbowR', 'kneeL', 'kneeR', 'footL', 'footR']) expect(at(n, p)[1]).toBeLessThan(0.08);
    expect(at('head', p)[1]).toBeLessThan(0.15);
  });

  it('drapes the limbs onto limbFloor, leaving the trunk where its key grounded it', () => {
    const f = { ...frame(), floor: -0.13, limbFloor: 0 };
    const p = deathFallPose({ kind: 'backward', strength: 1, side: 1 }, f, fallLength('backward') + 1);
    const plain = deathFallPose({ kind: 'backward', strength: 1, side: 1 }, frame(), fallLength('backward') + 1);
    expect(at('handL', p)[1]).toBeCloseTo(0.05, 6);
    expect(at('chest', p)[1]).toBeCloseTo(at('chest', plain)[1] - 0.13, 6);
  });
});

describe('corpseHoldStep', () => {
  const choice: DeathFallChoice = { kind: 'backward', strength: 1, side: 1 };
  const settled = fallLength('backward') + SETTLE_SEC;
  const lying = end('backward');
  const moved = (by: Vec3) => lying.map(q => [q[0] + by[0], q[1] + by[1], q[2] + by[2]] as Vec3);

  it('plays the authored fall until it has landed', () => {
    expect(corpseHoldStep(choice, fallLength('backward') - 0.01, undefined, true, 1 / 60, lying, lying, j.names)).toBeNull();
  });

  it('re-anchors where it lies once settled, and holds that shape', () => {
    const here = moved([0.05, 0, 0]);
    const same = (p: readonly Vec3[]) => p.forEach((q, i) => q.forEach((v, c) => expect(v).toBeCloseTo(here[i]![c]!, 6)));
    const a = corpseHoldStep(choice, settled, undefined, false, 1 / 60, here, lying, j.names)!;
    same(a.targets!);
    const b = corpseHoldStep(choice, settled + 1, a.hold, false, 1 / 60, lying, lying, j.names)!;
    same(b.targets!);
  });

  it('a hit lets the limbs move within the slack, then re-anchors where the body ended (no spring back)', () => {
    const rest = corpseHoldStep(choice, settled, undefined, false, 1 / 60, lying, lying, j.names)!.hold;
    const shoved = lying.map((q, i) => (j.names[i] === 'handL' ? [q[0] + 1, q[1], q[2]] : [q[0] + 0.1, q[1], q[2]]) as Vec3);
    const hit = corpseHoldStep(choice, settled + 1, rest, true, 1 / 60, shoved, lying, j.names)!;
    expect(hit.hold.loose).toBe(CORPSE_LOOSE_SEC);
    // A joint inside the slack is left where it is; the hand past it is caught at the slack's edge.
    expect(at('elbowL', hit.targets!)).toEqual(at('elbowL', shoved));
    expect(at('handL', hit.targets!)[0] - at('handL', lying)[0]).toBeCloseTo(CORPSE_SLACK_M, 6);
    let hold = hit.hold, last = hit;
    for (let t = 0; hold.loose > 0; t += 0.05) { last = corpseHoldStep(choice, settled + 1 + t, hold, false, 0.05, shoved, lying, j.names)!; hold = last.hold; }
    expect(at('pelvis', last.targets!)[0]).toBeCloseTo(at('pelvis', shoved)[0], 6);
  });

  it('the trunk slides as one piece: a hit cannot fold the hips past the pelvis', () => {
    const rest = corpseHoldStep(choice, settled, undefined, false, 1 / 60, lying, lying, j.names)!.hold;
    // Hips pushed through the pelvis toward the legs (the orb's fold).
    const pel = at('pelvis', lying), hips = at('hips', lying);
    const folded = lying.map((q, i) => (j.names[i] === 'hips' ? [2 * pel[0] - hips[0], hips[1], 2 * pel[2] - hips[2]] : q) as Vec3);
    const r = corpseHoldStep(choice, settled + 1, rest, true, 1 / 60, folded, lying, j.names)!;
    const along = (p: readonly Vec3[]) => {
      const c = at('chest', p), pe = at('pelvis', p), h = at('hips', p);
      return (h[0] - pe[0]) * (c[0] - pe[0]) + (h[2] - pe[2]) * (c[2] - pe[2]);
    };
    expect(along(folded)).toBeLessThan(0);
    expect(along(r.targets!)).toBeGreaterThan(0);
  });
});

describe('deathFallPull', () => {
  it('holds the pose through the fall, then eases to the settle pull', () => {
    expect(deathFallPull('sit', 0.2)).toBe(DEATH_FALL.pull);
    expect(deathFallPull('sit', fallLength('sit') + 5)).toBeCloseTo(DEATH_FALL.settle, 9);
  });
});

describe('pickDeathFall', () => {
  it('a blow-away throw always plays blown; otherwise every non-blown fall turns up', () => {
    const rng = makeRng(5);
    expect(pickDeathFall({ blown: 1, struck: 'body' }, rng).kind).toBe('blown');
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) seen.add(pickDeathFall({ blown: null, struck: 'body' }, rng).kind);
    expect([...seen].sort()).toEqual(['backward', 'crumple', 'sit', 'spin']);
  });
  it('a leg volley never rocks him straight back', () => {
    const rng = makeRng(9);
    for (let i = 0; i < 100; i++) expect(pickDeathFall({ blown: null, struck: 'legs' }, rng).kind).not.toBe('backward');
  });
});

describe('the keys respect the joints', () => {
  it('no key bends a knee or an elbow backwards (the rig would fight it forever)', () => {
    for (const kind of DEATH_FALL_KINDS) for (const key of FALLS[kind].keys) {
      for (const leg of [key.legNear, key.legFar]) expect(leg[1]).toBeGreaterThanOrEqual(leg[0]);
      for (const arm of [key.armNear, key.armFar]) expect(arm[1]).toBeLessThanOrEqual(arm[0]);
    }
  });
});
