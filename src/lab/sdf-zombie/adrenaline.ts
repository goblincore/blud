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
// LOW HEALTH DEEPENS IT (owner 2026-10-27: "once you're below a certain health threshold ... time slows down more,
// up to 0.2 ... It's a risk/reward thing"). A DANGER amount k = smoothstep(lowHealthStart 35, lowHealthFull 20,
// health) — 0 at 35+ HP, 1 at 20 HP and below — is slewed (`lowHealthSlewSec`, real seconds for a full 0 <-> 1
// swing) so a bite never snaps the time scale and healing glides it back. While the rush is in, its world target
// slides from worldScale (0.55) toward lowHealthWorldScale (0.2), the player's from playerScale (0.85) toward
// lowHealthPlayerScale (0.6) — so the player stays ~3x the world's pace at the bottom — and the edge look from
// edgeFx toward lowHealthEdgeFx, and (owner: "a red border around the edges of the screen that fades inward") a RED
// BORDER grows in — thin and faint near 35 HP, wide and strong at 20 — with a slow pulse (static under
// ?flashes=reduced), only while the deepening is actually slowing time. The rush's level still gates it all: low
// health ALONE does nothing unless `lowHealthAlways` (then the danger amount drives a rush of its own). The world
// target never goes below explicit bullet time's 0.2 (LOW_HEALTH_WORLD_FLOOR), and explicit bullet time still wins.
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
  /** Low health deepens a rush even with no enemy hit (the danger amount drives the level itself). Off: low health
   *  only deepens a rush a hit started — the owner framed it as part of the bullet-time mechanic. */
  lowHealthAlways: false,
  /** Health at and above which the rush is its normal depth. */
  lowHealthStart: 35,
  /** Health at and below which the rush is fully deepened. */
  lowHealthFull: 20,
  /** The world's dt multiplier fully in AND fully deepened (never below explicit bullet time's 0.2). */
  lowHealthWorldScale: 0.2,
  /** The player's scale fully in and fully deepened: slower than 0.85 so the world-to-player ratio holds up
   *  (0.2 / 0.6 — the player at 3x the world), not so slow that a low-health player feels handicapped. */
  lowHealthPlayerScale: 0.6,
  /** Real seconds for the danger amount to swing fully (0 <-> 1) after a health change: the time-scale ease. */
  lowHealthSlewSec: 0.4,
  /** The edge distortion's strength fully in and fully deepened (edgeFx at normal health). */
  lowHealthEdgeFx: 0.85,
  /** The red border's opacity at the screen edge fully in and fully deepened (0 = none). */
  lowHealthBorder: 0.75,
  /** The red border's width fully deepened, as a fraction of the screen HEIGHT from each edge (it fades inward over
   *  it; near lowHealthStart it is a quarter of this). The centre stays clean. */
  lowHealthBorderWidth: 0.2,
  /** The red border's slow pulse, cycles per REAL second (0 = steady; ?flashes=reduced holds it steady anyway). */
  lowHealthPulseHz: 0.8,
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
  lowHealthStart: [0, 100],
  lowHealthFull: [0, 100],
  lowHealthWorldScale: [0.2, 1],
  lowHealthPlayerScale: [0.05, 1],
  lowHealthSlewSec: [0.02, 5],
  lowHealthEdgeFx: [0, 1],
  lowHealthBorder: [0, 1],
  lowHealthBorderWidth: [0.02, 0.45],
  lowHealthPulseHz: [0, 4],
} as const satisfies Partial<Record<keyof AdrenalineTuning, readonly [number, number]>>;
export type AdrenalineKnob = keyof typeof ADRENALINE_RANGES;
export const ADRENALINE_KNOBS = Object.keys(ADRENALINE_RANGES) as AdrenalineKnob[];
/** The on/off switches (accept true/false or 1/0). */
export const ADRENALINE_SWITCHES = ['on', 'flail', 'lowHealthAlways'] as const;
/** The deepest world scale low health may reach: explicit bullet time's default fully in. */
export const LOW_HEALTH_WORLD_FLOOR = 0.2;
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
 *  ?adr_out= ?adr_fx=, and low health's ?adr_low_always=0|1 ?adr_low_start= ?adr_low_full= ?adr_low_world=
 *  ?adr_low_player= ?adr_low_slew= ?adr_low_fx= ?adr_low_border= ?adr_low_width= ?adr_low_pulse= (empty / non-numeric dropped here; applyAdrenalineTuning range-checks the rest). */
export const ADRENALINE_PARAMS: Readonly<Record<string, AdrenalineKnob | AdrenalineSwitch>> = {
  adrenaline: 'on', adr_flail: 'flail',
  adr_world: 'worldScale', adr_player: 'playerScale', adr_shot: 'shotScale',
  adr_in: 'rampInSec', adr_sustain: 'sustainSec', adr_out: 'rampOutSec', adr_fx: 'edgeFx',
  adr_low_always: 'lowHealthAlways', adr_low_start: 'lowHealthStart', adr_low_full: 'lowHealthFull',
  adr_low_world: 'lowHealthWorldScale', adr_low_player: 'lowHealthPlayerScale', adr_low_slew: 'lowHealthSlewSec',
  adr_low_fx: 'lowHealthEdgeFx', adr_low_border: 'lowHealthBorder', adr_low_width: 'lowHealthBorderWidth',
  adr_low_pulse: 'lowHealthPulseHz',
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
  /** The low-health danger amount, slewed toward lowHealthDanger(health): 0 healthy .. 1 fully deepened. */
  danger: number;
  /** The red border's pulse phase in cycles [0, 1), advanced on the real step at lowHealthPulseHz. */
  pulse: number;
}

