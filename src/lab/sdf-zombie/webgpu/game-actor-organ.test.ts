// The organ through the GAME actor (createZombieActor), not just its mind: the wail has to reach onFire three times
// (the chord) from the trumpets on its back (MotionProfile.spit), and the bite has to land as a melee contact up close.
// The gibbet's lesson (game-actor-gibbet.test.ts): mind-level tests passed while no glob left the sac in the game.
import { describe, it, expect } from 'vitest';
import src from '../characters/organ.blob?raw';
import { parseBlob } from '../blob-parse';
import { compileBlob, compileFace } from '../blob-compile';
import { buildBody } from '../build-body';
import { createZombieActor } from './game-actor';
import { makeOrganMind } from './enemy-mind';
import { ORGAN_PROFILE } from '../motion-profile';
import type { SwingVariant } from '../attack';
import type { Vec3 } from '../types';

const doc = parseBlob(src);
const body = buildBody(compileBlob(doc, compileFace(doc)));
function organ(onFire: (s: { origin: Vec3; direction: Vec3 }) => void, onMeleeContact?: (e: { variant: SwingVariant }) => void) {
  return createZombieActor({
    id: 1, room: 1, seed: 42, start: [0, 0, 0],
    bounds: { minX: -12, maxX: 12, minZ: -12, maxZ: 12 }, furniture: [],
    body,
    view: { setRootShift() {}, update() {}, setHeadRotation() {}, setTime() {} } as any,
    profile: ORGAN_PROFILE, mind: makeOrganMind(), onFire,
    ...(onMeleeContact ? { onMeleeContact } : {}),
  });
}

describe('organ actor (game path)', () => {
  it('wails at a player 7 m off: three notes, from high up at the front (the trumpets over the shoulders)', () => {
    const shots: Vec3[] = [];
    const a = organ(({ origin }) => shots.push(origin));
    const states = new Set<string>();
    for (let i = 0; i < 360; i++) {
      a.setRingInput(true, 0);
      a.setBrainInput({ x: 0, z: 7, room: 1 }, true);
      a.step(1 / 60);
      states.add(a.debug().state);
    }
    expect([...states]).toContain('wail');
    expect(shots.length, 'the chord: three notes').toBeGreaterThanOrEqual(3);
    // The bells stand ~1.4 m up (the back is ~1.25 m); the wail's head throw lifts the front a little more.
    expect(shots[0]![1]).toBeGreaterThan(1.2);
  });

  it('bites a player standing at its head', () => {
    const hits: SwingVariant[] = [];
    const a = organ(() => {}, ({ variant }) => hits.push(variant));
    for (let i = 0; i < 600 && hits.length === 0; i++) {
      a.setRingInput(true, 0);
      a.setBrainInput({ x: 0, z: 1.5, room: 1 }, true);
      a.step(1 / 60);
    }
    expect(hits).toContain('bite');
  });
});
