# Soldier Shoot-Back AI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the soldier a ranged state machine — hold a standoff band, telegraph, fire the shorty, reposition, back-pedal when rushed — and spawn him in the SDF game as its second kind of enemy.

**Architecture:** A new pure `soldier-brain.ts` sits beside `brain.ts`, which is not touched. `game-actor.ts` grows an `EnemyMind` seam that defaults to `zombieMind`, so the zombie path is a no-op by construction; `brain.test.ts` and `sdf-game-crowd-gate.mjs` passing unchanged is the evidence. `game-main.ts` learns that enemies come in kinds: per-character blob, face sheet, motion profile, kit overlay and held prop.

**Tech Stack:** TypeScript, Vitest, Three.js (WebGPU renderer). No new dependencies.

**Spec:** [2026-09-06-soldier-shootback-ai-design.md](../specs/2026-09-06-soldier-shootback-ai-design.md)

---

## Orientation — read before Task 1

You are working in a game engine written as many small, pure, heavily-commented modules with one wiring layer (`webgpu/game-main.ts`) that is deliberately large. Conventions that matter:

- **Pure brain modules take no clock, no RNG and no THREE.** Randomness arrives as a plain `0..1` number in the input struct. This is so every transition is testable against hand-worked geometry. Do not import `Math.random` into `soldier-brain.ts`.
- **Heading convention** (`wander.ts`): yaw 0 faces `+z`, positive is clockwise seen from above, and the bearing from point A to point B is `Math.atan2(bx - ax, bz - az)`. Note the argument order — `(x, z)`, not the usual `(y, x)`.
- **Comments explain *why*, especially why a value is what it is.** Look at `brain.ts`'s `meleeRadius` comment for the house style: it records the bug that forced the number. Match that density.
- **Tests are `*.test.ts` beside the module.** Run the whole suite with `npm test`; a single file with `npx vitest run <path>`.
- `Vec3` is `[number, number, number]` from `./types`.

Read `src/lab/sdf-zombie/brain.ts` in full before Task 1. `soldier-brain.ts` is its sibling and should read like it.

---

## File Structure

| File | Status | Responsibility |
| --- | --- | --- |
| `src/lab/sdf-zombie/soldier-brain.ts` | **create** | The ranged state machine. Pure. |
| `src/lab/sdf-zombie/soldier-brain.test.ts` | **create** | Its unit tests. |
| `src/lab/sdf-zombie/webgpu/enemy-mind.ts` | **create** | The `EnemyMind` interface + `zombieMind` / `soldierMind`. |
| `src/lab/sdf-zombie/webgpu/enemy-mind.test.ts` | **create** | Adapter tests. |
| `src/lab/sdf-zombie/webgpu/game-actor.ts` | modify | Accept a `mind` and a `profile`; write `faceHeading`. |
| `src/lab/sdf-zombie/webgpu/game-main.ts` | modify | Per-kind spawn, face sheet, kit, prop, soldier pellets. |
| `src/lab/sdf-zombie/brain.ts` | **untouched** | Hard gate. |

---

## Task 1: The band — perception, advance, retreat, standoff

Builds `soldier-brain.ts` up to the point where he holds a distance. No firing yet.

**Files:**
- Create: `src/lab/sdf-zombie/soldier-brain.ts`
- Create: `src/lab/sdf-zombie/soldier-brain.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lab/sdf-zombie/soldier-brain.test.ts`:

```ts
// src/lab/sdf-zombie/soldier-brain.test.ts
import { describe, it, expect } from 'vitest';
import {
  SOLDIER_TUNING, makeSoldierBrain, stepSoldierBrain,
  type SoldierBrain, type SoldierInput,
} from './soldier-brain';

const DT = 1 / 60;

function input(over: Partial<SoldierInput> = {}): SoldierInput {
  return {
    dt: DT,
    self: { x: 0, z: 0, yaw: 0, room: 3 },   // facing +z
    player: { x: 0, z: 5, room: 3 },          // straight ahead, in the band
    alerted: false,
    roll: 1,        // 1 = never fire (refireRoll is 0.5)
    rollDrift: 0,
    ...over,
  };
}

/** Runs the brain for `seconds` of DT steps; returns the last output. */
function run(brain: SoldierBrain, over: Partial<SoldierInput>, seconds: number) {
  let b = brain;
  let out = stepSoldierBrain(b, input(over));
  b = out.brain;
  for (let t = DT; t < seconds; t += DT) {
    out = stepSoldierBrain(b, input(over));
    b = out.brain;
  }
  return out;
}

/** An already-alert brain, from one step with the player in front. */
function alerted(): SoldierBrain {
  return stepSoldierBrain(makeSoldierBrain(), input()).brain;
}

describe('stepSoldierBrain — perception', () => {
  it('notices a player in front, same room, in range', () => {
    const out = stepSoldierBrain(makeSoldierBrain(), input());
    expect(out.brain.alert).toBe(true);
  });

  it('does not notice a player behind it', () => {
    const out = stepSoldierBrain(makeSoldierBrain(), input({
      player: { x: 0, z: -5, room: 3 },
    }));
    expect(out.brain.alert).toBe(false);
    expect(out.brain.state).toBe('idle');
    expect(out.target).toBeNull();
  });

  it('does not notice a player in another room', () => {
    const out = stepSoldierBrain(makeSoldierBrain(), input({
      player: { x: 0, z: 5, room: 9 },
    }));
    expect(out.brain.alert).toBe(false);
  });

  it('a gunshot in the room bypasses the notice cone', () => {
    const out = stepSoldierBrain(makeSoldierBrain(), input({
      player: { x: 0, z: -5, room: 3 },
      alerted: true,
    }));
    expect(out.brain.alert).toBe(true);
  });

  it('forgets the player after loseGrace out of the room', () => {
    const out = run(alerted(), { player: { x: 0, z: 5, room: 9 } },
      SOLDIER_TUNING.loseGrace + 0.5);
    expect(out.brain.alert).toBe(false);
    expect(out.brain.state).toBe('idle');
  });
});

describe('stepSoldierBrain — the band', () => {
  it('advances when farther than standoffFar', () => {
    const out = stepSoldierBrain(alerted(), input({
      player: { x: 0, z: 8, room: 3 },
    }));
    expect(out.brain.state).toBe('advance');
    expect(out.target).toEqual([0, 0, 8]);   // the player himself
    expect(out.halt).toBe(false);
  });

  it('retreats when closer than standoffNear', () => {
    const out = stepSoldierBrain(alerted(), input({
      player: { x: 0, z: 2, room: 3 },
    }));
    expect(out.brain.state).toBe('retreat');
    expect(out.halt).toBe(false);
    // Away from the player: he is at z=2, self at 0, so the retreat point is
    // standoffFar BEHIND self on the player->self bearing (z negative).
    expect(out.target![2]).toBeLessThan(0);
  });

  it('holds standoff inside the band', () => {
    const out = stepSoldierBrain(alerted(), input({
      player: { x: 0, z: 5, room: 3 },
    }));
    expect(out.brain.state).toBe('standoff');
    expect(out.halt).toBe(false);
  });

  it('hysteresis runs INWARD: advancing continues past standoffFar', () => {
    // Start him advancing from 8 m...
    let b = stepSoldierBrain(alerted(), input({ player: { x: 0, z: 8, room: 3 } })).brain;
    expect(b.state).toBe('advance');
    // ...then place him just inside standoffFar. He must NOT stop yet.
    const inside = SOLDIER_TUNING.standoffFar - SOLDIER_TUNING.bandHysteresis / 2;
    const out = stepSoldierBrain(b, input({ player: { x: 0, z: inside, room: 3 } }));
    expect(out.brain.state).toBe('advance');
    // Only well inside does he settle.
    const settled = SOLDIER_TUNING.standoffFar - SOLDIER_TUNING.bandHysteresis - 0.1;
    b = stepSoldierBrain(out.brain, input({ player: { x: 0, z: settled, room: 3 } })).brain;
    expect(b.state).toBe('standoff');
  });

  it('hysteresis runs INWARD on the near edge too', () => {
    let b = stepSoldierBrain(alerted(), input({ player: { x: 0, z: 2, room: 3 } })).brain;
    expect(b.state).toBe('retreat');
    const inside = SOLDIER_TUNING.standoffNear + SOLDIER_TUNING.bandHysteresis / 2;
    const out = stepSoldierBrain(b, input({ player: { x: 0, z: inside, room: 3 } }));
    expect(out.brain.state).toBe('retreat');
    const settled = SOLDIER_TUNING.standoffNear + SOLDIER_TUNING.bandHysteresis + 0.1;
    b = stepSoldierBrain(out.brain, input({ player: { x: 0, z: settled, room: 3 } })).brain;
    expect(b.state).toBe('standoff');
  });

  it('never emits fire or a face lock while only holding the band', () => {
    const out = run(alerted(), {}, 3);
    expect(out.fire).toBe(false);
    expect(out.faceHeading).toBeNull();
    expect(out.aimT).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npx vitest run src/lab/sdf-zombie/soldier-brain.test.ts`

