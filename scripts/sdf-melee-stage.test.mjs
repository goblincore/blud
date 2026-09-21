// scripts/sdf-melee-stage.test.mjs
//
// Unit tests for the melee staging library's PURE half. The browser-driving
// half (stageMelee / stampMeleeWounds) is exercised by running the bench for
// real; these tests pin the parts a wrong number could hide: the arc layout
// really is an arc with its nearest row exactly `nearest` out and staggered
// rows, the wound plan really spreads over DIFFERENT owner limbs and never
// plans a limb-severing slug calibre, the census math is exact on a
// hand-computed buffer, and the loud assertions fire on the failures they
// exist to catch.

import { describe, it, expect } from 'vitest';
import {
  median,
  meleeLayout,
  woundPlan,
  pelletsOnly,
  summariseBlocks,
  renderMarkdown,
  censusFromTarget,
  clipDepthToMetres,
  assertMeleeWounds,
  MELEE_REGIONS,
  LOAD_SUSPECT_LIMIT,
} from './lib/sdf-melee-stage.mjs';

describe('meleeLayout', () => {
  it('returns n deterministic positions, body 0 on the nearest row', () => {
    const a = meleeLayout(6);
    const b = meleeLayout(6);
    expect(a).toEqual(b);
    expect(a).toHaveLength(6);
    expect(a[0].row).toBe(0);
    expect(a[0].dist).toBe(1.4);
    // Body 0 is row 0, straight ahead: yaw-0 forward is -z.
    expect(a[0].x).toBeCloseTo(0, 12);
    expect(a[0].z).toBeCloseTo(-1.4, 12);
  });

  it('keeps every row-r body exactly nearest + r*rowGap out (arc, not line)', () => {
    const pts = meleeLayout(6, { nearest: 1.5, spacing: 1.0 });
    const dRow = (p) => Math.hypot(p.x, p.z);
    for (const p of pts) {
      const want = p.row === 0 ? 1.5 : 1.5 + Math.max(0.6, 1.0 * 0.75);
      expect(dRow(p)).toBeCloseTo(want, 9);
    }
    // ...and all of them in FRONT of the player (z < 0).
    for (const p of pts) expect(p.z).toBeLessThan(0);
  });

  it('staggered rows: odd rows offset half a slot so bodies overlap on screen', () => {
    const pts = meleeLayout(4, { nearest: 1.4, spacing: 0.9 });
    const row0 = pts.filter((p) => p.row === 0);
    const row1 = pts.filter((p) => p.row === 1);
    const theta0 = row0.map((p) => p.theta).sort((a, b) => a - b);
    const theta1 = row1.map((p) => p.theta).sort((a, b) => a - b);
    const mid0 = (theta0[0] + theta0[theta0.length - 1]) / 2;
    const mid1 = (theta1[0] + theta1[theta1.length - 1]) / 2;
    expect(mid1).not.toBeCloseTo(mid0, 6); // the rows are NOT aligned
  });

  it('never plans two bodies closer than half the spacing (no interpenetration)', () => {
    for (const [n, opts] of [[6, {}], [8, { spacing: 0.7 }], [4, { nearest: 1.2, spacing: 0.8 }], [3, {}]]) {
      const pts = meleeLayout(n, opts);
      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
          const d = Math.hypot(pts[i].x - pts[j].x, pts[i].z - pts[j].z);
          expect(d).toBeGreaterThan((opts.spacing ?? 0.9) * 0.5);
        }
      }
    }
  });

  it('handles n=1 and n=0', () => {
    expect(meleeLayout(0)).toEqual([]);
    const one = meleeLayout(1);
    expect(one).toHaveLength(1);
    expect(one[0].dist).toBe(1.4);
  });
});

