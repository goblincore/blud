// @vitest-environment node
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { packChunkBake, chunkBakeTransfers, unpackChunkBake } from './chunk-bake-buffers';

describe('worker mesh transfer', () => {
  it.each([Uint16Array, Uint32Array])('preserves geometry, normals, colours and collision bounds with %s indices', (Index) => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([1, 2, 3, 4, 2, 3, 1, 5, 3], 3));
    geometry.setAttribute('bakeColor', new THREE.Float32BufferAttribute([.3, .2, .1, 1, .6, .4, .2, .5, .9, .6, .3, 0], 4));
    geometry.setIndex(new THREE.BufferAttribute(new Index([0, 1, 2]), 1));
    geometry.computeVertexNormals();
    const expected = ['position', 'normal', 'bakeColor'].map(name => Array.from(geometry.getAttribute(name).array));
    const packed = packChunkBake({ geometry, centre: [2.5, 3.5, 3], radius: 2.2, verts: 3, tris: 1, bakeMs: 50, overflow: false, droppedQuads: 0 });
    const received = structuredClone(packed, { transfer: chunkBakeTransfers(packed) });
    expect(packed.positions.byteLength).toBe(0);
    const result = unpackChunkBake(received);
    for (const [i, name] of ['position', 'normal', 'bakeColor'].entries()) {
      expect(Array.from(result.geometry.getAttribute(name).array)).toEqual(expected[i]);
    }
    expect(result.geometry.getAttribute('position').array).toBe(received.positions);
    expect(result.geometry.index!.array).toBeInstanceOf(Index);
    expect(Array.from(result.geometry.index!.array)).toEqual([0, 1, 2]);
    expect(result.geometry.boundingSphere!.center.toArray()).toEqual([2.5, 3.5, 3]);
    expect(result.geometry.boundingSphere!.radius).toBe(2.2);
    expect(result.bakeMs).toBe(50);
    result.geometry.dispose();
    geometry.dispose();
  });
});
