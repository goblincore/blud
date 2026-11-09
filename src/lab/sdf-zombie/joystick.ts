// src/lab/sdf-zombie/joystick.ts
//
// THE GAMER WORKS HIS JOYSTICK (characters/gamer.blob; owner: "he jiggles the joystick back n forth or up and
// down like he's controlling something in the VR headset playing a game"). The stick, its knob and his hands ride
// the body's `hem` pendulum, held stiff (rig-bind.ts HEM_HELD_SCALE); this is the body-local offset motion.ts adds
// to the `hem` target: a hard, fast back-and-forth and up-and-down while he attacks, and a faint idle twitch the
// rest of the time, because he never stops playing. Pure: time and the attack phase in, metres out.
import type { Vec3 } from './types';

export interface JoystickSpec {
  /** Peak throw of the stick's grip during an attack (m). */
  amp: number;
  /** The idle twitch's peak throw (m); 0 holds the stick still between attacks. */
  idle: number;
  /** The knob BREATHES (owner: "it breathes and grows, like the bulbous part enlarges and the rocket inside is exposed a
   *  bit more"): the `swell` morph channel (expression.ts), 0..1, on a slow breath of `period` s, throbbing up to 1 through
   *  an attack. The .blob's `morph=swell:` words say what grows. Absent: no breathing. */
  swell?: { period: number; jiggle?: SwellJiggle };
}

/** A HIT JIGGLE on the swell channel (the cerebrax: its frame is rigid, so a shot quivers the flesh instead of moving
 *  it; owner: "when i shoot the brain/flesh it should still jiggle"). Each shot kicks a damped wobble that ADDS to the
 *  breath: the swell weight swings past 1 and below 0, so the lobes bulge and suck in about their own centres while the
 *  frame, the kit and the craters' anchors stay put. */
export interface SwellJiggle {
  /** Swell weight one shot of gain 1 adds at the wobble's peak. Kicks stack up to 1.6x this. */
  amp: number;
  /** Wobble frequency (Hz). */
  freq: number;
  /** Seconds for the wobble to fall to 1/e. */
  decay: number;
}

/** The jiggle's state: the wobble's current amplitude (swell weight) and how long ago it was last kicked (s). */
export interface JiggleState { amp: number; since: number }

/** Advance `st` by `dt` and kick it when a shot of `gain` landed this step. Returns the swell weight to add. */
export function stepSwellJiggle(st: JiggleState, dt: number, shotGain: number | null, spec: SwellJiggle): number {
  if (shotGain !== null) {
    // Keep what is still ringing, add the kick, cap the stack.
    const left = st.amp * Math.exp(-st.since / spec.decay);
    st.amp = Math.min(spec.amp * 1.6, left + spec.amp * shotGain);
    st.since = 0;
  } else {
    st.since += dt;
  }
  if (st.amp === 0) return 0;
  const env = st.amp * Math.exp(-st.since / spec.decay);
  if (env < 1e-3) { st.amp = 0; return 0; }
  return env * Math.sin(2 * Math.PI * spec.freq * st.since + Math.PI / 2) * (st.since < 0.02 ? st.since / 0.02 : 1);
}

/** The `hem` offset (body-local: +x his right, +y up, +z forward) at time `t` (s), with `attackPhase` 0..1 while
 *  an attack plays, else null. The attack's jiggle rises and falls with sin(pi phase), so it is exactly zero at the
 *  attack's ends; it beats two frequencies per axis so it never reads as a metronome. */
export function joystickOffset(t: number, attackPhase: number | null, spec: JoystickSpec): Vec3 {
  // Idle: short twitchy bursts (a slow gate over a fast wobble), mostly side to side.
  const gate = Math.max(0, Math.sin(t * 1.3) * Math.sin(t * 0.47 + 1.1));
  const idle: Vec3 = [
    spec.idle * gate * Math.sin(t * 17.0),
    spec.idle * 0.6 * gate * Math.sin(t * 13.0 + 0.7),
    spec.idle * 0.4 * gate * Math.sin(t * 11.0 + 2.1),
  ];
  if (attackPhase === null || !(attackPhase > 0) || attackPhase >= 1) return idle;
  const env = Math.sin(Math.PI * attackPhase);
  const w = 2 * Math.PI * attackPhase;
  return [
    idle[0] + spec.amp * env * (0.75 * Math.sin(w * 6) + 0.25 * Math.sin(w * 9.5 + 0.4)),
    idle[1] + spec.amp * 0.7 * env * (0.7 * Math.sin(w * 4.5 + 1.3) + 0.3 * Math.sin(w * 11 + 2.0)),
    idle[2] + spec.amp * 0.5 * env * Math.sin(w * 3.5 + 0.6),
  ];
}

/** The knob's `swell` weight (0..1) at time `t` (s), with `attackPhase` 0..1 during an attack, else null: a slow breath (in
 *  over 40% of the period, held, out), and through an attack a fast throb riding up to full. Pure. */
export function joystickSwell(t: number, attackPhase: number | null, spec: JoystickSpec): number {
  if (!spec.swell) return 0;
  const u = ((t / spec.swell.period) % 1 + 1) % 1;
  // In quickly, out slowly: a breath, not a sine.
  const breath = u < 0.4 ? 0.5 - 0.5 * Math.cos(Math.PI * u / 0.4) : 0.5 + 0.5 * Math.cos(Math.PI * (u - 0.4) / 0.6);
  if (attackPhase === null || !(attackPhase > 0) || attackPhase >= 1) return breath;
  const env = Math.sin(Math.PI * attackPhase);
  const throb = 0.75 + 0.25 * Math.sin(2 * Math.PI * attackPhase * 5);
  return Math.max(breath, env * throb);
}
