// The anatomical skull fitted to a head's flesh (?skullfit=): every fit on every humanoid, and the default left as it
// was. The fit's own maths is pinned in skull-fit.test.ts; here it is run on the asset the game ships and the bodies
// the game builds.
// @ts-expect-error — node:fs is available in the Vitest runtime
import { readFileSync } from 'node:fs';
import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import {
  AnatomicalSkullKit, HUMANOID_SKULLS, SKULL_EYE_POINT, SKULL_FACE_PIECES, SKULL_FIT_NAMES, SKULL_OPENINGS, SKULL_PIECES,
  skullEyeLine, skullFitMatrix, skullFitOf, type FittedSkull, type SkullFitName,
} from './anatomical-skull';
import { anatomicalSkullSource } from './anatomical-skull.fixture';
import { SKULL_FITS, skullWarpAt, skullWarpJacobian, det3 } from './skull-fit';
import { parseBlob } from '../../blob-parse';
import { compileBlob } from '../../blob-compile';
import { buildBody, DEFAULT_BUILD_OPTS } from '../../build-body';
import { bindRig } from '../../rig-bind';
import { sdBody } from '../../validate';
import { createSkeletonSources, type BoneFieldSource } from './contract';
import { skullRayCast, skullRayHit, intactSkull, type SkullPieceSurface } from '../../skull-fracture';
import { meshEyePlacements } from './mesh-eyes';
import { meshBoneSource } from './mesh-skull';
import { SegmentMeshCache } from './mesh';
import { createBoneMeshCache } from './sculpt-cache';
import { createSegmentMeshRenderer } from './mesh-renderer';
import type { Vec3 } from '../../types';

const CHARACTERS = [...HUMANOID_SKULLS];
const FLESH_FITS = SKULL_FIT_NAMES.filter(n => n !== 'envelope') as Exclude<SkullFitName, 'envelope'>[];
const source = anatomicalSkullSource();
const kitOf = (fit?: SkullFitName) => new AnatomicalSkullKit(source, new THREE.Texture(), new THREE.Vector2(1, 1), fit);

const built = new Map<string, { body: ReturnType<typeof buildBody>; head: BoneFieldSource }>();
const headOf = (character: string) => {
  let b = built.get(character);
  if (!b) {
    const body = buildBody(compileBlob(parseBlob(readFileSync(`src/lab/sdf-zombie/characters/${character}.blob`, 'utf8'))), DEFAULT_BUILD_OPTS);
    b = { body, head: createSkeletonSources(body, bindRig(body), { character }).find(s => s.segment === 'head')! };
    built.set(character, b);
  }
  return b;
};
const fits = new Map<string, FittedSkull>();
const fitOf = (character: string, fit: SkullFitName): FittedSkull => {
  const key = `${character}|${fit}`;
  let f = fits.get(key);
  if (!f) { f = kitOf(fit).head(headOf(character).head)!; fits.set(key, f); }
  return f;
};
const hash = (arrays: ArrayLike<number>[]): string => {
  let h = 2166136261 >>> 0;
  for (const a of arrays) {
    const view = a as unknown as Float32Array, bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
    for (let i = 0; i < bytes.length; i++) { h ^= bytes[i]!; h = Math.imul(h, 16777619) >>> 0; }
  }
  return (h >>> 0).toString(16);
};
const surfacesOf = (pieces: readonly { geometry: THREE.BufferGeometry }[]): SkullPieceSurface[] => pieces.map((p, i) => {
  p.geometry.computeBoundingBox();
  const b = p.geometry.boundingBox!;
  return { id: SKULL_PIECES[i]!, positions: p.geometry.getAttribute('position').array, indices: p.geometry.index!.array, pivot: [0, 0, 0], min: b.min.toArray() as Vec3, max: b.max.toArray() as Vec3 };
});
/** Is the way from far in front of the face to `point` clear of bone? */
const openTo = (pieces: readonly SkullPieceSurface[], point: readonly number[], front: number): boolean =>
  skullRayCast(pieces, intactSkull(pieces.length), [point[0]!, point[1]!, front], [0, 0, -1], front - point[2]!) === null;

