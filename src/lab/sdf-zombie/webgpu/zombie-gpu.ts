// src/lab/sdf-zombie/webgpu/zombie-gpu.ts
//
// The WebGPU view of the body: packs primitives into a float data texture and
// drives the WGSL march.
//
// The pure modules (build-body, pack, clusters, validate, face, damage, sever,
// gib-chunks) are shared with the WebGL path UNCHANGED. That is the point of
// the migration being lab-scoped — only the rendering tail differs, so a bug in
// the field maths cannot diverge between the two paths.

import * as THREE from 'three/webgpu';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
  wgslFn, positionWorld, cameraPosition, vec4, uniform, texture,
  cameraProjectionMatrix, cameraViewMatrix, normalize, sub, mul, add,
} from 'three/tsl';
import type { BuildResult } from '../build-body';
import { packBody, PRIM_STRIDE } from '../pack';
import { MAX_PRIMS } from '../validate';
import { MAX_WOUNDS } from '../damage';
import type { Chunk } from '../gib-chunks';
import type { FleshMaterial, LightPreset } from '../material';
import type { Primitive, Vec3 } from '../types';
import { sub as vsub } from '../vec';
import { chunkExtent } from '../extent';
import {
  HELPERS, MARCH_BODY, DATA_ROWS,
  ROW_PRIM_A, ROW_PRIM_B, ROW_PRIM_SCALE, ROW_CLUSTER_BOUNDS, ROW_CLUSTER_RANGE,
  ROW_WOUND, ROW_WOUND_META,
} from './march.wgsl';

