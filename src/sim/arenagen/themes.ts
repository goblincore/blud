// src/sim/arenagen/themes.ts
// Typed access to the distilled theme records. Data is generated + checked in;
// the sim firewall never parses JSON at runtime.
import { THEMES, DEFAULT_THEME, type ThemeId, type ThemeRecord } from './theme-data';

export { THEMES, DEFAULT_THEME };
export type { ThemeId, ThemeRecord };

export function getTheme(id: ThemeId): ThemeRecord {
  const t = THEMES[id];
  if (!t) throw new Error(`unknown theme '${id}'`);
  return t;
}

export function themeIds(): ThemeId[] {
  return Object.keys(THEMES);
}
