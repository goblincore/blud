// The cultist is a SOFT target (MotionProfile.soft): the first bullet drops
// him. Owner playtest 2026-09-24: "one shot and they go down"; the zombie and
// soldier are the ones that soak hits to show off the gore.
import { describe, expect, it } from 'vitest';
import { buildBody } from '../build-body';
import { compileBlob, compileFace } from '../blob-compile';
import { parseBlob } from '../blob-parse';
import cultistSrc from '../characters/cultist.blob?raw';
import { CULTIST_PROFILE } from '../motion-profile';
import { makeSoldierMind } from './enemy-mind';
import { SMG_TUNING } from '../soldier-brain';
import { createZombieActor } from './game-actor';

const doc = parseBlob(cultistSrc);
const body = buildBody(compileBlob(doc, compileFace(doc)));

function cultist() {
  let fired = 0;
  const actor = createZombieActor({
    id: 1, room: 1, seed: 42, start: [0, 0, 0],
    bounds: { minX: -3, maxX: 3, minZ: -3, maxZ: 3 }, furniture: [],
    body,
    view: { setRootShift() {}, update() {}, setHeadRotation() {}, setTime() {} } as any,
    profile: CULTIST_PROFILE, mind: makeSoldierMind(SMG_TUNING),
    onFire: () => { fired++; },
  });
  return { actor, fired: () => fired };
}

/** One pellet into the middle of the robe's skirt. */
function shootSkirt(actor: ReturnType<typeof cultist>['actor']) {
  const p = actor.posed().prims.find(q => q.bone === 'hem' && q.shell)!;
  const at: [number, number, number] = [(p.a[0] + p.b[0]) / 2, (p.a[1] + p.b[1]) / 2, 1];
  return actor.hit(at, [0, 0, -1]);
}

describe('cultist: soft target', () => {
  it('the profile is soft', () => expect(CULTIST_PROFILE.soft).toBe(true));

  it('stays up unhit, goes down to ONE pellet and stops shooting', () => {
    const { actor, fired } = cultist();
    for (let i = 0; i < 30; i++) { actor.setBrainInput({ x: 0, z: 2.8, room: 1 }, true); actor.step(1 / 60); }
    expect(actor.motionFrame()!.collapsed).toBe(false);
    expect(shootSkirt(actor)).toBeTruthy();
    actor.step(1 / 60);
    expect(actor.motionFrame()!.collapsed).toBe(true);
    const n = fired();
    for (let i = 0; i < 240; i++) { actor.setBrainInput({ x: 0, z: 2.8, room: 1 }, true); actor.step(1 / 60); }
    expect(fired()).toBe(n);
    expect(actor.motionFrame()!.collapsed).toBe(true);
  });

  it('a skirt hit no longer kicks the hem pendulum sideways (it spun the robe)', () => {
    const { actor } = cultist();
    const hemBefore = actor.boundRig().rig.points.map(q => [...q.pos]);
    const hemI = actor.boundRig().rig.restScale!.findIndex(k => k !== 1);
    shootSkirt(actor);
    const moved = Math.hypot(...actor.boundRig().rig.points[hemI]!.pos.map((v, k) => v - hemBefore[hemI]![k]!));
    expect(moved).toBeLessThan(0.05);
  });

  it('a slug THROWS the body along the shot (it used to fold toward the shooter)', () => {
    for (const dz of [-1, 1]) {
      const { actor } = cultist();
      for (let i = 0; i < 10; i++) actor.step(1 / 60);
      const cz = () => { const ps = actor.boundRig().rig.points; return ps.reduce((a, p) => a + p.pos[2], 0) / ps.length; };
      const z0 = cz();
      const torso = actor.posed().prims.find(p => p.limb === 'torso' && !p.shell)!;
      actor.hitSlug([torso.a[0], torso.a[1], torso.a[2] - dz * 0.3], [0, 0, dz]);
      for (let i = 0; i < 60; i++) actor.step(1 / 60);
      expect((cz() - z0) * dz).toBeGreaterThan(0.5);
    }
  });

  it('death drops the hood: when=alive prims go dead, the hood-down roll appears', () => {
    const { actor } = cultist();
    const hood = () => actor.posed().prims.filter(p => p.when === 'alive');
    const down = () => actor.posed().prims.filter(p => p.when === 'dead');
    expect(hood().length).toBe(2);
    expect(down().length).toBe(2);
    actor.step(1 / 60);
    expect(hood().every(p => !p.dead) && down().every(p => p.dead)).toBe(true);
    shootSkirt(actor);
    for (let i = 0; i < 5; i++) actor.step(1 / 60);
    expect(hood().every(p => p.dead)).toBe(true);
    expect(down().every(p => !p.dead)).toBe(true);
  });
});

