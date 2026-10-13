// src/lab/sdf-zombie/characters/goblin-poses.ts
//
// The goblin's authored poses and clips (goblin refinement phase 4b, spec docs/superpowers/specs/2026-10-03-goblin-pose-layer-design.md).
// DATA ONLY: bone-angle keys in degrees, resolved by pose.ts against goblin.blob's own skeleton. Angles are ABSOLUTE like a .blob
// bone line's `pitch=` (a bone a key does not mention keeps its rest angle), and + pitch tips a bone toward +z (forward).
//
// The two held poses are the Flat look-dev's (docs/dev-notes/2026-10-01-flat-emergence-lookdev/notes.md, TYPE and RECOIL), kept
// as the starting values; every change from them is commented with the lab frame that asked for it.
import type { BoneAngle, PoseClip, PoseKey } from '../pose';

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
// apartment is floor level, so he sits on a zabuton at the Flat's low kotatsu (its board 0.385 m over the tatami: emergence-field's
// KOTATSU). Found by SEARCH against the compiled goblin-home skeleton: the hand balls' places chosen, two-bone IK from the shoulders
// (whose places the spine angles give) to the wrists, the bone directions turned into pitch / tilt (+ pitch tips a `down` bone toward +z,
// tilt turns it round z from straight down toward +x), and every result re-measured on the posed flesh (goblin-poses.test.ts and
// screen-lab-goblin.test.ts): limbs keep their lengths, the pelvis rests on the cushion's top, nothing goes under the floor, into the
// cushion or through the kotatsu at any sampled time, the arms never rise above the shoulders.
//
// They leave the GROUND LOCK off and set their own height (`root.y`): the lock holds the lower ankle at its STANDING height (0.205 m on
// the 1.70 m body), a whole shin above a cushion. The goblin's lower leg runs on 0.17 m past the ankle knob and the foot hangs under it
// (goblin-home.blob's bare feet), so the floor poses turn the FOOT too (pose.ts: a `fwd` bone turns as a whole) to lie along the shin.
// The pose layer is mirrored, so the cross-legged sit and the one-handed reach use one-sided keys (`shin.l`, `upperarm.r`).
//
// THE HANDS (the hands round, 2026-10-13; the owner: "the hands clip into the floor a bit too much and maybe bend a bit too acutely or
// look too disconnected to the wrist/forearm"). goblin-home's hand is an ORB (r 0.060 m compiled) and the rig does NOT carry it along the
// hand bone: rig-bind turns only upper-arm and forearm prims with their bones, so the orb rides its nearest joint, the hand TIP, at its
// rest offset in world axes: it always sits 4.24 cm straight ABOVE the hand tip, whatever `hand` says (measured: orb - tip = (0, 0.0424,
// 0) in every pose). The hand bone draws nothing; a `hand` angle only chooses where the ball sits round the wrist, on a sphere of radius
// 0.094 m centred 4.24 cm over it. The ball hugs the wrist (5.2 cm off) only when it hangs below it, and it floats free of the forearm's
// 2.35 cm cap past 8.4 cm. So the hands are fitted on what the eye sees: the forearm against the wrist-to-ball line (the wrist bend, under
// 40 degrees in a contact pose, under 60 always) and the ball's distance from the wrist (under 7.2 cm in contact, 8 cm always), the ball's
// underside on its surface (goblin-poses.test.ts, screen-lab-goblin.test.ts). Before: the balls already sat on the keys and the floor
// (0.0 and 0.3 mm), but braced back the ball was 9.5 cm from the wrist, 77 degrees off the forearm's line and 1.1 cm clear of it (a
// detached ball beside a forearm stump on the floor), typing 8.0 cm and 33 degrees (an 11 mm neck), the lean between up to 106 degrees.
// ---------------------------------------------------------------------------

/** The cushion the floor poses were authored on, in the body's frame (the floor at y 0, the hips over the origin, facing +z): a zabuton
 *  0.55 m square, `top` high, spanning `x` and `z`. 0.08 thick, a plump one (0.06 is the thin kind): the goblin's torso is short (his
 *  shoulders are 0.366 m above his hip joints), so on a thin one at the kotatsu his forearms would lie on the board at his shoulders'
 *  height. The screen lab builds the cushion from this; it slides back on the tatami with him (screen-lab-goblin.ts goblinRootAt). */
export const FLOOR_SEAT = { top: 0.08, x: [-0.275, 0.275] as const, z: [-0.2, 0.35] as const } as const;
/** The root's lift for a pelvis resting on FLOOR_SEAT.top: the pelvis flesh is 0.105 m under the hip joints (and the pelvis bone stays
 *  upright whatever the spine does), the standing hips are at 0.922 m. */
