// src/lab/sdf-zombie/webgpu/game-spawn.ts
//
// Spawning the cast: spawnEnemy (body, view, march settings, skeleton, kit), spawnAll, rebuildCast, and the game's march constants.
//
// Extracted from game-main.ts's main() closure. Each function takes the
// GameContext explicitly instead of capturing main()'s scope.
//
// Plan: docs/superpowers/plans/2026-09-17-game-main-decomposition.md

import type { GameContext } from './game-context';
import * as THREE from 'three/webgpu';
import { burstVolume, spawnImpactGout } from '../blood-sim';
import { type BuildResult } from '../build-body';
import { characterEntry } from '../character-registry';
import { woundWorldPos, type Wound } from '../damage';
import { headPopDebris } from '../head-pop';
import { LIGHT_PRESETS } from '../material';
import { hitFeedback } from '../player-hit-feedback';
import { spawnRocket } from '../rockets';
import { GUNNER_TUNING } from '../soldier-brain';
import { type Primitive, type Vec3 } from '../types';
import { bodyPrimStride } from '../validate';
import { compileCharacterSheet, createCharacterView } from './character-view';
import { type CrowdType } from './crowd-type';
import { makeSoldierMind, makeSwordMind, makeWarbullMind } from './enemy-mind';
import { createZombieActor, type ZombieActor } from './game-actor';
import { registerBleed } from './game-bleed';
import { crowdTypeFor } from './game-crowd-types';
import { applyStormBodyKey } from './game-dynamic-light';
import { shellAmpOf } from './game-hit-trace';
import { wanderBounds, type RoomDef } from './game-level';
import { damagePlayer } from './game-loop';
import { GAME_AA, GAME_AA_FADE_M, GAME_AA_NEAR, GAME_LAST_STEP_DEFAULT } from './game-march-accept';
import { clearMeshGibs } from './game-mesh-gibs';
import { applyMoonKey } from './game-outdoor';
import { bindSkeletonVolume, buildSkeletonSources, releaseSkeletonActor } from './game-skeleton-actors';
import { spawnPellets, spawnRound } from './game-weapon';
import { applyWoundRamp, faceFor } from './game-wound-vfx';
import { ZOMBIE_FLAT, headShape } from './game-zombie-face';
import { type LevelRoom } from './level-def';
import { VITALS } from './player-vitals';
import { rngStreams, seedFromUnit } from './rng';
import { CONE_LAYER, DEPTH_PREPASS_LAYER, REFINE_LAYER, SDF_LAYER } from './sdf-layer';
import { type GpuViewOpts } from './zombie-gpu';

/**
 * Over-relaxation factor for the game page's march (woundCfg2.y).
 *
 * 1.0 = OFF, which falls through to marchCfg.y = 0.6. X1.10 measured 1.4 as
 * the optimum in the LAB and it is tempting here — it drops mean steps from
 * 18.1 to 10.7 and appears to resolve far more flesh (room 4: 26841 -> 50685
 * hit pixels).
 *
 * IT FAILED ITS VISUAL GATE ON THIS PAGE (2026-08-31). Those extra "hits"
 * are FALSE, and they are box-shaped: large translucent rectangles washing
 * over the walls, exactly the screen extents of the bodies' proxy boxes.
 * Mechanism is the same one that produced the shell halo — above omega 1.0
 * the tracer does `t = tMax; clamped = true` and takes a FINAL CLAMPED
 * SAMPLE, and at the far side of a big proxy box the AA epsilon
 * (t * aaCfg.x, growing with distance) accepts that sample as a surface.
 *
 * Interesting wrinkle worth keeping: the outer-hull shell SUPPRESSES the
 * artifact, because the false hits sit on box pixels outside the hull and
 * the shell discards those before the march runs (room 3 measured 8773
 * fewer hits with the shell on at 1.4, room 4 only 87 — the difference is
 * how much box lies outside the hull). So 1.4 may become available once the
 * shell defaults on, but it is not a free win on its own.
 *
 * Do not raise this without re-running the visual gate.
 */
