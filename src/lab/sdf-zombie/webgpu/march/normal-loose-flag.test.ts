import { describe, expect, it } from 'vitest';
import { normalLooseOn } from './normal-loose-flag';
import { SHADING_NORMAL_BLOCK } from './body/blocks/post/shading-normal.wgsl';

describe('?ngloose', () => {
  it('is on unless the page turns it off', () => {
    expect(normalLooseOn('')).toBe(true);
    expect(normalLooseOn('?level=doom-map28')).toBe(true);
    expect(normalLooseOn('?ngloose=0')).toBe(false);
    expect(normalLooseOn('?ngloose')).toBe(true);
    expect(normalLooseOn('?level=doom-map28&ngloose=1')).toBe(true);
  });
  it('puts the cheaper fallback in the default text, and keeps the full normal near wounds', () => {
    // `&& !wvHit`: a baked crater's pixels keep the full normal too (wound-volume-flag.ts, on by default).
    expect(SHADING_NORMAL_BLOCK).toContain('if (!ngValid && ngRan && !hitNearWound && !wvHit) {');
    expect(SHADING_NORMAL_BLOCK).toContain('  if ((!ngValid && !ngLoose) || debugNormal12) {');
  });
});
