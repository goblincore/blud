import { describe, expect, it } from 'vitest';
import { emitVhs } from './vhs-panel';
import { VHS_TERM_RANGES } from './post-aa';
import { VHS_PRESETS, type VhsTerms } from './post-vhs';

const KEYS = Object.keys(VHS_TERM_RANGES) as (keyof VhsTerms)[];

describe('vhs panel', () => {
  // The bug this test exists to make impossible: a panel whose COPY button
  // emits keys the setter ignores. It has happened twice in this project
  // (setBeam, and the goo panel), and both times the tuning LOOKED applied.
  it('emits only keys setVhsTerm consumes', () => {
    const wrecked = { ...VHS_PRESETS.soft, chromaAmount: 4.3, warpAmount: 9 };
    const emitted = [...emitVhs('soft', wrecked).matchAll(/setVhsTerm\('(\w+)'/g)].map(m => m[1]!);
    expect(emitted.length).toBeGreaterThan(0);
    for (const k of emitted) expect(KEYS as string[]).toContain(k);
  });

  // The preset call must come FIRST: setVhs overwrites every term, so a term
  // line above it would be silently undone by the paste that follows.
  it('leads with the preset, then the delta from it', () => {
    const text = emitVhs('soft', { ...VHS_PRESETS.soft, chromaAmount: 4.3 });
    expect(text.split('\n')).toEqual([
      "__sdfGame.setVhs('soft')",
      "__sdfGame.setVhsTerm('chromaAmount', 4.3)",
    ]);
  });

  it('emits no term lines when nothing was swept off the preset', () => {
    expect(emitVhs('chaotic', VHS_PRESETS.chaotic)).toBe("__sdfGame.setVhs('chaotic')");
  });

  // With the stage off there is no preset to seed from, so the paste has to
  // carry every term or it would restore a half-remembered look.
  it('emits every term when the stage is off', () => {
    const text = emitVhs(null, VHS_PRESETS.balanced);
    expect(text).toContain('__sdfGame.setVhs(null)');
    for (const k of KEYS) expect(text).toContain(`'${k}'`);
  });

  // Every preset must be reachable by the sliders: a term outside its own
  // range would clamp the moment the panel refreshed, silently changing the
  // look the preset row promises.
  it('every preset value sits inside its slider range', () => {
    for (const [name, terms] of Object.entries(VHS_PRESETS)) {
      for (const k of KEYS) {
        const [lo, hi] = VHS_TERM_RANGES[k];
        expect(terms[k], `${name}.${k}`).toBeGreaterThanOrEqual(lo);
        expect(terms[k], `${name}.${k}`).toBeLessThanOrEqual(hi);
      }
    }
  });
});
