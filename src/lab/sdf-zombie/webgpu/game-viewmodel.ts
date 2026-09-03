// src/lab/sdf-zombie/webgpu/game-viewmodel.ts
//
// View-model TIMING for sdf-game.html's sawed-off: the reload state machine,
// the hinge curve, the muzzle-flash envelope and the magazine. Numbers only --
// no Three.js import -- because that is what makes the feel testable without a
// renderer, the same split game-weapon.ts already uses for ballistics.
//
// Beat sheet per the spec's §5 (Doom-SSG rhythm).

export const RELOAD = {
  presentSec:  0.14,
  breakEndSec: 0.32,
  ejectEndSec: 0.44,
  loadEndSec:  0.72,
  snapEndSec:  0.86,
  totalSec:    1.05,
  /** How far the barrels swing off the frame, radians (~35 deg). */
  openRad: 0.61,
  /** When the spent cases leave the breech. Inside the eject beat, a beat
   *  after the hinge is fully open -- they cannot clear a shut gun. */
  ejectAtSec: 0.34,
  /** When fresh cases first appear coming up from under the frame, and when
   *  they seat. Seating a hair before the snap so the gun never closes on a
   *  shell that is still visibly outside it. */
  loadStartSec: 0.46,
  loadSeatSec:  0.70,
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
  // The present has to bring the BREECH into frame, not merely tilt the gun:
  // at roll -19 / dy 0.055 the action opened off the bottom-right of the screen
  // and the break was invisible, which defeats the point of the animation.
  { t: 0.00, roll:   0, pitch:  0, dy: 0.000, dz: 0.000, hinge: 0 },
  { t: 0.14, roll: -22, pitch: 11, dy: 0.085, dz: 0.055, hinge: 0 },
  { t: 0.32, roll: -30, pitch: 21, dy: 0.115, dz: 0.080, hinge: 1 },
  { t: 0.44, roll: -30, pitch: 22, dy: 0.118, dz: 0.082, hinge: 1 },
  { t: 0.72, roll: -27, pitch: 19, dy: 0.108, dz: 0.074, hinge: 1 },
  // The snap. 0.14 s to shut against 0.18 s to open, so it closes harder than
  // it opened -- that asymmetry IS the "clack".
  { t: 0.86, roll:  -9, pitch:  3, dy: 0.022, dz: 0.012, hinge: 0 },
  { t: 1.05, roll:   0, pitch:  0, dy: 0.000, dz: 0.000, hinge: 0 },
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

/** Where a spent case is at `t`, relative to the breech, or null when it has
 *  not been thrown yet or has fallen out of interest. Ballistic and
 *  deterministic: same reload, same arc, every time.
 *
 *  Doom throws them UP and back over the shoulder, which is the read we want --
 *  cases that merely drop are invisible against a dark floor. */
export function ejectedShell(t: number, i: 0 | 1): { x: number; y: number; z: number; spin: number } | null {
  const dt = t - RELOAD.ejectAtSec;
  if (dt < 0 || dt > 0.85) return null;
  const side = i === 0 ? -1 : 1;
  // MOSTLY SIDEWAYS, barely toward the eye. The first pass used vz = 0.95,
  // which carried a case from the breech to within ~8 cm of the camera in a
  // third of a second -- a 7 cm shell that close fills a quarter of the frame.
  // Up and out past the shoulder reads as ejection; at the face reads as a bug.
  const vx = 0.62 * side + 0.46;
  const vy = 1.42;                 // up hard
  const vz = 0.12;                 // a hair toward the camera, no more
  const g = -6.2;                  // exaggerated, to match the pellet gravity
  return {
    x: vx * dt,
    y: vy * dt + 0.5 * g * dt * dt,
    z: vz * dt,
    spin: dt * (11 + 4 * side),
  };
}

/** 0..1 travel of the fresh cases from below the frame into the chambers, or
 *  null outside the load beat. 1 = seated. */
export function loadShellTravel(t: number): number | null {
  if (t < RELOAD.loadStartSec || t > RELOAD.snapEndSec) return null;
  if (t >= RELOAD.loadSeatSec) return 1;
  return smoothstep(RELOAD.loadStartSec, RELOAD.loadSeatSec, t);
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

/**
 * Where the left hand is through the reload, as a delta from its resting place
 * on the fore-end.
 *
 * It has to actually LEAVE and COME BACK. The first pass just dipped it 13 cm
 * on a binary flag during the load beat, which reads as a teleport and never
 * shows the hand doing anything. Here it falls away as the gun presents, drops
 * out of frame low and left, then rises carrying two cases, seats them, and
 * withdraws to the fore-end.
 */
const SUPPORT_KEYS: readonly (SupportHandPose & { t: number })[] = [
  { t: 0.00, dx:  0.000, dy:  0.000, dz: 0.000, carrying: false },
  { t: 0.14, dx: -0.020, dy: -0.060, dz: 0.020, carrying: false },
  { t: 0.32, dx: -0.060, dy: -0.200, dz: 0.060, carrying: false },
  { t: 0.46, dx: -0.050, dy: -0.160, dz: 0.100, carrying: true  },
  { t: 0.70, dx:  0.020, dy:  0.020, dz: 0.120, carrying: true  },
  { t: 0.86, dx: -0.010, dy: -0.040, dz: 0.060, carrying: false },
  { t: 1.05, dx:  0.000, dy:  0.000, dz: 0.000, carrying: false },
];

export function supportHandPose(t: number): SupportHandPose {
  const REST: SupportHandPose = { dx: 0, dy: 0, dz: 0, carrying: false };
  let a = SUPPORT_KEYS[0];
  if (a === undefined) return REST;
  if (t <= a.t) return { dx: a.dx, dy: a.dy, dz: a.dz, carrying: a.carrying };
  for (let i = 1; i < SUPPORT_KEYS.length; i++) {
    const b = SUPPORT_KEYS[i];
    if (b === undefined) break;
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
