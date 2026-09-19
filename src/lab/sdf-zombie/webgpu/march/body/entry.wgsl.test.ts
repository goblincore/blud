// src/lab/sdf-zombie/webgpu/march/body/entry.wgsl.test.ts
//
// Moved verbatim from march.wgsl.test.ts (march split task 3, 2026-09-19):
// the assertions that pin `entry`. Nothing here compiles a shader; these guard
// what CAN be checked from text. See march/helpers.test.ts for the parse
// contract and docs/dev-notes/2026-09-18-march-split/ for the split.

import { describe, it, expect } from 'vitest';
import { MARCH_BODY } from '../../march.wgsl';

// Hybrid deferred M1 task 2: MARCH_BODY is assembled from named sections so
// the deferred surface entry (deferred-sdf.ts) shares the trace and material
// text verbatim. These pin the ASSEMBLY — the surface entry itself is pinned
// in deferred-sdf.test.ts.
describe('MARCH_BODY section split (hybrid deferred M1 task 2)', () => {
  it('is exactly fn marchBody + params + trace + surface-prep + light', async () => {
    const m = await import('../../march.wgsl');
    expect(m.MARCH_BODY).toBe(
      `fn marchBody${m.MARCH_BODY_PARAMS}${m.MARCH_BODY_TRACE}${m.MARCH_BODY_SURFACE_PREP}${m.MARCH_BODY_LIGHT}`,
    );
    // The entry point still satisfies the wgslFn ^-anchor.
    expect(MARCH_BODY.startsWith('fn marchBody(')).toBe(true);
  });

  it('the wet/specPow/glow hoist is arithmetic-neutral: each term defined ONCE, before the flashlight', () => {
    // The hoist exists so the surface entry can exit before lighting while
    // sharing the terms. A duplicated definition would mean the two entries
    // diverged — the failure this split exists to prevent.
    expect(MARCH_BODY.match(/\blet specPow\b/g)).toHaveLength(1);
    expect(MARCH_BODY.match(/var wet = /g)).toHaveLength(1);
    expect(MARCH_BODY.match(/let glow = /g)).toHaveLength(1);
    expect(MARCH_BODY.indexOf('let specPow')).toBeLessThan(MARCH_BODY.indexOf('ANALYTIC FLASHLIGHT'));
    expect(MARCH_BODY.indexOf('let wetWound')).toBeLessThan(MARCH_BODY.indexOf('ANALYTIC FLASHLIGHT'));
    expect(MARCH_BODY.indexOf('let glow =')).toBeLessThan(MARCH_BODY.indexOf('ANALYTIC FLASHLIGHT'));
    // shine consumes the shared exponent — the legacy inline mix, named.
    expect(MARCH_BODY).toContain('let shine = pow(max(dot(n, H), 0.0), specPow);');
    expect(MARCH_BODY).toContain('let specPow = mix(mix(128.0, 4.0, surfCfg.y), 220.0, gloss);');
  });

  it('the light tail keeps every light-dependent term — nothing leaked into the shared sections', async () => {
    const m = await import('../../march.wgsl');
    for (const marker of [
      'ANALYTIC FLASHLIGHT', 'ambientAt(', 'woundShadow(', 'levelShadow(',
      'var fleshLit', 'softShoulder(', '0.04045',
    ]) {
      expect(m.MARCH_BODY_LIGHT).toContain(marker);
      // The trace and surface-prep are the sections the surface entry reuses;
      // they must stay light-free (signatures legitimately NAME the light
      // params — check the bodies only).
      expect(m.MARCH_BODY_TRACE).not.toContain(marker);
      expect(m.MARCH_BODY_SURFACE_PREP).not.toContain(marker);
    }
  });
});

