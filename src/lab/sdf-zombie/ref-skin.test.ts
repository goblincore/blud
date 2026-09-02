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

/** Lay byte parts into one 4-byte-aligned binary chunk, returning their
 *  offsets (for bufferViews) along with it. */
function binChunk(parts: Uint8Array[]): { bin: Uint8Array; offs: number[] } {
  let off = 0; const offs: number[] = [];
  for (const p of parts) { offs.push(off); off += p.length + ((4 - (p.length % 4)) % 4); }
  const bin = new Uint8Array(off);
  parts.forEach((p, i) => bin.set(p, offs[i]!));
  return { bin, offs };
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

/**
 * The same two-joint rig, but vertex influences split across TWO JOINTS_n
 * sets, as exporters do when a vertex carries more than four influences.
 * Four vertices (joint indices are per the skin: 0 = A, 1 = B):
 *
 *   v0  set0 [A=0.2]  set1 [B=0.6, B=0.2]  — set-0 max is 0.2 (the old code
 *       drops it); the true dominant, 0.6 on B, lives in JOINTS_1. KEPT as B.
 *   v1  set0 [A=0.7, B=0.1] set1 [B=0.2]   — dominant A=0.7 in set 0; KEPT as
 *       A, and its POSITION must blend the set-1 weight in too (see test).
 *   v2  set0 [A=0.5]  set1 [B=0.5]         — a tie ACROSS sets is still a
 *       tie. DROPPED.
 *   v3  set0 [A=1.0]  set1 [all zero]      — a second set present but unused
 *       must change nothing. KEPT as A.
 */
function twoSetGlb(): Uint8Array {
  const pos = new Float32Array([1, 0, 0,  0, 1, 0,  0, 0, 1,  0, 0, 1]);
  const j0 = new Uint8Array([0,0,0,0,  0,1,0,0,  0,0,0,0,  0,0,0,0]);
  const w0 = new Float32Array([0.2,0,0,0,  0.7,0.1,0,0,  0.5,0,0,0,  1,0,0,0]);
  const j1 = new Uint8Array([1,1,0,0,  1,0,0,0,  1,0,0,0,  0,0,0,0]);
  const w1 = new Float32Array([0.6,0.2,0,0,  0.2,0,0,0,  0.5,0,0,0,  0,0,0,0]);
  const parts = [new Uint8Array(pos.buffer), j0, new Uint8Array(w0.buffer), j1, new Uint8Array(w1.buffer)];
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
    meshes: [{ primitives: [{
      attributes: { POSITION: 0, JOINTS_0: 1, WEIGHTS_0: 2, JOINTS_1: 3, WEIGHTS_1: 4 },
    }] }],
    buffers: [{ byteLength: bin.length }],
    bufferViews: [
      { buffer: 0, byteOffset: offs[0], byteLength: pos.byteLength },
      { buffer: 0, byteOffset: offs[1], byteLength: j0.byteLength },
      { buffer: 0, byteOffset: offs[2], byteLength: w0.byteLength },
      { buffer: 0, byteOffset: offs[3], byteLength: j1.byteLength },
      { buffer: 0, byteOffset: offs[4], byteLength: w1.byteLength },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 4, type: 'VEC3' },
      { bufferView: 1, componentType: 5121, count: 4, type: 'VEC4' },
      { bufferView: 2, componentType: 5126, count: 4, type: 'VEC4' },
      { bufferView: 3, componentType: 5121, count: 4, type: 'VEC4' },
      { bufferView: 4, componentType: 5126, count: 4, type: 'VEC4' },
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

  it('carries TEXCOORD_0 parallel to the kept verts when present, and omits the field when not', () => {
    // The draft's colour pass joins a vertex's paint to its geometry through
    // this array. It must index the KEPT verts (the drop happens in the same
    // loop), and it must be ABSENT — not an array of nulls — when the
    // primitive has no uv, so "unpainted reference" stays distinguishable
    // from "painted but this vertex has no uv".
    const pos = new Float32Array([1, 0, 0,  0, 1, 0,  0, 0, 1]);
    const joints = new Uint8Array([0,0,0,0,  1,0,0,0,  0,1,0,0]);
    const weights = new Float32Array([1,0,0,0,  0.8,0.2,0,0,  0.5,0.5,0,0]);
    const uv = new Float32Array([0.25, 0.75,  0.5, 0.25,  0.9, 0.9]);
    const { bin, offs } = binChunk([
      new Uint8Array(pos.buffer), joints, new Uint8Array(weights.buffer), new Uint8Array(uv.buffer),
    ]);
    const withUv = readRefSkin(makeGlb({
      asset: { version: '2.0' },
      scenes: [{ nodes: [0] }], scene: 0,
      nodes: [
        { name: 'Root', scale: [2, 2, 2], children: [1, 2, 3] },
        { name: 'A', translation: [0, 0, 0] },
        { name: 'B', translation: [0, 3, 0] },
        { name: 'MeshNode', mesh: 0, skin: 0 },
      ],
      skins: [{ joints: [1, 2] }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0, JOINTS_0: 1, WEIGHTS_0: 2, TEXCOORD_0: 3 } }] }],
      buffers: [{ byteLength: bin.length }],
      bufferViews: [
        { buffer: 0, byteOffset: offs[0], byteLength: pos.byteLength },
        { buffer: 0, byteOffset: offs[1], byteLength: joints.byteLength },
        { buffer: 0, byteOffset: offs[2], byteLength: weights.byteLength },
        { buffer: 0, byteOffset: offs[3], byteLength: uv.byteLength },
      ],
      accessors: [
        { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
        { bufferView: 1, componentType: 5121, count: 3, type: 'VEC4' },
        { bufferView: 2, componentType: 5126, count: 3, type: 'VEC4' },
        { bufferView: 3, componentType: 5126, count: 3, type: 'VEC2' },
      ],
    }, bin));
    // Vertex 2 (the 0.5/0.5 tie) is dropped; the two kept verts carry THEIR
    // uvs, in order, with no gap left where the dropped one was.
    expect(withUv.uv).toEqual([[0.25, 0.75], [0.5, 0.25]]);

    const withoutUv = readRefSkin(twoJointGlb());
    expect(withoutUv.uv).toBeUndefined();
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

  // The dragon reference carries JOINTS_0/1/2 — up to 12 influences per
  // vertex — and reading only set 0 mis-assigns dominants and shrinks kept
  // vertices' positions by the weight mass that lives outside set 0.
  describe('multiple JOINTS_n/WEIGHTS_n sets', () => {
    it('picks the dominant joint across every set, not just JOINTS_0', () => {
      const skin = readRefSkin(twoSetGlb());
      expect(skin.total).toBe(4);
      // v2 (the 0.5/0.5 tie across sets) is the only drop.
      expect(skin.dropped).toBe(1);
      // v0's dominant (B, 0.6) lives in JOINTS_1; v1/v3 are dominated from
      // set 0 and must be untouched by the extra set's presence.
      expect(skin.verts.map((v) => v.joint)).toEqual(['B', 'A', 'A']);
    });

    it('blends kept vertices over the weights of ALL sets', () => {
      const skin = readRefSkin(twoSetGlb());
      // v1: P=[0,1,0], joint A maps P under the 2x root, joint B additionally
      // translates [0,6,0]. Weights A=0.7 (set 0), B=0.1 (set 0) + 0.2
      // (set 1). The blended position must use the FULL weight set:
      // 0.7*[0,2,0] + 0.3*[0,8,0] = [0, 3.8, 0]. Reading set 0 alone would
      // shrink this to [0, 2.2, 0] — the exact position-shrinkage defect.
      const v1 = skin.verts[1]!;
      expect(v1.joint).toBe('A');
      // 7, not 12: the fixture weights are float32, so 0.7/0.3 carry ~1e-8
      // before the arithmetic even starts.
      expect(v1.position[0]).toBeCloseTo(0, 7);
      expect(v1.position[1]).toBeCloseTo(3.8, 7);
      expect(v1.position[2]).toBeCloseTo(0, 7);
    });

    it('still drops a 0.5/0.5 tie thrown across two sets', () => {
      const skin = readRefSkin(twoSetGlb());
      expect(skin.dropped).toBe(1);
    });

    it('refuses a JOINTS_n whose WEIGHTS_n partner is missing', () => {
      // Valid set-0 accessors, JOINTS_1 present and readable, WEIGHTS_1
      // absent — the refusal must name the broken set, not crash reading.
      const j1 = new Uint8Array([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
      const parts = [j1];
      let off = 0; const offs: number[] = [];
      for (const p of parts) { offs.push(off); off += p.length + ((4 - (p.length % 4)) % 4); }
      const bin = new Uint8Array(off);
      parts.forEach((p, i) => bin.set(p, offs[i]!));
      const broken = makeGlb({
        asset: { version: '2.0' }, scenes: [{ nodes: [0] }], scene: 0,
        nodes: [
          { name: 'Root', scale: [2, 2, 2], children: [1, 2, 3] },
          { name: 'A', translation: [0, 0, 0] },
          { name: 'B', translation: [0, 3, 0] },
          { name: 'MeshNode', mesh: 0, skin: 0 },
        ],
        skins: [{ joints: [1, 2] }],
        meshes: [{ primitives: [{
          attributes: { POSITION: 0, JOINTS_0: 1, WEIGHTS_0: 2, JOINTS_1: 3 },
        }] }],
        buffers: [{ byteLength: bin.length }],
        bufferViews: [
          { buffer: 0, byteOffset: 0, byteLength: 4 },
          { buffer: 0, byteOffset: offs[0], byteLength: j1.byteLength },
        ],
        accessors: [
          { bufferView: 0, componentType: 5126, count: 1, type: 'VEC3' },
          { bufferView: 1, componentType: 5121, count: 1, type: 'VEC4' },
          { bufferView: 0, componentType: 5126, count: 1, type: 'VEC4' },
          { bufferView: 1, componentType: 5121, count: 1, type: 'VEC4' },
        ],
      }, bin);
      expect(() => readRefSkin(broken)).toThrow(/JOINTS_1.*WEIGHTS_1|WEIGHTS_1.*JOINTS_1/);
    });
  });
});
