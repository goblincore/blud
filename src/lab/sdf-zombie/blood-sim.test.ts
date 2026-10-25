import { describe, it, expect } from 'vitest';
import {
  createBloodSim, burst, emitTrails, stepBlood, addScraps, SCRAP_TUNING,
  spawnWoundDroplets, WOUND_BLEED, TRAIL_HIST, spawnImpactGout, IMPACT_GOUT, burstVolume, VOLUME_BURST,
} from './blood-sim';
import type { Vec3 } from './types';
import type { Droplet } from './blood-sim';
import type { CurlFlow } from './curl-sample';
import type { DebrisGround } from './debris-ground';
import { BLOOD_TRAIL, GIB_BURST } from '../../game/gibs/tuning';

function seeded(seed = 1): () => number {
  let s = seed;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

describe('blood-sim', () => {
  it('burstVolume: the full burst by default; a scaled one has fewer, slower drops', () => {
    const full = createBloodSim();
    burstVolume(full, [0, 1.7, 0], 0.06, [0, 0.4, 0], seeded());
    expect(full.droplets).toHaveLength(VOLUME_BURST.drops + VOLUME_BURST.scraps);
    const half = createBloodSim();
    burstVolume(half, [0, 1.7, 0], 0.06, [0, 0.4, 0], seeded(), undefined, { count: 0.4, speed: 0.5 });
    expect(half.droplets).toHaveLength(Math.round(VOLUME_BURST.drops * 0.4) + Math.round(VOLUME_BURST.scraps * 0.4));
    const maxSpeed = (sim: typeof full) => Math.max(...sim.droplets.map(d => Math.hypot(d.vel[0], d.vel[1] - 0.4, d.vel[2])));
    expect(maxSpeed(half)).toBeLessThanOrEqual(VOLUME_BURST.speedMax * 0.5 * 1.3 + 1e-9);
    expect(maxSpeed(full)).toBeGreaterThan(VOLUME_BURST.speedMax * 0.5);
  });

  it('burstVolume seat (sector levels): floorY on every drop, each start clamped, the RNG stream untouched', () => {
    const plain = createBloodSim();
    burstVolume(plain, [0, 1.7, 0], 0.25, [1.5, 0.5, 0], seeded(3), 9);
    const empty = createBloodSim();
    burstVolume(empty, [0, 1.7, 0], 0.25, [1.5, 0.5, 0], seeded(3), 9, undefined, {});
    expect(empty.droplets).toEqual(plain.droplets);                      // an empty seat is the shipped burst
    const seated = createBloodSim();
    const wall = 0.05;                                                   // a wall at x = 0.05: starts stay short of it
    burstVolume(seated, [0, 1.7, 0], 0.25, [1.5, 0.5, 0], seeded(3), 9, undefined,
      { floorY: 0.5, clamp: (p) => [Math.min(p[0], wall), p[1], p[2]] });
    expect(seated.droplets).toHaveLength(plain.droplets.length);
    expect(plain.droplets.some((d) => d.pos[0] > wall)).toBe(true);     // the volume did reach past it
    for (const [i, d] of seated.droplets.entries()) {
      expect(d.floorY).toBe(0.5);
      expect(d.pos[0]).toBeLessThanOrEqual(wall);
      const p = plain.droplets[i]!;
      expect(d.vel).toEqual(p.vel);                                      // same draws, same order
      expect(d.size).toBe(p.size);
      expect([d.pos[1], d.pos[2]]).toEqual([p.pos[1], p.pos[2]]);
    }
  });

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

  /** Mist rides every bead (mistPerDrop each), so droplet totals split by
   *  kind: beads() is the pinned bleed rate, mist is beads * mistPerDrop. */
  const beads = (sim: { droplets: { kind: string }[] }) =>
    sim.droplets.filter(d => d.kind === 'drop').length;

  it('pellet oozes a small PINNED count over its 2 s life at a constant low rate', () => {
    expect(WOUND_BLEED.pellet.lifetimeSec).toBe(2);
    expect(WOUND_BLEED.pellet.tailHz).toBe(WOUND_BLEED.pellet.baseHz); // constant
    // Pinned exact: the fractional accumulator must land 7 Hz x 2 s = 14
    // spawns; drift of even one droplet means the carry logic is broken.
    // emitFor counts ALL droplets; each pellet bead brings mistPerDrop mist.
    // Pinned to the TABLE, not a literal: the rate is a look knob and has
    // moved once already (density round). The ideal is baseHz * lifetime
    // beads, each with its mist retinue — but the accumulator sums baseHz/60
    // per step in floating point, so the LAST fractional spawn can round
    // away (18/60 x 120 lands at 35.999..., not 36). One short is the float
    // boundary; two short would be a carry bug, which is what this guards.
    const ideal = WOUND_BLEED.pellet.baseHz * WOUND_BLEED.pellet.lifetimeSec;
    const perBead = 1 + WOUND_BLEED.pellet.mistPerDrop;
    const got = emitFor('pellet', 2);
    expect(got).toBeLessThanOrEqual(ideal * perBead);
    expect(got).toBeGreaterThanOrEqual((ideal - 1) * perBead);
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
    const idealBeads = WOUND_BLEED.pellet.baseHz * WOUND_BLEED.pellet.lifetimeSec;
    expect(beads(sim)).toBeGreaterThanOrEqual(idealBeads - 1);
    expect(beads(sim)).toBeLessThanOrEqual(idealBeads);
    const total = sim.droplets.length; // beads + their mist
    expect(spawnWoundDroplets(sim, 'slug', 6.01, ANCHOR, NORMAL, 1 / 60, 0, rng)).toBe(0);
    expect(spawnWoundDroplets(sim, 'stump', 10.01, ANCHOR, NORMAL, 1 / 60, 0, rng)).toBe(0);
    expect(sim.droplets.length).toBe(total); // and nothing spawned above
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
    expect(sim.droplets.filter(d => d.kind === 'drop').length).toBeGreaterThan(30);
    // BEADS only: mist deliberately scatters wider than the cone (its whole
    // point is haze around the stream), so the cone bound applies to drops.
    for (const d of sim.droplets.filter(x => x.kind === 'drop')) {
      const l = Math.hypot(d.vel[0], d.vel[1], d.vel[2]);
      const dot = (d.vel[0] * n[0] + d.vel[1] * n[1] + d.vel[2] * n[2]) / l;
      expect(dot).toBeGreaterThanOrEqual(bound - 1e-9);
    }
  });

  it('wound BEADS are kind "drop" in the size band; mist is smaller and short-lived', () => {
    const sim = createBloodSim();
    const rng = seeded(17);
    let acc = 0;
    for (let i = 0; i < 30; i++) {
      acc = spawnWoundDroplets(sim, 'stump', i / 60, ANCHOR, NORMAL, 1 / 60, acc, rng);
    }
    const drops = sim.droplets.filter(d => d.kind === 'drop');
    const mist = sim.droplets.filter(d => d.kind === 'mist');
    expect(drops.length).toBeGreaterThan(0);
    expect(mist.length).toBe(drops.length * WOUND_BLEED.stump.mistPerDrop);
    for (const d of drops) {
      expect(d.size).toBeGreaterThanOrEqual(WOUND_BLEED.stump.sizeMin - 1e-9);
      expect(d.size).toBeLessThanOrEqual(WOUND_BLEED.stump.sizeMax + 1e-9);
    }
    for (const m of mist) {
      expect(m.size).toBeLessThan(WOUND_BLEED.stump.sizeMin); // finer than any bead
      expect(m.life).toBe(WOUND_BLEED.stump.mistLifeSec);
    }
  });

  it('mist EVAPORATES: stepping past mist life stamps no splat for it', () => {
    const sim = createBloodSim();
    spawnWoundDroplets(sim, 'stump', 0, ANCHOR, NORMAL, 1 / 60, 0.99, seeded(9));
    const mistCount = sim.droplets.filter(d => d.kind === 'mist').length;
    expect(mistCount).toBeGreaterThan(0);
    const splatsBefore = sim.splats.length;
    // Step long enough for mist to expire but not beads (mist life 0.5 s,
    // bead life BLOOD_TRAIL.lifetimeSec is longer) and keep them airborne.
    for (let i = 0; i < 40; i++) stepBlood(sim, 1 / 60, seeded(6));
    expect(sim.droplets.filter(d => d.kind === 'mist').length).toBe(0);
    expect(sim.splats.length).toBe(splatsBefore); // no confetti from mist
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
    const rate = WOUND_BLEED.stump.baseHz; // table-driven: the rate is a look knob
    const acc = spawnWoundDroplets(sim, 'stump', 0, ANCHOR, NORMAL, 1 / 600, 0.95, seeded(2));
    // One bead + its mist retinue.
    expect(sim.droplets.filter(d => d.kind === 'drop').length).toBe(1); // 0.95 + 90/600 = 1.1 -> one spawn
    expect(acc).toBeCloseTo(0.95 + rate / 600 - 1, 9);
  });
});

describe('ribbon history (X1.bleed-look: cohesive lines of fluid)', () => {
  const ANCHOR: [number, number, number] = [1, 1.2, 0.5];
  const NORMAL: [number, number, number] = [0, 1, 0];
  it('beads accumulate a capped, path-following history; mist does not', () => {
    const sim = createBloodSim();
    let acc = 0;
    const rng = seeded(11);
    acc = spawnWoundDroplets(sim, 'stump', 0, ANCHOR, NORMAL, 1 / 60, 0.99, rng);
    for (let i = 0; i < 20; i++) stepBlood(sim, 1 / 60, seeded(6));
    const bead = sim.droplets.find(d => d.kind === 'drop')!;
    expect(bead.hist!.length).toBe(TRAIL_HIST); // capped, not 20
    // Newest sample is the current position...
    const last = bead.hist![bead.hist!.length - 1]!;
    expect(last[0]).toBeCloseTo(bead.pos[0], 12);
    // ...and the trail actually spans the path (oldest != newest).
    const first = bead.hist![0]!;
    expect(Math.hypot(last[0] - first[0], last[1] - first[1], last[2] - first[2]))
      .toBeGreaterThan(0.01);
    for (const m of sim.droplets.filter(d => d.kind === 'mist')) {
      expect(m.hist).toBeUndefined();
    }
  });
});

describe('impact gouts (blood-viscosity spec §a)', () => {
  const seeded = () => {
    let s = 0x12345678;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 0x100000000;
    };
  };
  const anchor: Vec3 = [0, 1.2, 0];
  const dir: Vec3 = [0, 0, 1]; // travelling +z, so blood sprays back along -z

  it('emits the profile count in ONE call — the density the metaball needs', () => {
    for (const kind of ['pellet', 'slug', 'stump'] as const) {
      const sim = createBloodSim();
      spawnImpactGout(sim, kind, anchor, dir, seeded());
      expect(sim.droplets.length, kind).toBe(IMPACT_GOUT[kind].count);
    }
  });

  it('sprays BACK along the incoming direction, not through the body', () => {
    const sim = createBloodSim();
    spawnImpactGout(sim, 'slug', anchor, dir, seeded());
    // Every droplet's velocity must have a negative z component: the cone
    // half-angles are all under 90 degrees around -dir.
    for (const d of sim.droplets) expect(d.vel[2]).toBeLessThan(0);
  });

  it('is head-fast/tail-slow: speeds decrease monotonically across the pulse', () => {
    const sim = createBloodSim();
    spawnImpactGout(sim, 'slug', anchor, dir, seeded());
    const speeds = sim.droplets.map(d => Math.hypot(d.vel[0], d.vel[1], d.vel[2]));
    for (let i = 1; i < speeds.length; i++) {
      // Strictly decreasing: the ramp carries no jitter, precisely so the
      // pulse STRETCHES into a rope instead of expanding as a ball.
      expect(speeds[i]!).toBeLessThan(speeds[i - 1]!);
    }
    expect(speeds[0]!).toBeCloseTo(IMPACT_GOUT.slug.speedMax, 5);
    expect(speeds[speeds.length - 1]!).toBeCloseTo(IMPACT_GOUT.slug.speedMin, 5);
  });

  it('keeps every droplet inside the profile cone half-angle', () => {
    const sim = createBloodSim();
    spawnImpactGout(sim, 'stump', anchor, dir, seeded());
    const axis: Vec3 = [-dir[0], -dir[1], -dir[2]];
    for (const d of sim.droplets) {
      const len = Math.hypot(d.vel[0], d.vel[1], d.vel[2]);
      const cos = (d.vel[0] * axis[0] + d.vel[1] * axis[1] + d.vel[2] * axis[2]) / len;
      expect(Math.acos(Math.min(1, cos))).toBeLessThanOrEqual(IMPACT_GOUT.stump.coneRad + 1e-6);
    }
  });

  it('draws exactly 4 rng values per droplet, in a fixed order', () => {
    const sim = createBloodSim();
    let draws = 0;
    const rng = () => { draws++; return 0.5; };
    spawnImpactGout(sim, 'pellet', anchor, dir, rng);
    expect(draws).toBe(IMPACT_GOUT.pellet.count * 4);
  });

  it('spawns kind "drop" — gout beads are the fluid body, not haze', () => {
    const sim = createBloodSim();
    spawnImpactGout(sim, 'slug', anchor, dir, seeded());
    expect(sim.droplets.every(d => d.kind === 'drop')).toBe(true);
  });

  it('does NOT mark gout beads ribbon-eligible', () => {
    // Ribbons draw straight metre rods at gib speeds -- the round-1 "laser
    // spaghetti" bug. Only slow bleed streams arc enough to read as liquid.
    const sim = createBloodSim();
    spawnImpactGout(sim, 'slug', anchor, dir, seeded());
    expect(sim.droplets.some(d => d.ribbon)).toBe(false);
  });

  it('a full 8-pellet shotgun blast fits inside MAX_DROPLETS', () => {
    // 8 simultaneous pellet gouts must not evict each other mid-blast, or
    // the shotgun reads as one gout instead of eight.
    const sim = createBloodSim();
    const rng = seeded();
    for (let i = 0; i < 8; i++) spawnImpactGout(sim, 'pellet', anchor, dir, rng);
    expect(sim.droplets.length).toBe(IMPACT_GOUT.pellet.count * 8);
  });

  it('is deterministic under a fixed seed', () => {
    const a = createBloodSim();
    const b = createBloodSim();
    spawnImpactGout(a, 'slug', anchor, dir, seeded());
    spawnImpactGout(b, 'slug', anchor, dir, seeded());
    expect(a.droplets).toEqual(b.droplets);
  });
});

