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
import { bindRig, applyRig, headQuatOf, impulseAt, type BoundRig } from '../rig-bind';
import { constrainRigBends, stepRig } from '../rig';
import { relaxRopeConstraints } from '../collapse';
import {
  MAX_WOUNDS, pushWound, WOUND_PROFILES, woundCarveNormal, woundWorldPos,
  type Wound, type WoundType,
} from '../damage';
import { severLimb, severDistal } from '../sever';
import { cutLimbs, cutChains } from '../connectivity';
import { sdBody } from '../validate';
import type { LimbId, Primitive, Vec3 } from '../types';
import {
  applyRigidYaw, fitRestToPose, woundFromPellet, woundFromSlug,
} from './game-weapon';
import {
  makeMotionJoints, makeMotionState, stepMotion, planSubSteps,
  applyFloorContact, MOTION_TUNING, STANDING_RIG,
  type MotionJoints, type MotionState, type MotionSignals,
} from '../motion';
import { makeRng, type Rng, type WanderBounds } from '../wander';
import type { BrainPlayer } from '../brain';
import { makeZombieMind, type EnemyMind } from './enemy-mind';
import type { MotionProfile } from '../motion-profile';
import type { MotionFrame } from '../motion';
import type { SwingVariant } from '../attack';
import type { MissingLimbs } from '../collapse';
import type { ZombieGpuView } from './zombie-gpu';
import { createWoundRing, type CharacterView } from './character-view';
import type { Aabb } from './game-level';

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

/** Heavy-hit root knockback: initial ground-plane speed (m/s) along the
 *  shot's horizontal direction — the body's ROOT actually travels back
 *  (a real stumble, not just a joint offsets), decaying at BLAST_KNOCK_DECAY
 *  per second. ∫ v0·e^(−kt) ≈ v0/k metres of total travel. */
const BLAST_KNOCK_MPS = 1.2;
const BLAST_KNOCK_DECAY = 7;

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
  readonly room: number;
  /** The LIVE body — severing replaces it (alive flags move). */
  readonly body: BuildResult;
  /** THE BODY it belongs to, when the caller supplied one. Null for the
   *  test and spike call sites that build from a bare body + view. */
  readonly character: CharacterView | null;
  readonly view: ZombieGpuView;
  /** Latest POSED body (world space) — what projectiles will raycast. */
  readonly posed: () => BuildResult;
  readonly boundRig: () => BoundRig;
  /** Current ground position + facing. */
  readonly pose: () => { pos: Vec3; yaw: number };
  /** Ground-plane shove from crowd separation (crowd.ts), bounds- and
   *  furniture-clamped. */
  nudge(dx: number, dz: number): void;
  /** The per-frame brain input from game-main: where the player is (null when
   *  he is in a tunnel or the void) and whether a shot just went off in this
   *  actor's room. Set BEFORE step(). */
  setBrainInput(player: BrainPlayer | null, alerted: boolean): void;
  /** The decision layer — callers that must distinguish kinds, and the
   *  source of truth for every decision field this interface reports. */
  mind(): EnemyMind;
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
  hit(hitWorld: Vec3, dirWorld: Vec3): Wound | null;
  /**
   * A SLUG (one big projectile) lands at `hitWorld`: same choreography as
   * hit() but stamps the slug calibre crater. Separate method on purpose —
   * nothing about the pellet path may drift while it is under diagnosis.
   * Returns the stamped wound — see hit().
   */
  hitSlug(hitWorld: Vec3, dirWorld: Vec3): Wound | null;
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
}

