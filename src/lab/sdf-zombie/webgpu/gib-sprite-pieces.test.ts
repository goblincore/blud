// src/lab/sdf-zombie/webgpu/gib-sprite-pieces.test.ts
//
// The runtime half of the sprite gibs: a blast's pieces are the SAME `Chunk`
// state the marched path integrates, plus a quad. These pin the three things
// that are actually new — the in-plane roll derived from the piece's own pose,
// the billboard's relationship to the camera, and the lifetime (the staggered
// release, settle-and-park, and the caps that replace the marched pool).
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { makeChunk, CHUNK_TUNING, type Chunk } from '../gib-chunks';
import type { GibSpriteFrame } from './gib-sprites';
import {
  GIB_SPRITE_TUNING, applySpritePose, clearSpritePieces, makeSpritePieceSet,
  setSpritePiecesVisible, spawnSpritePiece, spritePieceStates, spriteRollRad,
  stepSpritePieces,
} from './gib-sprite-pieces';

/** A frame with no image behind it — the pose and lifetime code never samples
 *  the texture, and a real one would need a decoder and a GPU. */
function frame(picnum: number, w = 2, h = 1): GibSpriteFrame {
  return { picnum, texture: new THREE.Texture(), w, h };
}

/** A chunk that is ALREADY at rest, so a single step parks it (chunkSettled's
 *  every clause satisfied: grounded on the floor, no spin, no squash, long axis
 *  flat, no speed). `makeChunk` gives every spawn a random tumble, which is the
 *  one clause that has to be cleared by hand. */
function settledChunk(radius = 0.1): Chunk {
  const c = makeChunk('torso' as never, [0, radius, 0], [0, 0, 0], radius, [1, 0, 0]);
  c.angVel = [0, 0, 0];
  return c;
}

const IDENTITY = new THREE.Quaternion();

function step(set: ReturnType<typeof makeSpritePieceSet>, dt = 1 / 60, opts: {
  liveCap?: number; restCap?: number; cameraQuat?: THREE.Quaternion;
} = {}) {
  return stepSpritePieces(set, {
    dt, cameraQuat: opts.cameraQuat ?? IDENTITY,
    liveCap: opts.liveCap, restCap: opts.restCap,
  });
}

describe('spriteRollRad — the tumble comes out of the piece\'s own pose', () => {
  it('reads the LONG AXIS\' screen-plane angle: identity camera, long axis +X, no roll', () => {
    const c = makeChunk('thigh' as never, [0, 0, 0], [0, 0, 0], 0.1, [1, 0, 0]);
    expect(spriteRollRad(c, IDENTITY)).toBeCloseTo(0, 9);
  });

  it('a quarter turn of the long axis is a quarter turn of the sprite', () => {
    const c = makeChunk('thigh' as never, [0, 0, 0], [0, 0, 0], 0.1, [0, 1, 0]);
    expect(spriteRollRad(c, IDENTITY)).toBeCloseTo(Math.PI / 2, 9);
  });

  it('the piece\'s QUAT is applied, not just its authored long axis', () => {
    // Same authored axis, spun 90 deg about Z by the physics: the world long
    // axis goes from +X to +Y, so the roll must go from 0 to a quarter turn.
    const c = makeChunk('thigh' as never, [0, 0, 0], [0, 0, 0], 0.1, [1, 0, 0]);
    c.quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2)
      .toArray() as Chunk['quat'];
    expect(spriteRollRad(c, IDENTITY)).toBeCloseTo(Math.PI / 2, 6);
  });

  it('DEGENERATE: a long axis pointing at the camera falls back to the spin', () => {
    // This is the case that would otherwise snap a gib upright exactly as it
    // flies at the player: the projection is a point, atan2(0,0) is 0.
    const c = makeChunk('thigh' as never, [0, 0, 0], [0, 0, 0], 0.1, [0, 0, 1]);
    c.angVel = [0, 7, 0];
    expect(spriteRollRad(c, IDENTITY)).toBeCloseTo(Math.PI / 2, 6);
    c.angVel = [-7, 0, 0];
    expect(spriteRollRad(c, IDENTITY)).toBeCloseTo(Math.PI, 6);
  });

  it('fully degenerate (axis at the camera AND spin along it) is 0, not NaN', () => {
    const c = makeChunk('thigh' as never, [0, 0, 0], [0, 0, 0], 0.1, [0, 0, 1]);
    c.angVel = [0, 0, 5];
    const r = spriteRollRad(c, IDENTITY);
    expect(Number.isFinite(r)).toBe(true);
    expect(r).toBe(0);
  });

  it('follows the CAMERA: the same piece rolls differently as the view yaws', () => {
    const c = makeChunk('thigh' as never, [0, 0, 0], [0, 0, 0], 0.1, [0, 0, 1]);
    c.angVel = [3, 0, 0];
    const yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
    const a = spriteRollRad(c, IDENTITY);
    const b = spriteRollRad(c, yaw);
    expect(a).not.toBeCloseTo(b, 3);
  });
});

