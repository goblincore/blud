// src/lab/sdf-zombie/webgpu/enemy-mind.ts
//
// ONE interface over the two decision layers, so game-actor.ts can drive
// either without knowing which. The actor owns ~800 lines of body, view,
// hit/sever/wound, crowd nudge, furniture routing and hit batching that are
// identical for every enemy; only the thinking differs.
//
// THE ZOMBIE PATH MUST BE A NO-OP. createEnemyActor defaults to
// makeZombieMind(), so brain.test.ts and scripts/sdf-game-crowd-gate.mjs
// passing UNCHANGED is the evidence that this seam changed nothing for the
// zombie. A diff in either is a failure of this design, not a test to update.
//
// This wrapper is the ONLY place the two vocabularies meet. brain.ts and
// soldier-brain.ts do not import each other and never should.
import {
  makeBrain, staggerNow, stepBrain, type Brain, type BrainPlayer, type BrainSelf,
} from '../brain';
import {
  makeSoldierBrain, staggerSoldierNow, stepSoldierBrain, SOLDIER_TUNING,
  type SoldierBrain, type SoldierTuning,
} from '../soldier-brain';
import { SWORD_TUNING, isSwordVariant, lungeAdvance, swordContact } from '../sword-swing';
import type { BrainTuning } from '../brain';
import type { SwingVariant } from '../attack';
import type { Vec3 } from '../types';
import type { WanderBounds } from '../wander';

export interface MindInput {
  dt: number;
  self: BrainSelf;
  player: BrainPlayer | null;
  /** A shot was fired in this mind's room since the last step. */
  alerted: boolean;
  /** Melee-ring verdict. Meaningless to a soldier; ignored by that mind. */
  hasToken: boolean;
  /** Melee-ring tangential shuffle. Ignored by the soldier mind, which rolls
   *  its own strafe sign; the encounter director grants ranged firing lanes. */
  drift: -1 | 0 | 1;
  /** Fresh 0..1 per frame. The zombie rolls swing variants with it, the
   *  soldier rolls firing opportunities. */
  roll: number;
  /** A SECOND independent 0..1, for the soldier's strafe sign. The zombie
   *  mind ignores it. */
  rollDrift: number;
  lineOfSight?: boolean;
  mayFire?: boolean;
  bounds?: WanderBounds;
  canMoveTo?: (point: Vec3) => boolean;
  missing?: { armL: boolean; armR: boolean; legL: boolean; legR: boolean };
}

export interface MindOutput {
  /** Wander-target override; null = leave it alone. */
  target: Vec3 | null;
  /** True = locomotion off this frame. */
  halt: boolean;
  /** Melee swing to compose, or null. Always null for a soldier. */
  attack: { phase: number; side: 'L' | 'R'; variant: SwingVariant } | null;
  /** The weapon went off this frame. Always false for a zombie. */
  fire: boolean;
  /** Raise the weapon into the fire carry — the visible telegraph, held
   *  through the whole aim/fire/recover/settle beat. Always false for a
   *  zombie, which carries nothing. */
  weaponUp: boolean;
  /** Bearing to write into wander.heading while halted; null = leave it.
   *  Always null for a zombie, which turns only while walking. */
  faceHeading: number | null;
  /** Crowd separation at the wider engaged radius (melee-ring). */
  engaged: boolean;
  /** The ring may not revoke this body's token. */
  committed: boolean;
  contact: boolean;
  aimError: number;
  /** World XZ root delta to apply THIS frame (the sword lunge), or null.
   *  The actor applies it only where canMoveTo allows. */
  advance?: Vec3 | null;
}

/** Fields every mind reports, merged into ZombieActor.debug() by the actor. */
export interface MindDebug {
  state: string;
  alert: boolean;
  /** Melee vocabulary — the capture driver's oracle. Soldiers report the
   *  neutral defaults so the shape stays stable for every consumer. */
  side: 'L' | 'R';
  variant: string;
  swingT: number;
  /** Seconds of blast hold remaining (the stagger walk-freeze). Both brains
   *  carry the field; the actor surfaces it through debug().holdSecs — the
   *  heavy-hit tuning seam the slug tests read. Lives here rather than
   *  staying actor-owned because the hold timer itself moved INSIDE the
   *  mind: an actor-side copy would be the private timer brain.ts's header
   *  documents as the original defect. */
  holdSecs: number;
  hasToken: boolean;
  /** Ranged vocabulary. Zombies report the neutral defaults. */
  aimT: number;
  cooldown: number;
}

export interface EnemyMind {
  readonly kind: 'zombie' | 'soldier';
  /**
   * Does this mind ever want a MELEE-RING token?
   *
   * WHY IT IS A FLAG AND NOT INFERRED FROM `state`. game-main picked melee
   * claimants with `a.brain().alert && a.brain().state !== 'idle'` — a
   * predicate that silently assumes every actor is a melee actor. A soldier in
   * `advance` or `standoff` satisfies it, so he would be submitted to
   * melee-ring.ts as a claimant: competing for a token to throw a swing he has
   * no animation for, and being spaced against zombies at melee radius, which
   * distorts THEIR positioning too.
   *
   * The ring is the zombie's mechanism. A mind should say whether it plays
   * that game rather than have it guessed from a state name that happens to
   * exist in both vocabularies.
   */
  readonly meleeCapable: boolean;
  step(input: MindInput): MindOutput;
  /** Force the stagger state NOW, on the frame the hit lands. */
  stagger(holdSec?: number): void;
  debug(): MindDebug;
}