describe('the default fit is the envelope fit, as it was', () => {
  // The merged skull's position, normal and uv bytes and every plate's pivot and box, hashed, from the kit of the
  // commit before the fits were added (f127e868), character by character.
  const PINNED: Record<string, string> = {
    zombie: '7521b803', soldier: '78bb2940', cultist: '207d306f', 'cultist-cowled': 'e2f91d15', bride: '65757b34', female: '65b544c',
    schoolgirl: '4fb56c07', 'schoolgirl-alt': '9b20ce99', 'schoolgirl-described': '934ac511', clown: '3400eaad', 'clown-alt': '3400eaad',
    juggernaut: '4f191b22', bonewalker: 'a718fe24',
  };
  it.each(CHARACTERS)('%s: bit for bit, under the old key, with or without the fit named', character => {
    const { head } = headOf(character);
    for (const kit of [kitOf(), kitOf('envelope')]) {
      const skull = kit.head(head)!, g = skull.mesh.geometry;
      const numbers = new Float64Array(skull.pieces.flatMap(p => [...p.pivot, ...p.min, ...p.max]));
      let h = parseInt(hash([g.getAttribute('position').array, g.getAttribute('normal').array, g.getAttribute('uv').array]), 16);
      for (const b of new Uint8Array(numbers.buffer)) { h ^= b; h = Math.imul(h, 16777619) >>> 0; }
      expect((h >>> 0).toString(16)).toBe(PINNED[character]);
      expect(skull.mesh.key).toBe(`${head.revision}:anatomical-skull-1`);
      expect(skull.mesh.bakeMs).toBe(0);
      expect(skull.fit).toBeNull();
    }
    // And it is the old rule, written out: the asset through skullFitMatrix.
    const envelope = new THREE.Box3();
    for (const p of source) { p.geometry.computeBoundingBox(); envelope.union(p.geometry.boundingBox!); }
    const m = skullFitMatrix(head.bounds, envelope, character);
    const skull = kitOf().head(head)!;
    source.forEach((p, i) => {
      const want = p.geometry.clone().applyMatrix4(m);
      expect(hash([skull.pieces[i]!.geometry.getAttribute('position').array])).toBe(hash([want.getAttribute('position').array]));
      expect(hash([skull.pieces[i]!.geometry.getAttribute('normal').array])).toBe(hash([want.getAttribute('normal').array]));
    });
  });
  it('the default kit never asks a head for its flesh', () => {
    const { head } = headOf('zombie');
    const guarded = Object.create(head) as BoneFieldSource;
    Object.defineProperty(guarded, 'flesh', { get: () => { throw new Error('the envelope fit read the flesh'); } });
    expect(kitOf().head(guarded)).not.toBeNull();
    expect(() => kitOf('snug').head(guarded)).toThrow('the envelope fit read the flesh');
  });
  it('?skullfit= names a fit; anything else, and no word at all, is the envelope fit; ?skull=sculpt has no kit to fit', async () => {
    expect(skullFitOf('')).toBe('envelope');
    expect(skullFitOf('?level=night-train')).toBe('envelope');
    expect(skullFitOf('?skullfit=envelope')).toBe('envelope');
    for (const name of FLESH_FITS) expect(skullFitOf(`?a=1&skullfit=${name}`)).toBe(name);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(skullFitOf('?skullfit=huge')).toBe('envelope');
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
    expect((await createBoneMeshCache('?skull=sculpt&skullfit=snug', () => {})).skullKit).toBeNull();
    expect((await createBoneMeshCache('?skull=procedural&skullfit=tight', () => {})).skullKit).toBeNull();
  });
  it('a head whose source carries no flesh gets the envelope fit under any name', () => {
    const { head } = headOf('zombie');
    const bare = Object.create(head) as BoneFieldSource;
    Object.defineProperty(bare, 'flesh', { value: undefined });
    const skull = kitOf('snug').head(bare)!;
    expect(skull.fit).toBeNull();
    expect(hash([skull.mesh.geometry.getAttribute('position').array])).toBe(hash([kitOf().head(head)!.mesh.geometry.getAttribute('position').array]));
  });
});

