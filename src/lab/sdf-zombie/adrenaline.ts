// src/lab/sdf-zombie/adrenaline.ts
//
// ADRENALINE (owner 2026-10-27: "a subtle bullet time that automatically kicks in when you hit an enemy with your
// shot ... like an adrenaline rush where everything slows down"; then "it 'ramps up' — not on/off, it accelerates into
// the state and decelerates out — maybe after like 30 seconds after the last enemy hit", with "a visual indicator ...
// distortion around the border/edges of the screen"). The automatic sibling of bullet-time.ts's explicit mode (Q).
// Pure: the tuning, the envelope, the scales it hands game-tick.ts and the edge FX amount post-aa.ts draws.
//
// TRIGGER. A player round (pellet or slug) that lands on an ACTOR, or a flail strike that connects (`flail`), calls
// `triggerAdrenaline` — game-tick.ts's pellet loop / game-flail.ts's strike. Barrels, gibs, baked chunks and walls
// do not.
//
// A SUSTAINED STATE, not a pulse. A hit (re)starts the `sustainSec` clock; while it runs the rush is WANTED and the
// level glides up over `rampInSec`; once `sustainSec` passes with no hit it glides back down over `rampOutSec`. A hit
// during the ramp-out turns it straight back up from where it is (no jump). The level is capped at 1, so the depth is
// never more than worldScale however many hits land: no accumulation. The scales smoothstep the level, so the world
// ACCELERATES into the slowdown and decelerates out of it (zero rate of change at both ends).
//
// EXPLICIT BULLET TIME WINS. While it is on the rush is not wanted (the level eases out under it; per channel the
// slower of the two scales applies, so the hand-over is seamless). Hits still restart the sustain clock, so when Q
// turns bullet time off inside the sustain window the rush glides back in.
//
// CLOCK. The envelope runs on the tick's REAL step (`rdt`, the one the demo recorder stores), like bullet time's
// ramp — so a 30 s sustain is 30 s the player waits, not 30 slowed sim seconds (54 real at 0.55). The trigger is a
// sim hit, so a replay re-derives every rush; retuning ADRENALINE changes a replay, like any tuning.
//
// SCALES (absolute fractions of real time, as bullet time's): the WORLD on `worldScale` (everything bullet time's
// worldScale slows: actors, enemy shots, gore, the sim clock); the PLAYER (move/aim/fire/reload) on `playerScale`,
// shallower so the player stays responsive while the world drags; the player's own pellets on `shotScale`.
//
// LIVE TUNING mirrors bullet-time.ts: `ADRENALINE` is live and mutable, `applyAdrenalineTuning` is the one validated
// way to change it (the __sdfGame.adrenaline({...}) seam, the BULLET TIME panel's ADRENALINE section, ?adr_* params).

export const ADRENALINE_DEFAULTS = {
  /** The mode at all (?adrenaline=0 turns it off). */
  on: true,
  /** A flail strike that connects triggers it too (the flail's own hit-stop / slow tail still runs first). */
  flail: true,
  /** The world's dt multiplier fully in (owner: "maybe 0.55 ... instead of 0.2"). */
  worldScale: 0.55,
  /** The player's move / aim / fire / reload fully in. 0.85: the world visibly drags (0.55) while the player, at
   *  1.5x the world's pace, still reads as you — a rush, not a handicap — which matters more now the state lasts. */
  playerScale: 0.85,
  /** The player's own pellets fully in. With the player (0.85), not the world: slowing your own shots to 0.55 for
   *  a 30 s state would make every follow-up hit land late. */
  shotScale: 0.85,
  /** Real seconds to glide from normal time to fully in (smoothstepped: it accelerates in). */
  rampInSec: 0.8,
  /** Real seconds after the LAST enemy hit before the rush starts to fade. */
  sustainSec: 30,
  /** Real seconds to glide back to normal time (smoothstepped: it decelerates out). */
  rampOutSec: 1.8,
  /** Strength of the screen-edge distortion fully in (post-aa.ts: warp + chromatic split + darkening/desaturation
   *  at the borders, centre untouched). 0 = no look; 1 is loud. */
  edgeFx: 0.6,
};
export type AdrenalineTuning = { -readonly [K in keyof typeof ADRENALINE_DEFAULTS]: (typeof ADRENALINE_DEFAULTS)[K] };