Expected: FAIL — `Failed to resolve import "./soldier-brain"`.

- [ ] **Step 3: Write the implementation**

Create `src/lab/sdf-zombie/soldier-brain.ts`:

```ts
// src/lab/sdf-zombie/soldier-brain.ts
//
// One soldier's decision layer, as a named state machine. Pure — no clock, no
// RNG, no THREE — so every transition is unit-testable against hand-worked
// geometry. The sibling of brain.ts, which is the ZOMBIE's.
//
// WHY IT IS A SEPARATE FILE. The zombie's whole geometry is "collapse the
// distance": pursue, encircle, engage, swing. A rifleman's is the opposite —
// hold a distance, and back off when it closes. No state in that machine
// wants what this one wants. brain.ts is also pinned (brain.test.ts plus
// scripts/sdf-game-crowd-gate.mjs) and its own header records that it was
// rewritten specifically to escape mode-branching; adding a ranged mode
// walks that back. The cost is ~30 duplicated lines of perception and
// stagger preamble, which is the price of learning what is ACTUALLY common
// from two real brains rather than guessing from one. Extract a shared
// perception.ts when a third enemy arrives, from evidence.
//
// IT DOES NOT DRIVE LOCOMOTION. Same rule as brain.ts: there is exactly one
// walker (wander.ts, through motion.ts). The machine emits a TARGET, a HALT
// flag and a FACE HEADING; the actor writes them into the wander.
//
// HEADING CONVENTION (wander.ts): yaw 0 faces +z, positive is clockwise seen
// from above. The bearing to a point is atan2(dx, dz).
//
// ROOM-BOUND, DELIBERATELY, exactly as brain.ts is. stepWander clamps every
// body to its own room's bounds — which is also why CORNERING IS EMERGENT:
// a soldier backed into a wall simply stops retreating and keeps firing from
// where he stands. No bounds query in here, and no cornered state.
import type { Vec3 } from './types';
import { wrapPi } from './wander';

export type SoldierState =
  | 'idle' | 'advance' | 'retreat' | 'standoff'
  | 'aim' | 'fire' | 'recover' | 'stagger';

export interface SoldierBrain {
  state: SoldierState;
  /** Has noticed the player and not yet forgotten him. */
  alert: boolean;
  /** Seconds the player has been out of this brain's room (0 while in it). */
  lostFor: number;
  /** Seconds elapsed in the current aim or recover phase. */
  phaseT: number;
  /** Seconds until another firing opportunity may be rolled. */
  cooldown: number;
  /** Seconds of blast hold remaining. */
  holdSecs: number;
  /** Tangential strafe sign, re-rolled on each decision tick. */
  drift: -1 | 1;
  /** Seconds until the next decision tick. */
  driftT: number;
}

export interface SoldierSelf { x: number; z: number; yaw: number; room: number }
export interface SoldierPlayer { x: number; z: number; room: number }

export interface SoldierInput {
  dt: number;
  self: SoldierSelf;
  /** null when the player is somewhere with no room id (a tunnel, the void). */
  player: SoldierPlayer | null;
  /** A shot was fired in this brain's room since the last step. */
  alerted: boolean;
  /** A fresh 0..1 value each frame. Consumed ONLY on a decision tick, to roll
   *  whether to take a firing opportunity. It lives in the input rather than
   *  as an injected generator so this module stays a pure function of its
   *  arguments — the same reason wander.ts takes an Rng. */
  roll: number;
  /** A SECOND, independent 0..1 value, for the strafe sign. It must not be
   *  the same number as `roll`: one value serving both decisions correlates
   *  them, so "fires" and "strafes left" would become the same event. */
  rollDrift: number;
}

export interface SoldierOutput {
  brain: SoldierBrain;
  /** Wander-target override (world ground point); null = leave it alone. */
  target: Vec3 | null;
  /** True = locomotion off this frame (the actor's cfg.wander gate). */
  halt: boolean;
  /** True on EXACTLY the frame the shot goes off. */
  fire: boolean;
  /** Bearing to hold while halted, written into wander.heading by the actor;
   *  null = leave the heading alone. A halted body cannot otherwise turn:
   *  stepWander owns wander.heading and is skipped when cfg.wander is false,
   *  so without this he would aim at wherever he last happened to face. */
  faceHeading: number | null;
  /** 0..1 telegraph progress while aiming, else 0. Drives no geometry in this
   *  phase — it is the debug HUD's read and the seam a visible tell hangs off
   *  in phase 3. In the output rather than reconstructed by a consumer from a
   *  timer it does not own. */
  aimT: number;
}

export const SOLDIER_TUNING = {
  /** Beyond this the player goes unnoticed (m). The zombie's value; the band
   *  sits well inside it, so he notices before he has to decide anything. */
  noticeRange: 9,
  /** Half-angle of the notice cone (rad). The zombie's value. */
  noticeCone: (70 * Math.PI) / 180,
  /** Alert survives this long after the player leaves the room (s). */
  loseGrace: 4,
  /** Closer than this, back off (m). */
  standoffNear: 3.5,
  /** Farther than this, close in (m). */
  standoffFar: 6.0,
  /** Band hysteresis (m). THE EXIT THRESHOLD SITS INSIDE THE BAND: he starts
   *  advancing at dist > standoffFar but does not stop until
   *  dist <= standoffFar - this. An exit threshold OUTSIDE the band would
   *  make advance and retreat overlap and oscillate, which is the opposite
   *  of the intent. At these values he settles in roughly 4.1–5.4 m. */
  bandHysteresis: 0.6,
  /** The telegraph (s). Doom's shotgun guy has a distinct pre-fire frame and
   *  it is the only reason a sergeant is dodgeable; this is that frame. If
   *  the playtest says the soldier is unreadable, this is the first knob. */
  aimSec: 0.5,
  /** Recoil hold after the shot (s). Sits under FIRE.holdSec (0.85) so the
   *  carry is still in the fire pose when he resumes. */
  recoverSec: 0.4,
  /** Floor between shots (s). */
  minCooldownSec: 1.0,
  /** Chance to take an ELIGIBLE firing opportunity, rolled on a decision
   *  tick. Doom monsters roll for the attack rather than running a timer; a
   *  fixed cooldown metronomes, and metronoming is the fastest way to make an
   *  enemy read as a machine. */
  refireRoll: 0.5,
  /** The decision tick (s) — see the comment on the tick itself. */
  repositionSec: 1.5,
  /** Tangential offset applied to the strafe target (rad). */
  strafeStep: 0.5,
  /** Blast hold, matching the zombie's, so a shot soldier lurches for as long
   *  as a shot zombie does (s). */
  blastHoldSec: 0.55,
} as const;

export type SoldierTuning = typeof SOLDIER_TUNING;

export function makeSoldierBrain(): SoldierBrain {
  return {
    state: 'idle', alert: false, lostFor: 0,
    phaseT: 0, cooldown: 0, holdSecs: 0,
    drift: 1, driftT: SOLDIER_TUNING.repositionSec,
  };
}

/** A point `radius` from the player, on `bearing`. */
function ringPoint(player: SoldierPlayer, bearing: number, radius: number): Vec3 {
  return [player.x + Math.sin(bearing) * radius, 0, player.z + Math.cos(bearing) * radius];
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function stepSoldierBrain(
  brain: SoldierBrain,
  input: SoldierInput,
  tuning: SoldierTuning = SOLDIER_TUNING,
): SoldierOutput {
  const dt = Math.max(0, input.dt);
  const { self, player } = input;

  let { state, alert, lostFor, phaseT, cooldown, holdSecs, drift, driftT } = brain;
  cooldown = Math.max(0, cooldown - dt);
  holdSecs = Math.max(0, holdSecs - dt);

  const sameRoom = player !== null && player.room === self.room;
  lostFor = sameRoom ? 0 : lostFor + dt;

  const dx = player ? player.x - self.x : 0;
  const dz = player ? player.z - self.z : 0;
  const dist = player ? Math.hypot(dx, dz) : Infinity;

  // --- notice, then lock (brain.ts's rule verbatim) ------------------------
  if (!alert && sameRoom) {
    if (input.alerted) {
      alert = true;                              // a gunshot bypasses the cone
    } else if (dist <= tuning.noticeRange) {
      const bearing = Math.atan2(dx, dz);
      if (Math.abs(wrapPi(bearing - self.yaw)) <= tuning.noticeCone) alert = true;
    }
  }
  if (alert && lostFor > tuning.loseGrace) alert = false;

  const pack = (over: Partial<SoldierOutput> = {}): SoldierOutput => ({
    brain: { state, alert, lostFor, phaseT, cooldown, holdSecs, drift, driftT },
    target: null, halt: false, fire: false, faceHeading: null, aimT: 0,
    ...over,
  });

  const idle = (): SoldierOutput => {
    state = 'idle'; phaseT = 0;
    return pack();
  };

  // --- stagger outranks everything ----------------------------------------
  // Entered by staggerSoldierNow() AT THE MOMENT OF THE HIT, not by a flag
  // consumed on the next step: a body lurches on the frame it is shot. See
  // brain.ts's staggerNow for what a one-step deferral actually cost.
  if (state === 'stagger') {
    if (holdSecs > 0) return pack({ halt: true });
    state = alert && player ? 'advance' : 'idle';
    phaseT = 0;
  }

  if (!alert || !player) return idle();

  /** Where he must LOOK: from himself toward the player. */
  const faceBearing = Math.atan2(dx, dz);
  /** Where he STANDS relative to the player: from the player toward himself.
   *  The retreat and strafe points are placed on this bearing, so he backs
   *  straight away from the player and strafes around him. */
  const standBearing = Math.atan2(self.x - player.x, self.z - player.z);
  const playerPoint: Vec3 = [player.x, 0, player.z];

  // --- the committed firing cycle -----------------------------------------
  // Once aim starts the cycle runs to the end even if the player leaves the
  // band. This is the direct analogue of brain.ts's "a committed swing runs
  // to the end", and it is what makes the telegraph readable: without it,
  // strafing at the band edge makes him flicker in and out of aiming and
  // never commit. All three states halt and hold the face lock.
  if (state === 'aim') {
    phaseT += dt;
    if (phaseT < tuning.aimSec) {
      return pack({
        halt: true, faceHeading: faceBearing,
        aimT: tuning.aimSec > 0 ? phaseT / tuning.aimSec : 1,
      });
    }
    // The telegraph is done: THIS frame is the shot.
    state = 'fire'; phaseT = 0;
    return pack({ halt: true, faceHeading: faceBearing, fire: true, aimT: 1 });
  }

  if (state === 'fire') {
    // 'fire' occupies exactly one frame, and its fire pulse was emitted on
    // the frame it was entered (above). Falling straight through to recover
    // here is what guarantees ONE pulse per cycle.
    state = 'recover'; phaseT = 0;
    cooldown = tuning.minCooldownSec;
  }

  if (state === 'recover') {
    phaseT += dt;
    if (phaseT < tuning.recoverSec) {
      return pack({ halt: true, faceHeading: faceBearing });
    }
    state = 'standoff'; phaseT = 0;
  }

  // --- the band, hysteresis running INWARD --------------------------------
  // See bandHysteresis's comment for why the exit threshold is inside.
  if (state === 'advance') {
    if (dist <= tuning.standoffFar - tuning.bandHysteresis) state = 'standoff';
  } else if (state === 'retreat') {
    if (dist >= tuning.standoffNear + tuning.bandHysteresis) state = 'standoff';
  } else if (dist > tuning.standoffFar) {
    state = 'advance';
  } else if (dist < tuning.standoffNear) {
    state = 'retreat';
  } else if (state === 'idle') {
    state = 'standoff';
  }

  if (state === 'advance') {
    // The PLAYER, not a standoff point: stepWander's arrive band on a target
    // at the band edge would park him outside it. brain.ts's pursue makes the
    // same choice for the same reason (its predecessor's defect, found by the
    // crowd gate).
    return pack({ target: playerPoint });
  }

  if (state === 'retreat') {
    return pack({ target: ringPoint(player, standBearing, tuning.standoffFar) });
  }

  // --- standoff: the decision tick ----------------------------------------
  // ROLLING EVERY FRAME WOULD DEFEAT THE POINT. At 60 Hz a refireRoll of 0.5
  // fires on the first eligible frame every single time, which is a fixed
  // cooldown wearing a costume. Doom rolls when a monster FINISHES A MOVE,
  // not every tic, and that cadence is the whole source of the irregular
  // rhythm. So both rolls are consumed here and nowhere else.
  driftT -= dt;
  if (driftT <= 0) {
    driftT = tuning.repositionSec;
    drift = input.rollDrift < 0.5 ? -1 : 1;
    if (cooldown <= 0 && input.roll < tuning.refireRoll) {
      state = 'aim'; phaseT = 0;
      return pack({ halt: true, faceHeading: faceBearing, aimT: 0 });
    }
  }

  return pack({
    target: ringPoint(
      player,
      standBearing + drift * tuning.strafeStep,
      clamp(dist, tuning.standoffNear, tuning.standoffFar),
    ),
  });
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npx vitest run src/lab/sdf-zombie/soldier-brain.test.ts`

Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/soldier-brain.ts src/lab/sdf-zombie/soldier-brain.test.ts
git commit -m "soldier-brain: perception and the standoff band