describe('the asset\'s openings (SKULL_OPENINGS)', () => {
  const raw = surfacesOf(source);
  it('each point is inside its cavity: clear from the front, bone close behind it, bone beside it', () => {
    for (const [name, p] of Object.entries(SKULL_OPENINGS)) {
      expect(openTo(raw, p, 0.2), name).toBe(true);
      const behind = skullRayCast(raw, intactSkull(14), [p[0], p[1], p[2]], [0, 0, -1], 0.03);
      expect(behind, name).not.toBeNull();
      // 14 mm to the side, the first bone from the front stands well in front of the point: the rim (the nasal
      // opening is narrower, 9 mm).
      const off = name === 'nasal' ? 0.009 : 0.022;
      const rim = [0, 1, 2, 3].map(k => skullRayCast(raw, intactSkull(14), [p[0] + Math.cos(k * Math.PI / 2) * off, p[1] + Math.sin(k * Math.PI / 2) * off, 0.2], [0, 0, -1], 0.4));
      expect(rim.filter(h => h && 0.2 - h.distance > p[2] + 0.005).length, name).toBeGreaterThanOrEqual(3);
    }
    expect(SKULL_EYE_POINT.x).toBeCloseTo((SKULL_OPENINGS.orbitLeft[0] + SKULL_OPENINGS.orbitRight[0]) / 2, 12);
  });
  it('skullEyeLine is the height mesh-eyes.ts seats a head\'s eyes at', () => {
    for (const character of ['zombie', 'soldier', 'bride']) {
      const { head } = headOf(character);
      const seats = meshEyePlacements(meshBoneSource(head));
      expect(seats.length).toBe(2);
      // The seat's centre is at this height before its depth is searched for.
      expect(seats[0]!.center[1]).toBeCloseTo(skullEyeLine(head.bounds), 9);
    }
  });
});

