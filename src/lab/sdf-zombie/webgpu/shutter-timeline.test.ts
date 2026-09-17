// src/lab/sdf-zombie/webgpu/shutter-timeline.test.ts
//
// Tests for the identity-preserving shutter timeline. The critical properties
// the plan's exit gate names are here: births/deaths/contacts are preserved,
// a REUSED SLOT cannot inherit the dead particle's history, a particle with no
// history in the window cannot generate a spurious long vector, and recording
// the same seed twice is identical. No GPU, no wall clock.

import { describe, it, expect } from 'vitest';
import { createBloodSim, burst, stepBlood, type BloodSim, type Droplet } from '../blood-sim';
import { recordTimeline, particlesAt, eventsInRange, frameIndexAt } from './shutter-timeline';

function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function droplet(over: Partial<Droplet> = {}): Droplet {
  return {
    pos: [0, 5, 0], vel: [0, 0, 0], age: 0, life: 100, size: 0.1, kind: 'drop',
    ...over,
  } as Droplet;
}

describe('shutter timeline — recording contract', () => {
  it('records fixed-cadence frames from t=0 with exact timestamps', () => {
    const sim = createBloodSim();
    const rng = seeded(1);
    sim.droplets.push(droplet());
    const tl = recordTimeline({ dt: 1 / 120, duration: 0.5, sim, step: (dt) => stepBlood(sim, dt, rng) });
    expect(tl.frames.length).toBe(61);
    expect(tl.frames[0]!.t).toBe(0);
    expect(tl.frames[1]!.t).toBeCloseTo(1 / 120, 12);
    expect(tl.toT).toBeCloseTo(0.5, 12);
    expect(tl.dt).toBe(1 / 120);
  });

  it('assigns a stable identity to a surviving particle and reports one birth', () => {
    const sim = createBloodSim();
    const rng = seeded(2);
    sim.droplets.push(droplet());
    const tl = recordTimeline({ dt: 1 / 120, duration: 0.25, sim, step: (dt) => stepBlood(sim, dt, rng) });
    const ids = new Set(tl.frames.flatMap(f => f.particles.map(p => p.id)));
    expect(ids.size).toBe(1);
    expect(tl.events.filter(e => e.kind === 'birth').length).toBe(1);
    expect(tl.particleCount).toBe(1);
  });

  it('records a floor contact for a droplet removed at the floor', () => {
    const sim = createBloodSim();
    const rng = seeded(3);
    sim.droplets.push(droplet({ pos: [0, 0.03, 0], vel: [0, -5, 0] }));
    const tl = recordTimeline({ dt: 1 / 60, duration: 0.1, sim, step: (dt) => stepBlood(sim, dt, rng) });
    const contacts = tl.events.filter(e => e.kind === 'floor');
    expect(contacts.length).toBe(1);
    expect(contacts[0]!.pos[1]).toBeLessThanOrEqual(0.03);
  });

  it('distinguishes expiry and eviction from a floor contact', () => {
    // Expiry: high above the floor when its life runs out.
    const simA = createBloodSim();
    simA.droplets.push(droplet({ pos: [0, 4, 0], life: 0.01, age: 0 }));
    const tlA = recordTimeline({ dt: 1 / 60, duration: 0.1, sim: simA, step: (dt) => stepBlood(simA, dt, seeded(4)) });
    expect(tlA.events.filter(e => e.kind === 'expiry').length).toBe(1);

    // Eviction: removed while alive and airborne (the MAX_DROPLETS shift path).
    const simB = createBloodSim();
    simB.droplets.push(droplet({ pos: [0, 4, 0], life: 100 }));
    let tick = 0;
    const tlB = recordTimeline({
      dt: 1 / 60, duration: 1 / 60, sim: simB,
      step: () => { tick++; if (tick === 1) simB.droplets.splice(0, 1); },
    });
    expect(tlB.events.filter(e => e.kind === 'evicted').length).toBe(1);
  });

  it('keeps identity even for particles that existed before the stored window', () => {
    const sim = createBloodSim();
    const rng = seeded(5);
    sim.droplets.push(droplet());
    const tl = recordTimeline({
      dt: 1 / 60, duration: 0.25, keepFrom: 0.2, sim,
      step: (dt) => stepBlood(sim, dt, rng),
    });
    expect(tl.frames[0]!.t).toBeCloseTo(0.2, 9);
    // The single birth happened at t=0, before the window; it is recorded but
    // the particle is NOT re-reported as a window birth.
    const windowBirths = eventsInRange(tl, tl.keepFrom, tl.toT).filter(e => e.kind === 'birth');
    expect(windowBirths.length).toBe(0);
    expect(tl.particleCount).toBe(1);
  });
});

