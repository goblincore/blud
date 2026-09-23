import { describe, it, expect } from 'vitest';
import { VHS_PRESETS, effectiveSmear, POST_VHS_WGSL } from './post-vhs';

describe('VHS_PRESETS', () => {
  // The one row that is NOT club-mutant's: the owner's sweep, made in
  // vhs-panel.ts and shipped as the default. Pinned for the same reason as
  // the other three — it is the look the game boots at, and a silent drift
  // changes that look with no error anywhere.
  it('matches the owner-tuned blud preset exactly — the shipped default', () => {
    expect(VHS_PRESETS.blud).toEqual({
      intensity: 0.64, blurAmount: 1, noiseAmount: 0.005, gradeAmount: 1,
      warpAmount: 0.3, warpFrequency: 1.1, warpSpeed: 0.05,
      chromaAmount: 4.6, chromaJitter: 10, motionThreshold: 0.06,
      chromaBurstChance: 0.61, chromaBurstStrength: 0.5, chromaBurstRate: 41,
    });
  });
  it('matches the club-mutant soft preset exactly — it is the source of truth', () => {
    expect(VHS_PRESETS.soft).toEqual({
      intensity: 0.7, blurAmount: 0.45, noiseAmount: 0.04, gradeAmount: 0.55,
      warpAmount: 1.25, warpFrequency: 1.5, warpSpeed: 0.25,
      chromaAmount: 0.6, chromaJitter: 0.6, motionThreshold: 0.12,
      chromaBurstChance: 0.02, chromaBurstStrength: 0.6, chromaBurstRate: 12,
    });
  });
  it('matches the club-mutant balanced preset exactly', () => {
    expect(VHS_PRESETS.balanced).toEqual({
      intensity: 1, blurAmount: 0.35, noiseAmount: 0.07, gradeAmount: 0.6,
      warpAmount: 2.5, warpFrequency: 2.0, warpSpeed: 0.35,
      chromaAmount: 2.5, chromaJitter: 1.75, motionThreshold: 0.08,
      chromaBurstChance: 0.08, chromaBurstStrength: 0.9, chromaBurstRate: 18,
    });
  });
  it('matches the club-mutant chaotic preset exactly', () => {
    expect(VHS_PRESETS.chaotic).toEqual({
      intensity: 1, blurAmount: 0.25, noiseAmount: 0.14, gradeAmount: 0.85,
      warpAmount: 3.5, warpFrequency: 2.5, warpSpeed: 0.5,
      chromaAmount: 7, chromaJitter: 4, motionThreshold: 0.04,
      chromaBurstChance: 0.38, chromaBurstStrength: 1.6, chromaBurstRate: 55,
    });
  });
  it('orders the three club-mutant presets by escalating chroma', () => {
    expect(VHS_PRESETS.soft.chromaAmount).toBeLessThan(VHS_PRESETS.balanced.chromaAmount);
    expect(VHS_PRESETS.balanced.chromaAmount).toBeLessThan(VHS_PRESETS.chaotic.chromaAmount);
  });
  it('has every term defined on every preset', () => {
    const keys = Object.keys(VHS_PRESETS.soft);
    for (const p of ['blud', 'soft', 'balanced', 'chaotic'] as const) {
      expect(Object.keys(VHS_PRESETS[p]).sort()).toEqual(keys.sort());
      for (const k of keys) expect(Number.isFinite((VHS_PRESETS[p] as never as Record<string, number>)[k])).toBe(true);
    }
  });
});

describe('effectiveSmear', () => {
  it('suppresses smear while VHS owns temporal blending', () => {
    expect(effectiveSmear(0.25, true)).toBe(0);
  });
  it('passes the user setting through when VHS is off', () => {
    expect(effectiveSmear(0.25, false)).toBe(0.25);
    expect(effectiveSmear(0, false)).toBe(0);
  });
  it('never mutates the user setting — off after on restores it', () => {
    const user = 0.4;
    effectiveSmear(user, true);
    expect(effectiveSmear(user, false)).toBe(0.4);
  });
});

/** Parameter names of `fn postVhs(` — the signature only, up to `) ->`. */
function postVhsParamNames(): string[] {
  const start = POST_VHS_WGSL.indexOf('fn postVhs(');
  const end = POST_VHS_WGSL.indexOf(') ->', start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return [...POST_VHS_WGSL.slice(start, end).matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*:/g)]
    .map(m => m[1]!);
}

