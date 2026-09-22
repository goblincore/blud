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
  woundPlan,
  pelletsOnly,
  summariseBlocks,
  renderMarkdown,
  censusFromTarget,
  clipDepthToMetres,
  assertMeleeWounds,
  MELEE_REGIONS,
  LOAD_SUSPECT_LIMIT, missAnatomy, costCensus } from './lib/sdf-melee-stage.mjs';

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
      n: 6, gathered: 6, frames: 1140, nearest: 1.4, distances: [1.4, 1.9], coverage: 0.66, rasterised: 0.9,
      bodiesOnScreen: 7, room: 6, search: [{ dyaw: 0, pitch: -0.12, coverage: 0.66 }],
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

// px: [steps, hit, rasterised]
function buf(w, h, fn) {
  const f = new Float32Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const [s, hit, r] = fn(x, y); const o = (y * w + x) * 4;
    f[o] = s; f[o + 1] = hit; f[o + 2] = r;
  }
  return f;
}

describe('missAnatomy', () => {
  it('puts a miss next to a hit in bucket 1 and a far miss in >16, and finds empty blocks', () => {
    const w = 32, h = 8;
    const f = buf(w, h, (x) => x === 0 ? [4, 1, 1] : [1, 0, 1]);
    const a = missAnatomy(f, w, h);
    const total = 8 * 4 + 31 * 8;
    expect(a.missStepShare).toBeCloseTo(248 / total, 6);
    expect(a.byDistance['1']).toBeCloseTo(8 / total, 6);
    expect(a.byDistance['>16']).toBeCloseTo((31 - 16) * 8 / total, 6);
    // 4x4 blocks: columns 0-3 hold hits; the other 7 block-columns x 2 rows are empty.
    expect(a.emptyBlocks[4]).toBeCloseTo((28 * 8) / total, 6);
  });

  it('ignores pixels that were never rasterised', () => {
    const f = buf(4, 4, () => [9, 0, 0]);
    const a = missAnatomy(f, 4, 4);
    expect(a.missStepShare).toBe(0);
  });
});

describe('costCensus', () => {
  // A 3x3 hit block in a 5x5 target; its centre pixel is interior, the ring is
  // silhouette; one hit flagged near-wound; the rest miss.
  const w = 5, h = 5;
  const walk = new Float32Array(w * h * 4), total = new Float32Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const isHit = x >= 1 && x <= 3 && y >= 1 && y <= 3;
    const near = x === 3 && y === 3;
    walk[i] = isHit ? 10 : 2;                        // prims
    walk[i + 1] = near ? 5 : 0;                      // wound rows
    walk[i + 2] = 4 + (isHit ? 1000 : 0) + (near ? 2000 : 0);
    if (isHit) { total[i] = walk[i] + 20; total[i + 1] = walk[i + 1] + (near ? 7 : 0); total[i + 2] = walk[i + 2]; }
  }
  const c = costCensus(walk, total, w, h);

  it('classes the pixels', () => {
    expect(c.classes.miss.px).toBe(16);
    expect(c.classes.interior.px).toBe(1);
    expect(c.classes.silhouette.px).toBe(7);
    expect(c.classes.wound.px).toBe(1);
  });

  it('splits prim work into walk and post-hit shares that sum to 1', () => {
    // walk: 16*2 + 9*10 = 122; post: 9*20 = 180; total 302
    expect(c.totals.prims).toBe(302);
    expect(c.classes.miss.primShare.walk).toBeCloseTo(32 / 302, 9);
    expect(c.classes.silhouette.primShare.post).toBeCloseTo(140 / 302, 9);
    const s = Object.values(c.classes).reduce((a, k) => a + k.primShare.walk + k.primShare.post, 0);
    expect(s).toBeCloseTo(1, 9);
  });

  it('puts wound rows on the near-wound class', () => {
    expect(c.totals.rows).toBe(12);
    expect(c.classes.wound.rowShare.walk).toBeCloseTo(5 / 12, 9);
    expect(c.classes.wound.rowShare.post).toBeCloseTo(7 / 12, 9);
    expect(c.classes.wound.perPixel.steps).toBe(4);
  });
});

describe('costCensus — cleared texels', () => {
  it('does not count the scene clear colour (b ~ 0.01) as a rasterised miss', () => {
    const w = 2, h = 1;
    const walk = new Float32Array([3, 0, 1003, 0.9, 0.008, 0.008, 0.01, 1]);
    const total = new Float32Array([5, 0, 1003, 0.9, 0.008, 0.008, 0.01, 1]);
    const c = costCensus(walk, total, w, h);
    expect(c.classes.miss.px).toBe(0);
    expect(c.classes.silhouette.px).toBe(1);
  });
});
