import { describe, it, expect } from 'vitest';
import { AMBIENT_AT, AMBIENT_REF_DIST, WALL_CONTRIBUTION } from './ambient.wgsl';

describe('AMBIENT_AT — the hard perf constraint', () => {
  it('evaluates the SDF field ZERO times', () => {
    // THE gate for this spike, from the spec: "ambientAt must add zero
    // mapBody evaluations". Bounce is analytic — dot products and distance
    // falloff. If this ever fails, the lighting work has started charging
    // the march path and collides head-on with the raymarcher perf plan.
    expect(AMBIENT_AT).not.toContain('mapBody');
    expect(AMBIENT_AT).not.toContain('sdBody');
    expect(AMBIENT_AT).not.toContain('applyWounds');
    expect(AMBIENT_AT).not.toContain('textureSample');
    expect(AMBIENT_AT).not.toContain('textureLoad');
  });

  it('contains no loop that could hide a field sample', () => {
    // The six walls are unrolled deliberately: a loop invites someone to
    // put a march inside it later, and six iterations is not worth one.
    expect(AMBIENT_AT).not.toContain('loop {');
    expect(AMBIENT_AT).not.toContain('while ');
  });
});

describe('AMBIENT_AT — shape contract', () => {
  it('starts with fn, per the wgslFn parse contract', () => {
    // three.js TSL parses the parameter list out of the source string, so
    // the declaration must be the first thing in the file.
    expect(AMBIENT_AT.startsWith('fn ambientAt(')).toBe(true);
  });

  it('returns vec3 — ambient is a colour now, not a scalar', () => {
    expect(AMBIENT_AT).toContain('-> vec3<f32>');
  });

  it('early-outs to exactly fill * keyColor at probeWeight 0', () => {
    // The parity guarantee, pinned in the shader as well as the mirror.
    // Any refactor that turns this into a mix() breaks bit-exactness and
    // silently moves every owner-blessed visual.
    expect(AMBIENT_AT).toContain('if (bounceCfg.x <= 0.0) { return flat; }');
  });

  it('renormalises to unit luminance with Rec.709 weights', () => {
    // COLOUR, NOT BRIGHTNESS. Must match luminance() in ../ambient.ts.
    expect(AMBIENT_AT).toContain('vec3<f32>(0.2126, 0.7152, 0.0722)');
  });

  it('agrees with the CPU mirror on the falloff reference distance', () => {
    // The two copies of the maths share exactly one tunable; if it drifts,
    // the lab and the tests describe different rooms. It lives in
    // WALL_CONTRIBUTION (hoisted so ambientAt reads as six identical lines).
    expect(WALL_CONTRIBUTION).toContain(`${AMBIENT_REF_DIST}`);
  });

  it('honours the ceiling flag', () => {
    expect(AMBIENT_AT).toContain('bounceCfg.z');
  });
});
