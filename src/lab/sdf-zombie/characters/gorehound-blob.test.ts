// gorehound.blob — the four-legged biomech hound on the biped rig.
//
// What this pins:
//   * the body builds clean and every rig point maps to a gait joint, so it
//     walks at all (makeMotionJoints non-null);
//   * the rest pose is a QUADRUPED: front paws and hind toes on the floor,
//     the elbow behind the shoulder-wrist line, the stifle ahead of the
//     hip-hock line;
//   * walking through the REAL motion pipeline (gait + both pairs of plants +
//     Verlet rig), all four feet lift in turn (a four-beat walk, not two
//     pairs), the elbows never fold forward and the stifles never fold back.
//
// To SEE the walk: scripts/gorehound-walk-dump.ts + scripts/gorehound-gait-strip.py.
import { describe, it, expect } from 'vitest';
import src from './gorehound.blob?raw';
import { parseBlob } from '../blob-parse';
import { compileBlob, compileFace } from '../blob-compile';
import { buildBody } from '../build-body';
import { characterEntry } from '../character-registry';
import { makeActorMotion, stepActorMotion, emptyActorSignals } from '../actor';
import { makeRng } from '../wander';
import type { Vec3 } from '../types';

const doc = parseBlob(src);
const body = buildBody(compileBlob(doc, compileFace(doc)));
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

/** Signed forward offset (along `fwd`) of `mid` from the straight line a -> b, at mid's height. */
function fold(a: Vec3, mid: Vec3, b: Vec3, fwd: Vec3): number {
  const t = (mid[1] - a[1]) / (b[1] - a[1]);
  const onLine: Vec3 = [a[0] + (b[0] - a[0]) * t, mid[1], a[2] + (b[2] - a[2]) * t];
  const d = sub(mid, onLine);
  return d[0] * fwd[0] + d[2] * fwd[2];
}

describe('gorehound — a quadruped on the biped rig', () => {
  it('builds clean', () => {
    expect(body.errors).toEqual([]);
    expect(characterEntry('gorehound').profile.armStyle).toBe('foreleg');
  });

  it('rest pose: four feet on the floor, elbow back, stifle forward', () => {
    const hand = body.bones.get('hand.l')!, foot = body.bones.get('foot.l')!;
    expect(hand.tail[1], 'front toes on the floor').toBeLessThan(0.06);
    expect(foot.tail[1], 'hind toes on the floor').toBeLessThan(0.06);
    const sh = body.bones.get('upperarm.l')!.head, el = body.bones.get('upperarm.l')!.tail, wr = hand.head;
    expect(fold(sh, el, wr, [0, 0, 1]), 'elbow behind the shoulder-wrist line').toBeLessThan(-0.08);
    const hip = body.bones.get('thigh.l')!.head, kn = body.bones.get('thigh.l')!.tail, hock = foot.head;
    expect(fold(hip, kn, hock, [0, 0, 1]), 'stifle ahead of the hip-hock line').toBeGreaterThan(0.08);
  });

  it('walks a four-beat gait through the real motion pipeline', () => {
    const m = makeActorMotion(body, { seed: 7 });
    expect(m.motionJoints, 'every rig point must map to a gait joint').not.toBeNull();
    const J = m.motionJoints!.index;
    const profile = characterEntry('gorehound').profile;
    const rng = makeRng(7);
    const lifts: Record<string, number> = { handL: 0, handR: 0, footL: 0, footR: 0 };
    const restY: Record<string, number> = {};
    let minKnee = Infinity, maxElbow = -Infinity, maxStretch = 0;
    const armLen = m.motionJoints!.arm.L[0] + m.motionJoints!.arm.L[1];
    for (let i = 0; i < 360; i++) {
      stepActorMotion(m, {
        current: body, dt: 1 / 60, wander: true, armStyle: undefined,
        headingFollow: 1, gazeFollow: 1, bounds: { minX: -50, maxX: 50, minZ: -50, maxZ: 50 },
        rng, signals: emptyActorSignals(), profile, forceSpeed: profile.cruise,
      });
      const P = (k: number) => m.bound.rig.points[k]!.pos as Vec3;
      if (i < 90) {
        for (const n of Object.keys(lifts)) restY[n] = Math.min(restY[n] ?? Infinity, P(J[n as 'handL']!)[1]);
        continue;
      }
      const fwd: Vec3 = [Math.sin(m.lastBodyYaw), 0, Math.cos(m.lastBodyYaw)];
      for (const n of Object.keys(lifts)) lifts[n] = Math.max(lifts[n]!, P(J[n as 'handL']!)[1] - restY[n]!);
      for (const s of ['L', 'R'] as const) {
        minKnee = Math.min(minKnee, fold(P(J[`hip${s}`]!), P(J[`knee${s}`]!), P(J[`foot${s}`]!), fwd));
        maxElbow = Math.max(maxElbow, fold(P(J[`shoulder${s}`]!), P(J[`elbow${s}`]!), P(J[`hand${s}`]!), fwd));
        const reach = Math.hypot(...sub(P(J[`hand${s}`]!), P(J[`shoulder${s}`]!)));
        maxStretch = Math.max(maxStretch, reach / armLen);
      }
    }
    for (const [n, lift] of Object.entries(lifts)) expect(lift, `${n} lifts off the floor`).toBeGreaterThan(0.05);
    expect(minKnee, 'stifle never folds backward').toBeGreaterThan(0.02);
    expect(maxElbow, 'elbow never folds forward').toBeLessThan(-0.02);
    expect(maxStretch, 'the foreleg is never pulled straight').toBeLessThan(1.0);
  });
});
