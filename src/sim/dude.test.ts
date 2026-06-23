// src/sim/dude.test.ts
import { describe, it, expect } from 'vitest';
import {
  spawnDude, DudeAi, CULTIST,
  turnToward, aiMoveForward, aiMoveDodge, moveDude, stepDudes, recoilDude,
  type DudeState,
} from './dude';
import { fpFromMeters, fpFromBU, metersPerSecToFp } from './fp';
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

// ——— Plan 4, Task 5: shotgun fire — deterministic hitscan + player damage —————
// All exercised through the public `stepDudes` driver, which dispatches the SFire
// thinker `thinkSFire` → `fireShotgun`. A dude placed in SFire at the fire tic
// (stateTics = DUDE_STATES[SFire].tics - SHOTGUN.sfireFireTic) fires on the next
// step. RNG comes from a seeded `SimRng`, so the spread (and thus the damage) is
// identical for identical seeds.

import { SHOTGUN } from './dude';

/** The SFire stateTics value at which the blast goes off (one step before firing).
 *  Mirrors thinkSFire: fireAt = SFire.tics - sfireFireTic. */
function sfireFireAt(): number {
  // DUDE_STATES[SFire].tics (60) - SHOTGUN.sfireFireTic (18) = 42.
  return 60 - SHOTGUN.sfireFireTic;
}

/** Spawn a dude already in SFire at the fire tic, facing yaw 0 (forward = -z). */
function makeSFireDudeAtFireTic(): DudeState {
  const dudes: DudeState[] = [];
  spawnDude(dudes, 0, 0, 0, 0);
  const d = dudes[0]!;
  d.ai = DudeAi.SFire;
  d.stateTics = sfireFireAt();
  d.fired = false;
  return d;
}

describe('stepDudes: SFire shotgun hits a player straight ahead', () => {
  it('reduces player.hp on a clear shot (≥1 pellet connects)', () => {
    const dudes: DudeState[] = [makeSFireDudeAtFireTic()];
    const player = createPlayerState();
    player.x = 0; player.z = fpFromMeters(-5);    // 5 m dead ahead, on axis
    const geo = buildArenaGeometry();
    const out: import('./types').SimEvent[] = [];
    const hpBefore = player.hp;
    stepDudes(dudes, player, geo, createRng(99), 0, out);
    expect(player.hp).toBeLessThan(hpBefore);     // damaged
    expect(dudes[0]!.fired).toBe(true);           // fired this visit
    // a cultistFire event was emitted for the cosmetic layer
    expect(out.filter((e) => e.kind === 'cultistFire')).toHaveLength(1);
  });

  it('is deterministic: same seed → identical player.hp', () => {
    const run = (seed: number): number => {
      const dudes: DudeState[] = [makeSFireDudeAtFireTic()];
      const player = createPlayerState();
      player.x = 0; player.z = fpFromMeters(-5);
      stepDudes(dudes, player, buildArenaGeometry(), createRng(seed), 0, []);
      return player.hp;
    };
    expect(run(99)).toBe(run(99));
    expect(run(7)).toBe(run(7));
    // different seeds may differ (spread) — just assert they're each self-stable
  });

  it('fires exactly once per SFire visit (no double damage on later tics)', () => {
    const dudes: DudeState[] = [makeSFireDudeAtFireTic()];
    const d = dudes[0]!;
    const player = createPlayerState();
    player.x = 0; player.z = fpFromMeters(-5);
    const geo = buildArenaGeometry();
    stepDudes(dudes, player, geo, createRng(99), 0, []);
    expect(d.fired).toBe(true);
    const hpAfterFire = player.hp;
    // a few more SFire tics: the one-shot guard prevents a second blast
    for (let i = 0; i < 5; i++) stepDudes(dudes, player, geo, createRng(99), 0, []);
    expect(player.hp).toBe(hpAfterFire);
    expect(d.fired).toBe(true);
  });
});

describe('stepDudes: SFire blocked by a wall → no damage', () => {
  it('deals no damage when a wall stands between the cultist and player', () => {
    const dudes: DudeState[] = [makeSFireDudeAtFireTic()];
    const player = createPlayerState();
    player.x = 0; player.z = fpFromMeters(-5);
    // wide wall (2 m) on-axis between dude (0,0) and player (0,-5): blocks the
    // whole cone, so no pellet reaches the player.
    const geo: import('./geometry').SimAABB[] = [
      ...buildArenaGeometry(),
      { minX: fpFromMeters(-1), maxX: fpFromMeters(1),
        minZ: fpFromMeters(-3), maxZ: fpFromMeters(-2) },
    ];
    const hpBefore = player.hp;
    stepDudes(dudes, player, geo, createRng(99), 0, []);
    expect(player.hp).toBe(hpBefore);            // fully blocked
    expect(dudes[0]!.fired).toBe(true);          // did fire (just missed)
  });
});