export const ADRENALINE: AdrenalineTuning = { ...ADRENALINE_DEFAULTS };

/** The numeric knobs, each [min, max] inclusive. Scales stay in (0, 1], as bullet time's. */
export const ADRENALINE_RANGES = {
  worldScale: [0.05, 1],
  playerScale: [0.05, 1],
  shotScale: [0.05, 1],
  rampInSec: [0.02, 5],
  sustainSec: [0, 120],
  rampOutSec: [0.02, 10],
  edgeFx: [0, 1],
} as const satisfies Partial<Record<keyof AdrenalineTuning, readonly [number, number]>>;
export type AdrenalineKnob = keyof typeof ADRENALINE_RANGES;
export const ADRENALINE_KNOBS = Object.keys(ADRENALINE_RANGES) as AdrenalineKnob[];
/** The on/off switches (accept true/false or 1/0). */
export const ADRENALINE_SWITCHES = ['on', 'flail'] as const;
type AdrenalineSwitch = typeof ADRENALINE_SWITCHES[number];

export type AdrenalineValues = Record<AdrenalineKnob, number> & Record<AdrenalineSwitch, boolean>;

export function adrenalineKnobs(T: AdrenalineTuning = ADRENALINE): AdrenalineValues {
  const out = {} as AdrenalineValues;
  for (const k of ADRENALINE_SWITCHES) out[k] = T[k];
  for (const k of ADRENALINE_KNOBS) out[k] = T[k];
  return out;
}

/** Validate and apply a partial set in place (refused values are listed, never clamped); `{ reset: true }` first
 *  restores the defaults. As bullet-time.ts applyBulletTimeTuning. */
export function applyAdrenalineTuning(
  partial: Record<string, unknown> | null | undefined,
  T: AdrenalineTuning = ADRENALINE,
): { tuning: AdrenalineValues; rejected: string[] } {
  const rejected: string[] = [];
  if (partial && typeof partial === 'object') {
    if (partial.reset === true) Object.assign(T, ADRENALINE_DEFAULTS);
    for (const [k, v] of Object.entries(partial)) {
      if (k === 'reset') continue;
      if ((ADRENALINE_SWITCHES as readonly string[]).includes(k)) {
        if (v === true || v === 1) T[k as AdrenalineSwitch] = true;
        else if (v === false || v === 0) T[k as AdrenalineSwitch] = false;
        else rejected.push(`${k}: not true/false/1/0`);
        continue;
      }
      if (!(k in ADRENALINE_RANGES)) { rejected.push(`${k}: unknown knob`); continue; }
      const [lo, hi] = ADRENALINE_RANGES[k as AdrenalineKnob];
      if (typeof v !== 'number' || !Number.isFinite(v)) { rejected.push(`${k}: not a finite number`); continue; }
      if (v < lo || v > hi) { rejected.push(`${k}: ${v} outside [${lo}, ${hi}]`); continue; }
      T[k as AdrenalineKnob] = v;
    }
  }
  return { tuning: adrenalineKnobs(T), rejected };
}

/** URL params -> partial: ?adrenaline=0|1 ?adr_flail=0|1 ?adr_world= ?adr_player= ?adr_shot= ?adr_in= ?adr_sustain=
 *  ?adr_out= ?adr_fx= (empty / non-numeric dropped here; applyAdrenalineTuning range-checks the rest). */
export const ADRENALINE_PARAMS: Readonly<Record<string, AdrenalineKnob | AdrenalineSwitch>> = {
  adrenaline: 'on', adr_flail: 'flail',
  adr_world: 'worldScale', adr_player: 'playerScale', adr_shot: 'shotScale',
  adr_in: 'rampInSec', adr_sustain: 'sustainSec', adr_out: 'rampOutSec', adr_fx: 'edgeFx',
};
export function adrenalineFromParams(search: string | URLSearchParams): Record<string, number> {
  const q = typeof search === 'string' ? new URLSearchParams(search) : search;
  const out: Record<string, number> = {};
  for (const [param, knob] of Object.entries(ADRENALINE_PARAMS)) {
    const raw = q.get(param);
    if (raw === null || raw.trim() === '') continue;
    const v = Number(raw);
    if (Number.isFinite(v)) out[knob] = v;
  }
  return out;
}

