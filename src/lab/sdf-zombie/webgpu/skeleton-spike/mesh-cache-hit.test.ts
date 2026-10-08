// src/lab/sdf-zombie/webgpu/skeleton-spike/mesh-cache-hit.test.ts
//
// A SECOND ASK FOR THE SAME SOURCE IS ONE LOOKUP. The bone renderer asks the mesh cache, and through it the
// anatomical skull's kit, for every drawn segment in every frame: a source object already answered for must come
// back as the same mesh without the sculpt being carved again, a key string being built, or the source being read.
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { parseBlob } from '../../blob-parse';
import { compileBlob } from '../../blob-compile';
import { buildBody, DEFAULT_BUILD_OPTS } from '../../build-body';
import { bindRig } from '../../rig-bind';
import zombieSrc from '../../characters/zombie.blob?raw';
import cultistSrc from '../../characters/cultist.blob?raw';
import { createSkeletonSources, type BoneFieldSource } from './contract';
import { ORGAN_MESHES, SegmentMeshCache } from './mesh';
import { meshBoneSource } from './mesh-skull';
import { sculptRecipe } from './sculpt-variant';
import { AnatomicalSkullKit } from './anatomical-skull';
import { anatomicalSkullSource } from './anatomical-skull.fixture';
import { ballHeadFit } from './skull-cast';

vi.mock('./mesh-skull', async (original) => {
  const m = await original<typeof import('./mesh-skull')>();
  return { ...m, meshBoneSource: vi.fn(m.meshBoneSource) };
});
const carves = vi.mocked(meshBoneSource);

const sourcesOf = (src: string, character: string) => {
  const body = buildBody(compileBlob(parseBlob(src)), DEFAULT_BUILD_OPTS);
  return createSkeletonSources(body, bindRig(body), { character, organs: true });
};
/** `source` behind a proxy that counts every property read of it. */
const watched = (source: BoneFieldSource) => {
  const seen = { reads: 0 };
  return { seen, source: new Proxy(source, { get: (t, k, r) => { seen.reads++; return Reflect.get(t, k, r); } }) };
};

describe('SegmentMeshCache.get on the game\'s recipe (the second sculpt)', () => {
  const zombie = sourcesOf(zombieSrc, 'zombie');
  const head = zombie.find(s => s.segment === 'head' && s.kind !== 'organ')!;

  it('a carved head: the second ask gives the same mesh, carves nothing and reads nothing of the source', () => {
    const cache = new SegmentMeshCache(undefined, undefined, null, sculptRecipe('full'));
    const w = watched(head);
    const first = cache.get(w.source);
    expect(carves.mock.calls.length).toBeGreaterThan(0);
    const carved = carves.mock.calls.length, read = w.seen.reads;
    expect(read).toBeGreaterThan(0);
    for (let frame = 0; frame < 3; frame++) expect(cache.get(w.source)).toBe(first);
    expect(carves.mock.calls.length).toBe(carved);
    expect(w.seen.reads).toBe(read);
    // Another source object of the same revision finds the same mesh by its key, extracting nothing.
    const twin = sourcesOf(zombieSrc, 'zombie').find(s => s.segment === 'head' && s.kind !== 'organ')!;
    const extracted = cache.stats().extractCount;
    expect(cache.get(twin)).toBe(first);
    expect(cache.stats().extractCount).toBe(extracted);
    cache.dispose();
  });

  it('every other bone the same; dispose forgets, and the next ask extracts again', () => {
    const cache = new SegmentMeshCache(undefined, undefined, null, sculptRecipe('full'));
    const bone = zombie.find(s => s.segment !== 'head' && s.kind !== 'organ')!;
    const w = watched(bone);
    const first = cache.get(w.source), carved = carves.mock.calls.length, read = w.seen.reads;
    expect(cache.get(w.source)).toBe(first);
    expect(carves.mock.calls.length).toBe(carved);
    expect(w.seen.reads).toBe(read);
    const count = cache.stats().extractCount;
    cache.dispose();
    expect(cache.get(w.source)).not.toBe(first);
    expect(cache.stats().extractCount).toBe(count + 1);
    cache.dispose();
  });

  it('an organ source is kept for the organ recipe it was built by: a new recipe builds it again, and that is kept in turn', () => {
    const organ = zombie.find(s => s.kind === 'organ')!;
    const cache = new SegmentMeshCache(undefined, ORGAN_MESHES['nets-10mm'], null, sculptRecipe('full'));
    const nets = cache.get(organ);
    expect(cache.get(organ)).toBe(nets);
    cache.organMesh = ORGAN_MESHES.tubes;
    const tubes = cache.get(organ);
    expect(tubes).not.toBe(nets);
    expect(tubes.key).not.toBe(nets.key);
    expect(cache.get(organ)).toBe(tubes);
    // And back: the first recipe's mesh is still in the cache under its key.
    cache.organMesh = ORGAN_MESHES['nets-10mm'];
    expect(cache.get(organ)).toBe(nets);
    cache.dispose();
  });
});

describe('AnatomicalSkullKit.head', () => {
  const kit = () => new AnatomicalSkullKit(anatomicalSkullSource(), new THREE.Texture(), new THREE.Vector2(1, 1), ballHeadFit);
  const cultist = sourcesOf(cultistSrc, 'cultist').find(s => s.segment === 'head' && s.kind !== 'organ')!;
  const zombieHead = sourcesOf(zombieSrc, 'zombie').find(s => s.segment === 'head' && s.kind !== 'organ')!;

  it('a fitted head: the second ask gives the same skull and reads nothing of the source, its flesh included', () => {
    const k = kit(), w = watched(cultist);
    const first = k.head(w.source)!;
    expect(first.fit).not.toBeNull();
    const read = w.seen.reads;
    for (let frame = 0; frame < 3; frame++) expect(k.head(w.source)).toBe(first);
    expect(w.seen.reads).toBe(read);
    expect(k.made).toHaveLength(1);
    k.dispose();
  });

  it('a head the plan leaves on its sculpted bone: null, and the second ask reads nothing', () => {
    const k = kit(), w = watched(zombieHead);
    expect(k.head(w.source)).toBeNull();
    const read = w.seen.reads;
    expect(k.head(w.source)).toBeNull();
    expect(w.seen.reads).toBe(read);
    k.dispose();
  });

  it('through the mesh cache: a fitted head\'s mesh is the kit\'s, and a second ask reaches neither the kit\'s fit nor the source', () => {
    const k = kit(), cache = new SegmentMeshCache(undefined, undefined, k, sculptRecipe('full'));
    const w = watched(cultist);
    const mesh = cache.get(w.source);
    expect(mesh).toBe(k.head(cultist)!.mesh);
    const read = w.seen.reads, carved = carves.mock.calls.length;
    expect(cache.get(w.source)).toBe(mesh);
    expect(w.seen.reads).toBe(read);
    expect(carves.mock.calls.length).toBe(carved);
    cache.dispose();
  });
});
