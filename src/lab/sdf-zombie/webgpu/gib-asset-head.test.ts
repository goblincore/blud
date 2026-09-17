// src/lab/sdf-zombie/webgpu/gib-asset-head.test.ts
//
// offline-gib-assets task 4. The moving asset head's face frame and the
// ownership of its per-instance face material. NO GPU: the frame math is pure,
// and the registry is generic over a handle, so a fake factory proves the
// lifecycle (motion, reset, disposal, resource ownership) without a renderer.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { makeChunk, squashFactors, stepChunk } from '../gib-chunks';
import { qFromAxisAngle, qMul } from '../vec';
import {
  GibAssetHeadRegistry, gibAssetHeadFrame,
  type GibAssetHeadFrame, type GibAssetHeadLocal, type GibAssetHeadMaterial,
} from './gib-asset-head';
import { createBakedChunkMaterial } from './baked-chunks';
import type { Vec3 } from '../types';

const LOCAL: GibAssetHeadLocal = {
  centre: [0.08, 0.31, -0.05],
  quat: qFromAxisAngle([0.2, 1, 0.1], 0.6),
  axes: [0.11, 0.13, 0.12],
};

/** A chunk with a non-trivial orientation, squash and position. */
function movingChunk() {
  return makeChunk(
    'torso' as never, [1.2, 0.9, -3.1] as Vec3, [0.4, -1.1, 0.2] as Vec3,
    0.12, [0.3, 0.9, 0.2] as Vec3, () => 0.5, 'limb',
    { quat: qFromAxisAngle([0.3, 0.9, 0.1], 1.1), angVel: [0.2, -0.4, 0.1] },
  );
}

interface FakeHandle { frames: GibAssetHeadFrame[]; disposed: number; }

function recordingFactory() {
  const handles: FakeHandle[] = [];
  let nextId = 0;
  const factory = {
    create: (): GibAssetHeadMaterial => {
      const h: FakeHandle = { frames: [], disposed: 0 };
      const id = nextId++;
      handles.push(h);
      return {
        material: { id },
        setFrame: (f: GibAssetHeadFrame) => { h.frames.push(f); },
        dispose: () => { h.disposed++; },
      };
    },
  };
  return { handles, factory };
}

describe('gibAssetHeadFrame — the face rides the chunk', () => {
  it('matches the mesh pose transform the sprite path applies', () => {
    const state = movingChunk();
    const frame = gibAssetHeadFrame(state, LOCAL);
    // Independent composition through THREE's own quaternion/scale path, the
    // same values `applyMeshPose` writes onto the mesh.
    const s = squashFactors(state);
    const expected = new THREE.Vector3(LOCAL.centre[0], LOCAL.centre[1], LOCAL.centre[2])
      .applyQuaternion(new THREE.Quaternion(state.quat[0], state.quat[1], state.quat[2], state.quat[3]))
      .multiply(new THREE.Vector3(s.sx, s.sy, s.sz))
      .add(new THREE.Vector3(state.pos[0], state.pos[1], state.pos[2]));
    expect(frame.centre[0]).toBeCloseTo(expected.x, 10);
    expect(frame.centre[1]).toBeCloseTo(expected.y, 10);
    expect(frame.centre[2]).toBeCloseTo(expected.z, 10);
    // World head rotation = chunk rotation * rest head rotation.
    const expectedQuat = new THREE.Quaternion(state.quat[0], state.quat[1], state.quat[2], state.quat[3])
      .multiply(new THREE.Quaternion(LOCAL.quat[0], LOCAL.quat[1], LOCAL.quat[2], LOCAL.quat[3]));
    expect(frame.quat[0]).toBeCloseTo(expectedQuat.x, 10);
    expect(frame.quat[1]).toBeCloseTo(expectedQuat.y, 10);
    expect(frame.quat[2]).toBeCloseTo(expectedQuat.z, 10);
    expect(frame.quat[3]).toBeCloseTo(expectedQuat.w, 10);
    // Semi-axes take the world-axis squash.
    expect(frame.axes).toEqual([LOCAL.axes[0] * s.sx, LOCAL.axes[1] * s.sy, LOCAL.axes[2] * s.sz]);
  });

  it('tracks the chunk across a motion and a squash change', () => {
    const a = movingChunk();
    const frameA = gibAssetHeadFrame(a, LOCAL);
    // Pure translation: the frame delta IS the chunk delta.
    const b = { ...a, pos: [a.pos[0] + 0.7, a.pos[1] - 0.2, a.pos[2] + 0.3] as Vec3 };
    const frameB = gibAssetHeadFrame(b, LOCAL);
    expect(frameB.centre[0] - frameA.centre[0]).toBeCloseTo(0.7, 10);
    expect(frameB.centre[1] - frameA.centre[1]).toBeCloseTo(-0.2, 10);
    expect(frameB.centre[2] - frameA.centre[2]).toBeCloseTo(0.3, 10);
    // A squash change is carried into the semi-axes (not silently dropped).
    const squashed = { ...a, squash: 1 };
    const frameS = gibAssetHeadFrame(squashed, LOCAL);
    const sS = squashFactors(squashed);
    expect(frameS.axes[0]).toBeCloseTo(LOCAL.axes[0] * sS.sx, 10);
    expect(frameS.axes[1]).toBeCloseTo(LOCAL.axes[1] * sS.sy, 10);
    expect(frameS.axes[1]).not.toBeCloseTo(frameA.axes[1], 6);
  });
});

