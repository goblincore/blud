import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { createSdfLayer, isHoldFrame, SDF_LAYER } from './sdf-layer';

describe('SDF-layer material precompile', () => {
  it('compiles in the real float-target context and restores renderer/camera state', async () => {
    const previousTarget = new THREE.RenderTarget(2, 2);
    let currentTarget: THREE.RenderTarget | null = previousTarget;
    let targetDuringCompile: THREE.RenderTarget | null = null;
    let maskDuringCompile = 0;
    const camera = new THREE.PerspectiveCamera();
    const compileAsync = vi.fn(async () => {
      targetDuringCompile = currentTarget;
      maskDuringCompile = camera.layers.mask;
    });
    const renderer = {
      getRenderTarget: () => currentTarget,
      setRenderTarget: (target: THREE.RenderTarget | null) => { currentTarget = target; },
      compileAsync,
    } as unknown as THREE.WebGPURenderer;
    const layer = createSdfLayer(renderer);
    const scene = new THREE.Scene();
    camera.layers.set(7);
    const previousMask = camera.layers.mask;
    const object = new THREE.Object3D();

    await layer.precompile(object, scene, camera);

    const compileTarget = compileAsync.mock.invocationCallOrder.length > 0
      ? compileAsync.mock.calls[0]
      : undefined;
    expect(compileTarget).toEqual([object, camera, scene]);
    expect(targetDuringCompile).toBeInstanceOf(THREE.RenderTarget);
    expect(targetDuringCompile).not.toBe(previousTarget);
    const compiledTarget = targetDuringCompile as unknown as THREE.RenderTarget;
    expect(compiledTarget.texture.type).toBe(THREE.FloatType);
    expect(maskDuringCompile).toBe(1 << SDF_LAYER);
    expect(currentTarget).toBe(previousTarget);
    expect(camera.layers.mask).toBe(previousMask);

    layer.dispose();
    previousTarget.dispose();
  });
});

describe('half-rate hold decision (C2)', () => {
  it('alternates fresh/hold by frame parity while enabled', () => {
    // Even index = fresh march, odd = hold, forever.
    expect(isHoldFrame(0, true, false)).toBe(false);
    expect(isHoldFrame(1, true, false)).toBe(true);
    expect(isHoldFrame(2, true, false)).toBe(false);
    expect(isHoldFrame(41, true, false)).toBe(true);
  });
  it('never holds while disabled or while a fresh frame is forced', () => {
    expect(isHoldFrame(1, false, false)).toBe(false);
    expect(isHoldFrame(1, true, true)).toBe(false);
    // The first frame ever is fresh even on an odd index.
    expect(isHoldFrame(1, true, true)).toBe(false);
  });
  it('alternation survives a forced-fresh frame (enable/resize mid-run)', () => {
    // frameIndex keeps counting; the forced frame is fresh, the next odd
    // frame holds again — enabling mid-session cannot put the layer in a
    // permanent all-fresh or all-hold state.
    const idxAfterForce = 6;              // even index anyway
    expect(isHoldFrame(idxAfterForce, true, true)).toBe(false);
    expect(isHoldFrame(idxAfterForce + 1, true, false)).toBe(true);
    const idxAfterForceOdd = 7;
    expect(isHoldFrame(idxAfterForceOdd, true, true)).toBe(false);
    expect(isHoldFrame(idxAfterForceOdd + 1, true, false)).toBe(false);
    expect(isHoldFrame(idxAfterForceOdd + 2, true, false)).toBe(true);
  });
});
