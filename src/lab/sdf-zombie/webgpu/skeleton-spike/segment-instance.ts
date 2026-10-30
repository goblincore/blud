// src/lab/sdf-zombie/webgpu/skeleton-spike/segment-instance.ts
//
// Skeleton segment batches drawn instanced from a NAMED per-instance matrix attribute, so every batch of a material
// shares one node build, one shader module per stage and one pipeline (shared segment batch builds, 2026-10-28).
// The skeleton's segment batches (mesh-renderer.ts: one per segment
// geometry, ~20 bone + 2 organ per character type, ~120 on E1M1) were THREE.InstancedMesh, and three r186 can not
// share anything between two instanced meshes on one material:
//  - RenderObject.getMaterialCacheKey adds `object.uuid` for `object.isInstancedMesh || object.count > 1` (a TODO,
//    three PR 29066), and that key is NodeManager.getForRender's nodeBuilderCache key: every batch ran its own TSL
//    NodeBuilder.build (~20-25 ms on the main thread);
//  - the InstancedMesh's instance matrix (Instance.js createInstanceMatrixNode, a uniform `buffer()` up to the
//    uniform limit) is named by its node id in the WGSL, so the vertex modules differ by that one name and the
//    program cache (Pipelines.programs, keyed by shader CODE) and the pipeline cache missed as well: a module and a
//    pipeline per batch.
// So a batch is a plain THREE.Mesh on an InstancedBufferGeometry instead (RenderObject.getDrawParameters takes the
// draw's instance count from `geometry.instanceCount`; the mesh's own `count` stays 1, so its uuid stays out of the
// key), and the instance matrix is a NAMED per-instance attribute like iLights: one InstancedInterleavedBuffer of 16
// floats a row, read as the four vec4 columns SEGMENT_MATRIX_ATTRS (one vertex buffer, as three's own interleaved
// instance path binds it). A named attribute is bound per render object from its own geometry, so nothing in the
// node build belongs to one batch: every batch of a material (and an attribute layout) shares one build, one shader
// module per stage and one pipeline. The vertex transform is three's own instancing (Instance.js), done by
// segmentInstance from each segment material's setupPosition (useSegmentInstance).
// A plain debris mesh on a segment material (a plate or fragment that came off, an ejected eye) carries one identity
// row (ensureSegmentMatrices), so it shares the batches' build too.

import * as THREE from 'three/webgpu';
import type { NodeBuilder, NodeMaterial } from 'three/webgpu';
import { Fn, attribute, mat4, normalLocal, positionLocal, transformNormal } from 'three/tsl';

/** The instance matrix's four columns, in this order, in one row of SEGMENT_MATRIX_FLOATS (column-major, as
 *  Matrix4.toArray writes it). */
export const SEGMENT_MATRIX_ATTRS = ['iM0', 'iM1', 'iM2', 'iM3'] as const;
export const SEGMENT_MATRIX_FLOATS = 16;

/** The geometry's instance-matrix rows, at least `cap` of them (grown with the batch, the rows kept; a new row is the
 *  identity). The buffer, not its attributes: write rows with setSegmentMatrix, upload with its update range. */
export function ensureSegmentMatrices(geometry: THREE.BufferGeometry, cap: number): THREE.InstancedInterleavedBuffer {
  const cur = (geometry.getAttribute(SEGMENT_MATRIX_ATTRS[0]) as THREE.InterleavedBufferAttribute | undefined)?.data as THREE.InstancedInterleavedBuffer | undefined;
  if (cur && cur.count >= cap) return cur;
  const n = Math.max(cap, 1), array = new Float32Array(n * SEGMENT_MATRIX_FLOATS);
  for (let i = 0; i < n; i++) array[i * 16] = array[i * 16 + 5] = array[i * 16 + 10] = array[i * 16 + 15] = 1;
  if (cur) array.set(cur.array as Float32Array);
  const next = new THREE.InstancedInterleavedBuffer(array, SEGMENT_MATRIX_FLOATS);
  next.setUsage(THREE.DynamicDrawUsage);
  SEGMENT_MATRIX_ATTRS.forEach((name, k) => geometry.setAttribute(name, new THREE.InterleavedBufferAttribute(next, 4, k * 4)));
  return next;
}

/** Row `i` of `rows` := `m` (the instance's world matrix, as InstancedMesh.setMatrixAt wrote it). */
export function setSegmentMatrix(rows: THREE.InstancedInterleavedBuffer, i: number, m: THREE.Matrix4): void {
  m.toArray(rows.array as Float32Array, i * SEGMENT_MATRIX_FLOATS);
}

