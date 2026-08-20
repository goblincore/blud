// src/lab/sdf-zombie/webgpu/humanoid-view.test.ts
//
// Task 5 — the clustered proxy view's lifecycle. Constructs tiny 8³ distance
// and colour textures plus a two-bone manifest and pins what the plan Step 2
// requires: one attached group + one hidden detached group, all cluster meshes
// created immediately, setPose mutating data rather than identity, a stable
// material count across setPose, and dispose releasing each view-owned
// resource exactly once while leaving the shared atlases to
// HumanoidVolumeAssets.dispose().

import { describe, it, expect, vi, afterEach } from 'vitest';
// @ts-expect-error — node:fs available in vitest via happy-dom/node
import { readFileSync } from 'node:fs';
import * as THREE from 'three/webgpu';
import {
  createHumanoidView, type HumanoidView, type PrewarmReport,
} from './humanoid-view';
import type { HumanoidVolumeAssets, HumanoidVolumeManifest } from './humanoid-volume';
import type { HumanoidPoseState, HumanoidBonePose } from '../humanoid-pose';
import type { SeverRenderState } from '../humanoid-sever';
import { makeChunk } from '../gib-chunks';
import { HUMANOID_MAX_BONES } from './humanoid.wgsl';
import type { BoneWound } from '../humanoid-damage';
import type { WoundType } from '../damage';
import type { Vec3 } from '../types';

/** A minimal two-bone manifest — the view reads bones/joints/clusters/rightArm
 *  and never re-validates, so it only carries what the view consumes. */
function twoBoneManifest(): HumanoidVolumeManifest {
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  return {
    version: 1,
    kind: 'humanoid-bone-sdf',
    order: 'x-fastest-y-z',
    boneCount: 2,
    pageCount: 1,
    atlasDimensions: [8, 8, 8],
    source: {
      url: 'zombie-rigged.glb', originalFilename: 'zombie-rigged.glb',
      byteLength: 1, sha256: '0'.repeat(64), textureSha256: '0'.repeat(64),
    },
    sourceToRuntime: identity, runtimeToSource: identity,
    bake: {
      limbPitchM: 0.006, detailPitchM: 0.003, marginM: 0.012,
      jointOverlapM: 0.03, atlasPadding: 2, maxTransportPartBytes: 1,
      route: 'direct-vdb', blenderVersion: '5.2.0 LTS',
      nodeContractSha256: '0'.repeat(64), threshold: 0, adaptivity: 0,
      bandWidth: 16, maxAtlasDimension: 2048,
    },
    distance: { encoding: 'r16f-le', parts: [], combinedByteLength: 1, combinedSha256: '0'.repeat(64) },
    color: { encoding: 'rgba8', parts: [], combinedByteLength: 1, combinedSha256: '0'.repeat(64) },
    coarse: { encoding: 'f32-le', bones: [], combinedByteLength: 1, combinedSha256: '0'.repeat(64) },
    bones: [
      {
        bone: 'RightArm', jointIndex: 0, parentIndex: -1,
        offset: [2, 2, 2], dimensions: [3, 3, 3],
        boundsMin: [0, 0, 0], boundsMax: [0.02, 0.02, 0.02],
        voxelSize: [0.01, 0.01, 0.01], padding: 2, pageIndex: 0,
        occupiedBoundsMin: [0, 0, 0], occupiedBoundsMax: [0.02, 0.02, 0.02],
        fieldStats: { min: -1, max: 1, negativeCount: 1, positiveCount: 1, boundaryMin: 0.01 },
        bindToModel: identity, modelToBind: identity,
      },
      {
        bone: 'RightForeArm', jointIndex: 1, parentIndex: 0,
        offset: [6, 2, 2], dimensions: [3, 3, 3],
        boundsMin: [0, 0, 0], boundsMax: [0.02, 0.02, 0.02],
        voxelSize: [0.01, 0.01, 0.01], padding: 2, pageIndex: 0,
        occupiedBoundsMin: [0, 0, 0], occupiedBoundsMax: [0.02, 0.02, 0.02],
        fieldStats: { min: -1, max: 1, negativeCount: 1, positiveCount: 1, boundaryMin: 0.01 },
        bindToModel: identity, modelToBind: identity,
      },
    ],
    joints: [
      { parent: 'RightArm', child: 'RightForeArm', centerModel: [0, 0.01, 0], axisModel: [0, 1, 0], overlapM: 0.03 },
    ],
    clusters: [
      {
        name: 'right-arm',
        primaryBones: ['RightArm', 'RightForeArm'],
        sampleBones: ['RightArm', 'RightForeArm'],
        sweepBoundsMin: [-0.1, -0.1, -0.1],
        sweepBoundsMax: [0.1, 0.2, 0.1],
      },
    ],
    rightArm: {
      upperArm: 'RightArm', forearm: 'RightForeArm', hand: 'RightHand',
      cutPlaneLocal: [0, 1, 0, 0], cutSeed: 12648430,
      irregularityM: 0.004, rimWidthM: 0.008,
    },
  };
}

