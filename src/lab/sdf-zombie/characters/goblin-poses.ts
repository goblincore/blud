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

/** Reaching for the egg on the desk: both hands come down on the egg's upper flanks, cupping it (the pose layer is mirrored, so it is both
 *  hands or neither). Fitted in the screen lab (plan Task 8) against the egg's rest place (screen frame [0, -0.095, 0.185]): each hand's
 *  centre 6.8 cm from the egg's surface, the hand's flesh (radius about 6 cm) resting on it; the elbows low by the knees, the forearms rising
 *  onto the egg clear of it (their axes 6.5 cm off its surface and more), the wrists below the shoulders. He sits up a little from the
 *  typing hunch (spine 20, chest 24): the egg's top is level with his shoulders. Round one's 62 / 38 / 20 hung the hands 28 cm from the
 *  egg's centre, beside and below it, 2 cm below the desk's top. */
const REACH_BONES: PoseKey['bones'] = {
  spine1: { pitch: 20 }, chest: { pitch: 24 }, neck: { pitch: 20 }, skull: { pitch: -4 },
  thigh: { pitch: 86 }, shin: { pitch: -4 },
  upperarm: { pitch: 36, tilt: -3 }, forearm: { pitch: 136, tilt: 29 }, hand: { pitch: 117 },
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

/** The reach pose held: the last frame of the sequence. */
export const REACH: PoseClip = { name: 'reach', keys: [{ t: 0, bones: REACH_BONES }] };

/** From the recoil's end (thrown back, arms up) to the reach: the arms come down from over his head onto the egg. 2.2 s, eased: the hands
 *  arrive as the egg settles on the desk (it lands at about 11.1 s in the screen lab and bounces until 11.5; touch runs 9.4 to 11.6), so
 *  they come down on it from above and never meet it in the air (1.4 s put them through the falling egg). */
export const TOUCH: PoseClip = {
  name: 'touch',
  keys: [{ t: 0, bones: RECOIL_BONES }, { t: 2.2, bones: REACH_BONES, ease: 'smooth' }],
};

// ---------------------------------------------------------------------------
// FLOOR POSES (screen emergence look round 1, plan docs/superpowers/plans/2026-10-12-screen-emergence-look-round-1.md Task C): the
// apartment is floor level, so he sits on a zabuton at the Flat's low kotatsu. Found by SEARCH against the compiled goblin-home skeleton
// (the joint positions placed, two-bone IK for the arms, then turned into angles; the feet by a grid search), and checked on the posed
// flesh (goblin-poses.test.ts): every limb keeps its length, the pelvis rests on the cushion's top, nothing goes under the floor or into
// the cushion, the arms never rise above the shoulders.
//
// They leave the GROUND LOCK off and set their own height (`root.y`): the lock holds the lower ankle at its STANDING height (0.205 m on
// the 1.70 m body), a whole shin above a cushion. The goblin's lower leg runs on 0.17 m past the ankle knob and the foot hangs under it
// (goblin-home.blob's bare feet), so the floor poses turn the FOOT too (pose.ts: a `fwd` bone turns as a whole) to lie along the shin.
// The pose layer is mirrored, so the cross-legged sit and the one-handed reach use one-sided keys (`shin.l`, `upperarm.r`).
// ---------------------------------------------------------------------------

/** The Flat's kotatsu: its board's top above the floor (scripts/levels/flat_layout.py KTOP). The floor poses were fitted to it: the
 *  forearms rest on it and the hands on a keyboard lying on it (the screen lab's KEYBOARD, 0.038 m to the key tops). */
export const KOTATSU_TOP = 0.44;

/** The cushion the floor poses were authored on, in the body's frame (the floor at y 0, the hips over the origin, facing +z): a zabuton
 *  0.55 m square, `top` high, spanning `x` and `z`. 0.08 thick (a plump one; 0.06 is the thin kind): at 0.06 his shoulders (0.518 m) sit
 *  BELOW his wrists on the keyboard (the goblin's torso is short: his shoulders are 0.366 m above his hip joints), so typing would hold
 *  his hands above his shoulders; at 0.08 the wrists are 1.4 cm under them. The screen lab builds the cushion from this; it travels with
 *  him when he shoves back (it slides on the tatami under him) and when he shuffles forward on his knees. */
export const FLOOR_SEAT = { top: 0.08, x: [-0.275, 0.275] as const, z: [-0.2, 0.35] as const } as const;
/** The root's lift for a pelvis resting on FLOOR_SEAT.top: the pelvis flesh is 0.105 m under the hip joints (and the pelvis bone stays
 *  upright whatever the spine does), the standing hips are at 0.922 m. */
const SEATED_Y = FLOOR_SEAT.top + 0.105 - 0.922;
/** The kneeling root's lift and its shift forward over the cushion (solved: the knees' flesh on FLOOR_SEAT.top at z 0.30, the thighs
 *  near upright, so the hip joints are 0.502 m up and 0.33 m forward). */
const KNEEL_ROOT = { y: -0.4195, z: 0.33 } as const;

/** The cross-legged legs, shared by floor-type and brace-back: the thighs out 48 degrees from forward and 6 down (the knees 0.145 m up,
 *  0.356 m out, 0.25 forward: past the cushion's sides, off the floor), the left lower leg crossed IN FRONT (its end at x -0.16, z 0.22)
 *  and the right one behind it (x 0.17, z -0.02: under the left thigh), both lying on the cushion (their axes 6.5 cm apart where they
 *  cross); the feet turned along the shins, on their outer edges about 2 cm over the cushion. */
const CROSSED_LEGS: PoseKey['bones'] = {
  thigh: { pitch: 41.7, tilt: 81.9 },
  'shin.l': { pitch: -3.6, tilt: -86.6 }, 'shin.r': { pitch: -27.3, tilt: -86.7 },
  foot: { pitch: 12, tilt: 171 },
};

/** Cross-legged on the cushion, hunched at the kotatsu, typing: the forearms rest on the table (their flesh 7 mm over its top, the elbows
 *  at its front edge, 0.28 m out to the sides), the wrists come in to the keyboard (x 0.12) and the hand balls rest on the keys (their
 *  flesh ON the key tops at 0.478 m). The spine curls 14 + 22 and the neck 18 (the skull back 10, to keep the face on the screen). */
const FLOOR_TYPE_BONES: PoseKey['bones'] = {
  ...CROSSED_LEGS,
  spine1: { pitch: 14 }, chest: { pitch: 22 }, neck: { pitch: 18 }, skull: { pitch: -10 },
  upperarm: { pitch: 52.6, tilt: 72.5 }, forearm: { pitch: 57.4, tilt: -104.8 }, hand: { pitch: 59.5, tilt: -53.1 },
};

/** Leaning back on nearly straight arms (the elbows bent 17 degrees), the hand balls on the floor 0.53 m behind the hips and 0.29 m out
 *  (behind the cushion), the spine back 18 + 22, the head brought forward again (neck 12) to watch the screen; the legs still crossed.
 *  The arms never rise: the elbows hang 0.22 m under the shoulders. */
const BRACE_BACK_BONES: PoseKey['bones'] = {
  ...CROSSED_LEGS,
  spine1: { pitch: -18 }, chest: { pitch: -22 }, neck: { pitch: 12 }, skull: { pitch: -4 },
  upperarm: { pitch: -38.2, tilt: 22.3 }, forearm: { pitch: -23.4, tilt: 13.6 }, hand: { pitch: -65.9, tilt: 60.3 },
};

/** Up on his knees at the table's edge, leaning in (spine 30 + 30, the head bowed toward the egg): the knees on the cushion's front
 *  (z 0.30), the hips over them, the lower legs back along the cushion rising 7 degrees and the feet turned down behind it, toes on the
 *  floor; the LEFT hand's ball on the table top 8 cm in from its front edge, the RIGHT hand's ball resting on the egg's near upper flank.
 *  Fitted with the egg where the screen lab puts it (centre [0, 0.62, 0.685] in the lab's world, his root 0.41 m back at the end:
 *  screen-lab-goblin.ts, whose test reads the contact). */
const CRAWL_REACH_BONES: PoseKey['bones'] = {
  spine1: { pitch: 30 }, chest: { pitch: 30 }, neck: { pitch: 10 }, skull: { pitch: -20 },
  thigh: { pitch: -4.5, tilt: 3.6 }, shin: { pitch: -97, tilt: 0 }, foot: { pitch: 97, tilt: 0 },
  'upperarm.l': { pitch: 0.7, tilt: 51.6 }, 'forearm.l': { pitch: 54.5, tilt: -44.1 }, 'hand.l': { pitch: 57.6, tilt: -21.8 },
  'upperarm.r': { pitch: 21.1, tilt: 46.3 }, 'forearm.r': { pitch: 41.6, tilt: -104.2 }, 'hand.r': { pitch: 61.7, tilt: -18.4 },
};

const seated = (t: number, bones: PoseKey['bones'], ease?: PoseKey['ease']): PoseKey =>
  ({ t, bones, groundLock: false, root: { y: SEATED_Y }, ...(ease ? { ease } : {}) });
const kneeling = (t: number, bones: PoseKey['bones'], ease?: PoseKey['ease']): PoseKey =>
  ({ t, bones, groundLock: false, root: KNEEL_ROOT, ...(ease ? { ease } : {}) });

export const FLOOR_TYPE: PoseClip = { name: 'floor-type', keys: [seated(0, FLOOR_TYPE_BONES)] };
export const BRACE_BACK: PoseClip = { name: 'brace-back', keys: [seated(0, BRACE_BACK_BONES)] };
export const CRAWL_REACH: PoseClip = { name: 'crawl-reach', keys: [kneeling(0, CRAWL_REACH_BONES)] };

/** Typing -> braced back (0.7 s): the glass swells and he leans away onto his hands. A straight angle blend swept the hands down through
 *  the table's edge and his lap, so the hands follow solved waypoints (their balls lift off the keys, come back over the table's edge,
 *  out past his knees and the cushion's side, down behind him to the floor), the elbows hanging low and turning back as they go. The end
 *  key is brace-back with the forearm's tilt written 360 down (the same direction), so the blend from the last waypoint turns the short
 *  way. The page slides him back as he goes (screen-lab-goblin.ts goblinRootAt). */
export const LEAN_BACK: PoseClip = {
  name: 'lean-back',
  keys: [
    seated(0, FLOOR_TYPE_BONES),
    seated(0.12, { ...CROSSED_LEGS, spine1: { pitch: 8.5 }, chest: { pitch: 14.5 }, neck: { pitch: 17 }, skull: { pitch: -9 },
      upperarm: { pitch: 20.2, tilt: 47.6 }, forearm: { pitch: 43.8, tilt: -141.7 }, hand: { pitch: 53.7, tilt: -42.1 } }, 'smooth'),
    seated(0.25, { ...CROSSED_LEGS, spine1: { pitch: 2.6 }, chest: { pitch: 6.3 }, neck: { pitch: 15.9 }, skull: { pitch: -7.9 },
      upperarm: { pitch: -22.5, tilt: 28.2 }, forearm: { pitch: 56.1, tilt: -213.8 }, hand: { pitch: 34.5, tilt: -23.8 } }),
    seated(0.4, { ...CROSSED_LEGS, spine1: { pitch: -4.3 }, chest: { pitch: -3.1 }, neck: { pitch: 14.6 }, skull: { pitch: -6.6 },
      upperarm: { pitch: -40, tilt: 17.3 }, forearm: { pitch: 44, tilt: -275.3 }, hand: { pitch: -26.5, tilt: 5.4 } }),
    seated(0.48, { ...CROSSED_LEGS, spine1: { pitch: -7.9 }, chest: { pitch: -8.2 }, neck: { pitch: 13.9 }, skull: { pitch: -5.9 },
      upperarm: { pitch: -53.6, tilt: 15.9 }, forearm: { pitch: 31.1, tilt: -305.1 }, hand: { pitch: -47.5, tilt: 20.9 } }),
    seated(0.57, { ...CROSSED_LEGS, spine1: { pitch: -12.1 }, chest: { pitch: -13.8 }, neck: { pitch: 13.1 }, skull: { pitch: -5.1 },
      upperarm: { pitch: -62, tilt: 28.4 }, forearm: { pitch: 10.2, tilt: -330.1 }, hand: { pitch: -57.5, tilt: 35.1 } }),
    seated(0.7, { ...BRACE_BACK_BONES, forearm: { pitch: -23.4, tilt: 13.6 - 360 } }, 'smooth'),
  ],
};

/** Braced back -> kneeling and reaching (1.8 s), once the egg is out: he sits up and lifts his hands (0.45), rolls forward onto his hands
 *  as his hips come up and his legs uncross and fold back under him (0.75), crawls onto his knees on the cushion's front with his hands
 *  reaching down ahead (1.05), comes up with the left hand onto the table and the right toward the egg (1.4), and settles into the
 *  reach. Solved waypoints like lean-back's (an angle blend straight from crossed legs to a kneel swung the feet 0.39 m through the
 *  floor); the end key is crawl-reach with the shin and foot written the other way round (the same directions). The egg lands about
 *  0.7 s in (11.1 s), while he is coming forward on his hands. */
export const CRAWL_IN: PoseClip = {
  name: 'crawl-in',
  keys: [
    seated(0, BRACE_BACK_BONES),
    seated(0.45, { ...CROSSED_LEGS, spine1: { pitch: 6 }, chest: { pitch: 8 }, neck: { pitch: 10 }, skull: { pitch: -8 },
      upperarm: { pitch: -49.4, tilt: -10.3 }, forearm: { pitch: 8.4, tilt: 73 }, hand: { pitch: 27.2, tilt: 31 } }, 'smooth'),
    { t: 0.75, groundLock: false, root: { y: -0.4514, z: 0.18 }, bones: {
      spine1: { pitch: 40 }, chest: { pitch: 42 }, neck: { pitch: -6 }, skull: { pitch: -12 },
      thigh: { pitch: 20.1, tilt: 23.9 }, 'shin.l': { pitch: -53.5, tilt: -111.8 }, 'shin.r': { pitch: -55.5, tilt: -90 },
      'foot.l': { pitch: 51, tilt: 147 }, 'foot.r': { pitch: 42, tilt: 162 },
      upperarm: { pitch: 9.6, tilt: 16.4 }, forearm: { pitch: 9.7, tilt: 16.2 }, hand: { pitch: 53.1, tilt: 0 } } },
    { t: 1.05, groundLock: false, root: { y: -0.4127, z: 0.33 }, bones: {
      spine1: { pitch: 52 }, chest: { pitch: 52 }, neck: { pitch: -18 }, skull: { pitch: -14 },
      thigh: { pitch: -4.5, tilt: 5.2 }, shin: { pitch: -83.7, tilt: -180 }, foot: { pitch: 81, tilt: 162 },
      upperarm: { pitch: 1.7, tilt: 7.6 }, forearm: { pitch: 1.8, tilt: 7.5 }, hand: { pitch: 53.1, tilt: 0 } } },
    kneeling(1.4, {
      spine1: { pitch: 32 }, chest: { pitch: 32 }, neck: { pitch: 4 }, skull: { pitch: -15 },
      thigh: { pitch: -4.5, tilt: 3.6 }, shin: { pitch: -83.2, tilt: -180 }, foot: { pitch: 78, tilt: 162 },
      'upperarm.l': { pitch: -18.8, tilt: 67.6 }, 'forearm.l': { pitch: 49, tilt: -44.9 }, 'hand.l': { pitch: 57.6, tilt: -21.8 },
      'upperarm.r': { pitch: -4.6, tilt: 54.5 }, 'forearm.r': { pitch: 39.2, tilt: -85.2 }, 'hand.r': { pitch: 61.7, tilt: -18.4 } }),
    kneeling(1.8, { ...CRAWL_REACH_BONES, shin: { pitch: -83, tilt: -180 }, foot: { pitch: 83, tilt: 180 } }, 'smooth'),
  ],
};

export const GOBLIN_POSES: Readonly<Record<string, PoseClip>> = {
  type: TYPE, recoil: RECOIL, sit: SIT, stand: STAND, jolt: JOLT, reach: REACH, touch: TOUCH,
  'floor-type': FLOOR_TYPE, 'brace-back': BRACE_BACK, 'crawl-reach': CRAWL_REACH, 'lean-back': LEAN_BACK, 'crawl-in': CRAWL_IN,
};
