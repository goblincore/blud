// src/lab/sdf-zombie/webgpu/skeleton-spike/segment-instance.test.ts
//
// SHARED SEGMENT BATCH BUILDS (2026-10-28): pins the three r186 keying the shared builds rest on (two batches of a
// material give ONE render-object cache key, the nodeBuilderCache key; two InstancedMeshes give two) and the
// instance-row helpers. Constructible under vitest: RenderObject is built on stubs, no device.

import { describe, it, expect } from 'vitest';
import * as THREE from 'three/webgpu';
import { MeshBasicNodeMaterial } from 'three/webgpu';
// @ts-expect-error three ships no types for its internal modules
import RenderObject from 'three/src/renderers/common/RenderObject.js';
import {
  SEGMENT_MATRIX_ATTRS, SEGMENT_MATRIX_FLOATS, ensureSegmentMatrices, getSegmentMatrix, instancedShareOf,
  setSegmentMatrix, useSegmentInstance,
} from './segment-instance';

/** The render object's cache key three keys a node build by (NodeManager.getForRenderCacheKey: initialCacheKey). */
const buildKey = (object: THREE.Mesh, material: THREE.Material): unknown => {
  const renderer = { backend: { isWebGPUBackend: true }, contextNode: { id: 1, version: 0 }, _currentSourceMaterial: null };
  const nodes = { getCacheKey: () => 0 };
  const ro = new RenderObject(nodes, null, renderer, object, material, new THREE.Scene(), new THREE.PerspectiveCamera(), null, { id: 7 }, null);
  return (ro as { initialCacheKey: unknown }).initialCacheKey;
};
const segmentGeometry = (detail: number) => {
  const g = new THREE.SphereGeometry(1, 8 + detail, 6 + detail);
  g.setAttribute('meshFeature', new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count * 4), 4));
  return g;
};
const batchOf = (base: THREE.BufferGeometry, material: THREE.Material, n: number) => {
  const g = instancedShareOf(base);
  ensureSegmentMatrices(g, 16);
  g.setAttribute('iLights', new THREE.InstancedBufferAttribute(new Float32Array(16 * 4), 4));
  g.instanceCount = n;
  return new THREE.Mesh(g, material);
};

describe('segment batches share one node build per material (three r186 keying)', () => {
  it('two batches of different segment geometries on one material: one key, at any instance count', () => {
    const material = new MeshBasicNodeMaterial();
    useSegmentInstance(material);
    const a = batchOf(segmentGeometry(0), material, 1), b = batchOf(segmentGeometry(3), material, 40);
    expect(a.count).toBe(1);
    expect(b.count).toBe(1);
    expect(buildKey(a, material)).toBe(buildKey(b, material));
  });
  it('the InstancedMesh it replaces: a key per mesh (its uuid), so a build, a module and a pipeline per batch', () => {
    const material = new MeshBasicNodeMaterial();
    const a = new THREE.InstancedMesh(segmentGeometry(0), material, 16), b = new THREE.InstancedMesh(segmentGeometry(3), material, 16);
    expect(buildKey(a, material)).not.toBe(buildKey(b, material));
  });
  it('useSegmentInstance is idempotent and leaves the material otherwise as it was', () => {
    const material = new MeshBasicNodeMaterial();
    const plain = new MeshBasicNodeMaterial();
    useSegmentInstance(material);
    const once = material.setupPosition;
    useSegmentInstance(material);
    expect(material.setupPosition).toBe(once);
    expect(material.positionNode).toBe(plain.positionNode);
  });
});

describe('instance rows', () => {
  it('new rows are the identity; growth keeps the rows written; set/get round-trips', () => {
    const g = new THREE.BufferGeometry();
    const rows = ensureSegmentMatrices(g, 2);
    expect(rows.stride).toBe(SEGMENT_MATRIX_FLOATS);
    expect(rows.count).toBe(2);
    expect(SEGMENT_MATRIX_ATTRS.every(name => (g.getAttribute(name) as THREE.InterleavedBufferAttribute).data === rows)).toBe(true);
    const out = new THREE.Matrix4();
    expect(getSegmentMatrix(rows, 1, out).equals(new THREE.Matrix4())).toBe(true);
    const m = new THREE.Matrix4().compose(new THREE.Vector3(1, 2, 3), new THREE.Quaternion(0.1, 0.2, 0.3, 0.9).normalize(), new THREE.Vector3(1, 0.9, 1.1));
    setSegmentMatrix(rows, 1, m);
    expect(ensureSegmentMatrices(g, 1)).toBe(rows);
    const grown = ensureSegmentMatrices(g, 8);
    expect(grown).not.toBe(rows);
    expect(grown.count).toBe(8);
    getSegmentMatrix(grown, 1, out).elements.forEach((v, k) => expect(v).toBeCloseTo(m.elements[k]!, 6));
    expect(getSegmentMatrix(grown, 7, out).equals(new THREE.Matrix4())).toBe(true);
    // A column is a vec4 attribute at its offset in the row: column k of row 1 is m's column k.
    const col2 = g.getAttribute(SEGMENT_MATRIX_ATTRS[2]) as THREE.InterleavedBufferAttribute;
    expect([col2.getX(1), col2.getY(1), col2.getZ(1), col2.getW(1)].map(v => +v.toFixed(6))).toEqual(m.elements.slice(8, 12).map(v => +v.toFixed(6)));
  });
  it('instancedShareOf: the same vertex attributes and index, none of the base\'s instance data, no draw yet', () => {
    const base = segmentGeometry(0);
    base.setAttribute('iLights', new THREE.InstancedBufferAttribute(new Float32Array(4), 4));
    ensureSegmentMatrices(base, 1);
    base.userData.sculptPaint = 2;
    const g = instancedShareOf(base);
    expect(g.isInstancedBufferGeometry).toBe(true);
    expect(g.instanceCount).toBe(0);
    expect(g.index).toBe(base.index);
    expect(Object.keys(g.attributes).sort()).toEqual(['meshFeature', 'normal', 'position', 'uv']);
    for (const name of Object.keys(g.attributes)) expect(g.getAttribute(name)).toBe(base.getAttribute(name));
    expect(g.userData.sculptPaint).toBe(2);
  });
});