Sibling of brain.ts, same pure contract. Perception is the zombie's rule
verbatim; the band is this brain's own geometry, with the hysteresis running
INWARD so advance and retreat cannot overlap and oscillate.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2: The firing cycle

The implementation from Task 1 already contains the cycle. This task **tests** it, which is where its real defects live — the one-pulse property, the commitment property, and the decision tick.

**Files:**
- Modify: `src/lab/sdf-zombie/soldier-brain.test.ts` (append)

- [ ] **Step 1: Write the failing tests**

Append to `src/lab/sdf-zombie/soldier-brain.test.ts`:

```ts
describe('stepSoldierBrain — the firing cycle', () => {
  /** Steps until `pred` holds or `seconds` elapse. Returns {out, fires}. */
  function until(
    brain: SoldierBrain,
    over: Partial<SoldierInput>,
    seconds: number,
    pred: (o: ReturnType<typeof stepSoldierBrain>) => boolean = () => false,
  ) {
    let b = brain;
    let fires = 0;
    let out = stepSoldierBrain(b, input(over));
    b = out.brain;
    if (out.fire) fires++;
    for (let t = DT; t < seconds && !pred(out); t += DT) {
      out = stepSoldierBrain(b, input(over));
      b = out.brain;
      if (out.fire) fires++;
    }
    return { out, fires, brain: b };
  }

  it('does NOT fire on frame one even when the roll always says fire', () => {
    // The decision-tick regression: rolling every frame would fire instantly.
    const out = stepSoldierBrain(alerted(), input({ roll: 0 }));
    expect(out.brain.state).toBe('standoff');
    expect(out.fire).toBe(false);
  });

  it('enters aim on the first decision tick when the roll says fire', () => {
    const r = until(alerted(), { roll: 0 }, SOLDIER_TUNING.repositionSec + 0.1,
      o => o.brain.state === 'aim');
    expect(r.out.brain.state).toBe('aim');
    expect(r.out.halt).toBe(true);
  });

  it('never enters aim when the roll always refuses', () => {
    const r = until(alerted(), { roll: 1 }, 6);
    expect(r.fires).toBe(0);
    expect(r.out.brain.state).toBe('standoff');
  });

  it('emits exactly ONE fire pulse per cycle', () => {
    // Long enough for one aim+fire+recover, short enough that the next
    // decision tick cannot start a second cycle (cooldown is 1.0 s).
    const span = SOLDIER_TUNING.repositionSec + SOLDIER_TUNING.aimSec
      + SOLDIER_TUNING.recoverSec + 0.2;
    const r = until(alerted(), { roll: 0 }, span);
    expect(r.fires).toBe(1);
  });

  it('holds the face lock and halts through aim, fire and recover', () => {
    const r = until(alerted(), { roll: 0 }, SOLDIER_TUNING.repositionSec + 0.1,
      o => o.brain.state === 'aim');
    // Player is straight ahead at +z, so the face bearing is 0.
    expect(r.out.faceHeading).toBeCloseTo(0, 6);
    expect(r.out.halt).toBe(true);
    expect(r.out.target).toBeNull();
  });

  it('aimT ramps 0..1 across the telegraph', () => {
    const enter = until(alerted(), { roll: 0 }, SOLDIER_TUNING.repositionSec + 0.1,
      o => o.brain.state === 'aim');
    expect(enter.out.aimT).toBe(0);
    const mid = until(enter.brain, { roll: 0 }, SOLDIER_TUNING.aimSec / 2);
    expect(mid.out.aimT).toBeGreaterThan(0.3);
    expect(mid.out.aimT).toBeLessThan(0.7);
  });

  it('COMMITMENT: a started cycle completes even if the player leaves the band', () => {
    const enter = until(alerted(), { roll: 0 }, SOLDIER_TUNING.repositionSec + 0.1,
      o => o.brain.state === 'aim');
    expect(enter.out.brain.state).toBe('aim');
    // Player teleports far outside the band, mid-telegraph.
    const far = { player: { x: 0, z: 30, room: 3 }, roll: 1 };
    const r = until(enter.brain, far, SOLDIER_TUNING.aimSec + 0.1);
    expect(r.fires).toBe(1);            // he still takes the shot
  });

  it('respects minCooldownSec between shots', () => {
    // Two full decision ticks with roll=0: the cooldown must suppress the
    // second opportunity if it lands too soon.
    const span = SOLDIER_TUNING.repositionSec * 2 + SOLDIER_TUNING.aimSec
      + SOLDIER_TUNING.recoverSec + 0.1;
    const r = until(alerted(), { roll: 0 }, span);
    expect(r.fires).toBeLessThanOrEqual(1);
  });

  it('re-rolls the strafe sign on the decision tick', () => {
    const left = until(alerted(), { roll: 1, rollDrift: 0 },
      SOLDIER_TUNING.repositionSec + 0.1, o => o.brain.driftT >= SOLDIER_TUNING.repositionSec);
    expect(left.out.brain.drift).toBe(-1);
    const right = until(alerted(), { roll: 1, rollDrift: 1 },
      SOLDIER_TUNING.repositionSec + 0.1, o => o.brain.driftT >= SOLDIER_TUNING.repositionSec);
    expect(right.out.brain.drift).toBe(1);
  });

  it('strafes tangentially, staying inside the band', () => {
    const out = stepSoldierBrain(alerted(), input({ roll: 1 }));
    expect(out.brain.state).toBe('standoff');
    const t = out.target!;
    const d = Math.hypot(t[0] - 0, t[2] - 5);
    expect(d).toBeGreaterThanOrEqual(SOLDIER_TUNING.standoffNear - 1e-6);
    expect(d).toBeLessThanOrEqual(SOLDIER_TUNING.standoffFar + 1e-6);
    expect(Math.abs(t[0])).toBeGreaterThan(0);     // actually moved off-axis
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `npx vitest run src/lab/sdf-zombie/soldier-brain.test.ts`

Expected: PASS, 22 tests total. If the one-pulse or commitment test fails, the bug is in `stepSoldierBrain`'s cycle — fix the implementation, not the test.

- [ ] **Step 3: Commit**

```bash
git add src/lab/sdf-zombie/soldier-brain.test.ts
git commit -m "soldier-brain: pin the firing cycle

