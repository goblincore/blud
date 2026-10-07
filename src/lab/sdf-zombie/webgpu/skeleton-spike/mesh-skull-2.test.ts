import { describe, expect, it } from 'vitest';
import { parseBlob } from '../../blob-parse';
import { compileBlob } from '../../blob-compile';
import { buildBody, DEFAULT_BUILD_OPTS } from '../../build-body';
import { bindRig } from '../../rig-bind';
import { sdBody } from '../../validate';
import zombie from '../../characters/zombie.blob?raw';
import soldier from '../../characters/soldier.blob?raw';
import cultist from '../../characters/cultist.blob?raw';
import { createSkeletonSources, type BoneFieldSource, type Point3 } from './contract';
import { meshBoneSource, MESH_SKULL_2_REVISION, SOLDIER_MESH_SKULL_2_REVISION } from './mesh-skull';
import {
  SKULL2_FACE, SKULL2_SOLDIER, SKULL2_ZOMBIE, skull2BrowTop, skull2Erosion, skull2JawOf, skull2Nose, skull2Orbit, skull2Raise,
} from './mesh-skull-2';
import { extractSegmentMesh, MESH_CELL, SegmentMeshCache } from './mesh';
import { meshEyePlacements } from './mesh-eyes';
import { SCULPT_FINE_CELL, sculptRecipe } from './sculpt-variant';

/** The point at normalized (x, y, z) of a source's bounds. */
function at(source: BoneFieldSource, x: number, y: number, z: number): Point3 {
  return [x, y, z].map((v, i) => source.bounds.min[i]! + (v + 1) * 0.5 * (source.bounds.max[i]! - source.bounds.min[i]!)) as unknown as Point3;
}
/** The normalized z of the bone's front surface on the line through (x, y); -1 where there is none. */
function front(source: BoneFieldSource, x: number, y: number): number {
  for (let z = 1.2; z >= -1; z -= 0.002) if (source.distance(at(source, x, y, z)) <= 0) return z;
  return -1;
}
const sourcesOf = (character: string, blob: string) => {
  const body = buildBody(compileBlob(parseBlob(blob)), DEFAULT_BUILD_OPTS);
  return { body, sources: createSkeletonSources(body, bindRig(body), { character }) };
};

