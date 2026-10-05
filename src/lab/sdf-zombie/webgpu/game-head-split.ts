// src/lab/sdf-zombie/webgpu/game-head-split.ts
//
// THE HEAD SPLIT LEAF (spec docs/superpowers/specs/2026-10-04-axe-and-head-split-design.md §4-§5). The axe hands its
// head chops here (game-axe.ts → deps.split): chop 1 opens the head, later chops widen it, and a chop on a head
// already split wide kicks it. head-split.ts decides everything (the preset from the chop, the spring, the
// world-space SplitWarp, the cut faces' segments); this leaf only owns each actor's SplitState, steps its spring once
// a frame and installs the actor's split hook (ZombieActor.setHeadSplit), which gives the split for every re-pose.
//
// THE POSE IS THE ONE SOURCE OF THE SPLIT. The hook's answer rides `posed().split` and nothing else keeps a copy:
// sdBody (every strike, shot and trace) reads it there, and so does the renderer, from the body the actor hands its
// view (`view.update(drawnPose(), …)`, i.e. `a.drawnBody().split`).
//
// THE TICK RUNS BEFORE THE ACTORS STEP (game-main tick), so the step's re-pose asks the hook with this frame's angle:
// a stepping actor's pose does not lag the spring. A FROZEN actor (?frozen=1, the gates) never steps; the tick
// re-poses it itself whenever an angle moved.
//
// THE WOBBLE (head-split.ts HEAD_SPLIT.wobble): the halves swing with the body. Its drive is the acceleration of the
// split's mass point (splitMassPoint), by finite differences of where the POSE has it (pointAccel). The tick comes
// before the step, so the pose it reads is the last step's: tick N differences the point at steps N-1, N-2 and N-3,
// an acceleration centred on step N-2, two frames (33 ms) behind the pose that will draw this tick's angles.
// Secondary motion trails its body anyway. A frozen actor's point does not move: no drive, and its halves come to
// rest at exactly the spring's angle. A pose with no split (the head gone, the body tearing) forgets the motion.
//
// THE CUT FACES. Opening stamps one cut per opened half along the plane (head-split.ts splitFaceSegs → cut-wound.ts
// stampCut, on the closed head, where wounds live), tagged headSlot 'keep' so they outlive the wound ring's cap, and
// headRegion 'split+' / 'split-' so a re-stamp replaces its own face. They are the only head-kept wounds a split head
// has (at most 2 of damage.ts MAX_HEAD_WOUNDS): the other users of those slots are head damage's craters, which a
// split head never has (below). open() hands them to the caller to blast with its chop (one blast, one re-pose);
// force() blasts them itself.
//
// NO SPLIT, in three cases the hook answers null for:
//   * the head is gone (its cluster is not alive: severed, popped);
//   * the body is tearing apart (the rupture window, gib-tear.ts): the split describes the clean pose in world space
//     and must not ride onto the displaced regions. The actor also closes its own pose when the window begins, so the
//     tear's first frame is already closed;
//   * the state is closed.
// The state itself stays (a split stays open on the corpse) until the actor leaves ctx.world.actors, or reset().
//
// THE SPLIT AND HEAD DAMAGE DO NOT MIX (game-head-damage.ts: its regions, trackers and deform are measured on the
// closed head). open() refuses a head that leaf holds state for (deps.headDamaged), and that leaf declines a head
// this one has open (isOpen). Only the plain zombie has presets (the slug burst's rule too).
//
// AT RANGE the view writes the split closed (head-split.ts splitDrawDistance), measured from the eye the frame is
// drawn with: the draw stage hands it over (drawEye, game-main), and the leaf passes it to the view of each actor it
// holds a split for. An actor it drops gets its eye taken back. Drawing only; the pose, and so every strike and
// trace, keeps the split.
//
// The per-actor state lives in this module (keyed by the actor object), never on main(). Deterministic: sim time only.
import type { GameContext } from './game-context';
import type { ZombieActor } from './game-actor';
import type { BuildResult } from '../build-body';
import type { Vec3 } from '../types';
import type { Wound } from '../damage';
import { sdBodyClosed } from '../validate';
import { stampCut } from '../cut-wound';
import { headQuatOf } from '../rig-bind';
import {
  HEAD_SPLIT, forcedSplit, headFrameOf, headLocalDir, headLocalPoint, makePointMotion, openSplit, pointAccel, punchSplit,
  splitFaceSegs, splitMassPoint, splitWarpOf, stepSplit, widenSplit, wobbleDrive,
  type HeadFrame, type PointMotion, type SplitPresetId, type SplitState, type SplitWarp,
} from '../head-split';
import { headAlive, headShape } from './flame-anchors';

