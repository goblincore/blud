// src/lab/sdf-zombie/hand-grip-clip.ts
//
// X1.27 task E1 — the pure grip/toss controller: finger closure over the
// baked clip (grip01), the camera-local underhand wrist arc, and the authored
// release marker. No wall-clock, no renderer, no gameplay state — the lab
// feeds frame dt and reads back one GripMotionFrame per step.
//
// TIMING PROVENANCE (viewed only, nothing extracted): Blood's QAV
// public/assets/animations/weapons/dynamite-throw.json holds 17 frames at
// 42 ms with the open-hand tile 3225 first appearing at frame index 4
// (168 ms) — an EARLY release, late open. GRIP_MOTION mirrors that
// silhouette: the release marker (150 ms) and swing (240 ms) land just under
// the reference's open-hand frame, and the fingers finish opening at 220 ms.
//
// PHASES AND WRIST CONTINUITY — the state is only {phase, elapsedSec,
// releaseEmitted}, so every curve must be a pure function of those. The
// wrist channel is therefore keyed per phase so that EVERY phase boundary is
// position/quaternion-continuous at ANY crossing time:
//
//   open          wrist = follow key   (the pre-presentation rest matches
//                                       closing(0), so the first presentation
//                                       cannot snap)
//   closing       follow → start glide (a re-presented bundle sweeps the hand
//                                       back down to carry while it closes;
//                                       closing(0)=follow is continuous with
//                                       the follow-through it came from)
//   held          wrist = start key    (static — held does not breathe)
//   throwing      start → release over [0, releaseAtSec], then
//                 release → follow over [releaseAtSec, swingSec]
//   follow-through wrist = follow key  (the open hand holds where the swing
//                                       left it, until the next presentation)
//
// The 'open' phase resting at the FOLLOW key is the deliberate consequence:
// it is the only assignment under which the open→closing AND
// follow-through→closing boundaries are both continuous with a closing curve
// that must END at the start key (where held lives and the throw begins).
// In the lab, 'open' is transient — a presented bundle (the boot condition)
// steps straight into closing.
//
// QUATERNIONS are xyzw tuples throughout (BakedHandPose's convention — the
// shader's volumePose1), built from the Euler keys in THREE 'XYZ' order and
// mixed by slerp.
import * as THREE from 'three/webgpu';
import { camBasis } from './fpv-mode';
import type { Vec3 } from './types';

// ——— The authored keys ————————————————————————————————————————————————————

export const GRIP_MOTION = {
  /** open → firm-grip close duration (s). */
  closeSec: 0.22,
  /** total underhand swing duration (s); the follow key lands exactly here. */
  swingSec: 0.24,
  /** fingers begin opening this far into the swing (s). */
  openAtSec: 0.10,
  /** the release marker: the frame crossing this elapsed time owns the
   *  hand→flight transfer (s into the swing). */
  releaseAtSec: 0.15,
  /** finger-open duration (s): openAtSec + releaseSec = 0.22 = grip 0. */
  releaseSec: 0.12,
  startOffset: [0, -0.025, -0.015] as Vec3,
  releaseOffset: [0.020, 0.085, 0.095] as Vec3,
  followOffset: [0.035, 0.120, 0.150] as Vec3,
  startEuler: [0.10, 0, -0.08] as Vec3,
  releaseEuler: [-0.25, 0.05, 0.16] as Vec3,
  followEuler: [-0.38, 0.08, 0.20] as Vec3,
} as const;

// ——— State / frame ————————————————————————————————————————————————————————

export type GripMotionPhase = 'open' | 'closing' | 'held' | 'throwing' | 'follow-through';

export interface GripMotionState {
  phase: GripMotionPhase;
  /** Seconds inside the CURRENT phase (resets on every phase transition). */
  elapsedSec: number;
  /** Latched once the release marker fired in this throw; reset by the next
   *  throw request or bundle presentation. */
  releaseEmitted: boolean;
}

export interface GripMotionInput {
  /** A bundle is being presented to the hand (drives open/follow-through →
   *  closing). The lab derives this from its own ownership state. */
  bundlePresented: boolean;
  /** Edge request to throw (drives held → throwing). Consumed only from
   *  held; ignored everywhere else. */
  throwRequested: boolean;
}

