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
    // WAM today emits one primitive per material, so the accumulate path
    // never fires — but the first draft of this line spread the previous
    // VERTICES in with the new INDICES and mapped the lot through pos[],
    // which tsc flagged (Vec3 as an index). Keep the two kinds apart.
    const added = [...seen].map(i => pos[i]!);
    out.set(name, [...(out.get(name) ?? []), ...added]);
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
      ['blue', 'grey', 'hoodblue', 'hoodpink', 'nose', 'pink', 'red', 'white', 'yellow']);
    for (const [name, vs] of groups) expect(vs.length, name).toBeGreaterThan(8);
  });

  // NOTHING ON THE OUTFIT MAY PASS CLEAN THROUGH THE CLOWN. Same shape as
  // the goblin's bound: garments legitimately TUCK (the ruff beads ride the
  // head ball's surface with their inner poles ~44 mm deep — forced, since
  // there is no neck to hang a collar on), but anything deeper than that is
  // geometry sized against the wrong height, which is how attempt one's hem
  // ended up 53 mm inside the belly.
  const TUCK_MAX = 0.045;

  /**
   * The hair tufts are ROOTED, not tucked, and get their own allowance.
   *
   * They mount off the skull's flanks and are meant to be buried at the root —
   * the visible part is the sweep outside the head. The skull was then made
   * 23% wider (headWidth 0.96 -> 1.18) because owner review said the tufts
   * "are floating off to the side because his head is too small and narrow",
   * and a wider skull pushes its own surface OUT past those roots. The extra
   * depth is that fix working.
   *
   * Still bounded, and well short of the failure it guards: a tuft punching
   * out through the FAR side of a skull whose half-width is ~0.28.
   */
  const TUCK_MAX_BY_MATERIAL: Record<string, number> = { hoodblue: 0.08, hoodpink: 0.08 };

  it.each([...groups.keys()])('no %s vertex passes through the body', name => {
    const limit = TUCK_MAX_BY_MATERIAL[name] ?? TUCK_MAX;
    const vs = groups.get(name)!;
    let worst = Infinity, at: Vec3 = vs[0]!;
    for (const v of vs) {
      const d = sdBody(v, body);
      if (d < worst) { worst = d; at = v; }
    }
    expect(worst, `${name} deepest vertex at (${at.map(n => n.toFixed(3)).join(', ')})`)
      .toBeGreaterThan(-limit);
  });

  // THE OWNER'S EXPLICIT COMPLAINT ABOUT ATTEMPT ONE: "the cap swallowed the
  // face". That still has to be pinned — but the RULE has changed, because
  // the cap has.
  //
  // It used to be "no cap geometry in front of z=0.10 below y=0.80", which
  // suited a cap that stopped at the brow. The cap is now a HOODIE that
  // deliberately falls past the eye line down the back and sides, so that
  // bound fails by construction and loosening it would give up the invariant
  // entirely.
  //
  // What actually keeps the face clear is that the hood's rings are pushed
  // BACK, so the head — a ball — protrudes through the front of them. So
  // assert exactly that, at face heights: the hood's frontmost point must sit
  // BEHIND the head's own front surface, marched with sdBody. That is a
  // stronger statement than the old one (it holds at every height, not just
  // above a line) and it is the thing that would actually break if someone
  // widened a ring or reduced its `fwd=` offset.
  it('the face protrudes through the hood rather than being covered', () => {
    const hood = [...groups.get('hoodblue')!, ...groups.get('hoodpink')!];
    for (const y of [0.63, 0.69, 0.75]) {
      // Head's front surface at this height.
      let lo = 0, hi = 0.6;
      for (let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2;
        if (sdBody([0, y, mid], body) < 0) lo = mid; else hi = mid;
      }
      const headFront = lo;
      // +/-0.05 because the loft's rings land at discrete heights; a tighter
      // band falls between two of them and finds nothing.
      const band = hood.filter(v => Math.abs(v[1] - y) < 0.05 && Math.abs(v[0]) < 0.15);
      expect(band.length, `hood band at y=${y}`).toBeGreaterThan(0);
      const hoodFront = Math.max(...band.map(v => v[2]));
      expect(hoodFront, `hood front vs head front at y=${y}`).toBeLessThan(headFront);
    }
  });

  // ...and the other half of the same complaint: the cap must actually be ON
  // the head. A cap that retreats from the face can also retreat off the
  // crown entirely; the cone apex must clear the cranium's own top (y 1.002).
  it('cap crowns the head instead of floating behind it', () => {
    const hood = [...groups.get('hoodblue')!, ...groups.get('hoodpink')!];
    expect(Math.max(...hood.map(v => v[1]))).toBeGreaterThan(1.005);
  });

  // THE POM-POMS MUST STICK OUT PAST THE COLLAR — the reference reads them
  // as red dots breaking the grey scallop's silhouette on both sides. Both
  // materials are spheres on the same circle, so this is a radial-reach race
  // between the red vertices near the collar and the grey ones. Measured
  // 12 mm of advantage (202 vs 190 mm); the bound asks for 5.
  it('pom-poms project past the grey collar beads', () => {
    const radial = (v: Vec3) => Math.hypot(v[0], v[2]);
    const greyReach = Math.max(...groups.get('grey')!.map(radial));
    const poms = groups.get('red')!.filter(v => v[1] > 0.47 && v[1] < 0.62);
    expect(poms.length).toBeGreaterThan(0);
    expect(Math.max(...poms.map(radial))).toBeGreaterThan(greyReach + 0.005);
  });

  // THE HAIR TUFTS ARE GONE — the owner had them removed once the hood fell
  // down the sides itself ("we can get rid of the pink hair pods"). This
  // asserted purple reached past +/-0.26 in x, which was the tufts' wing span.
  //
  // Purple is now the hood's LEFT half, so the invariant worth keeping is the
  // one the removal could silently break: that the hood still covers the head
  // sideways rather than perching on top of it.
  it('the hood reaches out over the head, not just across its crown', () => {
    const hood = [...groups.get('hoodblue')!, ...groups.get('hoodpink')!];
    expect(Math.max(...hood.map(v => Math.abs(v[0])))).toBeGreaterThan(0.26);
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

  // THERE IS NO SOLE ANY MORE, and no `gold` geometry at all. This asserted a
  // gold slab bottomed out on the ground; owner review read that slab as a
  // SANDAL worn under the shoe ("remove the sandles") and it went, along with
  // the gold toe balls that the fattened shoe then swallowed whole.
  //
  // The invariant it protected — the footwear reaches the floor and does not
  // sink through it — still matters, so it moves onto the red shoe itself.
  it('shoes reach the ground without sinking through it', () => {
    const lowest = Math.min(...groups.get('red')!.map(v => v[1]));
    expect(lowest).toBeGreaterThanOrEqual(0);
    expect(lowest).toBeLessThan(0.02);
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
