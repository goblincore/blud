// src/lab/sdf-zombie/webgpu/crt-handoff.ts
//
// THE CRT'S PICTURE ACROSS THE PAGE HOP (spec 2026-10-21 §3.2). The Night Train captures the last frame the player saw; the Flat's CRT shows it.
// The picture is a PNG data URL in sessionStorage, which survives a same-tab navigation. Pure: the storage is injected, every access is guarded
// (a private window, a full quota or blocked site data must never break the hand-over: the Flat falls back to its committed still).
export interface KeyValueStorage { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }
export const CRT_KEY = 'blud.crtPicture';
/** The data URL's length cap (characters; about 1.5 MB of PNG). */
export const CRT_MAX_CHARS = 2_000_000;
/** The captured picture's size (4:3, the CRT's picture). */
export const CRT_SIZE = { width: 512, height: 384 } as const;
const PNG_PREFIX = 'data:image/png;base64,';

export function saveCrtPicture(storage: KeyValueStorage, dataUrl: string): boolean {
  if (!dataUrl.startsWith(PNG_PREFIX) || dataUrl.length > CRT_MAX_CHARS) return false;
  try { storage.setItem(CRT_KEY, dataUrl); return true; } catch { return false; }
}
export function loadCrtPicture(storage: KeyValueStorage): string | null {
  try {
    const v = storage.getItem(CRT_KEY);
    return v !== null && v.startsWith(PNG_PREFIX) && v.length <= CRT_MAX_CHARS ? v : null;
  } catch { return null; }
}
export function clearCrtPicture(storage: KeyValueStorage): void {
  try { storage.removeItem(CRT_KEY); } catch { /* nothing to clear */ }
}
/** The page's sessionStorage, or null where touching it throws. */
export function sessionStore(): KeyValueStorage | null {
  try { return typeof sessionStorage === 'undefined' ? null : sessionStorage; } catch { return null; }
}

/** Is this RGBA buffer a flat colour (a blank capture)? True when the luma's standard deviation is under 2 (of 255), or the buffer is empty. */
export function looksBlank(rgba: Uint8ClampedArray): boolean {
  const n = rgba.length / 4;
  if (n === 0) return true;
  let sum = 0, sum2 = 0;
  for (let i = 0; i < n; i++) {
    const y = 0.2126 * rgba[i * 4]! + 0.7152 * rgba[i * 4 + 1]! + 0.0722 * rgba[i * 4 + 2]!;
    sum += y; sum2 += y * y;
  }
  const mean = sum / n;
  return Math.sqrt(Math.max(0, sum2 / n - mean * mean)) < 2;
}
