// src/lab/sdf-zombie/webgpu/humanoid-spike-main.test.ts
//
// Task 7 Step 1 — the DOM-free spike controller contract. Every test here
// runs without WebGPU: the controller drives a structural SpikeViewLike stub
// and the pure pose/sever modules, so the automation contract
// (HumanoidSpikeStatus / HumanoidSpikeApi / Window.__humanoidSdfSpike) is
// pinned in Vitest and the page bootstrap stays an integration concern for
// the CDP verifier.
//
// Pinned behaviours (plan Task 7 Step 1): controls clamp values; sever
// refuses before ready/prewarm and in the failed state; sever succeeds once
// per reset; pause/reset wiring; error state; DOM button disabled state
// through the controller adapter.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { HumanoidVolumeManifest, HumanoidCoarseBricks, HumanoidCoarseBrick } from './humanoid-volume';
import type { HumanoidResourceCounts, PrewarmReport } from './humanoid-view';
import type { SeverRenderState } from '../humanoid-sever';
import type { HumanoidBonePose, HumanoidPoseState } from '../humanoid-pose';
import type { WoundUploadLists } from '../humanoid-damage';
import type { Chunk } from '../gib-chunks';
import type { Vec3 } from '../types';
import {
  HumanoidSpikeController,
  SpikeDomAdapter,
  createHumanoidSpikeApi,
  DEFAULT_RELEASE_VELOCITY,
  type HumanoidSpikeStatus,
  type SpikeViewLike,
} from './humanoid-spike-main';

/** A minimal right-arm-chain manifest — the controller feeds it to the pure
 *  pose/sever modules, which read bones/joints/rightArm/occupiedBounds and
 *  never re-validate. Includes `RightHand` because the pose module's
 *  flexion-axis derivation reads `rightArm.hand` (a real bone origin). */
function armChainManifest(): HumanoidVolumeManifest {
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  return {
    version: 1,
    kind: 'humanoid-bone-sdf',
    order: 'x-fastest-y-z',
    boneCount: 3,
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
        bindToModel: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1, 0, 1],
        modelToBind: identity,
      },
      {
        bone: 'RightHand', jointIndex: 2, parentIndex: 1,
        offset: [10, 2, 2], dimensions: [3, 3, 3],
        boundsMin: [0, 0, 0], boundsMax: [0.02, 0.02, 0.02],
        voxelSize: [0.01, 0.01, 0.01], padding: 2, pageIndex: 0,
        occupiedBoundsMin: [0, 0, 0], occupiedBoundsMax: [0.02, 0.02, 0.02],
        fieldStats: { min: -1, max: 1, negativeCount: 1, positiveCount: 1, boundaryMin: 0.01 },
        bindToModel: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 2, 0, 1],
        modelToBind: identity,
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

const BASE_COUNTS: HumanoidResourceCounts = {
  materials: 7, geometries: 7, textures: 1,
  attachedClusters: 6, detachedClusters: 1, compileCalls: 2,
};

interface ViewStub {
  view: SpikeViewLike;
  calls: Record<'setPose' | 'setSoftness' | 'setTime' | 'setCut' | 'setWounds' | 'setDetachedChunk', number>;
  lastCut: SeverRenderState | null;
  lastWounds: WoundUploadLists | null;
  lastChunk: { chunk: Chunk; frozen: readonly HumanoidBonePose[] } | null;
}

/** Records every call so tests can assert the controller drove the view. */
function makeViewStub(): ViewStub {
  const calls: ViewStub['calls'] = {
    setPose: 0, setSoftness: 0, setTime: 0, setCut: 0, setWounds: 0, setDetachedChunk: 0,
  };
  const stub: ViewStub = {
    calls,
    lastCut: null,
    lastWounds: null,
    lastChunk: null,
    view: {
      setPose: (_state: HumanoidPoseState) => { calls.setPose++; },
      setSoftness: () => { calls.setSoftness++; },
      setTime: () => { calls.setTime++; },
      setCut: (s: SeverRenderState) => { calls.setCut++; stub.lastCut = s; },
      setWounds: (lists: WoundUploadLists) => { calls.setWounds++; stub.lastWounds = lists; },
      setDetachedChunk: (chunk: Chunk, frozen: readonly HumanoidBonePose[]) => {
        calls.setDetachedChunk++; stub.lastChunk = { chunk, frozen };
      },
      resourceCounts: () => ({ ...BASE_COUNTS }),
    },
  };
  return stub;
}

function makePrewarmReport(): PrewarmReport {
  return {
    materialCountBefore: 7, materialCountAfter: 7,
    compileCallsBefore: 0, compileCallsAfter: 2,
    renderedAttached: true, renderedDetached: true, elapsedMs: 42,
  };
}

