// src/lab/sdf-zombie/build-body-cache.test.ts
//
// COLD-START BODY-BUILD MEMO (2026-09-16 playtest follow-ups, task 1).
// The memo exists to stop spawnAll paying the deterministic body build +
// containment validation once per actor. These tests pin the two properties
// that make it safe: a hit returns the SAME untranslated body (identity), and
// every caller still gets its own TRANSLATED body (no shared mutable actor
// state). The key contract is pinned too — changing the face must miss.
import { describe, it, expect, beforeEach } from 'vitest';
import { BodyBuildCache } from './build-body';
import { buildCharacterBody, bodyBuildCacheStats, clearBodyBuildCache } from './webgpu/character-view';
import { characterEntry } from './character-registry';
import { DEFAULT_FACE } from './face';

describe('BodyBuildCache', () => {
  it('builds once per key and returns the same value on a hit', () => {
    const cache = new BodyBuildCache<number>();
    let builds = 0;
    const build = () => { builds++; return 41 + builds; };
    const a = cache.get('k', build);
    const b = cache.get('k', build);
    const c = cache.get('other', build);
    expect(a).toBe(b);
    expect(a).toBe(42);
    expect(c).toBe(43);
    expect(cache.stats()).toEqual({ entries: 2, hits: 1, misses: 2, buildMs: expect.any(Number) });
  });

  it('clear() drops entries but keeps the counters', () => {
    const cache = new BodyBuildCache<string>();
    cache.get('k', () => 'v');
    cache.clear();
    cache.get('k', () => 'v2');
    expect(cache.stats()).toMatchObject({ entries: 1, hits: 0, misses: 2 });
  });
});

describe('buildCharacterBody memo', () => {
  beforeEach(() => clearBodyBuildCache());

  it('serves repeated actors from one build and still translates each body', () => {
    const entry = characterEntry('zombie');
    const before = bodyBuildCacheStats();
    const a = buildCharacterBody(entry, [0, 0, 0], []);
    const b = buildCharacterBody(entry, [5, 0, 3], []);
    const after = bodyBuildCacheStats();
    // One real build for both actors, and a hit for the second.
    expect(after.misses - before.misses).toBe(1);
    expect(after.hits - before.hits).toBe(1);
    // Distinct objects, translated as requested, same geometry.
    expect(a).not.toBe(b);
    expect(b.prims[0]!.a[0] - a.prims[0]!.a[0]).toBeCloseTo(5, 6);
    expect(b.prims[0]!.a[2] - a.prims[0]!.a[2]).toBeCloseTo(3, 6);
    expect(a.prims.length).toBe(b.prims.length);
    expect(b.bonePrims.length).toBe(a.bonePrims.length);
  });

  it('returns a body identical to an uncached build', () => {
    const entry = characterEntry('soldier');
    const cached = buildCharacterBody(entry, [0, 0, 0], []);
    clearBodyBuildCache();
    const fresh = buildCharacterBody(entry, [0, 0, 0], []);
    expect(cached.prims).toEqual(fresh.prims);
    expect(cached.bonePrims).toEqual(fresh.bonePrims);
    expect(cached.bones).toEqual(fresh.bones);
    expect(cached.errors).toEqual(fresh.errors);
  });

  it('misses when the face changes (the key covers every build input)', () => {
    const entry = characterEntry('zombie');
    const before = bodyBuildCacheStats();
    buildCharacterBody(entry, [0, 0, 0], [], { ...DEFAULT_FACE });
    buildCharacterBody(entry, [0, 0, 0], [], { ...DEFAULT_FACE, headRadius: DEFAULT_FACE.headRadius + 0.01 });
    const after = bodyBuildCacheStats();
    expect(after.misses - before.misses).toBe(2);
  });
});
