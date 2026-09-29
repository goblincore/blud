// src/lab/sdf-zombie/webgpu/lamp-moods.ts
//
// LAMP MOODS (Night Train dynamic light spec §2.5, §3). Pure: a lamp's level (a multiplier
// on its power) for its ambient mood and for a scripted event, at a time on the sim clock.
// Seeded by the lamp, never Math.random, so a replay lights the same way.

export type LampMood = 'steady' | 'flicker' | 'stutter' | 'dying' | 'dead' | 'fire';
export const LAMP_MOODS: readonly LampMood[] = ['steady', 'flicker', 'stutter', 'dying', 'dead', 'fire'];

export type LampScript =
  | { mode: 'die'; at: number }
  | { mode: 'blackout'; at: number }
  | { mode: 'strobe'; at: number; reduced?: boolean }
  | { mode: 'emergency'; at: number };

export const LAMP_SCRIPT = {
  /** die: sputter this long, then dark for good. */
  sputterS: 1.2,
  /** blackout: dark this long, then stutter back over recoverS. */
  blackoutS: 6,
  recoverS: 1.5,
  /** strobe: surge, strobe, then dark for good. */
  surgeS: 0.5,
  strobeS: 3,
  strobeHz: 8,
  /** strobe afterglow (owner, 2026-09-29: "a contrasting strobe ... cold blue-white"): after the opening strobe the tubes stay
   *  dark for burstDelayS (the red beacons get a beat; every gate probe sits inside it), then fire cold lightning-style bursts.
   *  One burst per burstWindowS window at a hashed offset, kept burstMinGapS clear of the next window's burst; a burst is 2 or
   *  3 flashes of burstFlashS with burstGapS between, at burstLevel (a tube is 1). The whole room flashes together (the room's
   *  seed is the script's start), each lamp a few ms off. Never more than 3 flashes in any second. */
  burstDelayS: 3.5,
  burstWindowS: 6,
  burstMinGapS: 2.5,
  burstMaxS: 0.4,
  burstFlashS: 0.07,
  burstGapS: 0.06,
  burstLevel: 1.7,
  /** `?flashes=reduced`: the opening strobe slows to this rate, and each burst is one smooth pulse of burstMaxS. */
  strobeHzReduced: 2,
  /** emergency: dark through the strobe (surgeS + strobeS), then a stutter on over emergencyOnS, then 1 for good. */
  emergencyOnS: 0.3,
} as const;

