// src/lab/sdf-zombie/corpse-contact.test.ts
//
// A CORPSE MEETS THE WORLD (corpse-contact.ts), pure: points kept out of the level's boxes (swept, so a fast point
// cannot tunnel a wall), out of standing bodies above their knees and out of other corpses' trunks, with no speed
// added and the speed into the contact dropped.
import { describe, expect, it } from 'vitest';
import { clearOfSegs, pushOutOfBodies, pushOutOfBoxes, pushOutOfSegs, type BodyObstacle, type ContactBox, type ContactSeg } from './corpse-contact';
import type { RigPoint } from './rig';
import type { Vec3 } from './types';

const pt = (pos: Vec3, prev: Vec3 = pos, pinned = false): RigPoint => ({ pos: [...pos] as Vec3, prev: [...prev] as Vec3, pinned });
/** A 30 cm wall across x = 1..1.3, 3 m tall. */
const WALL: ContactBox = { min: [1, 0, -5], max: [1.3, 3, 5] };
const R = () => 0.06;
const vel = (p: RigPoint) => [p.pos[0] - p.prev[0], p.pos[1] - p.prev[1], p.pos[2] - p.prev[2]];

describe('pushOutOfBoxes', () => {
  it('stops a point that tunnelled clean through a wall in one step at the face it hit', () => {
    const [p] = pushOutOfBoxes([pt([1.6, 1, 0], [0.8, 1, 0])], [WALL], R);
    expect(p!.pos[0]).toBeCloseTo(1 - 0.06, 6);
    expect(vel(p!)[0]).toBeLessThanOrEqual(1e-9);   // no speed on into the wall
  });

  it('pushes a point back out of the face it came in by, not the nearer far face', () => {
    // In from the left, ending nearer the right face.
    const [p] = pushOutOfBoxes([pt([1.25, 1, 0], [0.9, 1, 0])], [WALL], R);
    expect(p!.pos[0]).toBeCloseTo(0.94, 6);
  });

  it('keeps the slide along the wall and the fall, less friction', () => {
    const [p] = pushOutOfBoxes([pt([1.1, 1.0, 0.1], [0.9, 1.05, 0])], [WALL], R, 0.25);
    const v = vel(p!);
    expect(v[0]).toBeCloseTo(0, 9);
    expect(v[1]).toBeCloseTo(-0.05 * 0.75, 9);
    expect(v[2]).toBeCloseTo(0.1 * 0.75, 9);
  });

  it('lets a point that was already inside out by the shallowest face', () => {
    const [p] = pushOutOfBoxes([pt([1.28, 1, 0])], [WALL], R);
    expect(p!.pos[0]).toBeCloseTo(1.36, 6);
  });

  it('lands a point falling onto a crate on its top', () => {
    const crate: ContactBox = { min: [-0.5, 0, -0.5], max: [0.5, 0.8, 0.5] };
    const [p] = pushOutOfBoxes([pt([0, 0.78, 0], [0, 0.95, 0])], [crate], R);
    expect(p!.pos[1]).toBeCloseTo(0.86, 6);
  });

  it('leaves points clear of every box, and pinned points, alone (the same array)', () => {
    const pts = [pt([0.5, 1, 0], [0.4, 1, 0]), pt([1.1, 1, 0], [0.9, 1, 0], true)];
    expect(pushOutOfBoxes(pts, [WALL], R)).toBe(pts);
  });
});