export interface ZombieGpuView {
  object: THREE.Object3D;
  /** Live uniforms — the WebGPU stand-in for `ShaderMaterial.uniforms`. */
  uniforms: MarchUniforms;
  /** Re-upload after the body changes (sever, override edit, rig step). */
  update(body: BuildResult): void;
  /** Uploads wounds already transformed to world space by the caller. */
  setWounds(worldPositions: Vec3[], radii: number[], types: number[], ages: number[]): void;
  /** The skull's centre and semi-axes, which the face projection normalises by. */
  setHeadShape(centre: Vec3, axes: Vec3): void;
  /** Drives the eye-glow flicker. Seconds. */
  setTime(seconds: number): void;
  /**
   * Swaps the face sheet, its crop rect (as uv scale/offset) and its mean.
   *
   * Does NOT dispose the outgoing texture: one sheet is shared across every
   * body in the scene, so a view that disposed on swap would pull the texture
   * out from under its neighbours. The caller owns the lifecycle.
   */
  setFaceTexture(tex: THREE.Texture, atlas: THREE.Vector4, mean: number): void;
  applyMaterial(m: FleshMaterial, light: LightPreset): void;
  dispose(): void;
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

/**
 * Stand-in face sheet, so the texture binding exists before the real art
 * loads. A 1x1 opaque white texel is the identity for everything the face does
 * — the multiplier divides by its own mean, and the relief differences are all
 * zero — so a body whose face never loads simply renders untextured rather
 * than black or pink.
 */
function blankFaceTexture(): THREE.DataTexture {
  const tex = new THREE.DataTexture(
    new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat,
  );
  tex.needsUpdate = true;
  return tex;
}

/**
 * Every uniform the march reads.
 *
 * Defaults mirror zombie.ts's uniform block exactly, so both renderer paths
 * start from the same look and a divergence on screen means a port bug rather
 * than a different starting value.
 *
 * Values are packed into vec4s rather than one uniform per scalar because the
 * entry function takes them as PARAMETERS, and twenty-odd loose floats would
 * make an already-long signature unreadable. Slot meanings are documented on
 * MARCH_BODY in march.wgsl.ts and repeated in the comments below.
 */
function defaultUniforms(faceTex: THREE.Texture) {
  return {
    /** x primCount, y clusterCount, z carveCount, w maxBlendK */
    counts: uniform(new THREE.Vector4(0, 0, 0, 0)),
    /** x steps, y stepMul, z silhouetteNoiseAmp */
    marchCfg: uniform(new THREE.Vector3(96, 0.6, 0.016)),
    /** x count, y blendK, z rimSplay, w rimOffset */
    woundCfg: uniform(new THREE.Vector4(0, 0.015, 0.55, 1.15)),
    /**
     * x rimWidth, y relaxation factor for sphere tracing.
     *
     * 1.6 is the usual over-relaxation constant. It only takes effect where
     * the silhouette noise is off and the field is therefore trustworthy —
     * see the long note in MARCH_BODY. Set at or below 1.0 to disable.
     */
    woundCfg2: uniform(new THREE.Vector4(0.42, 1.6, 0, 0)),
    baseColor: uniform(new THREE.Color(0xc46a72)),
    deepColor: uniform(new THREE.Color(0x8c1420)),
    charColor: uniform(new THREE.Color(0x1a1214)),
    lightDir: uniform(new THREE.Vector3(0.45, 0.72, 0.53)),
    keyColor: uniform(new THREE.Color(1, 0.96, 0.92)),
    /** x keyIntensity, y fillIntensity */
    lightCfg: uniform(new THREE.Vector2(2.4, 0.06)),
    /** x specIntensity, y specRoughness, z fresnelBoost, w translucency */
    surfCfg: uniform(new THREE.Vector4(0.95, 0.12, 0.85, 0.45)),
    /** x wetness, y surfaceNoiseAmp */
    surfCfg2: uniform(new THREE.Vector2(1.0, 0.06)),
    /** x enabled, y strength, z forward (+1/-1), w relief */
    faceCfg: uniform(new THREE.Vector4(0, 0.85, 1, 1.4)),
    /** x projMode (0 planar, 1 spherical), y mean, z glowThreshold, w glowStrength */
    // 0.88, not the 0.72 this used to be. Measured off the sheet: at 0.72 the
    // mask covers 314 texels spanning y 0-35 — most of the upper face — while
    // at 0.9 it is 30 texels in a tight band at y 20-25, which is the eyes and
    // nothing else. The loose value only ever worked because the glow was a
    // faint ADDITIVE tint that spilled unnoticeably; now that the eye replaces
    // the flesh under it, a loose threshold paints a solid red patch across
    // the brow. Re-measure this if the art changes.
    faceCfg2: uniform(new THREE.Vector4(0, 0.5, 0.88, 1.6)),
    /** x glowFlicker, y timeSeconds */
    faceCfg3: uniform(new THREE.Vector4(0.45, 0, 0, 0)),
    faceProj: uniform(new THREE.Vector4(1.15, 1.15, 0.5, 0.52)),
    faceAtlas: uniform(new THREE.Vector4(1, 1, 0, 0)),
    headCentre: uniform(new THREE.Vector3(0, 1.6, 0)),
    headAxes: uniform(new THREE.Vector3(0.12, 0.13, 0.12)),
    // Bright red, and deliberately over 1.0 on the red channel: an emissive
    // that only reaches 1.0 cannot read as a LIGHT, and a value above it is
    // also what a bloom pass would key on if one is added later.
    //
    // Green and blue are much lower than the WebGL path's 0.18/0.10, and that
    // divergence is deliberate. These are LINEAR values that go through the
    // output sRGB encode on this path, which lifts the low channels far more
    // than the clamped red one — 0.18 linear encodes to 0.46, so the "red" eye
    // came out salmon. At 1.6 strength these land near RGB(255, 42, 28).
    // The WebGL path has no output encode (see the parity note), so its
    // numbers stay as authored; both converge at the preset retune, X1.3.
    faceGlowColor: uniform(new THREE.Color(1.9, 0.012, 0.005)),
    /** The face sheet itself. Swapped by the panel; see setFaceTexture(). */
    faceTex: texture(faceTex),
    /**
     * x = aoEnabled.
     *
     * The only LOD lever that needs its own uniform: every other one is
     * switched off by driving its existing amplitude to zero, and the shader
     * branches on that. "No ambient occlusion" has no amplitude.
     */
    lodCfg: uniform(new THREE.Vector4(1, 0, 0, 0)),
  };
}

/**
 * The live uniform set — the WebGPU stand-in for `ShaderMaterial.uniforms`.
 *
 * Derived from the factory rather than declared by hand so the node types stay
 * exact: `wgslFn` takes Nodes, and a hand-written `{ value: Vector4 }` shape
 * would not satisfy it.
 */
export type MarchUniforms = ReturnType<typeof defaultUniforms>;

/**
 * Swizzle accessors on a wgslFn result.
 *
 * three 0.185 types wgslFn's return as a plain Node, which has no `.xyz` or
 * `.w` on it even though the node system supplies them at runtime. Casting
 * through a named shape keeps the two uses below honest about what they
 * expect, rather than scattering `as any` at each call site.
 */
type Swizzled = { xyz: unknown; w: unknown };

/**
 * Builds the marching material for one data texture + uniform set.
 *
 * Shared by the body and by every gib chunk. Both march the identical WGSL, so
 * three hashes them to ONE pipeline and only the bind groups differ — which is
 * what makes a two-dozen-chunk gib explosion affordable on this path.
 */
function createMarchMaterial(dataTex: THREE.Texture, u: MarchUniforms) {
  const marched = marchBody({
    worldPos: positionWorld,
    camPos: cameraPosition,
    data: texture(dataTex),
    faceTex: u.faceTex,
    counts: u.counts,
    marchCfg: u.marchCfg,
    woundCfg: u.woundCfg,
    woundCfg2: u.woundCfg2,
    baseColor: u.baseColor,
    deepColor: u.deepColor,
    charColor: u.charColor,
    lightDir: u.lightDir,
    keyColor: u.keyColor,
    lightCfg: u.lightCfg,
    surfCfg: u.surfCfg,
    surfCfg2: u.surfCfg2,
    faceCfg: u.faceCfg,
    faceCfg2: u.faceCfg2,
    faceCfg3: u.faceCfg3,
    faceProj: u.faceProj,
    faceAtlas: u.faceAtlas,
    headCentre: u.headCentre,
    headAxes: u.headAxes,
    faceGlowColor: u.faceGlowColor,
    lodCfg: u.lodCfg,
  }) as unknown as Swizzled;

  const material = new MeshBasicNodeMaterial();
  material.side = THREE.BackSide;

  // Depth from the marched hit, so the body composites with real geometry.
  // WebGPU clip z is already [0,1] — no `* 0.5 + 0.5` remap, unlike the GLSL.
  const rayDir = normalize(sub(positionWorld, cameraPosition));
  const hitPos = add(cameraPosition, mul(rayDir, marched.w as never));
  const clip = mul(cameraProjectionMatrix, mul(cameraViewMatrix, vec4(hitPos, 1.0)));
  const depth = clip.z.div(clip.w);

  material.colorNode = vec4(marched.xyz as never, 1.0);
  material.depthNode = depth;
  material.depthWrite = true;

  // Depth goes out in ALPHA as well as to depthNode, via `outputNode`.
  //
  // It has to be outputNode and not colorNode: three builds `DiffuseColor =
  // vec4(colorNode.xyz, 1.0)` and then forces `DiffuseColor.w = 1.0` again for
  // an opaque material, so an alpha written through colorNode never reaches
  // the target. That cost a pass where the composite discarded every pixel and
  // no body appeared at all. outputNode replaces the final RGBA outright.
  //
  // The alpha copy is what lets the half-resolution SDF layer composite: its
  // pass renders into a float target, and the composite reads depth straight
  // back out of the colour it already samples. Attaching a DepthTexture and
  // sampling it as `texture_depth_2d` was the first attempt and read as "near"
  // everywhere, so the quad passed the depth test across the whole screen and
  // painted out the floor. Depth in a float alpha channel has no such
  // ambiguity, and FloatType keeps it exact rather than quantised to 8 bits.
  //
  // Harmless when the material draws straight to the canvas: it is opaque, so
  // the framebuffer alpha is never read.
  material.outputNode = vec4(marched.xyz as never, depth);
  return material;
}

/** Allocates the RGBA32F data texture every march reads its field from. */
function createDataTexture() {
  // Nearest filtering and no mips: these are DATA, and any interpolation
  // between texels would silently blend one primitive's endpoint into its
  // neighbour's.
  const texels = new Float32Array(MAX_PRIMS * DATA_ROWS * 4);
  const tex = new THREE.DataTexture(
    texels, MAX_PRIMS, DATA_ROWS, THREE.RGBAFormat, THREE.FloatType,
  );
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;

  /** Writes one row of the data texture from a packed Float32Array. */
  function writeRow(row: number, src: Float32Array, count: number) {
    const base = row * MAX_PRIMS * 4;
    for (let i = 0; i < count * 4; i++) texels[base + i] = src[i]!;
  }
  return { tex, texels, writeRow };
}

/**
 * Writes the wound rows. Shared by the body and by a chunk's torn end, which
 * is itself just a single blast wound parked where the limb came away.
 */
function writeWounds(
  texels: Float32Array,
  worldPositions: Vec3[], radii: number[], types: number[], ages: number[],
): number {
  const n = Math.min(worldPositions.length, MAX_WOUNDS);
  const wBase = ROW_WOUND * MAX_PRIMS * 4;
  const mBase = ROW_WOUND_META * MAX_PRIMS * 4;
  for (let i = 0; i < n; i++) {
    const p = worldPositions[i]!;
    texels[wBase + i * 4] = p[0];
    texels[wBase + i * 4 + 1] = p[1];
    texels[wBase + i * 4 + 2] = p[2];
    texels[wBase + i * 4 + 3] = radii[i]!;
    texels[mBase + i * 4] = types[i]!;
    texels[mBase + i * 4 + 1] = ages[i]!;
  }
  return n;
}

export function createZombieGpuView(body: BuildResult): ZombieGpuView {
  const { tex: dataTex, texels, writeRow } = createDataTexture();
  const u = defaultUniforms(blankFaceTexture());

  function upload(next: BuildResult) {
    const p = packBody(next);
    writeRow(ROW_PRIM_A, p.primA, MAX_PRIMS);
    writeRow(ROW_PRIM_B, p.primB, MAX_PRIMS);
    writeRow(ROW_PRIM_SCALE, p.primScale, MAX_PRIMS);
    writeRow(ROW_CLUSTER_BOUNDS, p.clusterBounds, p.clusterCount);
    writeRow(ROW_CLUSTER_RANGE, p.clusterRange, p.clusterCount);
    dataTex.needsUpdate = true;
    u.counts.value.set(p.primCount, p.clusterCount, p.carveCount, p.maxBlendK);
    return p;
  }

  const packed = upload(body);
  const material = createMarchMaterial(dataTex, u);

  /**
   * Proxy box covering every live cluster, plus blend margin.
   *
   * A true AABB, not a cube. A standing body is roughly 0.6 x 1.8 x 0.35, so
   * the cube this used to build — 1.8 on every side — covered about three
   * times the screen area of the body itself, and every one of those extra
   * pixels entered the march. Sphere tracing exits them quickly, but "quickly"
   * still means several full mapBody evaluations each.
   */
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
      size: new THREE.Vector3(...max.map((v, i) => v - min[i]! + pad * 2)),
    };
  }

  const first = fit(body, packed.maxBlendK);
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(first.size.x, first.size.y, first.size.z), material,
  );
  mesh.position.copy(first.centre);
  mesh.frustumCulled = false; // the proxy IS the bound; don't double-cull

  return {
    object: mesh,
    uniforms: u,
    update(next) {
      const p = upload(next);
      const f = fit(next, p.maxBlendK);
      mesh.position.copy(f.centre);
      // Per-axis, since the box is an AABB: severing a leg shortens it without
      // narrowing it, and a uniform scale would either clip or over-cover.
      mesh.scale.set(
        f.size.x / first.size.x, f.size.y / first.size.y, f.size.z / first.size.z);
    },
    setWounds(worldPositions, radii, types, ages) {
      u.woundCfg.value.x = writeWounds(texels, worldPositions, radii, types, ages);
      dataTex.needsUpdate = true;
    },
    setHeadShape(centre, axes) {
      u.headCentre.value.set(...centre);
      u.headAxes.value.set(...axes);
    },
    setTime(seconds) { u.faceCfg3.value.y = seconds; },
    setFaceTexture(tex, atlas, mean) {
      u.faceTex.value = tex;
      u.faceAtlas.value.copy(atlas);
      u.faceCfg2.value.y = mean;
    },
    applyMaterial(m, light) {
      u.baseColor.value.setRGB(...m.baseColor);
      u.deepColor.value.setRGB(...m.deepColor);
      u.charColor.value.setRGB(...m.charColor);
      u.surfCfg.value.set(m.specIntensity, m.specRoughness, m.fresnelBoost, m.translucency);
      u.surfCfg2.value.set(m.wetness, m.surfaceNoiseAmp);
      u.marchCfg.value.z = m.silhouetteNoiseAmp;
      u.lightDir.value.set(...light.keyDir);
      u.keyColor.value.setRGB(...light.keyColor);
      u.lightCfg.value.set(light.keyIntensity, light.fillIntensity);
    },
    dispose() {
      mesh.geometry.dispose();
      material.dispose();
      dataTex.dispose();
    },
  };
}

