// src/lab/sdf-zombie/burn-state.ts
//
// HOW ALIGHT A BODY IS — the whole burn model, pure and three-free so the lab,
// the tests and (spec 2) the game's actors all step the same numbers.
//
// Three values, because the look needs three different clocks:
//   burn    0..1  how much fire is on the body RIGHT NOW. Ramps up when lit,
//                 decays when put out, and is what the shader scales fire by.
//   burnSec       seconds of continuous burning, for the flame noise phase, so
//                 two bodies lit at different times do not flicker in lockstep.
//   char    0..1  accumulated blackening. MONOTONIC: a body that burned and was
//                 put out stays charred, which is the difference between a
//                 burnt corpse and a clean one.
//   dying         a KILLED body whose fire is burning down (flame-polish task
//                 5): over corpseBurnSec the char completes and the fire fades
//                 to nothing, then the flag clears — the corpse stays charred
//                 and cold. `corpseSec` is the seconds elapsed in that window.

export interface BurnState {
  burn: number;
  burnSec: number;
  char: number;
  alight: boolean;
  /** Killed while burning: burn-down is running (flame-polish task 5). */
  dying: boolean;
  /** Seconds elapsed into the burn-down; 0 unless `dying`. */
  corpseSec: number;
}

/** The subset of BurnTuning this module needs; BurnTuning is a superset. */
export interface BurnRates {
  igniteSec: number;
  extinguishSec: number;
  charRate: number;
  /** Seconds a killed, burning body takes to char fully and go out. */
  corpseBurnSec: number;
}

// NaN-safe clamp to [0, 1]. Any non-numeric input (NaN from a bad tuning
// value propagating through) falls through the first comparison to 0 rather
// than surviving — `NaN < 0` and `NaN > 1` are both false, which is why the
// naive `v < 0 ? 0 : v > 1 ? 1 : v` form used to let NaN through unclamped.
// Hoisted to module scope: stepBurn runs per body per frame and this avoids
// re-creating the closure on every call.
const clamp01 = (v: number) => (v > 0 ? (v < 1 ? v : 1) : 0);

export function createBurnState(): BurnState {
  return { burn: 0, burnSec: 0, char: 0, alight: false, dying: false, corpseSec: 0 };
}

/**
 * Start ramping `burn` toward 1 on the next `stepBurn` call(s).
 * Does not change `burn` itself — only takes effect once stepped.
 *
 * Also cancels a burn-down: re-lighting a corpse returns it to normal burning,
 * so `dying` never fights the ignite/extinguish verbs.
 */
export function igniteBurn(s: BurnState): void {
  s.alight = true;
  s.dying = false;
  s.corpseSec = 0;
}

/**
 * Start decaying `burn` toward 0 on the next `stepBurn` call(s).
 * Does not change `burn` itself — only takes effect once stepped.
 *
 * Also cancels a burn-down (see igniteBurn).
 */
export function extinguishBurn(s: BurnState): void {
  s.alight = false;
  s.dying = false;
  s.corpseSec = 0;
}

/**
 * A body was KILLED while burning (flame-polish task 5). Unlike `extinguishBurn`
 * this does NOT drop the fire at once: over the next `corpseBurnSec` the char
 * drives to 1 and the fire fades linearly out, so the capture shows a flame
 * that dies down instead of snapping off. The body stays charred afterwards; the
 * `dying` flag clears itself at the end so nothing keeps stepping it.
 *
 * Does not change `burn` itself — only takes effect once stepped.
 */
export function killBurning(s: BurnState): void {
  s.alight = false;
  s.dying = true;
  s.corpseSec = 0;
}

/**
 * Advance one body's burn state by `dt` seconds.
 *
 * `dt` is in seconds. A non-finite or non-positive `dt` (NaN, negative,
 * zero) is a no-op. This function does not clamp `dt` itself — the house
 * convention is for the caller to clamp at the call site (e.g.
 * `Math.min(dt, 1/30)`) before passing it in.
 *
 * Mutates `s` in place and returns that SAME object. This differs from the
 * fresh-object `step*` functions in this directory (melt.ts, prop-drop.ts,
 * humanoid-verlet.ts, rig.ts) — though not from all of them, since
 * blood-sim.ts's stepBlood mutates too — so don't assume either convention
 * here from the signature alone. Mutation is
 * deliberate: this runs per body per frame, one state per body, and
 * allocating a fresh object every call would be pure waste.
 */
export function stepBurn(s: BurnState, dt: number, rates: BurnRates): BurnState {
  if (!Number.isFinite(dt) || dt <= 0) return s;
  const before = s.burn;
  if (s.dying) {
    // BURN-DOWN (flame-polish task 5). A killed body's fire fades linearly to
    // nothing over corpseBurnSec while its char drives to 1, so a capture sees
    // the flame die down rather than snap off. Both use dt/corpseBurnSec — a
    // rate, not a frame count — so the window is the same at any frame rate.
    // `before` only matters for the burn fade: a body killed at burn < 1 has
    // proportionally less fire to lose, which is the honest reading.
    const corpseSec = Math.max(1e-3, rates.corpseBurnSec);
    s.corpseSec += dt;
    s.burn = clamp01(before - dt / corpseSec);
    s.char = clamp01(s.char + dt / corpseSec);
    s.burnSec = s.burn > 0 ? s.burnSec + dt : 0;
    if (s.corpseSec >= corpseSec) {
      // The window is over: a fully charred, cold corpse. Clear `dying` so
      // nothing keeps stepping the death state (burns() in the lab reads this).
      s.burn = 0;
      s.char = 1;
      s.dying = false;
      s.burnSec = 0;
    }
    return s;
  }
  if (s.alight) {
    s.burn = clamp01(s.burn + dt / Math.max(1e-3, rates.igniteSec));
  } else {
    s.burn = clamp01(s.burn - dt / Math.max(1e-3, rates.extinguishSec));
  }
  if (s.burn > 0) {
    s.burnSec += dt;
    // Trapezoid of burn across the step, not the post-step value alone —
    // otherwise a coarse step during the ignite ramp over-chars relative to
    // many small steps covering the same interval. Exact at any frame rate
    // while no single step overshoots the burn = 1 clamp, which the caller's
    // dt clamp guarantees as long as igniteSec stays above it.
    const charRate = Math.max(0, rates.charRate);
    s.char = clamp01(s.char + dt * charRate * 0.5 * (before + s.burn));
  } else {
    s.burnSec = 0;
  }
  return s;
}

/**
 * Set a body straight to a burn/char pair, for deterministic captures.
 * Clamped, and char still cannot go backwards. Cancels any burn-down: a stage
 * pin is a live burning body, and the `death` capture re-kills it explicitly.
 *
 * Like `stepBurn`, mutates `s` in place and returns that same object.
 */
export function forceBurn(s: BurnState, burn: number, char: number): BurnState {
  const b = clamp01(burn);
  s.burn = b;
  s.alight = b > 0;
  s.dying = false;
  s.corpseSec = 0;
  s.burnSec = 0;
  s.char = Math.max(s.char, clamp01(char));
  return s;
}