export interface HeadSplitDeps {
  /** The head damage leaf holds state for this head (game-head-damage.ts has): open() and force() refuse it. Absent:
   *  never. */
  headDamaged?(a: ZombieActor): boolean;
}

export interface HeadSplitLeaf {
  /** Chop 1: choose the preset from the chop (the blade plane's normal and the impact, world) and spring open toward
   *  `frac` of its max. Returns the cut faces, stamped but NOT yet in the wound ring: the caller blasts them with its
   *  chop. Null when it refused (already open, not the plain zombie, no live head, tearing, or a head the head-damage
   *  leaf holds): the caller then keeps its own cut. */
  open(a: ZombieActor, bladeNormalW: Vec3, impactW: Vec3, frac: number): readonly Wound[] | null;
  /** Later chops: spring on to `frac` of the preset's max (the preset stays; the target never drops), and kick the
   *  halves `kick` of the preset's max past where that leaves them (head-split.ts punchSplit; 0 = no kick). Returns
   *  the cut faces (to bleed again), or null when the head is not open. */
  widen(a: ZombieActor, frac: number, kick?: number): readonly Wound[] | null;
  /** The actor's head has an open split state (from the opening chop on, before the spring has moved). */
  isOpen(a: ZombieActor): boolean;
  tick(dt: number): void;
  /** The eye this frame is drawn with (world), for every actor with a split state: its view draws the split out to
   *  a distance from it (zombie-gpu.ts setSplitEye). Called from the draw stage, where the render camera is final. */
  drawEye(eye: Vec3): void;
  /** A copy of the actor's state, or null when it has none. */
  state(id: number): SplitState | null;
  /** Tuning / gate seam: set actor `id`'s split by hand, at `angleFrac` of the preset's max at once (no spring), and
   *  stamp and blast its faces. `offset` is head-local metres along the plane normal. `angleFrac` <= 0 closes it (the
   *  faces stay in the ring). False for an unknown id, arguments that are not a split (head-split.ts forcedSplit), or
   *  a head open() would refuse. */
  force(id: number, preset: SplitPresetId, sides: -1 | 0 | 1, offset: number, angleFrac: number): boolean;
  /** Drop every actor's state and hook (a cast rebuild / level reset). */
  reset(): void;
}

interface ActorSplit {
  st: SplitState;
  faces: readonly Wound[];
  /** The mass point's motion (head-split.ts pointAccel), and the last tick's time step: the one the pose this tick
   *  reads was stepped with. */
  motion: PointMotion;
  dt: number;
}

/** The rupture window is running, or spent and not yet ended (the actor is about to be gibbed). */
const tearing = (a: ZombieActor): boolean => a.tearing() || a.tearAge() > 0;

