// src/lab/sdf-zombie/webgpu/humanoid-view.ts
//
// Task 5 + Task 6 — the clustered proxy view. One proxy box per manifest
// cluster plus a hidden detached right-arm proxy, all marching the SAME
// clustered bone-atlas field (humanoid.wgsl.ts) through one shared descriptor
// texture and the two shared 3D atlases from HumanoidVolumeAssets.
//
// LIFE-CYCLE CONTRACT (Task 5 Step 5):
//   - every attached cluster mesh exists at load; the detached proxy exists
//     too but is hidden;
//   - materials are created BEFORE the view is exposed, all sharing the one
//     module-level entry (identical node graphs hit Three's pipeline cache),
//     but each is a distinct NodeMaterial instance — resourceCounts reports the
//     true instance count, not a deduped one;
//   - one fixed Float32Array backs one descriptor DataTexture, allocated once;
//     setPose writes every bone's pose rows and marks that texture dirty, and
//     NEVER replaces a texture/material/geometry/array/cluster object;
//   - setSoftness/setTime only write uniform values;
//   - dispose releases each view-owned descriptor texture/geometry/material
//     exactly once and NEVER touches the shared distance/colour atlases, whose
//     sole owner stays HumanoidVolumeAssets.dispose().
//
// TASK 6 CUT + DETACH + PREWARM. The cut mask lives in mapHumanoidCut; the
// attached right-arm cluster runs cutMode 1 (proximal) and the detached proxy
// runs cutMode 2 (distal), both sampling the SAME cutPlane so their contours
// are complementary by construction. Because one descriptor texture backs
// every material, the detached distal bones are written to the two SPARE
// columns (HUMANOID_MAX_BONES - distalIndices.length .. HUMANOID_MAX_BONES)
// — the retained bone array is 22 and the padded budget is 24, so exactly the
// two distal bones fit. `setDetachedChunk` re-poses those spare rows under the
// chunk root; `prewarm` compiles attached + detached once each before the
// sever control arms, so sever never pays a first-use compile.

import * as THREE from 'three/webgpu';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
  wgslFn, positionWorld, cameraPosition, vec4, uniform, texture, texture3D,
  cameraProjectionMatrix, cameraViewMatrix, normalize, sub, mul, add,
} from 'three/tsl';
import type { HumanoidVolumeAssets, HumanoidBrickManifest } from './humanoid-volume';
import { HUMANOID_SURFACE_WARP_AMP, HUMANOID_DATA_ROWS, HUMANOID_MAX_BONES } from './humanoid.wgsl';
import {
  ROW_POSE_POS, ROW_POSE_QUAT, ROW_BRICK_OFFSET, ROW_BRICK_DIMS,
  ROW_BOUNDS_MIN, ROW_BOUNDS_INV, ROW_JOINT, ROW_JOINT_AXIS,
  HUMANOID_HELPERS, MARCH_HUMANOID,
} from './humanoid.wgsl';
import {
  distalBoneIndices, type HumanoidPoseState, type HumanoidBonePose,
} from '../humanoid-pose';
import type { CutMode, SeverRenderState } from '../humanoid-sever';
import { chunkBoneWorldPose } from '../humanoid-sever';
import type { Chunk } from '../gib-chunks';
import type { Vec3 } from '../types';
import type { Quat } from '../vec';

export interface HumanoidResourceCounts {
  materials: number;
  geometries: number;
  textures: number;
  attachedClusters: number;
  detachedClusters: number;
  compileCalls: number;
}

export interface PrewarmReport {
  materialCountBefore: number;
  materialCountAfter: number;
  compileCallsBefore: number;
  compileCallsAfter: number;
  renderedAttached: boolean;
  renderedDetached: boolean;
  elapsedMs: number;
}

/** The subset of WebGPURenderer prewarm needs — structural so tests can mock it. */
export interface PrewarmRenderer {
  compileAsync(scene: THREE.Object3D, camera: THREE.Camera, targetScene?: THREE.Scene | null): Promise<unknown>;
  render(scene: THREE.Scene, camera: THREE.Camera): void;
}

