import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import type { GameContext } from './game-context';
import { clearMeshGibs, MESH_GIB_CAP, SKULL_GIB_CAP, spawnMeshGib } from './game-mesh-gibs';

function fixture() {
  const scene = new THREE.Scene();
  const router = { register: vi.fn(), unregister: vi.fn() };
  const ctx = { boot: { handle: { scene }, deferredApi: { router } }, gibs: { meshGibs: [] } } as unknown as GameContext;
  const add = (tag: string) => {
    const geometry = new THREE.BufferGeometry();
    geometry.userData.ownedSkullDebris = tag === 'skull';
    const material = new THREE.MeshBasicMaterial();
    const mesh = new THREE.Mesh(geometry, material);
    const root = new THREE.Group(); root.add(mesh);
    const disposed = vi.fn(); geometry.addEventListener('dispose', disposed);
    const materialDisposed = vi.fn(); material.addEventListener('dispose', materialDisposed);
    spawnMeshGib(ctx, root, [0, 1, 0], [0, 2, 0], [1, 2, 3], .05, { tag });
    return { root, disposed, materialDisposed };
  };
  return { ctx, scene, router, add };
}

describe('anatomical skull gib ownership', () => {
  it('keeps a complete fourteen-piece explosion beside an existing brain', () => {
    const { ctx, add, scene } = fixture();
    const brain = add('brain');
    for (let i = 0; i < 14; i++) add('skull');
    expect(ctx.gibs.meshGibs).toHaveLength(15);
    expect(brain.root.parent).toBe(scene);
    clearMeshGibs(ctx);
    expect(brain.disposed).not.toHaveBeenCalled();
  });

  it('evicts within each pool and frees owned geometry without disposing shared materials', () => {
    const { ctx, add, scene, router } = fixture();
    const firstSkull = add('skull');
    const firstBrain = add('brain');
    for (let i = 1; i < SKULL_GIB_CAP; i++) add('skull');
    add('skull');
    expect(firstSkull.root.parent).toBeNull();
    expect(firstSkull.disposed).toHaveBeenCalledOnce();
    expect(firstSkull.materialDisposed).not.toHaveBeenCalled();
    expect(firstBrain.root.parent).toBe(scene);
    for (let i = 1; i < MESH_GIB_CAP; i++) add('brain');
    add('brain');
    expect(firstBrain.root.parent).toBeNull();
    expect(firstBrain.disposed).not.toHaveBeenCalled();
    expect(ctx.gibs.meshGibs).toHaveLength(SKULL_GIB_CAP + MESH_GIB_CAP);
    const lastSkull = add('skull');
    clearMeshGibs(ctx);
    expect(ctx.gibs.meshGibs).toHaveLength(0);
    expect(scene.children).toHaveLength(0);
    expect(lastSkull.disposed).toHaveBeenCalledOnce();
    expect(lastSkull.materialDisposed).not.toHaveBeenCalled();
    expect(router.unregister).toHaveBeenCalledWith(lastSkull.root);
  });
});
