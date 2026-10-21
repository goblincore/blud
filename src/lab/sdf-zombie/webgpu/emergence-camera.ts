// src/lab/sdf-zombie/webgpu/emergence-camera.ts
//
// THE EMERGENCE'S CAMERAS IN THE FLAT, and the view the player takes over at the end (plan 2026-10-16-emergence-in-the-flat Task 7; spec
// docs/superpowers/specs/2026-10-16-emergence-in-the-flat-design.md sections 3 and 4). Pure: no three.js, no DOM.
//
// THE SHOTS. The lab page's five presets (screen-lab-main.ts PRESETS: an eye, a look-at and a vertical fov in THE SCREEN'S frame, origin
// at the glass centre, +z out of the glass toward him) re-authored for the Flat's room: the lab's wide shots sat 2.4 to 3 m from the table,
// outside the Flat's 2.7 m-wide room (and the settle shot's eye inside the bookshelf). The close shots (glass-gives, push, crowning) are the
// lab's, which already sit inside the room (glass-gives a few centimetres back, clear of the kotatsu's collider); push-wide is a profile
// from behind his right just south of the bookshelf, out an over-the-shoulder from the arch side behind his left shoulder, settle low from the
// front-right between the kotatsu and the bookshelf. `sequenceFor(placement)` lays them on the sequence system's timeline (ending-sequence.ts):
// one `fixed` shot per SHOTS entry of emergence-timeline.ts, the push cut in two at PUSH_WIDE_AT, eye and look through the placement.
//
// THE FOV. A preset's fov is the lab's plain-perspective fov; the game draws through its fisheye lens (fisheye.ts: the render fov 58, the
// centre fov 46), and the sequence runtime moves both by a shot's fovDelta (game-sequence.ts applySequenceCamera), so a preset's fov
// becomes the CENTRE fov: fovDelta = fov - centreFov. No preset is wider than the game's own centre fov: the SDF layer's cone geometry is
// sized for the base fov, and a wider frame than that is the fatal case (game-tick.ts's FOV punch note, sdf-layer.ts setConeGeometry).
//
// THE HAND-OFF (handoffFor). At the end the player's view starts at his seated eye (the settle pose's head, measured in the lab: 0.85 m
// above the tatami, not the spec's guessed 0.6) looking at the egg on the keyboard, and rises to the player's own eye height standing on
// the same spot (the controller has one eye height, 1.62 m: there is no crouch to leave him in). The spot is half a metre clear of the
// kotatsu's collider, so the capsule stands there without being pushed out.
import type { Placement } from './emergence-placement';
import { toWorld } from './emergence-placement';
import { DURATION, SHOTS, paramsAt, type ShotId } from './emergence-timeline';
import { eggCentre, type Vec3 } from './emergence-field';
import type { Sequence, Shot as SequenceShot } from './ending-sequence';

/** A camera preset in the screen frame: an eye, a look-at and the vertical (centre) fov in degrees. */
export interface CameraPreset { eye: Vec3; at: Vec3; fov: number }
export type PresetId = ShotId | 'push-wide';

/** The push cuts wider inside its shot, at this time (the lab page's, shared). */
export const PUSH_WIDE_AT = 4.5;

/** The game's fisheye centre fov (fisheye.ts FISHEYE_DEFAULTS.centerFovDeg), restated so this module stays free of the renderer. */
export const GAME_CENTRE_FOV = 46;

/** The sequence id and the level event its end queues. */
export const EMERGENCE_SEQUENCE_ID = 'emergence';
export const EMERGENCE_END_EVENT = 'emergence.end';

/** In the screen frame the Flat's room (game = screen + (0.12, 0.76, -2.315)): x -1.47 to 1.23 wall to wall, the bookshelf at x 0.96 to
 *  1.23 for z -0.64 to 0.77 (up to y 0.79), the arch's wall at z 2.30 to 2.48, the kotatsu's collider x +-0.41, z -0.46 to 0.37, the floor
 *  at y -0.76. The goblin's hips at (0, -0.705, 0.865), sliding back to z 1.07 after the flinch; his head about 0.9 above his floor. */
