// src/lab/sdf-zombie/webgpu/game-state-player.ts
//
// PLAYER slice of the GameContext decomposition. Everything the first-person
// player owns inside the old `main()` closure: the capsule motion state, the
// raw input accumulator the listeners feed and the tick consumes, the free-aim
// reticle / head-bob view-model state, the diagnostic marker, and the headless
// driver's walk helpers (autopilot + stuck/strafe recovery).
//
// Pure by construction: the only non-local imports are erased `import type`s,
// so this module carries no runtime Three.js / DOM dependency. Fields are plain
// and mutable — no getters, setters, `readonly` or `Object.freeze` — because
// the codemod moves the original assignments onto these fields and an accessor
// would change evaluation timing around the pixel gate.
//
// Computed initializers (the `bootRoom`-dependent spawn pose, `new Set()`, the
// `DEFAULT_PROBE_WEIGHT` park value) get a type-correct placeholder in the
// factory; the codemod supplies the real value at the binding's original line.
// Literal initializers keep their literal.

import type * as THREE from 'three/webgpu';
import type { Vec3 } from '../types';
// game-main.ts types this binding as `PlayerState` from game-player; this
// module EXPORTS its own (slice) `PlayerState`, so the motion-state import is
// aliased to keep the two apart.
import type { PlayerState as PlayerMotionState } from './game-player';
import type { DemoFrame } from './demo-recorder';
import { makeHitFeedback, type HitFeedback } from '../player-hit-feedback';

export interface PlayerState {
  /** Center FOV handed to the fisheye lens, degrees; the lens and camera.fov
   *  must never disagree (see the CO-INVARIANT comment in game-main.ts). */
  centerFovDeg: number;
  /** The centre FOV the FIRST-PERSON WEAPONS are framed against, degrees —
   *  independent of `centerFovDeg` on purpose, so tuning the world FOV never
   *  moves the gun. Defaults to VIEWMODEL_REFERENCE_FOV_DEG (the FOV the
   *  poses were authored at); `__sdfGame.setViewmodelFov` is the knob. */
  viewmodelFovDeg: number;
  /** Capsule position/velocity and view angles — game-player's motion state. */
  player: PlayerMotionState;
  /** Codes of the keys currently held (live input, cleared on keyup). */
  keys: Set<string>;
  /** Accumulated mouse delta for the frame about to tick. */
  pendingDx: number;
  pendingDy: number;
  /** The input frame the next tick consumes (live: read; replay: next()). */
  currentInputFrame: DemoFrame;
  /** Previous frame's key set, for the rising-edge toggles. */
  prevInputKeys: Set<string>;
  /** Probe weight parked for this page (`DEFAULT_PROBE_WEIGHT`). */
  parked: number;
  /** Realms-of-the-Haunting free aim: the mouse drives the reticle, not the
   *  camera; turning is a consequence of shoving the reticle past the dead zone. */
  freeAimOn: boolean;
  /** Metres walked, driving head bob by DISTANCE so it stays locked to
   *  footfalls at any speed. */
  bobDistance: number;
  /** Smoothed 0..1 bob amount. */
  bobAmount: number;
  /** Previous frame's feet position, the bob-distance sample. */
  prevPlayerPos: Vec3;
  /** Overlay element the free-aim reticle is drawn into, once created. */
  reticleEl: HTMLDivElement | null;
  /** Bench: pin the player pose for the whole leg (forced zero input). */
  holdPlayerPose: boolean;
  /** The `__sdfGame.placeMarker` debug sphere. */
  marker: THREE.Mesh | null;
  /** Headless driver autopilot: walk toward (x, z) until within 0.25 m. */
  autopilot: { x: number; z: number } | null;
  /** Stuck recovery: time spent making no progress against a blocking body. */
  stuckT: number;
  /** Remaining strafe-around time once `stuckT` trips. */
  strafeT: number;
  /** Which way to strafe around the obstacle (+1 / -1). */
  strafeDir: number;
  /** Last walk position sampled by the stuck detector. */
  lastWalkPos: [number, number] | null;
  /** What enemy melee hits have done to the player (player-hit-feedback.ts):
   *  the red flash, the camera shake and the hit counter. There is no player
   *  health yet; this is the feedback half of `onMeleeContact`. */
  hitFeedback: HitFeedback;
  /** The full-screen red flash overlay, created once at boot. */
  hitFlashEl: HTMLDivElement | null;
}

/** Every call returns a fresh object, nested objects, arrays and sets included. */
export function makePlayerState(): PlayerState {
  return {
    centerFovDeg: 0,
    viewmodelFovDeg: 0,
    player: { pos: [0, 0, 0], vel: [0, 0, 0], yaw: 0, pitch: 0, grounded: false },
    keys: new Set<string>(),
    pendingDx: 0,
    pendingDy: 0,
    currentInputFrame: { keys: [], dx: 0, dy: 0, fire: 0, reload: false, look: [0, 0] },
    prevInputKeys: new Set<string>(),
    parked: 0,
    freeAimOn: true,
    bobDistance: 0,
    bobAmount: 0,
    prevPlayerPos: [0, 0, 0],
    reticleEl: null,
    holdPlayerPose: false,
    marker: null,
    autopilot: null,
    stuckT: 0,
    strafeT: 0,
    strafeDir: 1,
    lastWalkPos: null,
    hitFeedback: makeHitFeedback(),
    hitFlashEl: null,
  };
}

/** Old `game-main.ts` binding name → path on the `player` slice. */
export const PLAYER_BINDINGS = {
  centerFovDeg: 'player.centerFovDeg',
  viewmodelFovDeg: 'player.viewmodelFovDeg',
  player: 'player.player',
  keys: 'player.keys',
  pendingDx: 'player.pendingDx',
  pendingDy: 'player.pendingDy',
  currentInputFrame: 'player.currentInputFrame',
  prevInputKeys: 'player.prevInputKeys',
  parked: 'player.parked',
  freeAimOn: 'player.freeAimOn',
  bobDistance: 'player.bobDistance',
  bobAmount: 'player.bobAmount',
  prevPlayerPos: 'player.prevPlayerPos',
  reticleEl: 'player.reticleEl',
  holdPlayerPose: 'player.holdPlayerPose',
  marker: 'player.marker',
  autopilot: 'player.autopilot',
  stuckT: 'player.stuckT',
  strafeT: 'player.strafeT',
  strafeDir: 'player.strafeDir',
  lastWalkPos: 'player.lastWalkPos',
} as const;
