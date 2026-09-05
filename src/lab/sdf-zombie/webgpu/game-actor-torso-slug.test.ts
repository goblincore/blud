import { describe, expect, it } from 'vitest';
import { buildBody } from '../build-body';
import { parseBlob } from '../blob-parse';
import { compileBlob, compileFace } from '../blob-compile';
import zombieSource from '../characters/zombie.blob?raw';
import { createZombieActor } from './game-actor';
import { sdBody } from '../validate';
import { add, len, scale, sub } from '../vec';
import { rotateYaw } from '../gait';
import type { Vec3 } from '../types';

describe('torso slug reaction without wound clutch', () => {
  for (const warm of [0, 30, 120]) for (const x of [-0.12, 0, 0.12]) {
    it(`keeps hands outside the torso while recoiling: warm=${warm}, x=${x}`, () => {
      const doc = parseBlob(zombieSource);
      const body = buildBody(compileBlob(doc, compileFace(doc)));
      let severs = 0;
      const actor = createZombieActor({ id: 1, room: 0, body,
        view: { setRootShift() {}, setTime() {}, setHeadRotation() {},
          setWounds() {}, update() {} } as never,
        start: [0, 0, 0], seed: 0,
        bounds: { minX: -10, maxX: 10, minZ: -10, maxZ: 10 }, furniture: [],
        onSever() { severs++; },
      });
      for (let f = 0; f < warm; f++) actor.step(1 / 60);
      const pose = actor.pose();
      const dir = rotateYaw([0, 0, -1], pose.yaw);
      const origin = add(pose.pos, rotateYaw([x, 1.25, 1], pose.yaw));
      let hit: Vec3 | null = null;
      for (let d = 0; d < 2; d += 0.002) {
        const p = add(origin, scale(dir, d));
        if (sdBody(p, actor.posed()) <= 0) { hit = p; break; }
      }
      expect(hit).not.toBeNull();
      const wound = actor.hitSlug(hit!, dir)!;
      expect(body.prims[wound.primIdx]!.limb).toBe('torso');
      let sawLurch = false;
      for (let f = 0; f < 60; f++) {
        if (f) actor.step(1 / 60);
        sawLurch ||= actor.debug().staggerKind === 'lurch';
        const posed = actor.posed();
        // Preserve indices/cluster ranges; exclude arms from the obstacle field.
        const torso = { ...posed, bonePrims: [], prims: posed.prims.map(p =>
          p.limb === 'torso' ? p : { ...p, dead: true }) };
        const hands = posed.prims.filter(p => p.bone?.startsWith('foreArm') &&
          len(sub(p.b, p.a)) < 0.001 && !p.dead);
        expect(hands).toHaveLength(2);
        for (const hand of hands) {
          expect(sdBody(hand.a, torso) - hand.radius, `${hand.bone}, frame ${f}`)
            .toBeGreaterThanOrEqual(-0.003);
        }
      }
      expect(sawLurch).toBe(true);
      expect(len(sub(actor.pose().pos, pose.pos))).toBeGreaterThan(0.1);
      expect(actor.wounds()).toHaveLength(1);
      expect(severs).toBe(0);
    });
  }
});
