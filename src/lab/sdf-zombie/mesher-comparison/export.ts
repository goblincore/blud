// src/lab/sdf-zombie/mesher-comparison/export.ts
//
// Pure mesh serialisation: OBJ (required) and GLB (cheap, dependency-free).
// No node:fs here — the CLI script owns file writing so this module stays
// usable from a browser/test context.
//
// The output is static POSED geometry, not a skinned character. Per-vertex
// normals travel with it; OBJ carries `v`/`vn`/`f v//vn` and GLB carries a
// NORMAL accessor. Triangulation is unchanged (both writers emit triangles).

import type { IndexedMesh } from './types';

export function meshToObj(mesh: IndexedMesh, comment = ''): string {
  const p = mesh.positions, n = mesh.normals, idx = mesh.indices;
  const verts = p.length / 3;
  const out: string[] = [];
  out.push(`# blud mesher comparison — ${mesh.method}`);
  out.push(`# ${verts} vertices, ${idx.length / 3} triangles`);
  if (comment) for (const line of comment.split('\n')) out.push(`# ${line}`);
  for (let i = 0; i < verts; i++) {
    out.push(`v ${fmt(p[i * 3]!)} ${fmt(p[i * 3 + 1]!)} ${fmt(p[i * 3 + 2]!)}`);
  }
  if (n && n.length >= verts * 3) {
    for (let i = 0; i < verts; i++) {
      out.push(`vn ${fmt(n[i * 3]!)} ${fmt(n[i * 3 + 1]!)} ${fmt(n[i * 3 + 2]!)}`);
    }
    for (let t = 0; t < idx.length; t += 3) {
      out.push(`f ${idx[t]! + 1}//${idx[t]! + 1} ${idx[t + 1]! + 1}//${idx[t + 1]! + 1} ${idx[t + 2]! + 1}//${idx[t + 2]! + 1}`);
    }
  } else {
    for (let t = 0; t < idx.length; t += 3) {
      out.push(`f ${idx[t]! + 1} ${idx[t + 1]! + 1} ${idx[t + 2]! + 1}`);
    }
  }
  return out.join('\n') + '\n';
}

const fmt = (x: number): string => {
  // Fixed decimals keeps OBJ files compact and deterministic to diff.
  const s = x.toFixed(6);
  return s === '-0.000000' ? '0.000000' : s;
};

interface GlbBuffers {
  json: unknown;
  bin: Uint8Array;
}

/** Minimal glTF 2.0 binary container (one mesh, POSITION/NORMAL/indices). */
export function meshToGlb(mesh: IndexedMesh): Uint8Array {
  const p = mesh.positions;
  const verts = p.length / 3;
  const idx = mesh.indices;

  const useU16 = verts <= 65535;
  const idxBytes = useU16 ? new Uint16Array(idx) : new Uint32Array(idx);

  const posBytes = new Uint8Array(p.buffer.slice(p.byteOffset, p.byteOffset + p.byteLength));
  const normals = mesh.normals && mesh.normals.length >= verts * 3
    ? mesh.normals
    : new Float32Array(verts * 3);
  const nrmBytes = new Uint8Array(normals.buffer.slice(normals.byteOffset, normals.byteOffset + normals.byteLength));
  const idxBytesArr = new Uint8Array(idxBytes.buffer);

  const align4 = (n: number): number => (n + 3) & ~3;
  const posOff = 0;
  const nrmOff = align4(posBytes.byteLength);
  const idxOff = align4(nrmOff + nrmBytes.byteLength);
  const binLength = align4(idxOff + idxBytesArr.byteLength);
  const bin = new Uint8Array(binLength);
  bin.set(posBytes, posOff);
  bin.set(nrmBytes, nrmOff);
  bin.set(idxBytesArr, idxOff);

  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < verts; i++) for (let d = 0; d < 3; d++) {
    const v = p[i * 3 + d]!;
    if (v < min[d]!) min[d] = v;
    if (v > max[d]!) max[d] = v;
  }

  const glb: GlbBuffers = {
    json: {
      asset: { version: '2.0', generator: 'blud-mesher-comparison' },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0, name: mesh.method }],
      meshes: [{
        name: mesh.method,
        primitives: [{
          attributes: { POSITION: 0, NORMAL: 1 },
          indices: 2,
          mode: 4,
          material: 0,
        }],
      }],
      materials: [{
        name: 'neutral-grey',
        pbrMetallicRoughness: { baseColorFactor: [0.72, 0.72, 0.74, 1], metallicFactor: 0, roughnessFactor: 0.85 },
      }],
      accessors: [
        { bufferView: 0, componentType: 5126, count: verts, type: 'VEC3', min, max },
        { bufferView: 1, componentType: 5126, count: verts, type: 'VEC3' },
        { bufferView: 2, componentType: useU16 ? 5123 : 5125, count: idx.length, type: 'SCALAR' },
      ],
      bufferViews: [
        { buffer: 0, byteOffset: posOff, byteLength: posBytes.byteLength, target: 34962 },
        { buffer: 0, byteOffset: nrmOff, byteLength: nrmBytes.byteLength, target: 34962 },
        { buffer: 0, byteOffset: idxOff, byteLength: idxBytesArr.byteLength, target: 34963 },
      ],
      buffers: [{ byteLength: binLength }],
    },
    bin,
  };
  return packGlb(glb.json, glb.bin);
}