The three properties that matter: exactly one fire pulse per cycle, a started
cycle completes even if the player leaves the band, and the roll is consumed
only on a decision tick (rolling every frame is a fixed cooldown in disguise).

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: `staggerSoldierNow`

**Files:**
- Modify: `src/lab/sdf-zombie/soldier-brain.ts`
- Modify: `src/lab/sdf-zombie/soldier-brain.test.ts` (append)

- [ ] **Step 1: Write the failing tests**

Append to `src/lab/sdf-zombie/soldier-brain.test.ts`, and add `staggerSoldierNow` to the import at the top of the file:

```ts
describe('staggerSoldierNow', () => {
  it('forces stagger and halts, synchronously', () => {
    const b = staggerSoldierNow(alerted());
    expect(b.state).toBe('stagger');
    expect(b.holdSecs).toBeCloseTo(SOLDIER_TUNING.blastHoldSec, 6);
    const out = stepSoldierBrain(b, input());
    expect(out.halt).toBe(true);
    expect(out.target).toBeNull();
  });

  it('cancels an in-flight aim and leaves NO stuck fire pulse', () => {
    let b = alerted();
    // Advance to aim.
    for (let t = 0; t < SOLDIER_TUNING.repositionSec + 0.1; t += DT) {
      const o = stepSoldierBrain(b, input({ roll: 0 }));
      b = o.brain;
      if (b.state === 'aim') break;
    }
    expect(b.state).toBe('aim');
    b = staggerSoldierNow(b);
    expect(b.state).toBe('stagger');
    expect(b.phaseT).toBe(0);
    // Run out the hold: not one fire pulse anywhere.
    let fires = 0;
    for (let t = 0; t < SOLDIER_TUNING.blastHoldSec + 0.2; t += DT) {
      const o = stepSoldierBrain(b, input({ roll: 1 }));
      b = o.brain;
      if (o.fire) fires++;
    }
    expect(fires).toBe(0);
  });

  it('resumes at advance once the hold expires, if still alert', () => {
    let b = staggerSoldierNow(alerted());
    for (let t = 0; t < SOLDIER_TUNING.blastHoldSec + 0.1; t += DT) {
      b = stepSoldierBrain(b, input({ roll: 1 })).brain;
    }
    expect(b.state).not.toBe('stagger');
  });
});
```

- [ ] **Step 2: Run and verify it fails**

Run: `npx vitest run src/lab/sdf-zombie/soldier-brain.test.ts`

Expected: FAIL — `staggerSoldierNow is not exported`.

- [ ] **Step 3: Implement**

Add to `src/lab/sdf-zombie/soldier-brain.ts`, immediately after `makeSoldierBrain`:

```ts
/**
 * Force the stagger state NOW — called by the wiring the instant a
 * blast-profile hit lands, before any step.
 *
 * IT IS SYNCHRONOUS ON PURPOSE, for the reason brain.ts's staggerNow records:
 * a flag consumed by the NEXT step delays the lurch by one frame, and while
 * sixteen milliseconds is imperceptible on its own, it shifts the whole
 * recovery downstream far enough to change what a displacement measurement a
 * second later reports. A body lurches on the frame it is shot.
 *
 * Cancels any in-flight aim: a staggering soldier must not complete a
 * telegraph he was knocked out of, and must leave no stranded fire pulse
 * behind (the cycle emits its pulse on the aim->fire transition, so clearing
 * phaseT and the state together is what guarantees it).
 *
 * A SEPARATE FUNCTION from brain.ts's staggerNow because that one is typed to
 * Brain. This is part of the duplication the file header accounts for.
 */
export function staggerSoldierNow(
  brain: SoldierBrain,
  tuning: SoldierTuning = SOLDIER_TUNING,
): SoldierBrain {
  return { ...brain, state: 'stagger', phaseT: 0, holdSecs: tuning.blastHoldSec };
}
```

- [ ] **Step 4: Run and verify it passes**

Run: `npx vitest run src/lab/sdf-zombie/soldier-brain.test.ts`

