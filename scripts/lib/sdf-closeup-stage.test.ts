// scripts/lib/sdf-closeup-stage.test.ts — the GPU-free seams of the close-up
// staging library.
//
// WHAT IS TESTED HERE, AND WHAT CANNOT BE. The staging itself
// (stageCloseUp / stampFacingWounds / bootCloseupPage) needs a live WebGPU
// page — it cannot run in vitest and is proven instead by the byte-identical
// staging-record diff against the pre-extraction script (task 1b report) and
// by every bench run's loud staging assertions. What CAN be tested without a
// GPU is the measurement discipline: the interleave rotation (which makes a
// thermal ramp unable to alias onto one leg) and the load gate (which keeps
// a churning machine out of the summary). Both are decision code — exactly
// the kind of thing whose silent breakage produces a plausible table.
import { describe, expect, it } from 'vitest';
import { interleaveOrder, passesLoadGate } from './sdf-closeup-stage.mjs';

const LEGS = ['normal', 'flat', 'normal0', 'flat0'];

describe('interleaveOrder', () => {
  it('rep 0 runs the legs in table order', () => {
    expect(interleaveOrder(LEGS, 0)).toEqual(LEGS);
  });

  it('rotates the starting leg by rep, wrapping', () => {
    expect(interleaveOrder(LEGS, 1)).toEqual(['flat', 'normal0', 'flat0', 'normal']);
    expect(interleaveOrder(LEGS, 2)).toEqual(['normal0', 'flat0', 'normal', 'flat']);
    expect(interleaveOrder(LEGS, 4)).toEqual(LEGS); // full wrap == rep 0
  });

  it('every rep contains each leg exactly once (no leg doubled or dropped)', () => {
    for (let rep = 0; rep < 7; rep++) {
      const order = interleaveOrder(LEGS, rep);
      expect([...order].sort()).toEqual([...LEGS].sort());
    }
  });
});

describe('passesLoadGate', () => {
  const gate = { maxRise: 8, maxAbs: 24 };
  const row = (load1Start: number, load1: number) => ({ load1Start, load1 });

  it('passes a quiet row', () => {
    expect(passesLoadGate(row(10, 12), gate)).toBe(true);
  });

  it('rejects a row whose load ROSE more than maxRise during the leg', () => {
    expect(passesLoadGate(row(10, 19), gate)).toBe(false); // rise 9 > 8
    expect(passesLoadGate(row(10, 18), gate)).toBe(true); // rise exactly 8 is not > 8
    expect(passesLoadGate(row(10, 18.5), gate)).toBe(false); // rise 8.5
  });

  it('rejects a row whose absolute load exceeds maxAbs, even unrisen', () => {
    expect(passesLoadGate(row(100, 100), gate)).toBe(false); // rise 0, load 100
    expect(passesLoadGate(row(23.5, 24), gate)).toBe(true); // at the cap is not over it
  });

  it('a null gate passes everything (plain mode)', () => {
    expect(passesLoadGate(row(500, 500), null)).toBe(true);
  });
});
