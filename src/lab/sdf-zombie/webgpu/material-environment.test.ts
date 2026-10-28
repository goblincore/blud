import { afterEach, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { loadKit } from './kit-overlay';
import { loadHeldProp } from './held-prop';

afterEach(() => vi.restoreAllMocks());

function stubLoads(): { targets: THREE.RenderTarget[]; materials: THREE.MeshStandardMaterial[] } {
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
  return { targets, materials };
}

it('prop retirement leaves the survivor with independent environment bindings', async () => {
  const { targets, materials } = stubLoads();
  const renderer = {} as THREE.WebGPURenderer;
  const first = await loadHeldProp('/stub.gltf', renderer), survivor = await loadHeldProp('/stub.gltf', renderer);
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

// Kits share ONE environment per renderer so instances of a character share node builds (teratoma first-sight hitch,
// db14ad19); it is never disposed, so retiring a kit cannot pull it from under a survivor.
it('kits share one never-disposed environment per renderer', async () => {
  const { targets, materials } = stubLoads();
  const renderer = {} as THREE.WebGPURenderer;
  const first = await loadKit('/stub.gltf', renderer), survivor = await loadKit('/stub.gltf', renderer);
  expect(targets).toHaveLength(1);
  const dispose = vi.spyOn(targets[0]!, 'dispose');
  expect(materials[0]!.envMap).toBe(targets[0]!.texture);
  expect(materials[1]!.envMap).toBe(targets[0]!.texture);
  expect(materials[0]!.customProgramCacheKey()).toBe(materials[1]!.customProgramCacheKey());
  first.dispose();
  expect(materials[1]!.envMap).toBe(targets[0]!.texture);
  survivor.dispose();
  expect(dispose).not.toHaveBeenCalled();
});
