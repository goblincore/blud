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
  it('puts the cheaper fallback in the default text, and keeps the full normal near a wound the analytic one does not support', () => {
    // Near a wound the taps are kept only for a shape the analytic normal does not support (reason 1: a cut, a torn
    // wound): `?ngwound=8` is the default (normal-wound-flag.ts). No `&& !wvHit`: the baked volume is off under the
    // crater grid.
    expect(SHADING_NORMAL_BLOCK).toContain('if (!ngValid && ngRan && (!hitNearWound || ngReason != 1)) {');
    expect(SHADING_NORMAL_BLOCK).toContain('  if ((!ngValid && !ngLoose) || debugNormal12) {');
  });
});