describe('GibAssetHeadRegistry — per-instance ownership', () => {
  it('builds a DISTINCT material and frame per head (no shared uniforms)', () => {
    const { factory, handles } = recordingFactory();
    const reg = new GibAssetHeadRegistry(factory);
    const a = reg.acquire('head', LOCAL)!;
    const b = reg.acquire('head', LOCAL)!;
    expect(a.material).not.toBe(b.material);
    const state = movingChunk();
    a.setFrameFromState(state);
    b.setFrameFromState({ ...state, pos: [9, 9, 9] as Vec3 });
    expect(handles[0]!.frames.length).toBe(1);
    expect(handles[1]!.frames.length).toBe(1);
    // The second head's frame did not overwrite the first's.
    expect(handles[0]!.frames[0]!.centre[1]).toBeLessThan(5);
    expect(handles[1]!.frames[0]!.centre[1]).toBeGreaterThan(8);
    expect(reg.counters()).toEqual({ live: 2, created: 2, disposed: 0 });
  });

  it('snapshots the locals so a reused actor vector cannot alias the frame', () => {
    const { factory, handles } = recordingFactory();
    const reg = new GibAssetHeadRegistry(factory);
    const mutable: GibAssetHeadLocal = { centre: [1, 2, 3], quat: [0, 0, 0, 1], axes: [1, 1, 1] };
    const res = reg.acquire('head', mutable)!;
    mutable.centre = [9, 9, 9];
    res.setFrameFromState({ pos: [0, 0, 0], quat: [0, 0, 0, 1], squash: 0 } as never);
    expect(handles[0]!.frames[0]!.centre).toEqual([1, 2, 3]);
  });

  it('releases idempotently and a reset disposes the rest exactly once', () => {
    const { factory, handles } = recordingFactory();
    const reg = new GibAssetHeadRegistry(factory);
    const a = reg.acquire('head', LOCAL)!;
    const b = reg.acquire('head', LOCAL)!;
    a.release();
    a.release(); // idempotent — the sprite detach may race a reset
    expect(handles[0]!.disposed).toBe(1);
    expect(reg.counters()).toEqual({ live: 1, created: 2, disposed: 1 });
    reg.dispose();
    expect(handles[1]!.disposed).toBe(1);
    expect(reg.counters()).toEqual({ live: 0, created: 2, disposed: 2 });
    // A late release after disposal (a piece evicted after a reset) is a no-op.
    b.release();
    expect(handles[1]!.disposed).toBe(1);
  });

  it('is unavailable with no factory, so the marched head fallback is kept', () => {
    const reg = new GibAssetHeadRegistry(null);
    expect(reg.available).toBe(false);
    expect(reg.acquire('head', LOCAL)).toBeNull();
    expect(reg.counters()).toEqual({ live: 0, created: 0, disposed: 0 });
  });

  it('carries the frame through a real step without drifting off the chunk', () => {
    const { factory, handles } = recordingFactory();
    const reg = new GibAssetHeadRegistry(factory);
    const res = reg.acquire('head', LOCAL)!;
    let state = movingChunk();
    res.setFrameFromState(state);
    const first = handles[0]!.frames[0]!;
    // The frame must always be the chunk-transformed local centre.
    for (let i = 0; i < 40; i++) {
      state = stepChunk(state, 1 / 60);
      res.setFrameFromState(state);
      const f = handles[0]!.frames[handles[0]!.frames.length - 1]!;
      const s = squashFactors(state);
      const r = new THREE.Vector3(LOCAL.centre[0], LOCAL.centre[1], LOCAL.centre[2])
        .applyQuaternion(new THREE.Quaternion(state.quat[0], state.quat[1], state.quat[2], state.quat[3]))
        .multiply(new THREE.Vector3(s.sx, s.sy, s.sz))
        .add(new THREE.Vector3(state.pos[0], state.pos[1], state.pos[2]));
      expect(f.centre[0]).toBeCloseTo(r.x, 10);
      expect(f.centre[1]).toBeCloseTo(r.y, 10);
      expect(f.centre[2]).toBeCloseTo(r.z, 10);
    }
    // 41 frames, all distinct objects, all owned by this one resource.
    expect(handles[0]!.frames.length).toBe(41);
    expect(handles[0]!.frames[0]).not.toBe(handles[0]!.frames[40]);
    expect(first.centre).not.toEqual(handles[0]!.frames[40]!.centre);
    res.release();
  });
});

