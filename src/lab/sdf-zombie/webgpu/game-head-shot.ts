// src/lab/sdf-zombie/webgpu/game-head-shot.ts
//
// THE HEAD-SHOT LEAF: what a gun round does to a zombie's head besides an ordinary wound (head-burst.ts headShotRule): a precise slug from close to medium range splits the head, and a slug from that range pops a split one.
//
// The projectile loop (game-tick.ts) asks hit() for every round that lands on an actor, before it stamps the
// round's ordinary wound, and before the round reaches the skull's own hit path (the bone renderer's impact, which
// ejects the eyes near a hit and breaks the plate under it): a round this leaf takes does neither. This leaf owns no
// state of its own but the last verdict per actor (the gates' readout): the rule is pure (head-burst.ts
// headShotRule), and each outcome belongs to a leaf or the actor that already has it.
//
// PRECISE AND IN RANGE are read from the slug's provenance: the eye and the crosshair's ray as the gun fired
// (damage.ts ShotAim; game-weapon-rig.ts launchSlug records them). The slug is precise when that ray passes within
// burstTuning.splitFrac head radii of the head's centre, and in range when the head is within
// burstTuning.splitRangeM of that eye. Where the slug itself lands does not decide it, so long as it stopped in the
// head's own flesh (head-burst.ts onHeadPrim: the head limb's prims, the neck's included): it leaves from the muzzle
// and lands about 10 cm under the crosshair, on the chin or under it. The older measure (burstTuning.splitAim
// 'slug') is the slug's own line, and keeps the reach it always had: a landing point past BURST.maxHs of the head's
// ellipsoid is the neck's or a shoulder's, and is not judged.
//
// ONLY THE ZOMBIE: the character (ZombieActor.characterName), not the motion profile. Every character without a
// profile of its own moves on the zombie's, and none of them has the split's presets or the pop.
//
//   ordinary   hit() answers false and the caller stamps the round's own wound (ZombieActor.hit / hitSlug). Every
//              pellet, an imprecise slug, a slug from too far, a round that is not on head flesh (the neck's base
//              is the torso's), any character but the zombie, a head that is popping, everything with
//              burstTuning.on off.
//   split      THE SLUG SPLIT. The head opens through the head split leaf (game-head-split.ts open), exactly as the
//              axe's chop opens it, straight to burstTuning.splitOpen of the preset's angle. The split's plane holds
//              the shot's direction and the head's up axis: a slug from the front parts the head left and right
//              (the 'middle' preset), one from the side takes the face (head-split.ts choosePreset decides, from
//              the plane's normal and the point this leaf hands it). That point is on the head's middle line
//              (head-burst.ts slugSplitPoint), so the slug from the front opens BOTH halves. The split's cut faces
//              are the slug's wound: they are blasted with a slug's shove and a slug's share of the collapse meter,
//              and they bleed as the axe's do. The zombie lives. If the split refuses after all (the body is
//              tearing apart), the round is ordinary.
//   pop        A slug from within range on a head that is ALREADY split wide (burstTuning.popSplitMin of its angle
//              or more; a head only cracked takes it as an ordinary wound). It need not be precise
//              (burstTuning.popPrecise): the head swells and bursts (ZombieActor.beginHeadPop; the burst itself is
//              the actor's onHeadPop, game-spawn.ts). The other way to a pop is not this leaf's: an ordinary slug
//              wound that cuts the head off pops it through the actor's onDecapitate (head-burst.ts
//              decapitationRule).
//   opening    The slug head burst of 2026-10-02 (game-head-damage.ts burst), only while burstTuning.opening is on.
//              Not the shipped behaviour.
//
// THE ORDERS. An earlier ordinary wound on the head, a pellet's or an imprecise slug's, leaves no state in any
// leaf, so a later precise slug still splits. A head the flail has damaged (the head damage leaf holds its regions
// and deform, measured on the closed head) is refused by the split, here and for the axe: a precise slug on it is
// an ordinary slug wound, and can still take the head off and pop it. A split head takes pellets and slugs from too
// far as ordinary wounds on its un-warped flesh (damage.ts unwarpHit); the next slug from within range pops it if it
// is split wide.
import type { GameContext } from './game-context';
import type { ZombieActor } from './game-actor';
import type { BuildResult } from '../build-body';
import type { Vec3 } from '../types';
import { WOUND_PROFILES, unwarpHit, type ShotProvenance, type Wound } from '../damage';
import { COLLAPSE_TUNING } from '../collapse';
import { headQuatOf } from '../rig-bind';
import { rotate, type HeadFrame, type Quat } from '../head-deform';
import { BURST, aimOffsetOf, aimRangeOf, burstTuning, classifyBurst, headShotRule, hsOf, onHeadPrim, slugSplitPoint, type HeadShotRule } from '../head-burst';
import { splitMaxAngle } from '../head-split';
import type { HeadSplitLeaf } from './game-head-split';
import { headAlive } from './flame-anchors';

