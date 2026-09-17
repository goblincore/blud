import { describe, expect, it, vi } from 'vitest';
import { buildBody } from '../build-body';
import { compileBlob } from '../blob-compile';
import { parseBlob } from '../blob-parse';
import soldierSrc from '../characters/soldier.blob?raw';
import { severDistal, severLimb } from '../sever';
import { cutLimbs, cutChains } from '../connectivity';
import type { BuildResult } from '../build-body';
import { SOLDIER_PROFILE } from '../motion-profile';
import { makeSoldierMind } from './enemy-mind';
import { createZombieActor, segmentHitsBox, clearCombatMove } from './game-actor';
import { gunPoint, GUN_GRIP } from '../carry';
import { qRotate } from '../vec';
import { jointNamesForBody } from '../gait';
import type { Aabb } from './game-level';
import { resolveExplosion } from '../explosion-aoe';
import { woundFromSlug, spawnPellets, spawnSlug, stepProjectiles } from './game-weapon';
import { createWoundRing } from './character-view';
import { createSkeletonSources } from './skeleton-spike/contract';
import { extractSegmentMesh } from './skeleton-spike/mesh';
import { sdBody } from '../validate';
import * as soldierStagger from '../soldier-stagger';
import * as motion from '../motion';
import { soldierInjury } from '../soldier-damage';

function soldier(furniture: Aabb[] = [], releaseProp?: () => void, body?: BuildResult, onMeleeContact?: () => void) {
  const shots: { age: number; kicks: number; origin: readonly number[]; direction: readonly number[]; expectedOrigin: readonly number[]; expectedDirection: readonly number[] }[] = [];
  const actor = createZombieActor({
    id: 1, room: 1, seed: 42, start: [0, 0, 0],
    bounds: { minX: -3, maxX: 3, minZ: -3, maxZ: 3 }, furniture,
    body: body ?? buildBody(compileBlob(parseBlob(soldierSrc))),
    view: { setRootShift() {}, update() {}, setHeadRotation() {}, setTime() {} } as any,
    profile: SOLDIER_PROFILE, mind: makeSoldierMind(),
    ...(releaseProp ? { character: { wounds: createWoundRing(), releaseProp } as any } : {}),
    onFire: (shot) => {
      const frame = actor.motionFrame()!;
      shots.push({ age: actor.sinceFire(), kicks: frame.kicks.length,
        origin: shot?.origin ?? [], direction: shot?.direction ?? [],
        expectedOrigin: frame.gun ? gunPoint(frame.gun, GUN_GRIP.muzzle) : [],
        expectedDirection: frame.gun ? qRotate(frame.gun.quat, [0, 0, 1]) : [],
      });
    },
    onMeleeContact,
  });
  return { actor, shots };
}

