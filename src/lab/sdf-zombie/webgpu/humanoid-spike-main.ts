// src/lab/sdf-zombie/webgpu/humanoid-spike-main.ts
//
// Task 7 — the dedicated spike page controller + bootstrap. The page
// (humanoid-sdf-spike.html) renders the textured humanoid from its baked
// bone atlases, scrubs the right elbow 0..100 degrees, severs a physics-
// driven distal forearm with matching layered caps, and reports resource
// counts + frame timing through a pinned automation API.
//
// SPLIT. Everything that can be tested without WebGPU lives in
// HumanoidSpikeController: a DOM-free state machine over the pure Task 4
// pose/sever modules and a structural SpikeViewLike (HumanoidView satisfies
// it exactly). The bootstrap is the only place that touches WebGPU/DOM —
// createLabRenderer, loadHumanoidVolume, createHumanoidView, view.prewarm —
// and it is exercised by scripts/verify-humanoid-sdf-spike.mjs in a headed
// browser, never by Vitest.
//
// BOOTSTRAP ORDER (plan Task 7 Step 3, fixed):
//   1. create the WebGPU renderer and REJECT a non-WebGPU backend;
//   2. load/validate the real humanoid assets;
//   3. create the attached + detached views and floor/reference lighting;
//   4. await view.prewarm (the only compileCalls — sever/reset never create);
//   5. expose the enabled controls and window.__humanoidSdfSpike;
//   6. start the render/update loop.
// Every rejection surfaces a visible `FAILED: ...` message, leaves sever
// disabled, and still exposes a failed-stub __humanoidSdfSpike so the CDP
// verifier can read status().phase === 'failed'.

import * as THREE from 'three/webgpu';
import { createLabRenderer } from './lab-renderer';
import { loadHumanoidVolume, type HumanoidVolumeManifest, type HumanoidCoarseBricks } from './humanoid-volume';
import { createHumanoidView, type HumanoidResourceCounts, type PrewarmReport } from './humanoid-view';
import type { HumanoidPoseState, HumanoidBonePose } from '../humanoid-pose';
import { makeHumanoidPose, stepHumanoidPose } from '../humanoid-pose';
import type { HumanoidSeverState, SeverPhase, SeverRenderState, ReleaseVelocity } from '../humanoid-sever';
import { makeHumanoidSever, severForearm, stepHumanoidSever, resetHumanoidSever, chunkBoneWorldPose } from '../humanoid-sever';
import type { BoneWound, WoundUploadLists } from '../humanoid-damage';
import { partitionWoundsByCut, MAX_BONE_WOUNDS, woundSlotsForClusters, boneWoundWorldPos } from '../humanoid-damage';
import { WOUND_PROFILES, type WoundType } from '../damage';
import { traceHumanoidRay } from '../humanoid-target';
import type { Chunk } from '../gib-chunks';
import type { Vec3 } from '../types';
import { qRotate } from '../vec';

// ---------------------------------------------------------------------------
// Pinned automation contract (plan Task 7 Step 1)
// ---------------------------------------------------------------------------

export interface HumanoidSpikeStatus {
  phase: 'loading' | 'prewarming' | 'ready' | 'failed';
  severPhase: SeverPhase;
  elbowDeg: number;
  elbowTargetDeg: number;
  softness01: number;
  physicsPaused: boolean;
  error: string | null;
  prewarm: PrewarmReport | null;
}

export interface HumanoidSpikeApi {
  readonly backend: string;
  readonly ready: boolean;
  readonly severEnabled: boolean;
  setElbow(deg: number): void;
  setSoftness(value01: number): void;
  sever(): boolean;
  reset(): void;
  setPhysicsPaused(paused: boolean): void;
  step(dtSec: number): void;
  setCamera(yaw: number, pitch: number, distance: number): void;
  setCameraTarget(x: number, y: number, z: number): void;
  /** Aim a shot at client pixel coordinates — the page's pointer path. */
  shoot(x: number, y: number): boolean;
  /** Aim a shot through a world position (deterministic aiming for the CDP
   *  verifier's wound panels). */
  shootWorld(world: readonly [number, number, number]): boolean;
  /** Clears the wound ring (staging aid for the verifier's wound panels). */
  clearWounds(): void;
  /** World position of a bone's occupied centre (plus an optional bind-local
   *  offset), posed under the chunk root after a sever. */
  worldOnBone(boneName: string, local?: readonly [number, number, number]): [number, number, number] | null;
  status(): HumanoidSpikeStatus;
  resourceCounts(): HumanoidResourceCounts;
  timing(): { median: number; p95: number; max: number; samples: number } | null;
}

