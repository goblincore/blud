// src/sim/trig.ts
import { FP_PER_BU } from './fp';

/** Blood angle units: a full turn is 2048. */
export const BANGLE_FULL = 2048;
export const BANGLE_QUARTER = 512;

/**
 * cos/sin tables in 16.16 fixed-point (65536 = 1.0), indexed by Blood angle.
 * Built once at load by rounding Math.cos/sin to integers — the rounding makes
 * the table identical across peers in practice (this is what Blood does). If a
 * future cross-platform desync ever traces here, bake the table via codegen.
 */
const COS: Int32Array = (() => {
  const t = new Int32Array(BANGLE_FULL);
  for (let i = 0; i < BANGLE_FULL; i++) {
    t[i] = Math.round(Math.cos((i / BANGLE_FULL) * Math.PI * 2) * FP_PER_BU);
  }
  return t;
})();

function wrap(a: number): number {
  return ((a % BANGLE_FULL) + BANGLE_FULL) % BANGLE_FULL;
}

/** cos(angle) in 16.16. */
export function bcos(angle: number): number { return COS[wrap(angle)]!; }
/** sin(angle) in 16.16 — sin(a) = cos(a - 90°) = cos(a - 512). */
export function bsin(angle: number): number { return COS[wrap(angle - BANGLE_QUARTER)]!; }
