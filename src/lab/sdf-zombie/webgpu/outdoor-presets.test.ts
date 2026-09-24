// src/lab/sdf-zombie/webgpu/outdoor-presets.test.ts
import { describe, expect, it } from 'vitest';
import {
  EDGE_PRESETS, EDGE_STYLES, GROUND_NAMES, GROUND_PRESETS, SKYLINE_NAMES, SKYLINE_PRESETS,
  SKY_NAMES, SKY_PRESETS, skylineLayerColor,
} from './outdoor-presets';

const unit = (v: readonly number[]) => Math.hypot(...v);

describe('outdoor presets', () => {
  it('name lists match the tables exactly', () => {
    expect([...SKY_NAMES].sort()).toEqual(Object.keys(SKY_PRESETS).sort());
    expect([...GROUND_NAMES].sort()).toEqual(Object.keys(GROUND_PRESETS).sort());
    expect([...EDGE_STYLES].sort()).toEqual(Object.keys(EDGE_PRESETS).sort());
    expect([...SKYLINE_NAMES].sort()).toEqual(Object.keys(SKYLINE_PRESETS).sort());
  });

  it('the v1 names are the spec §4.1 names', () => {
    expect(SKY_NAMES).toEqual(['night']);
    expect(GROUND_NAMES).toEqual(['stone', 'flagstone', 'gravel', 'dirt', 'grass']);
    expect(EDGE_STYLES).toEqual(['wall', 'fence', 'hedge']);
    expect(SKYLINE_NAMES).toEqual(['treeline', 'rooftops', 'hills']);
  });

  it('every sky: unit moon direction above the horizon, fog colour = horizon colour', () => {
    for (const s of Object.values(SKY_PRESETS)) {
      expect(unit(s.moon.dir)).toBeCloseTo(1, 6);
      expect(s.moon.dir[1]).toBeGreaterThan(0.2);
      expect(s.fog.color).toEqual(s.horizon);
      expect(s.fog.far).toBeGreaterThan(s.fog.near);
    }
  });

  it('skyline layers recede: farther layers are taller and closer to the horizon colour', () => {
    for (const k of SKYLINE_NAMES) {
      const L = SKYLINE_PRESETS[k].layers;
      expect(L.length).toBeGreaterThanOrEqual(2);
      for (let i = 1; i < L.length; i++) expect(L[i]!.distance).toBeGreaterThan(L[i - 1]!.distance);
    }
    const sky = SKY_PRESETS.night;
    const near = skylineLayerColor(sky, 0, 3), far = skylineLayerColor(sky, 2, 3);
    const d = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
    expect(d(far, sky.horizon)).toBeLessThan(d(near, sky.horizon));
  });
});