declare global {
  interface Window {
    __humanoidSdfSpike?: HumanoidSpikeApi;
  }
}

/** The structural subset of HumanoidView the controller drives. HumanoidView
 *  satisfies it exactly; tests stub it. */
export interface SpikeViewLike {
  setPose(state: HumanoidPoseState): void;
  setSoftness(value01: number): void;
  setTime(timeSec: number): void;
  setCut(state: SeverRenderState): void;
  setWounds(lists: WoundUploadLists): void;
  setDetachedChunk(chunk: Chunk, frozenDistalBones: readonly HumanoidBonePose[]): void;
  resourceCounts(): HumanoidResourceCounts;
}

/** Extra read-only diagnostics for the CDP verifier (not part of the pinned
 *  automation contract, additive only). */
export interface HumanoidSpikeDiagnostics {
  detached: boolean;
  chunkPos: [number, number, number] | null;
  grounded: boolean;
  jiggleImpulse: number;
  /** Logical wounds in the ring (0..MAX_BONE_WOUNDS). */
  woundCount: number;
  /** Slots dropped by the wound slot budget this frame — a nonzero count means
   *  the budget is wrong and must be RAISED, not silently tolerated. */
  woundSlotDrops: number;
  /** World-space unit normal of the DISTAL cut surface (the piece's cap),
   *  tumbling with the chunk — the verifier polls it to catch a cap-facing
   *  flight frame. Computed exactly as the shader does: the cut plane normal
   *  rotated by the forearm's posed quaternion under the chunk root. */
  capNormal: [number, number, number] | null;
  camera: {
    yaw: number; pitch: number; distance: number;
    targetX: number; targetY: number; targetZ: number;
  };
}

export interface HumanoidSpikeOptions {
  backend: string;
  initialElbowDeg?: number;
  initialSoftness01?: number;
  /** The coarse CPU brick pack (click-to-shoot). Omitted in DOM-free unit
   *  tests; a controller without it simply can never land a hit. */
  coarse?: HumanoidCoarseBricks;
}

/** The fixed deterministic release impulse: the severed forearm flies away
 *  from the torso (+X is the zombie's right side, opposite the right arm at
 *  -X), upward and slightly toward the camera. The angular velocity is
 *  CHOSEN so the distal cap sweeps through a camera-facing orientation at
 *  ~0.47 s (simulated: dot(capNormal, camDir) = 1.0) — the flight capture
 *  shows the complementary cut surface face-on. Same every sever/reset
 *  cycle, so captures are reproducible. */
export const DEFAULT_RELEASE_VELOCITY: ReleaseVelocity = {
  linear: [-1.5, 1.8, 0.45],
  angular: [1.4, -3.5, -0.8],
};

const ELBOW_MIN_DEG = 0;
const ELBOW_MAX_DEG = 100;
const CAM_PITCH_MIN = -0.4;
const CAM_PITCH_MAX = 1.2;
const CAM_DIST_MIN = 0.9;
const CAM_DIST_MAX = 8;
const TIMING_WINDOW = 120;
const TIMING_MIN_SAMPLES = 20;

function clampDeg(v: number): number {
  if (!Number.isFinite(v)) return ELBOW_MIN_DEG;
  return Math.min(ELBOW_MAX_DEG, Math.max(ELBOW_MIN_DEG, v));
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, v));
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ---------------------------------------------------------------------------
// Controller — DOM-free, WebGPU-free, fully testable
// ---------------------------------------------------------------------------

export class HumanoidSpikeController {
  readonly backend: string;

