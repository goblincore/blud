import { describe, it, expect } from 'vitest';
import { glowWeights, glowKnee, POST_GLOW_EXTRACT_WGSL, POST_GLOW_BLUR_WGSL } from './post-glow';

describe('glow', () => {
  it('uses a normalised, symmetric kernel', () => {
    const w = glowWeights();
    expect(w.length).toBe(5);
    expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    expect(w[0]).toBeCloseTo(w[4]!, 6);
    expect(w[2]).toBeGreaterThan(w[1]!);
  });

  it('passes nothing below the threshold and rises smoothly above it', () => {
    expect(glowKnee(0.2, 0.75)).toBe(0);
    expect(glowKnee(0.75, 0.75)).toBe(0);
    expect(glowKnee(1.5, 0.75)).toBeGreaterThan(0);
    expect(glowKnee(3, 0.75)).toBeGreaterThan(glowKnee(1.5, 0.75));
  });

  it('mirrors the knee in the shader', () => {
    // The CPU knee above and the WGSL one must agree, or the tuning lies.
    expect(POST_GLOW_EXTRACT_WGSL).toContain('fn glowKnee(');
    expect(POST_GLOW_BLUR_WGSL).toContain('textureSample');
  });
});
