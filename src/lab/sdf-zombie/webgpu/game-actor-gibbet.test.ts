// The gibbet through the GAME actor (createZombieActor), not just its mind: the squirt has to reach onFire from the
// sac's drip (MotionProfile.spit), and the stab has to land as a melee contact. The mind-level tests
// (hound-attack.test.ts) passed while, in the game, no glob ever left the sac.
import { describe, it, expect } from 'vitest';
import src from '../characters/gibbet.blob?raw';
import { parseBlob } from '../blob-parse';
import { compileBlob, compileFace } from '../blob-compile';
import { buildBody } from '../build-body';
import { createZombieActor } from './game-actor';
import { makeGibbetMind } from './enemy-mind';
import { GIBBET_PROFILE } from '../motion-profile';
import type { SwingVariant } from '../attack';
import type { Vec3 } from '../types';

const doc = parseBlob(src);
const body = buildBody(compileBlob(doc, compileFace(doc)));
function gibbet(onFire: (s: { origin: Vec3; direction: Vec3 }) => void, onMeleeContact?: (e: { variant: SwingVariant }) => void) {
  return createZombieActor({
    id: 1, room: 1, seed: 42, start: [0, 0, 0],
    bounds: { minX: -8, maxX: 8, minZ: -8, maxZ: 8 }, furniture: [],
    body,
    view: { setRootShift() {}, update() {}, setHeadRotation() {}, setTime() {} } as any,
    profile: GIBBET_PROFILE, mind: makeGibbetMind(), onFire,
    ...(onMeleeContact ? { onMeleeContact } : {}),
  });
}

describe('gibbet actor (game path)', () => {
  it('squirts at a player 6 m off: onFire fires from low under the frame (the sac\'s drip)', () => {
    const shots: Vec3[] = [];
    const a = gibbet(({ origin }) => shots.push(origin));
    const states = new Set<string>();
    for (let i = 0; i < 400; i++) {
      a.setRingInput(true, 0);
      a.setBrainInput({ x: 0, z: 6, room: 1 }, true);
      a.step(1 / 60);
      states.add(a.debug().state);
    }
    expect([...states]).toContain('squirt');
    expect(shots.length).toBeGreaterThanOrEqual(1);
    expect(shots[0]![1], 'from the drip, low under the frame').toBeLessThan(0.45);
  });
});
