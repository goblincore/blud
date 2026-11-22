import { describe, expect, it } from 'vitest';
import { ANKLE_LIMITS, collapseHipCones, relaxAnkles } from './collapse';
import type { GaitJointName } from './gait';
import type { RigPoint } from './rig';
import type { Vec3 } from './types';
import { len, sub } from './vec';

// A standing pair of legs facing +z: shin straight down, foot flat forward.
const NAMES: GaitJointName[] = ['pelvis', 'chest', 'hipL', 'kneeL', 'footL', 'toeL', 'hipR', 'kneeR', 'footR', 'toeR'];
const REST: Vec3[] = [
  [0, 1, 0], [0, 1.5, 0],
  [-0.1, 1, 0], [-0.1, 0.5, 0], [-0.1, 0.05, 0], [-0.1, 0.05, 0.15],
  [0.1, 1, 0], [0.1, 0.5, 0], [0.1, 0.05, 0], [0.1, 0.05, 0.15],
];
const at = (n: GaitJointName) => NAMES.indexOf(n);
const rig = (pose: Vec3[]): RigPoint[] => pose.map(p => ({ pos: p, prev: p, pinned: false }));
const withToe = (toe: Vec3): Vec3[] => REST.map((p, i) => i === at('toeL') ? toe : p);
/** Shin-to-foot angle (deg): 90 at rest. */
const ankleDeg = (pts: readonly RigPoint[]) => {
  const s = sub(pts[at('footL')]!.pos, pts[at('kneeL')]!.pos), t = sub(pts[at('toeL')]!.pos, pts[at('footL')]!.pos);
  return Math.acos((s[0] * t[0] + s[1] * t[1] + s[2] * t[2]) / len(s) / len(t)) * 180 / Math.PI;
};
const FAR_BELOW = () => -10;

describe('relaxAnkles — the soft ankle spring', () => {
  const cones = collapseHipCones(NAMES, REST);

  it('learns the rest aim from the rest pose, and leaves the rest foot alone', () => {
    expect(cones.every(c => c.ankle)).toBe(true);
    const out = relaxAnkles(rig(REST), cones, FAR_BELOW);
    expect(len(sub(out[at('toeL')]!.pos, REST[at('toeL')]!))).toBeLessThan(1e-9);
  });

  it('pulls a toe pointed past the range part of the way back, keeping the foot length and adding no speed', () => {
    const pts = rig(withToe([-0.1, -0.1, 0])); // pointed straight down the shin: 90 deg of plantarflexion
    const out = relaxAnkles(pts, cones, FAR_BELOW);
    const edge = 90 - ANKLE_LIMITS.plantar * 180 / Math.PI;
    expect(ankleDeg(out)).toBeGreaterThan(5);
    expect(ankleDeg(out)).toBeLessThan(edge);
    expect(len(sub(out[at('toeL')]!.pos, out[at('footL')]!.pos))).toBeCloseTo(0.15, 2);
    const v = sub(out[at('toeL')]!.pos, out[at('toeL')]!.prev);
    expect(len(v)).toBeLessThan(1e-9);
  });

  it('leaves a toe on the floor alone when the pull would drive it into the floor, and lifts the ankle instead', () => {
    const toe: Vec3 = [-0.1, 0.2, 0]; // folded up the shin, past dorsiflexion
    const free = relaxAnkles(rig(withToe(toe)), cones, FAR_BELOW);
    expect(free[at('toeL')]!.pos[1]).toBeLessThan(toe[1]); // in the air it is pulled down toward range
    const onFloor = relaxAnkles(rig(withToe(toe)), cones, i => i === at('toeL') ? toe[1] : -10);
    expect(onFloor[at('toeL')]!.pos).toEqual(toe);
    expect(onFloor[at('footL')]!.pos[1]).toBeGreaterThan(REST[at('footL')]![1]);
  });
});