export const makeAdrenaline = (): AdrenalineState => ({ level: 0, sinceHit: Infinity, triggers: 0, danger: 0, pulse: 0 });

/** The low-health target k = smoothstep(lowHealthStart, lowHealthFull, health): 0 at/above start, 1 at/below full.
 *  A non-finite health (no loop yet) is healthy. start <= full degenerates to a step at full. */
export function lowHealthDanger(health: number, T: AdrenalineTuning = ADRENALINE): number {
  if (!Number.isFinite(health)) return 0;
  const a = T.lowHealthStart, b = T.lowHealthFull;
  if (!(a > b)) return health <= b ? 1 : 0;
  const x = Math.max(0, Math.min(1, (a - health) / (a - b)));
  return x * x * (3 - 2 * x);
}

/** The level the scales and the look follow: the rush's, or (lowHealthAlways) the danger amount when that is more. */
export const adrenalineDrive = (s: AdrenalineState, T: AdrenalineTuning = ADRENALINE): number =>
  T.on && T.lowHealthAlways ? Math.max(s.level, s.danger) : s.level;

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

/** Advance the envelope on the REAL step: the sustain clock, the level toward wanted at its ramp's rate, and the
 *  danger amount toward `health`'s (omitted: full health) at most 1 / lowHealthSlewSec per second. */
export function stepAdrenaline(
  s: AdrenalineState, realDt: number, explicitOn: boolean, T: AdrenalineTuning = ADRENALINE, health = Infinity,
): void {
  const dt = Math.max(0, realDt);
  s.sinceHit += dt;
  if (adrenalineWanted(s, explicitOn, T)) s.level = Math.min(1, s.level + dt / T.rampInSec);
  else s.level = Math.max(0, s.level - dt / T.rampOutSec);
  const target = lowHealthDanger(health, T), step = dt / T.lowHealthSlewSec;
  s.danger = s.danger < target ? Math.min(target, s.danger + step) : Math.max(target, s.danger - step);
  s.pulse = (s.pulse + dt * T.lowHealthPulseHz) % 1;
}

const ease = (x: number): number => x * x * (3 - 2 * x);
const towards = (scale: number, level: number): number => 1 + (scale - 1) * ease(Math.max(0, Math.min(1, level)));

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const unit = (x: number): number => (Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0);

export interface AdrenalineScales { world: number; player: number; shot: number }

/** The fully-in targets at danger amount `danger`: low health only ever DEEPENS them (a low-health knob above its
 *  normal one is ignored), and the world never past LOW_HEALTH_WORLD_FLOOR from low health. */
export function adrenalineTargets(danger: number, T: AdrenalineTuning = ADRENALINE): { world: number; player: number } {
  const k = unit(danger);
  const lowWorld = Math.max(LOW_HEALTH_WORLD_FLOOR, T.lowHealthWorldScale);
  return {
    world: Math.min(T.worldScale, lerp(T.worldScale, lowWorld, k)),
    player: Math.min(T.playerScale, lerp(T.playerScale, T.lowHealthPlayerScale, k)),
  };
}

/** This tick's multipliers at `level` (all 1 at 0), deepened by the danger amount (0: the normal rush). */
export function adrenalineScalesAt(level: number, T: AdrenalineTuning = ADRENALINE, danger = 0): AdrenalineScales {
  const tg = adrenalineTargets(danger, T);
  return { world: towards(tg.world, level), player: towards(tg.player, level), shot: towards(T.shotScale, level) };
}

/** The screen-edge FX amount at `level` (post-aa.ts setAdrenalineEdge): edgeFx at full rush (toward lowHealthEdgeFx
 *  as the danger amount rises), 0 at normal time, following the same smoothstep as the time scale so the look and
 *  the slowdown arrive together. */
export const adrenalineEdgeAt = (level: number, T: AdrenalineTuning = ADRENALINE, danger = 0): number =>
  lerp(T.edgeFx, Math.max(T.edgeFx, T.lowHealthEdgeFx), unit(danger)) * ease(unit(level));

export interface AdrenalineBorder {
  /** Opacity of the red at the very edge (0 = no border). */
  strength: number;
  /** How far in it fades, as a fraction of the screen height from each edge. */
  width: number;
}

/** The low-health RED BORDER (post-adrenaline-border.wgsl.ts) at drive `level`, danger `danger`, pulse phase `pulse`:
 *  only while the deepening is slowing time (danger > 0 and the rush — or lowHealthAlways' drive — in). Strength
 *  lowHealthBorder x danger x the eased level, breathing between 75% and 100% with the pulse (`calm`: steady at the
 *  mean); width a quarter of lowHealthBorderWidth at the first touch of danger, all of it at full danger. */
export function adrenalineBorderAt(
  level: number, danger: number, pulse: number, calm: boolean, T: AdrenalineTuning = ADRENALINE,
): AdrenalineBorder {
  const k = unit(danger), g = k * ease(unit(level));
  if (!(g > 0) || !(T.lowHealthBorder > 0)) return { strength: 0, width: 0 };
  const breathe = calm || T.lowHealthPulseHz <= 0 ? 0.875 : 0.875 - 0.125 * Math.cos(2 * Math.PI * pulse);
  return { strength: T.lowHealthBorder * g * breathe, width: T.lowHealthBorderWidth * (0.25 + 0.75 * k) };
}

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
