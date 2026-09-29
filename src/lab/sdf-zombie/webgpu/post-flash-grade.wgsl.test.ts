import { describe, expect, it } from 'vitest';
import { FLASH_GRADE_WGSL } from './post-flash-grade.wgsl';

describe('post-flash-grade.wgsl', () => {
  it('declares one fn and returns the input untouched when idle', () => {
    expect(FLASH_GRADE_WGSL.trim().startsWith('fn flashGrade(')).toBe(true);
    expect(FLASH_GRADE_WGSL.match(/\bfn /g)).toHaveLength(1);
    expect(FLASH_GRADE_WGSL).toContain('if (g.x <= 0.0 && g.y <= 0.0) { return c; }');
  });
});
