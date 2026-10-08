// src/lab/sdf-zombie/webgpu/skeleton-spike/anatomical-eyes.test.ts
//
// THE EYES OF AN ANATOMICAL SKULL FITTED TO THE FLESH SIT IN ITS OWN ORBITS (skull-orbits.ts) and are sized from
// them, measured here on the real asset: fitted to each of the eight ball-headed humanoids under its own fit
// (skull-cast.ts), and to all thirteen under the plain `snug` fit, with rays of this file's own (not the module's
// depth map): what shows of each eye past the bone is centred on the eye, the eye lies in a closed socket and inside
// the intact flesh. Then the renderer: the seated eyes, the ejected ones and a split head's copies all come from
// those seats; and a head on the envelope fit, a head the kit does not fit and a page with no kit keep the sculpted
// skull's sockets, as before.
// @ts-expect-error — node:fs is available in the Vitest runtime
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { AnatomicalSkullKit, HUMANOID_SKULLS, type FittedSkull, type SkullFitName, type SkullFitPlan } from './anatomical-skull';
import { anatomicalSkullSource } from './anatomical-skull.fixture';
import { parseBlob } from '../../blob-parse';
import { compileBlob } from '../../blob-compile';
import { buildBody, DEFAULT_BUILD_OPTS } from '../../build-body';
import { applyRig, bindRig, headQuatOf } from '../../rig-bind';
import { sdBody } from '../../validate';
import { createSkeletonSources, type BoneFieldSource } from './contract';
import { SegmentMeshCache } from './mesh';
import { createSegmentMeshRenderer } from './mesh-renderer';
import { meshEyePlacements, type MeshEyePlacement } from './mesh-eyes';
import { meshBoneSource } from './mesh-skull';
import { ORBIT_EYE_RECESS, ORBIT_EYE_SIZE, orbitEyeRadius } from './skull-orbits';
import { BALL_HEADS, ballHeadFit } from './skull-cast';
import { createBoneMeshCache } from './sculpt-cache';
import { forcedSplit, headFrameOf, skullSplitOf, splitWarpOf } from '../../head-split';
import { headShape } from '../flame-anchors';
import type { Vec3 } from '../../types';

const source = anatomicalSkullSource();
const newKit = (fit: SkullFitName | SkullFitPlan = 'snug') => new AnatomicalSkullKit(source, new THREE.Texture(), new THREE.Vector2(1, 1), fit);
const cast = (character: string) => {
  const body = buildBody(compileBlob(parseBlob(readFileSync(`src/lab/sdf-zombie/characters/${character}.blob`, 'utf8'))), DEFAULT_BUILD_OPTS);
  const bound = bindRig(body);
  return { body, bound, head: createSkeletonSources(body, bound, { character }).find(s => s.segment === 'head')! };
};

// ---------------------------------------------------------------------------
// The measurement: rays straight in from the front (head-local -z) at the fitted skull's real triangles.
// ---------------------------------------------------------------------------
const RAY_STEP = 0.0005;
/** The skull's triangles whose front view comes within `reach` of (x, y): nine floats each. */
function trianglesNear(skull: FittedSkull, x: number, y: number, reach: number): number[] {
  const out: number[] = [];
  for (const piece of skull.pieces) {
    const p = piece.positions, ix = piece.indices;
    for (let t = 0; t < ix.length; t += 3) {
      const a = ix[t]! * 3, b = ix[t + 1]! * 3, c = ix[t + 2]! * 3;
      if (Math.max(p[a]!, p[b]!, p[c]!) < x - reach || Math.min(p[a]!, p[b]!, p[c]!) > x + reach) continue;
      if (Math.max(p[a + 1]!, p[b + 1]!, p[c + 1]!) < y - reach || Math.min(p[a + 1]!, p[b + 1]!, p[c + 1]!) > y + reach) continue;
      out.push(p[a]!, p[a + 1]!, p[a + 2]!, p[b]!, p[b + 1]!, p[b + 2]!, p[c]!, p[c + 1]!, p[c + 2]!);
    }
  }
  return out;
}
/** The z at which the ray down -z through (x, y) first meets bone; -Infinity when it meets none. */
function frontRay(tris: readonly number[], x: number, y: number): number {
  let z = -Infinity;
  for (let t = 0; t < tris.length; t += 9) {
    const ax = tris[t]!, ay = tris[t + 1]!, bx = tris[t + 3]!, by = tris[t + 4]!, cx = tris[t + 6]!, cy = tris[t + 7]!;
    const det = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
    if (det === 0) continue;
    const u = ((x - ax) * (cy - ay) - (cx - ax) * (y - ay)) / det, v = ((bx - ax) * (y - ay) - (x - ax) * (by - ay)) / det;
    if (u < 0 || v < 0 || u + v > 1) continue;
    z = Math.max(z, tris[t + 2]! + u * (tris[t + 5]! - tris[t + 2]!) + v * (tris[t + 8]! - tris[t + 2]!));
  }
  return z;
}
/** The eye's disc as the rays see it: the share the bone covers, and where the centroid of the rest lies from the
 *  eye's centre (m). A ray sees the eye when it reaches the sphere before any bone. */
