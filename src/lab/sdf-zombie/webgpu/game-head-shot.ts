// src/lab/sdf-zombie/webgpu/game-head-shot.ts
//
// THE HEAD-SHOT LEAF: what a gun round does to a zombie's head besides an ordinary wound (head-burst.ts headShotRule): a centred slug splits the head or pops a split one.
//
// The projectile loop (game-tick.ts) asks hit() for every round that lands on an actor, before it stamps the
// round's ordinary wound. This leaf owns no state of its own but the last verdict per actor (the gates' readout):
// the rule is pure (head-burst.ts headShotRule), and each outcome belongs to a leaf or the actor that already has it.
//
//   ordinary   hit() answers false and the caller stamps the round's own wound (ZombieActor.hit / hitSlug). Every
//              pellet, an off-centre slug, a round that is not on head flesh (the neck's base is the torso's), any
//              character but the plain zombie, a head that is popping, everything with burstTuning.on off.
//   split      THE SLUG SPLIT. The head opens through the head split leaf (game-head-split.ts open), exactly as the
//              axe's chop opens it, straight to burstTuning.splitOpen of the preset's angle. The split's plane holds
//              the shot's direction and the head's up axis: a slug from the front parts the head left and right
//              (the 'middle' preset), one from the side takes the face (head-split.ts choosePreset decides, from
//              the plane's normal and where the slug landed). The split's cut faces are the slug's wound: they are
//              blasted with a slug's shove and a slug's share of the collapse meter, and they bleed as the axe's
//              do. The zombie lives. If the split refuses after all (the body is tearing apart), the round is
//              ordinary.
//   pop        A centred slug on a head that is ALREADY split open: the head swells and bursts
//              (ZombieActor.beginHeadPop; the burst itself is the actor's onHeadPop, game-spawn.ts). The other way
//              to a pop is not this leaf's: an ordinary slug wound that cuts the head off pops it through the
//              actor's onDecapitate (head-burst.ts decapitationRule).
//   opening    The slug head burst of 2026-10-02 (game-head-damage.ts burst), only while burstTuning.opening is on.
//              Not the shipped behaviour.
//
// THE ORDERS. An earlier ordinary wound on the head, a pellet's or an off-centre slug's, leaves no state in any
// leaf, so a later centred slug still splits. A head the flail has damaged (the head damage leaf holds its regions
// and deform, measured on the closed head) is refused by the split, here and for the axe: a centred slug on it is
// an ordinary slug wound, and can still take the head off and pop it. A split head takes pellets and off-centre
// slugs as ordinary wounds on its un-warped flesh (damage.ts unwarpHit); the next centred slug pops it.
import type { GameContext } from './game-context';
import type { ZombieActor } from './game-actor';
import type { BuildResult } from '../build-body';
import type { Vec3 } from '../types';
import { WOUND_PROFILES, unwarpHit, type ShotProvenance, type Wound } from '../damage';
import { COLLAPSE_TUNING } from '../collapse';
import { headQuatOf } from '../rig-bind';
import { rotate, type HeadFrame, type Quat } from '../head-deform';
import { BURST, burstTuning, classifyBurst, headShotRule, hsOf, onHeadPrim, type HeadShotRule } from '../head-burst';
import type { HeadSplitLeaf } from './game-head-split';
import { headAlive } from './flame-anchors';

export interface HeadShotDeps {
  /** game-main's headShape: the head frame's centre and half-axes on a posed body. */
  headShape(b: BuildResult): { centre: Vec3; axes: Vec3 } | null;
  /** The head split leaf: the slug opens the head through it, and it says whether a head is open. */
  split: Pick<HeadSplitLeaf, 'open' | 'isOpen'>;
  /** The head damage leaf holds state for this head (game-head-damage.ts has): the split would refuse it. */
  headDamaged(a: ZombieActor): boolean;
  /** The burst opening (game-head-damage.ts burst); false when it declined the round. */
  opening(a: ZombieActor, point: Vec3, dir: Vec3, shot: ShotProvenance | undefined, kind: 'pellet' | 'slug'): boolean;
  /** Blood for one of the split's cut faces (registerCutBleed, as the axe's). */
  bleed(a: ZombieActor, w: Wound, point: Vec3, dir: Vec3): void;
}

/** The last round this leaf judged on an actor's head. `took`: the leaf consumed it (false: the caller stamped its
 *  ordinary wound, which is every 'ordinary' verdict and a split or an opening that was refused). */
