import { describe, it, expect } from 'vitest';
import {
  makeChunk, stepChunk, chunkPoint, squashFactors, chunkSettled, toppleAngleToFlat,
  chunkSupportOffset,
  type Chunk, type ChunkBox,
} from './gib-chunks';
import { qRotate, qFromAxisAngle, qIdentity } from './vec';
import type { Vec3 } from './types';

const rng = () => 0.5; // deterministic spawn

function settle(c: Chunk, seconds: number): Chunk {
  const dt = 1 / 60;
  for (let t = 0; t < seconds; t += dt) c = stepChunk(c, dt);
  return c;
}

describe('makeChunk', () => {
  it('spawns with a unit quaternion and bounded tumble', () => {
    const c = makeChunk('armL', [0, 1, 0], [2, 3, 1], 0.2, [0, 1, 0], rng);
    expect(Math.hypot(...c.quat)).toBeCloseTo(1, 6);
    for (const w of c.angVel) expect(Math.abs(w)).toBeLessThanOrEqual(9);
  });

  it('takes a pre-release orientation/angular velocity over the random tumble', () => {
    const quat: [number, number, number, number] = [0, Math.SQRT1_2, 0, Math.SQRT1_2];
    const angVel: Vec3 = [0, 2.4, 0];
    const c = makeChunk('torso', [1, 2, 3], [0, 0, 0], 0.2, [0, 1, 0], rng, 'limb', { quat, angVel });
    for (let k = 0; k < 4; k++) expect(c.quat[k]).toBeCloseTo(quat[k]!, 12);
    expect(c.angVel).toEqual(angVel);
    // The random draws are still consumed (the shared stream is unchanged), so
    // a chunk with no pre-release state keeps the old spawn behaviour.
    const random = makeChunk('torso', [1, 2, 3], [0, 0, 0], 0.2, [0, 1, 0], rng);
    expect(random.quat).toEqual([0, 0, 0, 1]);
    expect(random.angVel).not.toEqual(angVel);
  });
});

describe('stepChunk', () => {
  it('integrates orientation from angular velocity', () => {
    const c = makeChunk('armL', [0, 5, 0], [0, 0, 0], 0.2, [0, 1, 0], rng);
    const c2 = { ...c, angVel: [0, Math.PI, 0] as Vec3 };
    const after = stepChunk(c2, 0.5); // half a half-turn about y
    const v = qRotate(after.quat, [1, 0, 0]);
    // Rotated ~90deg from where quat started; just assert it moved substantially.
    const before = qRotate(c2.quat, [1, 0, 0]);
    expect(Math.abs(v[0] - before[0]) + Math.abs(v[2] - before[2])).toBeGreaterThan(0.5);
  });

  it('bounces with the game restitution', () => {
    let c = makeChunk('armL', [0, 0.5, 0], [0, -4, 0], 0.2, [0, 1, 0], rng);
    // Drop until first bounce.
    let bounced: Chunk | null = null;
    for (let i = 0; i < 300; i++) {
      const next = stepChunk(c, 1 / 60);
      if (next.vel[1] > 0 && c.vel[1] < 0) { bounced = next; break; }
      c = next;
    }
    expect(bounced).not.toBeNull();
    // restitution 0.55 of impact speed, within integration slop
    expect(bounced!.vel[1]).toBeGreaterThan(0.3);
  });

  it('topples: a vertical limb ends lying flat', () => {
    // Long axis local y, spawned upright, at rest on the floor.
    let c = makeChunk('legL', [0, 0.2, 0], [0, 0, 0], 0.2, [0, 1, 0], rng);
    c = { ...c, angVel: [0, 0, 0] as Vec3 };
    c = settle(c, 3);
    const worldLong = qRotate(c.quat, c.longAxis);
    // Lying flat = long axis within ~15deg of horizontal.
    expect(Math.abs(worldLong[1])).toBeLessThan(0.26);
  });

  it('does not topple while still flying', () => {
    let c = makeChunk('legL', [0, 8, 0], [0, 4, 0], 0.2, [0, 1, 0], rng);
    c = { ...c, angVel: [0, 0, 0] as Vec3 };
    const after = stepChunk(c, 1 / 60);
    const before = qRotate(c.quat, c.longAxis);
    const now = qRotate(after.quat, c.longAxis);
    expect(now[1]).toBeCloseTo(before[1], 5);
  });

  it('recovers from non-finite state', () => {
    const c = makeChunk('armL', [0, 1, 0], [NaN, 0, 0], 0.2, [0, 1, 0], rng);
    const after = stepChunk(c, 1 / 60);
    expect(after.vel.every(Number.isFinite)).toBe(true);
  });
});