describe('pushOutOfBodies', () => {
  const standing: BodyObstacle = { id: 7, kind: 'upright', x: 0, z: 0, r: 0.24, y0: 0.35, y1: 1.8 };

  it('pushes a flying point out of a standing body sideways, and stops it going in', () => {
    const [p] = pushOutOfBodies([pt([0.2, 1.2, 0], [0.4, 1.2, 0])], [standing], 1, R, 1);
    expect(p!.pos[0]).toBeCloseTo(0.3, 6);
    expect(p!.pos[1]).toBeCloseTo(1.2, 9);
    expect(vel(p!)[0]).toBeGreaterThanOrEqual(-1e-9);
  });

  it('leaves a corpse lying at a standing body\'s feet alone', () => {
    const pts = [pt([0.1, 0.12, 0])];
    expect(pushOutOfBodies(pts, [standing], 1, R)).toBe(pts);
  });

  it('never pushes a body out of itself', () => {
    const pts = [pt([0.1, 1.2, 0])];
    expect(pushOutOfBodies(pts, [standing], 7, R)).toBe(pts);
  });

  it('moves a resting point at most maxStep a call (uprightStep for a standing body)', () => {
    const [p] = pushOutOfBodies([pt([0.01, 1.2, 0])], [standing], 1, R, 0.03, 0.25, 0.08);
    expect(p!.pos[0]).toBeCloseTo(0.09, 6);
    const trunk: BodyObstacle = { id: 3, kind: 'sphere', c: [0, 0.15, 0], r: 0.13 };
    const [q] = pushOutOfBodies([pt([0, 0.16, 0])], [trunk], 1, R, 0.03);
    expect(q!.pos[1]).toBeCloseTo(0.19, 6);
  });

  // Owner playtest 2026-11-12: "clips through ... other bodies". Judged by where it ended, a fast point came out the
  // far side of a body or was never seen in it.
  it('stops a point that crossed a standing body in one step, or ended past its middle, where it came in', () => {
    const [through] = pushOutOfBodies([pt([-0.5, 1.2, 0], [0.5, 1.2, 0])], [standing], 1, R);
    expect(through!.pos[0]).toBeCloseTo(0.3, 6);
    const [past] = pushOutOfBodies([pt([-0.1, 1.2, 0], [0.35, 1.2, 0])], [standing], 1, R);
    expect(past!.pos[0]).toBeCloseTo(0.3, 6);
    expect(vel(past!)[0]).toBeGreaterThanOrEqual(-1e-9);
    // Off centre: it stops on the surface where its path met it, and keeps its slide round the body.
    const [off] = pushOutOfBodies([pt([-0.5, 1.2, 0.18], [0.5, 1.2, 0.18])], [standing], 1, R);
    expect(Math.hypot(off!.pos[0], off!.pos[2])).toBeCloseTo(0.3, 6);
    expect(off!.pos[0]).toBeGreaterThan(0);
    expect(off!.pos[2]).toBeCloseTo(0.18, 6);
  });

  it('lets a point fly over a standing body or past it', () => {
    const over = [pt([-0.5, 2.2, 0], [0.5, 2.2, 0])], beside = [pt([-0.5, 1.2, 0.4], [0.5, 1.2, 0.4])];
    expect(pushOutOfBodies(over, [standing], 1, R)).toBe(over);
    expect(pushOutOfBodies(beside, [standing], 1, R)).toBe(beside);
  });

  it('stops a point that crossed a corpse\'s trunk sphere in one step', () => {
    const trunk: BodyObstacle = { id: 3, kind: 'sphere', c: [0, 0.15, 0], r: 0.13 };
    const [p] = pushOutOfBodies([pt([0, -0.2, 0], [0, 0.6, 0])], [trunk], 1, R);
    expect(p!.pos[1]).toBeCloseTo(0.15 + 0.19, 6);
  });

  it('tells onHit whose body, the way out and how far the point was driving in', () => {
    const hits: [number, number, number][] = [];
    pushOutOfBodies([pt([0.2, 1.2, 0], [0.4, 1.2, 0])], [standing], 1, R, undefined, undefined, undefined,
      (o, n, into) => hits.push([o.id, n[0], into]));
    expect(hits).toHaveLength(1);
    expect(hits[0]![0]).toBe(7);
    expect(hits[0]![1]).toBeCloseTo(1, 6);
    expect(hits[0]![2]).toBeCloseTo(0.2, 6);
  });

  it('keeps a point out of another corpse\'s trunk sphere', () => {
    const trunk: BodyObstacle = { id: 3, kind: 'sphere', c: [0, 0.15, 0], r: 0.13 };
    const [p] = pushOutOfBodies([pt([0, 0.2, 0], [0, 0.3, 0])], [trunk], 1, R, 1);
    expect(p!.pos[1]).toBeCloseTo(0.15 + 0.19, 6);
    expect(vel(p!)[1]).toBeGreaterThanOrEqual(-1e-9);
  });
});

describe('pushOutOfBoxes keeps a point on the side it came from (owner playtest 2026-11-12)', () => {
  it('stops a point resting ON a face that moves in', () => {
    // Every contact leaves the point exactly on the grown face. The entry at t = 0 used to count as none: the point
    // sank a whole step into the wall, and came back (or went out the far side) the step after.
    const [p] = pushOutOfBoxes([pt([1.2, 1, 0], [0.94, 1, 0])], [WALL], R);
    expect(p!.pos[0]).toBeCloseTo(0.94, 6);
    expect(vel(p!)[0]).toBeLessThanOrEqual(1e-9);
  });

  it('leaves a point on a face that moves away or along it alone', () => {
    const away = [pt([0.8, 1, 0], [0.94, 1, 0])], along = [pt([0.94, 1, 0.3], [0.94, 1, 0])];
    expect(pushOutOfBoxes(away, [WALL], R)).toBe(away);
    expect(pushOutOfBoxes(along, [WALL], R)).toBe(along);
  });

  it('sends a point already past the middle of a wall back out where it was last clear, not out the far side', () => {
    const deep = [pt([1.3, 1, 0], [1.1, 1, 0])];
    expect(pushOutOfBoxes(deep, [WALL], R)[0]!.pos[0]).toBeCloseTo(1.36, 6);                       // no clear place known: the far face
    expect(pushOutOfBoxes(deep, [WALL], R, undefined, () => [0.5, 1, 0])[0]!.pos[0]).toBeCloseTo(0.94, 6);
  });

  it('fetches back a point a pass carried across a thin wall together with its prev', () => {
    const thin: ContactBox = { min: [1, 0, -5], max: [1.1, 3, 5] };
    const across = [pt([1.4, 1, 0], [1.38, 1, 0])];
    expect(pushOutOfBoxes(across, [thin], R)).toBe(across);                                         // prev -> pos never meets the wall
    expect(pushOutOfBoxes(across, [thin], R, undefined, () => [0.5, 1, 0])[0]!.pos[0]).toBeCloseTo(0.94, 6);
  });

  it('falls back to prev when the clear place handed in is itself inside the box', () => {
    const [p] = pushOutOfBoxes([pt([1.25, 1, 0], [0.9, 1, 0])], [WALL], R, undefined, () => [1.15, 1, 0]);
    expect(p!.pos[0]).toBeCloseTo(0.94, 6);
  });
});