describe('applySpritePose — position, faces the camera, roll about its own normal', () => {
  const camQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3, 1.1, -0.2));

  it('writes the piece position and a quaternion that is camera * rollZ', () => {
    const state = makeChunk('thigh' as never, [1.5, 0.4, -2.25], [0, 0, 0], 0.1, [1, 0, 0]);
    const obj = new THREE.Object3D();
    applySpritePose(obj, state, camQuat);
    expect([obj.position.x, obj.position.y, obj.position.z]).toEqual([1.5, 0.4, -2.25]);
    const expected = camQuat.clone().multiply(
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), spriteRollRad(state, camQuat)),
    );
    // `angleTo` is 2*acos(|dot|), so float noise in the dot amplifies; 1e-6 rad
    // is far below anything a viewer could see and far above the noise.
    expect(obj.quaternion.angleTo(expected)).toBeLessThan(1e-6);
  });

  it('the quad FACES the camera whatever it is doing (local +Z points at the eye)', () => {
    const state = makeChunk('thigh' as never, [0, 0.5, 0], [0, 0, 0], 0.1, [1, 0, 0]);
    state.quat = new THREE.Quaternion().setFromEuler(new THREE.Euler(1.1, -0.4, 2.2))
      .toArray() as Chunk['quat'];
    const obj = new THREE.Object3D();
    applySpritePose(obj, state, camQuat);
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(obj.quaternion);
    const camBack = new THREE.Vector3(0, 0, 1).applyQuaternion(camQuat);
    expect(normal.dot(camBack)).toBeCloseTo(1, 6);
  });
});

describe('lifetime — the staged release, and settle-and-park', () => {
  it('counts DRAINS, not frames: delay 1 still draws one frame at rest', () => {
    const set = makeSpritePieceSet();
    const state = makeChunk('thigh' as never, [0, 2, 0], [0, 0, 0], 0.1, [1, 0, 0]);
    spawnSpritePiece(set, { state, frame: frame(1), impulseDelay: 1, impulseVel: [5, 0, 0] });
    // The drain that could have fired it has already run in the spawn tick.
    step(set);
    expect(set.live[0]!.state.vel[0]).toBeCloseTo(0, 6);
    // Next drain: it goes.
    step(set);
    expect(set.live[0]!.state.vel[0]).toBeGreaterThan(4);
  });

  it('steps with the SHARED chunk stepper — gravity pulls a live piece down', () => {
    const set = makeSpritePieceSet();
    const state = makeChunk('thigh' as never, [0, 5, 0], [0, 0, 0], 0.1, [1, 0, 0]);
    spawnSpritePiece(set, { state, frame: frame(1) });
    const y0 = set.live[0]!.state.pos[1];
    step(set, 1 / 60);
    const y1 = set.live[0]!.state.pos[1];
    expect(y1).toBeLessThan(y0);
    expect(CHUNK_TUNING.gravity).toBeLessThan(0);
  });

  it('parks a settled piece in rest and never steps it again', () => {
    const set = makeSpritePieceSet();
    const state = settledChunk(0.1);
    spawnSpritePiece(set, { state, frame: frame(1) });
    const r = step(set);
    expect(r.rested).toBe(1);
    expect(set.live.length).toBe(0);
    expect(set.rest.length).toBe(1);
    const parked = [...set.rest[0]!.state.pos] as [number, number, number];
    step(set);
    expect([...set.rest[0]!.state.pos]).toEqual(parked); // no drift: not integrated
  });

  it('a parked piece still FACES the camera (a flat card on the floor otherwise)', () => {
    const set = makeSpritePieceSet();
    spawnSpritePiece(set, { state: settledChunk(0.1), frame: frame(1) });
    step(set);
    const yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 2.0);
    step(set, 1 / 60, { cameraQuat: yaw });
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(set.rest[0]!.mesh.quaternion);
    const camBack = new THREE.Vector3(0, 0, 1).applyQuaternion(yaw);
    expect(normal.dot(camBack)).toBeCloseTo(1, 6);
  });
});

describe('caps — the sprite path\'s stand-in for the marched view pool', () => {
  it('drops the OLDEST live piece over the cap, keeping the newest gore', () => {
    const set = makeSpritePieceSet();
    for (let i = 0; i < 6; i++) {
      spawnSpritePiece(set, {
        state: makeChunk('thigh' as never, [0, 5, 0], [0, 0, 0], 0.1, [1, 0, 0]),
        frame: frame(i + 1),
      });
    }
    const r = step(set, 1 / 60, { liveCap: 4 });
    expect(r.dropped).toBe(2);
    expect(set.live.length).toBe(4);
    expect(set.live.map(p => p.id)).toEqual([3, 4, 5, 6]);
  });

  it('bounds the resting pile separately, oldest-first', () => {
    const set = makeSpritePieceSet();
    for (let i = 0; i < 4; i++) {
      spawnSpritePiece(set, { state: settledChunk(0.1), frame: frame(i + 1) });
    }
    const r = step(set, 1 / 60, { liveCap: 100, restCap: 2 });
    expect(r.rested).toBe(4);
    expect(set.rest.length).toBe(2);
    expect(r.dropped).toBe(2);
  });

  it('the defaults are the shipped caps (the marched pool is not consulted)', () => {
    const set = makeSpritePieceSet();
    expect(GIB_SPRITE_TUNING.liveCap).toBeGreaterThanOrEqual(96);
    expect(step(set).dropped).toBe(0);
  });
});

