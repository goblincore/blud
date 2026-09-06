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
  makeSoldierBrain, staggerSoldierNow, stepSoldierBrain, type SoldierBrain,
} from '../soldier-brain';
import type { SwingVariant } from '../attack';
import type { Vec3 } from '../types';

export interface MindInput {
  dt: number;
  self: BrainSelf;
  player: BrainPlayer | null;
  /** A shot was fired in this mind's room since the last step. */
  alerted: boolean;
  /** Melee-ring verdict. Meaningless to a soldier; ignored by that mind. */
  hasToken: boolean;
  /** Melee-ring tangential shuffle. Ignored by the soldier mind, which rolls
   *  its own strafe sign — there is no ranged arbiter yet. */
  drift: -1 | 0 | 1;
  /** Fresh 0..1 per frame. The zombie rolls swing variants with it, the
   *  soldier rolls firing opportunities. */
  roll: number;
  /** A SECOND independent 0..1, for the soldier's strafe sign. The zombie
   *  mind ignores it. */
  rollDrift: number;
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
  /** Bearing to write into wander.heading while halted; null = leave it.
   *  Always null for a zombie, which turns only while walking. */
  faceHeading: number | null;
  /** Crowd separation at the wider engaged radius (melee-ring). */
  engaged: boolean;
  /** The ring may not revoke this body's token. */
  committed: boolean;
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
  hasToken: boolean;
  /** Ranged vocabulary. Zombies report the neutral defaults. */
  aimT: number;
  cooldown: number;
}

export interface EnemyMind {
  step(input: MindInput): MindOutput;
  /** Force the stagger state NOW, on the frame the hit lands. */
  stagger(): void;
  debug(): MindDebug;
}

export function makeZombieMind(): EnemyMind {
  let brain: Brain = makeBrain();
  let lastToken = false;
  return {
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
      });
      brain = out.brain;
      return {
        target: out.target,
        halt: out.halt,
        attack: out.attack,
        fire: false,
        faceHeading: null,
        engaged: out.engaged,
        committed: out.committed,
      };
    },
    stagger() { brain = staggerNow(brain); },
    debug: () => ({
      state: brain.state,
      alert: brain.alert,
      side: brain.swing.side,
      variant: brain.swing.variant,
      swingT: brain.swingT,
      hasToken: lastToken,
      aimT: 0,
      cooldown: brain.cooldown,
    }),
  };
}

export function makeSoldierMind(): EnemyMind {
  let brain: SoldierBrain = makeSoldierBrain();
  let aimT = 0;
  return {
    step(input) {
      const out = stepSoldierBrain(brain, {
        dt: input.dt,
        self: input.self,
        player: input.player,
        alerted: input.alerted,
        roll: input.roll,
        rollDrift: input.rollDrift,
      });
      brain = out.brain;
      aimT = out.aimT;
      return {
        target: out.target,
        halt: out.halt,
        attack: null,
        fire: out.fire,
        faceHeading: out.faceHeading,
        // Not in any ring: there is no ranged arbiter, and submitting a lone
        // soldier at the wider engaged radius would only push him around.
        engaged: false,
        committed: false,
      };
    },
    stagger() { brain = staggerSoldierNow(brain); },
    debug: () => ({
      state: brain.state,
      alert: brain.alert,
      side: 'R',
      variant: 'none',
      swingT: 0,
      hasToken: false,
      aimT,
      cooldown: brain.cooldown,
    }),
  };
}
