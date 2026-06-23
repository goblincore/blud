// src/sim/dude.test.ts
import { describe, it, expect } from 'vitest';
import {
  spawnDude, DudeAi, CULTIST,
  turnToward, aiMoveForward, aiMoveDodge, moveDude, stepDudes,
  type DudeState,
} from './dude';
import { fpFromMeters, metersPerSecToFp } from './fp';
import { createRng } from './rng';
import { createPlayerState } from './player';
import { buildArenaGeometry } from './geometry';

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

// ——— Plan 4, Task 4: targeting + chase brain + state-machine driver ———————
// All exercised through the public `stepDudes` driver (which dispatches the
// Idle thinker `aiThinkTarget` / the Chase thinker `thinkChase` and runs the
// state-machine timer). RNG comes from a seeded `SimRng` so every test is
// deterministic.

describe('stepDudes: Idle → Chase (aiThinkTarget acquire)', () => {
  it('acquires the player when in range, LOS clear, and within periphery', () => {
    const dudes: DudeState[] = [];
    spawnDude(dudes, 0, 0, 0, 0);                 // origin, facing yaw 0 (forward = -z)
    const player = createPlayerState();
    player.x = 0; player.z = fpFromMeters(-3);   // straight ahead, 3 m, in periphery
    const geo = buildArenaGeometry();
    const rng = createRng(42);
    let acquired = false;
    // aiThinkTarget gates on Chance(alertChance=0x8000) each Idle tic (ai.cpp:1329),
    // so loop until the deterministic sequence rolls a pass.
    for (let i = 0; i < 200; i++) {
      stepDudes(dudes, player, geo, rng, 0, []);
      if (dudes[0]!.ai === DudeAi.Chase) { acquired = true; break; }
    }
    expect(acquired).toBe(true);
    expect(dudes[0]!.hasTarget).toBe(true);
  });
});

describe('stepDudes: Chase refreshes last-known while the player is visible', () => {
  it('stays in Chase and records the player position (out of fire/throw range)', () => {
    const dudes: DudeState[] = [];
    spawnDude(dudes, 0, 0, 0, 0);
    const d = dudes[0]!;
    d.ai = DudeAi.Chase; d.hasTarget = true;
    const player = createPlayerState();
    player.x = 0; player.z = fpFromMeters(-15);  // 15 m ahead: <seeDist, >fireRange/throwMax
    const geo = buildArenaGeometry();
    stepDudes(dudes, player, geo, createRng(3), 0, []);
    expect(d.ai).toBe(DudeAi.Chase);
    expect(d.targetX).toBe(0);
    expect(d.targetZ).toBe(fpFromMeters(-15));
  });
});

describe('stepDudes: Chase moves toward + faces the player', () => {
  it('turns to face the player and walks toward it', () => {
    const dudes: DudeState[] = [];
    spawnDude(dudes, 0, 0, 0, 0);
    const d = dudes[0]!;
    d.ai = DudeAi.Chase; d.hasTarget = true;
    const player = createPlayerState();
    // ~16 m, off-axis: within seeDist+periphery, outside fireRange(12m)/throwMax(11m).
    player.x = fpFromMeters(3); player.z = fpFromMeters(-15);
    const geo = buildArenaGeometry();
    const rng = createRng(7);
    for (let i = 0; i < 60; i++) stepDudes(dudes, player, geo, rng, 0, []);
    // getangle(3,-15) ≈ 1984 in the sim facing convention → the dude snaps to face it.
    expect(d.ang).toBe(1984);
    // walked toward the player: +x and -z components of the facing vector.
    expect(d.x).toBeGreaterThan(0);
    expect(d.z).toBeLessThan(fpFromMeters(-0.3));
  });
});

describe('stepDudes: Chase → Goto on LOS break (records last-known)', () => {
  it('goes to Goto and keeps the last-known position when LOS is blocked', () => {
    const dudes: DudeState[] = [];
    spawnDude(dudes, 0, 0, 0, 0);
    const d = dudes[0]!;
    d.ai = DudeAi.Chase; d.hasTarget = true;
    d.targetX = 0; d.targetZ = fpFromMeters(-2);   // last seen here
    const player = createPlayerState();
    player.x = 0; player.z = fpFromMeters(-6);     // now behind a wall
    // custom wall between dude (0,0) and player (0,-6): blocks the eye→target ray.
    const geo = [{
      minX: fpFromMeters(-0.5), maxX: fpFromMeters(0.5),
      minZ: fpFromMeters(-4), maxZ: fpFromMeters(-2),
    }];
    stepDudes(dudes, player, geo, createRng(1), 0, []);
    expect(d.ai).toBe(DudeAi.Goto);
    expect(d.hasTarget).toBe(false);
    expect(d.targetX).toBe(0);
    expect(d.targetZ).toBe(fpFromMeters(-2));      // unchanged = last known
  });
});
