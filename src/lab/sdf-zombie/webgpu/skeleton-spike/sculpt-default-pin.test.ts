import { describe, expect, it } from 'vitest';
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
import { SCULPT_DEFAULT, sculptRecipe } from './sculpt-variant';

// THE DEFAULT SCULPTED SKULL IS PINNED. `?skull=sculpt` with no `?sculpt=` must draw what it drew before the variants
// existed: the same mesh bytes for the zombie's and the soldier's head, and the same shader text. The hashes below
// were taken from the tree before the variants were added (f127e868).

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

const PINNED = {
  zombie: { key: 'zombie:head:2:77b0c2d:skull-sculpt-1@0.01', verts: 2220, tris: 4448, bytes: '492f9fb76d46f916' },
  soldier: { key: 'soldier:head:2:11a18b47:soldier-skull-sculpt-1@0.01', verts: 1686, tris: 3392, bytes: '4eef1460c3417114' },
  wgsl: '8232c6723fa94dba',
};

describe('the default sculpted skull is unchanged', () => {
  it.each([['zombie', zombie], ['soldier', soldier]] as const)('%s: the head mesh, byte for byte', (character, blob) => {
    const pin = PINNED[character];
    const direct = extractSegmentMesh(headOf(character, blob));
    expect([direct.key, direct.verts, direct.tris]).toEqual([pin.key, pin.verts, pin.tris]);
    expect(bytes(direct)).toBe(pin.bytes);
    // The cache with no recipe, with the default recipe, and with the recipe of no variant: all the same mesh.
    for (const cache of [new SegmentMeshCache(), new SegmentMeshCache(MESH_CELL, undefined, null, SCULPT_DEFAULT), new SegmentMeshCache(MESH_CELL, undefined, null, sculptRecipe(null))]) {
      const head = headOf(character, blob);
      expect(cache.keyOf(head)).toBe(pin.key);
      expect(bytes(cache.get(head))).toBe(pin.bytes);
      cache.dispose();
    }
    direct.geometry.dispose();
  });

  it('the first paint\'s shader text', () => {
    expect(hash(MESH_TOOTH_ROW_WGSL, MESH_SKULL_CAVITY_WGSL, MESH_SOCKET_VESSEL_WGSL, MESH_BONE_SURFACE_WGSL, MESH_BONE_WET_WGSL)).toBe(PINNED.wgsl);
  });
});
