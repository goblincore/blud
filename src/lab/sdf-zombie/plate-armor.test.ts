// src/lab/sdf-zombie/plate-armor.test.ts
import { describe, it, expect } from 'vitest';
import {
  JUGGERNAUT_ARMOR as A, blastPlates, freshPlates, hitPlate, isShed, plateFor, shedPlates,
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