function eyeSeen(skull: FittedSkull, eye: MeshEyePlacement): { covered: number; offset: [number, number] } {
  const [cx, cy, cz] = eye.center, r = eye.radius, tris = trianglesNear(skull, cx, cy, r), n = Math.ceil(r / RAY_STEP);
  let all = 0, seen = 0, sx = 0, sy = 0;
  for (let j = -n; j <= n; j++) for (let i = -n; i <= n; i++) {
    const dx = i * RAY_STEP, dy = j * RAY_STEP, q = r * r - dx * dx - dy * dy;
    if (q < 0) continue;
    all++;
    if (frontRay(tris, cx + dx, cy + dy) > cz + Math.sqrt(q)) continue;
    seen++; sx += dx; sy += dy;
  }
  return { covered: 1 - seen / all, offset: seen ? [sx / seen, sy / seen] : [0, 0] };
}
/** The socket around the eye at the depth of its pole: the rays, spreading from the eye's centre, that pass deeper
 *  than the pole before meeting bone. `closed`: bone rings them in within three radii (an eye standing in front of
 *  its skull has no such ring). `offset`: the eye's centre from the middle of the socket, as a share of the socket's
 *  half-width and half-height (0 = the middle, 1 = its edge). */
function socketAtPole(skull: FittedSkull, eye: MeshEyePlacement): { closed: boolean; offset: [number, number] } {
  const [cx, cy, cz] = eye.center, reach = eye.radius * 3, tris = trianglesNear(skull, cx, cy, reach), n = Math.ceil(reach / RAY_STEP), w = 2 * n + 1;
  const open = (i: number, j: number) => frontRay(tris, cx + (i - n) * RAY_STEP, cy + (j - n) * RAY_STEP) < cz + eye.radius;
  if (!open(n, n)) return { closed: false, offset: [0, 0] };
  const seen = new Uint8Array(w * w), stack = [n * w + n];
  let closed = true, i0 = n, i1 = n, j0 = n, j1 = n;
  seen[n * w + n] = 1;
  while (stack.length) {
    const k = stack.pop()!, i = k % w, j = (k - i) / w;
    i0 = Math.min(i0, i); i1 = Math.max(i1, i); j0 = Math.min(j0, j); j1 = Math.max(j1, j);
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const a = i + di, b = j + dj;
      if (a < 0 || b < 0 || a >= w || b >= w) { closed = false; continue; }
      if (seen[b * w + a] || !open(a, b)) continue;
      seen[b * w + a] = 1; stack.push(b * w + a);
    }
  }
  return { closed, offset: [(n - (i0 + i1) / 2) / ((i1 - i0 + 1) / 2), (n - (j0 + j1) / 2) / ((j1 - j0 + 1) / 2)] };
}
/** The deepest the eye's front half lies in the intact flesh (m, negative = inside). */
function fleshOverEye(head: BoneFieldSource, body: ReturnType<typeof cast>['body'], eye: MeshEyePlacement): number {
  const flesh = { ...body, bonePrims: [] };
  let worst = -Infinity;
  for (const t of [0, 0.5, 0.9]) for (let a = 0; a < 8; a++) {
    const s = t * eye.radius, ang = a / 8 * Math.PI * 2;
    worst = Math.max(worst, sdBody(head.toWorld([eye.center[0] + Math.cos(ang) * s, eye.center[1] + Math.sin(ang) * s, eye.center[2] + Math.sqrt(eye.radius ** 2 - s * s)]), flesh));
  }
  return worst;
}