describe('run 5: MARCH_BODY_TRACE is SETUP + LOOP + POST', () => {
  it('concatenates textually and splits at the walk', async () => {
    const m = await import('../../march.wgsl');
    expect(m.MARCH_BODY_TRACE).toBe(`${m.MARCH_TRACE_SETUP}${m.MARCH_TRACE_LOOP}${m.MARCH_TRACE_POST}`);
    expect(m.MARCH_TRACE_LOOP.startsWith('  var t = clamp(max(max(max(max(startT')).toBe(true);
    expect(m.MARCH_TRACE_POST.startsWith('  if (!hit) { discard; }')).toBe(true);
    expect(m.MARCH_TRACE_SETUP).not.toContain('for (var i = 0; i < 512');
    expect(m.MARCH_TRACE_LOOP).toContain('for (var i = 0; i < 512');
    expect(m.MARCH_TRACE_POST).not.toContain('for (var i = 0; i < 512');
  });

  it('calcNormal takes its stencil size from gNormalEps, default 0.0015', async () => {
    const m = await import('../../march.wgsl');
    expect(m.CALC_NORMAL).toContain('var<private> gNormalEps: f32 = 0.0015;');
    expect(m.CALC_NORMAL).toContain('let e = vec2<f32>(1.0, -1.0) * gNormalEps;');
    expect(m.CALC_NORMAL).not.toContain('* 0.0015;');
  });

  it('REFINE_BODY is params + setup + REFINE_LOOP + post + prep + light, with four refine params appended', async () => {
    const m = await import('../../march.wgsl');
    expect(m.REFINE_BODY).toBe(`fn refineBody${m.REFINE_PARAMS}${m.MARCH_TRACE_SETUP}${m.REFINE_LOOP}${m.MARCH_TRACE_POST}${m.MARCH_BODY_SURFACE_PREP}${m.MARCH_BODY_LIGHT}`);
    expect(m.REFINE_PARAMS.endsWith('  marchTex: texture_2d<f32>,\n  cosRay: f32,\n  nearFar: vec2<f32>,\n  refineCfg: vec4<f32>,\n  normalTex: texture_2d<f32>\n) -> vec4<f32> {\n')).toBe(true);
    expect(m.REFINE_PARAMS.startsWith(m.MARCH_BODY_PARAMS.slice(0, m.MARCH_BODY_PARAMS.lastIndexOf(')')).replace(/\s*$/, ''))).toBe(true);
  });
  it('REFINE_LOOP declares every name the walk declares that the later sections read', async () => {
    const m = await import('../../march.wgsl');
    // Strip WGSL comments: the pin is about names read as CODE, not mentioned in prose.
    const later = `${m.MARCH_TRACE_POST}${m.MARCH_BODY_SURFACE_PREP}${m.MARCH_BODY_LIGHT}`
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    const declared = [...m.MARCH_TRACE_LOOP.matchAll(/\b(?:let|var)\s+([A-Za-z_]\w*)/g)].map((x) => x[1]!);
    const needed = [...new Set(declared)].filter((n) => new RegExp(`\\b${n}\\b`).test(later));
    expect(needed.length).toBeGreaterThan(0);
    for (const n of needed) expect(m.REFINE_LOOP, `REFINE_LOOP must declare ${n}`).toMatch(new RegExp(`\\b(?:let|var)\\s+${n}\\b`));
  });
  it('REFINE_LOOP rejects on the SDF distance before any Newton step, never walks, and sets gNormalEps', async () => {
    const m = await import('../../march.wgsl');
    expect(m.REFINE_LOOP).not.toContain('for (var i = 0; i < 512');
    const reject = m.REFINE_LOOP.indexOf('refineCfg.y');
    const newton = m.REFINE_LOOP.indexOf('t = t + dres.x');
    expect(reject).toBeGreaterThan(-1); expect(newton).toBeGreaterThan(reject);
    expect(m.REFINE_LOOP).toContain('gNormalEps = ');
    expect(m.REFINE_LOOP).toContain('if (wsum < 0.5) { discard; }');
  });
  it('run 5b: the march writes the per-body key into the normal attachment alpha', async () => {
    const m = await import('../../march.wgsl');
    expect(m.MARCH_BODY_LIGHT).toContain('let bodyKey = dot(gInstCentre, vec3<f32>(1.0, 7.31, 13.7)) + 1.0;');
    expect(m.MARCH_BODY_LIGHT).toContain('gMarchNormal = vec4<f32>(normalize(n), bodyKey);');
    expect(m.MARCH_BODY_LIGHT).not.toContain('gMarchNormal = vec4<f32>(normalize(n), 1.0);');
  });
  it('run 5b: the ownership early-out precedes the first mapBody in REFINE_LOOP', async () => {
    const m = await import('../../march.wgsl');
    expect(m.REFINE_LOOP).toContain('let myKey = dot(gInstCentre, vec3<f32>(1.0, 7.31, 13.7)) + 1.0;');
    const gate = m.REFINE_LOOP.indexOf('nk != myKey');
    const map = m.REFINE_LOOP.indexOf('mapBody(');
    expect(gate).toBeGreaterThan(-1);
    expect(map).toBeGreaterThan(gate);
  });
});