  private readonly manifest: HumanoidVolumeManifest;
  private readonly view: SpikeViewLike;
  private readonly coarse: HumanoidCoarseBricks | null;
  private phase: HumanoidSpikeStatus['phase'] = 'loading';
  private error: string | null = null;
  private prewarmReport: PrewarmReport | null = null;

  private pose: HumanoidPoseState;
  private severState: HumanoidSeverState;
  private _physicsPaused = false;
  private _elbowTargetDeg: number;
  private _softness01: number;
  /** The one authoritative wound ring (bone-local). Derived per frame, never
   *  migrated at the sever frame — reset stays a no-op on it. */
  private wounds: BoneWound[] = [];
  /** Slots dropped by the wound slot budget in the last derived layout. */
  private _woundSlotDrops = 0;

  private camera = { yaw: 0.35, pitch: 0.12, distance: 2.4, targetX: 0, targetY: 0.95, targetZ: 0 };

  /** Rolling loop frame intervals (ms), only while ready. */
  private readonly frames: number[] = [];
  private readonly listeners = new Set<() => void>();

  constructor(
    manifest: HumanoidVolumeManifest,
    view: SpikeViewLike,
    opts: HumanoidSpikeOptions,
  ) {
    this.manifest = manifest;
    this.view = view;
    this.coarse = opts.coarse ?? null;
    this.backend = opts.backend;
    this._elbowTargetDeg = clampDeg(opts.initialElbowDeg ?? 0);
    this._softness01 = clamp01(opts.initialSoftness01 ?? 0);
    this.pose = makeHumanoidPose(manifest, {
      elbowDeg: this._elbowTargetDeg, softness01: this._softness01,
    });
    this.severState = makeHumanoidSever(manifest);
    this.applyView();
  }

  // -- read-only state -------------------------------------------------------

  get ready(): boolean { return this.phase === 'ready'; }
  get severEnabled(): boolean { return this.ready && this.severState.phase === 'intact'; }
  get severPhase(): SeverPhase { return this.severState.phase; }
  get elbowDeg(): number { return this.pose.elbowDeg; }
  get elbowTargetDeg(): number { return this._elbowTargetDeg; }
  get softness01(): number { return this._softness01; }
  get physicsPaused(): boolean { return this._physicsPaused; }
  get prewarm(): PrewarmReport | null { return this.prewarmReport; }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private notify(): void {
    for (const l of this.listeners) l();
  }

  // -- lifecycle transitions (bootstrap calls these) -------------------------

  markPrewarming(): void {
    if (this.phase === 'loading') {
      this.phase = 'prewarming';
      this.notify();
    }
  }

  markReady(report: PrewarmReport): void {
    if (this.phase === 'failed') return; // terminal
    this.phase = 'ready';
    this.prewarmReport = report;
    this.notify();
  }

  /** Terminal: a failed bootstrap never resurrects. */
  fail(err: unknown): void {
    this.phase = 'failed';
    this.error = errorMessage(err);
    this.notify();
  }

  // -- controls --------------------------------------------------------------

  setElbow(deg: number): void {
    this._elbowTargetDeg = clampDeg(deg);
    this.notify();
  }

  setSoftness(value01: number): void {
    this._softness01 = clamp01(value01);
    this.notify();
  }

  setPhysicsPaused(paused: boolean): void {
    this._physicsPaused = !!paused;
    this.notify();
  }

  setCamera(yaw: number, pitch: number, distance: number): void {
    if (!Number.isFinite(yaw)) yaw = this.camera.yaw;
    if (!Number.isFinite(pitch)) pitch = this.camera.pitch;
    if (!Number.isFinite(distance)) distance = this.camera.distance;
    this.camera.yaw = yaw;
    this.camera.pitch = Math.min(CAM_PITCH_MAX, Math.max(CAM_PITCH_MIN, pitch));
    this.camera.distance = Math.min(CAM_DIST_MAX, Math.max(CAM_DIST_MIN, distance));
    this.notify();
  }

  /** Repoints the orbit target (additive — the verifier frames the settled
   *  detached piece by aiming at it before panel 17). */
  setCameraTarget(x: number, y: number, z: number): void {
    if (!Number.isFinite(x)) x = this.camera.targetX;
    if (!Number.isFinite(y)) y = this.camera.targetY;
    if (!Number.isFinite(z)) z = this.camera.targetZ;
    this.camera.targetX = x;
    this.camera.targetY = y;
    this.camera.targetZ = z;
    this.notify();
  }

