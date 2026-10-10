// src/lab/sdf-zombie/webgpu/game-gib-actor.ts
//
// Gibbing a whole actor (gibActor: chunks, blood, blast profile, retire) and spawning the gibs scheduled for later frames.
//
// Extracted from game-main.ts's main() closure. Each function takes the
// GameContext explicitly instead of capturing main()'s scope.
//
// Plan: docs/superpowers/plans/2026-09-17-game-main-decomposition.md

import type { GameContext } from './game-context';
import { EXPLOSION_LAUNCH, EXPLOSION_STANDARD } from '../../../game/gibs/tuning';
import { spawnImpactGout } from '../blood-sim';
import { type BuildResult } from '../build-body';
import { concussionVelocity } from '../explosion-aoe';
import { gibLaunchVelocity } from '../gib-launch';
import { displaceGibPieces, gibTierPlan, retargetGibPieces, type GibPiece } from '../gib-parts';
import { gibAll, gibAllPieces } from '../sever';
import { type Vec3 } from '../types';
import { type ZombieActor } from './game-actor';
import { spawnChunkPiece } from './game-chunk-pieces';
import { spawnAssetGibPiece, spawnSpriteGibPiece } from './game-gib-pieces';
import { ensureCarvedLibrary, gibAllowance, gibAssetArchetypeOf, gibBudget, gibDebit, retireActor, spawnCarvedPiece } from './game-gib-spawn';
import { rngStreams } from './rng';


/**
 * TURN EVERY BODY WHOSE WINDOW HAS CLOSED INTO PIECES. Runs once per tick,
 * AFTER the actors have stepped, so `a.posed()` is the pose the body was last
 * DRAWN in and the hand-off from bent body to pieces has nothing to hide.
 *
 * The pool is divided across this tick's ready bodies with the same greedy
 * rule a blast uses (nearest first, one floor reserved for each body still to
 * come), because a window that closes for three bodies at once is a blast's
 * worth of pieces arriving at once.
 */
export function spawnScheduledGibs(ctx: GameContext, dt: number): number {
  if (ctx.gibs.pendingGibs.length === 0) return 0;
  // THE WINDOW'S CLOCK LIVES HERE, not in the body's step: a frozen capture
  // (`?frozen=1`) skips the whole body block, and a body whose clock stopped
  // would never become pieces. Stepping it here also means the separating
  // body is re-drawn on frames the body itself did not step.
  for (const q of ctx.gibs.pendingGibs) q.actor.stepTear(dt);
  const ready = ctx.gibs.pendingGibs.filter(q => !q.actor.tearing());
  if (ready.length === 0) return 0;
  let remaining = gibBudget(ctx);
  let left = ready.length;
  let spawned = 0;
  for (const q of ready) {
    const i = ctx.gibs.pendingGibs.indexOf(q);
    if (i >= 0) ctx.gibs.pendingGibs.splice(i, 1);
    const allowance = gibAllowance(ctx, remaining, left);
    // THE HAND-OFF: the plan's own regions at the offsets the body was last
    // DRAWN with, RETARGETED onto the SLOUGHED prims (`deformedPrims`/
    // `deformedBones`). Without the retarget the chunks would spawn their
    // clean prims and the body would snap back to the intact pose on the
    // release frame; with it, the spawned flesh is the geometry that was on
    // screen. `stepTear` above uploaded exactly this frame (age >= sec,
    // progress 1), so there is no second partition and no snap.
    const frame = q.actor.tearFrame();
    // LOCKED TO THE SCHEDULE-TIME TIER (task 3): the ladder does not re-run,
    // so a tight pool cannot preview one shape and spawn another. `q.reserve`
    // is what `gibBudget()` held for it; the splice above frees it.
    const locked = ctx.gibs.mode !== 'pieces';
    const planned = {
      pieces: frame
        ? displaceGibPieces(
            retargetGibPieces(q.plan.pieces, frame.deformedPrims, frame.deformedBones),
            frame.offsets, frame.quats, frame.angVels)
        : q.plan.pieces,
      body: frame?.body ?? q.actor.posed(),
      tier: q.tier,
      locked,
    };
    const made = gibActor(ctx, q.actor, q.at, q.falloff, locked ? q.reserve : allowance, planned);
    q.actor.endTear();
    remaining = gibDebit(ctx, remaining, made);
    left--;
    spawned += made;
  }
  // The census counters live here rather than only in detonateAt: with a
  // pre-tear window the pieces are born in the TICK, several frames after the
  // blast that condemned the body, and a counter that only counted the blast
  // frame reported zero pieces for a gib that plainly happened (the gate's
  // live-view row showed 19 -> 24 chunks against "no pieces were spawned").
  ctx.dynamite.gibPieces += spawned;
  for (const q of ready) ctx.dynamite.scheduledGibBodies++;
  ctx.dynamite.scheduledGibPieces += spawned;
  return spawned;
}

