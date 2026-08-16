// src/lab/sdf-zombie/collapse.test.ts
//
// Spec §5 units: damage-meter accumulation weights, the full trigger matrix
// (legs/meter/forced), the hop-limp vs collapse boundary, the fall timeline
// (rest-pull release → settle), the one-sided rope relaxer, rope building
// against the REAL body geometry, and the ground-feel mirror sync guard.
import { describe, it, expect } from 'vitest';
import {
  COLLAPSE_TUNING,
  collapseRopes,
  makeCollapseState,
  relaxRopeConstraints,
  stepCollapse,
  type CollapseSignal,
  type CollapseState,
  type CollapseStep,
  type MissingLimbs,
  type RopeLimit,
} from './collapse';
import { WOUND_PROFILES, type Wound, type WoundType } from './damage';
import { jointNamesForBody, type GaitJointName } from './gait';
import { bindRig } from './rig-bind';
import { buildBody } from './build-body';
import { makeZombie } from './body';
import { makeChunk, stepChunk } from './gib-chunks';
import type { RigPoint } from './rig';
import type { LimbId } from './types';
import { len, sub } from './vec';

const T = COLLAPSE_TUNING;
const DT = 1 / 60;

const NONE_MISSING: MissingLimbs = { legL: false, legR: false, armL: false, armR: false };
const ONE_LEG: MissingLimbs = { ...NONE_MISSING, legL: true };
const BOTH_LEGS: MissingLimbs = { legL: true, legR: true, armL: false, armR: false };
const NO_ROPES: RopeLimit[] = [];

const wound = (type: WoundType): Wound => ({
  primIdx: 0,
  local: [0, 0, 0],
  radius: WOUND_PROFILES[type].radius,
  type,
  ageSec: 0,
});

interface SigOpts {
  wounds?: Wound[];
  severed?: LimbId[];
  missing?: MissingLimbs;
  forced?: boolean;
  ropes?: RopeLimit[];
}

function sig(o: SigOpts = {}): CollapseSignal {
  return {
    wounds: o.wounds ?? [],
    severed: o.severed ?? [],
    missing: o.missing ?? NONE_MISSING,
    forced: o.forced ?? false,
    ropes: o.ropes ?? NO_ROPES,
  };
}

/** Steps `frames` times with the same signal (the standing/idle case). */
function idle(frames: number, st0?: CollapseState): CollapseStep[] {
  let st = st0 ?? makeCollapseState();
  const out: CollapseStep[] = [];
  for (let i = 0; i < frames; i++) {
    const step = stepCollapse(st, sig(), DT);
    st = step.state;
    out.push(step);
  }
  return out;
}

describe('collapse — damage meter', () => {
  it('accumulates each wound profile radius per hit', () => {
    expect(stepCollapse(makeCollapseState(), sig({ wounds: [wound('pellet')] }), DT).state.meter)
      .toBeCloseTo(WOUND_PROFILES.pellet.radius * T.meterRadiusWeight, 12);
    expect(stepCollapse(makeCollapseState(), sig({ wounds: [wound('blast')] }), DT).state.meter)
      .toBeCloseTo(WOUND_PROFILES.blast.radius * T.meterRadiusWeight, 12);
    expect(stepCollapse(makeCollapseState(), sig({ wounds: [wound('burn')] }), DT).state.meter)
      .toBeCloseTo(WOUND_PROFILES.burn.radius * T.meterRadiusWeight, 12);
  });

  it('weights blast > burn > pellet per hit (spec: profile radius)', () => {
    const m = (t: WoundType) =>
      stepCollapse(makeCollapseState(), sig({ wounds: [wound(t)] }), DT).state.meter;
    expect(m('blast')).toBeGreaterThan(m('burn'));
    expect(m('burn')).toBeGreaterThan(m('pellet'));
  });

  it('severed limbs weigh heavily (a flat jump per limb)', () => {
    const one = stepCollapse(makeCollapseState(), sig({ severed: ['legL'] }), DT).state.meter;
    const two = stepCollapse(makeCollapseState(), sig({ severed: ['armL', 'legR'] }), DT).state.meter;
    expect(one).toBeCloseTo(T.severedLimbWeight, 12);
    expect(two).toBeCloseTo(2 * T.severedLimbWeight, 12);
    // A sever outweighs the heaviest single wound.
    expect(T.severedLimbWeight).toBeGreaterThan(WOUND_PROFILES.blast.radius * T.meterRadiusWeight);
  });

  it('clamps at 1 and never decays', () => {
    let st = makeCollapseState();
    for (let i = 0; i < 10; i++) {
      st = stepCollapse(st, sig({ wounds: [wound('blast'), wound('blast')] }), DT).state;
    }
    expect(st.meter).toBe(1);
    // 300 idle seconds later the meter has not moved.
    const after = idle(300, { ...st, phase: 'standing', fallAge: 0 });
    expect(after[after.length - 1]!.state.meter).toBe(1);
  });
});

