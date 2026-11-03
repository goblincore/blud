// src/lab/sdf-zombie/rig-timestep.test.ts
//
// TIME-CORRECTED VERLET (owner playtest 2026-11-02: bullet-time corpses looped and floated): a rig point
// moves at the same speed whatever the step length, across a change of step, and a shove gives the same
// speed at 0.2x as at 1x.
import { describe, expect, it } from 'vitest';
import { stepRig, type RigState } from './rig';
import { impulseAt, type BoundRig } from './rig-bind';
import type { Vec3 } from './types';

const OPTS = { gravity: [0, 0, 0] as Vec3, damping: 0, iterations: 1, restStiffness: 0 };

function moving(v: Vec3, dt: number): RigState {
  return {
    points: [{ pos: [0, 0, 0], prev: [-v[0] * dt, -v[1] * dt, -v[2] * dt], pinned: false }],
    constraints: [], restPose: [[0, 0, 0]], stepDt: dt,
  };
}

/** Distance covered over `seconds` of sim time in steps of `dt`. */
function travel(rig: RigState, dt: number, seconds: number): number {
  const x0 = rig.points[0]!.pos[0];
  for (let t = 0; t < seconds - 1e-9; t += dt) rig = stepRig(rig, dt, OPTS);
  return rig.points[0]!.pos[0] - x0;
}

describe('stepRig keeps velocity across step lengths', () => {
  it('a point moving at 1 m/s covers 0.1 m in 0.1 s at 1/60 and at 1/300 steps', () => {
    expect(travel(moving([1, 0, 0], 1 / 60), 1 / 60, 0.1)).toBeCloseTo(0.1, 3);
    expect(travel(moving([1, 0, 0], 1 / 300), 1 / 300, 0.1)).toBeCloseTo(0.1, 3);
  });

  it('dropping into bullet time slows the step, not the speed', () => {
    // Launched at 1/60, then stepped at 1/300 (0.2x): still 1 m/s in sim time.
    expect(travel(moving([1, 0, 0], 1 / 60), 1 / 300, 0.1)).toBeCloseTo(0.1, 3);
  });

  it('damping bleeds the same per second at any step', () => {
    const o = { ...OPTS, damping: 0.06 };
    const run = (dt: number) => {
      let r = moving([1, 0, 0], dt);
      for (let t = 0; t < 0.5 - 1e-9; t += dt) r = stepRig(r, dt, o);
      return r.points[0]!.pos[0];
    };
    expect(run(1 / 300)).toBeCloseTo(run(1 / 60), 1);
  });
});

describe('impulseAt is a 60 Hz shove', () => {
  const bound = (dt: number): BoundRig => ({ rig: moving([0, 0, 0], dt) } as unknown as BoundRig);
  it('gives the same speed at 0.2x as at 1x', () => {
    const speed = (dt: number) => {
      const r = impulseAt(bound(dt), [0, 0, 0], [0.05, 0, 0]).rig;
      return (r.points[0]!.pos[0] - r.points[0]!.prev[0]) / dt;
    };
    expect(speed(1 / 300)).toBeCloseTo(speed(1 / 60), 6);
    expect(speed(1 / 60)).toBeCloseTo(3, 6); // 5 cm per 1/60 s
  });
});