describe('chunkPoint / squashFactors', () => {
  it('rotates locals by the chunk quat then squashes in world axes', () => {
    const base = makeChunk('armL', [1, 2, 3], [0, 0, 0], 0.2, [0, 1, 0], rng);
    const c: Chunk = { ...base, quat: qFromAxisAngle([0, 1, 0], Math.PI / 2), squash: 0 };
    const { sx, sy, sz } = squashFactors(c);
    expect([sx, sy, sz]).toEqual([1, 1, 1]);
    const p = chunkPoint(c, [1, 0, 0], sx, sy, sz);
    expect(p[0]).toBeCloseTo(1, 5);
    expect(p[1]).toBeCloseTo(2, 5);
    expect(p[2]).toBeCloseTo(3 - 1, 5);
  });

  it('squash flattens y and bulges xz', () => {
    const base = makeChunk('armL', [0, 0, 0], [0, 0, 0], 0.2, [0, 1, 0], rng);
    const c: Chunk = { ...base, squash: 1 };
    const { sx, sy, sz } = squashFactors(c);
    expect(sx).toBeCloseTo(1.35, 5);
    expect(sy).toBeCloseTo(0.5, 5);
    expect(sz).toBeCloseTo(1.35, 5);
  });
});

describe('chunkSettled (close-up task 5 bake predicate)', () => {
  it('a chunk stepped to rest becomes settled and STAYS settled', () => {
    let c = makeChunk('armL', [0.3, 1.5, -0.2], [1.4, 0.5, 0.9], 0.09, [0.3, 1, 0.1], rng);
    for (let i = 0; i < 60 * 6; i++) c = stepChunk(c, 1 / 60);
    expect(chunkSettled(c)).toBe(true);
    // Idempotent: a settled chunk re-judged is still settled (nothing steps it).
    expect(chunkSettled(c)).toBe(true);
  });

  it('is never settled while airborne', () => {
    const c = makeChunk('armL', [0, 3, 0], [0, 0, 0], 0.2, [0, 1, 0], rng);
    const still = { ...c, vel: [0, 0, 0] as Vec3, angVel: [0, 0, 0] as Vec3 };
    expect(chunkSettled(still)).toBe(false); // y = 3 >> radius: in the air
  });

  it('is never settled while sliding fast on the floor', () => {
    // Grounded (y == radius) but moving at 3 m/s: a slide, not a rest.
    const c = makeChunk('armL', [0, 0.15, 0], [3, 0, 0], 0.15, [1, 0, 0], rng, 'gob');
    const sliding: Chunk = { ...c, pos: [0, c.radius, 0], angVel: [0, 0, 0] as Vec3 };
    expect(chunkSettled(sliding)).toBe(false);
  });

  it('is never settled mid-topple even when slow and grounded', () => {
    // Slow, grounded, angVel zeroed, squash done — but the long axis still
    // pointing straight UP, 90deg from flat. The topple has not finished.
    const c = makeChunk('legL', [0, 0.2, 0], [0.01, 0, 0], 0.2, [0, 1, 0], rng);
    const poised: Chunk = { ...c, angVel: [0, 0, 0] as Vec3, squash: 0 };
    expect(toppleAngleToFlat(poised)).toBeGreaterThan(0.011);
    expect(chunkSettled(poised)).toBe(false);
  });

  it('is never settled while the squash is still relaxing', () => {
    const c = makeChunk('armL', [0, 0.2, 0], [0, 0, 0], 0.2, [1, 0, 0], rng);
    const wet: Chunk = { ...c, angVel: [0, 0, 0] as Vec3, squash: 0.4 };
    expect(chunkSettled(wet)).toBe(false);
  });

  it('settle time from a hot spawn is bounded (~2s) — the bake must not wait forever', () => {
    let c = makeChunk('armL', [0.3, 1.5, -0.2], [2.5, 3.5, 1.9], 0.09, [0.3, 1, 0.1], rng);
    let settledAt = -1;
    for (let i = 0; i < 60 * 10 && settledAt < 0; i++) {
      c = stepChunk(c, 1 / 60);
      if (chunkSettled(c)) settledAt = i;
    }
    expect(settledAt).toBeGreaterThan(0);
    expect(settledAt).toBeLessThan(60 * 4);
  });
});

