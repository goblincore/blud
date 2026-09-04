// src/lab/sdf-zombie/brain.test.ts
import { describe, it, expect } from 'vitest';
import {
  BRAIN_TUNING, makeBrain, stepBrain,
  type Brain, type BrainInput,
} from './brain';

const DT = 1 / 60;

function input(over: Partial<BrainInput> = {}): BrainInput {
  return {
    dt: DT,
    self: { x: 0, z: 0, yaw: 0, room: 3 },   // facing +z
    player: { x: 0, z: 4, room: 3 },          // straight ahead, 4 m
    alerted: false,
    hasToken: false,
    drift: 0,
    blasted: false,
    ...over,
  };
}

/** Runs the brain for `seconds` and returns the last output. */
function run(brain: Brain, over: Partial<BrainInput>, seconds: number) {
  let b = brain;
  let out = stepBrain(b, input(over));
  b = out.brain;
  for (let t = DT; t < seconds; t += DT) {
    out = stepBrain(b, input(over));
    b = out.brain;
  }
  return out;
}

/** Alert, in the player's room, at `d` metres directly ahead. */
function alertAt(d: number, over: Partial<BrainInput> = {}) {
  const seed = stepBrain(makeBrain(), input()).brain;
  return { brain: seed, over: { player: { x: 0, z: d, room: 3 }, ...over } };
}

describe('stepBrain — aggro (carried over from the predecessor spec)', () => {
  it('notices a player in front, in the same room, in range', () => {
    const out = stepBrain(makeBrain(), input());
    expect(out.brain.alert).toBe(true);
    expect(out.brain.state).toBe('pursue');
  });

  it('does not notice a player behind it', () => {
    const out = stepBrain(makeBrain(), input({ player: { x: 0, z: -4, room: 3 } }));
    expect(out.brain.alert).toBe(false);
    expect(out.brain.state).toBe('idle');
    expect(out.target).toBeNull();
  });

  it('does not notice a player in another room', () => {
    expect(stepBrain(makeBrain(), input({ player: { x: 0, z: 4, room: 2 } })).brain.alert)
      .toBe(false);
  });

  it('does not notice a player past noticeRange', () => {
    const far = BRAIN_TUNING.noticeRange + 1;
    expect(stepBrain(makeBrain(), input({ player: { x: 0, z: far, room: 3 } })).brain.alert)
      .toBe(false);
  });

  it('a shot in the room turns heads regardless of the cone', () => {
    const out = stepBrain(
      makeBrain(), input({ player: { x: 0, z: -4, room: 3 }, alerted: true }),
    );
    expect(out.brain.alert).toBe(true);
  });

  it('keeps the lock while the player is briefly out of the room', () => {
    const seed = stepBrain(makeBrain(), input()).brain;
    const out = run(seed, { player: { x: 0, z: 4, room: 9 } }, BRAIN_TUNING.loseGrace - 0.5);
    expect(out.brain.alert).toBe(true);
  });

  it('gives up past the grace, and goes idle', () => {
    const seed = stepBrain(makeBrain(), input()).brain;
    const out = run(seed, { player: { x: 0, z: 4, room: 9 } }, BRAIN_TUNING.loseGrace + 0.5);
    expect(out.brain.alert).toBe(false);
    expect(out.brain.state).toBe('idle');
    expect(out.target).toBeNull();
  });
});

describe('stepBrain — the ring states', () => {
  it('pursues while further out than engageRange', () => {
    const { brain, over } = alertAt(BRAIN_TUNING.engageRange + 1);
    const out = stepBrain(brain, input(over));
    expect(out.brain.state).toBe('pursue');
    expect(out.halt).toBe(false);
    expect(out.engaged).toBe(false);
  });

  it('encircles inside engageRange without a token', () => {
    const { brain, over } = alertAt(2.0);
    const out = stepBrain(brain, input({ ...over, hasToken: false }));
    expect(out.brain.state).toBe('encircle');
    expect(out.engaged).toBe(false);
    expect(out.target).not.toBeNull();
  });

  it('engages inside engageRange with a token', () => {
    const { brain, over } = alertAt(2.0);
    const out = stepBrain(brain, input({ ...over, hasToken: true }));
    expect(out.brain.state).toBe('engage');
    expect(out.engaged).toBe(true);
  });

  it('an encircler holds outerRadius, not the player', () => {
    const { brain, over } = alertAt(2.0);
    const out = stepBrain(brain, input({ ...over, hasToken: false }));
    const t = out.target!;
    const p = over.player!;   // measured from the player alertAt actually moved
    expect(Math.hypot(t[0] - p.x, t[2] - p.z)).toBeCloseTo(BRAIN_TUNING.outerRadius, 6);
  });

  it('an engager walks at the PLAYER, not at a standoff point', () => {
    // The predecessor's bug: a target at meleeRadius plus stepWander's 0.4 m
    // arrive band parks the body outside meleeRadius, so it never engages.
    const { brain, over } = alertAt(2.0);
    const out = stepBrain(brain, input({ ...over, hasToken: true }));
    expect(out.target).toEqual([0, 0, 2.0]);
  });

  it('drift rotates the encircle target tangentially', () => {
    const { brain, over } = alertAt(2.0);
    const still = stepBrain(brain, input({ ...over, hasToken: false, drift: 0 })).target!;
    const moved = stepBrain(brain, input({ ...over, hasToken: false, drift: 1 })).target!;
    const p = over.player!;   // both measured from the player alertAt actually moved
    expect(moved).not.toEqual(still);
    // Same radius, different bearing: it slides around the ring.
    expect(Math.hypot(moved[0] - p.x, moved[2] - p.z))
      .toBeCloseTo(Math.hypot(still[0] - p.x, still[2] - p.z), 6);
  });

  it('falls back to pursue past releaseRange (hysteresis)', () => {
    const { brain, over } = alertAt(2.0);
    const engaged = stepBrain(brain, input({ ...over, hasToken: true })).brain;
    const mid = (BRAIN_TUNING.engageRange + BRAIN_TUNING.releaseRange) / 2;
    const held = stepBrain(engaged, input({
      player: { x: 0, z: mid, room: 3 }, hasToken: true,
    }));
    expect(held.brain.state).toBe('engage');
    const gone = stepBrain(held.brain, input({
      player: { x: 0, z: BRAIN_TUNING.releaseRange + 0.5, room: 3 }, hasToken: true,
    }));
    expect(gone.brain.state).toBe('pursue');
  });
});

