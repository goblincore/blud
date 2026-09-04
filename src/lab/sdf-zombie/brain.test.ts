// src/lab/sdf-zombie/brain.test.ts
import { describe, it, expect } from 'vitest';
import {
  BRAIN_TUNING, makeBrainState, stepBrain,
  type BrainInput, type BrainState,
} from './brain';

const DT = 1 / 60;

function input(over: Partial<BrainInput> = {}): BrainInput {
  return {
    dt: DT,
    self: { x: 0, z: 0, yaw: 0, room: 3 },   // facing +z
    player: { x: 0, z: 4, room: 3 },          // straight ahead, 4 m
    alerted: false,
    ...over,
  };
}

/** Runs the brain for `seconds`, returning the last output. */
function run(state: BrainState, over: Partial<BrainInput>, seconds: number) {
  let s = state;
  let out = stepBrain(s, input(over));
  for (let t = 0; t < seconds; t += DT) {
    out = stepBrain(s, input(over));
    s = out.state;
  }
  return out;
}

describe('stepBrain — noticing', () => {
  it('notices a player in front, in the same room, in range', () => {
    const out = stepBrain(makeBrainState(), input());
    expect(out.state.alert).toBe(true);
    expect(out.state.mode).toBe('chase');
  });

  it('does not notice a player behind it', () => {
    const out = stepBrain(makeBrainState(), input({ player: { x: 0, z: -4, room: 3 } }));
    expect(out.state.alert).toBe(false);
    expect(out.state.mode).toBe('wander');
    expect(out.target).toBeNull();
  });

  it('does not notice a player in another room', () => {
    const out = stepBrain(makeBrainState(), input({ player: { x: 0, z: 4, room: 2 } }));
    expect(out.state.alert).toBe(false);
  });

  it('does not notice a player past noticeRange', () => {
    const far = BRAIN_TUNING.noticeRange + 1;
    const out = stepBrain(makeBrainState(), input({ player: { x: 0, z: far, room: 3 } }));
    expect(out.state.alert).toBe(false);
  });

  it('a shot in the room turns heads regardless of the cone', () => {
    const out = stepBrain(
      makeBrainState(),
      input({ player: { x: 0, z: -4, room: 3 }, alerted: true }),
    );
    expect(out.state.alert).toBe(true);
  });
});

describe('stepBrain — the lock', () => {
  it('keeps chasing while the player is briefly out of the room', () => {
    const alert = stepBrain(makeBrainState(), input()).state;
    const out = run(alert, { player: { x: 0, z: 4, room: 9 } }, BRAIN_TUNING.loseGrace - 0.5);
    expect(out.state.alert).toBe(true);
  });

  it('gives up once the player has been gone past the grace', () => {
    const alert = stepBrain(makeBrainState(), input()).state;
    const out = run(alert, { player: { x: 0, z: 4, room: 9 } }, BRAIN_TUNING.loseGrace + 0.5);
    expect(out.state.alert).toBe(false);
    expect(out.state.mode).toBe('wander');
    expect(out.target).toBeNull();
  });

  it('a null player (tunnel / void) also counts as gone', () => {
    const alert = stepBrain(makeBrainState(), input()).state;
    const out = run(alert, { player: null }, BRAIN_TUNING.loseGrace + 0.5);
    expect(out.state.alert).toBe(false);
  });
});

describe('stepBrain — the standoff target', () => {
  it('aims at a point attackRange from the player, on the zombie side', () => {
    const out = stepBrain(makeBrainState(), input());
    const t = out.target!;
    expect(t).not.toBeNull();
    // Player at (0, 4), zombie at (0, 0): the standoff sits between them.
    expect(Math.hypot(t[0] - 0, t[2] - 4)).toBeCloseTo(BRAIN_TUNING.attackRange, 6);
    expect(t[2]).toBeLessThan(4);
    expect(t[1]).toBe(0);
  });

  it('falls back to its own facing when standing exactly on the player', () => {
    const alert = stepBrain(makeBrainState(), input()).state;
    const out = stepBrain(alert, input({
      self: { x: 2, z: 2, yaw: 0, room: 3 },
      player: { x: 2, z: 2, room: 3 },
    }));
    const t = out.target!;
    expect(Number.isFinite(t[0])).toBe(true);
    expect(Math.hypot(t[0] - 2, t[2] - 2)).toBeCloseTo(BRAIN_TUNING.attackRange, 6);
  });
});

