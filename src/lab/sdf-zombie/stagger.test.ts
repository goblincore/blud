// src/lab/sdf-zombie/stagger.test.ts
//
// Spec §4 units: profile scaling (flinch/lurch/shudder), decay to zero, the
// blast's gait-phase knock + recovery-step window, supersession, and
// determinism. All exact-float assertions are pinned to STAGGER_TUNING so
// retuning breaks loudly here rather than silently in the lab.
import { describe, it, expect } from 'vitest';
import {
  STAGGER_TUNING,
  makeStaggerState,
  stepStagger,
  type StaggerHit,
  type StaggerStep,
} from './stagger';
import type { WoundType } from './damage';
import type { Vec3 } from './types';
import { len } from './vec';

const T = STAGGER_TUNING;
const DT = 1 / 60;

const FWD: Vec3 = [0, 0, 1]; // body-local forward (see gait.ts axes)
const LEFT: Vec3 = [-1, 0, 0];

const hit = (type: WoundType, dir: Vec3 = FWD): StaggerHit => ({ type, dir });

/** Steps `frames` times feeding `hits[i]` on frame i (null = no hit). */
function runHits(hits: (StaggerHit | null)[], seed = 7, dt = DT, frames?: number): StaggerStep[] {
  let st = makeStaggerState(seed);
  const n = frames ?? hits.length;
  const out: StaggerStep[] = [];
  for (let i = 0; i < n; i++) {
    const step = stepStagger(st, { hit: hits[i] ?? null }, dt);
    st = step.state;
    out.push(step);
  }
  return out;
}

/** One hit on frame 0, then calm — the canonical single-reaction run. */
function run(type: WoundType, seconds: number, seed = 7, dir: Vec3 = FWD): StaggerStep[] {
  return runHits([hit(type, dir)], seed, DT, Math.round(seconds / DT));
}

const maxRoot = (steps: StaggerStep[]): number => Math.max(...steps.map(s => len(s.rootOffset)));

describe('stagger — calm', () => {
  it('stays inert with no hits', () => {
    const steps = runHits([null, null, null, null, null]);
    for (const s of steps) {
      expect(s.staggered).toBe(false);
      expect(s.recoveryStep).toBe(false);
      expect(s.phaseKnock).toBe(0);
      expect(s.rootOffset).toEqual([0, 0, 0]);
      expect(s.offsets).toEqual({});
      expect(s.state.kind).toBeNull();
      expect(s.state.age).toBe(0);
    }
  });
});

describe('stagger — pellet flinch', () => {
  const beatFrames = Math.ceil(T.flinchBeat / DT); // 0.24 s → 15 frames

  it('fires on the hit frame and ends after one beat', () => {
    const steps = run('pellet', 0.5);
    expect(steps[0]!.staggered).toBe(true);
    expect(steps[0]!.state.kind).toBe('flinch');
    // age advances from the hit frame; the reaction ends once age ≥ beat.
    expect(steps[beatFrames - 2]!.staggered).toBe(true);
    expect(steps[beatFrames - 1]!.staggered).toBe(false);
    expect(steps[beatFrames - 1]!.state.kind).toBeNull();
  });

  it('peaks at the tuning amplitude along the shot direction', () => {
    const steps = run('pellet', 0.5);
    // Envelope peaks at u = 0.5 (frame ~7 of 0.24 s); normalized so the
    // peak root displacement is exactly flinchAmp × flinchRootScale.
    expect(maxRoot(steps)).toBeCloseTo(T.flinchAmp * T.flinchRootScale, 3);
    // Follows the shot direction (body-local forward).
    const peak = steps.reduce((a, b) => (len(a.rootOffset) > len(b.rootOffset) ? a : b));
    expect(peak.rootOffset[2]).toBeGreaterThan(0);
    expect(Math.abs(peak.rootOffset[0])).toBeLessThan(1e-9);
    expect(Math.abs(peak.rootOffset[1])).toBeLessThan(1e-9);
  });

  it('twitches shoulders/chest harder than the root, and touches nothing else', () => {
    const steps = run('pellet', 0.5);
    const peak = steps.reduce((a, b) => (len(a.rootOffset) > len(b.rootOffset) ? a : b));
    expect(peak.offsets.shoulderL).toBeDefined();
    expect(peak.offsets.shoulderR).toBeDefined();
    expect(peak.offsets.chest).toBeDefined();
    // Shoulder twitch = full amplitude; root only carries flinchRootScale.
    expect(len(peak.offsets.shoulderL!)).toBeCloseTo(T.flinchAmp, 3);
    expect(len(peak.offsets.chest!)).toBeCloseTo(T.flinchAmp * T.flinchChestScale, 3);
    // Composition contract: missing keys = zero offset (gait adds the rest).
    expect(peak.offsets.neck).toBeUndefined();
    expect(peak.offsets.hipL).toBeUndefined();
    expect(peak.offsets.footR).toBeUndefined();
  });

  it('decays to exactly zero by the end of the beat', () => {
    const steps = run('pellet', 0.5);
    for (let i = beatFrames - 1; i < steps.length; i++) {
      expect(steps[i]!.staggered).toBe(false);
      expect(steps[i]!.rootOffset).toEqual([0, 0, 0]);
      expect(steps[i]!.offsets).toEqual({});
    }
  });

  it('never requests a recovery step or a gait-phase knock', () => {
    for (const s of run('pellet', 0.5)) {
      expect(s.recoveryStep).toBe(false);
      expect(s.phaseKnock).toBe(0);
    }
  });
});

