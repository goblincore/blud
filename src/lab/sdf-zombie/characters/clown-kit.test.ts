// src/lab/sdf-zombie/characters/clown-kit.test.ts
//
// Does the outfit fit the clown? Same bargain as goblin-kit.test.ts: the kit
// is authored in WAM against flesh that lives in another file, nothing else
// notices when either moves, and "is this point inside the body" is one
// sdBody call — so a polygon garment is checkable against an SDF body in a
// unit test with no renderer and no GPU.
//
// THIS READS THE COMPILED MESH, not the .wam text, for the goblin kit's
// reason: vertices have nowhere to hide. Attempt one of this character
// shipped tests asserting its MATERIAL LIST while the stripes were broken,
// rebuilt the glTF, and never re-ran — so this file also pins things the
// owner actually rejected (cap swallowing the face, pom-poms lost inside the
// collar) rather than only what the compiler could get wrong.
import { describe, it, expect } from 'vitest';
import blobSrc from './clown.blob?raw';
import kitJson from '../../../../public/assets/lab/clown-kit.gltf?raw';
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
    out.set(name, [...(out.get(name) ?? []), ...seen].map(i => pos[i]!));
  }
  return out;
}

describe('clown-kit.gltf fits clown.blob', () => {
  const body = buildBody(compileBlob(parseBlob(blobSrc)));
  const groups = verticesByMaterial();

  // Guards the decode. A parse that silently yields nothing turns every
  // it.each below into zero tests, which reports as a pass.
  //
  // PINNED EXPLICITLY, and re-checked after EVERY rebuild — attempt one of
  // this very character asserted this list while its stripes were broken,
  // then fixed the stripes, rebuilt the glTF, and shipped with the stale
  // assertion failing. The list changes only by a deliberate palette edit.
  it('decodes the compiled kit', () => {
    expect([...groups.keys()].sort()).toEqual(
      ['blue', 'gold', 'grey', 'pink', 'purple', 'red', 'royal', 'white', 'yellow']);
    for (const [name, vs] of groups) expect(vs.length, name).toBeGreaterThan(8);
  });

  // NOTHING ON THE OUTFIT MAY PASS CLEAN THROUGH THE CLOWN. Same shape as
  // the goblin's bound: garments legitimately TUCK (the ruff beads ride the
  // head ball's surface with their inner poles ~44 mm deep — forced, since
  // there is no neck to hang a collar on), but anything deeper than that is
  // geometry sized against the wrong height, which is how attempt one's hem
  // ended up 53 mm inside the belly.
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

  // THE OWNER'S EXPLICIT COMPLAINT ABOUT ATTEMPT ONE: "the cap swallowed the
  // face". Coverage is invisible to the containment test above, so it gets
  // its own pin: the cap's front rim must stay ABOVE the eye line (~y 0.79,
  // sheet eyeRise 0.42 over a cranium spanning y 0.532..1.002). 0.80 keeps a
  // 10 mm margin; the band ships at y 0.825.
  it('cap front rim stays above the eyes', () => {
    const royal = groups.get('royal')!;
    const frontRimY = Math.min(...royal.filter(v => v[2] > 0.10).map(v => v[1]));
    expect(frontRimY).toBeGreaterThan(0.80);
  });

  // ...and the other half of the same complaint: the cap must actually be ON
  // the head. A cap that retreats from the face can also retreat off the
  // crown entirely; the cone apex must clear the cranium's own top (y 1.002).
  it('cap crowns the head instead of floating behind it', () => {
    const royal = groups.get('royal')!;
    expect(Math.max(...royal.map(v => v[1]))).toBeGreaterThan(1.005);
  });

  // THE POM-POMS MUST STICK OUT PAST THE COLLAR — the reference reads them
  // as red dots breaking the grey scallop's silhouette on both sides. Both
  // materials are spheres on the same circle, so this is a radial-reach race
  // between the red vertices near the collar and the grey ones. Measured
  // 12 mm of advantage (202 vs 190 mm); the bound asks for 5.
  it('pom-poms project past the grey collar beads', () => {
    const radial = (v: Vec3) => Math.hypot(v[0], v[2]);
    const greyReach = Math.max(...groups.get('grey')!.map(radial));
    const poms = groups.get('red')!.filter(v => v[1] > 0.55 && v[1] < 0.68);
    expect(poms.length).toBeGreaterThan(0);
    expect(Math.max(...poms.map(radial))).toBeGreaterThan(greyReach + 0.005);
  });

  // THE HAIR IS HALF THE SILHOUETTE. The tufts must break past the cheeks —
  // the cranium's half-width is 0.2256, and tips parked inside that are
  // bumps on the ball, not wings. Measured tip reach ~0.35.
  it('hair tufts sweep out past the cheeks', () => {
    const purple = groups.get('purple')!;
    expect(Math.max(...purple.map(v => Math.abs(v[0])))).toBeGreaterThan(0.26);
  });

  // THE SHOES ARE THE JOKE. Comically oversized against a 0.095 m foot bone:
  // the toe end must reach well past the foot flesh (toe nub at z ~0.091).
  // Measured ~0.19.
  it.each(['l', 'r'])('shoe (%s) runs comically past the foot', side => {
    const red = groups.get('red')!.filter(v => v[1] < 0.15);
    expect(red.length).toBeGreaterThan(0);
    const frontZ = Math.max(...red.filter(v => (side === 'l') === (v[0] >= 0)).map(v => v[2]));
    expect(frontZ).toBeGreaterThan(0.14);
  });

  // Sole bottoms out ON the ground, not through it (ankle y 0.086 minus the
  // slab's 62 mm drop minus half its depth ≈ 10 mm).
  it('shoe soles sit on the ground', () => {
    expect(Math.min(...groups.get('gold')!.map(v => v[1]))).toBeGreaterThan(0);
  });

  // The mitts are white puffs swallowing the flesh mitten whole; they ride
  // at the hand, not drifted down the forearm.
  it('mitts sit at the hands', () => {
    for (const side of ['l', 'r'] as const) {
      const hand = body.bones.get(`hand.${side}`)!.tail;
      const near = groups.get('white')!
        .filter(v => Math.hypot(v[0] - hand[0], v[1] - hand[1], v[2] - hand[2]) < 0.08);
      expect(near.length, `hand.${side}`).toBeGreaterThan(8);
    }
  });
});
