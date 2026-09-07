// src/lab/sdf-zombie/webgpu/enemy-mind.test.ts
import { describe, it, expect } from 'vitest';
import { makeZombieMind, makeSoldierMind, type MindInput } from './enemy-mind';
import { SOLDIER_TUNING } from '../soldier-brain';
import { BRAIN_TUNING } from '../brain';

/** The soldier's preferred range, derived so a retune cannot rot the fixture —
 *  see soldier-brain.test.ts's note. Zombie pursuit uses its own range below. */
const MID = SOLDIER_TUNING.preferredRange;

const DT = 1 / 60;

function mindInput(over: Partial<MindInput> = {}): MindInput {
  return {
    dt: DT,
    self: { x: 0, z: 0, yaw: 0, room: 3 },
    player: { x: 0, z: MID, room: 3 },
    alerted: false,
    hasToken: false,
    drift: 0,
    roll: 1,
    rollDrift: 0,
    ...over,
  };
}

describe('makeZombieMind', () => {
  it('wraps stepBrain and reports the zombie vocabulary in debug', () => {
    const m = makeZombieMind();
    const out = m.step(mindInput({
      player: { x: 0, z: BRAIN_TUNING.engageRange + 0.4, room: 3 },
    }));
    expect(out.attack).toBeNull();
    expect(out.fire).toBe(false);
    expect(out.faceHeading).toBeNull();
    expect(m.debug().state).toBe('pursue');
    expect(m.debug().side).toBe('R');
  });

  it('exposes engaged and committed, which the melee ring needs', () => {
    const m = makeZombieMind();
    const out = m.step(mindInput());
    expect(typeof out.engaged).toBe('boolean');
    expect(typeof out.committed).toBe('boolean');
  });

  it('staggers synchronously', () => {
    const m = makeZombieMind();
    m.step(mindInput());
    m.stagger();
    expect(m.debug().state).toBe('stagger');
    expect(m.step(mindInput()).halt).toBe(true);
  });
});

describe('makeSoldierMind', () => {
  it('never emits an attack, and is never engaged or committed', () => {
    const m = makeSoldierMind();
    const out = m.step(mindInput());
    expect(out.attack).toBeNull();
    expect(out.engaged).toBe(false);
    expect(out.committed).toBe(false);
  });

  it('engages and reports the soldier vocabulary in debug', () => {
    const m = makeSoldierMind();
    m.step(mindInput());
    expect(m.debug().state).toBe('engage');
    expect(m.debug().aimT).toBe(0);
  });

  it('surfaces faceHeading while aiming', () => {
    const m = makeSoldierMind();
    let out = m.step(mindInput({ roll: 0 }));
    for (let t = 0; t < 2 && m.debug().state !== 'aim'; t += DT) {
      out = m.step(mindInput({ roll: 0 }));
    }
    expect(m.debug().state).toBe('aim');
    expect(out.faceHeading).toBeCloseTo(0, 6);
    expect(out.halt).toBe(true);
  });

  it('staggers synchronously', () => {
    const m = makeSoldierMind();
    m.step(mindInput());
    m.stagger();
    expect(m.debug().state).toBe('stagger');
    expect(m.step(mindInput()).halt).toBe(true);
  });
});
