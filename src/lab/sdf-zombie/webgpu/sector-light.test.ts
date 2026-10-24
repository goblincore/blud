// src/lab/sdf-zombie/webgpu/sector-light.test.ts
//
// Spec 2026-10-24 §7: Doom light levels on a hard curve; flicker, pulse and strobe on sim time.

import { describe, expect, it } from 'vitest';
import { DEFAULT_SECTOR_LIGHT, gainParam, sectorAmbient, sectorEffect, writeSectorLevels } from './sector-light';
import type { SectorDef } from './sector-def';

const sector = (light: number, special: SectorDef['special'] = 'none'): SectorDef => ({
  floor: 0, ceil: 4, light, special, hurtPerSec: 0, glow: null,
  materials: { floor: 'default', ceil: 'default', wall: 'default' }, zone: 0,
});

describe('sectorAmbient', () => {
  it('maps full light to the cap and no light to zero', () => {
    expect(sectorAmbient(1, DEFAULT_SECTOR_LIGHT)).toBeCloseTo(DEFAULT_SECTOR_LIGHT.max, 9);
    expect(sectorAmbient(0, DEFAULT_SECTOR_LIGHT)).toBe(0);
  });
  it('is a hard curve: Doom 160 is under half of Doom 255 (γ1.6: about 0.47)', () => {
    const r = sectorAmbient(160 / 255, DEFAULT_SECTOR_LIGHT) / sectorAmbient(1, DEFAULT_SECTOR_LIGHT);
    expect(r).toBeGreaterThan(0.4);
    expect(r).toBeLessThan(0.5);
  });
  it('is monotonic and clamps out-of-range input', () => {
    let prev = -1;
    for (let l = 0; l <= 1.0001; l += 0.05) { const a = sectorAmbient(l, DEFAULT_SECTOR_LIGHT); expect(a).toBeGreaterThanOrEqual(prev); prev = a; }
    expect(sectorAmbient(2, DEFAULT_SECTOR_LIGHT)).toBeCloseTo(DEFAULT_SECTOR_LIGHT.max, 9);
    expect(sectorAmbient(-1, DEFAULT_SECTOR_LIGHT)).toBe(0);
  });
});

describe('sectorEffect', () => {
  const ts = Array.from({ length: 2000 }, (_, i) => i * 0.005);              // 10 s at 5 ms
  it('is 1 for plain sectors and hurt floors', () => {
    expect(ts.every(t => sectorEffect('none', t, 3, false) === 1)).toBe(true);
    expect(ts.every(t => sectorEffect('hurt', t, 3, false) === 1)).toBe(true);
  });
  it('strobe is bright about 14 % of the time and dark the rest', () => {
    const vals = ts.map(t => sectorEffect('strobe', t, 3, false));
    const bright = vals.filter(v => v === 1).length / vals.length;
    expect(bright).toBeGreaterThan(0.1);
    expect(bright).toBeLessThan(0.2);
    expect(Math.min(...vals)).toBeCloseTo(0.35, 9);
  });
  it('reduced flashes turn strobe into a smooth pulse', () => {
    const vals = ts.map(t => sectorEffect('strobe', t, 3, true));
    for (let i = 1; i < vals.length; i++) expect(Math.abs(vals[i]! - vals[i - 1]!)).toBeLessThan(0.02);
  });
  it('pulse swings smoothly between 0.35 and 1', () => {
    const vals = ts.map(t => sectorEffect('pulse', t, 3, false));
    expect(Math.min(...vals)).toBeGreaterThanOrEqual(0.35 - 1e-9);
    expect(Math.max(...vals)).toBeLessThanOrEqual(1 + 1e-9);
    expect(Math.max(...vals) - Math.min(...vals)).toBeGreaterThan(0.5);
  });
  it('flicker drops out sometimes, deterministically per seed', () => {
    const a = ts.map(t => sectorEffect('flicker', t, 7, false));
    expect(a.some(v => v === 0)).toBe(true);
    expect(a.filter(v => v > 0.5).length / a.length).toBeGreaterThan(0.6);
    expect(ts.map(t => sectorEffect('flicker', t, 7, false))).toEqual(a);
    expect(ts.map(t => sectorEffect('flicker', t, 8, false))).not.toEqual(a);
  });
});

describe('writeSectorLevels', () => {
  it('writes ambient × effect per sector, or zeros when off', () => {
    const sectors = [sector(1), sector(0.5), sector(1, 'strobe')];
    const out = new Float32Array(3);
    writeSectorLevels(sectors, 0.5, { ...DEFAULT_SECTOR_LIGHT, on: true }, false, out);
    expect(out[0]).toBeCloseTo(DEFAULT_SECTOR_LIGHT.max, 6);
    expect(out[1]).toBeCloseTo(sectorAmbient(0.5, DEFAULT_SECTOR_LIGHT), 6);
    expect(out[2]).toBeCloseTo(DEFAULT_SECTOR_LIGHT.max * sectorEffect('strobe', 0.5, 2, false), 6);
    writeSectorLevels(sectors, 0.5, { ...DEFAULT_SECTOR_LIGHT, on: false }, false, out);
    expect([...out]).toEqual([0, 0, 0]);
  });
});

describe('gainParam', () => {
  it('absent, empty, junk or negative is the fallback; 0 and positives pass', () => {
    for (const raw of [null, '', '  ', 'abc', '-1', 'Infinity']) expect(gainParam(raw, 6)).toBe(6);
    expect(gainParam('0', 6)).toBe(0);
    expect(gainParam('2.5', 6)).toBe(2.5);
  });
});