export interface HeadShotDebug { rule: HeadShotRule; kind: 'pellet' | 'slug'; offset: number; took: boolean }

export interface HeadShotLeaf {
  /** One gun round on an actor at `point` (world, on the posed surface), travelling along `dir` (world, unit). True
   *  when the leaf took the round: the caller then stamps nothing. */
  hit(a: ZombieActor, point: Vec3, dir: Vec3, shot?: ShotProvenance, kind?: 'pellet' | 'slug'): boolean;
  /** The last verdict on actor `id`'s head (null: no round has been judged on it). */
  last(id: number): HeadShotDebug | null;
  /** Forget every verdict (a cast rebuild / level reset). */
  reset(): void;
}

const IDENTITY: Quat = [0, 0, 0, 1];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** THE SLUG'S SPLIT PLANE: its unit normal (world), for a shot along `dir` at a head whose frame is `quat`. The plane
 *  holds the shot and the head's up axis, so its normal is their cross product; a shot straight down the up axis has
 *  no such plane, and parts the head left and right (the head's own x). */
export function slugSplitNormal(dir: Vec3, quat: Quat): Vec3 {
  const n = cross(dir, rotate(quat, [0, 1, 0]));
  const l = Math.hypot(n[0], n[1], n[2]);
  return l > 1e-4 ? [n[0] / l, n[1] / l, n[2] / l] : rotate(quat, [1, 0, 0]);
}

export function createHeadShot(_ctx: GameContext, deps: HeadShotDeps): HeadShotLeaf {
  const verdicts = new WeakMap<ZombieActor, HeadShotDebug>();
  const byId = new Map<number, ZombieActor>();

  /** Open the head along the slug's plane; the faces are the slug's wound. False when the split refused. */
  function split(a: ZombieActor, point: Vec3, dir: Vec3, frame: HeadFrame, shot: ShotProvenance | undefined): boolean {
    const faces = deps.split.open(a, slugSplitNormal(dir, frame.quat), point, burstTuning.splitOpen);
    if (!faces) return false;
    for (const w of faces) w.shot = shot?.weapon === 'slug' ? shot : { weapon: 'slug' };
    a.blast({
      wounds: faces, meterCredit: WOUND_PROFILES.blast.radius * COLLAPSE_TUNING.meterRadiusWeight, reaction: 'blast',
      impulse: { at: point, vel: [dir[0] * BURST.shove, dir[1] * BURST.shove, dir[2] * BURST.shove] },
    });
    for (const w of faces) deps.bleed(a, w, point, dir);
    return true;
  }

  return {
    hit(a, point, dir, shot, kind = 'slug') {
      if (!burstTuning.on || a.profileName() !== 'zombie') return false;
      const posed = a.posed();
      if (!headAlive(posed) || a.headPopping()) return false;
      // A split head's prims are the closed head's: the hit is judged where it lands on them.
      const at = unwarpHit(posed, point).hit;
      if (!onHeadPrim(posed.prims, at)) return false;
      const shape = deps.headShape(posed);
      if (!shape) return false;
      const frame: HeadFrame = { centre: shape.centre, axes: shape.axes, quat: (headQuatOf(a.boundRig(), a.pose().yaw) as Quat | null) ?? IDENTITY };
      const hs = hsOf(frame, at);
      if (Math.hypot(hs[0], hs[1], hs[2]) > BURST.maxHs) return false;   // the neck or a shoulder
      const offset = classifyBurst({ point, dir }, frame).offset;
      const rule = headShotRule({ kind, offset, splitOpen: deps.split.isOpen(a), splitRefused: deps.headDamaged(a) });
      const took = rule === 'split' ? split(a, point, dir, frame, shot)
        : rule === 'pop' ? a.beginHeadPop(dir, burstTuning.popSwellS)
          : rule === 'opening' ? deps.opening(a, point, dir, shot, kind)
            : false;
      verdicts.set(a, { rule, kind, offset, took });
      byId.set(a.id, a);
      // Visible in the browser console while the rules are being tuned.
      if (rule !== 'ordinary' && rule !== 'opening') console.info(`[head-shot] actor ${a.id} ${kind}: ${rule}${took ? '' : ' (refused)'} (line ${offset.toFixed(2)} head radii off centre)`);
      return took;
    },
    last(id) {
      const a = byId.get(id);
      return a ? verdicts.get(a) ?? null : null;
    },
    reset() { byId.clear(); },
  };
}
