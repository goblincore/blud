// src/lab/sdf-zombie/goblin-gait.test.ts
//
// Goblin refinement phase 4a: the goblin's own scamper gait (spec docs/superpowers/specs/2026-10-02-goblin-gait-design.md).
// Pins the RELATIONSHIPS the numbers must keep, not the numbers: the speeds come from the clip curves the profile
// borrows, so retuning the cadence in the turntable must keep cruise, the run band and the curves in step.
import { describe, it, expect } from 'vitest';
import { motionProfileFor } from './motion-profile';
import { GOBLIN_WALK, GOBLIN_RUN } from './gait';
import { SOLDIER_WALK } from './gait-curves/soldier-walk';
import { SOLDIER_RUN } from './gait-curves/soldier-run';
import type { GaitCurves } from './gait-curves';

const LEG = 0.29 + 0.27; // goblin.blob thigh + shin, metres
/** gait-from-clip.ts's formula: the speed the stride implies for this body. */
const implied = (c: GaitCurves, freq: number) => {
  const duty = c.L.stance.filter(Boolean).length / c.n;
  return (c.travel * LEG * freq) / duty;
};

describe('goblin gait', () => {
  const p = motionProfileFor('goblin');

  it('walks and runs on its own clip-derived gaits, with carry arms for the shotgun', () => {
    expect(p.gait.walk).toBe(GOBLIN_WALK);
    expect(p.gait.run).toBe(GOBLIN_RUN);
    expect(GOBLIN_WALK.curves).toBe(SOLDIER_WALK);
    expect(GOBLIN_RUN.curves).toBe(SOLDIER_RUN);
    expect(GOBLIN_WALK.armStyle).toBe('carry'); // arm style comes from the GAIT (pickArmStyle), not the profile
    expect(GOBLIN_RUN.armStyle).toBe('carry');
  });

  it('steps quicker than the soldier (short legs) but is not a blur, and runs faster than it walks', () => {
    expect(GOBLIN_WALK.strideFreq).toBeGreaterThan(SOLDIER_WALK.freq);
    expect(GOBLIN_WALK.strideFreq).toBeLessThan(2.2);
    expect(GOBLIN_RUN.strideFreq).toBeGreaterThan(GOBLIN_WALK.strideFreq);
  });

  it("cruises at the walk gait's own implied speed, below the run blend, and tops out at the run's", () => {
    expect(p.cruise).toBeCloseTo(implied(SOLDIER_WALK, GOBLIN_WALK.strideFreq), 1);
    expect(p.cruise).toBeLessThan(p.runBand.from); // marches, never drifts toward the run (the soldier's overshoot)
    expect(p.runBand.to).toBeCloseTo(implied(SOLDIER_RUN, GOBLIN_RUN.strideFreq), 1);
    expect(p.runBand.to).toBeGreaterThan(p.runBand.from);
  });

  it('stoops forward, more when running', () => {
    expect(GOBLIN_WALK.torsoLean).toBeGreaterThan(0);
    expect(GOBLIN_RUN.torsoLean).toBeGreaterThan(GOBLIN_WALK.torsoLean);
  });
});
