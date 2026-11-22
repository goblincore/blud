import { afterEach, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { loadKit } from './kit-overlay';
import { loadHeldProp } from './held-prop';

afterEach(() => vi.restoreAllMocks());

/** A loaded kit's own (per-actor) materials. Kits parse once per URL (kit-overlay loadKitSource) and clone materials per
 *  actor, so the loader's material is never the one an actor draws with. */
function kitMaterials(k: { object: THREE.Object3D }): THREE.MeshStandardMaterial[] {
  const out: THREE.MeshStandardMaterial[] = [];
  k.object.traverse(o => { const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined; if (m) out.push(m); });
  return out;
}

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

// Held props share the kits' ONE environment per renderer (E1M1 soldier guns built per instance, 2026-10-28): never
// disposed, so retiring a prop cannot pull it from under a survivor, and instances share their node builds.
it('props share the never-disposed kit environment per renderer', async () => {
  const { targets, materials } = stubLoads();
  const renderer = {} as THREE.WebGPURenderer;
  const first = await loadHeldProp('/stub.gltf', renderer), survivor = await loadHeldProp('/stub.gltf', renderer);
  const kit = await loadKit('/stub.gltf', renderer);
  expect(targets).toHaveLength(1);
  const dispose = vi.spyOn(targets[0]!, 'dispose');
  expect(materials[0]!.envMap).toBe(targets[0]!.texture);
  expect(materials[1]!.envMap).toBe(targets[0]!.texture);
  expect(kitMaterials(kit)[0]!.envMap).toBe(targets[0]!.texture);
  expect(materials[0]!.customProgramCacheKey()).toBe(materials[1]!.customProgramCacheKey());
  first.dispose();
  expect(materials[1]!.envMap).toBe(targets[0]!.texture);
  survivor.dispose();
  kit.dispose();
  expect(dispose).not.toHaveBeenCalled();
});

// Kits share ONE environment per renderer so instances of a character share node builds (teratoma first-sight hitch,
// db14ad19); it is never disposed, so retiring a kit cannot pull it from under a survivor.
it('kits share one never-disposed environment per renderer', async () => {
  const { targets } = stubLoads();
  const renderer = {} as THREE.WebGPURenderer;
  const first = await loadKit('/stub-shared.gltf', renderer), survivor = await loadKit('/stub-shared.gltf', renderer);
  expect(targets).toHaveLength(1);
  const dispose = vi.spyOn(targets[0]!, 'dispose');
  const [a] = kitMaterials(first), [b] = kitMaterials(survivor);
  expect(a).not.toBe(b); // each actor its own material clone over the one parse
  expect(a!.envMap).toBe(targets[0]!.texture);
  expect(b!.envMap).toBe(targets[0]!.texture);
  expect(a!.customProgramCacheKey()).toBe(b!.customProgramCacheKey());
  first.dispose();
  expect(b!.envMap).toBe(targets[0]!.texture);
  survivor.dispose();
  expect(dispose).not.toHaveBeenCalled();
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