describe('collapse — trigger matrix', () => {
  it('both legs severed ⇒ instant collapse, regardless of meter', () => {
    const step = stepCollapse(makeCollapseState(), sig({ missing: BOTH_LEGS }), DT);
    expect(step.phase).toBe('falling');
    expect(step.state.fallAge).toBeCloseTo(DT, 12);
    expect(step.state.meter).toBe(0);
  });

  it('meter crossing ⇒ collapse on the exact crossing frame', () => {
    const perHit = WOUND_PROFILES.blast.radius * T.meterRadiusWeight;
    const hitsToCross = Math.ceil(T.meterThreshold / perHit); // 7 blasts
    let st = makeCollapseState();
    const steps: CollapseStep[] = [];
    for (let i = 0; i < hitsToCross; i++) {
      const step = stepCollapse(st, sig({ wounds: [wound('blast')] }), DT);
      st = step.state;
      steps.push(step);
    }
    expect(steps[hitsToCross - 2]!.phase).toBe('standing');
    expect(steps[hitsToCross - 2]!.state.meter).toBeLessThan(T.meterThreshold);
    expect(steps[hitsToCross - 1]!.phase).toBe('falling');
    expect(steps[hitsToCross - 1]!.state.meter).toBeGreaterThanOrEqual(T.meterThreshold);
  });

  it('forced (K key) ⇒ collapse with an empty meter', () => {
    const step = stepCollapse(makeCollapseState(), sig({ forced: true }), DT);
    expect(step.phase).toBe('falling');
    expect(step.state.meter).toBe(0);
  });

  it('one leg severed alone ⇒ hop-limp, NOT collapse', () => {
    let st = makeCollapseState();
    for (let i = 0; i < 300; i++) {
      const step = stepCollapse(st, sig({ missing: ONE_LEG }), DT);
      st = step.state;
      expect(step.phase).toBe('standing');
      expect(step.hop).toBe(true);
    }
  });

  it('one leg severed does NOT block the meter or forced triggers', () => {
    const byMeter = stepCollapse(makeCollapseState(), sig({
      missing: ONE_LEG, wounds: Array.from({ length: 8 }, () => wound('blast')),
    }), DT);
    expect(byMeter.phase).toBe('falling');
    const byForce = stepCollapse(makeCollapseState(), sig({ missing: ONE_LEG, forced: true }), DT);
    expect(byForce.phase).toBe('falling');
  });

  it('no trigger ⇒ stands indefinitely', () => {
    const steps = idle(600);
    for (const s of steps) {
      expect(s.phase).toBe('standing');
      expect(s.hop).toBe(false);
      expect(s.restPull).toBe(1);
      expect(s.settled).toBe(false);
    }
  });
});