export interface HumanoidView {
  readonly attachedGroup: THREE.Group;
  readonly detachedGroup: THREE.Group;
  readonly detachedVisible: boolean;
  readonly attachedCutMode: CutMode;
  readonly detachedCutMode: CutMode;
  setPose(state: HumanoidPoseState): void;
  setSoftness(value01: number): void;
  setTime(timeSec: number): void;
  setCut(state: SeverRenderState): void;
  setDetachedTransform(position: Vec3, quaternion: Quat): void;
  setDetachedChunk(chunk: Chunk, frozenDistalBones: readonly HumanoidBonePose[]): void;
  setVisible(visible: boolean): void;
  warmupObjects(): readonly THREE.Object3D[];
  prewarm(renderer: PrewarmRenderer, scene: THREE.Scene, camera: THREE.Camera): Promise<PrewarmReport>;
  resourceCounts(): HumanoidResourceCounts;
  dispose(): void;
}

/** The one marching entry, built once and shared by every cluster material —
 *  the per-cluster bone indices are a uniform, not baked literals, so all
 *  materials produce the identical WGSL and hit Three's pipeline cache. */
const marchHumanoidFn = (() => {
  const nodes = HUMANOID_HELPERS.reduce<ReturnType<typeof wgslFn>[]>(
    (acc, src) => [...acc, wgslFn(src, acc.slice())], [],
  );
  return wgslFn(MARCH_HUMANOID, nodes);
})();

/** Per-material uniform set. Each cluster material owns its own nodes so the
 *  bone indices and cut mode can differ per proxy while the graph is shared. */
function createHumanoidUniforms() {
  return {
    /** xyz = bone array positions 0..3, w = spare (count lives in clusterCfg.x). */
    boneIdx: uniform(new THREE.Vector4(0, 0, 0, 0)),
    /** x boneCount, y cutMode (0 none/1 proximal/2 distal), z softness01,
     *  w hit epsilon. */
    clusterCfg: uniform(new THREE.Vector4(0, 0, 0, 0.004)),
    /** xyz = unit cut normal, w = plane offset (RightForeArm bind-local). */
    cutPlane: uniform(new THREE.Vector4(0, 0, 1, 0)),
    /** Data-texture column of the bone the cut is evaluated in (the forearm). */
    cutBone: uniform(0),
    timeSec: uniform(0),
    baseColor: uniform(new THREE.Color(0xc46a72)),
    /** Wet red tissue — the cap's mid band between skin edge and dark centre. */
    meatColor: uniform(new THREE.Color(0x9e1b24)),
    deepColor: uniform(new THREE.Color(0x8c1420)),
    keyColor: uniform(new THREE.Color(1, 0.96, 0.92)),
    lightDir: uniform(new THREE.Vector3(0.45, 0.72, 0.53)),
    lightCfg: uniform(new THREE.Vector2(2.4, 0.06)),
    surfCfg: uniform(new THREE.Vector4(0.95, 0.12, 0.85, 0.45)),
    marchCfg: uniform(new THREE.Vector3(96, 0.6, 0)),
  };
}
type HumanoidUniforms = ReturnType<typeof createHumanoidUniforms>;

type Swizzled = { xyz: unknown; w: unknown };

/** Builds one marching material over the shared data/atlas textures. Mirrors
 *  zombie-gpu.ts's createMarchMaterial: real WebGPU depth from the marched hit
 *  (clip.z / clip.w), colour + depth in the output alpha. */
function createHumanoidMarchMaterial(
  dataTex: THREE.DataTexture,
  distAtlas: THREE.Data3DTexture,
  colorAtlas: THREE.Data3DTexture,
  u: HumanoidUniforms,
): MeshBasicNodeMaterial {
  const marched = marchHumanoidFn({
    worldPos: positionWorld,
    camPos: cameraPosition,
    data: texture(dataTex),
    distAtlas: texture3D(distAtlas),
    colorAtlas: texture3D(colorAtlas),
    boneIdx: u.boneIdx,
    clusterCfg: u.clusterCfg,
    cutPlane: u.cutPlane,
    cutBone: u.cutBone,
    timeSec: u.timeSec,
    baseColor: u.baseColor,
    meatColor: u.meatColor,
    deepColor: u.deepColor,
    keyColor: u.keyColor,
    lightDir: u.lightDir,
    lightCfg: u.lightCfg,
    surfCfg: u.surfCfg,
    marchCfg: u.marchCfg,
  }) as unknown as Swizzled;

  const material = new MeshBasicNodeMaterial();
  material.side = THREE.BackSide;

  const rayDir = normalize(sub(positionWorld, cameraPosition));
  const hitPos = add(cameraPosition, mul(rayDir, marched.w as never));
  const clip = mul(cameraProjectionMatrix, mul(cameraViewMatrix, vec4(hitPos, 1.0)));
  const depth = clip.z.div(clip.w);

  material.colorNode = vec4(marched.xyz as never, 1.0);
  material.depthNode = depth;
  material.depthWrite = true;
  material.outputNode = vec4(marched.xyz as never, depth);
  return material;
}

