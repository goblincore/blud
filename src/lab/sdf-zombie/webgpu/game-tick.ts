// src/lab/sdf-zombie/webgpu/game-tick.ts
//
// The game tick: one simulation step of the whole game (player, weapons, actors, gibs, dynamite, blood, VFX), still one function.
//
// Extracted from game-main.ts's main() closure. Each function takes the
// GameContext explicitly instead of capturing main()'s scope.
//
// Plan: docs/superpowers/plans/2026-09-17-game-main-decomposition.md

import { withCtx, type GameContext } from './game-context';
import * as THREE from 'three/webgpu';
import { woundEmitAnchorAndNormal } from '../bleed-registry';
import { emitTrails, spawnWoundDroplets, stepBlood } from '../blood-sim';
import { chunkBakeField } from '../chunk-bake-field';
import { separate, type CrowdAgent } from '../crowd';
import { woundWorldPos } from '../damage';
import { fleshShrink } from '../flesh-bits';
import { rotateYaw } from '../gait';
import { chunkSettled, stepChunk } from '../gib-chunks';
import { arbitrate, type RingClaimant } from '../melee-ring';
import { stepHitFeedback } from '../player-hit-feedback';
import { ROCKET, blastPlayerDamage, stepRockets } from '../rockets';
import { type Vec3 } from '../types';
import { sdBody } from '../validate';
import { bodyInSight } from './actor-sight';
import { connectionBlobsForSim } from './blood-connections';
import { type EncounterAgent } from './encounter-director';
import { reticleNdc } from './fisheye';
import { approachAngle, approachBob, bobPose, pivotOffset, turnFromAim, weaponAngles, weaponSlide } from './free-aim';
import { segmentHitsBox, type ZombieActor } from './game-actor';
import { registerBleed, stepGutRopes } from './game-bleed';
import { cancelChunkBake, finishChunkBake } from './game-chunk-bake';
import { gibBakedPiece, gibChunkMeat } from './game-chunk-pieces';
import { describeRecordedWound, neutralInput, readInputFrame, updateDemoHud } from './game-demo-record';
import { stepDisco } from './game-disco';
import { stepDynamicLight } from './game-dynamic-light';
import { detonateAt, stepDynamite } from './game-dynamite-step';
import { stepEgg } from './game-egg';
import { spawnScheduledGibs } from './game-gib-actor';
import { stepPendingGibImpulses } from './game-gib-spawn';
import { ceilingAt, chunkCollidersAt, shellAmpOf } from './game-hit-trace';
import { updateHud } from './game-hud';
import { applyDeathCamera, damagePlayer, loopBlocksInput, refillMagazine, stepLoop } from './game-loop';
import { stepMeshGibs } from './game-mesh-gibs';
import { stepFlashLight, stepMuzzleFlash } from './game-muzzle-flash';
import { stepOutdoor } from './game-outdoor';
import { PLAYER, eyeOf, stepPlayer, type MoveInput } from './game-player';
import { applyInputFrame } from './game-player-input';
import { gibBlurSubjects } from './game-render-controls';
import { applySequenceCamera, stepSequence } from './game-sequence';
import { applyTrainCamera, lightSteam, stepTrain } from './game-train';
import { CHAMBER_DEPTH_M, LOAD_STAGE_GAP_M, RECOIL, RELOAD, SHELL_LEN_M, ejectedShell, extractStage, extractorOffset, fireRecoil, insertStage, loadCarry, loadHold, reloadPhaseAt, reloadPose, stagedShellCenter, supportHandPose, topLeverAngle, type HandDelta, type HandHold } from './game-viewmodel';
import { stepVoid } from './game-void';
import { expired, stepProjectiles, traceProjectile } from './game-weapon';
import { aimArms, aimFrustum, boreFrameInRig, breechInRig, hideTracer, newTracerView, placeTracer, stepWeaponSlots } from './game-weapon-rig';
import { woundStreamId } from './game-wound-streams';
import { trailStreamId } from './game-wound-vfx';
import { headShape } from './game-zombie-face';
import { stepSpritePieces } from './gib-sprite-pieces';
import { billboardGib } from './gib-sprites';
import { GOBLIN_SKIN } from './goblin-skin';
import { VITALS, segmentHitsCapsule } from './player-vitals';
import { carryWithRecoil } from './recoil-carry';
import { rngStreams } from './rng';
import { advance as advanceSimClock, simTimeMs } from './sim-clock';
import { selectVisualActors } from './visual-actor-set';

/** Separation radius for any body in the melee ring — attacking, closing,
 *  recovering or waiting.
 *
 *  IT IS DERIVED, NOT PICKED. Two circles of radius r settle 2r apart, and
 *  an arm reaches ~0.6 m, so clearing two facing arms needs 2r > 1.2, i.e.
 *  r > 0.6. The first value here was 0.55 — 1.10 m apart, which does NOT
 *  clear 1.2 m of arms — specified from "wider than 0.35" rather than from
 *  the arm reach the 90-degree ring spacing was computed from. A 12 s hand
 *  probe caught it: minHandGap still went to -0.06 m with only ONE body at
 *  melee radius, because the pair clipping was two WAITERS, not two
 *  attackers.
 *
 *  RAISED AGAIN 0.70 -> 0.80 when origin/main's arm work landed (elbow
 *  flexion constraints, the removed wound-clutch reach, constrainRigBends):
 *  those move where an arm sits, and the measured room-4 gap went 0.435 ->
 *  0.210 -> -0.031 across two merges without this file changing at all. The
 *  ceiling is meleeRadius (1.25) minus the player's 0.32 anchor = 0.93, so
 *  there is room for one more bump before the melee radius has to move too;
 *  the gate is what tells us. */
export const ENGAGED_RADIUS = 0.80;
export const Y_UP = new THREE.Vector3(0, 1, 0);
export const _tmpV = new THREE.Vector3();
/** The gun's resting pose. Every per-frame offset -- reload, recoil -- is a
 *  DELTA from here, so nothing has to remember where "home" was. */
export const GUN_REST = {
  // TOWARD THE CENTRE. At x = 0.125 the gun sat well right of screen centre,
  // which pushed the support hand out to the left edge as a disconnected blob
  // instead of wrapping the fore-end. Centring the weapon is also the
  // classic-FPS placement the Realms-of-the-Haunting reference uses.
  pos: new THREE.Vector3(0.038, -0.115, -0.300),
  rollDeg: -4.5,
  pitchDeg: 2.5,
} as const;
/** Hand rest positions in VIEW space, read from the GLB's Grip_Hand and
 *  Fore_Hand locators at load. Hand-placed constants drifted out of contact
 *  with the weapon the moment the gun pose moved -- which is exactly what
 *  left the support hand floating unattached. These cannot drift. */
export const GRIP_HAND_REST = new THREE.Vector3();
export const FORE_HAND_REST = new THREE.Vector3();
/** Keeps sprite trail-emitter ids out of the chunk ids' range — `emitTrails`
 *  keys its per-emitter clock by id and the two sequences both start at 1. */
export const SPRITE_TRAIL_ID_BASE = 0x4000_0000;

