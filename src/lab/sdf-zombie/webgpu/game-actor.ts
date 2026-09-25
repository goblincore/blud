import type { EncounterNavigation } from './encounter-navigation';
import type { EncounterOrder } from './encounter-director';
// src/lab/sdf-zombie/webgpu/game-actor.ts
//
// One wandering zombie in the game page: the lab's motion pipeline
// (stepMotion -> stepRig -> applyRig -> view.update) wrapped per body, minus
// everything this page does not do — no wounds, no chunks, no blood, no
// collapse triggers. The lab's wiring (lab-main.ts ~2330) is the reference;
// this is the same drive with empty damage signals.
//
// crowd-alive has NOT landed at the time of writing, so there is no per-actor
// record to reuse — this wrapper IS the actor record for the game page. It
// imports the shared building blocks; it does not touch lab-main.
//
// ROOM CLAMP. stepWander already clamps to the injected bounds (the room
// interior, inset). Furniture is a second constraint the bounds cannot
// express, so the wrapper rejects it post-step: a wanderer whose new position
// lands inside a furniture AABB (fattened by the body radius) is put back and
// its target is dropped, so the next step picks a fresh heading. A clamp,
// not navigation.

import type { BuildResult } from '../build-body';
import { bindRig, applyRig, headQuatOf, impulseAt, pinTips, type BoundRig } from '../rig-bind';
import {
  TEAR_TUNING, ruptureGore, rupturePosed, ruptureProgress,
  type RuptureFrame, type RupturePlan, type TearState, type TearTuning,
} from '../gib-tear';
import { constrainRigBends, stepRig } from '../rig';
import { relaxRopeConstraints } from '../collapse';
import { addSpin, deathThrowVelocities, launchPoints, planDeath, type DeathPlan } from '../soft-death';
import { applyDeathState, hasDeathState } from '../death-state';
import { inflateHead, SWELL_SEC } from '../head-pop';
import {
  MAX_WOUNDS, pushWound, WOUND_PROFILES, woundCarveNormal, woundWorldPos, clothDecal,
  type Wound, type WoundType,
} from '../damage';
import { severLimb, severDistal, type SeverResult } from '../sever';
import { soldierInjury, soldierArmCutAllowed } from '../soldier-damage';
import { posedDetachedChunk } from '../detached-pose';
import { cutLimbs, cutChains, chainOrder, jointPoint } from '../connectivity';
import { sdBody } from '../validate';
import type { LimbId, Primitive, Vec3 } from '../types';
import {
  woundFromPellet, woundFromSlug,
} from './game-weapon';
import {
  makeMotionJoints, makeMotionState, stepMotion, planSubSteps,
  applyFloorContact, MOTION_TUNING, STANDING_RIG,
  type MotionJoints, type MotionState, type MotionSignals,
} from '../motion';
import { makeRng, headingDir, type Rng, type WanderBounds } from '../wander';
import { rotateYaw } from '../gait';
import type { BrainPlayer } from '../brain';
import { makeZombieMind, type EnemyMind } from './enemy-mind';
import type { MotionProfile } from '../motion-profile';
import type { MotionFrame } from '../motion';
import type { SwingVariant } from '../attack';
import type { MissingLimbs } from '../collapse';
import type { ZombieGpuView } from './zombie-gpu';
import { createWoundRing, type CharacterView, type WoundPointTransform } from './character-view';
import { createTorsoWounds } from '../shared-wounds/torso';
import { soldierVisualWounds } from '../soldier-wounds';
import { soldierStaggerDuration } from '../soldier-stagger';
import type { Aabb } from './game-level';
import { GUN_GRIP, gunPoint } from '../carry';
import { add, normalize, qMul, qRotate, sub } from '../vec';
import {
  BURN_BEHAVIOUR, createBurnPanic, stepBurnPanic, type BurnPanicState,
} from '../burn-behaviour';

/** Signals for an undamaged wanderer — every frame, verbatim. */
const CALM: Omit<MotionSignals, 'dt'> = {
  shot: null,
  fire: false,
  wounded: { armL: false, armR: false, legL: false, legR: false },
  severed: [],
  missing: { legL: false, legR: false, armL: false, armR: false },
  headAlive: true,
  forcedCollapse: false,
  freshWounds: [],
};

/** Wound-type ids the shader expects — same mapping as lab-main's TYPE_ID. */
const TYPE_ID: Record<WoundType, number> = { pellet: 0, blast: 1, burn: 2 };

/** Hit shove along the shot direction, PER WOUND PROFILE — the defect this
 *  file shipped with was one constant (0.05) for everything, so a slug
 *  stamped a blast-profile wound and then shoved like a single pellet. The
 *  baseline is the lab's own scale (lab-main.ts: blast 0.16, pellet 0.06,
 *  burn 0.04); the slug path rides 'blast' because woundFromSlug stamps the
 *  blast calibre. Raised slightly above the lab for first-person range —
 *  the lab's numbers were tuned for a god-cam further out (see the lab's
 *  "scaled up in the motion-polish pass" note). */
const IMPULSE: Record<WoundType, number> = { pellet: 0.07, blast: 0.18, burn: 0.04 };

/** Stagger amplitude multiplier sent with a SLUG's motion signal — the slug
 *  is a hand-cannon round and should lurch harder than the lab's tuned
 *  blast response (stagger.ts StaggerHit.gain; default 1 = lab amplitudes).
 *  Pellets send no gain: eight arrive together and re-flinch the body. */
const SLUG_GAIN = 1.3;

/** SOFT TARGETS (MotionProfile.soft — the cultist; owner playtest 2026-09-24,
 *  second pass). Trigger pulls to kill; the range (m) inside which a slug
 *  severs (an arm) or pops a head. 6 m: across a small room — eyeballed. */
export const SOFT_TUNING = { hitsToKill: 2, severRange: 6 } as const;

/** Heavy-hit root knockback: initial ground-plane speed (m/s) along the
 *  shot's horizontal direction — the body's ROOT actually travels back
 *  (a real stumble, not just a joint offsets), decaying at BLAST_KNOCK_DECAY
 *  per second. ∫ v0·e^(−kt) ≈ v0/k metres of total travel. */
const BLAST_KNOCK_MPS = 1.2;
const BLAST_KNOCK_DECAY = 7;

/**
 * THE BLAST SIGNAL'S DIRECTION MUST BE A UNIT VECTOR, and handing it a VELOCITY
 * is what tore bodies in half.
 *
 * `stagger.ts` turns the shot signal into a pose reaction by SCALING its `dir`
 * by metre-valued amplitudes (`lurchAmp` 0.26 m, `flinchAmp` 0.085 m) and
 * writing the result into `rootOffset` plus `offsets.chest`/`offsets.neck`/the
 * shoulders. Every one of those is a METRE offset, so `dir` has to be unit —
 * the module's own header calls it "the shot direction".
 *
 * `blast()` passed `impulse.vel` — the resolver's concussion VELOCITY, 2.0 m/s
 * at the launch floor and 25.2 point-blank — so the lurch became
 * `0.26 x 25.2 x 1.3(gain) = 8.5 m` of chest and neck offset. MEASURED
 * intra-body chest-to-foot span after a point-blank blast: 0.667 m -> **8.23 m**
 * in five frames, easing back to 0.67 m over the next half second. That is the
 * owner's "the upper torso/arms/head fly off leaving just the legs and then they
 * rubberband back to the body", to the metre — and it is also the same defect
 * behind the earlier "teleported outside the screen then animated backwards",
 * of which the `impulseAt` unit bug was the smaller half.
 *
 * The two facts are separate and both are needed: the DIRECTION of the reaction
 * (unit) and HOW HARD (a velocity, which only the root knock uses, and which
 * never displaces a joint relative to its neighbours).
 */
function unitOrZero(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]);
  return l > 1e-6 ? [v[0] / l, v[1] / l, v[2] / l] : [0, 0, 0];
}

/** A detached piece, placed in WORLD space where the rendered limb hung.
 *  game-main turns this into a ballistic chunk + SDF view. */
export interface DetachedPiece {
  limb: LimbId;
  origin: Vec3;
  prims: Primitive[];
  tornAt: Vec3[];
  /** The piece's BONE prims (gore r3 refinement 6). Empty for sub-limb
   *  fragments, where a bone would have to be split across the cut. */
  bones: Primitive[];
}

/** How far outside a furniture AABB a wanderer's centre must stay. */
const FURNITURE_MARGIN = 0.55;

// ---- chase routing (ground-plane, furniture-aware) ------------------------
// Pure helpers behind the actor's chase-target wiring. brain.ts stays pure
// geometry (self/player/room only), so obstacle knowledge lives HERE, next
// to the furniture rejection that already lives here.

/** Does the ground-plane segment p→q cross this furniture box, fattened by
 *  `margin` (the same fattening insideFurniture rejects at)? 2D slab test on
 *  x/z; y is ignored — bodies walk on the plane. Conservative: a segment
 *  that only TOUCHES the fattened boundary counts as crossing, so routing
 *  keeps a step of slack instead of shaving the corner. */
export function segmentCrossesBox(
  p: Vec3, q: Vec3, box: Aabb, margin = FURNITURE_MARGIN,
): boolean {
  let t0 = 0;
  let t1 = 1;
  const axes: [number, number, number, number][] = [
    [p[0], q[0] - p[0], box.min[0] - margin, box.max[0] + margin],
    [p[2], q[2] - p[2], box.min[2] - margin, box.max[2] + margin],
  ];
  for (const [a, d, lo, hi] of axes) {
    if (Math.abs(d) < 1e-9) {
      if (a < lo || a > hi) return false;   // parallel, outside the slab
      continue;
    }
    let ta = (lo - a) / d;
    let tb = (hi - a) / d;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t0 > t1) return false;
  }
  return true;
}

/** Swept-body clearance for a short directed combat move. */
export function clearCombatMove(from: Vec3, target: Vec3, furniture: readonly Aabb[]): boolean {
  // The push-out solver can leave the centre exactly on the padded face.
  // A tenth-mm tolerance permits tangential/away motion from that contact.
  return firstBlockingBox(from, target, furniture, FURNITURE_MARGIN - 1e-4) === null;
}

/** Segment versus solid level geometry, including vertical clearance. */
export function segmentHitsBox(from: Vec3, to: Vec3, box: Aabb): boolean {
  let enter = 0, leave = 1;
  for (let axis = 0; axis < 3; axis++) {
    const d = to[axis]! - from[axis]!;
    if (Math.abs(d) < 1e-9) {
      if (from[axis]! < box.min[axis]! || from[axis]! > box.max[axis]!) return false;
    } else {
      const a = (box.min[axis]! - from[axis]!) / d;
      const b = (box.max[axis]! - from[axis]!) / d;
      enter = Math.max(enter, Math.min(a, b));
      leave = Math.min(leave, Math.max(a, b));
      if (enter > leave) return false;
    }
  }
  return true;
}

/** Push a position that ended up inside a fattened furniture box back out
 *  along its shallowest axis, per box in injection order. Depths here are
 *  sub-step-sized (the rejection fires per 1/60 s step), so this is a
 *  slide-to-the-face, not a teleport — which is the point: a body pressing
 *  a face keeps the TANGENTIAL component of its step and slides along it,
 *  and that slide is what lets the chase router round a corner. */
export function pushOutOfFurniture(
  p: Vec3, furniture: readonly Aabb[], margin = FURNITURE_MARGIN,
): Vec3 {
  let x = p[0]!;
  let z = p[2]!;
  for (const f of furniture) {
    const minX = f.min[0] - margin, maxX = f.max[0] + margin;
    const minZ = f.min[2] - margin, maxZ = f.max[2] + margin;
    if (x <= minX || x >= maxX || z <= minZ || z >= maxZ) continue;
    const west = x - minX, east = maxX - x;
    const north = maxZ - z, south = z - minZ;
    const min = Math.min(west, east, north, south);
    if (min === west) x = minX;
    else if (min === east) x = maxX;
    else if (min === north) z = maxZ;
    else z = minZ;
  }
  return [x, 0, z];
}

/** The first furniture box the segment p→q crosses (injection order), or
 *  null when the way is clear. */
export function firstBlockingBox(
  p: Vec3, q: Vec3, furniture: readonly Aabb[], margin = FURNITURE_MARGIN,
): Aabb | null {
  for (const f of furniture) {
    if (segmentCrossesBox(p, q, f, margin)) return f;
  }
  return null;
}

/** How far to the side of the goal the avoid way-point aims (m). Must exceed
 *  the level's widest furniture half-extent (room 2's crate: 0.9) plus the
 *  body margin (0.55), so the way-point sits outside the box's shadow along
 *  the avoid axis and the arc can actually round the blocker. */
const AVOID_OFFSET = 2.5;

/** The avoid way-point: `goal` pushed `offset` to `side`, along the
 *  perpendicular of (goal − p). Re-aimed every sub-step — it rotates with
 *  the body, which is what makes the chase ARC around the blocker instead of
 *  pressing into it. Not a parking spot: the wander's arrival branch cannot
 *  trap the body here because the point moves as the body moves. */
