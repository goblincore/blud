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
import type { MissingLimbs } from '../collapse';
import type { ZombieGpuView } from './zombie-gpu';
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

/** Heavy-hit walk stop: after a blast-profile hit the zombie HALTS for this
 *  long (the lurch plays on a stopped walker — a stagger that never
 *  interrupts locomotion reads weightless), then resumes its wander. */
const BLAST_HOLD_SEC = 0.55;

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

  let lastDebug: ReturnType<ZombieActor['debug']> | null = null;
  let lastFrame: ReturnType<typeof stepMotion>['frame'] | null = null;

  // Heavy-hit choreography state (blast-profile hits — the slug). A stagger
  // that never interrupts locomotion reads weightless: after a blast hit the
  // zombie HALTS for BLAST_HOLD_SEC (the lurch plays on a stopped walker;
  // MotionConfig.wander=false fades the stride out and it resumes after),
  // while its ROOT is knocked back along the shot's ground-plane direction
  // from BLAST_KNOCK_MPS, decaying exponentially at BLAST_KNOCK_DECAY/s
  // (total travel ≈ v0/k). Actor-owned on purpose: MotionConfig.wander and a
  // wander.pos delta already express both, so the shared motion modules and
  // the lab's wiring — which must stay bit-identical — are untouched.
  let holdSecs = 0;
  let knockV = 0;
  let knockDir: Vec3 = [0, 0, 0];

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
    if (wounds.length === 0 || typeof opts.view.setWounds !== 'function') return;
    opts.view.setWounds(
      wounds.map(w => woundWorldPos(posed.prims, w, bodyYaw)),
      wounds.map(w => w.radius),
      wounds.map(w => TYPE_ID[w.type]),
      wounds.map(w => w.ageSec),
      wounds.map(w => WOUND_PROFILES[w.type].rimSplayScale * (w.rimScale ?? 1)),
      wounds.map(w => WOUND_PROFILES[w.type].rimOffsetScale),
      wounds.map(w => {
        const n = woundCarveNormal(posed.prims, w, bodyYaw);
        return n ? { n, depth: w.carveDepth ?? 0 } : null;
      }),
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
      wounds = pushWound(wounds, r.stumpWound, MAX_WOUNDS);
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
      // Heavy-hit choreography (see the state block): knock the ROOT before
      // the motion step so this sub-step's targets ride the moved root, and
      // gate the wander off while the hold lasts. Bounds-clamped like
      // stepWander's own integration, so a knock cannot shove the body
      // through a room wall.
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
      holdSecs = Math.max(0, holdSecs - sdt);
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
        { enabled: true, wander: holdSecs <= 0 },
        signals,
        bound.rig.points, opts.bounds, rng,
      );
      state = stepR.state;
      lastFrame = stepR.frame;
      const f = stepR.frame;
      // Furniture rejection: restore the position, drop the target. The
      // heading stays, so the body turns as it picks the next target.
      if (insideFurniture(state.wander.pos)) {
        state = { ...state, wander: { ...state.wander, pos: prevPos, target: null, idle: 0.2 } };
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
    if (wounds.length) {
      wounds = wounds.map(w => ({ ...w, ageSec: w.ageSec + dt }));
    }
    posed = applyRig(current, bound, bodyYaw);
    view.update(posed, current);
    view.setHeadRotation(headQuatOf(bound, bodyYaw) ?? [0, 0, 0, 1]);
    refreshWounds();
    const d = lastFrame;
    if (d) lastDebug = {
      holdSecs,
      knockV,
      phase: d.phase,
      meter: d.meter,
      blend: d.blend,
      speed: d.speed,
      staggerKind: d.staggerKind,
      target: state.wander.target ? [...state.wander.target] as Vec3 : null,
      idle: state.wander.idle,
    };
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
    for (const w of blastWounds) {
      // The caller must have resolved these with this actor's pose().yaw
      // (ExplosionBody.bodyYaw) so they sit in the body frame like every
      // other wound in the ring — see refreshWounds.
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
   *  the actor's CURRENT posed body at call time. Returns the stamped wound. */
  function applyProjectileHit(wound: Wound, hitWorld: Vec3, dirWorld: Vec3): Wound {
    const field = posed;
    wounds = pushWound(wounds, wound, MAX_WOUNDS);
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
      // Heavy-hit choreography: stop the walk, knock the ROOT back.
      holdSecs = BLAST_HOLD_SEC;
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
    runSeverChecks();
    posed = applyRig(current, bound, bodyYaw);
    view.update(posed, current);
    view.setHeadRotation(headQuatOf(bound, bodyYaw) ?? [0, 0, 0, 1]);
    refreshWounds();
    return wound;
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
    debug: () => lastDebug ?? {
      holdSecs, knockV, phase: 'standing', meter: 0, blend: 0, speed: 0,
      staggerKind: null, target: null, idle: 0,
    },
    hit,
    hitSlug,
    stampBlast,
  };
}