// ——— Plan 4, Task 6: tactical states (dodge/goto/search/throw/recoil) ————————
// All exercised through the public `stepDudes` driver. State durations come from
// DUDE_STATES (Dodge 90, Goto 600, Search 1800, SThrow 30, Recoil 0). The
// dodgeDir is chosen from the seeded `SimRng` (one Chance(0x8000) draw per
// aiChooseDirection, ai.cpp:307) so it is deterministic for a given seed.

import { DUDE_STATES } from './dude';

/** Make a dude already in a given AI state with the table's duration loaded. */
function makeDudeIn(ai: DudeAi): DudeState {
  const d = makeDude();
  d.ai = ai;
  d.stateTics = DUDE_STATES[ai].tics;
  return d;
}

describe('stepDudes: SThrow windup → SFire', () => {
  it('counts down the 30-tic windup then transitions to SFire', () => {
    const dudes: DudeState[] = [makeDudeIn(DudeAi.SThrow)];
    const player = createPlayerState();
    const geo = buildArenaGeometry();
    // SThrow has no thinker/mover: just a timed windup. Step the full duration.
    for (let i = 0; i < DUDE_STATES[DudeAi.SThrow].tics; i++) {
      stepDudes(dudes, player, geo, createRng(1), 0, []);
    }
    expect(dudes[0]!.ai).toBe(DudeAi.SFire);
    expect(dudes[0]!.stateTics).toBe(DUDE_STATES[DudeAi.SFire].tics);
  });
});

describe('stepDudes: Dodge lasts 90 tics then → Chase', () => {
  it('strafes for the full 90-tic Dodge duration then returns to Chase', () => {
    const d = makeDudeIn(DudeAi.Dodge);
    d.ang = 0; d.goalAng = 0; d.dodgeDir = 1; // strafe +right (yaw 0 → +x)
    const dudes: DudeState[] = [d];
    const player = createPlayerState();
    const startX = d.x;
    const rng = createRng(5);
    for (let i = 0; i < DUDE_STATES[DudeAi.Dodge].tics; i++) {
      stepDudes(dudes, player, buildArenaGeometry(), rng, 0, []);
    }
    expect(dudes[0]!.ai).toBe(DudeAi.Chase);
    // dodged sideways (+x for dodgeDir=+1 at yaw 0) during the 90 tics
    expect(dudes[0]!.x).toBeGreaterThan(startX);
  });
});

describe('stepDudes: recoilDude → Recoil → Dodge (dodgeDir deterministic)', () => {
  it('recoilDude enters Recoil, then the next step transitions to Dodge', () => {
    const d = makeDudeIn(DudeAi.Chase);
    const dudes: DudeState[] = [d];
    const player = createPlayerState();
    const geo = buildArenaGeometry();
    recoilDude(d);
    expect(d.ai).toBe(DudeAi.Recoil);
    expect(d.stateTics).toBe(DUDE_STATES[DudeAi.Recoil].tics); // 0 (transient)
    // one step: the 0-tic transient Recoil transitions to Dodge, rolling dodgeDir
    stepDudes(dudes, player, geo, createRng(42), 0, []);
    expect(d.ai).toBe(DudeAi.Dodge);
    expect(d.stateTics).toBe(DUDE_STATES[DudeAi.Dodge].tics); // 90
  });

  it('recoilDude is ignored for a dead dude (no reaction post-mortem)', () => {
    const d = makeDudeIn(DudeAi.Chase);
    d.health = 0;
    recoilDude(d);
    expect(d.ai).toBe(DudeAi.Chase); // unchanged
  });

  it('dodgeDir is deterministic from the seed (same seed → same sign)', () => {
    const run = (seed: number): number => {
      const d = makeDudeIn(DudeAi.Chase);
      const dudes: DudeState[] = [d];
      recoilDude(d);
      stepDudes(dudes, createPlayerState(), buildArenaGeometry(), createRng(seed), 0, []);
      return d.dodgeDir; // ±1, set on entering Dodge
    };
    expect(Math.abs(run(42))).toBe(1);            // never 0 in Dodge
    expect(run(42)).toBe(run(42));                 // same seed → same dir
    expect(run(7)).toBe(run(7));
    // at least one seed pair disagrees (sanity that it's a real roll, not a
    // constant) — try several seeds until we see both signs.
    const signs = new Set<number>();
    for (let s = 1; s <= 32; s++) signs.add(run(s) > 0 ? 1 : -1);
    expect(signs.size).toBe(2);
  });

  it('a recoiling dude eventually returns to Chase via Dodge (Recoil→Dodge→Chase)', () => {
    const d = makeDudeIn(DudeAi.Chase);
    const dudes: DudeState[] = [d];
    const player = createPlayerState();
    const geo = buildArenaGeometry();
    recoilDude(d);
    // 1 (Recoil→Dodge) + 90 (Dodge→Chase) steps
    for (let i = 0; i < 1 + DUDE_STATES[DudeAi.Dodge].tics; i++) {
      stepDudes(dudes, player, geo, createRng(42), 0, []);
    }
    expect(d.ai).toBe(DudeAi.Chase);
  });
});

