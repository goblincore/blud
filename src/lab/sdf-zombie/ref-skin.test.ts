import { describe, it, expect } from 'vitest';
import { readRefSkin, MIN_DOMINANT_WEIGHT } from './ref-skin';

/** Pack a glTF JSON object plus a binary chunk into GLB container bytes. */
function makeGlb(json: unknown, bin: Uint8Array): Uint8Array {
  const enc = new TextEncoder();
  let jsonBytes: Uint8Array = enc.encode(JSON.stringify(json));
  const padTo4 = (b: Uint8Array, filler: number) => {
    const pad = (4 - (b.length % 4)) % 4;
    if (pad === 0) return b;
    const out = new Uint8Array(b.length + pad);
    out.set(b); out.fill(filler, b.length);
    return out;
  };
  jsonBytes = padTo4(jsonBytes, 0x20);
  const binBytes = padTo4(bin, 0);
  const total = 12 + 8 + jsonBytes.length + 8 + binBytes.length;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
  dv.setUint32(12, jsonBytes.length, true); dv.setUint32(16, 0x4e4f534a, true);
  out.set(jsonBytes, 20);
  const binOff = 20 + jsonBytes.length;
  dv.setUint32(binOff, binBytes.length, true); dv.setUint32(binOff + 4, 0x004e4942, true);
  out.set(binBytes, binOff + 8);
  return out;
}

/**
 * Two joints under a root scaled 2x. Three vertices: two clearly owned by
 * joint 0 and joint 1, and one split 0.5/0.5 which must be DROPPED.
 */
function twoJointGlb(): Uint8Array {
  const pos = new Float32Array([1, 0, 0,  0, 1, 0,  0, 0, 1]);
  const joints = new Uint8Array([0,0,0,0,  1,0,0,0,  0,1,0,0]);
  const weights = new Float32Array([1,0,0,0,  0.8,0.2,0,0,  0.5,0.5,0,0]);
  const parts = [new Uint8Array(pos.buffer), joints, new Uint8Array(weights.buffer)];
  let off = 0; const offs: number[] = [];
  for (const p of parts) { offs.push(off); off += p.length + ((4 - (p.length % 4)) % 4); }
  const bin = new Uint8Array(off);
  parts.forEach((p, i) => bin.set(p, offs[i]!));
  return makeGlb({
    asset: { version: '2.0' },
    scenes: [{ nodes: [0] }], scene: 0,
    nodes: [
      { name: 'Root', scale: [2, 2, 2], children: [1, 2, 3] },
      { name: 'A', translation: [0, 0, 0] },
      { name: 'B', translation: [0, 3, 0] },
      { name: 'MeshNode', mesh: 0, skin: 0 },
    ],
    skins: [{ joints: [1, 2] }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, JOINTS_0: 1, WEIGHTS_0: 2 } }] }],
    buffers: [{ byteLength: bin.length }],
    bufferViews: [
      { buffer: 0, byteOffset: offs[0], byteLength: pos.byteLength },
      { buffer: 0, byteOffset: offs[1], byteLength: joints.byteLength },
      { buffer: 0, byteOffset: offs[2], byteLength: weights.byteLength },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: 1, componentType: 5121, count: 3, type: 'VEC4' },
      { bufferView: 2, componentType: 5126, count: 3, type: 'VEC4' },
    ],
  }, bin);
}

describe('readRefSkin', () => {
  it('assigns each vertex to its dominant joint and drops ambiguous ones', () => {
    const skin = readRefSkin(twoJointGlb());
    expect(skin.total).toBe(3);
    expect(skin.dropped).toBe(1);              // the 0.5/0.5 vertex
    expect(skin.verts).toHaveLength(2);
    expect(skin.verts.map((v) => v.joint)).toEqual(['A', 'B']);
  });

  it('returns positions and joints in one common space, root scale applied', () => {
    const skin = readRefSkin(twoJointGlb());
    // POSITION [1,0,0] under a root scaled 2x.
    expect(skin.verts[0]!.position).toEqual([2, 0, 0]);
    // Joint B translates [0,3,0] under the same 2x root.
    expect(skin.jointWorld.get('B')).toEqual([0, 6, 0]);
  });

  it('exposes the dominant-weight threshold it used', () => {
    // Calibrated against both real references; see the constant's own comment.
    expect(MIN_DOMINANT_WEIGHT).toBe(0.5);
  });

  it('requires a STRICT majority — an exact 0.5/0.5 tie is still dropped', () => {
    // The fixture's third vertex is split 0.5/0.5. A `<` comparison against a
    // 0.5 threshold would keep it and break the tie arbitrarily.
    const skin = readRefSkin(twoJointGlb());
    expect(skin.dropped).toBe(1);
    expect(skin.verts.map((v) => v.joint)).not.toContain(undefined);
  });

  it('refuses a non-uniform node scale rather than shearing the measurement', () => {
    const json = JSON.parse(JSON.stringify({
      asset: { version: '2.0' }, scenes: [{ nodes: [0] }], scene: 0,
      nodes: [
        { name: 'Root', scale: [2, 3, 2], children: [1, 2, 3] },
        { name: 'A' }, { name: 'B', translation: [0, 3, 0] },
        { name: 'MeshNode', mesh: 0, skin: 0 },
      ],
      skins: [{ joints: [1, 2] }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0, JOINTS_0: 1, WEIGHTS_0: 2 } }] }],
      buffers: [{ byteLength: 4 }],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 4 }],
      accessors: [{ bufferView: 0, componentType: 5126, count: 0, type: 'VEC3' }],
    }));
    expect(() => readRefSkin(makeGlb(json, new Uint8Array(4)))).toThrow(/non-uniform/i);
  });

  it('refuses an unskinned GLB by name', () => {
    const bare = makeGlb({
      asset: { version: '2.0' }, scenes: [{ nodes: [0] }], scene: 0,
      nodes: [{ name: 'N', mesh: 0 }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
      buffers: [{ byteLength: 12 }],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 12 }],
      accessors: [{ bufferView: 0, componentType: 5126, count: 1, type: 'VEC3' }],
    }, new Uint8Array(12));
    expect(() => readRefSkin(bare)).toThrow(/no skin/i);
  });
});
