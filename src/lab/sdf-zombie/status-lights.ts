// src/lab/sdf-zombie/status-lights.ts
//
// The warbull's BLINKING LIGHTS as plain data (spec 2026-09-27-warbull-
// design.md, "Blinking lights"). Pure: no three, no clock of its own.
//
// Lights are what make machinery read as ALIVE rather than bolted-on scrap,
// and on this character they are also the tells. So the pulse is a function
// of what the mind is doing:
//
//   idle      a slow double-thump heartbeat on the LEDs; the reactor core
//             breathes. Machinery ticking over.
//   alert     the heartbeat quickens (he has you).
//   aim       a hard strobe, the core flaring: the rocket telegraph, the
//             same beat the chaingun's spin-up is for the juggernaut.
//   fire      bright and ragged while the volley goes.
//   charge    strobe (Task 6's charge telegraph and run).
//   stunned   a stutter: the machine glitching after he hits a wall.
//   dead      dark.
//
// DAMAGE makes the LEDs drop out: a plate taking hits stutters its
// lights, deterministically (a hash of the sim time), so a bruised machine
// flickers and a fresh one does not. ENRAGED (launcher shot off, Task 5)
// turns the core from amber to red.
//
// kit-overlay.ts glow() multiplies each emissive material's authored
// intensity by these levels; 1 is the authored look.

export type LightsMode = 'idle' | 'alert' | 'aim' | 'fire' | 'charge' | 'stunned' | 'dead';

export interface LightsInput {
  mode: LightsMode;
  /** Sim seconds (any monotonic clock; only its differences matter). */
  t: number;
  /** 0 = pristine, 1 = every plate at zero. */
  damage?: number;
  /** Launcher gone (Task 5): the core burns red. */
  enraged?: boolean;
  /** Per-body phase offset, so a crowd does not blink in unison. */
  phase?: number;
}

export interface StatusLights {
  /** Multiplier on the `led` material's authored emissive intensity. */
  led: number;
  /** Multiplier on the `core` material's authored emissive intensity. */
  core: number;
  /** The core's emissive colour, linear RGB. */
  coreRgb: readonly [number, number, number];
}

export const STATUS_LIGHTS = {
  /** Heartbeat period, s: idle, alert. */
  beatSec: { idle: 1.2, alert: 0.7 },
  /** LED floor between beats, and the beat peak. */
  beatFloor: 0.25,
  beatPeak: 1.1,
  /** Strobe frequency while aiming / charging, Hz, and its levels. */
  strobeHz: 8,
  strobeLow: 0.15,
  strobeHigh: 1.6,
  /** Core breathing: period s and depth (fraction of 1). */
  breatheSec: 2.6,
  breatheDepth: 0.2,
  /** Core level while aiming and firing (a flare). */
  coreFlare: 1.6,
  /** Damage: at full damage this fraction of 1/12 s slots are dark. */
  dropoutAtFull: 0.55,
  amber: [1.0, 0.62, 0.18] as const,
  red: [1.0, 0.10, 0.04] as const,
} as const;

/** Deterministic hash of an integer to [0, 1). */
function hash01(n: number): number {
  let x = (n | 0) ^ 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

/** A double-thump heartbeat: two gaussian bumps early in each period. */
function heartbeat(t: number, period: number): number {
  const u = (((t / period) % 1) + 1) % 1;
  const bump = (c: number, w: number) => Math.exp(-(((u - c) / w) ** 2));
  return Math.min(1, bump(0.08, 0.05) + 0.7 * bump(0.26, 0.05));
}

export function statusLights(input: LightsInput): StatusLights {
  const L = STATUS_LIGHTS;
  const t = input.t + (input.phase ?? 0);
  const coreRgb = input.enraged ? L.red : L.amber;
  if (input.mode === 'dead') return { led: 0, core: 0, coreRgb };

  const breathe = 1 - L.breatheDepth * 0.5 * (1 - Math.cos((2 * Math.PI * t) / L.breatheSec));
  let led: number, core: number;
  switch (input.mode) {
    case 'idle':
    case 'alert': {
      const b = heartbeat(t, L.beatSec[input.mode]);
      led = L.beatFloor + (L.beatPeak - L.beatFloor) * b;
      core = breathe;
      break;
    }
    case 'aim':
    case 'charge': {
      const on = Math.floor(t * L.strobeHz * 2) % 2 === 0;
      led = on ? L.strobeHigh : L.strobeLow;
      core = input.mode === 'aim' ? L.coreFlare : breathe;
      break;
    }
    case 'fire':
      led = L.strobeHigh * (0.75 + 0.25 * hash01(Math.floor(t * 30)));
      core = L.coreFlare;
      break;
    case 'stunned':
      led = hash01(Math.floor(t * 18)) < 0.5 ? 0.9 : 0.05;
      core = 0.4 + 0.3 * hash01(Math.floor(t * 9) + 7);
      break;
  }
  // Damage drop-outs: dark slots, deterministic in time.
  const damage = Math.min(1, Math.max(0, input.damage ?? 0));
  if (damage > 0 && hash01(Math.floor(t * 12) + 101) < damage * L.dropoutAtFull) led = 0;
  return { led, core, coreRgb };
}

/** The lights mode for a soldier-family mind state (soldier-brain.ts). */
export function lightsModeFor(mindState: string, opts: { alert?: boolean; collapsed?: boolean } = {}): LightsMode {
  if (opts.collapsed) return 'dead';
  switch (mindState) {
    case 'aim': return 'aim';
    case 'fire': case 'recover': return 'fire';
    case 'charge': case 'windup': return 'charge';
    case 'stunned': case 'stagger': return 'stunned';
    case 'idle': return opts.alert ? 'alert' : 'idle';
    default: return 'alert';
  }
}
