// src/lab/sdf-zombie/wail.ts
//
// The ORGAN's WAIL (characters/organ.blob). Plain data like fireball.ts and bile.ts: no three, no clock of its own, no
// world of its own; game-tick steps the notes with the world's segment tests and draws them as pale tracers, and
// enemy-mind.ts makeOrganMind decides when to wail.
//
// WHAT IT IS. The organ plants, its bellows fill (the `swell` morph throbbing to full, every flank mouth gaping), its
// head is thrown back, and its trumpets en chamade (the horizontal reed pipes fanned forward over its shoulders, kit
// spine|chamade*) sound a CHORD: three slow NOTES, one from each side's bells and one from the middle, a beat apart,
// fanned a little either side of the player. Each note is a large, slow, pale ball of sound that trembles as it flies
// (a vibrato drawn on the tracer, wailWobble) and hurts on a hit, with a small shove of pressure (a near miss) round it.
//
// WHY NOT A BESPOKE SONIC EFFECT. A real sound wave (a refracting ring, a cone of distortion) needs its own render
// pass; the post-aa blast ring exists but is an experiment that is off by default. So the wail ships as projectiles
// through the fireball's path, and game-tick feeds each note's burst to that blast ring when it is on. A sonic visual
// is a follow-up.
//
// WHY SLOW AND FANNED. The organ is a heavy, slow walker; the wail is its threat at range, so it must be dodgeable
// and readable: 6 m/s (about half the imp's fireball), three notes a beat apart rather than one, the outer two fanned
// 0.09 rad off the aim so a player who strafes one way clears the chord and one who stands still eats the middle.
import type { Vec3 } from './types';

export const WAIL = {
  /** Flight speed, m/s: slow, ~1.7 s across a 10 m room (the imp's fireball is 11). */
  speed: 6,
  /** Drawn and collision radius, m: a big ball of sound, easy to see coming. */
  radius: 0.15,
  /** Seconds before it can hit anything (it leaves from inside the bell). */
  armSec: 0.12,
  /** Gone after this long in flight, s (~19 m). */
  maxAge: 3.2,
  /** Player damage per note on a hit (player-vitals.ts scale: a zombie bite is 10, the imp's fireball 14). */
  playerDamage: 9,
  /** A note that bursts this close to the player's middle without hitting still shoves for this much. */
  splashRadius: 0.75,
  splashDamage: 3,
  /** The vibrato: the drawn note trembles this far (m) at this rate (Hz), and its radius beats by this fraction. */
  wobble: { amp: 0.05, hz: 9, pulse: 0.25 },
} as const;

/** The wail's beats and the organ mind's ranged tuning (enemy-mind.ts makeOrganMind). */
export const ORGAN_TUNING = {
  /** The whole wail, s: the fill (the telegraph), the chord, the release. */
  wailSec: 2.2,
  /** The fill ends here (phase): the body has risen, the head is back, the bellows are full. */
  filled: 0.40,
  /** The note is held to here, then the body settles. */
  held: 0.86,
  /** The phases the three notes leave (inside the hold), in firing order. */
  notes: [0.46, 0.56, 0.66] as readonly number[],
  /** Each note's yaw off the aim (rad, + = the body's left), in firing order: left, right, the middle. */
  fan: [0.09, -0.09, 0] as readonly number[],
  /** Each note's bell: the side it leaves from (+1 left bells, -1 right, 0 between them), in firing order. */
  bell: [1, -1, 0] as readonly number[],
  /** Half the spacing (m) between the two sides' middle bells (assets-source/organ-kit/make_pipes.py prints
   *  CHAMADE_BELL at x 0.184): a note leaves from x = bell * this. */
  bellX: 0.18,
  /** It wails at a player between these distances (m) it can see, every cooldown seconds, the first after `first`.
   *  Inside `min` it bites instead. */
  band: { min: 3.2, max: 15 },
  cooldown: 4.0,
  first: 1.5,
} as const;

/** How many notes leave this frame (prevPhase -> phase), and which: the indices into ORGAN_TUNING.notes crossed. */
export function wailNotesCrossed(prevPhase: number, phase: number): number[] {
  const out: number[] = [];
  ORGAN_TUNING.notes.forEach((at, i) => { if (prevPhase < at && phase >= at) out.push(i); });
  return out;
}