// ---------------------------------------------------------------------------
// WALLS. The owner, playing: "it seems the gibs dont bounce off the walls/have
// collission" — and they did not. `stepChunk` had a floor plane at y = radius and
// NOTHING else, so a piece thrown at a wall flew straight through it and out of
// the room. The boxes are the level's own colliders (`levelColliders()`), which
// are the walls SPLIT AROUND THE DOORWAYS — so the doorway case below is the one
// that says the model is right rather than a box drawn around the room.
// ---------------------------------------------------------------------------
describe('chunk walls', () => {
  /** The arena's east wall: a slab in x, spanning z and y. */
  const WALL = { min: [-0.2, 0, -8] as Vec3, max: [0, 3, 8] as Vec3 };

  /** Fly for `frames` and report the extreme x reached plus the final state. */
  function fly(c: Chunk, frames: number, colliders?: { boxes?: readonly ChunkBox[]; ceilingY?: number }) {
    let maxX = c.pos[0], minX = c.pos[0], maxY = c.pos[1];
    for (let i = 0; i < frames; i++) {
      c = stepChunk(c, 1 / 60, colliders);
      maxX = Math.max(maxX, c.pos[0]); minX = Math.min(minX, c.pos[0]);
      maxY = Math.max(maxY, c.pos[1]);
    }
    return { c, maxX, minX, maxY };
  }

  it('bounces off a wall instead of flying through it', () => {
    const r = fly(makeChunk('armL', [-1.5, 1, 0], [9, 0, 0], 0.15, [1, 0, 0], rng), 40, { boxes: [WALL] });
    // Never ends up inside the slab, and it came back off it.
    expect(r.maxX + 0.15).toBeLessThanOrEqual(WALL.max[0] + 1e-9);
    expect(r.c.vel[0]).toBeLessThan(0);
    expect(r.c.pos[0]).toBeLessThan(r.maxX);
    // ...and it is not glue: it came back with a real fraction of the speed.
    expect(Math.abs(r.c.vel[0])).toBeGreaterThan(2);
  });

  it('skids along a wall rather than stopping dead on it', () => {
    // 12 frames puts it just past the wall (1.35 m at ~9 m/s is ~9 frames), so
    // this reads the state just after the bounce: friction applies on EVERY
    // contact frame, exactly as it does on the floor, so a longer run decays the
    // tangential too and would measure the friction rather than the bounce.
    const r = fly(makeChunk('armL', [-1.5, 1, 0], [9, 0, 4], 0.15, [1, 0, 0], rng), 12, { boxes: [WALL] });
    expect(r.c.vel[0]).toBeLessThan(0);          // normal component reflected
    expect(r.c.vel[2]).toBeGreaterThan(2.2);     // tangential mostly kept (friction 0.72)
  });

  it('flies THROUGH a doorway: the boxes have a gap, the model does not care', () => {
    // The same wall, split around a 1.6 m opening at z in [-0.8, 0.8] — exactly
    // how levelColliders() models a tunnel mouth.
    const boxes = [
      { min: [-0.2, 0, -8] as Vec3, max: [0, 3, -0.8] as Vec3 },
      { min: [-0.2, 0, 0.8] as Vec3, max: [0, 3, 8] as Vec3 },
    ];
    const through = fly(makeChunk('armL', [-1.5, 1, 0], [9, 0, 0], 0.15, [1, 0, 0], rng), 20, { boxes });
    const blocked = fly(makeChunk('armL', [-1.5, 1, 4], [9, 0, 0], 0.15, [1, 0, 0], rng), 20, { boxes });
    expect(through.c.pos[0]).toBeGreaterThan(0.5);   // out the door
    expect(through.c.vel[0]).toBeGreaterThan(0);     // never reflected
    expect(blocked.maxX + 0.15).toBeLessThanOrEqual(0 + 1e-9);   // bounced off the wall beside it
    expect(blocked.c.vel[0]).toBeLessThan(0);
  });

  it('stops at the ceiling instead of leaving the room through the roof', () => {
    // Asserted AT the contact, not at the end of a one-second run: by then the
    // piece has already bounced off the FLOOR and is rising again, so "it is
    // going down now" would be false for a perfectly good bounce.
    let c = makeChunk('armL', [0, 1, 0], [0, 12, 0], 0.15, [1, 0, 0], rng);
    let ceilingHits = 0;
    for (let i = 0; i < 60; i++) {
      const prevVy = c.vel[1];
      c = stepChunk(c, 1 / 60, { ceilingY: 3 });
      expect(c.pos[1] + c.radius).toBeLessThanOrEqual(3 + 1e-9);
      if (prevVy > 0 && c.vel[1] < 0) ceilingHits++;
    }
    expect(ceilingHits).toBeGreaterThanOrEqual(1);
  });

  it('is UNCHANGED when no colliders are passed (the lab and every old test)', () => {
    // The stepper must be bit-identical to its old self when it is given no
    // geometry, or every tuning made in the lab stops meaning anything.
    const c1 = stepChunk(makeChunk('armL', [0, 1, 0], [3, 2, 1], 0.2, [0, 1, 0], rng), 1 / 60);
    const c2 = stepChunk(makeChunk('armL', [0, 1, 0], [3, 2, 1], 0.2, [0, 1, 0], rng), 1 / 60, {});
    expect([...c1.pos, ...c1.vel]).toEqual([...c2.pos, ...c2.vel]);
    const a = settle(makeChunk('armL', [0, 1, 0], [3, 2, 1], 0.2, [0, 1, 0], rng), 1);
    const b = settle(makeChunk('armL', [0, 1, 0], [3, 2, 1], 0.2, [0, 1, 0], rng), 1);
    expect([...a.pos, ...a.vel]).toEqual([...b.pos, ...b.vel]);
  });

  it('pushes a chunk whose CENTRE is inside a box out along its shallowest axis', () => {
    // The fast-piece-through-a-thin-wall case: there is no surface normal at the
    // centre, so the resolve has to pick an axis. x is 0.1 from either face here,
    // y/z are metres away, so -x wins and the sphere lands clear of the slab.
    const inside = stepChunk(makeChunk('armL', [-0.1, 1, 0], [0, 0, 0], 0.05, [1, 0, 0], rng),
      1 / 60, { boxes: [WALL] });
    expect(inside.pos[0] + inside.radius).toBeLessThanOrEqual(WALL.min[0] + 1e-9);
  });
});

