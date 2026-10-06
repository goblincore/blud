// src/lab/sdf-zombie/webgpu/skeleton-spike/skull-split-hit.test.ts
//
// A shot at a split skull meets the bone where it is drawn: the real anatomical skull fitted to the zombie's head,
// the head turned so nothing is axis-aligned, a `middle` split at the kill's opening.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { parseBlob } from '../../blob-parse';
import { compileBlob } from '../../blob-compile';
import { buildBody, DEFAULT_BUILD_OPTS } from '../../build-body';
import { applyRig, bindRig, headQuatOf } from '../../rig-bind';
import zombieSrc from '../../characters/zombie.blob?raw';
import {
  HEAD_SPLIT, forcedSplit, headFrameOf, rotAxis, skullSplitOf, skullWarpPoint, splitWarpOf, type SkullSplit,
} from '../../head-split';
import { intactSkull, skullRayCast, skullRayHit, type SkullDamage, type SkullPieceSurface } from '../../skull-fracture';
import type { Vec3 } from '../../types';
import { headShape } from '../flame-anchors';
import { AnatomicalSkullKit, SKULL_PIECES } from './anatomical-skull';
import { anatomicalSkullSource } from './anatomical-skull.fixture';
import { createSkeletonSources } from './contract';
import { meshSplitFracture, meshSplitJagMax, skullJagAt, type SplitJag } from './mesh-split';
import { skullOwnerAt, skullPieceAngle, skullSplitRayHit, type SkullHeadFrame, type SkullSplitHit } from './skull-split-hit';

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: Vec3): Vec3 => mul(a, 1 / (len(a) || 1));
const hash = (i: number, lane: number): number => { const x = Math.sin(i * 127.1 + lane * 311.7) * 43758.5453; return x - Math.floor(x); };

// The zombie, its body turned 0.7 rad, and the anatomical skull fitted to its head.
const YAW = 0.7;
const body = buildBody(compileBlob(parseBlob(zombieSrc)), DEFAULT_BUILD_OPTS);
const bound = bindRig(body);
const head = createSkeletonSources(body, bound, { character: 'zombie', bodyYaw: () => YAW }).find(s => s.segment === 'head')!;
const posed = applyRig(body, bound, YAW);
const skull = new AnatomicalSkullKit(anatomicalSkullSource(), new THREE.Texture(), new THREE.Vector2(1, 1)).head(head)!;
const pieces: readonly SkullPieceSurface[] = skull.pieces;
const plate = (id: (typeof SKULL_PIECES)[number]) => SKULL_PIECES.indexOf(id);
const origin0 = head.toLocal([0, 0, 0]);
const frame: SkullHeadFrame = {
  toLocal: p => head.toLocal(p) as Vec3, toWorld: p => head.toWorld(p) as Vec3,
  dirToLocal: v => sub(head.toLocal(v) as Vec3, origin0 as Vec3),
};
const dirToWorld = (v: Vec3): Vec3 => sub(frame.toWorld(v), frame.toWorld([0, 0, 0]));
const headFrame = headFrameOf(headShape(posed)!, headQuatOf(bound, YAW) ?? [0, 0, 0, 1]);
/** The skull's split for a forced flesh split, as the renderer makes it (seed 7: one head's own fracture). */
const splitOf = (sides: -1 | 0 | 1, offset: number, frac: number): SkullSplit =>
  skullSplitOf(splitWarpOf(forcedSplit('middle', sides, offset, frac)!, headFrame), null, 7)!;
// The kill: both halves, the flesh at its full angle, the bone at 0.85 of it.
const KILL = splitOf(0, 0, 1);
const JAG: SplitJag = HEAD_SPLIT.skull.jag;
const whole = intactSkull(pieces.length);

/** WHAT IS DRAWN, BUILT FORWARDS (the reference the ray test is held to): every triangle of every plate, once per
 *  piece that has a copy, turned to where that copy draws it. A ray meets a triangle there only where the piece owns
 *  the hit point's un-turned place. The nearest such hit, by brute force. */
