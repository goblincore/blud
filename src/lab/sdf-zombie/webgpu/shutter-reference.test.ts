// src/lab/sdf-zombie/webgpu/shutter-reference.test.ts
//
// Pure tests for the sampled-reference contract: the box sample plan, the
// selected/static split, the normalized premultiplied average, and the
// projection parity probe. No GPU.

import { describe, it, expect } from 'vitest';
import { createBloodSim, type Droplet, type BloodSim } from '../blood-sim';
import {
  SHUTTER_REFERENCES, DEFAULT_SHUTTER_SAMPLES, planShutterSamples,
  classifyDroplet, isSelectedForShutter, simFromParticles, splitSimForShutter,
  movingSimAt, accumulatePremultiplied, averagePremultiplied, averageSamples,
  compositeOverScene, projectWorldToPixel, referenceBudget, PREMUL_ZERO,
  MAX_REFERENCE_PARTICLES,
} from './shutter-reference';
import { recordTimeline, type ParticleState } from './shutter-timeline';
import { stepBlood, burst } from '../blood-sim';

function droplet(over: Partial<Droplet> = {}): Droplet {
  return {
    pos: [0, 5, 0], vel: [0, 0, 0], age: 0, life: 100, size: 0.1, kind: 'drop',
    ...over,
  } as Droplet;
}

function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('shutter reference — selection and honest availability', () => {
  it('lists sharp, sampled and an explicitly unavailable efficient candidate', () => {
    expect(SHUTTER_REFERENCES.map(r => r.id)).toEqual(['sharp', 'sampled', 'efficient']);
    expect(SHUTTER_REFERENCES.find(r => r.id === 'sampled')!.implemented).toBe(true);
    // The efficient candidate must never be aliased to a real implementation.
    expect(SHUTTER_REFERENCES.find(r => r.id === 'efficient')!.implemented).toBe(false);
    expect(DEFAULT_SHUTTER_SAMPLES).toBeGreaterThan(0);
  });

  it('classifies droplets into the exact stage-1 categories', () => {
    expect(classifyDroplet(droplet({ kind: 'drop' }))).toBe('airborne');
    expect(classifyDroplet(droplet({ kind: 'scrap' }))).toBe('scrap');
    expect(classifyDroplet(droplet({ kind: 'mist' }))).toBe('mist');
    expect(classifyDroplet(droplet({ kind: 'gut' }))).toBe('gut');
    expect(isSelectedForShutter(droplet({ kind: 'drop' }))).toBe(true);
    expect(isSelectedForShutter(droplet({ kind: 'scrap' }))).toBe(true);
    // Mist and gut are NOT selected: mist is the separate fine-spray switch,
    // gut is static chain-owned geometry.
    expect(isSelectedForShutter(droplet({ kind: 'mist' }))).toBe(false);
    expect(isSelectedForShutter(droplet({ kind: 'gut' }))).toBe(false);
  });

  it('splits moving blood from static pools/guts and drops the moving pool splats', () => {
    const sim: BloodSim = createBloodSim();
    sim.droplets.push(droplet({ kind: 'drop' }));
    sim.droplets.push(droplet({ kind: 'scrap' }));
    sim.droplets.push(droplet({ kind: 'mist' }));
    sim.droplets.push(droplet({ kind: 'gut' }));
    sim.splats.push({ pos: [0, 0, 0], size: 0.2, yaw: 0 });
    const { moving, staticSim } = splitSimForShutter(sim);
    expect(moving.droplets.map(d => d.kind).sort()).toEqual(['drop', 'scrap']);
    expect(moving.splats.length).toBe(0);
    expect(staticSim.droplets.map(d => d.kind).sort()).toEqual(['gut', 'mist']);
    expect(staticSim.splats.length).toBe(1);
    // The split copies state; mutating a copy must not touch the live sim.
    moving.droplets[0]!.pos[0] = 99;
    expect(sim.droplets.find(d => d.kind === 'drop')!.pos[0]).toBe(0);
  });
});

