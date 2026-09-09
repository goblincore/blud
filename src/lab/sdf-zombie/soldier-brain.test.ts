// src/lab/sdf-zombie/soldier-brain.test.ts
import { describe, it, expect } from 'vitest';
import {
  SOLDIER_TUNING, makeSoldierBrain, staggerSoldierNow, stepSoldierBrain,
  type SoldierBrain, type SoldierInput,
} from './soldier-brain';

const DT = 1 / 60;

// DISTANCES DERIVE FROM THE TUNING, never literals.
//
// They were literals (5 = "in the band", 8 = "outside", 2 = "too close") and
// every one of them rotted the moment the band was retuned from 3.5-6.0 to
// 2.0-3.5 to fit room 1's 6.6 m of walkable floor: 15 tests failed, all of
// them fixture arithmetic rather than behaviour. A test that encodes a tuning
// value in a magic number is a test that breaks when the value is tuned, which
// is the one thing tuning values are for.
/** At his preferred range — in weapon range, not crowding, not far. */
const MID = SOLDIER_TUNING.preferredRange;
/** Well beyond the range he likes — he should close. Still inside
 *  noticeRange so he can see the player at all. */
const FAR = SOLDIER_TUNING.preferredRange + SOLDIER_TUNING.rangeSlack + 2;
/** Crowding him — he should give ground. */
const NEAR = SOLDIER_TUNING.tooClose * 0.5;

function input(over: Partial<SoldierInput> = {}): SoldierInput {
  return {
    dt: DT,
    self: { x: 0, z: 0, yaw: 0, room: 3 },   // facing +z
    player: { x: 0, z: MID, room: 3 },        // straight ahead, in the band
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
      player: { x: 0, z: -MID, room: 3 },
    }));
    expect(out.brain.alert).toBe(false);
    expect(out.brain.state).toBe('idle');
    expect(out.target).toBeNull();
  });

  it('does not notice a player in another room', () => {
    const out = stepSoldierBrain(makeSoldierBrain(), input({
      player: { x: 0, z: MID, room: 9 },
    }));
    expect(out.brain.alert).toBe(false);
  });

  it('a gunshot in the room bypasses the notice cone', () => {
    const out = stepSoldierBrain(makeSoldierBrain(), input({
      player: { x: 0, z: -MID, room: 3 },
      alerted: true,
    }));
    expect(out.brain.alert).toBe(true);
  });

  it('forgets the player after loseGrace out of the room', () => {
    const out = run(alerted(), { player: { x: 0, z: MID, room: 9 } },
      SOLDIER_TUNING.loseGrace + 0.5);
    expect(out.brain.alert).toBe(false);
    expect(out.brain.state).toBe('idle');
  });
});

describe('stepSoldierBrain — disarmed combat', () => {
  it('keeps support-arm loss ranged but slows the aim', () => {
    const base = { ...alerted(), state: 'aim' as const, phaseT: SOLDIER_TUNING.aimSec };
    expect(stepSoldierBrain(base, input({ missing: { armL: true, armR: false, legL: false, legR: false } })).fire).toBe(false);
    expect(stepSoldierBrain(base, input({ missing: { armL: false, armR: false, legL: false, legR: false } })).fire).toBe(true);
  });

  it('pursues and emits one gated contact when the gun arm is gone', () => {
    let b = alerted(); let contacts = 0; let attacks = 0;
    const missing = { armL: false, armR: true, legL: false, legR: false };
    for (let i = 0; i < 100; i++) {
      const out = stepSoldierBrain(b, input({ player: { x: 0, z: 1, room: 3 }, missing, hasToken: true, lineOfSight: true }));
      b = out.brain; contacts += Number(out.contact); attacks += Number(!!out.attack);
    }
    expect(attacks).toBeGreaterThan(1);
    expect(contacts).toBe(1);
    expect(stepSoldierBrain(b, input({ player: { x: 0, z: 5, room: 3 }, missing, hasToken: true })).contact).toBe(false);
  });

  it('uses a body shove when both arms are missing', () => {
    const missing = { armL: true, armR: true, legL: false, legR: false };
    let b = alerted(), variant = '';
    for (let i = 0; i < 30 && !variant; i++) { const o = stepSoldierBrain(b, input({ player: { x: 0, z: 1, room: 3 }, missing, hasToken: true })); b = o.brain; variant = o.attack?.variant ?? ''; }
    expect(variant).toBe('shove');
  });
});

