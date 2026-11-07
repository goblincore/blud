// src/lab/sdf-zombie/corpse-contact.test.ts
//
// A CORPSE MEETS THE WORLD (corpse-contact.ts), pure: points kept out of the level's boxes (swept, so a fast point
// cannot tunnel a wall), out of standing bodies above their knees and out of other corpses' trunks, with no speed
// added and the speed into the contact dropped.
import { describe, expect, it } from 'vitest';
import { pushOutOfBodies, pushOutOfBoxes, type BodyObstacle, type ContactBox } from './corpse-contact';
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

  it('keeps a point out of another corpse\'s trunk sphere', () => {
    const trunk: BodyObstacle = { id: 3, kind: 'sphere', c: [0, 0.15, 0], r: 0.13 };
    const [p] = pushOutOfBodies([pt([0, 0.2, 0], [0, 0.3, 0])], [trunk], 1, R, 1);
    expect(p!.pos[1]).toBeCloseTo(0.15 + 0.19, 6);
    expect(vel(p!)[1]).toBeGreaterThanOrEqual(-1e-9);
  });
});
