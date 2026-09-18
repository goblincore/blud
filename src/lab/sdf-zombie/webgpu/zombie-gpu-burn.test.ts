// Source tripwires for the burn uniform's positional binding. A misplaced key
// hands the shader a DIFFERENT uniform and fails silently (zombie-gpu.ts:1225),
// so the contract is pinned by text, in the only place it is visible.
import { describe, it, expect } from 'vitest';
// @ts-expect-error — node:fs available in vitest via happy-dom/node
import { readFileSync } from 'node:fs';
import { MARCH_BODY_PARAMS } from './march.wgsl';

const src = readFileSync('src/lab/sdf-zombie/webgpu/zombie-gpu.ts', 'utf8');

const BURN_SCALARS = ['burnNoiseScale', 'burnRiseSpeed', 'burnCharPatch', 'burnFireGain', 'burnFireCoverage', 'burnSkeleton'];

describe('burn uniform plumbing', () => {
  it('declares the burn uniforms', () => {
    expect(src).toContain('burnCfg: uniform(new THREE.Vector4(0, 0, 0, 0))');
    for (const name of BURN_SCALARS) expect(src).toContain(`${name}: uniform(`);
  });

  it('binds the burn uniforms last, in the same order as the WGSL tail', () => {
    // The WGSL parameter list ends with burnCfg then the five scalars, so every
    // positional binding object must end with them in that order.
    const params = MARCH_BODY_PARAMS.replace(/\s+/g, ' ');
    const order = ['burnCfg: vec4<f32>', ...BURN_SCALARS.map(n => `${n}: f32`)];
    let at = -1;
    for (const p of order) {
      const next = params.indexOf(p);
      expect(next, p).toBeGreaterThan(at);
      at = next;
    }
    expect(params).toMatch(/burnSkeleton: f32\s*\)/);
    const binds = [...src.matchAll(/burnCfg: u\.burnCfg,/g)];
    expect(binds.length).toBeGreaterThan(0);
    for (const name of BURN_SCALARS) expect(src).toContain(`${name}: u.${name},`);
  });

  it('carries the body burn state into the crowd record', () => {
    expect(src).toContain('burn: u.burnCfg.value.x');
    expect(src).toContain('burnSec: u.burnCfg.value.y');
    expect(src).toContain('charAmount: u.burnCfg.value.z');
  });
});