describe('woundPlan', () => {
  it('spreads each body over distinct regions and the crowd over both flanks', () => {
    const plan = woundPlan(6, 4);
    expect(plan).toHaveLength(6);
    for (const p of plan) {
      const regions = p.targets.map((t) => t.region);
      expect(new Set(regions).size).toBe(Math.min(4, p.targets.length));
    }
    const laterals = plan.flatMap((p) => p.targets.map((t) => t.lateral));
    expect(laterals.some((l) => l > 0)).toBe(true);
    expect(laterals.some((l) => l < 0)).toBe(true);
  });

  it('matches the documented region heights', () => {
    const heights = Object.fromEntries(MELEE_REGIONS.map((r) => [r.region, r.height]));
    expect(heights.chest).toBeCloseTo(1.25);
    expect(heights.head).toBeCloseTo(1.6);
    expect(heights.arm).toBeCloseTo(1.3);
    expect(heights.thigh).toBeCloseTo(0.8);
    expect(heights.arm).not.toBe(0); // the arm carries a lateral offset
  });

  it('never plans a slug off the chest (a limb slug severs in one hit)', () => {
    for (const perBody of [2, 3, 4, 6]) {
      const plan = woundPlan(8, perBody);
      for (const p of plan) {
        for (const t of p.targets) {
          if (t.kind === 'slug') expect(t.region).toBe('chest');
        }
      }
    }
  });

  it('alternates calibres across the global stamp order where safe', () => {
    const plan = woundPlan(6, 4);
    const flat = plan.flatMap((p) => p.targets);
    const kinds = flat.map((t) => t.kind);
    // The first two stamps alternate (chest first: slug, then pellet).
    expect(kinds[0]).toBe('slug');
    expect(kinds[1]).toBe('pellet');
    // And both calibres appear in volume.
    expect(kinds.filter((k) => k === 'slug').length).toBeGreaterThan(0);
    expect(kinds.filter((k) => k === 'pellet').length).toBeGreaterThan(0);
  });

  it('pelletsOnly downgrades every stamp but keeps the geometry', () => {
    const plan = woundPlan(3, 4);
    const pel = pelletsOnly(plan);
    for (const [i, p] of pel.entries()) {
      expect(p.targets.every((t) => t.kind === 'pellet')).toBe(true);
      expect(p.targets.map((t) => t.region)).toEqual(plan[i].targets.map((t) => t.region));
    }
  });
});

describe('censusFromTarget', () => {
  // Hand-computed 2x2 frame:
  //   px0: miss ray, 3 steps, rasterised  (r=3 g=0 b=1 a=0.2)
  //   px1: hit ray, 10 steps              (r=10 g=1 b=1 a=0.5)
  //   px2: not rasterised at all          (r=0 g=0 b=0 a=0)
  //   px3: hit ray, 6 steps               (r=6 g=1 b=1 a=0.25)
  const f32 = new Float32Array([
    3, 0, 1, 0.2,
    10, 1, 1, 0.5,
    0, 0, 0, 0,
    6, 1, 1, 0.25,
  ]);
  const c = censusFromTarget(f32, 2, 2);

  it('counts hits, misses and rasterised pixels exactly', () => {
    expect(c.pixels).toBe(4);
    expect(c.rasterised).toBe(3);
    expect(c.hits).toBe(2);
    expect(c.misses).toBe(1);
    expect(c.coverage).toBeCloseTo(0.5);
    expect(c.rasterisedFrac).toBeCloseTo(0.75);
    expect(c.occupancy).toBeCloseTo(2 / 3);
  });

  it('splits the step budget between hit and miss rays', () => {
    expect(c.meanStepsHit).toBeCloseTo(8); // (10+6)/2
    expect(c.meanStepsMiss).toBeCloseTo(3);
    expect(c.missStepShare).toBeCloseTo(3 / 19);
  });

  it('means clip depth over hit pixels only', () => {
    expect(c.meanClipDepthOnHit).toBeCloseTo(0.375);
  });

  it('is safe on an empty frame', () => {
    const e = censusFromTarget(new Float32Array(4 * 4), 2, 2);
    expect(e.hits).toBe(0);
    expect(e.coverage).toBe(0);
    expect(e.missStepShare).toBe(0);
  });
});

describe('clipDepthToMetres', () => {
  it('maps the near plane to near and the far plane to far', () => {
    expect(clipDepthToMetres(0, 0.1, 200)).toBeCloseTo(0.1);
    expect(clipDepthToMetres(1, 0.1, 200)).toBeCloseTo(200);
  });
  it('is monotonic and lands mid-range depths between the staged body bands', () => {
    const at = (a) => clipDepthToMetres(a, 0.1, 200);
    expect(at(0.25)).toBeLessThan(at(0.5));
    expect(at(0.5)).toBeLessThan(at(0.75));
  });
});