describe('stepSoldierBrain — movement is a preference, never a gate', () => {
  it('closes when well outside the range he likes', () => {
    const out = stepSoldierBrain(alerted(), input({
      player: { x: 0, z: FAR, room: 3 },
    }));
    expect(out.brain.state).toBe('engage');
    expect(out.target![2]).toBeGreaterThan(0);
    expect(out.target![2]).toBeLessThan(FAR); // a bounded approach, not a charge
    expect(out.halt).toBe(false);
  });

  it('gives ground when crowded', () => {
    const out = stepSoldierBrain(alerted(), input({
      player: { x: 0, z: NEAR, room: 3 },
    }));
    expect(out.brain.state).toBe('engage');
    expect(out.halt).toBe(false);
    // Away from the player: he is at z=NEAR, self at 0, so the fallback point
    // sits BEHIND self on the player->self bearing (z negative).
    expect(out.target![2]).toBeLessThan(0);
  });

  it('holds a comfortable firing position between decisions', () => {
    const out = stepSoldierBrain(alerted(), input({ roll: 1 }));
    expect(out.brain.state).toBe('engage');
    expect(out.halt).toBe(true);
    expect(out.target).toBeNull();
  });

  it('THE REGRESSION: movement never starves him of a shot', () => {
    // The first design gated firing on a `standoff` state reached only after
    // the advance/retreat branches fell through, with the decision tick INSIDE
    // that branch — so a player who kept him moving kept the tick from ever
    // advancing and he could not attack at all. Firing must now work from any
    // in-range distance, including ones that also make him walk.
    for (const z of [NEAR, MID, FAR]) {
      let b = makeSoldierBrain();
      let fired = false;
      for (let i = 0; i < 600 && !fired; i++) {
        const o = stepSoldierBrain(b, input({ player: { x: 0, z, room: 3 }, roll: 0 }));
        b = o.brain;
        if (o.fire) fired = true;
      }
      const inRange = z <= SOLDIER_TUNING.fireRange;
      expect(fired, `z=${z} (inRange=${inRange})`).toBe(inRange);
    }
  });

  it('will not shoot from beyond fireRange', () => {
    let b = makeSoldierBrain();
    let fired = false;
    for (let i = 0; i < 600; i++) {
      const o = stepSoldierBrain(b, input({
        player: { x: 0, z: SOLDIER_TUNING.fireRange + 2, room: 3 }, roll: 0,
      }));
      b = o.brain;
      if (o.fire) fired = true;
    }
    expect(fired).toBe(false);
  });
});

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
    expect(out.brain.state).toBe('engage');
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
    expect(r.out.brain.state).toBe('engage');
  });

  it('emits a single-frame fire pulse, then recovers before the follow-up', () => {
    const r = until(alerted(), { roll: 0 }, 5, out => out.fire);
    expect(r.fires).toBe(1);
    const next = stepSoldierBrain(r.brain, input({ roll: 0 }));
    expect(next.fire).toBe(false);
    expect(next.brain.state).toBe('recover');
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

  it('abandons a shot if the player leaves effective weapon range', () => {
    const enter = until(alerted(), { roll: 0 }, SOLDIER_TUNING.repositionSec + 0.1,
      o => o.brain.state === 'aim');
    expect(enter.out.brain.state).toBe('aim');
    // Player teleports far outside the band, mid-telegraph.
    const far = { player: { x: 0, z: 30, room: 3 }, roll: 1 };
    const r = until(enter.brain, far, SOLDIER_TUNING.aimSec + 0.1);
    expect(r.fires).toBe(0);            // reacquire before another telegraph
  });

  it('a BURST bypasses the tick, but a refused burst does not', () => {
    // roll 0 always wins the burst roll, so a shot is followed up immediately
    // without waiting for the next decision tick -- a burst is ONE action.
    const span = SOLDIER_TUNING.repositionSec + SOLDIER_TUNING.aimSec * 2
      + SOLDIER_TUNING.recoverSec * 2 + 0.1;
    const burst = until(alerted(), { roll: 0 }, span);
    expect(burst.fires).toBeGreaterThan(1);

    // roll 1 refuses both the fire roll AND the burst roll: no shots at all.
    const none = until(alerted(), { roll: 1 }, span);
    expect(none.fires).toBe(0);
  });

  it('holds a settle beat after the burst before moving again', () => {
    // The shot used to end and he was strafing on the very next frame, which
    // read as a twitch rather than an attack.
    let b = alerted();
    let sawSettle = false;
    let movedDuringSettle = false;
    for (let i = 0; i < 60 * 12; i++) {
      const o = stepSoldierBrain(b, input({ roll: 0 }));
      b = o.brain;
      if (b.state === 'settle') {
        sawSettle = true;
        if (!o.halt || o.target !== null) movedDuringSettle = true;
        if (!o.weaponUp) movedDuringSettle = true;   // gun must stay up
      }
    }
    expect(sawSettle).toBe(true);
    expect(movedDuringSettle).toBe(false);
  });

  it('the weapon is UP for the whole beat, not just the shot frame', () => {
    let b = alerted();
    const upStates = new Set<string>();
    for (let i = 0; i < 60 * 12; i++) {
      const o = stepSoldierBrain(b, input({ roll: 0 }));
      b = o.brain;
      if (o.weaponUp) upStates.add(b.state);
    }
    // aim through settle, never while merely engaging
    expect(upStates.has('aim')).toBe(true);
    expect(upStates.has('recover')).toBe(true);
    expect(upStates.has('settle')).toBe(true);
    expect(upStates.has('engage')).toBe(false);
  });

  it('re-rolls the strafe sign on the decision tick', () => {
    const left = until(alerted(), { roll: 1, rollDrift: 0 },
      SOLDIER_TUNING.repositionSec + 0.1, o => o.brain.driftT >= SOLDIER_TUNING.repositionSec);
    expect(left.out.brain.drift).toBe(-1);
    const right = until(alerted(), { roll: 1, rollDrift: 1 },
      SOLDIER_TUNING.repositionSec + 0.1, o => o.brain.driftT >= SOLDIER_TUNING.repositionSec);
    expect(right.out.brain.drift).toBe(1);
  });

});