describe('shutter timeline — interpolation and spurious-vector guards', () => {
  it('linearly interpolates a surviving particle and flags it', () => {
    const sim = createBloodSim();
    sim.droplets.push(droplet({ pos: [0, 5, 0], vel: [2, 0, 0] }));
    // Constant-velocity drag-free step keeps the arithmetic exact.
    const tl = recordTimeline({
      dt: 1, duration: 1, sim,
      step: () => { const d = sim.droplets[0]!; d.pos[0] += 2; d.pos[1] += 0; d.age += 1; },
    });
    const mid = particlesAt(tl, 0.5);
    expect(mid.length).toBe(1);
    expect(mid[0]!.pos[0]).toBeCloseTo(1, 9);
    expect(mid[0]!.interpolated).toBe(true);
    // At an exact frame time the snapshot is returned, not re-lerped.
    const exact = particlesAt(tl, 1);
    expect(exact[0]!.pos[0]).toBeCloseTo(2, 9);
  });

  it('excludes a particle born between two snapshots (no long spurious vector)', () => {
    const sim = createBloodSim();
    let tick = 0;
    const tl = recordTimeline({
      dt: 1, duration: 1, sim,
      step: () => { tick++; if (tick === 1) sim.droplets.push(droplet({ pos: [0, 3, 0], vel: [100, 0, 0] })); },
    });
    // The droplet is in the t=1 frame only; at t=0.9 it has no history.
    expect(particlesAt(tl, 0.9).length).toBe(0);
    expect(particlesAt(tl, 1).length).toBe(1);
  });

  it('a reused slot gets a new id and cannot inherit the dead particle history', () => {
    const sim = createBloodSim();
    sim.droplets.push(droplet({ pos: [0, 5, 0], vel: [0, 0, 0] }));
    let tick = 0;
    const tl = recordTimeline({
      dt: 1, duration: 1, sim,
      step: () => {
        tick++;
        if (tick === 1) {
          // Replace the ONLY slot with a new droplet far away and fast.
          sim.droplets.splice(0, 1);
          sim.droplets.push(droplet({ pos: [50, 5, 0], vel: [500, 0, 0] }));
        }
      },
    });
    const ids = tl.frames.flatMap(f => f.particles.map(p => p.id));
    expect(new Set(ids).size).toBe(2);
    // Between the frames neither particle is present in both: no vector at all.
    expect(particlesAt(tl, 0.5).length).toBe(0);
    // And the removed id is recorded as a removal, not teleported.
    const death = tl.events.find(e => e.kind !== 'birth');
    expect(death).toBeDefined();
    expect(Math.hypot(death!.pos[0], death!.pos[1], death!.pos[2])).toBeLessThan(10);
  });

  it('reports contacts in the window and clamps outside it', () => {
    const sim = createBloodSim();
    const rng = seeded(6);
    sim.droplets.push(droplet({ pos: [0, 0.02, 0], vel: [0, -2, 0] }));
    const tl = recordTimeline({ dt: 1 / 120, duration: 0.2, sim, step: (dt) => stepBlood(sim, dt, rng) });
    expect(eventsInRange(tl, 0, 0.1).length).toBeGreaterThan(0);
    expect(eventsInRange(tl, 10, 20).length).toBe(0);
  });

  it('clamps a sample before the first frame to the first frame', () => {
    const sim = createBloodSim();
    sim.droplets.push(droplet());
    const tl = recordTimeline({ dt: 1, duration: 1, sim, step: () => {} });
    expect(particlesAt(tl, -5).length).toBe(1);
    expect(particlesAt(tl, 99).length).toBe(1);
    expect(frameIndexAt(tl.frames, -1)).toBe(-1);
  });
});

describe('shutter timeline — production emitters and determinism', () => {
  const run = () => {
    const sim: BloodSim = createBloodSim();
    const rng = seeded(12345);
    burst(sim, [0, 1.35, 0.55], rng);
    return recordTimeline({
      dt: 1 / 120, duration: 5.0, sim,
      step: (dt) => stepBlood(sim, dt, rng),
    });
  };

  it('records the production burst with real births and contacts', () => {
    const tl = run();
    // GIB_BURST.count is 10 (src/game/gibs/tuning.ts) — pin the production count.
    expect(tl.particleCount).toBe(10);
    expect(tl.frames.length).toBe(601);
    expect(tl.events.filter(e => e.kind === 'birth').length).toBe(10);
    // Burst droplets fall to the floor within 1 s.
    expect(tl.events.some(e => e.kind === 'floor' || e.kind === 'expiry')).toBe(true);
  });

  it('is bit-reproducible from the same seed', () => {
    const a = run();
    const b = run();
    expect(a.particleCount).toBe(b.particleCount);
    expect(a.frames.length).toBe(b.frames.length);
    expect(a.frames[60]!.particles.length).toBe(b.frames[60]!.particles.length);
    for (const [i, pa] of a.frames[60]!.particles.entries()) {
      const pb = b.frames[60]!.particles[i]!;
      expect(pa.id).toBe(pb.id);
      expect(pa.pos).toEqual(pb.pos);
      expect(pa.vel).toEqual(pb.vel);
    }
    expect(a.events.length).toBe(b.events.length);
  });

  it('does not depend on how many times it is sampled (timeline is immutable)', () => {
    const tl = run();
    const before = JSON.stringify(tl.frames[60]!.particles);
    particlesAt(tl, 0.5);
    particlesAt(tl, 0.7);
    expect(JSON.stringify(tl.frames[60]!.particles)).toBe(before);
  });
});