type Copy = { piece: 0 | 1 | 2; angle: number; plates: { at: Float64Array; min: number[]; max: number[] }[] };
const copiesOf = new Map<SkullSplit, Copy[]>();
function drawnCopies(split: SkullSplit): Copy[] {
  let copies = copiesOf.get(split);
  if (copies) return copies;
  const { h, a } = split.frame.w;
  copies = [];
  for (const piece of [0, 1, 2] as const) {
    const angle = skullPieceAngle(split, piece);
    if (piece !== 0 && angle === 0) continue;
    copies.push({ piece, angle, plates: pieces.map(p => {
      const at = new Float64Array(p.positions.length), min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < p.positions.length; i += 3) {
        const q = frame.toWorld([p.positions[i]!, p.positions[i + 1]!, p.positions[i + 2]!]);
        const x = angle === 0 ? q : add(h, rotAxis(sub(q, h), a, angle));
        for (let k = 0; k < 3; k++) { at[i + k] = x[k]!; min[k] = Math.min(min[k]!, x[k]!); max[k] = Math.max(max[k]!, x[k]!); }
      }
      return { at, min, max };
    }) });
  }
  copiesOf.set(split, copies);
  return copies;
}
function drawnHit(split: SkullSplit, state: SkullDamage, point: Vec3, direction: Vec3, reach: number, jag: SplitJag = JAG): SkullSplitHit | null {
  const { h, a } = split.frame.w, [rx, ry, rz] = unit(direction), [ox, oy, oz] = point;
  let best: SkullSplitHit | null = null;
  for (const copy of drawnCopies(split)) {
    copy.plates.forEach((turned, index) => {
      if (state.missing & (1 << index)) return;
      // The ray against the copy's box first.
      let enter = 0, leave = best ? best.distance : reach;
      for (let k = 0; k < 3; k++) {
        const o = point[k]!, r = [rx, ry, rz][k]!;
        if (Math.abs(r) < 1e-12) { if (o < turned.min[k]! || o > turned.max[k]!) return; continue; }
        const t0 = (turned.min[k]! - o) / r, t1 = (turned.max[k]! - o) / r;
        enter = Math.max(enter, Math.min(t0, t1)); leave = Math.min(leave, Math.max(t0, t1));
      }
      if (enter > leave) return;
      const at = turned.at, ix = pieces[index]!.indices;
      for (let i = 0; i < ix.length; i += 3) {
        const A = ix[i]! * 3, B = ix[i + 1]! * 3, C = ix[i + 2]! * 3;
        const ax = at[A]!, ay = at[A + 1]!, az = at[A + 2]!;
        const e1x = at[B]! - ax, e1y = at[B + 1]! - ay, e1z = at[B + 2]! - az, e2x = at[C]! - ax, e2y = at[C + 1]! - ay, e2z = at[C + 2]! - az;
        const px = ry * e2z - rz * e2y, py = rz * e2x - rx * e2z, pz = rx * e2y - ry * e2x, det = e1x * px + e1y * py + e1z * pz;
        if (Math.abs(det) < 1e-14) continue;
        const tx = ox - ax, ty = oy - ay, tz = oz - az, bu = (tx * px + ty * py + tz * pz) / det;
        if (bu < 0 || bu > 1) continue;
        const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x, bv = (rx * qx + ry * qy + rz * qz) / det;
        if (bv < 0 || bu + bv > 1) continue;
        const d = (e2x * qx + e2y * qy + e2z * qz) / det;
        if (d < 0 || d >= (best ? best.distance : reach)) continue;
        const x: Vec3 = [ox + rx * d, oy + ry * d, oz + rz * d];
        if (skullOwnerAt(split, copy.angle === 0 ? x : add(h, rotAxis(sub(x, h), a, -copy.angle)), jag) === copy.piece) best = { plate: index, piece: copy.piece, distance: d };
      }
    });
  }
  return best;
}
/** Two answers agree: the same bone on the same piece, the distance to a nanometre. */
const agree = (got: SkullSplitHit | null, want: SkullSplitHit | null, what = '') => {
  expect(got === null, what).toBe(want === null);
  if (!got || !want) return;
  expect([got.plate, got.piece], what).toEqual([want.plate, want.piece]);
  expect(got.distance, what).toBeCloseTo(want.distance, 9);
};

/** The outward-facing triangles of plate `index` on the CLOSED skull, as (centroid, outward unit normal), head frame:
 *  a ray from 3 cm outside straight in meets the plate there first. `where` picks among the centroids; `facing` is
 *  how squarely a face must look away from the skull's middle. */
