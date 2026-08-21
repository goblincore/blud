// src/lab/sdf-zombie/characters/goblin-kit.test.ts
//
// Does the armour fit the goblin?
//
// This is the check a mesh pipeline cannot cheaply have and an SDF one gets
// almost free. WAM spends ~955 lines of triangle raycasting on `noclip`
// because a mesh has no interior and containment has to be built by
// parity-counting ray crossings. Here "is this point inside the flesh" is
// `sdBody(p) < 0`, so a kit authored in one language is checkable against a
// body authored in another, in a unit test, with no renderer and no GPU.
//
// It matters because the two files have NO enforced relationship.
// goblin-kit.wam transcribes goblin.blob's skeleton by hand — into height
// fractions instead of metres, with the pitch sign flipped on every `down`
// bone — and every plate dimension was sized against flesh that lives entirely
// in the other file. Nothing else notices when the .blob moves. The
// arm-clearance work already narrowed every torso ring once.
//
// THIS READS THE COMPILED MESH, not the .wam text. An earlier version compared
// authored `ring` widths against flesh measured at the same t, and its own
// docstring named the gap that then bit: "a cap ... can still land somewhere
// this does not look". It passed the pauldron while the shoulder orbs were
// visibly poking through it in the lab, because the clipping was in the
// `cap start=dome`, which has no ring line to check. Vertices have nowhere to
// hide.
//
// glTF skinning means the stored POSITION *is* the rest-pose world position:
// a skinned vertex is Σ wᵢ · (jointGlobalᵢ · inverseBindᵢ) · v, and at bind
// pose jointGlobal equals the bind matrix, so the product is identity. WAM
// exports in metres, the same space .blob uses, so the two compare directly
// with no transform at all.
import { describe, it, expect } from 'vitest';
import blobSrc from './goblin.blob?raw';
import kitJson from '../../../../public/assets/lab/goblin-kit.gltf?raw';
import { parseBlob } from '../blob-parse';
import { compileBlob } from '../blob-compile';
import { buildBody } from '../build-body';
import { sdBody } from '../validate';
import type { Vec3 } from '../types';

interface Gltf {
  buffers: { uri: string; byteLength: number }[];
  bufferViews: { buffer: number; byteOffset?: number; byteLength: number }[];
  accessors: { bufferView: number; byteOffset?: number; count: number; type: string; componentType: number }[];
  meshes: { primitives: { attributes: Record<string, number>; indices: number; material: number }[] }[];
  materials: { name: string }[];
  nodes: { name?: string; translation?: number[] }[];
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

describe('goblin-kit.gltf fits goblin.blob', () => {
  const body = buildBody(compileBlob(parseBlob(blobSrc)));
  const groups = verticesByMaterial();

  // Guards the decode. A parse that silently yields nothing turns every
  // it.each below into zero tests, which reports as a pass.
  it('decodes the compiled kit', () => {
    // Named explicitly so a material vanishing from the .wam is a failure
    // rather than a silently smaller test. `cloth` was here until the kilt
    // became a plate fauld.
    expect([...groups.keys()].sort()).toEqual(['brass', 'iron', 'leather']);
    for (const [name, vs] of groups) expect(vs.length, name).toBeGreaterThan(8);
  });

  // NO PLATE MAY PASS CLEAN THROUGH THE GOBLIN.
  //
  // The tolerance is not slack, it is the shape of the problem. Armour is
  // meant to sit against skin, and a rim legitimately TUCKS UNDER the flesh it
  // wraps — the pauldron's inner rim is buried 36 mm in the chest and that is
  // forced, not sloppy: .blob's shoulder orb is 108 mm across sitting 78 mm
  // from the body axis, so any shell that encloses it reaches past the
  // centreline. There is no pauldron that both covers the orb and clears the
  // ribs, and real ones tuck the same way. So does the cleaver's haft, which
  // is inside a closed fist by definition.
  //
  // What the bound catches is geometry that is not a tuck at all: interior
  // faces, and pieces sized against the wrong body. Every value it rejected in
  // practice was a `cap flat` disc slicing through a limb — the belt's cap
  // centre sat 61 mm in, dead on the body axis — which is why nothing in the
  // .wam is capped flat any more.
  //
  // Re-derive it, do not raise it: the deepest legitimate tuck is a property
  // of how far the widest joint sits from the body axis, and if a redesign
  // needs more room than this, the plate has probably stopped being plate.
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

  // THE OWNER-REPORTED BUG, pinned directly. "The shoulder pauldrons clip into
  // the shoulder orbs": the orb reached y=1.039 and the plate crowned at 1.020,
  // so green flesh punched through grey steel from every angle.
  //
  // Worth its own test because the depth check above cannot see it. Nothing was
  // inside anything — the plate was simply too short, which is a COVERAGE
  // failure, and coverage is invisible to a containment test. The ring-level
  // check that preceded this passed it too, for the same reason plus one more:
  // the shortfall was in a `cap dome`, which has no ring line to measure.
  it('crowns the shoulder orbs instead of letting them punch through', () => {
    // The orb is the fattest sphere (a === b) in the arm cluster — the
    // shoulder ball authored at the clavicle tail.
    const arm = body.clusters.find(c => c.limb === 'armL')!;
    const orb = body.prims.slice(arm.start, arm.start + arm.count)
      .filter(p => p.a[1] === p.b[1] && p.a[0] === p.b[0])
      .reduce((best, p) => (p.radius > best.radius ? p : best));
    const top = orb.a[1] + orb.radius * Math.min(...orb.scale);
    const kitTop = Math.max(...[...groups.values()].flat().map(v => v[1]));
    expect(kitTop, `orb crown ${top.toFixed(4)}`).toBeGreaterThan(top);
  });
});
