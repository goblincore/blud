// src/lab/sdf-zombie/webgpu/game-march-accept.ts
//
// THE MARCH'S ACCEPT LAW AS THE GAME SHIPS IT: the numbers game-main writes into every body view's aaCfg.y/z/w and
// perfCfg.w, and the march's step settings beside it (marchCfg.y, woundCfg2.y, perfCfg.x/y/z; moved here from game-spawn.ts,
// which re-exports them, so a lab page can run the game's march without importing the game). Pure constants, apart from main(), so that what depends on the law can be tested against the shipped
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

/**
 * Over-relaxation factor for the game page's march (woundCfg2.y).
 *
 * 1.0 = OFF, which falls through to marchCfg.y = 0.6. X1.10 measured 1.4 as
 * the optimum in the LAB and it is tempting here — it drops mean steps from
 * 18.1 to 10.7 and appears to resolve far more flesh (room 4: 26841 -> 50685
 * hit pixels).
 *
 * IT FAILED ITS VISUAL GATE ON THIS PAGE (2026-08-31). Those extra "hits"
 * are FALSE, and they are box-shaped: large translucent rectangles washing
 * over the walls, exactly the screen extents of the bodies' proxy boxes.
 * Mechanism is the same one that produced the shell halo — above omega 1.0
 * the tracer does `t = tMax; clamped = true` and takes a FINAL CLAMPED
 * SAMPLE, and at the far side of a big proxy box the AA epsilon
 * (t * aaCfg.x, growing with distance) accepts that sample as a surface.
 *
 * Interesting wrinkle worth keeping: the outer-hull shell SUPPRESSES the
 * artifact, because the false hits sit on box pixels outside the hull and
 * the shell discards those before the march runs (room 3 measured 8773
 * fewer hits with the shell on at 1.4, room 4 only 87 — the difference is
 * how much box lies outside the hull). So 1.4 may become available once the
 * shell defaults on, but it is not a free win on its own.
 *
 * Do not raise this without re-running the visual gate.
 */
export const GAME_RELAX = 1.0;
/** Perf round 2, task 1: the hull exit bounds tMax on the un-relaxed march
 *  (perfCfg.x). `__sdfGame.setHullExitBound()` flips it for A/B.
 *  DEFAULT OFF (task 1b finding): at real-render parity the bound deletes a
 *  whole background body's visible pixels (room 3: 2055 px, one
 *  figure-shaped component) while the occupancy hit set stays bit-identical
 *  — a cross-body hull-texture effect, not a per-ray loss. Do not raise
 *  until task 1c's shell-exit diagnosis explains the deletion and both
 *  rooms pass the parity gate with the bound on.
 *
 *  FLIPPED TO 1 (close-up task 1b, 2026-09-04). Task 1c's diagnosis IS the
 *  deletion's explanation: the shell-out target was written through the
 *  scene fog (mix(dist, fogColor, smoothstep(near, far, viewZ))), so far
 *  bodies' exit distances read ~2.8 m at a true 9 m and the bound cut the
 *  march short of them — 4 of 9 bodies vanished from the census. With
 *  material.fog = false (occluder-hull.ts / shell-hull-outer.ts) the
 *  written distance is exact, and the re-taken census (scripts/
 *  sdf-exit-bound-census.mjs, five views: room 1 at 0.5/3/9 m + rooms 3/4
 *  standoff) reads hits/rasterised/meanStepsHit BIT-IDENTICAL on/off with
 *  pixel diffs at/below the noise floor — including the multi-body rooms
 *  where the deletion historically happened. The step win survives:
 *  missStepShare 0.58 → 0.46 (room-4 standoff), meanStepsHit unchanged;
 *  r2's timed −0.28 ms stands, and the frame-time A/B could not resolve
 *  ±1 ms on that night's machine (spread 11-40%, load quoted per row) —
 *  the flip rests on exactness + counters, not on that timing. */
export const GAME_HULL_EXIT_BOUND = 1;
/** Perf round 2, task 3: skip a wound's meta/cap texel loads when the
 *  sample is beyond the wound's reach (perfCfg.y). Exact-by-construction —
 *  see the march.wgsl.ts reach comment; `__sdfGame.setWoundEarlyOut()`
 *  flips it live for A/B. */
export const GAME_WOUND_EARLY_OUT = 1;
/**
 * Step multiplier for the game page's march (marchCfg.y). The lab ships
 * 0.6 (under-relaxed) to survive the fbm shell displacement, which this
 * page runs with amplitude 0. With a conservative field, 1.0 is plain
 * sphere tracing: exact, fewer steps, and it never enters the omega > 1
 * overshoot path that produced the 2026-08-31 box washes.
 * `__sdfGame.setOmega()` flips it live for A/B.
 */
export const GAME_OMEGA = 1.0;
/** Near-wound step multiplier the GAME ships (perfCfg.z; 0 would mean the
 *  shader's sound constant WOUND_STEP_MUL 0.6). 1.0 on the owner's look
 *  verdict (2026-09-05, own tab, stacked craters at close and mid range:
 *  "1.0 seems fine, no major visual differences"); the wounds bench prices
 *  the 0.6 zone at 6–30% of a wounded fill-screen frame. The lab keeps the
 *  sound constant — march-step-soundness.test.ts pins it below 0.6. */
export const GAME_WOUND_STEP = 1.0;