describe('collapse — the fall', () => {
  const fallFrames = Math.round(T.fallReleaseTime / DT); // 0.35 s → 21 frames
  const settleFrames = Math.round(T.fallSettleTime / DT); // 2.5 s → 150 frames

  function forcedFall(frames: number, ropes: RopeLimit[] = NO_ROPES): CollapseStep[] {
    let st = makeCollapseState();
    const out: CollapseStep[] = [];
    for (let i = 0; i < frames; i++) {
      const step = stepCollapse(st, sig({ forced: i === 0, ropes }), DT);
      st = step.state;
      out.push(step);
    }
    return out;
  }

  it('ramps restPull 1 → 0 over fallReleaseTime', () => {
    const steps = forcedFall(fallFrames + 5);
    expect(steps[0]!.restPull).toBeCloseTo(1 - DT / T.fallReleaseTime, 12);
    for (let i = 1; i < fallFrames; i++) {
      expect(steps[i]!.restPull).toBeLessThan(steps[i - 1]!.restPull);
      expect(steps[i]!.restPull).toBeCloseTo(1 - ((i + 1) * DT) / T.fallReleaseTime, 12);
    }
    expect(steps[fallFrames - 1]!.restPull).toBe(0);
    for (let i = fallFrames; i < steps.length; i++) expect(steps[i]!.restPull).toBe(0);
  });

  it('settles after ~fallSettleTime and the phase is terminal', () => {
    const steps = forcedFall(settleFrames + 120);
    const idx = steps.findIndex(s => s.phase === 'settled');
    // dt-summed clocks carry float slack — settle lands within a frame of
    // the nominal fallSettleTime (2.5 s at 60 fps).
    expect(idx).toBeGreaterThanOrEqual(settleFrames - 1);
    expect(idx).toBeLessThanOrEqual(settleFrames + 1);
    expect(steps[idx - 1]!.settled).toBe(false);
    for (const s of steps.slice(idx)) {
      expect(s.phase).toBe('settled');
      expect(s.settled).toBe(true);
      expect(s.restPull).toBe(0);
    }
  });

  it('hop goes false once collapsed (a horizontal corpse has no gait)', () => {
    const steps = forcedFall(5);
    for (const s of steps) expect(s.hop).toBe(false);
  });

  it('echoes the rope set only while collapsed, as a copy', () => {
    const ropes: RopeLimit[] = [{ a: 0, b: 1, max: 0.5 }, { a: 2, b: 5, max: 0.9 }];
    const steps = forcedFall(3, ropes);
    for (let i = 0; i < 3; i++) expect(steps[i]!.ropes).toEqual(ropes);
    expect(steps[0]!.ropes).not.toBe(ropes); // defensive copy
    expect(ropes).toEqual([{ a: 0, b: 1, max: 0.5 }, { a: 2, b: 5, max: 0.9 }]); // unmutated
    // While standing: no ropes.
    const standing = stepCollapse(makeCollapseState(), sig({ ropes }), DT);
    expect(standing.ropes).toEqual([]);
  });

  it('a settled corpse stays interactive — wounds still land in the meter', () => {
    let st = makeCollapseState();
    for (let i = 0; i < settleFrames + 10; i++) st = stepCollapse(st, sig({ forced: i === 0 }), DT).state;
    expect(st.phase).toBe('settled');
    const shot = stepCollapse(st, sig({ wounds: [wound('blast')] }), DT);
    expect(shot.state.phase).toBe('settled'); // no despawn, no recovery
    expect(shot.state.meter).toBeCloseTo(WOUND_PROFILES.blast.radius * T.meterRadiusWeight, 12);
  });
});