Expected: PASS, 25 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/soldier-brain.ts src/lab/sdf-zombie/soldier-brain.test.ts
git commit -m "soldier-brain: staggerSoldierNow

Synchronous for the same reason brain.ts's staggerNow is, and it cancels an
in-flight aim so a knocked soldier cannot complete a telegraph or strand a
fire pulse.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: The `EnemyMind` seam

The hard gate task. After this, `brain.test.ts` and the crowd gate must pass **unchanged**.

**Files:**
- Create: `src/lab/sdf-zombie/webgpu/enemy-mind.ts`
- Create: `src/lab/sdf-zombie/webgpu/enemy-mind.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lab/sdf-zombie/webgpu/enemy-mind.test.ts`:

```ts
// src/lab/sdf-zombie/webgpu/enemy-mind.test.ts
import { describe, it, expect } from 'vitest';
import { makeZombieMind, makeSoldierMind, type MindInput } from './enemy-mind';

const DT = 1 / 60;

function mindInput(over: Partial<MindInput> = {}): MindInput {
  return {
    dt: DT,
    self: { x: 0, z: 0, yaw: 0, room: 3 },
    player: { x: 0, z: 5, room: 3 },
    alerted: false,
    hasToken: false,
    drift: 0,
    roll: 1,
    rollDrift: 0,
    ...over,
  };
}

describe('makeZombieMind', () => {
  it('wraps stepBrain and reports the zombie vocabulary in debug', () => {
    const m = makeZombieMind();
    const out = m.step(mindInput());
    expect(out.attack).toBeNull();
    expect(out.fire).toBe(false);
    expect(out.faceHeading).toBeNull();
    expect(m.debug().state).toBe('pursue');
    expect(m.debug().side).toBe('R');
  });

  it('exposes engaged and committed, which the melee ring needs', () => {
    const m = makeZombieMind();
    const out = m.step(mindInput());
    expect(typeof out.engaged).toBe('boolean');
    expect(typeof out.committed).toBe('boolean');
  });

  it('staggers synchronously', () => {
    const m = makeZombieMind();
    m.step(mindInput());
    m.stagger();
    expect(m.debug().state).toBe('stagger');
    expect(m.step(mindInput()).halt).toBe(true);
  });
});

describe('makeSoldierMind', () => {
  it('never emits an attack, and is never engaged or committed', () => {
    const m = makeSoldierMind();
    const out = m.step(mindInput());
    expect(out.attack).toBeNull();
    expect(out.engaged).toBe(false);
    expect(out.committed).toBe(false);
  });

  it('holds the band and reports the soldier vocabulary in debug', () => {
    const m = makeSoldierMind();
    m.step(mindInput());
    expect(m.debug().state).toBe('standoff');
    expect(m.debug().aimT).toBe(0);
  });

  it('surfaces faceHeading while aiming', () => {
    const m = makeSoldierMind();
    let out = m.step(mindInput({ roll: 0 }));
    for (let t = 0; t < 2 && m.debug().state !== 'aim'; t += DT) {
      out = m.step(mindInput({ roll: 0 }));
    }
    expect(m.debug().state).toBe('aim');
    expect(out.faceHeading).toBeCloseTo(0, 6);
    expect(out.halt).toBe(true);
  });

  it('staggers synchronously', () => {
    const m = makeSoldierMind();
    m.step(mindInput());
    m.stagger();
    expect(m.debug().state).toBe('stagger');
    expect(m.step(mindInput()).halt).toBe(true);
  });
});
```

- [ ] **Step 2: Run and verify it fails**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/enemy-mind.test.ts`

Expected: FAIL — `Failed to resolve import "./enemy-mind"`.

- [ ] **Step 3: Implement**

Create `src/lab/sdf-zombie/webgpu/enemy-mind.ts`:

```ts
// src/lab/sdf-zombie/webgpu/enemy-mind.ts
//
// ONE interface over the two decision layers, so game-actor.ts can drive
// either without knowing which. The actor owns ~800 lines of body, view,
// hit/sever/wound, crowd nudge, furniture routing and hit batching that are
// identical for every enemy; only the thinking differs.
//
// THE ZOMBIE PATH MUST BE A NO-OP. createEnemyActor defaults to
// makeZombieMind(), so brain.test.ts and scripts/sdf-game-crowd-gate.mjs
// passing UNCHANGED is the evidence that this seam changed nothing for the
// zombie. A diff in either is a failure of this design, not a test to update.
//
// This wrapper is the ONLY place the two vocabularies meet. brain.ts and
// soldier-brain.ts do not import each other and never should.
import {
  makeBrain, staggerNow, stepBrain, type Brain, type BrainPlayer, type BrainSelf,
} from '../brain';
import {
  makeSoldierBrain, staggerSoldierNow, stepSoldierBrain, type SoldierBrain,
} from '../soldier-brain';
import type { SwingVariant } from '../attack';
import type { Vec3 } from '../types';

export interface MindInput {
  dt: number;
  self: BrainSelf;
  player: BrainPlayer | null;
  /** A shot was fired in this mind's room since the last step. */
  alerted: boolean;
  /** Melee-ring verdict. Meaningless to a soldier; ignored by that mind. */
  hasToken: boolean;
  /** Melee-ring tangential shuffle. Ignored by the soldier mind, which rolls
   *  its own strafe sign — there is no ranged arbiter yet. */
  drift: -1 | 0 | 1;
  /** Fresh 0..1 per frame. The zombie rolls swing variants with it, the
   *  soldier rolls firing opportunities. */
  roll: number;
  /** A SECOND independent 0..1, for the soldier's strafe sign. The zombie
   *  mind ignores it. */
  rollDrift: number;
}

export interface MindOutput {
  /** Wander-target override; null = leave it alone. */
  target: Vec3 | null;
  /** True = locomotion off this frame. */
  halt: boolean;
  /** Melee swing to compose, or null. Always null for a soldier. */
  attack: { phase: number; side: 'L' | 'R'; variant: SwingVariant } | null;
  /** The weapon went off this frame. Always false for a zombie. */
  fire: boolean;
  /** Bearing to write into wander.heading while halted; null = leave it.
   *  Always null for a zombie, which turns only while walking. */
  faceHeading: number | null;
  /** Crowd separation at the wider engaged radius (melee-ring). */
  engaged: boolean;
  /** The ring may not revoke this body's token. */
  committed: boolean;
}

/** Fields every mind reports, merged into ZombieActor.debug() by the actor. */
export interface MindDebug {
  state: string;
  alert: boolean;
  /** Melee vocabulary — the capture driver's oracle. Soldiers report the
   *  neutral defaults so the shape stays stable for every consumer. */
  side: 'L' | 'R';
  variant: string;
  swingT: number;
  hasToken: boolean;
  /** Ranged vocabulary. Zombies report the neutral defaults. */
  aimT: number;
  cooldown: number;
}

export interface EnemyMind {
  step(input: MindInput): MindOutput;
  /** Force the stagger state NOW, on the frame the hit lands. */
  stagger(): void;
  debug(): MindDebug;
}

export function makeZombieMind(): EnemyMind {
  let brain: Brain = makeBrain();
  let lastToken = false;
  return {
    step(input) {
      lastToken = input.hasToken;
      const out = stepBrain(brain, {
        dt: input.dt,
        self: input.self,
        player: input.player,
        alerted: input.alerted,
        hasToken: input.hasToken,
        drift: input.drift,
        roll: input.roll,
      });
      brain = out.brain;
      return {
        target: out.target,
        halt: out.halt,
        attack: out.attack,
        fire: false,
        faceHeading: null,
        engaged: out.engaged,
        committed: out.committed,
      };
    },
    stagger() { brain = staggerNow(brain); },
    debug: () => ({
      state: brain.state,
      alert: brain.alert,
      side: brain.swing.side,
      variant: brain.swing.variant,
      swingT: brain.swingT,
      hasToken: lastToken,
      aimT: 0,
      cooldown: brain.cooldown,
    }),
  };
}