export interface WailNote {
  pos: Vec3;
  vel: Vec3;
  ageSec: number;
  /** Actor id of the organ that sang it. */
  owner: number;
}

export interface WailWorld {
  /** True when the segment crosses solid level geometry. */
  hitsWorld(from: Vec3, to: Vec3): boolean;
  /** True when the segment passes through the player. */
  hitsPlayer(from: Vec3, to: Vec3): boolean;
}

export type WailCause = 'world' | 'player' | 'age';
export interface WailBurst { at: Vec3; cause: WailCause; owner: number }

/** A note leaving `origin` for `target`, turned `yaw` rad about the vertical (+ = toward +x of a body facing +z, i.e.
 *  its left). Straight: sound does not fall. Pure. */
export function spawnWailNote(origin: Vec3, target: Vec3, owner: number, yaw = 0): WailNote {
  const d: Vec3 = [target[0] - origin[0], target[1] - origin[1], target[2] - origin[2]];
  const l = Math.hypot(d[0], d[1], d[2]) || 1;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const x = d[0] / l, z = d[2] / l;
  const v: Vec3 = [x * c + z * s, d[1] / l, -x * s + z * c];
  const k = WAIL.speed / (Math.hypot(v[0], v[1], v[2]) || 1);
  return { pos: [...origin] as Vec3, vel: [v[0] * k, v[1] * k, v[2] * k], ageSec: 0, owner };
}

/** Advance every note one step. Returns the survivors and this step's bursts (at the last free point). Unarmed notes
 *  pass through everything. */
export function stepWailNotes(notes: readonly WailNote[], dt: number, world: WailWorld): { live: WailNote[]; bursts: WailBurst[] } {
  const live: WailNote[] = [];
  const bursts: WailBurst[] = [];
  for (const n of notes) {
    const from = n.pos;
    const to: Vec3 = [from[0] + n.vel[0] * dt, from[1] + n.vel[1] * dt, from[2] + n.vel[2] * dt];
    const ageSec = n.ageSec + dt;
    const armed = ageSec >= WAIL.armSec;
    const cause: WailCause | null = !armed ? null
      : world.hitsPlayer(from, to) ? 'player'
        : world.hitsWorld(from, to) ? 'world'
          : ageSec >= WAIL.maxAge ? 'age' : null;
    if (cause) { bursts.push({ at: [...from] as Vec3, cause, owner: n.owner }); continue; }
    live.push({ ...n, pos: to, ageSec });
  }
  return { live, bursts };
}

/** The player's share of a burst: the full note on a hit, the pressure shove within splashRadius, else 0. */
export function wailPlayerDamage(burst: WailBurst, playerMid: Vec3): number {
  if (burst.cause === 'player') return WAIL.playerDamage;
  if (burst.cause === 'age') return 0;
  const d = Math.hypot(burst.at[0] - playerMid[0], burst.at[1] - playerMid[1], burst.at[2] - playerMid[2]);
  return d <= WAIL.splashRadius ? WAIL.splashDamage : 0;
}

/** The note as DRAWN at `ageSec`: a tremble off its true path (up-down and side to side, out of step) and a beating
 *  radius. The sim never sees it (collision is on the true path). Pure. */
export function wailWobble(note: Pick<WailNote, 'pos' | 'vel' | 'ageSec'>): { pos: Vec3; radius: number } {
  const W = WAIL.wobble;
  const w = 2 * Math.PI * W.hz * note.ageSec;
  const h = Math.hypot(note.vel[0], note.vel[2]) || 1;
  const side: Vec3 = [note.vel[2] / h, 0, -note.vel[0] / h];
  const a = W.amp * Math.sin(w), b = W.amp * 0.6 * Math.sin(w * 0.7 + 1.3);
  return {
    pos: [note.pos[0] + side[0] * b, note.pos[1] + a, note.pos[2] + side[2] * b],
    radius: WAIL.radius * (1 + W.pulse * Math.sin(w * 1.5)),
  };
}
