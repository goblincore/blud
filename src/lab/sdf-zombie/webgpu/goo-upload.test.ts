import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import { createGooLayer, GOO_TUNING } from './goo-layer';
import type { BloodSim, Droplet } from '../blood-sim';

// Exercise the actual sync and render paths. Only GPU submission is stubbed;
// matrices, attributes, partitioning and dirty ranges are real Three objects.
function fixture(optimized: boolean) {
  let mesh: THREE.InstancedMesh | undefined;
  const renderer = {
    domElement: { width: 800, height: 600 }, autoClear: true,
    setRenderTarget() {}, setClearColor() {}, getClearAlpha: () => 1,
    getClearColor: (out: THREE.Color) => out.set(0),
    render(scene: THREE.Scene) {
      const candidate = scene.children.find(o => o instanceof THREE.InstancedMesh);
      if (candidate) mesh = candidate as THREE.InstancedMesh;
    },
  } as unknown as THREE.WebGPURenderer;
  const layer = createGooLayer(renderer, {
    lightDir: uniform(new THREE.Vector3(0, 1, 0)),
    keyColor: uniform(new THREE.Vector3(1, 1, 1)),
    lightCfg: uniform(new THREE.Vector4(1, 1, 1, 1)),
  });
  layer.setUploadOptimization(optimized);
  const camera = new THREE.PerspectiveCamera(65, 4/3, .1, 200);
  camera.position.set(1, 1.6, 2);
  camera.lookAt(0, 1, -3);
  camera.updateMatrixWorld();
  layer.render(camera, () => {});
  return { layer, camera, mesh: mesh! };
}

function sim(count: number): BloodSim {
  return {
    droplets: Array.from({ length: count }, (_, i): Droplet => ({
      pos: [i * .03, 1 + i * .01, -3], vel: [i * .1, 2, -1],
      size: .2, age: .1, life: 2, kind: i % 3 ? 'drop' : 'gut',
    } as Droplet)),
    splats: [],
  } as unknown as BloodSim;
}

function active(mesh: THREE.InstancedMesh) {
  return {
    count: mesh.count,
    matrix: Array.from(mesh.instanceMatrix.array.slice(0, mesh.count * 16)),
    gut: Array.from(mesh.geometry.getAttribute('gutMask').array.slice(0, mesh.count)),
    fall: Array.from(mesh.geometry.getAttribute('fallMask').array.slice(0, mesh.count)),
  };
}

describe('goo live-prefix uploads', () => {
  it('preserves all drawn bytes through shrinking, empty, growing and partition changes', () => {
    const old = fixture(false), candidate = fixture(true);
    for (const area of [false, true]) {
      for (const count of [GOO_TUNING.maxParticles, 7, 0, 23, 1, 0, 1000]) {
        for (const kind of [null, 'gut', 'drop'] as const) {
          const input = sim(count);
          for (const f of [old, candidate]) {
            f.layer.setAreaPriority(area);
            f.layer.setSelection(kind ? { droplet: d => d.kind === kind, splats:false, extras:false } : null);
            f.layer.sync(input, f.camera);
          }
          expect(active(candidate.mesh)).toEqual(active(old.mesh));
          const n = candidate.mesh.count;
          if (n) {
            expect(candidate.mesh.instanceMatrix.updateRanges).toEqual([{start:0,count:n*16}]);
            expect((candidate.mesh.geometry.getAttribute('gutMask') as THREE.InstancedBufferAttribute).updateRanges).toEqual([{start:0,count:n}]);
            expect((candidate.mesh.geometry.getAttribute('fallMask') as THREE.InstancedBufferAttribute).updateRanges).toEqual([{start:0,count:n}]);
          }
        }
      }
    }
    old.layer.dispose(); candidate.layer.dispose();
  });

  it('does not dirty empty frames and safely replaces an unconsumed range', () => {
    const f = fixture(true);
    f.layer.sync(sim(100), f.camera);
    const version = f.mesh.instanceMatrix.version;
    f.layer.sync(sim(0), f.camera);
    expect(f.mesh.count).toBe(0);
    expect(f.mesh.instanceMatrix.version).toBe(version);
    f.layer.sync(sim(3), f.camera);
    expect(f.mesh.instanceMatrix.updateRanges).toEqual([{start:0,count:48}]);
    expect(f.mesh.instanceMatrix.version).toBe(version+1);
    f.layer.dispose();
  });
});