describe('shutter reference — box sample plan', () => {
  it('returns no samples when exposure is off (sharp frame is the truth)', () => {
    const plan = planShutterSamples(1.0, 0, 8);
    expect(plan.sampleCount).toBe(0);
    expect(plan.sampleTimes).toEqual([]);
    expect(plan.sampleWeight).toBe(0);
    expect(plan.from).toBe(plan.to);
  });

  it('places N equal-weight midpoint samples across [now-exposure, now]', () => {
    const now = 1.0;
    const exposure = 1 / 60;
    const plan = planShutterSamples(now, exposure, 4);
    expect(plan.sampleCount).toBe(4);
    expect(plan.sampleWeight).toBe(0.25);
    expect(plan.from).toBeCloseTo(now - exposure, 12);
    expect(plan.to).toBe(now);
    const step = exposure / 4;
    plan.sampleTimes.forEach((t, i) => {
      expect(t).toBeCloseTo(plan.from + step * (i + 0.5), 12);
      expect(t).toBeGreaterThan(plan.from);
      expect(t).toBeLessThanOrEqual(plan.to);
    });
    expect(plan.sampleTimes.length * plan.sampleWeight).toBeCloseTo(1, 12);
  });

  it('clamps the sample count to the budget', () => {
    expect(planShutterSamples(1, 1 / 30, 0).sampleCount).toBe(1);
    expect(planShutterSamples(1, 1 / 30, 100000).sampleCount).toBeLessThanOrEqual(64);
  });

  it('reports the reference work budget with the plan equation streak', () => {
    const plan = planShutterSamples(1, 1 / 60, 8);
    const b = referenceBudget(plan, 100, 600);
    expect(b.samples).toBe(8);
    expect(b.particlesPerSample).toBe(100);
    expect(b.shadeSamples).toBe(800);
    expect(b.streakPx).toBeCloseTo(10, 10);
    const capped = referenceBudget(plan, 100000, 600);
    expect(capped.particlesPerSample).toBe(MAX_REFERENCE_PARTICLES);
  });
});

describe('shutter reference — normalized premultiplied averaging', () => {
  it('accumulates then divides all four channels', () => {
    const a = accumulatePremultiplied({ ...PREMUL_ZERO }, { r: 0.2, g: 0, b: 0, a: 0.5 });
    const b = accumulatePremultiplied(a, { r: 0.1, g: 0.2, b: 0.3, a: 0.25 });
    const avg = averagePremultiplied(b, 2);
    expect(avg.r).toBeCloseTo(0.15, 12);
    expect(avg.g).toBeCloseTo(0.1, 12);
    expect(avg.b).toBeCloseTo(0.15, 12);
    expect(avg.a).toBeCloseTo(0.375, 12);
  });

  it('composites over scene as scene*(1-a) + rgb, keeping background weight', () => {
    // Uncovered pixel: background unchanged.
    expect(compositeOverScene([0.4, 0.4, 0.4], { ...PREMUL_ZERO })).toEqual([0.4, 0.4, 0.4]);
    // Fully covered: background gone, premultiplied colour survives.
    expect(compositeOverScene([0.4, 0.4, 0.4], { r: 0.2, g: 0, b: 0, a: 1 })).toEqual([0.2, 0, 0]);
    // Half covered: exactly half the background plus the premultiplied colour.
    const out = compositeOverScene([1, 1, 1], { r: 0.1, g: 0, b: 0, a: 0.5 });
    expect(out[0]).toBeCloseTo(0.6, 12);
    expect(out[1]).toBeCloseTo(0.5, 12);
  });

  it('does NOT double-count two overlapping samples of the same coverage', () => {
    // Two samples each covering a pixel with coverage 0.5 must average to 0.5,
    // not clamp to 1 and not multiply background by 0. This is the property
    // that separates a premultiplied average from accumulating density.
    const avg = averageSamples([
      { r: 0.1, g: 0, b: 0, a: 0.5 },
      { r: 0.1, g: 0, b: 0, a: 0.5 },
    ]);
    expect(avg.a).toBeCloseTo(0.5, 12);
    expect(avg.r).toBeCloseTo(0.1, 12);
    const out = compositeOverScene([1, 1, 1], avg);
    expect(out[0]).toBeCloseTo(0.6, 12);
  });

  it('returns zero for a zero/invalid sample count', () => {
    expect(averagePremultiplied({ r: 1, g: 1, b: 1, a: 1 }, 0).a).toBe(0);
    expect(averagePremultiplied({ r: 1, g: 1, b: 1, a: 1 }, Number.NaN).r).toBe(0);
  });
});