function tinyAtlas(): THREE.Data3DTexture {
  const tex = new THREE.Data3DTexture(new Uint16Array(8 * 8 * 8), 8, 8, 8);
  tex.format = THREE.RedFormat;
  tex.type = THREE.HalfFloatType;
  tex.needsUpdate = true;
  return tex;
}

function tinyColorAtlas(): THREE.Data3DTexture {
  const tex = new THREE.Data3DTexture(new Uint8Array(8 * 8 * 8 * 4), 8, 8, 8);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.needsUpdate = true;
  return tex;
}

function makeAssets(): HumanoidVolumeAssets {
  const manifest = twoBoneManifest();
  const distanceTexture = tinyAtlas();
  const colorTexture = tinyColorAtlas();
  return {
    manifest,
    distanceTexture,
    colorTexture,
    coarse: {
      bones: [],
      combinedByteLength: 0,
      combinedSha256: '0'.repeat(64),
      dispose() {},
    },
    boneIndex: new Map(manifest.bones.map((b, i) => [b.bone, i])),
    dispose() { distanceTexture.dispose(); colorTexture.dispose(); },
  };
}

function poseState(): HumanoidPoseState {
  return {
    elbowTargetDeg: 0, elbowDeg: 0, elbowVelocityDeg: 0,
    softness01: 0, timeSec: 0,
    bones: [
      { position: [0, 0, 0], quaternion: [0, 0, 0, 1] },
      { position: [0, 0.1, 0], quaternion: [0, 0, 0, 1] },
    ],
    elbowAxis: [0, 0, 1], elbowPivot: [0, 0, 0], distalIndices: [1],
  };
}

const severed: SeverRenderState = {
  attachedCutMode: 'proximal',
  detachedCutMode: 'distal',
  cutPlaneLocal: [0, 1, 0, 0],
  detachedVisible: true,
  jiggleImpulse: 0,
};

const intact: SeverRenderState = {
  attachedCutMode: 'none',
  detachedCutMode: 'none',
  cutPlaneLocal: [0, 1, 0, 0],
  detachedVisible: false,
  jiggleImpulse: 0,
};