/** Row `i` of `rows`, into `out`. */
export function getSegmentMatrix(rows: THREE.InstancedInterleavedBuffer, i: number, out: THREE.Matrix4): THREE.Matrix4 {
  return out.fromArray(rows.array as Float32Array, i * SEGMENT_MATRIX_FLOATS);
}

/** A batch's draw geometry for the segment (or eye) geometry `base`: the SAME vertex attributes and index (shared
 *  objects, one set of GPU buffers), instance attributes of its own, and `instanceCount` the draw's (0: no draw).
 *  Instanced attributes of `base` are not carried (a batch has its own). Its user data is the base's (the paint, the
 *  plate flag the materials are picked by). */
export function instancedShareOf(base: THREE.BufferGeometry): THREE.InstancedBufferGeometry {
  const g = new THREE.InstancedBufferGeometry();
  for (const [name, attr] of Object.entries(base.attributes)) {
    const a = attr as THREE.BufferAttribute | THREE.InterleavedBufferAttribute;
    const instanced = (a as THREE.InstancedBufferAttribute).isInstancedBufferAttribute
      || ((a as THREE.InterleavedBufferAttribute).data as { isInstancedInterleavedBuffer?: boolean } | undefined)?.isInstancedInterleavedBuffer;
    if (!instanced) g.setAttribute(name, a);
  }
  g.setIndex(base.index);
  g.userData = { ...base.userData };
  g.instanceCount = 0;
  return g;
}

/** A segment batch's mesh (mesh-renderer.ts batchFor): a plain Mesh on an InstancedBufferGeometry. */
export type SegmentBatchMesh = THREE.Mesh<THREE.InstancedBufferGeometry>;
/** Whether `object` is a segment batch (diagnostics and tests: the batches are no longer InstancedMeshes). */
export function isSegmentBatch(object: THREE.Object3D): object is SegmentBatchMesh {
  return !!(object as SegmentBatchMesh).geometry?.isInstancedBufferGeometry && !!(object as SegmentBatchMesh).geometry.getAttribute(SEGMENT_MATRIX_ATTRS[0]);
}
/** Whether the batch `object` draws the segment (or eye) geometry `geometry`: a split batch draws its twin itself, a
 *  closed batch a share of the segment's geometry (its `userData.segmentBase`). */
export function batchDraws(object: THREE.Object3D, geometry: THREE.BufferGeometry): boolean {
  if (!isSegmentBatch(object)) return false;
  return object.geometry === geometry || object.geometry.userData.segmentBase === geometry;
}
/** The batch's instances drawn this update. */
export const batchInstances = (mesh: SegmentBatchMesh): number => mesh.geometry.instanceCount;
/** The batch's instance `i`'s matrix, into `out`. */
export const batchMatrixAt = (mesh: SegmentBatchMesh, i: number, out: THREE.Matrix4): THREE.Matrix4 =>
  getSegmentMatrix(ensureSegmentMatrices(mesh.geometry, 0), i, out);

/** Three's instancing (Instance.js `instance`), from the named instance-matrix attributes: the position, and the
 *  normal by the matrix's inverse transpose (exact for the head deform's axis scales, as InstancedMesh's was). */
export const segmentInstance = Fn((builder: NodeBuilder) => {
  const m = mat4(...SEGMENT_MATRIX_ATTRS.map(name => attribute(name, 'vec4')) as [never, never, never, never]);
  positionLocal.assign(m.mul(positionLocal).xyz);
  if ((builder as unknown as { hasGeometryAttribute(name: string): boolean }).hasGeometryAttribute('normal')) {
    normalLocal.assign(transformNormal(normalLocal, m as never));
  }
}, 'void');

/** Draw `material` instanced by the segment-matrix attributes: segmentInstance runs at the head of its vertex
 *  position setup, where three runs an InstancedMesh's. Idempotent. */
export function useSegmentInstance(material: NodeMaterial): void {
  const m = material as NodeMaterial & { setupPosition(builder: NodeBuilder): unknown; userData: { segmentInstance?: boolean } };
  if (m.userData.segmentInstance) return;
  m.userData.segmentInstance = true;
  const base = m.setupPosition.bind(m);
  m.setupPosition = (builder: NodeBuilder) => { segmentInstance(); return base(builder); };
}