describe('gut droplets (entrails)', () => {
  const gut = (): Droplet => ({
    pos: [0, 1, 0], vel: [0, 0, 0], age: 0, life: Infinity, size: 0.1, kind: 'gut',
  });

  it('stepBlood does not move a gut droplet — the chain owns its position', () => {
    const sim = createBloodSim();
    sim.droplets.push(gut());
    stepBlood(sim, 1 / 60, () => 0.5);
    expect(sim.droplets[0]!.pos).toEqual([0, 1, 0]);
  });

  it('never culls a gut droplet by age or by touching the floor', () => {
    const sim = createBloodSim();
    const g = gut(); g.pos = [0, 0, 0]; g.age = 1e6;
    sim.droplets.push(g);
    stepBlood(sim, 1 / 60, () => 0.5);
    expect(sim.droplets).toHaveLength(1);
  });

  it('never stamps a floor splat for a gut droplet', () => {
    const sim = createBloodSim();
    const g = gut(); g.pos = [0, 0, 0];
    sim.droplets.push(g);
    stepBlood(sim, 1 / 60, () => 0.5);
    expect(sim.splats).toHaveLength(0);
  });

  it('still integrates ordinary drops', () => {
    // Guard against the skip being too broad.
    const sim = createBloodSim();
    sim.droplets.push({ pos: [0, 1, 0], vel: [0, 0, 0], age: 0, life: 5, size: 0.02, kind: 'drop' });
    stepBlood(sim, 1 / 60, () => 0.5);
    expect(sim.droplets[0]!.pos[1]).toBeLessThan(1);
  });
});

