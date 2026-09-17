// src/lab/sdf-zombie/webgpu/goo-presets.ts
//
// THE GAME'S GOO DEFAULTS, in one importable place (blood-surface comparison
// task, 2026-09-13).
//
// game-main.ts owns the shipping values and they are set there as literals in
// a long documented block; this module mirrors them for pages that must
// render "the game look" without booting the whole game (the blood comparison
// page). It is a MIRROR, not a second source of truth: `goo-presets.test.ts`
// scans game-main's source and fails if any number here drifts from the
// literal the game actually applies.
//
// The owner's own tuning pass (2026-08-31) is the reason these are not
// GOO_TUNING: the shared table belongs to the LAB, whose look was tuned
// separately and must not move. Small blobs (0.14), blur off, stretch and
// gloss high, near-stationary gout — a sharp, wet, elongated read.

import type { GooLayer } from './goo-layer';

export interface GameGooDefaults {
  sizeScale: number;
  threshold: number;
  blurPx: number;
  mode: 'overlay' | 'depth';
  stretch: number;
  edge: number;
  absorb: number;
  spec: number;
  gloss: number;
  rim: number;
  shadowRed: number;
}

/** Verbatim from game-main.ts's GAME-PAGE GOO DEFAULTS block. */
export const GAME_GOO_DEFAULTS: GameGooDefaults = {
  sizeScale: 0.14,
  threshold: 0.65,
  blurPx: 0,
  mode: 'depth',
  stretch: 4,
  edge: 2.75,
  absorb: 1.6,
  spec: 2.85,
  gloss: 220,
  rim: 0,
  shadowRed: 0.19,
};

/**
 * Applies the game defaults to a goo layer in the SAME order game-main does.
 * Does not touch the candidate axes (reconstruction / connections): those
 * default to the shipped original path and are opt-in separately.
 */
export function applyGameGooDefaults(layer: GooLayer): void {
  layer.setSizeScale(GAME_GOO_DEFAULTS.sizeScale);
  layer.setThreshold(GAME_GOO_DEFAULTS.threshold);
  layer.setBlurPx(GAME_GOO_DEFAULTS.blurPx);
  layer.setMode(GAME_GOO_DEFAULTS.mode);
  layer.setStretch(GAME_GOO_DEFAULTS.stretch);
  layer.setEdge(GAME_GOO_DEFAULTS.edge);
  layer.setAbsorb(GAME_GOO_DEFAULTS.absorb);
  layer.setSpec(GAME_GOO_DEFAULTS.spec);
  layer.setGloss(GAME_GOO_DEFAULTS.gloss);
  layer.setRim(GAME_GOO_DEFAULTS.rim);
  layer.setShadowRed(GAME_GOO_DEFAULTS.shadowRed);
}
