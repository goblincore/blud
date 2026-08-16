import { describe, it, expect } from 'vitest';
import { makeGobs, GOB_TUNING } from './gobs';
import { buildBody, DEFAULT_BUILD_OPTS } from './build-body';
import { ZOMBIE } from './body';

function seeded(seed = 1): () => number {
  let s = seed;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

const body = buildBody(ZOMBIE, DEFAULT_BUILD_OPTS);
const torso = body.clusters.find(c => c.limb === 'torso')!;

describe('makeGobs', () => {
  const { gobs, scraps } = makeGobs(body, torso.center, seeded(7));

  it('emits a large-gob count in the tuned band, plus the intact head', () => {
    const head = gobs.filter(g => g.limb === 'head');
    expect(head).toHaveLength(1);
    const meat = gobs.length - 1;
    expect(meat).toBeGreaterThanOrEqual(GOB_TUNING.largeMin);
    expect(meat).toBeLessThanOrEqual(GOB_TUNING.largeMax);
  });

  it('every non-head gob is a multi-blob lump, not a source prim', () => {
    for (const g of gobs) {
      if (g.limb === 'head') continue;
      expect(g.prims.length).toBeGreaterThanOrEqual(2);
      expect(g.prims.length).toBeLessThanOrEqual(4);
      // Blobs are NEW primitives (jittered), not references into body.prims.
      for (const p of g.prims) expect(body.prims).not.toContain(p);
    }
  });

  it('gob size tracks its source region (torso gob outweighs a hand gob)', () => {
    const vol = (g: (typeof gobs)[number]) =>
      g.prims.reduce((s, p) => s + p.radius ** 3, 0);
    const torsoGob = gobs.find(g => g.limb === 'torso')!;
    const armGobs = gobs.filter(g => g.limb === 'armL' || g.limb === 'armR');
    expect(armGobs.length).toBeGreaterThan(0);
    for (const a of armGobs) expect(vol(torsoGob)).toBeGreaterThan(vol(a));
  });

  it('per-axis jitter stays in the tuned band', () => {
    for (const g of gobs) {
      if (g.limb === 'head') continue;
      for (const p of g.prims) for (const s of p.scale) {
        expect(s).toBeGreaterThanOrEqual(0.6);
        expect(s).toBeLessThanOrEqual(1.3);
      }
    }
  });

  it('every non-head gob carries 1-2 torn points', () => {
    for (const g of gobs) {
      if (g.limb === 'head') continue;
      expect(g.tornAt.length).toBeGreaterThanOrEqual(1);
      expect(g.tornAt.length).toBeLessThanOrEqual(2);
    }
  });

  it('emits scraps in the tuned band with the scrap size/drag stamp', () => {
    expect(scraps.length).toBeGreaterThanOrEqual(GOB_TUNING.scrapMin);
    expect(scraps.length).toBeLessThanOrEqual(GOB_TUNING.scrapMax);
    for (const s of scraps) {
      expect(s.size).toBeGreaterThanOrEqual(GOB_TUNING.scrapSizeMin);
      expect(s.size).toBeLessThanOrEqual(GOB_TUNING.scrapSizeMax);
    }
  });

  it('skips dead prims and dead clusters', () => {
    const armDead = {
      ...body,
      clusters: body.clusters.map(c => c.limb === 'armL' ? { ...c, alive: false } : c),
    };
    const { gobs: g2 } = makeGobs(armDead, torso.center, seeded(7));
    expect(g2.some(g => g.limb === 'armL')).toBe(false);
  });

  it('is deterministic under a seed', () => {
    const a = makeGobs(body, torso.center, seeded(42));
    const b = makeGobs(body, torso.center, seeded(42));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