/** STATED TOLERANCE: the centroid of what shows of a seated eye lies within one ray (0.5 mm) of the eye's centre. */
const CENTRED = RAY_STEP;

describe('the anatomical skull\'s eye seats, on the real asset', () => {
  it('covers the thirteen humanoids', () => {
    expect([...HUMANOID_SKULLS]).toHaveLength(13);
  });

  /** The eyes of `skull` on `character`'s head: seated, sized, centred, socketed and covered. */
  function seated(character: string, skull: FittedSkull, head: BoneFieldSource, body: ReturnType<typeof cast>['body']): void {
    expect(skull.orbits).toHaveLength(2);
    expect(skull.eyes).toHaveLength(2);
    // The skull's own right orbit (-x) first: the order the sculpt's seats have.
    expect(skull.eyes![0]!.center[0]).toBeLessThan(skull.eyes![1]!.center[0]);
    for (const [i, eye] of skull.eyes!.entries()) {
      // Sized from the fitted orbits: one size for both, ORBIT_EYE_SIZE of their mean radius.
      expect(eye.radius).toBe(orbitEyeRadius(skull.orbits));
      expect(eye.radius).toBeCloseTo(ORBIT_EYE_SIZE * (skull.orbits[0]!.radius + skull.orbits[1]!.radius) / 2, 12);
      // In its own orbit, its pole the recess behind the lowest point of the rim.
      const orbit = skull.orbits[i]!;
      expect(Math.hypot(eye.center[0] - orbit.centre[0], eye.center[1] - orbit.centre[1])).toBeLessThan(orbit.radius * 0.25);
      expect(eye.center[2] + eye.radius).toBeCloseTo(orbit.centre[2] - ORBIT_EYE_RECESS * eye.radius, 9);
      const s = eyeSeen(skull, eye);
      expect(Math.hypot(...s.offset), `${character} seen part off centre by ${s.offset.map(v => (v * 1000).toFixed(2))} mm`).toBeLessThanOrEqual(CENTRED);
      // Some of the eye shows and the rim hides some: neither buried nor bare.
      expect(s.covered, `${character} covered`).toBeGreaterThan(0.05);
      expect(s.covered, `${character} covered`).toBeLessThan(0.65);
      // The eye is in a socket (bone rings its pole), in the middle fifth of it each way.
      const socket = socketAtPole(skull, eye);
      expect(socket.closed, `${character} socket closed`).toBe(true);
      expect(Math.max(...socket.offset.map(Math.abs)), `${character} eye off its socket's middle by ${socket.offset.map(v => v.toFixed(2))}`).toBeLessThan(0.2);
      // Behind intact flesh by the skull's own clearance (anatomical-skull.test.ts).
      expect(fleshOverEye(head, body, eye), `${character} flesh over the eye`).toBeLessThanOrEqual(-0.002);
    }
  }

  it.each(Object.keys(BALL_HEADS))('%s, under its own fit: each eye shows centred in its orbit, in a closed socket, inside the flesh', character => {
    const { body, head } = cast(character);
    const skull = newKit(ballHeadFit).head(head)!;
    expect(skull.fit!.name).toBe(BALL_HEADS[character]!.spec.fit);
    seated(character, skull, head, body);
  });

  it.each([...HUMANOID_SKULLS])('%s, under the plain snug fit: the same', character => {
    const { body, head } = cast(character);
    seated(character, newKit('snug').head(head)!, head, body);
  });

  it('the envelope fit has no seats of its own: its eyes stay in the sculpted skull\'s sockets', () => {
    for (const character of ['zombie', 'cultist', 'female']) {
      const skull = newKit('envelope').head(cast(character).head)!;
      expect(skull.fit).toBeNull();
      expect(skull.eyes).toBeNull();
      expect(skull.orbits).toEqual([]);
    }
  });

  it('the sculpt\'s seats are NOT in a fitted skull\'s orbits: the measure tells them apart', () => {
    const { head } = cast('cultist');
    const skull = newKit(ballHeadFit).head(head)!, sculpt = meshEyePlacements(meshBoneSource(head));
    // The cultist's sculpted seats are on his small bone ball: far from the fitted skull's orbits.
    const far = sculpt.map((s, i) => Math.hypot(s.center[0] - skull.eyes![i]!.center[0], s.center[1] - skull.eyes![i]!.center[1]));
    expect(Math.min(...far)).toBeGreaterThan(0.01);
    expect(sculpt[0]!.radius).toBeLessThan(skull.eyes![0]!.radius * 0.6);
  });

  it('a fitted head\'s orbits are measured once, with its plates', () => {
    const kit = newKit(), { head } = cast('zombie');
    expect(kit.head(head)!.eyes).toBe(kit.head(head)!.eyes);
  });
});

