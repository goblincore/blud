// src/lab/sdf-zombie/webgpu/march/body/blocks/light/flashlight.wgsl.test.ts
//
// Moved verbatim from march.wgsl.test.ts (march split task 3, 2026-09-19):
// the assertions that pin `flashlight`. Nothing here compiles a shader; these guard
// what CAN be checked from text. See march/helpers.test.ts for the parse
// contract and docs/dev-notes/2026-09-18-march-split/ for the split.

import { describe, it, expect } from 'vitest';
import { MARCH_BODY } from '../../../../march.wgsl';

describe('analytic flashlight (dungeon relighting task 7)', () => {
  // The dungeon's SpotLight is invisible to the march — SDF bodies shade
  // inside this WGSL — so the beam is re-evaluated analytically per pixel.
  // These pins hold the seam the design rests on.
  const start = () => MARCH_BODY.indexOf('// ---- ANALYTIC FLASHLIGHT');
  const end = () => MARCH_BODY.indexOf('// ---- END ANALYTIC FLASHLIGHT');
  const block = () => MARCH_BODY.slice(start(), end());

  it('is present in the shading block', () => {
    expect(MARCH_BODY).toContain('spotCfg');
    expect(MARCH_BODY).toContain('spotPos');
    expect(MARCH_BODY).toContain('spotAxis');
  });

  it('adds ZERO mapBody evaluations — the constraint the whole design rests on', () => {
    // Extract the spotlight block and prove no field call hides in it.
    expect(start()).toBeGreaterThan(-1);
    expect(end()).toBeGreaterThan(start());
    expect(block()).not.toContain('mapBody');
    expect(block()).not.toContain('map(');
  });

  it('drives keyColor, not albedo — brightness cannot ride the bounce hue', () => {
    expect(start()).toBeGreaterThan(-1);
    expect(block()).toContain('keyColor');
  });

  it('collapses to the old key when the beam is off (spotCfg.x = 0)', () => {
    // Lab parity: with the dungeon off, L/keyC/keyI must reduce to exactly
    // lightDir/keyColor/lightCfg.x so the gallery renders bit-identically.
    expect(block()).toContain('var L = normalize(lightDir);');
    expect(block()).toContain('var keyC = keyColor;');
    expect(block()).toContain('var keyI = lightCfg.x;');
    expect(block()).toContain('if (spotCfg.x > 0.0) {');
  });

  it('feeds the blended key into the lit expressions, ambient hue untouched', () => {
    expect(start()).toBeGreaterThan(-1);
    // The two fleshLit sites ride the blended key...
    expect(MARCH_BODY).toContain('albedo * (amb + flashDirect + diff * wShadow * lvl * keyI * keyC) * ao');
    // ...while ambientAt keeps the ORIGINAL keyColor as its hue basis.
    expect(MARCH_BODY).toContain(
      'bounceCfg, lightCfg.y, keyColor);');
  });
});
