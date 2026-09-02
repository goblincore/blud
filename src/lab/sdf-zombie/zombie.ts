// src/lab/sdf-zombie/zombie.ts
import * as THREE from 'three';
import type { BuildResult } from './build-body';
import { packBody, PRIM_STRIDE, type PackedBody } from './pack';
import { chunkPoint, squashFactors, type Chunk } from './gib-chunks';
import { FRAG, VERT } from './march.glsl';
import { FLESH_PRESETS, LIGHT_PRESETS, type FleshMaterial, type LightPreset } from './material';
import type { Primitive, Vec3 } from './types';
import { sub } from './vec';
import { chunkExtent, tornEndRadius } from './extent';
import { MAX_WOUNDS } from './damage';

export interface ZombieView {
  object: THREE.Object3D;
  material: THREE.ShaderMaterial;
  /** Re-upload after the body changes (sever, override edit, rig step). */
  update(body: BuildResult): void;
  /** Uploads wounds already transformed to world space by the caller.
   *  splay/offsetScales are the per-wound rim multipliers (WOUND_PROFILES);
   *  omitted, they default to 1 — chunk torn ends pass nothing and get 1s. */
  setWounds(worldPositions: Vec3[], radii: number[], types: number[], ages: number[],
    splayScales?: number[], offsetScales?: number[]): void;
  /** The skull's centre and semi-axes, which the face projection normalises by. */
  setHeadShape(centre: Vec3, axes: Vec3): void;
  /** Drives the eye-glow flicker. Seconds. */
  setTime(seconds: number): void;
  applyMaterial(m: FleshMaterial, light: LightPreset): void;
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
      uCarveCount: { value: packed.carveCount },
      uClusterCount: { value: packed.clusterCount },
      uMaxBlendK: { value: packed.maxBlendK },
      uSteps: { value: 96 },
      uStepMul: { value: 0.6 },
      uBaseColor: { value: new THREE.Color(0xc46a72) },
      uLightDir: { value: new THREE.Vector3(0.5, 1.0, 0.4) },
      uSpecIntensity: { value: 0.95 },
      uSpecRoughness: { value: 0.12 },
      uFresnelBoost: { value: 0.85 },
      uTranslucency: { value: 0.45 },
      uSurfaceNoiseAmp: { value: 0.06 },
      uSilhouetteNoiseAmp: { value: 0.016 },
      uWetness: { value: 1.0 },
      uKeyIntensity: { value: 2.4 },
      uFillIntensity: { value: 0.06 },
      uKeyColor: { value: new THREE.Color(1.0, 0.96, 0.92) },
      uWound: { value: new Float32Array(16 * 4) },
      uWoundMeta: { value: new Float32Array(16 * 4) },
      uWoundCount: { value: 0 },
      uWoundBlendK: { value: 0.015 },
      uRimSplay: { value: 0.55 },
      uRimOffset: { value: 1.15 },
      uRimWidth: { value: 0.42 },
      uDeepColor: { value: new THREE.Color(0x8c1420) },
      uCharColor: { value: new THREE.Color(0x1a1214) },
      uFaceTex: { value: null as THREE.Texture | null },
      uFaceEnabled: { value: 0 },
      uFaceStrength: { value: 0.85 },
      uFaceForward: { value: 1 },
      uFaceProj: { value: new THREE.Vector4(1.15, 1.15, 0.5, 0.52) },
      uFaceAtlas: { value: new THREE.Vector4(1, 1, 0, 0) },
      uHeadCentre: { value: new THREE.Vector3(0, 1.6, 0) },
      uHeadAxes: { value: new THREE.Vector3(0.12, 0.13, 0.12) },
      uFaceMean: { value: 0.5 },
      uFaceRelief: { value: 1.4 },
      uFaceProjMode: { value: 0 },
      // 0.88 rather than 0.72 — see the measurement note in
      // webgpu/zombie-gpu.ts. At 0.72 the mask covers most of the upper face,
      // which only passed unnoticed while the glow was additive.
      uFaceGlowThreshold: { value: 0.88 },
      uFaceGlowStrength: { value: 1.6 },
      // Bright red, and deliberately over 1.0 on the red channel: an emissive
      // that only reaches 1.0 cannot read as a LIGHT, and a value above it is
      // also what a bloom pass would key on if one is added later.
      uFaceGlowColor: { value: new THREE.Color(1.9, 0.18, 0.10) },
      uFaceGlowFlicker: { value: 0.45 },
      uTime: { value: 0 },
    },
  });

  const { center, size } = fitProxy(packed, body);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), material);
  mesh.position.copy(center);
  mesh.frustumCulled = false; // the proxy is the bound; don't double-cull

  // set after construction so the preset is the single source of truth

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
      u.uCarveCount!.value = p.carveCount;
      u.uClusterCount!.value = p.clusterCount;
      u.uMaxBlendK!.value = p.maxBlendK;
      const fit = fitProxy(p, next);
      mesh.position.copy(fit.center);
      mesh.scale.setScalar(fit.size / size);
    },
    setWounds(worldPositions, radii, types, ages, splayScales, offsetScales) {
      const w = material.uniforms.uWound!.value as Float32Array;
      const m = material.uniforms.uWoundMeta!.value as Float32Array;
      const n = Math.min(worldPositions.length, 16);
      for (let i = 0; i < n; i++) {
        w.set([...worldPositions[i]!, radii[i]!], i * 4);
        // meta = (type, age, rimSplayScale, rimOffsetScale); scales default
        // to 1 so omitted callers keep the global woundCfg rim settings.
        m.set([types[i]!, ages[i]!, splayScales?.[i] ?? 1, offsetScales?.[i] ?? 1], i * 4);
      }
      material.uniforms.uWoundCount!.value = n;
    },
    setTime(t) { material.uniforms.uTime!.value = t; },
    setHeadShape(centre, axes) {
      (material.uniforms.uHeadCentre!.value as THREE.Vector3).set(...centre);
      (material.uniforms.uHeadAxes!.value as THREE.Vector3).set(...axes);
    },
    applyMaterial(m, light) {
      const u = material.uniforms;
      (u.uBaseColor!.value as THREE.Color).setRGB(...m.baseColor);
      (u.uDeepColor!.value as THREE.Color).setRGB(...m.deepColor);
      (u.uCharColor!.value as THREE.Color).setRGB(...m.charColor);
      u.uSpecIntensity!.value = m.specIntensity;
      u.uSpecRoughness!.value = m.specRoughness;
      u.uFresnelBoost!.value = m.fresnelBoost;
      u.uTranslucency!.value = m.translucency;
      u.uSurfaceNoiseAmp!.value = m.surfaceNoiseAmp;
      u.uSilhouetteNoiseAmp!.value = m.silhouetteNoiseAmp;
      u.uWetness!.value = m.wetness;
      (u.uLightDir!.value as THREE.Vector3).set(...light.keyDir);
      (u.uKeyColor!.value as THREE.Color).setRGB(...light.keyColor);
      u.uKeyIntensity!.value = light.keyIntensity;
      u.uFillIntensity!.value = light.fillIntensity;
    },
  };
}

