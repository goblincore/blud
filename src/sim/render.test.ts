// src/sim/render.test.ts
import { describe, it, expect } from 'vitest';
import { createPlayerState } from './player';
import { renderPlayer } from './render';
import { fpFromMeters } from './fp';
import { BANGLE_QUARTER } from './trig';

describe('renderPlayer — interpolated camera transform (render boundary)', () => {
  it('lerps position between prev and cur by alpha, in meters', () => {
    const prev = createPlayerState();
    const cur = createPlayerState();
    cur.x = fpFromMeters(2); // moved 2 m in X
    const out = renderPlayer(prev, cur, 0.5);
    expect(out.xMeters).toBeCloseTo(1, 6); // halfway
  });
  it('eye is feet + EYE_HEIGHT', () => {
    const p = createPlayerState(); // feet y = 0
    const out = renderPlayer(p, p, 1);
    expect(out.eyeYMeters).toBeCloseTo(1.75, 6);
  });
  it('converts Blood-angle yaw to radians', () => {
    const prev = createPlayerState();
    const cur = createPlayerState();
    cur.yaw = BANGLE_QUARTER; // 90°
    const out = renderPlayer(cur, cur, 1);
    expect(out.yawRad).toBeCloseTo(Math.PI / 2, 4);
  });
});