function makeReady(
  manifest: HumanoidVolumeManifest = armChainManifest(),
  backend = 'webgpu',
): { controller: HumanoidSpikeController; stub: ViewStub } {
  const stub = makeViewStub();
  const controller = new HumanoidSpikeController(manifest, stub.view, { backend });
  controller.markPrewarming();
  controller.markReady(makePrewarmReport());
  return { controller, stub };
}

describe('HumanoidSpikeController — automation contract', () => {
  let manifest: HumanoidVolumeManifest;
  let stub: ViewStub;

  beforeEach(() => {
    manifest = armChainManifest();
    stub = makeViewStub();
  });

  it('status() returns a fresh snapshot object per call', () => {
    const controller = new HumanoidSpikeController(manifest, stub.view, { backend: 'webgpu' });
    const a = controller.status();
    const b = controller.status();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
    expect(a.phase).toBe('loading');
    expect(a.severPhase).toBe('intact');
    expect(a.elbowDeg).toBe(0);
    expect(a.elbowTargetDeg).toBe(0);
    expect(a.softness01).toBe(0);
    expect(a.physicsPaused).toBe(false);
    expect(a.error).toBeNull();
    expect(a.prewarm).toBeNull();
  });

  it('resourceCounts() forwards the view counts by identity, no derivation', () => {
    const { controller, stub } = makeReady(manifest);
    const counts = stub.view.resourceCounts();
    expect(controller.resourceCounts()).toEqual(counts);
    expect(controller.resourceCounts()).toEqual(BASE_COUNTS);
    // The controller must not have walked the scene: nothing else changes.
    expect(stub.calls.setPose).toBeGreaterThanOrEqual(1);
  });

  it('clamps elbow to 0..100 and softness to 0..1, NaN to the safe default', () => {
    const controller = new HumanoidSpikeController(manifest, stub.view, { backend: 'webgpu' });
    controller.setElbow(150);
    expect(controller.status().elbowTargetDeg).toBe(100);
    controller.setElbow(-20);
    expect(controller.status().elbowTargetDeg).toBe(0);
    controller.setElbow(Number.NaN);
    expect(controller.status().elbowTargetDeg).toBe(0);
    controller.setSoftness(1.5);
    expect(controller.status().softness01).toBe(1);
    controller.setSoftness(-0.5);
    expect(controller.status().softness01).toBe(0);
    controller.setSoftness(Number.NaN);
    expect(controller.status().softness01).toBe(0);
  });

  it('sever refuses before ready and while prewarming', () => {
    const controller = new HumanoidSpikeController(manifest, stub.view, { backend: 'webgpu' });
    expect(controller.severEnabled).toBe(false);
    expect(controller.sever()).toBe(false);
    controller.markPrewarming();
    expect(controller.status().phase).toBe('prewarming');
    expect(controller.sever()).toBe(false);
    expect(controller.status().severPhase).toBe('intact');
  });

  it('sever succeeds exactly once per reset, then refuses until reset', () => {
    const { controller } = makeReady(manifest);
    expect(controller.severEnabled).toBe(true);
    expect(controller.sever()).toBe(true);
    expect(controller.status().severPhase).toBe('detached');
    expect(controller.severEnabled).toBe(false);
    expect(controller.sever()).toBe(false);
    // The second call must not have advanced the release count.
    expect(controller.status().severPhase).toBe('detached');
    controller.reset();
    expect(controller.status().severPhase).toBe('intact');
    expect(controller.severEnabled).toBe(true);
    expect(controller.sever()).toBe(true);
  });

  it('sever drives the view synchronously with the complementary cut', () => {
    const { controller, stub } = makeReady(manifest);
    expect(controller.sever()).toBe(true);
    expect(stub.lastCut).not.toBeNull();
    expect(stub.lastCut!.attachedCutMode).toBe('proximal');
    expect(stub.lastCut!.detachedCutMode).toBe('distal');
    expect(stub.lastCut!.detachedVisible).toBe(true);
    expect(stub.lastChunk).not.toBeNull();
    expect(stub.lastChunk!.chunk.limb).toBe('armR');
    expect(stub.lastChunk!.frozen.length).toBe(2); // RightForeArm + RightHand
    expect(controller.resourceCounts()).toEqual(BASE_COUNTS);
  });

  it('reset restores the intact render state through the view', () => {
    const { controller, stub } = makeReady(manifest);
    controller.sever();
    controller.reset();
    expect(stub.lastCut!.attachedCutMode).toBe('none');
    expect(stub.lastCut!.detachedCutMode).toBe('none');
    expect(stub.lastCut!.detachedVisible).toBe(false);
  });

  it('pause freezes the detached chunk; unpause resumes it', () => {
    const { controller } = makeReady(manifest);
    expect(controller.sever()).toBe(true);
    controller.setPhysicsPaused(true);
    expect(controller.status().physicsPaused).toBe(true);
    const before = controller.diagnostics().chunkPos;
    for (let i = 0; i < 5; i++) controller.step(1 / 60);
    const during = controller.diagnostics().chunkPos;
    expect(during).toEqual(before);
    controller.setPhysicsPaused(false);
    // The launch impulse is upward (1.8 m/s) — gravity wins after the peak
    // (~0.18 s); by 0.75 s the piece is falling (and lands on the floor).
    for (let i = 0; i < 45; i++) controller.step(1 / 60);
    const after = controller.diagnostics().chunkPos;
    expect(after![1]).toBeLessThan(before![1]); // gravity pulled it down
  });

  it('error state is terminal and disables sever', () => {
    const { controller } = makeReady(manifest);
    controller.fail(new Error('boom'));
    const status = controller.status();
    expect(status.phase).toBe('failed');
    expect(status.error).toBe('boom');
    expect(controller.severEnabled).toBe(false);
    expect(controller.sever()).toBe(false);
    // Terminal: markReady cannot resurrect a failed bootstrap.
    controller.markReady(makePrewarmReport());
    expect(controller.status().phase).toBe('failed');
    expect(controller.ready).toBe(false);
  });

  it('timing() is null until enough samples, then reports median/p95/max', () => {
    const { controller } = makeReady(manifest);
    expect(controller.timing()).toBeNull();
    for (let i = 0; i < 25; i++) controller.step(1 / 60);
    const t = controller.timing();
    expect(t).not.toBeNull();
    expect(t!.samples).toBe(25);
    expect(t!.median).toBeGreaterThan(15);
    expect(t!.median).toBeLessThan(18);
    expect(t!.p95).toBeGreaterThanOrEqual(t!.median);
    expect(t!.max).toBeGreaterThanOrEqual(t!.p95);
  });

  it('step before ready does not drive the view or record timing', () => {
    const controller = new HumanoidSpikeController(manifest, stub.view, { backend: 'webgpu' });
    const before = { ...stub.calls };
    for (let i = 0; i < 10; i++) controller.step(1 / 60);
    expect(stub.calls).toEqual(before);
    expect(controller.timing()).toBeNull();
  });

  it('setCamera clamps pitch and distance to the orbit envelope', () => {
    const controller = new HumanoidSpikeController(manifest, stub.view, { backend: 'webgpu' });
    controller.setCamera(3, 5, 50);
    const cam = controller.cameraState();
    expect(cam.pitch).toBe(1.2);
    expect(cam.distance).toBe(8);
    controller.setCamera(0, -5, 0.1);
    expect(controller.cameraState().pitch).toBe(-0.4);
    expect(controller.cameraState().distance).toBe(0.9);
  });

  it('setCameraTarget repoints the orbit target and survives NaN', () => {
    const controller = new HumanoidSpikeController(manifest, stub.view, { backend: 'webgpu' });
    controller.setCameraTarget(-1, 0.1, 0.3);
    expect(controller.cameraState().targetX).toBe(-1);
    expect(controller.cameraState().targetY).toBe(0.1);
    expect(controller.cameraState().targetZ).toBe(0.3);
    controller.setCameraTarget(Number.NaN, 5, Number.NaN);
    expect(controller.cameraState().targetX).toBe(-1); // unchanged
    expect(controller.cameraState().targetY).toBe(5);
    expect(controller.cameraState().targetZ).toBe(0.3); // unchanged
  });

  it('the API surface exposes exactly the pinned contract', () => {
    const { controller } = makeReady(manifest);
    const api = createHumanoidSpikeApi(controller);
    expect(api.backend).toBe('webgpu');
    expect(api.ready).toBe(true);
    expect(api.severEnabled).toBe(true);
    api.setElbow(40);
    api.setSoftness(0.25);
    api.setPhysicsPaused(true);
    api.setCamera(0.1, -0.05, 3);
    expect(api.status().elbowTargetDeg).toBe(40);
    expect(api.status().softness01).toBe(0.25);
    expect(api.status().physicsPaused).toBe(true);
    expect(api.sever()).toBe(true);
    expect(api.resourceCounts()).toEqual(BASE_COUNTS);
    api.step(1 / 60);
    api.reset();
    expect(api.status().severPhase).toBe('intact');
  });

  it('the API surface carries the click-to-shoot entry points', () => {
    const { controller } = makeReady(manifest);
    const api = createHumanoidSpikeApi(controller);
    expect(typeof api.shoot).toBe('function');
    expect(typeof api.shootWorld).toBe('function');
    expect(typeof api.worldOnBone).toBe('function');
    // Without a camera/canvas, shoot refuses rather than throwing.
    expect(api.shoot(100, 100)).toBe(false);
    expect(api.shootWorld([0, 0, 0])).toBe(false);
    // worldOnBone resolves a known bone's occupied centre.
    const fa = api.worldOnBone('RightForeArm');
    expect(fa).not.toBeNull();
    expect(fa![1]).toBeCloseTo(1.01, 6);
    expect(api.worldOnBone('NotABone')).toBeNull();
  });
});

