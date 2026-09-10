import { describe, expect, it } from 'vitest';
import { buildBody } from '../build-body';
import { parseBlob } from '../blob-parse';
import { compileBlob, compileFace } from '../blob-compile';
import zombieSource from '../characters/zombie.blob?raw';
import { createZombieActor } from './game-actor';
import { cross, dot, len, normalize, qFromTo, qRotate, sub } from '../vec';
import { rotateYaw } from '../gait';
import type { BuildResult } from '../build-body';

// Stored surface hits from the investigation, real projectile paths, no renderer/GPU.
// Removing the immediate-hit stop or dropping its metadata during stepping must fail.
describe('projectile elbow upload', () => {
  const cases = [
    { side: 'l', kind: 'pellet', warm: 0,
      hit: [0.33685037806209916, 1.0573099639573043, 0.04580139988875679], dir: [-1, 0, 0] },
    { side: 'l', kind: 'pellet', warm: 30,
      hit: [-0.20543623562493135, 1.2845481281177504, 0.6140696090132045], dir: [-1, 0, 0] },
    { side: 'l', kind: 'slug', warm: 30,
      hit: [-0.27643623562493097, 1.2845481281177504, 0.6780696090132042], dir: [0, 0, -1] },
    { side: 'r', kind: 'pellet', warm: 30,
      hit: [-0.6466685295430288, 1.2574807391188823, 0.11720865180014345], dir: [0, 0, 1] },
    { side: 'r', kind: 'slug', warm: 30,
      hit: [-0.7196685295430283, 1.2574807391188823, 0.17820865180014306], dir: [1, 0, 0] },
    { side: 'l', kind: 'slug', warm: 30,
      hit: [-0.3413607557779469, 1.2057104940372008, 0.6768538584807906], dir: [0, 1, 0] },
    { side: 'r', kind: 'slug', warm: 30,
      hit: [-0.715432988648778, 1.1670090291863195, 0.229596871651776], dir: [0, 1, 0] },
  ] as const;
  for (const c of cases) for (const dt of [1 / 30, 1 / 60, 1 / 144]) {
    it(`${c.kind} ${c.side}, warm=${c.warm}, dt=${dt}: every upload respects the moving elbow frame`, () => {
      const doc = parseBlob(zombieSource);
      const body = buildBody(compileBlob(doc, compileFace(doc)));
      let latest: BuildResult = body, severs = 0;
      const actor = createZombieActor({ id: 1, room: 0, body,
        view: { setRootShift() {}, setTime() {}, setHeadRotation() {}, setWounds() {},
          update(posed: BuildResult) { latest = posed; } } as never,
        start: [0, 0, 0], seed: 0,
        bounds: { minX: -10, maxX: 10, minZ: -10, maxZ: 10 }, furniture: [],
        onSever() { severs++; },
      });
      const upper = body.prims.findIndex(p => p.bone === `upperArm.${c.side}`);
      const fore = body.prims.findIndex(p => p.bone === `foreArm.${c.side}` && len(sub(p.b, p.a)) > 0.01);
      // The zombie faces +Z. Rest-arm sideways splay is NOT elbow flexion.
      // This oracle deliberately does not read the solver's stored pole.
      const normal = normalize(cross(sub(body.prims[upper]!.b, body.prims[upper]!.a),
        [0, 0, 1]));
      const check = () => {
        const a = latest.prims[upper]!, b = latest.prims[fore]!;
        expect(dot(normalize(sub(a.b, a.a)), normalize(sub(b.b, b.a))))
          .toBeGreaterThanOrEqual(Math.cos(150 * Math.PI / 180) - 1e-6);
        const yaw = actor.pose().yaw;
        const restUpper = normalize(sub(body.prims[upper]!.b, body.prims[upper]!.a));
        const swing = qFromTo(rotateYaw(restUpper, yaw), normalize(sub(a.b, a.a)));
        const movingNormal = qRotate(swing, rotateYaw(normal, yaw));
        // ~3° of slack since the 2026-09-09 shoulder socket clamp: the clamp
        // deliberately trims shoulder targets past 0.05 m, and the verlet
        // solve now settles up to ~1.2° past straight at the elbow (measured
        // −0.021 dot). The regression this pins is a construction bug that
        // ignored the moving frame — that read ~−1, whole-plane flipped.
        expect(dot(cross(sub(a.b, a.a), sub(b.b, b.a)), movingNormal))
          .toBeGreaterThanOrEqual(-0.05);
      };
      for (let f = 0; f < c.warm; f++) actor.step(1 / 60);
      const wound = c.kind === 'slug' ? actor.hitSlug(c.hit, c.dir) : actor.hit(c.hit, c.dir);
      expect(body.prims[wound!.primIdx]!.limb).toBe(c.side === 'l' ? 'armL' : 'armR');
      check();
      for (let f = 0; f < 12; f++) { actor.step(dt); check(); }
      // The stored surface hits were captured pre-clamp; the clamp shifts the
      // arm a few centimetres, so the borderline slug-l hit now lands in a
      // sever zone and may legitimately detach during the post-hit steps.
      // The guard here is hit ROUTING (the limb assertion above) and frame
      // tracking (check), not sever suppression.
      expect(severs).toBeLessThanOrEqual(1);
    });
  }
});