export const GAME_RELAX = 1.0;
/** Perf round 2, task 1: the hull exit bounds tMax on the un-relaxed march
 *  (perfCfg.x). `__sdfGame.setHullExitBound()` flips it for A/B.
 *  DEFAULT OFF (task 1b finding): at real-render parity the bound deletes a
 *  whole background body's visible pixels (room 3: 2055 px, one
 *  figure-shaped component) while the occupancy hit set stays bit-identical
 *  — a cross-body hull-texture effect, not a per-ray loss. Do not raise
 *  until task 1c's shell-exit diagnosis explains the deletion and both
 *  rooms pass the parity gate with the bound on.
 *
 *  FLIPPED TO 1 (close-up task 1b, 2026-09-04). Task 1c's diagnosis IS the
 *  deletion's explanation: the shell-out target was written through the
 *  scene fog (mix(dist, fogColor, smoothstep(near, far, viewZ))), so far
 *  bodies' exit distances read ~2.8 m at a true 9 m and the bound cut the
 *  march short of them — 4 of 9 bodies vanished from the census. With
 *  material.fog = false (occluder-hull.ts / shell-hull-outer.ts) the
 *  written distance is exact, and the re-taken census (scripts/
 *  sdf-exit-bound-census.mjs, five views: room 1 at 0.5/3/9 m + rooms 3/4
 *  standoff) reads hits/rasterised/meanStepsHit BIT-IDENTICAL on/off with
 *  pixel diffs at/below the noise floor — including the multi-body rooms
 *  where the deletion historically happened. The step win survives:
 *  missStepShare 0.58 → 0.46 (room-4 standoff), meanStepsHit unchanged;
 *  r2's timed −0.28 ms stands, and the frame-time A/B could not resolve
 *  ±1 ms on that night's machine (spread 11-40%, load quoted per row) —
 *  the flip rests on exactness + counters, not on that timing. */
export const GAME_HULL_EXIT_BOUND = 1;
/** Perf round 2, task 3: skip a wound's meta/cap texel loads when the
 *  sample is beyond the wound's reach (perfCfg.y). Exact-by-construction —
 *  see the march.wgsl.ts reach comment; `__sdfGame.setWoundEarlyOut()`
 *  flips it live for A/B. */
export const GAME_WOUND_EARLY_OUT = 1;
/**
 * Step multiplier for the game page's march (marchCfg.y). The lab ships
 * 0.6 (under-relaxed) to survive the fbm shell displacement, which this
 * page runs with amplitude 0. With a conservative field, 1.0 is plain
 * sphere tracing: exact, fewer steps, and it never enters the omega > 1
 * overshoot path that produced the 2026-08-31 box washes.
 * `__sdfGame.setOmega()` flips it live for A/B.
 */
export const GAME_OMEGA = 1.0;
/** Near-wound step multiplier the GAME ships (perfCfg.z; 0 would mean the
 *  shader's sound constant WOUND_STEP_MUL 0.6). 1.0 on the owner's look
 *  verdict (2026-09-05, own tab, stacked craters at close and mid range:
 *  "1.0 seems fine, no major visual differences"); the wounds bench prices
 *  the 0.6 zone at 6–30% of a wounded fill-screen frame. The lab keeps the
 *  sound constant — march-step-soundness.test.ts pins it below 0.6. */
export const GAME_WOUND_STEP = 1.0;
// Last-step secant accept (Claybook slide 25; MARCH_BODY's perfCfg.w).
// SHIPS AT 4 (2026-09-09): accepts the hit once the secant root through
// the last two samples is within 4 hit-epsilons. A/B on room 1 (8 walking
// bodies): 11.92 -> 10.17 ms; wound/gib-heavy rooms inside repeat spread;
// 1.1 m close-up pair visually identical. ?laststep=K overrides (0 = off,
// the pre-lever march bit for bit); __sdfGame.setLastStep() flips it live.
export const GAME_LAST_STEP = (() => {
  const raw = new URLSearchParams(location.search).get('laststep');
  if (raw === null) return GAME_LAST_STEP_DEFAULT;
  const v = Number(raw) || 0;
  return v > 0 ? Math.min(16, v) : 0;
})();
// The footprint-AA strength and the distance-based accept (aaCfg.y/z/w) are game-march-accept.ts's GAME_AA,
// GAME_AA_NEAR and GAME_AA_FADE_M.

/** Perf round 2, task 7: bodies RECEIVE the level's shadows. The twin
 *  light (dungeon-lighting.ts) renders a level-only depth map (layer 0 —
 *  no body hulls, so no self-shadowing) from the flashlight's pose; the
 *  march multiplies the KEY diffuse+specular by a 4-tap PCF lookup into
 *  it. One texture load per hit pixel, zero extra field evaluations.
 *  `__sdfGame.setLevelShadow(on)` flips it live; 0 is bit-for-bit the
 *  pre-task-7 march. NOT a level-shadow ABLATION for the bench: the twin's
 *  1024² map still renders — for the shadow-cost split use ?spotshadow=0,
 *  which kills both maps at boot. */
export const GAME_LEVEL_SHADOW = 1.0;
/** Height above the player's feet an enemy SMG or chaingun round is aimed at (m). */
export const SMG_TARGET_CHEST_Y = 1.25;

