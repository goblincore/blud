import { describe, it, expect } from 'vitest';
import { tongueProfile, tonguePixelLength, POST_TONGUES_WGSL } from './post-tongues';

describe('screen-space tongues', () => {
  it('falls off from the body and dies at the tip', () => {
    expect(tongueProfile(0, 1)).toBeCloseTo(1, 6);   // at the silhouette
    expect(tongueProfile(1, 1)).toBe(0);             // at full length
    expect(tongueProfile(1.5, 1)).toBe(0);           // past the tip
    expect(tongueProfile(0.5, 1)).toBeGreaterThan(0);
    expect(tongueProfile(0.5, 1)).toBeLessThan(tongueProfile(0.25, 1));
  });

  it('keeps flames a constant WORLD size, so distance shortens them in pixels', () => {
    const near = tonguePixelLength(0.45, 2, 540, 1.0);
    const far = tonguePixelLength(0.45, 8, 540, 1.0);
    expect(near).toBeGreaterThan(far * 3);
    expect(tonguePixelLength(0, 2, 540, 1)).toBe(0);
  });

  it('mirrors the profile in the shader and reads the burn mask, not the colour', () => {
    expect(POST_TONGUES_WGSL).toContain('fn tongueProfile(');
    expect(POST_TONGUES_WGSL).toContain('burnTex');
    expect(POST_TONGUES_WGSL).toContain('depthTex');
  });
});
