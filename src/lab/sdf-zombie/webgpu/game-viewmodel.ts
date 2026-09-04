// src/lab/sdf-zombie/webgpu/game-viewmodel.ts
//
// View-model TIMING for sdf-game.html's sawed-off: the reload state machine,
// the hinge curve, the muzzle-flash envelope and the magazine. Numbers only --
// no Three.js import -- because that is what makes the feel testable without a
// renderer, the same split game-weapon.ts already uses for ballistics.
//
// Beat sheet per the spec's §5 (Doom-SSG rhythm).

import type { Vec3 } from '../types';

export const RELOAD = {
  /** Gun rolled into view AND the top lever thrown. The reference has no
   *  present beat at all -- it is a fixed camera -- so ours is folded INTO the
   *  lever throw rather than added in front of it, which is what keeps the
   *  whole reload at the reference's 1.30 s instead of 1.46 s. */
  presentSec:  0.18,
  /** Barrels at full 45 deg. 0.33 s of travel, straight off the reference. */
  breakEndSec: 0.51,
  ejectEndSec: 0.65,
  loadEndSec:  1.11,
  snapEndSec:  1.16,
  totalSec:    1.30,
  /** How far the barrels swing off the frame, radians (45 deg). The reference
   *  opens this wide; our old 35 deg barely showed the breech. */
  openRad: Math.PI / 4,
  /** When the spent cases start their AXIAL slide out of the bore -- a beat
   *  before the hinge finishes, exactly as the reference does it. */
  extractAtSec: 0.45,
  /** When they clear the mouth and the free tumble takes over. */
  ejectAtSec: 0.51,
  /** When fresh cases first appear coming up from under the frame, and when
   *  they seat. Seating well before the snap so the gun never closes on a
   *  shell that is still visibly outside it. */
  loadStartSec: 0.74,
  /** When the fresh cases arrive STAGED: tips a gap behind the mouths, lying
   *  on the bore axis, still in the hand. From here to loadSeatSec they slide
   *  straight in along the bore -- the extract in reverse. Before this the
   *  hand is carrying them up from below in rig space. Two stages, because a
   *  straight line from under the frame to the mouth passes THROUGH the
   *  barrels, and because a case that is not on the bore axis when it meets
   *  the mouth cannot be pushed in without clipping. */
  loadStageSec: 0.96,
  loadSeatSec:  1.11,
} as const;

/**
 * THE RELOAD AS KEYFRAMES, in the Doom super-shotgun rhythm the owner asked
 * for: present, break, the spent cases up and out, two fresh ones shoved in
 * from below, a hard snap shut, level out.
 *
 * Why a table rather than the curve this replaced: the first pass drove the
 * "present" roll with `sin(PI * t / total)`, which peaks at 0.475 s -- the
 * MIDDLE of the reload. So the gun was still rolling toward the camera while
 * the hinge was already open and the cases were leaving, then un-rolled
 * through the load. Every beat was smeared across every other beat, which is
 * what "doesn't sync up" looked like. Keyframes cannot drift from the beat
 * sheet because they ARE the beat sheet.
 *
 * All values are DELTAS from the idle pose, so game-main keeps ownership of
 * where the gun sits at rest and this file never has to know.
 */
export interface ReloadPose {
  /** Roll toward the camera, DEGREES (negative = breech rolls into view). */
  roll: number;
  /** Muzzle pitch, DEGREES (positive = muzzle down, presenting the breech). */
  pitch: number;
  /** Rise, metres. */
  dy: number;
  /** Toward the camera, metres. */
  dz: number;
  /** Hinge opening, 0 shut .. 1 fully broken. */
  hinge: number;
}

