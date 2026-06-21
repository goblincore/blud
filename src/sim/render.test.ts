// src/sim/render.test.ts
import { describe, it, expect } from 'vitest';
import { createPlayerState } from './player';
import { renderPlayer, renderProjectiles } from './render';
import { fpFromMeters } from './fp';
import { BANGLE_QUARTER } from './trig';
import { createSimState } from './state';

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
  it('wraps yaw across the 0/2048 boundary without overshoot at alpha=1', () => {
    const prev = createPlayerState(); prev.yaw = 1900;
    const cur = createPlayerState(); cur.yaw = 100;
    const out = renderPlayer(prev, cur, 1);
    expect(out.yawRad).toBeCloseTo((100 / 2048) * Math.PI * 2, 4);
  });
});

describe('renderProjectiles — interpolated billboard positions', () => {
  it('renderProjectiles interpolates positions to meters', () => {
    const prev = createSimState(1); const cur = createSimState(1);
    const base = { vx:0,vy:0,vz:0,radius:1,elastic:24576,resting:false,fuseTics:1,fuseMaxTics:1,impactMode:true,spawnTic:0,spawnX:0,spawnY:0,spawnZ:0 };
    prev.projectiles.push({ ...base, x: 0, y: fpFromMeters(0), z: 0, spawnX:0,spawnY:0,spawnZ:0 });
    cur.projectiles.push({ ...base, x: fpFromMeters(2), y: 0, z: 0, spawnX:0,spawnY:0,spawnZ:0 });
    const out = renderProjectiles(prev.projectiles, cur.projectiles, 0.5);
    expect(out[0]!.xMeters).toBeCloseTo(1, 6);
  });
});