describe('emitter stream provenance (blood-connections)', () => {
  const countRng = (): { rng: () => number; calls: () => number } => {
    let n = 0;
    const rng = () => { n++; return 0.5; };
    return { rng, calls: () => n };
  };

  it('spawnWoundDroplets stamps one stable stream on beads and mist', () => {
    const sim = createBloodSim();
    spawnWoundDroplets(sim, 'slug', 0, [0, 1, 0], [0, 1, 0], 1 / 60, 0.99, seeded(4), 42);
    expect(sim.droplets.length).toBeGreaterThan(0);
    for (const d of sim.droplets) expect(d.stream).toBe(42);
  });

  it('spawnImpactGout stamps the stream on every gout droplet', () => {
    const sim = createBloodSim();
    spawnImpactGout(sim, 'pellet', [0, 1, 0], [0, 0, -1], seeded(5), 7);
    expect(sim.droplets.length).toBe(IMPACT_GOUT.pellet.count);
    for (const d of sim.droplets) expect(d.stream).toBe(7);
  });

  it('emitTrails stamps the source stream', () => {
    const sim = createBloodSim();
    emitTrails(sim, [{ id: 3, pos: [0, 2, 0], vel: [0, 0, 0], stream: 99 }], 1.0, seeded(6));
    expect(sim.droplets.length).toBeGreaterThan(0);
    for (const d of sim.droplets) expect(d.stream).toBe(99);
  });

  it('leaves droplets untagged when no stream is supplied (lab path)', () => {
    const sim = createBloodSim();
    burst(sim, [0, 1, 0], seeded(1));
    expect(sim.droplets.length).toBeGreaterThan(0);
    expect(sim.droplets.every(d => d.stream === undefined)).toBe(true);
  });

  it('consumes no extra RNG when a stream tag is supplied', () => {
    const plain = countRng();
    const tagged = countRng();
    spawnWoundDroplets(createBloodSim(), 'stump', 0, [0, 1, 0], [0, 1, 0], 1 / 60, 0.99, plain.rng);
    spawnWoundDroplets(createBloodSim(), 'stump', 0, [0, 1, 0], [0, 1, 0], 1 / 60, 0.99, tagged.rng, 5);
    expect(tagged.calls()).toBe(plain.calls());

    const a = countRng(); const b = countRng();
    spawnImpactGout(createBloodSim(), 'slug', [0, 1, 0], [0, 0, -1], a.rng);
    spawnImpactGout(createBloodSim(), 'slug', [0, 1, 0], [0, 0, -1], b.rng, 5);
    expect(b.calls()).toBe(a.calls());
  });
});