describe('createHumanoidView lifecycle', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('creates one attached group, one hidden detached group, and every cluster mesh at load', () => {
    const view = createHumanoidView(makeAssets());
    expect(view.attachedGroup.children).toHaveLength(1); // the one cluster proxy
    expect(view.detachedGroup.children).toHaveLength(1); // the hidden detached proxy
    expect(view.attachedGroup.visible).toBe(true);
    expect(view.detachedGroup.visible).toBe(false);
    expect(view.detachedVisible).toBe(false);
    const r = view.resourceCounts();
    expect(r.attachedClusters).toBe(1);
    expect(r.detachedClusters).toBe(1);
    expect(r.materials).toBe(2); // one cluster + one detached
    view.dispose();
  });

  it('mutates data rather than identity across setPose, and keeps the material count stable', () => {
    const view = createHumanoidView(makeAssets());
    const before = view.resourceCounts();
    const mesh0 = view.attachedGroup.children[0]!;
    const geo0 = (mesh0 as THREE.Mesh).geometry;
    const mat0 = (mesh0 as THREE.Mesh).material;
    view.setPose(poseState());
    view.setPose({ ...poseState(), elbowDeg: 50, softness01: 0.5 });
    view.setSoftness(0.4);
    view.setTime(1.5);
    // Same object identities — nothing was replaced.
    expect(view.attachedGroup.children[0]).toBe(mesh0);
    expect((mesh0 as THREE.Mesh).geometry).toBe(geo0);
    expect((mesh0 as THREE.Mesh).material).toBe(mat0);
    expect(view.resourceCounts()).toEqual(before);
    view.dispose();
  });

  it('setCut toggles the detached proxy and stores the cut modes', () => {
    const view = createHumanoidView(makeAssets());
    view.setCut(severed);
    expect(view.detachedVisible).toBe(true);
    expect(view.detachedGroup.visible).toBe(true);
    expect(view.attachedCutMode).toBe('proximal');
    expect(view.detachedCutMode).toBe('distal');
    view.setDetachedTransform([1, 0, 0], [0, 0, 0, 1]);
    view.dispose();
  });

  it('dispose releases each view-owned texture/geometry/material exactly once and never the shared atlases', () => {
    const dataSpy = vi.spyOn(THREE.DataTexture.prototype, 'dispose');
    const geoSpy = vi.spyOn(THREE.BoxGeometry.prototype, 'dispose');
    const matSpy = vi.spyOn(THREE.MeshBasicNodeMaterial.prototype, 'dispose');
    const atlasSpy = vi.spyOn(THREE.Data3DTexture.prototype, 'dispose');

    const assets = makeAssets();
    const view = createHumanoidView(assets);
    view.dispose();
    view.dispose(); // idempotent — second call releases nothing more

    expect(dataSpy).toHaveBeenCalledTimes(1);   // the descriptor texture
    expect(geoSpy).toHaveBeenCalledTimes(2);    // one geometry per proxy (2 proxies)
    expect(matSpy).toHaveBeenCalledTimes(2);    // one material per proxy
    expect(atlasSpy).not.toHaveBeenCalled();    // atlases are NOT view-owned

    // The shared atlases belong to the assets alone.
    assets.dispose();
    expect(atlasSpy).toHaveBeenCalledTimes(2);  // distance + colour, exactly once
    view.dispose();
  });

  it('sizes the proxy from the cluster sweep bounds', () => {
    const view = createHumanoidView(makeAssets());
    const mesh = view.attachedGroup.children[0] as THREE.Mesh;
    const geo = mesh.geometry as THREE.BoxGeometry;
    const s = geo.parameters!;
    // sweepBounds [(-0.1,-0.1,-0.1)..(0.1,0.2,0.1)] + softness amp padding.
    expect(s.width).toBeCloseTo(0.2 + 2 * 0.008, 6);
    expect(s.height).toBeCloseTo(0.3 + 2 * 0.008, 6);
    expect(s.depth).toBeCloseTo(0.2 + 2 * 0.008, 6);
    view.dispose();
  });

  it('warmupObjects returns every proxy, attached and detached', () => {
    const view = createHumanoidView(makeAssets());
    const objs = view.warmupObjects();
    expect(objs).toHaveLength(2);
    expect(objs).toContain(view.attachedGroup.children[0]);
    expect(objs).toContain(view.detachedGroup.children[0]);
    view.dispose();
  });

  it('does not exceed the padded bone-column budget', () => {
    // The data texture is HUMANOID_MAX_BONES wide; a two-bone manifest must fit.
    const assets = makeAssets();
    expect(assets.manifest.bones.length).toBeLessThanOrEqual(HUMANOID_MAX_BONES);
    const view = createHumanoidView(assets);
    view.setPose(poseState());
    view.dispose();
  });

  it('setCut + setDetachedChunk keep resource counts constant and flip the cut modes', () => {
    const view = createHumanoidView(makeAssets());
    const before = view.resourceCounts();
    // The two-bone manifest has exactly one distal bone (RightForeArm).
    const chunk = makeChunk(
      'armR', [0.3, 0.2, 0.1], [0, 0, 0], 0.04, [0, 1, 0], () => 0.5, 'limb',
    );
    const frozenBones: readonly HumanoidBonePose[] = [
      { position: [0, 0, 0], quaternion: [0, 0, 0, 1] },
    ];
    view.setCut(severed);
    view.setDetachedChunk(chunk, frozenBones);
    const after = view.resourceCounts();
    expect(after).toEqual(before);
    expect(view.detachedVisible).toBe(true);
    expect(view.attachedCutMode).toBe('proximal');
    expect(view.detachedCutMode).toBe('distal');
    view.dispose();
  });

  it('reset hides/re-parks without disposal and repeated sever/reset cycles stay constant', () => {
    const view = createHumanoidView(makeAssets());
    const before = view.resourceCounts();
    const chunk = makeChunk(
      'armR', [0.3, 0.2, 0.1], [0, 0, 0], 0.04, [0, 1, 0], () => 0.5, 'limb',
    );
    const frozenBones: readonly HumanoidBonePose[] = [
      { position: [0, 0, 0], quaternion: [0, 0, 0, 1] },
    ];
    for (let i = 0; i < 3; i++) {
      view.setCut(severed);
      view.setDetachedChunk(chunk, frozenBones);
      view.setCut(intact);
    }
    expect(view.resourceCounts()).toEqual(before);
    expect(view.detachedVisible).toBe(false);
    expect(view.detachedGroup.visible).toBe(false);
    expect(view.attachedCutMode).toBe('none');
    expect(view.detachedCutMode).toBe('none');
    view.dispose();
  });

  it('prewarm compiles attached and detached once each and reports stable material counts', async () => {
    const view = createHumanoidView(makeAssets());
    const renderer = {
      compileAsync: vi.fn().mockResolvedValue(undefined),
      render: vi.fn(),
    };
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    scene.add(view.attachedGroup);
    scene.add(view.detachedGroup);

    const report: PrewarmReport = await view.prewarm(renderer, scene, camera);

    expect(renderer.compileAsync).toHaveBeenCalledTimes(2);
    expect(renderer.compileAsync).toHaveBeenNthCalledWith(1, view.attachedGroup, camera, scene);
    expect(renderer.compileAsync).toHaveBeenNthCalledWith(2, view.detachedGroup, camera, scene);
    expect(renderer.render).toHaveBeenCalledTimes(1);
    expect(renderer.render).toHaveBeenCalledWith(scene, camera);
    expect(report.materialCountBefore).toBe(report.materialCountAfter);
    expect(report.compileCallsAfter).toBe(report.compileCallsBefore + 2);
    expect(report.renderedAttached).toBe(true);
    expect(report.renderedDetached).toBe(true);
    expect(report.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(view.resourceCounts().compileCalls).toBe(2);
    // Hidden state is restored: the detached proxy is parked back out of view.
    expect(view.detachedGroup.visible).toBe(false);
    view.dispose();
  });

  it('only prewarm increments compileCalls; sever/reset/setPose never do', () => {
    const view = createHumanoidView(makeAssets());
    expect(view.resourceCounts().compileCalls).toBe(0);
    view.setPose(poseState());
    view.setCut(severed);
    view.setCut(intact);
    expect(view.resourceCounts().compileCalls).toBe(0);
    view.dispose();
  });
});

