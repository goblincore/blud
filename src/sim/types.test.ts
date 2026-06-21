// src/sim/types.test.ts
import { describe, it, expect } from 'vitest';
import { EMPTY_INPUT, BTN_FIRE, BTN_SWITCH, type InputCommand, type KinematicBody } from './types';

describe('sim core types', () => {
  it('EMPTY_INPUT is all-zero / neutral', () => {
    expect(EMPTY_INPUT).toEqual({ moveForward: 0, moveStrafe: 0, aimAngle: 0, buttons: 0 });
  });

  it('button bits are distinct powers of two', () => {
    expect(BTN_FIRE).toBe(1);
    expect(BTN_SWITCH).toBe(2);
    expect(BTN_FIRE & BTN_SWITCH).toBe(0);
  });

  it('a KinematicBody is plain integer data', () => {
    const b: KinematicBody = { x: 10, y: 0, z: -5, vx: 1, vy: 0, vz: 2 };
    expect(b.x + b.vx).toBe(11);
  });

  it('an InputCommand carries movement, aim, and buttons', () => {
    const cmd: InputCommand = { moveForward: 1, moveStrafe: -1, aimAngle: 512, buttons: BTN_FIRE };
    expect(cmd.aimAngle).toBe(512);
    expect((cmd.buttons & BTN_FIRE) !== 0).toBe(true);
  });
});
