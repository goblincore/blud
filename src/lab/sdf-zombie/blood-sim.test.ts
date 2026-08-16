import { describe, it, expect } from 'vitest';
import { createBloodSim, burst, emitTrails, stepBlood } from './blood-sim';
import { BLOOD_TRAIL, GIB_BURST } from '../../game/gibs/tuning';

function seeded(seed = 1): () => number {
  let s = seed;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

describe('blood-sim', () => {
  it('burst spawns GIB_BURST.count droplets inside the game speed band', () => {
    const sim = createBloodSim();
    burst(sim, [0, 1, 0], seeded());
    expect(sim.droplets).toHaveLength(GIB_BURST.count);
    for (const d of sim.droplets) {
      const speed = Math.hypot(...d.vel);
      expect(speed).toBeGreaterThanOrEqual(GIB_BURST.speedMin * 0.9);
      expect(speed).toBeLessThanOrEqual(GIB_BURST.speedMax * 1.8); // + up-bias
      expect(d.life).toBeCloseTo(GIB_BURST.lifetimeSec, 5);
    }
  });

  it('burst droplets are trail-sized beads, not orbs (0.03..0.06 m)', () => {
    const sim = createBloodSim();
    burst(sim, [0, 1, 0], seeded(3));
    expect(sim.droplets.length).toBeGreaterThan(0);
    for (const d of sim.droplets) {
      // Lab plays closer than the game camera: burst drops read as small
      // beads, half the old 0.05..0.10 orb band.
      expect(d.size).toBeGreaterThanOrEqual(0.03);
      expect(d.size).toBeLessThanOrEqual(0.06);
    }
  });

  it('trails emit at BLOOD_TRAIL.emitHz per source with 1/256 vel inheritance', () => {
    const sim = createBloodSim();
    const src = [{ id: 1, pos: [0, 2, 0] as [number, number, number], vel: [256, 0, 0] as [number, number, number] }];
    emitTrails(sim, src, 1.0, seeded()); // one full second
    expect(sim.droplets.length).toBe(Math.floor(BLOOD_TRAIL.emitHz));
    // Inheritance base is exact (256 * 1/256 = 1); the emitter adds bounded
    // per-axis jitter of ±0.2 on top, so assert within the jitter bound rather
    // than toBeCloseTo — a dropped velScale would land ~0.8 outside it.
    const v0 = sim.droplets[0]!.vel[0];
    expect(Math.abs(v0 - 256 * BLOOD_TRAIL.velScale)).toBeLessThanOrEqual(0.2 + 1e-9);
  });

  it('droplets fall, die on the floor, and stamp splats', () => {
    const sim = createBloodSim();
    burst(sim, [0, 0.5, 0], seeded());
    for (let i = 0; i < 600; i++) stepBlood(sim, 1 / 60, seeded(7));
    expect(sim.droplets).toHaveLength(0);
    expect(sim.splats.length).toBeGreaterThanOrEqual(GIB_BURST.count);
  });

  it('is deterministic under a fixed seed', () => {
    const a = createBloodSim(); const b = createBloodSim();
    burst(a, [0, 1, 0], seeded(42)); burst(b, [0, 1, 0], seeded(42));
    for (let i = 0; i < 60; i++) { stepBlood(a, 1 / 60, seeded(5)); stepBlood(b, 1 / 60, seeded(5)); }
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('caps droplets and splats FIFO', () => {
    const sim = createBloodSim();
    for (let i = 0; i < 100; i++) burst(sim, [0, 1, 0], seeded(i + 1));
    expect(sim.droplets.length).toBeLessThanOrEqual(600);
    for (let i = 0; i < 2000; i++) stepBlood(sim, 1 / 60, seeded(9));
    expect(sim.splats.length).toBeLessThanOrEqual(256);
  });
});