/** 0..1 from two integers (an integer mix; stable across platforms). */
export function hash01(seed: number, slot: number): number {
  let h = (Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(slot | 0, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const wobble = (t: number, phase: number) => Math.sin(t * 7.3 + phase) * 0.5 + Math.sin(t * 17.1 + phase * 2.3) * 0.25;
/** A per-lamp integer from a (possibly fractional) seed. */
const iseed = (seed: number) => Math.floor(seed * 1000);

/** Stutter bursts: 0.4-1.2 s long, one per 3-7 s window. */
function inBurst(t: number, s: number): boolean {
  const win = 5;   // windows of 5 s, each with one burst at a hashed offset (so gaps are ~3-7 s)
  const w = Math.floor(t / win);
  const start = w * win + hash01(s, w * 3 + 1) * (win - 1.2);
  const len = 0.4 + hash01(s, w * 3 + 2) * 0.8;
  return t >= start && t < start + len;
}

export function moodLevel(mood: LampMood, t: number, seed: number): number {
  const s = iseed(seed);
  switch (mood) {
    case 'steady':
      return 1 + wobble(t, seed) * 0.14;
    case 'flicker': {
      // A failing fluorescent tube (owner, 2026-09-26: "very dramatic flicker"): mostly on, with
      // hard drop-outs in 0.05 s slots and the odd longer gasp.
      const slot = Math.floor(t / 0.05);
      if (hash01(s, slot) < 0.14) return 0;
      if (hash01(s + 5, Math.floor(t / 0.6)) < 0.08) return hash01(s + 9, slot) < 0.5 ? 0 : 0.25;
      return clamp(1 + wobble(t, seed) * 0.12, 0, 1.4);
    }
    case 'stutter': {
      if (inBurst(t, s) && hash01(s + 7, Math.floor(t / 0.06)) < 0.5) return 0;
      return 1 + wobble(t, seed) * 0.14;
    }
    case 'dying': {
      if (hash01(s + 3, Math.floor(t / 0.12)) < 0.25) return 0;
      return 0.35 + 0.1 * Math.sin(t * Math.PI * 0.5 + seed);
    }
    case 'dead':
      return 0;
    case 'fire': {
      const n = hash01(s + 11, Math.floor(t / 0.08)) - 0.5;
      return clamp(1 + 0.3 * Math.sin(t * 5.1 + seed) * 0.5 + 0.18 * Math.sin(t * 13.7 + seed * 1.7) * 0.5 + 0.1 * n, 0, 1.4);
    }
  }
}

/** The room's flash burst level at `e` seconds after the burst delay (see LAMP_SCRIPT.burstDelayS). */
function burstAfterglow(e: number, roomSeed: number, lampSeed: number, reduced: boolean): number {
  const W = LAMP_SCRIPT.burstWindowS;
  const w = Math.floor(e / W);
  const start = hash01(roomSeed, w * 3 + 1) * (W - LAMP_SCRIPT.burstMaxS - LAMP_SCRIPT.burstMinGapS);
  // A few ms of per-lamp jitter, so the room's tubes do not fire as one lamp.
  const local = e - w * W - start - hash01(lampSeed, 5) * 0.012;
  if (local < 0) return 0;
  if (reduced) {
    return local < LAMP_SCRIPT.burstMaxS ? LAMP_SCRIPT.burstLevel * Math.sin(Math.PI * local / LAMP_SCRIPT.burstMaxS) ** 2 : 0;
  }
  const n = hash01(roomSeed, w * 3 + 2) < 0.45 ? 3 : 2;
  const cycle = LAMP_SCRIPT.burstFlashS + LAMP_SCRIPT.burstGapS;
  const i = Math.floor(local / cycle);
  if (i >= n) return 0;
  return local - i * cycle < LAMP_SCRIPT.burstFlashS ? LAMP_SCRIPT.burstLevel : 0;
}

/** The lamp's level with a scripted event applied (null: the mood alone). */
export function lampLevel(mood: LampMood, script: LampScript | null, t: number, seed: number): number {
  const base = moodLevel(mood, t, seed);
  if (!script || t < script.at) return base;
  const age = t - script.at;
  const s = iseed(seed);
  switch (script.mode) {
    case 'die': {
      if (age >= LAMP_SCRIPT.sputterS) return 0;
      // Sputter: on-off in 0.05 s slots, the off share rising to all of it.
      const off = hash01(s + 19, Math.floor(age / 0.05)) < 0.3 + 0.7 * (age / LAMP_SCRIPT.sputterS);
      return off ? 0 : Math.max(base, 0.6);
    }
    case 'blackout': {
      if (age < LAMP_SCRIPT.blackoutS) return 0;
      const r = age - LAMP_SCRIPT.blackoutS;
      if (r >= LAMP_SCRIPT.recoverS) return base;
      const off = hash01(s + 23, Math.floor(r / 0.06)) < 1 - r / LAMP_SCRIPT.recoverS;
      return off ? 0 : base;
    }
    case 'strobe': {
      if (age < LAMP_SCRIPT.surgeS) return 2.2 + 0.1 * Math.sin(age * 40);
      const k = age - LAMP_SCRIPT.surgeS;
      const hz = script.reduced ? LAMP_SCRIPT.strobeHzReduced : LAMP_SCRIPT.strobeHz;
      if (k < LAMP_SCRIPT.strobeS) return Math.floor(k * hz * 2) % 2 === 0 ? 1.3 : 0;
      const e = k - LAMP_SCRIPT.strobeS - LAMP_SCRIPT.burstDelayS;
      return e < 0 ? 0 : burstAfterglow(e, iseed(script.at), s, !!script.reduced);
    }
    case 'emergency': {
      const k = age - (LAMP_SCRIPT.surgeS + LAMP_SCRIPT.strobeS);
      if (k < 0) return 0;
      if (k >= LAMP_SCRIPT.emergencyOnS) return 1;
      return hash01(s + 29, Math.floor(k / 0.04)) < 0.45 + 0.55 * (k / LAMP_SCRIPT.emergencyOnS) ? 1 : 0;
    }
  }
}