/**
 * GIB A LIVE ACTOR — the thing the active game did not have.
 *
 * The lab gibs a body by calling sever.ts and spawning chunks; here the body
 * belongs to an actor with a GPU view, a brain, a collapse clock and a room
 * membership, so this is bookkeeping as much as it is gore:
 *
 *  1. `gibBlastPlan` (via `gibTierPlan`, the default) on the POSED body — the
 *     split-only priority plan with the skeleton's readable core released as
 *     its own bone piece. `?gib=clusters|pieces` keeps sever.ts's two older
 *     shapes as labelled A/B controls. Pieces come back in WORLD space, which
 *     is exactly what spawnChunkPiece wants — the same frame the existing
 *     sever path hands it.
 *  2. **ZERO VELOCITY AT BIRTH, THEN THE BLAST.** Every piece is spawned
 *     stationary at the transform the body is actually in, and its concussion
 *     velocity is QUEUED for a later frame (`pendingGibImpulses`). Frame 0 is
 *     therefore the body's own silhouette rather than a magic trick, and the
 *     pieces come apart over `gibStaggerFrames` frames with the NEAREST the
 *     blast going first — so the blast reads as ripping outward THROUGH the
 *     body instead of the body being swapped for debris.
 *  3. The actor is RETIRED: hidden, unregistered, dropped from `actors`. Its
 *     GPU view is deliberately NOT disposed — every chunk's template borrows
 *     that view's uniforms and volume texture (the sever path makes the same
 *     borrow), so freeing it would take the gib's own geometry with it. That
 *     is a bounded, deliberate leak: the roster is finite and the view is
 *     small beside the geometry it seeds.
 *
 *     THE PRE-TEAR WINDOW OF THE DESIGN (dev-note §3c, the flesh pushed
 *     outward and jiggled BEFORE it tears) IS NOT HERE, and it cannot be
 *     until the body outlives this function: the cheapest mechanism for it is
 *     pumping the struck actor's `woundCfg.z` (rim splay — the only existing
 *     uniform that everts flesh outward, and it is not in the wound cull's
 *     reach formula, so it is safe to animate), and that needs the resolver's
 *     wounds stamped on a body that is still being marched. Today a gibbing
 *     blast takes this branch, stamps nothing, and the actor is gone in the
 *     same frame, so a rim pump here would be dead code. §3(a)/(b) — what
 *     this function now does — are the prerequisite, which is the order the
 *     design asks for them in anyway.
 */