export function makeZombieMind(): EnemyMind {
  let brain: Brain = makeBrain();
  let lastToken = false;
  return {
    kind: 'zombie',
    meleeCapable: true,
    step(input) {
      lastToken = input.hasToken;
      const out = stepBrain(brain, {
        dt: input.dt,
        self: input.self,
        player: input.player,
        alerted: input.alerted,
        hasToken: input.hasToken,
        drift: input.drift,
        roll: input.roll,
        lineOfSight: input.lineOfSight,
      });
      brain = out.brain;
      return {
        target: out.target,
        halt: out.halt,
        attack: out.attack,
        fire: false,
        weaponUp: false,
        faceHeading: null,
        engaged: out.engaged,
        committed: out.committed,
        contact: false,
        aimError: 0,
      };
    },
    stagger() { brain = staggerNow(brain); },
    debug: () => ({
      state: brain.state,
      alert: brain.alert,
      side: brain.swing.side,
      variant: brain.swing.variant,
      swingT: brain.swingT,
      holdSecs: brain.holdSecs,
      hasToken: lastToken,
      aimT: 0,
      cooldown: brain.cooldown,
    }),
  };
}

/** The shooting brain. `tuning` is the weapon's (soldier-brain.ts):
 *  SOLDIER_TUNING for the soldier's shotgun, SMG_TUNING for the cultist. */
export function makeSoldierMind(tuning: SoldierTuning = SOLDIER_TUNING): EnemyMind {
  let brain: SoldierBrain = makeSoldierBrain();
  let aimT = 0;
  let lastAttack: MindOutput['attack'] = null;
  let melee = false;
  return {
    kind: 'soldier',
    // A rifleman never claims a melee token. See the interface note.
    get meleeCapable() { return melee; },
    step(input) {
      melee = !!input.missing?.armR;
      const out = stepSoldierBrain(brain, {
        dt: input.dt,
        self: input.self,
        player: input.player,
        alerted: input.alerted,
        roll: input.roll,
        rollDrift: input.rollDrift,
        lineOfSight: input.lineOfSight,
        mayFire: input.mayFire,
        bounds: input.bounds,
        canMoveTo: input.canMoveTo,
        missing: input.missing,
        hasToken: input.hasToken,
        drift: input.drift,
      }, tuning);
      brain = out.brain;
      aimT = out.aimT;
      lastAttack = out.attack;
      return {
        target: out.target,
        halt: out.halt,
        attack: out.attack,
        fire: out.fire,
        weaponUp: out.weaponUp,
        faceHeading: out.faceHeading,
        // Not in any ring: there is no ranged arbiter, and submitting a lone
        // soldier at the wider engaged radius would only push him around.
        engaged: out.engaged,
        committed: out.committed,
        contact: out.contact,
        aimError: out.aimError,
      };
    },
    stagger(holdSec) { brain = staggerSoldierNow(brain, undefined, holdSec); },
    debug: () => ({
      state: brain.state,
      alert: brain.alert,
      side: lastAttack?.side ?? 'R',
      variant: lastAttack?.variant ?? 'none',
      swingT: lastAttack?.phase ?? 0,
      holdSecs: brain.holdSecs,
      hasToken: false,
      aimT,
      cooldown: brain.cooldown,
    }),
  };
}

/** The bride's sword: the zombie's ring brain (brain.ts) on SWORD_TUNING —
 *  wider reach, cleave/sweep inside it, a lunge from the band beyond — plus
 *  the two things the zombie mind never produced: a real contact on the
 *  strike frame, and the lunge's root advance. */
export function makeSwordMind(tuning: BrainTuning = SWORD_TUNING.brain): EnemyMind {
  let brain: Brain = makeBrain();
  let lastToken = false;
  let prevPhase = 0;
  return {
    kind: 'zombie',
    meleeCapable: true,
    step(input) {
      lastToken = input.hasToken;
      const out = stepBrain(brain, {
        dt: input.dt, self: input.self, player: input.player, alerted: input.alerted,
        hasToken: input.hasToken, drift: input.drift, roll: input.roll, lineOfSight: input.lineOfSight,
      }, tuning);
      brain = out.brain;
      let contact = false;
      let advance: Vec3 | null = null;
      const a = out.attack;
      if (a && input.player && isSwordVariant(a.variant)) {
        const dx = input.player.x - input.self.x, dz = input.player.z - input.self.z;
        const dist = Math.hypot(dx, dz);
        contact = swordContact({ prevPhase, phase: a.phase, variant: a.variant, self: input.self, player: input.player });
        if (a.variant === 'lunge' && dist > 1e-6) {
          const d = lungeAdvance(prevPhase, a.phase, dist);
          if (d > 0) advance = [(dx / dist) * d, 0, (dz / dist) * d];
        }
        prevPhase = a.phase;
      } else {
        prevPhase = 0;
      }
      return {
        target: out.target, halt: out.halt, attack: out.attack,
        fire: false, weaponUp: false, faceHeading: null,
        engaged: out.engaged, committed: out.committed,
        contact, aimError: 0, advance,
      };
    },
    stagger() { brain = staggerNow(brain, tuning); prevPhase = 0; },
    debug: () => ({
      state: brain.state, alert: brain.alert, side: brain.swing.side, variant: brain.swing.variant,
      swingT: brain.swingT, holdSecs: brain.holdSecs, hasToken: lastToken, aimT: 0, cooldown: brain.cooldown,
    }),
  };
}
