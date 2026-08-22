// src/lab/sdf-zombie/damage.test.ts
import { describe, it, expect } from 'vitest';
import { worldHitToWound, woundWorldPos, pushWound, MAX_WOUNDS, WOUND_PROFILES } from './damage';
import { rotateYaw } from './gait';
import type { Primitive, Vec3 } from './types';
import { add, len, qFromAxisAngle, qMul, qRotate, sub } from './vec';

const capsule = (a: [number, number, number], b: [number, number, number]): Primitive =>
  ({ a, b, radius: 0.1, scale: [1, 1, 1], blendK: 0.05, limb: 'armL', cluster: 2 });

const sphere = (c: Vec3): Primitive =>
  ({ a: c, b: c, radius: 0.14, scale: [1, 1, 1], blendK: 0.02, limb: 'torso', cluster: 1 });

/** Rigid body turn: rotate p by `yaw` about the root pivot's vertical axis —
 *  the same transform motion.ts's heading rotation puts every rest target
 *  (and so every posed prim endpoint) through. */
const rotAbout = (p: Vec3, pivot: Vec3, yaw: number): Vec3 =>
  add(pivot, rotateYaw(sub(p, pivot), yaw));

describe('worldHitToWound / woundWorldPos', () => {
  const prims = [capsule([0, 1, 0], [0, 1.4, 0]), capsule([1, 1, 0], [1, 1.4, 0])];

  it('binds the wound to the nearest primitive', () => {
    expect(worldHitToWound(prims, [0.95, 1.2, 0], 0.06, 'pellet').primIdx).toBe(1);
    expect(worldHitToWound(prims, [0.05, 1.2, 0], 0.06, 'pellet').primIdx).toBe(0);
  });

  it('round-trips the hit point back to the same world position', () => {
    const hit: [number, number, number] = [0.09, 1.2, 0.02];
    const w = worldHitToWound(prims, hit, 0.06, 'pellet');
    const back = woundWorldPos(prims, w);
    expect(len(sub(back, hit))).toBeCloseTo(0, 8);
  });

  it('follows its primitive when the body moves — the crater stays on the flesh', () => {
    const hit: [number, number, number] = [0.09, 1.2, 0.02];
    const w = worldHitToWound(prims, hit, 0.06, 'pellet');
    const offset: [number, number, number] = [0.5, -0.3, 0.2];
    const moved = [{ ...prims[0]!, a: add(prims[0]!.a, offset), b: add(prims[0]!.b, offset) }, prims[1]!];
    const back = woundWorldPos(moved, w);
    expect(len(sub(back, add(hit, offset)))).toBeCloseTo(0, 8);
  });

  it('follows its primitive when the limb rotates', () => {
    const hit: [number, number, number] = [0.09, 1.2, 0.0];
    const w = worldHitToWound(prims, hit, 0.06, 'pellet');
    // Rotate the capsule 90° about its own head, from +Y to +X.
    const rotated = [{ ...prims[0]!, b: [0.4, 1, 0] as const }, prims[1]!];
    const back = woundWorldPos(rotated as Primitive[], w);
    // Still the same distance from the capsule axis head.
    expect(len(sub(back, rotated[0]!.a))).toBeCloseTo(len(sub(hit, prims[0]!.a)), 6);
  });

  it('records the wound type and radius', () => {
    const w = worldHitToWound(prims, [0.09, 1.2, 0], 0.09, 'burn');
    expect(w.type).toBe('burn');
    expect(w.radius).toBe(0.09);
    expect(w.ageSec).toBe(0);
  });
});

