// src/lab/sdf-zombie/gait.test.ts
import { describe, it, expect } from 'vitest';
import {
  GAIT_JOINTS,
  GAIT_TUNING,
  jointForBoneEnd,
  jointNamesForBody,
  makeGaitState,
  rotateYaw,
  stepGait,
  type GaitPose,
  type GaitSkew,
} from './gait';
import { bindRig } from './rig-bind';
import { buildBody } from './build-body';
import { makeZombie } from './body';
import { len, sub } from './vec';
import type { Vec3 } from './types';

const NONE: GaitSkew = { damageMeter: 0, missing: {}, wounded: {} };
const DT = 1 / 60;

/** Runs stepGait for `seconds` and returns every pose (for assertions that
 *  need signed asymmetries across a cycle, not exact floats). */
function poses(seed: number, skew: GaitSkew, seconds: number, dt = DT, style: 'swing' | 'reach' = 'swing'): GaitPose[] {
  let st = makeGaitState(seed);
  const out: GaitPose[] = [];
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) {
    const step = stepGait(st, skew, dt, style);
    st = step.state;
    out.push(step.pose);
  }
  return out;
}

const maxAbs = (ps: GaitPose[], pick: (p: GaitPose) => number): number =>
  Math.max(...ps.map(p => Math.abs(pick(p))));
const minY = (ps: GaitPose[], pick: (p: GaitPose) => Vec3): number =>
  Math.min(...ps.map(p => pick(p)[1]));
const meanX = (ps: GaitPose[], pick: (p: GaitPose) => Vec3): number =>
  ps.reduce((a, p) => a + pick(p)[0], 0) / ps.length;

const close = (a: Vec3, b: Vec3, eps: number): boolean =>
  a.every((v, i) => Math.abs(v - b[i]!) < eps);

describe('stepGait — phase math', () => {
  it('alternates stance/swing: legs never swing together, ~38% swing each', () => {
    const ps = poses(7, NONE, 1 / GAIT_TUNING.strideFreq * 2 + DT, 1 / 240);
    let both = 0;
    let swingL = 0;
    let swingR = 0;
    for (const p of ps) {
      const liftL = p.offsets.footL[1];
      const liftR = p.offsets.footR[1];
      const sL = liftL > 1e-4;
      const sR = liftR > 1e-4;
      if (sL && sR) both++;
      if (sL) swingL++;
      if (sR) swingR++;
      // stance flag agrees with the lift curve
      expect(p.stance.legL).toBe(!sL);
      expect(p.stance.legR).toBe(!sR);
    }
    expect(both).toBe(0);
    const frac = (n: number) => n / ps.length;
    expect(frac(swingL)).toBeGreaterThan(0.34);
    expect(frac(swingL)).toBeLessThan(0.44);
    expect(frac(swingR)).toBeGreaterThan(0.34);
    expect(frac(swingR)).toBeLessThan(0.44);
  });

  it('repeats: legs bob every stride, the full pose (with sway) every two strides', () => {
    const seed = 42;
    const t1 = 2.5;
    const stride = 1 / GAIT_TUNING.strideFreq;
    const g1 = stepGait(makeGaitState(seed), NONE, t1);
    const g1b = stepGait(makeGaitState(seed), NONE, t1 + stride);
    const g2 = stepGait(makeGaitState(seed), NONE, t1 + 2 * stride);
    const eps = 1e-9;
    // leg phases run at the stride clock — one full stride repeats them exactly
    expect(close(g1.pose.offsets.footL, g1b.pose.offsets.footL, eps)).toBe(true);
    expect(close(g1.pose.offsets.footR, g1b.pose.offsets.footR, eps)).toBe(true);
    expect(Math.abs(g1.pose.phase - g1b.pose.phase)).toBeLessThan(eps);
    // the lateral sway runs at half the stride frequency (one sway per pair of
    // steps), so the FULL pose — root included — repeats every two strides
    for (const [name, a, b] of [
      ['root', g1.pose.rootOffset, g2.pose.rootOffset],
      ['shoulderL', g1.pose.offsets.shoulderL, g2.pose.offsets.shoulderL],
      ['head', g1.pose.offsets.head, g2.pose.offsets.head],
    ] as const) {
      expect(close(a, b, eps), name).toBe(true);
    }
  });

  it('advances the clock by dt and never by negative dt', () => {
    const st = makeGaitState(3);
    expect(stepGait(st, NONE, 1 / 60).state.time).toBeCloseTo(1 / 60, 10);
    expect(stepGait(st, NONE, -1).state.time).toBe(0);
  });
});

