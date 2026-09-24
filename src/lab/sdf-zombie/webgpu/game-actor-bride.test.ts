// src/lab/sdf-zombie/webgpu/game-actor-bride.test.ts
//
// The bride on the GAME path (game-actor.ts), not the lab's stepActorMotion:
// the game re-seats the held prop on the solved hand and never pinned tips,
// so the lab's fist-to-grip numbers (NOTES Task 8/9) did not carry over.
// Task 11 measured 3.1 cm at the guard and 4.8 cm mid-swing before the fix.
import { describe, expect, it } from 'vitest';
import { buildBody } from '../build-body';
import { compileBlob } from '../blob-compile';
import { parseBlob } from '../blob-parse';
import brideSrc from '../characters/bride.blob?raw';
import { BRIDE_PROFILE, runWeight } from '../motion-profile';
import { BURN_BEHAVIOUR } from '../burn-behaviour';
import { makeSwordMind } from './enemy-mind';
import { createZombieActor } from './game-actor';
import type { SwingVariant } from '../attack';

const body = buildBody(compileBlob(parseBlob(brideSrc)));
function bride(onMeleeContact?: (e: { variant: SwingVariant }) => void) {
  return createZombieActor({
    id: 1, room: 1, seed: 42, start: [0, 0, 0],
    bounds: { minX: -6, maxX: 6, minZ: -6, maxZ: 6 }, furniture: [],
    body,
    view: { setRootShift() {}, update() {}, setHeadRotation() {}, setTime() {} } as any,
    profile: BRIDE_PROFILE, mind: makeSwordMind(),
    ...(onMeleeContact ? { onMeleeContact } : {}),
  });
}
const CM3 = 0.03;

describe('bride actor (game path)', () => {
  it('holds the guard with the fist on the grip (solved and seated)', () => {
    const a = bride();
    for (let i = 0; i < 120; i++) a.step(1 / 60);
    let seated = 0, authored = 0;
    for (let i = 0; i < 60; i++) {
      a.step(1 / 60);
      const d = a.debug();
      expect(d.carry).toBe('swordGuard');
      seated = Math.max(seated, d.fistGrip!);
      authored = Math.max(authored, d.fistGripAuthored!);
    }
    expect(seated).toBeLessThan(0.005);
    expect(authored).toBeLessThan(CM3);
  });

  it('fights: swings, hits the player, and the fist stays on the grip through every swing', () => {
    const variants = new Set<SwingVariant>();
    const a = bride(({ variant }) => variants.add(variant));
    let seated = 0, authored = 0, attackFrames = 0;
    // The player 5 m off: she walks in (so she faces him), then swings.
    for (let i = 0; i < 900; i++) {
      a.setRingInput(true, 0);
      a.setBrainInput({ x: 0, z: 5, room: 1 }, true);
      a.step(1 / 60);
      const d = a.debug();
      // EVERY frame, the walk-in and her turns included: before the carry
      // pinned the arms, the solved hands lagged their targets by up to 14 cm
      // while she turned or set off (game gate, first run).
      seated = Math.max(seated, d.fistGrip!);
      authored = Math.max(authored, d.fistGripAuthored!);
      if (d.state === 'attack') attackFrames++;
    }
    expect(attackFrames).toBeGreaterThan(60);
    expect(a.debug().meleeContacts).toBeGreaterThanOrEqual(1);
    expect(variants.size).toBeGreaterThanOrEqual(1);
    expect(seated).toBeLessThan(0.005);
    expect(authored).toBeLessThan(CM3);
  });

  // THE RUN-TO-SWING SNAP (Task 9 review). The track starts from the WALK
  // guard, so a swing thrown while the swordTrail run carry was live would
  // jump the pinned arms. In the game it cannot be: her wander speed never
  // reaches the run band, even at the burning-panic speed-up, so the carry
  // when any swing starts is always the guard. If this fails, make
  // swordCarryAt start from the carry pose at swing start instead.
  it('never runs in the game, so a swing always starts from the guard', () => {
    const fastest = BRIDE_PROFILE.cruise * Math.max(BURN_BEHAVIOUR.zombieSpeed, 1);
    expect(runWeight(BRIDE_PROFILE, fastest)).toBe(0);
  });
});
