// src/lab/sdf-zombie/characters/mouse-kit.test.ts
//
// Does the outfit fit the mouse?
//
// The same bargain as goblin-kit.test.ts (read that header first): the kit is
// authored in WAM against flesh that lives in mouse.blob, the two files have
// no enforced relationship, and `sdBody(v) < 0` is the containment check a
// mesh pipeline has to raycast for. THIS READS THE COMPILED glTF, not the
// .wam text — vertices have nowhere to hide.
import { describe, it, expect } from 'vitest';
import blobSrc from './mouse.blob?raw';
import kitJson from '../../../../public/assets/lab/mouse-kit.gltf?raw';
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

describe('mouse-kit.gltf fits mouse.blob', () => {
  const body = buildBody(compileBlob(parseBlob(blobSrc)));
  const groups = verticesByMaterial();

  // Guards the decode. A parse that silently yields nothing turns every
  // it.each below into zero tests, which reports as a pass.
  it('decodes the compiled kit', () => {
    // Named explicitly so a material vanishing from the .wam is a failure
    // rather than a silently smaller test.
    expect([...groups.keys()].sort()).toEqual(['black', 'shoe', 'shorts', 'tee', 'white']);
    for (const [name, vs] of groups) expect(vs.length, name).toBeGreaterThan(8);
  });

  // NO CLOTH MAY PASS CLEAN THROUGH THE MOUSE. The tolerance is the goblin's
  // argument scaled to a body with no armour: clothes sit ON skin, and a rim
  // legitimately tucks under the flesh it wraps — the tee collar dips into
  // the neck, the brow slabs' back rims sink ~20 mm into the crown ON
  // PURPOSE (a rim that stops at the smin surface gaps yellow at its edges).
  // What the bound catches is geometry that is not a tuck at all: interior
  // faces, and rings sized against the wrong body.
  //
  // Per-material bounds, each the measured worst LEGITIMATE tuck plus
  // margin — re-derive, do not raise:
  //   shorts 0.050 — the mirrored leg tubes wrap thighs whose flesh MERGES
  //     at the centreline above y 0.31, so the hem's inner rim crosses the
  //     crotch mass no matter how the tubes are sized (measured -0.046 at
  //     (-0.015, 0.290, 0.011) — between the legs, under the hem, invisible
  //     from any angle). Same forced-tuck class as the goblin's pauldron.
  //   shoe 0.060 — the shoe fully encloses the foot and ankle flesh (that
  //     is what a shoe IS); its deepest vertex is the topline rim against
  //     the shin, not a clip.
  //   everything else 0.030 — cloth on skin.
  const TUCK: Record<string, number> = {
    tee: 0.030, black: 0.030, white: 0.030,
    shorts: 0.050, shoe: 0.060,
  };

  it.each([...groups.keys()])('no %s vertex passes through the body', name => {
    const vs = groups.get(name)!;
    let worst = Infinity, at: Vec3 = vs[0]!;
    for (const v of vs) {
      const d = sdBody(v, body);
      if (d < worst) { worst = d; at = v; }
    }
    expect(worst, `${name} deepest vertex at (${at.map(n => n.toFixed(3)).join(', ')})`)
      .toBeGreaterThan(-TUCK[name]!);
  });

  // THE SHORTS MUST READ. The first compiled kit rendered the shorts as a
  // near-black band that vanished under the tee's shadow: their back sat
  // INSIDE the torso flesh (shorts z-back 0.082 against the flesh's 0.090
  // half-depth at hip height), so from behind there was no blue at all. Pin
  // the coverage directly: the shorts must own the silhouette somewhere on
  // the BACK of the hips (z < 0), not only at the front.
  it('the shorts own the back of the hips, not just the front', () => {
    const vs = groups.get('shorts')!;
    // A vertex that is both behind the body centreline and outside the flesh
    // there is proof the shorts close over the seat.
    const proud = vs.filter(v => v[2] < -0.03 && sdBody(v, body) > 0);
    expect(proud.length).toBeGreaterThan(0);
  });

  // THE SHOES ARE THE GROUND CONTACT. The flesh sole floats at 0.138; the
  // shoe bridges to the floor, so the sole material must touch y ~0 or the
  // mouse levitates.
  it('the soles touch the ground', () => {
    const vs = groups.get('white')!;
    const lowest = Math.min(...vs.map(v => v[1]));
    expect(lowest).toBeLessThan(0.005);
    expect(lowest).toBeGreaterThan(-0.030);
  });
});
