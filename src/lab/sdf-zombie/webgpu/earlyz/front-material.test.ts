// src/lab/sdf-zombie/webgpu/earlyz/front-material.test.ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import { createCrowdMaterial, defaultUniforms, blankFaceTexture } from '../zombie-gpu';
import { createCrowdRecords } from '../crowd-records';
import { createComputeTileBinding } from '../tile-bin-compute';

const renderer = { compute() { /* GPU dispatch stub, as crowd-type.test.ts */ } } as unknown as THREE.WebGPURenderer;
const make = (dispatch: 'boxes' | 'quad', earlyz?: { front: boolean }) => {
  const tex = new THREE.DataTexture(new Float32Array(4), 1, 1, THREE.RGBAFormat, THREE.FloatType);
  const rec = createCrowdRecords();
  return createCrowdMaterial(
    tex, defaultUniforms(blankFaceTexture()),
    { inst: rec.node, instCfg: uniform(new THREE.Vector4(0, 1, 0, 0)) },
    createComputeTileBinding(renderer, 256, 256), undefined, dispatch, undefined, earlyz,
  ).material as THREE.MeshBasicNodeMaterial & { conservativeDepth?: string };
};

describe('front-face crowd material (spec D2-D4)', () => {
  it('the shipped call is unchanged: BackSide, no opt-in property', () => {
    const m = make('boxes');
    expect(m.side).toBe(THREE.BackSide);
    expect('conservativeDepth' in m).toBe(false);
  });
  it('earlyz front: FrontSide + conservativeDepth greater + a depth node', () => {
    const m = make('boxes', { front: true });
    expect(m.side).toBe(THREE.FrontSide);
    expect(m.conservativeDepth).toBe('greater');
    expect(m.depthNode).not.toBeNull();
    expect(m.depthWrite).toBe(true);
  });
  it('the quad dispatch never takes the front path', () => {
    const m = make('quad', { front: true });
    expect('conservativeDepth' in m).toBe(false);
  });
});
