import { describe, expect, it } from 'vitest';
import { createZombieActor } from './game-actor';
import { buildBody, DEFAULT_BUILD_OPTS } from '../build-body';
import { makeZombie } from '../body';
import type { Wound } from '../damage';
import type { Vec3 } from '../types';
import { createWoundRing } from './character-view';
import { writeWounds } from './zombie-gpu';
import { DATA_ROWS, ROW_WOUND_CAP } from './march.wgsl';

function fixture(boundedWounds: boolean) {
  const body = buildBody(makeZombie(), DEFAULT_BUILD_OPTS, {});
  const severed: string[] = [];
  let upload: { positions: Vec3[]; radii: number[]; types: number[] } = { positions: [], radii: [], types: [] };
  const view = { update() {}, setRootShift() {}, setHeadRotation() {}, setTime() {},
    setWounds(positions: Vec3[], radii: number[], types: number[]) { upload = { positions, radii, types }; },
  };
  const actor = createZombieActor({ id: 1, room: 0, body, view: view as never, start: [0, 0, 0], seed: 1,
    bounds: { minX: -5, maxX: 5, minZ: -5, maxZ: 5 }, furniture: [], boundedWounds,
    onSever: piece => severed.push(piece.limb) });
  const primIdx = body.prims.findIndex(p => p.limb === 'torso' && p.op === 'add');
  const wound: Wound = { primIdx, local: [.1, 0, 0], radius: .055, type: 'pellet', ageSec: 0 };
  return { actor, wound, upload: () => upload, severed };
}

describe('bounded torso game preview', () => {
  it('preserves projectile sever decisions and sever notifications', () => {
    const control = fixture(false), preview = fixture(true);
    const p = control.actor.posed().prims.find(p => p.limb === 'armL' && p.op === 'add')!;
    const point: Vec3 = [p.a[0], p.a[1], p.a[2] + p.radius];
    for (let i = 0; i < 8; i++) {
      control.actor.hitSlug(point, [0, 0, -1]);
      preview.actor.hitSlug(point, [0, 0, -1]);
    }
    preview.actor.advanceWoundPreview(.4);
    expect(preview.severed.length).toBeGreaterThan(0);
    expect(preview.severed).toEqual(control.severed);
    expect(preview.actor.body).toEqual(control.actor.body);
    expect(preview.actor.wounds()).toEqual(control.actor.wounds());
  });
  it('clears an old depth cap when a preview slot becomes an uncapped stump', () => {
    const { actor, wound } = fixture(true);
    const ring = createWoundRing(), texels = new Float32Array(128 * DATA_ROWS * 4);
    const view = { setWounds(positions: Vec3[], radii: number[], types: number[], ages: number[], splay: number[], offsets: number[], caps: never) {
      writeWounds(texels, positions, radii, types, ages, splay, offsets, {}, caps);
    } };
    ring.refresh(view as never, actor.posed(), 0, [{ ...wound, presetCut: true, carveN: [0, 0, -1], carveDepth: .04 }]);
    expect(texels[ROW_WOUND_CAP * 128 * 4 + 3]).toBeCloseTo(.04);
    ring.refresh(view as never, actor.posed(), 0, [{ ...wound, type: 'blast' }]);
    expect(Array.from(texels.slice(ROW_WOUND_CAP * 128 * 4, ROW_WOUND_CAP * 128 * 4 + 4))).toEqual([0, 0, 0, 0]);
    ring.refresh(view as never, actor.posed(), 0, []);
  });
  it('keeps gameplay history while uploading only two cutters after saturation', () => {
    const { actor, wound, upload } = fixture(true);
    actor.stampBlast(Array.from({ length: 20 }, () => ({ ...wound })));
    expect(actor.wounds()).toHaveLength(16);
    actor.advanceWoundPreview(.4);
    expect(upload().types).toEqual([-1, -1]);
    expect(upload().radii).toEqual([.12, .07]);
    expect(actor.visualWounds()).toHaveLength(2);
    expect(actor.wounds().every(w => w.radius === .055)).toBe(true);
  });

  it('advances a frozen actor without moving its rig and stops refreshing once settled', () => {
    const { actor, wound, upload } = fixture(true);
    actor.stampBlast([wound]);
    const before = actor.posed();
    actor.advanceWoundPreview(.08);
    expect(upload().radii).toEqual([.0375]);
    expect(actor.posed()).toEqual(before);
    expect(actor.advanceWoundPreview(.08)).toBe(true);
    expect(actor.advanceWoundPreview(.08)).toBe(false);
    expect(upload().radii).toEqual([.075]);
  });

  it('leaves the normal game upload unchanged and isolates respawned actors', () => {
    const { actor, wound, upload } = fixture(false);
    actor.stampBlast([wound, wound, wound]);
    actor.advanceWoundPreview(1);
    expect(upload().types).toEqual([0, 0, 0]);
    expect(actor.visualWounds()).toEqual(actor.wounds());
    expect(fixture(true).actor.visualWounds()).toEqual([]);
  });
});
