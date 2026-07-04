import { describe, it, expect } from 'vitest';
import { THEMES, DEFAULT_THEME, getTheme, themeIds } from './themes';

describe('theme data (distilled from patterns.json, checked in)', () => {
  it('has at least 2 themes with sane densities', () => {
    const ids = themeIds();
    expect(ids.length).toBeGreaterThanOrEqual(2);
    for (const id of ids) {
      const t = getTheme(id);
      expect(t.sourceMaps.length).toBeGreaterThan(0);
      expect(t.propPer100Cells).toBeGreaterThanOrEqual(2);
      expect(t.propPer100Cells).toBeLessThanOrEqual(12);
      expect(t.rubblePer100Cells).toBeGreaterThanOrEqual(1);
      expect(t.rubblePer100Cells).toBeLessThanOrEqual(6);
      expect(t.materialSetId).toBe(id);
    }
  });

  it('DEFAULT_THEME is a valid theme with a stable index per theme', () => {
    expect(themeIds()).toContain(DEFAULT_THEME);
    const indices = themeIds().map((id) => getTheme(id).index);
    expect(new Set(indices).size).toBe(indices.length); // unique fork indices
  });
});