const RELOAD_KEYS: readonly (ReloadPose & { t: number })[] = [
  // LOW, not centred. The first table lifted the gun 11.5 cm and rolled it
  // 30 deg so the breech filled the centre of the frame -- where the fisheye
  // magnifies 1.73x -- and the owner's read was that the reload blocked the
  // view and distracted. The owner asked for the gun LOWERED instead; tried
  // at dy -0.055 the whole reload left the bottom of the frame, because at
  // rest the breech already sits ON the bottom edge (19 deg below the
  // horizon at z -0.33). So: the smallest lift that keeps the open mouths in
  // the lower third (4 cm), pitched muzzle-down so they are seen from above
  // and behind, only enough roll to read the breech, and less travel toward
  // the eye than before so it stays small. Doom's super shotgun reloads at
  // the bottom of the screen the same way.
  { t: 0.00, roll:   0, pitch:  0, dy: 0.000, dz: 0.000, hinge: 0 },
  { t: 0.18, roll: -12, pitch: 10, dy: 0.025, dz: 0.020, hinge: 0 },
  { t: 0.51, roll: -16, pitch: 16, dy: 0.040, dz: 0.030, hinge: 1 },
  { t: 0.65, roll: -16, pitch: 17, dy: 0.042, dz: 0.031, hinge: 1 },
  { t: 1.11, roll: -14, pitch: 15, dy: 0.037, dz: 0.027, hinge: 1 },
  // The snap. 0.14 s to shut against 0.33 s to open, so it closes far harder
  // than it opened -- that asymmetry IS the "clack".
  { t: 1.16, roll:  -4, pitch:  3, dy: 0.010, dz: 0.006, hinge: 0 },
  { t: 1.30, roll:   0, pitch:  0, dy: 0.000, dz: 0.000, hinge: 0 },
];

export const FLASH = {
  /** Visible window, seconds. Short on purpose: a muzzle flash that outlasts
   *  two frames reads as a lamp, not a detonation. */
  windowSec: 0.07,
  /** Exponential decay rate. 60 gives ~2% left at the window's end. */
  decay: 60,
} as const;

export const MAGAZINE_CAPACITY = 2;

export type ReloadPhase =
  | 'present' | 'break' | 'eject' | 'load' | 'snap' | 'settle' | 'done';

