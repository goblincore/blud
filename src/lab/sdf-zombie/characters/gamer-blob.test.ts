// gamer.blob — the chair's boss variant: a swollen man fused into a gaming chair, both hands on a joystick of flesh
// out of his navel. What this pins: it builds and fuses, it is BIGGER than the chair (the boss), it walks on all four
// feet through the real motion pipeline, and his hands stay ON THE STICK while it walks (they are `rigid` on the
// chest with the grip; nothing in the arm IK reaches them, because the rig's arms are the front legs).
import { describe, it, expect } from 'vitest';
import src from './gamer.blob?raw';
import chairSrc from './chair.blob?raw';
import { parseBlob } from '../blob-parse';
import { compileBlob, compileFace } from '../blob-compile';
import { buildBody } from '../build-body';
import { characterEntry } from '../character-registry';
import { makeActorMotion, stepActorMotion, emptyActorSignals } from '../actor';
import { makeRng } from '../wander';
import { applyRig } from '../rig-bind';
import type { Vec3 } from '../types';

const build = (s: string) => { const d = parseBlob(s); return buildBody(compileBlob(d, compileFace(d))); };
const body = build(src);
const chair = build(chairSrc);

describe('gamer — the chair boss, plugged in', () => {
  it('builds clean, feet on the floor, a third bigger than the chair', () => {
    expect(body.errors).toEqual([]);
    expect(body.bones.get('hand.l')!.tail[1]).toBeLessThan(0.03);
    expect(body.bones.get('foot.l')!.tail[1]).toBeLessThan(0.03);
    const top = (b: typeof body) => b.bones.get('skull')!.tail[1];
    expect(top(body) / top(chair)).toBeGreaterThan(1.25);
  });

  it('walks on four feet with both hands on the stick', () => {
    const m = makeActorMotion(body, { seed: 5 });
    expect(m.motionJoints, 'every rig point must map to a gait joint').not.toBeNull();
    const J = m.motionJoints!.index;
    const profile = characterEntry('gamer').profile;
    const rng = makeRng(5);
    const lifts: Record<string, number> = { handL: 0, handR: 0, footL: 0, footR: 0 };
    const low: Record<string, number> = {};
    for (let i = 0; i < 360; i++) {
      stepActorMotion(m, {
        current: body, dt: 1 / 60, wander: true, armStyle: undefined,
        headingFollow: 1, gazeFollow: 1, bounds: { minX: -50, maxX: 50, minZ: -50, maxZ: 50 },
        rng, signals: emptyActorSignals(), profile, forceSpeed: profile.cruise,
      });
      const P = (k: number) => m.bound.rig.points[k]!.pos as Vec3;
      if (i < 90) { for (const n of Object.keys(lifts)) low[n] = Math.min(low[n] ?? Infinity, P(J[n as 'handL']!)[1]); continue; }
      for (const n of Object.keys(lifts)) lifts[n] = Math.max(lifts[n]!, P(J[n as 'handL']!)[1] - low[n]!);
    }
    for (const [n, lift] of Object.entries(lifts)) expect(lift, `${n} lifts`).toBeGreaterThan(0.04);

    // Measured on the POSED body after the walk: each hand (the prims at x +-0.058, z 0.585 in the rest body) stays
    // within a couple of millimetres of where it sits against the grip at rest. Rigid on the chest with the grip,
    // so the walk carries them together; the arm IK never reaches them (the rig's arms are the front legs).
    const posed = applyRig(body, m.bound, m.lastBodyYaw);
    const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    const isHand = (p: { a: Vec3; radius: number }) => Math.abs(Math.abs(p.a[0]) - 0.058) < 0.005 && Math.abs(p.a[2] - 0.585) < 0.005;
    const isGrip = (p: { a: Vec3; b: Vec3 }) => Math.abs(p.a[0]) < 1e-6 && Math.abs(p.a[2] - 0.585) < 0.005 && p.b[1] - p.a[1] > 0.1;
    const restHands = body.prims.map((p, i) => [p, i] as const).filter(([p]) => isHand(p));
    const g = body.prims.findIndex(isGrip);
    expect(restHands.length, 'two hands').toBe(2);
    expect(g, 'the grip').toBeGreaterThanOrEqual(0);
    for (const [p, i] of restHands) {
      const rest = dist(p.a, body.prims[g]!.a);
      const now = dist(posed.prims[i]!.a, posed.prims[g]!.a);
      expect(Math.abs(now - rest), 'hand stays on the grip').toBeLessThan(0.003);
    }
  });
});
