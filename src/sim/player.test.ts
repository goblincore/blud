// src/sim/player.test.ts
import { describe, it, expect } from 'vitest';
import { createSimState } from './state';
import { stepSim } from './step';
import { buildArenaGeometry } from './geometry';
import { fpToMeters, metersPerSecToFp } from './fp';
import { EMPTY_INPUT, BTN_JUMP, type InputCommand } from './types';
import { BANGLE_QUARTER } from './trig';

const geo = buildArenaGeometry();

function cmd(over: Partial<InputCommand>): InputCommand { return { ...EMPTY_INPUT, ...over }; }

describe('stepPlayer (via stepSim)', () => {
  it('starts at spawn, grounded, not moving', () => {
    const s = createSimState(1);
    expect(s.player.vy).toBe(0);
    expect(s.player.grounded).toBe(true);
  });

  it('moves forward along -Z at WALK speed when yaw=0', () => {
    const s = createSimState(1);
    stepSim(s, cmd({ moveForward: 1, aimYaw: 0 }), geo);
    // yaw 0, forward → local -Z; after one tic, z decreases by ~WALK/tic.
    expect(s.player.z).toBeLessThan(0);
    expect(Math.abs(s.player.x)).toBeLessThan(10); // no X drift
    const perTic = fpToMeters(metersPerSecToFp(6));
    expect(fpToMeters(s.player.z)).toBeCloseTo(-perTic, 4);
  });

  it('yaw rotates the movement direction (yaw=quarter → forward turns to -X or +X)', () => {
    const s = createSimState(1);
    stepSim(s, cmd({ moveForward: 1, aimYaw: BANGLE_QUARTER }), geo);
    expect(Math.abs(s.player.x)).toBeGreaterThan(0); // now moving along X
  });

  it('sprint uses RUN speed', () => {
    const walk = createSimState(1); stepSim(walk, cmd({ moveForward: 1 }), geo);
    const run = createSimState(1); stepSim(run, cmd({ moveForward: 1, buttons: 1 << 3 /*BTN_SPRINT*/ }), geo);
    expect(Math.abs(run.player.z)).toBeGreaterThan(Math.abs(walk.player.z));
  });

  it('gravity pulls down and the floor clamps feet to y=0', () => {
    const s = createSimState(1);
    s.player.y = metersPerSecToFp(0) + 16_777_216 * 3; // start 3 m up (fp meters)
    s.player.grounded = false;
    for (let i = 0; i < 240; i++) stepSim(s, EMPTY_INPUT, geo); // 2 s of fall
    expect(s.player.y).toBe(0);          // clamped to floor
    expect(s.player.vy).toBe(0);
    expect(s.player.grounded).toBe(true);
  });

  it('jump launches up then returns to the floor', () => {
    const s = createSimState(1);
    stepSim(s, cmd({ buttons: BTN_JUMP }), geo); // press jump (edge)
    expect(s.player.vy).toBeGreaterThan(0);
    expect(s.player.grounded).toBe(false);
    for (let i = 0; i < 240; i++) stepSim(s, EMPTY_INPUT, geo);
    expect(s.player.grounded).toBe(true);  // landed
    expect(s.player.y).toBe(0);
  });

  it('cannot move through a perimeter wall (clamped inside the arena)', () => {
    const s = createSimState(1);
    for (let i = 0; i < 600; i++) stepSim(s, cmd({ moveForward: 1, aimYaw: 0 }), geo); // run at -Z wall
    // wall inner face ≈ -20 + wallThick/2; player radius 0.3 keeps it short of it.
    expect(fpToMeters(s.player.z)).toBeGreaterThan(-20);
  });
});