describe('summariseBlocks', () => {
  const rows = [
    { phase: 'clean', leg: 'ship', p50: 20, labels: { 'sdf:march': { p50: 12 }, 'sdf:polys': { p50: 3 } }, load1: 2.0 },
    { phase: 'clean', leg: 'ship', p50: 24, labels: { 'sdf:march': { p50: 14 }, 'sdf:polys': { p50: 3 } }, load1: 2.5 },
    { phase: 'clean', leg: 'flat', p50: 10, labels: { 'sdf:march': { p50: 9 } }, load1: 2.2 },
  ];
  const s = summariseBlocks(rows);

  it('groups by phase/leg with the median frame p50', () => {
    const ship = s.groups.find((g) => g.leg === 'ship');
    expect(ship.phase).toBe('clean');
    expect(ship.n).toBe(2);
    expect(ship.frameP50).toBe(24); // median() of 20, 24 = upper middle
  });

  it('medians per-pass ms per label and ranks the top labels', () => {
    const ship = s.groups.find((g) => g.leg === 'ship');
    expect(ship.labels['sdf:march']).toBe(14); // median() of 12, 14 = upper middle, per the close-up harness convention
    expect(ship.topLabels[0]).toBe('sdf:march');
  });

  it('reports max load and the suspect flag', () => {
    const hot = summariseBlocks([{ phase: 'p', leg: 'l', p50: 1, labels: {}, load1: LOAD_SUSPECT_LIMIT + 1 }]);
    expect(hot.loadSuspect).toBe(true);
    expect(hot.groups[0].maxLoad).toBe(LOAD_SUSPECT_LIMIT + 1);
    expect(s.loadSuspect).toBe(false);
  });
});

describe('renderMarkdown', () => {
  it('embeds the staging record and one table per phase', () => {
    const summary = summariseBlocks([
      { phase: 'clean', leg: 'ship', p50: 20, labels: { 'sdf:march': { p50: 12 } }, load1: 2 },
      { phase: 'wounded', leg: 'ship', p50: 26, labels: { 'sdf:march': { p50: 16 } }, load1: 2 },
    ]);
    const md = renderMarkdown(summary, {
      n: 6, nearest: 1.4, spacing: 0.9, coverage: 0.66, rasterisedFrac: 0.9,
      bodiesOnScreen: 7, room: 6, ladder: [{ nearest: 1.4, spacing: 0.9, coverage: 0.66 }],
    });
    expect(md).toContain('## Staged scene');
    expect(md).toContain('66.0%');
    expect(md).toContain('## clean');
    expect(md).toContain('## wounded');
    expect(md).toContain('`sdf:march`');
    expect(md).not.toContain('loadSuspect'); // quiet run -> no warning banner
  });

  it('adds the load warning banner when the run was suspect', () => {
    const summary = summariseBlocks([
      { phase: 'p', leg: 'l', p50: 1, labels: {}, load1: 9 },
    ]);
    const md = renderMarkdown(summary, { n: 1, nearest: 1, spacing: 1, coverage: 0, bodiesOnScreen: 1, room: 1 });
    expect(md).toContain('loadSuspect');
  });
});

describe('assertMeleeWounds', () => {
  const good = {
    planned: 24, landed: 20,
    chunks: 0,
    bleed: { droplets: 0, splats: 0 },
    perBody: [
      { limbs: ['torso'] }, { limbs: ['head', 'torso'] },
      { limbs: ['armL'] }, { limbs: ['thighR'] },
    ],
  };

  it('passes a trustworthy staging', () => {
    expect(assertMeleeWounds(good)).toEqual([]);
  });

  it('fires on a low landed fraction', () => {
    const problems = assertMeleeWounds({ ...good, landed: 10 });
    expect(problems.some((p) => p.includes('landed'))).toBe(true);
  });

  it('fires on a sever (chunks) and names the retry', () => {
    const problems = assertMeleeWounds({ ...good, chunks: 2 });
    expect(problems.some((p) => p.includes('SEVERED') && p.includes('pelletsOnly'))).toBe(true);
  });

  it('fires on a live blood sim at spillChance 0', () => {
    const problems = assertMeleeWounds({ ...good, bleed: { droplets: 3, splats: 0 } });
    expect(problems.some((p) => p.includes('blood sim not empty'))).toBe(true);
  });

  it('fires when wounds pile onto fewer than 3 owner limbs', () => {
    const problems = assertMeleeWounds({
      ...good,
      perBody: [{ limbs: ['torso'] }, { limbs: ['torso'] }],
    });
    expect(problems.some((p) => p.includes('owner limbs'))).toBe(true);
  });
});

describe('median', () => {
  it('picks the middle (or upper middle) of sorted values', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(3);
    expect(median([])).toBeNaN();
  });
});