function outerFaces(index: number, where: (c: Vec3) => boolean, facing = 0.8): { c: Vec3; n: Vec3 }[] {
  const p = pieces[index]!, centre = skull.mesh.geometry.boundingSphere!.center.toArray() as Vec3, out: { c: Vec3; n: Vec3 }[] = [];
  const vertex = (i: number): Vec3 => [p.positions[i * 3]!, p.positions[i * 3 + 1]!, p.positions[i * 3 + 2]!];
  for (let i = 0; i < p.indices.length; i += 3) {
    const A = vertex(p.indices[i]!), B = vertex(p.indices[i + 1]!), C = vertex(p.indices[i + 2]!);
    const c = mul(add(add(A, B), C), 1 / 3);
    let n = unit(cross(sub(B, A), sub(C, A)));
    if (dot(n, sub(c, centre)) < 0) n = mul(n, -1);
    if (!where(c) || dot(n, unit(sub(c, centre))) < facing) continue;
    const hit = skullRayCast(pieces, whole, add(c, mul(n, 0.03)), mul(n, -1));
    if (hit && hit.plate === index && Math.abs(hit.distance - 0.03) < 1e-6) out.push({ c, n });
  }
  return out;
}

describe('skullSplitRayHit: a closed head is the closed test', () => {
  it('a null split answers skullRayCast in the head\'s frame, ray for ray, whole and with plates missing', () => {
    const centre = frame.toWorld(skull.mesh.geometry.boundingSphere!.center.toArray() as Vec3);
    let hits = 0, misses = 0;
    for (const state of [whole, { missing: (1 << plate('frontal')) | (1 << plate('parietal-left')), hits: whole.hits }]) {
      for (let i = 0; i < 400; i++) {
        const from = add(centre, mul(unit([hash(i, 1) - 0.5, hash(i, 2) - 0.5, hash(i, 3) - 0.5]), 0.1 + 0.08 * hash(i, 4)));
        const at = add(centre, [(hash(i, 5) - 0.5) * 0.12, (hash(i, 6) - 0.5) * 0.16, (hash(i, 7) - 0.5) * 0.12]);
        const dir = sub(at, from);
        const closed = skullRayCast(pieces, state, frame.toLocal(from), frame.dirToLocal(dir));
        const got = skullSplitRayHit(pieces, state, null, frame, from, dir);
        expect(got).toEqual(closed ? { plate: closed.plate, piece: 0, distance: closed.distance } : null);
        expect(got?.plate ?? null).toBe(skullRayHit(pieces, state, frame.toLocal(from), frame.dirToLocal(dir)));
        if (got) hits++; else misses++;
      }
    }
    expect(hits).toBeGreaterThan(300);
    expect(misses).toBeGreaterThan(50);
  });
});

