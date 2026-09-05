// src/lab/sdf-zombie/gait.test.ts
import { describe, it, expect } from 'vitest';
import {
  GAIT_JOINTS,
  GAIT_TUNING,
  MARCH,
  RUN,
  SHAMBLE,
  blendProfiles,
  jointForBoneEnd,
  jointNamesForBody,
  makeGaitState,
  rotateYaw,
  stepGait,
  type GaitPose,
  type GaitProfile,
  type GaitSkew,
} from './gait';
import { bindRig } from './rig-bind';
import { buildBody } from './build-body';
import { makeZombie } from './body';
import { compileBlob } from './blob-compile';
import { parseBlob } from './blob-parse';
import { makeMotionJoints } from './motion';
import soldierSrc from './characters/soldier.blob?raw';
import goblinSrc from './characters/goblin.blob?raw';
import zombieSrc from './characters/zombie.blob?raw';
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
  it('swing knee always bows FORWARD of the hip→foot line (never the backward "cow" knee)', () => {
    // Motion-polish task 5: the swing knee offset used to sit BEHIND the hip
    // while the foot reached forward — a backward hinge at full reach. The
    // knee now tracks half the foot's reach plus a forward bow (kneeTrack /
    // kneeBend), so it stays on the +z side of the line for the whole swing.
    for (const seed of [1, 21, 42]) {
      for (const p of poses(seed, NONE, 4)) {
        for (const [knee, foot] of [
          [p.offsets.kneeL, p.offsets.footL],
          [p.offsets.kneeR, p.offsets.footR],
        ] as const) {
          if (foot[2] <= 0.01) continue; // stance / swing edge — no reach
          // Knee z = kneeTrack·reach + bow ⇒ strictly ahead of half the
          // foot's forward offset (half = the on-line position at mid-leg).
          expect(knee[2]).toBeGreaterThan(0.5 * foot[2]);
        }
      }
    }
  });

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

describe('stepGait — reach style (mummy arms as a shoulder PIVOT spec)', () => {
  it('emits a rotation spec instead of elbow/hand offsets', () => {
    const ps = poses(5, NONE, 2, DT, 'reach');
    for (const p of ps) {
      expect(p.reach).toBeDefined();
      // Additive elbow/hand displacements are what popped the shoulder ball
      // out of the torso — in reach style they must stay zero so the wiring
      // can rotate the chain rigidly about the shoulder anchor instead.
      expect(p.offsets.elbowL).toEqual([0, 0, 0]);
      expect(p.offsets.handL).toEqual([0, 0, 0]);
      expect(p.offsets.elbowR).toEqual([0, 0, 0]);
      expect(p.offsets.handR).toEqual([0, 0, 0]);
      // near-horizontal mummy reach (0 = hang, π/2 = horizon)
      expect(p.reach!.pitchL).toBeGreaterThan(1);
      expect(p.reach!.pitchR).toBeGreaterThan(1);
      expect(p.reach!.drop).toBe(GAIT_TUNING.reachElbowDrop);
    }
    // the bob/sway beat rides as ONE rigid shift for the whole arm
    expect(maxAbs(ps, p => p.reach!.shift[1])).toBeGreaterThan(0.01);
    expect(maxAbs(ps, p => p.reach!.shift[0])).toBeGreaterThan(0.005);
  });

  it('a wounded arm reaches less high; a missing arm not at all', () => {
    const healthy = poses(8, NONE, 1, DT, 'reach')[0]!.reach!;
    const hurt = poses(8, { ...NONE, wounded: { armL: true } }, 1, DT, 'reach')[0]!.reach!;
    expect(hurt.pitchL).toBeCloseTo(healthy.pitchL * GAIT_TUNING.woundedArmSwingScale, 9);
    expect(hurt.pitchR).toBeCloseTo(healthy.pitchR, 9);
    const gone = poses(8, { ...NONE, missing: { armR: true } }, 1, DT, 'reach')[0]!.reach!;
    expect(gone.pitchR).toBe(0);
    expect(gone.pitchL).toBeCloseTo(healthy.pitchL, 9);
  });

  it('swing style emits no reach spec', () => {
    for (const p of poses(5, NONE, 1, DT, 'swing')) expect(p.reach).toBeUndefined();
  });
});