export type AdrenalinePhase = 'idle' | 'in' | 'full' | 'out';
export interface AdrenalineState {
  /** 0 = normal time, 1 = fully in (linear; the scales smoothstep it). */
  level: number;
  /** Real seconds since the last enemy hit (Infinity before the first). */
  sinceHit: number;
  /** Hits that started or sustained the rush (a counter for probes / telemetry). */
  triggers: number;
}

export const makeAdrenaline = (): AdrenalineState => ({ level: 0, sinceHit: Infinity, triggers: 0 });

/** Whether the rush is wanted now: on, explicit bullet time off, and inside the sustain window. */
export const adrenalineWanted = (s: AdrenalineState, explicitOn: boolean, T: AdrenalineTuning = ADRENALINE): boolean =>
  T.on && !explicitOn && s.sinceHit < T.sustainSec;

/** Where the envelope is (for probes and the panel): gliding in, fully in, gliding out, or idle. */
export function adrenalinePhase(s: AdrenalineState, explicitOn: boolean, T: AdrenalineTuning = ADRENALINE): AdrenalinePhase {
  if (adrenalineWanted(s, explicitOn, T)) return s.level >= 1 ? 'full' : 'in';
  return s.level > 0 ? 'out' : 'idle';
}

/**
 * A player hit on an enemy: restarts the sustain clock (the rush glides in, stays in, or turns back up from a
 * ramp-out). Never deepens it. Refused (false) only when the mode is off; under explicit bullet time the clock still
 * restarts (the rush resumes when bullet time ends).
 */
export function triggerAdrenaline(s: AdrenalineState, T: AdrenalineTuning = ADRENALINE): boolean {
  if (!T.on) return false;
  s.sinceHit = 0;
  s.triggers++;
  return true;
}

/** Advance the envelope on the REAL step: the sustain clock, then the level toward wanted at its ramp's rate. */
export function stepAdrenaline(s: AdrenalineState, realDt: number, explicitOn: boolean, T: AdrenalineTuning = ADRENALINE): void {
  const dt = Math.max(0, realDt);
  s.sinceHit += dt;
  if (adrenalineWanted(s, explicitOn, T)) s.level = Math.min(1, s.level + dt / T.rampInSec);
  else s.level = Math.max(0, s.level - dt / T.rampOutSec);
}

const ease = (x: number): number => x * x * (3 - 2 * x);
const towards = (scale: number, level: number): number => 1 + (scale - 1) * ease(Math.max(0, Math.min(1, level)));

export interface AdrenalineScales { world: number; player: number; shot: number }

/** This tick's multipliers at `level` (all 1 at 0). */
export function adrenalineScalesAt(level: number, T: AdrenalineTuning = ADRENALINE): AdrenalineScales {
  return { world: towards(T.worldScale, level), player: towards(T.playerScale, level), shot: towards(T.shotScale, level) };
}

/** The screen-edge FX amount at `level` (post-aa.ts setAdrenalineEdge): edgeFx at full rush, 0 at normal time,
 *  following the same smoothstep as the time scale so the look and the slowdown arrive together. */
export const adrenalineEdgeAt = (level: number, T: AdrenalineTuning = ADRENALINE): number =>
  T.edgeFx * ease(Math.max(0, Math.min(1, level)));

/** Bullet time's world multiplier and per-player scales merged with adrenaline's: per channel the SLOWER wins. */
export function combineScales<S extends { move: number; aim: number; fire: number; reload: number; shot: number }>(
  btWorld: number, bt: S, adr: AdrenalineScales,
): { world: number } & S {
  return {
    ...bt,
    world: Math.min(btWorld, adr.world),
    move: Math.min(bt.move, adr.player),
    aim: Math.min(bt.aim, adr.player),
    fire: Math.min(bt.fire, adr.player),
    reload: Math.min(bt.reload, adr.player),
    shot: Math.min(bt.shot, adr.shot),
  };
}
