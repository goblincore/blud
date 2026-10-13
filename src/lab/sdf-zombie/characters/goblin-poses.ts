// src/lab/sdf-zombie/characters/goblin-poses.ts
//
// The goblin's authored poses and clips (goblin refinement phase 4b, spec docs/superpowers/specs/2026-10-03-goblin-pose-layer-design.md).
// DATA ONLY: bone-angle keys in degrees, resolved by pose.ts against goblin.blob's own skeleton. Angles are ABSOLUTE like a .blob
// bone line's `pitch=` (a bone a key does not mention keeps its rest angle), and + pitch tips a bone toward +z (forward).
//
// The two held poses are the Flat look-dev's (docs/dev-notes/2026-10-01-flat-emergence-lookdev/notes.md, TYPE and RECOIL), kept
// as the starting values; every change from them is commented with the lab frame that asked for it.
//
// THE CHAIR-ERA CLIPS (type, recoil, sit, stand, jolt, reach, touch) are round one's desk-and-chair sequence. They stay registered (the
// pose library and its tests use them) but the screen lab no longer plays any of them: since look round 1 it plays the FLOOR clips below
// (screen-lab-goblin.ts GOBLIN_CUTS), and since the owner's third notes (2026-10-13) the sequence ends with him sitting up and looking at
// the egg, no hand on it. Where their comments speak of the egg and the screen lab, that is the old desk's egg.
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

/** The reach pose held: round one's last frame (the chair-era sequence; not played since look round 1). */
export const REACH: PoseClip = { name: 'reach', keys: [{ t: 0, bones: REACH_BONES }] };

/** From the recoil's end (thrown back, arms up) to the reach: the arms come down from over his head onto the egg. 2.2 s, eased (round
 *  one's desk timing: the egg landed about 11.1 s and touch ran 9.4 to 11.6; not played since look round 1). */
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
// The pose layer is mirrored, so the cross-legged sit uses one-sided keys (`shin.l`, `shin.r`).
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

/** The cross-legged legs, shared by every floor pose (he never uncrosses them): the thighs out 48 degrees from forward and 6 down (the knees 0.145 m up,
 *  0.356 m out, 0.25 forward: past the cushion's sides, off the floor), the left lower leg crossed IN FRONT (its end at x -0.16, z 0.22)
 *  and the right one behind it, both lying on the cushion; the feet turned along the shins, on their outer edges about 2 cm over the
 *  cushion. (Kept from the first floor-pose pass: it holds up on the flesh. The right foot tucks UNDER the left thigh, its flesh inside the
 *  thigh's: the union hides it, as a foot tucked under a thigh is hidden.) */
const CROSSED_LEGS: PoseKey['bones'] = {
  thigh: { pitch: 41.7, tilt: 81.9 },
  'shin.l': { pitch: -3.6, tilt: -86.6 }, 'shin.r': { pitch: -27.3, tilt: -86.7 },
  foot: { pitch: 12, tilt: 171 },
};

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

/** THE SLIGHT LEAN BACK (the owner's third notes, 2026-10-13: "it's more like a slight pushback and lean back"; it was a crab on straight
 *  arms, the hands 0.57 m behind the hips, the page sliding him 0.55 m back): the trunk leans back 20 degrees (spine 18 + 22; the line
 *  from the hips to the chest joint), the hand balls on the floor 0.45 m behind the hips and 0.30 m out (just behind the cushion), the
 *  elbows bent 50 degrees and pointing back and out, 13 cm under the shoulders; each ball hangs off its wrist nearly in line with the
 *  forearm (5 degrees, 5.3 cm out) with its underside on the floor (the hands round's contact rules). The head is brought forward again
 *  (neck 12, the skull level) to watch the sac: its forward axis within 8 degrees of the sac's apex from 3.5 s to 10 s at the page's 0.2 m
 *  pushback (screen-lab-goblin.test). The contact is the pose's own: the scoot only slides him and the cushion along the floor. */
const BRACE_BACK_BONES: PoseKey['bones'] = {
  ...CROSSED_LEGS,
  spine1: { pitch: -18 }, chest: { pitch: -22 }, neck: { pitch: 12 }, skull: { pitch: 0 },
  upperarm: { pitch: -43.9, tilt: 53.4 }, forearm: { pitch: -17.5, tilt: 2.7 }, hand: { pitch: -10, tilt: 4 },
};

/** SITTING UP TO LOOK (the third notes: "his head doesn't appear to be looking at the egg when he sits up a bit"; "we don't need to animate
 *  his hands raising to touch it": the sequence ends with him looking, then the player takes over). Sitting up on the cushion, the legs
 *  still crossed, the trunk upright and a little forward (6 degrees; spine 4 + 8), the neck bowed 20 and the skull pitched 17 so the
 *  head's forward axis points at the egg resting on the keyboard (EGG_REST), 22 degrees down: under 1 degree off its centre at the page's
 *  0.2 m pushback. The hand balls rest on his knees (on the thighs' flesh just inside the knee joints), the elbows bent back and down, 18
 *  cm under the shoulders; the wrist 16 degrees, the ball 6.5 cm out. The head angle is inside the rig's head cone (rig-bind headQuatOf
 *  clamps the head to 28.6 degrees round its rest direction: skull -33.6 .. +23.6), so the page renders it as authored. */
