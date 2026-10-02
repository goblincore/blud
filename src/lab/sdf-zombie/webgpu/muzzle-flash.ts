// src/lab/sdf-zombie/webgpu/muzzle-flash.ts
//
// The shotgun's muzzle flash as PER-BARREL FLAME JETS: pure timing and motion,
// no renderer. The first flash was one star-shaped sprite at the midpoint of the
// two bores for 0.07 s, and the owner's read was "some smoke, but it needs more
// of an explosion/flame effect from the ends of the barrels".
//
// Each fired barrel gets a jet made of four layers, all additive:
//   core    a hot white-yellow star facing the camera (the existing flash sprite)
//   tongue  a flame teardrop shot out along the bore, yellow -> orange -> red
//   bloom   a wide soft fireball puffing out around the mouth
//   sparks  a few streaks thrown forward and out, dragged and dropped
// Everything here is a function of seconds since the shot, so it is testable and
// the leaf that draws it (game-muzzle-flash.ts) holds no timing of its own.

export const MUZZLE_FLASH = {
  /** Every layer is dark by this many seconds after the shot. */
  windowSec: 0.13,
  /** The core's exponential decay rate (1/s): ~1% left at the window's end. */
  coreDecay: 36,
  /** The tongue reaches its full length this fast. */
  tongueRiseSec: 0.022,
  /** Longest the flame tongue gets, metres, and its widest, metres. */
  tongueMaxLen: 0.42,
  tongueMaxWidth: 0.16,
  /** Fireball scale (metres across) at the start and the end of the window. */
  bloomStart: 0.10,
  bloomEnd: 0.46,
  /** Core star scale (metres across) at the start and the end. */
  coreStart: 0.14,
  coreEnd: 0.30,
  /** Sparks per barrel, their speed range (m/s), drag rate (1/s), gravity (m/s^2)
   *  and life (s). */
  sparkCount: 7,
  sparkSpeedMin: 4,
  sparkSpeedMax: 9,
  sparkDrag: 7,
  sparkGravity: 5.5,
  sparkLifeSec: 0.2,
} as const;

const W = MUZZLE_FLASH.windowSec;
const inWindow = (t: number): boolean => t >= 0 && t <= W;
const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
const smooth = (x: number): number => { const k = clamp01(x); return k * k * (3 - 2 * k); };

/** Core opacity: full at the shot, then an exponential burn-off. */
export function coreAlpha(t: number): number {
  return inWindow(t) ? Math.exp(-MUZZLE_FLASH.coreDecay * t) : 0;
}

/** Core size (metres across): it swells as it dies, gas pushing outward. */
export function coreScale(t: number): number {
  const u = clamp01(t / W);
  return MUZZLE_FLASH.coreStart + (MUZZLE_FLASH.coreEnd - MUZZLE_FLASH.coreStart) * Math.sqrt(u);
}

/** The flame tongue's length, metres: it is thrown out in ~1.5 frames, then
 *  collapses back to the muzzle as the gas burns off. */
export function tongueLength(t: number): number {
  if (!inWindow(t)) return 0;
  const rise = MUZZLE_FLASH.tongueRiseSec;
  if (t < rise) return MUZZLE_FLASH.tongueMaxLen * Math.sin((t / rise) * Math.PI / 2);
  const u = (t - rise) / (W - rise);
  return MUZZLE_FLASH.tongueMaxLen * Math.pow(1 - u, 1.6);
}

/** The tongue's width, metres: it spreads as it travels, so it is a plume. */
export function tongueWidth(t: number): number {
  if (!inWindow(t)) return 0;
  const u = clamp01(t / W);
  return MUZZLE_FLASH.tongueMaxWidth * (0.55 + 0.45 * smooth(u * 3)) * (1 - 0.35 * u);
}

/** The tongue's opacity: bright through the throw, gone with the window. */
export function tongueAlpha(t: number): number {
  return inWindow(t) ? Math.pow(1 - clamp01(t / W), 0.8) : 0;
}

/** The fireball's size, metres across: it puffs out fast, then eases. */
export function bloomScale(t: number): number {
  const u = clamp01(t / W);
  return MUZZLE_FLASH.bloomStart + (MUZZLE_FLASH.bloomEnd - MUZZLE_FLASH.bloomStart) * Math.sqrt(u);
}

/** The fireball's opacity: quick to full, then a squared fade. */
export function bloomAlpha(t: number): number {
  if (!inWindow(t)) return 0;
  const u = clamp01(t / W);
  return 0.75 * Math.min(1, u * 12) * (1 - u) * (1 - u);
}

/** A spark's displacement from the muzzle, metres, `t` seconds after the shot,
 *  thrown along unit `dir` at `speed` m/s: dragged (the closed form of
 *  v' = -k v) and dropped by gravity. */
export function sparkOffset(t: number, dir: readonly [number, number, number], speed: number): [number, number, number] {
  if (t <= 0) return [0, 0, 0];
  const k = MUZZLE_FLASH.sparkDrag;
  const travel = (speed * (1 - Math.exp(-k * t))) / k;
  return [dir[0] * travel, dir[1] * travel - 0.5 * MUZZLE_FLASH.sparkGravity * t * t, dir[2] * travel];
}

export function sparkAlpha(t: number): number {
  const life = MUZZLE_FLASH.sparkLifeSec;
  if (t < 0 || t > life) return 0;
  return Math.pow(1 - t / life, 1.3);
}

/** Which of [left, right] flame. A double shot lights both. A single shot lights
 *  one, alternating by `shotIndex` so repeat single shots do not all spit from
 *  the same bore (the gun does not model which barrel a click fired). */
export function jetFlameSides(barrels: 1 | 2, shotIndex: number): [boolean, boolean] {
  if (barrels === 2) return [true, true];
  return shotIndex % 2 === 0 ? [true, false] : [false, true];
}
