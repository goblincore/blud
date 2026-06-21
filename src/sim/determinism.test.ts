// src/sim/determinism.test.ts
import { describe, it, expect } from 'vitest';
import { createSimState, type SimState } from './state';
import { stepSim } from './step';
import { hashSimState } from './hash';
import { cloneSimState } from './snapshot';
import { randomInt } from './rng';
import type { InputCommand } from './types';

/** A deterministic recorded input stream (varied movement/aim/buttons). */
function recordedInputs(n: number): InputCommand[] {
  const out: InputCommand[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      moveForward: (i % 3) - 1,
      moveStrafe: (i % 2) === 0 ? 1 : -1,
      aimAngle: (i * 37) % 2048,
      buttons: i % 5 === 0 ? 1 : 0,
    });
  }
  return out;
}

/** Seed a state with a few bodies + draw some rng so the hash is non-trivial. */
function seededState(seed: number): SimState {
  const s = createSimState(seed);
  for (let i = 0; i < 4; i++) {
    s.bodies.push({
      x: i * 100, y: 1000, z: -i * 50,
      vx: randomInt(s.rng, 7) - 3,
      vy: -randomInt(s.rng, 4),
      vz: randomInt(s.rng, 7) - 3,
    });
  }
  return s;
}

describe('determinism harness', () => {
  it('two independent states on the same seed + inputs hash-match every tic', () => {
    const inputs = recordedInputs(300);
    const a = seededState(2026);
    const b = seededState(2026);
    expect(hashSimState(a)).toBe(hashSimState(b)); // identical seeding
    for (let t = 0; t < inputs.length; t++) {
      stepSim(a, inputs[t]!);
      stepSim(b, inputs[t]!);
      expect(hashSimState(a)).toBe(hashSimState(b)); // identical EVERY tic
    }
  });

  it('recorded-input replay reproduces the exact final hash', () => {
    const inputs = recordedInputs(300);
    const run = (): number => {
      const s = seededState(2026);
      for (const cmd of inputs) stepSim(s, cmd);
      return hashSimState(s);
    };
    expect(run()).toBe(run());
  });

  it('mid-run snapshot + resume reproduces the same final hash', () => {
    const inputs = recordedInputs(200);
    const live = seededState(7);
    for (let t = 0; t < 100; t++) stepSim(live, inputs[t]!);
    const snap = cloneSimState(live);              // save at tic 100
    for (let t = 100; t < 200; t++) stepSim(live, inputs[t]!);
    const liveHash = hashSimState(live);
    for (let t = 100; t < 200; t++) stepSim(snap, inputs[t]!); // resume from snapshot
    expect(hashSimState(snap)).toBe(liveHash);
  });

  it('a different seed diverges (sanity: the hash actually depends on sim)', () => {
    const inputs = recordedInputs(50);
    const a = seededState(1);
    const b = seededState(2);
    for (const cmd of inputs) { stepSim(a, cmd); stepSim(b, cmd); }
    expect(hashSimState(a)).not.toBe(hashSimState(b));
  });
});
