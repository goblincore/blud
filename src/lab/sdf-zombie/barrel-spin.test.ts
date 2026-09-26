// src/lab/sdf-zombie/barrel-spin.test.ts
import { describe, it, expect } from 'vitest';
import { BARREL_REST, BARREL_SPIN, barrelsDriven, stepBarrelSpin } from './barrel-spin';
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