describe('stepBrain — the swing', () => {
  const close = { player: { x: 0, z: 0.8, room: 3 } };

  it('halts and swings once inside attackRange', () => {
    const alert = stepBrain(makeBrainState(), input()).state;
    const out = stepBrain(alert, input(close));
    expect(out.halt).toBe(true);
    expect(out.state.mode).toBe('attack');
    expect(out.attack).not.toBeNull();
  });

  it('runs the swing over swingSec and then cools down', () => {
    let s = stepBrain(makeBrainState(), input()).state;
    let out = stepBrain(s, input(close));
    s = out.state;
    const frames = Math.ceil(BRAIN_TUNING.swingSec / DT) + 2;
    for (let i = 0; i < frames; i++) { out = stepBrain(s, input(close)); s = out.state; }
    expect(s.mode).not.toBe('attack');
    expect(s.cooldown).toBeGreaterThan(0);
  });

  it('finishes a swing already in flight after the player retreats', () => {
    let s = stepBrain(makeBrainState(), input()).state;
    s = stepBrain(s, input(close)).state;         // committed
    const out = stepBrain(s, input({ player: { x: 0, z: 6, room: 3 } }));
    expect(out.state.mode).toBe('attack');
    expect(out.attack).not.toBeNull();
  });

  it('gates the second swing behind cooldownSec', () => {
    let s = stepBrain(makeBrainState(), input()).state;
    let out = stepBrain(s, input(close)); s = out.state;
    const frames = Math.ceil(BRAIN_TUNING.swingSec / DT) + 2;
    for (let i = 0; i < frames; i++) { out = stepBrain(s, input(close)); s = out.state; }
    expect(s.mode).not.toBe('attack');
    // Half the cooldown later it must still not have started another.
    for (let t = 0; t < BRAIN_TUNING.cooldownSec / 2; t += DT) {
      out = stepBrain(s, input(close)); s = out.state;
    }
    expect(s.mode).not.toBe('attack');
    // Past the cooldown it swings again.
    for (let t = 0; t < BRAIN_TUNING.cooldownSec; t += DT) {
      out = stepBrain(s, input(close)); s = out.state;
      if (s.mode === 'attack') break;
    }
    expect(s.mode).toBe('attack');
  });

  it('holds position through the cooldown instead of walking into the player', () => {
    let s = stepBrain(makeBrainState(), input()).state;
    let out = stepBrain(s, input(close)); s = out.state;
    const frames = Math.ceil(BRAIN_TUNING.swingSec / DT) + 2;
    for (let i = 0; i < frames; i++) { out = stepBrain(s, input(close)); s = out.state; }
    expect(out.halt).toBe(true);   // engaged latch keeps it halted
  });

  it('releases the halt only past releaseRange (hysteresis)', () => {
    let s = stepBrain(makeBrainState(), input()).state;
    s = stepBrain(s, input(close)).state;
    // Just past attackRange but inside releaseRange: still engaged.
    const mid = (BRAIN_TUNING.attackRange + BRAIN_TUNING.releaseRange) / 2;
    let out = stepBrain(s, input({ player: { x: 0, z: mid, room: 3 } }));
    expect(out.state.engaged).toBe(true);
    // Past releaseRange: released, and walking again.
    out = stepBrain(out.state, input({ player: { x: 0, z: BRAIN_TUNING.releaseRange + 0.3, room: 3 } }));
    expect(out.state.engaged).toBe(false);
  });
});