export function avoidPoint(
  p: Vec3, goal: Vec3, side: -1 | 1, offset = AVOID_OFFSET,
): Vec3 {
  const dx = goal[0] - p[0];
  const dz = goal[2] - p[2];
  const d = Math.hypot(dx, dz) || 1;
  // (goal − p) rotated ±90°: side +1 → (dz, −dx), side −1 → (−dz, dx).
  return [goal[0] + side * (dz / d) * offset, 0, goal[2] + side * (-dx / d) * offset];
}

/** Committed avoid side for a blocked chase line: prefer the side whose
 *  way-point gives a clear first leg, tie-broken by the shorter total path
 *  (first leg + side-hop); +1 when everything ties. Computed ONCE per
 *  blocked episode (the caller keeps the answer) — re-picking every sub-step
 *  would flip sides as the body moves and jitter in place. */
export function pickAvoidSide(
  p: Vec3, goal: Vec3, furniture: readonly Aabb[], offset = AVOID_OFFSET,
): -1 | 1 {
  const scores = ([-1, 1] as const).map((side) => {
    const w = avoidPoint(p, goal, side, offset);
    const clear = firstBlockingBox(p, w, furniture) === null;
    const cost = Math.hypot(w[0] - p[0], w[2] - p[2])
      + Math.hypot(goal[0] - w[0], goal[2] - w[2]);
    return { side, clear, cost };
  });
  const clear = scores.filter(s => s.clear);
  const pool = clear.length ? clear : scores;
  pool.sort((a, b) => a.cost - b.cost);
  return pool[0]!.side;   // pool is non-empty by construction
}

export interface ZombieActor {
  readonly id: number;
  corpseBakeEligible(): boolean;
  /** Run 5b: the refine twin is drawn only for a standing body inside the band —
   *  collapsing, settled and baked bodies never refine. */
  refineEligible(): boolean;
  damageRevision(): number;
  /** Diagnostic size of the persistent Soldier injury ledger. */
  injuryHistorySize(): number;
  pauseForBake(paused: boolean): void;
  readonly room: number;
  /** The LIVE body — severing replaces it (alive flags move). */
  readonly body: BuildResult;
  /** THE BODY it belongs to, when the caller supplied one. Null for the
   *  test and spike call sites that build from a bare body + view. */
  readonly character: CharacterView | null;
  readonly view: ZombieGpuView;
  /** Crowd stage a (?crowd=1): the type this body is attached to and its slot
   *  in that type's shared atlas/record buffer. Undefined = the per-body path. */
  crowd?: { type: import('./crowd-type').CrowdType; slot: number };
  /** Latest POSED body (world space) — what projectiles will raycast. */
  readonly posed: () => BuildResult;
  /**
   * The body the march is ACTUALLY drawing this frame: `posed()` in ordinary
   * play, or the rupture-displaced body while the window is running. The face
   * projection and any other per-frame read that must sit on the drawn surface
   * (not the clean pose) goes through this.
   */
  readonly drawnBody: () => BuildResult;
  readonly boundRig: () => BoundRig;
  /**
   * BEGIN THE RUPTURE WINDOW (gib-tear.ts): for `sec` seconds the march draws
   * the body with its planned regions pulled apart — flesh leading, bones
   * lagging — and `posed()` stays clean. `plan` is the reusable piece plan
   * prepared once from the clean posed body; the caller gibs the body with the
   * SAME plan at the offsets `tearFrame()` reports when `tearing()` goes false.
   * The actor owns the clock rather than the wiring because the window has to
   * end on a frame the actor has already stepped, or the chunks spawn from a
   * pose the body was never drawn in.
   */
  beginTear(at: Vec3, falloff: number, plan: RupturePlan): void;
  /**
   * ADVANCE THE WINDOW BY `dt` AND RE-DRAW THE BODY. The CALLER owns this
   * clock (game-main steps it for the bodies it has queued to gib) rather than
   * the body's own step, because the step is skippable — `?frozen=1`, and any
   * future distance/room culling of bodies — and a window whose clock stops is
   * a body that never becomes pieces.
   */
  stepTear(dt: number): void;
  /** Is the window still running? False before it starts AND after it ends. */
  readonly tearing: () => boolean;
  /** Seconds into the window (0 when not tearing) — the capture rig's clock. */
  readonly tearAge: () => number;
  /**
   * The body as LAST drawn by the rupture and the per-region offsets it was
   * built with, or null when not tearing. This is the hand-off: the caller
   * displaces the plan it passed to `beginTear` by `offsets` and spawns that,
   * so the displayed region and the spawned piece are the same prims at the
   * same transform.
   */
  tearFrame(): RuptureFrame | null;
  /** Drop the window immediately without gibbing (a reset, a bake pause). */
  endTear(): void;
  /** Retune the window for this actor (the page's `?gibtear*` knobs). */
  setTearTuning(t: Partial<TearTuning>): void;
  /** Current ground position + facing. */
  readonly pose: () => { pos: Vec3; yaw: number };
  /** Ground-plane shove from crowd separation (crowd.ts), bounds- and
   *  furniture-clamped. */
  nudge(dx: number, dz: number): void;
  /** Encounter perception and routing verdict. Set BEFORE step(). */
  setEncounterOrder(order: EncounterOrder): void;
  setBrainInput(player: BrainPlayer | null, alerted: boolean): void;
  /**
   * BURNING PANIC (2026-09-18). Called by game-burning.ts on registry
   * transitions: true on the frame the body starts burning, false when it is
   * extinguished, burnt down or retired. While on, the mind's verdict is
   * overridden (the `doomed` pattern) — a soldier flees the player without
   * firing, a zombie keeps chasing with a jittered heading, both stumble.
   * Idempotent: repeating the current state is a no-op.
   */
  setBurning(on: boolean): void;
  /** Monotonic count of burn stumbles since the current ignite began (0 when
   *  not burning). The capture-trace oracle — pose-level `staggerKind` cannot
   *  tell a burn stumble from a hit reaction. */
  burnStumbles(): number;
  /** The decision layer — callers that must distinguish kinds, and the
   *  source of truth for every decision field this interface reports. */
  mind(): EnemyMind;
  readonly kind: 'zombie' | 'soldier';
  /** The motion profile's character name ('zombie' when none) — which
   *  character this is, where `kind` is only which decision vocabulary. */
  profileName(): string;
  meleeCapable(): boolean;
  /** The LAST motion frame, or null before the first step. character-view's
   *  pose() reads `gun` (the held prop's transform) and `collapsed` (release
   *  the prop) off it — the whole frame rather than those two fields, so the
   *  actor does not have to grow an accessor every time the prop needs one
   *  more thing from motion. */
  motionFrame: () => MotionFrame | null;
  /** Seconds since this body last fired. Feeds the held prop's muzzle rise. */
  sinceFire: () => number;
  /** This frame's melee-ring verdict for this body (melee-ring.ts). Set
   *  BEFORE step(), like setBrainInput. */
  setRingInput(hasToken: boolean, drift: -1 | 0 | 1): void;
  /** True while game-main should submit this body to crowd separation at the
   *  wider engaged radius. */
  engagedForCrowd(): boolean;
  /** True while the ring may not revoke this body's token (mid-swing). */
  committed(): boolean;
  step(dt: number): void;
  /** Live wound ring (for HUD/debug). */
  wounds: () => readonly Wound[];
  /** Rendered carve spheres, also used to exclude occluder hulls. */
  visualWounds: () => readonly Wound[];
  /** Preview transitions advance even while the motion/rig is frozen. */
  advanceWoundPreview(dt: number): boolean;
  /** Where `wound` was placed at stamp time, before the recoil shove — see
   *  the note on `stampWorld`. Null for a wound this actor never stamped
   *  (a blast bundle from stampBlast, or one evicted from the ring).
   *  DIAGNOSTIC ONLY: rendering must keep using woundWorldPos, so a crater
   *  rides the flesh it is carved into. */
  stampWorldOf: (wound: Wound) => Vec3 | null;
  /** CAPTURE SEAM: pin the next step()'s swing pose. Overwritten by the brain
   *  on the following step; null clears it. Never used by the game itself. */
  forceSwing(phase: number, side: 'L' | 'R', variant: SwingVariant): void;
  /** Choreography + motion diagnostics from the LAST step() — the heavy-hit
   *  tuning seam (is the hold engaged? did the knock decay? did the meter
   *  cross?) and the capture driver's oracle. Not a simulation input. */
  debug: () => {
    holdSecs: number;
    knockV: number;
    phase: string;
    meter: number;
    blend: number;
    speed: number;
    staggerKind: string | null;
    target: Vec3 | null;
    idle: number;
    state: string;
    side: 'L' | 'R';
    variant: string;
    hasToken: boolean;
    alert: boolean;
    swingT: number;
    /** Ranged vocabulary — the soldier's aim progress 0..1; zombies 0. */
    aimT: number;
    meleeContacts: number;
    /** The carry motion.ts used on the last step (carry.ts name), or null. */
    carry: string | null;
    /** prop.fistOnGrip bodies: metres from the fist (the middle of the right
     *  hand bone, wrist to hand tip) to the seated prop's grip on the last
     *  step. Null for every other body. The bride melee gate's number. */
    fistGrip: number | null;
    /** The same gap BEFORE the seat, to the grip where motion.ts put it:
     *  how far the solved fist is from the authored grip. */
    fistGripAuthored: number | null;
  };
  /**
   * One pellet lands at `hitWorld`, travelling along `dirWorld`.
   * Stamps a wound through damage.ts, shoves the rig, then runs the existing
   * sever checks; any detachment is reported through `onSever` as world-space
   * piece data. Safe to call while the wander is frozen — the pose refresh is
   * done here, not left to the next step().
   * Returns the wound THIS impact stamped (pre-sever — a hit that also
   * severs reports its stump through onSever), so callers can hang per-hit
   * effects (bleed emitters) off the exact wound without ring-index sniffing.
   */
  hit(hitWorld: Vec3, dirWorld: Vec3, shot?: import('../damage').ShotProvenance): Wound | null;
  /**
   * A SLUG (one big projectile) lands at `hitWorld`: same choreography as
   * hit() but stamps the slug calibre crater. Separate method on purpose —
   * nothing about the pellet path may drift while it is under diagnosis.
   * Returns the stamped wound — see hit().
   */
  hitSlug(hitWorld: Vec3, dirWorld: Vec3, shot?: import('../damage').ShotProvenance): Wound | null;
  /**
   * HIT BATCHING (2026-09-05). Between beginHits() and endHits(), hit() /
   * hitSlug() stamp the wound and apply the shove but DEFER the expensive
   * tail — sever checks, rig re-solve, the whole-body repack + upload, and
   * the wound-row rewrite — to ONE flush in endHits(). A double-barrel burst
   * at point blank lands ~16 pellets in one frame; unbatched that was 16
   * repacks in one frame (12–18 ms CPU per landing frame, the owner's
   * "50 ms spike when I shoot up close" — hit-profile.mjs, 2026-09-05).
   * Callers that land ONE projectile need not batch: outside a batch the
   * tail runs inline exactly as before.
   */
  beginHits(): void;
  endHits(): void;
  /**
   * Diagnostic blast: push a resolver-provided bundle of blast wounds
   * (resolveExplosion ran against this actor's POSED body) with no shove,
   * no flinch and no severing — geometry only, so a captured crater is not
   * moved by its own impact. Routes through the same wound ring + carve
   * upload the pellet path uses.
   */
  stampBlast(wounds: readonly Wound[]): void;
  /** Re-run the wound upload now (a render-side wound look changed). */
  refreshWoundUpload(): void;
  /** Debug seam: sever a limb as a shot would ('full' or a chain index for severDistal). */
  debugSever(limb: LimbId, at?: 'full' | number): boolean;
  /**
   * A RESOLVED EXPLOSION's full effect on this body — the dynamite path.
   * Stamps the blast wounds (geometry + carves), credits the collapse meter
   * with the resolver's `meterCredit` DIRECTLY (never through `freshWounds` —
   * see the implementation's doc block and the X1.23 contract), raises the
   * blast reaction (flinch/stagger/knock), shoves the rig once at the nearest
   * surface, and runs the sever tail.
   *
   * The caller checks `BodyExplosionEffect.gibbed` FIRST and gibs the actor
   * instead of calling this — a gibbed body wants no sever claims.
   *
   * `wounds` must have been resolved against THIS actor's posed body with
   * `bodyYaw: pose().yaw`, exactly as `stampBlast` requires.
   */
  blast(effect: ActorBlastEffect): void;
}

/** The slice of explosion-aoe.ts's `BodyExplosionEffect` the actor needs. */
export interface ActorBlastEffect {
  wounds: readonly Wound[];
  /** Σ wound radii × COLLAPSE_TUNING.meterRadiusWeight, falloff-scaled. */
  meterCredit: number;
  /** Concussion shove at the nearest surface point, or null. `vel` is the
   *  world-space velocity; its direction also anchors the reaction. */
  impulse: { at: Vec3; vel: Vec3 } | null;
}