describe('relaxRopeConstraints', () => {
  const pt = (x: number, y = 0, z = 0, pinned = false): RigPoint =>
    ({ pos: [x, y, z], prev: [x, y, z], pinned });

  it('pulls an over-stretched rope back to exactly max (half/half split)', () => {
    const out = relaxRopeConstraints([pt(0), pt(1)], [{ a: 0, b: 1, max: 0.5 }]);
    expect(out[0]!.pos).toEqual([0.25, 0, 0]);
    expect(out[1]!.pos).toEqual([0.75, 0, 0]);
    expect(len(out[1]!.pos.map((v, i) => v - out[0]!.pos[i]!) as [number, number, number]))
      .toBeCloseTo(0.5, 12);
  });

  it('never pushes apart — a slack rope (dist ≤ max) is untouched', () => {
    for (const d of [0, 0.3, 0.5]) {
      const pts = [pt(0), pt(d)];
      const out = relaxRopeConstraints(pts, [{ a: 0, b: 1, max: 0.5 }]);
      expect(out[0]!.pos).toEqual([0, 0, 0]);
      expect(out[1]!.pos).toEqual([d, 0, 0]);
    }
  });

  it('a pinned end half-corrects per pass, exactly like stepRig', () => {
    // a pinned: only b moves, by half the excess.
    const outA = relaxRopeConstraints([pt(0, 0, 0, true), pt(1)], [{ a: 0, b: 1, max: 0.5 }]);
    expect(outA[0]!.pos).toEqual([0, 0, 0]);
    expect(outA[1]!.pos).toEqual([0.75, 0, 0]);
    // b pinned: only a moves, toward b, by half the excess.
    const outB = relaxRopeConstraints([pt(0), pt(1, 0, 0, true)], [{ a: 0, b: 1, max: 0.5 }]);
    expect(outB[1]!.pos).toEqual([1, 0, 0]);
    expect(outB[0]!.pos).toEqual([0.25, 0, 0]);
    // both pinned: nothing can move.
    const outC = relaxRopeConstraints(
      [pt(0, 0, 0, true), pt(1, 0, 0, true)],
      [{ a: 0, b: 1, max: 0.5 }],
    );
    expect(outC[0]!.pos).toEqual([0, 0, 0]);
    expect(outC[1]!.pos).toEqual([1, 0, 0]);
  });

  it('preserves prev (verlet history) and pinned flags, and never mutates input', () => {
    const pts = [pt(0, 1, 0), pt(1, 1, 0, true)];
    const before = JSON.stringify(pts);
    const out = relaxRopeConstraints(pts, [{ a: 0, b: 1, max: 0.2 }]);
    expect(JSON.stringify(pts)).toBe(before);
    expect(out[0]!.prev).toEqual([0, 1, 0]); // untouched by the correction
    expect(out[0]!.pinned).toBe(false);
    expect(out[1]!.pinned).toBe(true);
  });

  it('handles multiple ropes in one SEQUENTIAL pass (a shared point moves twice)', () => {
    // Rope A (0↔1, max 1) half-splits its 1 m excess: 0→0.5, 2→1.5.
    // Rope B (1↔2, max 1) then sees 1.5↔5 (3.5 m) and half-splits again:
    // 1.5→2.75, 5→3.75. Still over max — by design: one pass per frame,
    // after stepRig; full satisfaction accumulates over frames.
    const out = relaxRopeConstraints(
      [pt(0), pt(2), pt(5)],
      [
        { a: 0, b: 1, max: 1 },
        { a: 1, b: 2, max: 1 },
      ],
    );
    expect(out[0]!.pos[0]).toBeCloseTo(0.5, 12);
    expect(out[1]!.pos[0]).toBeCloseTo(2.75, 12);
    expect(out[2]!.pos[0]).toBeCloseTo(3.75, 12);
  });

  it('skips invalid indices and non-positive maxes without throwing', () => {
    const out = relaxRopeConstraints(
      [pt(0), pt(1)],
      [{ a: 99, b: 0, max: 1 }, { a: 0, b: 1, max: 0 }, { a: -1, b: 0, max: 1 }],
    );
    expect(out[0]!.pos).toEqual([0, 0, 0]);
    expect(out[1]!.pos).toEqual([1, 0, 0]);
  });
});