describe('assets and visibility', () => {
  it('SHARES one geometry and one material across pieces of the same frame', () => {
    // Per-piece `texture.clone()` would be N uploads of the same sheet rect; and
    // three r185's Texture.copy shares the sheet's Source, so per-piece disposal
    // would blank the siblings. Sharing is what makes both moot.
    const set = makeSpritePieceSet();
    const f = frame(7);
    const a = spawnSpritePiece(set, { state: settledChunk(), frame: f });
    const b = spawnSpritePiece(set, { state: settledChunk(), frame: f });
    expect(a.mesh.material).toBe(b.mesh.material);
    expect(a.mesh.geometry).toBe(b.mesh.geometry);
    // ...but a different frame gets its own material (its own sheet rect).
    const c = spawnSpritePiece(set, { state: settledChunk(), frame: frame(8) });
    expect(c.mesh.material).not.toBe(a.mesh.material);
    // The GEOMETRY is shared across frames too: it is one unit plane and the
    // piece's size lives on the mesh scale, so the cache cannot grow with the
    // number of pieces ever spawned (measured: a size-keyed cache left 232
    // geometries for 147 pieces, because every radius is its own number).
    expect(c.mesh.geometry).toBe(a.mesh.geometry);
    expect((a.mesh.geometry as THREE.PlaneGeometry).parameters).toMatchObject({ width: 1, height: 1 });
  });

  it('carries the sprite\'s own ASPECT on the scale, not in the geometry', () => {
    const set = makeSpritePieceSet();
    // 2:1 rect at a 0.2 m height -> 0.4 m wide, 0.2 m tall.
    const p = spawnSpritePiece(set, { state: settledChunk(0.2), frame: frame(1, 2, 1), sizeM: 0.2 });
    expect(p.mesh.scale.x).toBeCloseTo(0.4, 9);
    expect(p.mesh.scale.y).toBeCloseTo(0.2, 9);
    expect(p.mesh.scale.z).toBe(1);
    // A squarer rect gets a squarer quad, off the same shared geometry.
    const q = spawnSpritePiece(set, { state: settledChunk(0.2), frame: frame(2, 1, 1), sizeM: 0.2 });
    expect(q.mesh.scale.x).toBeCloseTo(0.2, 9);
    expect(q.mesh.geometry).toBe(p.mesh.geometry);
  });

  it('sizes the quad from the piece\'s own diameter, with the margin correction', () => {
    const set = makeSpritePieceSet();
    const p = spawnSpritePiece(set, { state: settledChunk(0.2), frame: frame(1, 1, 1) });
    expect(p.sizeM).toBeCloseTo(2 * 0.2 * GIB_SPRITE_TUNING.sizeScale, 6);
  });

  it('hides every piece, live and parked, and new spawns inherit it', () => {
    const set = makeSpritePieceSet();
    spawnSpritePiece(set, { state: settledChunk(), frame: frame(1) });
    step(set);
    expect(setSpritePiecesVisible(set, false)).toBe(false);
    expect(set.rest[0]!.mesh.visible).toBe(false);
    const fresh = spawnSpritePiece(set, { state: settledChunk(), frame: frame(2) });
    expect(fresh.mesh.visible).toBe(false);
    setSpritePiecesVisible(set, true);
    expect(fresh.mesh.visible).toBe(true);
  });

  it('clear empties both lists and reports what it dropped', () => {
    const set = makeSpritePieceSet();
    spawnSpritePiece(set, { state: settledChunk(), frame: frame(1) });
    spawnSpritePiece(set, { state: makeChunk('thigh' as never, [0, 4, 0], [0, 0, 0], 0.1, [1, 0, 0]), frame: frame(2) });
    step(set);
    expect(clearSpritePieces(set)).toBe(2);
    expect(set.live.length).toBe(0);
    expect(set.rest.length).toBe(0);
    expect(set.group.children.length).toBe(0);
  });

  it('spritePieceStates reports both lists, so a rig need not know the mode', () => {
    const set = makeSpritePieceSet();
    spawnSpritePiece(set, { state: settledChunk(0.1), frame: frame(1) });
    step(set);
    const states = spritePieceStates(set);
    expect(states.length).toBe(1);
    expect(states[0]!.rest).toBe(true);
    expect(states[0]!.settled).toBe(true);
    expect(states[0]!.radius).toBeCloseTo(0.1, 9);
  });
});
