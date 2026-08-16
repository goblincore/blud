// src/lab/sdf-zombie/webgpu/scene-gpu.ts
//
// The merged march: ONE data texture, ONE proxy box, ONE draw for every body.
//
// The per-body path in zombie-gpu.ts gives each body its own proxy box and its
// own draw, so a pixel covered by N bodies is marched N times. Measured, ten
// bodies stacked into roughly one body's silhouette cost 6.2x a single body —
// so the hidden ones were paying almost in full. This path marches each pixel
// once regardless of how many bodies cover it.
//
// SPIKE SCOPE. No face, no wounds, no char, no AO, no cone pre-pass. All of
// those are PER-BODY state, and threading them through a merged pass means
// moving them into the data texture and looking them up by whichever body was
// actually hit — real work, and not worth doing before the perf number says
// the architecture is worth having.
//
// So the A/B must switch the same features off on the per-body side, and must
// run with the CONE OFF on both, or it measures the feature gap rather than
// the architecture. See the lab's `mergedCompare` helper.

import * as THREE from 'three/webgpu';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
  wgslFn, positionWorld, cameraPosition, vec4, uniform, texture, float,
  cameraProjectionMatrix, cameraViewMatrix, normalize, sub, mul, add,
} from 'three/tsl';
import {
  MARCH_SCENE, SCENE_HELPERS, SCENE_DATA_ROWS, SCENE_MAX_BODIES,
  ROW_PRIM_A, ROW_PRIM_B, ROW_PRIM_SCALE,
  ROW_CLUSTER_BOUNDS, ROW_CLUSTER_RANGE, ROW_BODY_SPHERE, ROW_BODY_RANGE,
} from './march.wgsl';
import { mergeBodies, type MergedScene } from '../merge-bodies';
import { MAX_PRIMS } from '../validate';
import type { BuiltBody } from '../types';
import type { FleshMaterial, LightPreset } from '../material';

/** Widest the merged texture ever needs to be: every body at full primitives. */
const SCENE_TEX_WIDTH = MAX_PRIMS * SCENE_MAX_BODIES;

/** Same include-chaining the per-body path uses — see buildMarchFn there. */
const marchScene = (() => {
  const nodes = SCENE_HELPERS.reduce<ReturnType<typeof wgslFn>[]>(
    (acc, src) => [...acc, wgslFn(src, acc.slice())], [],
  );
  return wgslFn(MARCH_SCENE, nodes);
})();

export function createSceneUniforms() {
  return {
    /** x = primCount, z = carveCount, w = maxBlendK (the cull margin). */
    counts: uniform(new THREE.Vector4(0, 0, 0, 0)),
    /** x = bodyCount. */
    sceneCfg: uniform(new THREE.Vector4(0, 0, 0, 0)),
    /** x = steps, y = stepMul, z = silhouetteNoiseAmp. */
    marchCfg: uniform(new THREE.Vector3(96, 0.6, 0.016)),
    /** y = over-relaxation factor; <= 1 disables the relaxed tracer. */
    relaxCfg: uniform(new THREE.Vector4(0.42, 1.6, 0, 0)),
    baseColor: uniform(new THREE.Color(1, 1, 1)),
    deepColor: uniform(new THREE.Color(1, 0, 0)),
    lightDir: uniform(new THREE.Vector3(0.4, 0.8, 0.45)),
    keyColor: uniform(new THREE.Color(1, 1, 1)),
    lightCfg: uniform(new THREE.Vector2(1, 0.25)),
    surfCfg: uniform(new THREE.Vector4(0.95, 0.12, 0.85, 0.45)),
    surfCfg2: uniform(new THREE.Vector2(1, 0.06)),
  };
}
export type SceneUniforms = ReturnType<typeof createSceneUniforms>;

export interface SceneGpuView {
  object: THREE.Mesh;
  uniforms: SceneUniforms;
  /** Re-packs and re-uploads every body. Call whenever any body moved. */
  update(bodies: BuiltBody[]): void;
  applyMaterial(m: FleshMaterial, light: LightPreset): void;
  /** Bodies actually folded in — bodies past the cap are dropped. */
  readonly bodyCount: number;
  dispose(): void;
}

