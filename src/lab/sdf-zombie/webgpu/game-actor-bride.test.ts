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
import { makeMotionJoints } from '../motion';
import type { SwingVariant } from '../attack';
import type { Vec3 } from '../types';
import { len, sub } from '../vec';
import { rotateYaw } from '../gait';

const body = buildBody(compileBlob(parseBlob(brideSrc)));
function bride(onMeleeContact?: (e: { variant: SwingVariant }) => void, releaseProp?: () => void) {
  return createZombieActor({
    id: 1, room: 1, seed: 42, start: [0, 0, 0],
    bounds: { minX: -6, maxX: 6, minZ: -6, maxZ: 6 }, furniture: [],
    body,
    view: { setRootShift() {}, update() {}, setHeadRotation() {}, setTime() {} } as any,
    profile: BRIDE_PROFILE, mind: makeSwordMind(),
    ...(onMeleeContact ? { onMeleeContact } : {}),
    ...(releaseProp ? { character: { releaseProp } as any } : {}),
  });
}
const J = makeMotionJoints(body, bindRigRest())!.index;
function bindRigRest() { return createZombieActor({
  id: 0, room: 1, seed: 1, start: [0, 0, 0], bounds: { minX: -1, maxX: 1, minZ: -1, maxZ: 1 }, furniture: [], body,
  view: { setRootShift() {}, update() {}, setHeadRotation() {}, setTime() {} } as any, profile: BRIDE_PROFILE,
}).boundRig().rig.restPose; }
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

  // THE STOCKING TUBE (playtest 2026-09-25): an ivory tube ~1 m long from
  // her pelvis to a knee. The stocking band and the thigh stigmata bound
  // their upper ends to the PELVIS root point (nearest joint), not the
  // thigh; the lunge surges her root 1.2 m over planted feet, the hips part
  // from the pelvis, and those prims stretched pelvis->knee (0.23 -> 1.1 m).
  // Every live prim of the bride must keep its rest length through
  // walks, swings and lunges. Players 2.5-3 m off put her in the lunge band.
  it.each([2.5, 3.0])('no prim stretches through her fights (player %s m off, lunges)', pz => {
    const game = buildBody(compileBlob(parseBlob(brideSrc)));
    const a = createZombieActor({
      id: 1, room: 1, seed: 42, start: [0, 0, 0],
      bounds: { minX: -6, maxX: 6, minZ: -6, maxZ: 6 }, furniture: [], body: game,
      view: { setRootShift() {}, update() {}, setHeadRotation() {}, setTime() {} } as any,
      profile: BRIDE_PROFILE, mind: makeSwordMind(),
    });
    const rest = game.prims.map(p => Math.hypot(p.a[0] - p.b[0], p.a[1] - p.b[1], p.a[2] - p.b[2]));
    let worst = 0, worstAt = '', lunges = 0;
    for (let f = 0; f < 900; f++) {
      a.setRingInput(true, 0);
      a.setBrainInput({ x: 0, z: pz, room: 1 }, true);
      a.step(1 / 60);
      if (a.debug().state === 'attack' && a.debug().variant === 'lunge') lunges++;
      a.posed().prims.forEach((p, i) => {
        const l = Math.hypot(p.a[0] - p.b[0], p.a[1] - p.b[1], p.a[2] - p.b[2]) - rest[i]!;
        if (l > worst) { worst = l; worstAt = `prim ${i} ${game.prims[i]!.bone} line ${game.prims[i]!.src}`; }
      });
    }
    expect(lunges).toBeGreaterThan(0);
    expect(worst, worstAt).toBeLessThan(0.05);
  });

  // THE LUNGE DRAG (2026-09-25, the mechanism under the stocking tube): the
  // lunge surges her root 1.2 m in ~0.25 s while both feet sit in stance;
  // the plants never released, so the stranded feet dragged the hips back
  // off the pelvis — 0.35 m off their pelvis-relative rest (radially 0.27 m)
  // mid-lunge, and 0.22 m HELD through every later swing until she walked
  // again, the legs stretched past full length. Now her stance plants slide
  // within reach while she lunges (MotionConfig.plantReach).
  // Walking levels, same metric (her pursue walk / idle wander): 0.144 /
  // 0.142 m offset, 0.064 / 0.084 m radial. The pelvis leads the hips by
  // design in every swing (attack.ts rootOffset; sweep 0.124), so the bound
  // is "no worse than her walk", not zero.
  it.each([2.5, 3.0])('her legs follow her through a lunge (player %s m off)', pz => {
    const game = buildBody(compileBlob(parseBlob(brideSrc)));
    const a = createZombieActor({
      id: 1, room: 1, seed: 42, start: [0, 0, 0],
      bounds: { minX: -6, maxX: 6, minZ: -6, maxZ: 6 }, furniture: [], body: game,
      view: { setRootShift() {}, update() {}, setHeadRotation() {}, setTime() {} } as any,
      profile: BRIDE_PROFILE, mind: makeSwordMind(),
    });
    const rest = a.boundRig().rig.restPose;
    const MJ = makeMotionJoints(game, rest)!, K = MJ.index;
    const legLen = Math.max(MJ.leg.L[0] + MJ.leg.L[1], MJ.leg.R[0] + MJ.leg.R[1]);
    // Hip displacement off its rest offset from the pelvis, turned by the yaw;
    // and the plain change in hip-pelvis distance (yaw-free).
    const sep = (P: readonly Vec3[], h: number, yaw: number) =>
      len(sub(sub(P[h]!, P[K.pelvis]!), rotateYaw(sub(rest[h]!, rest[K.pelvis]!), yaw)));
    const radial = (P: readonly Vec3[], h: number) =>
      Math.abs(len(sub(P[h]!, P[K.pelvis]!)) - len(sub(rest[h]!, rest[K.pelvis]!)));
    let lunges = 0, sinceLunge = Infinity, during = 0, duringRadial = 0, after = 0, reach = 0;
    const start = a.pose().pos;
    let travelled = 0;
    for (let f = 0; f < 600; f++) {
      a.setRingInput(true, 0);
      a.setBrainInput({ x: 0, z: pz, room: 1 }, true);
      a.step(1 / 60);
      const d = a.debug();
      const lunging = d.state === 'attack' && d.variant === 'lunge';
      if (lunging) { lunges++; sinceLunge = 0; } else sinceLunge++;
      if (sinceLunge > 60) continue; // the lunge and the second after it
      const P = a.boundRig().rig.points.map(p => p.pos);
      const yaw = a.pose().yaw;
      const s = Math.max(sep(P, K.hipL, yaw), sep(P, K.hipR, yaw));
      if (lunging) {
        during = Math.max(during, s);
        duringRadial = Math.max(duringRadial, radial(P, K.hipL), radial(P, K.hipR));
        travelled = Math.max(travelled, Math.hypot(a.pose().pos[0] - start[0], a.pose().pos[2] - start[2]));
      } else if (sinceLunge > 15) after = Math.max(after, s); // settled
      reach = Math.max(reach, len(sub(P[K.footL]!, P[K.hipL]!)) / legLen, len(sub(P[K.footR]!, P[K.hipR]!)) / legLen);
    }
    expect(lunges).toBeGreaterThan(0);
    expect(travelled).toBeGreaterThan(1.1); // the lunge still carries her 1.2 m (reach unchanged)
    expect(during).toBeLessThan(0.15); // was 0.35
    expect(duringRadial).toBeLessThan(0.09); // was 0.27
    expect(after).toBeLessThan(0.03); // was 0.22, held
    expect(reach).toBeLessThan(1.005); // feet within reach of the hips (was 1.01: stretched)
  });

  // SEVERED ARMS (Task 11 review). Pins for the whole two-handed carry must
  // never hold a missing arm's joints to guard targets; without her sword arm
  // she drops the sword, the carry goes, and her swings stop landing.
  it.each(['armR', 'armL'] as const)('without %s: no pin on the missing arm, and she keeps stepping', limb => {
    let released = 0, hits = 0;
    const a = bride(() => hits++, () => released++);
    for (let i = 0; i < 60; i++) a.step(1 / 60);
    expect(a.debugSever(limb)).toBe(true);
    const gone = limb === 'armR' ? [J.elbowR, J.handR, J.handTipR] : [J.elbowL, J.handL, J.handTipL];
    let fights = 0;
    for (let i = 0; i < 600; i++) {
      a.setRingInput(true, 0);
      a.setBrainInput({ x: 0, z: 5, room: 1 }, true);
      expect(() => a.step(1 / 60)).not.toThrow();
      const f = a.motionFrame()!;
      for (const g of gone) expect(f.posePins ?? []).not.toContain(g);
      if (a.debug().state === 'attack') fights++;
    }
    expect(fights).toBeGreaterThan(0);
    if (limb === 'armR') {
      // Drops the sword: released once, no carry, no seated fist, no hits.
      expect(released).toBe(1);
      expect(a.motionFrame()!.gun).toBeNull();
      expect(a.debug().carry).toBeNull();
      expect(a.debug().fistGrip).toBeNull();
      expect(hits).toBe(0);
    } else {
      // One-handed: she keeps the sword, the right arm stays pinned, and she still hits.
      expect(released).toBe(0);
      expect(a.debug().carry).toBe('swordGuard');
      expect(a.motionFrame()!.posePins ?? []).toContain(J.handR);
      expect(hits).toBeGreaterThan(0);
    }
  });
});