/** Which beat the reload is in at `t` seconds since it started. */
export function reloadPhaseAt(t: number): ReloadPhase {
  if (t < 0) return 'done';
  if (t < RELOAD.presentSec)  return 'present';
  if (t < RELOAD.breakEndSec) return 'break';
  if (t < RELOAD.ejectEndSec) return 'eject';
  if (t < RELOAD.loadEndSec)  return 'load';
  if (t < RELOAD.snapEndSec)  return 'snap';
  if (t <= RELOAD.totalSec)   return 'settle';
  return 'done';
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/**
 * The posed view-model at `t` seconds into the reload, interpolated across
 * RELOAD_KEYS with a smoothstep on each segment so nothing changes velocity
 * discontinuously at a key.
 */
export function reloadPose(t: number): ReloadPose {
  const strip = (k: ReloadPose): ReloadPose =>
    ({ roll: k.roll, pitch: k.pitch, dy: k.dy, dz: k.dz, hinge: k.hinge });
  const REST: ReloadPose = { roll: 0, pitch: 0, dy: 0, dz: 0, hinge: 0 };
  let a = RELOAD_KEYS[0];
  if (a === undefined) return REST;
  if (t <= a.t) return strip(a);
  for (let i = 1; i < RELOAD_KEYS.length; i++) {
    const b = RELOAD_KEYS[i];
    if (b === undefined) break;
    if (t < b.t) {
      const k = smoothstep(a.t, b.t, t);
      const mix = (x: number, y: number) => x + (y - x) * k;
      return {
        roll:  mix(a.roll,  b.roll),
        pitch: mix(a.pitch, b.pitch),
        dy:    mix(a.dy,    b.dy),
        dz:    mix(a.dz,    b.dz),
        hinge: mix(a.hinge, b.hinge),
      };
    }
    a = b;
  }
  return strip(a);
}

/** 0 = shut, 1 = fully broken open. Now read straight off the keyframe table,
 *  so the hinge cannot disagree with the pose that carries it. */
export function hingeOpenFraction(t: number): number {
  if (t < 0) return 0;
  return Math.min(1, Math.max(0, reloadPose(t).hinge));
}

/** The bore's basis in rig space, read off the live locators each frame:
 *  `out` is the unit vector from the muzzle to the breech (the direction a
 *  case leaves the chamber), `side` runs from the left chamber to the right.
 *  Up is rig +Y. */
export interface BoreFrame {
  out: readonly [number, number, number];
  side: readonly [number, number, number];
}

/** Deterministic -1..1 jitter from a reload seed. Seed 0 is the reference
 *  arc with no jitter at all, so tests and gates can pin it. */
function jitter(seed: number, i: number, n: number): number {
  if (seed === 0) return 0;
  const x = Math.sin(seed * 12.9898 + i * 78.233 + n * 37.719) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

/** How long the free tumble is drawn at most, seconds. */
const EJECT_LIFE_SEC = 0.85;
/** Once past the apex, a case this close to breech height is dropped rather
 *  than drawn falling back through the frame past the camera. */
const EJECT_DROP_BELOW_M = 0.10;

/** Where a spent case is at `t`, as a DISPLACEMENT from where the hand-off
 *  left it, or null when it has not been thrown yet or is out of interest.
 *
 *  The tumble starts along the BORE. The first pass threw the case straight
 *  up in rig space from the chamber mouth, on a shell that was snapped to the
 *  rig's -Z: its rear half was still inside the tube and its rise cut through
 *  the chamber wall and the standing breech -- the owner's "clip through the
 *  gun frame". Now the velocity has a component along `frame.out`, so the
 *  case keeps leaving the bore while gravity bends it up and over.
 *
 *  Doom throws them UP and back over the shoulder, which is the read we want
 *  -- cases that merely drop are invisible against a dark floor -- and they
 *  never come back down into frame. Ours don't either: see EJECT_DROP_BELOW_M.
 *
 *  `seed` varies the arc per reload (owner: "always eject the same animation");
 *  0 is the reference arc. Whatever the seed, `t === ejectAtSec` is the
 *  origin, which is what the shorty gate pins against the live breech. */
export function ejectedShell(
  t: number, i: 0 | 1, frame: BoreFrame, seed = 0,
): { x: number; y: number; z: number; spin: number } | null {
  const dt = t - RELOAD.ejectAtSec;
  if (dt < 0 || dt > EJECT_LIFE_SEC) return null;
  const sign = i === 0 ? -1 : 1;
  // Along the bore: fast enough that the case keeps clearing the tube, slow
  // enough that the toward-camera share of `out` on an open gun (~0.4) does
  // not carry it to the eye. Up: hard, so the apex sits well above the frame.
  const vOut  = 0.55 * (1 + 0.20 * jitter(seed, i, 0));
  const vUp   = 2.05 * (1 + 0.12 * jitter(seed, i, 1));
  // Both drift toward the right shoulder, the right case more so.
  const vSide = (0.34 * sign + 0.30) + 0.14 * jitter(seed, i, 2);
  const g = -6.2;                  // exaggerated, to match the pellet gravity
  const y = vUp * dt + 0.5 * g * dt * dt;
  const rising = dt < vUp / -g;
  if (!rising && y < EJECT_DROP_BELOW_M) return null;
  const { out, side } = frame;
  const a = vOut * dt, b = vSide * dt;
  return {
    x: out[0] * a + side[0] * b,
    y: out[1] * a + side[1] * b + y,
    z: out[2] * a + side[2] * b,
    spin: dt * (11 + 4 * sign) * (1 + 0.25 * jitter(seed, i, 3)),
  };
}

/** 0..1 of the rig-space CARRY: the fresh cases riding in the support hand
 *  from below the frame to their staged position behind the mouths. Null
 *  outside the window. */
export function loadCarry(t: number): number | null {
  if (t < RELOAD.loadStartSec || t > RELOAD.loadStageSec) return null;
  return smoothstep(RELOAD.loadStartSec, RELOAD.loadStageSec, t);
}

/** 0..1 of the barrel-local INSERT: staged (0) to seated (1). The mirror of
 *  extractStage, and driven the same way -- the seated Shell_L/R nodes slide
 *  along their own local bore axis, so a tilted gun needs no rotated basis.
 *  Null outside the window. */
export function insertStage(t: number): number | null {
  if (t < RELOAD.loadStageSec || t > RELOAD.loadSeatSec) return null;
  return smoothstep(RELOAD.loadStageSec, RELOAD.loadSeatSec, t);
}

/** Chamber depth in metres, mirroring CHAMBER_DEPTH in the model script. A
 *  shell has cleared the mouth once it has travelled this far. */
export const CHAMBER_DEPTH_M = 0.070;

/** Case length, metres. The model script sets SHELL_LEN = CHAMBER_DEPTH: a
 *  case exactly fills its chamber, head rim flush with the breech face. */
export const SHELL_LEN_M = CHAMBER_DEPTH_M;

/** How far behind the mouth a fresh case's TIP is staged before the push in,
 *  metres. Small: it only has to be visibly outside the gun for a frame. */
export const LOAD_STAGE_GAP_M = 0.015;

/** The staged centre of a fresh case, rig space: the case lies on the bore
 *  axis with its tip LOAD_STAGE_GAP_M behind the mouth. This is exactly where
 *  the seated Shell node's centre is when its local z is pulled back by
 *  CHAMBER_DEPTH_M + LOAD_STAGE_GAP_M, which is what makes the rig-space
 *  carry and the barrel-local insert meet without a visible jump. */
export function stagedShellCenter(mouth: Vec3, out: Vec3): Vec3 {
  const d = SHELL_LEN_M / 2 + LOAD_STAGE_GAP_M;
  return [mouth[0] + out[0] * d, mouth[1] + out[1] * d, mouth[2] + out[2] * d];
}

/** Chamber centre-to-centre half spacing, metres: XSEP in the model script. */
export const CHAMBER_HALF_SEP_M = 0.0234;
/** Case radius, metres (the tumble/carry meshes; the GLB's is RCH*0.985). */
export const SHELL_RADIUS_M = 0.0172;

/**
 * Where the support hand's orb sits while it loads, rig space, given the
 * midpoint between the two mouths, the bore's `out` and `side`, and the orb's
 * radius.
 *
 * BESIDE the cases, not behind them. The first placement put the orb behind
 * the heads along `out`, pushing them like a thumb -- and on the presented
 * gun `out` points largely AT the camera, so the orb landed between the eye
 * and the breech and hid the entire load (the 960/1040 ms captures were a
 * green disc with a red sliver). Off to the left of the pair, level with the
 * heads, the orb reads as the fist the cases stick out of and leaves both of
 * them and both mouths in view.
 *
 * `stage`: beside the staged cases' rear halves.
 * `seat`: the hand follows the cases down the bore and stops with the orb's
 * centre a radius short of the mouth plane, beside the left chamber, so it
 * never enters the standing breech. The cases finish seating under their own
 * momentum, which is also how the reference reads it.
 */
export function loadHold(
  mouthMid: Vec3, out: Vec3, _side: Vec3, handRadius: number,
): { stage: Vec3; seat: Vec3 } {
  const staged = stagedShellCenter(mouthMid, out);
  // A FIST, centred on the pair, just behind their heads: the cases stick out
  // of it toward the mouths, and as it pushes it covers the heads and then
  // the mouths. The owner's read of the beside-the-pair placement was "the
  // hand holds one shell and the other is floating"; two cases jammed in
  // together ARE mostly hidden by the hand doing it. This only works because
  // the gun is now LOWERED for the reload (RELOAD_KEYS): on the raised,
  // presented pose the same fist sat between the eye and the breech and hid
  // the whole load.
  const at = (o: Vec3, alongOut: number): Vec3 => [
    o[0] + out[0] * alongOut,
    o[1] + out[1] * alongOut,
    o[2] + out[2] * alongOut,
  ];
  return {
    stage: at(staged, SHELL_LEN_M / 2 + handRadius * 0.35),
    seat: at(mouthMid, handRadius * 0.95),
  };
}

/** Extractor throw in metres. Proportional to the reference's, which pushes
 *  its slugs about 65% of a case length clear of the mouth. */
export const EXTRACTOR_THROW_M = 0.009;

const LEVER_THROW_RAD = Math.PI * 40 / 180;

/**
 * Top-lever yaw at `t`, radians. Thrown open across the present beat, held
 * while the action is open, home again as it snaps shut.
 *
 * It has to LEAD the break: on a real break-action the lever unlocks the bolt
 * before the barrels can drop, and the reference animates exactly that (its
 * `release` is at full throw a sixth of a second before `front` starts to
 * move). A lever that swings WITH the barrels reads as decoration.
 */
export function topLeverAngle(t: number): number {
  if (t <= 0 || t >= RELOAD.totalSec) return 0;
  if (t < RELOAD.presentSec) {
    return LEVER_THROW_RAD * smoothstep(0, RELOAD.presentSec, t);
  }
  if (t < RELOAD.snapEndSec) return LEVER_THROW_RAD;
  return LEVER_THROW_RAD * (1 - smoothstep(RELOAD.snapEndSec, RELOAD.totalSec, t));
}

/**
 * Normalised 0..1 axial travel of a seated case, or `null` outside the extract
 * window. Multiply by CHAMBER_DEPTH_M for metres.
 *
 * This is stage one of a TWO-STAGE eject, which is the thing that makes cases
 * leave a tilted gun correctly. The case is a child of the barrel group, so
 * this slide happens in the barrels' own frame and needs no rotated basis;
 * `ejectedShell` then takes over for the free tumble.
 */
export function extractStage(t: number): number | null {
  if (t < RELOAD.extractAtSec || t > RELOAD.ejectAtSec) return null;
  return smoothstep(RELOAD.extractAtSec, RELOAD.ejectAtSec, t);
}

/**
 * Extractor throw in metres at `t`. Rides out with the cases, HOLDS while the
 * breech is empty, and retracts as the fresh ones seat -- the reference's
 * `unloader` channel exactly.
 */
export function extractorOffset(t: number): number {
  if (t < RELOAD.extractAtSec || t >= RELOAD.loadSeatSec) return 0;
  if (t < RELOAD.ejectAtSec) {
    return EXTRACTOR_THROW_M * smoothstep(RELOAD.extractAtSec, RELOAD.ejectAtSec, t);
  }
  if (t < RELOAD.loadStartSec) return EXTRACTOR_THROW_M;
  return EXTRACTOR_THROW_M * (1 - smoothstep(RELOAD.loadStartSec, RELOAD.loadSeatSec, t));
}

/** Flash brightness at `t` seconds since the shot: instant attack, exponential
 *  decay, hard zero outside the window so nothing lingers a frame too long. */
export function flashEnvelope(t: number): number {
  if (t < 0 || t >= FLASH.windowSec) return 0;
  return Math.exp(-FLASH.decay * t);
}

/** Shells left after pulling `barrels` triggers on a gun holding `shells`.
 *  Both barrels on one shell spends the one shell, not minus one. */
export function magazineAfterFire(shells: number, barrels: 1 | 2): number {
  return Math.max(0, shells - Math.min(shells, barrels));
}

// ——— Fire recoil ————————————————————————————————————————————————————————

export const RECOIL = {
  /** How long the weapon takes to come back to rest, seconds. Short: a
   *  sawed-off snaps back, it does not wallow. */
  durationSec: 0.26,
  /** Peak travel straight back toward the eye, metres, per barrel. */
  kickBack: 0.075,
  /** Peak rise, metres, per barrel. */
  kickUp: 0.030,
  /** Peak muzzle-up rotation, degrees, per barrel. */
  kickPitchDeg: 9.0,
  /** Peak roll, degrees, per barrel — a single barrel is off-axis, so the gun
   *  twists as well as lifts. */
  kickRollDeg: 4.0,
} as const;

export interface RecoilPose { dy: number; dz: number; pitch: number; roll: number; }

/**
 * Weapon recoil at `t` seconds since the shot, scaled by how many barrels went
 * off. Instant spike, then a decaying return that UNDERSHOOTS slightly before
 * settling — the small dip past rest is what makes it read as a mechanism
 * absorbing a shove rather than a value lerping home.
 */
export function fireRecoil(t: number, barrels: 1 | 2 = 1): RecoilPose {
  if (t < 0 || t >= RECOIL.durationSec) return { dy: 0, dz: 0, pitch: 0, roll: 0 };
  const u = t / RECOIL.durationSec;
  // Fast attack over the first ~12%, then decay with one small overshoot.
  const attack = Math.min(1, u / 0.12);
  const decay = Math.exp(-5.2 * u) * Math.cos(7.5 * u);
  const s = attack * decay * (barrels === 2 ? 1.65 : 1);
  return {
    dy: RECOIL.kickUp * s,
    dz: RECOIL.kickBack * s,
    pitch: -RECOIL.kickPitchDeg * s,
    roll: RECOIL.kickRollDeg * s,
  };
}

// ——— The support hand ———————————————————————————————————————————————————

export interface SupportHandPose {
  dx: number; dy: number; dz: number;
  /** True while the hand is visibly carrying fresh cases toward the breech. */
  carrying: boolean;
}

export interface HandDelta { dx: number; dy: number; dz: number; }

/** The two load-beat keys the caller DERIVES from the live breech (see
 *  loadHold), as deltas from the hand's rest. */
export interface HandHold { stage: HandDelta; seat: HandDelta; }

/**
 * Where the left hand is through the reload, as a delta from its resting place
 * on the fore-end.
 *
 * It has to actually LEAVE and COME BACK. The first pass just dipped it 13 cm
 * on a binary flag during the load beat, which reads as a teleport and never
 * shows the hand doing anything. Here it falls away as the gun presents, drops
 * out of frame low and left, then rises carrying two cases, seats them, and
 * withdraws to the fore-end.
 *
 * The two keys at loadStageSec and loadSeatSec are AUTHORED FALLBACKS only.
 * The hand's job on those beats is to be at the breech, and the breech is
 * wherever the open barrels put it this frame -- so game-main passes a `hold`
 * read off the live locators and these two keys are replaced by it. The
 * 1110 ms capture of the authored table had the hand at the bottom of the
 * frame while the cases seated by themselves; that is the failure mode.
 */
const SUPPORT_KEYS: readonly (SupportHandPose & { t: number })[] = [
  { t: 0.00, dx:  0.000, dy:  0.000, dz: 0.000, carrying: false },
  { t: 0.18, dx: -0.020, dy: -0.060, dz: 0.020, carrying: false },
  { t: 0.51, dx: -0.060, dy: -0.200, dz: 0.060, carrying: false },
  { t: 0.74, dx: -0.050, dy: -0.160, dz: 0.100, carrying: true  },
  { t: 0.96, dx:  0.010, dy:  0.010, dz: 0.140, carrying: true  },  // hold.stage
  { t: 1.11, dx:  0.020, dy:  0.020, dz: 0.120, carrying: true  },  // hold.seat
  { t: 1.16, dx: -0.010, dy: -0.040, dz: 0.060, carrying: false },
  { t: 1.30, dx:  0.000, dy:  0.000, dz: 0.000, carrying: false },
];

export function supportHandPose(t: number, hold?: HandHold): SupportHandPose {
  const REST: SupportHandPose = { dx: 0, dy: 0, dz: 0, carrying: false };
  const key = (k: SupportHandPose & { t: number }): SupportHandPose & { t: number } => {
    if (!hold) return k;
    if (k.t === RELOAD.loadStageSec) return { ...k, ...hold.stage };
    if (k.t === RELOAD.loadSeatSec) return { ...k, ...hold.seat };
    return k;
  };
  let a = SUPPORT_KEYS[0];
  if (a === undefined) return REST;
  if (t <= a.t) return { dx: a.dx, dy: a.dy, dz: a.dz, carrying: a.carrying };
  a = key(a);
  for (let i = 1; i < SUPPORT_KEYS.length; i++) {
    const raw = SUPPORT_KEYS[i];
    if (raw === undefined) break;
    const b = key(raw);
    if (t < b.t) {
      const k = smoothstep(a.t, b.t, t);
      const mix = (x: number, y: number) => x + (y - x) * k;
      return {
        dx: mix(a.dx, b.dx), dy: mix(a.dy, b.dy), dz: mix(a.dz, b.dz),
        carrying: t >= RELOAD.loadStartSec && t < RELOAD.loadSeatSec,
      };
    }
    a = b;
  }
  return { dx: a.dx, dy: a.dy, dz: a.dz, carrying: false };
}
