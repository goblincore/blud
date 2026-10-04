// src/lab/sdf-zombie/webgpu/game-head-split.ts
//
// THE HEAD SPLIT LEAF (spec docs/superpowers/specs/2026-10-04-axe-and-head-split-design.md §4-§5). The axe hands its
// head chops here (game-axe.ts → deps.split): chop 1 opens the head, later chops widen it, the kill chop throws it
// fully open. head-split.ts decides everything (the preset from the chop, the spring, the world-space SplitWarp, the
// cut faces' segments); this leaf only owns each actor's SplitState, steps its spring once a frame and installs the
// actor's split hook (ZombieActor.setHeadSplit), which gives the split for every re-pose. From there it rides
// `posed().split`: sdBody, and so every strike, shot and trace, sees the opened halves.
//
// THE CUT FACES. Opening stamps one cut per opened half along the plane (head-split.ts splitFaceSegs → cut-wound.ts
// stampCut, on the closed head, where wounds live), tagged headSlot 'keep' so they outlive the wound ring's cap, and
// headRegion 'split+' / 'split-' so a re-stamp replaces its own face. They take 2 of damage.ts MAX_HEAD_WOUNDS (8);
// the other users of those slots are head damage's craters, which a split head never has (below).
//
// NO SPLIT, in three cases the hook answers null for:
//   * the head is gone (its cluster is not alive: severed, popped);
//   * the body is tearing apart (the rupture window, gib-tear.ts): the split describes the clean pose in world space
//     and must not ride onto the displaced regions. The actor also closes its own pose when the window begins;
//   * the state is closed.
// The state itself stays (a split stays open on the corpse) until the actor leaves ctx.world.actors, forget() or
// reset().
//
// THE SPLIT AND HEAD DAMAGE DO NOT MIX (game-head-damage.ts: its regions, trackers and deform are measured on the
// closed head). open() refuses a head that leaf holds state for (deps.headDamaged), and that leaf declines a head
// this one has open (isOpen). Only the plain zombie has presets (the slug burst's rule too).
//
// The per-actor state lives in this module (keyed by the actor object), never on main(). Deterministic: sim time only.
import type { GameContext } from './game-context';
import type { ZombieActor } from './game-actor';
import type { BuildResult } from '../build-body';
import type { Vec3 } from '../types';
import type { Wound } from '../damage';
import { sdBody } from '../validate';
import { stampCut } from '../cut-wound';
import { headQuatOf } from '../rig-bind';
import {
  HEAD_SPLIT, forcedSplit, headFrameOf, headLocalDir, headLocalPoint, openSplit, splitFaceSegs, splitWarpOf, stepSplit,
  widenSplit,
  type HeadFrame, type SplitPresetId, type SplitState, type SplitWarp,
} from '../head-split';
import { headShape } from './flame-anchors';
import { AXE_HEAD } from './axe-head';

export interface HeadSplitDeps {
  /** The head damage leaf holds state for this head (game-head-damage.ts has): open() and force() refuse it. Absent:
   *  never. */
  headDamaged?(a: ZombieActor): boolean;
}

export interface HeadSplitLeaf {
  /** Chop 1: choose the preset from the chop (the blade plane's normal and the impact, world) and spring open toward
   *  `frac` of its max (default AXE_HEAD.openAngles[0]); stamps the cut faces. Returns them, or null when it refused
   *  (already open, not the plain zombie, no live head, tearing, or a head the head-damage leaf holds): the caller
   *  then keeps its own cut. */
  open(a: ZombieActor, bladeNormalW: Vec3, impactW: Vec3, frac?: number): readonly Wound[] | null;
  /** Later chops: spring on to `frac` of the preset's max (the preset stays; the target never drops). Returns the cut
   *  faces, or null when the head is not open. */
  widen(a: ZombieActor, frac: number): readonly Wound[] | null;
  /** The actor's head has an open split state (from the opening chop on, before the spring has moved). */
  isOpen(a: ZombieActor): boolean;
  /** The split the actor's LAST re-pose used, in world space (null: closed, or none to carry): the same object as
   *  `a.posed().split`. For the renderer. */
  warp(a: ZombieActor): SplitWarp | null;
  tick(dt: number): void;
  /** A copy of the actor's state, or null when it has none. */
  state(id: number): SplitState | null;
  /** Tuning / gate seam: set actor `id`'s split by hand, at `angleFrac` of the preset's max at once (no spring), and
   *  stamp its faces. `offset` is head-local metres along the plane normal. `angleFrac` <= 0 closes it (the faces
   *  stay in the ring). False for an unknown id or a head open() would refuse. */
  force(id: number, preset: SplitPresetId, sides: -1 | 0 | 1, offset: number, angleFrac: number): boolean;
  /** Drop an actor's state and its hook. */
  forget(id: number): void;
  /** Drop every actor's state (a cast rebuild / level reset). */
  reset(): void;
}

