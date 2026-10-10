// src/lab/sdf-zombie/webgpu/ending-sequence.ts
//
// SHORT SCRIPTED SEQUENCES (spec 2026-09-30-night-train-egg-ending-design.md §3): a timeline of shots,
// each a duration, a cut type, a camera and an overlay. Abstract on purpose: jump cuts, flashes, a
// full-screen colour and a line of text, never a third-person shot of the hero. Pure: no three.js, no DOM.
// The runtime (game-sequence.ts) advances `t` on the sim step and applies what these return.
// Shots are authored in seconds; there is no beat clock yet.

export type Vec3 = [number, number, number];
export type CutKind = 'hard' | 'flash';

/** How a shot places the camera.
 *  drift: from the player's view at the sequence's start towards a named anchor, stopping `stopShort` m
 *         from it, looking at it, with the lens narrowing by fovDelta[0] -> fovDelta[1] degrees.
 *  fixed: an authored eye and look point.
 *  hold:  keep whatever the last shot left (or the player's own view if there was none). */
export type CameraSpec =
  | { kind: 'drift'; anchor: string; stopShort: number; fovDelta: readonly [number, number] }
  | { kind: 'fixed'; eye: Vec3; look: Vec3; fovDelta?: number }
  | { kind: 'hold' };

export interface OverlaySpec { rgb: Vec3; alpha: number; text?: string }

export interface Shot {
  id: string;
  /** Seconds. */
  duration: number;
  /** 'flash' starts the shot with a white frame that falls away in FLASH_S. */
  cut: CutKind;
  camera: CameraSpec;
  overlay?: OverlaySpec;
}

export interface Sequence {
  id: string;
  /** The level event fired when the last shot ends (the level's `completeOn` maps it to completion). */
  endEvent: string;
  shots: readonly Shot[];
}

/** How long a flash cut's white frame takes to fall to nothing (s). */
export const FLASH_S = 0.12;

export function totalDuration(seq: Sequence): number {
  return seq.shots.reduce((sum, s) => sum + s.duration, 0);
}

export interface ShotAt { index: number; shot: Shot; local: number; u: number; finished: boolean }

/** The shot playing at sequence time t, and the progress through it. Past the end it stays on the
 *  last shot with u = 1 and finished = true. */
export function shotAt(seq: Sequence, t: number): ShotAt {
  const total = totalDuration(seq);
  let start = 0;
  for (let i = 0; i < seq.shots.length; i++) {
    const shot = seq.shots[i]!;
    const end = start + shot.duration;
    if (t < end || i === seq.shots.length - 1) {
      const local = Math.min(Math.max(t - start, 0), shot.duration);
      return { index: i, shot, local, u: shot.duration > 0 ? local / shot.duration : 1, finished: t >= total };
    }
    start = end;
  }
  throw new Error(`sequence ${seq.id} has no shots`);
}

export interface CameraStart { eye: Vec3; look: Vec3 }
export interface CameraPose { eye: Vec3; look: Vec3; fovDelta: number }

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const ease = (x: number) => { const t = clamp01(x); return t * t * (3 - 2 * t); };
const lerp3 = (a: Vec3, b: Vec3, k: number): Vec3 => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];

/** The camera for a shot at progress u (0..1). `start` is the player's view when the sequence began;
 *  `anchors` are named world points. Null means hold the previous pose. */
export function cameraAt(spec: CameraSpec, u: number, start: CameraStart, anchors: Readonly<Record<string, Vec3>>): CameraPose | null {
  if (spec.kind === 'hold') return null;
  if (spec.kind === 'fixed') return { eye: spec.eye, look: spec.look, fovDelta: spec.fovDelta ?? 0 };
  const a = anchors[spec.anchor];
  if (!a) return null;
  const dx = start.eye[0] - a[0], dy = start.eye[1] - a[1], dz = start.eye[2] - a[2];
  const len = Math.hypot(dx, dy, dz) || 1;
  const goal: Vec3 = [a[0] + (dx / len) * spec.stopShort, a[1] + (dy / len) * spec.stopShort, a[2] + (dz / len) * spec.stopShort];
  const e = ease(u);
  return {
    eye: lerp3(start.eye, goal, e),
    look: lerp3(start.look, a, ease(u * 1.5)),
    fovDelta: spec.fovDelta[0] + (spec.fovDelta[1] - spec.fovDelta[0]) * e,
  };
}

export interface OverlayAt { rgb: Vec3; alpha: number; text: string | null }

/** The full-screen colour, its opacity and any text at sequence time t. */
export function overlayAt(seq: Sequence, t: number): OverlayAt {
  const { shot, local } = shotAt(seq, t);
  const base = shot.overlay ?? { rgb: [0, 0, 0] as Vec3, alpha: 0 };
  // A flash cut is white at alpha 1, falling linearly to the shot's own overlay alpha over FLASH_S.
  const k = shot.cut === 'flash' ? Math.max(0, 1 - local / FLASH_S) : 0;
  if (k > 0) return { rgb: [1, 1, 1], alpha: base.alpha + (1 - base.alpha) * k, text: base.text ?? null };
  return { rgb: base.rgb, alpha: base.alpha, text: base.text ?? null };
}

/** Every sequence the game knows, by id. A level starts one with the event `sequence.<id>`. */
export const SEQUENCES: Readonly<Record<string, Sequence>> = {
  // The plan-3 stub of the Night Train ending (spec §4): a slow pull towards the egg, then black and a title.
  ending: {
    id: 'ending',
    endEvent: 'ending.end',
    shots: [
      { id: 'pull', duration: 4, cut: 'hard', camera: { kind: 'drift', anchor: 'inner-egg', stopShort: 1.3, fovDelta: [0, -25] } },
      { id: 'black', duration: 2, cut: 'hard', camera: { kind: 'hold' }, overlay: { rgb: [0, 0, 0], alpha: 1, text: 'NIGHT TRAIN' } },
    ],
  },
};