describe('stagger — blast lurch', () => {
  const durFrames = Math.round((T.lurchDecay * 5) / DT); // 1.0 s → 60 frames

  it('lurches along the shot for ~1 s, then is calm', () => {
    const steps = run('blast', 1.2);
    expect(steps[0]!.state.kind).toBe('lurch');
    expect(steps[durFrames - 2]!.staggered).toBe(true);
    expect(steps[durFrames - 1]!.staggered).toBe(false);
    expect(steps[durFrames - 1]!.state.kind).toBeNull();
    // Root displacement is directional...
    expect(steps[0]!.rootOffset[2]).toBeGreaterThan(0);
    // ...and reverses with the shot.
    const back = run('blast', 0.2, 7, [-1, 0, -1]);
    expect(back[0]!.rootOffset[2]).toBeLessThan(0);
    expect(back[0]!.rootOffset[0]).toBeLessThan(0);
  });

  it('peaks at exactly lurchAmp (normalised attack-decay envelope)', () => {
    const steps = run('blast', 1.2);
    expect(maxRoot(steps)).toBeCloseTo(T.lurchAmp, 3);
    // Every frame is bounded by the peak.
    for (const s of steps) expect(len(s.rootOffset)).toBeLessThanOrEqual(T.lurchAmp + 1e-9);
  });

  it('carries the upper body with the root (lurchUpperScale share)', () => {
    const steps = run('blast', 1.2);
    const s = steps[3]!;
    expect(s.offsets.chest![2]).toBeCloseTo(s.rootOffset[2] * T.lurchUpperScale, 5);
    expect(s.offsets.head![2]).toBeCloseTo(s.rootOffset[2] * T.lurchUpperScale, 5);
    expect(s.offsets.handL![2]).toBeCloseTo(s.rootOffset[2] * T.lurchUpperScale, 5);
    // Legs stay out of it — the lurch is torso+arms.
    expect(s.offsets.hipL).toBeUndefined();
    expect(s.offsets.footL).toBeUndefined();
  });

  it('requests one recovery-step window mid-lurch', () => {
    const steps = run('blast', 1.2);
    const at = (t: number) => steps[Math.round(t / DT)]!;
    expect(at(0.05).recoveryStep).toBe(false); // before the window
    expect(at(T.recoveryStepAt).recoveryStep).toBe(true); // window opens
    expect(at(T.recoveryStepAt + T.recoveryStepDur - DT).recoveryStep).toBe(true);
    expect(at(T.recoveryStepAt + T.recoveryStepDur).recoveryStep).toBe(false); // closes
    // Exactly one contiguous window across the whole lurch.
    const opens = steps.filter((s, i) => s.recoveryStep && !(i > 0 && steps[i - 1]!.recoveryStep));
    expect(opens.length).toBe(1);
  });

  it('knocks the gait phase out of sync and recovers to zero over ~1 s', () => {
    const steps = run('blast', 1.2);
    // Full strength right after impact (quadratic ease-out from the max)...
    expect(steps[0]!.phaseKnock).toBeCloseTo(T.phaseKnockMax * (1 - DT) ** 2, 6);
    // ...sign follows the shot's body-local x...
    const left = run('blast', 0.2, 7, LEFT);
    expect(left[0]!.phaseKnock).toBeLessThan(0);
    // ...monotonically shrinking in magnitude...
    for (let i = 1; i < durFrames - 1; i++) {
      expect(Math.abs(steps[i]!.phaseKnock)).toBeLessThanOrEqual(Math.abs(steps[i - 1]!.phaseKnock) + 1e-12);
    }
    // ...to exactly zero when the lurch ends (phaseKnockTime = lurch duration).
    expect(T.phaseKnockTime).toBeCloseTo(T.lurchDecay * 5, 12);
    expect(steps[durFrames - 1]!.phaseKnock).toBe(0);
    expect(Math.abs(steps[durFrames - 2]!.phaseKnock)).toBeLessThan(1e-3);
  });
});