describe('the second sculpt\'s outlines', () => {
  const o = SKULL2_FACE.orbit;
  it('the orbit holds the eye, is wider than tall and droops at its outer corner', () => {
    expect(skull2Orbit(o.x, o.y)).toBeLessThan(0);
    // Wider than tall, in the head's own proportions (a normalized unit of height is the longer one).
    expect(o.halfW).toBeGreaterThan(o.halfH);
    // The outer lower corner is inside, the outer upper corner the same step away is outside: the outline is turned.
    expect(skull2Orbit(o.x + 0.20, o.y - 0.14)).toBeLessThan(0);
    expect(skull2Orbit(o.x + 0.20, o.y + 0.14)).toBeGreaterThan(0);
    // And the inner upper corner is inside where the inner lower one is not.
    expect(skull2Orbit(o.x - 0.20, o.y + 0.14)).toBeLessThan(0);
    expect(skull2Orbit(o.x - 0.20, o.y - 0.14)).toBeGreaterThan(0);
    // The two orbits do not meet: bone stands between them.
    expect(skull2Orbit(0, o.y)).toBeGreaterThan(0.02);
  });

  it('the nasal aperture is a pear: narrow at the top, two lobes and a spine between them at the bottom', () => {
    const n = SKULL2_FACE.nose, widthAt = (y: number) => { let w = 0; for (let x = 0; x < 0.4; x += 0.002) if (skull2Nose(x, y) < 0) w = x; return w; };
    expect(widthAt(n.top - 0.03)).toBeLessThan(0.06);
    expect(widthAt(n.lobeY)).toBeGreaterThan(0.14);
    expect(widthAt(n.lobeY)).toBeGreaterThan(widthAt(n.top - 0.03) * 2.5);
    // Under the lobes' middle the aperture reaches lower than on the midline: the spine.
    const bottomAt = (x: number) => { let b = 0; for (let y = 0; y > -0.4; y -= 0.002) if (skull2Nose(x, y) < 0) b = y; return b; };
    expect(bottomAt(n.lobeX)).toBeLessThan(bottomAt(0) - 0.02);
    // It stays clear of the orbits above and of the teeth's roots below.
    expect(n.top).toBeLessThan(o.y);
    expect(bottomAt(n.lobeX)).toBeGreaterThan(SKULL2_FACE.teeth.upperRoot);
  });

  it('the brow\'s edge falls toward the temple, and the forehead sinks above it only', () => {
    expect(skull2BrowTop(0)).toBe(SKULL2_FACE.brow.top);
    expect(skull2BrowTop(0.6)).toBeLessThan(skull2BrowTop(0.2));
    const top = skull2BrowTop(0.3);
    expect(skull2Erosion(0.3, top + 0.12, 0.8)).toBeCloseTo(SKULL2_FACE.brow.sink, 4);
    expect(skull2Erosion(0.3, top - 0.03, 0.8)).toBe(0);
    // The ridge itself is what a character's raise lifts.
    expect(skull2Raise(0.3, top - 0.05, 0.8).brow).toBeCloseTo(1, 3);
    expect(skull2Raise(0.3, top + 0.12, 0.8).brow).toBe(0);
    expect(skull2Raise(0.3, top - 0.05, -0.5).brow).toBe(0);
    expect(skull2Raise(SKULL2_FACE.malar.x, SKULL2_FACE.malar.y, 0.7).malar).toBe(1);
  });

  it('an erosion is never negative and is bounded by its deepest part', () => {
    const deepest = Math.max(SKULL2_FACE.brow.sink, SKULL2_FACE.temple.sink, SKULL2_FACE.cheek.sink, SKULL2_FACE.groove.sink);
    for (let x = -1; x <= 1; x += 0.125) for (let y = -1; y <= 1; y += 0.125) for (let z = -1; z <= 1; z += 0.125) {
      const e = skull2Erosion(x, y, z);
      expect(e).toBeGreaterThanOrEqual(0);
      expect(e).toBeLessThanOrEqual(deepest);
      expect(skull2Erosion(-x, y, z)).toBe(e);
    }
  });

  it('only the zombie and the soldier are carved', () => {
    expect(skull2JawOf('zombie')).toBe(SKULL2_ZOMBIE);
    expect(skull2JawOf('soldier')).toBe(SKULL2_SOLDIER);
    expect(skull2JawOf('cultist')).toBeNull();
    // The zombie's sculpt adds nothing.
    expect(SKULL2_ZOMBIE.add).toEqual([]);
    expect(SKULL2_ZOMBIE.raise).toEqual({ brow: 0, malar: 0 });
  });
});