const SIT_UP_LOOK_BONES: PoseKey['bones'] = {
  ...CROSSED_LEGS,
  spine1: { pitch: 4 }, chest: { pitch: 8 }, neck: { pitch: 20 }, skull: { pitch: 17 },
  upperarm: { pitch: -30.9, tilt: 46.8 }, forearm: { pitch: 73, tilt: 17.9 }, hand: { pitch: 35, tilt: 6 },
};

const seated = (t: number, bones: PoseKey['bones'], ease?: PoseKey['ease']): PoseKey =>
  ({ t, bones, groundLock: false, root: { y: SEATED_Y }, ...(ease ? { ease } : {}) });
/** A cross-legged key: the crossed legs, a spine (spine1, chest, neck, skull) and the arms (both sides alike). */
const crossed = (spine: readonly [number, number, number, number], upperarm: BoneAngle, forearm: BoneAngle, hand: BoneAngle): PoseKey['bones'] => ({
  ...CROSSED_LEGS,
  spine1: { pitch: spine[0] }, chest: { pitch: spine[1] }, neck: { pitch: spine[2] }, skull: { pitch: spine[3] },
  upperarm, forearm, hand,
});

export const FLOOR_TYPE: PoseClip = { name: 'floor-type', keys: [seated(0, FLOOR_TYPE_BONES)] };
export const BRACE_BACK: PoseClip = { name: 'brace-back', keys: [seated(0, BRACE_BACK_BONES)] };

/** Typing -> leaning back (0.9 s; the plan's 0.7 s swung his elbows at 3.5 m/s, a jerk): the glass swells and he leans away onto his
 *  hands while the page pushes him back on his cushion (goblinRootAt: 0.2 m over 1.15 s). A straight angle blend would sweep the hands
 *  down through the board's edge, so the hands follow solved waypoints, each placed in the lab's world at its time (the scoot included):
 *  they lift 2 cm off the keys and come back 4 cm (0.19), pull back over the board and clear of its edge, still under the shoulders (0.39),
 *  drop past his knees outside the cushion (0.59), swing back behind it low (0.75), and come down onto the floor behind him (0.84,
 *  0.9: brace-back). The spine straightens and leans back over the same time. Tilts are written so each blend turns the short way. The
 *  hands round (2026-10-13) re-aimed the hands at every key so the balls stay on the forearms' line (the wrist under 45 degrees all the
 *  way); the third notes' slight lean back re-solved 0.75 and 0.84 for the nearer hands (0.45 m behind the hips, not 0.57) and the shorter
 *  pushback (the balls 2 cm and 0 cm over the floor there, 3 cm short of their place at 0.84). */
export const LEAN_BACK: PoseClip = {
  name: 'lean-back',
  keys: [
    seated(0, FLOOR_TYPE_BONES),
    seated(0.19, crossed([12, 16, 19, -10], { pitch: 57.9, tilt: 23.1 }, { pitch: 64.5, tilt: -171.8 }, { pitch: 47.6, tilt: -4.3 }), 'smooth'),
    seated(0.39, crossed([6, 8, 17, -9], { pitch: 28.7, tilt: 37.8 }, { pitch: 51.7, tilt: -156.1 }, { pitch: 52.2, tilt: -24.3 })),
    seated(0.59, crossed([-6, -8, 14, -6], { pitch: -36.5, tilt: 48.6 }, { pitch: 74.5, tilt: 20.2 }, { pitch: 19, tilt: 1.9 })),
    seated(0.75, crossed([-12, -15, 13, -2], { pitch: -68.4, tilt: 61.8 }, { pitch: 3.2, tilt: 21.5 }, { pitch: 0, tilt: 16 })),
    seated(0.84, crossed([-16, -20, 12, -1], { pitch: -44.9, tilt: 56.1 }, { pitch: -20.4, tilt: 4.2 }, { pitch: -10, tilt: 4 })),
    seated(0.9, BRACE_BACK_BONES, 'smooth'),
  ],
};

/** Leaning back -> sitting up to look (1.6 s), once the egg is out: he lifts his hands off the floor and brings them round outside his
 *  hips as his trunk comes up (0.45; the head already turning down), sits up with his head on the egg and his hands over his knees (0.8:
 *  the egg lands about now, 11.2 s in the screen lab, and the head is on it from here), and settles them onto his knees (1.6, sit-up-look's
 *  pose, held to the end). The legs stay crossed; the page's pushback holds (goblinRootAt). Replaces round one's crawl-in / crawl-reach
 *  (onto his knees and a hand on the egg: the owner, 2026-10-13, "we don't need to animate his hands raising to touch it"). */
export const SIT_UP_LOOK: PoseClip = {
  name: 'sit-up-look',
  keys: [
    seated(0, BRACE_BACK_BONES),
    seated(0.45, crossed([-8, -10, 16, 8], { pitch: -60.7, tilt: 53.6 }, { pitch: 23.5, tilt: 23.4 }, { pitch: 15, tilt: 16 }), 'smooth'),
    seated(0.8, crossed([1, 4, 19, 17], { pitch: -50.5, tilt: 46.2 }, { pitch: 65.5, tilt: 41.5 }, { pitch: 40, tilt: 18 })),
    seated(1.6, SIT_UP_LOOK_BONES, 'smooth'),
  ],
};

export const GOBLIN_POSES: Readonly<Record<string, PoseClip>> = {
  type: TYPE, recoil: RECOIL, sit: SIT, stand: STAND, jolt: JOLT, reach: REACH, touch: TOUCH,
  'floor-type': FLOOR_TYPE, 'brace-back': BRACE_BACK, 'lean-back': LEAN_BACK, 'sit-up-look': SIT_UP_LOOK,
};
