import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { MeshBasicNodeMaterial, Node } from 'three/webgpu';
import { createSegmentMeshRenderer } from './mesh-renderer';
import { BONE_HASH_WGSL, BONE_NOISE_WGSL, BONE_SHADE_WGSL } from '../bone-instancer';
import { BODY_LIGHTS } from '../march/body-lights.wgsl';
import { AnatomicalSkullKit } from './anatomical-skull';
import { anatomicalSkullSource } from './anatomical-skull.fixture';
import { parseBlob } from '../../blob-parse';
import { compileBlob } from '../../blob-compile';
import { buildBody, DEFAULT_BUILD_OPTS } from '../../build-body';
import { bindRig } from '../../rig-bind';
import zombie from '../../characters/zombie.blob?raw';
import soldier from '../../characters/soldier.blob?raw';
import { createSkeletonSources } from './contract';
import { extractSegmentMesh, MESH_CELL, SegmentMeshCache } from './mesh';
import {
  MESH_BONE_SURFACE_WGSL, MESH_BONE_WET_WGSL, MESH_SKULL_CAVITY_WGSL, MESH_SOCKET_VESSEL_WGSL, MESH_TOOTH_ROW_WGSL,
} from './mesh-appearance';
import { createBoneMeshCache } from './sculpt-cache';
import { SCULPT_PAINT_SHAPE1, SCULPT_PAINT_SHAPE2, sculptPaintSources } from './sculpt-paint';
import { SCULPT_CLASSIC, SCULPT_DEFAULT_VARIANT, SCULPT_FINE_CELL, resolveSkull, sculptRecipe } from './sculpt-variant';

// TWO LOOKS OF THE SCULPTED SKULL ARE PINNED, by the zombie's and the soldier's head mesh bytes and the paint's shader
// text: a change to either is a change to what the game draws, and must be made on purpose (and the pin moved with
// it, in the same commit, saying why).
//   THE DEFAULT: what a page with no skull parameter draws, the variant `full` (the second sculpt at a 5 mm head
//     cell, under the second paint). The owner played this look and chose it on 2026-10-07; the hashes were taken
//     from the tree that made it the default.
//   THE FIRST LOOK: the variant `classic` (`?sculpt=classic`), which is what `?skull=sculpt` drew before the variants
//     existed. Its hashes were taken from the tree before the variants were added (f127e868) and have not moved.

