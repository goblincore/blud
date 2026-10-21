import { describe, expect, it } from 'vitest';
import { bodyNormalMap } from './body-normal-load';
import { BODY_NORMAL_BLOCK } from './march/body/blocks/post/body-normal.wgsl';
import { MARCH_TRACE_POST } from './march/body/trace.wgsl';
import { characterEntry, characterNames } from '../character-registry';

const META = { yMin: 0.95, yMax: 1.9, axisX: 0, axisZ: 0.1 };

describe('bodyNormalMap', () => {
  it('takes the projection from the sidecar and the prim range from the TORSO cluster', () => {
    const m = bodyNormalMap({ strength: 0.8 }, META, {
      clusters: [{ limb: 'head', start: 0, count: 21 }, { limb: 'torso', start: 21, count: 35 }, { limb: 'armL', start: 56, count: 9 }],
    });
    expect(m).toEqual({ strength: 0.8, yMin: 0.95, yMax: 1.9, axisX: 0, axisZ: 0.1, primStart: 21, primEnd: 56 });
  });

  it('is off for a body with no torso (a severed piece)', () => {
    expect(bodyNormalMap({ strength: 1 }, META, { clusters: [{ limb: 'armL', start: 0, count: 9 }] })).toBeNull();
  });
});

describe('BODY_NORMAL_BLOCK', () => {
  it('runs after the body grain and before the gore, so its masks exist and paint still wins', () => {
    const grain = MARCH_TRACE_POST.indexOf('BODY GRAIN (body-grain.ts)');
    const nmap = MARCH_TRACE_POST.indexOf('BODY NORMAL MAP (body-normal.wgsl.ts)');
    expect(grain).toBeGreaterThan(-1);
    expect(nmap).toBeGreaterThan(grain);
    expect(MARCH_TRACE_POST.indexOf('GORE', nmap)).toBeGreaterThan(nmap);
  });

  it('is gated on strength and the torso prim range, and prefixes every local with nmap', () => {
    expect(BODY_NORMAL_BLOCK).toContain('if (nmapStr > 0.0 && hitBest >= i32(bodyNormAxis.z) && hitBest < i32(bodyNormAxis.w))');
    const locals = [...BODY_NORMAL_BLOCK.matchAll(/\b(?:let|var)\s+([A-Za-z_]\w*)/g)].map(m => m[1]!);
    expect(locals.length).toBeGreaterThan(0);
    expect(locals.every(n => n.startsWith('nmap'))).toBe(true);
  });
});

describe('registry body normal maps', () => {
  it('every declared map has a sidecar beside its PNG and a positive strength', () => {
    for (const name of characterNames()) {
      const bn = characterEntry(name).bodyNormal;
      if (!bn) continue;
      expect(bn.url.endsWith('.png')).toBe(true);
      expect(bn.meta).toBe(bn.url.replace(/\.png$/, '.json'));
      expect(bn.strength).toBeGreaterThan(0);
    }
  });
});