describe('staggerSoldierNow', () => {
  it('cannot resume aiming or attack while the backward stagger is recovering', () => {
    let b = staggerSoldierNow(alerted());
    for (let frame = 0; frame < 71; frame++) {
      const out = stepSoldierBrain(b, input({ roll: 0 }));
      b = out.brain;
      expect(out.fire).toBe(false);
      expect(out.weaponUp).toBe(false);
      expect(out.halt).toBe(true);
      expect(b.state).toBe('stagger');
    }
  });

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

describe('soldier combat regressions', () => {
  it('waits for actual facing before releasing a completed telegraph', () => {
    const b = { ...alerted(), state: 'aim' as const, phaseT: SOLDIER_TUNING.aimSec };
    const out = stepSoldierBrain(b, input({ self: { x: 0, z: 0, yaw: Math.PI, room: 3 } }));
    expect(out.fire).toBe(false);
    expect(out.weaponUp).toBe(true);
    expect(out.faceHeading).toBeCloseTo(0);
  });

  it('cancels fire when the player disappears behind an obstacle', () => {
    const b = { ...alerted(), state: 'aim' as const, phaseT: SOLDIER_TUNING.aimSec };
    const out = stepSoldierBrain(b, input({ lineOfSight: false }));
    expect(out.fire).toBe(false);
    expect(out.brain.state).not.toBe('aim');
  });

  it('does not finish a shot into a different room during alert grace', () => {
    const b = { ...alerted(), state: 'aim' as const, phaseT: SOLDIER_TUNING.aimSec };
    expect(stepSoldierBrain(b, input({ player: { x: 0, z: MID, room: 9 } })).fire).toBe(false);
  });

  it('raises the gun on the first frame of aim', () => {
    const b = { ...alerted(), driftT: 0 };
    expect(stepSoldierBrain(b, input({ roll: 0 })).weaponUp).toBe(true);
  });

  it('commits to one reachable destination instead of chasing an orbit', () => {
    const b = { ...alerted(), driftT: 0 };
    const start = stepSoldierBrain(b, input({ roll: 1 }));
    expect(start.target).not.toBeNull();
    const next = stepSoldierBrain(start.brain, input({ self: { x: 0.2, z: 0.1, yaw: 0, room: 3 } }));
    expect(next.target).toEqual(start.target);
    const arrived = stepSoldierBrain(next.brain, input({
      self: { x: start.target![0], z: start.target![2], yaw: 0, room: 3 },
    }));
    expect(arrived.halt).toBe(true);
    expect(arrived.target).toBeNull();
  });

  it('holds position if both sidesteps are blocked', () => {
    const b = { ...alerted(), driftT: 0 };
    const out = stepSoldierBrain(b, input({ canMoveTo: () => false }));
    expect(out.halt).toBe(true);
    expect(out.target).toBeNull();
  });

  it('abandons a blocked move promptly rather than walking into a wall forever', () => {
    const start = stepSoldierBrain({ ...alerted(), driftT: 0 }, input());
    const out = run(start.brain, {}, 1.8);
    expect(out.halt).toBe(true);
  });
});


describe('soldier pressure bursts', () => {
  it.each([{ roll: .8, count: 2 }, { roll: .1, count: 3 }])('commits to $count quick shots without moving between them', ({ roll, count }) => {
    let brain = makeSoldierBrain();
    const shots: number[] = [];
    for (let frame = 0; frame < 600; frame++) {
      const out = stepSoldierBrain(brain, input({ alerted: true, roll }));
      brain = out.brain;
      if (out.fire) shots.push(frame * DT);
      if (shots.length && brain.state !== 'settle') expect(out.halt).toBe(true);
      if (brain.state === 'settle') break;
    }
    expect(shots).toHaveLength(count);
    for (let i = 1; i < shots.length; i++) {
      expect(shots[i]! - shots[i - 1]!).toBeGreaterThan(.2);
      expect(shots[i]! - shots[i - 1]!).toBeLessThan(.5);
    }
  });
});
