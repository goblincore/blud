// src/sim/units.ts
/**
 * Integer Build-unit space for the deterministic sim. The sim runs entirely in
 * these units (no floats in state); conversions to meters/seconds/radians happen
 * ONLY at the render boundary (see the render-side interpolation in plan 2).
 */

export const BU_PER_METER = 256;      // 256 Build units = 1 meter
export const TICS_PER_SEC = 120;      // fixed sim rate
export const BLOOD_ANGLE_UNITS = 2048; // a full turn in Blood angle units

/**
 * Fixed-point multiply-then-scale, mirroring Blood's `mulscale(a, b, n)`.
 * Returns floor(a*b / 2^n). Use Math.floor (NOT `>>`, which is 32-bit) — our
 * magnitudes are < 2^53 so the multiply is exact; floor matches arithmetic
 * shift rounding (toward -inf) for negatives.
 */
export function mulscale(a: number, b: number, shift: number): number {
  return Math.floor((a * b) / 2 ** shift);
}

/** Blood's `dmulscale(a, b, c, d, n)` = floor((a*b + c*d) / 2^n). */
export function dmulscale(a: number, b: number, c: number, d: number, shift: number): number {
  return Math.floor((a * b + c * d) / 2 ** shift);
}

// ——— Render-boundary conversions (NEVER used inside sim logic) ———
export function buToMeters(bu: number): number { return bu / BU_PER_METER; }
export function metersToBu(m: number): number { return Math.round(m * BU_PER_METER); }
export function ticsToSeconds(tics: number): number { return tics / TICS_PER_SEC; }
export function bloodAngleToRadians(a: number): number {
  return (a / BLOOD_ANGLE_UNITS) * Math.PI * 2;
}