export interface HeadShotDeps {
  /** game-main's headShape: the head frame's centre and half-axes on a posed body. */
  headShape(b: BuildResult): { centre: Vec3; axes: Vec3 } | null;
  /** The head split leaf: the slug opens the head through it, and it says whether a head is open. */
  split: Pick<HeadSplitLeaf, 'open' | 'isOpen' | 'state'>;
  /** The head damage leaf holds state for this head (game-head-damage.ts has): the split would refuse it. */
  headDamaged(a: ZombieActor): boolean;
  /** The burst opening (game-head-damage.ts burst); false when it declined the round. */
  opening(a: ZombieActor, point: Vec3, dir: Vec3, shot: ShotProvenance | undefined, kind: 'pellet' | 'slug'): boolean;
  /** Blood for one of the split's cut faces (registerCutBleed, as the axe's). */
  bleed(a: ZombieActor, w: Wound, point: Vec3, dir: Vec3): void;
}

/** The last round this leaf judged on an actor's head. `offset`: how far the round's own line ran from the head's
 *  centre, head radii. `aimOffset` and `rangeM`: the same of the crosshair's ray recorded at firing, and the metres
 *  from that eye to the head (null: the round carries no aim). `took`: the leaf consumed it (false: the caller
 *  stamped its ordinary wound, which is every 'ordinary' verdict and a split or an opening that was refused). */
export interface HeadShotDebug { rule: HeadShotRule; kind: 'pellet' | 'slug'; offset: number; aimOffset: number | null; rangeM: number | null; took: boolean }

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

export function createHeadShot(ctx: GameContext, deps: HeadShotDeps): HeadShotLeaf {
  // Keyed by the actor object and held weakly: an actor that has left the cast takes its verdict with it.
  let verdicts = new WeakMap<ZombieActor, HeadShotDebug>();

  /** Open the head along the slug's plane, laid on the head's middle line (slugSplitPoint); the faces are the
   *  slug's wound. False when the split refused. */
  function split(a: ZombieActor, point: Vec3, dir: Vec3, frame: HeadFrame, shot: ShotProvenance | undefined): boolean {
    const faces = deps.split.open(a, slugSplitNormal(dir, frame.quat), slugSplitPoint(burstTuning.splitAim, point, frame), burstTuning.splitOpen);
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
      if (!burstTuning.on || a.characterName() !== 'zombie') return false;
      const posed = a.posed();
      if (!headAlive(posed) || a.headPopping()) return false;
      // A split head's prims are the closed head's: the hit is judged where it lands on them.
      const at = unwarpHit(posed, point).hit;
      if (!onHeadPrim(posed.prims, at)) return false;
      const shape = deps.headShape(posed);
      if (!shape) return false;
      const frame: HeadFrame = { centre: shape.centre, axes: shape.axes, quat: (headQuatOf(a.boundRig(), a.pose().yaw) as Quat | null) ?? IDENTITY };
      // Judged on the slug's own line, where it lands is the measure, and a landing point past the head ellipsoid's
      // reach is the neck's or a shoulder's. Judged on the crosshair it is not asked: an aimed slug lands 10 cm
      // under the crosshair, at that reach's edge.
      if (burstTuning.splitAim === 'slug') {
        const hs = hsOf(frame, at);
        if (Math.hypot(hs[0], hs[1], hs[2]) > BURST.maxHs) return false;
      }
      const offset = classifyBurst({ point, dir }, frame).offset;
      // Where the player was aiming as the slug left: the crosshair's ray against this head, and the range.
      const aim = kind === 'slug' && shot?.weapon === 'slug' ? shot.aim ?? null : null;
      const aimOffset = aim ? aimOffsetOf(aim, frame) : null, rangeM = aim ? aimRangeOf(aim, frame) : null;
      // How far a split head stands open: its spring's target, as a share of its preset's full angle.
      const st = deps.split.isOpen(a) ? deps.split.state(a.id) : null;
      const full = st ? splitMaxAngle(st) : 0;
      const rule = headShotRule({ kind, offset, aimOffset, rangeM, splitOpen: !!st, splitShare: st && full > 0 ? st.target / full : 0, splitRefused: deps.headDamaged(a) });
      const took = rule === 'split' ? split(a, point, dir, frame, shot)
        : rule === 'pop' ? a.beginHeadPop(dir, burstTuning.popSwellS)
          : rule === 'opening' ? deps.opening(a, point, dir, shot, kind)
            : false;
      verdicts.set(a, { rule, kind, offset, aimOffset, rangeM, took });
      // Visible in a dev build's console while the rules are being tuned.
      if (import.meta.env.DEV && rule !== 'ordinary' && rule !== 'opening') {
        console.info(`[head-shot] actor ${a.id} ${kind}: ${rule}${took ? '' : ' (refused)'} (aim ${aimOffset === null ? 'not recorded' : `${aimOffset.toFixed(2)} head radii off centre from ${rangeM!.toFixed(1)} m`}; the round's line ${offset.toFixed(2)})`);
      }
      return took;
    },
    last(id) {
      const a = ctx.world.actors.find(x => x.id === id);
      return a ? verdicts.get(a) ?? null : null;
    },
    reset() { verdicts = new WeakMap(); },
  };
}
