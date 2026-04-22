export interface PostFxConfig {
  vignette: { enabled: boolean; offset: number; darkness: number };
  dither:   { enabled: boolean; strength: number };
  ca:       { enabled: boolean; baseline: number };
  grain:    { enabled: boolean; amount: number };
  scanlines: { enabled: boolean };
  barrel:   { enabled: boolean };
}

export const DEFAULT_POST_FX: PostFxConfig = {
  vignette: { enabled: true, offset: 0.35, darkness: 0.6 },
  dither:   { enabled: true, strength: 0.5 },
  ca:       { enabled: true, baseline: 0.0025 },
  grain:    { enabled: true, amount: 0.08 },
  scanlines: { enabled: false },
  barrel:   { enabled: false },
};

export function isDevPanelEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('devfx') === '1';
}