describe('soldier actor combat wiring', () => {
  const hitLimb = (actor: ReturnType<typeof soldier>['actor'], bone: string, slug = false, shot?: import('../damage').ShotProvenance) => {
    const candidates = actor.posed().prims.filter(p => p.bone === bone && !p.dead);
    const p = candidates.find(p => Math.hypot(...p.a.map((v, i) => v - p.b[i]!)) > 0.01) ?? candidates[0]!;
    const point: [number, number, number] = [(p.a[0] + p.b[0]) / 2, (p.a[1] + p.b[1]) / 2, (p.a[2] + p.b[2]) / 2 + p.radius];
    if (bone.startsWith('upperarm')) {
      point[0] += Math.sign(point[0]) * p.radius;
      point[2] -= p.radius;
    }
    return slug ? actor.hitSlug(point, [0, 0, -1]) : actor.hit(point, [0, 0, -1], shot);
  };

  it('freezes a settled corpse for baking and wakes on further damage', () => {
    const {actor}=soldier();
    expect(actor.refineEligible()).toBe(true);   // run 5b: a standing body refines
    for(let i=0;i<6;i++) hitLimb(actor,'thigh.l');
    for(let i=0;i<10;i++) actor.step(1/60);
    expect(actor.refineEligible()).toBe(false);  // falling — past 'standing', never refines
    for(let i=0;i<240;i++) actor.step(1/60);
    expect(actor.corpseBakeEligible()).toBe(true);
    expect(actor.refineEligible()).toBe(false);  // settled
    actor.pauseForBake(true);
    const before=JSON.stringify(actor.posed());
    for(let i=0;i<30;i++) actor.step(1/60);
    expect(JSON.stringify(actor.posed())).toBe(before);
    const revision=actor.damageRevision();hitLimb(actor,'chest');
    expect(actor.damageRevision()).toBeGreaterThan(revision);
    actor.step(1/60);expect(actor.motionFrame()!.collapsed).toBe(true);
    for(let i=0;i<8;i++) hitLimb(actor,'upperarm.r');
    expect(actor.boundRig().rig.headFollowsRig).toBe(true); // immediate post-sever restore, before another step
  });

  it('a head pellet survives with visible carving and continued combat', () => {
    const { actor, shots } = soldier();
    const w = hitLimb(actor, 'skull');
    expect(actor.body.prims[w!.primIdx]!.limb).toBe('head');
    expect(actor.wounds()).toContain(w);
    for (let i = 0; i < 180; i++) {
      actor.setBrainInput({ x: 0, z: 2.8, room: 1 }, true);
      actor.step(1 / 60);
    }
    expect(actor.motionFrame()!.collapsed).toBe(false);
    expect(shots.length).toBeGreaterThan(0);
  });

  it('a concentrated pellet batch interrupts aim strongly without making one pellet a stun', () => {
    const one = soldier().actor;
    hitLimb(one, 'chest');
    expect(one.debug().holdSecs).toBe(0);
    const many = soldier().actor;
    for (let i = 0; i < 120 && many.debug().state !== 'aim'; i++) {
      many.setBrainInput({ x: 0, z: 2.8, room: 1 }, true);
      many.step(1 / 60);
    }
    expect(many.debug().state).toBe('aim');
    many.beginHits();
    for (let i = 0; i < 4; i++) hitLimb(many, 'chest');
    many.endHits();
    many.step(1 / 60);
    expect(many.debug().holdSecs).toBeGreaterThan(0);
    expect(many.debug().state).toBe('stagger');
    expect(many.motionFrame()!.collapsed).toBe(false);
    expect(many.motionFrame()!.staggerKind).toBe('lurch');
    for (let i = 0; i < 90; i++) { many.setBrainInput({ x: 0, z: 2.8, room: 1 }, true); many.step(1 / 60); }
    expect(many.debug().state).not.toBe('stagger');
  });

  it.each([['slug-first', 1], ['pellet-first', 1], ['slug-first', 10], ['pellet-first', 10]] as const)('preserves the stronger reaction and its impact source in a %s batch with %i pellets', (order, count) => {
    const actor = soldier().actor;
    const observe = vi.spyOn(soldierStagger, 'stepSoldierStagger');
    try {
      const chest = actor.posed().prims.find(p => p.bone === 'chest' && !p.dead)!;
      const skull = actor.posed().prims.find(p => p.bone === 'skull' && !p.dead)!;
      const slug = () => actor.hitSlug([chest.a[0], (chest.a[1] + chest.b[1]) / 2, chest.a[2] + chest.radius], [1, 0, 0]);
      const pellet = () => {
        for (let i = 0; i < count; i++) actor.hit([skull.a[0], skull.a[1], skull.a[2] + skull.radius], [0, 0, -1]);
      };
      actor.beginHits();
      if (order === 'slug-first') { slug(); pellet(); } else { pellet(); slug(); }
      actor.endHits();
      expect(actor.debug().holdSecs).toBeCloseTo(count === 1 ? .78 : 1.20);
      actor.step(1 / 60);
      const hit = observe.mock.calls.find(call => call[1] !== null)?.[1];
      expect(hit).toEqual(count === 1
        ? { level: 'medium', torso: true, dirWorld: [1, 0, 0] }
        : { level: 'heavy', torso: false, dirWorld: [0, 0, -1] });
      expect(actor.motionFrame()!.staggerKind).toBe('lurch');
      expect(actor.motionFrame()!.collapsed).toBe(false);
    } finally { observe.mockRestore(); }
  });

  it('keeps the rendered grip on the solved hand through hits, rehits, recovery and firing', () => {
    const { actor, shots } = soldier();
    const handIndex = jointNamesForBody(actor.body).indexOf('handR');
    for (let frame = 0; frame < 240; frame++) {
      if (frame === 0) hitLimb(actor, 'chest', true);
      if (frame === 8 || frame === 28) hitLimb(actor, 'skull');
      actor.setBrainInput({ x: 0, z: 2.8, room: 1 }, true);
      const beforeShots = shots.length;
      actor.step(1 / 60);
      const gun = actor.motionFrame()!.gun!;
      expect(gun, `frame ${frame}: ${JSON.stringify(actor.debug())}`).not.toBeNull();
      const hand = actor.boundRig().rig.points[handIndex]!.pos;
      const grip = gunPoint(gun, GUN_GRIP.gripHand);
      expect(Math.hypot(...grip.map((v, i) => v - hand[i]!))).toBeLessThan(1e-8);
      if (shots.length > beforeShots) {
        const offset = qRotate(gun.quat, GUN_GRIP.muzzle.map((v, i) =>
          (v - GUN_GRIP.gripHand[i]!) * (gun.scale ?? 1)) as [number, number, number]);
        const actualMuzzle = hand.map((v, i) => v + offset[i]!);
        expect(Math.hypot(...shots.at(-1)!.origin.map((v, i) => v - actualMuzzle[i]!))).toBeLessThan(1e-8);
      }
    }
    expect(shots.length).toBeGreaterThan(0);
  });

  it('counts distinct shots across frame batches and forces the third aim interruption', () => {
    const { actor, shots } = soldier();
    for (let i = 0; i < 120 && actor.debug().state !== 'aim'; i++) {
      actor.setBrainInput({ x: 0, z: 2.8, room: 1 }, true);
      actor.step(1 / 60);
    }
    expect(actor.debug().state).toBe('aim');
    const observe = vi.spyOn(soldierStagger, 'stepSoldierStagger');
    try {
      for (const id of [901, 902, 903]) {
        actor.beginHits();
        hitLimb(actor, 'chest', false, { weapon: 'shotgun', shotId: id, barrels: 1, barrel: 0 });
        actor.endHits();
        actor.step(1 / 60);
        const hit = observe.mock.calls.filter(call => call[1] !== null).at(-1)![1]!;
        expect(hit.fullStagger === true).toBe(id === 903);
        expect(actor.debug().state).toBe(id === 903 ? 'stagger' : 'aim');
      }
      expect(actor.debug().state).toBe('stagger');
      expect(actor.debug().holdSecs).toBeGreaterThan(1.2);
      expect(shots).toHaveLength(0);
      expect(actor.motionFrame()!.staggerKind).toBe('lurch');
    } finally { observe.mockRestore(); }
  });

  it('one volley cannot count as three shots, even split across frame batches', () => {
    const actor = soldier().actor;
    const observe = vi.spyOn(soldierStagger, 'stepSoldierStagger');
    try {
      for (let i = 0; i < 6; i++) {
        actor.beginHits();
        hitLimb(actor, 'chest', false, { weapon: 'shotgun', shotId: 904, barrels: 2, barrel: i % 2 as 0 | 1 });
        actor.endHits(); actor.step(1 / 60);
      }
      expect(observe.mock.calls.some(call => call[1]?.fullStagger)).toBe(false);
    } finally { observe.mockRestore(); }
  });

  it('clears a completed chain but does not recount its trailing pellets', () => {
    const actor = soldier().actor;
    const observe = vi.spyOn(soldierStagger, 'stepSoldierStagger');
    try {
      for (const id of [908, 909, 910, 910, 910, 911, 912]) {
        hitLimb(actor, 'chest', false, { weapon: 'shotgun', shotId: id, barrels: 1, barrel: 0 });
        actor.step(1 / 60);
      }
      expect(observe.mock.calls.filter(call => call[1]?.fullStagger)).toHaveLength(1);
    } finally { observe.mockRestore(); }
  });

  it('counts a no-ID diagnostic batch once rather than counting its pellets', () => {
    const actor = soldier().actor;
    const observe = vi.spyOn(soldierStagger, 'stepSoldierStagger');
    try {
      actor.beginHits();
      for (let i = 0; i < 6; i++) hitLimb(actor, 'chest');
      actor.endHits(); actor.step(1 / 60);
      expect(observe.mock.calls.some(call => call[1]?.fullStagger)).toBe(false);
    } finally { observe.mockRestore(); }
  });

  it('keeps full escalation heavy when its triggering pellet also completes a medium batch', () => {
    const actor = soldier().actor;
    const observe = vi.spyOn(soldierStagger, 'stepSoldierStagger');
    try {
      actor.beginHits();
      for (const id of [913, 913, 913, 913, 914, 914, 914, 915])
        hitLimb(actor, 'chest', false, { weapon: 'shotgun', shotId: id, barrels: 1, barrel: 0 });
      actor.endHits(); actor.step(1 / 60);
      const hit = observe.mock.calls.find(call => call[1]?.fullStagger)?.[1];
      expect(hit).toMatchObject({ fullStagger: true, level: 'heavy' });
    } finally { observe.mockRestore(); }
  });

  it('expires the consecutive shot window', () => {
    const actor = soldier().actor;
    const observe = vi.spyOn(soldierStagger, 'stepSoldierStagger');
    try {
      for (const id of [905, 906]) {
        hitLimb(actor, 'chest', false, { weapon: 'shotgun', shotId: id, barrels: 1, barrel: 0 });
        actor.step(1 / 60);
      }
      for (let i = 0; i < 100; i++) actor.step(1 / 60);
      hitLimb(actor, 'chest', false, { weapon: 'shotgun', shotId: 907, barrels: 1, barrel: 0 });
      actor.step(1 / 60);
      expect(observe.mock.calls.some(call => call[1]?.fullStagger)).toBe(false);
    } finally { observe.mockRestore(); }
  });

  it('matches recovery time to medium volleys, heavy volleys and ordinary slugs', () => {
    const medium = soldier().actor, heavy = soldier().actor, slug = soldier().actor;
    for (const [actor, count] of [[medium, 4], [heavy, 10]] as const) {
      actor.beginHits();
      for (let i = 0; i < count; i++) hitLimb(actor, 'chest');
      actor.endHits();
    }
    hitLimb(slug, 'chest', true);
    expect(medium.debug().holdSecs).toBeCloseTo(.78);
    expect(heavy.debug().holdSecs).toBeCloseTo(1.20);
    expect(slug.debug().holdSecs).toBeCloseTo(.78);
    expect(slug.debug().knockV).toBe(0); // motion footwork owns Soldier knockback
  });

  it('support-arm loss keeps slower, less accurate actual fire', () => {
    const b = buildBody(compileBlob(parseBlob(soldierSrc)));
    const cut = severDistal(b, { limb: 'armL', fromPrim: b.prims.findIndex(p => p.bone === 'forearm.l') });
    const { actor, shots } = soldier([], undefined, cut.body);
    for (let i = 0; i < 240; i++) { actor.setBrainInput({ x: 0, z: 2.8, room: 1 }, true); actor.step(1 / 60); }
    expect(actor.motionFrame()!.collapsed).toBe(false);
    expect(shots.length).toBeGreaterThan(0);
    expect(shots.some(s => Math.abs(s.direction[0]! - s.expectedDirection[0]!) > 1e-4)).toBe(true);
  });

  it('does not grow persistent injury history after distal arm loss', () => {
    const b = buildBody(compileBlob(parseBlob(soldierSrc)));
    const cut = severDistal(b, { limb: 'armL', fromPrim: b.prims.findIndex(p => p.bone === 'forearm.l') });
    const { actor } = soldier([], undefined, cut.body);
    const before = actor.injuryHistorySize();
    for (let i = 0; i < 24; i++) hitLimb(actor, 'upperarm.l');
    expect(actor.injuryHistorySize()).toBe(before);
    expect(actor.wounds().length).toBeGreaterThan(0); // cosmetic geometry remains
  });

  it('gun-arm loss pursues and emits one melee contact without phantom fire', () => {
    const b = severLimb(buildBody(compileBlob(parseBlob(soldierSrc))), 'armR').body;
    const contact = vi.fn();
    const { actor, shots } = soldier([], undefined, b, contact);
    actor.setRingInput(true, 0);
    for (let i = 0; i < 100; i++) { actor.setBrainInput({ x: 0, z: 1, room: 1 }, true); actor.step(1 / 60); }
    expect(contact).toHaveBeenCalledTimes(1);
    expect(shots).toHaveLength(0);
    expect(actor.debug().meleeContacts).toBe(1);
    expect(actor.motionFrame()!.collapsed).toBe(false);
  });

  it('does not emit melee contact on the frame lethal damage collapses the Soldier', () => {
    const b = severLimb(buildBody(compileBlob(parseBlob(soldierSrc))), 'armR').body;
    const liveContact = vi.fn(), killedContact = vi.fn();
    const live = soldier([], undefined, b, liveContact).actor;
    const killed = soldier([], undefined, b, killedContact).actor;
    const advanceToContactEdge = (actor: typeof live) => {
      actor.setRingInput(true, 0);
      while (actor.debug().swingT < .47) {
        actor.setBrainInput({ x: 0, z: 1, room: 1 }, true);
        actor.step(1 / 60);
      }
      expect(actor.debug().swingT).toBeGreaterThanOrEqual(.47);
      expect(actor.debug().swingT).toBeLessThan(.5);
    };
    advanceToContactEdge(live);
    advanceToContactEdge(killed);
    const skull = killed.posed().prims.find(p => p.bone === 'skull')!;
    const lethal = woundFromSlug(killed.posed().prims,
      [skull.a[0], skull.a[1], skull.a[2] + skull.radius], () => 0);
    lethal.shot = { weapon: 'explosion' };
    killed.stampBlast([lethal]);
    for (const actor of [live, killed]) {
      actor.setBrainInput({ x: 0, z: 1, room: 1 }, true);
      actor.step(1 / 60);
    }
    expect(liveContact).toHaveBeenCalledTimes(1);
    expect(live.motionFrame()!.collapsed).toBe(false);
    expect(killed.motionFrame()!.collapsed).toBe(true);
    expect(killedContact).not.toHaveBeenCalled();
  });

  it('survives a full double torso volley; further damage stays cumulative after visual wound eviction', () => {
    const { actor } = soldier();
    const volley = spawnPellets([0, 0, 0], [0, 0, 1], 2, 42);
    actor.beginHits();
    for (const p of volley) hitLimb(actor, 'chest', false, p.shot);
    actor.endHits();
    actor.step(1 / 60);
    expect(actor.motionFrame()!.collapsed).toBe(false);
    for (let i = 0; i < 8; i++) hitLimb(actor, 'chest');
    actor.step(1 / 60);
    expect(actor.wounds().length).toBeLessThanOrEqual(16);
    expect(actor.motionFrame()!.collapsed).toBe(true);
  });

  it('diagnostic slug-like stamping reveals a head wound without lethal injury', () => {
    const { actor } = soldier();
    const p = actor.posed().prims.find(p => p.bone === 'skull')!;
    const at: [number, number, number] = [p.a[0], p.a[1], p.a[2] + p.radius];
    const w = woundFromSlug(actor.posed().prims, at, () => 0);
    expect(actor.body.prims[w.primIdx]!.limb).toBe('head');
    actor.stampBlast([w]);
    actor.step(1 / 60);
    expect(actor.motionFrame()!.collapsed).toBe(false);
    expect(actor.wounds()).toEqual([expect.objectContaining({ primIdx: w.primIdx, radius: w.radius, type: 'blast' })]);
    expect(actor.body.clusters.find(c => c.limb === 'head')!.alive).toBe(true);
  });

  it('the explosion resolver marks real head injury before actor stamping', () => {
    const { actor } = soldier();
    const p = actor.posed().prims.find(p => p.bone === 'skull')!;
    const fx = resolveExplosion([p.a[0], p.a[1], p.a[2] + 0.3], [{ id: '1', body: actor.posed() }]);
    const wounds = fx.perBody[0]!.wounds;
    expect(wounds.some(w => actor.body.prims[w.primIdx]!.limb === 'head')).toBe(true);
    expect(wounds.every(w => w.shot?.weapon === 'explosion')).toBe(true);
    actor.stampBlast(wounds);
    actor.step(1 / 60);
    expect(actor.motionFrame()!.collapsed).toBe(true);
  });

  it('a slug cannot bypass head survival through the geometric cut test', () => {
    const { actor } = soldier();
    const skull = actor.posed().prims.find(p => p.bone === 'skull')!;
    actor.hitSlug([skull.a[0], skull.a[1], skull.a[2] + skull.radius], [0, 0, -1]);
    actor.step(1 / 60);
    expect(actor.body.clusters.find(c => c.limb === 'head')!.alive).toBe(true);
    expect(actor.motionFrame()!.collapsed).toBe(false);
  });

  it.each(['double', 'single', 'stray', 'separate'] as const)('%s shotgun provenance manually forwarded to actor survives frame batches', kind => {
    const { actor } = soldier();
    const volley = spawnPellets([0, 0, 0], [0, 0, 1], kind === 'single' ? 1 : 2, 42);
    stepProjectiles(volley, 1 / 60);
    const other = spawnPellets([0, 0, 0], [0, 0, 1], 2, 42);
    const selected = kind === 'single' ? volley.slice(0, 4) : [volley[0]!, volley[1]!, volley[8]!, volley[9]!];
    selected.forEach((p, i) => {
      actor.beginHits();
      const shot = kind === 'separate' && i >= 2 ? other[i - 2]!.shot : p.shot;
      hitLimb(actor, kind === 'stray' && i > 0 ? 'chest' : 'skull', false, shot);
      actor.endHits();
    });
    actor.step(1 / 60);
    expect(actor.motionFrame()!.collapsed).toBe(kind === 'double');
    expect(spawnSlug([0, 0, 0], [0, 0, 1]).shot?.weapon).toBe('slug');
  });

  it('repeated focused thigh pellets detach the leg and cause a disabling fall', () => {
    const { actor } = soldier();
    for (let i = 0; i < 8; i++) hitLimb(actor, 'thigh.l');
    expect(actor.body.clusters.find(c => c.limb === 'legL')!.alive).toBe(false);
    actor.step(1 / 60);
    expect(actor.motionFrame()!.collapsed).toBe(true);
  });

  it.each(['L', 'R'] as const)('a single %s elbow slug stays attached with a bounded crater; focused repeats sever', side => {
    const release = vi.fn(), { actor } = soldier([], release);
    const boneName = `forearm.${side.toLowerCase()}`, limb = side === 'L' ? 'armL' : 'armR';
    const prim = actor.posed().prims.find(p => p.bone === boneName)!;
    const at = (): [number, number, number] => {
      const p = actor.posed().prims.find(p => p.bone === prim.bone && !p.dead)!;
      return [p.a[0], p.a[1], p.a[2] + p.radius];
    };
    const wound = actor.hitSlug(at(), [0, 0, -1])!;
    expect(actor.body.prims[wound.primIdx]!.limb).toBe(limb);
    expect(actor.body.prims.some(p => p.limb === limb && p.dead)).toBe(false);
    expect(release).not.toHaveBeenCalled();
    expect(wound.radius).toBeLessThanOrEqual(.09);
    expect(wound.severRadius).toBe(.13);
    actor.hitSlug(at(), [0, 0, -1]);
    actor.hitSlug(at(), [0, 0, -1]);
    expect(soldierInjury(actor.body, []).missing[limb]).toBe(true);
    actor.step(1 / 60);
    expect(actor.motionFrame()!.collapsed).toBe(false);
    const sources = createSkeletonSources(actor.body, actor.boundRig(), { character: 'soldier' });
    expect(sources.filter(source => source.segment.startsWith(`limb:${limb}:`) && source.isLive()).reduce((n, source) => n + source.primCount, 0))
      .toBe(actor.body.bonePrims.filter(p => p.limb === limb && !p.dead && actor.body.clusters[p.cluster]?.alive).length);
    hitLimb(actor, 'chest');
    expect(release).toHaveBeenCalledTimes(side === 'R' ? 1 : 0);
  });

  it('a fatal corpse retains geometric arm dismemberment without recording new injury', () => {
    const actor = soldier().actor;
    for (let i = 0; i < 12; i++) hitLimb(actor, 'skull');
    const ledger = actor.injuryHistorySize();
    const wound = hitLimb(actor, 'forearm.r', true)!;
    expect(wound.radius).toBe(.16); // living-arm visual limit no longer applies
    wound.severRadius = 1;
    hitLimb(actor, 'chest');
    expect(actor.injuryHistorySize()).toBe(ledger);
    expect(soldierInjury(actor.body, []).missing.armR).toBe(true);
  });

  it('enlarged geometric cut calibre cannot bypass the arm injury budget', () => {
    const actor = soldier().actor;
    const wound = hitLimb(actor, 'forearm.r', true)!;
    // Deliberately force both raw connectivity paths to propose an arm cut.
    // This is a gate regression, independent of the visual crater radius.
    wound.severRadius = 1;
    const torso = actor.body.clusters.find(c => c.limb === 'torso')!.center;
    expect(cutLimbs(actor.body, [wound], torso)).toContain('armR');
    expect(cutChains(actor.body, [wound]).some(c => c.limb === 'armR')).toBe(true);
    hitLimb(actor, 'chest'); // runs the actor's sever tail again
    expect(soldierInjury(actor.body, []).missing.armR).toBe(false);
  });

  it('eight scattered arm pellets leave both arms attached', () => {
    const actor = soldier().actor;
    for (let i = 0; i < 2; i++) for (const bone of ['upperarm.l', 'forearm.l', 'upperarm.r', 'forearm.r']) hitLimb(actor, bone);
    expect(actor.body.prims.some(p => (p.limb === 'armL' || p.limb === 'armR') && p.dead)).toBe(false);
  });

  it('a targeted two-barrel elbow group can still sever', () => {
    const actor = soldier().actor;
    const prim = actor.posed().prims.find(p => p.bone === 'forearm.r')!;
    const at = (): [number, number, number] => {
      const p = actor.posed().prims.find(p => p.bone === prim.bone && !p.dead)!;
      return [p.a[0], p.a[1], p.a[2] + p.radius];
    };
    actor.beginHits();
    for (let i = 0; i < 4; i++) actor.hit(at(), [0, 0, -1], {
      weapon: 'shotgun', shotId: 812, barrels: 2, barrel: i < 2 ? 0 : 1,
    });
    actor.endHits();
    expect(soldierInjury(actor.body, []).missing.armR).toBe(true);
    actor.step(1 / 60);
    expect(actor.motionFrame()!.collapsed).toBe(false);
  });

  it.each([['upperarm.r', 'armR'], ['upperarm.l', 'armL'], ['forearm.r', 'armR'], ['forearm.l', 'armL']])('a severed %s releases only the gun hand prop', (bone, limb) => {
    const release = vi.fn();
    const { actor } = soldier([], release);
    for (let i = 0; i < 8; i++) hitLimb(actor, bone!);
    expect(actor.body.clusters.find(c => c.limb === limb)!.alive).toBe(false);
    expect(release.mock.calls.length > 0).toBe(limb === 'armR');
  });

  it.each([['forearm.l', 'armL'], ['forearm.r', 'armR']] as const)('distal %s loss releases only the gun hand prop', (bone, limb) => {
    const b = buildBody(compileBlob(parseBlob(soldierSrc)));
    const cut = severDistal(b, { limb, fromPrim: b.prims.findIndex(p => p.bone === bone) });
    expect(cut.body.clusters.find(c => c.limb === limb)!.alive).toBe(true);
    const release = vi.fn();
    const { actor } = soldier([], release, cut.body);
    hitLimb(actor, 'chest');
    expect(release.mock.calls.length > 0).toBe(limb === 'armR');
  });

  it.each([['pelvis', 'both'], ['thigh.l', 'L'], ['thigh.r', 'R']] as const)('keeps authored %s injury mobile and forwards it after visual wounds expire', (bone, side) => {
    const actor = soldier().actor;
    const observe = vi.spyOn(motion, 'stepMotion');
    try {
      const wound = hitLimb(actor, bone)!;
      expect(actor.body.prims[wound.primIdx]!.bone).toBe(bone);
      actor.step(1 / 60);
      expect(observe.mock.calls.at(-1)![3].mobilityInjury).toEqual({ severity: 1 / 3, side });
      // Diagnostic visual-only marks evict the original crater without adding
      // injury; the lasting mobility state must come from the injury ledger.
      actor.stampBlast(Array.from({ length: 20 }, () => ({ ...wound, radius: .001, type: 'burn' as const })));
      expect(actor.wounds()).not.toContain(wound);
      for (let frame = 0; frame < 120; frame++) actor.step(1 / 60);
      expect(observe.mock.calls.at(-1)![3].mobilityInjury).toEqual({ severity: 1 / 3, side });
      expect(actor.motionFrame()!.collapsed).toBe(false);
      expect(actor.body.clusters.filter(c => c.limb === 'legL' || c.limb === 'legR').every(c => c.alive)).toBe(true);
    } finally { observe.mockRestore(); }
  });

  it.each(['pelvis', 'thigh.l'] as const)('four %s hits remain mobile; severe repeated damage disables', bone => {
    const actor = soldier().actor;
    for (let i = 0; i < 4; i++) hitLimb(actor, bone);
    actor.step(1 / 60);
    expect(actor.motionFrame()!.collapsed).toBe(false);
    for (let i = 0; i < 2; i++) hitLimb(actor, bone);
    actor.step(1 / 60);
    expect(actor.motionFrame()!.collapsed).toBe(true);
  });

  it('a mid-thigh slug causes a strong reaction while the limb remains attached', () => {
    const { actor } = soldier();
    const wound = hitLimb(actor, 'thigh.l', true);
    expect(actor.body.prims[wound!.primIdx]!.limb).toBe('legL');
    actor.step(1 / 60);
    expect(actor.body.clusters.find(c => c.limb === 'legL')!.alive).toBe(true);
    expect(actor.motionFrame()!.collapsed).toBe(false);
    expect(actor.motionFrame()!.staggerKind).toBe('lurch');
  });

  it.each(['L', 'R'] as const)('keeps distal %s arm loss standing with only surviving skeleton sources', side => {
    const b = buildBody(compileBlob(parseBlob(soldierSrc)));
    const limb = side === 'L' ? 'armL' : 'armR';
    const cut = severDistal(b, { limb, fromPrim: b.prims.findIndex(p => p.bone === `forearm.${side.toLowerCase()}`) });
    const release = vi.fn();
    const { actor, shots } = soldier([], release, cut.body);
    hitLimb(actor, 'chest'); // Resolve damage/prop eligibility before the next draw.
    const sources = createSkeletonSources(actor.body, actor.boundRig(), { character: 'soldier' });
    expect(sources.filter(s => s.segment.startsWith(`limb:${limb}:`)).reduce((n, s) => n + s.primCount, 0))
      .toBe(actor.body.bonePrims.filter(p => p.limb === limb && !p.dead).length);
    expect(release.mock.calls.length > 0).toBe(side === 'R');
    for (let i = 0; i < 180; i++) { actor.setBrainInput({ x: 0, z: 2.8, room: 1 }, true); actor.step(1 / 60); }
    expect(actor.motionFrame()!.collapsed).toBe(false);
    expect(shots.length > 0).toBe(side === 'L');
    expect(actor.motionFrame()!.gun === null).toBe(side === 'R');
  });

  it('keeps the authored skull behind posed flesh during a torso-hit lurch', () => {
    const { actor } = soldier();
    const sources=createSkeletonSources(actor.body,actor.boundRig(),{character:'soldier',rig:()=>actor.boundRig().rig,bodyYaw:()=>actor.pose().yaw});
    const source=sources.find(s=>s.segment==='head')!,mesh=extractSegmentMesh(source),pos=mesh.geometry.getAttribute('position');
    let worst=-Infinity;
    hitLimb(actor,'chest',true);
    for(let frame=0;frame<20;frame++){
      actor.step(1/60);expect(actor.motionFrame()!.staggerKind).toBe('lurch');
      for(let i=0;i<pos.count;i++)worst=Math.max(worst,sdBody(source.toWorld([pos.getX(i),pos.getY(i),pos.getZ(i)]),actor.posed()));
    }
    mesh.geometry.dispose();
    expect(worst).toBeLessThanOrEqual(0);
  });

  it('the released shot, current gun pose, and recoil share the same frame', () => {
    const { actor, shots } = soldier();
    for (let i = 0; i < 600 && shots.length === 0; i++) {
      actor.setBrainInput({ x: 0, z: 2.8, room: 1 }, true);
      actor.step(1 / 60);
    }
    expect(shots.length).toBeGreaterThan(0);
    expect(shots[0]!.age).toBe(0);
    expect(shots[0]!.kicks).toBeGreaterThan(0);
    expect(shots[0]!.origin).toEqual(shots[0]!.expectedOrigin);
    expect(shots[0]!.direction).toEqual(shots[0]!.expectedDirection);
  });

  it('a tall crate interrupts line of sight instead of permitting a shot through it', () => {
    const { actor, shots } = soldier([{ min: [-3, 0, 1], max: [3, 2, 1.5] }]);
    for (let i = 0; i < 480; i++) {
      actor.setBrainInput({ x: 0, z: 2.8, room: 1 }, true);
      actor.step(1 / 60);
    }
    expect(shots).toHaveLength(0);
    expect(actor.pose().pos[2]).toBeLessThan(0.46);
  });
});


describe('solid geometry sight and projectile segments', () => {
  const box: Aabb = { min: [-1, 0, 1], max: [1, 1, 2] };
  it('blocks a shot crossing a thin obstacle even when both endpoints are outside', () => {
    expect(segmentHitsBox([0, 0.5, 0], [0, 0.5, 5], box)).toBe(true);
  });
  it('permits a shot above low cover and rejects a parallel miss', () => {
    expect(segmentHitsBox([0, 1.4, 0], [0, 1.4, 5], box)).toBe(false);
    expect(segmentHitsBox([2, 0.5, 0], [2, 0.5, 5], box)).toBe(false);
  });
});


it('can step away from a crate face but cannot step into it', () => {
  const box: Aabb = { min: [-1, 0, 1], max: [1, 2, 2] };
  expect(clearCombatMove([0, 0, 0.45], [0, 0, -1], [box])).toBe(true);
  expect(clearCombatMove([0, 0, 0.45], [0, 0, 1.5], [box])).toBe(false);
});
