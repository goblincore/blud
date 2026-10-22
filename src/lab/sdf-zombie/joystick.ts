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
