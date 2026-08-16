// src/lab/sdf-zombie/webgpu/zombie-gpu.ts
//
// The WebGPU view of the body: packs primitives into a float data texture and
// drives the WGSL march.
//
// The pure modules (build-body, pack, clusters, validate, face) are shared
// with the WebGL path UNCHANGED. That is the point of the migration being
// lab-scoped — only the rendering tail differs, so a bug in the field maths
// cannot diverge between the two paths.

import * as THREE from 'three/webgpu';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
  wgslFn, positionWorld, cameraPosition, vec4, uniform, texture,
  cameraProjectionMatrix, cameraViewMatrix, normalize, sub, mul, add,
} from 'three/tsl';
import type { BuildResult } from '../build-body';
import { packBody } from '../pack';
import { MAX_PRIMS } from '../validate';
import type { FleshMaterial, LightPreset } from '../material';
import {
  HELPERS, MARCH_BODY, DATA_ROWS,
  ROW_PRIM_A, ROW_PRIM_B, ROW_PRIM_SCALE, ROW_CLUSTER_BOUNDS, ROW_CLUSTER_RANGE,
} from './march.wgsl';

/**
 * Returns a copy of `body` with every primitive endpoint and cluster centre
 * shifted by `offset`.
 *
 * This is how you MOVE a raymarched body. The shader marches in WORLD space and
 * the packed primitives ARE the field, so setting mesh.position only moves the
 * proxy BOX — the flesh stays at the origin and the displaced box then clips it.
 * The WebGL path's createChunkView carries the same warning; it is an easy and
 * very confusing mistake, presenting as a body with slices missing.
 */
export function translateBody(body: BuildResult, offset: [number, number, number]): BuildResult {
  const sh = (v: readonly [number, number, number]): [number, number, number] =>
    [v[0] + offset[0], v[1] + offset[1], v[2] + offset[2]];
  return {
    ...body,
    prims: body.prims.map(p => ({ ...p, a: sh(p.a), b: sh(p.b) })),
    clusters: body.clusters.map(c => ({ ...c, center: sh(c.center) })),
  };
}

export interface ZombieGpuView {
  object: THREE.Object3D;
  update(body: BuildResult): void;
  applyMaterial(m: FleshMaterial, light: LightPreset): void;
}

/**
 * Builds the entry function with its helpers as `includes`.
 *
 * Not string concatenation: three's declarationRegexp is ^-anchored, so a
 * source that does not START with `fn` fails to parse, and WGSL requires
 * declaration before use so helpers cannot follow the entry point either.
 * `includes` is the mechanism three provides for precisely this, and it emits
 * them in the order given — hence HELPERS being dependency-ordered.
 *
 * Each helper is itself a node, built by folding so that every one carries the
 * helpers declared before it.
 */
const helperNodes = HELPERS.reduce<ReturnType<typeof wgslFn>[]>(
  (acc, src) => [...acc, wgslFn(src, acc.slice())], [],
);
const marchBody = wgslFn(MARCH_BODY, helperNodes);