export function createHeadSplit(ctx: GameContext, deps: HeadSplitDeps = {}): HeadSplitLeaf {
  const heads = new Map<ZombieActor, ActorSplit>();

  /** The head's frame on a body posed by `a`'s rig (the prims are the closed head's, split or not), and the skull's
   *  half-width, which the preset's offsets are shares of. */
  function skullOf(a: ZombieActor, b: BuildResult): { frame: HeadFrame; halfWidth: number } | null {
    const s = headShape(b);
    if (!s) return null;
    return { frame: headFrameOf(s, headQuatOf(a.boundRig(), a.pose().yaw) ?? [0, 0, 0, 1]), halfWidth: s.axes[0] };
  }

  const canSplit = (a: ZombieActor): boolean =>
    a.profileName() === 'zombie' && headAlive(a.posed()) && !tearing(a) && !deps.headDamaged?.(a);

  /** The split hook: asked by the actor at every re-pose, with the un-split pose. */
  function hook(a: ZombieActor, h: ActorSplit, p: BuildResult): SplitWarp | null {
    const sk = h.st.preset !== null && headAlive(p) && !tearing(a) ? skullOf(a, p) : null;
    return sk ? splitWarpOf(h.st, sk.frame) : null;
  }

  /** Give `a` the state `st` (with its hook, on first use) and its cut faces: one cut per opened half, stamped on the
   *  closed head. They are not in the wound ring until someone blasts them. */
  function begin(a: ZombieActor, st: SplitState, frame: HeadFrame): readonly Wound[] {
    let h = heads.get(a);
    if (!h) {
      h = { st, faces: [], motion: makePointMotion(), dt: 0 };
      heads.set(a, h);
      const rec = h;
      a.setHeadSplit(p => hook(a, rec, p));
    }
    h.st = st;
    const posed = a.posed(), yaw = a.pose().yaw;
    h.faces = splitFaceSegs(st, frame).map((seg) => {
      const w = stampCut(posed.prims, seg, HEAD_SPLIT.faceCalibre, yaw, q => sdBodyClosed(q, posed));
      w.headSlot = 'keep';
      w.headRegion = seg.side > 0 ? 'split+' : 'split-';
      return w;
    });
    return h.faces;
  }

  /** The hulls follow the pose's split (shell-hull-outer.ts, occluder-hull.ts), and while the cast is frozen they are
   *  built once per frozen stretch (game-main): a split that changes on a frozen actor asks for that build again.
   *  Unfrozen play rebuilds them every tick. */
  const hullsStale = (): void => { ctx.render.frozenHullBuilt = false; };

  function drop(a: ZombieActor): void {
    a.setHeadSplit(null);
    a.view.setSplitEye(null);
    heads.delete(a);
  }

  return {
    open(a, bladeNormalW, impactW, frac) {
      if (heads.has(a) || !canSplit(a)) return null;
      const sk = skullOf(a, a.posed());
      if (!sk) return null;
      const st = openSplit(headLocalDir(sk.frame, bladeNormalW), headLocalPoint(sk.frame, impactW), sk.halfWidth, frac);
      return begin(a, st, sk.frame);
    },
    widen(a, frac, kick = 0) {
      const h = heads.get(a);
      if (!h) return null;
      h.st = punchSplit(widenSplit(h.st, frac), kick);
      return h.faces;
    },
    isOpen: a => heads.has(a),
    drawEye(eye) {
      for (const a of heads.keys()) a.view.setSplitEye(eye);
    },
    tick(dt) {
      for (const [a, h] of heads) {
        if (!ctx.world.actors.includes(a)) { drop(a); continue; }
        // A tick of no time (a gate syncing its camera) steps nothing and has no pose of its own: it takes no sample,
        // and the last step's time stands for the tick that follows.
        const was = h.st, w = a.posed().split ?? null;
        const s = dt > 0 ? pointAccel(h.motion, w ? splitMassPoint(w) : null, h.dt) : null;
        if (s) { h.motion = s.motion; h.dt = dt; }
        h.st = stepSplit(was, dt, s && w ? wobbleDrive(w, s.acc) : null);
        // A FROZEN actor never steps, and the step is where the hook is asked: without this its posed and drawn head
        // would keep the angles of the last hit's re-pose (game-head-damage.ts tick's rule). Not while it tears: the
        // rupture window re-uploads the body itself, with its wounds carried.
        const moved = h.st.angle !== was.angle || h.st.wobP !== was.wobP || h.st.wobM !== was.wobM;
        if (ctx.demo.wanderFrozen && moved && !tearing(a)) { a.reposeHead(); hullsStale(); }
      }
    },
    state(id) {
      for (const [a, h] of heads) if (a.id === id) return { ...h.st };
      return null;
    },
    force(id, preset, sides, offset, angleFrac) {
      const a = ctx.world.actors.find(x => x.id === id);
      const st = forcedSplit(preset, sides, offset, angleFrac);
      if (!a || !st) return false;
      if (st.preset === null) {
        if (heads.has(a)) { drop(a); a.reposeHead(); hullsStale(); }
        return true;
      }
      if (!canSplit(a)) return false;
      const sk = skullOf(a, a.posed());
      if (!sk) return false;
      // No reaction of its own; the blast re-poses the actor, so the forced split shows at once.
      a.blast({ wounds: begin(a, st, sk.frame), meterCredit: 0, impulse: null, reaction: 'none' });
      hullsStale();
      return true;
    },
    reset() {
      for (const a of heads.keys()) drop(a);
    },
  };
}