  /** Exactly-once per reset: the FIRST call severs, later calls refuse until
   *  reset(). Applies the complementary cut + chunk to the view synchronously
   *  so the very next rendered frame shows the severed forearm. */
  sever(): boolean {
    if (!this.severEnabled) return false;
    this.severState = severForearm(this.severState, this.pose, DEFAULT_RELEASE_VELOCITY);
    this.applyView();
    this.notify();
    return true;
  }

  /** Re-arms the sever control and re-poses the rig from the current
   *  elbow/softness targets. Pure state transitions; no resources created. */
  reset(): void {
    this.severState = resetHumanoidSever(this.severState);
    this.pose = makeHumanoidPose(this.manifest, {
      elbowDeg: this._elbowTargetDeg, softness01: this._softness01,
    });
    this.applyView();
    this.notify();
  }

  /** One frame: elbow spring, sever physics (frozen while paused), view
   *  uploads. No-op before ready — the loop runs during load/prewarm too. */
  step(dtSec: number): void {
    if (this.phase !== 'ready') return;
    if (Number.isFinite(dtSec) && dtSec > 0) {
      this.frames.push(dtSec * 1000);
      if (this.frames.length > TIMING_WINDOW) this.frames.shift();
    }
    this.pose = stepHumanoidPose(this.pose, {
      elbowTargetDeg: this._elbowTargetDeg, softness01: this._softness01,
    }, dtSec);
    this.severState = stepHumanoidSever(this.severState, dtSec, this._physicsPaused);
    this.applyView();
    this.notify();
  }

  /** Pushes the current pose/sever/wound state into the view. Called from the
   *  constructor, sever, reset, shoot and every step. */
  private applyView(): void {
    this.view.setPose(this.pose);
    this.view.setSoftness(this._softness01);
    this.view.setTime(this.pose.timeSec);
    this.view.setCut(this.severState.render);
    if (this.severState.phase === 'detached' && this.severState.chunk) {
      this.view.setDetachedChunk(this.severState.chunk, this.severState.frozenDistalBones);
    }
    const lists = this.deriveWoundLists();
    this.view.setWounds(lists);
    this._woundSlotDrops = this.computeSlotDrops(lists);
  }

  /** The one authoritative ring, split into the attached/detached upload lists
   *  around the baked cut plane (straddlers duplicated). Derived per frame. */
  private deriveWoundLists(): WoundUploadLists {
    return partitionWoundsByCut(this.manifest, this.wounds, this.pose.distalIndices);
  }

  /** Slots the wound layout drops under MAX_WOUND_SLOTS — computed exactly as
   *  the view does (attached poses for the full ring), so the reported counter
   *  cannot drift from what the shader actually scans. */
  private computeSlotDrops(lists: WoundUploadLists): number {
    const fullRing: BoneWound[] = [...new Set([...lists.attached, ...lists.detached])];
    const fullWorld: Vec3[] = fullRing.map(w => boneWoundWorldPos(this.pose.bones[w.boneIdx]!, w));
    return woundSlotsForClusters(this.manifest, fullRing, fullWorld).dropped;
  }

  /** World pose of a bone, composed under the chunk root after a sever. */
  private boneWorldPose(boneIdx: number): HumanoidBonePose {
    if (this.severState.phase === 'detached' && this.severState.chunk) {
      const k = this.pose.distalIndices.indexOf(boneIdx);
      if (k >= 0) return chunkBoneWorldPose(this.severState.chunk, this.severState.frozenDistalBones[k]!);
    }
    return this.pose.bones[boneIdx]!;
  }