describe('setWounds uploads without allocating', () => {
  const wound = (boneIdx: number, local: Vec3, type: WoundType = 'pellet'): BoneWound => ({
    boneIdx, local, radius: 0.055, type, ageSec: 0,
  });

  it('imports writeWounds from zombie-gpu and never defines its own texel writer', () => {
    const src = readFileSync('src/lab/sdf-zombie/webgpu/humanoid-view.ts', 'utf8');
    expect(src).toContain("import { writeWounds } from './zombie-gpu'");
    expect(src).toContain('writeWounds(texels');
    expect(src).not.toMatch(/\bfunction writeWounds\b/);
  });

  it('leaves resourceCounts() bit-identical across 0, 6 and 12 logical wounds', () => {
    const view = createHumanoidView(makeAssets());
    view.setPose(poseState());
    const before = view.resourceCounts();

    // 0 wounds.
    view.setWounds({ attached: [], detached: [] });
    expect(view.resourceCounts()).toEqual(before);

    // 6 attached wounds (non-distal bone 0).
    const sixAttached = Array.from({ length: 6 }, (_, i) => wound(0, [0.001 * i, 0, 0]));
    view.setWounds({ attached: sixAttached, detached: [] });
    expect(view.resourceCounts()).toEqual(before);

    // 6 more detached wounds (distal bone 1) riding a chunk-composed pose.
    const chunk = makeChunk('armR', [0.3, 0.2, 0.1], [0, 0, 0], 0.04, [0, 1, 0], () => 0.5, 'limb');
    view.setDetachedChunk(chunk, [{ position: [0, 0, 0], quaternion: [0, 0, 0, 1] }]);
    const sixDetached = Array.from({ length: 6 }, (_, i) => wound(1, [0.001 * i, 0, 0]));
    view.setWounds({ attached: sixAttached, detached: sixDetached });
    expect(view.resourceCounts()).toEqual(before);
    view.dispose();
  });

  it('never creates a pipeline, material or texture by taking a wound', () => {
    const view = createHumanoidView(makeAssets());
    view.setPose(poseState());
    const before = view.resourceCounts();
    const list = Array.from({ length: 12 }, (_, i) => wound(i % 2, [0.001 * i, 0, 0]));
    view.setWounds({
      attached: list.filter(w => w.boneIdx === 0),
      detached: list.filter(w => w.boneIdx === 1),
    });
    const after = view.resourceCounts();
    expect(after.materials).toBe(before.materials);
    expect(after.geometries).toBe(before.geometries);
    expect(after.textures).toBe(before.textures);
    expect(after.compileCalls).toBe(before.compileCalls);
    view.dispose();
  });
});