interface ActorSplit {
  st: SplitState;
  /** What the hook answered at the last re-pose. */
  warp: SplitWarp | null;
  faces: readonly Wound[];
}

const headAlive = (b: BuildResult): boolean => b.clusters.some(c => c.limb === 'head' && c.alive);
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
    h.warp = sk ? splitWarpOf(h.st, sk.frame) : null;
    return h.warp;
  }

  /** One cut per opened half, stamped on the closed head and blasted into the ring with no reaction of its own (the
   *  chop's blast carries the flinch). The blast re-poses the actor, so a forced split shows at once. */
  function stampFaces(a: ZombieActor, st: SplitState, frame: HeadFrame): Wound[] {
    const posed = a.posed(), yaw = a.pose().yaw;
    const closed = posed.split ? { ...posed, split: null } : posed;
    const field = (q: Vec3) => sdBody(q, closed);
    const faces = splitFaceSegs(st, frame).map((seg) => {
      const w = stampCut(posed.prims, seg, HEAD_SPLIT.faceCalibre, yaw, field);
      w.headSlot = 'keep';
      w.headRegion = seg.side > 0 ? 'split+' : 'split-';
      return w;
    });
    a.blast({ wounds: faces, meterCredit: 0, impulse: null, reaction: 'none' });
    return faces;
  }

  /** Give `a` the state `st` (with its hook, on first use) and stamp its faces. */
  function begin(a: ZombieActor, st: SplitState, frame: HeadFrame): readonly Wound[] {
    let h = heads.get(a);
    if (!h) {
      h = { st, warp: null, faces: [] };
      heads.set(a, h);
      const rec = h;
      a.setHeadSplit(p => hook(a, rec, p));
    }
    h.st = st;
    h.faces = stampFaces(a, st, frame);
    return h.faces;
  }

  function drop(a: ZombieActor): void {
    a.setHeadSplit(null);
    heads.delete(a);
  }

  return {
    open(a, bladeNormalW, impactW, frac = AXE_HEAD.openAngles[0]) {
      if (heads.has(a) || !canSplit(a)) return null;
      const sk = skullOf(a, a.posed());
      if (!sk) return null;
      const st = openSplit(headLocalDir(sk.frame, bladeNormalW), headLocalPoint(sk.frame, impactW), sk.halfWidth, frac);
      return begin(a, st, sk.frame);
    },
    widen(a, frac) {
      const h = heads.get(a);
      if (!h) return null;
      h.st = widenSplit(h.st, frac);
      return h.faces;
    },
    isOpen: a => heads.has(a),
    warp: a => heads.get(a)?.warp ?? null,
    tick(dt) {
      for (const [a, h] of heads) {
        if (!ctx.world.actors.includes(a)) { drop(a); continue; }
        const angle = h.st.angle;
        h.st = stepSplit(h.st, dt);
        if (tearing(a) || !headAlive(a.posed())) { h.warp = null; continue; }
        // A FROZEN actor (?frozen=1, the gates) never steps, and the step is where the hook is asked: without this its
        // posed and drawn head would keep the angle of the last hit's re-pose (game-head-damage.ts tick's rule).
        if (ctx.demo.wanderFrozen && h.st.angle !== angle) a.reposeHead();
      }
    },
    state(id) {
      for (const [a, h] of heads) if (a.id === id) return { ...h.st };
      return null;
    },
    force(id, preset, sides, offset, angleFrac) {
      const a = ctx.world.actors.find(x => x.id === id);
      if (!a) return false;
      const st = forcedSplit(preset, sides, offset, angleFrac);
      if (st.preset === null) {
        if (heads.has(a)) { drop(a); a.reposeHead(); }
        return true;
      }
      if (!canSplit(a)) return false;
      const sk = skullOf(a, a.posed());
      if (!sk) return false;
      begin(a, st, sk.frame);
      return true;
    },
    forget(id) {
      for (const a of heads.keys()) if (a.id === id) drop(a);
    },
    reset() {
      for (const a of heads.keys()) drop(a);
    },
  };
}
