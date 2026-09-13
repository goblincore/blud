// src/lab/sdf-zombie/webgpu/goo-presets.test.ts
//
// The drift gate: GAME_GOO_DEFAULTS must equal the literals game-main
// actually applies. A source scan, in the style of the goo-layer tripwires —
// nothing here constructs a renderer.

import { describe, it, expect } from 'vitest';
// @ts-expect-error — node:fs available in vitest via happy-dom/node
import { readFileSync } from 'node:fs';
import { GAME_GOO_DEFAULTS, applyGameGooDefaults } from './goo-presets';
import type { GooLayer } from './goo-layer';

describe('GAME_GOO_DEFAULTS (mirror of the game page)', () => {
  const src = readFileSync('src/lab/sdf-zombie/webgpu/game-main.ts', 'utf8');

  it('matches every literal game-main applies', () => {
    const checks: [string, string][] = [
      ['setSizeScale', '0.14'],
      ['setThreshold', '0.65'],
      ['setBlurPx', '0'],
      ['setStretch', '4'],
      ['setEdge', '2.75'],
      ['setAbsorb', '1.6'],
      ['setSpec', '2.85'],
      ['setGloss', '220'],
      ['setRim', '0'],
      ['setShadowRed', '0.19'],
    ];
    for (const [setter, value] of checks) {
      expect(src, `game-main must apply gooLayer.${setter}(${value})`).toContain(`gooLayer.${setter}(${value})`);
    }
  });

  it('matches the game mode and carries the same numbers', () => {
    expect(src).toContain("gooLayer.setMode('depth')");
    expect(GAME_GOO_DEFAULTS.mode).toBe('depth');
    expect(GAME_GOO_DEFAULTS).toEqual({
      sizeScale: 0.14, threshold: 0.65, blurPx: 0, mode: 'depth',
      stretch: 4, edge: 2.75, absorb: 1.6, spec: 2.85, gloss: 220,
      rim: 0, shadowRed: 0.19,
    });
  });

  it('applies every default through the layer setters, in order', () => {
    const calls: string[] = [];
    const layer = {
      setSizeScale: (v: number) => calls.push(`sizeScale=${v}`),
      setThreshold: (v: number) => calls.push(`threshold=${v}`),
      setBlurPx: (v: number) => calls.push(`blurPx=${v}`),
      setMode: (v: string) => calls.push(`mode=${v}`),
      setStretch: (v: number) => calls.push(`stretch=${v}`),
      setEdge: (v: number) => calls.push(`edge=${v}`),
      setAbsorb: (v: number) => calls.push(`absorb=${v}`),
      setSpec: (v: number) => calls.push(`spec=${v}`),
      setGloss: (v: number) => calls.push(`gloss=${v}`),
      setRim: (v: number) => calls.push(`rim=${v}`),
      setShadowRed: (v: number) => calls.push(`shadowRed=${v}`),
    } as unknown as GooLayer;
    applyGameGooDefaults(layer);
    expect(calls).toEqual([
      'sizeScale=0.14', 'threshold=0.65', 'blurPx=0', 'mode=depth',
      'stretch=4', 'edge=2.75', 'absorb=1.6', 'spec=2.85', 'gloss=220',
      'rim=0', 'shadowRed=0.19',
    ]);
  });

  it('never touches the candidate axes', () => {
    // The mirror must not silently opt into reconstruction or connections.
    expect(applyGameGooDefaults.toString()).not.toContain('Reconstruction');
    expect(applyGameGooDefaults.toString()).not.toContain('ExtraBlobs');
  });
});