describe('SpikeDomAdapter — button disabled state through the controller', () => {
  function makeEls() {
    const els = {
      status: document.createElement('div'),
      elbow: document.createElement('input'),
      elbowValue: document.createElement('span'),
      softness: document.createElement('input'),
      softnessValue: document.createElement('span'),
      severBtn: document.createElement('button'),
      resetBtn: document.createElement('button'),
      pauseChk: document.createElement('input'),
    };
    els.elbow.type = 'range';
    els.softness.type = 'range';
    els.pauseChk.type = 'checkbox';
    return els;
  }

  it('controls stay disabled until ready; sever gates on intact', () => {
    const els = makeEls();
    const stub = makeViewStub();
    const controller = new HumanoidSpikeController(armChainManifest(), stub.view, { backend: 'webgpu' });
    const adapter = new SpikeDomAdapter(controller, els);

    // loading: everything disabled, sever refused.
    expect(els.severBtn.disabled).toBe(true);
    expect(els.resetBtn.disabled).toBe(true);
    expect(els.elbow.disabled).toBe(true);
    expect(els.softness.disabled).toBe(true);
    expect(els.pauseChk.disabled).toBe(true);
    expect(els.status.textContent).toContain('loading');

    // ready: controls arm, sever enabled.
    controller.markReady(makePrewarmReport());
    expect(els.severBtn.disabled).toBe(false);
    expect(els.resetBtn.disabled).toBe(false);
    expect(els.elbow.disabled).toBe(false);
    expect(els.pauseChk.disabled).toBe(false);

    // severed: sever disarms until reset.
    controller.sever();
    expect(els.severBtn.disabled).toBe(true);
    controller.reset();
    expect(els.severBtn.disabled).toBe(false);

    adapter.dispose();
  });

  it('failure surfaces a visible FAILED message and keeps sever disabled', () => {
    const els = makeEls();
    const stub = makeViewStub();
    const controller = new HumanoidSpikeController(armChainManifest(), stub.view, { backend: 'webgpu' });
    const adapter = new SpikeDomAdapter(controller, els);
    controller.markReady(makePrewarmReport());
    controller.fail(new Error('atlas corrupt'));
    expect(els.status.textContent).toContain('FAILED');
    expect(els.status.textContent).toContain('atlas corrupt');
    expect(els.status.classList.contains('failed')).toBe(true);
    expect(els.severBtn.disabled).toBe(true);
    expect(els.resetBtn.disabled).toBe(true);
    adapter.dispose();
  });

  it('slider input drives the controller through the adapter', () => {
    const els = makeEls();
    const stub = makeViewStub();
    const controller = new HumanoidSpikeController(armChainManifest(), stub.view, { backend: 'webgpu' });
    const adapter = new SpikeDomAdapter(controller, els);
    controller.markReady(makePrewarmReport());
    els.elbow.value = '55';
    els.elbow.dispatchEvent(new Event('input'));
    expect(controller.status().elbowTargetDeg).toBe(55);
    expect(els.elbowValue.textContent).toContain('55');
    els.pauseChk.checked = true;
    els.pauseChk.dispatchEvent(new Event('change'));
    expect(controller.status().physicsPaused).toBe(true);
    els.severBtn.click();
    expect(controller.status().severPhase).toBe('detached');
    els.resetBtn.click();
    expect(controller.status().severPhase).toBe('intact');
    adapter.dispose();
  });

  it('the release velocity is a fixed deterministic impulse', () => {
    expect(DEFAULT_RELEASE_VELOCITY.linear).toHaveLength(3);
    expect(DEFAULT_RELEASE_VELOCITY.angular).toHaveLength(3);
    for (const v of [...DEFAULT_RELEASE_VELOCITY.linear, ...DEFAULT_RELEASE_VELOCITY.angular]) {
      expect(Number.isFinite(v)).toBe(true);
    }
  });
});