export interface ChunkGpuView {
  object: THREE.Object3D;
  update(chunk: Chunk): void;
  dispose(): void;
}

/**
 * A detached blob, raymarched in its own small proxy box.
 *
 * The chunk's primitives are packed as a ONE-CLUSTER body into the chunk's own
 * data texture. The mesh transform only moves the proxy box — the shader
 * marches in WORLD space and the packed prims ARE the field — so the endpoints
 * are re-packed in world space on every update(); moving the mesh alone would
 * fly the box off while the limb stayed frozen in body space. Same hazard
 * translateBody() exists for, and it has bitten this project twice.
 *
 * `template` is the body's live uniform set at the moment of the cut, so the
 * chunk shades exactly like the flesh it came from. Its VALUES are copied, not
 * the nodes: sharing the nodes would let a chunk's wound count scribble over
 * the body's.
 */
export function createChunkGpuView(
  chunk: Chunk,
  prims: Primitive[],
  template: MarchUniforms,
  /** World position where this limb was attached — becomes the torn end. */
  tornAt?: Vec3,
): ChunkGpuView {
  const { tex: dataTex, texels, writeRow } = createDataTexture();
  const u = defaultUniforms(template.faceTex.value);

  // Copy the body's look across. Anything not copied here is a deliberate
  // per-chunk override further down.
  u.baseColor.value.copy(template.baseColor.value);
  u.deepColor.value.copy(template.deepColor.value);
  u.charColor.value.copy(template.charColor.value);
  u.lightDir.value.copy(template.lightDir.value);
  u.keyColor.value.copy(template.keyColor.value);
  u.lightCfg.value.copy(template.lightCfg.value);
  u.surfCfg.value.copy(template.surfCfg.value);
  u.surfCfg2.value.copy(template.surfCfg2.value);
  u.marchCfg.value.copy(template.marchCfg.value);
  u.woundCfg.value.copy(template.woundCfg.value);
  u.woundCfg2.value.copy(template.woundCfg2.value);
  u.faceCfg.value.copy(template.faceCfg.value);
  u.faceCfg2.value.copy(template.faceCfg2.value);
  u.faceCfg3.value.copy(template.faceCfg3.value);
  u.lodCfg.value.copy(template.lodCfg.value);
  u.faceProj.value.copy(template.faceProj.value);
  u.faceAtlas.value.copy(template.faceAtlas.value);
  u.faceGlowColor.value.copy(template.faceGlowColor.value);

  // chunk.pos is the cluster centre at sever time, so this recentres the
  // severed limb's rest-space primitives around the chunk's own origin.
  const local = prims.map(p => ({
    ...p,
    cluster: 0,
    a: vsub(p.a, chunk.pos),
    b: vsub(p.b, chunk.pos),
  }));

  // The chunk's TRUE extent, not chunk.radius: a real limb is 0.3-0.45 across
  // where chunk.radius is 0.14, and the shader's cluster-bounds cull would
  // erase anything reaching past it.
  const extent = chunkExtent(prims, chunk.pos);
  const tornLocal: Vec3 | null = tornAt ? vsub(tornAt, chunk.pos) : null;
  // Big enough to read as a torn stump rather than a pellet hole.
  const tornRadius = extent * 0.55;

  const packed = packBody({
    prims: local,
    clusters: [{
      id: 0, limb: chunk.limb, start: 0, count: local.length,
      center: [0, 0, 0], radius: extent, alive: true,
    }],
    bones: new Map(),
  });

  writeRow(ROW_PRIM_A, packed.primA, MAX_PRIMS);
  writeRow(ROW_PRIM_B, packed.primB, MAX_PRIMS);
  writeRow(ROW_PRIM_SCALE, packed.primScale, MAX_PRIMS);
  writeRow(ROW_CLUSTER_RANGE, packed.clusterRange, 1);
  // A severed head keeps its face: the cluster slice carries its carves, and
  // apply() below rewrites only xyz per endpoint, leaving the packed sign in .w.
  u.counts.value.set(packed.primCount, 1, packed.carveCount, packed.maxBlendK);
  // Chunks are small; fewer steps.
  u.marchCfg.value.x = 48;
  // Only a severed HEAD carries the face. Without this a flying arm would get
  // one projected onto it, since every chunk's own cluster 0 is itself.
  u.faceCfg.value.x = chunk.limb === 'head' ? 1 : 0;
  // A severed head keeps its face, so give it its own skull sphere centred on
  // the chunk — the body's points at the original, now-absent head.
  u.headCentre.value.set(chunk.pos[0], chunk.pos[1], chunk.pos[2]);
  u.headAxes.value.set(extent, extent, extent);

  const material = createMarchMaterial(dataTex, u);
  const size = extent * 2 * 1.4 + packed.maxBlendK * 4 + 0.05;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), material);
  mesh.frustumCulled = false;

  /** Writes the local prims into the world-space data rows for state `c`. */
  function apply(c: Chunk): { sx: number; sy: number; sz: number } {
    const s = Math.min(1, Math.max(0, c.squash));
    // Non-uniform squash on impact — flatten in y, bulge in x/z.
    const sx = 1 + s * 0.35, sy = 1 - s * 0.5, sz = 1 + s * 0.35;
    const cos = Math.cos(c.angle), sin = Math.sin(c.angle);
    local.forEach((p, i) => {
      const o = i * PRIM_STRIDE;
      const ends: readonly [Vec3, Float32Array][] = [[p.a, packed.primA], [p.b, packed.primB]];
      for (const [pt, arr] of ends) {
        // Tumble around y, then squash in WORLD axes so the blob always
        // flattens against the floor, however far it has rolled.
        const rx = pt[0] * cos + pt[2] * sin;
        const rz = -pt[0] * sin + pt[2] * cos;
        arr.set([c.pos[0] + rx * sx, c.pos[1] + pt[1] * sy, c.pos[2] + rz * sz], o);
      }
      // Preserve the carve flag in .w — a severed head keeps its face.
      packed.primScale.set([p.scale[0] * sx, p.scale[1] * sy, p.scale[2] * sz,
        p.op === 'sub' ? 1 : 0], o);
    });
    packed.clusterBounds.set([c.pos[0], c.pos[1], c.pos[2], extent * Math.max(sx, sy, sz)], 0);

    writeRow(ROW_PRIM_A, packed.primA, MAX_PRIMS);
    writeRow(ROW_PRIM_B, packed.primB, MAX_PRIMS);
    writeRow(ROW_PRIM_SCALE, packed.primScale, MAX_PRIMS);
    writeRow(ROW_CLUSTER_BOUNDS, packed.clusterBounds, 1);

    if (tornLocal) {
      // Same tumble-then-squash transform the primitives get, so the torn end
      // stays welded to the stump as the limb spins and flattens.
      const rx = tornLocal[0] * cos + tornLocal[2] * sin;
      const rz = -tornLocal[0] * sin + tornLocal[2] * cos;
      const at: Vec3 = [
        c.pos[0] + rx * sx, c.pos[1] + tornLocal[1] * sy, c.pos[2] + rz * sz,
      ];
      // type 1 = blast, so it reads as torn, not burned.
      u.woundCfg.value.x = writeWounds(texels, [at], [tornRadius], [1], [0]);
    } else {
      u.woundCfg.value.x = 0;
    }

    // A severed head's face projection has to ride the tumbling skull.
    if (u.faceCfg.value.x > 0.5) u.headCentre.value.set(c.pos[0], c.pos[1], c.pos[2]);

    dataTex.needsUpdate = true;
    return { sx, sy, sz };
  }

  const firstApply = apply(chunk);
  mesh.position.set(chunk.pos[0], chunk.pos[1], chunk.pos[2]);
  mesh.rotation.y = chunk.angle;
  mesh.scale.set(firstApply.sx, firstApply.sy, firstApply.sz);

  return {
    object: mesh,
    update(c: Chunk) {
      const { sx, sy, sz } = apply(c);
      mesh.position.set(c.pos[0], c.pos[1], c.pos[2]);
      mesh.rotation.y = c.angle;
      mesh.scale.set(sx, sy, sz);
    },
    dispose() {
      mesh.geometry.dispose();
      material.dispose();
      dataTex.dispose();
    },
  };
}
