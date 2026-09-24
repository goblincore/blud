// The cultist is a SOFT target (MotionProfile.soft), second pass (owner
// playtest 2026-09-24): TWO trigger pulls kill him and the first staggers him
// (the profile's throw-back flail, arms open, or hunch); a CLOSE slug to the
// head pops it (Scanners, after a short swell); only close slugs sever; a face
// hit drops the hood. Deaths vary (soft-death.ts planDeath).
import { describe, expect, it } from 'vitest';
import { buildBody } from '../build-body';
import { compileBlob, compileFace } from '../blob-compile';
import { parseBlob } from '../blob-parse';
import cultistSrc from '../characters/cultist.blob?raw';
import { CULTIST_PROFILE } from '../motion-profile';
import { makeSoldierMind } from './enemy-mind';
import { SMG_TUNING } from '../soldier-brain';
import { createZombieActor, SOFT_TUNING } from './game-actor';
import type { Vec3 } from '../types';

const doc = parseBlob(cultistSrc);
const body = buildBody(compileBlob(doc, compileFace(doc)));

/** A cultist at the origin with the player `playerDist` m in front (+z). */
function cultist(seed = 42, playerDist = 3) {
  let fired = 0;
  const pops: unknown[] = [];
  const severs: string[] = [];
  let released = 0;
  const actor = createZombieActor({
    id: 1, room: 1, seed, start: [0, 0, 0],
    bounds: { minX: -30, maxX: 30, minZ: -30, maxZ: 30 }, furniture: [],
    body,
    view: { setRootShift() {}, update() {}, setHeadRotation() {}, setTime() {} } as any,
    profile: CULTIST_PROFILE, mind: makeSoldierMind(SMG_TUNING),
    onFire: () => { fired++; },
    onHeadPop: (head) => { pops.push(head); },
    onSever: (piece) => { severs.push(piece.limb); },
    character: { wounds: undefined, releaseProp: () => { released++; } } as any,
  });
  const step = (n: number) => { for (let i = 0; i < n; i++) { actor.setBrainInput({ x: 0, z: playerDist, room: 1 }, true); actor.step(1 / 60); } };
  step(10);
  return { actor, step, fired: () => fired, pops, severs, released: () => released };
}
type C = ReturnType<typeof cultist>;

let shotId = 1000;
const mid = (p: { a: Vec3; b: Vec3 }): Vec3 => [(p.a[0] + p.b[0]) / 2, (p.a[1] + p.b[1]) / 2, (p.a[2] + p.b[2]) / 2];
/** One shotgun trigger pull: `n` pellets sharing a shotId into the skirt. */
function volley(c: C, n = 6) {
  const p = c.actor.posed().prims.find(q => q.bone === 'hem' && q.shell)!;
  const id = ++shotId;
  c.actor.beginHits();
  for (let i = 0; i < n; i++) c.actor.hit([mid(p)[0] + (i - n / 2) * 0.02, mid(p)[1], 1], [0, 0, -1], { weapon: 'shotgun', shotId: id, barrels: 1, barrel: 0 });
  c.actor.endHits();
}
const skull = (c: C) => c.actor.posed().prims.find(p => p.bone === 'skull' && !p.shell && (p.glow ?? 0) === 0)!;
const hood = (c: C) => c.actor.posed().prims.filter(p => p.when === 'alive');

