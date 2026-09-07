// src/lab/sdf-zombie/webgpu/game-player-body.test.ts
//
// Gates for the isometric experiment's player body. The drive must satisfy
// two contracts at once:
//
// 1. THE CAPSULE IS THE TRUTH — the posed body lands on the commanded feet
//    position every frame (the whole point of driving the root directly;
//    a drift here is a goblin walking away from where you collide).
// 2. THE CARRY IS THE SOLDIER'S — the same carry table that holds the
//    soldier's shotgun holds the goblin's: 'low' at rest, 'aim' while the
//    fire hold runs, and a live GunPose on the frame so the prop can ride
//    the right forearm.
//
// Runs fully offline: only the view and character are stubbed (four view
// methods, one pose call), the motion pipeline is the real one — the same
// shape as game-actor.test.ts.

import { describe, expect, it } from 'vitest';
import { buildBody, DEFAULT_BUILD_OPTS } from '../build-body';
import { parseBlob } from '../blob-parse';
import { compileBlob, compileFace } from '../blob-compile';
import { translateBody } from '../translate';
import goblinBlobSrc from '../characters/goblin.blob?raw';
import { createPlayerBodyDrive, type PlayerBodyCmd } from './game-player-body';
import { GOBLIN_GUN_PROFILE } from '../motion-profile';
import { FIRE } from '../motion';
import type { Vec3 } from '../types';
import type { CharacterView } from './character-view';

const stubView = () => {
  const calls = { roots: [] as { x: number; z: number; yaw: number }[], updates: 0 };
  return {
    calls,
    setRootShift(x: number, z: number, yaw: number) { calls.roots.push({ x, z, yaw }); },
    update() { calls.updates++; },
    setHeadRotation() {},
    setTime() {},
  };
};

const stubCharacter = () => {
  const calls: { yaw: number; sinceFire: number; gun: unknown }[] = [];
  const character = {
    pose(_body: unknown, _bound: unknown, yaw: number, sinceFire: number, frame: unknown) {
      const gun = frame && typeof frame === 'object' && 'gun' in frame ? frame.gun : null;
      calls.push({ yaw, sinceFire, gun });
    },
  };
  return { calls, character: character as unknown as CharacterView };
};

function buildGoblin(at: Vec3) {
  const doc = parseBlob(goblinBlobSrc);
  const built = buildBody(compileBlob(doc, compileFace(doc)), DEFAULT_BUILD_OPTS, {});
  return translateBody(built, at);
}

const cmd = (over: Partial<PlayerBodyCmd>): PlayerBodyCmd => ({
  pos: [0, 0, 0],
  yaw: 0,
  speed: 0,
  fire: false,
  ...over,
});

describe('game-player-body', () => {
  it('lands the posed body on the commanded feet position, not near it', () => {
    const at: Vec3 = [-7.4, 0, -7.4];
    const view = stubView();
    const drive = createPlayerBodyDrive({
      body: buildGoblin(at), view: view as never, character: stubCharacter().character,
      profile: GOBLIN_GUN_PROFILE, seed: 7, start: at,
    });
    // A few frames of walking at full run across the room.
    const dest: Vec3 = [-4.0, 0, -3.0];
    for (let i = 0; i < 30; i++) {
      drive.step(1 / 60, cmd({ pos: dest, yaw: 0.6, speed: 3.4 }));
    }
    const posed = drive.posed();
    const lo: number[] = [Infinity, Infinity, Infinity];
    const hi: number[] = [-Infinity, -Infinity, -Infinity];
    for (const p of posed.prims) {
      for (let i = 0; i < 3; i++) {
        lo[i] = Math.min(lo[i]!, p.a[i]!);
        hi[i] = Math.max(hi[i]!, p.a[i]!);
      }
    }
    // The BODY EXTENT is a couple of metres across (and asymmetric — the
    // carried gun reaches out front), so the real drift gate is: the body
    // WALKED (the destination sits inside the extent) and the march proxy
    // was rooted at the commanded displacement. The root shift is measured
    // from the body's own pelvis base (motion.ts), so the expected value
    // for the PROXY is destination minus spawn — the same displacement the
    // flesh was translated by at build time.
    expect(dest[0]).toBeGreaterThan(lo[0]!);
    expect(dest[0]).toBeLessThan(hi[0]!);
    expect(dest[2]).toBeGreaterThan(lo[2]!);
    expect(dest[2]).toBeLessThan(hi[2]!);
    const last = view.calls.roots.at(-1)!;
    expect(last.x).toBeCloseTo(dest[0] - at[0], 3);
    expect(last.z).toBeCloseTo(dest[2] - at[2], 3);
  });

  it('carries the gun at rest and aims while the fire hold runs', () => {
    const at: Vec3 = [4.8, 0, 4.8];
    const { calls, character } = stubCharacter();
    const drive = createPlayerBodyDrive({
      body: buildGoblin(at), view: stubView() as never, character,
      profile: GOBLIN_GUN_PROFILE, seed: 11, start: at,
    });
    drive.step(1 / 60, cmd({ pos: at, yaw: 0 }));
    // Standing with nothing fired: the low carry, gun posed, full presence.
    expect(drive.debug().carry).toBe('low');
    expect(calls.at(-1)!.gun).not.toBeNull();
    // A shot: sig.fire arms FIRE.holdSec, and the carry is 'aim' for the
    // whole hold, not just the shot frame.
    drive.step(1 / 60, cmd({ pos: at, yaw: 0, fire: true }));
    expect(drive.debug().carry).toBe('aim');
    expect(calls.at(-1)!.sinceFire).toBe(0);
    let held = 0;
    for (let t = 0; t < FIRE.holdSec; t += 1 / 60) {
      drive.step(1 / 60, cmd({ pos: at, yaw: 0 }));
      if (drive.debug().carry === 'aim') held += 1 / 60;
    }
    expect(held).toBeCloseTo(FIRE.holdSec, 1);
    // ...and back down after it.
    drive.step(1 / 60, cmd({ pos: at, yaw: 0 }));
    expect(drive.debug().carry).toBe('low');
  });

  it('feeds the marching body the applied yaw, every frame', () => {
    const at: Vec3 = [0, 0, 0];
    const view = stubView();
    const drive = createPlayerBodyDrive({
      body: buildGoblin(at), view: view as never, character: stubCharacter().character,
      profile: GOBLIN_GUN_PROFILE, seed: 3, start: at,
    });
    drive.step(1 / 60, cmd({ pos: [0, 0, 0], yaw: 2.2, speed: 3.0 }));
    // The LAST root shift of the frame carries the body's applied yaw —
    // the damped turn begins from 0 toward the commanded heading.
    const last = view.calls.roots.at(-1)!;
    expect(last.yaw).toBeGreaterThan(0);
    expect(drive.debug().bodyYaw).toBe(last.yaw);
    // A driven body turns toward its heading but must not snap: one frame
    // in, the applied yaw is strictly between.
    expect(drive.debug().bodyYaw).toBeLessThan(2.2);
  });
});
