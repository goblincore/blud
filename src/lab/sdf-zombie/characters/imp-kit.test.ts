// src/lab/sdf-zombie/characters/imp-kit.test.ts
//
// The imp's fuel hoses come off with the arm they feed (owner, 2026-11-02: a shot-off arm left its cable behind). A
// kit piece sheds by the bone its triangle island is skinned to (kit-damage.ts piecesOf, kitPieceAttached), so this
// reads the COMPILED glTF's islands the way piecesOf does (welded by position, joined by triangles) and asks the real
// rule on the real body: nothing riding the torso reaches the shoulder, and every hose run that does sheds with the
// arm, at the shoulder and when the whole arm goes.
import { describe, it, expect } from 'vitest';
import blobSrc from './imp.blob?raw';
import kitJson from '../../../../public/assets/lab/imp-kit.gltf?raw';
import { parseBlob } from '../blob-parse';
import { compileBlob, compileFace } from '../blob-compile';
import { buildBody } from '../build-body';
import { chainOrder } from '../connectivity';
import { severDistal, severLimb } from '../sever';
import { kitPieceAttached, kitSupportIndex, kitSupportKey } from '../webgpu/kit-damage';
import type { LimbId } from '../types';

interface Accessor { bufferView: number; byteOffset?: number; count: number; type: string; componentType: number }
interface Gltf {
  buffers: { uri: string }[];
  bufferViews: { byteOffset?: number; byteStride?: number }[];
  accessors: Accessor[];
  meshes: { primitives: { attributes: Record<string, number>; indices: number; material: number }[] }[];
  materials: { name: string }[];
  nodes: { name?: string }[];
  skins: { joints: number[] }[];
}

const gltf = JSON.parse(kitJson) as Gltf;
const bytes = Uint8Array.from(atob(gltf.buffers[0]!.uri.split(',', 2)[1]!), c => c.charCodeAt(0));
const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const WIDTH: Record<string, number> = { SCALAR: 1, VEC3: 3, VEC4: 4 };
const read = (i: number): number[] => {
  const a = gltf.accessors[i]!, bv = gltf.bufferViews[a.bufferView]!, n = WIDTH[a.type]!;
  const size = a.componentType === 5126 || a.componentType === 5125 ? 4 : a.componentType === 5123 ? 2 : 1;
  const stride = bv.byteStride ?? size * n, base = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0), out: number[] = [];
  for (let k = 0; k < a.count; k++) for (let c = 0; c < n; c++) {
    const o = base + k * stride + c * size;
    out.push(a.componentType === 5126 ? view.getFloat32(o, true) : a.componentType === 5125 ? view.getUint32(o, true)
      : a.componentType === 5123 ? view.getUint16(o, true) : view.getUint8(o));
  }
  return out;
};

/** The hose islands (impmetal), each with the bone its vertices ride and its rest-pose bounds. */
const hoses = gltf.meshes.flatMap(m => m.primitives).filter(p => gltf.materials[p.material]!.name === 'impmetal').flatMap(p => {
  const pos = read(p.attributes.POSITION!), joint = read(p.attributes.JOINTS_0!), index = read(p.indices);
  const parent = Array.from({ length: pos.length / 3 }, (_, i) => i);
  const root = (a: number): number => { while (parent[a] !== a) a = parent[a] = parent[parent[a]!]!; return a; };
  const welded = new Map<string, number>();
  for (let i = 0; i < parent.length; i++) {
    const key = [0, 1, 2].map(c => Math.round(pos[i * 3 + c]! * 1e6)).join();
    const was = welded.get(key);
    if (was === undefined) welded.set(key, i); else parent[root(i)] = root(was);
  }
  for (let t = 0; t < index.length; t += 3) { parent[root(index[t + 1]!)] = root(index[t]!); parent[root(index[t + 2]!)] = root(index[t]!); }
  const islands = new Map<number, { bone: string; min: number[]; max: number[] }>();
  for (let i = 0; i < parent.length; i++) {
    const r = root(i), p3 = [pos[i * 3]!, pos[i * 3 + 1]!, pos[i * 3 + 2]!];
    const isl = islands.get(r) ?? { bone: gltf.nodes[gltf.skins[0]!.joints[joint[i * 4]!]!]!.name!, min: [...p3], max: [...p3] };
    for (let c = 0; c < 3; c++) { isl.min[c] = Math.min(isl.min[c]!, p3[c]!); isl.max[c] = Math.max(isl.max[c]!, p3[c]!); }
    islands.set(r, isl);
  }
  return [...islands.values()];
});

const doc = parseBlob(blobSrc);
const body = buildBody(compileBlob(doc, compileFace(doc)));
const limbOf = (bone: string): LimbId => /clavicle|upperArm|foreArm|hand/.test(bone) ? (bone.endsWith('.l') ? 'armL' : 'armR') : 'torso';
const attached = (b: typeof body, bone: string) => kitPieceAttached(limbOf(bone), kitSupportKey(bone), kitSupportIndex(b));

describe('imp kit: the fuel hoses', () => {
  // The shoulder: the upper arm's hose starts at x 0.19 (make_conduits.py's ports), so a torso piece past 0.15 runs into it.
  const SHOULDER_X = 0.15;

  it('nothing riding the torso reaches the shoulder', () => {
    const torso = hoses.filter(h => limbOf(h.bone) === 'torso');
    expect(torso.length).toBeGreaterThan(0);
    for (const h of torso) expect(Math.max(Math.abs(h.min[0]!), Math.abs(h.max[0]!)), h.bone).toBeLessThan(SHOULDER_X);
  });

  it.each(['armL', 'armR'] as const)('every run at the %s shoulder sheds with the arm, whole or cut at the shoulder', limb => {
    const side = limb === 'armL' ? 1 : -1;
    const atShoulder = hoses.filter(h => Math.max(h.min[0]! * side, h.max[0]! * side) > SHOULDER_X && h.max[1]! > 1.1);
    expect(atShoulder.map(h => h.bone).sort()).toEqual([`clavicle.${limb === 'armL' ? 'l' : 'r'}`, `upperArm.${limb === 'armL' ? 'l' : 'r'}`]);
    for (const h of atShoulder) expect(attached(body, h.bone), `${h.bone} intact`).toBe(true);
    const cluster = body.clusters.find(c => c.limb === limb)!;
    const order = chainOrder(body, cluster, body.clusters.find(c => c.limb === 'torso')!.center);
    const cuts = { whole: severLimb(body, limb).body, shoulder: severDistal(body, { limb, fromPrim: order[1]! }).body };
    for (const [how, cut] of Object.entries(cuts))
      for (const h of atShoulder) expect(attached(cut, h.bone), `${h.bone} after the ${how} cut`).toBe(false);
  });
});
