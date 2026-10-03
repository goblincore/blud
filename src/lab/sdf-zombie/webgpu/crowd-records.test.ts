import { describe, it, expect } from 'vitest';
import {
  REC_VEC4S, MAX_CROWD_INSTANCES, REC_COUNTS, REC_COUNTS2, REC_WOUND_BOUND, REC_ANCHOR_BAND,
  REC_WIND_ALIVE, REC_MELT, REC_FLASH, REC_NOISE_YAW, REC_HEAD_WCOUNT, REC_HEAD_QUAT,
  REC_VOL_POSE0, REC_VOL_POSE1, REC_CENTRE_SEED, REC_HALF_REV, REC_GORE, REC_BURN,
  REC_LIGHTS, createCrowdRecords, type RecordSource,
} from './crowd-records';
import { DATA_ROWS } from './march.wgsl';

describe('crowd records', () => {
  it('gives every field a distinct vec4 inside the record', () => {
    const rows = [REC_COUNTS, REC_COUNTS2, REC_WOUND_BOUND, REC_ANCHOR_BAND, REC_WIND_ALIVE, REC_MELT,
      REC_FLASH, REC_NOISE_YAW, REC_HEAD_WCOUNT, REC_HEAD_QUAT, REC_VOL_POSE0, REC_VOL_POSE1,
      REC_CENTRE_SEED, REC_HALF_REV, REC_GORE, REC_BURN, REC_LIGHTS];
    expect(new Set(rows).size).toBe(rows.length);
    expect(Math.max(...rows)).toBeLessThan(REC_VEC4S);
    expect(REC_VEC4S).toBe(17);
    expect(REC_LIGHTS).toBe(16);
    expect(MAX_CROWD_INSTANCES).toBe(64);
  });

  it('writes a slot and stores the band as slot * DATA_ROWS', () => {
    const r = createCrowdRecords(4);
    r.write(2, {
      counts: [56, 6, 3, 0.12], counts2: [10, 0, 0, 1], woundBound: [1, 2, 3, 0.5],
      bodyAnchor: [0.1, 0.2, 0.3], windDrift: [0, 0, 0], meltCfg: [0, 0, 0, 0], bodyFlash: [0, 0, 0, 0],
      noiseShift: [0.5, 0.6, 0.7], bodyYaw: 1.5, headCentre: [0, 1.6, 0], woundCount: 2,
      headQuat: [0, 0, 0, 1], volumePose0: [0, 0, 0, 0], volumePose1: [0, 0, 0, 0],
      bodyCentre: [0, 1, 0], variantSeed: 7, bodyHalf: [0.5, 1, 0.5], damageRevision: 3, gore: 0.75,
      burn: 0.6, burnSec: 2.5, charAmount: 0.25,
    });
    const f = r.floats;
    const base = 2 * REC_VEC4S * 4;
    expect(f[base + REC_COUNTS * 4]).toBe(56);
    expect(f[base + REC_ANCHOR_BAND * 4 + 3]).toBe(2 * DATA_ROWS);
    expect(f[base + REC_WIND_ALIVE * 4 + 3]).toBe(1);
    expect(f[base + REC_HEAD_WCOUNT * 4 + 3]).toBe(2);
    // The rupture gore ramp rides the record so a doomed crowd body can wear
    // the chunk material without repainting the whole shared-material type.
    expect(f[base + REC_GORE * 4]).toBeCloseTo(0.75, 6);
    r.alive(2, false);
    expect(f[base + REC_WIND_ALIVE * 4 + 3]).toBe(0);
    expect(r.dirty).toBe(true);
  });

  it('carries the per-eye glow switch in REC_GORE.yzw as OFF flags (a zero record = both eyes on)', () => {
    const r = createCrowdRecords(2);
    const src = {
      counts: [0, 0, 0, 0], counts2: [0, 0, 0, 0], woundBound: [0, 0, 0, 1e9],
      bodyAnchor: [0, 0, 0], windDrift: [0, 0, 0], meltCfg: [0, 0, 0, 0], bodyFlash: [0, 0, 0, 0],
      noiseShift: [0, 0, 0], bodyYaw: 0, headCentre: [0, 1.6, 0], woundCount: 0,
      headQuat: [0, 0, 0, 1], volumePose0: [0, 0, 0, 0], volumePose1: [0, 0, 0, 0],
      bodyCentre: [0, 1, 0], variantSeed: 0, bodyHalf: [0.5, 1, 0.5], damageRevision: 0, gore: 0.5,
      burn: 0, burnSec: 0, charAmount: 0,
    };
    r.write(1, { ...src, eyeMask: [0, 1, 0.07] });
    const g = 1 * REC_VEC4S * 4 + REC_GORE * 4;
    expect(Array.from(r.floats.subarray(g, g + 4)).map(v => +v.toFixed(6))).toEqual([0.5, 1, 0, 0.07]);
    r.write(0, src);
    expect(Array.from(r.floats.subarray(REC_GORE * 4, REC_GORE * 4 + 4))).toEqual([0.5, 0, 0, 0]);
  });

  it('carries the burn ramp, its clock and the char amount in slot 15', () => {
    // The lab and (spec 2) the game drive burn per BODY, and the crowd shares
    // one material, so a burning body can only wear fire through its record --
    // the same reason REC_GORE exists.
    const r = createCrowdRecords(2);
    r.write(1, {
      counts: [0, 0, 0, 0], counts2: [0, 0, 0, 0], woundBound: [0, 0, 0, 1e9],
      bodyAnchor: [0, 0, 0], windDrift: [0, 0, 0], meltCfg: [0, 0, 0, 0], bodyFlash: [0, 0, 0, 0],
      noiseShift: [0, 0, 0], bodyYaw: 0, headCentre: [0, 0, 0], woundCount: 0,
      headQuat: [0, 0, 0, 1], volumePose0: [0, 0, 0, 0], volumePose1: [0, 0, 0, 0],
      bodyCentre: [0, 0, 0], variantSeed: 0, bodyHalf: [0, 0, 0], damageRevision: 0, gore: 0,
      burn: 0.6, burnSec: 2.5, charAmount: 0.25,
    });
    const base = 1 * REC_VEC4S * 4;
    expect(r.floats[base + REC_BURN * 4]).toBeCloseTo(0.6, 6);
    expect(r.floats[base + REC_BURN * 4 + 1]).toBeCloseTo(2.5, 6);
    expect(r.floats[base + REC_BURN * 4 + 2]).toBeCloseTo(0.25, 6);
    expect(r.floats[base + REC_BURN * 4 + 3]).toBe(0);
  });

  describe('light picks (REC_LIGHTS, slot 16)', () => {
    const minimalSource: RecordSource = {
      counts: [0, 0, 0, 0], counts2: [0, 0, 0, 0], woundBound: [0, 0, 0, 1e9],
      bodyAnchor: [0, 0, 0], windDrift: [0, 0, 0], meltCfg: [0, 0, 0, 0], bodyFlash: [0, 0, 0, 0],
      noiseShift: [0, 0, 0], bodyYaw: 0, headCentre: [0, 0, 0], woundCount: 0,
      headQuat: [0, 0, 0, 1], volumePose0: [0, 0, 0, 0], volumePose1: [0, 0, 0, 0],
      bodyCentre: [0, 0, 0], variantSeed: 0, bodyHalf: [0, 0, 0], damageRevision: 0, gore: 0,
      burn: 0, burnSec: 0, charAmount: 0,
    };
    it('writes the four packed index+weight picks at (slot * 17 + 16) * 4', () => {
      const r = createCrowdRecords(3);
      r.write(2, { ...minimalSource, lights: [0.9, 2.5, -1, -1] });
      const o = (2 * 17 + 16) * 4;
      expect(r.floats[o]).toBeCloseTo(0.9, 6);
      expect(r.floats[o + 1]).toBeCloseTo(2.5, 6);
      expect(r.floats[o + 2]).toBe(-1);
      expect(r.floats[o + 3]).toBe(-1);
    });
    it('writes four empty picks (-1) when the source carries none', () => {
      const r = createCrowdRecords(2);
      r.write(1, minimalSource);
      const o = (1 * 17 + 16) * 4;
      expect(Array.from(r.floats.slice(o, o + 4))).toEqual([-1, -1, -1, -1]);
    });
  });

  // Body grain (body-grain.ts): the palette's grain rides meltCfg.w, which the record copies whole, so a
  // crowd body wears its own value through the shared per-type material.
  it('carries meltCfg.w (the body grain) in REC_MELT.w', () => {
    const r = createCrowdRecords(2);
    r.write(1, {
      counts: [0, 0, 0, 0], counts2: [0, 0, 0, 0], woundBound: [0, 0, 0, 1e9],
      bodyAnchor: [0, 0, 0], windDrift: [0, 0, 0], meltCfg: [0, 0, 0, 0.1], bodyFlash: [0, 0, 0, 0],
      noiseShift: [0, 0, 0], bodyYaw: 0, headCentre: [0, 0, 0], woundCount: 0,
      headQuat: [0, 0, 0, 1], volumePose0: [0, 0, 0, 0], volumePose1: [0, 0, 0, 0],
      bodyCentre: [0, 0, 0], variantSeed: 0, bodyHalf: [0, 0, 0], damageRevision: 0, gore: 0,
      burn: 0, burnSec: 0, charAmount: 0,
    });
    expect(r.floats[1 * REC_VEC4S * 4 + REC_MELT * 4 + 3]).toBeCloseTo(0.1, 6);
  });
});
