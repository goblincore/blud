// Task-8 gates for the entrails feature (plan 2026-09-02-entrails.md, task 8).
//
// These are GATES on shipped code, not red-green tests: every assertion here
// was mutation-checked (the guarded behaviour broken by hand, gate seen to
// fail, reverted) because a gate that has never failed is a decoration.
//
//  Gate 1 — off-state parity: `visceraAmp 0` packs the same material word and
//           reaches the albedo through the same guarded path as pre-entrails,
//           and `spillChance 0` spawns nothing over 200 qualifying wounds.
//  Gate 2 — determinism: the same seeded stream over the same wound sequence
//           produces the same spawn/tear decisions.
//  Gate 3 — the rope cap holds: 50 qualifying hits across 10 bodies never
//           exceed one attached chain per body, and death leaks none.

import { describe, expect, it } from 'vitest';
// @ts-expect-error — node:fs available in vitest via happy-dom/node
import { readFileSync } from 'node:fs';
import { shouldSpill, SPILL_CHANCE } from './entrails-spawn';
import {
  makeGutChain, stepGutChain, detachGutChain, GUT_TUNING, type GutChain,
} from './entrails';
import { mulberry32 } from './webgpu/game-weapon';
import { MARCH_BODY, TISSUE_RAMP } from './webgpu/march.wgsl';
import type { Wound } from './damage';

// ————————————————————————————————————————————————————————————————————
// Fixtures
// ————————————————————————————————————————————————————————————————————

/** A cavity wound as the damage paths actually stamp it (humanoid-damage /
 *  game-weapon). NOTE the real taxonomy (task-8 finding): a SLUG wound
 *  carries type 'blast' — it uses the blast crater profile — plus the
 *  spillCalibre marker; only the marker distinguishes the roll. */
const cavityWound = (calibre: 'slug' | 'blast'): Wound => ({
  primIdx: 0, local: [0, 0, 0], radius: 0.16, type: 'blast', ageSec: 0, cavity: true,
  ...(calibre === 'slug' ? { spillCalibre: 'slug' as const } : {}),
} as Wound);

/** A wound stream shaped like real fire: mostly non-cavity, torso slugs and
 *  blasts mixed in. Deterministic given the seed. */
function woundStream(n: number, seed: number): Wound[] {
  const rng = mulberry32(seed);
  const out: Wound[] = [];
  for (let i = 0; i < n; i++) {
    const r = rng();
    if (r < 0.2) out.push(cavityWound('blast'));
    else if (r < 0.5) out.push(cavityWound('slug'));
    else out.push({ primIdx: 0, local: [0, 0, 0], radius: 0.055, type: 'pellet', ageSec: 0 } as Wound);
  }
  return out;
}

/** The game's rope lifecycle, lifted one-for-one from game-main's
 *  spillVerdict + stepGutRopes so the gates exercise the real semantics:
 *  'tear' keeps the map entry but detaches; stepping a detached chain is
 *  allowed and it settles. */
class RopeLedger {
  private ropes = new Map<number, GutChain>();
  hit(bodyId: number, wound: Wound, rng: () => number): 'spawn' | 'tear' | 'none' {
    const verdict = shouldSpill(wound, this.ropes.get(bodyId) !== undefined, rng);
    if (verdict === 'tear') this.ropes.set(bodyId, detachGutChain(this.ropes.get(bodyId)!));
    else if (verdict === 'spawn') this.ropes.set(bodyId, makeGutChain([0, 1.2, 0]));
    return verdict;
  }
  /** stepGutRopes with every body standing (the pinned case). */
  step(dt: number): void {
    for (const [id, c] of this.ropes) this.ropes.set(id, stepGutChain(c, dt));
  }
  /** The death/collapse path: every chain torn free. */
  killAll(): void {
    for (const [id, c] of this.ropes) this.ropes.set(id, detachGutChain(c));
  }
  attachedCount(bodyId?: number): number {
    let n = 0;
    for (const [id, c] of this.ropes) {
      if (bodyId !== undefined && id !== bodyId) continue;
      if (c.attached) n++;
    }
    return n;
  }
  get entries(): number { return this.ropes.size; }
  chains(): GutChain[] { return [...this.ropes.values()]; }
}

// ————————————————————————————————————————————————————————————————————
// Gate 1a — viscera off-state parity (visceraAmp 0)
// ————————————————————————————————————————————————————————————————————