describe.each([['zombie', zombie, MESH_SKULL_2_REVISION], ['soldier', soldier, SOLDIER_MESH_SKULL_2_REVISION]])('%s: the second sculpt', (character, blob, revision) => {
  const { body, sources } = sourcesOf(character, blob);
  const original = sources.find(s => s.segment === 'head')!;
  const first = meshBoneSource(original);
  const skull = meshBoneSource(original, 2);
  const { teeth, orbit, nose } = SKULL2_FACE;

  it('is its own revision of the head, and leaves the first sculpt and every other source alone', () => {
    expect(skull.revision).toBe(`${original.revision}:${revision}`);
    expect(skull.revision).not.toBe(first.revision);
    expect(meshBoneSource(skull, 2)).toBe(skull);
    expect(meshBoneSource(original).revision).toBe(first.revision);
    const limb = sources.find(s => s.segment !== 'head')!;
    expect(meshBoneSource(limb, 2)).toBe(limb);
    expect(skull.bounds).toBe(original.bounds);
  });

  it('carves the orbits, the aperture and the parting of the jaws deep into the bone', () => {
    for (const [x, y] of [[orbit.x, orbit.y], [-orbit.x, orbit.y], [nose.lobeX, nose.lobeY], [0, (teeth.upperTip + teeth.lowerTip) / 2]]) {
      expect(front(original, x!, y!) - front(skull, x!, y!), `${x},${y}`).toBeGreaterThan(0.3);
    }
    // The orbit's floor is where the table puts it, flat under the eye.
    expect(front(skull, orbit.x, orbit.y)).toBeCloseTo(orbit.floor, 2);
    expect(front(skull, orbit.x + 0.1, orbit.y)).toBeCloseTo(orbit.floor, 2);
    // Bone stands between the orbits, and between the orbit and the aperture.
    expect(front(skull, 0, orbit.y)).toBeGreaterThan(0.7);
  });

  it('parts the jaws: both tooth rows stand well forward of the gap between them', () => {
    const gap = front(skull, 0, (teeth.upperTip + teeth.lowerTip) / 2);
    for (const x of [0, 0.15, -0.15]) {
      expect(front(skull, x, teeth.upperTip + 0.04), `upper ${x}`).toBeGreaterThan(gap + 0.4);
      expect(front(skull, x, teeth.lowerTip - 0.04), `lower ${x}`).toBeGreaterThan(gap + 0.4);
    }
    // The gap runs the width of the arch, and is closed at the back: the lower jaw hangs from the skull.
    expect(front(skull, 0.25, (teeth.upperTip + teeth.lowerTip) / 2)).toBeLessThan(0.3);
    expect(skull.distance(at(skull, 0, (teeth.upperTip + teeth.lowerTip) / 2, 0))).toBeLessThan(0);
  });

  it('leaves the upper jaw standing as an arch: the side of the face behind it is cut away under the cheekbone', () => {
    const y = -0.34, arch = SKULL2_FACE.arch.halfW;
    // On the arch, bone to the front; just outside it, nothing until well behind.
    expect(front(skull, arch - 0.10, y)).toBeGreaterThan(0.7);
    expect(front(skull, arch + 0.10, y)).toBeLessThan(front(skull, arch - 0.10, y) - 0.25);
    // The cheekbone above is still there.
    expect(skull.distance(at(skull, 0.5, -0.02, front(original, 0.5, -0.02) - 0.15))).toBeLessThan(0);
  });

  it('has a chin: the lower jaw narrows to it and ends flat', () => {
    const jaw = skull2JawOf(character)!;
    expect(front(skull, 0, jaw.chin - 0.03)).toBe(-1);
    expect(front(skull, 0, jaw.chin + 0.06)).toBeGreaterThan(0.65);
    // Its underside is hollow between the two arms.
    expect(skull.distance(at(skull, 0, jaw.chin + 0.06, SKULL2_FACE.under.z))).toBeGreaterThan(0);
    expect(skull.distance(at(skull, jaw.chinHalfW + 0.12, jaw.chin + 0.04, 0.5))).toBeGreaterThan(0);
  });

  it('seats both eyes on the orbits\' floors, inside the orbits\' outline', () => {
    const eyes = meshEyePlacements(skull);
    expect(eyes).toHaveLength(2);
    const half = original.bounds.max.map((v, i) => (v - original.bounds.min[i]!) / 2);
    for (const e of eyes) {
      // The seat is on the eye line, sunk into the floor, with its front pole in the open.
      expect(Math.abs(e.center[0] - at(skull, Math.sign(e.center[0]) * orbit.x, 0, 0)[0])).toBeLessThan(1e-9);
      expect(e.center[1]).toBeCloseTo(at(skull, 0, orbit.y, 0)[1], 9);
      expect(skull.distance(e.center)).toBeLessThan(0);
      expect(skull.distance([e.center[0], e.center[1], e.center[2] + e.radius])).toBeGreaterThan(0);
      // The ball's outline, seen from the front, lies inside the orbit's: no bone stands in front of the eye.
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 12) {
        const dx = Math.cos(a) * e.radius * 0.95 / half[0]!, dy = Math.sin(a) * e.radius * 0.95 / half[1]!;
        expect(skull2Orbit(orbit.x + dx, orbit.y + dy), `angle ${a.toFixed(2)}`).toBeLessThan(0);
      }
    }
  });

  it.each([['the cache\'s cell', MESH_CELL], ['the fine cell', SCULPT_FINE_CELL]])('keeps every extracted vertex at least 3 mm under the intact flesh (%s)', (_name, cell) => {
    const mesh = extractSegmentMesh(original, cell, 2);
    expect([mesh.overflow, mesh.clamped, mesh.droppedQuads]).toEqual([false, false, 0]);
    expect(mesh.key).toBe(`${skull.revision}@${cell}`);
    const positions = mesh.geometry.getAttribute('position');
    let worst = -Infinity;
    for (let i = 0; i < positions.count; i++) {
      worst = Math.max(worst, sdBody(original.toWorld([positions.getX(i), positions.getY(i), positions.getZ(i)]), body));
    }
    mesh.geometry.dispose();
    expect(worst).toBeLessThanOrEqual(-0.003);
  });

  it('the fine cell makes a finer mesh of the same field', () => {
    const coarse = extractSegmentMesh(original, MESH_CELL, 2), fine = extractSegmentMesh(original, SCULPT_FINE_CELL, 2);
    expect(fine.verts).toBeGreaterThan(coarse.verts * 3);
    expect(fine.tris).toBeGreaterThan(coarse.tris * 3);
    // Both are meshes of one surface: the fine one's vertices lie on the field the coarse one was cut from.
    const p = fine.geometry.getAttribute('position');
    let off = 0;
    for (let i = 0; i < p.count; i += 7) off = Math.max(off, Math.abs(skull.distance([p.getX(i), p.getY(i), p.getZ(i)])));
    expect(off).toBeLessThan(SCULPT_FINE_CELL);
    coarse.geometry.dispose(); fine.geometry.dispose();
  });

  it('a cache with a variant\'s recipe extracts the head by it and everything else as ever', () => {
    const plain = new SegmentMeshCache(), full = new SegmentMeshCache(MESH_CELL, null, sculptRecipe('full')), shape = new SegmentMeshCache(MESH_CELL, null, sculptRecipe('shape'));
    expect(full.keyOf(original)).toBe(`${skull.revision}@${SCULPT_FINE_CELL}`);
    expect(shape.keyOf(original)).toBe(`${skull.revision}@${MESH_CELL}`);
    expect(new SegmentMeshCache(MESH_CELL, null, sculptRecipe('paint')).keyOf(original)).toBe(plain.keyOf(original));
    expect(full.get(original).key).toBe(full.keyOf(original));
    expect(full.get(original)).toBe(full.get(original));
    const limb = sources.find(s => s.segment !== 'head')!;
    expect(full.keyOf(limb)).toBe(plain.keyOf(limb));
    expect(full.keyOf(limb).endsWith(`@${MESH_CELL}`)).toBe(true);
    plain.dispose(); full.dispose(); shape.dispose();
  });
});

