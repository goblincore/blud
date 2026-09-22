// src/lab/sdf-zombie/characters/ogre-kit.test.ts
//
// Does the leather fit the ogre? Same approach as goblin-kit.test.ts (read its
// header): the COMPILED glTF's rest-pose vertices checked against sdBody, plus
// the check the ogre paid for on day one — the kit's hand-transcribed
// skeleton drifting from the .blob's. Lengthening the .blob's arms without
// the .wam put the kit's wrists 60 mm off (2026-09-22), and nothing noticed:
// build-wam-kit.sh only prints a reminder.
import { describe, it, expect } from 'vitest';
import blobSrc from './ogre.blob?raw';
import kitJson from '../../../../public/assets/lab/ogre-kit.gltf?raw';
import { parseBlob } from '../blob-parse';
import { compileBlob, compileFace } from '../blob-compile';
import { buildBody } from '../build-body';
import { sdBody } from '../validate';
import type { Vec3 } from '../types';

interface Gltf {
  buffers: { uri: string; byteLength: number }[];
  bufferViews: { buffer: number; byteOffset?: number; byteLength: number }[];
  accessors: { bufferView: number; byteOffset?: number; count: number; type: string; componentType: number }[];
  meshes: { primitives: { attributes: Record<string, number>; indices: number; material: number }[] }[];
  materials: { name: string }[];
  nodes: { name?: string; translation?: number[]; children?: number[] }[];
  scenes: { nodes: number[] }[];
}

const gltf = JSON.parse(kitJson) as Gltf;
const bytes = Uint8Array.from(
  atob(gltf.buffers[0]!.uri.split(',', 2)[1]!), c => c.charCodeAt(0));
const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

const offsetOf = (i: number) => {
  const a = gltf.accessors[i]!;
  const bv = gltf.bufferViews[a.bufferView]!;
  return (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
};

const readVec3 = (i: number): Vec3[] => {
  const a = gltf.accessors[i]!, base = offsetOf(i), out: Vec3[] = [];
  for (let k = 0; k < a.count; k++)
    out.push([
      view.getFloat32(base + k * 12, true),
      view.getFloat32(base + k * 12 + 4, true),
      view.getFloat32(base + k * 12 + 8, true)]);
  return out;
};

// 5121 = u8, 5123 = u16, 5125 = u32. WAM picks by vertex count, so all three
// are possible as the kit grows and guessing one silently misreads the rest.
const readIndices = (i: number): number[] => {
  const a = gltf.accessors[i]!, base = offsetOf(i), out: number[] = [];
  const size = a.componentType === 5121 ? 1 : a.componentType === 5123 ? 2 : 4;
  for (let k = 0; k < a.count; k++)
    out.push(size === 1 ? view.getUint8(base + k)
      : size === 2 ? view.getUint16(base + k * 2, true)
        : view.getUint32(base + k * 4, true));
  return out;
};

/** Every kit vertex, grouped by the material whose triangles reference it. */
function verticesByMaterial(): Map<string, Vec3[]> {
  const out = new Map<string, Vec3[]>();
  for (const prim of gltf.meshes[0]!.primitives) {
    const pos = readVec3(prim.attributes['POSITION']!);
    const name = gltf.materials[prim.material]!.name;
    const seen = new Set(readIndices(prim.indices));
    out.set(name, [...seen].map(i => pos[i]!));
  }
  return out;
}

/** Every node's rest WORLD position (WAM exports translation-only bones). */
function nodeWorld(): Map<string, Vec3> {
  const out = new Map<string, Vec3>();
  const walk = (i: number, p: Vec3) => {
    const n = gltf.nodes[i]!;
    const t = n.translation ?? [0, 0, 0];
    const w: Vec3 = [p[0] + t[0]!, p[1] + t[1]!, p[2] + t[2]!];
    if (n.name) out.set(n.name, w);
    for (const c of n.children ?? []) walk(c, w);
  };
  for (const r of gltf.scenes[0]!.nodes) walk(r, [0, 0, 0]);
  return out;
}

describe('ogre-kit.gltf fits ogre.blob', () => {
  const doc = parseBlob(blobSrc);
  const body = buildBody(compileBlob(doc, compileFace(doc)));
  const groups = verticesByMaterial();

  it('decodes the compiled kit', () => {
    expect([...groups.keys()].sort()).toEqual(['boot', 'cloth', 'iron', 'leather']);
    for (const [name, vs] of groups) expect(vs.length, name).toBeGreaterThanOrEqual(8);
  });

  // THE TRANSCRIPTION. Every .blob bone's head must sit where the kit's bone
  // node does. 10 mm, not 0: WAM and .blob resolve a combined pitch+tilt on a
  // down bone very slightly differently (the forearm/hand carry 6-8 mm), which
  // is invisible under a 30 mm cloth margin; a missed length edit is 30-60 mm.
  it('carries the same skeleton as the .blob (height fractions x 2.20)', () => {
    const world = nodeWorld();
    for (const [name, bone] of body.bones) {
      // GLTFLoader-style sanitising is not applied to the raw JSON: WAM keeps
      // the dotted names.
      const k = world.get(name);
      expect(k, `kit has no bone ${name}`).toBeDefined();
      const d = Math.hypot(k![0] - bone.head[0], k![1] - bone.head[1], k![2] - bone.head[2]);
      expect(d, `${name} kit/blob head drift`).toBeLessThan(0.010);
    }
  });

  // Cloth and leather are meant to sit OVER flesh; a rim may tuck into it
  // (the kilt's top ring hides inside the belt, the belt bites the gut).
  // What must never happen is a piece sized against the wrong body.
  const TUCK_MAX = 0.045;
  it.each([...groups.keys()])('no %s vertex passes through the body', name => {
    const vs = groups.get(name)!;
    let worst = Infinity, at: Vec3 = vs[0]!;
    for (const v of vs) {
      const d = sdBody(v, body);
      if (d < worst) { worst = d; at = v; }
    }
    expect(worst, `${name} deepest vertex at (${at.map(n => n.toFixed(3)).join(', ')})`)
      .toBeGreaterThan(-TUCK_MAX);
  });

  it('stands the boots on the floor', () => {
    const minY = Math.min(...groups.get('boot')!.map(v => v[1]));
    expect(minY).toBeGreaterThan(-0.015);
    expect(minY).toBeLessThan(0.02);
  });
});
