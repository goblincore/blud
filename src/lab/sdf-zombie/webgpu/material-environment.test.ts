import { afterEach, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { loadKit } from './kit-overlay';
import { loadHeldProp } from './held-prop';

afterEach(() => vi.restoreAllMocks());

function stubLoads() {
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
  const load = () => loadHeldProp('/stub.gltf', renderer);
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

// Kits share ONE room environment per renderer (kit-overlay.ts kitEnvironment) and one parse per URL: retiring an actor's
// kit must never dispose that environment, so every survivor keeps sampling a live texture.
it('kit retirement never disposes the shared environment the survivor samples', async () => {
  const { targets } = stubLoads();
  const renderer = {} as THREE.WebGPURenderer;
  const first = await loadKit('/stub-kit.gltf', renderer), survivor = await loadKit('/stub-kit.gltf', renderer);
  expect(targets).toHaveLength(1);
  const disposeEnv = vi.spyOn(targets[0]!, 'dispose');
  const envOf = (k: typeof first) => {
    let env: THREE.Texture | null = null;
    k.object.traverse(o => { const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined; if (m?.envMap) env = m.envMap; });
    return env;
  };
  expect(envOf(survivor)).toBe(targets[0]!.texture);
  first.dispose();
  survivor.dispose();
  expect(disposeEnv).not.toHaveBeenCalled();
  expect(envOf(survivor)).toBe(targets[0]!.texture);
});
