// src/lab/sdf-zombie/zombie.ts
import * as THREE from 'three';
import type { BuildResult } from './build-body';
import { packBody, type PackedBody } from './pack';
import { FRAG, VERT } from './march.glsl';
import { len, sub } from './vec';

export interface ZombieView {
  object: THREE.Object3D;
  material: THREE.ShaderMaterial;
  /** Re-upload after the body changes (sever, override edit, rig step). */
  update(body: BuildResult): void;
}

/** Proxy box big enough to contain every live cluster, with blend margin. */
function fitProxy(packed: PackedBody, body: BuildResult): { center: THREE.Vector3; size: number } {
  let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const c of body.clusters) {
    if (!c.alive) continue;
    for (let i = 0; i < 3; i++) {
      const ci = c.center[i]!;
      min[i] = Math.min(min[i]!, ci - c.radius);
      max[i] = Math.max(max[i]!, ci + c.radius);
    }
  }
  const pad = packed.maxBlendK * 4 + 0.05;
  const center = new THREE.Vector3(...min.map((v, i) => (v + max[i]!) / 2));
  const size = Math.max(...max.map((v, i) => v - min[i]!)) + pad * 2;
  return { center, size };
}

export function createZombieView(body: BuildResult): ZombieView {
  const packed = packBody(body);

  const material = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    // NOTE (verified against the installed three r170): do NOT add
    // `extensions: { fragDepth: true }`. That was a WebGL1-era flag; r170's
    // ShaderMaterial `extensions` type accepts only clipCullDistance/multiDraw,
    // and WebGLPrograms reads only those two. gl_FragDepth is CORE in GLSL ES
    // 3.00, so `glslVersion: THREE.GLSL3` is sufficient. Adding the flag is a
    // tsc error and a runtime no-op. Task 2 already hit and fixed this.
    side: THREE.BackSide,
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uPrimA: { value: packed.primA },
      uPrimB: { value: packed.primB },
      uPrimScale: { value: packed.primScale },
      uClusterBounds: { value: packed.clusterBounds },
      uClusterRange: { value: packed.clusterRange },
      uPrimCount: { value: packed.primCount },
      uClusterCount: { value: packed.clusterCount },
      uMaxBlendK: { value: packed.maxBlendK },
      uSteps: { value: 96 },
      uStepMul: { value: 0.6 },
      uBaseColor: { value: new THREE.Color(0xc46a72) },
      uLightDir: { value: new THREE.Vector3(0.5, 1.0, 0.4) },
    },
  });

  const { center, size } = fitProxy(packed, body);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), material);
  mesh.position.copy(center);
  mesh.frustumCulled = false; // the proxy is the bound; don't double-cull

  return {
    object: mesh,
    material,
    update(next: BuildResult) {
      const p = packBody(next);
      const u = material.uniforms;
      (u.uPrimA!.value as Float32Array).set(p.primA);
      (u.uPrimB!.value as Float32Array).set(p.primB);
      (u.uPrimScale!.value as Float32Array).set(p.primScale);
      (u.uClusterBounds!.value as Float32Array).set(p.clusterBounds);
      (u.uClusterRange!.value as Float32Array).set(p.clusterRange);
      u.uPrimCount!.value = p.primCount;
      u.uClusterCount!.value = p.clusterCount;
      u.uMaxBlendK!.value = p.maxBlendK;
      const fit = fitProxy(p, next);
      mesh.position.copy(fit.center);
      mesh.scale.setScalar(fit.size / size);
    },
  };
}
