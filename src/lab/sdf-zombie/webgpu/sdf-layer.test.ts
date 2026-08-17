import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { createSdfLayer, SDF_LAYER } from './sdf-layer';

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