export function makeSoldierMind(): EnemyMind {
  let brain: SoldierBrain = makeSoldierBrain();
  let aimT = 0;
  return {
    step(input) {
      const out = stepSoldierBrain(brain, {
        dt: input.dt,
        self: input.self,
        player: input.player,
        alerted: input.alerted,
        roll: input.roll,
        rollDrift: input.rollDrift,
      });
      brain = out.brain;
      aimT = out.aimT;
      return {
        target: out.target,
        halt: out.halt,
        attack: null,
        fire: out.fire,
        faceHeading: out.faceHeading,
        // Not in any ring: there is no ranged arbiter, and submitting a lone
        // soldier at the wider engaged radius would only push him around.
        engaged: false,
        committed: false,
      };
    },
    stagger() { brain = staggerSoldierNow(brain); },
    debug: () => ({
      state: brain.state,
      alert: brain.alert,
      side: 'R',
      variant: 'none',
      swingT: 0,
      hasToken: false,
      aimT,
      cooldown: brain.cooldown,
    }),
  };
}
```

- [ ] **Step 4: Run and verify it passes**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/enemy-mind.test.ts`

Expected: PASS, 8 tests.

- [ ] **Step 5: Run the hard gate**

Run: `npx vitest run src/lab/sdf-zombie/brain.test.ts && npm test`

Expected: PASS, with `brain.test.ts` unmodified. Confirm with `git status` that `src/lab/sdf-zombie/brain.ts` and `src/lab/sdf-zombie/brain.test.ts` are **not** in the diff.

- [ ] **Step 6: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/enemy-mind.ts src/lab/sdf-zombie/webgpu/enemy-mind.test.ts
git commit -m "enemy-mind: one interface over the two decision layers

The only place the melee and ranged vocabularies meet. brain.ts and
soldier-brain.ts do not import each other. The zombie wrapper is a pure
passthrough so the actor's default stays a no-op.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 5: Wire the mind, the profile and the face heading into the actor

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/game-actor.ts`

- [ ] **Step 1: Add the new options**

In `createZombieActor`'s `opts` type (around line 310), add these three fields after `furniture`:

```ts
  /** The decision layer. Absent = the zombie's, so every existing call site
   *  and every pin is untouched by construction. */
  mind?: EnemyMind;
  /** Per-character motion profile. Absent = the zombie's, matching
   *  stepMotion's own `cfg.profile ?? ZOMBIE_PROFILE` fallback. */
  profile?: MotionProfile;
  /** The body fired its weapon this frame. Called from step(); the wiring
   *  spawns the flash and the pellets. */
  onFire?: () => void;
```

Add the imports at the top of the file:

```ts
import { makeZombieMind, type EnemyMind } from './enemy-mind';
import type { MotionProfile } from '../motion-profile';
```

- [ ] **Step 2: Replace the brain with the mind**

Replace the brain state declaration (around line 376, `let brain: Brain = makeBrain();`) with:

```ts
  const mind: EnemyMind = opts.mind ?? makeZombieMind();
```

Delete the now-unused `let brain: Brain = makeBrain();` and the `makeBrain` / `staggerNow` / `stepBrain` / `Brain` imports from `../brain`.

- [ ] **Step 3: Replace the stepBrain call**

Replace the `stepBrain(brain, {...})` call (around line 568) and the two lines after it:

```ts
      const think = mind.step({
        dt: sdt,
        self: {
          x: state.wander.pos[0], z: state.wander.pos[2],
          yaw: bodyYaw, room: opts.room,
        },
        player: brainPlayer,
        alerted: brainAlerted,
        hasToken: ringToken,
        drift: ringDrift,
        roll: swingRng(),
        rollDrift: swingRng(),
      });
      brainAlerted = false;   // one-shot: the first sub-step consumes it
      lastEngaged = think.engaged;
      lastCommitted = think.committed;
      // FACE LOCK. A halted body cannot otherwise turn: stepWander owns
      // wander.heading and is skipped when cfg.wander is false, so an aiming
      // soldier would track nothing and shoot wherever he last faced.
      // Writing the bearing straight into heading lets the EXISTING damped,
      // rate-limited bodyYaw follow do the turn — no new constant, and no
      // second turn implementation. (brain.ts: one walker, one turn rate.)
      if (think.faceHeading !== null) {
        state = { ...state, wander: { ...state.wander, heading: think.faceHeading } };
      }
      if (think.fire) opts.onFire?.();
```

- [ ] **Step 4: Pass the profile to stepMotion**

In the `stepMotion` config object (around line 620), add `profile` beside `wander`:

```ts
        {
          enabled: true,
          wander: !think.halt,
          ...(opts.profile !== undefined ? { profile: opts.profile } : {}),
```

The spread rather than `profile: opts.profile` is deliberate and matches the `attack` line directly below it: `stepMotion`'s bit-identity contract is about the key being **absent**, not undefined.

- [ ] **Step 5: Route stagger and debug through the mind**

Find every `brain = staggerNow(brain)` and replace with `mind.stagger()`.

Replace both `debug` return objects (around lines 700 and 843) — the shared fields stay owned by the actor, the rest come from the mind:

```ts
      state: mind.debug().state, alert: mind.debug().alert,
      swingT: mind.debug().swingT,
      side: mind.debug().side, variant: mind.debug().variant,
      hasToken: mind.debug().hasToken,
      aimT: mind.debug().aimT,
```

Add `aimT: number;` to the `debug` return type in the `ZombieActor` interface (around line 267).

Replace `brain(): Brain;` in the interface with `mind(): EnemyMind;` and its implementation with `mind: () => mind`.

- [ ] **Step 6: Typecheck and run the full suite**

Run: `npm run build && npm test`

Expected: typecheck clean, all tests pass. **`brain.test.ts`, `game-actor.test.ts`, `game-actor-elbow.test.ts` and `game-actor-torso-slug.test.ts` must pass unmodified.** If any needs editing, stop — the default is not a no-op and the seam is wrong.

- [ ] **Step 7: Run the crowd gate**

Run: `node scripts/sdf-game-crowd-gate.mjs`

Expected: the same verdict as before this task. Capture the output; if it differs, stop and diagnose.

- [ ] **Step 8: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/game-actor.ts
git commit -m "game-actor: take a mind, a profile and a face heading

Defaults to makeZombieMind() and no profile, so the zombie path is unchanged
by construction -- brain.test.ts and the crowd gate pass untouched.

The face lock writes the bearing into wander.heading rather than adding a
turn: stepWander owns heading and is skipped while halted, so an aiming body
could not otherwise track.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 6: Per-kind spawn in game-main

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/game-main.ts`

- [ ] **Step 1: Add the kind table**

Add the import beside the zombie's (line 63):

```ts
import soldierBlobSrc from '../characters/soldier.blob?raw';
```

Add after the `ZOMBIE_FLAT` constant (around line 157):

```ts
/** The soldier's own baked face. Unlike the zombie he HAS a `sheet` block, so
 *  his sheet params come from the blob and only the image is named here. */
const SOLDIER_FACE = {
  url: '/assets/lab/faces/soldier-face.png',
  rect: [0, 0, 512, 512, 512, 512] as [number, number, number, number, number, number],
  /** MEAN 1 IS A KNOWN APPROXIMATION, not a measurement. The shader divides
   *  the sheet by this (`tex.rgb / faceCfg2.y`), so a wrong mean shifts the
   *  whole head's brightness — the lab measures it off the decoded pixels
   *  (lab-main's applyMeanOf) and the game has no equivalent yet. 1 is the
   *  documented pre-measurement fallback, so this is the old behaviour, not
   *  a new bug. If the soldier's head reads too bright or too dark in the
   *  playtest, THIS is the knob, and porting applyMeanOf is the fix. */
  mean: 1,
};

export type EnemyKind = 'zombie' | 'soldier';

const KINDS: Record<EnemyKind, {
  src: string;
  face: typeof ZOMBIE_FLAT;
  profile: MotionProfile;
}> = {
  zombie: { src: zombieBlobSrc, face: ZOMBIE_FLAT, profile: ZOMBIE_PROFILE },
  soldier: { src: soldierBlobSrc, face: SOLDIER_FACE, profile: SOLDIER_PROFILE },
};
```

Add to the imports:

```ts
import { ZOMBIE_PROFILE, SOLDIER_PROFILE, type MotionProfile } from '../motion-profile';
import { compileSheet } from '../blob-compile';
import { makeSoldierMind } from './enemy-mind';
```

- [ ] **Step 2: Make the doc, face and texture per-kind**

Replace lines 927–936 (the single `doc` / `face` / `faceTex` / `faceAtlas`) with a per-kind record built once at boot:

```ts
  /** Everything a kind needs to build a body, compiled once at boot rather
   *  than per spawn. `sheet` is the character's OWN sheet block when it has
   *  one; the zombie has none and falls back to the shared flat texture. */
  const kinds = (Object.keys(KINDS) as EnemyKind[]).map(kind => {
    const def = KINDS[kind];
    const doc = parseBlob(def.src);
    // THE SHEET BLOCK IS A KNOWN TRAP. compileSheet THROWS a BlobError on an
    // unknown key, and one invalid key in the soldier's sheet cost an hour on
    // 2026-09-04 and made him render with the zombie's face. Catch it, shout,
    // and fall back rather than taking the whole page down.
    let sheet = null;
    try {
      sheet = compileSheet(doc);
    } catch (e) {
      console.error(
        `[sdf-game] ${kind}: its \`sheet\` block FAILED TO COMPILE, so it is `
        + `falling back to the zombie face texture. Fix the sheet block:\n  `
        + String(e),
      );
    }
    const tex = new THREE.TextureLoader().load(def.face.url);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.flipY = true;
    const [fx, fy, fw, fh, fsw, fsh] = def.face.rect;
    return {
      kind, doc,
      face: compileFace(doc),
      sheet,
      tex,
      mean: def.face.mean,
      atlas: new THREE.Vector4(fw / fsw, fh / fsh, fx / fsw, fy / fsh),
      profile: def.profile,
    };
  });
  const kindOf = (k: EnemyKind) => kinds.find(x => x.kind === k)!;