  /** Traces the coarse field and, on a hit, stamps one wound on the owning
   *  bone brick. Pure apart from appending to the ring — no pipeline, no
   *  texture, no view allocation, so `resourceCounts()` never changes. */
  shootRay(origin: Vec3, dir: Vec3, type: WoundType = 'pellet'): boolean {
    if (this.phase !== 'ready') return false;
    if (!this.coarse) return false;
    const hit = traceHumanoidRay(this.manifest, this.coarse, this.pose, this.severState, origin, dir);
    if (!hit) return false;
    const wound: BoneWound = {
      boneIdx: hit.boneIdx,
      local: hit.local,
      radius: WOUND_PROFILES[type].radius,
      type,
      ageSec: 0,
    };
    // Ring append with oldest-first eviction — the same contract as
    // damage.ts's pushWound, but the ring holds BoneWound, so the append is
    // inlined rather than re-typed (damage.ts is outside this task's files).
    const next = [...this.wounds, wound];
    this.wounds = next.length > MAX_BONE_WOUNDS ? next.slice(next.length - MAX_BONE_WOUNDS) : next;
    this.applyView();
    this.notify();
    return true;
  }

  /** Clears the wound ring and re-uploads an empty layout. Additive to the
   *  pinned contract — the verifier needs it to stage each wound panel. */
  clearWounds(): void {
    this.wounds = [];
    this.applyView();
    this.notify();
  }

  /** World position of a bone's occupied centre (or a specific bind-local
   *  offset from the bind origin), posed under the chunk root after a sever. */
  worldOnBone(boneName: string, local?: readonly [number, number, number]): [number, number, number] | null {
    const boneIdx = this.manifest.bones.findIndex(b => b.bone === boneName);
    if (boneIdx < 0) return null;
    const b = this.manifest.bones[boneIdx]!;
    const offset: Vec3 = local ?? [
      (b.occupiedBoundsMin[0] + b.occupiedBoundsMax[0]) / 2,
      (b.occupiedBoundsMin[1] + b.occupiedBoundsMax[1]) / 2,
      (b.occupiedBoundsMin[2] + b.occupiedBoundsMax[2]) / 2,
    ];
    const pose = this.boneWorldPose(boneIdx);
    const p = qRotate(pose.quaternion, offset);
    return [pose.position[0] + p[0], pose.position[1] + p[1], pose.position[2] + p[2]];
  }

  // -- reporting -------------------------------------------------------------

  status(): HumanoidSpikeStatus {
    return {
      phase: this.phase,
      severPhase: this.severState.phase,
      elbowDeg: this.pose.elbowDeg,
      elbowTargetDeg: this._elbowTargetDeg,
      softness01: this._softness01,
      physicsPaused: this._physicsPaused,
      error: this.error,
      prewarm: this.prewarmReport,
    };
  }

  /** Forwards the view's exact counts — no scene traversal here. */
  resourceCounts(): HumanoidResourceCounts {
    return this.view.resourceCounts();
  }

  timing(): { median: number; p95: number; max: number; samples: number } | null {
    if (this.frames.length < TIMING_MIN_SAMPLES) return null;
    const sorted = [...this.frames].sort((a, b) => a - b);
    return {
      median: sorted[Math.floor(sorted.length * 0.5)]!,
      p95: sorted[Math.floor(sorted.length * 0.95)]!,
      max: sorted[sorted.length - 1]!,
      samples: this.frames.length,
    };
  }

  diagnostics(): HumanoidSpikeDiagnostics {
    const chunk = this.severState.phase === 'detached' ? this.severState.chunk : null;
    let capNormal: [number, number, number] | null = null;
    if (chunk && this.severState.frozenDistalBones[0]) {
      const worldQ = chunkBoneWorldPose(chunk, this.severState.frozenDistalBones[0]).quaternion;
      const [nx, ny, nz] = this.severState.render.cutPlaneLocal;
      capNormal = qRotate(worldQ, [nx, ny, nz]) as [number, number, number];
    }
    return {
      detached: this.severState.phase === 'detached',
      chunkPos: chunk ? [...chunk.pos] as [number, number, number] : null,
      grounded: chunk !== null && chunk.pos[1] <= chunk.radius + 1e-9,
      jiggleImpulse: this.severState.render.jiggleImpulse,
      woundCount: this.wounds.length,
      woundSlotDrops: this._woundSlotDrops,
      capNormal,
      camera: { ...this.camera },
    };
  }

  cameraState() {
    return { ...this.camera };
  }
}