describe('stepGait — determinism', () => {
  it('same seed ⇒ identical poses; different seed ⇒ different pose', () => {
    const a = poses(11, NONE, 5);
    const b = poses(11, NONE, 5);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const c = poses(12, NONE, 5);
    expect(JSON.stringify(c)).not.toBe(JSON.stringify(a));
  });
});

describe('stepGait — skews', () => {
  it('missing arm: that shoulder droops, its hand is dead, the survivor swings harder', () => {
    const seed = 21;
    const base = poses(seed, NONE, 4);
    const armless = poses(seed, { ...NONE, missing: { armR: true } }, 4);
    for (const p of armless) {
      expect(p.offsets.shoulderR[1]).toBe(-GAIT_TUNING.missingArmDrop);
      expect(p.offsets.shoulderL[1]).toBe(0);
    }
    expect(maxAbs(armless, p => p.offsets.handR[2])).toBe(0);
    expect(maxAbs(armless, p => p.offsets.handL[2])).toBeGreaterThan(
      maxAbs(base, p => p.offsets.handL[2]) * 1.1,
    );
    // asymmetric counter-sway: the intact shoulder still counter-swings
    expect(maxAbs(armless, p => p.offsets.shoulderL[0])).toBeGreaterThan(0.01);
  });

  it('wounded leg: foot lifts less, stance shortens, hip drops — signed asymmetry vs the healthy side', () => {
    const seed = 33;
    const base = poses(seed, NONE, 4);
    const limping = poses(seed, { ...NONE, wounded: { legL: true } }, 4);
    // foot lift cut on the wounded side (same seed ⇒ same asymmetry multiplier)
    expect(maxAbs(limping, p => p.offsets.footL[1])).toBeLessThan(
      maxAbs(base, p => p.offsets.footL[1]) * 0.75,
    );
    // wounded side lifts less than the healthy side
    expect(maxAbs(limping, p => p.offsets.footL[1])).toBeLessThan(
      maxAbs(limping, p => p.offsets.footR[1]) * 0.8,
    );
    // shorter stance = larger swing fraction on the wounded side
    const fracL = limping.filter(p => !p.stance.legL).length / limping.length;
    const fracR = limping.filter(p => !p.stance.legR).length / limping.length;
    expect(fracL).toBeGreaterThan(fracR + 0.05);
    // hip droops on the wounded side
    for (const p of limping) {
      expect(p.offsets.hipL[1]).toBe(-GAIT_TUNING.woundedHipDrop);
      expect(p.offsets.hipR[1]).toBe(0);
    }
  });

  it('damage meter: heavier stumble — lower bob, more sway, dragging feet, a lurch', () => {
    const seed = 55;
    const fresh = poses(seed, NONE, 6);
    const hurt = poses(seed, { ...NONE, damageMeter: 0.9 }, 6);
    expect(minY(hurt, p => p.rootOffset)).toBeGreaterThan(minY(fresh, p => p.rootOffset) + 0.005);
    expect(maxAbs(hurt, p => p.rootOffset[0])).toBeGreaterThan(
      maxAbs(fresh, p => p.rootOffset[0]) + 0.01,
    );
    expect(maxAbs(hurt, p => p.offsets.footL[1])).toBeLessThan(
      maxAbs(fresh, p => p.offsets.footL[1]) * 0.7,
    );
    expect(maxAbs(hurt, p => p.rootOffset[2])).toBeGreaterThan(
      maxAbs(fresh, p => p.rootOffset[2]) + 0.01,
    );
  });

  it('one leg missing ⇒ hop-limp: hop flag, deeper bob, survivor swings harder, missing side dead, lean flips with the side', () => {
    const seed = 77;
    const base = poses(seed, NONE, 4);
    const hopR = poses(seed, { ...NONE, missing: { legR: true } }, 4);
    const hopL = poses(seed, { ...NONE, missing: { legL: true } }, 4);
    for (const p of hopR) {
      expect(p.hop).toBe(true);
      expect(p.stance.legR).toBe(false);
      expect(p.offsets.footR).toEqual([0, 0, 0]);
      expect(p.offsets.kneeR).toEqual([0, 0, 0]);
      expect(p.offsets.hipR).toEqual([0, 0, 0]);
    }
    expect(minY(hopR, p => p.rootOffset)).toBeLessThan(minY(base, p => p.rootOffset) - 0.01);
    expect(maxAbs(hopR, p => p.offsets.footL[1])).toBeGreaterThan(
      maxAbs(base, p => p.offsets.footL[1]) * 1.1,
    );
    // the hop lean is a constant offset toward the missing side — the sway
    // averages out over a cycle, so the mean root x differs by ~2× hopLean
    expect(meanX(hopL, p => p.rootOffset)).toBeLessThan(meanX(hopR, p => p.rootOffset) - 0.02);
  });

  it('hop state runs at the boosted stride frequency (shorter period)', () => {
    const seed = 9;
    const hopFreq = GAIT_TUNING.strideFreq * GAIT_TUNING.hopFreqScale;
    const t1 = 1.7;
    const skew: GaitSkew = { ...NONE, missing: { legR: true } };
    const g1 = stepGait(makeGaitState(seed), skew, t1);
    const g1b = stepGait(makeGaitState(seed), skew, t1 + 1 / hopFreq);
    const g2 = stepGait(makeGaitState(seed), skew, t1 + 2 / hopFreq);
    // the survivor's foot repeats every hop-stride
    expect(close(g1.pose.offsets.footL, g1b.pose.offsets.footL, 1e-9)).toBe(true);
    // the full hop pose (root sway included) repeats every two hop-strides
    expect(close(g1.pose.rootOffset, g2.pose.rootOffset, 1e-9)).toBe(true);
  });

  it('both legs missing: no hop, no leg offsets, pose stays finite (collapse owns the body)', () => {
    const ps = poses(3, { ...NONE, missing: { legL: true, legR: true } }, 2);
    for (const p of ps) {
      expect(p.hop).toBe(false);
      expect(p.offsets.footL).toEqual([0, 0, 0]);
      expect(p.offsets.footR).toEqual([0, 0, 0]);
      for (const v of [...p.rootOffset, ...Object.values(p.offsets).flat()])
        expect(Number.isFinite(v)).toBe(true);
    }
  });
});