export const FLAT_PRESETS: Readonly<Record<PresetId, CameraPreset>> = {
  // The lab's: close on the screen from low front-right, over the board in front of his right hand; 4 cm further back than the lab so the
  // eye is clear of the kotatsu's collider (which is taller than the board: 0.9 m).
  'glass-gives': { eye: [0.44, -0.12, 0.44], at: [-0.06, -0.02, 0], fov: 42 },
  // The lab's: three-quarter on the bulging screen from the front-right, him leaning away at the frame's edge.
  push: { eye: [0.72, -0.12, 0.62], at: [-0.04, -0.1, 0.08], fov: 46 },
  // The wide: high three-quarter from behind his right, 1.6 m off by the east wall south of the bookshelf (the lab's profile was 2.4 m out,
  // inside the east wall here): the sac coming into the room off the board and him on the floor back from it.
  'push-wide': { eye: [1.1, 0.45, 1.45], at: [0, -0.3, 0.6], fov: 46 },
  // The lab's: close on the tear from the egg's right side.
  crowning: { eye: [0.62, -0.05, 0.72], at: [0, 0, 0.32], fov: 45 },
  // Over his left shoulder from the arch side, high, past him to the egg slumping onto the keyboard (the lab's was 3 m back in the hall,
  // behind the arch's west wall here).
  out: { eye: [-0.3, 0.45, 1.85], at: [0.05, -0.3, 0.35], fov: 44 },
  // Low from his front-right, three-quarter on his face looking down at the egg in its goo, the healing screen beyond (the lab's eye was
  // 1.15 m out to the side, inside the bookshelf here).
  settle: { eye: [0.85, 0.04, 0.1], at: [0, -0.07, 0.55], fov: 46 },
};

/** The preset in force at sequence time t (the lab's presetAt). */
export function presetAt(t: number): { id: PresetId; preset: CameraPreset } {
  const s = SHOTS.find(x => t < x.end) ?? SHOTS[SHOTS.length - 1]!;
  const id: PresetId = s.id === 'push' && t >= PUSH_WIDE_AT ? 'push-wide' : s.id;
  return { id, preset: FLAT_PRESETS[id] };
}

/** The sequence's shots: one per SHOTS entry, the push split at PUSH_WIDE_AT, each a fixed camera placed through `placement`. */
export function shotsFor(placement: Placement, centreFov = GAME_CENTRE_FOV): SequenceShot[] {
  const shot = (id: PresetId, duration: number): SequenceShot => {
    const p = FLAT_PRESETS[id];
    return { id, duration, cut: 'hard', camera: { kind: 'fixed', eye: toWorld(placement, p.eye), look: toWorld(placement, p.at), fovDelta: p.fov - centreFov } };
  };
  const out: SequenceShot[] = [];
  for (const s of SHOTS) {
    if (s.id === 'push') {
      out.push(shot('push', PUSH_WIDE_AT - s.start), shot('push-wide', s.end - PUSH_WIDE_AT));
    } else {
      out.push(shot(s.id, s.end - s.start));
    }
  }
  return out;
}

/** The emergence as a sequence for the game's sequence system (registerSequence). */
export function sequenceFor(placement: Placement, centreFov = GAME_CENTRE_FOV, opts: { fadeInS?: number } = {}): Sequence {
  const shots = [...shotsFor(placement, centreFov)];
  // Only the first shot opens from black (arriving from the Night Train).
  if (opts.fadeInS && shots[0]) shots[0] = { ...shots[0], fadeInS: opts.fadeInS };
  return { id: EMERGENCE_SEQUENCE_ID, endEvent: EMERGENCE_END_EVENT, shots };
}

// ---------------------------------------------------------------------------
// The hand-off
// ---------------------------------------------------------------------------
/** His eyes at the end, in the screen frame: the settle pose's head (about (0, 0.17, 0.92), the lab's measure) less a few centimetres
 *  toward the egg and down to the eyes. 0.855 m above the tatami. */
export const SEATED_EYE: Vec3 = [0, 0.15, 0.86];
/** The player's eye height over the feet (game-player.ts PLAYER.eye), restated (pure). */
export const PLAYER_EYE = 1.62;
/** How long the view takes to rise from his seated eye to the player's standing one (s). */
export const RISE_S = 1.2;

export interface Handoff {
  /** The player's feet (world): under his seated eye, on the room's floor (y 0, as the level's start). */
  feet: Vec3;
  /** His seated eye (world), where the view starts. */
  seatedEye: Vec3;
  /** The player's standing eye there (world), where the view ends. */
  standingEye: Vec3;
  /** The egg's centre at rest on the keyboard (world): what the view looks at. */
  look: Vec3;
  /** The player's yaw and pitch at the standing eye, looking at the egg (game-player.ts: forward = [sin yaw, 0, -cos yaw]; pitch up +). */
  yaw: number;
  pitch: number;
}

export function handoffFor(placement: Placement): Handoff {
  const seatedEye = toWorld(placement, SEATED_EYE);
  const look = toWorld(placement, eggCentre(paramsAt(DURATION)));
  const feet: Vec3 = [seatedEye[0], 0, seatedEye[2]];
  const standingEye: Vec3 = [feet[0], feet[1] + PLAYER_EYE, feet[2]];
  const dx = look[0] - standingEye[0], dy = look[1] - standingEye[1], dz = look[2] - standingEye[2];
  return { feet, seatedEye, standingEye, look, yaw: Math.atan2(dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) };
}

/** The rise's ease at u (0..1): 0 his seated eye, 1 the player's own view. */
export function riseAt(u: number): number {
  const c = Math.min(1, Math.max(0, u));
  return c * c * (3 - 2 * c);
}
