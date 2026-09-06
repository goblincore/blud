// src/lab/sdf-zombie/soldier-brain.test.ts
import { describe, it, expect } from 'vitest';
import {
  SOLDIER_TUNING, makeSoldierBrain, staggerSoldierNow, stepSoldierBrain,
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