describe('wounds ride the heading rotation (motion-polish regression)', () => {
  // Owner playtest: a wound stamped on the turning body stayed fixed
  // relative to the VIEWER — the wound frame was world-axis-locked for
  // sphere prims (no axis) and vertical capsules (degenerate basis). The
  // world mapping must go through the SAME yaw the heading rotation applies.
  const pivot: Vec3 = [0, 0.92, 0]; // the pelvis line the body turns about
  const YAW = Math.PI / 2;

  it('sphere prim (torso blob): a 90° turn carries the crater with the flesh', () => {
    const atRest = sphere([0.05, 1.25, 0.12]);
    const hit: Vec3 = [0.14, 1.3, 0.2];
    const w = worldHitToWound([atRest], hit, 0.05, 'pellet', 0);
    const turned = [sphere(rotAbout(atRest.a, pivot, YAW))];
    const back = woundWorldPos(turned, w, YAW);
    expect(len(sub(back, rotAbout(hit, pivot, YAW)))).toBeCloseTo(0, 8);
  });

  it('vertical capsule (thigh, degenerate axis basis): same 90° guarantee', () => {
    const atRest = capsule([0.1, 1.3, 0.02], [0.1, 0.9, 0.02]); // axis exactly ±y
    const hit: Vec3 = [0.16, 1.1, 0.08];
    const w = worldHitToWound([atRest], hit, 0.05, 'pellet', 0);
    const turned = [capsule(
      rotAbout(atRest.a as Vec3, pivot, YAW) as [number, number, number],
      rotAbout(atRest.b as Vec3, pivot, YAW) as [number, number, number],
    )];
    const back = woundWorldPos(turned, w, YAW);
    expect(len(sub(back, rotAbout(hit, pivot, YAW)))).toBeCloseTo(0, 8);
  });

  it('oriented prim (rigid head sphere): the crater rides the orient quat', () => {
    const neck: Vec3 = [0, 1.5, 0.1];
    const q1 = qFromAxisAngle([0, 1, 0], 0.3);
    const atRest: Primitive = { ...sphere(add(neck, [0, 0.1, 0.05])), orient: q1 };
    const hit: Vec3 = add(atRest.a, [0.06, 0.03, 0.02]);
    const w = worldHitToWound([atRest], hit, 0.05, 'pellet');
    // The head turns 90° more about the neck: origin swings, quat composes.
    const dq = qFromAxisAngle([0, 1, 0], YAW);
    const turned: Primitive = {
      ...atRest,
      a: add(neck, qRotate(dq, sub(atRest.a, neck))),
      b: add(neck, qRotate(dq, sub(atRest.b, neck))),
      orient: qMul(dq, q1),
    };
    const back = woundWorldPos([turned], w);
    expect(len(sub(back, add(neck, qRotate(dq, sub(hit, neck)))))).toBeCloseTo(0, 8);
  });

  it('round-trips exactly at a nonzero yaw (stamp frame === upload frame)', () => {
    const turned = [sphere(rotAbout([0.05, 1.25, 0.12], pivot, YAW))];
    const hit: Vec3 = [0.0, 1.28, 0.2];
    const w = worldHitToWound(turned, hit, 0.05, 'blast', YAW);
    expect(len(sub(woundWorldPos(turned, w, YAW), hit))).toBeCloseTo(0, 8);
  });
});

describe('a crater on a swaying near-vertical limb does not jump (flicker regression)', () => {
  // The thigh is exactly vertical at rest and the forearm is 6 degrees off;
  // under the walk both sway a few degrees in x AND z. The owner's recording
  // (flickerzombie.mov, 2026-08-22) showed craters snapping between positions
  // on the lower torso: a live probe measured 14 basis flips and 18.6 cm
  // single-frame jumps in 2.6 s for a thigh-bound wound. The crater must move
  // with the flesh it sits on — continuously.
  const pivot: Vec3 = [0, 0.92, 0];
  const YAW = Math.PI / 2;
  const swayed = (t: number): Primitive => {
    const ax = 0.03 * Math.sin(t), az = 0.03 * Math.cos(t * 1.3); // ~6 deg tilt, rotating
    return capsule([0.1, 1.3, 0.02], [0.1 + ax, 0.9, 0.02 + az]);
  };
  it('moves the crater by no more than the flesh moved, every step of the sway', () => {
    const hit: Vec3 = [0.16, 1.1, 0.08]; // on the outer-front surface
    const w = worldHitToWound([swayed(0)], hit, 0.13, 'blast', 0);
    let prev = woundWorldPos([swayed(0)], w, 0);
    let worst = 0;
    for (let i = 1; i <= 400; i++) {
      const t = i * 0.02;
      const pos = woundWorldPos([swayed(t)], w, 0);
      // The far end moves at most 0.03 m per unit of t; per 0.02 step the
      // flesh anywhere on the capsule moves under 1 mm.
      worst = Math.max(worst, len(sub(pos, prev)));
      prev = pos;
    }
    expect(worst).toBeLessThan(0.002);
  });
  it('still rides a rigid turn exactly while swaying (the de-yaw contract holds)', () => {
    const hit: Vec3 = [0.16, 1.1, 0.08];
    const w = worldHitToWound([swayed(0)], hit, 0.13, 'blast', 0);
    const p = swayed(0.7);
    const turned = [capsule(
      rotAbout(p.a as Vec3, pivot, YAW) as [number, number, number],
      rotAbout(p.b as Vec3, pivot, YAW) as [number, number, number],
    )];
    const expected = rotAbout(woundWorldPos([p], w, 0), pivot, YAW);
    expect(len(sub(woundWorldPos(turned, w, YAW), expected))).toBeCloseTo(0, 8);
  });
});

