// src/lab/sdf-zombie/webgpu/dynamite-panel.test.ts
//
// The panel's anti-drift contract, which is the whole reason its key table
// exists: sliders, the page's setter and the COPY text must agree on the key
// names. A panel that emits a key the setter ignores has shipped twice in this
// project (the beam panel's setBeam keys, and goo before it), and both times
// the symptom was a tuning that LOOKED applied and was not — so this file pins
// the table against the page's `applyDynamiteTuning` switch by name.
import { describe, it, expect } from 'vitest';
// @ts-expect-error — node:fs available in vitest via happy-dom/node
import { readFileSync } from 'node:fs';
import {
  DYNAMITE_KEYS, GIB_BONES, GIB_MODES, copyText, defaultsFrom,
} from './dynamite-panel';

// Repo-relative, like dynamite-prop.test.ts's REAL_GLB: vitest's import.meta.url
// is not a file: URL in this setup, so `new URL(..., import.meta.url)` throws.
const pageSrc = readFileSync('src/lab/sdf-zombie/webgpu/game-main.ts', 'utf8');

describe('dynamite panel key table', () => {
  it('every key in the table is a case the page setter handles', () => {
    // The switch in `applyDynamiteTuning` names its cases; the burst keys are
    // routed through its `fxKey` map. Both are read out of the source, because
    // the failure this guards is a KEY THAT NEVER REACHES ANYTHING — which no
    // runtime check can see.
    const switchBody = pageSrc.slice(
      pageSrc.indexOf('function applyDynamiteTuning'),
      pageSrc.indexOf('function dynamiteTuningValues'),
    );
    // Two shapes: the switch's own `case 'name':` arms, and the burst keys,
    // which are routed through its `fxKey` map (`fxsmoke: 'smokeOpacity', ...`).
    // The map's pairs share lines, so this scans for the pattern anywhere rather
    // than anchoring to line starts — the first cut of this test failed on
    // exactly that and reported a key the setter does handle.
    const handled = new Set<string>([
      ...[...switchBody.matchAll(/case '([a-zA-Z]+)':/g)].map(m => m[1]!),
      ...[...switchBody.matchAll(/([a-zA-Z]+): '[a-zA-Z]+'/g)].map(m => m[1]!),
    ]);
    for (const k of DYNAMITE_KEYS) {
      expect(handled.has(k.key), `the panel has a "${k.key}" slider and applyDynamiteTuning has no case for it`).toBe(true);
    }
  });

  it('the read-back covers every key the panel can move', () => {
    const body = pageSrc.slice(pageSrc.indexOf('function dynamiteTuningValues'));
    const readBack = body.slice(0, body.indexOf('\n  }'));
    for (const k of DYNAMITE_KEYS) {
      expect(readBack.includes(`${k.key}:`), `dynamiteTuningValues does not report "${k.key}"`).toBe(true);
    }
  });

  it('the COPY text names every key, so a tuning pass cannot lose one', () => {
    const text = copyText(defaultsFrom() as unknown as Record<string, number>);
    for (const k of DYNAMITE_KEYS) expect(text).toContain(`${k.key}:`);
    // ...and it is a runnable seam call.
    expect(text.startsWith('__sdfGame.setDynamiteTuning({')).toBe(true);
  });

  it('defaults are the page\u2019s shipped behaviour, not the panel\u2019s taste', () => {
    const d = defaultsFrom();
    // These four are asserted against game-main's boot defaults in the gate
    // (which reads them live); here they are pinned to the values this session
    // shipped so a slider default cannot drift from the committed behaviour.
    expect(d.mode).toBe(2);            // 'parts'
    expect(d.bones).toBe(1);           // 'core'
    expect(d.tearSec).toBeCloseTo(0.2, 6);
    expect(d.plume).toBe(0.1);
    expect(d).toMatchObject({
      tearAmp: 0.045, tearJiggle: 0.35, chunkbake: 1, aoesize: 0.82,
      blastdistort: 1, bdstrength: 2.7, fxsmoke: 0.76, fxlife: 1.55,
      fxgain: 3.3, capflat: 0.955,
    });
    expect(GIB_MODES[d.mode]).toBe('parts');
    expect(GIB_BONES[d.bones]).toBe('core');
  });
});
