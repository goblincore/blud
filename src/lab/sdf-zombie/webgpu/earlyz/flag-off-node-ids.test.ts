// src/lab/sdf-zombie/webgpu/earlyz/flag-off-node-ids.test.ts
//
// FLAG-OFF SHADER IDENTITY (final review, Important 1). Every wgslFn consumes a global three
// node id, and those ids spell the `NodeBuffer_<id>` names of every program built after it. A
// wgslFn created at zombie-gpu's import would renumber the shipped crowd shaders (a different
// fragment hash, 44 lines of renames) even with the flag off. The early-Z box-exit function
// must therefore only be created when a FRONT material is built.
import { describe, it, expect, vi, beforeAll } from 'vitest';
import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import { EARLYZ_BOX_EXIT_WGSL } from './box-exit.wgsl';

// Count wgslFn calls for the exit source without changing what wgslFn returns.
vi.mock('three/tsl', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three/tsl')>();
  const real = actual.wgslFn as (code: string, includes?: unknown[]) => unknown;
  return { ...actual, wgslFn: vi.fn((code: string, includes?: unknown[]) => real(code, includes)) };
});

describe('early-Z box exit wgslFn is created lazily', () => {
  let tsl: typeof import('three/tsl');
  let zombie: typeof import('../zombie-gpu');
  let records: typeof import('../crowd-records');
  let tiles: typeof import('../tile-bin-compute');

  const exitCalls = (): number =>
    vi.mocked(tsl.wgslFn).mock.calls.filter((c) => c[0] === EARLYZ_BOX_EXIT_WGSL).length;

  const make = (dispatch: 'boxes' | 'quad', earlyz?: { front: boolean }) => {
    const renderer = { compute() { /* GPU dispatch stub */ } } as unknown as THREE.WebGPURenderer;
    const tex = new THREE.DataTexture(new Float32Array(4), 1, 1, THREE.RGBAFormat, THREE.FloatType);
    const rec = records.createCrowdRecords();
    return zombie.createCrowdMaterial(
      tex, zombie.defaultUniforms(zombie.blankFaceTexture()),
      { inst: rec.node, instCfg: uniform(new THREE.Vector4(0, 1, 0, 0)) },
      tiles.createComputeTileBinding(renderer, 256, 256), undefined, dispatch, undefined, earlyz,
    );
  };

  beforeAll(async () => {
    tsl = await import('three/tsl');
    zombie = await import('../zombie-gpu');
    records = await import('../crowd-records');
    tiles = await import('../tile-bin-compute');
  }, 60000);

  it('the mock really wraps wgslFn (zombie-gpu made its other wgslFn nodes through it)', () => {
    expect(vi.mocked(tsl.wgslFn).mock.calls.length).toBeGreaterThan(0);
  });

  it('importing zombie-gpu creates no exit node', () => {
    expect(exitCalls()).toBe(0);
  });

  it('shipped materials (no earlyz, front:false, quad + front) create none either', () => {
    make('boxes');
    make('boxes', { front: false });
    make('quad', { front: true });
    expect(exitCalls()).toBe(0);
  });

  it('the first front material creates it once; later front materials share it', () => {
    make('boxes', { front: true });
    expect(exitCalls()).toBe(1);
    make('boxes', { front: true });
    expect(exitCalls()).toBe(1);
  });
});