export function spawnEnemy(ctx: GameContext, name: string, room: RoomDef, start: Vec3, errs: string[]): ZombieActor {
  const enc = ctx.world.level.enclosureFor(room.name)!;
  const roomFurniture = ctx.world.level.furniture
    .filter(f => f.room === room.id)
    .map(f => ({ min: [f.minX, 0, f.minZ] as Vec3, max: [f.maxX, f.height, f.maxZ] as Vec3 }));
  // THE SHARED PATH (character-view.ts). Compile, bone-ratio override,
  // build, stance check, translate and the GPU view were all inline here and
  // all duplicated in lab-main; they are one module now, and this call is
  // the game's half of proving it. The game keeps everything BELOW this
  // point — the uniform stamping is the game's lighting and perf tuning,
  // not shared with a dev lab that lights its subject differently.
  //
  // The per-view tile binding is the GAME's (gameTiles), created here and
  // handed to the factory rather than made inside it: the game tracks every
  // binding it hands out so it can re-bin them, and the lab has no such
  // registry. It rides in through `gpu`, which is createZombieGpuView's own
  // parameter type, so nothing about the seam had to widen to carry it.
  const tileBinding = ctx.boot.gameTiles.createBinding();
  // DEFERRED MODE GPU OPTIONS. The view becomes a level-only surface
  // producer (unlit G-buffer; the deferred light stage lights it), and the
  // legacy pre-pass sources are NOT bound: sdf-layer.render never runs in
  // this mode, so its targets would stay uninitialised (the lazy-init
  // submit conflict sdf-layer's targetsNeedInit comment describes). Every
  // one of these opts is optional by construction — the task-2 producer
  // fixture is the precedent — and the fetch identities make the march
  // bit-identical without them. LEVEL-ONLY receiver: a character's own
  // inflated hull casts onto the ROOM (the full map) but must not swallow
  // its own illumination (the level-only map).
  // CROWD SLOT, RESERVED BEFORE THE VIEW IS BUILT (defer-compile task,
  // 2026-09-19). A material binds its data texture at CREATION, so a view
  // built on its own single-band atlas and later `rebind`-ed to the type's
  // shared atlas still samples the stale own atlas. That is fine while the
  // crowd mesh draws, but it breaks the per-body FALLBACK that keeps crowd
  // members visible while the crowd program compiles. Reserve the slot here
  // and hand the shared sink/records/slot to createZombieGpuView; attachAt()
  // below only marks the slot and stores the view.
  //
  // Reserved from INSIDE createCharacterView's gpu callback (per-body data
  // texture widths, 2026-09-24): the crowd type's atlas is sized to the
  // first body's primStride, so the body must exist first. The callback runs
  // after the build and before the view, which keeps the ordering above.
  // A body wider than an existing type's atlas does not join it — it draws
  // per-body, like a full type.
  let crowdAttach = null as { type: CrowdType; slot: number } | null;
  const crowdViewOptsFor = (built: BuildResult): GpuViewOpts => {
    if (!ctx.crowd.on) return {};
    const stride = bodyPrimStride(built);
    const t = crowdTypeFor(ctx, name, room.id, stride);
    if (t.atlas.stride < stride) {
      console.warn(`[crowd] ${name}: body needs a ${stride}-wide atlas, type has ${t.atlas.stride}; drawing per-body`);
      return {};
    }
    const slot = t.reserveSlot();
    if (slot < 0) { console.warn('[crowd] type full', name); return {}; }
    crowdAttach = { type: t, slot };
    return {
      sink: t.atlas.sink(slot),
      sinkTexture: t.atlas.texture,
      records: t.records,
      slot,
    };
  };
  const viewGpuOpts: GpuViewOpts = {
    // The dynamic probe layer's storage node (P3/P4). Bound at material
    // creation like the tile binding — a storage node cannot be rebound.
    ...(ctx.probes.gather ? { probeDyn: { node: ctx.probes.gather.probeDynNode } } : {}),
    // The shared light list's storage node (plan 1 task 9), bound at material
    // creation like probeDyn. The per-actor loop turns lightListCfg.x on (task 10).
    ...(ctx.world.light?.list ? { lightList: { node: ctx.world.light.list.node } } : {}),
    // DEFERRED MODE: no cone twin binding. sdf-layer.render never runs in
    // this mode, so the cone target would stay uninitialised — a WebGPU
    // lazy-init submit conflict that rejects the WHOLE producer pass
    // (symptom: an empty G-buffer, black world behind the forward
    // viewmodel). The tile binding is undefined unless the DEV
    // ?tiles-playtest is on (game-tile-playtest gates it), so it rides in
    // both modes harmlessly. Tiles are re-enabled for the surface path by
    // the same playtest, which bins them itself.
    ...(ctx.boot.deferredMode ? {
      output: 'surface' as const,
      shadowReceiver: 'level-only' as const,
      ...(tileBinding ? { tiles: tileBinding } : {}),
    } : {
      cone: ctx.render.sdfLayer.cone,
      tiles: tileBinding,
      occluder: ctx.render.sdfLayer.occluder,
      // The outer hull's bounds. Passing them unconditionally is safe:
      // the fetch identities (0 / 1e9) make the march bit-identical while
      // sdfLayer.shellEnabled is false, which is the ship default.
      shell: {
        entry: ctx.render.sdfLayer.shellEntry.texture,
        exit: ctx.render.sdfLayer.shellExit.texture,
        uniforms: ctx.render.sdfLayer.shellEntry.uniforms,
      },
      prev: ctx.render.sdfLayer.prev,
      // Temporal reprojection start (plan 2026-09-10): passed
      // unconditionally like prev — cfg.x 0 is the fetch identity.
      lastFrame: ctx.render.sdfLayer.lastFrame,
      // The quarter-res depth prepass (close-up task 3). Passed
      // unconditionally like the shell bounds — the fetch identities make
      // the march bit-identical while sdfLayer.depthPreEnabled is false,
      // which is the ship default. Chunks get NO twin: a missing start is
      // conservative (they march from today's start), and the shared chunk
      // material's single-node-graph trick is not worth rethinking for a
      // few dozen boxes.
      depthPre: ctx.render.sdfLayer.depthPre,
      // Run 5: the output-res refine twins. Null unless the boot allocated refine (?refine=1),
      // in which case createZombieGpuView builds a third twin mesh on REFINE_LAYER.
      refine: ctx.render.sdfLayer.refineSource ?? undefined,
      levelShadow: { light: ctx.lighting.flashlight.levelShadow },
    }),
  };
  // DEFERRED MODE: kit and prop load ASYNC and are added to the scene when
  // their glTF resolves — a per-actor group is what lets ONE registration
  // (propagated to descendants by the router's sync) catch them whenever
  // they land, including across rebuilds. Legacy adds them straight to the
  // scene, unchanged (the group is not even attached there).
  const rigGroup = new THREE.Group();
  rigGroup.name = `deferred-rig-${name}-${start[0]!.toFixed(2)}-${start[2]!.toFixed(2)}`;
  if (ctx.boot.deferredMode) ctx.boot.handle.scene.add(rigGroup);
  const character = createCharacterView({
    name,
    start,
    renderer: ctx.boot.handle.renderer,
    scene: ctx.boot.deferredMode ? rigGroup : ctx.boot.handle.scene,
    effectsScene: ctx.vfx.characterEffects.scene,
    errors: errs,
    // The panel's ratio, once the owner has touched it, overrides whatever
    // the doc would have done (nothing today; an authored ratio from the
    // bones block, later).
    ...(ctx.render.boneRatioOverride !== null ? { boneRatio: ctx.render.boneRatioOverride } : {}),
    gpu: (built) => ({ ...viewGpuOpts, ...crowdViewOptsFor(built) }),
  });
  const placed = character.body;
  const view = character.gpu;
  ctx.boot.gameTiles.track(view, tileBinding);
  // Bone tubes: with the mesh ON the field stops packing bone rows (task 5).
  view.setPackBones(!ctx.render.boneMesh);
  // A character's OWN palette (its .blob block) wherever it declares one —
  // was soldier-only, so the cultist's matte tan robe played in the game as
  // the zombie's wet black latex. The zombie keeps the panel-tunable flesh.
  view.applyMaterial(name !== 'zombie' ? character.palette ?? ctx.vfx.flesh : ctx.vfx.flesh,
    LIGHT_PRESETS['practical-hard-key']);
  // Outdoor v1 §7: a body in an open room takes the moon as its key light.
  if ((room as Partial<LevelRoom>).sky) applyMoonKey(ctx, view.uniforms);
  // Storm levels (Night Train): the body's base key is cold, not the practical's orange — the
  // crowd draw shares these uniforms, so this is what every crowd body is lit with.
  applyStormBodyKey(ctx, view.uniforms);
  // The panel's ramp rides ON TOP of the material: applyMaterial just
  // wrote the preset defaults, so a tuned panel must re-stamp its values
  // or a rebuild would silently reset the ramp (the silent-reset class
  // of bug this panel exists to kill).
  applyWoundRamp(ctx, view);
  // Relaxation, explicit rather than inherited from the uniform default —
  // see GAME_RELAX for why it is 1.0 and what happened when it was 1.4.
  view.uniforms.woundCfg2.value.y = GAME_RELAX;
  view.uniforms.perfCfg.value.x = GAME_HULL_EXIT_BOUND;
  view.uniforms.perfCfg.value.y = GAME_WOUND_EARLY_OUT;
  view.uniforms.marchCfg.value.y = GAME_OMEGA;
  view.uniforms.perfCfg.value.z = GAME_WOUND_STEP;
  view.uniforms.perfCfg.value.w = GAME_LAST_STEP;
  view.uniforms.normalGradientCfg.value.set(ctx.telemetry.normalGradientMode, ctx.telemetry.normalGradientDebug, 0, 0);
  view.uniforms.aaCfg.value.y = GAME_AA;
  (view.uniforms.aaCfg.value as unknown as { z: number; w: number }).z = GAME_AA_NEAR;
  (view.uniforms.aaCfg.value as unknown as { z: number; w: number }).w = GAME_AA_FADE_M;
  view.uniforms.aaCfg.value.x = ctx.render.sdfLayer.pixelConeK;
  view.uniforms.levelShadowCfg.value.x = GAME_LEVEL_SHADOW;
  const face = name === 'zombie'
    ? { tex: ctx.vfx.faceTex, atlas: ctx.vfx.faceAtlas, mean: ZOMBIE_FLAT.mean }
    : faceFor(ctx, name);
  view.setFaceTexture(face.tex, face.atlas, face.mean);
  view.uniforms.faceCfg.value.x = 1;
  view.uniforms.faceCfg.value.y = 1.0;
  // The character's OWN projection when its .blob declares a sheet block;
  // the zombie's hand-tuned default otherwise. Passing the zombie's numbers
  // to a body with its own bake is what strips a character's face.
  const sheet = name === 'zombie' ? null : compileCharacterSheet(characterEntry(name)).sheet;
  if (sheet) {
    view.uniforms.faceProj.value.set(
      sheet.projScaleX, sheet.projScaleY, sheet.projCentreX, sheet.projCentreY,
    );
    // Keep the soldier's authored face consistent with the lab. Projection
    // alone still left the zombie's full-strength tint, relief and glow on
    // his head, washing out the jaw and turning the entire face orange.
    // Every non-zombie character with a sheet block (was soldier-only):
    // the cultist's `sheet enabled 0` must switch the zombie's generated
    // face OFF, or his prim face wears the zombie's painted one.
    {
      view.uniforms.faceCfg.value.set(
        sheet.enabled ? (sheet.decal > 0.5 ? 2 : sheet.blendLuma > 0.5 ? 3 : 1) : 0,
        sheet.texStrength, sheet.faceForward, sheet.texRelief,
      );
      view.uniforms.faceCfg2.value.x = sheet.projSpherical;
      view.uniforms.faceCfg2.value.z = sheet.eyeGlowCut;
      view.uniforms.faceCfg2.value.w = sheet.eyeGlowAmp;
      view.uniforms.faceGlowRedOnly.value = sheet.eyeGlowRedOnly;
    }
  } else {
    view.uniforms.faceProj.value.set(0.45, 0.58, 0.5, 0.56);
  }
  const skull = headShape(placed);
  if (skull) view.setHeadShape(skull.centre, skull.axes);
  // The room's enclosure: bounds + albedos, with the page's probeWeight.
  view.uniforms.boxMin.value.set(...enc.box.min);
  view.uniforms.boxMax.value.set(...enc.box.max);
  view.uniforms.wallNegX.value.setRGB(...enc.walls.negX);
  view.uniforms.wallPosX.value.setRGB(...enc.walls.posX);
  view.uniforms.wallNegY.value.setRGB(...enc.walls.negY);
  view.uniforms.wallPosY.value.setRGB(...enc.walls.posY);
  view.uniforms.wallNegZ.value.setRGB(...enc.walls.negZ);
  view.uniforms.wallPosZ.value.setRGB(...enc.walls.posZ);
  view.uniforms.bounceCfg.value.set(ctx.probes.weight, 4, 1, 1);
  ctx.world.roomProbes.bind(view.uniforms, room.id);
  // CROWD STAGE A: attach BEFORE the layers/registration block so the
  // deferred router can skip the per-body producer, and before the actor
  // exists (a slot is actor-independent). The slot was reserved above and the
  // view was BUILT on that same shared atlas band, so attachAt() only marks
  // it (rebind is idempotent here) — the per-body fallback can then draw the
  // view's OWN material against the shared data.
  if (crowdAttach) {
    const t = crowdAttach.type;
    t.attachAt(view, crowdAttach.slot);
    if (!ctx.crowd.sourceView.has(t)) ctx.crowd.sourceView.set(t, view);
    ctx.crowd.typeOfView.set(view, t);
    // attach/detach is the crowd's visibility gate, so the per-body proxy
    // and its depth-pre twin stay in the scene but hidden. They ARE drawn
    // while the crowd program is not ready: the draw fn re-shows them each
    // frame (`setBodies` only does so with the depth gate ON — the cold-cache
    // flesh bug), which is the degrade that keeps members visible.
    view.object.visible = false;
    if (view.depthPreObject) view.depthPreObject.visible = false;
    // The per-body fallback marches out of the SHARED record buffer, so tell
    // the view's own material which record slot it owns: instCfg.z is the
    // base slot mapBody loads (z = 0 only for the old single-owner case).
    // instCfg.y stays 0 (the per-body entry) and instCfg.x is 1.
    (view.instCfg.value as THREE.Vector4).z = crowdAttach.slot;
    // Stage-a gap: one segVolumeMeta per type, so only the first instance
    // can bone-cull in 'segment' pose mode. Cluster culling needs no
    // per-instance pose and stays honest for every instance.
    view.setBoneCullMode('cluster');
    if (view.refineObject) {
      view.refineObject.visible = false;
      if (!ctx.crowd.refineWarned) {
        ctx.crowd.refineWarned = true;
        console.warn('[crowd] refine twins are not supported in crowd mode (stage 3)');
      }
    }
  }
  view.object.layers.set(SDF_LAYER);
  view.coneObject.layers.set(CONE_LAYER);
  if (view.depthPreObject) {
    view.depthPreObject.layers.set(DEPTH_PREPASS_LAYER);
    ctx.boot.handle.scene.add(view.depthPreObject);
  }
  if (view.refineObject) {
    view.refineObject.layers.set(REFINE_LAYER);
    ctx.boot.handle.scene.add(view.refineObject);
  }
  ctx.boot.handle.scene.add(view.object);
  ctx.boot.handle.scene.add(view.coneObject);
  // DEFERRED MODE registrations: the proxy box is the SDF producer; the
  // coarse twin (always built) and the depth-pre twin (legacy only — the
  // deferred view opts omit it) are march helpers that must never reach a
  // G-buffer or forward pass; the kit/prop group is level-only tissue.
  if (ctx.boot.deferredApi) {
    // A crowd-attached view is one instance of a shared type draw; its own
    // producer material must NOT also feed the G-buffer.
    if (!crowdAttach) ctx.boot.deferredApi.router.register(view.object, 'sdf');
    ctx.boot.deferredApi.router.register(view.coneObject, 'exclude');
    if (view.depthPreObject) ctx.boot.deferredApi.router.register(view.depthPreObject, 'exclude');
    if (view.refineObject) ctx.boot.deferredApi.router.register(view.refineObject, 'exclude');
    ctx.boot.deferredApi.router.register(rigGroup, 'mesh', 'level-only');
  }
  const zombieId = ctx.boot.nextId++;
  rigGroup.userData.gameActorId = zombieId;
  const actor = createZombieActor({
    id: zombieId, room: room.id, body: placed, view, character, start,
    boundedWounds: ctx.vfx.boundedWoundPreview,
    // A SWORD profile (motion-profile.ts `melee.kind === 'sword'`, the
    // bride) gets the ring brain on SWORD_TUNING plus strike contact and
    // the lunge's root advance (enemy-mind.ts makeSwordMind).
    ...(characterEntry(name).profile.melee?.kind === 'sword' ? {
      mind: makeSwordMind(),
    } : {}),
    // A RANGED profile (motion-profile.ts `gunner`) gets the shooting brain
    // on its weapon's tuning — the soldier's shotgun, the cultist's tommy
    // gun, the juggernaut's chaingun. Was `name === 'soldier'`.
    ...(characterEntry(name).profile.gunner ? {
      mind: characterEntry(name).profile.charger
        ? makeWarbullMind(GUNNER_TUNING[characterEntry(name).profile.gunner!.weapon])
        : makeSoldierMind(GUNNER_TUNING[characterEntry(name).profile.gunner!.weapon]),
      onFire: ({ origin: muz, direction: dir }) => {
        if (!character.prop || character.prop.released) return;
        ctx.world.encounter.shot(zombieId);
        // ONE barrel: the double-barrel volley is the player's signature,
        // and the soldier throwing the same wall of lead reads as a second
        // player rather than an enemy.
        // THE TOMMY GUN CLIMBS. Each round's fire kick lifts the carry, and a
        // 6-7 round burst at ~7 rounds/s walked the stream into the ceiling
        // (2026-09-23 capture). The barrel still climbs on screen; the ROUNDS
        // keep the gun's heading (the brain's aim error, so bursts can miss
        // sideways) but take their vertical from the player's chest. The
        // soldier's single shotgun round is unchanged. The juggernaut's
        // chaingun gets the same treatment: its heading is the SWEEP (the
        // slow turn the player outruns), its vertical the player's chest.
        const weapon = characterEntry(name).profile.gunner?.weapon;
        let shotDir = dir;
        if (weapon === 'smg' || weapon === 'chaingun' || weapon === 'rocket') {
          const pp = ctx.player.player.pos;
          const hx = dir[0], hz = dir[2], hl = Math.hypot(hx, hz) || 1;
          const dist = Math.hypot(pp[0] - muz[0], pp[2] - muz[2]);
          const rise = (pp[1] + SMG_TARGET_CHEST_Y) - muz[1];
          const l = Math.hypot(dist, rise) || 1;
          shotDir = [hx / hl * dist / l, rise / l, hz / hl * dist / l];
        }
        // The chaingun fires ONE round per trigger event (game-weapon.ts
        // spawnRound); the shotgun and the tommy gun keep their volley.
        // The warbull's launcher fires ONE slow rocket per trigger event
        // (rockets.ts), aimed like the tommy gun: the arm's heading, the
        // player's chest for the vertical. It detonates through the
        // dynamite path (the rocket step in the frame loop below).
        if (weapon === 'rocket') ctx.weapon.rockets.push(spawnRocket(muz, shotDir, zombieId));
        else if (weapon === 'chaingun') ctx.weapon.soldierPellets.push(spawnRound(muz, shotDir, seedFromUnit(rngStreams.misc())));
        else ctx.weapon.soldierPellets.push(...spawnPellets(muz, shotDir, 1, seedFromUnit(rngStreams.misc())));
      },
    } : {}),
    profile: characterEntry(name).profile,
    seed: 1337 + ctx.boot.nextId * 101,
    bounds: wanderBounds(room),
    furniture: roomFurniture,
    navigation: ctx.world.encounterNav,
    onSever: (piece, stumpWound) => ctx.boot.onSeverDispatch?.(actor, piece, stumpWound),
    // A melee hit on the player. There is no player health, so a hit is
    // FEEDBACK only: the red flash, the camera shake and the counter
    // (player-hit-feedback.ts). Every actor gets it; the zombie mind never
    // reports contact, so for the zombie this never fires. No sound: the
    // SDF game loads no audio at all, so there is none to reuse.
    onMeleeContact: ({ variant }) => {
      ctx.player.hitFeedback = hitFeedback(ctx.player.hitFeedback, variant);
      // A landed blade hurts; the warbull's charge (a charger's 'shove',
      // charge.ts, one per run) hurts twice as much. Its brawl swings keep
      // the sword's value.
      const charged = characterEntry(name).profile.charger && variant === 'shove';
      damagePlayer(ctx, charged ? VITALS.chargeHit : VITALS.swordHit, 'melee');
    },
    // HEAD POP (soft targets — the cultist, owner 2026-09-24: Scanners). The
    // head has swollen (game-actor inflateHead); now a VOLUMETRIC burst from
    // the whole swollen head (blood-sim.ts burstVolume — the 10-bead point
    // burst read as a thin mist), a slug gout along the shot, the neck
    // bleeds, and the head itself flies apart (head-pop.ts).
    ...(characterEntry(name).profile.soft ? {
      onHeadPop: (head: { origin: Vec3; prims: Primitive[] }, dir: Vec3, stumpWound: Wound | null) => {
        const at = head.origin;
        ctx.telemetry.telemetry.event('sever', { actor: actor.id, limb: 'head' });
        let rad = 0.08;
        for (const p of head.prims) for (const e of [p.a, p.b]) rad = Math.max(rad, Math.hypot(e[0] - at[0], e[1] - at[1], e[2] - at[2]));
        burstVolume(ctx.vfx.bloodSim, at, Math.min(rad, 0.25), [dir[0] * 1.5, 0.5, dir[2] * 1.5], rngStreams.bleed, ctx.boot.nextEmitterStream++);
        const l = Math.hypot(dir[0], dir[1] + 0.6, dir[2]) || 1;
        spawnImpactGout(ctx.vfx.bloodSim, 'slug', at, [dir[0] / l, (dir[1] + 0.6) / l, dir[2] / l], rngStreams.bleed, ctx.boot.nextEmitterStream++);
        if (stumpWound) registerBleed(ctx, actor, stumpWound, 'stump');
        ctx.render.segMeshRenderer?.explodeSkull(actor,ctx.render.skeletonSources.get(actor)?.sources ?? [],dir);
        ctx.boot.onGoreDispatch?.(actor, headPopDebris(head, dir, rngStreams.misc));
      },
    } : {}),
  });
  // Ship default + any live toggle: a late spawn must not fall back to the
  // flat bone fold while the rest of the room culls.
  if (crowdAttach) actor.crowd = crowdAttach;
  actor.view.setBoneCullMode(crowdAttach ? 'cluster' : ctx.render.boneCullMode);
  actor.view.setRefineTail(ctx.render.refineTailWanted);
  // skeleton=mesh: contract sources at REST bind (before any tick steps
  // the rig — stepActorMotion rewrites restPose, which limb local frames
  // are derived from), then the field drops this actor's bone rows so
  // the segment meshes are the ONLY bone surface (smax-then-min exposure
  // via depth composition — mesh-renderer.ts header).
  if (ctx.render.segMeshCache) {
    ctx.render.skeletonSources.set(actor, buildSkeletonSources(ctx, actor, name));
    actor.view.setPackBones(false);
    actor.view.setPackOrgans(ctx.render.organMode !== 'mesh');
  }
  // Task 3 is zombie-first. Other characters keep exact procedural bones
  // until their source fixtures have been validated.
  if (ctx.render.segVolumeCache && name === 'zombie') bindSkeletonVolume(ctx, actor, name);
  ctx.world.encounterHomes.set(actor.id,[...start] as Vec3);
  if (characterEntry(name).profile.melee?.kind === 'sword') ctx.world.loop?.biteExempt.add(actor.id);   // swings, never bites
  return actor;
}