export interface ChunkView {
  object: THREE.Object3D;
  update(chunk: Chunk): void;
  dispose(): void;
}

// Moved to extent.ts so the WebGPU path can share it without importing this
// module — which imports `three` and would pull a second copy of the library
// into the WebGPU bundle. Re-exported for the existing importers.
export { chunkExtent } from './extent';

/**
 * A detached blob, raymarched in its own small proxy box. Reuses the body
 * material's shader by packing the chunk's primitives as a one-cluster body.
 *
 * NOTE (task-18 deviation from the plan snippet, geometry-corrected): the
 * fragment shader marches in WORLD space — `ro = cameraPosition` and the
 * packed prims ARE the field. The mesh transform only moves the proxy box
 * (`tMax`), so setting mesh.position/rotation/scale alone (as the plan wrote)
 * would fly the box off while the limb geometry stayed frozen in body space,
 * and squash/tumble would never affect the blob. Instead the chunk is packed
 * centred in its own local space and its endpoints are re-packed in world
 * space every update(). Signature and ChunkView shape match the plan exactly.
 */
export function createChunkView(
  chunk: Chunk,
  prims: Primitive[],
  template: THREE.ShaderMaterial,
  /** World positions where this limb was attached — become torn ends. */
  tornAt?: Vec3[],
): ChunkView {
  const material = template.clone();
  // Material.clone() shares uniform VALUE references, so a chunk writing its
  // own wound array would scribble on the body's. Give it fresh buffers.
  material.uniforms.uWound = { value: new Float32Array(MAX_WOUNDS * 4) };
  material.uniforms.uWoundMeta = { value: new Float32Array(MAX_WOUNDS * 4) };

  // chunk.pos is the cluster centre at sever time, so this recentres the
  // severed limb's rest-space primitives around the chunk's own origin.
  const local = prims.map(p => ({
    ...p,
    cluster: 0,
    a: sub(p.a, chunk.pos),
    b: sub(p.b, chunk.pos),
  }));

  // The plan packed bounds/box from chunk.radius (0.14) — smaller than a real
  // limb (~0.3-0.45), which the shader's cluster-bounds cull would erase. Use
  // the true extent instead (same recipe as clusters.ts).
  const extent = chunkExtent(prims, chunk.pos);
  const tornLocals: Vec3[] = (tornAt ?? []).map(t => sub(t, chunk.pos));
  // Girth at the tear, NOT extent: extent is length-dominated, and a wound
  // radius that scales with length swallows the capsule silhouette (X1.16).
  const tornRadii = tornLocals.map(t => tornEndRadius(local, t));

  const packed = packBody({
    prims: local,
    clusters: [{
      id: 0, limb: chunk.limb, start: 0, count: local.length,
      center: [0, 0, 0], radius: extent, alive: true,
    }],
    bones: new Map(), bonePrims: [],
  });

  material.uniforms.uPrimA = { value: packed.primA };
  material.uniforms.uPrimB = { value: packed.primB };
  material.uniforms.uPrimScale = { value: packed.primScale };
  material.uniforms.uClusterBounds = { value: packed.clusterBounds };
  material.uniforms.uClusterRange = { value: packed.clusterRange };
  material.uniforms.uPrimCount = { value: packed.primCount };
  // A severed head keeps its face: the cluster slice carries its carves, and
  // apply() below rewrites only xyz per endpoint, leaving the packed sign in .w.
  material.uniforms.uCarveCount = { value: packed.carveCount };
  material.uniforms.uClusterCount = { value: 1 };
  material.uniforms.uMaxBlendK = { value: packed.maxBlendK };
  material.uniforms.uWoundCount = { value: 0 }; // set by apply() when torn
  material.uniforms.uSteps = { value: 48 }; // chunks are small; fewer steps
  // Only a severed HEAD carries the face. Without this the clone would project
  // a face onto a flying arm, since every chunk's own cluster 0 is itself.
  material.uniforms.uFaceEnabled = { value: chunk.limb === 'head' ? 1 : 0 };
  // A severed head keeps its face: give the clone its own head sphere, centred
  // on the chunk, since the template's points at the body's original skull.
  material.uniforms.uHeadCentre = {
    value: new THREE.Vector3(chunk.pos[0], chunk.pos[1], chunk.pos[2]),
  };
  material.uniforms.uHeadAxes = { value: new THREE.Vector3(extent, extent, extent) };

  const size = extent * 2 * 1.4 + packed.maxBlendK * 4 + 0.05;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), material);
  mesh.frustumCulled = false;

  /** Writes the local prims into the world-space uniform arrays for state `c`. */
  function apply(c: Chunk): { sx: number; sy: number; sz: number } {
    const { sx, sy, sz } = squashFactors(c);
    local.forEach((p, i) => {
      const o = i * PRIM_STRIDE;
      packed.primA.set(chunkPoint(c, p.a, sx, sy, sz), o);
      packed.primB.set(chunkPoint(c, p.b, sx, sy, sz), o);
      // Squash multiplies the world-axis ellipsoid scale. Approximation: the
      // authored per-axis scale does not rotate with the chunk (the yaw-only
      // version had the same limitation) — limb prims are near-uniform so this
      // never shows.
      packed.primScale.set([p.scale[0] * sx, p.scale[1] * sy, p.scale[2] * sz,
        p.op === 'sub' ? 1 : 0], o);
    });
    packed.clusterBounds.set([c.pos[0], c.pos[1], c.pos[2], extent * Math.max(sx, sy, sz)], 0);

    if (tornLocals.length > 0) {
      // Torn ends ride the same rotate-then-squash transform as the prims, so
      // they stay welded to the stumps as the piece tumbles.
      const ats = tornLocals.map(t => chunkPoint(c, t, sx, sy, sz));
      const w = material.uniforms.uWound!.value as Float32Array;
      const m = material.uniforms.uWoundMeta!.value as Float32Array;
      ats.forEach((at, i) => {
        w.set([at[0], at[1], at[2], tornRadii[i] ?? 0], i * 4);
        m.set([1, 0, 1, 1], i * 4); // type 1 = blast, so it reads as torn, not burned; scales 1 = global rim settings
      });
      material.uniforms.uWoundCount!.value = tornLocals.length;
    } else {
      material.uniforms.uWoundCount!.value = 0;
    }
    return { sx, sy, sz };
  }

  const first = apply(chunk);
  mesh.position.set(chunk.pos[0], chunk.pos[1], chunk.pos[2]);
  // No mesh rotation: the proxy box stays axis-aligned — its size
  // (extent * 2 * 1.4 + ...) already covers every orientation of the rotated
  // field, and rotating the box while squash acts in world axes would
  // under-cover.
  mesh.scale.set(first.sx, first.sy, first.sz);

  return {
    object: mesh,
    update(c: Chunk) {
      const { sx, sy, sz } = apply(c);
      mesh.position.set(c.pos[0], c.pos[1], c.pos[2]);
      mesh.scale.set(sx, sy, sz);
    },
    dispose() {
      mesh.geometry.dispose();
      material.dispose();
    },
  };
}
