// src/lab/sdf-zombie/sword-swing.test.ts
import { describe, it, expect } from 'vitest';
import { makeBrain, stepBrain, BRAIN_TUNING, type Brain, type BrainTuning } from './brain';

const TEST_TUNING: BrainTuning = {
  ...BRAIN_TUNING,
  meleeRadius: 1.8,
  engageRange: 3.2,
  releaseRange: 3.8,
  lungeBand: { min: 2.2, max: 3.1 },
  pickVariant: (roll) => (roll < 0.5 ? 'cleave' : 'sweep'),
  swingSecFor: { cleave: 1.25, sweep: 0.9, lunge: 1.0 },
};

/** Step an alert brain holding a token, player at `dist` m straight ahead. */
function swingAt(dist: number, roll: number) {
  let brain: Brain = { ...makeBrain(), alert: true, state: 'engage' };
  const out = stepBrain(brain, {
    dt: 1 / 60, self: { x: 0, z: 0, yaw: 0, room: 1 }, player: { x: 0, z: dist, room: 1 },
    alerted: false, hasToken: true, drift: 0, roll,
  }, TEST_TUNING);
  brain = out.brain;
  return out;
}

describe('BrainTuning — sword extensions', () => {
  it('picks the variant through pickVariant inside reach', () => {
    expect(swingAt(1.5, 0.2).attack?.variant).toBe('cleave');
    expect(swingAt(1.5, 0.8).attack?.variant).toBe('sweep');
  });

  it('lunges inside the lunge band, beyond reach', () => {
    expect(swingAt(2.6, 0.2).attack?.variant).toBe('lunge');
  });

  it('does not swing outside both', () => {
    expect(swingAt(3.15, 0.2).attack).toBeNull();
  });

  it('times the swing by swingSecFor', () => {
    let out = swingAt(1.5, 0.2);        // cleave starts, phase 0
    out = stepBrain(out.brain, {
      dt: 0.625, self: { x: 0, z: 0, yaw: 0, room: 1 }, player: { x: 0, z: 1.5, room: 1 },
      alerted: false, hasToken: true, drift: 0, roll: 0.2,
    }, TEST_TUNING);
    expect(out.attack?.phase).toBeCloseTo(0.5, 5); // 0.625 / 1.25
  });
});