export function createZombieActor(opts: {
  navigation?: EncounterNavigation;
  id: number;
  room: number;
  body: BuildResult;
  view: ZombieGpuView;
  /** THE BODY it belongs to, when the caller has one — build, GPU view, face,
   *  kit, prop, and (from task 4b) damage.
   *
   *  OPTIONAL, AND `body`/`view` STAY REQUIRED, deliberately. Making this the
   *  only way in broke eight existing test call sites and hull-spike-main:
   *  they construct actors from a lightweight fake body and view, and a
   *  CharacterView cannot be faked cheaply because building one creates a real
   *  GPU view. An API change that forces eight test files to change is a
   *  design that made the actor untestable without a GPU — so the actor keeps
   *  taking the two halves, and callers that HAVE a CharacterView hand it over
   *  as well, for the damage delegation in task 4b. */
  character?: CharacterView;
  /** Experimental fixed torso presets, off for the normal game. */
  boundedWounds?: boolean;
  start: Vec3;
  seed: number;
  bounds: WanderBounds;
  furniture: readonly Aabb[];
  /** The decision layer. Absent = the zombie's, so every existing call site
   *  and every pin is untouched by construction. */
  mind?: EnemyMind;
  /** Per-character motion profile. Absent = the zombie's, matching
   *  stepMotion's own `cfg.profile ?? ZOMBIE_PROFILE` fallback. */
  profile?: MotionProfile;
  /** The body fired its weapon this frame. Called from step(); the wiring
   *  spawns the flash and the pellets. */
  onFire?: (shot: { origin: Vec3; direction: Vec3 }) => void;
  /** Diagnostic/gameplay contact pulse; the game intentionally has no health. */
  onMeleeContact?: (event: { actorId: number; variant: SwingVariant }) => void;
  /** Receives every detached piece, already placed in world space, plus the
   *  stump wound the sever stamped on the REMAINING body (null when no live
   *  anchor existed) — the bleed emitters register from it directly. */
  onSever?: (piece: DetachedPiece, stumpWound: Wound | null) => void;
  /** HEAD POP (soft targets, owner 2026-09-24: the cultist's head shot is a
   *  big blood burst, not the zombie's flying head). When set, a killing
   *  head hit on a soft target removes the head outright — no flying chunk —
   *  and calls this with the head's world centre, the shot direction and the
   *  neck's stump wound, for the caller's burst and bleed. */
  onHeadPop?: (head: { origin: Vec3; prims: Primitive[] }, dir: Vec3, stumpWound: Wound | null) => void;
}): ZombieActor {
  const { body, view } = opts;
  let bound = bindRig(body);
  // Walking releases the static anchor bindRig pins — rest pull + stance
  // plants carry the body (lab-main's unpinnedRigPoints).
  bound = {
    ...bound,
    rig: { ...bound.rig, points: bound.rig.points.map(p => ({ ...p, pinned: false })) },
  };
  const mj = makeMotionJoints(body, bound.rig.restPose);
  if (!mj) throw new Error(`zombie ${opts.id}: no motion joints`);
  const joints: MotionJoints = mj;
  let state: MotionState = makeMotionState(opts.seed, opts.start);
  // Starting-phase variety: seed the initial heading so spawns don't parade.
  state = { ...state, wander: { ...state.wander, heading: (opts.seed % 8) * (Math.PI / 4) } };
  const rng: Rng = makeRng(opts.seed);
  /** A SECOND, independent RNG for swing-variant rolls. It must not share the
   *  wander/motion generator: drawing an extra value per frame from that one
   *  would shift every subsequent wander decision and change trajectories
   *  that existing tests and captures pin. */
  const swingRng: Rng = makeRng((opts.seed ^ 0x5eed5eed) >>> 0);
  // `current` is the LIVE body — severLimb/severDistal hand back a new
  // BuildResult with alive flags moved (prims are never removed/reordered).
  let current = body;
  let posed = body;
  /**
   * THE RUPTURE WINDOW (gib-tear.ts). While this is set the march draws the
   * body with its planned regions pulled apart and the flesh leading the bones,
   * and `posed` itself stays the CLEAN body, so the resolver, the wound ring
   * and the gib's own piece plan all still see the body as it is. Null on every
   * frame of ordinary play.
   */
  let tear: TearState | null = null;
  /**
   * The piece plan this body is separating into, prepared ONCE from the clean
   * posed body when the window begins. The visualization (`rupturePosed`) and
   * the released chunks both read THIS plan, so the region drawn is the region
   * spawned.
   */
  let tearPlan: RupturePlan | null = null;
  /**
   * FLESH-PRIM → REGION lookup, built once when the window begins. The wound
   * upload needs it to carry each crater by the same rigid transform its
   * region's flesh got (see `refreshWounds`).
   */
  let tearPrimRegion: Int32Array | null = null;
  /** Per-actor copy of the window's shape, so a live seam can retune it. */
  let tearTuning: TearTuning = TEAR_TUNING;
  /**
   * THE BODY THE MARCH SHOULD DRAW THIS FRAME: the posed body with its planned
   * regions pulled apart when a rupture is running. EVERY view upload goes
   * through here, so the separation cannot appear on one path and be missing on
   * another.
   */
  const ruptureFrameNow = (): RuptureFrame | null =>
    tear && tearPlan ? rupturePosed(posed, tearPlan, tear, tearTuning) : null;
  const drawnPose = (): BuildResult => ruptureFrameNow()?.body ?? posed;
  /** A body mid-rupture is DOOMED: it is already dead for gameplay (the blast
   *  resolved the kill), it just has not finished coming apart. It must not keep
   *  attacking or moving while it tears. */
  let doomed = false;
  /**
   * BURNING PANIC (Task 2, 2026-09-18). Non-null from the frame the body is
   * set alight until it is put out. The per-substep step overrides the mind's
   * target/fire verdict — the `doomed` pattern — so neither brain learns a
   * "burning" state. `burnCruiseScale` is the speed multiplier handed to
   * motion; `burnFlailT` counts down to the next flail shudder (the arm-flail
   * stand-in, since motion.ts has no additive arm channel).
   */
  let burnPanic: BurnPanicState | null = null;
  let burnCruiseScale = 1;
  let burnFlailT = 0;
  /** Monotonic count of burn stumbles — the trace's unambiguous oracle. */
  let burnStumbles = 0;
  /**
   * Last world position the actor saw the player at. game-main does not call
   * setBrainInput (the encounter director feeds the mind instead), so the
   * burn-panic flee target reads the director's player when visible and this
   * cached point when the player is out of sight — a burning soldier must
   * still run away from where the player was, not a fixed axis.
   */
  let lastPlayerPos: Vec3 | null = null;
  let bodyYaw = 0;
  const soldierDamage = opts.profile?.name === 'soldier';
  /** A soft target (MotionProfile.soft) dies to its first bullet or blast hit;
   *  set on the hit, turned into a forced collapse on the next step. */
  const softTarget = !!opts.profile?.soft;
  let softKilled = false;
  /** The killing hit's death (soft-death.ts planDeath): the style's throw is
   *  applied on the first collapsed sub-step, a stagger first stays up
   *  `dyingT` seconds (optionally spraying `burstLeft` rounds). */
  let deathPlan: DeathPlan | null = null;
  let deathDir: Vec3 = [0, 0, 0];
  let deathThrown = false;
  let dyingT = 0;
  let burstLeft = 0;
  let burstClock = 0;
  let burstShot = false;
  let headPop = false;
  /** SCANNERS SWELL: a head-shot kill holds `swellDur` s (dyingT counts it
   *  down) while the head inflates (head-pop.ts inflateHead), then pops. */
  let swellDur = 0;
  let swellClock = 0;
  const deathRng: Rng = makeRng((opts.seed ^ 0xdea7dea7) >>> 0);
  /** Start a soft target's death: plan it once, from the killing hit. */
  function beginSoftDeath(dir: Vec3, limb: LimbId | undefined, bone: string | undefined, weapon: 'slug' | 'pellet' | 'blast', pop = false) {
    softKilled = true;
    deathDir = [...dir] as Vec3;
    deathPlan = planDeath({ limb, bone, weapon }, deathRng);
    dyingT = deathPlan.delaySec;
    burstLeft = deathPlan.burst;
    headPop = pop && !!opts.onHeadPop;
    if (headPop) {
      // Owner, second pass: 0.3-0.5 s was "a bit too delayed". SWELL_SEC
      // (head-pop.ts) keeps it a knob — a bullet-time mode will stretch it.
      swellDur = SWELL_SEC[0] + (SWELL_SEC[1] - SWELL_SEC[0]) * deathRng();
      swellClock = 0;
      dyingT = Math.max(dyingT, swellDur);
      burstLeft = 0;
    }
  }
  let deathStateApplied = false;
  /** SOFT HIT COUNT (owner, second pass: one hit was too soft). Counted per
   *  TRIGGER PULL — a shotgun's pellets share a shotId — so a volley is one. */
  let softHits = 0;
  const softShots = new Set<string>();
  let softShotSerial = 0;
  function newSoftShot(wound: Wound): boolean {
    const src = wound.shot;
    const id = src && 'shotId' in src && src.shotId !== undefined ? `shot:${src.shotId}`
      : `batch:${hitBatching ? diagnosticBatchShot : --softShotSerial}`;
    if (softShots.has(id)) return false;
    softShots.add(id);
    return true;
  }
  /** Distance to the player at the hit (the last seen position); Infinity when
   *  unknown, so an unknown shooter never counts as close. */
  function shooterDistance(): number {
    const pl = encounterOrder?.player ?? brainPlayer;
    if (!pl) return Infinity;
    return Math.hypot(pl.x - state.wander.pos[0], pl.z - state.wander.pos[2]);
  }
  let soldierFatal = false;
  let propReleaseRequested = false;

  // ---- damage state -------------------------------------------------------
  /** THE shared wound ring (character-view.ts). The character's own when the
   *  caller supplied one, otherwise a private one from the same factory — so
   *  the eight test call sites and hull-spike-main, which build actors from a
   *  bare body and view, run the SAME ring implementation the game does.
   *  One implementation, whoever owns it: the drift this refactor exists to
   *  kill came from two hand-written copies of the same sequence. */
  const woundRing = opts.character?.wounds ?? createWoundRing();
  // Visual slots evict at MAX_WOUNDS; injury must not heal when a crater
  // disappears. Live regional histories stop growing after severing/death.
  const soldierWounds: Wound[] = soldierDamage ? [...woundRing.all()] : [];
  function recordSoldierInjury(w: Wound): void {
    if (!soldierDamage || soldierFatal || w.injuryIgnored || w.type === 'burn') return;
    const prim = current.prims[w.primIdx];
    if (prim && soldierInjury(current, soldierWounds).missing[prim.limb as keyof MissingLimbs]) return;
    if (prim && !prim.dead && current.clusters.find(c => c.limb === prim.limb)?.alive) soldierWounds.push(w);
  }
  const torsoWounds = opts.boundedWounds ? createTorsoWounds() : null;
  if (torsoWounds) for (const w of woundRing.all()) torsoWounds.record(w, body);
  const pendingWounds: Wound[] = [];
  const pendingSevered: LimbId[] = [];
  let pendingShot: MotionSignals['shot'] = null;
  let reactionTime = 0;
  let shotWindow: number[] = [];
  const seenReactionShots = new Map<string, number>();
  let diagnosticShotSerial = 0;
  let diagnosticBatchShot = 0;
  let pendingPelletHits = 0;
  let pendingPelletShot: MotionSignals['shot'] = null;
  let meleeContacts = 0;

  let lastDebug: ReturnType<ZombieActor['debug']> | null = null;
  let encounterOrder: EncounterOrder | null = null;
  let routeCache: { goal: Vec3; path: Vec3[]; age: number } | null = null;
  const actorRoom = () => opts.navigation?.roomAt(state.wander.pos) || opts.room;
  const routeGoal = (goal: Vec3, dt: number): Vec3 | null => {
    const nav=opts.navigation;if(!nav)return goal;
    if(nav.canTravel(state.wander.pos,goal))return goal;
    if(!routeCache||routeCache.age>.6||Math.hypot(goal[0]-routeCache.goal[0],goal[2]-routeCache.goal[2])>.6)
      routeCache={goal,path:nav.route(state.wander.pos,goal),age:0};
    routeCache.age+=dt;return nav.follow(state.wander.pos,routeCache.path);
  };
  let lastFrame: ReturnType<typeof stepMotion>['frame'] | null = null;
  /** prop.fistOnGrip: the right hand tip, pinned along its motion target
   *  each step (pinTips `only`); the one-element list, built once. */
  const fistTips = ((): { tips: BoundRig['tips']; only: ReadonlySet<number> } | null => {
    const i = joints.index.handTipR;
    if (!opts.profile?.prop?.fistOnGrip || i === undefined) return null;
    const tips = bound.tips.filter(t => t.point === i);
    return tips.length ? { tips, only: new Set([i]) } : null;
  })();
  /** See debug().fistGrip / fistGripAuthored. */
  let lastFistGrip: number | null = null;
  let lastFistGripAuthored: number | null = null;

  // Heavy-hit choreography state (blast-profile hits — the slug): the ROOT
  // knock. Knocked back along the shot's ground-plane direction from
  // BLAST_KNOCK_MPS, decaying exponentially at BLAST_KNOCK_DECAY/s (total
  // travel ≈ v0/k). Actor-owned on purpose: a wander.pos delta already
  // expresses it, so the shared motion modules and the lab's wiring — which
  // must stay bit-identical — are untouched. The walk STOP is not here: a
  // blast calls the mind's stagger() and the stagger state's hold gates
  // cfg.wander for blastHoldSec — locomotion is gated in exactly one place.
  let knockV = 0;
  let knockDir: Vec3 = [0, 0, 0];

  // ---- mind state ---------------------------------------------------------
  // The decision layer (the EnemyMind — brain.ts's machine or the soldier's,
  // wrapped) runs INSIDE the sub-step loop so a chase target is refreshed at
  // the same cadence the locomotion integrates at. Its target overrides
  // wander.target; its halt IS the single cfg.wander gate (the blast hold is
  // a brain state now); its swing phase becomes cfg.attack. The melee ring's
  // verdict and the blast flag arrive as inputs. Absent opts.mind = the
  // zombie's, which is what keeps every existing pin green by construction.
  const mind: EnemyMind = opts.mind ?? makeZombieMind();
  let brainPlayer: BrainPlayer | null = null;
  let brainAlerted = false;
  let ringToken = false;
  let ringDrift: -1 | 0 | 1 = 0;
  let forcedSwing: { phase: number; side: 'L' | 'R'; variant: SwingVariant } | null = null;
  let lastEngaged = false;
  let lastCommitted = false;
  // Committed avoid side while the direct chase line is blocked (0 = direct,
  // walking at the goal). Chosen once per blocked episode; see the routing
  // block inside step().
  let detourSide: -1 | 0 | 1 = 0;

  function woundedLimbs() {
    if (soldierDamage) return soldierInjury(current, soldierWounds).wounded;
    const w = { armL: false, armR: false, legL: false, legR: false };
    for (const wound of woundRing.all()) {
      const prim = current.prims[wound.primIdx];
      if (!prim) continue;
      if ((prim.limb === 'armL' || prim.limb === 'armR'
        || prim.limb === 'legL' || prim.limb === 'legR')
        && current.clusters.find(c => c.limb === prim.limb)?.alive) w[prim.limb] = true;
    }
    return w;
  }

  function missingLimbs(): MissingLimbs {
    if (soldierDamage) return soldierInjury(current, soldierWounds).missing;
    const gone = (l: LimbId) => !(current.clusters.find(c => c.limb === l)?.alive ?? false);
    // A leg with ANY distal cut has lost its foot (severDistal kills the prim
    // and everything outward), so it can no longer bear weight: count it as
    // missing for the gait/collapse. Otherwise two shot-off shins left the
    // torso standing on air (the cluster stays alive on a mid-limb cut).
    const legGone = (l: LimbId) => gone(l)
      || current.prims.some(p => p.limb === l && p.dead && p.op !== 'sub');
    return { legL: legGone('legL'), legR: legGone('legR'), armL: gone('armL'), armR: gone('armR') };
  }

  /** Carve upload: the SURFACE ANCHOR (the shader's sphere centre — the
   *  lab's deep-bowl look) plus the per-wound depth-slab cap (inward normal
   *  + max depth), which clips the sphere's reach so a crater on thin flesh
   *  floors before it perforates. Skipped entirely while there are no wounds
   *  (the common case), and tolerant of stub views without the method.
   *
   *  THE WOUND FRAME IS THE BODY FRAME (2026-09-02, the billboarding fix).
   *  Wounds are stamped on APPLYRIG OUTPUT (posed, world-space prims) WITH
   *  the live bodyYaw, and uploaded from the posed prims WITH the live
   *  bodyYaw. damage.ts does not rotate a world basis by the yaw — it uses
   *  the yaw to pick a canonical BODY-FRAME basis (de-yaw the prim axis,
   *  build the basis, re-yaw), so `local` comes out in the body frame and
   *  the frame turns with the flesh. Without it, every SPHERE prim (all four
   *  torso blobs, the shoulder balls) has no axis to carry the turn and its
   *  crater stayed viewer-fixed while the body rotated under it — the
   *  owner's back-wound-rotates-to-the-front report; head wounds ride the
   *  orient quat and were fine, limb capsules carry it in their axis.
   *
   *  SEVERING STAYS AT YAW 0 ON PURPOSE: runSeverChecks resolves the carve
   *  spheres against `current`, the REST body, which IS the body frame —
   *  yaw 0 there is the same frame as yaw θ on the posed prims. The old
   *  yaw-0-everywhere rule was defended by a measured failure ("worst
   *  neck-section sample stuck at 0.084 m > 0.055 m") that came from quoting
   *  the walk yaw against the REST body — a frame mismatch, not a reason to
   *  stamp at 0. Stamp(posed, θ) / upload(posed, θ) / resolve(rest, 0): one
   *  frame, three views of it. Same wiring as webgpu/lab-main's hero. */
  function refreshWounds(frame?: RuptureFrame | null) {
    // The upload lives on the ring now (character-view.ts), so the lab and the
    // game push identical carve rows — including the depth-slab normals the
    // lab had ZERO references to before this. The pose is ours to supply: the
    // ring owns the wound DATA, the caller owns the rig it is stamped against.
    const visual=torsoWounds?.visual(posed) ?? (soldierDamage ? soldierVisualWounds(woundRing.all()) : undefined);
    // RUPTURE: a crater must ride the rotating region it is carved into. The
    // ring computes the position from the CLEAN prims (the stored offset lives
    // in that frame); this applies that region's rigid transform to the result.
    // Re-running `frame()` on a rotated prim instead would reinterpret the
    // offset in a different frame — the stamp/upload mismatch the wound path
    // has been bitten by before.
    const xf: WoundPointTransform | undefined = frame && tearPrimRegion && tearPlan
      ? (v, primIdx, dir) => {
          const r = primIdx >= 0 && primIdx < tearPrimRegion!.length ? tearPrimRegion![primIdx]! : -1;
          if (r < 0) return v;
          const q = frame.quats[r];
          const off = frame.offsets[r];
          if (!q || !off) return v;
          const identity = q[0] === 0 && q[1] === 0 && q[2] === 0 && q[3] === 1;
          if (identity) return dir ? v : add(v, off);
          const pivot = tearPlan!.pieces[r]!.origin;
          return dir ? qRotate(q, v) : add(off, add(pivot, qRotate(q, sub(v, pivot))));
        }
      : undefined;
    woundRing.refresh(view, posed, bodyYaw, visual, xf);
  }

  function advanceWoundPreview(dt: number): boolean {
    if (!torsoWounds?.advance(dt)) return false;
    refreshWounds();
    return true;
  }

  /** Re-binds after a body edit, carrying live rig points across (bones are
   *  unchanged by severing — only alive flags move). Lab-main's rebind(). */
  function rebind() {
    damageRevision++; bakePaused = false;
    const keep = bound.rig.points;
    let next = bindRig(current);
    if (keep.length === next.rig.points.length) {
      next = {
        ...next,
        // jawGape carries over so a limb severed mid-swing does not shut the
        // bride's jaw for a frame (absent on every other body).
        rig: { ...next.rig, bodyYaw, headFollowsRig: bound.rig.headFollowsRig, jawGape: bound.rig.jawGape, points: keep.map(p => ({ ...p, pinned: false })) },
      };
    }
    bound = next;
  }

  function detach(limb: LimbId, r: SeverResult) {
    if (r.chunk.prims.length === 0) return;
    const piece = posedDetachedChunk(current, posed, r.chunk, bodyYaw, !soldierDamage);
    current = r.body;
    // A soft target's gun hand goes with ANY cut on the right arm (a forearm
    // cut leaves the arm cluster alive, so missingLimbs never says so).
    if (softTarget && limb === 'armR' && !propReleaseRequested) {
      propReleaseRequested = true;
      opts.character?.releaseProp([0, 0, 0], opts.seed);
    }
    if (r.stumpWound) {
      woundRing.stamp(r.stumpWound, posed, bodyYaw);
      torsoWounds?.record(r.stumpWound, current, false);
      pendingWounds.push(r.stumpWound);
    }
    pendingSevered.push(limb);
    rebind();
    opts.onSever?.({
      limb,
      origin: piece.origin, prims: piece.prims, bones: piece.bones, tornAt: piece.tornAt,
    }, r.stumpWound);
  }

  function allowArmCut(limb: LimbId, fromPrim?: number): boolean {
    if (!soldierDamage || soldierFatal || (limb !== 'armL' && limb !== 'armR')) return true;
    const cluster = current.clusters.find(c => c.limb === limb)!;
    const order = chainOrder(current, cluster);
    if (!order.length) return false;
    let at: Vec3;
    if (fromPrim !== undefined) {
      const i = order.indexOf(fromPrim);
      if (i < 1) return false;
      at = jointPoint(current.prims[order[i - 1]!]!, current.prims[fromPrim]!);
    } else {
      const first = current.prims[order[0]!]!;
      const joint = order.length > 1 ? jointPoint(first, current.prims[order[1]!]!)
        : current.clusters.find(c => c.limb === 'torso')!.center;
      const distance = (p: Vec3) => Math.hypot(p[0] - joint[0], p[1] - joint[1], p[2] - joint[2]);
      at = distance(first.a) >= distance(first.b) ? first.a : first.b;
    }
    return soldierArmCutAllowed(current, soldierWounds, limb, at);
  }

  /** HEAD POP: the head goes in a burst — no flying chunk (onHeadPop). */
  function popHead() {
    const head = current.clusters.find(c => c.limb === 'head');
    if (!head?.alive) return;
    const r = severLimb(current, 'head');
    const piece = posedDetachedChunk(current, posed, r.chunk, bodyYaw, !soldierDamage);
    current = r.body;
    if (r.stumpWound) {
      woundRing.stamp(r.stumpWound, posed, bodyYaw);
      pendingWounds.push(r.stumpWound);
    }
    pendingSevered.push('head');
    rebind();
    opts.onHeadPop?.(piece, deathDir, r.stumpWound);
  }

  /** The first (non-lethal) hit's reaction: the profile's violent throw-back
   *  flail (motion-profile.ts flail), the arms thrown open with the gun yawed
   *  off, or the hunch — and the aim goes (mind.stagger). */
  function softStagger(weapon: 'slug' | 'pellet' | 'blast'): Partial<NonNullable<MotionSignals['shot']>> {
    const r = deathRng();
    const react: Partial<NonNullable<MotionSignals['shot']>> = r < 0.45
      ? { soldierLevel: weapon === 'pellet' ? 'medium' : 'heavy', fullStagger: true, torso: true }
      : r < 0.7
        ? { soldierLevel: weapon === 'pellet' ? 'medium' : 'heavy', staggerVariant: 1 }
        : { soldierLevel: 'heavy', staggerVariant: 2, torso: true };
    const dur = react.fullStagger ? (opts.profile?.flail?.durationSec ?? soldierStaggerDuration('heavy', true))
      : soldierStaggerDuration(react.soldierLevel ?? 'medium');
    mind.stagger(dur);
    return react;
  }

  function runSeverChecks() {
    const torsoC = current.clusters.find(c => c.limb === 'torso')?.center ?? [0, 1.1, 0] as Vec3;
    const injury = soldierDamage ? soldierInjury(current, soldierWounds) : null;
    if (injury) soldierFatal ||= injury.fatal;
    const cuttingWounds = soldierDamage ? woundRing.all().filter(w => !w.injuryIgnored) : [...woundRing.all()];
    const fullCuts = [...new Set([...cutLimbs(current, cuttingWounds, torsoC).filter(limb => (!soldierDamage || soldierFatal || limb !== 'head') && allowArmCut(limb)), ...(injury?.sever ?? [])])];
    for (const limb of fullCuts) {
      detach(limb, severLimb(current, limb));
    }
    for (const cut of cutChains(current, soldierDamage ? cuttingWounds : [...woundRing.all()])) {
      if (fullCuts.includes(cut.limb) || (soldierDamage && !soldierFatal && cut.limb === 'head') || !allowArmCut(cut.limb, cut.fromPrim)) continue;
      detach(cut.limb, severDistal(current, cut));
    }
    // A soft target that loses its gun arm drops the gun.
    if (softTarget && !propReleaseRequested && missingLimbs().armR) {
      propReleaseRequested = true;
      opts.character?.releaseProp([0, 0, 0], opts.seed);
    }
    if (soldierDamage) {
      const after = soldierInjury(current, soldierWounds);
      soldierFatal ||= after.fatal;
      if (soldierFatal || after.downed) { shotWindow = []; seenReactionShots.clear(); }
      if (!propReleaseRequested && (soldierFatal || after.downed || after.missing.armR)) {
        propReleaseRequested = true;
        opts.character?.releaseProp([0, 0, 0], opts.seed);
      }
    }
  }

  function insideFurniture(p: Vec3): boolean {
    for (const f of opts.furniture) {
      if (p[0] > f.min[0] - FURNITURE_MARGIN && p[0] < f.max[0] + FURNITURE_MARGIN
        && p[2] > f.min[2] - FURNITURE_MARGIN && p[2] < f.max[2] + FURNITURE_MARGIN) return true;
    }
    return false;
  }

  let bakePaused = false;
  let damageRevision = 0;
  function step(dt: number) {
    if (bakePaused) return;
    // A MELEE prop falls with its sword arm (the bride): motion.ts stops the
    // carry (canHold), so drop the sword rather than leave it hanging in air.
    if (opts.profile?.melee && opts.profile.prop && !propReleaseRequested && missingLimbs().armR) {
      propReleaseRequested = true;
      opts.character?.releaseProp([0, 0, 0], opts.seed);
    }
    reactionTime += Math.max(0, dt);
    let firstSub = true;
    // Consume the capture pin ONCE PER FRAME, before the sub-step loop: every
    // sub-step of THIS step() carries the forced pose, and the brain's own
    // swing config resumes on the next step(). (Read-then-clear, not clear
    // per sub-step — a mid-frame clear would let later sub-steps compose the
    // pose without the attack, and the photographed frame would not show it.)
    const swingPin = forcedSwing;
    forcedSwing = null;
    for (const sdt of planSubSteps(dt)) {
      // Heavy-hit choreography (see the state block): knock the ROOT before
      // the motion step so this sub-step's targets ride the moved root.
      // Bounds-clamped like stepWander's own integration, so a knock cannot
      // shove the body through a room wall.
      if (knockV > 1e-4) {
        const w = state.wander;
        const nx = w.pos[0] + knockDir[0] * knockV * sdt;
        const nz = w.pos[2] + knockDir[2] * knockV * sdt;
        state = {
          ...state,
          wander: {
            ...w,
            pos: [
              Math.min(Math.max(nx, opts.navigation?.bounds.minX ?? opts.bounds.minX), opts.navigation?.bounds.maxX ?? opts.bounds.maxX),
              0,
              Math.min(Math.max(nz, opts.navigation?.bounds.minZ ?? opts.bounds.minZ), opts.navigation?.bounds.maxZ ?? opts.bounds.maxZ),
            ],
          },
        };
        if (opts.navigation && !opts.navigation.canTravel(w.pos,state.wander.pos)) state={...state,wander:{...state.wander,pos:w.pos}};
        knockV *= Math.exp(-BLAST_KNOCK_DECAY * sdt);
      }
      // Real signals on the damaged path; CALM otherwise. severed/freshWounds
      // alias the pending arrays and drain after the FIRST sub-step, exactly
      // like the lab's hero signals.
      const signals: MotionSignals = firstSub && (pendingShot || pendingWounds.length || pendingSevered.length)
        ? {
          ...CALM,
          dt: sdt,
          shot: pendingShot,
          wounded: woundedLimbs(),
          severed: pendingSevered,
          missing: missingLimbs(),
          headAlive: current.clusters.find(c => c.limb === 'head')?.alive ?? false,
          freshWounds: pendingWounds,
        }
        // A MELEE carry (the bride) needs her real missing limbs on EVERY
        // sub-step, not only on damage frames: motion.ts's canHold and arm
        // pins read sig.missing, and CALM would re-pin a severed arm's joints
        // to guard targets the frame after the cut (Task 11 review). Other
        // profiles keep CALM exactly (the zombie no-op contract).
        : opts.profile?.melee ? { ...CALM, dt: sdt, missing: missingLimbs() } : { ...CALM, dt: sdt };
      firstSub = false;
      // Decide before locomotion integrates, so the target this sub-step walks
      // toward is this sub-step's target.
      let think = mind.step({
        dt: sdt,
        self: {
          x: state.wander.pos[0], z: state.wander.pos[2],
          yaw: bodyYaw, room: actorRoom(),
        },
        player: encounterOrder ? encounterOrder.player : brainPlayer,
        alerted: encounterOrder ? encounterOrder.visible : brainAlerted,
        ...(encounterOrder ? { lineOfSight: encounterOrder.visible, mayFire: encounterOrder.fireAllowed } : {}),
        hasToken: ringToken,
        drift: ringDrift,
        roll: swingRng(),
        rollDrift: swingRng(),
        missing: missingLimbs(),
        ...(!mind.meleeCapable && !encounterOrder ? {
          bounds: opts.bounds,
          lineOfSight: brainPlayer !== null && !opts.furniture.some(box => segmentHitsBox(
            [state.wander.pos[0], 1.4, state.wander.pos[2]],
            [brainPlayer!.x, 1.4, brainPlayer!.z], box)),
          canMoveTo: (target: Vec3) => clearCombatMove(state.wander.pos, target, opts.furniture),
        } : {}),
      });
      // The MIND's own target, captured before the encounter director's halt
      // (a ring hold with `holdSecs > 0` nulls the post-encounter target). A
      // burning zombie's chase must follow the mind's intent, not a ring hold
      // that would freeze it at range.
      const mindTarget = think.target;
      // A DOOMED BODY KEEPS NO AGENDA. It is already dead for gameplay — the
      // blast resolved that on impact — it just has not finished coming apart,
      // so it must not keep chasing, swinging or shooting during the window.
      // The mind still ran (its own debug/timing stays coherent); its verdict is
      // overridden here, which keeps this to ONE place rather than teaching the
      // brain a new "rupturing" state.
      if (doomed) {
        think = {
          ...think, target: null, halt: true,
          attack: null, fire: false, weaponUp: false, contact: false, advance: null,
        };
      }
      if (encounterOrder) {
        if (encounterOrder.moveTarget) think={...think,target:encounterOrder.moveTarget,halt:think.committed && think.halt,
          faceHeading:encounterOrder.visible?think.faceHeading:null,fire:false,weaponUp:false};
        if (encounterOrder.halt || mind.debug().holdSecs > 0) think={...think,target:null,halt:true,fire:false};
        if (!encounterOrder.visible) think={...think,attack:null,fire:false,weaponUp:false};
        if (!encounterOrder.fireAllowed) think={...think,fire:false};
        if (think.target) {
          const routed=routeGoal(think.target,sdt);
          think={...think,target:routed,halt:think.halt || routed===null};
        }
      }
      // A BURNING BODY PANICS. This is an OVERRIDE of the mind's (and the
      // encounter director's) verdict, the same pattern as `doomed`, so
      // neither brain grows a burn state. It runs AFTER the encounter block on
      // purpose: the director emits `halt: true` for an idle actor and a
      // moveTarget in combat, either of which would erase the flee / chase
      // target on nearly every frame if the override ran first.
      if (burnPanic && !doomed) {
        // The encounter director (not setBrainInput) feeds the game's minds,
        // so read the player from the order when present and remember the
        // last seen point for when sight is lost.
        const playerNow = encounterOrder?.player ?? brainPlayer;
        if (playerNow) lastPlayerPos = [playerNow.x, 0, playerNow.z];
        const bp = stepBurnPanic(burnPanic, {
          kind: mind.kind,
          self: state.wander.pos,
          player: lastPlayerPos,
          // A held zombie (ring token / blast recovery) reports a null mind
          // target; its chase falls back to the last seen player point so the
          // panic keeps it closing instead of freezing at range.
          chaseTarget: mindTarget ?? lastPlayerPos,
        }, sdt);
        think = {
          ...think,
          target: bp.target,
          halt: bp.target === null,
          fire: false,
          weaponUp: false,
          // A zombie keeps its swipe; a soldier drops the attack (no aiming).
          attack: mind.kind === 'zombie' ? think.attack : null,
          faceHeading: null,
        };
        burnCruiseScale = bp.cruiseScale;
        burnFlailT -= sdt;
        // A soldier's `small` soldier reaction must lap before it can restart
        // (equal level does not restart an active one) — see burn-behaviour.ts.
        const flailPeriod = soldierDamage
          ? BURN_BEHAVIOUR.soldierFlailPeriodSec : BURN_BEHAVIOUR.flailPeriodSec;
        if (bp.stumble) {
          burnStumbles++;
          signals.shot = burnStumbleShot();
          burnFlailT = flailPeriod;
        } else if (burnFlailT <= 0 && signals.shot === null) {
          // The arm-flail stand-in (see burn-behaviour.ts's note): a burn
          // shudder re-emitted on a timer. A real hit signal wins the frame.
          signals.shot = burnFlailShot();
          burnFlailT = flailPeriod;
        }
      } else {
        burnCruiseScale = 1;
      }
      // The burn override's speed multiplier rides the same signals object
      // stepMotion consumes; 1 (absent-equivalent) when not burning.
      signals.cruiseScale = burnCruiseScale;
      brainAlerted = false;   // one-shot: the first sub-step consumes it
      lastEngaged = think.engaged;
      lastCommitted = think.committed;
      // Facing and travel are independent for a ranged actor. The motion
      // profile owns the turn rate; the mind gates release on actual yaw.
      if (think.faceHeading !== null) {
        state = { ...state, wander: { ...state.wander, heading: think.faceHeading } };
      }
      // Fire is the SAME event for the animation clock and the projectile.
      // Previously the callback fired but CALM.fire stayed false forever.
      signals.fire = think.fire && !missingLimbs().armR
        && (current.clusters.find(c => c.limb === 'head')?.alive ?? false);
      if (soldierDamage || !mind.meleeCapable) {
        signals.missing = missingLimbs();
        signals.wounded = woundedLimbs();
      }
      if (soldierDamage) {
        const injury = soldierInjury(current, soldierWounds);
        soldierFatal ||= injury.fatal;
        signals.downed = injury.downed;
        signals.mobilityInjury = injury.mobilityInjury;
        signals.fatal = soldierFatal;
        signals.forcedCollapse ||= soldierFatal;
        signals.fire &&= !soldierFatal && !signals.downed;
        signals.headAlive = current.clusters.find(c => c.limb === 'head')?.alive ?? false;
      }
      // A burning soldier must never fire, whatever the mind or the injury
      // path computed above (the panic override is the last word).
      if (burnPanic && !doomed) signals.fire = false;
      if (softKilled) {
        // A STAGGER stays up for dyingT, reeling, and may clench the trigger:
        // one round every 70 ms, sprayed high (see the onFire site).
        burstShot = false;
        if (dyingT > 0) {
          dyingT -= sdt;
          burstClock -= sdt;
          signals.fire = false;
          if (burstLeft > 0 && burstClock <= 0 && !missingLimbs().armR) {
            signals.fire = true; burstShot = true; burstLeft--; burstClock = 0.07;
          }
        } else {
          signals.forcedCollapse = true; signals.fire = false;
        }
      }
      // A dying soft target keeps no agenda (the same override as `doomed`).
      if (softKilled) think = { ...think, target: null, halt: true, attack: null, fire: false, contact: false };
      if (think.halt && (soldierDamage || !mind.meleeCapable)) {
        state = { ...state, wander: { ...state.wander, target: null, speed: 0, idle: 0 } };
      }
      if (think.target) {
        // CHASE ROUTING. The furniture rejection's escape hatch (drop the
        // target, stepWander picks another) cannot work for a chaser: the
        // brain re-aims every sub-step, so a body whose straight line to him
        // crossed a crate was rejected, restored and re-aimed into the crate
        // forever. Wired here because this is where the furniture AABBs
        // live; brain.ts stays pure geometry: when the straight line to the
        // goal is blocked, aim at the goal pushed to one COMMITTED side
        // (pickAvoidSide) so the body arcs around the blocker; the furniture
        // rejection's min-axis push-out lets it SLIDE along the face instead
        // of pressing it. The side is re-picked only per blocked episode —
        // re-picking every sub-step would jitter in place.
        // The brain now emits the point it actually wants walked to — the
        // player for pursue/engage, a ring point for encircle — so the
        // router must NOT substitute the player, or an encircling body would
        // be routed straight into the melee it is waiting outside of.
        const goal: Vec3 = think.target;
        if (!opts.navigation && mind.meleeCapable && firstBlockingBox(state.wander.pos, goal, opts.furniture)) {
          if (detourSide === 0) {
            detourSide = pickAvoidSide(state.wander.pos, goal, opts.furniture);
          }
        } else {
          detourSide = 0;
        }
        // idle 0 as well: a chaser must never take a wander pause mid-pursuit.
        const target = detourSide === 0
          ? goal
          : avoidPoint(state.wander.pos, goal, detourSide);
        state = {
          ...state,
          wander: { ...state.wander, target, idle: 0 },
        };
      } else {
        detourSide = 0;
      }
      // The sword LUNGE (enemy-mind.ts makeSwordMind): the brain halts
      // locomotion during a swing, so the surge is applied to the root here,
      // and only where the level allows it (the same combat-move check fed
      // into MindInput.canMoveTo above).
      if (think.advance) {
        const p = state.wander.pos;
        const next: Vec3 = [p[0] + think.advance[0], p[1], p[2] + think.advance[2]];
        if (clearCombatMove(p, next, opts.furniture)) {
          state = { ...state, wander: { ...state.wander, pos: next } };
        }
      }
      const beforeMove = state.wander.pos;
      const stepR = stepMotion(
        state, joints,
        {
          enabled: true,
          wander: !think.halt,
          ...(think.faceHeading !== null ? { faceHeading: think.faceHeading } : {}),
          // Profile, spread rather than `profile: opts.profile`: the same
          // bit-identity contract as the attack line below — motion.ts's
          // zombie path is pinned on the key being ABSENT, not undefined.
          ...(opts.profile !== undefined ? { profile: opts.profile } : {}),
          // Spread, not `attack: think.attack ?? undefined`: motion.ts's
          // bit-identity contract is about the key being ABSENT.
          // swingPin is forceSwing()'s one-frame capture pin (see step());
          // null on every frame the game itself runs.
          // WEAPON UP: hold the fire carry for the whole telegraph, not just
          // the shot frame. motion.ts only swaps to `carries.fire` while
          // FIRE.holdSec is running, i.e. AFTER the bang -- so a soldier
          // winding up showed no wind-up at all and the owner saw "muzzle
          // flash out of a walking body". carryOverride is the existing seam
          // for exactly this (it is what the lab's pose captures use).
          ...(think.weaponUp && opts.profile?.carries
            ? { carryOverride: opts.profile.carries.fire }
            : {}),
          ...(swingPin !== null
            ? { attack: swingPin }
            : think.attack !== null ? { attack: think.attack } : {}),
        },
        signals,
        bound.rig.points, encounterOrder && encounterOrder.mode !== 'idle' && opts.navigation ? opts.navigation.bounds : opts.bounds, rng,
      );
      state = stepR.state;
      lastFrame = stepR.frame;
      const f = stepR.frame;
      if (think.contact && think.attack && !f.collapsed && !signals.fatal) {
        meleeContacts++;
        opts.onMeleeContact?.({ actorId: opts.id, variant: think.attack.variant });
      }
      // Collision resolves after motion authored world-space targets. Keep
      // this frame's rig, held prop and future fall anchor with the root.
      // Footwork rebases its world contacts from wander on the next step.
      const correctFrame = (pos: Vec3) => {
        const dx = pos[0] - state.wander.pos[0], dz = pos[2] - state.wander.pos[2];
        const translate = (p: Vec3): Vec3 => [p[0] + dx, p[1], p[2] + dz];
        f.rootShift = translate(f.rootShift);
        f.restPose = f.restPose.map(translate);
        if (f.gun) f.gun = { ...f.gun, root: translate(f.gun.root) };
        state = { ...state, lastShift: translate(state.lastShift),
          wander: { ...state.wander, pos } };
      };
      if (opts.navigation && !opts.navigation.canTravel(beforeMove,state.wander.pos)) {
        correctFrame(beforeMove);
        state={...state,wander:{...state.wander,speed:0,target:null}};
      }
      // Furniture rejection. A step that lands inside a fattened box is
      // pushed back out along its shallowest axis (pushOutOfFurniture), so
      // the tangential component of the step survives and a body pressing a
      // face SLIDES along it — the chase router's committed-side arc needs
      // that slide to get round a corner; a full restore would cancel it and
      // the body would press the same spot forever. A plain wanderer (no
      // brain target) additionally drops its target and pauses: the next leg
      // starts somewhere else, the designed unstick.
      if (insideFurniture(state.wander.pos)) {
        correctFrame(pushOutOfFurniture(state.wander.pos, opts.furniture));
        let w = state.wander;
        if (!think.target) {
          w = { ...w, target: null, idle: 0.2 };
        }
        state = { ...state, wander: w };
      }
      bodyYaw = f.bodyYaw;
      view.setRootShift(f.rootShift[0], f.rootShift[2], f.bodyYaw);
      // LIFE-STATE PRIMS: the first collapsed sub-step swaps the body to its
      // dead look (the cultist's hood drops off his head; death-state.ts).
      if (f.collapsed && !deathStateApplied) {
        deathStateApplied = true;
        if (hasDeathState(current)) current = applyDeathState(current);
      }
      if (deathPlan && f.collapsed && !deathThrown) {
        deathThrown = true;
        const hemI = bound.rig.restScale?.findIndex(k => k !== 1) ?? -1;
        const vel = addSpin(bound.rig.points,
          deathThrowVelocities(bound.rig.points, deathDir, deathPlan.throw, hemI), deathPlan.spin);
        bound = { ...bound, rig: { ...bound.rig, points: launchPoints(bound.rig.points, vel, sdt) } };
        // The gun leaves his hand with it (the zombie path never released it).
        const hand = joints.index.handR;
        const hv = hand !== undefined ? vel[hand]! : [0, 0, 0] as Vec3;
        if (!propReleaseRequested) { propReleaseRequested = true; opts.character?.releaseProp([hv[0], hv[1] + 0.8, hv[2]], opts.seed); }
      }
      let points = stepRig(
        { ...bound.rig, restPose: f.restPose, bodyYaw: f.bodyYaw, posePins: f.posePins }, sdt,
        {
          gravity: f.gravity,
          damping: 0.06,
          iterations: 4,
          // A soft kill goes limp AT ONCE: the collapse's 0.35 s rest-pull
          // ramp dragged the thrown body back upright and ate the throw.
          restStiffness: STANDING_RIG.restStiffness * (softKilled && f.collapsed ? 0 : f.restPull),
        },
      ).points;
      if (f.ropes.length) points = relaxRopeConstraints(points, f.ropes);
      // THE FIST CLOSES ON THE GRIP (profile.prop.fistOnGrip, the bride). The
      // game rig never pins tips (only the lab's stepActorMotion does), so the
      // hand tip reached its grip-line target only through the soft rest pull:
      // measured 3.1 cm fist-to-grip at the guard and up to 4.8 cm mid-swing.
      // Point JUST that tip along its motion target, as actor.ts does. Every
      // other tip (and every other character) keeps the unpinned verlet.
      if (fistTips && f.gun && !f.collapsed && !propReleaseRequested) {
        points = pinTips(points, fistTips.tips, f.bodyYaw, f.restPose, fistTips.only);
      }
      if (f.collapsed) {
        points = applyFloorContact(points, f.floorY);
      }
      bound = {
        ...bound,
        rig: constrainRigBends({ ...bound.rig, points, headFollowsRig: soldierDamage && f.collapsed, restPose: f.restPose, bodyYaw: f.bodyYaw, jawGape: f.jawGape },
          f.collapsed ? f.floorY : undefined),
      };
      for (const kick of f.kicks) {
        const i = joints.index[kick.joint];
        if (i !== undefined) bound = impulseAt(bound, bound.rig.points[i]!.pos, kick.delta);
      }
      // Seat the held prop on the solved hand: the soldier, every gunner, and
      // every MELEE prop (the bride's sword; Task 11). The ogre carries a prop
      // but has no `melee`, so his chainsaw keeps riding the motion target as
      // it always has.
      // prop.fistOnGrip (the bride): the fist is the middle of the solved
      // hand bone (wrist to the pinned tip), where the fist prim sits.
      const fistTipI = joints.index.handTipR;
      const fistPt: Vec3 | null = opts.profile?.prop?.fistOnGrip && f.gun && fistTipI !== undefined && !propReleaseRequested
        ? (() => {
          const w = bound.rig.points[joints.index.handR]!.pos, t = bound.rig.points[fistTipI]!.pos;
          return [(w[0] + t[0]) / 2, (w[1] + t[1]) / 2, (w[2] + t[2]) / 2] as Vec3;
        })()
        : null;
      const gapTo = (g: Vec3 | null) => (fistPt && g
        ? Math.hypot(fistPt[0] - g[0], fistPt[1] - g[1], fistPt[2] - g[2]) : null);
      lastFistGripAuthored = gapTo(f.gun ? gunPoint(f.gun, GUN_GRIP.gripHand) : null);
      if ((soldierDamage || opts.profile?.gunner || (opts.profile?.prop && opts.profile.melee)) && f.gun && !f.collapsed) {
        // Motion authors the grip target before Verlet and bend constraints.
        // Seat the prop on the solved hand without changing its authored
        // wrist rotation (the elbow pole adjustment must not repitch it).
        // Every GUNNER, not only the soldier (the cultist's tommy gun floated
        // off his hand otherwise). The grip seats `gripReach` past the wrist
        // along the forearm, as motion.ts placed it (motion-profile.ts).
        const wrist = bound.rig.points[joints.index.handR]!.pos;
        const elbow = bound.rig.points[joints.index.elbowR]!.pos;
        const reach = opts.profile?.prop?.gripReach ?? 0;
        const fdx = wrist[0] - elbow[0], fdy = wrist[1] - elbow[1], fdz = wrist[2] - elbow[2];
        const fl = Math.hypot(fdx, fdy, fdz) || 1;
        // A fistOnGrip prop seats on the FIST, not on the forearm line: after
        // motion.ts seats the grip it swivels the elbow out (alignElbow), so
        // the solved forearm is no longer the line the grip and the hand bone
        // were laid on. Seating the sword on that line left it 3.1 cm off the
        // fist at the guard and 4.8 cm mid-swing (measured, Task 11).
        const hand: Vec3 = fistPt ?? (reach > 0
          ? [wrist[0] + fdx / fl * reach, wrist[1] + fdy / fl * reach, wrist[2] + fdz / fl * reach]
          : wrist);
        const grip = gunPoint(f.gun, GUN_GRIP.gripHand);
        f.gun = { ...f.gun, root: [
          f.gun.root[0] + hand[0] - grip[0],
          f.gun.root[1] + hand[1] - grip[1],
          f.gun.root[2] + hand[2] - grip[2],
        ] };
      }
      lastFistGrip = gapTo(f.gun ? gunPoint(f.gun, GUN_GRIP.gripHand) : null);
      if (signals.fire && f.gun && !f.collapsed) {
        const fwd = qRotate(f.gun.quat, [0, 0, 1]);
        // The death burst sprays HIGH and wide: up 15-60 deg, +-25 deg yaw.
        const direction = burstShot
          ? rotateYaw(normalize([fwd[0], fwd[1] + Math.tan(0.26 + deathRng() * 0.79), fwd[2]]), (deathRng() - 0.5) * 0.87)
          : rotateYaw(fwd, think.aimError);
        opts.onFire?.({ origin: gunPoint(f.gun, GUN_GRIP.muzzle), direction });
      }
    }
    // Drain the frame's one-shot signals (values are read back by the motion
    // step; arrays are drained in place after the first sub-step above).
    pendingShot = null;
    pendingWounds.length = 0;
    pendingSevered.length = 0;
    // Wound wobble decays — the spike chain's known gap (never advanced
    // ageSec), closed here so craters settle instead of bulging forever.
    if (woundRing.all().length) {
      woundRing.set(woundRing.all().map(w => ({ ...w, ageSec: w.ageSec + dt })));
    }
    posed = applyRig(current, bound, bodyYaw);
    if (headPop && swellDur > 0) {
      swellClock += dt;
      const u = 1 - dyingT / swellDur;
      if (u >= 1) {
        // Pop from the FULLY swollen head, then pose what is left.
        posed = inflateHead(posed, 1, swellClock);
        headPop = false;
        popHead();
        posed = applyRig(current, bound, bodyYaw);
      } else {
        posed = inflateHead(posed, u, swellClock);
      }
    }
    view.update(drawnPose(), current);
    view.setHeadRotation(headQuatOf(bound, bodyYaw) ?? [0, 0, 0, 1]);
    refreshWounds();
    const d = lastFrame;
    if (d) {
      // The decision fields are the MIND's now. holdSecs rides MindDebug so
      // the hold timer's truth lives in exactly one place (see
      // enemy-mind.ts) — an actor-side copy would be the private timer
      // brain.ts's header documents as the original defect.
      const md = mind.debug();
      lastDebug = {
        holdSecs: md.holdSecs,
        knockV,
        phase: d.phase,
        meter: d.meter,
        blend: d.blend,
        speed: d.speed,
        staggerKind: d.staggerKind,
        target: state.wander.target ? [...state.wander.target] as Vec3 : null,
        idle: state.wander.idle,
        state: md.state, alert: md.alert,
        swingT: md.swingT,
        side: md.side, variant: md.variant,
        hasToken: md.hasToken,
        aimT: md.aimT,
        meleeContacts,
        carry: d.carry ?? null,
        fistGrip: lastFistGrip, fistGripAuthored: lastFistGripAuthored,
      };
    }
  }

  /** Ground-plane displacement from crowd separation, clamped exactly like a
   *  wander step: room bounds, then the furniture rejection. Separation must
   *  never be able to push a body into a crate or through a wall. */
  function nudge(dx: number, dz: number) {
    if ((dx === 0 && dz === 0) || state.collapse.phase !== 'standing') return;
    const w = state.wander;
    const next: Vec3 = [
      Math.min(Math.max(w.pos[0] + dx, opts.navigation?.bounds.minX ?? opts.bounds.minX), opts.navigation?.bounds.maxX ?? opts.bounds.maxX),
      0,
      Math.min(Math.max(w.pos[2] + dz, opts.navigation?.bounds.minZ ?? opts.bounds.minZ), opts.navigation?.bounds.maxZ ?? opts.bounds.maxZ),
    ];
    if (opts.navigation && !opts.navigation.canTravel(w.pos,next)) return;
    if (insideFurniture(next)) return;
    state = { ...state, wander: { ...w, pos: next } };
  }

  function hit(hitWorld: Vec3, dirWorld: Vec3, shot?: import('../damage').ShotProvenance): Wound | null {
    // Stamped at the live yaw `posed` was built with — see refreshWounds.
    const field = posed;
    const wound = woundFromPellet(field.prims, hitWorld, bodyYaw, p => sdBody(p, field));
    wound.shot = shot;
    return applyProjectileHit(wound, hitWorld, dirWorld);
  }

  function hitSlug(hitWorld: Vec3, dirWorld: Vec3, shot?: import('../damage').ShotProvenance): Wound | null {
    const field = posed;
    const wound = woundFromSlug(field.prims, hitWorld, p => sdBody(p, field), bodyYaw);
    wound.shot = shot?.weapon === 'slug' ? shot : { weapon: 'slug' };
    return applyProjectileHit(wound, hitWorld, dirWorld);
  }

  function stampBlast(blastWounds: readonly Wound[]): void {
    damageRevision++; bakePaused = false;
    // The caller must have resolved these with this actor's pose().yaw
    // (ExplosionBody.bodyYaw) so they sit in the body frame like every other
    // wound in the ring — see refreshWounds. No stamp-time record: these
    // arrive already resolved against a posed body, with no single impact
    // point to anchor to.
    // This is also the wound-only diagnostic seam. Only the explosion
    // resolver may identify a bundle as damaging explosion provenance.
    for (const w of blastWounds) if (w.shot?.weapon === 'explosion') recordSoldierInjury(w);
    woundRing.stampBundle(blastWounds);
    if (torsoWounds) for (const w of blastWounds) torsoWounds.record(w, current);
    for (const w of blastWounds) pendingWounds.push(w);
    if (blastWounds.length === 0) return;
    posed = applyRig(current, bound, bodyYaw);
    view.update(drawnPose(), current);
    view.setHeadRotation(headQuatOf(bound, bodyYaw) ?? [0, 0, 0, 1]);
    refreshWounds();
  }

  /**
   * A RESOLVED EXPLOSION lands on this body — the dynamite path, and the one
   * place a blast does more than crater geometry.
   *
   * Four things, in this order, and the ORDER IS THE CONTRACT:
   *
   *  1. WOUNDS go into the ring + the carve upload (rendering) exactly as
   *     stampBlast does, including the Soldier injury ledger.
   *  2. THE COLLAPSE METER IS CREDITED WITH `meterCredit` DIRECTLY, and the
   *     wounds are deliberately NOT pushed through `pendingWounds`. That array
   *     is motion's `freshWounds` channel, and stepCollapse weights each entry
   *     by WOUND_PROFILES[type].radius — the PROFILE'S radius, not the
   *     wound's own. A 16-wound blast would therefore debit 16 × 0.13 = 2.08
   *     meter whatever the actual falloff, collapsing a body from a single
   *     grazing edge-of-radius hit. The resolver already scaled each wound by
   *     its own falloff and summed them into meterCredit, so that sum is the
   *     only honest number. (This is the X1.23 wiring contract.)
   *  3. THE REACTION still happens: a blast-class shot signal (flinch +
   *     Soldier stagger) and the zombie's root knock, so the body visibly
   *     takes it even though it is not "wounded" in the meter sense twice.
   *  4. THE SHOVE — one impulse at the nearest surface point — then the sever
   *     tail, which re-derives cuts from the ring the actor now holds. The
   *     resolver's severedLimbs/chainCuts need not be passed: runSeverChecks
   *     is the module that owns that bookkeeping and already reports
   *     detachments through onSever.
   *
   * GIB IS NOT HERE. The caller checks `effect.gibbed` FIRST and runs the gib
   * path instead — the game's single-hit rule (damage ≥ GIB_THRESHOLD skips
   * death and gibs outright), which also means no sever claims are wanted.
   */
  function blast(effect: ActorBlastEffect): void {
    damageRevision++; bakePaused = false;
    const { wounds: blastWounds, meterCredit, impulse } = effect;
    if (softTarget && meterCredit > 0 && !softKilled)
      beginSoftDeath(effect.impulse ? unitOrZero(effect.impulse.vel) : [0, 0, 0], undefined, undefined, 'blast');

    for (const w of blastWounds) if (w.shot?.weapon === 'explosion') recordSoldierInjury(w);
    woundRing.stampBundle(blastWounds);
    if (torsoWounds) for (const w of blastWounds) torsoWounds.record(w, current);

    // (2) The meter, credited directly — see the doc block.
    if (meterCredit > 0 && state.collapse.phase === 'standing') {
      state = {
        ...state,
        collapse: { ...state.collapse, meter: Math.min(1, state.collapse.meter + meterCredit) },
      };
    }

    // (3) The reaction: the same blast-class signal applyProjectileHit raises,
    //     minus the wound stamp it already did for us.
    //
    //     `unitOrZero`, NOT the raw velocity: the signal's direction is scaled by
    //     metre amplitudes downstream, so passing 25.2 m/s here put 8.5 m of
    //     lurch into the chest and neck. See `unitOrZero`'s block.
    const at: Vec3 = impulse ? impulse.at : bodyCentreWorld();
    const dirWorld: Vec3 = impulse ? unitOrZero(impulse.vel) : [0, 0, 0];
    selectPendingShot({
      type: 'blast',
      dirWorld: [...dirWorld] as Vec3,
      woundWorld: [...at] as Vec3,
      torso: true,
      ...(soldierDamage ? { soldierLevel: 'medium' as const } : {}),
      gain: SLUG_GAIN,
    });
    if (soldierDamage) {
      mind.stagger(soldierStaggerDuration('medium'));
    } else {
      const l = Math.hypot(dirWorld[0], dirWorld[2]);
      if (l > 1e-6) {
        knockV = Math.max(knockV, BLAST_KNOCK_MPS);
        knockDir = [dirWorld[0] / l, 0, dirWorld[2] / l];
      }
    }

    // (4) THE PUSH GOES THROUGH THE ROOT — never a rig joint. A joint-level
    //     shove cannot work while `bindRig` PINS a foot: the shoved joint flies
    //     and the pinned one holds, so the body tears. The root moves every joint
    //     together, including the pinned foot. The pose/upload refresh below is
    //     still wanted because the sever tail must see a current pose.
    posed = applyRig(current, bound, bodyYaw);
    view.update(drawnPose(), current);
    view.setHeadRotation(headQuatOf(bound, bodyYaw) ?? [0, 0, 0, 1]);
    refreshWounds();
    if (blastWounds.length > 0) runSeverChecks();
  }

  /** World-space centre of the body's live flesh — the reaction anchor when a
   *  blast arrives with no impulse (e.g. an impulse-free resolver call). */
  function bodyCentreWorld(): Vec3 {
    let x = 0, y = 0, z = 0, n = 0;
    for (const c of current.clusters) {
      if (!c.alive) continue;
      x += c.center[0]; y += c.center[1]; z += c.center[2]; n++;
    }
    if (n === 0) return [0, 1, 0];
    return [x / n, y / n, z / n];
  }

  // ---- burning panic motion signals (Task 2) ------------------------------
  // These are POSE reactions only. They ride `signals.shot`, which stepMotion
  // routes to stagger.ts (lurch / shudder) and the localized recoil — no
  // wound is stamped and `freshWounds` is never touched, so a burn stumble
  // cannot bleed or gib the body.
  /** The burning body's forward (unit), world space. */
  const burnForward = (): Vec3 => headingDir(bodyYaw);
  /**
   * The stumble: a `blast` signal → stagger.ts's directional lurch. For a
   * soldier it is `medium`, not `small`: the periodic flail already keeps a
   * `small` soldier reaction alive, and `stepSoldierStagger` will not restart
   * an equal-level reaction, so a `small` stumble would vanish behind the
   * flail. `medium` ranks up and lands; it is still a lurch (fullStagger is
   * false), never a knockdown.
   */
  function burnStumbleShot(): NonNullable<MotionSignals['shot']> {
    return {
      type: 'blast',
      dirWorld: burnForward(),
      woundWorld: [...bodyCentreWorld()] as Vec3,
      torso: true,
      gain: BURN_BEHAVIOUR.stumbleGain,
      ...(soldierDamage ? { soldierLevel: 'medium' as const } : {}),
    };
  }
  /**
   * The arm-flail stand-in: a `burn` signal → stagger.ts's shudder (and, for
   * a soldier, a `small` soldier arm-open on the same signal). `small` keeps
   * it a wave, not a stagger; motion.ts has no additive arm channel, so this
   * is the seam the plan names as the stand-in.
   */
  function burnFlailShot(): NonNullable<MotionSignals['shot']> {
    return {
      type: 'burn',
      dirWorld: burnForward(),
      woundWorld: [...bodyCentreWorld()] as Vec3,
      torso: true,
      gain: BURN_BEHAVIOUR.flailGain,
      ...(soldierDamage ? { soldierLevel: 'small' as const } : {}),
    };
  }

  /** Shared post-impact choreography: stamp wound, flinch signal, recoil
   *  shove, sever checks, pose + upload refresh. `field`/"posed" snapshot is
   *  the actor's CURRENT posed body at call time. Returns the stamped wound. */
  let hitBatching = false;
  let hitPending = false;
  /** Consecutive firearm trigger pulls, never individual pellets. Retain
   * dedup identities beyond the 1.5s combo window and after a full reaction. */
  function progressiveHit(wound: Wound): boolean {
    if (!soldierDamage || wound.injuryIgnored || wound.type === 'burn' || wound.shot?.weapon === 'explosion') return false;
    const injury = soldierInjury(current, soldierWounds);
    if (soldierFatal || injury.fatal || injury.downed) { shotWindow = []; seenReactionShots.clear(); return false; }
    for (const [id, at] of seenReactionShots) if (reactionTime - at > 3) seenReactionShots.delete(id);
    shotWindow = shotWindow.filter(at => reactionTime - at <= 1.5);
    const source = wound.shot;
    const id = source && 'shotId' in source && source.shotId !== undefined
      ? `shot:${source.shotId}`
      : `diagnostic:${hitBatching ? diagnosticBatchShot : ++diagnosticShotSerial}`;
    if (seenReactionShots.has(id)) return false;
    seenReactionShots.set(id, reactionTime);
    if (seenReactionShots.size > 64) seenReactionShots.delete(seenReactionShots.keys().next().value!);
    shotWindow.push(reactionTime);
    if (shotWindow.length < 3) return false;
    shotWindow = [];
    return true;
  }
  /** Preserve the strongest pending Soldier impact and its source. */
  function selectPendingShot(shot: NonNullable<MotionSignals['shot']>): void {
    const rank = (s: NonNullable<MotionSignals['shot']>) =>
      s.fullStagger ? 3 : s.soldierLevel === 'heavy' ? 2 : s.soldierLevel === 'medium' ? 1 : 0;
    // Keep strength and impact source together until motion consumes them.
    // Zombies retain their existing last-impact selection; a soft target with
    // soldier reactions keeps the strongest too (its volley's first pellet
    // carries the stagger, the rest are plain pellets).
    if (!(soldierDamage || (softTarget && opts.profile?.staggerStyle === 'soldier')) || !pendingShot || rank(shot) > rank(pendingShot)
      || (rank(shot) === rank(pendingShot) && (shot.gain ?? 1) >= (pendingShot.gain ?? 1))) {
      pendingShot = shot;
    }
  }
  /** The expensive post-impact tail; once per unbatched hit or hit batch. */
  function flushHitTail(): void {
    if (soldierDamage && pendingPelletHits >= 4) {
      const soldierLevel = pendingPelletShot?.fullStagger || pendingPelletHits >= 10 ? 'heavy' : 'medium';
      mind.stagger(soldierStaggerDuration(soldierLevel));
      if (pendingPelletShot) selectPendingShot({ ...pendingPelletShot, type: 'blast', soldierLevel, gain: Math.min(1.25, pendingPelletHits / 8) });
    }
    pendingPelletHits = 0;
    pendingPelletShot = null;
    runSeverChecks();
    posed = applyRig(current, bound, bodyYaw);
    view.update(drawnPose(), current);
    view.setHeadRotation(headQuatOf(bound, bodyYaw) ?? [0, 0, 0, 1]);
    refreshWounds();
  }
  function beginHits(): void { hitBatching = true; hitPending = false; diagnosticBatchShot = ++diagnosticShotSerial; }
  function endHits(): void {
    hitBatching = false;
    if (hitPending) { hitPending = false; flushHitTail(); }
  }


  function applyProjectileHit(wound: Wound, hitWorld: Vec3, dirWorld: Vec3): Wound {
    damageRevision++; bakePaused = false;
    const field = posed;
    // stamp() records the pre-impulse position for us — BEFORE the shove
    // below and before flushHitTail re-solves the pose, so it is the
    // placement, uncontaminated by the reaction to it.
    const hitPrim = field.prims[wound.primIdx];
    if (soldierDamage && !soldierFatal && wound.shot?.weapon === 'slug'
      && (hitPrim?.limb === 'armL' || hitPrim?.limb === 'armR')) {
      // The shared .16m slug crater is wider than a forearm. Keep a wound
      // sized to this arm while provenance retains the full slug injury.
      const girth = Math.max(hitPrim.radius, hitPrim.radiusB ?? hitPrim.radius) * Math.min(...hitPrim.scale);
      wound.radius = Math.min(wound.radius, .09, girth * 1.1);
    }
    recordSoldierInjury(wound);
    // SOFT TARGET, second pass (owner 2026-09-24):
    //   * two trigger pulls kill; the first STAGGERS (softStagger);
    //   * a slug to the HEAD from close range pops it at once (Scanners);
    //   * only a CLOSE slug severs (an arm through the sleeve); pellets and far
    //     slugs leave decals and blood, never cuts;
    //   * a hit in the face drops the hood (the death-state swap, early) and
    //     the face carves to the skull like the other enemies'.
    let softReact: Partial<NonNullable<MotionSignals['shot']>> | null = null;
    if (softTarget && wound.type !== 'burn' && !softKilled) {
      const weapon = wound.shot?.weapon === 'slug' ? 'slug' : wound.type === 'blast' ? 'blast' : 'pellet';
      const close = shooterDistance() <= SOFT_TUNING.severRange;
      const head = hitPrim?.limb === 'head';
      if (!(weapon === 'slug' && close)) wound.severRadius = 0;
      if (head && !deathStateApplied && hasDeathState(current)) { deathStateApplied = true; current = applyDeathState(current); }
      if (weapon === 'slug' && close && head) beginSoftDeath(dirWorld, 'head', hitPrim?.bone, 'slug', true);
      else if (newSoftShot(wound)) {
        softHits++;
        if (softHits >= SOFT_TUNING.hitsToKill) beginSoftDeath(dirWorld, hitPrim?.limb, hitPrim?.bone, weapon);
        else softReact = softStagger(weapon);
      }
    }
    // A soft target's robe takes a painted mark, not a crater (damage.ts).
    if (softTarget) clothDecal(field.prims, wound);
    woundRing.stamp(wound, field, bodyYaw);
    torsoWounds?.record(wound, current);
    pendingWounds.push(wound);
    const fullStagger = progressiveHit(wound);
    const shot: NonNullable<MotionSignals['shot']> = {
      ...(softReact ?? {}),
      type: fullStagger ? 'blast' : wound.type,
      dirWorld: [...dirWorld] as Vec3,
      woundWorld: [...hitWorld] as Vec3,
      torso: field.prims[wound.primIdx]?.limb === 'torso',
      ...(soldierDamage ? { soldierLevel: fullStagger ? 'heavy' as const : wound.type === 'blast' ? 'medium' as const : 'small' as const } : {}),
      ...(fullStagger ? { fullStagger: true } : {}),
      // The slug is a hand-cannon round: its lurch + localized recoil play at
      // SLUG_GAIN (above the lab's blast amplitudes — first-person range).
      // Pellets send no gain: eight arrive together and re-flinch at 1.
      ...(wound.type === 'blast' ? { gain: SLUG_GAIN } : {}),
      ...(softReact ?? {}),
    };
    selectPendingShot(shot);
    if (fullStagger) mind.stagger(soldierStaggerDuration('heavy', true));
    if (wound.type === 'pellet') { pendingPelletHits++; pendingPelletShot = shot; }
    if (wound.type === 'blast') {
      // Interrupt immediately. Soldier motion owns severity-scaled recovery
      // travel; Zombies retain the existing actor-level root knock.
      mind.stagger(soldierDamage ? soldierStaggerDuration('medium') : undefined);
      const l = Math.hypot(dirWorld[0], dirWorld[2]);
      if (!soldierDamage && !softTarget && l > 1e-6) {
        knockV = BLAST_KNOCK_MPS;
        knockDir = [dirWorld[0] / l, 0, dirWorld[2] / l];
      }
    }
    // Recoil shove through the rig — the rest-pose pull springs it back.
    // Scaled BY WOUND KIND: a slug stamps a blast-profile wound and must
    // shove like one, not like a single pellet (the defect this task was
    // opened for).
    const push = IMPULSE[wound.type];
    bound = impulseAt(bound, hitWorld, [
      dirWorld[0] * push,
      dirWorld[1] * push,
      dirWorld[2] * push,
    ]);
    // Sever checks BEFORE the pose re-apply so a severed limb is gone from
    // the very next rendered frame.
    if (hitBatching) { hitPending = true; } else { flushHitTail(); }
    return wound;
  }

  return {
    id: opts.id,
    get room() { return actorRoom(); },
    get body() { return current; },
    character: opts.character ?? null,
    view,
    beginHits,
    endHits,
    posed: () => posed,
    drawnBody: () => drawnPose(),
    beginTear: (at: Vec3, falloff: number, plan: RupturePlan) => {
      tear = { at: [...at] as Vec3, falloff, age: 0 };
      tearPlan = plan;
      // Flesh-prim -> region, for the wound upload's rigid carry (refreshWounds).
      tearPrimRegion = new Int32Array(posed.prims.length).fill(-1);
      for (let r = 0; r < plan.pieces.length; r++) {
        for (const i of plan.pieces[r]!.srcPrims ?? []) {
          if (i >= 0 && i < tearPrimRegion.length) tearPrimRegion[i] = r;
        }
      }
      doomed = true;
      // A live body whose procedure skeleton is packed folds it bare while the
      // flesh pulls away (counts2.y, march.wgsl.ts) — the mesh-skeleton path
      // (`setPackBones(false)`, the forward default) draws its bones separately
      // and needs none of this. Harmless when there are no packed bones.
      view.setBonesBare(true);
      // The material ramp starts at 0: the recoil frames are the intact body.
      view.setGoreStrength(0);
    },
    // FALSE THE MOMENT THE WINDOW IS SPENT, and the state itself is left in
    // place until the caller ends it: `tearing()` is the wiring's "gib it now"
    // signal, so it must go false exactly once per window and never flicker
    // back (a flicker would gib the same body twice).
    stepTear: (dt: number) => {
      if (!tear) return;
      tear = { ...tear, age: tear.age + dt };
      // AND THE VIEW IS RE-UPLOADED HERE. The window has to survive a frame the
      // actor did not step — `?frozen=1` skips the whole body block, and the
      // capture rigs run frozen — or a body mid-rupture is (a) never drawn
      // separating and (b) NEVER GIBBED, because the clock that ends its window
      // would never advance. Uploading the same pose twice on a frame the actor
      // DID step is one wasted pack for one body; a body stuck mid-rupture
      // forever is a hole in the world.
      //
      // One frame computed once: the body, the wound carry and the face anchor
      // must all read the SAME transforms, or they disagree by a frame.
      const frame = ruptureFrameNow();
      view.update(frame?.body ?? posed, current);
      // ...and the material ramp rides the SAME clock, so at release the drawn
      // body is already wearing the gore strength the spawned chunks carry and
      // there is no one-frame material switch (see ruptureGore).
      view.setGoreStrength(ruptureGore(ruptureProgress(tear.age, tearTuning.sec)));
      // Wounds ride their rotating region (task 4).
      refreshWounds(frame);
      // THE FACE RIDES THE HEAD REGION. The head is one region; its displayed
      // orientation is composed over the rig's own head quat, so the projection
      // frame turns with the skull instead of staying pinned to the clean pose.
      // The CENTRE is handled by the per-frame `headShape(a.drawnBody())` in the
      // draw loop.
      if (frame && tearPlan) {
        const hi = tearPlan.pieces.findIndex(p => p.limb === 'head');
        const hq = hi >= 0 ? frame.quats[hi] : undefined;
        if (hq && !(hq[0] === 0 && hq[1] === 0 && hq[2] === 0 && hq[3] === 1)) {
          const base = headQuatOf(bound, bodyYaw) ?? [0, 0, 0, 1];
          view.setHeadRotation(qMul(hq, base));
        }
      }
    },
    tearing: () => tear !== null && tear.age < tearTuning.sec,
    tearAge: () => tear?.age ?? 0,
    tearFrame: ruptureFrameNow,
    endTear: () => {
      tear = null; tearPlan = null; tearPrimRegion = null; doomed = false;
      // Restore the ordinary packed-bone layout for a body returned to play
      // (a reset mid-window). A retired body keeps its view hidden either way.
      view.setBonesBare(false);
      // ...and drop the material ramp: a reset mid-window returns the body to
      // ordinary play, so it must not keep the gore it was tearing into.
      view.setGoreStrength(0);
    },
    setTearTuning: (t: Partial<TearTuning>) => { tearTuning = { ...tearTuning, ...t }; },
    motionFrame: () => lastFrame,
    sinceFire: () => state.sinceFire,
    boundRig: () => bound,
    pose: () => ({ pos: [...state.wander.pos] as Vec3, yaw: bodyYaw }),
    nudge,
    setEncounterOrder: (order: EncounterOrder) => { encounterOrder = order; },
    setBrainInput: (p: BrainPlayer | null, alerted: boolean) => {
      brainPlayer = p;
      // Sticky until a step consumes it: the shot may land between frames.
      if (alerted) brainAlerted = true;
    },
    setBurning: (on: boolean) => {
      // Edge-triggered: game-burning only calls this on transitions, but a
      // repeated call must not re-seed the panic (that would reset the RNG
      // and restart every stumble/repick clock).
      if (on === (burnPanic !== null)) return;
      // Soldier panic is switched off for now (BURN_BEHAVIOUR.soldierPanic):
      // a burning soldier keeps his mind, speed and gun, with no stumbles.
      if (on && mind.kind === 'soldier' && !BURN_BEHAVIOUR.soldierPanic) return;
      if (on) {
        // The id seed keeps two bodies lit on the same frame out of phase.
        burnPanic = createBurnPanic(opts.id * 7919 + 1);
        burnFlailT = 0;
        burnStumbles = 0;
      } else {
        burnPanic = null;
        burnCruiseScale = 1;
      }
    },
    burnStumbles: () => burnStumbles,
    mind: () => mind,
    kind: mind.kind,
    meleeCapable: () => !doomed && (soldierDamage ? missingLimbs().armR : mind.meleeCapable),
    setRingInput: (hasToken: boolean, drift: -1 | 0 | 1) => {
      ringToken = hasToken;
      ringDrift = drift;
    },
    forceSwing: (phase: number, side: 'L' | 'R', variant: SwingVariant) => {
      forcedSwing = { phase, side, variant };
    },
    engagedForCrowd: () => !doomed && lastEngaged,
    committed: () => !doomed && lastCommitted,
    step,
    corpseBakeEligible: () => soldierDamage && state.collapse.phase === 'settled',
    refineEligible: () => state.collapse.phase === 'standing',
    damageRevision: () => damageRevision,
    injuryHistorySize: () => soldierWounds.length,
    pauseForBake: (paused: boolean) => { bakePaused = paused; },
    wounds: () => woundRing.all(),
    visualWounds: () => torsoWounds?.visual(posed) ?? (soldierDamage ? soldierVisualWounds(woundRing.all()) : woundRing.all()),
    advanceWoundPreview,
    stampWorldOf: (w: Wound) => woundRing.stampWorldOf(w),
    debug: () => lastDebug ?? {
      holdSecs: mind.debug().holdSecs, knockV, phase: 'standing', meter: 0,
      blend: 0, speed: 0,
      staggerKind: null, target: null, idle: 0,
      state: mind.debug().state, alert: mind.debug().alert,
      swingT: mind.debug().swingT,
      side: mind.debug().side, variant: mind.debug().variant,
      hasToken: mind.debug().hasToken,
      aimT: mind.debug().aimT,
      meleeContacts,
      carry: null, fistGrip: null, fistGripAuthored: null,
    },
    hit,
    hitSlug,
    stampBlast,
    refreshWoundUpload: () => refreshWounds(),
    /** DEBUG SEAM (decap repro): sever `limb` exactly as a shot would.
     *  `at` = 'full' → severLimb (whole cluster); a number n → severDistal
     *  from the n-th prim of the limb's chain (0 = root; for the head,
     *  1 leaves the neck on the body — the headshot-stump case). */
    profileName: () => opts.profile?.name ?? 'zombie',
    debugSever: (limb: LimbId, at: 'full' | number = 'full') => {
      const cluster = current.clusters.find(c => c.limb === limb);
      if (!cluster?.alive) return false;
      if (at === 'full') detach(limb, severLimb(current, limb));
      else {
        const order = chainOrder(current, cluster);
        const fromPrim = order[Math.max(0, Math.min(at, order.length - 1))];
        if (fromPrim === undefined) return false;
        detach(limb, severDistal(current, { limb, fromPrim }));
      }
      refreshWounds();
      return true;
    },
    blast,
  };
}
