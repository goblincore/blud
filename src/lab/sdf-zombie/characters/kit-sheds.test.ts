// src/lab/sdf-zombie/characters/kit-sheds.test.ts
//
// Every kit comes off with the anatomy under it (character-registry.ts kitSheds; owner, 2026-11-02: a shot-off imp arm
// left its fist and hoses floating, and so did every other non-armoured kit). This reads each SHIPPED glTF into skinned
// meshes and runs the real piecesOf over them, so the pieces, their bones and their limbs are the game's, then asks
// the real sever rules on the real body:
//   - every limb's pieces stay on the intact body and leave with that limb;
//   - nothing riding the torso reaches far past the torso's flesh into a limb's, where it would hang in the air once
//     the limb is gone (the imp's chest hose). Each kit's worst reach is pinned at what was measured, with what it is.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three/webgpu';
import { CHARACTERS, characterEntry } from '../character-registry';
import { parseBlob } from '../blob-parse';
import { compileBlob, compileFace } from '../blob-compile';
import { buildBody } from '../build-body';
import { severLimb } from '../sever';
import { sdPrimitive } from '../validate';
import { kitPieceAttached, kitSupportIndex, piecesOf, type Piece } from '../webgpu/kit-damage';
import type { LimbId, Vec3 } from '../types';

interface Accessor { bufferView: number; byteOffset?: number; count: number; type: string; componentType: number }
interface Gltf {
  buffers: { uri: string }[];
  bufferViews: { byteOffset?: number; byteStride?: number }[];
  accessors: Accessor[];
  meshes: { primitives: { attributes: Record<string, number>; indices: number; material: number }[] }[];
  materials: { name: string }[];
  nodes: { name: string; children?: number[] }[];
  skins: { joints: number[] }[];
}
const WIDTH: Record<string, number> = { SCALAR: 1, VEC3: 3, VEC4: 4 };
/** Every shipped kit's source, by served url. import.meta.glob, not node:fs: the tsconfig types only vite/client. */
const KIT_SRC: Record<string, string> = Object.fromEntries(Object.entries(
  import.meta.glob<string>('../../../../public/assets/lab/*-kit.gltf', { query: '?raw', import: 'default', eager: true }),
).map(([path, src]) => [path.slice(path.indexOf('/public/') + '/public'.length), src]));

/** The kit's skinned meshes, one per glTF primitive, on one skeleton with the glTF's bone hierarchy (piecesOf reads it). */
function kitMeshes(url: string): THREE.SkinnedMesh[] {
  const gltf = JSON.parse(KIT_SRC[url]!) as Gltf;
  const bytes = Uint8Array.from(atob(gltf.buffers[0]!.uri.split(',', 2)[1]!), c => c.charCodeAt(0));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
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
  const nodes = gltf.nodes.map(n => Object.assign(new THREE.Bone(), { name: n.name }));
  gltf.nodes.forEach((n, i) => n.children?.forEach(c => nodes[i]!.add(nodes[c]!)));
  const skeleton = new THREE.Skeleton(gltf.skins[0]!.joints.map(j => nodes[j]!));
  return gltf.meshes.flatMap(m => m.primitives).map(p => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(read(p.attributes.POSITION!), 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(read(p.attributes.JOINTS_0!), 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(read(p.attributes.WEIGHTS_0!), 4));
    g.setIndex(read(p.indices));
    const mesh = new THREE.SkinnedMesh(g, new THREE.MeshStandardMaterial({ name: gltf.materials[p.material]!.name }));
    mesh.bind(skeleton);
    return mesh;
  });
}

/** The furthest any torso piece reaches past the torso's flesh while nearer a limb's, in cm (measured 2026-11-03), and
 *  what reaches. 3 cm is a hose or rivet lying on the skin. Absent: 3. */
