// src/lab/sdf-zombie/webgpu/probe-gather-compute.ts
//
// THE GPU PROBE GATHER (lighting P3/P4 dynamic layer; spec
// docs/superpowers/specs/2026-09-09-gpu-probe-gather-design.md). One compute
// dispatch per frame, one thread per probe, writing the DYNAMIC probe layer
// (muzzle-flash radiance + body visibility) into a storage buffer the march
// reads next to the static grid. Modelled on tile-bin-compute.ts: storage
// attributes at worst-case sizes, kernels as wgslFn strings, fixed dispatch
// with the active count in a uniform, a read-only node for the march.
//
// The maths lives twice — probe-dynamic.ts is the tested CPU twin — and the
// kernel is pinned by probe-dynamic.wgsl.test.ts. Nothing here is verifiable
// without a GPU; readback() exists for the browser-driven checks.
import * as THREE from 'three/webgpu';
import { wgslFn, uniform, storage, instanceIndex, compute } from 'three/tsl';
import { withPassLabel } from './gpu-pass-timing';
import { K_PROBE_GATHER } from './probe-dynamic.wgsl';
import { DYN_VEC4_PER_PROBE, packBoxes, packCapsulesFromBoneInstances, packLights } from '../probe-dynamic';
import type { Box, Vec3 } from '../ambient';
import type { ProbeGrid } from '../probe-grid';

export interface ProbeGatherCaps {
  maxProbes: number;
  maxBoxes: number;
  maxCapsules: number;
  maxLights: number;
}

export interface ProbeGatherFrame {
  grid: ProbeGrid;
  enclosure: Box;
  wallAlbedo: Vec3;
  occluders: { box: Box; albedo: Vec3 }[];
  /** The bone instancer's packed array + count (INSTANCE_FLOATS per row). */
  instances: Float32Array;
  instanceCount: number;
  /** Flesh margin added to every capsule radius, m. */
  capsuleMargin: number;
  lights: { pos: Vec3; color: Vec3; intensity: number }[];
  /** 0..1, rotates the ray set so the estimate does not strobe. */
  frameSeed: number;
  /** 0..1, weight of the NEW estimate against last frame's. */
  blend: number;
  raysPerProbe: number;
}

export interface ProbeGatherBinding {
  /** Pack this frame's scene and dispatch the gather (one compute pass). */
  update(frame: ProbeGatherFrame): void;
  /** Read-only storage node of the dynamic layer, for the march material. */
  readonly probeDynNode: unknown;
  /** The whole dynamic buffer, for tests and debug tooling. */
  readback(): Promise<Float32Array>;
  readonly caps: ProbeGatherCaps;
  dispose(): void;
}

export function createProbeGatherBinding(renderer: THREE.WebGPURenderer, caps: ProbeGatherCaps): ProbeGatherBinding {
  const boxesN = 1 + caps.maxBoxes * 3;
  const capsN = 1 + caps.maxCapsules * 2;
  const lightsN = 1 + caps.maxLights * 2;
  const dynN = caps.maxProbes * DYN_VEC4_PER_PROBE;
  const boxesAttr = new THREE.StorageBufferAttribute(boxesN, 4);
  const capsAttr = new THREE.StorageBufferAttribute(capsN, 4);
  const lightsAttr = new THREE.StorageBufferAttribute(lightsN, 4);
  const dynAttr = new THREE.StorageBufferAttribute(dynN, 4);

  const boxesBuf = storage(boxesAttr, 'vec4', boxesN).toReadOnly();
  const capsBuf = storage(capsAttr, 'vec4', capsN).toReadOnly();
  const lightsBuf = storage(lightsAttr, 'vec4', lightsN).toReadOnly();
  const dynRw = storage(dynAttr, 'vec4', dynN);
  const probeDynNode = storage(dynAttr, 'vec4', dynN).toReadOnly();

  const uCfg = uniform(new THREE.Vector4());
  const uGridMin = uniform(new THREE.Vector4());
  const uGridInv = uniform(new THREE.Vector4());
  const uGridDims = uniform(new THREE.Vector4(1, 1, 1, 0));

  const call = wgslFn(K_PROBE_GATHER)(
    boxesBuf, capsBuf, lightsBuf, dynRw, uCfg, uGridMin, uGridInv, uGridDims, instanceIndex,
  );
  const node = compute(call, caps.maxProbes, [64]);
  let disposed = false;

  return {
    caps,
    probeDynNode,
    update(f) {
      if (disposed) throw new Error('probe gather binding disposed');
      const probes = f.grid.dims[0] * f.grid.dims[1] * f.grid.dims[2];
      if (probes > caps.maxProbes) {
        throw new Error(`[probe-gather] ${probes} probes exceed the allocation ${caps.maxProbes}`);
      }
      const boxes = boxesAttr.array as Float32Array;
      packBoxes(f.enclosure, f.wallAlbedo, f.occluders.slice(0, caps.maxBoxes - 1), boxes);
      boxesAttr.needsUpdate = true;
      const capsArr = capsAttr.array as Float32Array;
      packCapsulesFromBoneInstances(f.instances, f.instanceCount, f.capsuleMargin, capsArr, caps.maxCapsules);
      capsAttr.needsUpdate = true;
      const lightsArr = lightsAttr.array as Float32Array;
      packLights(f.lights.slice(0, caps.maxLights), lightsArr);
      lightsAttr.needsUpdate = true;

      (uCfg.value as THREE.Vector4).set(probes, Math.min(64, f.raysPerProbe), f.frameSeed, f.blend);
      (uGridMin.value as THREE.Vector4).set(f.grid.min[0], f.grid.min[1], f.grid.min[2], 0);
      (uGridInv.value as THREE.Vector4).set(
        1 / Math.max(1e-6, f.grid.max[0] - f.grid.min[0]),
        1 / Math.max(1e-6, f.grid.max[1] - f.grid.min[1]),
        1 / Math.max(1e-6, f.grid.max[2] - f.grid.min[2]), 0,
      );
      (uGridDims.value as THREE.Vector4).set(f.grid.dims[0], f.grid.dims[1], f.grid.dims[2], 0);
      withPassLabel('compute:probe-gather', () => renderer.compute(node));
    },
    async readback() {
      if (disposed) throw new Error('probe gather binding disposed');
      return new Float32Array(await renderer.getArrayBufferAsync(dynAttr));
    },
    dispose() {
      disposed = true;
    },
  };
}