/** Column-major 4x4 point transform (model -> bind-local). */
function matPoint(m: readonly number[], p: Vec3): Vec3 {
  return [
    m[0]! * p[0] + m[4]! * p[1] + m[8]! * p[2] + m[12]!,
    m[1]! * p[0] + m[5]! * p[1] + m[9]! * p[2] + m[13]!,
    m[2]! * p[0] + m[6]! * p[1] + m[10]! * p[2] + m[14]!,
  ];
}

/** Column-major 4x4 direction transform (rotation only). */
function matVec(m: readonly number[], v: Vec3): Vec3 {
  return [
    m[0]! * v[0] + m[4]! * v[1] + m[8]! * v[2],
    m[1]! * v[0] + m[5]! * v[1] + m[9]! * v[2],
    m[2]! * v[0] + m[6]! * v[1] + m[10]! * v[2],
  ];
}

/** Allocates the descriptor data texture: HUMANOID_MAX_BONES columns of
 *  HUMANOID_DATA_ROWS RGBA32F rows. One texture backs every cluster material. */
function createHumanoidDataTexture() {
  const texels = new Float32Array(HUMANOID_MAX_BONES * HUMANOID_DATA_ROWS * 4);
  const tex = new THREE.DataTexture(
    texels, HUMANOID_MAX_BONES, HUMANOID_DATA_ROWS, THREE.RGBAFormat, THREE.FloatType,
  );
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return { tex, texels };
}

/** Maps a CutMode to the shader's 0/1/2 cutMode uniform. */
function cutModeValue(mode: CutMode): number {
  return mode === 'proximal' ? 1 : mode === 'distal' ? 2 : 0;
}