const REACH_CM: Partial<Record<string, { cm: number; what: string }>> = {
  ogre: { cm: 21, what: 'the hide kilt hangs from the belt over the thighs, and stays on the belt' },
  gamer: { cm: 51, what: 'the gaming chair he is fused to: its base and armrests stay with the chair' },
  chair: { cm: 21, what: 'the chair he is: its seat frame runs under the thighs and beside the arms' },
  cerebrax: { cm: 13.5, what: 'the harness ring\'s leg sockets, where each leg hangs off the frame (13.1 cm, 2026-11-09)' },
  gibbet: { cm: 16, what: 'the yoke bar across the chest the arms are chained to' },
  flayer: { cm: 9.6, what: 'the hip sockets on the pelvis; the spine-to-shoulder coupling (7.3 cm) is a follow-up' },
  butcher: { cm: 9, what: 'the hip sockets on the pelvis' },
  deadeye: { cm: 9.6, what: 'the hip sockets on the pelvis' },
  twinhead: { cm: 4.5, what: 'the pelvis housing over the hip' },
  clown: { cm: 11.5, what: 'the skirt flares over the hips and stays on the waist' },
  'clown-alt': { cm: 11.5, what: 'the skirt flares over the hips and stays on the waist' },
  soldier: { cm: 12.5, what: 'the cuirass\'s shoulders, armour that sheds by its own plate rules' },
  juggernaut: { cm: 17, what: 'the front plate\'s shoulders, armour that sheds by its own plate rules' },
};

const KITS = Object.keys(CHARACTERS).filter(name => characterEntry(name).kit !== undefined);
const ARMS_AND_LEGS: readonly LimbId[] = ['armL', 'armR', 'legL', 'legR'];

describe('kit shedding', () => {
  it('every kit is breakable: it sheds with its anatomy, or is armour', () => {
    expect(KITS.length).toBeGreaterThan(20);
    for (const name of KITS) {
      const e = characterEntry(name);
      expect(e.kitSheds === true || e.armoured === true, name).toBe(true);
    }
  });

  it('a horn rides the head and a tusk its forearm, though their own bones name neither (gnasher)', () => {
    const pieces = kitMeshes(characterEntry('gnasher').kit!).flatMap(piecesOf);
    const limbs = new Set(pieces.map(p => `${p.bone}:${p.limb}`));
    expect([...limbs].sort()).toEqual(['horn2.l:head', 'horn2.r:head', 'tusk1.l:armL', 'tusk1.r:armR']);
  });

  describe.each(KITS.filter(name => characterEntry(name).kitScale === undefined))('%s', name => {
    const entry = characterEntry(name);
    const pieces = kitMeshes(entry.kit!).flatMap(piecesOf);
    const doc = parseBlob(entry.src);
    const body = buildBody(compileBlob(doc, compileFace(doc)));
    const attached = (b: typeof body, p: Piece) => kitPieceAttached(p.limb, p.support, kitSupportIndex(b), p.anchor);

    it('each limb\'s pieces stay on the intact body and leave with the limb', () => {
      for (const p of pieces) expect(attached(body, p), `${p.bone} intact`).toBe(true);
      for (const limb of ARMS_AND_LEGS) {
        if (!body.clusters.some(c => c.limb === limb)) continue;
        const cut = severLimb(body, limb).body;
        for (const p of pieces) expect(attached(cut, p), `${p.bone} after the ${limb} cut`).toBe(p.limb !== limb);
      }
    });

    it('nothing on the torso reaches far into a limb', () => {
      const flesh = body.prims.filter(p => p.op !== 'sub');
      let worst = 0, at = '';
      for (const p of pieces) {
        if (p.limb !== 'torso') continue;
        const pos = p.source.geometry.getAttribute('position'), verts = [...new Set(p.indices)];
        const step = Math.max(1, Math.floor(verts.length / 48));
        for (let k = 0; k < verts.length; k += step) {
          const v = verts[k]!, q: Vec3 = [pos.getX(v), pos.getY(v), pos.getZ(v)];
          let torso = Infinity, limb = Infinity;
          for (const f of flesh) {
            const d = sdPrimitive(q, f);
            if (f.limb === 'torso' || f.limb === 'head') torso = Math.min(torso, d); else limb = Math.min(limb, d);
          }
          if (limb < torso && torso > worst) { worst = torso; at = `${p.bone} at ${q.map(c => c.toFixed(2))}`; }
        }
      }
      expect(worst * 100, at).toBeLessThanOrEqual(REACH_CM[name]?.cm ?? 3);
    });
  });
});