export function createZombieGpuView(body: BuildResult): ZombieGpuView {
  // RGBA32F, MAX_PRIMS wide by DATA_ROWS tall. Nearest filtering and no mips:
  // these are DATA, and any interpolation between texels would silently blend
  // one primitive's endpoint into its neighbour's.
  const texels = new Float32Array(MAX_PRIMS * DATA_ROWS * 4);
  const dataTex = new THREE.DataTexture(
    texels, MAX_PRIMS, DATA_ROWS, THREE.RGBAFormat, THREE.FloatType,
  );
  dataTex.magFilter = THREE.NearestFilter;
  dataTex.minFilter = THREE.NearestFilter;
  dataTex.generateMipmaps = false;
  dataTex.needsUpdate = true;

  const uCounts = uniform(new THREE.Vector4(0, 0, 0, 0));
  const uMarchCfg = uniform(new THREE.Vector3(96, 0.6, 0.016));
  const uBaseColor = uniform(new THREE.Color(0xc46a72));
  const uDeepColor = uniform(new THREE.Color(0x8c1420));
  const uLightDir = uniform(new THREE.Vector3(0.45, 0.72, 0.53));
  const uKeyColor = uniform(new THREE.Color(1, 0.96, 0.92));
  const uLightCfg = uniform(new THREE.Vector2(2.4, 0.06));
  const uSurfCfg = uniform(new THREE.Vector4(0.95, 0.12, 0.85, 0.45));
  const uSurfCfg2 = uniform(new THREE.Vector2(1.0, 0.06));

  /** Writes one row of the data texture from a packed Float32Array. */
  function writeRow(row: number, src: Float32Array, count: number) {
    const base = row * MAX_PRIMS * 4;
    for (let i = 0; i < count * 4; i++) texels[base + i] = src[i]!;
  }

  function upload(next: BuildResult) {
    const p = packBody(next);
    writeRow(ROW_PRIM_A, p.primA, MAX_PRIMS);
    writeRow(ROW_PRIM_B, p.primB, MAX_PRIMS);
    writeRow(ROW_PRIM_SCALE, p.primScale, MAX_PRIMS);
    writeRow(ROW_CLUSTER_BOUNDS, p.clusterBounds, p.clusterCount);
    writeRow(ROW_CLUSTER_RANGE, p.clusterRange, p.clusterCount);
    dataTex.needsUpdate = true;
    uCounts.value.set(p.primCount, p.clusterCount, p.carveCount, p.maxBlendK);
    return p;
  }

  const packed = upload(body);

  /**
   * Swizzle accessors on a wgslFn result.
   *
   * three 0.185 types wgslFn's return as a plain Node, which has no `.xyz` or
   * `.w` on it even though the node system supplies them at runtime. Casting
   * through a named shape keeps the two uses below honest about what they
   * expect, rather than scattering `as any` at each call site.
   */
  type Swizzled = { xyz: unknown; w: unknown };
  const marched = marchBody({
    worldPos: positionWorld,
    camPos: cameraPosition,
    data: texture(dataTex),
    counts: uCounts,
    marchCfg: uMarchCfg,
    baseColor: uBaseColor,
    deepColor: uDeepColor,
    lightDir: uLightDir,
    keyColor: uKeyColor,
    lightCfg: uLightCfg,
    surfCfg: uSurfCfg,
    surfCfg2: uSurfCfg2,
  }) as unknown as Swizzled;

  const material = new MeshBasicNodeMaterial();
  material.side = THREE.BackSide;
  material.colorNode = vec4(marched.xyz as never, 1.0);

  // Depth from the marched hit, so the body composites with real geometry.
  // WebGPU clip z is already [0,1] — no `* 0.5 + 0.5` remap, unlike the GLSL.
  const rayDir = normalize(sub(positionWorld, cameraPosition));
  const hitPos = add(cameraPosition, mul(rayDir, marched.w as never));
  const clip = mul(cameraProjectionMatrix, mul(cameraViewMatrix, vec4(hitPos, 1.0)));
  material.depthNode = clip.z.div(clip.w);
  material.depthWrite = true;

  /** Proxy box covering every live cluster, plus blend margin. */
  function fit(body_: BuildResult, maxBlendK: number) {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const c of body_.clusters) {
      if (!c.alive) continue;
      for (let i = 0; i < 3; i++) {
        min[i] = Math.min(min[i]!, c.center[i]! - c.radius);
        max[i] = Math.max(max[i]!, c.center[i]! + c.radius);
      }
    }
    const pad = maxBlendK * 4 + 0.05;
    return {
      centre: new THREE.Vector3(...min.map((v, i) => (v + max[i]!) / 2)),
      size: Math.max(...max.map((v, i) => v - min[i]!)) + pad * 2,
    };
  }

  const first = fit(body, packed.maxBlendK);
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(first.size, first.size, first.size), material,
  );
  mesh.position.copy(first.centre);
  mesh.frustumCulled = false; // the proxy IS the bound; don't double-cull

  return {
    object: mesh,
    update(next) {
      const p = upload(next);
      const f = fit(next, p.maxBlendK);
      mesh.position.copy(f.centre);
      mesh.scale.setScalar(f.size / first.size);
    },
    applyMaterial(m, light) {
      uBaseColor.value.setRGB(...m.baseColor);
      uDeepColor.value.setRGB(...m.deepColor);
      uSurfCfg.value.set(m.specIntensity, m.specRoughness, m.fresnelBoost, m.translucency);
      uSurfCfg2.value.set(m.wetness, m.surfaceNoiseAmp);
      uMarchCfg.value.z = m.silhouetteNoiseAmp;
      uLightDir.value.set(...light.keyDir);
      uKeyColor.value.setRGB(...light.keyColor);
      uLightCfg.value.set(light.keyIntensity, light.fillIntensity);
    },
  };
}