describe('collapseRopes — the real body', () => {
  const body = buildBody(makeZombie());
  const bound = bindRig(body);
  const names = jointNamesForBody(body);
  const ropes = collapseRopes(names, bound.rig.restPose);
  const byPair = (a: string, b: string) =>
    ropes.find(r => names[r.a] === a && names[r.b] === b);

  it('builds all 8 ropes (anchors, bend keepers, splay keepers)', () => {
    expect(ropes.length).toBe(8);
    for (const want of [
      ['hipL', 'hips'], ['hipR', 'hips'],
      ['hipL', 'footL'], ['hipR', 'footR'],
      ['shoulderL', 'handL'], ['shoulderR', 'handR'],
      ['hipL', 'hipR'], ['shoulderL', 'shoulderR'],
    ]) {
      expect(byPair(want[0]!, want[1]!)).toBeDefined();
    }
  });

  it('max distances are rest distance × the documented slack factors', () => {
    expect(byPair('hipL', 'hips')!.max).toBeCloseTo(0.100 * T.anchorSlack, 3);
    expect(byPair('hipL', 'footL')!.max).toBeCloseTo(0.820 * T.legSlack, 3);
    expect(byPair('shoulderL', 'handL')!.max).toBeCloseTo(0.595 * T.armSlack, 3);
    expect(byPair('hipL', 'hipR')!.max).toBeCloseTo(0.200 * T.splay, 3);
    expect(byPair('shoulderL', 'shoulderR')!.max).toBeCloseTo(0.400 * T.splay, 3);
  });

  it('leg/arm ropes allow the joint to BEND (strictly inside full extension)', () => {
    // The load-bearing property: an equality constraint at full length would
    // forbid bending (the prior attempt's trap). Each rope max must sit
    // strictly between the triangle-inequality bounds of its bone chain.
    const bounds = (a: GaitJointName, mid: GaitJointName, b: GaitJointName) => {
      const rest = bound.rig.restPose;
      const d = (x: GaitJointName, y: GaitJointName) =>
        len(sub(rest[names.indexOf(x)]!, rest[names.indexOf(y)]!));
      const l1 = d(a, mid);
      const l2 = d(mid, b);
      return { min: Math.abs(l1 - l2), max: l1 + l2 };
    };
    const legL = bounds('hipL', 'kneeL', 'footL');
    expect(byPair('hipL', 'footL')!.max).toBeGreaterThan(legL.min);
    expect(byPair('hipL', 'footL')!.max).toBeLessThan(legL.max);
    const armL = bounds('shoulderL', 'elbowL', 'handL');
    expect(byPair('shoulderL', 'handL')!.max).toBeGreaterThan(armL.min);
    expect(byPair('shoulderL', 'handL')!.max).toBeLessThan(armL.max);
  });

  it('skips ropes whose joints are absent from the body', () => {
    const partial = collapseRopes(['hips', 'hipL', 'kneeL'], [
      [0, 1, 0], [0.1, 1, 0], [0.1, 0.6, 0],
    ]);
    expect(partial.length).toBe(1); // only the hipL↔hips anchor
    expect(partial[0]!.max).toBeCloseTo(0.1 * T.anchorSlack, 12);
  });
});

describe('COLLAPSE_TUNING — ground feel mirrors the chunk stepper', () => {
  // gib-chunks.ts keeps RESTITUTION/FLOOR_FRICTION module-private; these
  // measure them through observable stepChunk behavior so the mirrors can't
  // silently drift (the collapse header says: import once exported).
  const DT = 1 / 60;
  const chunk = makeChunk('armL', [0, 0, 0], [1, -2, 0], 0.1, [1, 0, 0], () => 0);
  const air = stepChunk({ ...chunk, pos: [0, 10, 0] }, DT); // control, airborne
  const hitFloor = stepChunk({ ...chunk }, DT); // y=0 < radius → contact

  it('groundRestitution matches the chunk rebound ratio', () => {
    expect(hitFloor.vel[1] / -air.vel[1]).toBeCloseTo(T.groundRestitution, 10);
  });

  it('groundFriction matches the chunk horizontal bleed per contact frame', () => {
    expect(hitFloor.vel[0] / air.vel[0]).toBeCloseTo(T.groundFriction, 10);
  });
});

describe('collapse — determinism', () => {
  it('identical runs are bit-identical', () => {
    const runOnce = () => {
      let st = makeCollapseState();
      const out = [];
      for (let i = 0; i < 200; i++) {
        const step = stepCollapse(st, sig({
          wounds: i % 30 === 0 ? [wound('pellet')] : [],
          severed: i === 100 ? ['armR'] : [],
          missing: i >= 60 ? ONE_LEG : NONE_MISSING,
          forced: i === 150,
          ropes: [{ a: 0, b: 1, max: 0.5 }],
        }), DT);
        st = step.state;
        out.push(step);
      }
      return out;
    };
    expect(JSON.stringify(runOnce())).toBe(JSON.stringify(runOnce()));
  });

  it('does not mutate the input state', () => {
    const st = makeCollapseState();
    const snap = JSON.stringify(st);
    stepCollapse(st, sig({ wounds: [wound('blast')], severed: ['legL'], forced: true }), DT);
    expect(JSON.stringify(st)).toBe(snap);
  });

  it('dt = 0 advances nothing but still processes the signal', () => {
    const step = stepCollapse(makeCollapseState(), sig({ wounds: [wound('pellet')] }), 0);
    expect(step.state.meter).toBeCloseTo(WOUND_PROFILES.pellet.radius, 12);
    expect(step.state.fallAge).toBe(0);
    const forced = stepCollapse(makeCollapseState(), sig({ forced: true }), 0);
    expect(forced.phase).toBe('falling');
    expect(forced.state.fallAge).toBe(0);
  });
});