// ---------------------------------------------------------------------------
// ORIENTATION-AWARE FLOOR SUPPORT. The owner, playing: "some pieces remaining
// above the floor". `stepChunk` pinned the chunk ORIGIN to one collision radius
// while the piece rotated, and that radius is the farthest reach of the piece
// (half a limb's LENGTH). A shin lying flat therefore rested with its origin at
// half-length height — floating by (length - thickness). The support shape is
// the actual geometry's local spheres; the floor test uses the lowest WORLD
// point, so a flat shin rests on its thickness and an upright one on its end.
// ---------------------------------------------------------------------------
describe('orientation-aware support (settled pieces on the floor)', () => {
  /** A 1 m capsule along local x with a 6 cm tube radius. */
  const CAPSULE = [
    { c: [-0.5, 0, 0] as Vec3, r: 0.06 },
    { c: [0.5, 0, 0] as Vec3, r: 0.06 },
  ];
  /** Broad-phase radius (chunkExtent) — half-length + r. */
  const EXTENT = 0.56;

  const makeSupportChunk = (quat: Chunk['quat'], pos: Vec3, vel: Vec3 = [0, 0, 0]): Chunk =>
    ({ ...makeChunk('legL', pos, vel, EXTENT, [1, 0, 0], rng, 'limb', undefined, CAPSULE), quat });

  it('chunkSupportOffset follows the rotation, not one sphere', () => {
    const flat = makeSupportChunk(qIdentity(), [0, 0, 0]);
    expect(chunkSupportOffset(flat)).toBeCloseTo(0.06, 6);
    // Turn the long axis vertical: the support is now half-length + tube.
    const upright = makeSupportChunk(qFromAxisAngle([0, 0, 1], Math.PI / 2), [0, 0, 0]);
    expect(chunkSupportOffset(upright)).toBeCloseTo(0.56, 6);
  });

  it('a flat long piece rests on its THICKNESS, not its half-length', () => {
    let c = makeSupportChunk(qIdentity(), [0, 2, 0], [0, -0.5, 0]);
    c = { ...c, angVel: [0, 0, 0] as Vec3 };
    for (let i = 0; i < 60 * 4; i++) c = stepChunk(c, 1 / 60);
    // The old radius pin left this at y = 0.56 (floating). It must rest at 0.06.
    expect(c.pos[1]).toBeCloseTo(0.06, 3);
    expect(c.pos[1]).toBeLessThan(0.12);
  });

  it('an upright piece rests on its END (does not sink through the floor)', () => {
    let c = makeSupportChunk(qFromAxisAngle([0, 0, 1], Math.PI / 2), [0, 3, 0], [0, -0.5, 0]);
    c = { ...c, angVel: [0, 0, 0] as Vec3 };
    for (let i = 0; i < 60 * 4; i++) c = stepChunk(c, 1 / 60);
    expect(c.pos[1]).toBeGreaterThanOrEqual(chunkSupportOffset(c) - 1e-6);
  });

  it('never lets the origin sink below its orientation-aware support', () => {
    let c = makeSupportChunk(qIdentity(), [0, 4, 0], [0, -12, 0]);
    for (let i = 0; i < 60 * 4; i++) {
      c = stepChunk(c, 1 / 60);
      expect(c.pos[1]).toBeGreaterThanOrEqual(chunkSupportOffset(c) - 1e-6);
    }
  });

  it('chunkSettled uses the orientation-aware support (a floating piece is not settled)', () => {
    const flat = makeSupportChunk(qIdentity(), [0, 0.3, 0]);
    const atRest: Chunk = { ...flat, vel: [0, 0, 0] as Vec3, angVel: [0, 0, 0] as Vec3, squash: 0 };
    // 0.3 m above the floor is airborne for a flat 6 cm shin even though the
    // old radius-based predicate (y <= 0.56) called it grounded.
    expect(chunkSettled(atRest)).toBe(false);
    const grounded: Chunk = { ...atRest, pos: [0, 0.06, 0] };
    expect(chunkSettled(grounded)).toBe(true);
  });

  it('a toppling long limb ends flat ON the floor, not hovering above it', () => {
    // Upright, slow, spin-free: only the topple moves it. It must lie down AND
    // descend to its thickness as the long axis goes horizontal.
    let c = makeSupportChunk(qFromAxisAngle([0, 0, 1], Math.PI / 2), [0, 0.56, 0], [0.01, 0, 0]);
    c = { ...c, angVel: [0, 0, 0] as Vec3 };
    for (let i = 0; i < 60 * 6; i++) c = stepChunk(c, 1 / 60);
    const worldLong = qRotate(c.quat, c.longAxis);
    expect(Math.abs(worldLong[1])).toBeLessThan(0.2);          // lying flat
    expect(Math.abs(c.pos[1] - 0.06)).toBeLessThan(0.06);      // and on the floor
  });

  it('defaults to the old single-sphere support (existing calls unchanged)', () => {
    const c = makeChunk('armL', [0, 0.2, 0], [0, 0, 0], 0.2, [0, 1, 0], rng);
    expect(chunkSupportOffset(c)).toBeCloseTo(0.2, 12);
    // Rotating a single origin sphere changes nothing.
    const spun = { ...c, quat: qFromAxisAngle([1, 1, 0], 0.7) };
    expect(chunkSupportOffset(spun)).toBeCloseTo(0.2, 12);
  });
});

