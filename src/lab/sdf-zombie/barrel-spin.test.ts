// src/lab/sdf-zombie/barrel-spin.test.ts
import { describe, it, expect } from 'vitest';
import { BARREL_REST, BARREL_SPIN, INDEX_REST, LAUNCHER_INDEX, barrelsDriven, stepBarrelIndex, stepBarrelSpin } from './barrel-spin';
import { CHAINGUN_TUNING } from './soldier-brain';

const run = (driven: boolean, sec: number, from = BARREL_REST) => {
  let s = from;
  for (let t = 0; t < sec - 1e-9; t += 1 / 60) s = stepBarrelSpin(s, driven, 1 / 60);
  return s;
};

describe('barrel spin', () => {
  it('reaches full speed inside the spin-up telegraph, before the first round', () => {
    expect(BARREL_SPIN.spinUpSec).toBeLessThan(CHAINGUN_TUNING.aimSec);
    expect(run(true, CHAINGUN_TUNING.aimSec).rate).toBe(BARREL_SPIN.maxRate);
  });
  it('coasts down after the burst and comes to rest', () => {
    const full = run(true, 2);
    const half = run(false, BARREL_SPIN.spinDownSec / 2, full);
    expect(half.rate).toBeGreaterThan(0);
    expect(half.rate).toBeLessThan(full.rate);
    expect(run(false, BARREL_SPIN.spinDownSec + 0.1, full).rate).toBe(0);
  });
  it('turns the barrels and keeps the angle wrapped', () => {
    const s = run(true, 3);
    expect(s.angle).toBeGreaterThanOrEqual(0);
    expect(s.angle).toBeLessThan(Math.PI * 2);
    expect(run(true, 0.1).angle).toBeGreaterThan(0);
    expect(stepBarrelSpin(BARREL_REST, false, 1 / 60)).toEqual(BARREL_REST);
  });
  it('is driven by the aim telegraph and the stream, not by idling or settling', () => {
    for (const s of ['aim', 'fire', 'recover']) expect(barrelsDriven(s)).toBe(true);
    for (const s of ['idle', 'engage', 'settle', 'stagger', 'pursue']) expect(barrelsDriven(s)).toBe(false);
  });
});

describe('launcher barrel index', () => {
  it('turns one tube (a third of a turn) per rocket and settles on it', () => {
    let s = stepBarrelIndex(INDEX_REST, true, 1 / 60);
    for (let i = 0; i < 30; i++) s = stepBarrelIndex(s, false, 1 / 60);
    expect(s.angle).toBeCloseTo(LAUNCHER_INDEX.step, 6);
    // Three rockets: a full turn, always forward.
    let prev = s.angle;
    for (let k = 0; k < 2; k++) {
      s = stepBarrelIndex(s, true, 1 / 60);
      for (let i = 0; i < 30; i++) { s = stepBarrelIndex(s, false, 1 / 60); expect(s.angle).toBeGreaterThanOrEqual(prev); prev = s.angle; }
    }
    expect(s.angle).toBeCloseTo(Math.PI * 2, 6);
  });

  it('comes round in about a fifth of a second, inside the volley spacing', () => {
    let s = stepBarrelIndex(INDEX_REST, true, 1 / 60), t = 1 / 60;
    while (s.angle < s.target - 1e-9) { s = stepBarrelIndex(s, false, 1 / 60); t += 1 / 60; }
    expect(t).toBeCloseTo(LAUNCHER_INDEX.step / LAUNCHER_INDEX.rate, 1);
    expect(t).toBeLessThan(0.4);
  });
});