function packGlb(json: unknown, bin: Uint8Array): Uint8Array {
  let jsonText = JSON.stringify(json);
  while (jsonText.length % 4 !== 0) jsonText += ' ';
  const jsonBytes = new TextEncoder().encode(jsonText);
  const jsonPadded = new Uint8Array((jsonBytes.length + 3) & ~3);
  jsonPadded.set(jsonBytes);
  const binPadded = new Uint8Array((bin.length + 3) & ~3);
  binPadded.set(bin);

  const total = 12 + 8 + jsonPadded.length + 8 + binPadded.length;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true); // 'glTF'
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  let o = 12;
  view.setUint32(o, jsonPadded.length, true);
  view.setUint32(o + 4, 0x4e4f534a, true); // 'JSON'
  out.set(jsonPadded, o + 8);
  o += 8 + jsonPadded.length;
  view.setUint32(o, binPadded.length, true);
  view.setUint32(o + 4, 0x004e4942, true); // 'BIN\0'
  out.set(binPadded, o + 8);
  return out;
}

export interface ObjReadback {
  readonly vertices: number;
  readonly normals: number;
  readonly faces: number;
  readonly nonTriangles: number;
  readonly degenerate: number;
}

/** Minimal OBJ reader used to prove an exported file survives a round trip. */
export function readBackObj(text: string): ObjReadback {
  let vertices = 0, normals = 0, faces = 0, nonTriangles = 0, degenerate = 0;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('v ')) vertices++;
    else if (line.startsWith('vn ')) normals++;
    else if (line.startsWith('f ')) {
      faces++;
      const parts = line.slice(2).trim().split(/\s+/);
      if (parts.length !== 3) { nonTriangles++; continue; }
      const vi = parts.map(p => parseInt(p.split('/')[0]!, 10));
      if (vi[0] === vi[1] || vi[1] === vi[2] || vi[2] === vi[0]) degenerate++;
    }
  }
  return { vertices, normals, faces, nonTriangles, degenerate };
}

/** Minimal GLB container check: magic, version, chunk lengths, accessor counts. */
export function inspectGlb(bytes: Uint8Array): { magicOk: boolean; version: number; json: Record<string, unknown>; binLength: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = view.getUint32(0, true);
  const version = view.getUint32(4, true);
  const length = view.getUint32(8, true);
  if (length !== bytes.byteLength) throw new Error(`GLB length mismatch ${length} != ${bytes.byteLength}`);
  const jsonLen = view.getUint32(12, true);
  const jsonType = view.getUint32(16, true);
  if (jsonType !== 0x4e4f534a) throw new Error('first GLB chunk is not JSON');
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLen)));
  const binOff = 20 + jsonLen;
  const binLen = view.getUint32(binOff, true);
  const binType = view.getUint32(binOff + 4, true);
  if (binType !== 0x004e4942) throw new Error('second GLB chunk is not BIN');
  return { magicOk: magic === 0x46546c67, version, json, binLength: binLen };
}
