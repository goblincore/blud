// src/lab/sdf-zombie/characters/soldier-kit.test.ts
//
// Does the armour fit the soldier?
//
// The goblin-kit test's argument, verbatim: WAM and .blob have NO enforced
// relationship — soldier-kit.wam transcribes soldier.blob's skeleton by hand
// (height fractions instead of metres, pitch sign flipped on every `down`
// bone) and every ring was sized against flesh that lives in the other file.
// "Is this point inside the flesh" is `sdBody(p) < 0`, so the compiled mesh
// is checkable against the body in a unit test, no renderer, no GPU. This
// reads the COMPILED mesh — vertices have nowhere to hide, unlike ring lines
// (the goblin's pauldron bug lived in a `cap dome` no ring line measured).
import { describe, it, expect } from 'vitest';
import blobSrc from './soldier.blob?raw';
import kitJson from '../../../../public/assets/lab/soldier-kit.gltf?raw';
import { parseBlob } from '../blob-parse';
import { compileBlob, compileFace } from '../blob-compile';
import { buildBody } from '../build-body';
import { sdBody } from '../validate';
import { boneFrames } from '../rig-frames';
import { bindRig } from '../rig-bind';
import type { Vec3 } from '../types';

interface Gltf {
  buffers: { uri: string; byteLength: number }[];
  bufferViews: { buffer: number; byteOffset?: number; byteLength: number }[];
  accessors: { bufferView: number; byteOffset?: number; count: number; type: string; componentType: number }[];
  meshes: { primitives: { attributes: Record<string, number>; indices: number; material: number }[] }[];
  materials: { name: string }[];
  nodes: { name?: string; translation?: number[]; children?: number[] }[];
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

// 5121 = u8, 5123 = u16, 5125 = u32. WAM picks by vertex count.
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

describe('soldier-kit.gltf fits soldier.blob', () => {
  const body = buildBody(compileBlob(parseBlob(blobSrc), compileFace(parseBlob(blobSrc))));
  const groups = verticesByMaterial();

  // Guards the decode. A parse that silently yields nothing turns every
  // it.each below into zero tests, which reports as a pass.
  it('decodes the compiled kit', () => {
    expect([...groups.keys()].sort()).toEqual(['plate', 'webbing']);
    // A kind=box attach emits EXACTLY 8 corner vertices, and the pouches and
    // front plate are boxes — but every material here also wraps a loft, so
    // no group is at the floor. Still assert >= 8, never > 8: a future
    // material that is ALL boxes can never beat 8 (the goblin-kit lesson).
    for (const [name, vs] of groups) expect(vs.length, name).toBeGreaterThanOrEqual(8);
  });

  // NO PLATE MAY PASS CLEAN THROUGH THE SOLDIER.
  //
  // Re-derived for THIS anatomy, per the goblin test's own rule ("re-derive
  // it, do not raise it"). The deepest legitimate tuck here is the pauldron's
  // inner rim, and it is forced: the deltoid orb is 0.202 m across centred
  // 0.142 m from the body axis, so any ring that encloses it reaches x=0.04
  // while the chest wall sits at x=0.09-0.115 — the rim is buried ~60-75 mm
  // in the torso no matter who authors it, and real pauldrons tuck under the
  // same way. The .wam shifts every ring 15 mm outward (side=0.0088) to keep
  // the tuck from running deeper than that.
  //
  // What the bound catches is what the goblin's caught: geometry that is not
  // a tuck at all — `cap flat` discs through limbs, pieces sized against the
  // wrong body. The boot shaft's bottom cap and the foot's heel/toe caps are
  // safe by construction: they face the bare-ankle gap and open air, no limb.
  const TUCK_MAX = 0.080;

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

  // COVERAGE, the failure containment cannot see (the goblin pauldron bug's
  // lesson): nothing was inside anything, the plate was simply too short.
  // The pauldron exists to crown the deltoid orb — the flat top was authored
  // 2 mm over the measured crown (y=1.448) — so pin it directly.
  it('crowns the deltoid orb instead of letting it punch through', () => {
    // The orb is the fattest sphere (a === b) in the arm cluster — the
    // deltoid blob authored at the upperarm's head.
    const arm = body.clusters.find(c => c.limb === 'armL')!;
    const orb = body.prims.slice(arm.start, arm.start + arm.count)
      .filter(p => p.a[1] === p.b[1] && p.a[0] === p.b[0])
      .reduce((best, p) => (p.radius > best.radius ? p : best));
    const top = orb.a[1] + orb.radius * Math.min(...orb.scale);
    const kitTop = Math.max(...[...groups.values()].flat().map(v => v[1]));
    expect(kitTop, `orb crown ${top.toFixed(4)}`).toBeGreaterThan(top);
  });

  // HE STANDS ON HIS BOOTS. The ankle is 15 cm of bare bone (the shin flesh
  // ends at y=0.214, the foot flesh tops at y=0.066), so if the boot's sole
  // floats, NOTHING catches him — the .wam sized every foot ring to put its
  // bottom on y=0. Pin the sole, and pin that the lowest geometry is a boot,
  // i.e. out at the foot, not a torso hem.
  it('stands on his boots, sole on the ground', () => {
    const all = [...groups.values()].flat();
    const bottom = Math.min(...all.map(v => v[1]));
    expect(bottom).toBeLessThan(0.012);
    const lowest = all.reduce((a, b) => (b[1] < a[1] ? b : a));
    expect(Math.abs(lowest[0]), `lowest vertex at (${lowest.map(n => n.toFixed(3)).join(', ')})`)
      .toBeGreaterThan(0.04); // out at a foot (ankle x=0.097), not the body axis
  });
});

describe('the kit skeleton transcribes the blob skeleton (rest identity)', () => {
  const body = buildBody(compileBlob(parseBlob(blobSrc), compileFace(parseBlob(blobSrc))));
  const bound = bindRig(body);
  // World position of every glTF node by walking translations root→leaf.
  const parent = new Map<number, number>();
  gltf.nodes.forEach((n, i) => (n.children ?? []).forEach(c => parent.set(c, i)));
  const worldOf = (i: number): Vec3 => {
    let x = 0, y = 0, z = 0;
    for (let k: number | undefined = i; k !== undefined; k = parent.get(k)) {
      const t = gltf.nodes[k]!.translation ?? [0, 0, 0];
      x += t[0]!; y += t[1]!; z += t[2]!;
    }
    return [x, y, z];
  };
  it('every named kit bone sits at its blob bone head, within 1 mm', () => {
    const frames = boneFrames(body, bound, 0);
    let checked = 0;
    gltf.nodes.forEach((n, i) => {
      const f = n.name ? frames.get(n.name) : undefined;
      if (!f) return;
      const w = worldOf(i);
      for (let k = 0; k < 3; k++) expect(Math.abs(w[k]! - f.pos[k]!), `${n.name}[${k}]`).toBeLessThan(1e-3);
      checked++;
    });
    expect(checked).toBe(body.bones.size);
  });
  it('rest frames are the identity rotation', () => {
    for (const [name, f] of boneFrames(body, bound, 0)) expect(f.quat, name).toEqual([0, 0, 0, 1]);
  });
});
