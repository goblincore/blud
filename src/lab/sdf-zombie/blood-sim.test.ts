import { describe, it, expect } from 'vitest';
import {
  createBloodSim, burst, emitTrails, stepBlood, addScraps, SCRAP_TUNING,
  spawnWoundDroplets, WOUND_BLEED,
} from './blood-sim';
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

describe('blood-sim scraps (gobs-and-goo §1)', () => {
  const scraps = [
    { pos: [1, 1.2, 0] as [number, number, number], size: 0.08 },
    { pos: [-0.5, 1.0, 0.8] as [number, number, number], size: 0.06 },
    { pos: [0.2, 0.9, -1.1] as [number, number, number], size: 0.10 },
  ];

  it('addScraps spawns kind:"scrap" droplets at the scrap positions with 6s life', () => {
    const sim = createBloodSim();
    addScraps(sim, scraps, [0, 1, 0], seeded(21));
    expect(sim.droplets).toHaveLength(scraps.length);
    for (let i = 0; i < scraps.length; i++) {
      const d = sim.droplets[i]!;
      expect(d.kind).toBe('scrap');
      expect(d.pos).toEqual(scraps[i]!.pos);
      expect(d.size).toBeCloseTo(scraps[i]!.size, 9);
      expect(d.life).toBeCloseTo(SCRAP_TUNING.lifetimeSec, 5);
      expect(SCRAP_TUNING.lifetimeSec).toBe(6);
    }
  });

  it('existing emitters default to kind:"drop"', () => {
    const sim = createBloodSim();
    burst(sim, [0, 1, 0], seeded(2));
    emitTrails(sim, [{ id: 1, pos: [0, 2, 0], vel: [256, 0, 0] }], 0.06, seeded(3));
    for (const d of sim.droplets) expect(d.kind).toBe('drop');
  });

  it('launches scraps radially at HALF the burst speed band with an up-bias', () => {
    const sim = createBloodSim();
    addScraps(sim, scraps, [0, 1, 0], seeded(5));
    for (const d of sim.droplets) {
      // The radial (horizontal) launch speed is the half-band roll itself;
      // the up-bias rides on top as a positive vertical term.
      const horiz = Math.hypot(d.vel[0], d.vel[2]);
      expect(horiz).toBeGreaterThanOrEqual(0.5 * GIB_BURST.speedMin - 1e-9);
      expect(horiz).toBeLessThanOrEqual(0.5 * GIB_BURST.speedMax + 1e-9);
      expect(d.vel[1]).toBeGreaterThan(0);
    }
    // Radial-away from the body centre: scrap 0 sits +x of origin, scrap 1
    // sits -x/+z — their launches must point outward, not at random azimuths.
    expect(sim.droplets[0]!.vel[0]).toBeGreaterThan(0);
    expect(sim.droplets[1]!.vel[0]).toBeLessThan(0);
    expect(sim.droplets[1]!.vel[2]).toBeGreaterThan(0);
  });

  it('scraps stamp splats SCRAP_TUNING.splatScale (2.2x) wider than droplets', () => {
    const drop = createBloodSim();
    const scrap = createBloodSim();
    // Identical trajectories and rng stream — only the kind differs, so the
    // stamp rng draws line up 1:1 and only the size multiplier shows.
    drop.droplets.push({ pos: [0, 0.5, 0], vel: [0, 0, 0], age: 0, life: 1 / 60, size: 0.05, kind: 'drop' });
    scrap.droplets.push({ pos: [0, 0.5, 0], vel: [0, 0, 0], age: 0, life: 1 / 60, size: 0.05, kind: 'scrap' });
    stepBlood(drop, 1 / 60, seeded(11));
    stepBlood(scrap, 1 / 60, seeded(11));
    expect(drop.splats.length).toBeGreaterThan(0);
    expect(scrap.splats).toHaveLength(drop.splats.length);
    expect(SCRAP_TUNING.splatScale).toBe(2.2);
    for (let i = 0; i < drop.splats.length; i++) {
      expect(scrap.splats[i]!.size).toBeCloseTo(drop.splats[i]!.size * SCRAP_TUNING.splatScale, 5);
    }
  });

  it('scraps integrate with 2x the drag', () => {
    const sim = createBloodSim();
    sim.droplets.push({ pos: [0, 2, 0], vel: [4, 0, 0], age: 0, life: 10, size: 0.05, kind: 'drop' });
    sim.droplets.push({ pos: [0, 2, 0], vel: [4, 0, 0], age: 0, life: 10, size: 0.08, kind: 'scrap' });
    stepBlood(sim, 1 / 60, seeded(1)); // nothing dies this step — rng untouched
    const d = sim.droplets[0]!;
    const s = sim.droplets[1]!;
    expect(d.vel[0]).toBeCloseTo(4 * (1 - BLOOD_TRAIL.airdrag / 60), 9);
    expect(SCRAP_TUNING.dragMul).toBe(2);
    expect(s.vel[0]).toBeCloseTo(4 * (1 - (BLOOD_TRAIL.airdrag * SCRAP_TUNING.dragMul) / 60), 9);
  });

  it('addScraps + integration is deterministic under a fixed seed', () => {
    const a = createBloodSim();
    const b = createBloodSim();
    addScraps(a, scraps, [0, 1, 0], seeded(33));
    addScraps(b, scraps, [0, 1, 0], seeded(33));
    for (let i = 0; i < 600; i++) { stepBlood(a, 1 / 60, seeded(9)); stepBlood(b, 1 / 60, seeded(9)); }
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('wound bleed emitters (bleeding-wounds spec, 2026-08-31)', () => {
  const ANCHOR: [number, number, number] = [1, 1.2, 0.5];
  const NORMAL: [number, number, number] = [0, 1, 0];

  /** Steps one fresh emitter for `secs` at 60 Hz, returns droplet count. */
  function emitFor(kind: 'pellet' | 'slug' | 'stump', secs: number, seed = 11): number {
    const sim = createBloodSim();
    let acc = 0;
    const rng = seeded(seed);
    const steps = Math.round(secs * 60);
    for (let i = 0; i < steps; i++) {
      acc = spawnWoundDroplets(sim, kind, i / 60, ANCHOR, NORMAL, 1 / 60, acc, rng);
    }
    return sim.droplets.length;
  }

  it('pellet oozes a small PINNED count over its 2 s life at a constant low rate', () => {
    expect(WOUND_BLEED.pellet.lifetimeSec).toBe(2);
    expect(WOUND_BLEED.pellet.tailHz).toBe(WOUND_BLEED.pellet.baseHz); // constant
    // Pinned exact: the fractional accumulator must land 7 Hz x 2 s = 14
    // spawns; drift of even one droplet means the carry logic is broken.
    expect(emitFor('pellet', 2)).toBe(14);
  });

  it('slug spurt is front-loaded: most of its droplets in the first second', () => {
    expect(WOUND_BLEED.slug.lifetimeSec).toBeGreaterThanOrEqual(6);
    expect(WOUND_BLEED.slug.lifetimeSec).toBeLessThanOrEqual(8);
    const first = emitFor('slug', 1);
    const total = emitFor('slug', 8); // past the 6 s life: spawn fn already dead
    expect(first).toBeGreaterThan(total - first); // strict majority up front
    expect(total).toBeGreaterThan(first); // and the drip keeps contributing
  });

  it('stump gushes MORE in total than the slug, and arcs (high speed band)', () => {
    expect(emitFor('stump', 10)).toBeGreaterThan(emitFor('slug', 6));
    expect(WOUND_BLEED.stump.speedMax).toBeGreaterThan(WOUND_BLEED.slug.speedMax);
    expect(WOUND_BLEED.stump.speedMin).toBeGreaterThan(WOUND_BLEED.slug.speedMin);
  });

  it('every kind hits ZERO spawns after its lifetime (2 s / 6 s / 10 s)', () => {
    const sim = createBloodSim();
    let acc = 0;
    const rng = seeded(4);
    for (let i = 0; i < 60 * 12; i++) {
      acc = spawnWoundDroplets(sim, 'pellet', i / 60, ANCHOR, NORMAL, 1 / 60, acc, rng);
    }
    expect(sim.droplets.length).toBe(14); // nothing beyond the pinned 2 s count
    expect(spawnWoundDroplets(sim, 'slug', 6.01, ANCHOR, NORMAL, 1 / 60, 0, rng)).toBe(0);
    expect(spawnWoundDroplets(sim, 'stump', 10.01, ANCHOR, NORMAL, 1 / 60, 0, rng)).toBe(0);
    expect(sim.droplets.length).toBe(14); // and nothing spawned above
  });

  it('same seed + same step sequence => identical droplet counts AND positions', () => {
    const run = () => {
      const sim = createBloodSim();
      let acc = 0;
      const rng = seeded(77);
      for (let i = 0; i < 60 * 3; i++) {
        acc = spawnWoundDroplets(sim, 'stump', i / 60, ANCHOR, NORMAL, 1 / 60, acc, rng);
        stepBlood(sim, 1 / 60, seeded(5));
      }
      return sim;
    };
    const a = run(); const b = run();
    expect(JSON.stringify(a.droplets)).toBe(JSON.stringify(b.droplets));
    expect(a.droplets.length).toBe(b.droplets.length);
    expect(a.droplets.length).toBeGreaterThan(0);
  });

  it('spawned velocities lie within the cone around the passed normal', () => {
    const sim = createBloodSim();
    const rng = seeded(31);
    const n: [number, number, number] = [0.6, 0.8, 0];
    let acc = 0;
    for (let i = 0; i < 60; i++) {
      acc = spawnWoundDroplets(sim, 'stump', i / 60, ANCHOR, n, 1 / 60, acc, rng);
    }
    const bound = Math.cos(WOUND_BLEED.stump.coneRad);
    expect(sim.droplets.length).toBeGreaterThan(30);
    for (const d of sim.droplets) {
      const l = Math.hypot(d.vel[0], d.vel[1], d.vel[2]);
      const dot = (d.vel[0] * n[0] + d.vel[1] * n[1] + d.vel[2] * n[2]) / l;
      expect(dot).toBeGreaterThanOrEqual(bound - 1e-9);
    }
  });

  it('wound droplets are mist beads (kind "drop") in the per-kind size band', () => {
    const sim = createBloodSim();
    const rng = seeded(17);
    let acc = 0;
    for (let i = 0; i < 30; i++) {
      acc = spawnWoundDroplets(sim, 'stump', i / 60, ANCHOR, NORMAL, 1 / 60, acc, rng);
    }
    for (const d of sim.droplets) {
      expect(d.kind).toBe('drop');
      expect(d.size).toBeGreaterThanOrEqual(WOUND_BLEED.stump.sizeMin - 1e-9);
      expect(d.size).toBeLessThanOrEqual(WOUND_BLEED.stump.sizeMax + 1e-9);
    }
  });

  it('spawning past MAX_DROPLETS recycles oldest and never grows', () => {
    const sim = createBloodSim();
    const rng = seeded(3);
    for (let i = 0; i < 700; i++) {
      spawnWoundDroplets(sim, 'stump', 0, ANCHOR, NORMAL, 1 / 60, 0, rng); // 1 droplet/fresh call
    }
    expect(sim.droplets.length).toBe(600);
    for (let i = 0; i < 100; i++) {
      spawnWoundDroplets(sim, 'stump', 0, ANCHOR, NORMAL, 1 / 60, 0, rng);
    }
    expect(sim.droplets.length).toBe(600); // FIFO cap, no growth
  });

  it('the fractional accumulator carries: a carry of 0.9 emits on the next step', () => {
    const sim = createBloodSim();
    const acc = spawnWoundDroplets(sim, 'stump', 0, ANCHOR, NORMAL, 1 / 600, 0.95, seeded(2));
    expect(sim.droplets.length).toBe(1); // 0.95 + 90/600 = 1.1 -> one spawn
    expect(acc).toBeCloseTo(0.1, 9);
  });
});
