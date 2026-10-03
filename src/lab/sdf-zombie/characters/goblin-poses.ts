// src/lab/sdf-zombie/characters/goblin-poses.ts
//
// The goblin's authored poses and clips (goblin refinement phase 4b, spec docs/superpowers/specs/2026-10-03-goblin-pose-layer-design.md).
// DATA ONLY: bone-angle keys in degrees, resolved by pose.ts against goblin.blob's own skeleton. Angles are ABSOLUTE like a .blob
// bone line's `pitch=` (a bone a key does not mention keeps its rest angle), and + pitch tips a bone toward +z (forward).
//
// The two held poses are the Flat look-dev's (docs/dev-notes/2026-10-01-flat-emergence-lookdev/notes.md, TYPE and RECOIL), kept
// as the starting values; every change from them is commented with the lab frame that asked for it.
import type { PoseClip, PoseKey } from '../pose';

/** Seated at the desk, hunched toward the screen, hands on the keys: the pull-back shot's goblin. */
const TYPE_BONES: PoseKey['bones'] = {
  // The spine curls forward 20 + 27 degrees and the neck another 24: the hunch, ears against the glow. The skull tips back 6 to
  // keep the face toward the screen.
  spine1: { pitch: 20 }, chest: { pitch: 27 }, neck: { pitch: 24 }, skull: { pitch: -6 },
  // 86: the thigh lies almost flat, forward (a seat); the shin hangs from the knee (-4 = a hair back under it).
  thigh: { pitch: 86 }, shin: { pitch: -4 },
  // Arms forward to the keyboard: upper arm 40, forearm 80, hand 70 (the hands lie nearly level).
  upperarm: { pitch: 40 }, forearm: { pitch: 80 }, hand: { pitch: 70 },
};

/** Thrown back when the egg pushes through: the spine arches back and both arms fly up. */
const RECOIL_BONES: PoseKey['bones'] = {
  spine1: { pitch: -6 }, chest: { pitch: -12 }, neck: { pitch: -2 }, skull: { pitch: -14 },
  thigh: { pitch: 78 }, shin: { pitch: 2 },
  // 150 / 172 / 175: past vertical, the arms thrown over the head (lab frame 2026-10-03: straight up in front view, torso arched
  // back in side view; no clipping of the pads, yoke or collar).
  upperarm: { pitch: 150 }, forearm: { pitch: 172 }, hand: { pitch: 175 },
};

/** Held poses: one key each. */
export const TYPE: PoseClip = { name: 'type', keys: [{ t: 0, bones: TYPE_BONES }] };
export const RECOIL: PoseClip = { name: 'recoil', keys: [{ t: 0, bones: RECOIL_BONES }] };

/** Stand -> sit: from the standing rest (a key that names no bones) into the typing pose, eased both ends. 0.8 s is eyeballed:
 *  long enough to read as lowering onto a seat, short enough for a 2.5 s shot. */
export const SIT: PoseClip = {
  name: 'sit',
  keys: [{ t: 0, bones: {} }, { t: 0.8, bones: TYPE_BONES, ease: 'smooth' }],
};

/** Sit -> stand: the same move back. */
export const STAND: PoseClip = {
  name: 'stand',
  keys: [{ t: 0, bones: TYPE_BONES }, { t: 0.8, bones: {}, ease: 'smooth' }],
};

/** Typing -> thrown back: the egg's push. Snappy (0.25 s, eased) because a recoil is a jolt, not a lean. */
export const JOLT: PoseClip = {
  name: 'jolt',
  keys: [{ t: 0, bones: TYPE_BONES }, { t: 0.25, bones: RECOIL_BONES, ease: 'smooth' }],
};

export const GOBLIN_POSES: Readonly<Record<string, PoseClip>> = {
  type: TYPE, recoil: RECOIL, sit: SIT, stand: STAND, jolt: JOLT,
};