describe('stepDudes: Goto walks toward last-known then → Idle on expiry', () => {
  it('moves toward targetX/targetZ during Goto', () => {
    const d = makeDudeIn(DudeAi.Goto);
    d.ang = 0;                       // facing -z (forward)
    d.targetX = 0; d.targetZ = fpFromMeters(-50); // far last-known straight ahead
    const dudes: DudeState[] = [d];
    const player = createPlayerState();
    player.x = fpFromMeters(200); player.z = fpFromMeters(200); // far: not reacquired
    const startZ = d.z;
    const rng = createRng(2);
    for (let i = 0; i < 30; i++) stepDudes(dudes, player, buildArenaGeometry(), rng, 0, []);
    expect(d.ai).toBe(DudeAi.Goto);              // still going
    expect(d.z).toBeLessThan(startZ);            // walked toward -z last-known
  });

  it('expires to Idle after the 600-tic Goto duration', () => {
    const d = makeDudeIn(DudeAi.Goto);
    d.ang = 0;
    d.targetX = 0; d.targetZ = fpFromMeters(-50);
    const dudes: DudeState[] = [d];
    const player = createPlayerState();
    player.x = fpFromMeters(200); player.z = fpFromMeters(200);
    const rng = createRng(2);
    for (let i = 0; i < DUDE_STATES[DudeAi.Goto].tics; i++) {
      stepDudes(dudes, player, buildArenaGeometry(), rng, 0, []);
    }
    expect(d.ai).toBe(DudeAi.Idle);
  });

  it('reacquires the player on LOS → Chase (drops the Goto walk)', () => {
    const d = makeDudeIn(DudeAi.Goto);
    d.ang = 0;
    d.targetX = fpFromMeters(50); d.targetZ = fpFromMeters(-50); // irrelevant once seen
    const dudes: DudeState[] = [d];
    const player = createPlayerState();
    // player straight ahead, close, clear LOS: lookForTarget should acquire.
    player.x = 0; player.z = fpFromMeters(-4);
    const rng = createRng(11);
    let acquired = false;
    for (let i = 0; i < 200; i++) {
      stepDudes(dudes, player, buildArenaGeometry(), rng, 0, []);
      if (d.ai === DudeAi.Chase) { acquired = true; break; }
    }
    expect(acquired).toBe(true);
    expect(d.hasTarget).toBe(true);
  });
});

describe('stepDudes: Search → Idle after 1800 (sees target → Chase)', () => {
  it('expires to Idle after the 1800-tic Search duration', () => {
    const d = makeDudeIn(DudeAi.Search);
    d.ang = 0; d.goalAng = 0;
    const dudes: DudeState[] = [d];
    const player = createPlayerState();
    player.x = fpFromMeters(200); player.z = fpFromMeters(200); // far: not seen
    const rng = createRng(3);
    for (let i = 0; i < DUDE_STATES[DudeAi.Search].tics; i++) {
      stepDudes(dudes, player, buildArenaGeometry(), rng, 0, []);
    }
    expect(d.ai).toBe(DudeAi.Idle);
  });

  it('spots the player and returns to Chase', () => {
    const d = makeDudeIn(DudeAi.Search);
    d.ang = 0; d.goalAng = 0;
    const dudes: DudeState[] = [d];
    const player = createPlayerState();
    player.x = 0; player.z = fpFromMeters(-4); // straight ahead, clear LOS
    const rng = createRng(11);
    let acquired = false;
    for (let i = 0; i < 200; i++) {
      stepDudes(dudes, player, buildArenaGeometry(), rng, 0, []);
      if (d.ai === DudeAi.Chase) { acquired = true; break; }
    }
    expect(acquired).toBe(true);
  });
});