describe('stagger — burn shudder', () => {
  const durFrames = Math.round((T.shudderDecay * 5) / DT); // 0.7 s → 42 frames

  it('shudders along the shot axis and dies down after 5·shudderDecay', () => {
    const steps = run('burn', 1.0);
    expect(steps[0]!.state.kind).toBe('shudder');
    expect(steps[durFrames - 2]!.staggered).toBe(true);
    expect(steps[durFrames - 1]!.staggered).toBe(false);
    const s = steps[5]!;
    expect(Math.abs(s.offsets.chest![2])).toBeGreaterThan(0);
    expect(Math.abs(s.rootOffset[2])).toBeCloseTo(
      Math.abs(s.offsets.chest![2]) * T.shudderRootScale, 5,
    );
  });

  it('oscillates at the tremor frequency (sign flips within a couple of periods)', () => {
    const steps = run('burn', 1.0);
    // 13 frames ≈ 0.217 s ≈ 2.4 periods at shudderFreq — both signs guaranteed.
    const first13 = steps.slice(0, 13).map(s => s.offsets.chest![2]);
    expect(first13.some(v => v > 1e-6)).toBe(true);
    expect(first13.some(v => v < -1e-6)).toBe(true);
    // Sign flips per second ≈ 2·shudderFreq (count zero crossings, allow slack
    // for the seeded phase and frame sampling).
    const vals = steps.slice(0, durFrames - 1).map(s => s.offsets.chest![2]);
    let flips = 0;
    for (let i = 1; i < vals.length; i++) {
      if (Math.sign(vals[i]!) !== Math.sign(vals[i - 1]!) && Math.abs(vals[i]!) > 1e-9) flips++;
    }
    expect(flips).toBeGreaterThan(2 * T.shudderFreq * 0.5);
  });

  it('stays bounded by shudderAmp while active, zero after', () => {
    for (const s of run('burn', 1.0)) {
      if (!s.staggered) {
        expect(s.offsets.chest).toBeUndefined();
        continue;
      }
      expect(Math.abs(s.offsets.chest![2])).toBeLessThanOrEqual(T.shudderAmp + 1e-9);
      expect(len(s.rootOffset)).toBeLessThanOrEqual(T.shudderAmp * T.shudderRootScale + 1e-9);
    }
  });

  it('no phase knock or recovery step', () => {
    for (const s of run('burn', 1.0)) {
      expect(s.phaseKnock).toBe(0);
      expect(s.recoveryStep).toBe(false);
    }
  });
});

describe('stagger — supersession', () => {
  it('blast during flinch escalates and restarts the clock', () => {
    const steps = runHits([hit('pellet'), hit('blast'), null]);
    expect(steps[0]!.state.kind).toBe('flinch');
    expect(steps[1]!.state.kind).toBe('lurch');
    expect(steps[1]!.state.age).toBeCloseTo(DT, 12); // restarted, aged one frame
  });

  it('blast during shudder escalates', () => {
    const steps = runHits([hit('burn'), hit('blast'), null]);
    expect(steps[0]!.state.kind).toBe('shudder');
    expect(steps[1]!.state.kind).toBe('lurch');
  });

  it('pellet during lurch is ignored — clock and direction keep going', () => {
    const steps = runHits([hit('blast', LEFT), hit('pellet'), null]);
    expect(steps[1]!.state.kind).toBe('lurch');
    expect(steps[1]!.state.age).toBeCloseTo(2 * DT, 12); // NOT restarted
    expect(steps[1]!.rootOffset[0]).toBeLessThan(0); // still the blast direction
  });

  it('burn during lurch is ignored', () => {
    const steps = runHits([hit('blast'), hit('burn'), null]);
    expect(steps[1]!.state.kind).toBe('lurch');
    expect(steps[1]!.state.age).toBeCloseTo(2 * DT, 12);
  });

  it('equal severity restarts with the new direction (re-blasts re-lurch)', () => {
    const diag: Vec3 = [-1, 0, 1]; // from the left, slightly from behind
    const steps = runHits([hit('blast', FWD), hit('blast', diag), null]);
    expect(steps[1]!.state.kind).toBe('lurch');
    expect(steps[1]!.state.age).toBeCloseTo(DT, 12); // restarted
    expect(steps[1]!.rootOffset[0]).toBeLessThan(0); // new direction
    expect(steps[1]!.rootOffset[2]).toBeGreaterThan(0);
  });

  it('continuous pellet fire keeps re-flinching', () => {
    const hits = Array.from({ length: 20 }, () => hit('pellet'));
    const steps = runHits(hits);
    for (const s of steps) {
      expect(s.staggered).toBe(true);
      expect(s.state.kind).toBe('flinch');
    }
  });
});