describe('GAIT_TUNING', () => {
  it('is low-frequency and stance-heavy (claymation bias)', () => {
    expect(GAIT_TUNING.strideFreq).toBeLessThan(2);
    expect(GAIT_TUNING.stanceDuty).toBeGreaterThan(0.4);
    expect(GAIT_TUNING.stanceDuty).toBeLessThan(0.8);
    for (const v of Object.values(GAIT_TUNING))
      if (typeof v === 'number') expect(v).toBeGreaterThanOrEqual(0);
  });
});

describe('body ↔ joint wiring contract', () => {
  it('jointNamesForBody reproduces bindRig point order and position, and matches GAIT_JOINTS', () => {
    const def = makeZombie();
    const body = buildBody(def);
    const bound = bindRig(body);
    const names = jointNamesForBody(body);
    expect(names).toHaveLength(17);
    // The zombie's 17 primary names, in rig-point order (mirrored bones emit
    // as adjacent .l/.r pairs, so the sides interleave bone-by-bone).
    expect(names).toEqual([
      'pelvis', 'hips', 'chest', 'neck', 'head',
      'shoulderL', 'shoulderR', 'elbowL', 'elbowR', 'handL', 'handR',
      'hipL', 'kneeL', 'hipR', 'kneeR', 'footL', 'footR',
    ]);
    expect(bound.rig.points).toHaveLength(17);
    // every resolved bone joint lands on the named rig point at the right spot
    for (const [boneName, bone] of body.bones.entries()) {
      for (const end of ['head', 'tail'] as const) {
        const name = jointForBoneEnd(boneName, end);
        if (!name) continue;
        const idx = names.indexOf(name);
        if (idx < 0) continue; // a primary name won this point's position
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
    expect(jointForBoneEnd('clavicle.l', 'head')).toBe('clavicleL');
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

describe('joint naming — every rig point of every character gets a name', () => {
  const load = (src: string) => {
    const body = buildBody(compileBlob(parseBlob(src)));
    return { body, bound: bindRig(body), names: jointNamesForBody(body) };
  };
  it('zombie: the 17 primary names in rig-point order', () => {
    const { names } = load(zombieSrc);
    // compileBlob emits each mirrored bone as an adjacent .l/.r pair, so the
    // rig points (and their names) interleave the sides bone-by-bone — this
    // is the order bindRig has always emitted for the blob-compiled zombie.
    expect(names).toEqual([
      'pelvis', 'hips', 'chest', 'neck', 'head',
      'shoulderL', 'shoulderR', 'elbowL', 'elbowR', 'handL', 'handR',
      'hipL', 'kneeL', 'hipR', 'kneeR', 'footL', 'footR',
    ]);
  });
  it.each([['soldier', soldierSrc], ['goblin', goblinSrc]])('%s: names == rig points, makeMotionJoints is live', (_n, src) => {
    const { bound, names, body } = load(src);
    expect(names.length).toBe(bound.rig.points.length);
    expect(new Set(names).size).toBe(names.length);
    expect(makeMotionJoints(body, bound.rig.restPose)).not.toBeNull();
    for (const j of ['shoulderL', 'elbowL', 'handL', 'hipL', 'kneeL', 'footL', 'chest', 'neck', 'head'])
      expect(names, j).toContain(j);
  });
  it('soldier: the secondary names land on the right points', () => {
    const { body, bound, names } = load(soldierSrc);
    const at = (n: string) => bound.rig.points[names.indexOf(n as never)]!.pos;
    expect(at('spineA')).toEqual(body.bones.get('spine1')!.tail);
    expect(at('spineB')).toEqual(body.bones.get('chest')!.tail);
    expect(at('chest')).toEqual(body.bones.get('neck')!.head);
    expect(at('clavicleL')).toEqual(body.bones.get('clavicle.l')!.head);
    expect(at('handTipR')).toEqual(body.bones.get('hand.r')!.tail);
    expect(at('toeL')).toEqual(body.bones.get('foot.l')!.tail);
  });
  it('goblin: chest.tail and neck.head coincide and the PRIMARY name wins', () => {
    const { names } = load(goblinSrc);
    expect(names).toContain('chest');
    expect(names).not.toContain('spineB');
  });
  it('jointForBoneEnd aliases', () => {
    expect(jointForBoneEnd('upperarm.l', 'head')).toBe('shoulderL');
    expect(jointForBoneEnd('forearm.r', 'tail')).toBe('handR');
    expect(jointForBoneEnd('hand.r', 'tail')).toBe('handTipR');
    expect(jointForBoneEnd('foot.l', 'tail')).toBe('toeL');
    expect(jointForBoneEnd('clavicle.l', 'head')).toBe('clavicleL');
    expect(jointForBoneEnd('spine2', 'tail')).toBe('chest');
  });
  it('the pose carries every secondary joint, rigid with its parent', () => {
    const p = stepGait(makeGaitState(3), NONE, 0.2, 'swing').pose;
    expect(p.offsets.handTipL).toEqual(p.offsets.handL);
    expect(p.offsets.toeR).toEqual(p.offsets.footR);
    expect(p.offsets.clavicleL).toEqual(p.offsets.chest);
    expect(p.offsets.spineA[1]).not.toBe(0);
  });
});

describe('gait profiles', () => {
  it('SHAMBLE is GAIT_TUNING by identity and the default', () => {
    expect(SHAMBLE).toBe(GAIT_TUNING);
    const a = stepGait(makeGaitState(1), NONE, 0.1, 'swing').pose;
    const b = stepGait(makeGaitState(1), NONE, 0.1, 'swing', SHAMBLE).pose;
    expect(b).toEqual(a);
  });
  it('run lifts the foot higher and strides longer than march', () => {
    const lift = (p: GaitProfile) => {
      let st = makeGaitState(5); let best = 0; let reach = 0;
      for (let i = 0; i < 240; i++) {
        const s = stepGait(st, NONE, 1 / 240, 'swing', p); st = s.state;
        best = Math.max(best, s.pose.offsets.footL[1]); reach = Math.max(reach, s.pose.offsets.footL[2]);
      }
      return { best, reach };
    };
    expect(lift(RUN).best).toBeGreaterThan(lift(MARCH).best);
    expect(lift(RUN).reach).toBeGreaterThan(lift(MARCH).reach);
  });
  it('blendProfiles lerps scalars and snaps armStyle at 0.5', () => {
    const half = blendProfiles(MARCH, RUN, 0.5);
    expect(half.strideLen).toBeCloseTo((MARCH.strideLen + RUN.strideLen) / 2, 9);
    expect(blendProfiles(MARCH, RUN, 0.49).armStyle).toBe(MARCH.armStyle);
    expect(blendProfiles(MARCH, RUN, 0.5).armStyle).toBe(RUN.armStyle);
    expect(blendProfiles(MARCH, RUN, 0).torsoLean).toBe(0);
    expect(blendProfiles(MARCH, RUN, 1).torsoLean).toBe(RUN.torsoLean);
  });
  it('the pose reports the profile lean; shamble reports 0', () => {
    expect(stepGait(makeGaitState(1), NONE, 0.1, 'swing').pose.lean).toBe(0);
    expect(stepGait(makeGaitState(1), NONE, 0.1, 'swing', RUN).pose.lean).toBeCloseTo(RUN.torsoLean * Math.PI / 180, 9);
  });
});
