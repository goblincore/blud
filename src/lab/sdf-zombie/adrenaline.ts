// src/lab/sdf-zombie/adrenaline.ts
//
// ADRENALINE (owner 2026-10-27: "a subtle bullet time that automatically kicks in when you hit an enemy with your
// shot ... like an adrenaline rush where everything slows down"). The automatic sibling of bullet-time.ts's explicit
// mode (Q). Pure: the tuning, the envelope, and the scales it hands game-tick.ts.
//
// TRIGGER. A player round (pellet or slug) that lands on an ACTOR, or a flail strike that connects (`flail`), calls
// `triggerAdrenaline` — game-tick.ts's pellet loop / game-flail.ts's strike. Barrels, gibs, baked chunks and walls
// do not. While explicit bullet time is ON the trigger is refused and a running rush eases out: explicit wins.
//
// ENVELOPE (REAL seconds, like bullet time's ramp): ease in over `easeInSec`, hold `holdSec`, ease out over
// `easeOutSec`. NO ACCUMULATION: the level is capped at 1 (worldScale is the deepest it ever gets), and a hit during
// a rush only REFRESHES it — in the hold it restarts the hold timer, easing in or out it eases (back) in from the
// current level and then holds once. So the slowdown never deepens and never outlasts easeIn + one hold past the
// last hit.
//
// SCALES (absolute fractions of real time, as bullet time's): the WORLD on `worldScale` (everything bullet time's
// worldScale slows: actors, enemy shots, gore, the sim clock); the PLAYER (move/aim/fire/reload) on `playerScale`,
// shallower so the player stays responsive while the world drags; the player's own pellets on `shotScale`.
// `combineScales` merges them with bullet time's per channel (the slower wins), so the two never fight and the
// moment explicit takes over is seamless.
//
// DETERMINISM. Both the trigger (a sim hit) and the step (the recorded real dt) come from the tick, so a demo replay
// re-derives every rush. Retuning ADRENALINE changes a replay, like any tuning.
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
   *  1.5x the world's pace, still reads as you — a rush, not a handicap. Equal to 1 the player would feel nothing. */
  playerScale: 0.85,
  /** The player's own pellets fully in. With the player (0.85), not the world: the rest of a blast that triggers
   *  the rush is still in the air, and slowing it to 0.55 would delay the follow-up hits the rush is rewarding. */
  shotScale: 0.85,
  /** Real seconds from normal time to fully in. */
  easeInSec: 0.08,
  /** Real seconds fully in. */
  holdSec: 0.45,
  /** Real seconds back to normal time. */
  easeOutSec: 0.35,
  /** Peak opacity of the warm edge vignette (0 = no look; game-bullet-time.ts). Modest: it should be felt, not read. */
  feedback: 0.3,
};
export type AdrenalineTuning = { -readonly [K in keyof typeof ADRENALINE_DEFAULTS]: (typeof ADRENALINE_DEFAULTS)[K] };

export const ADRENALINE: AdrenalineTuning = { ...ADRENALINE_DEFAULTS };

/** The numeric knobs, each [min, max] inclusive. Scales stay in (0, 1], as bullet time's. */
export const ADRENALINE_RANGES = {
  worldScale: [0.05, 1],
  playerScale: [0.05, 1],
  shotScale: [0.05, 1],
  easeInSec: [0.005, 2],
  holdSec: [0, 5],
  easeOutSec: [0.005, 3],
  feedback: [0, 1],
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

/** URL params -> partial: ?adrenaline=0|1 ?adr_flail=0|1 ?adr_world= ?adr_player= ?adr_shot= ?adr_in= ?adr_hold=
 *  ?adr_out= ?adr_fx= (empty / non-numeric dropped here; applyAdrenalineTuning range-checks the rest). */
export const ADRENALINE_PARAMS: Readonly<Record<string, AdrenalineKnob | AdrenalineSwitch>> = {
  adrenaline: 'on', adr_flail: 'flail',
  adr_world: 'worldScale', adr_player: 'playerScale', adr_shot: 'shotScale',
  adr_in: 'easeInSec', adr_hold: 'holdSec', adr_out: 'easeOutSec', adr_fx: 'feedback',
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

export type AdrenalinePhase = 'idle' | 'in' | 'hold' | 'out';
export interface AdrenalineState {
  phase: AdrenalinePhase;
  /** 0 = normal time, 1 = fully in (linear; the scales smoothstep it). */
  level: number;
  /** Real seconds left in the hold (phase 'hold'). */
  holdLeft: number;
  /** Rushes started or refreshed (a counter for probes / telemetry). */
  triggers: number;
}

export const makeAdrenaline = (): AdrenalineState => ({ phase: 'idle', level: 0, holdLeft: 0, triggers: 0 });

/**
 * A player hit on an enemy. Refused (false) when the mode is off or explicit bullet time is on; otherwise starts the
 * rush, or REFRESHES a running one without deepening it: fully in, the hold restarts; part way (in or out), it eases
 * in from the current level and then holds once.
 */
export function triggerAdrenaline(s: AdrenalineState, explicitOn: boolean, T: AdrenalineTuning = ADRENALINE): boolean {
  if (!T.on || explicitOn) return false;
  if (s.level >= 1) { s.phase = 'hold'; s.holdLeft = T.holdSec; }
  else s.phase = 'in';
  s.triggers++;
  return true;
}

/** Advance the envelope on the REAL step. Explicit bullet time on (or the mode switched off) eases a rush out. */
export function stepAdrenaline(s: AdrenalineState, realDt: number, explicitOn: boolean, T: AdrenalineTuning = ADRENALINE): void {
  if ((explicitOn || !T.on) && (s.phase === 'in' || s.phase === 'hold')) s.phase = 'out';
  let dt = Math.max(0, realDt);
  // Leftover time carries across phase boundaries, so a long step lands where a run of short ones would.
  for (let guard = 0; dt > 0 && guard < 4; guard++) {
    if (s.phase === 'in') {
      const need = (1 - s.level) * T.easeInSec;
      if (dt < need) { s.level += dt / T.easeInSec; dt = 0; }
      else { dt -= need; s.level = 1; s.phase = 'hold'; s.holdLeft = T.holdSec; }
    } else if (s.phase === 'hold') {
      if (dt < s.holdLeft) { s.holdLeft -= dt; dt = 0; }
      else { dt -= s.holdLeft; s.holdLeft = 0; s.phase = 'out'; }
    } else if (s.phase === 'out') {
      const need = s.level * T.easeOutSec;
      if (dt < need) { s.level -= dt / T.easeOutSec; dt = 0; }
      else { dt = 0; s.level = 0; s.phase = 'idle'; }
    } else break;
  }
}

const ease = (x: number): number => x * x * (3 - 2 * x);
const towards = (scale: number, level: number): number => 1 + (scale - 1) * ease(Math.max(0, Math.min(1, level)));

export interface AdrenalineScales { world: number; player: number; shot: number }

/** This tick's multipliers at `level` (all 1 at 0). */
export function adrenalineScalesAt(level: number, T: AdrenalineTuning = ADRENALINE): AdrenalineScales {
  return { world: towards(T.worldScale, level), player: towards(T.playerScale, level), shot: towards(T.shotScale, level) };
}

/** The feedback vignette's opacity at `level`. */
export const adrenalineFeedbackAt = (level: number, T: AdrenalineTuning = ADRENALINE): number =>
  T.feedback * ease(Math.max(0, Math.min(1, level)));

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