describe('stagger — determinism + purity', () => {
  it('identical inputs produce bit-identical steps', () => {
    const a = run('blast', 1.2, 123);
    const b = run('blast', 1.2, 123);
    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i++) expect(a[i]).toEqual(b[i]);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('different seeds shudder out of phase', () => {
    const a = run('burn', 0.5, 1);
    const b = run('burn', 0.5, 2);
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });

  it('does not mutate the input state', () => {
    const st = makeStaggerState(9);
    const snapshot = JSON.stringify(st);
    stepStagger(st, { hit: hit('blast', LEFT) }, DT);
    stepStagger(st, { hit: null }, DT);
    expect(JSON.stringify(st)).toBe(snapshot);
  });

  it('dt = 0 freezes the reaction at age 0 (still live, zero output)', () => {
    const step = stepStagger(makeStaggerState(3), { hit: hit('blast') }, 0);
    expect(step.state.kind).toBe('lurch');
    expect(step.state.age).toBe(0);
    expect(step.staggered).toBe(true);
    expect(step.rootOffset).toEqual([0, 0, 0]); // envelope is 0 at age 0
  });
});

describe('stagger — tuning sanity', () => {
  it('the blast reaction displaces the most (the headline escalation)', () => {
    expect(T.lurchAmp).toBeGreaterThan(T.shudderAmp);
    expect(T.lurchAmp).toBeGreaterThan(T.flinchAmp);
    // The tremor is a smaller displacement than the flinch twitch — severity
    // ordering in the module is about reaction TYPE, not raw amplitude.
    expect(T.shudderAmp).toBeGreaterThan(0);
    expect(T.flinchAmp).toBeGreaterThan(T.shudderAmp);
  });

  it('reaction durations are the documented 5τ of their decay constants', () => {
    expect(T.lurchDecay * 5).toBeCloseTo(1.0, 12); // spec §4: recovers over ~1 s
    expect(T.shudderDecay * 5).toBeGreaterThan(0);
    expect(T.flinchBeat).toBeGreaterThan(0);
  });
});

describe('stagger — gain knob (game hits; default leaves the lab bit-identical)', () => {
  it('defaults to the tuned amplitudes: gain-less == gain 1, state carries 1', () => {
    expect(makeStaggerState(7).gain).toBe(1);
    const plain = runHits([hit('blast'), ...Array(20).fill(null)]);
    const one = runHits([{ type: 'blast', dir: FWD, gain: 1 }, ...Array(20).fill(null)]);
    for (let i = 0; i < plain.length; i++) {
      expect(plain[i]!.rootOffset).toEqual(one[i]!.rootOffset);
      expect(plain[i]!.offsets).toEqual(one[i]!.offsets);
      expect(plain[i]!.state.gain).toBe(1);
    }
  });

  it('scales the whole reaction: gain 2 doubles the lurch peak', () => {
    const steps = runHits([{ type: 'blast', dir: FWD, gain: 2 }], 7, DT, 60);
    expect(maxRoot(steps)).toBeCloseTo(T.lurchAmp * 2, 3);
    const peak = steps.reduce((a, b) => (len(b.rootOffset) > len(a.rootOffset) ? b : a));
    expect(peak.offsets.chest![2]).toBeCloseTo(peak.rootOffset[2] * T.lurchUpperScale, 5);
  });

  it('persists for the whole reaction, resets on expiry, clamps negatives', () => {
    const steps = runHits([{ type: 'pellet', dir: FWD, gain: 3 }, ...Array(30).fill(null)]);
    const beatFrames = Math.ceil(T.flinchBeat / DT);
    for (let i = 0; i < beatFrames - 1; i++) expect(steps[i]!.state.gain).toBe(3);
    expect(steps[beatFrames - 1]!.state.gain).toBe(1); // expired — reset
    const neg = runHits([{ type: 'pellet', dir: FWD, gain: -5 }], 7, DT, 4);
    expect(maxRoot(neg)).toBeCloseTo(0, 9); // clamped to 0 → inert shove
    expect(neg[0]!.state.gain).toBe(0);
  });
});
