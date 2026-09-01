import { describe, it, expect } from 'vitest';
import {
  createBloodSim, burst, emitTrails, stepBlood, addScraps, SCRAP_TUNING,
  spawnWoundDroplets, WOUND_BLEED, TRAIL_HIST, spawnImpactGout, IMPACT_GOUT,
} from './blood-sim';
import type { Vec3 } from './types';
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