export function gibActor(ctx: GameContext, 
  a: ZombieActor,
  at: Vec3,
  falloff: number,
  budget: number,
  planned?: {
    pieces: GibPiece[]; body: BuildResult; tier?: string; locked?: boolean;
  },
): number {
  // A planned hand-off comes from the rupture: `body` is the pose the body was
  // last DRAWN in and `pieces` are the plan's own regions at the same offsets,
  // so the released set is the drawn set (task 3), not a re-derivation from
  // the clean pose.
  const posedBody = planned?.body ?? a.posed();
  const torsoC = posedBody.clusters.find(c => c.limb === 'torso')?.center
    ?? ([at[0], at[1], at[2]] as Vec3);
  const clusters: GibPiece[] = (ctx.gibs.mode === 'pieces' ? gibAllPieces(posedBody, torsoC) : gibAll(posedBody))
    .chunks.map(g => ({ ...g, part: g.limb, kind: 'limb' as const }));
  // THE SPLIT PLAN IS CHOSEN THE SAME WAY AT BOTH ENDS (2026-09-16 task 2).
  // A scheduled rupture already carries the plan the preview drew; the
  // zero-duration path (`?gibtear=0`) and any direct caller choose it HERE
  // with the same `gibTierPlan`, so no default path can silently fall back to
  // whole-limb clusters. `?gib=clusters|pieces` keep their own labelled
  // reference shapes.
  const scheduledPlan = ctx.gibs.mode === 'parts' && planned === undefined
    ? gibTierPlan(posedBody, budget, { bones: ctx.gibs.bones, mode: 'parts', at })
    : null;
  const pieces: GibPiece[] = ctx.gibs.mode === 'parts'
    ? (planned?.pieces ?? scheduledPlan!.plan.pieces)
    : clusters;
  const template = { uniforms: a.view.uniforms, volumeTexture: a.view.volumeTexture };
  // IS THIS BODY ACTUALLY GOING OUT AS SPRITES? Both halves matter: the mode
  // has to be on AND there has to be an atlas to cut a frame from. Resolved
  // ONCE per body and used for the tier decision AND the spawn loop, so a body
  // can never take the sprite path's budget while spawning marched pieces.
  const spriteMode = ctx.gibs.renderMode === 'sprite' && ctx.gibs.atlas !== null;
  // CARVE IS THE THIRD RENDERER: real meshes from the archetype library. It
  // resolves ONCE per body (mode on AND a library that built), so a body can
  // never take the carve budget while spawning something else.
  const carveMode = ctx.gibs.renderMode === 'carve' && ensureCarvedLibrary(ctx) && ctx.bake.carvedLibrary !== null;
  // ASSETS ARE THE FOURTH RENDERER (task 2): real reusable meshes loaded from
  // the committed offline sets. Resolved ONCE per body, like carve, so the
  // budget/tier decision and the spawn loop agree. Until the archetype's load
  // resolves this is false and the body falls back to marched pieces.
  const assetMode = ctx.gibs.renderMode === 'assets' && ctx.gibs.assetRuntime.library(gibAssetArchetypeOf(ctx, a)) !== null;
  if (ctx.gibs.renderMode === 'sprite' && ctx.gibs.atlas === null && !ctx.gibs.spriteAtlasWarned) {
    ctx.gibs.spriteAtlasWarned = true;
    console.warn('[gib-sprites] ?gibrender=sprite but no atlas is loaded — '
      + 'falling back to marched pieces for this session');
  }
  const launchFall = EXPLOSION_LAUNCH.falloffFloor
    + (1 - EXPLOSION_LAUNCH.falloffFloor) * falloff;
  // ——— THE LAUNCH: INDEPENDENT PIECE SPREAD + ONE SHARED BODY SHOVE ————————
  // The owner, on the shipped blast: "Gib launch should more closely follow
  // the existing ported NotBlood behavior; pieces cluster too much." The old
  // line called `concussionVelocity(at, g.origin, ...)` PER PIECE — a radial
  // vector from the blast to that piece, so chest and abdomen (centimetres
  // apart) left on one spoke. That is ConcussSprite's generic shockwave, not
  // how NotBlood launches a gib (see gib-launch.ts's header).
  //
  // Source-faithful: NotBlood's GibThing gives each thing its OWN random
  // spread from the gib table's `atc`/`at10` fields, and the blast's shared
  // ConcussSprite then shoves the whole set coherently. So: compute ONE
  // coherent velocity at the body (the shove the body itself would have
  // taken), and let `gibLaunchVelocity` add each piece's independent,
  // seed-deterministic spread on top at `coherentFrac`. GIB_LAUNCH keeps the
  // source 1:3 horizontal:vertical ratio and the lab's accepted arc.
  const coherentVel = concussionVelocity(
    at, torsoC, EXPLOSION_STANDARD.impulse * launchFall * ctx.gibs.velScale);
  // `?giblaunch=radial` is the labelled CONTROL: the old per-piece radial
  // shove, kept only so a normal-speed A/B can be captured side by side.
  const launchFor = (key: string, origin: Vec3): Vec3 => ctx.gibs.launchMode === 'radial'
    ? concussionVelocity(at, origin, EXPLOSION_STANDARD.impulse * launchFall * ctx.gibs.velScale)
    : gibLaunchVelocity({ key, seed: ctx.demo.seed, bodyVel: coherentVel });
  // NEAREST THE BLAST FIRST. This is the STAGGER order: the piece nearest the
  // explosion starts moving first, so the blast reads as ripping outward
  // through the body. It no longer decides what survives — the budget was
  // applied to the plan (by priority) before this point.
  const dist = (p: Vec3) => (p[0] - at[0]) ** 2 + (p[1] - at[1]) ** 2 + (p[2] - at[2]) ** 2;
  const byBlast = (list: GibPiece[]) => [...list].sort((x, y) => dist(x.origin) - dist(y.origin));

  // ——— THE TIERS ————————————————————————————————————————————————————————
  // The default `parts` shape is SPLIT-ONLY and is chosen by `gibTierPlan`
  // (schedule time, or the call above for the zero-duration path). There is
  // deliberately NO release-time ladder here any more: the old one degraded by
  // rebuilding whole limbs (`clusters`, `clusters+cage`, `clusters+core`) and
  // that is the "arms and legs become tubes again" the owner reported. The
  // only remaining whole-limb shape is `?gib=clusters`, which is a labelled
  // A/B control the page asked for by name.
  let chosen = byBlast(pieces);
  let tier = ctx.gibs.mode === 'parts' ? (scheduledPlan?.tier ?? 'parts') : ctx.gibs.mode;
  // THE SCHEDULE-TIME TIER IS BINDING (task 3). When the caller locked the
  // plan, the shape was already chosen with the pool arithmetic and previewed;
  // re-deriving here is exactly the "preview rich, spawn cheap" defect this
  // removes.
  const tierLocked = planned?.locked === true;
  if (tierLocked && planned?.tier) tier = planned.tier;
  // ——— SPRITE MODE HAS NO LADDER, AND THAT IS THE FEATURE ————————————————
  // A quad cannot cost what a marched piece costs, so `gibBudget()` hands
  // sprite mode its own cap and the condition that would degrade the shape
  // never becomes true. The body comes apart completely, every time.
  if (carveMode) {
    // NO LADDER, for the same reason as sprite mode and one more: the carved
    // piece set IS the whole body by construction (every region of it), so
    // there is no cheaper shape to degrade to — a degraded carve would just be
    // a body with holes in it.
    tier = 'carve';
  } else if (assetMode) {
    // The asset path IS the whole authored split by name, so there is no
    // cheaper shape to degrade to; a missing/damaged piece falls back
    // per-piece inside the loop below and is counted.
    tier = 'assets';
  } else if (spriteMode) {
    tier = 'sprite';
    // A blast bigger than the cap still slices — nearest-the-blast first, the
    // same order the blast's own spawn order uses — but that is the CAP
    // talking, not a shape compromise: the pieces that go are the ones the
    // player is furthest from.
    if (chosen.length > budget) chosen = chosen.slice(0, Math.max(1, budget));
  } else if (chosen.length > budget) {
    // The split plan was already chosen against the pool (reserved at schedule
    // time, or planned here for the zero-duration path), so this is only a
    // belt-and-braces bound for the labelled `clusters`/`pieces` controls.
    // Never reached for default `parts`.
    chosen = chosen.slice(0, Math.max(1, budget));
  }
  const ordered = chosen;
  const liveBefore = ctx.bake.liveChunks.length;
  const spawning = ordered;
  const dropped = pieces.length - spawning.length;
  // THE RUPTURE HAND-OFF DOES NOT GET THE ZERO-VELOCITY HOLD (Task 2 audit).
  // The `+ 1` below exists for the OLD path, where the body was intact up to
  // the blast frame: one full frame at rest is what kept frame 0 the body's
  // own silhouette instead of a substitution. A planned hand-off comes from a
  // body that has ALREADY been visibly separating for `gibTearSec`, and the
  // strain is nearly spent by the end of the ease-out — so spawning it at rest
  // again produced exactly the second pause the contract forbids: measured
  // (RESULTS.md) 16 pieces at zero velocity for the release frame plus 1-3
  // stagger frames, on a body that had been moving. A delay of 0 still fires
  // in the SPAWN TICK (`stepPendingGibImpulses` runs later in the same tick),
  // so the pieces integrate their launch velocity on the release frame; the
  // jump is vel*dt, identical to what a delay of 1 produced one frame later,
  // minus the dead frame. `?gibstagger` keeps its meaning for the immediate
  // path.
  const ruptureHandoff = planned !== undefined;
  const perFrame = Math.max(1, Math.ceil(spawning.length / ctx.gibs.staggerFrames));
  const boneOnly = (g: GibPiece) => g.prims.length === 0 && g.bones.length > 0;
  let spawned = 0, boneSpawned = 0;
  // ——— CARVE: THE WHOLE BODY, FROM THE ARCHETYPE LIBRARY —————————————————
  // The piece set here is NOT `spawning` (the body's authored split) but the
  // library's carved regions, which cover the whole body including its
  // skeleton. Placement is the one approximation this path makes: the library
  // is baked in the archetype's REST pose, so a piece goes to
  // `actorPos + rotateY(regionCentre, bodyYaw)`. A gib is anonymous meat a
  // frame after the blast, so a rest-pose arm on a mid-stride body is the
  // standard trade — and it is what makes ONE library serve every zombie.
  if (carveMode && ctx.bake.carvedLibrary && ctx.bake.carvedMaterial) {
    const lib = ctx.bake.carvedLibrary.pieces;
    const yaw = a.pose().yaw;
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const base = a.pose().pos;
    const perFrameCarve = Math.max(1, Math.ceil(lib.length / ctx.gibs.staggerFrames));
    for (let i = 0; i < lib.length; i++) {
      const p = lib[i]!;
      // Body space -> world: yaw about the vertical, then translate.
      const wx = base[0] + (p.centre[0] * cy + p.centre[2] * sy);
      const wy = base[1] + p.centre[1];
      const wz = base[2] + (-p.centre[0] * sy + p.centre[2] * cy);
      const o: Vec3 = [wx, wy, wz];
      const vel = launchFor(`carve#${i}`, o);
      const delay = 1 + Math.min(ctx.gibs.staggerFrames - 1, Math.floor(i / perFrameCarve));
      if (spawnCarvedPiece(ctx, p, o, 'limb', vel, delay)) spawned++;
    }
  }
  for (let i = 0; i < spawning.length && !carveMode; i++) {
    const g = spawning[i]!;
    const vel = launchFor(`${g.part ?? g.limb}#${i}`, g.origin);
    // + 1 on the OLD path only: every piece spends at least ONE FULL FRAME at
    // rest, so the first frame drawn after the blast is the body's own
    // silhouette in place. The rupture hand-off launches on the spawn tick —
    // see `ruptureHandoff` above. See stepPendingGibImpulses for why this
    // counts drains. The sprite path passes it to `spawnSpritePiece` instead,
    // and `stepSpritePieces` counts drains the same way.
    const delay = ruptureHandoff ? 0 : 1 + Math.min(ctx.gibs.staggerFrames - 1, Math.floor(i / perFrame));
    if (spriteMode) {
      // THE SAME PIECE, A DIFFERENT RENDERER. `g` carries the split (which
      // prims, which bones, which limb) and the sprite path reads only its
      // EXTENT and identity from it — the geometry itself never touches the
      // GPU, which is the trade the owner accepted ("sure you trade 3d but its
      // not important in this case").
      if (spawnSpriteGibPiece(ctx, g, vel, delay)) {
        spawned++;
        if (boneOnly(g)) boneSpawned++;
      }
      continue;
    }
    if (assetMode) {
      // THE OFFLINE MESH, DEFORMED ONTO THE DRAWN POSE/SLOUGH. On success the
      // piece is a reusable mesh from the committed set; on failure (missing
      // part, damaged source set) the SAME piece falls through to the marched
      // path below, so damage is never silently lost. The deform subtracts
      // `g.origin` — the same pivot `makeChunk` places the piece at.
      if (spawnAssetGibPiece(ctx, a, g, vel, delay)) {
        spawned++;
        if (boneOnly(g)) boneSpawned++;
        continue;
      }
    }
    spawnChunkPiece(ctx, {
      limb: g.limb, origin: g.origin, prims: g.prims, tornAt: g.tornAt, bones: g.bones, kind: g.kind,
      // THE PRE-RELEASE MOTION RIDES THE PIECE (task 4): the orientation the
      // region was last drawn with and the angular velocity that produced it.
      // `makeChunk` overrides its random tumble with these, so the release has
      // no orientation reset and no second angular kick.
      spinQuat: g.spinQuat, spinAngVel: g.spinAngVel,
    }, template, [0, 0, 0]); // AT REST: see the doc block, point 2
    const made = ctx.bake.liveChunks[ctx.bake.liveChunks.length - 1];
    if (made) {
      ctx.gibs.pendingGibImpulses.push({ id: made.id, vel, delay });
      spawned++;
      if (boneOnly(g)) boneSpawned++;
    }
  }
  // Gore: the blast opens the body, so one gout at the epicentre. `spawnImpactGout`
  // takes the SIM directly (its droplets are rendered by bloodView.sync), and
  // 'slug' is the heaviest profile BleedKind has — there is no 'blast' one.
  if (ctx.vfx.bleedEnabled) {
    spawnImpactGout(ctx.vfx.bloodSim, 'slug', at, [0, 1, 0], rngStreams.bleed, ctx.boot.nextEmitterStream++);
  }
  retireActor(ctx, a);
  ctx.telemetry.telemetry.event('dynamite-gib', {
    actor: a.id, mode: ctx.gibs.mode, tier, pieces: spawned, dropped, bones: boneSpawned,
    gibBones: ctx.gibs.bones, gibStaggerFrames: ctx.gibs.staggerFrames, gibVelScale: ctx.gibs.velScale, gibLaunchMode: ctx.gibs.launchMode, budget, liveBefore,
  });
  ctx.dynamite.lastGibDropped = dropped;
  ctx.dynamite.lastGibTier = tier;
  ctx.dynamite.gibTierLog.push(`${tier}:${spawned}`);
  ctx.dynamite.lastGibSpawned = spawned;
  // WHAT THE BODY BECAME, by name. A census of chunk counts cannot say
  // whether the RIBCAGE is in the pile, and "is there a ribcage" is the
  // owner's actual question — so the part ids ride the seam.
  ctx.dynamite.lastGibParts = spawning.map(g => g.part);
  ctx.dynamite.lastGibHeld = spawning.length - spawned;
  return spawned;
}
