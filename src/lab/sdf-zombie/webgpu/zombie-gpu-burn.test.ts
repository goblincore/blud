// Source tripwires for the burn uniforms' NAME bindings. Keys in the wgslFn
// call object bind BY NAME (three 0.186 resolves each WGSL input via
// parameters[inputNode.name]; proven GPU-free in wgslfn-binding.test.ts), so
// key ORDER cannot misbind — but a MISSING key binds float(0) with only a
// console error (see zombie-gpu.ts's KEYS BIND BY NAME note), so key PRESENCE
// is pinned by text, in the only place it is visible.
import { describe, it, expect } from 'vitest';
// @ts-expect-error — node:fs available in vitest via happy-dom/node
import { readFileSync } from 'node:fs';
import { MARCH_BODY_PARAMS } from './march.wgsl';

const src = readFileSync('src/lab/sdf-zombie/webgpu/zombie-gpu.ts', 'utf8');

const BURN_SCALARS = ['burnNoiseScale', 'burnRiseSpeed', 'burnCharPatch', 'burnFireGain', 'burnFireCoverage', 'burnSkeleton', 'burnSkeletonDepth'];

describe('burn uniform plumbing', () => {
  it('binds every burn uniform BY NAME at the call site — a missing key silently binds float(0)', () => {
    // Keys bind by NAME, so order cannot misbind; the hazard is a missing or
    // misnamed key, which binds float(0) with only a console error. The WGSL
    // parameter list ends with burnCfg then the six scalars; each needs its
    // key at the call site, spelled exactly as the signature spells it.
    const params = MARCH_BODY_PARAMS.replace(/\s+/g, ' ');
    const order = ['burnCfg: vec4<f32>', ...BURN_SCALARS.map(n => `${n}: f32`)];
    let at = -1;
    for (const p of order) {
      const next = params.indexOf(p);
      expect(next, p).toBeGreaterThan(at);
      at = next;
    }
    // Light list task 9 appends lightListCfg and the lightList storage after
    // the burn tail; the storage node is always bound (the zero fallback when
    // no list is passed), so its key is pinned here too.
    expect(params).toContain('burnSkeletonDepth: f32,');
    expect(src).toContain('lightListCfg: u.lightListCfg,');
    expect(src).toContain('lightList: (lightList ?? fallbackLightListNode()) as never,');
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

describe('shared light list plumbing (light list plan 1 task 9)', () => {
  it('defaults lightListCfg to 0 (the old key path) and routes the game list to bodies, crowds and the refine twin', () => {
    expect(src).toContain('sources?.lightList?.node,');
    expect(src.split('opts.lightList?.node,').length - 1).toBe(2);   // the body view and its refine twin
  });
});