describe('skullSplitRayHit: the kill\'s split, both halves turned by the bone angle', () => {
  const s = KILL, { w, u } = s.frame;
  it('the split is the kill\'s: the bone 0.85 of the flesh\'s 0.55 rad, each way', () => {
    expect(s.angleP).toBeCloseTo(0.55 * 0.85, 12);
    expect(s.angleM).toBeCloseTo(-0.55 * 0.85, 12);
  });

  for (const [name, id, piece] of [['+', 'parietal-left', 1], ['-', 'parietal-right', 2]] as const) {
    it(`a ray at a point of the ${name} half where it is DRAWN breaks the plate drawn there, on piece ${piece}; the closed test at that ray does not`, () => {
      const index = plate(id);
      // Outer faces of the plate that this half owns, clear of the fracture.
      const faces = outerFaces(index, c => { const q = frame.toWorld(c); return skullOwnerAt(s, q) === piece && meshSplitFracture(q, s) > 0.015; });
      expect(faces.length).toBeGreaterThan(80);
      let closedSame = 0;
      for (const f of faces) {
        const q = frame.toWorld(f.c), moved = skullWarpPoint(s, q, skullJagAt(s, q));
        expect(moved.piece).toBe(piece);
        // The bone has moved: 27 degrees about the hinge, centimetres at the crown.
        expect(len(sub(moved.p, q))).toBeGreaterThan(0.02);
        const n = rotAxis(dirToWorld(f.n), w.a, skullPieceAngle(s, piece));
        const from = add(moved.p, mul(n, 0.03)), dir = mul(n, -1);
        const hit = skullSplitRayHit(pieces, whole, s, frame, from, dir)!;
        expect(hit, `${id} face at ${f.c}`).not.toBeNull();
        expect([hit.plate, hit.piece]).toEqual([index, piece]);
        expect(hit.distance).toBeCloseTo(0.03, 6);
        // The closed head's test of the same ray: the bone it would break is not drawn there.
        const closed = skullRayCast(pieces, whole, frame.toLocal(from), frame.dirToLocal(dir));
        if (closed && closed.plate === index && Math.abs(closed.distance - 0.03) < 1e-3) closedSame++;
      }
      expect(closedSame).toBe(0);
    });
  }

  it('a ray down the open gap: the closed skull\'s crown is not there, and nothing is until the hinge', () => {
    // Straight down the old plane. `al` is along the hinge axis from the hinge point, 3 cm above the crown.
    const crown = Math.max(...pieces.flatMap(p => [p.min, p.max]).map(c => dot(u, sub(frame.toWorld(c), w.h))));
    const down = mul(u, -1);
    const over = (al: number): Vec3 => add(add(w.h, mul(w.a, al)), mul(u, crown + 0.03));
    const alOf = (local: Vec3) => dot(w.a, sub(frame.toWorld(local), w.h));
    // Over the middle of the crown. Closed: the crown, 3 cm down.
    const mid = over(alOf(skull.mesh.geometry.boundingSphere!.center.toArray() as Vec3));
    const closed = skullRayCast(pieces, whole, frame.toLocal(mid), frame.dirToLocal(down))!;
    expect(closed.distance).toBeGreaterThan(0.025);
    expect(closed.distance).toBeLessThan(0.045);
    expect([plate('parietal-left'), plate('parietal-right')]).toContain(closed.plate);
    // Split: nothing within the bullet's reach, and nothing at all below: the halves have swung clear of the plane
    // with the cranial base, and the jaw the hinge holds is an arch, open in the middle.
    expect(skullSplitRayHit(pieces, whole, s, frame, mid, down)).toBeNull();
    expect(skullSplitRayHit(pieces, whole, s, frame, mid, down, JAG, 0.5)).toBeNull();
    expect(drawnHit(s, whole, mid, down, 0.5)).toBeNull();
    // Over the chin the closed ray meets the brow. Split, it runs down the gap to where the halves meet: the first
    // bone is within the fracture's reach of the hinge plane, or under it on the jaw.
    const jaw = pieces[plate('mandible')]!;
    const front = over(alOf([0, jaw.min[1], jaw.max[2] - 0.012]));
    const brow = skullRayCast(pieces, whole, frame.toLocal(front), frame.dirToLocal(down), 0.5)!;
    expect(brow.plate).toBe(plate('frontal'));
    expect(crown + 0.03 - brow.distance).toBeGreaterThan(0.1);
    const deep = skullSplitRayHit(pieces, whole, s, frame, front, down, JAG, 0.5)!;
    agree(deep, drawnHit(s, whole, front, down, 0.5));
    expect([deep.plate, deep.piece]).toEqual([plate('mandible'), 0]);
    // A half's ragged edge reaches the plane only this close to the hinge: its swing has cleared the fracture above.
    expect(crown + 0.03 - deep.distance).toBeLessThan(meshSplitJagMax() / Math.sin(s.angleP) + 1e-3);
  });

  it('a ray at bone the rest owns is the closed test\'s where no half has swung over it (the front of the chin)', () => {
    const index = plate('mandible');
    const side = (q: Vec3) => dot(w.n, q) - w.d0;
    // The jaw under the hinge plane is the rest's. Its outer faces, all round the arch.
    const faces = outerFaces(index, c => { const q = frame.toWorld(c); return skullOwnerAt(s, q) === 0 && dot(u, sub(q, w.h)) < -0.008; }, 0.2);
    expect(faces.length).toBeGreaterThan(50);
    let chin = 0, shadowed = 0;
    for (const f of faces) {
      const from = frame.toWorld(add(f.c, mul(f.n, 0.03))), dir = dirToWorld(mul(f.n, -1));
      const closed = skullRayCast(pieces, whole, frame.toLocal(from), frame.dirToLocal(dir))!;
      const got = skullSplitRayHit(pieces, whole, s, frame, from, dir);
      agree(got, drawnHit(s, whole, from, dir, 0.14), `jaw face at ${f.c}`);
      // Within 12 mm of the plane a half's copy cannot dip under the hinge plane into the ray.
      if (Math.abs(side(frame.toWorld(f.c))) < 0.012) { expect(got).toEqual({ plate: index, piece: 0, distance: closed.distance }); chin++; }
      // Out along the arch a half's own copy of the jaw (its ramus, above the hinge plane) has swung down in front.
      else if (got!.piece !== 0) { expect(got!.distance).toBeLessThan(closed.distance); shadowed++; }
    }
    expect(chin).toBeGreaterThan(8);
    expect(shadowed).toBeGreaterThan(0);
  });

  it('whatever the ray, it meets what is drawn: the forward build of the three copies agrees, plate, piece and distance', () => {
    const centre = frame.toWorld(skull.mesh.geometry.boundingSphere!.center.toArray() as Vec3);
    const seen = [0, 0, 0];
    let none = 0, moved = 0;
    for (const [split, state, n] of [
      [s, whole, 260], [s, { missing: (1 << plate('parietal-left')) | (1 << plate('temporal-right')), hits: whole.hits }, 80],
      [splitOf(1, 0.03, 1), whole, 80], [splitOf(0, 0, 0.8), whole, 80],
    ] as const) {
      for (let i = 0; i < n; i++) {
        const from = add(centre, mul(unit([hash(i, 11) - 0.5, hash(i, 12) - 0.3, hash(i, 13) - 0.5]), 0.14 + 0.1 * hash(i, 14)));
        const at = add(centre, [(hash(i, 15) - 0.5) * 0.2, (hash(i, 16) - 0.5) * 0.2, (hash(i, 17) - 0.5) * 0.16]);
        const dir = sub(at, from), reach = i % 2 ? 0.14 : 0.4;
        const want = drawnHit(split, state, from, dir, reach), got = skullSplitRayHit(pieces, state, split, frame, from, dir, JAG, reach);
        agree(got, want, `ray ${i}`);
        if (!want) { none++; continue; }
        seen[got!.piece]!++;
        const closed = skullRayCast(pieces, state, frame.toLocal(from), frame.dirToLocal(dir), reach);
        if (!closed || closed.plate !== got!.plate || Math.abs(closed.distance - got!.distance) > 1e-3) moved++;
      }
    }
    for (const k of [0, 1, 2]) expect(seen[k]!, `piece ${k}`).toBeGreaterThan(10);
    expect(none).toBeGreaterThan(20);
    // Most of what a ray meets on the open skull is not what the closed test would have answered.
    expect(moved).toBeGreaterThan((seen[0]! + seen[1]! + seen[2]!) / 2);
  });

  it('the fracture is the one handed in: with another fracture a ray at the edge meets the other half\'s bone, or none', () => {
    // A clean plane against the default fracture, on rays into the band the fracture wanders over.
    const clean: SplitJag = { ...JAG, zigAmp: 0, chipAmp: 0 }, band = meshSplitJagMax();
    const centre = frame.toWorld(skull.mesh.geometry.boundingSphere!.center.toArray() as Vec3);
    let differ = 0, same = 0;
    for (let i = 0; i < 300; i++) {
      // A point of the crown's band, then where the + half's copy draws it; shot from above.
      const q = add(add(sub(centre, mul(w.n, dot(w.n, centre) - w.d0)), mul(w.n, (hash(i, 21) - 0.5) * 2 * band)), add(mul(w.a, (hash(i, 22) - 0.5) * 0.1), mul(u, 0.02)));
      const p = add(w.h, rotAxis(sub(q, w.h), w.a, s.angleP));
      const from = add(p, mul(rotAxis(u, w.a, s.angleP), 0.12)), dir = mul(rotAxis(u, w.a, s.angleP), -1);
      const a = skullSplitRayHit(pieces, whole, s, frame, from, dir, JAG, 0.2), b = skullSplitRayHit(pieces, whole, s, frame, from, dir, clean, 0.2);
      agree(a, drawnHit(s, whole, from, dir, 0.2, JAG), `ray ${i}`);
      agree(b, drawnHit(s, whole, from, dir, 0.2, clean), `ray ${i}, clean`);
      if (a?.plate === b?.plate && a?.piece === b?.piece && Math.abs((a?.distance ?? 0) - (b?.distance ?? 0)) < 1e-9) same++; else differ++;
    }
    expect(differ).toBeGreaterThan(30);
    expect(same).toBeGreaterThan(30);
  });
});
