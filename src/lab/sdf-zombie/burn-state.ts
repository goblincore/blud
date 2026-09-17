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

export interface BurnState {
  burn: number;
  burnSec: number;
  char: number;
  alight: boolean;
}

/** The subset of BurnTuning this module needs; BurnTuning is a superset. */
export interface BurnRates {
  igniteSec: number;
  extinguishSec: number;
  charRate: number;
}

export function createBurnState(): BurnState {
  return { burn: 0, burnSec: 0, char: 0, alight: false };
}

export function igniteBurn(s: BurnState): void { s.alight = true; }

export function extinguishBurn(s: BurnState): void { s.alight = false; }

export function stepBurn(s: BurnState, dt: number, t: BurnRates): BurnState {
  if (!Number.isFinite(dt) || dt <= 0) return s;
  const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
  if (s.alight) {
    s.burn = clamp01(s.burn + dt / Math.max(1e-3, t.igniteSec));
  } else {
    s.burn = clamp01(s.burn - dt / Math.max(1e-3, t.extinguishSec));
  }
  if (s.burn > 0) {
    s.burnSec += dt;
    s.char = clamp01(s.char + dt * t.charRate * s.burn);
  } else {
    s.burnSec = 0;
  }
  return s;
}
