// src/lab/sdf-zombie/webgpu/character-view.test.ts
import { describe, it, expect } from 'vitest';
import { buildCharacterBody, compileCharacterSheet } from './character-view';
import { characterEntry, characterNames } from '../character-registry';

// The GPU half needs a device and is covered by the capture gate instead.
// These cover the pure half: building and sheet compilation, which is where
// the bugs have actually been.

describe('buildCharacterBody', () => {
  it('builds every registered character without errors', () => {
    for (const name of characterNames()) {
      const errs: string[] = [];
      const body = buildCharacterBody(characterEntry(name), [0, 0, 0], errs);
      expect(errs, `${name}: ${errs.join(' | ')}`).toEqual([]);
      expect(body.prims.length).toBeGreaterThan(0);
    }
  });

  it('places the body at the requested start', () => {
    const errs: string[] = [];
    const a = buildCharacterBody(characterEntry('zombie'), [0, 0, 0], errs);
    const b = buildCharacterBody(characterEntry('zombie'), [5, 0, 3], errs);
    expect(b.prims[0]!.a[0] - a.prims[0]!.a[0]).toBeCloseTo(5, 6);
    expect(b.prims[0]!.a[2] - a.prims[0]!.a[2]).toBeCloseTo(3, 6);
  });
});

describe('compileCharacterSheet', () => {
  it('returns the blob own sheet when it declares one', () => {
    // The soldier has an owner-tuned bake; the zombie has no sheet block.
    expect(compileCharacterSheet(characterEntry('soldier')).sheet).not.toBeNull();
    expect(compileCharacterSheet(characterEntry('zombie')).sheet).toBeNull();
  });

  it('a bad sheet block is REPORTED, not thrown', () => {
    // compileSheet raises BlobError on an unknown key. One bad key cost an
    // hour on 2026-09-04 and silently swapped the soldier's face for the
    // zombie's. The catch must report loudly and fall back, not crash.
    // (The skeleton/root lines are the minimum parseable document: parseBlob
    // rejects a lone sheet block with `no "root" bone declared` before
    // compileSheet ever sees the key — plan defect, fixed here rather than
    // skipped.)
    const broken = {
      ...characterEntry('soldier'),
      src: 'skeleton\n  root pelvis at 0.9\nsheet\n  notAKey 1\n',
    };
    const r = compileCharacterSheet(broken);
    expect(r.sheet).toBeNull();
    expect(r.error).toMatch(/sheet/i);
  });

  it('every character with no sheet block falls back to the zombie flat', () => {
    const r = compileCharacterSheet(characterEntry('zombie'));
    expect(r.sheet).toBeNull();
    expect(r.face.url).toContain('zombie-face');
  });
});
