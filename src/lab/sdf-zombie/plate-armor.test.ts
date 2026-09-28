// src/lab/sdf-zombie/plate-armor.test.ts
import { describe, it, expect } from 'vitest';
import {
  JUGGERNAUT_ARMOR as A, JUGGERNAUT_ARMOR, WARBULL_ARMOR, blastPlates, freshPlates, hitPlate, isShed, kitShedFor, plateFor, restHitPoint, shedPlates,
  type ArmorSpec,
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

describe('region plates (metal embedded in flesh that shares a bone)', () => {
  // A test suit shaped like the problem: a reactor sunk in the chest and a
  // rack on the back, both on bones that also carry bare flesh.
  const R: ArmorSpec = {
    plates: [
      { id: 'reactor', bones: ['chest', 'neck'], hp: 12, region: { center: [0, 1.53, 0.36], radius: 0.15 }, kitBones: ['chest'] },
      { id: 'rack', bones: ['neck', 'chest'], hp: 12, region: { center: [0, 1.70, -0.42], radius: 0.30 }, kitBones: ['neck'] },
      { id: 'arm', bones: ['forearm.r'], hp: 6 },
    ],
    blastPlateDamage: 10,
  };
  const fresh = () => freshPlates(R);

  it('a round on the metal is stopped; the same bone a hand-span away is flesh', () => {
    expect(hitPlate(R, fresh(), 'chest', 1, [0, 1.53, 0.36])).toMatchObject({ plate: 'reactor', absorbed: true });
    expect(hitPlate(R, fresh(), 'neck', 1, [0.13, 1.74, 0.30])).toMatchObject({ plate: null, absorbed: false });
    expect(hitPlate(R, fresh(), 'neck', 1, [0, 1.72, -0.40]).plate).toBe('rack');
  });

  it('a region plate never matches without a hit point; a bone plate always does', () => {
    expect(plateFor(R, 'chest')).toBeNull();
    expect(plateFor(R, 'forearm.r')?.id).toBe('arm');
  });

  it('a shed plate strips only its own kit bones', () => {
    expect(kitShedFor(R, new Set(['reactor']), 'chest')).toBe(true);
    expect(kitShedFor(R, new Set(['reactor']), 'neck')).toBe(false);
    expect(kitShedFor(R, new Set(['rack']), 'neck')).toBe(true);
    expect(kitShedFor(R, new Set(['arm']), 'forearmr')).toBe(true); // the GLTFLoader spelling
    // The juggernaut (no kitBones): everything on the plate's bones.
    expect(kitShedFor(JUGGERNAUT_ARMOR, new Set(['helmet']), 'neck')).toBe(true);
  });

  it('a blast cracks every plate on the bones it wounds, region plates included', () => {
    expect(blastPlates(R, fresh(), ['chest']).hit.sort()).toEqual(['rack', 'reactor']);
  });
});

describe('the warbull\'s plates', () => {
  it('only the launcher (his right forearm and fist) is a plate: the disarm target', () => {
    expect(WARBULL_ARMOR.plates.map(p => p.id)).toEqual(['launcher']);
    const f = freshPlates(WARBULL_ARMOR);
    expect(hitPlate(WARBULL_ARMOR, f, 'forearm.r', 1).plate).toBe('launcher');
    expect(hitPlate(WARBULL_ARMOR, f, 'hand.r', 1).plate).toBe('launcher');
    expect(hitPlate(WARBULL_ARMOR, f, 'forearm.l', 1).plate).toBeNull();
    expect(hitPlate(WARBULL_ARMOR, f, 'chest', 1, [0, 1.5, 0.3]).plate).toBeNull();
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