export interface GripMotionFrame {
  /** 0 = open hand, 1 = firm grip — the clip's adjacent-frame selector. */
  grip01: number;
  /** Camera-local wrist translation this frame (metres). */
  wristOffsetCamera: Vec3;
  /** Camera-local wrist rotation this frame, xyzw, normalized. */
  wristQuaternionCamera: [number, number, number, number];
  /** True on exactly the one frame whose step crossed the release marker. */
  releaseNow: boolean;
  /** True while the prop rides the hand (from presentation until release). */
  propHeld: boolean;
}

/** Fresh state. With a bundle presented the open→held close plays from 0
 *  (the spec's entering-the-lab mapping); otherwise the open hand waits. */
export function makeGripMotion(bundlePresented = false): GripMotionState {
  return {
    phase: bundlePresented ? 'closing' : 'open',
    elapsedSec: 0,
    releaseEmitted: false,
  };
}

// ——— Curves ——————————————————————————————————————————————————————————————

/** Clamped Hermite smoothstep on [0,1] — zero slope at both keys. */
function smoothstep(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

function lerp3(a: Vec3, b: Vec3, t: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** The three Euler keys, precomputed once (XYZ order, normalized by THREE). */
const qStart = new THREE.Quaternion().setFromEuler(
  new THREE.Euler(GRIP_MOTION.startEuler[0], GRIP_MOTION.startEuler[1], GRIP_MOTION.startEuler[2], 'XYZ'));
const qRelease = new THREE.Quaternion().setFromEuler(
  new THREE.Euler(GRIP_MOTION.releaseEuler[0], GRIP_MOTION.releaseEuler[1], GRIP_MOTION.releaseEuler[2], 'XYZ'));
const qFollow = new THREE.Quaternion().setFromEuler(
  new THREE.Euler(GRIP_MOTION.followEuler[0], GRIP_MOTION.followEuler[1], GRIP_MOTION.followEuler[2], 'XYZ'));

const qScratch = new THREE.Quaternion();

function slerpKey(a: THREE.Quaternion, b: THREE.Quaternion, t: number): [number, number, number, number] {
  qScratch.slerpQuaternions(a, b, t);
  return [qScratch.x, qScratch.y, qScratch.z, qScratch.w];
}

/** Finger closure for a phase/elapsed — the clip's grip01. */
function gripAt(phase: GripMotionPhase, e: number): number {
  const M = GRIP_MOTION;
  switch (phase) {
    case 'open':
    case 'follow-through':
      return 0;
    case 'closing':
      return smoothstep(e / M.closeSec);
    case 'held':
      return 1;
    case 'throwing':
      // Fingers stay wrapped until openAtSec, then traverse backward over
      // releaseSec — the late open of the underhand reference silhouette.
      return e <= M.openAtSec ? 1 : 1 - smoothstep((e - M.openAtSec) / M.releaseSec);
  }
}

/** Wrist placement for a phase/elapsed — see the header's continuity map. */
function wristAt(phase: GripMotionPhase, e: number): {
  offset: [number, number, number];
  quat: [number, number, number, number];
} {
  const M = GRIP_MOTION;
  switch (phase) {
    case 'open':
    case 'follow-through':
      return {
        offset: [...M.followOffset] as [number, number, number],
        quat: [qFollow.x, qFollow.y, qFollow.z, qFollow.w],
      };
    case 'closing':
      // follow → start: continuous with the follow-through it re-enters
      // from, and with the held frame it lands on.
      {
        const t = smoothstep(e / M.closeSec);
        return { offset: lerp3(M.followOffset, M.startOffset, t), quat: slerpKey(qFollow, qStart, t) };
      }
    case 'held':
      return {
        offset: [...M.startOffset] as [number, number, number],
        quat: [qStart.x, qStart.y, qStart.z, qStart.w],
      };
    case 'throwing': {
      if (e <= M.releaseAtSec) {
        const t = smoothstep(e / M.releaseAtSec);
        return { offset: lerp3(M.startOffset, M.releaseOffset, t), quat: slerpKey(qStart, qRelease, t) };
      }
      const t = smoothstep((e - M.releaseAtSec) / (M.swingSec - M.releaseAtSec));
      return { offset: lerp3(M.releaseOffset, M.followOffset, t), quat: slerpKey(qRelease, qFollow, t) };
    }
  }
}

function frameFor(phase: GripMotionPhase, e: number): GripMotionFrame {
  const wrist = wristAt(phase, e);
  const propHeld =
    phase === 'closing' || phase === 'held' ||
    (phase === 'throwing' && e < GRIP_MOTION.releaseAtSec);
  return {
    grip01: gripAt(phase, e),
    wristOffsetCamera: wrist.offset,
    wristQuaternionCamera: wrist.quat,
    releaseNow: false,
    propHeld,
  };
}

// ——— The step ————————————————————————————————————————————————————————————

/**
 * One pure advance of the grip/toss controller. Input transitions are
 * evaluated at the START of the step (a presentation from open/follow-through
 * restarts closing; a throw request fires only from held — both reset
 * `releaseEmitted`), then `dt` accumulates into the phase clock and
 * completions carry over (closing → held at closeSec, throwing →
 * follow-through at swingSec). `releaseNow` is true on exactly the one frame
 * whose step crossed releaseAtSec inside the swing — including a single
 * large dt from the throw request itself. Negative or NaN `dt` is a full
 * no-op: no advancement, no transition, no release. Never mutates `state`.
 */
export function stepGripMotion(
  state: GripMotionState,
  input: GripMotionInput,
  dt: number,
): { state: GripMotionState; frame: GripMotionFrame } {
  if (!Number.isFinite(dt) || dt < 0) {
    return { state, frame: frameFor(state.phase, state.elapsedSec) };
  }

  let phase = state.phase;
  let elapsed = state.elapsedSec;
  let released = state.releaseEmitted;

  if (phase === 'open' && input.bundlePresented) {
    phase = 'closing'; elapsed = 0; released = false;
  } else if (phase === 'follow-through' && input.bundlePresented) {
    phase = 'closing'; elapsed = 0; released = false;
  } else if (phase === 'held' && input.throwRequested) {
    phase = 'throwing'; elapsed = 0; released = false;
  }

  const prevInPhase = elapsed;
  elapsed += dt;

  let releaseNow = false;
  if (phase === 'closing' && elapsed >= GRIP_MOTION.closeSec) {
    phase = 'held';
    elapsed -= GRIP_MOTION.closeSec;
  } else if (phase === 'throwing') {
    if (!released && prevInPhase < GRIP_MOTION.releaseAtSec && elapsed >= GRIP_MOTION.releaseAtSec) {
      released = true;
      releaseNow = true;
    }
    if (elapsed >= GRIP_MOTION.swingSec) {
      phase = 'follow-through';
      elapsed -= GRIP_MOTION.swingSec;
    }
  }

  const next: GripMotionState = { phase, elapsedSec: elapsed, releaseEmitted: released };
  return { state: next, frame: { ...frameFor(phase, elapsed), releaseNow } };
}

// ——— The camera basis as a quaternion ————————————————————————————————————

const gcBx = new THREE.Vector3();
const gcBy = new THREE.Vector3();
const gcBz = new THREE.Vector3();
const gcM = new THREE.Matrix4();
const gcQ = new THREE.Quaternion();

/**
 * The hand-placement camera orientation at (yaw, pitch), xyzw. THE SEAM:
 * fpv-mode's camBasis is shared BY IMPORT so this can never drift from the
 * basis that places the marched hands and the throw origin. That basis —
 * columns (right, up, forward) — is LEFT-handed (camera +Z is forward,
 * world −Z at yaw 0), so like fpv-mode's other quaternion consumers the X
 * column is NEGATED to make a proper rotation: the returned quaternion maps
 * local +Z → forward and +Y → up exactly, and local +X → −right (the
 * codebase's established mirror repair — see handSheetProjections' header).
 * The lab passes the CURRENT frame's value to applyGripMotion; it must not
 * substitute the scene camera quaternion, which is composed later in the
 * frame and carries kick/roll.
 */
export function gripCameraQuaternion(
  yaw: number,
  pitch: number,
): [number, number, number, number] {
  const { f, r, u } = camBasis(yaw, pitch);
  gcBx.set(-r[0], -r[1], -r[2]);
  gcBy.set(u[0], u[1], u[2]);
  gcBz.set(f[0], f[1], f[2]);
  gcM.makeBasis(gcBx, gcBy, gcBz);
  gcQ.setFromRotationMatrix(gcM);
  return [gcQ.x, gcQ.y, gcQ.z, gcQ.w];
}