export function tick(ctx: GameContext, dt: number) {
  if (ctx.demo.simLocked) return; // render-lock: drawFn still runs; nothing mutates.
  // FLAIL HIT-STOP AND SLOW TAIL: a landed strike nearly freezes the sim for
  // 70-100 ms, then steps the time scale to 0.4 and eases it back to 1
  // (flail-impact.ts timeScale, spec §14.1). Its timers — and the impact
  // feel's view springs — run on the unscaled step. The demo recorder stores
  // the scaled dt (a replay stays deterministic).
  dt *= ctx.weapon.flail?.timeScale(dt) ?? 1;
  // The sim clock advances ONLY here, from the step's own dt — never from
  // wall time. This is the single source of "how much simulated time has
  // passed", so every dwell/timer that reads it is reproducible under a
  // replay. See the declaration next to lastSeenMs for the why.
  advanceSimClock(dt);
  ctx.demo.simFrame++;
  stepOutdoor(ctx, dt);
  stepVoid(ctx, dt);
  stepTrain(ctx, dt);
  stepDynamicLight(ctx, dt);
  lightSteam(ctx);
  stepDisco(ctx);
  stepEgg(ctx);
  stepLoop(ctx, dt);
  stepSequence(ctx, dt);
  ctx.telemetry.telemetry.lap('region', 'tick:input-player');
  // BLAST REFRACTION ages on SIM time, like every other sim clock — never
  // wall time — so a frozen capture advances it exactly one frame per step and
  // an on/off pair at the same frame is a real comparison (post-aa.ts).
  ctx.render.postAa.stepBlastDistort(dt);
  // Billboard the gib sprites. Cheap (a handful of quads) and it has to be per
  // frame: a piece that stops facing the camera vanishes edge-on.
  for (const s of ctx.vfx.spriteBenchSprites) billboardGib(s, ctx.boot.handle.camera);
  ctx.render.segMeshRenderer?.stepDebris(dt);
  // ONE INPUT FRAME PER TICK (stage 3). Live, this snapshots the listeners'
  // accumulated state; replaying, it is the player's next frame. Both go
  // through applyInputFrame, so the input path is identical either way; and
  // while recording, the frame the tick CONSUMED is what gets logged (not a
  // re-read after the fact, which could see a later event).
  const inputFrame = ctx.demo.replayActive ? ctx.player.currentInputFrame : readInputFrame(ctx);
  applyInputFrame(ctx, inputFrame);
  if (ctx.demo.replayActive) {
    // A recorded frame is consumed by exactly ONE tick. Reset to a neutral
    // frame (keeping the last look) so a repeated step — the bench's warmup,
    // say — cannot re-fire the same shot.
    ctx.player.currentInputFrame = neutralInput(ctx, inputFrame);
    ctx.demo.replayFrame++;
  } else {
    // The frame the tick CONSUMED, not a re-read after the fact: a live
    // event that lands mid-tick must belong to the next frame, not this one.
    if (ctx.demo.recorder) { ctx.demo.recorder.push({ ...inputFrame, dt }); updateDemoHud(ctx); }
  }
  const held = inputFrame.keys;
  let input: MoveInput = ctx.player.holdPlayerPose
    ? { x: 0, z: 0, jump: false }
    : {
      x: (held.includes('KeyD') ? 1 : 0) - (held.includes('KeyA') ? 1 : 0),
      z: (held.includes('KeyW') ? 1 : 0) - (held.includes('KeyS') ? 1 : 0),
      jump: held.includes('Space'),
    };
  if (ctx.player.autopilot && !ctx.player.holdPlayerPose) {
    const dx = ctx.player.autopilot.x - ctx.player.player.pos[0];
    const dz = ctx.player.autopilot.z - ctx.player.player.pos[2];
    if (Math.hypot(dx, dz) < 0.25) {
      ctx.player.autopilot = null;
      input = { x: 0, z: 0, jump: false };
    } else if (ctx.player.strafeT > 0) {
      ctx.player.strafeT -= dt;
      input = { x: ctx.player.strafeDir, z: 0.2, jump: false };
    } else {
      ctx.player.player.yaw = Math.atan2(dx, -dz);
      input = { x: 0, z: 1, jump: false };
    }
    if (ctx.player.lastWalkPos
      && Math.hypot(ctx.player.player.pos[0] - ctx.player.lastWalkPos[0], ctx.player.player.pos[2] - ctx.player.lastWalkPos[1]) < 0.02) {
      ctx.player.stuckT += dt;
      if (ctx.player.stuckT > 0.5) {
        // Strafe AWAY from whatever is ahead: nearest zombie within 1.2 m
        // in front picks the side; walls just get the fallback flip.
        const sy = Math.sin(ctx.player.player.yaw), cy = Math.cos(ctx.player.player.yaw);
        let bestLat: number | null = null;
        let bestFwd = Infinity;
        for (const a of ctx.world.actors) {
          const ox = a.pose().pos[0] - ctx.player.player.pos[0];
          const oz = a.pose().pos[2] - ctx.player.player.pos[2];
          const fwdDist = ox * sy - oz * cy;
          const lat = ox * cy + oz * sy;
          if (fwdDist > 0 && fwdDist < 1.2 && Math.abs(lat) < 0.9 && fwdDist < bestFwd) {
            bestFwd = fwdDist;
            bestLat = lat;
          }
        }
        ctx.player.strafeDir = bestLat !== null ? (bestLat > 0 ? -1 : 1) : -ctx.player.strafeDir;
        ctx.player.strafeT = 0.8;
        ctx.player.stuckT = 0;
      }
    } else {
      ctx.player.stuckT = 0;
    }
    ctx.player.lastWalkPos = [ctx.player.player.pos[0], ctx.player.player.pos[2]];
  }
  // Zombies are soft obstacles: one fat AABB each, rebuilt per frame.
  const zombieBoxes = ctx.world.actors.filter(a=>!a.motionFrame()?.collapsed).map(a => {
    const p = a.pose().pos;
    return { min: [p[0] - 0.35, 0, p[2] - 0.35] as Vec3, max: [p[0] + 0.35, 1.8, p[2] + 0.35] as Vec3 };
  });
  if (loopBlocksInput(ctx)) input = { x: 0, z: 0, jump: false };   // dead or done
  stepPlayer(ctx.player.player, input, dt, [...ctx.world.colliders, ...zombieBoxes]);

  // Damage transitions use their own clock; frozen pose captures must
  // still show a newly selected preset. Refresh exclusions as it grows.
  for (const a of ctx.world.actors) if (a.advanceWoundPreview(dt)) ctx.render.frozenHullBuilt = false;
  // The head split's spring (game-head-split.ts), BEFORE the actors step: their step is what asks the split hook, so
  // this frame's pose carries this frame's angle. Outside the wanderFrozen branch: a frozen actor is re-posed by the
  // tick itself.
  ctx.weapon.headSplit?.tick(dt);
  // ——— VISUAL-ACTOR SET (visual-actor-cull plan task 2) ————————
  // Which actors need PER-ACTOR VISUAL upkeep this tick: the padded view
  // cone from the player's eye/yaw/pitch and the camera's fov/aspect,
  // unioned with LAST FRAME's visibleActors (the march cull's verdict —
  // one frame stale here by construction, which the cone margin exists to
  // cover) and with everything within alwaysWithinM. Computed ONCE per
  // tick, BEFORE the wanderFrozen branch, so the ?frozen=1 boot path
  // (march-hash, closeup captures) also has a fresh set: its hull block
  // AND the draw-side skeleton `shown` set run every tick regardless of
  // the freeze, and a frozen capture that moves the camera must see the
  // set follow it. A begin()/end() span named 'tick:visual-set' rather
  // than a region lap: a lap opened here would stay open until the next
  // 'region' lap inside the branch and smear the encounter + body-step
  // cost into the phase. Bodies are each actor's torso cluster centre; an
  // actor with NO torso cluster (mid-gib, exotic body) is ALWAYS kept —
  // never cull what we cannot measure (same rule as updateVisibleActors).
  // When the cull is off the set is every actor: the pre-cull behaviour,
  // exactly.
  {
    const visualSetTiming = ctx.telemetry.telemetry.begin();
    if (ctx.render.visualCullEnabled) {
      const cam = ctx.boot.handle.camera;
      const alsoKeep = new Set<number>();
      for (const a of ctx.render.visibleActors) alsoKeep.add(a.id);
      const bodies: { id: number; center: Vec3 }[] = [];
      const unmeasurable: ZombieActor[] = [];
      const byId = new Map<number, ZombieActor>();
      const eye = eyeOf(ctx.player.player);
      for (const a of ctx.world.actors) {
        byId.set(a.id, a);
        const torso = a.posed().clusters.find(c => c.limb === 'torso');
        if (!torso) { unmeasurable.push(a); continue; }
        bodies.push({ id: a.id, center: torso.center });
      }
      const keptIds = selectVisualActors(
        { eye, yaw: ctx.player.player.yaw, pitch: ctx.player.player.pitch, fovYDeg: cam.fov, aspect: cam.aspect },
        bodies, alsoKeep, undefined,
        // Walls count: the same per-cluster sight test the march cull uses,
        // from this tick's eye. Only bodies the cone kept are ever asked.
        (id) => { const a = byId.get(id); return !a || bodyInSight(eye, a.posed().clusters, ctx.world.colliders); },
      );
      const visual = new Set<ZombieActor>();
      for (const a of unmeasurable) visual.add(a);
      for (const a of ctx.world.actors) if (keptIds.has(a.id)) visual.add(a);
      ctx.render.visualActors = visual;
    } else {
      ctx.render.visualActors = new Set(ctx.world.actors);
    }
    ctx.telemetry.telemetry.end('tick:visual-set', visualSetTiming);
  }
  if (!ctx.demo.wanderFrozen) {
    ctx.render.frozenHullBuilt = false;
    // --- brain input + crowd separation, BEFORE the actors step ----------
    // Order matters: separating first means this frame's step() and its
    // view.update() render the corrected positions, so a resolved overlap
    // is never a frame late on screen.
    const pRoom = ctx.world.encounterNav.roomAt(ctx.player.player.pos);
    const pInfo = pRoom > 0
      ? { x: ctx.player.player.pos[0], z: ctx.player.player.pos[2], room: pRoom }
      : null;
    // The snapshot build is INSIDE the phase on purpose: it calls pose()
    // per actor and is part of what the director costs per frame.
    const encounterTiming = ctx.telemetry.telemetry.begin();
    const snapshots: EncounterAgent[] = ctx.world.actors.map(a=>({id:a.id,pos:a.pose().pos,yaw:a.pose().yaw,room:a.room,
      home:ctx.world.encounterHomes.get(a.id)??a.pose().pos,soldier:a.kind==='soldier',ranged:a.kind==='soldier'&& !a.meleeCapable(),disabled:!!a.motionFrame()?.collapsed}));
    const orders=ctx.world.encounter.update(snapshots,pInfo,ctx.weapon.shotAlert,dt);
    ctx.weapon.shotAlert = false;
    for (const a of ctx.world.actors) a.setEncounterOrder(orders.get(a.id)!);
    ctx.telemetry.telemetry.end('encounter', encounterTiming);
    ctx.telemetry.telemetry.lap('region', 'tick:ai-separation');

    // --- melee ring: who may swing this frame ---------------------------
    // Claimants are the alert bodies that are actually in the encounter; an
    // idle wanderer must not take a token it cannot use and starve a body
    // that is closing. Runs BEFORE the actors step, so a body's brain sees
    // this frame's verdict rather than last frame's.
    if (pInfo) {
      const claimants: RingClaimant[] = ctx.world.actors
        // meleeCapable FIRST: the ring is the zombie's mechanism, and a
        // soldier in 'advance'/'standoff' satisfies the alert+non-idle test
        // while having no swing to throw. Submitting him would make him
        // compete for a token AND be spaced at melee radius against the
        // zombies, distorting their positioning.
        .filter(a => a.meleeCapable() && orders.get(a.id)?.visible && !a.motionFrame()?.collapsed
          && a.mind().debug().alert && a.mind().debug().state !== 'idle')
        .map(a => {
          const p = a.pose().pos;
          return {
            id: a.id, x: p[0], z: p[2],
            committed: a.committed(),
            incumbent: a.debug().hasToken,
          };
        });
      const verdict = arbitrate({ x: pInfo.x, z: pInfo.z }, claimants);
      for (const a of ctx.world.actors) {
        a.setRingInput(verdict.holders.has(a.id), verdict.drift.get(a.id) ?? 0);
      }
    } else {
      for (const a of ctx.world.actors) a.setRingInput(false, 0);
    }

    const agents: CrowdAgent[] = ctx.world.actors.map(a => {
      const p = a.pose().pos;
      return {
        x: p[0], z: p[2],
        r: ctx.world.level.keyAt(p[0],p[2]).startsWith('tunnel') ? .34 : a.engagedForCrowd() ? ENGAGED_RADIUS : .45,
        mobile: !a.motionFrame()?.collapsed,
      };
    });
    // The player is an ANCHOR: zombies slide off him rather than shove him.
    // His own capsule already resolves against the per-frame zombie boxes
    // above (stepPlayer), which is the other half of the same contact.
    agents.push({ x: ctx.player.player.pos[0], z: ctx.player.player.pos[2], r: PLAYER.radius, mobile: false });
    const push = separate(agents);
    ctx.world.actors.forEach((a, i) => a.nudge(push[i]![0], push[i]![1]));

    const bodyTiming = ctx.telemetry.telemetry.begin();
    ctx.world.soldierCorpses?.update(ctx.world.actors,dt);
    for (const a of ctx.world.actors) a.step(dt);
    // 'body-step' CLOSES HERE, before the kit pose below, because that is
    // the boundary main's telemetry numbers were taken with. Widening a
    // counter to cover more work without saying so makes every recorded
    // figure incomparable to every new one, which is worse than the counter
    // being slightly narrow than it ought to be.
    ctx.telemetry.telemetry.end('body-step', bodyTiming);
    ctx.telemetry.telemetry.lap('region', 'tick:burn-kit-viewtime');
    // BURNING BODIES: step AFTER the bodies, so the draw reads this frame's
    // uniforms. An empty registry is one size check.
    ctx.vfx.burning.step(dt);
    // POLYGON HALVES RIDE THE RIG. Armour from per-bone frames, the gun from
    // the motion frame's gun pose; collapse and gib release the gun while the
    // kit keeps following the fallen rig. One call, because character-view
    // owns all three — this is the block held soldier task 7 was going to
    // hand-port out of lab-main for a fourth time.
    //
    // A no-op for the zombie: it has neither kit nor prop, and pose() returns
    // immediately when both are absent.
    // Kit armour and the held prop ride the same rig and draw as polygons,
    // so they hold with the flesh for the same reason the skeleton meshes
    // do (see meshHold in the draw). Motion and the rig still advance —
    // only the VISUAL pose is held, so gameplay is untouched.
    if (!(ctx.render.sdfLayer.halfRate && ctx.render.sdfLayer.willHold)) {
      for (const a of ctx.world.actors) {
        if (!a.character) continue;
        const p = a.pose();
        // THE DISARM (the warbull's launcher plate shot off, profile
        // armor.disarmPlate): the launcher tears off his arm and falls,
        // flung out to his right. With the prop released, onFire refuses to
        // shoot, so the ranged mode is over for good.
        if (a.disarmed() && a.character.prop && !a.character.prop.released) {
          a.character.releaseProp(rotateYaw([-1.4, 1.6, 0.5], p.yaw), a.id);
          ctx.telemetry.telemetry.event('disarm', { actor: a.id });
        }
        a.character.pose(a.body, a.boundRig(), p.yaw, a.sinceFire(), a.motionFrame(), dt, a.id, a.posed(), a.barrelSpin(), a.armorView(), a.statusLights());
      }
    }
    // The actor animation phase: wall-clock in play, the SIM CLOCK while a
    // demo is held. `simClockMs` is milliseconds, so the expression below is
    // the same NUMBER normal play computes — the hold changes the SOURCE,
    // not the scale, and is therefore invisible when it is off. Without this
    // the rig jiggle would differ between two runs of one recording and the
    // frame hash could never match. Pixel-only: nothing here feeds the sim.
    const now = ctx.demo.hold ? simTimeMs() / 1000 : performance.now() / 1000;
    for (const a of ctx.world.actors) {
      // Visual-actor cull: view time and head shape are PER-ACTOR VISUAL
      // state — skipped for bodies that cannot be on screen. Both writes
      // are absolute-time uniform stores (no dt integration), so an actor
      // leaving and re-entering the set just picks the current time up.
      if (!ctx.render.visualActors.has(a)) continue;
      a.view.setTime(now);
      // Face projection tracks the posed skull through the gait jiggle — and
      // the RUPTURE's displaced head while a doomed body is coming apart, so
      // the face does not stay pinned to the clean pose as the head rotates
      // (task 4).
      const skull = headShape(a.drawnBody());
      if (skull) a.view.setHeadShape(skull.centre, skull.axes);
    }
    ctx.telemetry.telemetry.lap('region', 'tick:occluder-hull');
    // The visual set's actors, in actor order, as ONE array reused by both
    // hull updates and the wound-exclusion flatMap (visual-actor-cull task
    // 2). With the cull off the set is every actor, so this is the old
    // `ctx.world.actors` list exactly (order included).
    const hullActors = ctx.world.actors.filter(a => ctx.render.visualActors.has(a));
    // Wound exclusion, same contract as the lab's woundSpheres: hull
    // endpoint spheres must not sit inside carve zones, or they render as
    // pale discs inside craters. The carve sphere is centred ON the anchor
    // (depth-slab-clipped in the shader), so the full-radius sphere here is
    // a superset — it can only over-exclude (a slightly looser hull), never
    // expose. The game never passed this before 2026-08-27 because its
    // craters were tangent (the pale-wound defect) and never reached the
    // hull; real craters exposed it within one capture.
    if (ctx.render.sdfLayer.shellEnabled) {
      // Same VISUAL bodies the occluder hull is built from, one line below
      // — this is what makes the hull "posed" at no extra cost. (Visual-
      // actor cull: an off-screen body's hull instances cannot be seen;
      // its exclusion spheres only ever touched its own hull.)
      ctx.world.outerHull.update(hullActors.map(a => a.posed()), { shellAmp: shellAmpOf(ctx) });
    }
    ctx.render.occluderHull.update(
      hullActors.map(a => a.posed()),
      ctx.render.hullExclusionsEnabled
        ? hullActors.flatMap(a => {
          const prims = a.posed().prims;
          const yaw = a.pose().yaw;
          return a.visualWounds().map(w => ({ centre: woundWorldPos(prims, w, yaw), radius: w.radius }));
        })
        : [],
      // The pre-pass ships disabled and nothing consumes the occluder
      // instances; skip their rebuild while it is off (perf r2 task 4).
      // setOccluder(true) resumes the rebuild on the next frame, so the
      // A/B seam still works.
      //
      // The shadow twin holds on a half-rate hold frame — the same condition
      // as the visual-pose hold above: the flesh on screen is the PREVIOUS
      // pose reprojected, so a current-pose shadow hull would lead the body
      // by one sub-frame (the shadow-detaches-during-animation report).
      { occluder: ctx.render.sdfLayer.occluderEnabled, shadow: !(ctx.render.sdfLayer.halfRate && ctx.render.sdfLayer.willHold) },
    );
  } else if (!ctx.render.frozenHullBuilt) {
    // FROZEN-FROM-BOOT HULL BUILD (closeup task 1, 2026-09-04). A body
    // frozen via ?frozen=1 never runs the branch above, so the outer hull
    // never builds, the shell entry/exit targets stay cleared to zero, and
    // shellFetch reads shellOut = 0 — which the march treats as "no hull
    // covers this pixel" is FALSE, it reads it as shellOut <= 0 and
    // DISCARDS EVERY FRAGMENT: the entire march layer is invisible while
    // everything else (CPU field, predictor, polygonal world) works. The
    // freeze() SEAM never hit this because it freezes after frames have
    // run. Nothing can move once frozen, so both hulls build exactly once;
    // unfreezing clears the flag and the normal per-frame path resumes.
    // (Visual-actor cull: this block does NOT filter by the visual set —
    // deliberately, a diagnosed exception to the plan's “both hull
    // blocks”. The frozen build runs ONCE, at the spawn view, and the hull
    // then persists for the whole frozen session while the capture
    // teleports the camera wherever it stages (march-hash's stageCloseUp).
    // A build filtered by the spawn-view set drops staged bodies' shell
    // instances — shell on, shellOut 0 discards their fragments — so the
    // “cull” would corrupt the one-shot build instead of saving anything:
    // there is no per-frame cost here to save. Safety bias: keep all.)
    if (ctx.render.sdfLayer.shellEnabled) {
      ctx.world.outerHull.update(ctx.world.actors.map(a => a.posed()), { shellAmp: shellAmpOf(ctx) });
    }
    ctx.render.occluderHull.update(
      ctx.world.actors.map(a => a.posed()),
      ctx.render.hullExclusionsEnabled
        ? ctx.world.actors.flatMap(a => {
          const prims = a.posed().prims;
          const yaw = a.pose().yaw;
          return a.visualWounds().map(w => ({ centre: woundWorldPos(prims, w, yaw), radius: w.radius }));
        })
        : [],
      { occluder: ctx.render.sdfLayer.occluderEnabled },
    );
    ctx.render.frozenHullBuilt = true;
  }

  // ---------------------------------------------------------------
  // GRAPESHOT SIM — pellets fly, land as wounds through actor.hit();
  // detached pieces fly ballistically through the shared chunk path.
  // ---------------------------------------------------------------
  ctx.telemetry.telemetry.lap('region', 'tick:weapon-rig-reload');
  ctx.weapon.cooldown = Math.max(0, ctx.weapon.cooldown - dt);
  ctx.weapon.flare?.tickCooldown(dt);
  ctx.weapon.rod?.tick(dt);
  ctx.weapon.axe?.tick(dt);
  ctx.weapon.launcher?.tick(dt);
  ctx.weapon.recoilPitch *= Math.exp(-9 * dt);
  // ——— FREE AIM ————————————————————————————————————————————————————
  // The reticle only turns the camera once it is shoved past the dead zone;
  // inside it, aiming is free and the world stays put.
  if (ctx.player.freeAimOn) {
    const turn = turnFromAim(ctx.weapon.aim, dt);
    ctx.player.player.yaw += turn.yaw;
    ctx.player.player.pitch = Math.min(PLAYER.pitchLimit,
      Math.max(-PLAYER.pitchLimit, ctx.player.player.pitch + turn.pitch));
  }
  {
    const w = ctx.player.freeAimOn ? weaponAngles(ctx.weapon.aim, aimFrustum(ctx)) : { yawDeg: 0, pitchDeg: 0 };
    ctx.weapon.yawDeg = approachAngle(ctx.weapon.yawDeg, w.yawDeg, dt);
    ctx.weapon.pitchDeg = approachAngle(ctx.weapon.pitchDeg, w.pitchDeg, dt);
    // ...and the weapon CARRIES across the frame as well as turning. Rotation
    // alone pins the grip near screen centre at every reticle position --
    // that is what pivoting about the grip means -- so the gun read as bolted
    // to the camera with a hinged barrel (owner report). approachAngle is a
    // plain exponential catch-up, so it smooths metres as happily as degrees.
    const s = ctx.player.freeAimOn ? weaponSlide(ctx.weapon.aim) : { x: 0, y: 0 };
    ctx.weapon.slideXm = approachAngle(ctx.weapon.slideXm, s.x, dt);
    ctx.weapon.slideYm = approachAngle(ctx.weapon.slideYm, s.y, dt);
  }
  // WALK BOB, driven by distance rather than time so it stays locked to the
  // stride when the player speeds up, slows down or stops.
  {
    const pos = ctx.player.player.pos;
    const step = Math.hypot(pos[0] - ctx.player.prevPlayerPos[0], pos[2] - ctx.player.prevPlayerPos[2]);
    ctx.player.prevPlayerPos = [pos[0], pos[1], pos[2]];
    ctx.player.bobDistance += step;
    const speed01 = dt > 0 ? Math.min(1, step / dt / PLAYER.walkSpeed) : 0;
    ctx.player.bobAmount = approachBob(ctx.player.bobAmount, speed01, dt);
  }
  if (ctx.weapon.aimRig) {
    const b = bobPose(ctx.player.bobDistance, ctx.player.bobAmount);
    const yaw = THREE.MathUtils.degToRad(ctx.weapon.yawDeg);
    const pitch = THREE.MathUtils.degToRad(ctx.weapon.pitchDeg);
    const roll = THREE.MathUtils.degToRad(b.rollDeg);
    // ROTATE ABOUT THE GRIP, not about the eye. Without this offset the rig
    // pivots on the player's head and the weapon leaves the frame the moment
    // it points anywhere near the edge of the viewport. Roll (the walk bob)
    // has to be passed too -- it is small alone but combines with yaw/pitch
    // under Three.js's 'XYZ' Euler order in a way pivotOffset must match.
    const o = pivotOffset(GUN_REST.pos, pitch, yaw, roll);
    // Bob + pivot correction + the aim slide. Order does not matter (they are
    // all translations) but the roles do: `o` holds the grip STILL under the
    // rotation, and the slide is what then carries that held grip across the
    // frame. Without the slide the two cancel to a gun that only ever nods.
    ctx.weapon.aimRig.position.set(
      b.x + o.x + ctx.weapon.slideXm,
      b.y + o.y + ctx.weapon.slideYm,
      o.z,
    );
    ctx.weapon.aimRig.rotation.set(pitch, yaw, roll);
    // The rig just moved; the shoulders did not. Re-aim the arms at them.
    aimArms(ctx);
  }
  // Weapon slots + the dynamite, AFTER the rig has been placed for this frame
  // (the holster travel is a local transform on gunRig/bundleRig, so it does
  // not care where the rig is — but the burst sprites the dynamite spawns are
  // world-space and want the frame's final camera).
  stepWeaponSlots(ctx, dt);
  // The flail, after the rig AND the holster are placed (game-flail.ts).
  ctx.weapon.flail?.tick(dt);
  // The head damage model after the flail (actors stepped earlier this frame,
  // so the dangling eye follows this frame's pose).
  ctx.weapon.headDamage?.tick(dt);
  stepDynamite(ctx, dt);
  if (ctx.player.reticleEl) {
    ctx.player.reticleEl.style.display = ctx.player.freeAimOn && !ctx.world.sequence?.started ? 'block' : 'none';
    if (ctx.player.freeAimOn) {
      // Position against the CANVAS, not the window. Percent-of-viewport put
      // the reticle outside the render area whenever the canvas did not fill
      // the page -- so the thing marking where you are aiming sat somewhere
      // you could not shoot.
      const r = ctx.boot.canvas.getBoundingClientRect();
      // Through the LENS. The fisheye moves the world under the crosshair,
      // so the crosshair rides the inverse map or it stops marking where
      // the shot lands. Pushed outward, because the centre is magnified.
      // Lens off (k = 0) returns `aim` unchanged — this is the old line.
      const p = reticleNdc(ctx.weapon.aim, ctx.render.postAa.lens);
      ctx.player.reticleEl.style.left = `${r.left + r.width * (0.5 + p.x * 0.5)}px`;
      ctx.player.reticleEl.style.top = `${r.top + r.height * (0.5 - p.y * 0.5)}px`;
    }
  }

  ctx.weapon.flashAge += dt;
  ctx.weapon.fireAge += dt;
  // The flame jets are posed below, after the view-model matrices are current.
  stepFlashLight(ctx);

  // SMOKE. Each live puff drifts, expands and fades; dead ones stay hidden.
  for (const p of ctx.vfx.smokePuffs) {
    if (p.age === Infinity) continue;
    p.age += dt;
    const life = 0.9;
    if (p.age >= life) { p.age = Infinity; p.mesh.visible = false; continue; }
    const u = p.age / life;
    p.mesh.position.addScaledVector(p.vel, dt);
    p.vel.multiplyScalar(1 - 1.6 * dt);      // drag
    p.vel.y += 0.28 * dt;                    // it rises as it cools
    p.mesh.scale.setScalar(0.6 + 2.4 * u);
    p.mesh.rotation.z = p.roll + u * 0.8;
    (p.mesh.material as THREE.MeshBasicMaterial).opacity = 0.42 * (1 - u) * (1 - u * 0.3);
    p.mesh.visible = true;
  }

  // THE VIEW-MODEL POSE: rest + reload delta + recoil delta, composed once so
  // a reload during recoil reads as both rather than one clobbering the other.
  const reloading = ctx.weapon.reloadAge <= RELOAD.totalSec;
  if (reloading) ctx.weapon.reloadAge += dt * ctx.weapon.reloadSpeed;
  const rp = reloading ? reloadPose(ctx.weapon.reloadAge) : { roll: 0, pitch: 0, dy: 0, dz: 0, hinge: 0 };
  const rc = fireRecoil(ctx.weapon.fireAge, ctx.weapon.fireBarrels);
  if (ctx.weapon.gunGroup) {
    ctx.weapon.gunGroup.rotation.z = THREE.MathUtils.degToRad(GUN_REST.rollDeg + rp.roll + rc.roll);
    ctx.weapon.gunGroup.rotation.x = THREE.MathUtils.degToRad(GUN_REST.pitchDeg + rp.pitch + rc.pitch);
    ctx.weapon.gunGroup.position.set(
      GUN_REST.pos.x,
      GUN_REST.pos.y + rp.dy + rc.dy,
      GUN_REST.pos.z + rp.dz + rc.dz,
    );
  }
  if (ctx.weapon.hingePivot) ctx.weapon.hingePivot.rotation.x = rp.hinge * RELOAD.openRad;
  // The breech locators are read below in RIG space, and they hang off the
  // hinge pivot that was just rotated. Without this the eject would trail the
  // barrels by exactly one frame.
  if (ctx.weapon.gunGroup) ctx.weapon.viewModelAnchor.updateMatrixWorld(true);
  stepMuzzleFlash(ctx);   // the jets follow the barrels through the kick
  if (ctx.weapon.topLeverNode) ctx.weapon.topLeverNode.rotation.y = topLeverAngle(reloading ? ctx.weapon.reloadAge : 0);

  /** Where the fore hand is this frame BEFORE the recoil carries it: the rest
   *  place, or the reload's path while one is running. */
  let foreHandBase: THREE.Vector3 = FORE_HAND_REST;
  if (reloading) {
    // THE BORE BASIS, this frame, in rig space. The cases leave along it,
    // the fresh ones are staged on it, and the hand's two breech keys are
    // derived from it -- all from the same live locators, so nothing here
    // can disagree with where the open barrels actually are.
    const out = new THREE.Vector3(), side = new THREE.Vector3();
    const breech = new THREE.Vector3();
    const haveBore = boreFrameInRig(ctx, out, side);
    const outV: Vec3 = [out.x, out.y, out.z];
    const frame = { out: outV, side: [side.x, side.y, side.z] as Vec3 };
    // Shell meshes run hull +Y / head -Y; the hull points down the bore.
    const qBore = new THREE.Quaternion().setFromUnitVectors(
      Y_UP, _tmpV.copy(out).negate(),
    );

    // THE SUPPORT HAND leaves the fore-end, drops out of frame low-left, and
    // comes back up carrying the fresh cases -- so the reload actually SHOWS
    // a hand doing the loading instead of shells appearing by themselves.
    // Its two keys at the breech are read off the live mouths (loadHold):
    // the authored table put the hand at the bottom of the frame at the seat
    // beat while the cases seated by themselves, which is "magically appear".
    let hold: HandHold | undefined;
    if (haveBore) {
      const mL = new THREE.Vector3(), mR = new THREE.Vector3();
      breechInRig(ctx, 0, mL); breechInRig(ctx, 1, mR);
      const mid: Vec3 = [(mL.x + mR.x) / 2, (mL.y + mR.y) / 2, (mL.z + mR.z) / 2];
      const h = loadHold(mid, outV, frame.side, GOBLIN_SKIN.handRadius);
      const asDelta = (p: Vec3): HandDelta => ({
        dx: p[0] - FORE_HAND_REST.x, dy: p[1] - FORE_HAND_REST.y, dz: p[2] - FORE_HAND_REST.z,
      });
      hold = { stage: asDelta(h.stage), seat: asDelta(h.seat) };
    }
    const sh = supportHandPose(ctx.weapon.reloadAge, hold);
    const handNow = new THREE.Vector3(
      FORE_HAND_REST.x + sh.dx,
      FORE_HAND_REST.y + sh.dy,
      FORE_HAND_REST.z + sh.dz,
    );
    foreHandBase = handNow;
    if (ctx.weapon.foreHandGroup) { ctx.weapon.foreHandGroup.position.copy(handNow); aimArms(ctx); }

    // ——— STAGE 1: EXTRACTION, and the INSERT that mirrors it ————————
    // The seated cases are children of Barrels, so they are already carrying
    // the 45 deg tilt. Sliding them along their own LOCAL -Z walks them
    // straight back out of the bores; sliding them the other way seats the
    // fresh ones. Larger z is toward the muzzle. Same nodes for both: a
    // fresh case IS the seated case, arriving.
    const ex = extractStage(ctx.weapon.reloadAge);
    const ins = insertStage(ctx.weapon.reloadAge);
    for (let i = 0; i < ctx.weapon.shellNodes.length; i++) {
      const s = ctx.weapon.shellNodes[i];
      const restZ = ctx.weapon.shellRestZ[i];
      if (!s || restZ === undefined) continue;
      if (ex !== null) {
        s.visible = true;
        s.position.z = restZ - ex * CHAMBER_DEPTH_M;
      } else if (ins !== null) {
        // From staged (tip a gap behind the mouth) to seated.
        s.visible = true;
        s.position.z = restZ - (1 - ins) * (CHAMBER_DEPTH_M + LOAD_STAGE_GAP_M);
      } else {
        // Seated before the extract beat, gone after the hand-off, back
        // once the insert has seated them.
        s.visible = ctx.weapon.reloadAge < RELOAD.extractAtSec || ctx.weapon.reloadAge >= RELOAD.loadSeatSec;
        s.position.z = restZ;
      }
    }
    if (ctx.weapon.extractorNode) {
      ctx.weapon.extractorNode.position.z = ctx.weapon.extractorRestZ - extractorOffset(ctx.weapon.reloadAge);
    }

    // ——— STAGE 2: THE TUMBLE ———————————————————————————————————————
    // Handed off where stage one LEFT the case: its centre half a case
    // length out of the mouth along the bore, on a gun that may be at any
    // point in its swing, and bore-aligned -- not snapped to the rig's -Z
    // with its rear half still inside the tube, which is what clipped.
    for (let i = 0; i < ctx.weapon.ejectedShells.length; i++) {
      const m = ctx.weapon.ejectedShells[i];
      if (!m) continue;
      const k: 0 | 1 = i === 0 ? 0 : 1;
      const e = ejectedShell(ctx.weapon.reloadAge, k, frame, ctx.weapon.reloadSeed);
      if (!e || !haveBore || !breechInRig(ctx, k, breech)) { m.visible = false; continue; }
      m.visible = true;
      const origin = breech.clone().addScaledVector(out, SHELL_LEN_M / 2);
      m.position.set(origin.x + e.x, origin.y + e.y, origin.z + e.z);
      // End over end about the side axis, from the bore-aligned start.
      m.quaternion.setFromAxisAngle(side, e.spin).multiply(qBore);
      const originWorld = (ctx.weapon.aimRig ?? ctx.weapon.viewModelAnchor).localToWorld(origin);
      ctx.weapon.lastEjectOrigin = [originWorld.x, originWorld.y, originWorld.z];
    }

    // FRESH CASES: the rig-space CARRY. They ride rigidly in the hand from
    // wherever it is to their staged spot on the bore axis, and the hand's
    // stage key IS the place that puts them there -- so at the end of the
    // carry each case sits exactly where the barrel-local insert picks it
    // up, and the two stages meet without a jump. Held tips-up at first,
    // rolling onto the bore axis as they arrive.
    const carry = loadCarry(ctx.weapon.reloadAge);
    for (let i = 0; i < ctx.weapon.loadShells.length; i++) {
      const m = ctx.weapon.loadShells[i];
      if (!m) continue;
      const k: 0 | 1 = i === 0 ? 0 : 1;
      if (carry === null || !haveBore || !hold || !breechInRig(ctx, k, breech)) {
        m.visible = false; continue;
      }
      m.visible = true;
      const staged = stagedShellCenter([breech.x, breech.y, breech.z], outV);
      m.position.set(
        handNow.x + staged[0] - (FORE_HAND_REST.x + hold.stage.dx),
        handNow.y + staged[1] - (FORE_HAND_REST.y + hold.stage.dy),
        handNow.z + staged[2] - (FORE_HAND_REST.z + hold.stage.dz),
      );
      const qHeld = new THREE.Quaternion().setFromAxisAngle(side, -0.7).multiply(qBore);
      m.quaternion.copy(qHeld).slerp(qBore, carry);
    }

    if (reloadPhaseAt(ctx.weapon.reloadAge) === 'done') {
      refillMagazine(ctx);   // from the reserve on finite-ammo levels
      ctx.weapon.reloadAge = Infinity;
      if (ctx.weapon.hingePivot) ctx.weapon.hingePivot.rotation.x = 0;
      if (ctx.weapon.topLeverNode) ctx.weapon.topLeverNode.rotation.y = 0;
      if (ctx.weapon.extractorNode) ctx.weapon.extractorNode.position.z = ctx.weapon.extractorRestZ;
      for (let i = 0; i < ctx.weapon.shellNodes.length; i++) {
        const s = ctx.weapon.shellNodes[i];
        const restZ = ctx.weapon.shellRestZ[i];
        if (!s || restZ === undefined) continue;
        s.visible = true;              // loaded gun: two heads at the breech
        s.position.z = restZ;
      }
      if (ctx.weapon.gunGroup) {
        ctx.weapon.gunGroup.rotation.z = THREE.MathUtils.degToRad(GUN_REST.rollDeg);
        ctx.weapon.gunGroup.rotation.x = THREE.MathUtils.degToRad(GUN_REST.pitchDeg);
        ctx.weapon.gunGroup.position.copy(GUN_REST.pos);
      }
      if (ctx.weapon.foreHandGroup) { ctx.weapon.foreHandGroup.position.copy(FORE_HAND_REST); aimArms(ctx); }
      for (const m of ctx.weapon.ejectedShells) m.visible = false;
      for (const m of ctx.weapon.loadShells) m.visible = false;
      updateHud(ctx);
    }
  }
  // THE HANDS RIDE THE KICK. They are placed at rest (or by the reload) and the
  // recoil moves only the gun, so the hands used to hang where the fore-end had
  // been. Carry both by the recoil part of the gun's motion; the window runs a
  // little past the recoil so the last frame lands them exactly at rest.
  if (ctx.weapon.fireAge < RECOIL.durationSec + 0.1 && ctx.weapon.gripHandGroup && ctx.weapon.foreHandGroup) {
    const gunRest = { pos: GUN_REST.pos, pitchDeg: GUN_REST.pitchDeg, rollDeg: GUN_REST.rollDeg };
    carryWithRecoil(GRIP_HAND_REST, gunRest, rc, ctx.weapon.gripHandGroup.position);
    carryWithRecoil(foreHandBase, gunRest, rc, ctx.weapon.foreHandGroup.position);
    aimArms(ctx);
  }
  {
    const projectileTiming = ctx.telemetry.telemetry.begin();
    const prevs = ctx.weapon.pellets.map(p => [...p.pos] as Vec3);
    stepProjectiles(ctx.weapon.pellets, dt);
    // Hit batching: every actor hit this frame flushes its rig/repack/
    // wound-row tail ONCE after the loop (ZombieActor.beginHits).
    const hitThisFrame = new Set<ZombieActor>();
    for (let i = ctx.weapon.pellets.length - 1; i >= 0; i--) {
      const p = ctx.weapon.pellets[i]!;
      const from = prevs[i]!;
      let dead = expired(p);
      if (!dead && ctx.bake.chunks.length > 0) {
        // ORDER: this MUST precede the floor kill below — a settled piece
        // rests AT the y = 0.02 plane, so the slug that reaches it is
        // always past y 0.02 by segment end, and a floor-first pre-check
        // eats every such shot before the test can run (measured 2026-09-
        // 05: the check log held first-segment entries only, and every
        // overhead drop at a settled piece read as eaten by the floor).
        // A BAKED piece is still hittable (close-up task 5 gate): the
        // pre-bake page tested NOTHING against chunks, so the bake would
        // have shipped floor pieces that silently ate slugs. A segment
        // passing inside the piece's baked bounding sphere GIBS it —
        // option 2 from the design: spawn fresh chunks and delete the
        // mesh, no reverse path, no dual-representation invariant.
        // ORDER: this runs BEFORE the floor kill below — a settled piece
        // rests AT the y = 0.02 plane, so a slug that reaches it is always
        // "at the floor" by segment end, and the old pre-check would have
        // eaten every such shot before the test could run.
        const segX = p.pos[0] - from[0], segY = p.pos[1] - from[1], segZ = p.pos[2] - from[2];
        const segLen2 = segX * segX + segY * segY + segZ * segZ || 1;
        for (let bi = ctx.bake.chunks.length - 1; bi >= 0; bi--) {
          const b = ctx.bake.chunks[bi]!;
          const t = Math.max(0, Math.min(1,
            ((b.centre[0] - from[0]) * segX + (b.centre[1] - from[1]) * segY + (b.centre[2] - from[2]) * segZ) / segLen2));
          const qx = from[0] + segX * t - b.centre[0];
          const qy = from[1] + segY * t - b.centre[1];
          const qz = from[2] + segZ * t - b.centre[2];
          // Summed radii: the projectile is itself a ball (SLUG/GRAPEHOT
          // radius), so the segment-sphere test uses piece + pellet. A
          // point-probe would let a 5.5 cm slug overlap a piece without
          // hitting it — wrong at these scales.
          const hitR = b.radius + p.radius;
          if (qx * qx + qy * qy + qz * qz > hitR * hitR) continue;
          gibBakedPiece(ctx, b, p.pos);
          dead = true;
          break;
        }
      }
      if (!dead && ctx.bake.enabled) {
        // Settled pieces must remain hittable while queued/in flight. A
        // sphere rejects distant shots, then the existing CPU field tests
        // the actual piece without extracting any mesh on this thread.
        const dx = p.pos[0] - from[0], dy = p.pos[1] - from[1], dz = p.pos[2] - from[2];
        const l2 = dx * dx + dy * dy + dz * dz || 1;
        for (let ci = ctx.bake.liveChunks.length - 1; ci >= 0; ci--) {
          const c = ctx.bake.liveChunks[ci]!;
          if (!chunkSettled(c.state)) continue;
          const centre = c.state.pos;
          const t = Math.max(0, Math.min(1, ((centre[0] - from[0]) * dx + (centre[1] - from[1]) * dy + (centre[2] - from[2]) * dz) / l2));
          const qx = from[0] + dx * t - centre[0], qy = from[1] + dy * t - centre[1], qz = from[2] + dz * t - centre[2];
          if (qx * qx + qy * qy + qz * qz > (c.state.radius + p.radius) ** 2) continue;
          const data = c.view.bakeData();
          if (data.flesh.length === 0) continue;
          const field = chunkBakeField(data).field;
          const hp = traceProjectile(from, p.pos, q => field(q) - p.radius);
          if (!hp) continue;
          if (ctx.bake.jobs.pendingId === c.id) cancelChunkBake(ctx);
          ctx.bake.liveChunks.splice(ci, 1);
          c.view.object.visible = false;
          ctx.bake.spareViews.push(c.view);
          gibChunkMeat(ctx, c.template, hp);
          dead = true;
          break;
        }
      }
      if (!dead && p.pos[1] <= 0.02) dead = true;
      if (!dead) {
        // Level geometry: a point-in-AABB test is enough — pellets are
        // small and the substepped trace already bounds their travel.
        for (const b of ctx.world.colliders) {
          if (p.pos[0] > b.min[0] && p.pos[0] < b.max[0]
            && p.pos[1] > b.min[1] && p.pos[1] < b.max[1]
            && p.pos[2] > b.min[2] && p.pos[2] < b.max[2]) { dead = true; break; }
        }
      }
      if (!dead) {
        // Actors: bounding-sphere reject on the frame segment, then a
        // substepped trace against the posed field. Nearest hit wins.
        let bestDist = Infinity;
        let hitActor: ZombieActor | null = null;
        let hitPoint: Vec3 | null = null;
        const segLen = Math.hypot(p.pos[0] - from[0], p.pos[1] - from[1], p.pos[2] - from[2]);
        for (const a of ctx.world.actors) {
          const c = a.posed().clusters.find(cc => cc.limb === 'torso')?.center;
          if (!c) continue;
          // Segment-to-centre distance (clamped closest approach).
          const t = Math.max(0, Math.min(segLen,
            ((c[0]-from[0])*(p.pos[0]-from[0]) + (c[1]-from[1])*(p.pos[1]-from[1]) + (c[2]-from[2])*(p.pos[2]-from[2]))
            / (segLen * segLen || 1)));
          const qx = from[0] + (p.pos[0]-from[0]) * t / (segLen || 1);
          const qy = from[1] + (p.pos[1]-from[1]) * t / (segLen || 1);
          const qz = from[2] + (p.pos[2]-from[2]) * t / (segLen || 1);
          if (Math.hypot(qx-c[0], qy-c[1], qz-c[2]) > 1.35) continue;
          const posedA = a.posed();
          const hp = traceProjectile(from, p.pos, q => sdBody(q, posedA));
          if (!hp) continue;
          const d = Math.hypot(hp[0]-from[0], hp[1]-from[1], hp[2]-from[2]);
          if (d < bestDist) { bestDist = d; hitActor = a; hitPoint = hp; }
        }
        if (hitActor && hitPoint) {
          const l = Math.hypot(p.vel[0], p.vel[1], p.vel[2]) || 1;
          const dirN: Vec3 = [p.vel[0] / l, p.vel[1] / l, p.vel[2] / l];
          // hit/hitSlug RETURN the wound this impact stamped (pre-sever),
          // so the bleed emitter binds the exact wound instead of sniffing
          // the ring tail (a hit that also severs puts a stump there).
          if (!hitThisFrame.has(hitActor)) { hitActor.beginHits(); hitThisFrame.add(hitActor); }
          const hitTiming = ctx.telemetry.telemetry.begin();
          if (ctx.render.segMeshRenderer) {
            const sources = ctx.render.skeletonSources.get(hitActor)?.sources;
            if (sources) ctx.render.segMeshRenderer.impact(hitActor, sources, hitPoint, dirN, p.kind);
          }
          // A slug on a zombie's head bursts or ruptures it (game-head-damage.ts burst; while burstTuning.anyWeapon is
          // on, pellets too, once per shot); anything the leaf declines (not the head, not the plain zombie, off) takes
          // the ordinary path below. Routed by projectile kind, never by Wound.type (slugs stamp 'blast').
          const burstHandled = !!ctx.weapon.headDamage?.burst(hitActor, hitPoint, dirN, p.shot, p.kind);
          const stamped = burstHandled ? null
            : p.kind === 'slug'
              ? hitActor.hitSlug(hitPoint, dirN, p.shot)
              : hitActor.hit(hitPoint, dirN, p.shot);
          ctx.telemetry.telemetry.end('wound-hit', hitTiming);
          if (ctx.telemetry.telemetry.active) ctx.telemetry.telemetry.event('impact', {
            actor: hitActor.id, model: 'zombie', room: hitActor.room, kind: p.kind, stamped: !!stamped,
            world: hitPoint, direction: dirN, actorPose: hitActor.pose(),
            wound: stamped ? describeRecordedWound(ctx, hitActor, stamped) : null,
            woundCount: hitActor.wounds().length,
          });
          if (stamped) registerBleed(ctx, hitActor, stamped, p.kind, { point: hitPoint, incoming: dirN });
          dead = true;
        }
      }
      if (dead) ctx.weapon.pellets.splice(i, 1);
    }
    const flushTiming = ctx.telemetry.telemetry.begin();
    for (const a of hitThisFrame) a.endHits();
    if (ctx.telemetry.telemetry.active) for (const a of hitThisFrame) ctx.telemetry.telemetry.event('actor-wounds', {
      actor: a.id, model: 'zombie', pose: a.pose(), wounds: a.wounds().map(w => describeRecordedWound(ctx, a, w)),
      aliveRegions: a.posed().clusters.filter(c => c.alive).map(c => c.limb),
    });
    ctx.world.soldierCorpses?.update(ctx.world.actors,0); // restore damaged snapshots before this draw
    ctx.telemetry.telemetry.end('wound-flush', flushTiming);
    ctx.telemetry.telemetry.end('projectiles-and-hits', projectileTiming);
    ctx.telemetry.telemetry.lap('region', 'tick:post-hits');
    // SOLDIER PELLETS SIT OUTSIDE 'projectiles-and-hits' ON PURPOSE — see
    // the same argument at 'body-step'. This is work that did not exist when
    // that counter was calibrated on main, and quietly folding it in would
    // make new readings incomparable to recorded ones.
    // SOLDIER PELLETS: stepped, culled and drawn — never traced. Uses the
    // same integrator as the player's (semi-implicit Euler, gravity before
    // move); hand-rolling a second one would let the two drift apart.
    const soldierFrom = ctx.weapon.soldierPellets.map(p => [...p.pos] as Vec3);
    stepProjectiles(ctx.weapon.soldierPellets, dt);
    for (let i = ctx.weapon.soldierPellets.length - 1; i >= 0; i--) {
      const p = ctx.weapon.soldierPellets[i]!;
      if (expired(p) || ctx.world.colliders.some(box => segmentHitsBox(soldierFrom[i]!, p.pos, box))) {
        ctx.weapon.soldierPellets.splice(i, 1);
      } else if (segmentHitsCapsule(soldierFrom[i]!, p.pos, ctx.player.player.pos, PLAYER.radius, PLAYER.height)) {
        // The game loop: soldier pellets and cultist rounds hit the player (never actors).
        damagePlayer(ctx, VITALS.soldierPellet, 'pellet');
        ctx.weapon.soldierPellets.splice(i, 1);
      }
    }
    // ROCKETS (the warbull, rockets.ts): slow warheads that detonate on the
    // first thing they touch through the DYNAMITE path (detonateAt), so an
    // actor caught in one takes a bundle's wounds and gibs, and the player
    // takes the falloff share. Stepped here, after the actors, like the
    // pellets above; actors are coarse capsules at their feet.
    if (ctx.weapon.rockets.length) {
      const pp = ctx.player.player.pos;
      const stepped = stepRockets(ctx.weapon.rockets, dt, {
        hitsWorld: (from, to) => to[1] <= 0.02 || to[1] >= ceilingAt(ctx, to[0], to[2])
          || ctx.world.colliders.some(box => segmentHitsBox(from, to, box)),
        hitsPlayer: (from, to) => segmentHitsCapsule(from, to, pp, PLAYER.radius, PLAYER.height),
        hitsActor: (from, to, owner, armed) => ctx.world.actors.some(a =>
          (armed || a.id !== owner) && segmentHitsCapsule(from, to, a.pose().pos, 0.45, 2.0)),
      });
      ctx.weapon.rockets = stepped.live;
      for (const d of stepped.detonations) {
        ctx.telemetry.telemetry.event('rocket-detonate', { cause: d.cause, owner: d.owner, x: d.at[0], y: d.at[1], z: d.at[2] });
        detonateAt(ctx, d.at);
        const hurt = blastPlayerDamage(Math.hypot(pp[0] - d.at[0], pp[1] + PLAYER.height * 0.5 - d.at[1], pp[2] - d.at[2]));
        if (hurt > 0) damagePlayer(ctx, hurt, 'blast');
      }
    }
    // The eye every tracer billboards around this frame. Declared here (not
    // reused from the block below) because that one is scoped to the hit
    // pass; the streaks need it whether or not anything was hit.
    const tracerEye = eyeOf(ctx.player.player);
    while (ctx.weapon.rocketViews.length < ctx.weapon.rockets.length) {
      ctx.weapon.rocketViews.push(newTracerView(ctx));
    }
    for (let k = 0; k < ctx.weapon.rocketViews.length; k++) {
      const v = ctx.weapon.rocketViews[k]!;
      const r = ctx.weapon.rockets[k];
      // A rocket draws as a fat tracer at its own calibre (placeTracer reads
      // the radius); the slug kind gives it the heavy streak.
      if (r) placeTracer(ctx, v, { pos: r.pos, vel: r.vel, ageSec: r.ageSec, radius: ROCKET.radius, kind: 'slug' }, tracerEye);
      else hideTracer(ctx, v);
    }
    while (ctx.weapon.soldierPelletViews.length < ctx.weapon.soldierPellets.length) {
      ctx.weapon.soldierPelletViews.push(newTracerView(ctx));
    }
    for (let k = 0; k < ctx.weapon.soldierPelletViews.length; k++) {
      const v = ctx.weapon.soldierPelletViews[k]!;
      const p = ctx.weapon.soldierPellets[k];
      if (p) placeTracer(ctx, v, p, tracerEye);
      else hideTracer(ctx, v);
    }
    // Sync the mesh pool to the sim list — growing it on demand (the
    // pool is ONLY grown here; fire() must not touch meshes because it
    // runs from an evaluate() with no frame in between).
    while (ctx.weapon.pelletViews.length < ctx.weapon.pellets.length) {
      ctx.weapon.pelletViews.push(newTracerView(ctx));
    }
    for (let k = 0; k < ctx.weapon.pelletViews.length; k++) {
      const v = ctx.weapon.pelletViews[k]!;
      const p = ctx.weapon.pellets[k];
      // A slug is drawn at its own (larger) calibre — placeTracer reads the
      // projectile's radius, so no branch is needed here.
      if (p) placeTracer(ctx, v, p, tracerEye);
      else hideTracer(ctx, v);
    }
    // Chunks: ballistic step + world-space field repack, lab contract.
    // With the bake seam on, a chunk that has come to rest is retired
    // from the sim HERE (chunkSettled fires only on a grounded,
    // spin-free, flat, sub-millimetre-per-frame chunk — see gib-chunks.ts
    // for the clause-by-clause "has already stopped" argument) and its
    // march proxy is replaced by a static mesh. Reverse iteration: bake
    // SPLICES entries out of liveChunks.
    const chunkTiming = ctx.telemetry.telemetry.begin();
    const cdt = Math.min(dt, 1 / 30);
    // GUT ROPES first, so stepBlood's skip of 'gut' droplets this frame
    // sees this frame's chain positions (see stepGutRopes).
    stepGutRopes(ctx, cdt);
    // Bodies whose pre-tear window has closed become pieces HERE — after the
    // actors stepped above (so the pieces take the pose the body was drawn
    // in) and before the chunk step (so their impulses are released in the
    // same frame they are born).
    spawnScheduledGibs(ctx, dt);
    // The staged release's due impulses, BEFORE the chunk step, so a piece
    // that goes this frame integrates at its launch velocity for the whole
    // frame rather than a frame late.
    stepPendingGibImpulses(ctx);
    finishChunkBake(ctx);
    for (let ci = ctx.bake.liveChunks.length - 1; ci >= 0; ci--) {
      const c = ctx.bake.liveChunks[ci]!;
      // Keep the exact settled snapshot visible while its worker runs.
      // No disappearance, and no pose drift between sampling and swap.
      if (ctx.bake.jobs.pendingId === c.id) {
        c.view.update(c.state); // repair view resets (e.g. bone-mode changes) without moving the snapshot
        continue;
      }
      if (c.tag === 'flesh') {
        // A FLESH BIT (flesh-bits.ts) is never baked: it lives FLESH_BITS.lifeS, shrinking into the floor over
        // the last shrinkS, then its view goes back to the spares.
        c.age = (c.age ?? 0) + cdt;
        const k = fleshShrink(c.age);
        if (k <= 0) {
          ctx.bake.liveChunks.splice(ci, 1);
          c.view.object.visible = false;
          ctx.bake.spareViews.push(c.view);
          continue;
        }
        if (k < 1) {
          c.shrinkY0 ??= c.state.pos[1];
          c.state = { ...c.state, shrink: k, pos: [c.state.pos[0], c.shrinkY0 - (1 - k) * c.state.radius * 0.8, c.state.pos[2]] };
          c.view.update(c.state);
          continue;
        }
        // Settled: nothing moves until the shrink, so no step and no row rewrite (upload) per frame.
        if (chunkSettled(c.state)) continue;
      }
      c.state = stepChunk(c.state, cdt, chunkCollidersAt(ctx, c.state.pos));
      c.view.update(c.state);
      // A snapped eye and a flesh bit stay live pieces (never baked): tiny, and the eye keeps the eviction-last
      // guarantee.
      if (!c.tag && ctx.bake.enabled && ctx.bake.jobs.pendingId === null && !ctx.bake.jobs.error && chunkSettled(c.state)) {
        const t0 = performance.now();
        const data = c.view.bakeData();
        // Bone-only pieces retain their original SDF path.
        if (data.flesh.length > 0 && ctx.bake.jobs.submit(c.id, data)) {
          ctx.bake.input = data;
          ctx.bake.submitFrame = ctx.demo.simFrame;
          ctx.telemetry.telemetry.event('chunk-bake-request', { chunk: c.id, flesh: data.flesh.length, bones: data.bones.length });
        }
        ctx.bake.lastRequestMs = performance.now() - t0;
      }
    }
    // MESH GIBS (the head damage's modelled brain): the same stepChunk, dt and colliders as the SDF chunks.
    stepMeshGibs(ctx, cdt);
    // SPRITE PIECES, on the same clock and in the same block as the marched
    // ones — deliberately, because they are the same physics: `stepSpritePieces`
    // calls the same `stepChunk` with the same `chunkCollidersAt`, so a sprite
    // gib and a marched gib cannot disagree about where the wall is. What it
    // does NOT do is any of the bake: a settled sprite is parked, not retired
    // through a worker. Costs a loop over an empty array when the mode is off.
    if (ctx.vfx.spritePieces.live.length > 0 || ctx.vfx.spritePieces.rest.length > 0) {
      stepSpritePieces(ctx.vfx.spritePieces, {
        dt: cdt,
        cameraQuat: ctx.boot.handle.camera.quaternion,
        collidersAt: withCtx(ctx, chunkCollidersAt),
        liveCap: ctx.gibs.spriteLiveCap,
        restCap: ctx.gibs.spriteRestCap,
      });
    }
    ctx.telemetry.telemetry.end('chunks-and-guts', chunkTiming);
    const bloodTiming = ctx.telemetry.telemetry.begin();
    // BLEED — emitters spray (anchors recomputed from the CURRENT posed
    // prims, so droplets ride the walking body), flying chunks trail, and
    // the sim settles into splats. Runs even with the wander frozen: it is
    // a cosmetic sim exactly like the pellets and chunks above (a frozen
    // capture that fired still bleeds), and posed() is always current.
    if (ctx.vfx.bleedEnabled) {
      ctx.vfx.bleedClock += cdt;
      for (const e of ctx.vfx.bleed.live(ctx.vfx.bleedClock)) {
        const a = ctx.world.actors.find(q => q.id === e.bodyId);
        if (!a) { ctx.vfx.bleed.evictForBody(e.bodyId); continue; }
        const { anchor, normal } = woundEmitAnchorAndNormal(a.posed().prims, e.wound, a.pose().yaw, a.posed().split);
        e.acc = spawnWoundDroplets(
          ctx.vfx.bloodSim, e.kind, ctx.vfx.bleedClock - e.bornAt, anchor, normal, cdt, e.acc, rngStreams.bleed,
          woundStreamId(ctx, e.wound),
        );
      }
      // EVERY FLYING PIECE IS AN EMITTER, IN EITHER RENDER MODE. The owner,
      // playing the sprite mode: "there are no blood trails — the blood trails
      // should be in there as before." They were not: this call took only
      // `liveChunks`, which is EMPTY by construction in sprite mode (a sprite
      // piece has no marched view), so a sprite blast threw gore that trailed
      // nothing. The trail is a property of the PIECE, not of how it is drawn,
      // so both lists feed it.
      //
      // THE TWO ID SPACES ARE OFFSET, and that is load-bearing rather than
      // tidiness: `emitTrails` keys its per-emitter emission clock by id
      // (`sim.clocks[s.id]`), and chunk ids and sprite ids are INDEPENDENT
      // sequences that both start at 1. Merged raw, chunk 3 and sprite 3 would
      // share one clock, so a page that gibbed in one mode and then the other
      // would have the two pieces stealing each other's emission phase —
      // trails appearing and vanishing on the wrong bodies.
      emitTrails(
        ctx.vfx.bloodSim,
        [
          ...ctx.bake.liveChunks.map(c => ({
            id: c.id, pos: c.state.pos, vel: c.state.vel, stream: trailStreamId(ctx, c.id),
          })),
          // LIVE ONLY, not `rest`: the marched path's equivalent of a parked
          // sprite is a BAKED piece, and a baked piece is out of `liveChunks`
          // and therefore no longer trails. A stationary emitter would just
          // stack drops on one spot forever.
          //
          // The id is offset by SPRITE_TRAIL_ID_BASE so the two id sequences —
          // both of which start at 1 — cannot collide; `trailStreamId` is then
          // given the OFFSET id, so a sprite piece and a chunk never share an
          // emission stream either (the same separation, one layer down).
          ...ctx.vfx.spritePieces.live.map(p => ({
            id: SPRITE_TRAIL_ID_BASE + p.id, pos: p.state.pos, vel: p.state.vel,
            stream: trailStreamId(ctx, SPRITE_TRAIL_ID_BASE + p.id),
          })),
        ],
        cdt, rngStreams.bleed,
      );
      stepBlood(ctx.vfx.bloodSim, cdt, rngStreams.bleed);
      // Re-pose every instance from sim state (billboards track the camera
      // even frozen — same contract as the lab's always-sync).
      ctx.vfx.bloodView.sync(ctx.vfx.bloodSim, ctx.boot.handle.camera);
    }
    ctx.telemetry.telemetry.end('blood-simulation-and-sync', bloodTiming);
    ctx.telemetry.telemetry.lap('region', 'tick:post-blood');
    // The optional impact crown advances even with bleed off, so an event
    // already in flight finishes instead of freezing mid-burst.
    ctx.panels.impactSplashLayer?.step(cdt);
  }

  // Melee hit feedback: the shake offsets the eye (and so the look target,
  // which is taken from `eye` below: the view shakes, it does not swivel);
  // the flash drives the overlay.
  ctx.player.hitFeedback = stepHitFeedback(ctx.player.hitFeedback, dt);
  if (ctx.player.hitFlashEl) ctx.player.hitFlashEl.style.opacity = String(ctx.player.hitFeedback.flash * 0.55);
  // THE FLAIL'S IMPACT (flail-impact.ts, published by flail.timeScale):
  // its judder is SUMMED with the hit-feedback shake — x along the view's
  // right, y up — its pitch kick rides next to recoilPitch, and its roll
  // composes like the train's (rotateZ after the look).
  const eye0 = eyeOf(ctx.player.player), shake = ctx.player.hitFeedback.offset;
  const imp = ctx.weapon.impact, yaw = ctx.player.player.yaw;
  const eye: Vec3 = [
    eye0[0] + shake[0] + Math.cos(yaw) * imp.shake[0],
    eye0[1] + shake[1] + imp.shake[1],
    eye0[2] + shake[2] + Math.sin(yaw) * imp.shake[0],
  ];
  ctx.boot.handle.camera.position.set(eye[0], eye[1], eye[2]);
  const viewPitch = ctx.player.player.pitch + ctx.weapon.recoilPitch + imp.pitch;
  const cp = Math.cos(viewPitch);
  ctx.boot.handle.camera.lookAt(
    eye[0] + Math.sin(yaw) * cp,
    eye[1] + Math.sin(viewPitch),
    eye[2] - Math.cos(yaw) * cp,
  );
  if (imp.shake[2] !== 0) ctx.boot.handle.camera.rotateZ(imp.shake[2]);
  // THE FOV PUNCH. camera.fov moves, so the lens is re-synced IN THE SAME
  // BREATH (the CO-INVARIANT at FISHEYE_DEFAULTS.renderFovDeg): the render
  // and centre FOVs both narrow by the punch, the bend stays put. The
  // sdfLayer's cone geometry is left at the base FOV on purpose: a wider
  // cone than the pinched frame needs is conservative (sdf-layer.ts
  // setConeGeometry: a too-NARROW cone is the fatal one), and re-sizing
  // the layer every frame of a 0.27 s punch is not worth it. The render FOV
  // is restored EXACTLY from fovBase when the punch ends.
  if (imp.fovDeg !== imp.fovApplied) {
    if (imp.fovApplied === 0) imp.fovBase = ctx.boot.handle.camera.fov;
    ctx.boot.handle.camera.fov = imp.fovDeg === 0 ? imp.fovBase : imp.fovBase + imp.fovDeg;
    ctx.boot.handle.camera.updateProjectionMatrix();
    ctx.render.postAa.setLens(ctx.boot.handle.camera.fov, ctx.player.centerFovDeg + imp.fovDeg);
    imp.fovApplied = imp.fovDeg;
  }
  // The train's roll and bob ride on the view only (never the player or collision).
  applyTrainCamera(ctx, ctx.boot.handle.camera);
  applyDeathCamera(ctx, ctx.boot.handle.camera);
  applySequenceCamera(ctx, ctx.boot.handle.camera);
  ctx.boot.handle.camera.updateMatrixWorld();

  // Optional impact crown: rebuild from the current event times after the
  // camera is final (its sync takes the camera for parity; geometry is
  // world-space). No-op when the feature is off.
  ctx.panels.impactSplashLayer?.sync(ctx.boot.handle.camera);

  // GOO DENSITY QUADS — pose them from the same sim state, every frame,
  // AFTER the camera is final and before the drawFn composites. The lab
  // has always done this (lab-main: bloodView.sync then gooLayer.sync);
  // the game-page port shipped without it, and that ONE MISSING LINE is
  // why the goo never appeared here.
  //
  // Without sync the InstancedMesh keeps its zeroed instance matrices, so
  // every density quad is degenerate, the field is empty on every frame,
  // and NO threshold can ever be crossed. That is not a look bug with a
  // tuning fix — it is the pass rendering nothing at all, which is exactly
  // what five threshold sweeps and a depth-reconstruction investigation
  // were unknowingly chasing. There is a source tripwire on this call in
  // goo-layer.test.ts; do not remove one without the other.
  //
  // Unconditional, NOT under bleedEnabled like bloodView.sync above: floor
  // splats persist in the sim after bleed is switched off, and the goo
  // draws them. Gating this would freeze the pools mid-frame instead.
  const gooTiming = ctx.telemetry.telemetry.begin();
  // CANDIDATE connections: derived deterministically from the SAME droplet
  // array the sim already owns (no new particles, no new RNG). Set BEFORE
  // sync so the density instancer poses them in the same pass. When the
  // feature is off this clears any stale extras, so the shipped frame is
  // bit-identical again on the very next frame after disabling it.
  ctx.goo.layer?.setExtraBlobs(ctx.goo.connectionsEnabled
    ? connectionBlobsForSim(ctx.vfx.bloodSim.droplets, {
      enableStrands: ctx.goo.strandsEnabled, enableSheets: ctx.goo.sheetsEnabled,
    })
    : []);
  // SHUTTER BLUR PARTITION: when on, this sync poses only the sharp
  // remainder (pools/guts/leftover drops). The selected airborne partition is
  // posed and shaded later by the capture stage, exactly once. When off this
  // clears the selection, so the frame is the shipped fused goo.
  ctx.panels.shutterGame?.poseSharp();
  ctx.goo.layer?.sync(ctx.vfx.bloodSim, ctx.boot.handle.camera);
  // GIB SHUTTER PARTITION: lift this frame's moving pieces onto the blur
  // layer BEFORE the base scene renders (the draw callback follows this tick),
  // so the capture's clean background has no selected gib in it. When the
  // switch is off the list is empty and every mesh is put back where it was.
  // THE FLAIL rides the same layer (spike-flail Task 28): its ball and chain segments while a swing is
  // live and fast. Its subjects come from this tick's drawn chain and the camera placed above, so it runs
  // here, after the camera is final and before select(). Flail pieces go FIRST (the layer keeps the first
  // GIB_BLUR_MAX_PIECES). Called even with the switch off, so its prior stays one frame old.
  const flailBlur = ctx.weapon.flail?.blurSubjects() ?? [];
  if (ctx.gibs.shutter) {
    ctx.gibs.shutter.select(ctx.gibs.shutter.enabled ? [...flailBlur, ...gibBlurSubjects(ctx)] : []);
    if (!ctx.gibs.shutter.enabled) ctx.gibs.blurPrevKeys = new Set();
  }
  ctx.telemetry.telemetry.end('goo-sync', gooTiming);
  ctx.telemetry.telemetry.lap('region', 'tick:tail');
}