const SEATED_Y = FLOOR_SEAT.top + 0.105 - 0.922;
/** The kneeling root's lift and its shift forward over the cushion (solved: the knees' flesh on FLOOR_SEAT.top at z 0.30, the thighs
 *  near upright, so the hip joints are 0.502 m up and 0.33 m forward). */
const KNEEL_ROOT = { y: -0.4195, z: 0.33 } as const;

/** The cross-legged legs, shared by floor-type and brace-back: the thighs out 48 degrees from forward and 6 down (the knees 0.145 m up,
 *  0.356 m out, 0.25 forward: past the cushion's sides, off the floor), the left lower leg crossed IN FRONT (its end at x -0.16, z 0.22)
 *  and the right one behind it, both lying on the cushion; the feet turned along the shins, on their outer edges about 2 cm over the
 *  cushion. (Kept from the first floor-pose pass: it holds up on the flesh. The right foot tucks UNDER the left thigh, its flesh inside the
 *  thigh's: the union hides it, as a foot tucked under a thigh is hidden.) */
const CROSSED_LEGS: PoseKey['bones'] = {
  thigh: { pitch: 41.7, tilt: 81.9 },
  'shin.l': { pitch: -3.6, tilt: -86.6 }, 'shin.r': { pitch: -27.3, tilt: -86.7 },
  foot: { pitch: 12, tilt: 171 },
};
/** Kneeling on the cushion's front (the knees' flesh on its top), the hips over the knees, the lower legs back along the cushion rising 7
 *  degrees and the feet turned down behind it, toes on the floor. */
const KNEEL_LEGS: PoseKey['bones'] = { thigh: { pitch: -4.5, tilt: 3.6 }, shin: { pitch: -97, tilt: 0 }, foot: { pitch: 97, tilt: 0 } };

/** Cross-legged on the cushion, hunched at the kotatsu, typing (spine 10 + 15, the neck 20 and the skull back 10 to keep the face on the
 *  screen): the hand balls ON the key tops (their flesh at the keyboard's top, 0.423 m: the board 0.385 plus the keyboard), 0.695 m in
 *  front of the hips and 0.11 m out (the same place as before, so the set laid out from it does not move); the elbows by his sides (0.12
 *  m under the shoulders, 0.10 m out from them), the forearms rising gently over the board's front edge, about 5 cm clear of it, the balls
 *  hanging off the wrists 38 degrees off the forearms' line, 7.0 cm out. The hands round (2026-10-13) sat him up 9 degrees (spine 14 + 20
 *  before) and raised the elbows (0.17 m under the shoulders) so the forearms come in flatter: with the forearms RESTING on the edge they
 *  rise about 25 degrees to the wrists, and a ball that must hang below the wrist to stay joined to it then bends the wrist 60 (the search
 *  found nothing better than 38 degrees and 7.5 cm at the old hunch). The first pass put the elbows ON the board out at his sides (a 0.44
 *  m board, at his shoulders' height: chicken wings). */
const FLOOR_TYPE_BONES: PoseKey['bones'] = {
  ...CROSSED_LEGS,
  spine1: { pitch: 10 }, chest: { pitch: 15 }, neck: { pitch: 20 }, skull: { pitch: -10 },
  upperarm: { pitch: 59.4, tilt: 38.9 }, forearm: { pitch: 68.9, tilt: -138.6 }, hand: { pitch: 41.5, tilt: -13.9 },
};

/** Leaning back on straight arms (the elbows bent 5 degrees), the hand balls on the floor 0.57 m behind the hips and 0.29 m out (behind
 *  the cushion), the spine back 18 + 22, the head brought forward again (neck 12) to watch the screen; the legs still crossed. The arms
 *  never rise: the elbows hang 0.22 m under the shoulders. The hands round (2026-10-13) kept the shoulders and elbows and ran each arm
 *  straight on to the floor, the ball hanging off the wrist in line with the forearm (3 degrees, 5.9 cm out) with its underside on the
 *  floor (0.8 mm); the ball moved 4 cm further back. The contact is the pose's own: the page's scoot only slides him and the cushion along
 *  the floor, so it holds whatever the pushback distance (screen-lab-goblin.test checks 0, 0.2 m and 0.55 m). */
const BRACE_BACK_BONES: PoseKey['bones'] = {
  ...CROSSED_LEGS,
  spine1: { pitch: -18 }, chest: { pitch: -22 }, neck: { pitch: 12 }, skull: { pitch: -4 },
  upperarm: { pitch: -37.9, tilt: 22.3 }, forearm: { pitch: -43.4, tilt: 21.7 }, hand: { pitch: -24.1, tilt: 11.3 },
};

