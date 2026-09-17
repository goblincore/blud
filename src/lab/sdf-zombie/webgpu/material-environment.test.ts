import { afterEach, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { loadKit } from './kit-overlay';
import { loadHeldProp } from './held-prop';

afterEach(() => vi.restoreAllMocks());

it.each(['kit', 'prop'] as const)('%s retirement leaves the survivor with independent environment bindings', async kind => {
  const targets: THREE.RenderTarget[] = [];
  vi.spyOn(THREE.PMREMGenerator.prototype, 'fromScene').mockImplementation(() => {
    const target = new THREE.RenderTarget(16, 16);
    targets.push(target);
    return target;
  });
  vi.spyOn(THREE.PMREMGenerator.prototype, 'dispose').mockImplementation(() => {});
  const materials: THREE.MeshStandardMaterial[] = [];
  vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockImplementation(async () => {
    const material = new THREE.MeshStandardMaterial();
    materials.push(material);
    const scene = new THREE.Group();
    scene.add(new THREE.Mesh(new THREE.BoxGeometry(), material));
    return { scene } as never;
  });
  const renderer = {} as THREE.WebGPURenderer;
  const load = () => kind === 'kit' ? loadKit('/stub.gltf', renderer) : loadHeldProp('/stub.gltf', renderer);
  const first = await load(), survivor = await load();
  const disposeFirst = vi.spyOn(targets[0]!, 'dispose');
  const disposeSurvivor = vi.spyOn(targets[1]!, 'dispose');
  expect(materials[0]!.envMap).toBe(targets[0]!.texture);
  expect(materials[1]!.envMap).toBe(targets[1]!.texture);
  expect(materials[0]!.customProgramCacheKey()).not.toBe(materials[1]!.customProgramCacheKey());
  first.dispose();
  expect(disposeFirst).toHaveBeenCalledOnce();
  expect(disposeSurvivor).not.toHaveBeenCalled();
  expect(materials[1]!.envMap).toBe(targets[1]!.texture);
  survivor.dispose();
  expect(disposeSurvivor).toHaveBeenCalledOnce();
});