describe.each(FLESH_FITS)('?skullfit=%s', fit => {
  const params = SKULL_FITS[fit];
  it.each(CHARACTERS)('%s: under the intact flesh by the margin, within the limits, nothing folded, every opening open', character => {
    const { body, head } = headOf(character);
    const skull = fitOf(character, fit), result = skull.fit!.result;
    expect(skull.fit!.name).toBe(fit);

    // THE MARGIN, against the whole body's flesh at rest (the field the game's wounds and shots read), at every
    // distinct place of the fitted skull.
    const seen = new Set<string>();
    let worst = -Infinity;
    for (const piece of skull.pieces) {
      const a = piece.positions;
      for (let i = 0; i < a.length; i += 3) {
        const key = `${a[i]},${a[i + 1]},${a[i + 2]}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const d = sdBody(head.toWorld([a[i]!, a[i + 1]!, a[i + 2]!]), body);
        if (d > worst) worst = d;
      }
    }
    // A micron of slack: the vertices are stored as float32.
    expect(worst, 'flesh over the worst vertex').toBeLessThanOrEqual(-params.margin + 1e-6);

    // THE LIMITS. No axis scale more than `limit` times another; the warp's passes sufficed (no shrink after them);
    // stage 2 did nothing where there is none.
    const s = result.affine.scale;
    expect(Math.max(...s) / Math.min(...s)).toBeLessThanOrEqual(params.limit + 1e-9);
    expect(result.shrunk).toBe(1);
    if (params.pull === 0) expect(result.passes).toHaveLength(0);
    else expect(result.passes.length).toBeLessThanOrEqual(12);
    // Held by the eyes: the point between the orbits is on the head's middle plane, and on its eye line.
    expect(SKULL_EYE_POINT.x * s[0] + result.affine.offset[0]).toBeCloseTo((head.bounds.min[0] + head.bounds.max[0]) / 2, 9);
    if (params.eyes) expect(SKULL_EYE_POINT.y * s[1] + result.affine.offset[1]).toBeCloseTo(skullEyeLine(head.bounds), 9);

    // NOTHING FOLDED. The warp's Jacobian keeps its sign and does not collapse at any vertex. Every triangle keeps
    // its facing and a fair part of its area, against the same triangle sized and placed only. And a corner normal
    // that stood with its triangle (within 45 degrees of its facing) is on its side still: the normals are carried
    // by the field's Jacobian at the vertex, the triangle by its three corners, and where the field bends hard over
    // one of this decimated asset's large triangles (edges to 24 mm) the two part by tens of degrees (84 at the
    // worst corner measured, on the soldier), never by a side. A sliver (under 1 mm high in the asset: 627 of its
    // 9947 triangles) has no facing worth the name, and is not judged.
    expect(result.warp.detMin).toBeGreaterThan(0.2);
    expect(result.warp.detMax).toBeLessThan(2);
    const sized = (a: ArrayLike<number>, i: number): Vec3 => [a[i * 3]! * s[0] + result.affine.offset[0], a[i * 3 + 1]! * s[1] + result.affine.offset[1], a[i * 3 + 2]! * s[2] + result.affine.offset[2]];
    const cross = (a: Vec3, b: Vec3, c: Vec3): Vec3 => {
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      return [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
    };
    const far = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    let judged = 0, slivers = 0, flipped = 0, thinnest = Infinity, turned = 0;
    skull.pieces.forEach((piece, k) => {
      const rawPos = source[k]!.geometry.getAttribute('position').array, rawNormal = source[k]!.geometry.getAttribute('normal').array;
      const pos = piece.positions, normal = piece.geometry.getAttribute('normal').array, index = piece.indices;
      const at = (i: number): Vec3 => [pos[i * 3]!, pos[i * 3 + 1]!, pos[i * 3 + 2]!];
      for (let t = 0; t < index.length; t += 3) {
        const [a, b, c] = [index[t]!, index[t + 1]!, index[t + 2]!];
        const pa = sized(rawPos, a), pb = sized(rawPos, b), pc = sized(rawPos, c);
        const before = cross(pa, pb, pc), after = cross(at(a), at(b), at(c));
        const areaBefore = Math.hypot(...before), areaAfter = Math.hypot(...after);
        const ra: Vec3 = [rawPos[a * 3]!, rawPos[a * 3 + 1]!, rawPos[a * 3 + 2]!], rb: Vec3 = [rawPos[b * 3]!, rawPos[b * 3 + 1]!, rawPos[b * 3 + 2]!], rc: Vec3 = [rawPos[c * 3]!, rawPos[c * 3 + 1]!, rawPos[c * 3 + 2]!];
        if (Math.hypot(...cross(ra, rb, rc)) < 0.001 * Math.max(far(ra, rb), far(rb, rc), far(rc, ra))) { slivers++; continue; }
        judged++;
        if (before[0] * after[0] + before[1] * after[1] + before[2] * after[2] <= 0) flipped++;
        thinnest = Math.min(thinnest, areaAfter / areaBefore);
        for (const v of [a, b, c]) {
          // The authored normal carried by the scale alone: n / s.
          const w: Vec3 = [rawNormal[v * 3]! / s[0], rawNormal[v * 3 + 1]! / s[1], rawNormal[v * 3 + 2]! / s[2]];
          const was = (w[0] * before[0] + w[1] * before[1] + w[2] * before[2]) / (areaBefore * Math.hypot(...w));
          const is = (normal[v * 3]! * after[0] + normal[v * 3 + 1]! * after[1] + normal[v * 3 + 2]! * after[2]) / areaAfter;
          if (was > 0.707 && is <= 0) turned++;
        }
      }
      for (let i = 0; i < normal.length; i += 3) expect(Math.hypot(normal[i]!, normal[i + 1]!, normal[i + 2]!)).toBeCloseTo(1, 4);
    });
    expect(slivers).toBe(627);
    expect(judged).toBe(9947 - 627);
    expect(flipped, 'triangles turned over').toBe(0);
    expect(thinnest, 'the most a triangle lost of its area').toBeGreaterThan(0.2);
    expect(turned, 'corner normals turned through their triangle').toBe(0);

    // THE OPENINGS STAY OPEN: the way from the front to the point inside each orbit and the nasal opening, carried
    // by the fit, meets no bone.
    const front = skull.fit!.max[2] + 0.05;
    for (const [name, p] of Object.entries(SKULL_OPENINGS)) {
      const carried = skullWarpAt(result.passes, [p[0] * s[0] + result.affine.offset[0], p[1] * s[1] + result.affine.offset[1], p[2] * s[2] + result.affine.offset[2]]);
      expect(openTo(skull.pieces, carried, front), name).toBe(true);
      expect(det3(skullWarpJacobian(result.passes, carried))).toBeGreaterThan(0.5);
    }
  });

  it.each(CHARACTERS)('%s: no seam opens, and one place stays one place', character => {
    const skull = fitOf(character, fit), result = skull.fit!.result, s = result.affine.scale;
    // Inside a plate (a UV split, a hard edge): vertices at one place of the asset are at one place of the fit, and
    // those that shared a normal share one still.
    skull.pieces.forEach((piece, k) => {
      const rawPos = source[k]!.geometry.getAttribute('position').array, rawNormal = source[k]!.geometry.getAttribute('normal').array;
      const normal = piece.geometry.getAttribute('normal').array, first = new Map<string, number>();
      for (let i = 0; i < rawPos.length / 3; i++) {
        const key = `${rawPos[i * 3]},${rawPos[i * 3 + 1]},${rawPos[i * 3 + 2]}`, j = first.get(key);
        if (j === undefined) { first.set(key, i); continue; }
        for (let c = 0; c < 3; c++) expect(piece.positions[i * 3 + c]).toBe(piece.positions[j * 3 + c]);
        if ([0, 1, 2].every(c => rawNormal[i * 3 + c] === rawNormal[j * 3 + c])) for (let c = 0; c < 3; c++) expect(normal[i * 3 + c]).toBe(normal[j * 3 + c]);
      }
    });
    // Between plates: the asset's plates meet at vertices up to half a millimetre apart (194 pairs; none coincide
    // exactly). The gap of each such pair, against the same gap sized and placed only.
    const cell = 0.0005, grid = new Map<string, { plate: number; i: number }[]>();
    source.forEach((p, plate) => {
      const a = p.geometry.getAttribute('position').array;
      for (let i = 0; i < a.length / 3; i++) {
        const key = `${Math.floor(a[i * 3]! / cell)},${Math.floor(a[i * 3 + 1]! / cell)},${Math.floor(a[i * 3 + 2]! / cell)}`;
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key)!.push({ plate, i });
      }
    });
    let pairs = 0, opened = 0;
    for (const [key, list] of grid) {
      const [x, y, z] = key.split(',').map(Number) as [number, number, number];
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) for (const b of grid.get(`${x + dx},${y + dy},${z + dz}`) ?? []) for (const a of list) {
        if (a.plate >= b.plate) continue;
        const pa = source[a.plate]!.geometry.getAttribute('position').array, pb = source[b.plate]!.geometry.getAttribute('position').array;
        const raw = [0, 1, 2].map(c => pa[a.i * 3 + c]! - pb[b.i * 3 + c]!);
        if (Math.hypot(...raw) >= cell) continue;
        pairs++;
        const before = Math.hypot(raw[0]! * s[0], raw[1]! * s[1], raw[2]! * s[2]);
        const fa = skull.pieces[a.plate]!.positions, fb = skull.pieces[b.plate]!.positions;
        opened = Math.max(opened, Math.hypot(...[0, 1, 2].map(c => fa[a.i * 3 + c]! - fb[b.i * 3 + c]!)) - before);
      }
    }
    expect(pairs).toBe(194);
    // A tenth of a millimetre at the very most: the field is smooth, and two places half a millimetre apart go
    // nearly the same way.
    expect(opened, 'the most a gap between two plates grew, metres').toBeLessThan(0.0001);
  });

  it.each(CHARACTERS)('%s: the plates, their boxes and pivots, the shot test and the whole skull come from the one fit', character => {
    const { head } = headOf(character);
    const kit = kitOf(fit), skull = kit.head(head)!, result = skull.fit!.result;
    expect(kit.head(head)).toBe(skull);
    expect(skull.mesh.key).toBe(`${head.revision}|${head.flesh!.revision}|${fit}:anatomical-skull-1`);
    expect(kit.size).toBe(1);
    const merged = skull.mesh.geometry.getAttribute('position').array, mergedNormal = skull.mesh.geometry.getAttribute('normal').array;
    const whole = new THREE.Box3();
    let offset = 0;
    skull.pieces.forEach((piece, k) => {
      const g = piece.geometry, pos = g.getAttribute('position').array;
      // The plate's vertices and normals are the fit's own arrays; the shot test reads the same vertices.
      expect(pos).toBe(result.positions[k]);
      expect(g.getAttribute('normal').array).toBe(result.normals[k]);
      expect(piece.positions).toBe(pos);
      expect(piece.indices).toBe(g.index!.array);
      expect(g.getAttribute('uv').array).toEqual(source[k]!.geometry.getAttribute('uv').array);
      expect(g.userData.anatomicalSkull).toBe(true);
      // Its box is its vertices' box, its pivot the box's middle, and its debris twin the plate about its pivot.
      const box = new THREE.Box3().setFromBufferAttribute(g.getAttribute('position') as THREE.BufferAttribute);
      expect(piece.min).toEqual(box.min.toArray());
      expect(piece.max).toEqual(box.max.toArray());
      expect(piece.pivot).toEqual(box.getCenter(new THREE.Vector3()).toArray());
      whole.union(box);
      const debris = piece.debrisGeometry.getAttribute('position').array;
      for (const i of [0, pos.length - 3]) for (let c = 0; c < 3; c++) expect(debris[i + c]).toBeCloseTo(pos[i + c]! - piece.pivot[c]!, 6);
      // The whole skull's one geometry is the plates' vertices, in order.
      for (let i = 0; i < pos.length; i += 997) { expect(merged[offset + i]).toBe(pos[i]); expect(mergedNormal[offset + i]).toBe(result.normals[k]![i]); }
      offset += pos.length;
    });
    expect(offset).toBe(merged.length);
    // The box the renderer bounds the whole skull's split by (mesh-renderer.ts drawBone) holds every plate.
    expect(skull.fit!.min).toEqual(whole.min.toArray());
    expect(skull.fit!.max).toEqual(whole.max.toArray());
    // A shot from in front of the forehead meets bone, where the fitted bone is: the first surface on the ray is
    // the fitted geometry's own (the same ray against the plates' geometries, read anew).
    const ray: Vec3 = [(skull.fit!.min[0] + skull.fit!.max[0]) / 2, skull.fit!.min[1] + (skull.fit!.max[1] - skull.fit!.min[1]) * 0.8, skull.fit!.max[2] + 0.03];
    const hit = skullRayCast(skull.pieces, intactSkull(14), ray, [0, 0, -1], 0.2);
    expect(hit).not.toBeNull();
    const anew = skullRayCast(surfacesOf(skull.pieces), intactSkull(14), ray, [0, 0, -1], 0.2)!;
    expect(hit!.plate).toBe(anew.plate);
    expect(hit!.distance).toBe(anew.distance);
    expect(skullRayHit(skull.pieces, intactSkull(14), ray, [0, 0, -1], 0.2)).toBe(hit!.plate);
    expect(hit!.distance).toBeGreaterThanOrEqual(0.03 - 1e-9);
    // Stage 2 moves the face's plates no further than the vault's (their budget is the smaller).
    expect(SKULL_FACE_PIECES.size).toBe(7);
  });
});

describe('a fitted skull in the renderer', () => {
  it('is larger than the bone envelope on the narrow-boned heads, which is why it brings its own box', () => {
    for (const character of ['cultist', 'female', 'schoolgirl', 'bonewalker']) {
      const { head } = headOf(character), skull = fitOf(character, 'snug');
      const span = (min: readonly number[], max: readonly number[]) => max[0]! - min[0]!;
      expect(span(skull.fit!.min, skull.fit!.max), character).toBeGreaterThan(span(head.bounds.min, head.bounds.max) * 1.3);
    }
  });
  it('draws, breaks and scatters as the envelope fit does: one draw whole, the struck plate gone, fourteen fragments', () => {
    const { head } = headOf('zombie');
    for (const fit of FLESH_FITS) {
      const cache = new SegmentMeshCache(undefined, undefined, kitOf(fit));
      const fragments: { name: string; pos: Vec3 }[] = [];
      const renderer = createSegmentMeshRenderer(cache, 0, undefined, (object, pos) => fragments.push({ name: object.name, pos }));
      const a = {}, b = {};
      renderer.update([[head], [head]], [a, b]);
      const bones = (owner: object) => renderer.drawn.filter(d => d.owner === owner && !d.eye);
      expect(bones(a)).toHaveLength(1);
      expect(bones(a)[0]!.geometry).toBe(cache.skullKit!.head(head)!.mesh.geometry);
      const skull = cache.skullKit!.head(head)!;
      // A slug at the forehead of the FITTED skull, from 3 cm in front of it.
      const at: Vec3 = [0, skull.fit!.min[1] + (skull.fit!.max[1] - skull.fit!.min[1]) * 0.8, skull.fit!.max[2] + 0.03];
      renderer.impact(a, [head], head.toWorld(at), [0, 0, -1], 'slug');
      expect(renderer.skullState(a).pieces).toEqual(['frontal']);
      expect(renderer.skullState(b).missing).toBe(0);
      // The fragment leaves from the fitted plate's pivot.
      expect(fragments).toHaveLength(1);
      const pivot = head.toWorld(skull.pieces[0]!.pivot);
      for (let c = 0; c < 3; c++) expect(fragments[0]!.pos[c]).toBeCloseTo(pivot[c]!, 6);
      renderer.update([[head], [head]], [a, b]);
      expect(bones(a)).toHaveLength(13);
      expect(renderer.explodeSkull(a, [head], [0, 1, 0])).toBe(13);
      expect(fragments).toHaveLength(14);
      renderer.dispose();
    }
  });
});