describe('HumanoidSpikeController — click-to-shoot targeting', () => {
  /** A self-contained coarse pack: one fat sphere per bone, centred at its
   *  occupied centre, so the controller's trace lands a hit in tests. */
  function spikeCoarse(): HumanoidCoarseBricks {
    const mk = (cx: number, cy: number, cz: number): HumanoidCoarseBrick => {
      const radius = 0.02;
      const boundsMin: [number, number, number] = [cx - 0.05, cy - 0.05, cz - 0.05];
      const boundsMax: [number, number, number] = [cx + 0.05, cy + 0.05, cz + 0.05];
      const dims: [number, number, number] = [8, 8, 8];
      const data = new Float32Array(512);
      for (let z = 0; z < 8; z++) {
        for (let y = 0; y < 8; y++) {
          for (let x = 0; x < 8; x++) {
            const lx = boundsMin[0] + (boundsMax[0] - boundsMin[0]) * (x / 7);
            const ly = boundsMin[1] + (boundsMax[1] - boundsMin[1]) * (y / 7);
            const lz = boundsMin[2] + (boundsMax[2] - boundsMin[2]) * (z / 7);
            data[x + y * 8 + z * 64] = Math.hypot(lx - cx, ly - cy, lz - cz) - radius;
          }
        }
      }
      return { data, dims, boundsMin, boundsMax };
    };
    return {
      bones: [mk(0.01, 0.01, 0.01), mk(0.01, 0.01, 0.01)],
      combinedByteLength: 0, combinedSha256: '0'.repeat(64), dispose() {},
    };
  }

  function readyWithCoarse() {
    const stub = makeViewStub();
    const controller = new HumanoidSpikeController(armChainManifest(), stub.view, {
      backend: 'webgpu', coarse: spikeCoarse(),
    });
    controller.markPrewarming();
    controller.markReady(makePrewarmReport());
    return { controller, stub };
  }

  it('a shot before ready is refused and changes nothing', () => {
    const stub = makeViewStub();
    const controller = new HumanoidSpikeController(armChainManifest(), stub.view, {
      backend: 'webgpu', coarse: spikeCoarse(),
    });
    const beforeCalls = stub.calls.setWounds;
    expect(controller.shootRay([0.01, 1.01, 3], [0, 0, -1])).toBe(false);
    expect(controller.diagnostics().woundCount).toBe(0);
    expect(stub.calls.setWounds).toBe(beforeCalls);
  });

  it('a hit adds one wound, uploads it, and never changes resource counts', () => {
    const { controller, stub } = readyWithCoarse();
    const before = controller.resourceCounts();
    // The forearm centre sits at world (0.01, 1.01, 0.01); aim straight at it.
    const ok = controller.shootRay([0.01, 1.01, 3], [0, 0, -1]);
    expect(ok).toBe(true);
    expect(controller.diagnostics().woundCount).toBe(1);
    expect(controller.diagnostics().woundSlotDrops).toBe(0);
    // The wound reached the view (straddler around the cut plane: both lists).
    const union = new Set([...stub.lastWounds!.attached, ...stub.lastWounds!.detached]);
    expect(union.size).toBe(1);
    // The first shot after page load must not allocate: the prewarm gate holds.
    expect(controller.resourceCounts()).toEqual(before);
  });

  it('a miss leaves the ring empty', () => {
    const { controller } = readyWithCoarse();
    // Aim at empty space well off the tiny two-bone body.
    expect(controller.shootRay([5, 5, 5], [0, 0, -1])).toBe(false);
    expect(controller.diagnostics().woundCount).toBe(0);
  });

  it('the ring evicts oldest-first at MAX_BONE_WOUNDS', () => {
    const { controller } = readyWithCoarse();
    const origin: Vec3 = [0.01, 1.01, 3];
    const dir: Vec3 = [0, 0, -1];
    for (let i = 0; i < 20; i++) {
      expect(controller.shootRay(origin, dir)).toBe(true);
    }
    expect(controller.diagnostics().woundCount).toBe(12); // MAX_BONE_WOUNDS
  });

  it('wounds survive sever and reset untouched', () => {
    const { controller, stub } = readyWithCoarse();
    controller.shootRay([0.01, 1.01, 3], [0, 0, -1]);
    const count = controller.diagnostics().woundCount;
    controller.sever();
    expect(controller.diagnostics().woundCount).toBe(count);
    controller.reset();
    expect(controller.diagnostics().woundCount).toBe(count);
    expect(stub.calls.setWounds).toBeGreaterThan(0);
  });
});
