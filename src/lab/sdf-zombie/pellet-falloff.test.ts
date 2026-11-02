// src/lab/sdf-zombie/pellet-falloff.test.ts
import { afterEach, describe, expect, it } from 'vitest';
import {
  PELLET_FALLOFF, PELLET_FALLOFF_DEFAULTS, pelletFalloff, pelletFalloffAt, pelletFalloffFromParams, pelletFalloffWound,
  resetPelletFalloff, setPelletFalloff,
} from './pellet-falloff';
import type { Wound } from './damage';

const D = PELLET_FALLOFF_DEFAULTS;
const wound = (): Wound => ({ primIdx: 0, local: [0, 0, 0], radius: 0.1, type: 'pellet', ageSec: 0, carveDepth: 0.08, severRadius: 0.1 });

afterEach(() => { resetPelletFalloff(); });

describe('pelletFalloff curve', () => {
  it('is full damage out to fullM, then falls monotonically by smoothstep to minFactor at farM, flat after', () => {
    expect(D).toMatchObject({ fullM: 5, farM: 18, minFactor: 0.3 });
    for (const d of [0, 1, 3, 4.99, 5]) expect(pelletFalloff(d, D)).toBe(1);
    expect(pelletFalloff(18, D)).toBeCloseTo(0.3, 12);
    expect(pelletFalloff(25, D)).toBeCloseTo(0.3, 12);
    expect(pelletFalloff(1000, D)).toBeCloseTo(0.3, 12);
    expect(pelletFalloff(11.5, D)).toBeCloseTo(0.65, 12);   // the midpoint of a smoothstep is half way
    let prev = 1;
    for (let d = 5; d <= 18; d += 0.25) { const f = pelletFalloff(d, D); expect(f).toBeLessThanOrEqual(prev + 1e-12); prev = f; }
    // Smooth at both ends: the first and last 0.1 m barely move.
    expect(1 - pelletFalloff(5.1, D)).toBeLessThan(0.001);
    expect(pelletFalloff(17.9, D) - 0.3).toBeLessThan(0.001);
  });

  it('off, or a zero-width band, behave', () => {
    expect(pelletFalloff(30, { ...D, on: false })).toBe(1);
    expect(pelletFalloff(6, { ...D, fullM: 5, farM: 5 })).toBe(0.3);
    expect(pelletFalloff(NaN, D)).toBe(1);
  });

  it('measures from the shot origin; a shot with no origin is full damage', () => {
    expect(pelletFalloffAt(undefined, [100, 0, 0], D)).toBe(1);
    expect(pelletFalloffAt([0, 1.5, 0], [0, 1.5, 3], D)).toBe(1);
    expect(pelletFalloffAt([0, 1.5, 0], [0, 1.5, -25], D)).toBeCloseTo(0.3, 12);
    expect(pelletFalloffAt([1, 0, 0], [1, 0, 11.5], D)).toBeCloseTo(0.65, 12);
  });
});

describe('pelletFalloffWound', () => {
  it('leaves a full-damage wound exactly as it was', () => {
    const w = pelletFalloffWound(wound(), 1, D);
    expect(w).toEqual(wound());
    expect(w.meterScale).toBeUndefined();
  });
  it('scales meter, crater and carve; severs weaker, and never below severMin', () => {
    const mid = pelletFalloffWound(wound(), 0.8, D);
    expect(mid.meterScale).toBe(0.8);
    expect(mid.radius).toBeCloseTo(0.1 * (0.7 + 0.3 * 0.8), 12);
    expect(mid.carveDepth).toBeCloseTo(0.08 * (0.7 + 0.3 * 0.8), 12);
    expect(mid.severRadius).toBeCloseTo(0.08, 12);
    const far = pelletFalloffWound(wound(), 0.3, D);
    expect(far.meterScale).toBe(0.3);
    expect(far.radius).toBeCloseTo(0.1 * 0.79, 12);
    expect(far.severRadius).toBe(0);
  });
});

describe('tuning', () => {
  it('setPelletFalloff merges, clamps and keeps farM >= fullM', () => {
    const t = setPelletFalloff({ fullM: 8, minFactor: 2 });
    expect(t).toMatchObject({ fullM: 8, farM: 18, minFactor: 1 });
    expect(setPelletFalloff({ farM: 3 }).farM).toBe(8);
    expect(setPelletFalloff({ fullM: NaN } as never).fullM).toBe(8);
    expect(PELLET_FALLOFF.fullM).toBe(8);
    expect(resetPelletFalloff()).toEqual(D);
  });
  it('reads URL params', () => {
    expect(pelletFalloffFromParams(new URLSearchParams(''))).toEqual({});
    expect(pelletFalloffFromParams(new URLSearchParams('pelletFalloff=0'))).toEqual({ on: false });
    expect(pelletFalloffFromParams(new URLSearchParams('pelletFull=4&pelletFar=20&pelletMin=0.5&pelletFalloff=1')))
      .toEqual({ on: true, fullM: 4, farM: 20, minFactor: 0.5 });
    expect(pelletFalloffFromParams(new URLSearchParams('pelletFull=abc'))).toEqual({});
  });
});
