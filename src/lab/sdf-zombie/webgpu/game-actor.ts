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
import { stepRig } from '../rig';
import { relaxRopeConstraints } from '../collapse';
import {
  MAX_WOUNDS, pushWound, WOUND_PROFILES, woundCarveWorldPos,
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
import type { MissingLimbs } from '../collapse';
import type { ZombieGpuView } from './zombie-gpu';
import type { Aabb } from './game-level';

/** Signals for an undamaged wanderer — every frame, verbatim. */
const CALM: Omit<MotionSignals, 'dt'> = {
  shot: null,
  wounded: { armL: false, armR: false, legL: false, legR: false },
  severed: [],
  missing: { legL: false, legR: false, armL: false, armR: false },
  headAlive: true,
  forcedCollapse: false,
  freshWounds: [],
};

/** Wound-type ids the shader expects — same mapping as lab-main's TYPE_ID. */
const TYPE_ID: Record<WoundType, number> = { pellet: 0, blast: 1, burn: 2 };

/** Hit shove along the shot direction, scaled up from the lab's 0.04/0.16
 *  pair because a pellet is small but arrives eight at a time. */
const PELLET_IMPULSE = 0.05;

/** A detached piece, placed in WORLD space where the rendered limb hung.
 *  game-main turns this into a ballistic chunk + SDF view. */
export interface DetachedPiece {
  limb: LimbId;
  origin: Vec3;
  prims: Primitive[];
  tornAt: Vec3[];
}

/** How far outside a furniture AABB a wanderer's centre must stay. */
const FURNITURE_MARGIN = 0.55;

export interface ZombieActor {
  readonly id: number;
  readonly room: number;
  /** The LIVE body — severing replaces it (alive flags move). */
  readonly body: BuildResult;
  readonly view: ZombieGpuView;
  /** Latest POSED body (world space) — what projectiles will raycast. */
  readonly posed: () => BuildResult;
  readonly boundRig: () => BoundRig;
  /** Current ground position + facing. */
  readonly pose: () => { pos: Vec3; yaw: number };
  step(dt: number): void;
  /** Live wound ring (for HUD/debug). */
  wounds: () => readonly Wound[];
  /**
   * One pellet lands at `hitWorld`, travelling along `dirWorld`.
   * Stamps a wound through damage.ts, shoves the rig, then runs the existing
   * sever checks; any detachment is reported through `onSever` as world-space
   * piece data. Safe to call while the wander is frozen — the pose refresh is
   * done here, not left to the next step().
   */
  hit(hitWorld: Vec3, dirWorld: Vec3): void;
  /**
   * A SLUG (one big projectile) lands at `hitWorld`: same choreography as
   * hit() but stamps the slug calibre crater. Separate method on purpose —
   * nothing about the pellet path may drift while it is under diagnosis.
   */
  hitSlug(hitWorld: Vec3, dirWorld: Vec3): void;
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
  start: Vec3;
  seed: number;
  bounds: WanderBounds;
  furniture: readonly Aabb[];
  /** Receives every detached piece, already placed in world space. */
  onSever?: (piece: DetachedPiece) => void;
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
  // `current` is the LIVE body — severLimb/severDistal hand back a new
  // BuildResult with alive flags moved (prims are never removed/reordered).
  let current = body;
  let posed = body;
  let bodyYaw = 0;

  // ---- damage state -------------------------------------------------------
  let wounds: Wound[] = [];
  const pendingWounds: Wound[] = [];
  const pendingSevered: LimbId[] = [];
  let pendingShot: MotionSignals['shot'] = null;

  function woundedLimbs() {
    const w = { armL: false, armR: false, legL: false, legR: false };
    for (const wound of wounds) {
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

  /** Carve-centre upload — same contract as lab-main's uploadWounds.
   *  Skipped entirely while there are no wounds (the common case), and
   *  tolerant of stub views without the method.
   *  YAW 0, ALWAYS: the game page stamps wounds on APPLYRIG OUTPUT, whose
   *  prim axes are already world space. frame() would rotate the basis a
   *  SECOND time by bodyYaw, and connectivity.ts resolves carve spheres at
   *  yaw 0 — any other value displaces every carve sphere by the whole walk
   *  yaw and silently disarms severing (measured: worst neck-section sample
   *  stuck at 0.084 m > the 0.055 m sphere radius no matter how many pellets
   *  landed). Stamp/upload/resolve must agree on ONE frame; here that is
   *  posed-prims-at-yaw-0. */
  function refreshWounds() {
    if (wounds.length === 0 || typeof opts.view.setWounds !== 'function') return;
    opts.view.setWounds(
      wounds.map(w => woundCarveWorldPos(posed.prims, w, 0)),
      wounds.map(w => w.radius),
      wounds.map(w => TYPE_ID[w.type]),
      wounds.map(w => w.ageSec),
      wounds.map(w => WOUND_PROFILES[w.type].rimSplayScale * (w.rimScale ?? 1)),
      wounds.map(w => WOUND_PROFILES[w.type].rimOffsetScale),
    );
  }

  /** Re-binds after a body edit, carrying live rig points across (bones are
   *  unchanged by severing — only alive flags move). Lab-main's rebind(). */
  function rebind() {
    const keep = bound.rig.points;
    let next = bindRig(current);
    if (keep.length === next.rig.points.length) {
      next = {
        ...next,
        rig: { ...next.rig, points: keep.map(p => ({ ...p, pinned: false })) },
      };
    }
    bound = next;
  }

  function detach(limb: LimbId, r: { body: BuildResult; chunk: { prims: Primitive[]; origin: Vec3; tornAt: Vec3[] }; stumpWound: Wound | null }) {
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
      wounds = pushWound(wounds, r.stumpWound, MAX_WOUNDS);
      pendingWounds.push(r.stumpWound);
    }
    pendingSevered.push(limb);
    rebind();
    opts.onSever?.({
      limb,
      origin: applyRigidYaw(t, r.chunk.origin),
      prims: r.chunk.prims.map(p => ({ ...p, a: applyRigidYaw(t, p.a), b: applyRigidYaw(t, p.b) })),
      tornAt: r.chunk.tornAt.map(v => applyRigidYaw(t, v)),
    });
  }

  function runSeverChecks() {
    const torsoC = current.clusters.find(c => c.limb === 'torso')?.center ?? [0, 1.1, 0] as Vec3;
    const fullCuts = cutLimbs(current, wounds, torsoC);
    for (const limb of fullCuts) {
      detach(limb, severLimb(current, limb));
    }
    for (const cut of cutChains(current, wounds)) {
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
    for (const sdt of planSubSteps(dt)) {
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
      const prevPos: Vec3 = [...state.wander.pos] as Vec3;
      const stepR = stepMotion(
        state, joints,
        { enabled: true, wander: true },
        signals,
        bound.rig.points, opts.bounds, rng,
      );
      state = stepR.state;
      const f = stepR.frame;
      // Furniture rejection: restore the position, drop the target. The
      // heading stays, so the body turns as it picks the next target.
      if (insideFurniture(state.wander.pos)) {
        state = { ...state, wander: { ...state.wander, pos: prevPos, target: null, idle: 0.2 } };
      }
      bodyYaw = f.bodyYaw;
      view.setRootShift(f.rootShift[0], f.rootShift[2], f.bodyYaw);
      let points = stepRig(
        { ...bound.rig, restPose: f.restPose }, sdt,
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
        rig: { points, constraints: bound.rig.constraints, restPose: f.restPose },
      };
    }
    // Drain the frame's one-shot signals (values are read back by the motion
    // step; arrays are drained in place after the first sub-step above).
    pendingShot = null;
    pendingWounds.length = 0;
    pendingSevered.length = 0;
    // Wound wobble decays — the spike chain's known gap (never advanced
    // ageSec), closed here so craters settle instead of bulging forever.
    if (wounds.length) {
      wounds = wounds.map(w => ({ ...w, ageSec: w.ageSec + dt }));
    }
    posed = applyRig(current, bound, bodyYaw);
    view.update(posed, current);
    view.setHeadRotation(headQuatOf(bound, bodyYaw) ?? [0, 0, 0, 1]);
    refreshWounds();
  }

  function hit(hitWorld: Vec3, dirWorld: Vec3): void {
    // Yaw 0 — see refreshWounds: posed prims are already world space.
    const field = posed;
    applyProjectileHit(woundFromPellet(field.prims, hitWorld, 0, p => sdBody(p, field)), hitWorld, dirWorld);
  }

  function hitSlug(hitWorld: Vec3, dirWorld: Vec3): void {
    const field = posed;
    applyProjectileHit(woundFromSlug(field.prims, hitWorld, p => sdBody(p, field)), hitWorld, dirWorld);
  }

  function stampBlast(blastWounds: readonly Wound[]): void {
    for (const w of blastWounds) {
      // Yaw 0 — resolveExplosion stamped these in posed-prims-at-yaw-0 space,
      // the same single frame every other stamper here uses.
      wounds = pushWound(wounds, w, MAX_WOUNDS);
      pendingWounds.push(w);
    }
    if (blastWounds.length === 0) return;
    posed = applyRig(current, bound, bodyYaw);
    view.update(posed, current);
    view.setHeadRotation(headQuatOf(bound, bodyYaw) ?? [0, 0, 0, 1]);
    refreshWounds();
  }

  /** Shared post-impact choreography: stamp wound, flinch signal, recoil
   *  shove, sever checks, pose + upload refresh. `field`/"posed" snapshot is
   *  the actor's CURRENT posed body at call time. */
  function applyProjectileHit(wound: Wound, hitWorld: Vec3, dirWorld: Vec3): void {
    const field = posed;
    wounds = pushWound(wounds, wound, MAX_WOUNDS);
    pendingWounds.push(wound);
    pendingShot = {
      type: 'pellet',
      dirWorld: [...dirWorld] as Vec3,
      woundWorld: [...hitWorld] as Vec3,
      torso: field.prims[wound.primIdx]?.limb === 'torso',
    };
    // Recoil shove through the rig — the rest-pose pull springs it back.
    bound = impulseAt(bound, hitWorld, [
      dirWorld[0] * PELLET_IMPULSE,
      dirWorld[1] * PELLET_IMPULSE,
      dirWorld[2] * PELLET_IMPULSE,
    ]);
    // Sever checks BEFORE the pose re-apply so a severed limb is gone from
    // the very next rendered frame.
    runSeverChecks();
    posed = applyRig(current, bound, bodyYaw);
    view.update(posed, current);
    view.setHeadRotation(headQuatOf(bound, bodyYaw) ?? [0, 0, 0, 1]);
    refreshWounds();
  }

  return {
    id: opts.id,
    room: opts.room,
    get body() { return current; },
    view,
    posed: () => posed,
    boundRig: () => bound,
    pose: () => ({ pos: [...state.wander.pos] as Vec3, yaw: bodyYaw }),
    step,
    wounds: () => wounds,
    hit,
    hitSlug,
    stampBlast,
  };
}