export function createZombieActor(opts: {
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
  onFire?: () => void;
  /** Receives every detached piece, already placed in world space, plus the
   *  stump wound the sever stamped on the REMAINING body (null when no live
   *  anchor existed) — the bleed emitters register from it directly. */
  onSever?: (piece: DetachedPiece, stumpWound: Wound | null) => void;
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
  let bodyYaw = 0;

  // ---- damage state -------------------------------------------------------
  /** THE shared wound ring (character-view.ts). The character's own when the
   *  caller supplied one, otherwise a private one from the same factory — so
   *  the eight test call sites and hull-spike-main, which build actors from a
   *  bare body and view, run the SAME ring implementation the game does.
   *  One implementation, whoever owns it: the drift this refactor exists to
   *  kill came from two hand-written copies of the same sequence. */
  const woundRing = opts.character?.wounds ?? createWoundRing();
  const pendingWounds: Wound[] = [];
  const pendingSevered: LimbId[] = [];
  let pendingShot: MotionSignals['shot'] = null;

  let lastDebug: ReturnType<ZombieActor['debug']> | null = null;
  let lastFrame: ReturnType<typeof stepMotion>['frame'] | null = null;

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
    const gone = (l: LimbId) => !(current.clusters.find(c => c.limb === l)?.alive ?? false);
    return { legL: gone('legL'), legR: gone('legR'), armL: gone('armL'), armR: gone('armR') };
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
  function refreshWounds() {
    // The upload lives on the ring now (character-view.ts), so the lab and the
    // game push identical carve rows — including the depth-slab normals the
    // lab had ZERO references to before this. The pose is ours to supply: the
    // ring owns the wound DATA, the caller owns the rig it is stamped against.
    woundRing.refresh(view, posed, bodyYaw);
  }

  /** Re-binds after a body edit, carrying live rig points across (bones are
   *  unchanged by severing — only alive flags move). Lab-main's rebind(). */
  function rebind() {
    const keep = bound.rig.points;
    let next = bindRig(current);
    if (keep.length === next.rig.points.length) {
      next = {
        ...next,
        rig: { ...next.rig, bodyYaw, points: keep.map(p => ({ ...p, pinned: false })) },
      };
    }
    bound = next;
  }

  function detach(limb: LimbId, r: { body: BuildResult; chunk: { prims: Primitive[]; bones: Primitive[]; origin: Vec3; tornAt: Vec3[] }; stumpWound: Wound | null }) {
    if (r.chunk.prims.length === 0) return;
    // Place the piece where the RENDERED limb hangs: fit rest→posed over the
    // chunk prims' own endpoint pairs (identity-matched against the pre-sever
    // layout), then apply that centroid+yaw transform to the piece.
    const idxOf = new Map<Primitive, number>();
    posed.prims.forEach((p, i) => idxOf.set(body.prims[i]!, i));
    const restPts: Vec3[] = [];
    const posedPts: Vec3[] = [];
    for (const cp of r.chunk.prims) {
      const i = idxOf.get(cp);
      if (i === undefined) continue;
      const pp = posed.prims[i];
      if (!pp) continue;
      restPts.push(cp.a, cp.b);
      posedPts.push(pp.a, pp.b);
    }
    const t = fitRestToPose(restPts, posedPts);
    current = r.body;
    if (r.stumpWound) {
      woundRing.stamp(r.stumpWound, posed, bodyYaw);
      pendingWounds.push(r.stumpWound);
    }
    pendingSevered.push(limb);
    rebind();
    opts.onSever?.({
      limb,
      origin: applyRigidYaw(t, r.chunk.origin),
      prims: r.chunk.prims.map(p => ({ ...p, a: applyRigidYaw(t, p.a), b: applyRigidYaw(t, p.b) })),
      // Bones take the IDENTICAL rest -> posed transform as the flesh. Giving
      // them anything else (or nothing) leaves the stub at rest pose while the
      // limb it belongs to is posed — the same defect translate.ts had.
      bones: r.chunk.bones.map(p => ({ ...p, a: applyRigidYaw(t, p.a), b: applyRigidYaw(t, p.b) })),
      tornAt: r.chunk.tornAt.map(v => applyRigidYaw(t, v)),
    }, r.stumpWound);
  }

  function runSeverChecks() {
    const torsoC = current.clusters.find(c => c.limb === 'torso')?.center ?? [0, 1.1, 0] as Vec3;
    const fullCuts = cutLimbs(current, [...woundRing.all()], torsoC);
    for (const limb of fullCuts) {
      detach(limb, severLimb(current, limb));
    }
    for (const cut of cutChains(current, [...woundRing.all()])) {
      if (fullCuts.includes(cut.limb)) continue;
      detach(cut.limb, severDistal(current, cut));
    }
  }

  function insideFurniture(p: Vec3): boolean {
    for (const f of opts.furniture) {
      if (p[0] > f.min[0] - FURNITURE_MARGIN && p[0] < f.max[0] + FURNITURE_MARGIN
        && p[2] > f.min[2] - FURNITURE_MARGIN && p[2] < f.max[2] + FURNITURE_MARGIN) return true;
    }
    return false;
  }

  function step(dt: number) {
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
              Math.min(Math.max(nx, opts.bounds.minX), opts.bounds.maxX),
              0,
              Math.min(Math.max(nz, opts.bounds.minZ), opts.bounds.maxZ),
            ],
          },
        };
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
        : { ...CALM, dt: sdt };
      firstSub = false;
      // Decide before locomotion integrates, so the target this sub-step walks
      // toward is this sub-step's target.
      const think = mind.step({
        dt: sdt,
        self: {
          x: state.wander.pos[0], z: state.wander.pos[2],
          yaw: bodyYaw, room: opts.room,
        },
        player: brainPlayer,
        alerted: brainAlerted,
        hasToken: ringToken,
        drift: ringDrift,
        roll: swingRng(),
        rollDrift: swingRng(),
      });
      brainAlerted = false;   // one-shot: the first sub-step consumes it
      lastEngaged = think.engaged;
      lastCommitted = think.committed;
      // FACE LOCK. A halted body cannot otherwise turn: stepWander owns
      // wander.heading and is skipped when cfg.wander is false, so an aiming
      // soldier would track nothing and shoot wherever he last faced.
      // Writing the bearing straight into heading lets the EXISTING damped,
      // rate-limited bodyYaw follow do the turn — no new constant, and no
      // second turn implementation. (brain.ts: one walker, one turn rate.)
      if (think.faceHeading !== null) {
        state = { ...state, wander: { ...state.wander, heading: think.faceHeading } };
      }
      if (think.fire) opts.onFire?.();
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
        if (firstBlockingBox(state.wander.pos, goal, opts.furniture)) {
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
      const stepR = stepMotion(
        state, joints,
        {
          enabled: true,
          wander: !think.halt,
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
        bound.rig.points, opts.bounds, rng,
      );
      state = stepR.state;
      lastFrame = stepR.frame;
      const f = stepR.frame;
      // Furniture rejection. A step that lands inside a fattened box is
      // pushed back out along its shallowest axis (pushOutOfFurniture), so
      // the tangential component of the step survives and a body pressing a
      // face SLIDES along it — the chase router's committed-side arc needs
      // that slide to get round a corner; a full restore would cancel it and
      // the body would press the same spot forever. A plain wanderer (no
      // brain target) additionally drops its target and pauses: the next leg
      // starts somewhere else, the designed unstick.
      if (insideFurniture(state.wander.pos)) {
        let w = {
          ...state.wander,
          pos: pushOutOfFurniture(state.wander.pos, opts.furniture),
        };
        if (!think.target) {
          w = { ...w, target: null, idle: 0.2 };
        }
        state = { ...state, wander: w };
      }
      bodyYaw = f.bodyYaw;
      view.setRootShift(f.rootShift[0], f.rootShift[2], f.bodyYaw);
      let points = stepRig(
        { ...bound.rig, restPose: f.restPose, bodyYaw: f.bodyYaw }, sdt,
        {
          gravity: f.gravity,
          damping: 0.06,
          iterations: 4,
          restStiffness: STANDING_RIG.restStiffness * f.restPull,
        },
      ).points;
      if (f.ropes.length) points = relaxRopeConstraints(points, f.ropes);
      if (f.collapsed) {
        points = applyFloorContact(points, joints.groundY - MOTION_TUNING.floorPad);
      }
      bound = {
        ...bound,
        rig: constrainRigBends({ ...bound.rig, points, restPose: f.restPose, bodyYaw: f.bodyYaw },
          f.collapsed ? joints.groundY - MOTION_TUNING.floorPad : undefined),
      };
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
    view.update(posed, current);
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
      };
    }
  }

  /** Ground-plane displacement from crowd separation, clamped exactly like a
   *  wander step: room bounds, then the furniture rejection. Separation must
   *  never be able to push a body into a crate or through a wall. */
  function nudge(dx: number, dz: number) {
    if (dx === 0 && dz === 0) return;
    const w = state.wander;
    const next: Vec3 = [
      Math.min(Math.max(w.pos[0] + dx, opts.bounds.minX), opts.bounds.maxX),
      0,
      Math.min(Math.max(w.pos[2] + dz, opts.bounds.minZ), opts.bounds.maxZ),
    ];
    if (insideFurniture(next)) return;
    state = { ...state, wander: { ...w, pos: next } };
  }

  function hit(hitWorld: Vec3, dirWorld: Vec3): Wound | null {
    // Stamped at the live yaw `posed` was built with — see refreshWounds.
    const field = posed;
    return applyProjectileHit(woundFromPellet(field.prims, hitWorld, bodyYaw, p => sdBody(p, field)), hitWorld, dirWorld);
  }

  function hitSlug(hitWorld: Vec3, dirWorld: Vec3): Wound | null {
    const field = posed;
    return applyProjectileHit(woundFromSlug(field.prims, hitWorld, p => sdBody(p, field), bodyYaw), hitWorld, dirWorld);
  }

  function stampBlast(blastWounds: readonly Wound[]): void {
    // The caller must have resolved these with this actor's pose().yaw
    // (ExplosionBody.bodyYaw) so they sit in the body frame like every other
    // wound in the ring — see refreshWounds. No stamp-time record: these
    // arrive already resolved against a posed body, with no single impact
    // point to anchor to.
    woundRing.stampBundle(blastWounds);
    for (const w of blastWounds) pendingWounds.push(w);
    if (blastWounds.length === 0) return;
    posed = applyRig(current, bound, bodyYaw);
    view.update(posed, current);
    view.setHeadRotation(headQuatOf(bound, bodyYaw) ?? [0, 0, 0, 1]);
    refreshWounds();
  }

  /** Shared post-impact choreography: stamp wound, flinch signal, recoil
   *  shove, sever checks, pose + upload refresh. `field`/"posed" snapshot is
   *  the actor's CURRENT posed body at call time. Returns the stamped wound. */
  let hitBatching = false;
  let hitPending = false;
  /** The expensive post-impact tail; once per pellet unbatched, once per
   *  batch inside beginHits/endHits. */
  function flushHitTail(): void {
    runSeverChecks();
    posed = applyRig(current, bound, bodyYaw);
    view.update(posed, current);
    view.setHeadRotation(headQuatOf(bound, bodyYaw) ?? [0, 0, 0, 1]);
    refreshWounds();
  }
  function beginHits(): void { hitBatching = true; hitPending = false; }
  function endHits(): void {
    hitBatching = false;
    if (hitPending) { hitPending = false; flushHitTail(); }
  }


  function applyProjectileHit(wound: Wound, hitWorld: Vec3, dirWorld: Vec3): Wound {
    const field = posed;
    // stamp() records the pre-impulse position for us — BEFORE the shove
    // below and before flushHitTail re-solves the pose, so it is the
    // placement, uncontaminated by the reaction to it.
    woundRing.stamp(wound, field, bodyYaw);
    pendingWounds.push(wound);
    pendingShot = {
      type: wound.type,
      dirWorld: [...dirWorld] as Vec3,
      woundWorld: [...hitWorld] as Vec3,
      torso: field.prims[wound.primIdx]?.limb === 'torso',
      // The slug is a hand-cannon round: its lurch + localized recoil play at
      // SLUG_GAIN (above the lab's blast amplitudes — first-person range).
      // Pellets send no gain: eight arrive together and re-flinch at 1.
      ...(wound.type === 'blast' ? { gain: SLUG_GAIN } : {}),
    };
    if (wound.type === 'blast') {
      // Heavy-hit choreography: the mind's stagger stops the walk for
      // blastHoldSec. The ROOT knock stays here — moving the root is a
      // different thing from gating locomotion. Lurch on the frame the slug
      // lands, not the next one — see brain.ts's staggerNow for what the
      // one-step deferral cost.
      mind.stagger();
      const l = Math.hypot(dirWorld[0], dirWorld[2]);
      if (l > 1e-6) {
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
    room: opts.room,
    get body() { return current; },
    character: opts.character ?? null,
    view,
    beginHits,
    endHits,
    posed: () => posed,
    motionFrame: () => lastFrame,
    sinceFire: () => state.sinceFire,
    boundRig: () => bound,
    pose: () => ({ pos: [...state.wander.pos] as Vec3, yaw: bodyYaw }),
    nudge,
    setBrainInput: (p: BrainPlayer | null, alerted: boolean) => {
      brainPlayer = p;
      // Sticky until a step consumes it: the shot may land between frames.
      if (alerted) brainAlerted = true;
    },
    mind: () => mind,
    setRingInput: (hasToken: boolean, drift: -1 | 0 | 1) => {
      ringToken = hasToken;
      ringDrift = drift;
    },
    forceSwing: (phase: number, side: 'L' | 'R', variant: SwingVariant) => {
      forcedSwing = { phase, side, variant };
    },
    engagedForCrowd: () => lastEngaged,
    committed: () => lastCommitted,
    step,
    wounds: () => woundRing.all(),
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
    },
    hit,
    hitSlug,
    stampBlast,
  };
}