/** Up on his knees, leaning in (spine 28 + 28, the head bowed toward the egg): the LEFT hand planted on the kotatsu's board beside the
 *  keyboard (its ball's flesh on the board, 7 cm in from the front edge, 0.31 m out: the arm nearly straight, leaning on it), the RIGHT
 *  hand's ball resting on the egg's near flank (the elbow low, the forearm rising onto it). Fitted with the egg where the screen lab puts it
 *  (EGG_REST on the keyboard, the set laid out from floor-type: screen-lab-goblin.ts) and his root 0.40 m back (goblinRootAt at the end);
 *  screen-lab-goblin.test reads the contact. */
const CRAWL_REACH_BONES: PoseKey['bones'] = {
  ...KNEEL_LEGS,
  spine1: { pitch: 28 }, chest: { pitch: 28 }, neck: { pitch: 8 }, skull: { pitch: -20 },
  'upperarm.l': { pitch: 24, tilt: 33.7 }, 'forearm.l': { pitch: 57.8, tilt: 25.2 }, 'hand.l': { pitch: 58, tilt: -20 },
  'upperarm.r': { pitch: 12.3, tilt: 20.9 }, 'forearm.r': { pitch: 58.2, tilt: -118 }, 'hand.r': { pitch: 60, tilt: -20 },
};

const seated = (t: number, bones: PoseKey['bones'], ease?: PoseKey['ease']): PoseKey =>
  ({ t, bones, groundLock: false, root: { y: SEATED_Y }, ...(ease ? { ease } : {}) });
const kneeling = (t: number, bones: PoseKey['bones'], ease?: PoseKey['ease']): PoseKey =>
  ({ t, bones, groundLock: false, root: KNEEL_ROOT, ...(ease ? { ease } : {}) });
/** A cross-legged key: the crossed legs, a spine (spine1, chest, neck, skull) and the arms (both sides alike). */
const crossed = (spine: readonly [number, number, number, number], upperarm: BoneAngle, forearm: BoneAngle, hand: BoneAngle): PoseKey['bones'] => ({
  ...CROSSED_LEGS,
  spine1: { pitch: spine[0] }, chest: { pitch: spine[1] }, neck: { pitch: spine[2] }, skull: { pitch: spine[3] },
  upperarm, forearm, hand,
});

export const FLOOR_TYPE: PoseClip = { name: 'floor-type', keys: [seated(0, FLOOR_TYPE_BONES)] };
export const BRACE_BACK: PoseClip = { name: 'brace-back', keys: [seated(0, BRACE_BACK_BONES)] };
export const CRAWL_REACH: PoseClip = { name: 'crawl-reach', keys: [kneeling(0, CRAWL_REACH_BONES)] };

/** Typing -> braced back (0.9 s; the plan's 0.7 s swung his elbows at 3.5 m/s, a jerk): the glass swells and he leans away onto his
 *  hands while the page slides him back on his cushion (goblinRootAt: 0.55 m over 1.15 s). A straight angle blend would sweep the hands down through the board's edge, so the hands follow
 *  solved waypoints, each placed in the lab's world at its time (the scoot included): they lift 2 cm off the keys and come back 4 cm
 *  (0.19), pull back over the board and clear of its edge, still under the shoulders (0.39), drop past his knees outside the cushion
 *  (0.59), swing back behind it low (0.75), and land flat on the floor behind him (0.9, brace-back). The spine straightens and leans back
 *  over the same time. Tilts are written so each blend turns the short way. The hands round (2026-10-13) re-aimed the hands at every key
 *  so the balls stay on the forearms' line (the wrist under 45 degrees all the way; 106 before), and added 0.84: the arms straighten
 *  onto the floor from there, the balls 2 cm up and 3 cm short of their place (straight from 0.75 the straightening arms swept the balls
 *  2 cm through the floor before they landed). */
export const LEAN_BACK: PoseClip = {
  name: 'lean-back',
  keys: [
    seated(0, FLOOR_TYPE_BONES),
    seated(0.19, crossed([12, 16, 19, -10], { pitch: 57.9, tilt: 23.1 }, { pitch: 64.5, tilt: -171.8 }, { pitch: 47.6, tilt: -4.3 }), 'smooth'),
    seated(0.39, crossed([6, 8, 17, -9], { pitch: 28.7, tilt: 37.8 }, { pitch: 51.7, tilt: -156.1 }, { pitch: 52.2, tilt: -24.3 })),
    seated(0.59, crossed([-6, -8, 14, -6], { pitch: -36.5, tilt: 48.6 }, { pitch: 74.5, tilt: 20.2 }, { pitch: 19, tilt: 1.9 })),
    seated(0.75, crossed([-13, -16, 13, -5], { pitch: -53.5, tilt: 59.8 }, { pitch: 12, tilt: 6.3 }, { pitch: 0, tilt: 0 })),
    seated(0.84, crossed([-16, -20, 12, -4], { pitch: -45.7, tilt: 37.2 }, { pitch: -37.4, tilt: 13.6 }, { pitch: -8.4, tilt: 2.8 })),
    seated(0.9, BRACE_BACK_BONES, 'smooth'),
  ],
};

