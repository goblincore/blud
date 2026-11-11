import { describe, expect, it } from 'vitest';
import { normalLooseOn } from './normal-loose-flag';
import { SHADING_NORMAL_BLOCK } from './body/blocks/post/shading-normal.wgsl';

describe('?ngloose', () => {
  it('is off unless the page asks for it', () => {
    expect(normalLooseOn('')).toBe(false);
    expect(normalLooseOn('?ngloose=0')).toBe(false);
    expect(normalLooseOn('?ngloose')).toBe(true);
    expect(normalLooseOn('?level=doom-map28&ngloose=1')).toBe(true);
  });
  it('leaves the shipped text alone when off', () => {
    expect(SHADING_NORMAL_BLOCK).not.toContain('ngLoose');
    expect(SHADING_NORMAL_BLOCK).toContain('  if (!ngValid || debugNormal12) {');
  });
});