export function createHumanoidView(assets: HumanoidVolumeAssets): HumanoidView {
  const { manifest } = assets;
  if (manifest.bones.length > HUMANOID_MAX_BONES) {
    throw new Error(
      `humanoid view: ${manifest.bones.length} bones exceed the ${HUMANOID_MAX_BONES}-bone descriptor budget`,
    );
  }

  const { tex: dataTex, texels } = createHumanoidDataTexture();

  /** Writes one bone's row (a, b, c, d). */
  function writeBone(row: number, boneIdx: number, a: number, b: number, c: number, d: number) {
    const base = (row * HUMANOID_MAX_BONES + boneIdx) * 4;
    texels[base] = a;
    texels[base + 1] = b;
    texels[base + 2] = c;
    texels[base + 3] = d;
  }

  // -- static per-bone rows (brick layout + joint bands, written once) --------
  const jointByChild = new Map(manifest.joints.map(j => [j.child, j]));
  function writeStaticRows(column: number, b: HumanoidBrickManifest): void {
    writeBone(ROW_BRICK_OFFSET, column, b.offset[0], b.offset[1], b.offset[2], 0);
    writeBone(ROW_BRICK_DIMS, column, b.dimensions[0], b.dimensions[1], b.dimensions[2], 0);
    writeBone(ROW_BOUNDS_MIN, column, b.boundsMin[0], b.boundsMin[1], b.boundsMin[2], 0);
    writeBone(
      ROW_BOUNDS_INV, column,
      1 / (b.boundsMax[0] - b.boundsMin[0]),
      1 / (b.boundsMax[1] - b.boundsMin[1]),
      1 / (b.boundsMax[2] - b.boundsMin[2]),
      0,
    );
    // Joint band to this bone's parent, in THIS bone's bind-local frame.
    const joint = jointByChild.get(b.bone);
    if (joint) {
      const center = matPoint(b.modelToBind, joint.centerModel);
      const axis = matVec(b.modelToBind, joint.axisModel);
      writeBone(ROW_JOINT, column, center[0], center[1], center[2], joint.overlapM * 0.5);
      writeBone(ROW_JOINT_AXIS, column, axis[0], axis[1], axis[2], 0);
    } else {
      writeBone(ROW_JOINT, column, 0, 0, 0, 0);
      writeBone(ROW_JOINT_AXIS, column, 0, 0, 0, 0);
    }
  }
  for (let i = 0; i < manifest.bones.length; i++) {
    writeStaticRows(i, manifest.bones[i]!);
  }

  // -- distal subtree + spare descriptor columns -------------------------------
  const forearmIdx = assets.boneIndex.get(manifest.rightArm.forearm);
  if (forearmIdx === undefined) {
    throw new Error(`humanoid view: manifest is missing the ${manifest.rightArm.forearm} brick`);
  }
  const distalIndices = distalBoneIndices(manifest, manifest.rightArm.forearm);
  // The retained bone array is 22 with a 24-column budget, leaving exactly
  // enough spare columns for the distal subtree to get its OWN detached pose.
  const spareColumns = HUMANOID_MAX_BONES - manifest.bones.length;
  if (distalIndices.length > spareColumns) {
    throw new Error(
      `humanoid view: ${distalIndices.length} distal bones exceed the ${spareColumns} spare descriptor columns`,
    );
  }
  const detachedBase = HUMANOID_MAX_BONES - distalIndices.length;
  // Copy the distal bones' static rows into the spare columns; setDetachedChunk
  // writes the chunk-composed pose rows there, leaving the attached pose intact.
  for (let k = 0; k < distalIndices.length; k++) {
    writeStaticRows(detachedBase + k, manifest.bones[distalIndices[k]!]!);
  }

  // The detached proxy is an orientation-invariant cube centred on the chunk
  // root: its radius is the farthest occupied-bound corner of any distal bone
  // from the cut-plane centre (bind pose), so the tumbling piece never clips.
  const fa = manifest.bones[forearmIdx]!;
  const [nx, ny, nz, w] = manifest.rightArm.cutPlaneLocal;
  const planePoint: Vec3 = [-w * nx, -w * ny, -w * nz];
  const cutCentreModel = matPoint(fa.bindToModel, planePoint);
  let distalRadius = 0;
  for (const bi of distalIndices) {
    const b = manifest.bones[bi]!;
    const bindPos: Vec3 = [b.bindToModel[12]!, b.bindToModel[13]!, b.bindToModel[14]!];
    const occRad = Math.max(
      Math.hypot(b.occupiedBoundsMin[0], b.occupiedBoundsMin[1], b.occupiedBoundsMin[2]),
      Math.hypot(b.occupiedBoundsMax[0], b.occupiedBoundsMax[1], b.occupiedBoundsMax[2]),
    );
    const centreDist = Math.hypot(
      bindPos[0] - cutCentreModel[0], bindPos[1] - cutCentreModel[1], bindPos[2] - cutCentreModel[2],
    );
    distalRadius = Math.max(distalRadius, centreDist + occRad);
  }
  distalRadius += HUMANOID_SURFACE_WARP_AMP;

  // -- material + proxy construction (before exposing the view) ---------------
  const attachedGroup = new THREE.Group();
  const detachedGroup = new THREE.Group();
  detachedGroup.visible = false;

  // One material per attached cluster, plus one for the detached right-arm
  // proxy. Each shares the same WGSL graph but owns its bone-index/cut uniforms.
  const materials: MeshBasicNodeMaterial[] = [];
  const geometries: THREE.BoxGeometry[] = [];
  const materialUniforms: HumanoidUniforms[] = [];
  const proxyMeshes: THREE.Mesh[] = [];

  function makeProxyMaterial(
    dataColumns: number[], boneIndices: number[],
  ): { u: HumanoidUniforms; material: MeshBasicNodeMaterial } {
    const u = createHumanoidUniforms();
    // Hit epsilon: at least half the largest voxel pitch in this cluster.
    let maxPitch = 0;
    for (const bi of boneIndices) {
      maxPitch = Math.max(maxPitch, ...manifest.bones[bi]!.voxelSize);
    }
    u.clusterCfg.value.set(dataColumns.length, 0, 0, Math.max(0.004, maxPitch * 0.5));
    u.boneIdx.value.set(
      dataColumns[0] ?? 0, dataColumns[1] ?? 0, dataColumns[2] ?? 0, dataColumns[3] ?? 0,
    );
    const material = createHumanoidMarchMaterial(
      dataTex, assets.distanceTexture, assets.colorTexture, u,
    );
    return { u, material };
  }

  function buildProxy(
    parent: THREE.Group, dataColumns: number[], boneIndices: number[],
    sweepMin: Vec3, sweepMax: Vec3,
  ): void {
    const { u, material } = makeProxyMaterial(dataColumns, boneIndices);

    // The proxy covers the cluster's swept field plus the max softness warp
    // amplitude on every side, so a warped surface can never clip the box.
    const pad = HUMANOID_SURFACE_WARP_AMP;
    const size = new THREE.Vector3(
      sweepMax[0] - sweepMin[0] + pad * 2,
      sweepMax[1] - sweepMin[1] + pad * 2,
      sweepMax[2] - sweepMin[2] + pad * 2,
    );
    const geometry = new THREE.BoxGeometry(size.x, size.y, size.z);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(
      (sweepMin[0] + sweepMax[0]) / 2,
      (sweepMin[1] + sweepMax[1]) / 2,
      (sweepMin[2] + sweepMax[2]) / 2,
    );
    mesh.frustumCulled = false; // the proxy IS the bound; do not double-cull

    parent.add(mesh);
    proxyMeshes.push(mesh);
    materials.push(material);
    geometries.push(geometry);
    materialUniforms.push(u);
  }

  const rightArmCluster = manifest.clusters.find(c => c.name === 'right-arm');
  if (!rightArmCluster) {
    throw new Error('humanoid view: manifest has no right-arm cluster');
  }

  for (const cluster of manifest.clusters) {
    const boneIndices = cluster.sampleBones.map(name => {
      const idx = assets.boneIndex.get(name);
      if (idx === undefined) throw new Error(`humanoid view: cluster samples unknown bone ${name}`);
      return idx;
    });
    buildProxy(attachedGroup, boneIndices, boneIndices, cluster.sweepBoundsMin, cluster.sweepBoundsMax);
  }
  const rightArmMaterialIdx = manifest.clusters.findIndex(c => c.name === 'right-arm');

  // The detached proxy: the distal forearm + hand, hidden at load, sampled from
  // the SPARE columns so its pose can diverge from the attached forearm.
  const detachedDataColumns = distalIndices.map((_, k) => detachedBase + k);
  const { u: detachedU, material: detachedMaterial } = makeProxyMaterial(detachedDataColumns, distalIndices);
  const detachedGeometry = new THREE.BoxGeometry(distalRadius * 2, distalRadius * 2, distalRadius * 2);
  const detachedMesh = new THREE.Mesh(detachedGeometry, detachedMaterial);
  detachedMesh.position.set(cutCentreModel[0], cutCentreModel[1], cutCentreModel[2]);
  detachedMesh.frustumCulled = false;
  detachedGroup.add(detachedMesh);
  proxyMeshes.push(detachedMesh);
  materials.push(detachedMaterial);
  geometries.push(detachedGeometry);
  materialUniforms.push(detachedU);
  const detachedMaterialIdx = materialUniforms.length - 1;

  // -- live state -------------------------------------------------------------
  let detachedVisible = false;
  let attachedCutMode: CutMode = 'none';
  let detachedCutMode: CutMode = 'none';
  let visible = true;
  let disposed = false;
  let compileCalls = 0;

  /** Writes every bone's pose row from the state's per-bone world pose. The
   *  quaternion is the bind->world (local->world) orientation; the shader
   *  conjugates it for world->local. */
  function setPose(state: HumanoidPoseState): void {
    if (disposed) return;
    if (state.bones.length !== manifest.bones.length) {
      throw new Error(
        `humanoid view: pose has ${state.bones.length} bones, manifest has ${manifest.bones.length}`,
      );
    }
    for (let i = 0; i < state.bones.length; i++) {
      const bone = state.bones[i]!;
      writeBone(ROW_POSE_POS, i, bone.position[0], bone.position[1], bone.position[2], 1);
      writeBone(
        ROW_POSE_QUAT, i,
        bone.quaternion[0], bone.quaternion[1], bone.quaternion[2], bone.quaternion[3],
      );
    }
    dataTex.needsUpdate = true;
  }

  async function prewarm(
    renderer: PrewarmRenderer, scene: THREE.Scene, camera: THREE.Camera,
  ): Promise<PrewarmReport> {
    const materialCountBefore = materials.length;
    const compileCallsBefore = compileCalls;
    const t0 = performance.now();

    const prevAttachedVisible = attachedGroup.visible;
    const prevDetachedVisible = detachedGroup.visible;
    const prevDetachedPos = detachedMesh.position.clone();

    let renderedAttached = false;
    let renderedDetached = false;

    // Park the detached proxy off-camera so its compile/render never lands in
    // view; restore the parked transform afterwards.
    detachedMesh.position.set(0, -1000, 0);

    try {
      // Compile the attached group first (detached hidden), then the detached
      // proxy. Only prewarm touches compileAsync — sever/reset/render never do.
      attachedGroup.visible = true;
      detachedGroup.visible = false;
      await renderer.compileAsync(attachedGroup, camera, scene);
      compileCalls++;

      detachedGroup.visible = true;
      await renderer.compileAsync(detachedGroup, camera, scene);
      compileCalls++;

      // Render at least one frame through the same draw path sever uses, so
      // the detached pipeline is fenced before the sever control arms.
      renderer.render(scene, camera);
      renderedAttached = true;
      renderedDetached = true;
    } finally {
      attachedGroup.visible = prevAttachedVisible;
      detachedGroup.visible = prevDetachedVisible;
      detachedMesh.position.copy(prevDetachedPos);
    }

    return {
      materialCountBefore,
      materialCountAfter: materials.length,
      compileCallsBefore,
      compileCallsAfter: compileCalls,
      renderedAttached,
      renderedDetached,
      elapsedMs: performance.now() - t0,
    };
  }

  return {
    attachedGroup,
    detachedGroup,
    get detachedVisible() { return detachedVisible; },
    get attachedCutMode() { return attachedCutMode; },
    get detachedCutMode() { return detachedCutMode; },

    setPose,

    setSoftness(value01) {
      const s = Math.min(1, Math.max(0, value01));
      for (const u of materialUniforms) u.clusterCfg.value.z = s;
    },

    setTime(timeSec) {
      for (const u of materialUniforms) u.timeSec.value = timeSec;
    },

    setCut(state) {
      attachedCutMode = state.attachedCutMode;
      detachedCutMode = state.detachedCutMode;
      detachedVisible = state.detachedVisible;
      detachedGroup.visible = visible && detachedVisible;
      const [cnx, cny, cnz, cw] = state.cutPlaneLocal;
      const attachedMode = cutModeValue(state.attachedCutMode);
      const detachedMode = cutModeValue(state.detachedCutMode);
      for (let i = 0; i < materialUniforms.length; i++) {
        const u = materialUniforms[i]!;
        u.cutPlane.value.set(cnx, cny, cnz, cw);
        if (i === rightArmMaterialIdx) {
          u.clusterCfg.value.y = attachedMode;
          u.cutBone.value = forearmIdx;
        } else if (i === detachedMaterialIdx) {
          u.clusterCfg.value.y = detachedMode;
          u.cutBone.value = detachedBase;
        } else {
          u.clusterCfg.value.y = 0;
          u.cutBone.value = 0;
        }
      }
    },

    setDetachedTransform(position, _quaternion) {
      // Task 5 kept this reposition-only; Task 6's setDetachedChunk is the
      // pose-uploading path. Kept for the parked-proxy lifecycle.
      detachedMesh.position.set(position[0], position[1], position[2]);
    },

    setDetachedChunk(chunk, frozenDistalBones) {
      if (disposed) return;
      if (frozenDistalBones.length !== distalIndices.length) {
        throw new Error(
          `humanoid view: ${frozenDistalBones.length} frozen bones for ${distalIndices.length} distal bones`,
        );
      }
      // Compose the chunk root (quat/pos) with each frozen distal bone pose
      // (relative to the root) and write the result to the spare columns. The
      // distal coordinates stay frozen under the chunk root, so texture and
      // cut noise tumble with the piece.
      for (let k = 0; k < distalIndices.length; k++) {
        const rel = frozenDistalBones[k]!;
        const column = detachedBase + k;
        const worldPose = chunkBoneWorldPose(chunk, rel);
        writeBone(ROW_POSE_POS, column, worldPose.position[0], worldPose.position[1], worldPose.position[2], 1);
        writeBone(ROW_POSE_QUAT, column, worldPose.quaternion[0], worldPose.quaternion[1], worldPose.quaternion[2], worldPose.quaternion[3]);
      }
      dataTex.needsUpdate = true;
      // Reposition (and never rebuild) the existing detached proxy box.
      detachedMesh.position.set(chunk.pos[0], chunk.pos[1], chunk.pos[2]);
    },

    setVisible(v) {
      visible = v;
      attachedGroup.visible = v;
      detachedGroup.visible = v && detachedVisible;
    },

    warmupObjects() {
      return proxyMeshes;
    },

    prewarm,

    resourceCounts() {
      return {
        materials: materials.length,
        geometries: geometries.length,
        textures: 1,
        attachedClusters: manifest.clusters.length,
        detachedClusters: 1,
        compileCalls,
      };
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      dataTex.dispose();
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
    },
  };
}
