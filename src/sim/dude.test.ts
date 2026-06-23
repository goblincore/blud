// src/sim/dude.test.ts
import { describe, it, expect } from 'vitest';
import {
  spawnDude, DudeAi, CULTIST,
  turnToward, aiMoveForward, aiMoveDodge, moveDude,
  type DudeState,
} from './dude';
import { fpFromMeters, metersPerSecToFp } from './fp';

describe('dude spawn', () => {
  it('spawns a cultist idle, full health, facing its initial angle', () => {
    const dudes: DudeState[] = [];
    spawnDude(dudes, fpFromMeters(3), 0, fpFromMeters(-2), 512);
    expect(dudes).toHaveLength(1);
    const d = dudes[0]!;
    expect(d.ai).toBe(DudeAi.Idle);
    expect(d.health).toBe(CULTIST.health);
    expect(d.ang).toBe(512);
    expect(d.hasTarget).toBe(false);
  });
});

/** Spawn a single dude on the origin facing yaw 0 and return it. */
function makeDude(): DudeState {
  const dudes: DudeState[] = [];
  spawnDude(dudes, 0, 0, 0, 0);
  return dudes[0]!;
}

describe('turnToward', () => {
  it('rotates toward the goal by at most turnRate per tic', () => {
    const d = makeDude(); d.ang = 0;
    turnToward(d, 512); // 90° away
    expect(d.ang).toBe(CULTIST.turnRate); // moved exactly the cap, not the full 512
  });

  it('converges exactly to the goal over multiple tics', () => {
    const d = makeDude(); d.ang = 0;
    for (let i = 0; i < 100; i++) turnToward(d, 512);
    expect(d.ang).toBe(512);
  });

  it('takes the shortest arc across the 0/2048 wrap', () => {
    const d = makeDude(); d.ang = 2040; // near the wrap
    turnToward(d, 10);                 // +18 forward (through 0), not -2030 backward
    expect(d.ang).toBe(10);
  });

  it('is a no-op when already facing the goal', () => {
    const d = makeDude(); d.ang = 512;
    turnToward(d, 512);
    expect(d.ang).toBe(512);
  });
});

describe('aiMoveForward', () => {
  it('thrusts along facing when roughly facing the goal (yaw 0 → -z)', () => {
    const d = makeDude(); d.ang = 0; d.goalAng = 0;
    aiMoveForward(d);
    expect(d.vx).toBe(0);
    expect(d.vz).toBe(-CULTIST.walkSpeed); // forward at yaw 0 is -z
    moveDude(d);
    expect(d.z).toBeLessThan(0);           // position advanced forward
    expect(d.x).toBe(0);
  });

  it('does not thrust while still turning toward a goal >60° away', () => {
    const d = makeDude(); d.ang = 0; d.goalAng = 512; // 90° off (> 341 gate)
    aiMoveForward(d);
    expect(d.ang).toBe(CULTIST.turnRate); // did turn...
    expect(d.vx).toBe(0);                 // ...but did not thrust
    expect(d.vz).toBe(0);
  });

  it('caps forward speed at walkSpeed (accel → cruise)', () => {
    const d = makeDude(); d.ang = 0; d.goalAng = 0;
    for (let i = 0; i < 10; i++) aiMoveForward(d);
    // forward component magnitude never exceeds walkSpeed
    expect(-d.vz).toBeLessThanOrEqual(CULTIST.walkSpeed);
  });
});

describe('aiMoveDodge', () => {
  it('strafes +right for dodgeDir=+1 (yaw 0 → +x)', () => {
    const d = makeDude(); d.ang = 0; d.goalAng = 0; d.dodgeDir = 1;
    aiMoveDodge(d);
    expect(d.vx).toBe(CULTIST.sideSpeed);
    expect(d.vz).toBe(0);
    moveDude(d);
    expect(d.x).toBeGreaterThan(0);
  });

  it('strafes -right for dodgeDir=-1 (yaw 0 → -x)', () => {
    const d = makeDude(); d.ang = 0; d.goalAng = 0; d.dodgeDir = -1;
    aiMoveDodge(d);
    expect(d.vx).toBe(-CULTIST.sideSpeed);
  });

  it('does nothing when dodgeDir=0', () => {
    const d = makeDude(); d.ang = 0; d.goalAng = 0; d.dodgeDir = 0;
    aiMoveDodge(d);
    expect(d.vx).toBe(0);
    expect(d.vz).toBe(0);
  });
});

describe('moveDude friction', () => {
  it('halts a coasting dude (no thrust) to exactly zero velocity', () => {
    const d = makeDude();
    d.vx = metersPerSecToFp(5);
    d.vz = 0;
    const startX = d.x;
    for (let i = 0; i < 200; i++) moveDude(d);
    expect(d.vx).toBe(0);
    expect(d.vz).toBe(0);
    expect(d.x).toBeGreaterThan(startX); // did coast forward before stopping
  });

  it('clamps the cultist to the floor (ground-only, no gravity)', () => {
    const d = makeDude();
    d.y = fpFromMeters(1);
    moveDude(d);
    expect(d.y).toBe(0);
  });
});