describe('binding picks the primitive whose SURFACE the hit is on', () => {
  // The zombie's forearms hang beside its torso. Nearest-ENDPOINT binding
  // put over half of all surface hits — the whole lower torso and both
  // flanks — on a forearm or thigh, so a crater on the belly swung with the
  // arm (live probe: 6 cm per frame) and flickered with the thigh basis. A
  // hit on the torso's skin must ride the torso.
  it('a flank hit next to a hanging forearm binds to the torso blob it sits on', () => {
    const torso = sphere([0, 1.0, 0]);                         // r 0.14: skin at x 0.14
    const forearm: Primitive = { ...capsule([0.20, 1.06, 0], [0.24, 0.70, 0]), radius: 0.05 };
    const hit: Vec3 = [0.135, 1.03, 0.03];                     // on the torso skin
    // Endpoint distances: forearm top 0.078 < torso centre 0.140 — the old rule
    // picked the forearm. Surface distances: torso ≈ 0, forearm +0.03 outside.
    expect(worldHitToWound([torso, forearm], hit, 0.13, 'blast').primIdx).toBe(0);
  });
  it('a hit on the forearm itself still binds to the forearm', () => {
    const torso = sphere([0, 1.0, 0]);
    const forearm: Primitive = { ...capsule([0.20, 1.06, 0], [0.24, 0.70, 0]), radius: 0.05 };
    const hit: Vec3 = [0.27, 0.90, 0.0];                       // outer surface of the forearm
    expect(worldHitToWound([torso, forearm], hit, 0.06, 'pellet').primIdx).toBe(1);
  });
});

describe('WOUND_PROFILES — per-type "weapon calibre" knobs', () => {
  it('covers all three wound types', () => {
    expect(Object.keys(WOUND_PROFILES).sort()).toEqual(['blast', 'burn', 'pellet']);
  });

  it('radii match the previous local RADIUS tables exactly', () => {
    // The lab-mains used to carry `const RADIUS = { pellet: 0.055, blast: 0.13,
    // burn: 0.08 }`. Drifting these silently retunes every wound pipeline term.
    expect(WOUND_PROFILES.pellet.radius).toBe(0.055);
    expect(WOUND_PROFILES.blast.radius).toBe(0.13);
    expect(WOUND_PROFILES.burn.radius).toBe(0.08);
  });

  it('tames the blast lip — the default splay welded the arm to the torso', () => {
    // Playtest 2026-08-16: at splay 1 the blast rim bridged the armpit gap.
    expect(WOUND_PROFILES.blast.rimSplayScale).toBeLessThan(1);
    expect(WOUND_PROFILES.blast.rimOffsetScale).toBeLessThanOrEqual(1);
  });

  it('scales are positive so the rim never inverts', () => {
    for (const p of Object.values(WOUND_PROFILES)) {
      expect(p.rimSplayScale).toBeGreaterThan(0);
      expect(p.rimOffsetScale).toBeGreaterThan(0);
    }
  });
});

describe('pushWound', () => {
  const w = (r: number) => worldHitToWound([capsule([0, 1, 0], [0, 1.4, 0])], [0.09, 1.2, 0], r, 'pellet');

  it('appends below capacity', () => {
    expect(pushWound([w(0.01), w(0.02)], w(0.03), MAX_WOUNDS)).toHaveLength(3);
  });

  it('evicts the oldest at capacity and keeps length fixed', () => {
    const full = Array.from({ length: MAX_WOUNDS }, (_, i) => w(i / 1000));
    const out = pushWound(full, w(0.99), MAX_WOUNDS);
    expect(out).toHaveLength(MAX_WOUNDS);
    expect(out[out.length - 1]!.radius).toBe(0.99);
    expect(out[0]!.radius).toBe(1 / 1000); // index 0 evicted
  });
});

it('never binds a wound to a carve', () => {
  const solid: Primitive = {
    a: [0, 0, 0], b: [0, 0, 0], radius: 0.2,
    scale: [1, 1, 1], blendK: 0.01, limb: 'head', cluster: 0,
  };
  // The carve is nearer the hit, so a naive nearest-primitive search picks it.
  const carve: Primitive = { ...solid, a: [0.5, 0, 0], b: [0.5, 0, 0], op: 'sub' };
  expect(worldHitToWound([solid, carve], [0.49, 0, 0], 0.05, 'pellet').primIdx).toBe(0);
});