```

- [ ] **Step 3: Parameterize the spawn**

Rename `spawnZombie` to `spawnEnemy` and give it a kind. Change the signature (line 1048):

```ts
  function spawnEnemy(kind: EnemyKind, room: RoomDef, start: Vec3, errs: string[]): ZombieActor {
    const K = kindOf(kind);
```

Inside it, replace `compileBlob(doc, face)` with `compileBlob(K.doc, K.face)`, and `if (doc.stance)` with `if (K.doc.stance)`.

Replace the face wiring (lines 1106–1109):

```ts
    view.setFaceTexture(K.tex, K.atlas, K.mean);
    view.uniforms.faceCfg.value.x = 1;
    view.uniforms.faceCfg.value.y = 1.0;
    // The character's OWN sheet projection when it declared one; the zombie's
    // hand-tuned default otherwise. Passing the zombie's numbers to a body
    // with its own bake is what strips a character's face.
    if (K.sheet) {
      view.uniforms.faceProj.value.set(
        K.sheet.projScaleX, K.sheet.projScaleY,
        K.sheet.projCentreX, K.sheet.projCentreY,
      );
    } else {
      view.uniforms.faceProj.value.set(0.45, 0.58, 0.5, 0.56);
    }
```

Replace the `createZombieActor` call (around line 1128):

```ts
    const actor = createZombieActor({
      id: zombieId, room: room.id, body: placed, view, start,
      seed: 1337 + nextId * 101,
      bounds: wanderBounds(room),
      furniture: roomFurniture,
      ...(kind === 'soldier' ? { mind: makeSoldierMind() } : {}),
      profile: K.profile,
      onSever: (piece, stumpWound) => onSeverDispatch?.(actor, piece, stumpWound),
    });
```

- [ ] **Step 4: Give one room the soldier**

Replace `spawnAll` (line 1141):

```ts
  /** Which room the lone soldier holds. ONE soldier, ONE room: there is no
   *  ranged arbiter yet, so two of them would shoot through each other. */
  const SOLDIER_ROOM = 2;

  function spawnAll(errs: string[]): void {
    for (const room of ROOMS) {
      const points = spawnPoints(room);
      for (let i = 0; i < points.length; i++) {
        const kind: EnemyKind =
          room.id === SOLDIER_ROOM && i === 0 ? 'soldier' : 'zombie';
        actors.push(spawnEnemy(kind, room, points[i]!, errs));
      }
    }
  }
```

- [ ] **Step 5: Typecheck and run**

Run: `npm run build && npm test`

Expected: typecheck clean, all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/game-main.ts
git commit -m "game-main: enemies come in kinds

Per-kind blob, compiled face, sheet block, texture and motion profile, built
once at boot. One soldier holds room 2; everything else is still a zombie.

The sheet block is caught rather than thrown: compileSheet raises on an
unknown key, and one bad key cost an hour on 2026-09-04 by silently swapping
the soldier's face for the zombie's.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 7: Kit overlay and held prop in the game

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/game-main.ts`

- [ ] **Step 1: Load them per soldier actor**

Add the imports:

```ts
import { loadKit, type KitOverlay } from './kit-overlay';
import { loadHeldProp, type HeldProp } from './held-prop';
import { boneFrames } from '../rig-frames';
import { rotateYaw } from '../vec';
```

Add a side table beside `actors` (near the `spawnAll` definition):

```ts
/** Polygon halves for the actors that have them, keyed by actor id. The
 *  zombie has neither, so this stays empty for every zombie in the game. */
const dressing = new Map<number, { kit: KitOverlay | null; prop: HeldProp | null }>();
```

At the end of `spawnEnemy`, before `return actor`:

```ts
    if (kind === 'soldier') {
      const slot: { kit: KitOverlay | null; prop: HeldProp | null } =
        { kit: null, prop: null };
      dressing.set(zombieId, slot);
      // Fire-and-forget, as the lab does: a kit or prop that fails to load
      // must not take the page down, and the flesh body renders regardless.
      loadKit('/assets/lab/soldier-kit.gltf')
        .then(k => { slot.kit = k; scene.add(k.object); })
        .catch(e => console.error('[sdf-game] soldier kit failed to load:', e));
      if (K.profile.prop) {
        loadHeldProp(K.profile.prop.url)
          .then(p => { slot.prop = p; scene.add(p.object); })
          .catch(e => console.error('[sdf-game] soldier prop failed to load:', e));
      }
    }
```

- [ ] **Step 2: Pose them each frame**

In the per-frame actor loop, after each actor's `step(dt)`, add:

```ts
    // Polygon halves ride the rig: the kit from per-bone frames, the gun from
    // the motion frame's gun pose. Collapse releases the gun; the kit simply
    // keeps following the fallen rig. Mirrors lab-main's block.
    const dress = dressing.get(a.id);
    if (dress && (dress.kit || dress.prop)) {
      const p = a.pose();
      const frames = boneFrames(a.posed(), a.boundRig(), p.yaw);
      dress.kit?.pose(frames);
      const gun = a.gunPose();
      if (dress.prop && gun && !dress.prop.released) {
        dress.prop.pose(gun, a.sinceFire(), rotateYaw([1, 0, 0], p.yaw));
      }
      if (dress.prop && a.collapsed() && !dress.prop.released) {
        dress.prop.release([0, 0, 0], a.id);
      }
      dress.prop?.step(Math.min(dt, 1 / 30), 0);
    }
```

- [ ] **Step 3: Expose the three new actor readers**

`gunPose()`, `sinceFire()` and `collapsed()` do not exist yet. Add them to `ZombieActor` in `game-actor.ts`:

```ts
  /** This frame's gun pose from the motion frame (right forearm), or null for
   *  a body with no carry. The held prop rides it. */
  gunPose: () => GunPose | null;
  /** Seconds since this body last fired — the held prop's muzzle rise. */
  sinceFire: () => number;
  /** True once the collapse has left the standing phase. */
  collapsed: () => boolean;
```

And implement them near the other readers, reading `lastFrame` (already tracked in `step`):

```ts
    gunPose: () => lastFrame?.gun ?? null,
    sinceFire: () => state.sinceFire,
    collapsed: () => lastFrame?.collapsed ?? false,
```

`GunPose` is already imported into `motion.ts` from `../carry`; import it into
`game-actor.ts` the same way: `import type { GunPose } from '../carry';`.

- [ ] **Step 4: Typecheck and run**

Run: `npm run build && npm test`

Expected: typecheck clean, all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/game-actor.ts src/lab/sdf-zombie/webgpu/game-main.ts
git commit -m "game-main: the soldier wears his kit and carries his shorty

kit-overlay and held-prop already live beside game-main; only lab-main wired
them. Per-actor dressing keyed by id, loaded fire-and-forget so a failed glTF
cannot take the page down.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 8: The shot

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/game-main.ts`

- [ ] **Step 1: Add the separate pellet list**

Near the player's projectile list:

```ts
  /** SOLDIER PELLETS — A SEPARATE LIST, AND NEVER RAYCAST AGAINST ACTORS.
   *
   *  Two deliberate reasons. The player's pellet path is tuned, pinned, and
   *  carries the hit-batching work from 2026-09-05; a soldier feature must
   *  not perturb it. And an un-raycast list CANNOT accidentally friendly-fire
   *  zombies — whether soldiers hurt zombies is a real encounter-design
   *  decision, not one to make by accident.
   *
   *  There is no player health in the SDF game, so these hit nothing at all.
   *  They fly, and they expire. That is the whole contract for this phase. */
  const soldierPellets: Projectile[] = [];
```

- [ ] **Step 2: Fire on the brain's pulse**

In `spawnEnemy`'s `createZombieActor` options, add the `onFire` hook for soldiers:

```ts
      ...(kind === 'soldier' ? {
        mind: makeSoldierMind(),
        onFire: () => {
          const slot = dressing.get(zombieId);
          const muz = slot?.prop?.muzzle();
          if (!muz) return;   // prop still loading: no muzzle, no shot
          const p = actor.pose();
          // Along his facing, which the brain's face lock has already turned
          // to the player — do NOT re-aim here, or the shot would ignore the
          // turn rate and snap to a player the telegraph never tracked.
          const dir = rotateYaw([0, 0, 1], p.yaw);
          // `nextSeed` is a mutable number, not a function — advance it the
          // way the player's fire path does at game-main.ts:1991.
          nextSeed = (nextSeed * 1664525 + 1013904223) >>> 0;
          // ONE barrel: the double-barrel volley is the player's signature,
          // and the soldier firing the same wall of lead reads as a second
          // player rather than an enemy.
          soldierPellets.push(...spawnPellets(muz, dir, 1, nextSeed));
          spawnMuzzleFlash(muz);
        },
      } : {}),
```

`spawnPellets(origin, aimDir, barrels, seed)` returns `Projectile[]` with `barrels` typed `1 | 2` — confirmed against `game-weapon.ts:161`.

- [ ] **Step 3: Step and cull them**

In the per-frame update, beside the player's pellet step. **Use `stepProjectiles`** — it is the same integrator the player's pellets use (semi-implicit Euler, gravity before move), and hand-rolling a second one would let the two drift apart:

```ts
    // Visual only — stepped and culled, never traced against a body. Note
    // the field is `ageSec`, not `age`.
    stepProjectiles(soldierPellets, dt);
    for (let i = soldierPellets.length - 1; i >= 0; i--) {
      if (expired(soldierPellets[i]!)) soldierPellets.splice(i, 1);
    }
```

Add `stepProjectiles` to the existing `game-weapon` import.

- [ ] **Step 4: Add the world-space muzzle flash**

`game-main` already builds a `flashTextures` pool (`FLASH_VARIANTS` pre-baked `flashPixels` textures, around line 1745), but its `flashGroup` is the **FPV weapon's** flash — one instance, parented to the viewmodel, and not reusable for a body out in the world. The soldier needs his own world-space sprites, drawn from the same texture pool so the two read as the same gun.

Add beside `soldierPellets`:

```ts
  /** World-space muzzle flashes (the soldier's). Separate from flashGroup,
   *  which is the FPV weapon's single viewmodel-parented flash. Pooled: a
   *  sprite per shot allocated and disposed would churn on sustained fire. */
  const soldierFlashes: { sprite: THREE.Sprite; life: number }[] = [];
  const SOLDIER_FLASH_SEC = 0.05;

  function spawnMuzzleFlash(at: Vec3): void {
    const tex = flashTextures[Math.floor(Math.random() * flashTextures.length)];
    if (!tex) return;   // pool not built yet
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, color: 0xffe6bf, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    s.position.set(at[0], at[1], at[2]);
    s.material.rotation = Math.random() * Math.PI * 2;
    s.scale.setScalar(0.4);
    scene.add(s);
    soldierFlashes.push({ sprite: s, life: SOLDIER_FLASH_SEC });
  }
```

and step them in the frame loop, disposing the per-sprite material on removal:

```ts
    for (let i = soldierFlashes.length - 1; i >= 0; i--) {
      const f = soldierFlashes[i]!;
      f.life -= dt;
      if (f.life <= 0) {
        scene.remove(f.sprite);
        f.sprite.material.dispose();
        soldierFlashes.splice(i, 1);
      } else {
        f.sprite.material.opacity = f.life / SOLDIER_FLASH_SEC;
      }
    }
```

- [ ] **Step 5: Typecheck and run**

Run: `npm run build && npm test`

Expected: typecheck clean, all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/game-main.ts
git commit -m "game-main: the soldier's shot

Muzzle flash and pellets from HeldProp.muzzle(), fired on the brain's one-frame
pulse and aimed along his ACTUAL facing so the shot cannot outrun the
telegraph's turn rate.

Soldier pellets live in their own list and are never raycast against actors:
the player's pellet path stays untouched, and friendly fire stays a decision
rather than an accident.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 9: The owner gate

**Files:** none — this is a playtest.

- [ ] **Step 1: Full suite and typecheck**

Run: `npm run build && npm test`

Expected: clean. Record the test count.

- [ ] **Step 2: Confirm the hard gate one last time**

Run: `git diff main --stat -- src/lab/sdf-zombie/brain.ts src/lab/sdf-zombie/brain.test.ts`

Expected: **empty output.** If either file appears, the design's central claim is false — stop and report it rather than proceeding.

Run: `node scripts/sdf-game-crowd-gate.mjs` and confirm the verdict matches the pre-Task-5 capture.

- [ ] **Step 3: Start the game for the owner**

Run: `npm run dev` and give the owner the SDF game URL. Do **not** judge the feel yourself — this gate is the owner's.

- [ ] **Step 4: Collect the verdict against the named failure modes**

Ask specifically about these three, since they are the ones with knobs:

| Symptom | Knob |
| --- | --- |
| Metronomic — he fires on a beat | `refireRoll`, `repositionSec`, `minCooldownSec` |
| You cannot tell he is about to shoot | `aimSec` |
| Passive — he politely holds range while you line up | `standoffNear` / `standoffFar`, or drop the band entirely (see the spec's Doom note) |

Also check, since neither has a unit test and both are known approximations:

- **Head brightness.** `SOLDIER_FACE.mean` is 1, not measured. Too bright or
  too dark a head means porting lab-main's `applyMeanOf` into the game.
- **Cornering.** Back him into a wall. He should stop retreating and keep
  firing, because `stepWander` clamps him — this is emergent from the bounds,
  not coded in the brain, so it can only be checked here.

- [ ] **Step 5: Record the outcome**

Update `TASKS.md`'s soldier row with the verdict. Save a dualmem memory of any tuning the owner settled on, with `--files` covering `soldier-brain.ts`, and write the session's findings to Obsidian under `Claude Notes/` per the standing preference.

---

## Notes for the implementer

- **If Task 5 makes you edit an existing test, stop.** The whole architecture rests on the zombie path being untouched. A test that needs changing means the default is not a no-op — diagnose that before continuing.
- **Field names verified against source, don't "fix" them:** `Projectile.ageSec` (not `age`), `MotionFrame.gun: GunPose | null`, `MotionState.sinceFire`, `spawnPellets(origin, aimDir, barrels: 1 | 2, seed)`, and `nextSeed` is a mutable number in `game-main` rather than a function.
- **`SOLDIER_ROOM = 2` is a guess.** Check `ROOMS` in `game-level.ts` and pick a room with enough floor for a 6 m standoff; a soldier in a closet will be pinned against the bounds and never leave `retreat`.
