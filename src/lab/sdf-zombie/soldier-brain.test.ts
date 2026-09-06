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
