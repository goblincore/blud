// src/lab/sdf-zombie/webgpu/game-march-accept.ts
//
// THE MARCH'S ACCEPT LAW AS THE GAME SHIPS IT: the numbers game-main writes into every body view's aaCfg.y/z/w and
// perfCfg.w. Pure constants, apart from main(), so that what depends on the law can be tested against the shipped
// values and not a copy of them: the head split's region shell is a bound only while the accept reach stays under
// REGION_MARGIN (head-split.ts splitDrawDistance, splitNearReach).

/** Perf round 2, task 6: the footprint-AA strength (aaCfg.y). When > 0 the
 *  march may accept a sample once the field is within the ray's projected
 *  PIXEL footprint (t * aaCfg.x) instead of the 1.2 mm literal — fewer
 *  steps at range, geometric aliasing prefiltered below Nyquist. The
 *  epsilon divides by the dominant prim's GROUP DISTORTION factor
 *  (gFoldBestDistort, up to 22x on the schoolgirl sole plate) so
 *  high-distortion regions cannot stop a ray short — the exact defect that
 *  kept this lever OFF when it first shipped (see march.wgsl.ts).
 *  `__sdfGame.setAa(strength)` flips it live for A/B; 0 is the old
 *  behaviour bit-for-bit (t * 0 / distort == t * 0 == 0). */
export const GAME_AA = 1.0;
/** DISTANCE-BASED ACCEPT (2026-09-22, cost census): accept strength GAME_AA_NEAR up
 *  close, fading to GAME_AA over [GAME_AA_FADE_M / 2, GAME_AA_FADE_M] metres. Owner A/B:
 *  invisible at 6 (and judged "okay" at 12 — 12 saves ~19 % of wounded-melee prim work vs
 *  ~15 % at 6; a one-number follow-up). `__sdfGame.setAaDistance(near, fadeM)`; 0 = off. */
export const GAME_AA_NEAR = 6.0;
export const GAME_AA_FADE_M = 3.0;
/** The last-step secant accept's factor (perfCfg.w) when `?laststep=` does not set one: see GAME_LAST_STEP in
 *  game-main.ts. */
export const GAME_LAST_STEP_DEFAULT = 4;