// Owner playtest 2026-11-12: a sector level's walls are lines, and a corpse met none of them.
describe('pushOutOfSegs', () => {
  /** A wall line along z at x = 1, from z = -2 to 2. */
  const LINE: ContactSeg = { ax: 1, az: -2, bx: 1, bz: 2 };
  const segs = () => [LINE];

  it('puts a point that crossed a wall line back on the side it came from, its radius off the line', () => {
    const [p] = pushOutOfSegs([pt([1.4, 1, 0], [0.8, 1, 0])], segs, R);
    expect(p!.pos[0]).toBeCloseTo(0.94, 6);
    expect(p!.pos[1]).toBeCloseTo(1, 9);
    expect(vel(p!)[0]).toBeLessThanOrEqual(1e-9);
    // From the other side, the other way.
    expect(pushOutOfSegs([pt([0.7, 1, 0], [1.3, 1, 0])], segs, R)[0]!.pos[0]).toBeCloseTo(1.06, 6);
  });

  it('pushes a point within its radius of the line off it, and keeps its slide and its fall less friction', () => {
    const [p] = pushOutOfSegs([pt([0.97, 1.0, 0.1], [0.9, 1.05, 0])], segs, R, 0.25);
    expect(p!.pos[0]).toBeCloseTo(0.94, 6);
    const v = vel(p!);
    expect(v[0]).toBeCloseTo(0, 9);
    expect(v[1]).toBeCloseTo(-0.05 * 0.75, 9);
    expect(v[2]).toBeCloseTo(0.1 * 0.75, 9);
  });

  it('takes the side from `safe`, not from prev: a pass that carried a point across with its prev is fetched back', () => {
    const across = [pt([1.3, 1, 0], [1.28, 1, 0])];
    expect(pushOutOfSegs(across, segs, R)).toBe(across);
    expect(pushOutOfSegs(across, segs, R, undefined, () => [0.5, 1, 0])[0]!.pos[0]).toBeCloseTo(0.94, 6);
  });

  it('lets a point pass the end of a line, and rounds the end', () => {
    const past = [pt([1.4, 1, 2.5], [0.8, 1, 2.5])];
    expect(pushOutOfSegs(past, segs, R)).toBe(past);
    const [p] = pushOutOfSegs([pt([1, 1, 2.03], [1, 1, 2.2])], segs, R);
    expect(p!.pos[2]).toBeCloseTo(2.06, 6);
  });

  it('leaves a point resting its radius off the line, or moving away, alone; pinned points stay', () => {
    const resting = [pt([0.94, 1, 0])], away = [pt([0.7, 1, 0], [0.94, 1, 0])], pinned = [pt([1.4, 1, 0], [0.8, 1, 0], true)];
    expect(pushOutOfSegs(resting, segs, R)).toBe(resting);
    expect(pushOutOfSegs(away, segs, R)).toBe(away);
    expect(pushOutOfSegs(pinned, segs, R)).toBe(pinned);
    expect(clearOfSegs([0.94, 1, 0], 0.06, [LINE])).toBe(true);
    expect(clearOfSegs([0.97, 1, 0], 0.06, [LINE])).toBe(false);
  });

  it('holds a point in a corner of two lines', () => {
    const corner = [LINE, { ax: -2, az: 1, bx: 1, bz: 1 }];
    const [p] = pushOutOfSegs([pt([1.3, 1, 1.3], [0.5, 1, 0.5])], () => corner, R);
    expect(p!.pos[0]).toBeCloseTo(0.94, 6);
    expect(p!.pos[2]).toBeCloseTo(0.94, 6);
  });
});