export function createSceneGpuView(bodies: BuiltBody[]): SceneGpuView {
  // Nearest, no mips: these are DATA. Any interpolation would blend one
  // primitive's endpoint into its neighbour's.
  const texels = new Float32Array(SCENE_TEX_WIDTH * SCENE_DATA_ROWS * 4);
  const dataTex = new THREE.DataTexture(
    texels, SCENE_TEX_WIDTH, SCENE_DATA_ROWS, THREE.RGBAFormat, THREE.FloatType,
  );
  dataTex.magFilter = THREE.NearestFilter;
  dataTex.minFilter = THREE.NearestFilter;
  dataTex.generateMipmaps = false;
  dataTex.needsUpdate = true;

  const u = createSceneUniforms();
  let merged: MergedScene = { prims: [], clusters: [], bodies: [], carveCount: 0, maxBlendK: 0 };

  const marched = marchScene({
    worldPos: positionWorld,
    camPos: cameraPosition,
    data: texture(dataTex),
    counts: u.counts,
    sceneCfg: u.sceneCfg,
    marchCfg: u.marchCfg,
    relaxCfg: u.relaxCfg,
    baseColor: u.baseColor,
    deepColor: u.deepColor,
    lightDir: u.lightDir,
    keyColor: u.keyColor,
    lightCfg: u.lightCfg,
    surfCfg: u.surfCfg,
    surfCfg2: u.surfCfg2,
    // No cone pre-pass in the spike, so every ray starts at the camera.
    startT: float(0),
  }) as unknown as { xyz: unknown; w: unknown };

  const material = new MeshBasicNodeMaterial();
  // BackSide, like the per-body path: the camera may be INSIDE the proxy box,
  // and front faces would be culled the moment it is.
  material.side = THREE.BackSide;

  const rayDir = normalize(sub(positionWorld, cameraPosition));
  const hitPos = add(cameraPosition, mul(rayDir, marched.w as never));
  const clip = mul(cameraProjectionMatrix, mul(cameraViewMatrix, vec4(hitPos, 1.0)));
  const depth = clip.z.div(clip.w);

  material.colorNode = vec4(marched.xyz as never, 1.0);
  material.depthNode = depth;
  material.depthWrite = true;
  // Depth in alpha, so the half-resolution SDF layer's composite can read it
  // back out of the colour it already samples. Must be outputNode: three
  // forces DiffuseColor.w to 1.0 for an opaque material, so alpha written
  // through colorNode never reaches the target.
  material.outputNode = vec4(marched.xyz as never, depth);

  // One box over every body. Geometry is rebuilt on update because the union
  // moves and grows as bodies do — cheap next to what it saves.
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
  mesh.frustumCulled = false; // the proxy IS the bound

  function writeRow(row: number, at: number, v: readonly number[]) {
    const o = (row * SCENE_TEX_WIDTH + at) * 4;
    texels[o] = v[0]!; texels[o + 1] = v[1]!; texels[o + 2] = v[2]!; texels[o + 3] = v[3]!;
  }

  function update(next: BuiltBody[]) {
    merged = mergeBodies(next);

    merged.prims.forEach((p, i) => {
      writeRow(ROW_PRIM_A, i, [p.a[0], p.a[1], p.a[2], p.radius]);
      writeRow(ROW_PRIM_B, i, [p.b[0], p.b[1], p.b[2], p.blendK]);
      // The carve flag rides primScale.w — never the sign of blendK, since
      // -0 is indistinguishable from 0 in a Float32Array and blendK 0 is the
      // useful case. Same convention as pack.ts.
      writeRow(ROW_PRIM_SCALE, i, [p.scale[0], p.scale[1], p.scale[2], p.op === 'sub' ? 1 : 0]);
    });
    merged.clusters.forEach((c, i) => {
      writeRow(ROW_CLUSTER_BOUNDS, i, [c.center[0], c.center[1], c.center[2], c.radius]);
      writeRow(ROW_CLUSTER_RANGE, i, [c.start, c.count, c.alive ? 1 : 0, 0]);
    });
    merged.bodies.forEach((b, i) => {
      writeRow(ROW_BODY_SPHERE, i, [b.centre[0], b.centre[1], b.centre[2], b.radius]);
      writeRow(ROW_BODY_RANGE, i, [b.clusterStart, b.clusterCount, 1, b.maxBlendK]);
    });

    dataTex.needsUpdate = true;
    u.counts.value.set(merged.prims.length, 0, merged.carveCount, merged.maxBlendK);
    u.sceneCfg.value.set(merged.bodies.length, 0, 0, 0);

    fitProxy();
  }

  /**
   * Union of the body spheres, which are already blend-padded — so the box is
   * conservative by construction and no ray can start past the surface.
   */
  function fitProxy() {
    if (merged.bodies.length === 0) {
      mesh.visible = false;
      return;
    }
    mesh.visible = true;
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const b of merged.bodies) {
      for (let i = 0; i < 3; i++) {
        min[i] = Math.min(min[i]!, b.centre[i]! - b.radius);
        max[i] = Math.max(max[i]!, b.centre[i]! + b.radius);
      }
    }
    mesh.geometry.dispose();
    mesh.geometry = new THREE.BoxGeometry(
      max[0]! - min[0]!, max[1]! - min[1]!, max[2]! - min[2]!,
    );
    mesh.position.set(
      (min[0]! + max[0]!) / 2, (min[1]! + max[1]!) / 2, (min[2]! + max[2]!) / 2,
    );
  }

  function applyMaterial(m: FleshMaterial, light: LightPreset) {
    u.baseColor.value.setRGB(...m.baseColor);
    u.deepColor.value.setRGB(...m.deepColor);
    u.surfCfg.value.set(m.specIntensity, m.specRoughness, m.fresnelBoost, m.translucency);
    u.surfCfg2.value.set(m.wetness, m.surfaceNoiseAmp);
    u.marchCfg.value.z = m.silhouetteNoiseAmp;
    u.lightDir.value.set(...light.keyDir);
    u.keyColor.value.setRGB(...light.keyColor);
    u.lightCfg.value.set(light.keyIntensity, light.fillIntensity);
  }

  update(bodies);

  return {
    object: mesh,
    uniforms: u,
    update,
    applyMaterial,
    get bodyCount() { return merged.bodies.length; },
    dispose() {
      mesh.geometry.dispose();
      material.dispose();
      dataTex.dispose();
    },
  };
}
