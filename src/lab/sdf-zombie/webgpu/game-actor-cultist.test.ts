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

function cultist(seed = 42) {
  let fired = 0;
  const pops: unknown[] = [];
  const severs: string[] = [];
  let released = 0;
  const actor = createZombieActor({
    id: 1, room: 1, seed, start: [0, 0, 0],
    bounds: { minX: -3, maxX: 3, minZ: -3, maxZ: 3 }, furniture: [],
    body,
    view: { setRootShift() {}, update() {}, setHeadRotation() {}, setTime() {} } as any,
    profile: CULTIST_PROFILE, mind: makeSoldierMind(SMG_TUNING),
    onFire: () => { fired++; },
    onHeadPop: (head) => { pops.push(head); },
    onSever: (piece) => { severs.push(piece.limb); },
    character: { wounds: undefined, releaseProp: () => { released++; } } as any,
  });
  return { actor, fired: () => fired, pops, severs, released: () => released };
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

  it('a slug sends the body ALONG the shot on average (it used to fold toward the shooter)', () => {
    // Deaths vary now (soft-death.ts planDeath), so judge the spread of seeds.
    for (const dz of [-1, 1]) {
      const moved: number[] = [];
      for (let seed = 1; seed <= 6; seed++) {
        const { actor } = cultist(seed);
        for (let i = 0; i < 10; i++) actor.step(1 / 60);
        const cz = () => { const ps = actor.boundRig().rig.points; return ps.reduce((a, p) => a + p.pos[2], 0) / ps.length; };
        const z0 = cz();
        const torso = actor.posed().prims.find(p => p.limb === 'torso' && !p.shell)!;
        actor.hitSlug([torso.a[0], torso.a[1], torso.a[2] - dz * 0.3], [0, 0, dz]);
        for (let i = 0; i < 90; i++) actor.step(1 / 60);
        moved.push((cz() - z0) * dz);
      }
      expect(moved.reduce((a, b) => a + b, 0) / moved.length).toBeGreaterThan(0.3);
      expect(Math.max(...moved)).toBeGreaterThan(0.5);
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

  it('a head shot POPS the head: onHeadPop, no flying head chunk, head gone, gun dropped', () => {
    const { actor, pops, severs, released } = cultist();
    for (let i = 0; i < 10; i++) actor.step(1 / 60);
    const skull = actor.posed().prims.find(p => p.bone === 'skull' && !p.shell && (p.glow ?? 0) === 0)!;
    actor.hitSlug([skull.a[0], skull.a[1], skull.a[2] + 0.4], [0, 0, -1]);
    for (let i = 0; i < 30; i++) actor.step(1 / 60);
    expect(pops.length).toBe(1);
    expect(severs).not.toContain('head');
    expect(actor.body.clusters.find(c => c.limb === 'head')!.alive).toBe(false);
    expect(released()).toBe(1);
    expect((pops[0] as { prims: unknown[] }).prims.length).toBeGreaterThan(0);
  });
  it('a slug through the sleeve can take the gun arm off, and the gun drops', () => {
    const { actor, severs, released } = cultist();
    for (let i = 0; i < 10; i++) actor.step(1 / 60);
    const arm = actor.posed().prims.find(p => p.bone === 'foreArm.r' && !p.shell && p.color !== undefined)!;
    const mid: [number, number, number] = [(arm.a[0] + arm.b[0]) / 2, (arm.a[1] + arm.b[1]) / 2, (arm.a[2] + arm.b[2]) / 2];
    actor.hitSlug(mid, [-Math.sign(mid[0]) || -1, 0, 0]);
    actor.step(1 / 60);
    expect(severs).toContain('armR');
    expect(released()).toBeGreaterThanOrEqual(1);
  });
  it('some deaths STAGGER: still standing a beat after the hit, then down', () => {
    let staggered = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const { actor } = cultist(seed);
      for (let i = 0; i < 10; i++) actor.step(1 / 60);
      shootSkirt(actor);
      for (let i = 0; i < 12; i++) actor.step(1 / 60);          // 0.2 s
      const up = !actor.motionFrame()!.collapsed;
      for (let i = 0; i < 60; i++) actor.step(1 / 60);          // +1 s
      expect(actor.motionFrame()!.collapsed).toBe(true);
      if (up) staggered++;
    }
    expect(staggered).toBeGreaterThan(0);
    expect(staggered).toBeLessThan(12);
  });

  it('SCANNERS: a head shot swells the head for a beat before it pops', () => {
    const { actor, pops } = cultist();
    for (let i = 0; i < 10; i++) actor.step(1 / 60);
    const r0 = actor.posed().prims.filter(p => p.limb === 'head' && !p.dead).reduce((a, p) => a + p.radius, 0);
    const skull = actor.posed().prims.find(p => p.bone === 'skull' && !p.shell && (p.glow ?? 0) === 0)!;
    actor.hit([skull.a[0], skull.a[1], skull.a[2] + 0.4], [0, 0, -1]);
    for (let i = 0; i < 12; i++) actor.step(1 / 60);          // 0.2 s: mid-swell
    expect(pops.length).toBe(0);
    expect(actor.motionFrame()!.collapsed).toBe(false);
    const r1 = actor.posed().prims.filter(p => p.limb === 'head' && !p.dead).reduce((a, p) => a + p.radius, 0);
    expect(r1).toBeGreaterThan(r0 * 1.05);
    for (let i = 0; i < 24; i++) actor.step(1 / 60);          // +0.4 s
    expect(pops.length).toBe(1);
    for (let i = 0; i < 10; i++) actor.step(1 / 60);
    expect(actor.motionFrame()!.collapsed).toBe(true);
  });
});