describe('curl flow in the sim (blood-curl-spike, optional)', () => {
  // A deterministic fake packed volume, so the flow tests cost no 64^3 build
  // and do not need three. The decode/wrap contract lives in curl-sample.test.
  function fakeVolume(): Uint8Array {
    const d = new Uint8Array(64 * 64 * 64 * 4);
    let s = 0x1234abcd;
    for (let i = 0; i < d.length; i++) { s = (s * 1664525 + 1013904223) >>> 0; d[i] = s >>> 24; }
    return d;
  }
  const flow = (over: Partial<CurlFlow> = {}): CurlFlow => ({
    data: fakeVolume(), strength: 3, scale: 6, drift: 0.5, time: 0, ...over,
  });

  function staged(): ReturnType<typeof createBloodSim> {
    const sim = createBloodSim();
    burst(sim, [0, 1.2, 0], seeded(11));
    addScraps(sim, [{ pos: [0.1, 1.2, 0.1], size: 0.06 }], [0, 1.2, 0], seeded(12));
    return sim;
  }

  it('is BYTE-IDENTICAL to today when flow is absent or strength is 0', () => {
    const a = staged(); const b = staged(); const c = staged();
    const fa = seeded(5), fb = seeded(5), fc = seeded(5);
    for (let i = 0; i < 90; i++) {
      stepBlood(a, 1 / 60, fa);
      stepBlood(b, 1 / 60, fb, undefined);
      stepBlood(c, 1 / 60, fc, flow({ strength: 0 }));
    }
    // Every droplet, every position/velocity/age, plus the stamped splats and
    // the RNG-driven splat offsets: identical bytes.
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    expect(JSON.stringify(c)).toBe(JSON.stringify(a));
  });

  it('a non-zero strength bends the same seeded spray (the switch reaches the sim)', () => {
    const a = staged(); const b = staged();
    const fa = seeded(5), fb = seeded(5);
    for (let i = 0; i < 20; i++) {
      stepBlood(a, 1 / 60, fa);
      stepBlood(b, 1 / 60, fb, flow());
    }
    expect(a.droplets.length).toBe(b.droplets.length);
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });

  it('stays deterministic with flow on (no Math.random)', () => {
    const a = staged(); const b = staged();
    const fa = seeded(5), fb = seeded(5);
    for (let i = 0; i < 40; i++) {
      stepBlood(a, 1 / 60, fa, flow({ time: i / 60 }));
      stepBlood(b, 1 / 60, fb, flow({ time: i / 60 }));
    }
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('moves every AIRBORNE kind but never the chain-owned gut', () => {
    const sim = createBloodSim();
    const mk = (kind: Droplet['kind']): Droplet => ({
      pos: [0.3, 1.5, 0.2], vel: [0, 0, 0], age: 0, life: 5, size: 0.08, kind,
    });
    sim.droplets.push(mk('drop'), mk('mist'), mk('scrap'), mk('gut'));
    const gutBefore = JSON.stringify(sim.droplets[3]);
    stepBlood(sim, 1 / 60, seeded(1), flow());
    const [drop, mist, scrap, gut] = sim.droplets;
    // drop/mist/scrap each left the origin; the gut is chain-owned and did not.
    for (const d of [drop!, mist!, scrap!]) expect(d.pos).not.toEqual([0.3, 1.5, 0.2]);
    expect(JSON.stringify(gut)).toBe(gutBefore);
  });
});

describe('emission density pack (blood-density spike, optional)', () => {
  const anchor: Vec3 = [0, 1.35, 0.55];
  const dir: Vec3 = [0, 0, -1];
  /** The exact profile values the page's DENSITY defaults use: neutral. */
  const NEUTRAL = { coneScale: 1, countMul: 1, sizeMul: 1 };
  /** Regenerated ONLY with an intentional default-tuning change (see below). */
  const GOLDEN_SIM_DIGEST = '93ac4a8c';

  /** A full seeded scenario: one-shot gout + a sustained wound + integration. */
  function runScenario(pack?: Parameters<typeof spawnImpactGout>[6]): ReturnType<typeof createBloodSim> {
    const sim = createBloodSim();
    spawnImpactGout(sim, 'slug', anchor, dir, seeded(9), 1, pack);
    let acc = 0;
    const r = seeded(21);
    for (let i = 0; i < 90; i++) {
      acc = spawnWoundDroplets(sim, 'slug', i / 60, [0, 1.2, 0.4], [0, 0, 1], 1 / 60, acc, r, 2, pack);
      stepBlood(sim, 1 / 60, r);
    }
    return sim;
  }

  /** FNV-1a over the full serialized sim — every droplet, every field. */
  function digest(sim: ReturnType<typeof createBloodSim>): string {
    const s = JSON.stringify(sim);
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
  }

  it('is BYTE-IDENTICAL to today when no pack is passed', () => {
    const a = runScenario();
    const b = runScenario(undefined);
    // Every droplet position/velocity/age/size, both emission sites and the
    // integration between them: identical bytes.
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it('a NEUTRAL pack (all 1s) is byte-identical to the shipped profiles', () => {
    // The game never passes a pack; a page that passes the neutral pack must
    // not move a single bit either — this is the "defaults are today" pin.
    const a = runScenario();
    const b = runScenario(NEUTRAL);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it('pins the shipped seeded scenario with a golden digest', () => {
    // Guards the DEFAULT bands themselves: if a future edit changes
    // IMPACT_GOUT / WOUND_BLEED (or the pack's neutral arithmetic), this
    // digest moves and the change has to be argued for, not slipped in.
    // Regenerate deliberately, never to make a red test green.
    expect(digest(runScenario())).toBe(GOLDEN_SIM_DIGEST);
  });

  it('a non-neutral pack actually reaches the spray (the switch is not inert)', () => {
    const base = runScenario();
    const dense = runScenario({ coneScale: 0.5, countMul: 2, sizeMul: 2 });
    expect(dense.droplets.length).not.toBe(base.droplets.length);
    expect(JSON.stringify(dense)).not.toBe(JSON.stringify(base));
  });

  it('stays deterministic with a pack on (no Math.random)', () => {
    const pack = { coneScale: 0.6, countMul: 1.5, sizeMul: 1.4 };
    expect(digest(runScenario(pack))).toBe(digest(runScenario(pack)));
  });

  it('countMul raises a gout\'s droplet budget linearly, cone/size stay bounded', () => {
    const sim = createBloodSim();
    spawnImpactGout(sim, 'slug', anchor, dir, seeded(3), 1, { countMul: 2, sizeMul: 2 });
    expect(sim.droplets).toHaveLength(IMPACT_GOUT.slug.count * 2);
    // Sizes remain inside the profile band times the pack multiplier.
    const sizeMul = 2;
    for (const d of sim.droplets) {
      expect(d.size).toBeGreaterThanOrEqual(IMPACT_GOUT.slug.sizeMin * sizeMul);
      expect(d.size).toBeLessThanOrEqual(IMPACT_GOUT.slug.sizeMax * sizeMul);
    }
  });
});


const makeRng = seeded;
const STEP: DebrisGround = { floorAt: (x) => (x < 0 ? 0.75 : -0.5), bounce: () => null };
const drop = (pos: [number, number, number], vel: [number, number, number]): Droplet =>
  ({ pos, vel, age: 0, life: 5, size: 0.01, kind: 'drop' });

describe('stepBlood on a debris ground (sector levels)', () => {
  it('a drop lands and stamps on the floor under it', () => {
    const sim = createBloodSim();
    sim.droplets.push(drop([-0.5, 2, 0], [0, 0, 0]), drop([0.5, 2, 0], [0, 0, 0]));
    const rng = makeRng(1);
    for (let i = 0; i < 240 && sim.droplets.length; i++) stepBlood(sim, 1 / 60, rng, undefined, undefined, STEP);
    expect(sim.droplets).toHaveLength(0);
    for (const s of sim.splats) expect(s.pos[1]).toBe(s.pos[0] < 0 ? 0.75 : -0.5);
    expect(sim.splats.some((s) => s.pos[1] === -0.5)).toBe(true);
  });
  it('never stamps a splat on a floor it is not over (a jittered splat across an edge is skipped)', () => {
    const sim = createBloodSim();
    for (let k = 0; k < 40; k++) sim.droplets.push(drop([-0.01, 1.2, k * 0.05], [0, 0, 0]));
    const rng = makeRng(2);
    for (let i = 0; i < 240 && sim.droplets.length; i++) stepBlood(sim, 1 / 60, rng, undefined, undefined, STEP);
    expect(sim.splats.length).toBeGreaterThan(0);
    for (const s of sim.splats) expect(s.pos[1]).toBe(STEP.floorAt(s.pos[0], s.pos[2]));
  });
  it('a drop that hits a wall stops there and runs down to that floor', () => {
    const wall: DebrisGround = {
      floorAt: () => 0,
      bounce: (prev, next, vel) => (prev[0] < 1 && next[0] >= 1
        ? { pos: [0.99, next[1], next[2]], vel: [0, vel[1], 0], normal: [-1, 0, 0] } : null),
    };
    const sim = createBloodSim();
    sim.droplets.push(drop([0, 1.5, 0], [6, 0, 0]));
    const rng = makeRng(3);
    for (let i = 0; i < 240 && sim.droplets.length; i++) stepBlood(sim, 1 / 60, rng, undefined, undefined, wall);
    expect(sim.splats.length).toBeGreaterThan(0);
    expect(sim.splats.every((s) => s.pos[0] < 1 + 0.3)).toBe(true);   // at the wall's foot (± the splat jitter)
  });
  it('the same RNG draws with or without a ground on a flat floor', () => {
    const flat: DebrisGround = { floorAt: () => 0, bounce: () => null };
    const a = createBloodSim(), b = createBloodSim();
    burst(a, [0, 1, 0], makeRng(9)); burst(b, [0, 1, 0], makeRng(9));
    const ra = makeRng(10), rb = makeRng(10);
    for (let i = 0; i < 300; i++) { stepBlood(a, 1 / 60, ra); stepBlood(b, 1 / 60, rb, undefined, undefined, flat); }
    expect(a.splats.length).toBeGreaterThan(0);
    expect(b.splats).toEqual(a.splats);
  });
});

describe('blood on sector levels: narrow steps and seeded floors (plan 3b follow-up)', () => {
  it('a drop on a narrow step still leaves a splat on the step (a jittered-off first splat goes at the drop)', () => {
    // A 0.3 m step (x 0..0.3, floor 0.75) between two floor-0 sides: most ±0.35 m jitters fall off it.
    const narrow: DebrisGround = { floorAt: (x) => (x >= 0 && x < 0.3 ? 0.75 : 0), bounce: () => null };
    const sim = createBloodSim();
    const n = 30;
    for (let k = 0; k < n; k++) sim.droplets.push(drop([0.15, 1.5, k * 0.5], [0, 0, 0]));
    const rng = makeRng(5);
    for (let i = 0; i < 240 && sim.droplets.length; i++) stepBlood(sim, 1 / 60, rng, undefined, undefined, narrow);
    expect(sim.droplets).toHaveLength(0);
    for (let k = 0; k < n; k++) {
      expect(sim.splats.some((s) => Math.abs(s.pos[2] - k * 0.5) <= 0.36 && s.pos[1] === 0.75)).toBe(true);
    }
    for (const s of sim.splats) expect(s.pos[1]).toBe(narrow.floorAt(s.pos[0], s.pos[2]));
  });
  it('spawnImpactGout / spawnWoundDroplets seed floorY only when given one (room spawns unchanged)', () => {
    const a = createBloodSim(), b = createBloodSim();
    spawnImpactGout(a, 'slug', [0, 1, 0], [0, 0, -1], seeded(4), 7);
    spawnImpactGout(b, 'slug', [0, 1, 0], [0, 0, -1], seeded(4), 7, undefined, 0.75);
    expect(a.droplets.every((d) => !('floorY' in d))).toBe(true);
    expect(b.droplets.every((d) => d.floorY === 0.75)).toBe(true);
    expect(b.droplets.map(({ floorY: _f, ...d }) => d)).toEqual(a.droplets);
    const c = createBloodSim();
    spawnWoundDroplets(c, 'stump', 0, [0, 1, 0], [1, 0, 0], 1 / 60, 0, seeded(5), 3, undefined, -0.5);
    expect(c.droplets.length).toBeGreaterThan(0);
    expect(c.droplets.every((d) => d.floorY === -0.5)).toBe(true);
  });
  it('a seeded drop over a hole lands on the body floor it was seeded with', () => {
    const hole: DebrisGround = { floorAt: () => NaN, bounce: () => null };
    const sim = createBloodSim();
    const d: Droplet = { ...drop([0, 1.5, 0], [0, 0, 0]), floorY: 0.75 };
    sim.droplets.push(d);
    const rng = makeRng(6);
    for (let i = 0; i < 240 && sim.droplets.length; i++) stepBlood(sim, 1 / 60, rng, undefined, undefined, hole);
    expect(sim.droplets).toHaveLength(0);
    expect(d.age).toBeLessThan(d.life);                 // it LANDED, not expired
    expect(d.pos[1]).toBeGreaterThan(0.6);              // on the seeded 0.75, not the y = 0 default
    expect(d.pos[1]).toBeLessThanOrEqual(0.76);
    expect(sim.splats).toHaveLength(0);                 // nothing under it to paint (off the map)
  });
});