describe('what each character\'s second sculpt may add', () => {
  it('the zombie\'s only removes: every surviving point is inside the authored bone', () => {
    const original = sourcesOf('zombie', zombie).sources.find(s => s.segment === 'head')!;
    const skull = meshBoneSource(original, 2);
    for (let x = -1; x <= 1; x += 0.1) for (let y = -1; y <= 1; y += 0.1) for (let z = -1; z <= 1; z += 0.1) {
      const p = at(original, x, y, z);
      expect(skull.distance(p)).toBeGreaterThanOrEqual(original.distance(p));
    }
  });

  it('the soldier\'s adds an upper jaw where his authored bone has a crease, and raises the brow', () => {
    const original = sourcesOf('soldier', soldier).sources.find(s => s.segment === 'head')!;
    const skull = meshBoneSource(original, 2);
    // The upper teeth's front stands forward of the authored crease there.
    const y = SKULL2_FACE.teeth.upperTip + 0.06;
    expect(front(skull, 0.12, y)).toBeGreaterThan(front(original, 0.12, y) + 0.08);
    // The brow ridge stands proud of the authored surface by about its raise; the forehead above it does not.
    const top = skull2BrowTop(0.3), unit = (original.bounds.max[2] - original.bounds.min[2]) / 2;
    expect((front(skull, 0.3, top - 0.05) - front(original, 0.3, top - 0.05)) * unit).toBeGreaterThan(SKULL2_SOLDIER.raise.brow * 0.6);
    expect(front(skull, 0.3, top + 0.15)).toBeLessThan(front(original, 0.3, top + 0.15));
  });

  it('a head it does not carve is returned as it came', () => {
    const head = sourcesOf('cultist', cultist).sources.find(s => s.segment === 'head')!;
    expect(meshBoneSource(head, 2)).toBe(head);
    const cache = new SegmentMeshCache(MESH_CELL, null, sculptRecipe('full'));
    // And it is extracted at the cache's own cell: the fine cell is for a head the sculpt carves.
    expect(cache.keyOf(head)).toBe(`${head.revision}@${MESH_CELL}`);
    cache.dispose();
  });
});