describe('shutter reference — projection parity (asymmetric fixture)', () => {
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

  it('maps +world-x to +screen-x and does not mirror', () => {
    const right = projectWorldToPixel([1, 0, 0], identity, 800, 600)!;
    const left = projectWorldToPixel([-1, 0, 0], identity, 800, 600)!;
    const centre = projectWorldToPixel([0, 0, 0], identity, 800, 600)!;
    expect(right[0]).toBeCloseTo(800, 6);
    expect(left[0]).toBeCloseTo(0, 6);
    expect(centre[0]).toBeCloseTo(400, 6);
    expect(right[0]).toBeGreaterThan(centre[0]);
  });

  it('maps +world-y upward (smaller screen y) and rejects behind-camera points', () => {
    const up = projectWorldToPixel([0, 1, 0], identity, 800, 600)!;
    expect(up[1]).toBeCloseTo(0, 6);
    // A w <= 0 point is behind the eye.
    const behind = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -1, 0];
    expect(projectWorldToPixel([0, 0, 1], behind, 800, 600)).toBeNull();
  });

  it('keeps the obstacle at +x on the right half of the frame', () => {
    const px = projectWorldToPixel([0.75, 1.0, -0.35], identity, 800, 600)!;
    expect(px[0]).toBeGreaterThan(400);
  });
});

describe('shutter reference — timeline reconstruction', () => {
  it('reconstructs only selected moving droplets (no pools) at a sample time', () => {
    const sim = createBloodSim();
    const rng = seeded(7);
    sim.droplets.push(droplet({ kind: 'drop', pos: [0, 5, 0] }));
    sim.droplets.push(droplet({ kind: 'gut', pos: [1, 1, 0] }));
    sim.splats.push({ pos: [0, 0, 0], size: 0.2, yaw: 0 });
    const tl = recordTimeline({ dt: 1 / 120, duration: 0.1, sim, step: (dt) => stepBlood(sim, dt, rng) });
    const scratch = movingSimAt(tl, 0.05);
    expect(scratch.droplets.length).toBe(1);
    expect(scratch.droplets[0]!.kind).toBe('drop');
    expect(scratch.splats.length).toBe(0);
  });

  it('reconstructs a sim from arbitrary particle states with material fields intact', () => {
    const particles: ParticleState[] = [{
      id: 3, kind: 'scrap', pos: [1, 2, 3], vel: [4, 5, 6], size: 0.25,
      age: 0.5, life: 6, ribbon: false, stream: 9, interpolated: true,
    }];
    const out = simFromParticles(particles, [{ pos: [0, 0, 0], size: 0.1, yaw: 1 }]);
    expect(out.droplets.length).toBe(1);
    expect(out.droplets[0]!.kind).toBe('scrap');
    expect(out.droplets[0]!.size).toBe(0.25);
    expect(out.droplets[0]!.stream).toBe(9);
    expect(out.splats.length).toBe(1);
  });

  it('produces the same sampled positions for two timelines of the same seed', () => {
    const make = () => {
      const sim = createBloodSim();
      const rng = seeded(4242);
      burst(sim, [0, 1.35, 0.55], rng);
      return recordTimeline({ dt: 1 / 120, duration: 0.6, sim, step: (dt) => stepBlood(sim, dt, rng) });
    };
    const a = movingSimAt(make(), 0.3).droplets.map(d => [...d.pos]);
    const b = movingSimAt(make(), 0.3).droplets.map(d => [...d.pos]);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(0);
  });
});
