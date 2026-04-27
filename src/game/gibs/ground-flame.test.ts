import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { GroundFlame, GroundFlameManager } from './ground-flame';
import { BURN } from './tuning';

function mockTex(): THREE.Texture {
  return { isTexture: true } as any;
}

function mockCamera(): THREE.Camera {
  return {
    position: { x: 0, y: 0, z: 10 },
    lookAt: vi.fn(),
  } as any;
}

describe('GroundFlame', () => {
  it('is alive within its lifetime', () => {
    const scene = new THREE.Scene();
    const flame = new GroundFlame({ x: 0, y: 0, z: 0 }, 0, mockTex(), scene);
    const cam = mockCamera();
    expect(flame.update(1, cam)).toBe(true); // 1s < 4s lifetime
    expect(flame.isExpired()).toBe(false);
    flame.dispose();
  });

  it('fades out over the last fade window', () => {
    const scene = new THREE.Scene();
    const flame = new GroundFlame({ x: 0, y: 0, z: 0 }, 0, mockTex(), scene);
    const cam = mockCamera();

    // Within full-alpha zone (3.5s, before fade starts at 4.0-0.5=3.5)
    flame.update(3.0, cam);
    const mat = flame.mesh.material as THREE.MeshBasicMaterial;
    expect(mat.opacity).toBe(1.0);

    // At 3.9s, near end of 0.5s fade window
    flame.update(3.9, cam);
    expect(mat.opacity).toBeLessThan(0.3); // (4.0-3.9)/0.5 = 0.2

    // Past lifetime
    flame.update(4.1, cam);
    expect(flame.isExpired()).toBe(true);

    flame.dispose();
  });

  it('expires after lifetime', () => {
    const scene = new THREE.Scene();
    const flame = new GroundFlame({ x: 0, y: 0, z: 0 }, 0, mockTex(), scene);
    const cam = mockCamera();
    expect(flame.update(BURN.groundFlameLifetimeSec + 0.1, cam)).toBe(false);
    expect(flame.isExpired()).toBe(true);
    flame.dispose();
  });

  it('billboard positions at world pos with slight Y offset', () => {
    const scene = new THREE.Scene();
    const flame = new GroundFlame({ x: 3, y: 1, z: 5 }, 0, mockTex(), scene);
    expect(flame.mesh.position.x).toBe(3);
    expect(flame.mesh.position.y).toBe(1.05); // 1.0 + 0.05 offset
    expect(flame.mesh.position.z).toBe(5);
    flame.dispose();
  });

  it('dispose cleans up geometry and material', () => {
    const scene = new THREE.Scene();
    const flame = new GroundFlame({ x: 0, y: 0, z: 0 }, 0, mockTex(), scene);
    const geomSpy = vi.spyOn(flame.mesh.geometry, 'dispose');
    const matSpy = vi.spyOn(flame.mesh.material as THREE.Material, 'dispose');
    flame.dispose();
    expect(geomSpy).toHaveBeenCalledOnce();
    expect(matSpy).toHaveBeenCalledOnce();
  });
});

describe('GroundFlameManager', () => {
  it('spawns and tracks flames', () => {
    const scene = new THREE.Scene();
    const mgr = new GroundFlameManager();
    mgr.spawn({ x: 0, y: 0, z: 0 }, 0, mockTex(), scene);
    expect(mgr.aliveCount()).toBe(1);
    mgr.clear(scene);
  });

  it('clears all flames on reset', () => {
    const scene = new THREE.Scene();
    const mgr = new GroundFlameManager();
    mgr.spawn({ x: 0, y: 0, z: 0 }, 0, mockTex(), scene);
    mgr.spawn({ x: 1, y: 0, z: 0 }, 0, mockTex(), scene);
    expect(mgr.aliveCount()).toBe(2);
    mgr.clear(scene);
    expect(mgr.aliveCount()).toBe(0);
  });

  it('update expires and removes old flames', () => {
    const scene = new THREE.Scene();
    const mgr = new GroundFlameManager();
    const cam = mockCamera();
    mgr.spawn({ x: 0, y: 0, z: 0 }, 0, mockTex(), scene);
    expect(mgr.aliveCount()).toBe(1);
    // Advance past lifetime
    mgr.update(BURN.groundFlameLifetimeSec + 0.5, cam);
    expect(mgr.aliveCount()).toBe(0);
  });
});