describe('the renderer seats, ejects and splits the eyes from the same seats', () => {
  const { body, bound, head } = cast('zombie');
  const eyesOf = (r: ReturnType<typeof createSegmentMeshRenderer>, owner: unknown) => r.drawn.filter(d => d.owner === owner && d.eye);
  const at = (m: THREE.Matrix4, p: Vec3) => new THREE.Vector3(...p).applyMatrix4(m);
  const make = (kit: AnatomicalSkullKit | null) => { const cache = new SegmentMeshCache(undefined, undefined, kit); return { cache, renderer: createSegmentMeshRenderer(cache) }; };

  it('with the kit: the drawn eyes are the skull\'s own seats', () => {
    const kit = newKit(), { renderer } = make(kit), owner = {};
    const seats = kit.head(head)!.eyes!;
    renderer.update([[head]], [owner]);
    const drawn = eyesOf(renderer, owner);
    expect(drawn).toHaveLength(2);
    drawn.forEach((d, i) => {
      expect(new THREE.Vector3().setFromMatrixPosition(d.matrix).distanceTo(new THREE.Vector3(...head.toWorld(seats[i]!.center)))).toBeLessThan(1e-9);
      expect(d.matrix.getMaxScaleOnAxis()).toBeCloseTo(seats[i]!.radius, 12);
    });
    renderer.dispose();
  });

  it('with the kit: a shot eye leaves from its seat, and that seat stays empty', () => {
    const kit = newKit(), { renderer } = make(kit), owner = {};
    const seats = kit.head(head)!.eyes!, shot = seats[1]!;
    renderer.update([[head]], [owner]);
    // A pellet at the +x eye, from the front: its reach takes that eye and not the far one.
    const lost = renderer.impact(owner, [head], head.toWorld([shot.center[0] + 0.14, shot.center[1], shot.center[2]]), [0, 0, -1], 'pellet');
    expect(lost).toBe(1);
    expect(renderer.eyeState(owner).missing).toEqual([1]);
    const flying = renderer.object.children.filter(c => c.name === 'skeleton-ejected-eye');
    expect(flying).toHaveLength(1);
    expect(flying[0]!.position.distanceTo(new THREE.Vector3(...head.toWorld(shot.center)))).toBeLessThan(1e-9);
    expect(flying[0]!.scale.x).toBeCloseTo(shot.radius, 12);
    renderer.update([[head]], [owner]);
    const left = eyesOf(renderer, owner);
    expect(left).toHaveLength(1);
    expect(new THREE.Vector3().setFromMatrixPosition(left[0]!.matrix).distanceTo(new THREE.Vector3(...head.toWorld(seats[0]!.center)))).toBeLessThan(1e-9);
    renderer.dispose();
  });

  it('with the kit: a split head\'s eye copies are those seats, each riding its piece of the skull', () => {
    const kit = newKit(), { renderer } = make(kit), owner = { id: 1 };
    const seats = kit.head(head)!.eyes!;
    const posed = applyRig(body, bound, 0);
    const warp = splitWarpOf(forcedSplit('middle', 0, 0, 0.8)!, headFrameOf(headShape(posed)!, headQuatOf(bound, 0) ?? [0, 0, 0, 1]))!;
    expect(skullSplitOf(warp)).not.toBeNull();
    renderer.update([[head]], [owner], undefined, undefined, undefined, { warp: (_o, segment) => (segment === 'head' ? warp : null) });
    const bone = renderer.drawn.filter(d => d.owner === owner && !d.eye), copies = eyesOf(renderer, owner);
    expect(copies.length).toBeGreaterThanOrEqual(2);
    for (const copy of copies) {
      expect(copy.piece).not.toBeNull();
      // The skull's copy for the same piece carries one of the seats to exactly where this eye is drawn.
      const skullCopy = bone.find(d => d.piece === copy.piece)!.matrix, here = new THREE.Vector3().setFromMatrixPosition(copy.matrix);
      expect(Math.min(...seats.map(s => at(skullCopy, s.center).distanceTo(here)))).toBeLessThan(1e-9);
    }
    // Both seats are drawn.
    for (const s of seats) expect(copies.some(c => at(bone.find(d => d.piece === c.piece)!.matrix, s.center).distanceTo(new THREE.Vector3().setFromMatrixPosition(c.matrix)) < 1e-9)).toBe(true);
    renderer.dispose();
  });

  it('without the kit (?skull=sculpt): the sculpt\'s sockets seat the eyes, as before', async () => {
    expect((await createBoneMeshCache('?skull=sculpt', () => {})).skullKit).toBeNull();
    const { cache, renderer } = make(null), owner = {};
    const sculpt = meshEyePlacements(meshBoneSource(head));
    // Pinned: the seats the sculpt path has always had.
    expect(sculpt.map(e => [...e.center, e.radius].map(v => +(v * 1000).toFixed(1)))).toEqual([[-36.3, 86.8, 47, 19.1], [36.3, 86.8, 47, 19.1]]);
    renderer.update([[head]], [owner]);
    const drawn = eyesOf(renderer, owner);
    expect(drawn).toHaveLength(2);
    drawn.forEach((d, i) => expect(new THREE.Vector3().setFromMatrixPosition(d.matrix).toArray()).toEqual(head.toWorld(sculpt[i]!.center)));
    expect(renderer.impact(owner, [head], head.toWorld([sculpt[1]!.center[0] + 0.14, sculpt[1]!.center[1], sculpt[1]!.center[2]]), [0, 0, -1], 'pellet')).toBe(1);
    expect(renderer.object.children.find(c => c.name === 'skeleton-ejected-eye')!.position.toArray()).toEqual(head.toWorld(sculpt[1]!.center));
    renderer.dispose(); cache.dispose();
  });

  it('on the envelope fit the drawn eyes are the sculpt\'s seats, as they were before any skull was fitted to the flesh', () => {
    const kit = newKit('envelope'), { renderer } = make(kit), owner = {};
    expect(kit.head(head)).not.toBeNull();
    const sculpt = meshEyePlacements(meshBoneSource(head));
    renderer.update([[head]], [owner]);
    const drawn = eyesOf(renderer, owner);
    expect(drawn).toHaveLength(2);
    drawn.forEach((d, i) => expect(new THREE.Vector3().setFromMatrixPosition(d.matrix).toArray()).toEqual(head.toWorld(sculpt[i]!.center)));
    renderer.dispose();
  });

  it('a head the kit does not fit keeps the sculpt\'s seats under the kit too', () => {
    const kit = newKit(), { renderer } = make(kit), owner = {};
    const other = { ...head, character: 'ogre', revision: `${head.revision}:ogre` };
    expect(kit.head(other)).toBeNull();
    const sculpt = meshEyePlacements(meshBoneSource(other));
    renderer.update([[other]], [owner]);
    eyesOf(renderer, owner).forEach((d, i) => expect(new THREE.Vector3().setFromMatrixPosition(d.matrix).toArray()).toEqual(other.toWorld(sculpt[i]!.center)));
    expect(eyesOf(renderer, owner)).toHaveLength(sculpt.length);
    renderer.dispose();
  });
});
