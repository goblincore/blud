// src/sim/fp.ts
import { BU_PER_METER, TICS_PER_SEC } from './units';

/** 16.16 fixed-point over Build units: value_fp = BU * 65536. Sim position and
 *  velocity use this so sub-BU-per-tic speeds stay exact integers. Converted to
 *  meters only at the render boundary. Magnitudes stay < 2^31 (arena ≤ ~10240
 *  BU → ~6.7e8 fp), so 32-bit-safe; products use Math.floor div, never `>>`. */
export const FP_PER_BU = 65536;
export const FP_PER_METER = BU_PER_METER * FP_PER_BU; // 16,777,216

export function fpFromBU(bu: number): number { return Math.round(bu * FP_PER_BU); }
export function fpToBU(fp: number): number { return Math.floor(fp / FP_PER_BU); }
export function fpFromMeters(m: number): number { return Math.round(m * FP_PER_METER); }
export function fpToMeters(fp: number): number { return fp / FP_PER_METER; }

/** Convert a real-world m/s speed into fp-per-tic (the sim's velocity unit). */
export function metersPerSecToFp(mps: number): number {
  return Math.round((mps * FP_PER_METER) / TICS_PER_SEC);
}

/** 16.16 multiply: floor(a*b / 2^16). Use for fp×fp (e.g. velocity × cos). */
export function mulfp(a: number, b: number): number {
  return Math.floor((a * b) / FP_PER_BU);
}

/** Blood's integer octagonal distance approximation (common_game.h `approxDist`):
 *  the larger axis plus 3/8 of the smaller. Deterministic (no float sqrt) — used
 *  for in-sim velocity magnitudes (e.g. floor friction). */
export function approxDist(dx: number, dy: number): number {
  dx = Math.abs(dx);
  dy = Math.abs(dy);
  return dx > dy ? dx + Math.floor((3 * dy) / 8) : dy + Math.floor((3 * dx) / 8);
}
