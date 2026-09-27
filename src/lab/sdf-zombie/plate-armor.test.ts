// src/lab/sdf-zombie/plate-armor.test.ts
import { describe, it, expect } from 'vitest';
import {
  JUGGERNAUT_ARMOR as A, JUGGERNAUT_ARMOR, WARBULL_ARMOR, blastPlates, freshPlates, hitPlate, isShed, kitShedFor, plateFor, restHitPoint, shedPlates,
} from './plate-armor';
import src from './characters/juggernaut.blob?raw';
import { parseBlob } from './blob-parse';
import { compileBlob, compileFace } from './blob-compile';
import { buildBody } from './build-body';

describe('plate armour', () => {
  it('covers every armoured bone of the juggernaut, and leaves the pelvis bare', () => {
    const d = parseBlob(src); const b = buildBody(compileBlob(d, compileFace(d)));
    for (const bone of b.bones.keys()) {
      if (bone === 'pelvis') expect(plateFor(A, bone)).toBeNull();
      else expect(plateFor(A, bone), bone).not.toBeNull();
    }
    // Every plate bone is a real bone (no typo silently armouring nothing).
    for (const p of A.plates) for (const bone of p.bones) expect(b.bones.has(bone), bone).toBe(true);
  });

  it('matches the kit side\'s sanitised bone names (GLTFLoader drops the dot)', () => {
    expect(plateFor(A, 'upperarml')?.id).toBe('upperarm.l');
    expect(plateFor(A, 'upperarm.l')?.id).toBe('upperarm.l');
    expect(plateFor(A, 'shinr')?.id).toBe('shin.r');
  });

  it('absorbs rounds until the plate breaks, then lets them through', () => {
    let s = freshPlates(A);
    const hp = A.plates.find(p => p.id === 'helmet')!.hp;
    for (let i = 1; i < hp; i++) {
      const h = hitPlate(A, s, 'skull', 1);
      expect(h).toMatchObject({ plate: 'helmet', absorbed: true, shed: false });
      s = h.state;
    }
    const breaking = hitPlate(A, s, 'skull', 1);
    expect(breaking).toMatchObject({ absorbed: true, shed: true });
    s = breaking.state;
    expect(isShed(s, 'helmet')).toBe(true);
    expect(hitPlate(A, s, 'skull', 1)).toMatchObject({ plate: null, absorbed: false, shed: false });
    expect(shedPlates(s)).toEqual(new Set(['helmet']));
  });

  it('a slug spends three points; bare flesh absorbs nothing', () => {
    const s = hitPlate(A, freshPlates(A), 'chest', 3).state;
    expect(s['cuirass']).toBe(A.plates.find(p => p.id === 'cuirass')!.hp - 3);
    expect(hitPlate(A, s, 'pelvis', 3)).toMatchObject({ absorbed: false, plate: null });
    expect(hitPlate(A, s, undefined, 1).absorbed).toBe(false);
  });

  it('a blast cracks each plate it reaches once per explosion, and never absorbs', () => {
    const r = blastPlates(A, freshPlates(A), ['chest', 'spine1', 'chest', 'upperarm.l', 'pelvis']);
    expect(r.hit.sort()).toEqual(['cuirass', 'upperarm.l']);
    expect(r.state['cuirass']).toBe(A.plates.find(p => p.id === 'cuirass')!.hp - A.blastPlateDamage);
    expect(r.shed).toEqual(['upperarm.l'].filter(() => A.plates.find(p => p.id === 'upperarm.l')!.hp <= A.blastPlateDamage));
  });
});