describe('gib-asset-head quaternion convention', () => {
  it('uses the same chunk*rest composition as ChunkGpuView.apply', () => {
    const chunkQuat = qFromAxisAngle([0.2, 0.3, 0.9], 0.8);
    const rest = qFromAxisAngle([0.1, 0.2, 1], 0.4);
    expect(qMul(chunkQuat, rest)).toHaveLength(4);
    const frame = gibAssetHeadFrame(
      { pos: [0, 0, 0], quat: chunkQuat, squash: 0 } as never,
      { centre: [0, 0, 0], quat: rest, axes: [1, 1, 1] },
    );
    const t = new THREE.Quaternion(chunkQuat[0], chunkQuat[1], chunkQuat[2], chunkQuat[3])
      .multiply(new THREE.Quaternion(rest[0], rest[1], rest[2], rest[3]));
    expect(frame.quat[3]).toBeCloseTo(t.w, 10);
  });
});

/** A minimal live-actor face uniform set, with the `.value` shape
 *  `createBakedChunkMaterial` reads. */
function fakeFaceSource() {
  return {
    faceTex: { value: new THREE.Texture() },
    headCentre: { value: new THREE.Vector3(0, 1.5, 0) },
    headAxes: { value: new THREE.Vector3(0.1, 0.12, 0.11) },
    headQuat: { value: new THREE.Vector4(0, 0, 0, 1) },
    faceCfg: { value: new THREE.Vector4(1, 1, 1, 0) },
    faceCfg2: { value: new THREE.Vector4(0, 0.5, 0.8, 0.5) },
    faceCfg3: { value: new THREE.Vector4(0, 0, 0, 0) },
    faceProj: { value: new THREE.Vector4(0.45, 0.58, 0.5, 0.56) },
    faceAtlas: { value: new THREE.Vector4(1, 1, 0, 0) },
    faceGlowRedOnly: { value: 0 },
    faceGlowColor: { value: new THREE.Color(1, 0, 0) },
  } as unknown as import('./zombie-gpu').MarchUniforms;
}

describe('per-instance face materials own their frame, not the texture', () => {
  it('exposes a private frame handle and never disposes the external atlas', () => {
    const srcA = fakeFaceSource();
    const srcB = fakeFaceSource();
    const texA = srcA.faceTex.value;
    const a = createBakedChunkMaterial({ goreDetail: true, bakedAo: true, fleshResponse: true, face: srcA });
    const b = createBakedChunkMaterial({ goreDetail: true, bakedAo: true, fleshResponse: true, face: srcB });
    expect(a.faceUniforms).toBeTruthy();
    expect(b.faceUniforms).toBeTruthy();
    a.faceUniforms!.headCentre.value.set(9, 9, 9);
    a.faceUniforms!.headQuat.value.set(0.1, 0.2, 0.3, 0.9);
    expect(b.faceUniforms!.headCentre.value.x).toBe(0);
    // The material references the ACTOR's atlas; disposing the material must not
    // dispose a texture it does not own (another head still uses it).
    let disposed = false;
    texA.addEventListener('dispose', () => { disposed = true; });
    a.dispose();
    b.dispose();
    expect(disposed).toBe(false);
  });
});