describe('gate 1a: visceraAmp 0 shades and packs as pre-entrails', () => {
  const gpuSrc = readFileSync('src/lab/sdf-zombie/webgpu/zombie-gpu.ts', 'utf8');

  it('the live uniform pack sources surfCfg3.w from visceraAmp', () => {
    // The base branch hardcoded 0 into .w (it was SPARE). Sourcing .w from
    // `m.visceraAmp` means amp 0 reproduces that exact uniform word — the
    // packed-material half of the parity gate. If this line is edited, the
    // base's `set(m.woundDepthAmp, m.fatDepth, m.muscleDepth, 0)` is the
    // thing to stay equivalent to at amp 0.
    expect(gpuSrc).toContain(
      'u.surfCfg3.value.set(m.woundDepthAmp, m.fatDepth, m.muscleDepth, m.visceraAmp)',
    );
  });

  it('wmCav reaches the albedo ONLY as `wmCav * surfCfg3.w` in the tissueRamp call', () => {
    // Exactly three occurrences: the destructure, the fbm guard, and the
    // multiplied argument. A fourth sink is a parity break at amp 0.
    const uses = MARCH_BODY.match(/wmCav/g) ?? [];
    expect(uses).toHaveLength(3);
    expect(MARCH_BODY).toContain('let wmCav = wmBoth.z;');
    expect(MARCH_BODY).toContain('wmCav * surfCfg3.w');
  });

  it('amp 0 forces the viscera mix to identity inside the ramp', () => {
    // toViscera = smoothstep(...) * cavity; with the argument 0 the mix is
    // `mix(c, visceraColor, 0)` = c bit-for-bit (IEEE: x*1 + y*0 = x for
    // finite y).
    expect(TISSUE_RAMP).toContain(
      'let toViscera = smoothstep(muscleDepth, visceraDepth, depth) * cavity;',
    );
    expect(TISSUE_RAMP).toContain('return mix(c, visceraColor, toViscera);');
  });

  it('the viscera fbm sits behind a guard the amp can close (cost parity)', () => {
    // Amp FIRST in the && so visceraAmp 0 short-circuits before wmCav and
    // before the noise call — the same-body, every-pixel cost the torn-fibre
    // pass was cut for.
    expect(MARCH_BODY).toMatch(
      /if \(surfCfg3\.w > 0\.0 && wmCav > 0\.0\) \{\s*let lump = fbm\(anchor \* 2\.5\)/,
    );
  });
});

// ————————————————————————————————————————————————————————————————————
// Gate 1b — spillChance 0 spawns nothing
// ————————————————————————————————————————————————————————————————————

describe('gate 1b: spillChance 0 spawns no chains over 200 qualifying wounds', () => {
  // SCOPE NOTE (found by this gate, 2026-09-02): `spillChance` is the SLUG
  // knob — the panel overrides SPILL_CHANCE.slug and shouldSpill reads it
  // live. BLAST is pinned at SPILL_CHANCE.blast = 1.0 on purpose (spec §3
  // trigger table: a torso blast ALWAYS spills; see entrails-spawn's header).
  // This gate first asserted zero spawns over a mixed slug+blast stream and
  // FAILED on the blasts — a finding about the gate, not the feature: the
  // plan step predates task 6's blast pin. Aligned to the shipped contract.
  it('a 0 roll silences every SLUG spill, on the same mutation path the panel knob uses', () => {
    const wounds = woundStream(200, 0xa11ce).filter(w => w.cavity && w.spillCalibre === 'slug');
    expect(wounds.length).toBeGreaterThan(20); // the stream must actually qualify

    // Mutate the shared table exactly as game-main's setWoundTuning does
    // (SPILL_CHANCE.slug = value) — shouldSpill reads it live.
    const keep = SPILL_CHANCE.slug;
    SPILL_CHANCE.slug = 0;
    try {
      const rng = mulberry32(0x5eedb1e);
      const ledger = new RopeLedger();
      for (let i = 0; i < wounds.length; i++) {
        expect(ledger.hit(i % 10, wounds[i]!, rng)).toBe('none');
        ledger.step(1 / 60);
      }
      expect(ledger.entries).toBe(0);
    } finally {
      SPILL_CHANCE.slug = keep;
    }
    // The restore is real: the table is shared module state.
    expect(SPILL_CHANCE.slug).toBe(keep);
  });

  it('blast spill is PINNED — spillChance 0 does not silence it (spec §3)', () => {
    const keep = SPILL_CHANCE.slug;
    SPILL_CHANCE.slug = 0;
    try {
      const rng = mulberry32(0x5eedb1e);
      // One blast cavity wound, no rope yet: spawns regardless of the knob.
      expect(new RopeLedger().hit(0, cavityWound('blast'), rng)).toBe('spawn');
    } finally {
      SPILL_CHANCE.slug = keep;
    }
  });

  it('contrast: the same stream at the shipped 0.35 does spawn', () => {
    const wounds = woundStream(200, 0xa11ce).filter(w => w.cavity);
    const rng = mulberry32(0x5eedb1e);
    const ledger = new RopeLedger();
    let spawns = 0;
    for (let i = 0; i < wounds.length; i++) {
      if (ledger.hit(0, wounds[i]!, rng) === 'spawn') spawns++;
      ledger.step(1 / 60);
    }
    expect(spawns).toBe(1); // also exercises the cap: one rope, then tears
  });
});

// ————————————————————————————————————————————————————————————————————
// Gate 2 — determinism
// ————————————————————————————————————————————————————————————————————

describe('gate 2: same seed, same spills', () => {
  it('two runs of one seeded stream over one wound sequence agree exactly', () => {
    const wounds = woundStream(200, 0xbeef);
    const run = (seed: number) => {
      const rng = mulberry32(seed);
      const ledger = new RopeLedger();
      const decisions = wounds.map((w, i) => {
        const v = ledger.hit(i % 10, w, rng);
        ledger.step(1 / 60);
        return v;
      });
      return { decisions, entries: ledger.entries };
    };
    const a = run(0x5eedb1e);
    const b = run(0x5eedb1e);
    expect(b.decisions).toEqual(a.decisions);
    expect(b.entries).toBe(a.entries);
  });

  it('and a different seed genuinely differs (the gate is not vacuous)', () => {
    const wounds = woundStream(200, 0xbeef).filter(w => w.cavity);
    const decisions = (seed: number) => {
      const rng = mulberry32(seed);
      let hasRope = false;
      return wounds.map(w => {
        const v = shouldSpill(w, hasRope, rng);
        if (v === 'spawn') hasRope = true;
        return v;
      });
    };
    const a = decisions(0x5eedb1e);
    const b = decisions(0x5eedb1e ^ 0xffff);
    expect(a.some((v, i) => v !== b[i])).toBe(true);
  });
});

// ————————————————————————————————————————————————————————————————————
// Gate 3 — the rope cap holds
// ————————————————————————————————————————————————————————————————————

describe('gate 3: 50 qualifying hits across 10 bodies, one rope each, none leaked', () => {
  it('never more than one attached chain per body, and death leaks none', () => {
    const rng = mulberry32(0x5eedb1e);
    const ledger = new RopeLedger();
    let spawns = 0;
    let tears = 0;

    for (let h = 0; h < 50; h++) {
      const bodyId = h % 10;
      const wound = cavityWound(h % 3 === 0 ? 'blast' : 'slug');
      const v = ledger.hit(bodyId, wound, rng);
      if (v === 'spawn') spawns++;
      if (v === 'tear') {
        tears++;
        // THE CAP: a torn body keeps at most its detached entry — never a
        // second attached rope growing beside the first.
        expect(ledger.attachedCount(bodyId)).toBe(0);
      }
      ledger.step(1 / 60);
      // Whole-world form of the cap, after every hit and step.
      expect(ledger.attachedCount(bodyId)).toBeLessThanOrEqual(1);
      expect(ledger.entries).toBeLessThanOrEqual(10);
    }

    // The simulation must have exercised both paths to mean anything.
    expect(spawns).toBeGreaterThan(0);
    expect(tears).toBeGreaterThan(0);
    // The cap working means far fewer chains than hits.
    expect(spawns).toBeLessThan(50);

    // DEATH: everything tears free (game-main detaches on collapse/death).
    ledger.killAll();
    expect(ledger.attachedCount()).toBe(0);
    for (const c of ledger.chains()) expect(c.attached).toBe(false);

    // And the fallen chains actually settle — frozen chains cost nothing,
    // which is what makes a room of corpses with spilled guts affordable.
    for (let i = 0; i < 900; i++) ledger.step(1 / 60);
    for (const c of ledger.chains()) expect(c.settled).toBe(true);
  });

  it('GUT_TUNING bounds the particle count: 10 nodes of 0.55 m per rope', () => {
    // The spec's "bounded by construction" — pin the numbers so a tuning
    // change is a conscious one.
    expect(GUT_TUNING.nodes).toBe(10);
    expect(GUT_TUNING.restLength).toBeCloseTo(0.55, 5);
    const c = makeGutChain([0, 1, 0]);
    expect(c.nodes).toHaveLength(GUT_TUNING.nodes);
    expect(c.seg).toBeCloseTo(GUT_TUNING.restLength / (GUT_TUNING.nodes - 1), 8);
  });
});
