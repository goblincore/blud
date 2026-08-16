// src/lab/sdf-zombie/webgpu/goo-layer.test.ts
//
// Nothing here compiles a shader — these are the same text guards
// march.wgsl.test.ts applies, extended to the goo surface pass: the wgslFn
// parse contract (source must start with `fn`, three's declarationRegexp is
// ^-anchored) and the reserved-word lint on declarations. Plus value pins
// on the tuning that the mist/goo split depends on.

import { describe, it, expect } from 'vitest';
import { GOO_TUNING, GOO_SURFACE_WGSL } from './goo-layer';

/** The reserved words WGSL reserves even without implementing (spec appendix). */
const RESERVED_WORDS = [
  'active', 'alignas', 'alignof', 'as', 'asm', 'asm_fragment', 'async',
  'attribute', 'auto', 'await', 'become', 'binding_array', 'cast', 'catch',
  'class', 'co_await', 'co_return', 'co_yield', 'coherent', 'column_major',
  'common', 'compile', 'compile_fragment', 'concept', 'const_cast',
  'consteval', 'constexpr', 'constinit', 'crate', 'debugger',
  'decltype', 'delete', 'demote', 'demote_to_helper', 'do', 'dynamic_cast',
  'enum', 'explicit', 'export', 'extends', 'extern', 'external', 'fallthrough',
  'filter', 'final', 'finally', 'friend', 'from', 'fxgroup', 'get', 'goto',
  'groupshared', 'highp', 'impl', 'implements', 'import', 'inline',
  'instanceof', 'interface', 'layout', 'lowp', 'macro', 'macro_rules',
  'match', 'mediump', 'meta', 'mod', 'module', 'move', 'mut', 'mutable',
  'namespace', 'new', 'nil', 'noexcept', 'noinline', 'nointerpolation',
  'noperspective', 'null', 'nullptr', 'of', 'operator', 'package', 'packoffset',
  'partition', 'pass', 'patch', 'pixelfragment', 'precise', 'precision',
  'premerge', 'priv', 'protected', 'pub', 'public', 'readonly', 'ref',
  'regardless', 'register', 'reinterpret_cast', 'require', 'resource',
  'restrict', 'self', 'set', 'shared', 'sizeof', 'smooth', 'snorm',
  'static', 'static_assert', 'static_cast', 'std', 'subroutine', 'super',
  'target', 'template', 'this', 'thread_local', 'throw', 'trait', 'try',
  'type', 'typedef', 'typeof', 'union', 'unorm', 'use', 'using', 'varying',
  'virtual', 'volatile', 'where', 'while', 'write', 'writeonly', 'yield',
];

describe('goo surface WGSL', () => {
  it('starts with fn, since three anchors its parse to ^', () => {
    expect(/^fn\s+gooSurface\s*\(/.test(GOO_SURFACE_WGSL)).toBe(true);
  });

  it('declares nothing reserved', () => {
    const declared = [
      ...GOO_SURFACE_WGSL.matchAll(/\b(?:let|var)\s+([a-z_][a-z_0-9]*)/gi),
      ...GOO_SURFACE_WGSL.matchAll(/[(,]\s*([a-z_][a-z_0-9]*)\s*:/gi),
    ].map(m => m[1]!);
    const clashes = declared.filter(d => RESERVED_WORDS.includes(d));
    expect(clashes).toEqual([]);
  });

  it('shades and depth-writes the metaball surface as specced', () => {
    // The metaball core: threshold discard, gradient normal, average-depth
    // fake depth, and the deep-red specular family.
    expect(GOO_SURFACE_WGSL).toContain('discard');
    expect(GOO_SURFACE_WGSL).toContain('textureLoad');
    expect(GOO_SURFACE_WGSL).toContain('smoothstep');
    expect(GOO_SURFACE_WGSL).toContain('vec3<f32>(0.35, 0.02, 0.05)');
    // The WebGPU [0,1] depth mapping three's perspective matrix produces.
    expect(GOO_SURFACE_WGSL).toContain('far * (viewDepth - near)');
  });
});

describe('goo tuning pins', () => {
  it('mist cutoff sits inside the burst droplet band (0.03-0.06)', () => {
    // burst() sizes droplets 0.03 + rng*0.03, so a cutoff inside that band
    // keeps SOME burst beads as mist while every trail droplet (0.22 ±
    // jitter) feeds the density field.
    expect(GOO_TUNING.mistMaxSize).toBeGreaterThan(0.03);
    expect(GOO_TUNING.mistMaxSize).toBeLessThan(0.06);
  });

  it('threshold leaves headroom for a lone blob to bead', () => {
    // A single falloff peaks near 1.0; the threshold must sit below that or
    // sparse drops vanish entirely instead of beading.
    expect(GOO_TUNING.threshold).toBeGreaterThan(0);
    expect(GOO_TUNING.threshold).toBeLessThan(1);
  });

  it('the density cap covers a fully-loaded sim plus scraps', () => {
    // The sim caps droplets at 600; scraps ride the same array, so 700
    // bounds any droplet population the sim can hold.
    expect(GOO_TUNING.maxParticles).toBeGreaterThanOrEqual(600);
  });
});