describe('stepBrain — the swing', () => {
  const close = { player: { x: 0, z: BRAIN_TUNING.meleeRadius - 0.05, room: 3 }, hasToken: true };

  it('attacks at meleeRadius with a token and no cooldown', () => {
    const { brain } = alertAt(2.0);
    const out = stepBrain(brain, input(close));
    expect(out.brain.state).toBe('attack');
    expect(out.halt).toBe(true);
    expect(out.committed).toBe(true);
    expect(out.attack).toEqual({ phase: 0, side: out.brain.side });
  });

  it('runs the swing over swingSec, then recovers and flips the arm', () => {
    const { brain } = alertAt(2.0);
    let out = stepBrain(brain, input(close));
    const firstSide = out.attack!.side;
    let b = out.brain;
    for (let i = 0; i < Math.ceil(BRAIN_TUNING.swingSec / DT) + 2; i++) {
      out = stepBrain(b, input(close));
      b = out.brain;
    }
    expect(b.state).toBe('recover');
    expect(b.cooldown).toBeGreaterThan(0);
    expect(b.side).not.toBe(firstSide);
  });

  it('a committed swing reports committed and finishes after the token is gone', () => {
    const { brain } = alertAt(2.0);
    const swinging = stepBrain(brain, input(close)).brain;
    const out = stepBrain(swinging, input({ ...close, hasToken: false }));
    expect(out.brain.state).toBe('attack');
    expect(out.committed).toBe(true);
  });

  it('recover holds position rather than shuffling in', () => {
    const { brain } = alertAt(2.0);
    let out = stepBrain(brain, input(close));
    let b = out.brain;
    for (let i = 0; i < Math.ceil(BRAIN_TUNING.swingSec / DT) + 2; i++) {
      out = stepBrain(b, input(close)); b = out.brain;
    }
    expect(b.state).toBe('recover');
    expect(out.halt).toBe(true);
    expect(out.engaged).toBe(true);
  });

  it('a revoked token drops a recovering body back to encircle', () => {
    const { brain } = alertAt(2.0);
    let out = stepBrain(brain, input(close));
    let b = out.brain;
    for (let i = 0; i < Math.ceil(BRAIN_TUNING.swingSec / DT) + 2; i++) {
      out = stepBrain(b, input(close)); b = out.brain;
    }
    expect(b.state).toBe('recover');
    const dropped = stepBrain(b, input({ ...close, hasToken: false }));
    expect(dropped.brain.state).toBe('encircle');
  });
});

describe('stepBrain — stagger', () => {
  it('a blast forces stagger from every other state', () => {
    const states: Brain['state'][] = [];
    const seeds: Brain[] = [];
    // idle
    seeds.push(makeBrain());
    // pursue
    seeds.push(stepBrain(makeBrain(), input()).brain);
    // encircle / engage / attack / recover
    const { brain } = alertAt(2.0);
    seeds.push(stepBrain(brain, input({ player: { x: 0, z: 2, room: 3 } })).brain);
    seeds.push(stepBrain(brain, input({ player: { x: 0, z: 2, room: 3 }, hasToken: true })).brain);
    const close = { player: { x: 0, z: 0.9, room: 3 }, hasToken: true };
    const swinging = stepBrain(brain, input(close)).brain;
    seeds.push(swinging);
    let b = swinging;
    let out = stepBrain(b, input(close));
    for (let i = 0; i < Math.ceil(BRAIN_TUNING.swingSec / DT) + 2; i++) {
      out = stepBrain(b, input(close)); b = out.brain;
    }
    seeds.push(b);
    for (const s of seeds) {
      const hit = stepBrain(s, input({ blasted: true }));
      states.push(hit.brain.state);
      expect(hit.halt).toBe(true);
      // A staggering body must not keep a melee slot it cannot use.
      expect(hit.committed).toBe(false);
      expect(hit.engaged).toBe(false);
    }
    expect(states.every(s => s === 'stagger')).toBe(true);
  });

  it('holds for blastHoldSec then resumes the chase', () => {
    const seed = stepBrain(makeBrain(), input()).brain;
    const hit = stepBrain(seed, input({ blasted: true })).brain;
    const out = run(hit, {}, BRAIN_TUNING.blastHoldSec + 0.1);
    expect(out.brain.state).not.toBe('stagger');
    expect(out.brain.alert).toBe(true);
  });

  it('a blast cancels a swing in flight — the lurch outranks the hook', () => {
    const { brain } = alertAt(2.0);
    const swinging = stepBrain(
      brain, input({ player: { x: 0, z: 0.9, room: 3 }, hasToken: true }),
    ).brain;
    expect(swinging.state).toBe('attack');
    const hit = stepBrain(swinging, input({ blasted: true }));
    expect(hit.brain.state).toBe('stagger');
    expect(hit.attack).toBeNull();
    expect(hit.brain.swingT).toBe(0);
  });
});
