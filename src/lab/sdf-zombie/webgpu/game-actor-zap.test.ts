// src/lab/sdf-zombie/webgpu/game-actor-zap.test.ts
//
// The zap on a game actor (game-actor.ts beginZap / setArc): the real actor with a stub view, on
// game-actor-melt.test.ts's pattern.
import { describe, expect, it } from 'vitest';
import { buildBody, DEFAULT_BUILD_OPTS } from '../build-body';
import { parseBlob } from '../blob-parse';
import { compileBlob, compileFace } from '../blob-compile';
import { translateBody } from '../translate';
import zombieBlobSrc from '../characters/zombie.blob?raw';
import { createZombieActor } from './game-actor';
import { ROOMS, wanderBounds, spawnPoints } from './game-level';
import { ZAP } from '../zap';
import { ZAP_TIER_DEFAULT } from '../motion-profile';
import type { Vec3 } from '../types';

function actor() {
  const view = {
    setRootShift: () => {}, setHeadRotation: () => {}, setTime: () => {},
    update: () => {}, setMelt: () => {}, setPackBones: () => {}, setBonesBare: () => {},
  };
  const doc = parseBlob(zombieBlobSrc);
  const built = buildBody(compileBlob(doc, compileFace(doc)), DEFAULT_BUILD_OPTS, {});
  const room = ROOMS[0]!;
  const start = spawnPoints(room)[0]! as Vec3;
  const a = createZombieActor({
    id: 1, room: room.id, body: translateBody(built, start), view: view as never,
    start, seed: 1337, bounds: wanderBounds(room), furniture: [],
  });
  for (let i = 0; i < 30; i++) a.step(1 / 60);
  return a;
}
const run = (a: ReturnType<typeof actor>, sec: number) => { for (let i = 0; i < Math.round(sec * 60); i++) a.step(1 / 60); };
const dist = (p: Vec3, q: Vec3) => Math.hypot(p[0] - q[0], p[2] - q[2]);

describe('a game actor under the tesla arc', () => {
  it('stands rigid where it is, glowing, for as long as the arc is on it', () => {
    const a = actor();
    expect(a.zapPhase()).toBe('none');
    expect(a.zapLook()).toBeNull();
    expect(a.beginZap()).toBe(true);
    a.setArc(true);
    run(a, 0.2);
    const at = a.pose().pos;   // a fresh copy each call
    expect(a.zapPhase()).toBe('zapped');
    expect(a.zapping()).toBe(true);
    expect(a.zapLook()!.glow).toBeGreaterThan(0.5);
    run(a, 0.8);
    expect(dist(a.pose().pos as Vec3, at)).toBeLessThan(0.05);
    expect(a.motionFrame()?.collapsed).toBe(false);
  });

  it('recovers when the arc leaves, keeping no glow', () => {
    const a = actor();
    a.beginZap(); a.setArc(true);
    run(a, 0.5);
    a.setArc(false);
    run(a, 0.1);
    expect(a.zapPhase()).toBe('recovering');
    run(a, ZAP_TIER_DEFAULT.recoverSec + 0.2);
    expect(a.zapPhase()).toBe('none');
    expect(a.zapLook()).toBeNull();
    expect(a.motionFrame()?.collapsed).toBe(false);
  });

  it('cooks through, holds as a charred statue, then dies', () => {
    const a = actor();
    a.beginZap(); a.setArc(true);
    run(a, ZAP_TIER_DEFAULT.cookSec[1] + 0.1);
    expect(a.zapPhase()).toBe('statue');
    expect(a.zapLook()).toEqual({ glow: 0, invert: false, char: 1 });
    expect(a.motionFrame()?.collapsed).toBe(false);
    expect(a.beginZap()).toBe(false);           // already a statue
    run(a, ZAP.statueSec + 1.5);
    expect(a.zapPhase()).toBe('none');
    expect(a.motionFrame()?.collapsed).toBe(true);
    expect(a.zapLook()).toEqual({ glow: 0, invert: false, char: 1 });   // the char stays on the corpse
    expect(a.beginZap()).toBe(false);           // a corpse
  });

  it('refuses a melting body', () => {
    const a = actor();
    expect(a.beginMelt()).toBe(true);
    expect(a.beginZap()).toBe(false);
  });

  it('keeps the char it had when the zap ends short of a full cook', () => {
    const a = actor();
    a.beginZap(); a.setArc(true);
    run(a, ZAP_TIER_DEFAULT.cookSec[0] * 0.9);
    const char = a.zapLook()!.char;
    expect(char).toBeGreaterThan(0);
    a.setArc(false);
    run(a, 1.5);
    expect(a.zapPhase()).toBe('none');
    expect(a.zapLook()).toEqual({ glow: 0, invert: false, char });
  });

  it('holds a burning body still, and its panic resumes when the arc leaves', () => {
    const a = actor();
    a.setBurning(true);
    run(a, 0.5);
    expect(a.burnPhase()).toBe('panic');
    a.beginZap(); a.setArc(true);
    run(a, 0.2);
    const at = a.pose().pos;   // a fresh copy each call
    run(a, 0.8);
    expect(a.burnPhase()).toBe('panic');
    expect(dist(a.pose().pos as Vec3, at)).toBeLessThan(0.05);
    a.setArc(false);
    run(a, ZAP_TIER_DEFAULT.recoverSec + 0.2);
    expect(a.zapPhase()).toBe('none');
    expect(a.burnPhase()).toBe('panic');
    run(a, 0.5);
    expect(dist(a.pose().pos as Vec3, at)).toBeGreaterThan(0.2);   // running again
  });
});