describe('region plates (the warbull: metal embedded in flesh)', () => {
  const W = WARBULL_ARMOR;
  const fresh = () => freshPlates(W);

  it('a round on the reactor is stopped; the same bone a hand-span away is flesh', () => {
    const onReactor = hitPlate(W, fresh(), 'chest', 1, [0, 1.53, 0.36]);
    expect(onReactor).toMatchObject({ plate: 'reactor', absorbed: true });
    const onPec = hitPlate(W, fresh(), 'neck', 1, [0.13, 1.74, 0.30]);
    expect(onPec).toMatchObject({ plate: null, absorbed: false });
  });

  it('the rack stops rounds on his back; the flesh side of the head and the left eye are flesh', () => {
    expect(hitPlate(W, fresh(), 'neck', 1, [0, 1.72, -0.40]).plate).toBe('rack');
    expect(hitPlate(W, fresh(), 'skull', 1, [-0.10, 2.25, 0.20]).plate).toBe('headgear');
    expect(hitPlate(W, fresh(), 'skull', 1, [0.10, 2.22, 0.22]).plate).toBeNull();
  });

  it('a region plate never matches without a hit point', () => {
    expect(plateFor(W, 'chest')).toBeNull();
    expect(plateFor(W, 'forearm.r')?.id).toBe('launcher');
  });

  it('the launcher covers the whole right forearm and fist, bone-only, and nothing on the left', () => {
    expect(hitPlate(W, fresh(), 'forearm.r', 1).plate).toBe('launcher');
    expect(hitPlate(W, fresh(), 'hand.r', 1).plate).toBe('launcher');
    expect(hitPlate(W, fresh(), 'forearm.l', 1).plate).toBeNull();
  });

  it('a shed plate strips only its own kit bones', () => {
    const shed = new Set(['reactor']);
    expect(kitShedFor(W, shed, 'chest')).toBe(true);
    expect(kitShedFor(W, shed, 'neck')).toBe(false);   // the rack stays
    expect(kitShedFor(W, new Set(['rack']), 'neck')).toBe(true);
    expect(kitShedFor(W, new Set(['launcher']), 'forearmr')).toBe(true); // the GLTFLoader spelling
    // The juggernaut (no kitBones): everything on the plate's bones.
    expect(kitShedFor(JUGGERNAUT_ARMOR, new Set(['helmet']), 'neck')).toBe(true);
  });

  it('a blast cracks every plate on the bones it wounds, region plates included', () => {
    const r = blastPlates(W, fresh(), ['chest']);
    expect(r.hit.sort()).toEqual(['rack', 'reactor']);
  });
});

describe('restHitPoint (a world hit carried back to the rest body)', () => {
  const rest = { a: [0, 1.4, 0] as const, b: [0, 1.8, 0] as const };
  it('undoes a walk and a turn: translation plus body yaw', () => {
    const root = [3, 0, -2], yaw = 0.7;
    const place = (p: readonly number[]) => [root[0]! + p[0]! * Math.cos(yaw) + p[2]! * Math.sin(yaw), p[1]!, root[2]! - p[0]! * Math.sin(yaw) + p[2]! * Math.cos(yaw)];
    const posed = { a: place(rest.a), b: place(rest.b) };
    const hitRest = [0.1, 1.55, 0.3];
    const got = restHitPoint(place(hitRest), root, yaw, posed, rest);
    for (let k = 0; k < 3; k++) expect(got[k]).toBeCloseTo(hitRest[k]!, 6);
  });
  it('undoes a rigid prim\'s own rotation exactly (the head\'s orient quat)', () => {
    const ang = 0.6, q = [Math.sin(ang / 2), 0, 0, Math.cos(ang / 2)]; // pitch about +x
    const rot = (v: number[]) => [v[0]!, v[1]! * Math.cos(ang) - v[2]! * Math.sin(ang), v[1]! * Math.sin(ang) + v[2]! * Math.cos(ang)];
    const a = [0.2, 2.0, 0.1];
    const off = [0.05, 0.1, 0.2];
    const hit = rot(off).map((v, k) => v + a[k]!);
    const got = restHitPoint(hit, [0, 0, 0], 0, { a, b: a, orient: q }, { a: rest.a, b: rest.a });
    for (let k = 0; k < 3; k++) expect(got[k]).toBeCloseTo(rest.a[k]! + off[k]!, 6);
  });
});
