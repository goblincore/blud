import { describe, it, expect } from 'vitest';
import * as THREE from 'three/webgpu';
import { applyEarlyzRenderOrder } from './earlyz-boot';
import { BACK_BATCH_BASE, FRONT_BATCH_BASE } from './type-order';

const fake = (nearestBack: number, nearestFront: number, front = true) => ({
  mesh: new THREE.Mesh(),
  frontMesh: front ? new THREE.Mesh() : null,
  earlyzBatches: () => ({ front: 1, back: 1, nearestBack, nearestFront }),
});

describe('applyEarlyzRenderOrder', () => {
  it('writes the ranks onto the back and front meshes', () => {
    const a = fake(Infinity, 5), b = fake(0.3, 2);
    applyEarlyzRenderOrder(new Map([['a', a], ['b', b]]) as never);
    expect(b.mesh.renderOrder).toBe(BACK_BATCH_BASE);
    expect(b.frontMesh!.renderOrder).toBe(FRONT_BATCH_BASE);
    expect(a.frontMesh!.renderOrder).toBe(FRONT_BATCH_BASE + 1);
  });
});
