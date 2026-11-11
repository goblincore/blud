// src/lab/sdf-zombie/webgpu/wound-ring-baked.test.ts
//
// A wound baked into the wound volume has left the ring, not the body (WoundRing.baked). The sever rules, the
// wounded limbs and the skeleton's / organs' exposure read the ring's wounds AND the baked ones; before this they
// read the ring alone, so a body's 33rd wound stopped counting toward a sever and exposed no bone.
import { describe, expect, it } from 'vitest';
import zombieSrc from '../characters/zombie.blob?raw';
import { parseBlob } from '../blob-parse';
import { compileBlob } from '../blob-compile';
import { buildBody, type BuildResult } from '../build-body';
import { sdBody } from '../validate';
import { MAX_WOUNDS, worldHitToWound, type Wound } from '../damage';
import { boneExposureOf } from '../cut-wound';
import type { Vec3 } from '../types';
import { MAX_BAKED_RECORD, createWoundRing } from './character-view';
import { createWoundVolumeAtlas } from './wound-volume-store';
import { recordWoundCount } from './zombie-gpu';

const body: BuildResult = buildBody(compileBlob(parseBlob(zombieSrc)));
const field = (p: Vec3) => sdBody(p, body);

/** Pellet wounds across the chest's front, `n` of them, each a little apart. */
function chestWounds(n: number): Wound[] {
  const out: Wound[] = [];
  for (let i = 0; i < n; i++) {
    const x = ((i % 8) - 3.5) * 0.03, y = 1.15 + Math.floor(i / 8) * 0.025;
    let t = 0;
    const o: Vec3 = [x, y, 1], d: Vec3 = [0, 0, -1];
    let hit: Vec3 | null = null;
    for (let k = 0; k < 400 && !hit; k++) {
      const p: Vec3 = [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t], s = field(p);
      if (s < 1e-4) hit = p; else t += Math.max(s * 0.9, 1e-4);
    }
    if (!hit) throw new Error(`shot ${i} missed`);
    out.push(worldHitToWound(body.prims, hit, 0.03, 'pellet', 0, field));
  }
  return out;
}

/** A view that takes the volume's table and the list's rows and keeps neither. */
const gpu = { setWoundVolumes() {}, setWounds() {} } as never;

describe('the wound ring remembers what it baked', () => {
  it('keeps the wounds past the list on record once they are stamped, oldest first', () => {
    createWoundVolumeAtlas(); // the module loads without a renderer
    const ring = createWoundRing();
    const shots = chestWounds(MAX_WOUNDS + 10);
    for (const w of shots) ring.stamp(w, body, 0);
    expect(ring.all()).toHaveLength(MAX_WOUNDS);
    expect(ring.baked()).toHaveLength(0);            // not until the next refresh has the pose to stamp against
    ring.refresh(gpu, body, 0);
    expect(ring.baked()).toHaveLength(10);
    expect(ring.baked().map(w => w.eventId)).toEqual(shots.slice(0, 10).map(w => w.eventId));
    // Nothing is in both.
    const live = new Set(ring.all());
    expect(ring.baked().some(w => live.has(w))).toBe(false);
    ring.dispose();
    expect(ring.baked()).toHaveLength(0);
  });

  it('forgets the oldest past its cap and the wounds of a primitive that died', () => {
    const ring = createWoundRing();
    for (const w of chestWounds(MAX_WOUNDS + 4)) ring.stamp(w, body, 0);
    ring.refresh(gpu, body, 0);
    const prim = ring.baked()[0]!.primIdx;
    const dead: BuildResult = { ...body, prims: body.prims.map((p, i) => (i === prim ? { ...p, dead: true } : p)) };
    // The prune runs with the next stamp, against the pose it is handed.
    ring.stamp(chestWounds(1)[0]!, body, 0);
    ring.refresh(gpu, dead, 0);
    expect(ring.baked().every(w => w.primIdx !== prim)).toBe(true);
    expect(MAX_BAKED_RECORD).toBeGreaterThanOrEqual(128);
  });

  it('a baked wound still exposes bone and organs: boneExposureOf reads the baked ones after the list', () => {
    const [a, b] = chestWounds(2) as [Wound, Wound];
    const actor = { posed: () => body, pose: () => ({ yaw: 0 }), visualWounds: () => [a] };
    const listOnly = boneExposureOf(actor);
    const both = boneExposureOf({ ...actor, bakedWounds: () => [b] });
    expect(listOnly.length).toBeGreaterThan(0);
    expect(both.length).toBeGreaterThan(listOnly.length);
    expect(both.slice(0, listOnly.length)).toEqual(listOnly);   // the list's first, unchanged
    // A baked wound on a dead primitive exposes nothing.
    const dead: BuildResult = { ...body, prims: body.prims.map((p, i) => (i === b.primIdx ? { ...p, dead: true } : p)) };
    expect(boneExposureOf({ ...actor, posed: () => dead, visualWounds: () => [], bakedWounds: () => [b] })).toHaveLength(0);
  });

  it('a body with boxes and an empty list is not marched as unwounded', () => {
    const u = (x: number, on?: number) => ({ woundCfg: { value: { x } }, ...(on === undefined ? {} : { woundVolumeOn: { value: on } }) });
    expect(recordWoundCount(u(0))).toBe(0);
    expect(recordWoundCount(u(0, 0))).toBe(0);
    // Below 1, so the list's loops run zero times; not below 0.5, so the lean walk's test fails.
    const marked = recordWoundCount(u(0, 1));
    expect(Math.trunc(marked)).toBe(0);
    expect(marked < 0.5).toBe(false);
    expect(recordWoundCount(u(7, 1))).toBe(7);
  });
});