describe('POST_VHS_WGSL', () => {
  it('starts with its main fn — three anchors the wgslFn parse at ^', () => {
    expect(POST_VHS_WGSL.trimStart().startsWith('fn postVhs')).toBe(true);
  });
  it('declares every VhsTerms key as a parameter of fn postVhs, and nothing else', () => {
    // The signature, not a substring: a term that only appears in the body (or
    // a helper) must fail this. The allowed non-term slots are the two
    // textures, the sampler and the four scalars the chain feeds.
    const params = postVhsParamNames();
    const terms = Object.keys(VHS_PRESETS.soft);
    for (const term of terms) expect(params).toContain(term);
    const allowed = new Set([
      'tex', 'samp', 'prevTex', 'uv', 'time', 'hasPrev', 'isDisplay', ...terms,
    ]);
    for (const p of params) expect(allowed).toContain(p);
  });
  it('derives resolution from the texture and never declares a resolution parameter', () => {
    // A stale uniform after post-aa's refit() would silently change the texel
    // size and the warp amplitude; the texture is the only truthful source.
    expect(POST_VHS_WGSL).toContain('textureDimensions(tex, 0)');
    expect(postVhsParamNames()).not.toContain('resolution');
    // The helpers take resolution as an argument (they have no texture to
    // size from); only the ENTRY signature must not declare it.
    const start = POST_VHS_WGSL.indexOf('fn postVhs(');
    const end = POST_VHS_WGSL.indexOf(') ->', start);
    expect(POST_VHS_WGSL.slice(start, end)).not.toContain('resolution:');
  });
  it('wraps the seconds clock before it feeds any hash', () => {
    // At ~600 s the unwrapped `floor(time * 60) * 345.45` loses f32 precision
    // and the hash pins to 0 — noise goes constant, bursts never fire.
    expect(POST_VHS_WGSL).toContain('let t = time - 600.0 * floor(time / 600.0);');
    expect(POST_VHS_WGSL).toContain('time is SECONDS');
  });
  it('samples prevTex only inside the hasPrev branch', () => {
    const bodyStart = POST_VHS_WGSL.indexOf(') -> vec4<f32> {');
    const gateStart = POST_VHS_WGSL.indexOf('if (hasPrev > 0.5) {');
    const gateEnd = POST_VHS_WGSL.indexOf('}', gateStart);
    expect(bodyStart).toBeGreaterThan(-1);
    expect(gateStart).toBeGreaterThan(bodyStart);
    expect(gateEnd).toBeGreaterThan(gateStart);
    const uses = [...POST_VHS_WGSL.matchAll(/prevTex/g)]
      .map(m => m.index!)
      .filter(i => i > bodyStart);
    expect(uses.length).toBeGreaterThan(0);
    for (const i of uses) {
      expect(i).toBeGreaterThan(gateStart);
      expect(i).toBeLessThan(gateEnd);
    }
  });
  it('blurs horizontally only, reusing the centre tap', () => {
    // The source's 3x3 blur9 vertical taps erase the interlace comb.
    expect(POST_VHS_WGSL).not.toContain('postVhsBlur9');
    expect(POST_VHS_WGSL).toContain('fn postVhsBlurH(');
    const blur = POST_VHS_WGSL.slice(POST_VHS_WGSL.indexOf('fn postVhsBlurH('));
    expect(blur).toContain('uv - vec2<f32>(texel.x, 0.0)');
    expect(blur).toContain('uv + vec2<f32>(texel.x, 0.0)');
    expect(blur).not.toContain('texel.y');
  });
  it('returns opaque alpha, matching the blend/blit siblings', () => {
    expect(POST_VHS_WGSL).toContain('return vec4<f32>(color, 1.0);');
  });
  it('is WGSL, not GLSL — no leftover GLSL types or samplers', () => {
    expect(POST_VHS_WGSL).not.toContain('texture2D(');
    expect(POST_VHS_WGSL).not.toContain('sampler2D');
    expect(POST_VHS_WGSL).not.toMatch(/\bvarying\b/);
    expect(POST_VHS_WGSL).not.toMatch(/\bvec3 [a-zA-Z]/);
  });
  it('prefixes every helper per the house convention (boneHash, postAaOetf)', () => {
    // An unprefixed helper collides the first time this shader shares a
    // material with another that defines the same name.
    const fns = [...POST_VHS_WGSL.matchAll(/\bfn\s+([A-Za-z0-9_]+)\s*\(/g)].map(m => m[1]!);
    expect(fns.length).toBeGreaterThan(1);
    for (const f of fns) expect(f.startsWith('postVhs')).toBe(true);
  });
  it('has balanced braces', () => {
    const open = (POST_VHS_WGSL.match(/\{/g) ?? []).length;
    const close = (POST_VHS_WGSL.match(/\}/g) ?? []).length;
    expect(open).toBe(close);
  });
});