export function spawnAll(ctx: GameContext, errs: string[]): void {
  // ?spawn=<character> (playtest): every ZOMBIE slot spawns that registry
  // character instead, e.g. ?spawn=cultist, ?spawn=warbull. Soldier,
  // cultist, juggernaut and warbull slots keep their kind (level-def
  // SpawnKind).
  for (const s of ctx.world.level.spawnList()) {
    const name = s.kind === 'zombie' ? ctx.boot.spawnOverride ?? 'zombie' : s.kind;
    ctx.world.actors.push(spawnEnemy(ctx, name, s.room, s.pos, errs));
  }
}

/** The wound panel's boneRatio lever (applyWoundTuning calls this). Bones
 *  are derived at BUILD time and packed into the prim data texture — there
 *  is no live repack — so the only honest way to apply a new ratio is to
 *  rebuild the cast through the same spawn path as boot. Wound state on
 *  the old bodies dies with them (the slider's tooltip says so). Ids
 *  continue from nextId, so capture scripts re-query rather than assume.
 *  Both hulls re-arm immediately: the frame-loop hull update is gated on
 *  !wanderFrozen, and a FROZEN bench leg calling setWoundTuning must not
 *  march through a stale hull. */
export function rebuildCast(ctx: GameContext): void {
  // Head damage state (and any dangling eye's piece) belongs to the old cast; so do its brain mesh gibs.
  ctx.weapon.headDamage?.reset();
  ctx.weapon.headSplit?.reset();
  clearMeshGibs(ctx);
  ctx.world.soldierCorpses?.dispose();
  ctx.world.encounter.clear(); ctx.world.encounterHomes.clear();
  // DRAIN IN-FLIGHT RUPTURES FIRST. Their actors are about to be disposed and
  // their queued impulses reference chunks from the pool that is also being
  // rebuilt; a window that survived the reset would gib a stale actor or
  // launch a stale id on the next tick.
  for (const q of ctx.gibs.pendingGibs) q.actor.endTear();
  ctx.gibs.pendingGibs.length = 0;
  ctx.gibs.pendingGibImpulses.length = 0;
  // The old source views are disposed below; refill from the rebuilt cast.
  ctx.crowd.sourceView.clear();
  ctx.crowd.volumeBound.clear();
  for (const a of ctx.world.actors) {
    releaseSkeletonActor(ctx, a);
    ctx.boot.handle.scene.remove(a.view.object);
    ctx.boot.handle.scene.remove(a.view.coneObject);
    if (a.view.depthPreObject) ctx.boot.handle.scene.remove(a.view.depthPreObject);
    if (a.view.refineObject) ctx.boot.handle.scene.remove(a.view.refineObject);
    if (a.character) a.character.dispose();
    else a.view.dispose();
  }
  // No mesh may retain a geometry while the shared cache frees it. Clear
  // actor slots first, then dispose reusable cached geometries; the next
  // frame repopulates both from the rebuilt cast.
  ctx.render.segMeshRenderer?.clear();
  ctx.render.segMeshCache?.dispose();
  ctx.world.actors.length = 0;
  const errs: string[] = [];
  spawnAll(ctx, errs);
  if (errs.length > 0) {
    console.error('[sdf-game] rebuilt body errors:', errs.join(' | '));
  }
  // The exclusion logic mirrors the refreshHull seam, which lives below
  // this point — object properties do not hoist, so it is restated here.
  ctx.render.occluderHull.update(
    ctx.world.actors.map(a => a.posed()),
    ctx.render.hullExclusionsEnabled
      ? ctx.world.actors.flatMap(a => {
        const prims = a.posed().prims;
        const yaw = a.pose().yaw;
        return a.visualWounds().map(w => ({ centre: woundWorldPos(prims, w, yaw), radius: w.radius }));
      })
      : [],
  );
  if (ctx.render.sdfLayer.shellEnabled) {
    ctx.world.outerHull.update(ctx.world.actors.map(a => a.posed()), { shellAmp: shellAmpOf(ctx) });
  }
}