describe('GAIT_TUNING', () => {
  it('is low-frequency and stance-heavy (claymation bias)', () => {
    expect(GAIT_TUNING.strideFreq).toBeLessThan(2);
    expect(GAIT_TUNING.stanceDuty).toBeGreaterThan(0.4);
    expect(GAIT_TUNING.stanceDuty).toBeLessThan(0.8);
    for (const v of Object.values(GAIT_TUNING))
      if (typeof v === 'number') expect(v).toBeGreaterThan(0);
  });
});

describe('body ↔ joint wiring contract', () => {
  it('jointNamesForBody reproduces bindRig point order and position, and matches GAIT_JOINTS', () => {
    const def = makeZombie();
    const body = buildBody(def);
    const bound = bindRig(body);
    const names = jointNamesForBody(body);
    expect(names).toHaveLength(17);
    expect(names).toEqual([...GAIT_JOINTS]);
    expect(bound.rig.points).toHaveLength(17);
    // every resolved bone joint lands on the named rig point at the right spot
    for (const [boneName, bone] of body.bones.entries()) {
      for (const end of ['head', 'tail'] as const) {
        const name = jointForBoneEnd(boneName, end);
        if (!name) continue;
        const idx = names.indexOf(name);
        expect(len(sub(bound.rig.points[idx]!.pos, bone[end]))).toBeLessThan(1e-4);
      }
    }
  });

  it('maps bone ends to the expected joint names', () => {
    expect(jointForBoneEnd('pelvis', 'head')).toBe('pelvis');
    expect(jointForBoneEnd('pelvis', 'tail')).toBe('hips');
    expect(jointForBoneEnd('spine', 'tail')).toBe('chest');
    expect(jointForBoneEnd('thigh.l', 'head')).toBe('hipL');
    expect(jointForBoneEnd('shin.r', 'tail')).toBe('footR');
    expect(jointForBoneEnd('clavicle.l', 'head')).toBe('chest');
    expect(jointForBoneEnd('foreArm.r', 'tail')).toBe('handR');
    expect(jointForBoneEnd('mysteryBone', 'tail')).toBeNull();
  });
});

describe('rotateYaw', () => {
  it('keeps y and rotates x/z by the heading', () => {
    expect(rotateYaw([0, 0, 1], 0)).toEqual([0, 0, 1]);
    const right = rotateYaw([1, 0, 0], Math.PI / 2);
    expect(right[0]).toBeCloseTo(0, 10);
    expect(right[2]).toBeCloseTo(-1, 10);
    expect(right[1]).toBe(0);
    // round-trip
    const v: Vec3 = [0.3, 0.7, -0.2];
    const back = rotateYaw(rotateYaw(v, 1.3), -1.3);
    expect(close(back, v, 1e-9)).toBe(true);
  });
});