/** FNV-1a over bytes, as 8 hex digits per 32-bit half (two seeds: 64 bits). */
function hash(...parts: (string | ArrayBufferView)[]): string {
  let a = 0x811c9dc5, b = 0x01000193;
  for (const part of parts) {
    const bytes = typeof part === 'string' ? new TextEncoder().encode(part) : new Uint8Array(part.buffer, part.byteOffset, part.byteLength);
    for (const v of bytes) {
      a = Math.imul(a ^ v, 0x01000193) >>> 0;
      b = Math.imul(b ^ v ^ (a >>> 13), 0x85ebca6b) >>> 0;
    }
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}
const headOf = (character: string, blob: string) => {
  const body = buildBody(compileBlob(parseBlob(blob)), DEFAULT_BUILD_OPTS);
  return createSkeletonSources(body, bindRig(body), { character }).find(s => s.segment === 'head')!;
};
const bytes = (m: ReturnType<typeof extractSegmentMesh>) =>
  hash(m.geometry.getAttribute('position').array as Float32Array, Uint32Array.from(m.geometry.getIndex()!.array));
const noKit = () => Promise.reject(new Error('no asset in this test'));
const BLOBS = [['zombie', zombie], ['soldier', soldier]] as const;

const CLASSIC = {
  zombie: { key: 'zombie:head:2:77b0c2d:skull-sculpt-1@0.01', verts: 2220, tris: 4448, bytes: '492f9fb76d46f916' },
  soldier: { key: 'soldier:head:2:11a18b47:soldier-skull-sculpt-1@0.01', verts: 1686, tris: 3392, bytes: '4eef1460c3417114' },
  wgsl: '8232c6723fa94dba',
};
const DEFAULT = {
  zombie: { key: 'zombie:head:2:77b0c2d:skull-sculpt-2@0.005', verts: 9144, tris: 18296, bytes: '44f3c7f58b87817c' },
  soldier: { key: 'soldier:head:2:11a18b47:soldier-skull-sculpt-2@0.005', verts: 7056, tris: 14108, bytes: 'f470bb51944b39b1' },
  wgsl: '61ebace5c3abd470',
  // Every WGSL text the default page's bone material reaches (the second paint, the bone hash and noise, the shade).
  material: '22a19cc4defab95a',
};
/** The name a WGSL source declares first. */
const nameOf = (src: string): string => /\bfn (\w+)/.exec(src)![1]!;
/** EVERY WGSL FUNCTION TEXT A MATERIAL'S NODE REACHES: the functions it calls and everything they include, by the
 *  name each declares. Two texts under one name fail here. */
function wgslReached(root: Node): Map<string, string> {
  type Fn = { code: string; includes?: readonly Fn[] };
  const out = new Map<string, string>(), seen = new Set<Node>(), todo: Node[] = [root];
  const take = (fn: Fn) => {
    const name = nameOf(fn.code), had = out.get(name);
    if (had !== undefined && had !== fn.code) throw new Error(`two texts of ${name}`);
    if (had !== undefined) return;
    out.set(name, fn.code);
    for (const inc of fn.includes ?? []) take(inc);
  };
  while (todo.length) {
    const n = todo.pop()!;
    if (seen.has(n)) continue;
    seen.add(n);
    const fn = (n as Node & { functionNode?: Fn }).functionNode;
    if (fn) take(fn);
    for (const c of n.getChildren()) todo.push(c as Node);
  }
  return out;
}

describe('the default skull is pinned: the sculpted skull, full', () => {
  it('the default is `full`: the second sculpt, a 5 mm head cell, the second paint', () => {
    expect(SCULPT_DEFAULT_VARIANT).toBe('full');
    expect(resolveSkull('').recipe).toBe(sculptRecipe('full'));
    expect(sculptRecipe('full')).toEqual({ shape: 2, headCell: 0.005, paint: 2 });
    expect(SCULPT_FINE_CELL).toBe(0.005);
  });

  it.each(BLOBS)('%s: the head mesh, byte for byte', async (character, blob) => {
    const pin = DEFAULT[character];
    const direct = extractSegmentMesh(headOf(character, blob), SCULPT_FINE_CELL, undefined, 2);
    expect([direct.key, direct.verts, direct.tris]).toEqual([pin.key, pin.verts, pin.tris]);
    expect(bytes(direct)).toBe(pin.bytes);
    // The page's own cache for a query that names no skull, for ?skull=sculpt, and the caches built from the default
    // recipe and from `full`'s: all the same mesh.
    const caches = [
      await createBoneMeshCache('', () => {}, noKit), await createBoneMeshCache('?skull=sculpt', () => {}, noKit), await createBoneMeshCache('?sculpt=full', () => {}, noKit),
      new SegmentMeshCache(MESH_CELL, undefined, null, sculptRecipe(SCULPT_DEFAULT_VARIANT)), new SegmentMeshCache(MESH_CELL, undefined, null, sculptRecipe('full')),
    ];
    for (const cache of caches) {
      const head = headOf(character, blob);
      expect(cache.skullKit).toBeNull();
      expect(cache.keyOf(head)).toBe(pin.key);
      expect(bytes(cache.get(head))).toBe(pin.bytes);
      cache.dispose();
    }
    direct.geometry.dispose();
  });

  it.each(BLOBS)('%s: the same mesh on the default page WITH the plates loaded: the anatomical skull is the eight ball heads\', not his', async (character, blob) => {
    // The page as it boots: the plates' asset loaded into a kit with the resolver's plan.
    const cache = await createBoneMeshCache('', () => {}, plan => Promise.resolve(new AnatomicalSkullKit(anatomicalSkullSource(), new THREE.Texture(), new THREE.Vector2(1, 1), plan)));
    const kit = cache.skullKit!, head = headOf(character, blob), pin = DEFAULT[character];
    expect(kit).not.toBeNull();
    expect(kit.fitOf(character)).toBeNull();
    expect(kit.supports(head)).toBe(false);
    expect(kit.head(head)).toBeNull();
    expect(cache.keyOf(head)).toBe(pin.key);
    expect(bytes(cache.get(head))).toBe(pin.bytes);
    // And the kit made nothing for him.
    expect(kit.made).toEqual([]);
    expect(kit.fitOf('cultist')).toEqual(resolveSkull('').anatomical.cultist);
    cache.dispose();
  });

  it('the second paint\'s shader text, as written for the second sculpt', () => {
    expect(hash(...sculptPaintSources(SCULPT_PAINT_SHAPE2))).toBe(DEFAULT.wgsl);
  });

  it('WHAT THE DEFAULT PAGE\'S BONE MATERIAL RECEIVED is that text: the WGSL its colour reaches, with the bone hash, the noise and the shade it includes', async () => {
    // The page as it boots, the plates loaded: its cache, the renderer on it, the zombie's and the soldier's heads.
    const cache = await createBoneMeshCache('', () => {}, plan => Promise.resolve(new AnatomicalSkullKit(anatomicalSkullSource(), new THREE.Texture(), new THREE.Vector2(1, 1), plan)));
    const renderer = createSegmentMeshRenderer(cache);
    const heads = BLOBS.map(([character, blob]) => headOf(character, blob));
    renderer.update(heads.map(h => [h]), heads.map((_, id) => ({ id })));
    const received = heads.map((head) => {
      const batch = renderer.object.children.find(c => (c as THREE.InstancedMesh).geometry === cache.get(head).geometry) as THREE.InstancedMesh;
      const material = batch.material as MeshBasicNodeMaterial;
      expect([material.name, material.userData.sculptPaint]).toEqual(['skeleton-bone', 2]);
      return { material, code: wgslReached(material.colorNode!) };
    });
    // One material for both heads, and what it reaches is the same text whichever head asks.
    expect(received[1]!.material).toBe(received[0]!.material);
    const code = received[0]!.code;
    // Every function of the pinned second paint is there, text for text, in the second sculpt's layout, and none of
    // the first sculpt's layout is.
    const pinned = sculptPaintSources(SCULPT_PAINT_SHAPE2);
    for (const src of pinned) expect(code.get(nameOf(src)), nameOf(src)).toBe(src);
    for (const src of sculptPaintSources(SCULPT_PAINT_SHAPE1)) if (!pinned.includes(src)) expect([...code.values()]).not.toContain(src);
    // With them, the bone hash and noise the paint calls, and the forward shade with the light list it includes.
    const shared = [BONE_HASH_WGSL, BONE_NOISE_WGSL, BONE_SHADE_WGSL, BODY_LIGHTS];
    for (const src of shared) expect(code.get(nameOf(src)), nameOf(src)).toBe(src);
    // The shade is built with everything declared before it as an include (mesh-renderer.ts's chain), so the first
    // paint's five functions ride into the shader's text as well. The second paint's material calls none of them
    // (sculpt-renderer.test.ts holds the calls); they are part of the text it received, and of this pin.
    const carried = [MESH_TOOTH_ROW_WGSL, MESH_SKULL_CAVITY_WGSL, MESH_SOCKET_VESSEL_WGSL, MESH_BONE_SURFACE_WGSL, MESH_BONE_WET_WGSL];
    for (const src of carried) expect(code.get(nameOf(src)), nameOf(src)).toBe(src);
    expect([...code.keys()].sort()).toEqual([...pinned, ...shared, ...carried].map(nameOf).sort());
    // The pin: every one of those texts, in the order of their names.
    expect(hash(...[...code.keys()].sort().map(k => code.get(k)!))).toBe(DEFAULT.material);
    renderer.dispose(); cache.dispose();
  });
});

describe('the first look is pinned, and reached through `classic`', () => {
  it.each(BLOBS)('%s: the head mesh, byte for byte', async (character, blob) => {
    const pin = CLASSIC[character];
    const direct = extractSegmentMesh(headOf(character, blob));
    expect([direct.key, direct.verts, direct.tris]).toEqual([pin.key, pin.verts, pin.tris]);
    expect(bytes(direct)).toBe(pin.bytes);
    // The page's cache for ?sculpt=classic, the cache with no recipe, with the classic recipe, and with the recipe of
    // the variant `classic`: all the same mesh.
    const caches = [
      await createBoneMeshCache('?sculpt=classic', () => {}, noKit), await createBoneMeshCache('?skull=sculpt&sculpt=classic', () => {}, noKit),
      new SegmentMeshCache(), new SegmentMeshCache(MESH_CELL, undefined, null, SCULPT_CLASSIC), new SegmentMeshCache(MESH_CELL, undefined, null, sculptRecipe('classic')),
    ];
    for (const cache of caches) {
      const head = headOf(character, blob);
      expect(cache.keyOf(head)).toBe(pin.key);
      expect(bytes(cache.get(head))).toBe(pin.bytes);
      cache.dispose();
    }
    direct.geometry.dispose();
  });

  it('the first paint\'s shader text', () => {
    expect(hash(MESH_TOOTH_ROW_WGSL, MESH_SKULL_CAVITY_WGSL, MESH_SOCKET_VESSEL_WGSL, MESH_BONE_SURFACE_WGSL, MESH_BONE_WET_WGSL)).toBe(CLASSIC.wgsl);
  });

  it('the two looks are different meshes and different shader text', () => {
    for (const character of ['zombie', 'soldier'] as const) expect(DEFAULT[character].bytes).not.toBe(CLASSIC[character].bytes);
    expect(DEFAULT.wgsl).not.toBe(CLASSIC.wgsl);
  });
});