/** Braced back -> kneeling and reaching (1.8 s), once the egg is out: he sits up and lifts his hands (0.45), rolls forward onto his hands
 *  as his hips come up and his legs uncross and fold back under him (0.75), crawls onto his knees on the cushion's front with his hands
 *  reaching down ahead, in front of the table (1.05), comes up with the left hand over the board's front edge and the right on its way to
 *  the egg (1.4), and settles into the reach: the left hand onto the board, the right onto the egg (1.8). The page brings him 0.15 m
 *  forward over the same time (goblinRootAt). The legs' waypoints (0.75, 1.05) are the first pass's (an angle blend straight from crossed
 *  legs to a kneel swung the feet 0.39 m through the floor); the arms at 1.4 and 1.8 are solved for the kotatsu and the egg. The egg lands
 *  about 0.7 s in (11.1 s), while he is coming forward on his hands; his hands reach it after it has settled. The end key is crawl-reach
 *  with the shin and foot written the other way round (the same directions), so the blend from 1.4 turns the short way. The hands round
 *  (2026-10-13) re-aimed the hands at 0.45, 0.75 and 1.05 (the wrist 77 degrees at 1.05 before, 41 now); 1.4 and the reach itself are
 *  left as they were (the egg-reach beat is being replaced). */
export const CRAWL_IN: PoseClip = {
  name: 'crawl-in',
  keys: [
    seated(0, BRACE_BACK_BONES),
    seated(0.45, crossed([6, 8, 10, -8], { pitch: -49.4, tilt: -10.3 }, { pitch: 8.4, tilt: 73 }, { pitch: -25, tilt: 45 }), 'smooth'),
    { t: 0.75, groundLock: false, root: { y: -0.4514, z: 0.18 }, bones: {
      spine1: { pitch: 40 }, chest: { pitch: 42 }, neck: { pitch: -6 }, skull: { pitch: -12 },
      thigh: { pitch: 20.1, tilt: 23.9 }, 'shin.l': { pitch: -53.5, tilt: -111.8 }, 'shin.r': { pitch: -55.5, tilt: -90 },
      'foot.l': { pitch: 51, tilt: 147 }, 'foot.r': { pitch: 42, tilt: 162 },
      upperarm: { pitch: 9.6, tilt: 16.4 }, forearm: { pitch: 9.7, tilt: 16.2 }, hand: { pitch: 0, tilt: 0 } } },
    { t: 1.05, groundLock: false, root: { y: -0.4127, z: 0.33 }, bones: {
      spine1: { pitch: 52 }, chest: { pitch: 52 }, neck: { pitch: -18 }, skull: { pitch: -14 },
      thigh: { pitch: -4.5, tilt: 5.2 }, shin: { pitch: -83.7, tilt: -180 }, foot: { pitch: 81, tilt: 162 },
      upperarm: { pitch: 1.7, tilt: 7.6 }, forearm: { pitch: 1.8, tilt: 7.5 }, hand: { pitch: 0, tilt: 0 } } },
    kneeling(1.4, {
      thigh: { pitch: -4.5, tilt: 3.6 }, shin: { pitch: -83.2, tilt: -180 }, foot: { pitch: 78, tilt: 162 },
      spine1: { pitch: 32 }, chest: { pitch: 32 }, neck: { pitch: 4 }, skull: { pitch: -15 },
      'upperarm.l': { pitch: -8.8, tilt: 38.4 }, 'forearm.l': { pitch: 73.1, tilt: 25.3 }, 'hand.l': { pitch: 57.6, tilt: -21.8 },
      'upperarm.r': { pitch: -9.9, tilt: 28.5 }, 'forearm.r': { pitch: 56.5, tilt: -106.3 }, 'hand.r': { pitch: 61.7, tilt: -18.4 } }),
    kneeling(1.8, { ...CRAWL_REACH_BONES, shin: { pitch: -83, tilt: -180 }, foot: { pitch: 83, tilt: 180 } }, 'smooth'),
  ],
};

export const GOBLIN_POSES: Readonly<Record<string, PoseClip>> = {
  type: TYPE, recoil: RECOIL, sit: SIT, stand: STAND, jolt: JOLT, reach: REACH, touch: TOUCH,
  'floor-type': FLOOR_TYPE, 'brace-back': BRACE_BACK, 'crawl-reach': CRAWL_REACH, 'lean-back': LEAN_BACK, 'crawl-in': CRAWL_IN,
};