/** The pinned automation surface over a controller. `camera`/`canvas` are the
 *  DOM/WebGPU glue for `shoot` (client pixel -> ray); pass null in unit tests
 *  (then `shoot` simply refuses, while `shootWorld` needs only the camera). */
export function createHumanoidSpikeApi(
  controller: HumanoidSpikeController,
  camera: THREE.PerspectiveCamera | null = null,
  canvas: HTMLCanvasElement | null = null,
): HumanoidSpikeApi {
  const rayFromScreen = (x: number, y: number): { origin: Vec3; dir: Vec3 } | null => {
    if (!camera || !canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const ndcX = ((x - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((y - rect.top) / rect.height) * 2 + 1;
    const v = new THREE.Vector3(ndcX, ndcY, 0.5).unproject(camera);
    const d = v.sub(camera.position).normalize();
    return {
      origin: [camera.position.x, camera.position.y, camera.position.z],
      dir: [d.x, d.y, d.z],
    };
  };
  const rayFromWorld = (world: readonly [number, number, number]): { origin: Vec3; dir: Vec3 } | null => {
    if (!camera) return null;
    const d = new THREE.Vector3(world[0], world[1], world[2]).sub(camera.position).normalize();
    return {
      origin: [camera.position.x, camera.position.y, camera.position.z],
      dir: [d.x, d.y, d.z],
    };
  };
  return {
    backend: controller.backend,
    get ready() { return controller.ready; },
    get severEnabled() { return controller.severEnabled; },
    setElbow: (deg) => controller.setElbow(deg),
    setSoftness: (value01) => controller.setSoftness(value01),
    sever: () => controller.sever(),
    reset: () => controller.reset(),
    setPhysicsPaused: (paused) => controller.setPhysicsPaused(paused),
    step: (dtSec) => controller.step(dtSec),
    setCamera: (yaw, pitch, distance) => controller.setCamera(yaw, pitch, distance),
    setCameraTarget: (x, y, z) => controller.setCameraTarget(x, y, z),
    shoot: (x, y) => {
      const r = rayFromScreen(x, y);
      return r ? controller.shootRay(r.origin, r.dir) : false;
    },
    shootWorld: (world) => {
      const r = rayFromWorld(world);
      return r ? controller.shootRay(r.origin, r.dir) : false;
    },
    clearWounds: () => controller.clearWounds(),
    worldOnBone: (name, local) => controller.worldOnBone(name, local),
    status: () => controller.status(),
    resourceCounts: () => controller.resourceCounts(),
    timing: () => controller.timing(),
    // Additive diagnostics for the verifier (kept off the pinned interface).
    diagnostics: () => controller.diagnostics(),
  } as HumanoidSpikeApi & { diagnostics: () => HumanoidSpikeDiagnostics };
}

/** The stub exposed when bootstrap fails before a controller exists (e.g. no
 *  WebGPU adapter): verifier reads status().phase === 'failed'. */
export function createFailedSpikeApi(message: string): HumanoidSpikeApi {
  const status: HumanoidSpikeStatus = {
    phase: 'failed', severPhase: 'intact', elbowDeg: 0, elbowTargetDeg: 0,
    softness01: 0, physicsPaused: false, error: message, prewarm: null,
  };
  return {
    backend: 'unknown',
    get ready() { return false; },
    get severEnabled() { return false; },
    setElbow() {}, setSoftness() {}, sever() { return false; },
    reset() {}, setPhysicsPaused() {}, step() {}, setCamera() {}, setCameraTarget() {},
    shoot() { return false; },
    shootWorld() { return false; },
    clearWounds() {},
    worldOnBone() { return null; },
    status() { return { ...status }; },
    resourceCounts() {
      return { materials: 0, geometries: 0, textures: 0, attachedClusters: 0, detachedClusters: 0, compileCalls: 0 };
    },
    timing() { return null; },
  };
}

// ---------------------------------------------------------------------------
// DOM adapter — binds the controller to the compact page panel
// ---------------------------------------------------------------------------

export interface SpikeDomElements {
  status?: HTMLElement | null;
  elbow?: HTMLInputElement | null;
  elbowValue?: HTMLElement | null;
  softness?: HTMLInputElement | null;
  softnessValue?: HTMLElement | null;
  severBtn?: HTMLButtonElement | null;
  resetBtn?: HTMLButtonElement | null;
  pauseChk?: HTMLInputElement | null;
}

export class SpikeDomAdapter {
  private readonly unsub: () => void;

  constructor(controller: HumanoidSpikeController, els: SpikeDomElements) {
    els.elbow?.addEventListener('input', () => {
      controller.setElbow(Number(els.elbow?.value));
    });
    els.softness?.addEventListener('input', () => {
      controller.setSoftness(Number(els.softness?.value));
    });
    els.severBtn?.addEventListener('click', () => { controller.sever(); });
    els.resetBtn?.addEventListener('click', () => { controller.reset(); });
    els.pauseChk?.addEventListener('change', () => {
      controller.setPhysicsPaused(els.pauseChk?.checked === true);
    });
    this.unsub = controller.subscribe(() => this.sync(controller, els));
    this.sync(controller, els);
  }

  dispose(): void { this.unsub(); }

  private sync(c: HumanoidSpikeController, els: SpikeDomElements): void {
    const ready = c.ready;
    if (els.elbow) {
      els.elbow.disabled = !ready;
      if (els.elbow.value !== String(c.elbowTargetDeg)) els.elbow.value = String(c.elbowTargetDeg);
    }
    if (els.softness) {
      els.softness.disabled = !ready;
      if (els.softness.value !== String(c.softness01)) els.softness.value = String(c.softness01);
    }
    if (els.severBtn) els.severBtn.disabled = !c.severEnabled;
    if (els.resetBtn) els.resetBtn.disabled = !ready;
    if (els.pauseChk) {
      els.pauseChk.disabled = !ready;
      els.pauseChk.checked = c.physicsPaused;
    }
    if (els.elbowValue) els.elbowValue.textContent = `${c.elbowTargetDeg.toFixed(0)}°`;
    if (els.softnessValue) els.softnessValue.textContent = c.softness01.toFixed(2);
    if (els.status) {
      const s = c.status();
      if (s.phase === 'failed' && s.error) {
        els.status.textContent = `FAILED: ${s.error}`;
        els.status.classList.add('failed');
      } else {
        els.status.textContent = `phase: ${s.phase} · sever: ${s.severPhase}`;
        els.status.classList.remove('failed');
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Bootstrap — the only WebGPU/DOM-touching code
// ---------------------------------------------------------------------------

const MANIFEST_URL = '/assets/lab/humanoid-sdf/zombie-humanoid.json';

function readDomElements(): SpikeDomElements {
  const byId = (id: string) => document.getElementById(id);
  return {
    status: byId('status'),
    elbow: byId('elbow') as HTMLInputElement | null,
    elbowValue: byId('elbowValue'),
    softness: byId('softness') as HTMLInputElement | null,
    softnessValue: byId('softnessValue'),
    severBtn: byId('severBtn') as HTMLButtonElement | null,
    resetBtn: byId('resetBtn') as HTMLButtonElement | null,
    pauseChk: byId('pauseChk') as HTMLInputElement | null,
  };
}

function addFloorAndReference(scene: THREE.Scene): void {
  // A plain dark floor at y=0: the severed piece tumbles and lands on it, and
  // the camera pitch shows the horizon so flight/impact are readable. No grid
  // lines — the verifier's straight-edge analysis must only see the arm.
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(24, 24),
    new THREE.MeshStandardMaterial({ color: 0x37262c, roughness: 1 }),
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
}

/** Orbit controls matching the small existing spike — drag to orbit, wheel to
 *  zoom, and a LEFT press that does not travel far enough to count as a drag
 *  fires a shot (the same pointer->ray path as lab-main.ts). */
function attachOrbitControls(
  canvas: HTMLCanvasElement,
  controller: HumanoidSpikeController,
  shoot: (x: number, y: number) => boolean,
): void {
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let dragTravel = 0;
  const DRAG_SLOP = 5;
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    dragging = true; dragTravel = 0; lastX = e.clientX; lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointerup', (e) => {
    const wasDragging = dragging;
    dragging = false; canvas.releasePointerCapture(e.pointerId);
    if (wasDragging && e.button === 0 && dragTravel < DRAG_SLOP) {
      shoot(e.clientX, e.clientY);
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    dragTravel += Math.hypot(dx, dy);
    if (dragTravel < DRAG_SLOP) return;
    const cam = controller.cameraState();
    controller.setCamera(
      cam.yaw - dx * 0.008,
      cam.pitch + dy * 0.006,
      cam.distance,
    );
    lastX = e.clientX; lastY = e.clientY;
  });
  canvas.addEventListener('wheel', (e) => {
    const cam = controller.cameraState();
    controller.setCamera(cam.yaw, cam.pitch, cam.distance + Math.sign(e.deltaY) * 0.2);
  }, { passive: true });
}

/** Positions the camera from the controller's orbit state. */
function applyCamera(
  camera: THREE.PerspectiveCamera,
  cam: ReturnType<HumanoidSpikeController['cameraState']>,
): void {
  const cp = Math.cos(cam.pitch);
  camera.position.set(
    cam.targetX + Math.sin(cam.yaw) * cp * cam.distance,
    cam.targetY + Math.sin(cam.pitch) * cam.distance,
    cam.targetZ + Math.cos(cam.yaw) * cp * cam.distance,
  );
  camera.lookAt(cam.targetX, cam.targetY, cam.targetZ);
}

/** Runs the fixed bootstrap order. NEVER throws: failures surface as a
 *  visible FAILED status, a failed-stub API, and a rejected promise for the
 *  page's top-level catch to log. */
export async function bootstrapHumanoidSpike(): Promise<HumanoidSpikeApi> {
  const els = readDomElements();
  let controller: HumanoidSpikeController | null = null;
  try {
    // 1. WebGPU renderer; reject a non-WebGPU backend.
    const mount = document.getElementById('app');
    if (!mount) throw new Error('#app not found');
    const handle = await createLabRenderer(mount);
    if (handle.backend !== 'webgpu') {
      throw new Error(`backend is '${handle.backend}' — this spike is WebGPU-only`);
    }

    // 2. Load + validate the real humanoid assets (blocking errors, no mesh fallback).
    const assets = await loadHumanoidVolume(MANIFEST_URL);

    // 3. Attached + detached views, floor/reference lighting.
    const view = createHumanoidView(assets);
    const { scene, camera, renderer, canvas } = handle;
    scene.add(view.attachedGroup);
    scene.add(view.detachedGroup);
    addFloorAndReference(scene);

    // 4. Controller + DOM adapter first (so loading status is visible), then prewarm.
    controller = new HumanoidSpikeController(assets.manifest, view, {
      backend: handle.backend, coarse: assets.coarse,
    });
    const adapter = new SpikeDomAdapter(controller, els);
    controller.markPrewarming();
    const report = await view.prewarm(renderer, scene, camera);
    controller.markReady(report);

    // 5. Expose the enabled controls + the automation API.
    const api = createHumanoidSpikeApi(controller, camera, canvas);
    window.__humanoidSdfSpike = api;

    // 6. Start the render/update loop + orbit controls + click-to-shoot.
    handle.setRenderCallback((dtSec) => {
      controller?.step(dtSec);
      if (controller) applyCamera(camera, controller.cameraState());
    });
    attachOrbitControls(canvas, controller, (x, y) => api.shoot(x, y));

    // Prevent the adapter from leaking the frame subscription on navigation.
    window.addEventListener('beforeunload', () => adapter.dispose());
    return api;
  } catch (err) {
    const msg = errorMessage(err);
    console.error('[humanoid-spike] bootstrap failed', err);
    if (controller) {
      controller.fail(err);
    } else if (els.status) {
      els.status.classList.add('failed');
      els.status.textContent = `FAILED: ${msg}`;
    }
    const api = createFailedSpikeApi(msg);
    window.__humanoidSdfSpike = api;
    return api;
  }
}

// Module top-level: bootstrap only when the page is actually present, so
// Vitest imports never start WebGPU work (the tests stub the controller).
if (typeof document !== 'undefined' && document.getElementById('app')) {
  void bootstrapHumanoidSpike();
}
