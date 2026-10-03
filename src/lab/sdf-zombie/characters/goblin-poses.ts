// src/lab/sdf-zombie/characters/goblin-poses.ts
//
// The goblin's authored poses and clips (goblin refinement phase 4b, spec docs/superpowers/specs/2026-10-03-goblin-pose-layer-design.md).
// DATA ONLY: bone-angle keys in degrees, resolved by pose.ts against goblin.blob's own skeleton. Angles are ABSOLUTE like a .blob
// bone line's `pitch=` (a bone a key does not mention keeps its rest angle), and + pitch tips a bone toward +z (forward).
//
// The two held poses are the Flat look-dev's (docs/dev-notes/2026-10-01-flat-emergence-lookdev/notes.md, TYPE and RECOIL), kept
// as the starting values; every change from them is commented with the lab frame that asked for it.
import type { PoseClip } from '../pose';

/** Seated at the desk, hunched toward the screen, hands on the keys: the pull-back shot's goblin. */
export const TYPE: PoseClip = {
  name: 'type',
  keys: [{
    t: 0,
    bones: {
      // The spine curls forward 20 + 27 degrees and the neck another 24: the hunch, ears against the glow. The skull tips back 6 to
      // keep the face toward the screen.
      spine1: { pitch: 20 }, chest: { pitch: 27 }, neck: { pitch: 24 }, skull: { pitch: -6 },
      // 86: the thigh lies almost flat, forward (a seat); the shin hangs from the knee (-4 = a hair back under it).
      thigh: { pitch: 86 }, shin: { pitch: -4 },
      // Arms forward to the keyboard: upper arm 40, forearm 80, hand 70 (the hands lie nearly level).
      upperarm: { pitch: 40 }, forearm: { pitch: 80 }, hand: { pitch: 70 },
    },
  }],
};

/** Thrown back when the egg pushes through: the spine arches back and both arms fly up. */
export const RECOIL: PoseClip = {
  name: 'recoil',
  keys: [{
    t: 0,
    bones: {
      spine1: { pitch: -6 }, chest: { pitch: -12 }, neck: { pitch: -2 }, skull: { pitch: -14 },
      thigh: { pitch: 78 }, shin: { pitch: 2 },
      // 150 / 172 / 175: past vertical, the arms thrown over the head.
      upperarm: { pitch: 150 }, forearm: { pitch: 172 }, hand: { pitch: 175 },
    },
  }],
};

export const GOBLIN_POSES: Readonly<Record<string, PoseClip>> = { type: TYPE, recoil: RECOIL };