describe('cultist: soft target, two hits', () => {
  it('the profile is soft, two hits, soldier-style reactions with his own flail', () => {
    expect(CULTIST_PROFILE.soft).toBe(true);
    expect(SOFT_TUNING.hitsToKill).toBe(2);
    expect(CULTIST_PROFILE.staggerStyle).toBe('soldier');
    expect(CULTIST_PROFILE.flail!.riseSec).toBeLessThan(0.1);
    expect(CULTIST_PROFILE.flail!.yawOut).toBeGreaterThan(Math.PI / 2); // behind the shoulder
  });

  it('one volley staggers (pellets of one pull count once); the second kills and the gun stops', () => {
    const c = cultist();
    volley(c);
    c.step(6);
    expect(c.actor.motionFrame()!.collapsed).toBe(false);
    expect(c.actor.motionFrame()!.staggerKind).not.toBeNull();
    c.step(120);
    expect(c.actor.motionFrame()!.collapsed).toBe(false);
    volley(c);
    c.step(80);
    expect(c.actor.motionFrame()!.collapsed).toBe(true);
    const n = c.fired();
    c.step(200);
    expect(c.fired()).toBe(n);
  });

  it('the first hit reacts in more than one way across seeds (flail / open / hunch)', () => {
    const kinds = new Set<string>();
    for (let seed = 1; seed <= 12; seed++) {
      const c = cultist(seed);
      volley(c);
      c.step(3);
      kinds.add(String(c.actor.motionFrame()!.staggerKind));
      expect(c.actor.motionFrame()!.collapsed).toBe(false);
    }
    expect(kinds.has('lurch')).toBe(true);
  });

  it('the THROW-BACK flings the arms out wide and a hand behind the chest (some seeds)', () => {
    let thrown = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const c = cultist(seed);
      const chestZ = mid(c.actor.posed().prims.find(p => p.limb === 'torso' && p.core)!)[2];
      let wide = 0, back = Infinity;
      volley(c);
      for (let i = 0; i < 16; i++) {
        c.step(1);
        for (const p of c.actor.posed().prims.filter(q => q.bone?.startsWith('foreArm') && !q.shell && q.color === undefined && q.radius > 0.03)) {
          wide = Math.max(wide, Math.abs(mid(p)[0]));
          back = Math.min(back, mid(p)[2] - chestZ);
        }
      }
      if (wide > 0.4 && back < -0.05) thrown++;
    }
    expect(thrown).toBeGreaterThan(0);
  });

  it('pellets never sever, even point blank', () => {
    const c = cultist(42, 1.5);
    const arm = c.actor.posed().prims.find(p => p.bone === 'foreArm.r' && !p.shell && p.color !== undefined)!;
    const id = ++shotId;
    c.actor.beginHits();
    for (let i = 0; i < 8; i++) c.actor.hit(mid(arm), [-Math.sign(mid(arm)[0]) || -1, 0, 0], { weapon: 'shotgun', shotId: id, barrels: 1, barrel: 0 });
    c.actor.endHits();
    c.step(2);
    expect(c.severs).toEqual([]);
  });

  it('a CLOSE slug through the sleeve takes the gun arm and the gun drops; a far one does not', () => {
    const near = cultist(42, 3);
    const arm = near.actor.posed().prims.find(p => p.bone === 'foreArm.r' && !p.shell && p.color !== undefined)!;
    near.actor.hitSlug(mid(arm), [-Math.sign(mid(arm)[0]) || -1, 0, 0]);
    near.step(1);
    expect(near.severs).toContain('armR');
    expect(near.released()).toBeGreaterThanOrEqual(1);
    const far = cultist(42, 20);
    const arm2 = far.actor.posed().prims.find(p => p.bone === 'foreArm.r' && !p.shell && p.color !== undefined)!;
    far.actor.hitSlug(mid(arm2), [-Math.sign(mid(arm2)[0]) || -1, 0, 0]);
    far.step(1);
    expect(far.severs).toEqual([]);
  });

  it('a face hit drops the hood without killing him', () => {
    const c = cultist();
    expect(hood(c).every(p => !p.dead)).toBe(true);
    const s = skull(c);
    c.actor.hit([s.a[0], s.a[1], s.a[2] + 0.4], [0, 0, -1], { weapon: 'shotgun', shotId: ++shotId, barrels: 1, barrel: 0 });
    c.step(20);
    expect(hood(c).every(p => p.dead)).toBe(true);
    expect(c.actor.motionFrame()!.collapsed).toBe(false);
    expect(c.pops.length).toBe(0);
  });

  it('SCANNERS: a close slug to the head swells it briefly, then pops it and he drops', () => {
    const c = cultist(42, 3);
    const r0 = c.actor.posed().prims.filter(p => p.limb === 'head' && !p.dead).reduce((a, p) => a + p.radius, 0);
    const s = skull(c);
    c.actor.hitSlug([s.a[0], s.a[1], s.a[2] + 0.4], [0, 0, -1]);
    c.step(4);                                            // ~0.07 s: swelling
    expect(c.pops.length).toBe(0);
    const r1 = c.actor.posed().prims.filter(p => p.limb === 'head' && !p.dead).reduce((a, p) => a + p.radius, 0);
    expect(r1).toBeGreaterThan(r0 * 0.6);                 // (the hood dropped: fewer prims, but swollen)
    c.step(12);                                           // +0.2 s
    expect(c.pops.length).toBe(1);
    expect(c.actor.body.clusters.find(q => q.limb === 'head')!.alive).toBe(false);
    c.step(20);
    expect(c.actor.motionFrame()!.collapsed).toBe(true);
    expect(c.released()).toBe(1);
  });

  it('a FAR slug to the head does not pop it: hood drops, he staggers', () => {
    const c = cultist(42, 20);
    const s = skull(c);
    c.actor.hitSlug([s.a[0], s.a[1], s.a[2] + 0.4], [0, 0, -1]);
    c.step(30);
    expect(c.pops.length).toBe(0);
    expect(c.actor.motionFrame()!.collapsed).toBe(false);
  });

  it('dying: the second hit sends the body along the shot on average; the hem kick is gone', () => {
    const moved: number[] = [];
    for (let seed = 1; seed <= 6; seed++) {
      const c = cultist(seed);
      const cz = () => { const ps = c.actor.boundRig().rig.points; return ps.reduce((a, p) => a + p.pos[2], 0) / ps.length; };
      const torso = () => c.actor.posed().prims.find(p => p.limb === 'torso' && !p.shell)!;
      c.actor.hitSlug([torso().a[0], torso().a[1], torso().a[2] + 0.3], [0, 0, -1]);
      c.step(90);
      const z0 = cz();
      c.actor.hitSlug([torso().a[0], torso().a[1], torso().a[2] + 0.3], [0, 0, -1]);
      c.step(90);
      moved.push(z0 - cz());
    }
    expect(moved.reduce((a, b) => a + b, 0) / moved.length).toBeGreaterThan(0.2);
  });
});
