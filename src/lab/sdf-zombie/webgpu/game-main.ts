import { impactSplashPresets, impactSplashProfiles, resolveImpactSplashProfile, type ImpactSplashProfile, type ImpactSplashWeapon } from './impact-splash-profiles';
import { createEncounterNavigation } from './encounter-navigation';
import { createEncounterDirector, clearSight, type EncounterAgent } from './encounter-director';
import { createSoldierCorpseBakes } from './soldier-corpse-bake';
import { buildNormalBodyPointFn } from './normal-gradient.wgsl';
import { finiteGradient, woundGradient, type V3, type WoundInput } from './normal-gradient-reference';
import { classifyNormalSupport, normalHitPoint } from './normal-gradient-support';
// src/lab/sdf-zombie/webgpu/game-main.ts
//
// sdf-game.html — the grey-box ring the owner walks to judge on-screen enemy
// counts. Four rooms, tunnels with arched mouths, 1/2/3/4 wandering zombies,
// a first-person player, and per-room environment bounce on the SDF bodies.
//
// NOT the lab: no panel, no wounds, no chunks, no dynamite. The combat
// wiring belongs to the grapeshot dispatch that follows; this page owns the
// walkable world and the actors, and exposes them through window.__sdfGame
// (see the bottom of the file — that hook is the seam the weapon builds on).
//
// Renderer stack mirrors bench-main.ts (createLabRenderer + createSdfLayer +
// createPostAa + createOccluderHull), NOT lab-main.ts — the bench is the
// small example of standing this up without the lab's control panel.
//
// BOUNCE. Each zombie's view carries the enclosure of the room it stands in
// (boxMin/boxMax + six wall albedos). practical-hard-key ships probeWeight 0,
// at which ambientAt early-outs to flat fill and the wall albedos do NOTHING
// — so this page parks probeWeight at DEFAULT_PROBE_WEIGHT and exposes it on
// [ and ] (plus __sdfGame.setProbeWeight) for the owner's flat->full slide.
// ambientGain 4 / chromaGain 1 are owner-tuned; left alone.

import * as THREE from 'three/webgpu';
import {
  createLabRenderer, type RenderCap,
} from './lab-renderer';
import {
  initialAdaptiveState, stepAdaptive, scaleForRung, SCALE_LADDER,
} from '../adaptive-scale';
import { WOUND_STEP_MUL, ROW_WOUND, ROW_WOUND_META, ROW_WOUND_CAP, ROW_PRIM_SHAPE, ROW_PRIM_COLOR, ROW_PRIM_A, ROW_PRIM_B, ROW_PRIM_SCALE, ROW_PRIM_QUAT, ROW_CLUSTER_RANGE, ROW_CLUSTER_BOUNDS } from './march.wgsl';
import { createSdfLayer, SDF_LAYER, CONE_LAYER, OCCLUDER_LAYER, SHADOW_HULL_LAYER, SHELL_LAYER, SHELL_EXIT_LAYER, DEPTH_PREPASS_LAYER, FIELD_MESH_LAYER, REFINE_LAYER } from './sdf-layer';
import { createFlashlight, DUNGEON_RIG, GALLERY_RIG, type AmbientRig } from './dungeon-lighting';
import { ProbeLightingNode, createProbeLevelSlots, levelLightsNode, levelMatchedGain } from './probe-lighting-node';
import { GOBLIN_SKIN } from './goblin-skin';
import { GOBLIN_ARM_GLB, aimArm, loadGoblinArms, type GoblinArms } from './game-arms';
import { flashPixels, smokePixels } from './flash-sprite';
import {
  TRACER, emberPixels, faceEyeBasis, tracerBasis, tracerHeadOn, tracerLength,
  tracerNearFade, tracerNearScale, tracerPixels, type TracerBasis,
} from './tracer-sprite';
import {
  BOB, FREE_AIM, approachAngle, approachBob, bobPose, moveAim, pivotOffset, turnFromAim,
  weaponAngles, weaponSlide, type AimPoint, type Frustum,
} from './free-aim';
import {
  FLASH, MAGAZINE_CAPACITY, RECOIL, RELOAD, CHAMBER_DEPTH_M, LOAD_STAGE_GAP_M,
  SHELL_LEN_M, ejectedShell, extractStage, extractorOffset, fireRecoil,
  flashEnvelope, insertStage, loadCarry, loadHold, magazineAfterFire,
  reloadPhaseAt, reloadPose, stagedShellCenter, supportHandPose, topLeverAngle,
  type HandDelta, type HandHold,
} from './game-viewmodel';
import { dungeonMaterialSet } from '../../../game/level/theme-material-set';
import { createOuterHull } from './shell-hull-outer';
import { createBoneInstancer } from './bone-instancer';
import { createSkeletonSources, type BoneFieldSource } from './skeleton-spike/contract';
import { SegmentMeshCache } from './skeleton-spike/mesh';
import { createSegmentMeshRenderer } from './skeleton-spike/mesh-renderer';
import { resolveSkeletonMode } from './skeleton-spike/selector';
import { SegmentVolumeCache, buildSegmentAtlas, boneSegmentKeyMap } from './skeleton-spike/volume';
import { SegmentVolumeBinding, createSegmentAtlasTexture } from './skeleton-spike/volume-gpu';
import { createPostAa } from './post-aa';
import { type VhsPreset, type VhsTerms } from './post-vhs';
import { type SscsTerms } from './post-sscs';
import { type ZombieGpuView, type RefineTail, defaultUniforms, blankFaceTexture, type MarchUniforms } from './zombie-gpu';
import { createCrowdType, type CrowdType } from './crowd-type';
import { DATA_ROWS as CROWD_DATA_ROWS } from './march.wgsl';
import { REC_VEC4S, REC_WIND_ALIVE, REC_COUNTS, REC_COUNTS2, REC_ANCHOR_BAND, REC_WOUND_BOUND, REC_VOL_POSE0, REC_MELT } from './crowd-records';
import { TILE_SIZE_PX } from './tile-cull';
import { createOccluderHull, buildHullInstances, HULL_SHRINK, type HullInstance } from './occluder-hull';
import { type BuildResult } from '../build-body';
import { parseBlob } from '../blob-parse';
import { MOTION_TUNING } from '../motion';
import { createCharacterView, compileCharacterSheet, bodyBuildCacheStats } from './character-view';
import { createCharacterEffects } from './character-effects';
import { characterEntry, characterNames } from '../character-registry';
import { rotateYaw } from '../gait';
import { makeSoldierMind } from './enemy-mind';
import { compileFace, compilePalette } from '../blob-compile';
import { FLESH_PRESETS, LIGHT_PRESETS } from '../material';
import type { Vec3 } from '../types';
import type { Quat } from '../vec';
import zombieBlobSrc from '../characters/zombie.blob?raw';
import {
  ROOMS, TUNNELS, FURNITURE, levelColliders, levelSurfaces,
  enclosureKeyAt, enclosureOf, wanderBounds, spawnPoints, PLAYER_START,
  type RoomDef,
} from './game-level';
import { crowdGridPoints, REGION_INSET_M, type FloorRect } from './crowd-spawn';
import { stepPlayer, eyeOf, PLAYER, type PlayerState, type MoveInput } from './game-player';
import { createRoomProbes, type ProbeWorkerLike } from './room-probes';
import { computeBounceSpot } from '../flashlight-bounce';
import { createProbeGatherBinding, type ProbeGatherBinding } from './probe-gather-compute';
import { parseFloatParam, parseIntParam } from './boot-params';
import {
  parseUpscaleConfig, parseUpscaleModelJson, UPSCALE_SCALE, type UpscaleConfig, type UpscaleModel,
} from './upscale/upscale-model';
import { runUpscaleSelfCheck } from './upscale/upscale-selfcheck';
import { accumulateSamples, float32ToBase64, jitterGrid, sampleOrder } from './upscale/supersample';
import type { UpscaleInfo } from './upscale/upscale-stage';
import { TEMPORAL_ACCUM_DEFAULT_SCALE } from './temporal-accum';
import { hashFrame, DEFAULT_TILES_X, DEFAULT_TILES_Y } from './demo-hash';
import { paddedRowStrideFloats } from './frame-hash';
import { tracerGatherLights } from '../tracer-lights';
import { boneInstanceArrays, packBoneInstances, INSTANCE_FLOATS } from './bone-instancer';
import { PROBE_MAX_BONE_INSTANCES, PROBE_MAX_CAPSULES } from '../probe-dynamic';
import { createZombieActor, segmentHitsBox, type ZombieActor } from './game-actor';
import { separate, minPairDistance, type CrowdAgent } from '../crowd';
import { arbitrate, RING_TUNING, type RingClaimant } from '../melee-ring';
import { ATTACK_TUNING, type SwingVariant } from '../attack';
import { buildFirefight, buildCloseup, validateScenario, actionsAt, type BenchAction, type Scenario, type ScenarioStep } from './game-bench-scenario';
import {
  createDemoRecorder, createDemoPlayer, DEMO_VERSION,
  type DemoFile, type DemoFrame, type DemoRecorder,
} from './demo-recorder';
// TSL nodes for the texRoundTrip diagnostic (close-up task 1, question B).
// Named with a Tsl suffix where the name collides with anything in this file.
import {
  wgslFn, texture3D as tslTexture3D, texture as tslTexture, screenUV as tslScreenUV, vec4 as tslVec4,
  length as tslLength, sub as tslSub, positionWorld, cameraPosition, uniform as tslUniform,
} from 'three/tsl';
import { runBench, type BenchDeps, type BenchMode } from './game-bench';
import { installPassTiming, beginPassFrame, setPassLabel } from './gpu-pass-timing';
import { GameTelemetry, type FrameTiming } from './game-telemetry';
import { getPipelineLog, setPipelineLogEnabled } from './pipeline-log';
import { coordinateWarmGate, createLoopController, type WarmOutcome } from './warm-gate';
import { createTelemetryControls } from './game-telemetry-controls';
import { createGameTilePlaytest } from './game-tile-playtest';
import { createComputeTileBinding } from './tile-bin-compute';
import { sdBody, smax } from '../validate';
import { FISHEYE_DEFAULTS, clampFovDeg, reticleNdc, visibleFovDeg } from './fisheye';
import {
  GRAPESHOT, SLUG, expired, spawnPellets, spawnSlug,
  stepProjectiles, traceProjectile, woundFromPellet, woundFromSlug, type Projectile,
} from './game-weapon';
import {
  concussionVelocity, explosionRadiusM, resolveExplosion, EXPLOSION_PROFILE,
  type BurstVisual, type ExplosionBody,
} from '../explosion-aoe';
import { EXPLOSION_LAUNCH, EXPLOSION_STANDARD, EXPLOSION_VFX_HEIGHT_SCALE } from '../../../game/gibs/tuning';
import { chargeFraction, stepCook, throwDirection, throwSpeedMps, type CookState, type CookSignal } from '../fpv';
import {
  detonated as flightDetonated, makeFlight, stepFlight,
  FLIGHT_TUNING, type FlightState,
} from '../dynamite-flight';
import { gibAll, gibAllPieces, type ChunkGroup } from '../sever';
import { displaceGibPieces, gibTierPlan, retargetGibPieces, type GibBoneRelease, type GibPiece, type GibPlan } from '../gib-parts';
import { TEAR_TUNING } from '../gib-tear';
import { blastRefractionBirthRadiusM, blastRefractionStrength } from '../blast-refraction';
import { createBurstLayer, createStickProp, type BurstLayer, type StickProp } from './fpv-view';
import { createExplosionVfx, type ExplosionVfx } from './explosion-vfx';
import {
  createDynamitePanel, defaultsFrom as dynamiteDefaults, GIB_BONES, GIB_MODES,
  type DynamitePanel, type DynamiteTuningKey, type DynamiteTuningValues,
} from './dynamite-panel';
import {
  WEAPON_SLOTS, makeWeaponSlotState, requestSlot, slotForKey, slotLowerAmount, slotReady,
  stepWeaponSlot, type WeaponSlot, type WeaponSlotState,
} from './game-weapon-slots';
import { setCarveProbeCapEnabled, setProbeCapEnabled, woundWorldPos, woundCarveNormal, type Wound } from '../damage';
import type { ImpactGoutProfile, Droplet } from '../blood-sim';
import {
  createBloodSim, spawnWoundDroplets, spawnImpactGout, emitTrails, stepBlood, IMPACT_GOUT,
} from '../blood-sim';
import { BleedRegistry, woundEmitAnchorAndNormal } from '../bleed-registry';
import {
  makeGutChain, pinGutChain, stepGutChain, detachGutChain, GUT_TUNING, type GutChain,
} from '../entrails';
import { shouldSpill, GUT_DROPLET_SIZE, SPILL_CHANCE } from '../entrails-spawn';
import { createBloodView } from './blood-view-gpu';
import { createGooLayer, type GooLayer, type GooReconstruction } from './goo-layer';
import { connectionBlobsForSim } from './blood-connections';
import { createImpactSplashLayer, type ImpactSplashLayer } from './impact-splash';
import { createGooPanel, type GooPanel } from './goo-panel';
import { createVhsPanel, type VhsPanel } from './vhs-panel';
import {
  createWoundPanel, defaultsFrom, WOUND_KEYS,
  type WoundPanel, type WoundTuningValues,
} from './wound-panel';
import { rngStreams, setRngSeed, seedFromUnit } from './rng';
import { advance as advanceSimClock, simTimeMs, resetSimClock } from './sim-clock';
import { chunkSettled, makeChunk, stepChunk, type ChunkBox } from '../gib-chunks';
import { gibLaunchVelocity } from '../gib-launch';
import { bonePartGeometry, meatPartGeometry } from './gore-part-geom';
import {
  billboardGib, loadGibSheet, loadGibSpriteAtlas, makeGibSprite, pickFrame, type GibSpriteAtlas,
} from './gib-sprites';
import {
  GIB_SPRITE_TUNING, applyMeshPose, clearSpritePieces, makeSpritePieceSet,
  setSpritePiecesVisible, spawnSpritePiece, spritePieceStates, stepSpritePieces,
  type SpritePieceSet,
} from './gib-sprite-pieces';
import { carveBodyIntoPieces, type CarvedLibrary, type CarvedPiece } from './gib-carve';
import { GibAssetRuntime, gibAssetMeshEligible } from './gib-asset-runtime';
import { gibAssetRowsFromPrims } from './gib-asset-deform';
import { resetGibAssetCache } from './gib-asset-loader';
import { compileBlob } from '../blob-compile';
import { buildBody, DEFAULT_BUILD_OPTS } from '../build-body';
import { BONE_VARIANTS, MEAT_VARIANTS } from '../gore-parts';
import type { ChunkLook } from '../chunk-bake-field';
import { chunkBakeField } from '../chunk-bake-field';
import { createChunkBakeJobs } from './chunk-bake-jobs';
import { unpackChunkBake } from './chunk-bake-buffers';
import type { ChunkBakeData } from './chunk-bake-geometry';
import {
  createBakedChunkMaterial, type BakedChunkMaterial,
} from './baked-chunks';
import { boneChunkRadius } from '../melt-bones';
import { chunkExtent, chunkSupportSpheres } from '../extent';
import { createChunkGpuView, createSharedChunkGpuMaterial, type ChunkGpuView, type GpuViewOpts } from './zombie-gpu';
import {
  createGameDeferredRenderer,
  deferredEnvironmentFromRig,
  resolveGameBootMode,
  type GameDeferredRendererDiagnostics,
  type GameSurfaceHash,
} from './game-deferred-renderer';
import { legacyFlashKnee, type GameLightCandidate } from './game-deferred-lights';
import type { DeferredDebugView } from './deferred-layer';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { Primitive } from '../types';
import { muzzleWorldPosition } from '../../../game/weapons/muzzle-pos';

/** Low but clearly visible — the owner's slide runs 0..1 from here. Measured
 *  on the room1 A/B (shadow-side px, mean channel shift vs probeWeight 0):
 *  0.5 -> (+12,+5,+2) on 743 px; 0.75 -> (+14,+7,+2) on 1735 px; 1.0 ->
 *  (+18,+10,+5) on 1848 px. Free at any weight: ambientAt is ANALYTIC — zero
 *  mapBody calls, pinned by the ambient tests — so the brief's probe-cost
 *  warning does not apply to the shipped P1 implementation. */
const DEFAULT_PROBE_WEIGHT = 0.75;

/**
 * RESOLUTION RUNGS — the owner picks with ?res=. All 4:3 except the legacy
 * '960' (the old fit-aspect 960x540 cap, kept so before/after numbers are
 * comparable). Default 800x600 per the owner's "capped at 800x600".
 *
 * SDF_SCALE is the SDF pass's fraction OF THE CAPPED BUFFER. Default 1.0:
 * one clean pixel grid — the march renders 1:1 with what gets presented and
 * upscaled once, instead of today's double resample (SDF at 0.7 of a
 * different-sized buffer). Cost table lives in the dispatch report.
 */
const RES_RUNGS = {
  '960': { mode: 'fit', maxW: 960, maxH: 540 },
  '800': { mode: 'fixed', width: 800, height: 600 },
  '640': { mode: 'fixed', width: 640, height: 480 },
} as const satisfies Record<string, RenderCap>;
type ResRung = keyof typeof RES_RUNGS;
/** `?graphics=high` (owner 2026-09-13): which SHIPPED_UPSCALE entry the boot loads. A BOOT
 *  decision — 'high' also allocates the march normal attachments and the refine twins/targets. */
type GraphicsLevel = 'default' | 'high';
const DEFAULT_RES: ResRung = '800';
function resRungFromUrl(fallback: ResRung = DEFAULT_RES): ResRung {
  const v = new URLSearchParams(location.search).get('res');
  return v && v in RES_RUNGS ? (v as ResRung) : fallback;
}

// The zombie's shared flat face sheet (zombie.blob has no `sheet` block) —
// the same registry entry bench-main duplicates from lab-main.
const ZOMBIE_FLAT = {
  url: '/assets/lab/zombie-face.png',
  rect: [0, 0, 64, 64, 64, 64] as [number, number, number, number, number, number],
  mean: 0.406,
};

/** The fattest additive prim in the head cluster — bench-main's headShape,
 *  verbatim: it normalises the face projection. */
function headShape(b: BuildResult): { centre: Vec3; axes: Vec3 } | null {
  const head = b.clusters.find(c => c.limb === 'head');
  if (!head) return null;
  let best: Vec3 | null = null;
  let bestAxes: Vec3 | null = null;
  let bestR = -Infinity;
  for (const p of b.prims.slice(head.start, head.start + head.count)) {
    if (p.op === 'sub') continue;
    const r = p.radius * Math.max(p.scale[0], p.scale[1], p.scale[2]);
    if (r > bestR) {
      bestR = r;
      best = [(p.a[0] + p.b[0]) / 2, (p.a[1] + p.b[1]) / 2, (p.a[2] + p.b[2]) / 2];
      bestAxes = [p.radius * p.scale[0], p.radius * p.scale[1], p.radius * p.scale[2]];
    }
  }
  return best === null || bestAxes === null ? null : { centre: best, axes: bestAxes };
}

async function main() {
  // BOOT PHASE MARKS (startup attribution, 2026-09-16). main() is one long
  // synchronous block after its first awaits — rAF cannot run, timers cannot
  // fire, and every console line lands at the same wall clock — so phase
  // boundaries cannot be inferred from the log. Two array pushes per phase;
  // read via __sdfGame.bootMarks() or window.__bootMarks. `t` is
  // performance.now(), comparable to performance.timeOrigin-relative CDP
  // timestamps and to the pipeline log's frame windows.
  const bootMarks: { n: string; t: number }[] = [];
  const mark = (n: string) => { bootMarks.push({ n, t: Math.round(performance.now()) }); };
  mark('main-start');
  (window as unknown as Record<string, unknown>).__bootMarks = bootMarks;
  const boundedWoundPreview = import.meta.env.DEV && new URLSearchParams(location.search).has('bounded-wounds');
  const mount = document.getElementById('app');
  if (!mount) throw new Error('#app not found');
  const resKey = resRungFromUrl(boundedWoundPreview ? '640' : DEFAULT_RES);
  const handle = await createLabRenderer(mount, RES_RUNGS[resKey]);
  // Per-pass GPU timestamps (gpu-pass-timing.ts). Wraps the backend's uid
  // builder once; costs a string concat per pass. Read through
  // __sdfGame.bench({ mode: 'passes' }) or __sdfGame.passTimings().
  const passTiming = installPassTiming(handle.renderer);
  const { scene, camera } = handle;
  mark('renderer-ready');

  // LOOP INTENT vs WARM SUSPENSION (warm-gate.ts, corrected 2026-09-16). The
  // old warm snapshotted loopRunning at its START and reapplied that in the
  // finally, so a rig/bench that paused (or resumed) the loop WHILE the warm
  // was in flight had its intent overwritten. Every external request now goes
  // through the controller's intent; the warm only suspends and releases.
  const rawSetLoopRunning = handle.setLoopRunning.bind(handle);
  const loopControl = createLoopController((on) => rawSetLoopRunning(on), handle.loopRunning);
  handle.setLoopRunning = (on: boolean) => loopControl.set(on);

  // PIPELINE LOG (pipeline-log.ts). The wraps are already installed (the lab
  // renderer does it right after init); ?pipelinelog=1 turns on per-creation
  // recording from the very first frame, so the boot warm-up's creations are
  // in the log too. Mid-session: __sdfGame.setPipelineLog(true).
  if (new URLSearchParams(location.search).get('pipelinelog') === '1') setPipelineLogEnabled(true);

  // DEMO SEED (determinism stage 1, 2026-09-14). ONE seed drives every named
  // stream in rng.ts. `?seed=` is what makes a bench leg or a recording
  // reproducible: with it, every repeat of a leg draws the same streams and
  // can produce an identical census. Absent, a random seed keeps normal play
  // as varied as the Math.random() this replaces. Logged, so a run whose
  // numbers surprise can be reproduced from the console line.
  const seedSearch = new URLSearchParams(location.search);
  const demoSeed = parseIntParam(seedSearch.get('seed'), { min: 0, max: 0x7fffffff })
    ?? (Date.now() & 0x7fffffff);
  setRngSeed(demoSeed);
  console.info(`[sdf-game] demo seed ${demoSeed}${seedSearch.has('seed') ? ' (?seed=)' : ' (random)'}`);

  // LOADING SCREEN (spike program). The boot compiles for seconds before the
  // game is playable — WebGPU init, the TSL graph, the weapon GLB, and since
  // the warm-up ~1.7 s of pipeline compilation — and the page used to drop
  // the player into whatever half-built frame existed at that moment. The
  // overlay is page-level HTML visible from FIRST PAINT (before any JS);
  // milestones below update it, and the game reveals itself only when the
  // weapon is loaded AND the pipeline warm-up finished. It auto-hides 1.2 s
  // after ready so headless drivers that never click are not blocked; a
  // click on it requests pointer lock (the gesture the canvas needs anyway);
  // ?loader=0 removes it (bench/screenshot determinism).
  const loaderEl = document.getElementById('loader');
  const loaderDisabled = new URLSearchParams(location.search).get('loader') === '0';
  if (loaderDisabled && loaderEl) loaderEl.style.display = 'none';
  function setLoader(text: string, ready = false): void {
    if (loaderDisabled) return;
    const status = document.getElementById('loader-status');
    if (status) status.textContent = text;
    if (ready) loaderEl?.classList.add('loader-ready');
  }
  setLoader('webgpu ready');
  loaderEl?.addEventListener('click', () => {
    const canvas = document.querySelector('#app canvas');
    if (canvas) canvas.requestPointerLock();
    loaderEl?.classList.add('loader-hidden');
  });
  const telemetry = new GameTelemetry();

  // RENDER MODE — parsed ONCE at boot (hybrid deferred M2 task 5). Absent or
  // 'legacy' boots the legacy path unchanged; 'deferred' opts into the
  // deferred coordinator below. An explicit deferred request on a backend
  // that is not really WebGPU (WebGPURenderer silently falls back to WebGL;
  // handle.backend is the honest signal) is FATAL and visible on the page —
  // silently benchmarking legacy while claiming deferred is the one failure
  // this seam must never produce.
  const bootMode = resolveGameBootMode(new URLSearchParams(location.search).get('renderer'), handle.backend);
  if (bootMode.warning) console.warn(`[sdf-game] ${bootMode.warning}`);
  if (bootMode.fatal) throw new Error(bootMode.fatal);
  const deferredMode = bootMode.mode === 'deferred';

  // FRAME PACING. Present on a 30 fps cadence instead of taking whatever slot
  // rAF hands us. Unpaced, a ~33 ms frame on a 60 Hz display alternates between
  // vsync slots -- 33, 50, 33, 50 -- whose MEAN reads a healthy 38 ms while the
  // hand feels a stagger, which is exactly the "wonky but the readings look
  // fine" the owner reported (2026-09-03).
  //
  // 30 is not arbitrary: `adaptiveBudgetMs` below is already 1000/30, so the
  // resolution ladder has been aiming at a 33.3 ms budget all along. This makes
  // the PRESENTATION agree with the budget the rest of the page is tuned for,
  // and gives the ladder a deadline it owns rather than one it has to infer
  // from a display refresh nobody measured.
  //
  // A seam, not a constant -- __sdfGame.setFrameCap(60) or (0) to compare by
  // eye. Off everywhere else: the bench times its own render callback and a cap
  // would flatten every reading to the cadence.
  handle.setFrameCap(30);

  // -----------------------------------------------------------------------
  mark('world-start');
  // The world: grey-box meshes from the same layout that feeds collision.
  // -----------------------------------------------------------------------
  const colliders = levelColliders();

  /**
   * WHAT A DETACHED PIECE COLLIDES WITH. The owner, playing: *"it seems the gibs
   * dont bounce off the walls/have collission"* — correct, and the reason was
   * that `stepChunk` only ever knew about a floor plane at y = radius, so a
   * piece thrown at a wall flew straight through it and out of the level.
   *
   * The boxes are `levelColliders()` — the SAME walls the player and the wander
   * clamp collide with, and they are split around every doorway and tunnel
   * mouth, so a gib sails out of an open door and bounces off the wall beside
   * it. That is why this is the level's collider list and not a box drawn around
   * each room: a room box would have sealed the doors.
   *
   * The ceiling is NOT one of those boxes (they end at WALL_H), so it comes in
   * separately through the page's existing per-enclosure `ceilingAt` — the same
   * lookup the bundle's flight already uses, which is why a piece cannot sail
   * out through the arena's 6 m roof while the 3 m rooms keep theirs.
   */
  function chunkCollidersAt(pos: Vec3): { boxes: readonly ChunkBox[]; ceilingY: number } {
    return { boxes: colliders, ceilingY: ceilingAt(pos[0], pos[2]) };
  }
  // ---- ACTOR VISIBILITY CULL STATE ---------------------------------------
  //
  // EVERY binding updateVisibleActors closes over lives here, above the draw
  // callback that calls it. The function itself is a hoisted declaration;
  // const/let are not. Getting this partly right is worse than not at all: a
  // first pass moved the state but left CULL_DWELL_MS behind, and boot
  // happened to reach `actors` but not the constant before the first frame,
  // so the cull threw on every frame while the picture still looked fine.
  // If you add a binding this function reads, add it HERE.
  const actors: ZombieActor[] = [];
  const CULL_DWELL_MS = 250;
  // Declared HERE, above the draw callback that closes over it, not beside
  // updateVisibleActors further down. `function updateVisibleActors` is a
  // hoisted declaration, but const/let are not: with the state declared later,
  // a frame rendering during boot threw "Cannot access 'cullCounts' before
  // initialization" and the cull silently never ran (HUD stuck at bodies
  // 0/15). It was a RACE — more boot work tipped it — which is exactly the
  // kind of bug that hides until something unrelated changes.
  const frustum = new THREE.Frustum();
  const projScreen = new THREE.Matrix4();
  const bodySphere = new THREE.Sphere(new THREE.Vector3(), 1.1);
  const lastSeenMs = new Map<number, number>();
  /** SIM FRAME INDEX (determinism stage 1, 2026-09-14). Incremented once at the
   *  top of every `tick(dt)`; the bake swap is pinned to a frame relative to
   *  submit so its landing frame does not depend on WORKER SPEED (see
   *  finishChunkBake). Reads only — the single writer is `tick`. */
  let simFrame = 0;
  /** THE SIM CLOCK now lives in `sim-clock.ts` (module state, so the demo
   *  player can reset it). The cull dwell below reads `simTimeMs()` —
   *  millisecond SIM time advanced only by `tick(dt)`, never wall time; see the
   *  module header for why the dwell is on it. Deliberately NOT a local `let`
   *  here: the hoisting trap documented above (a `let` read by a hoisted
   *  function from a later declaration threw "Cannot access ... before
   *  initialization" during boot and silently disabled the whole cull) cannot
   *  happen to a module import, whose binding is initialised before this body
   *  runs. */
  /** DEMO HOLD (2026-09-10, deterministic demo recordings stage 2). While ON,
   *  the render-side subsampling that is intentionally wall-clock or
   *  frame-counter driven is pinned to a value derived from the DEMO CLOCK, so
   *  two runs of one recording hash identically:
   *
   *    - the actor visual animation phase (`view.setTime`) comes off
   *      `simClockMs` instead of `performance.now() / 1000`;
   *    - the gather's `frameSeed` is measured from the frame the demo started,
   *      not from the absolute dispatch counter.
   *
   *  Both are PIXEL-ONLY: neither feeds sim state, so holding them cannot
   *  change what the simulation does — which is exactly why they are a
   *  recording seam and not a gameplay flag. OFF by default and OFF in
   *  normal play, so the shipped defaults are untouched; it is inert unless a
   *  demo is being recorded or replayed (see the frame hash:
   *  webgpu/demo-hash.ts). */
  let demoHold = false;
  /** The gather dispatch counter at demo entry, so the seed is a function of
   *  frames-since-entry rather than of how long the page happened to boot. */
  let demoSeedBase = 0;
  let actorCullEnabled = true;
  /** Run 5b: the distance band the refine twins are drawn in — from
   *  `scripts/lib/upscale-framing.mjs` DISTANCE_M.medium = [1.5, 3.5].
   *  Owner: close bodies are most of the pixels and the least visible gain
   *  (the march already resolves them), far bodies are cheap either way, so
   *  the twin only earns its cost in the middle. Hysteresis keeps a body
   *  walking along the edge from flickering. */
  const refineBand = { near: 1.5, far: 3.5, hysteresis: 0.25 };
  /** Run 5b: the twin lighting tail every view should be on — so a LATE SPAWN
   *  does not fall back to the default while the rest of the room is on the
   *  other tail (same idiom as boneCullMode). */
  let refineTailWanted: RefineTail = 'slim';
  /** Bodies whose refine twin was drawn this frame (reset each cull pass). */
  let refinedBodies = 0;
  let visibleActors: ZombieActor[] = [];
  const cullCounts = { visible: 0, total: 0 };
  const coverage = { screenFrac: 0, nearestM: 0, biggestFrac: 0 };
  const sightA: [number, number, number] = [0, 0, 0];

  const encounterNav = createEncounterNavigation(ROOMS, TUNNELS, colliders);
  const encounter = createEncounterDirector(encounterNav, colliders);
  const encounterHomes = new Map<number, Vec3>();
  const surfaces = levelSurfaces();
  const levelGroup = new THREE.Group();
  levelGroup.name = 'ring-level';
  const stoneSet = dungeonMaterialSet();
  const stoneFor = (axis: 0 | 1 | 2, facing: 1 | -1) =>
    axis !== 1 ? stoneSet.wall
      : facing > 0 ? stoneSet.floor
        : stoneSet.perimeterAccent;
  for (const p of surfaces.planes) {
    const axis = p.axis;
    // Walls span (x|z, y); floors/ceilings span (x, z).
    const w = axis === 1 ? p.max[0] - p.min[0] : p.max[axis === 0 ? 2 : 0] - p.min[axis === 0 ? 2 : 0];
    const h = axis === 1 ? p.max[2] - p.min[2] : p.max[1] - p.min[1];
    const geo = new THREE.PlaneGeometry(w, h);
    // Ceilings face AWAY from every light in the stack (sun points down, the
    // hemisphere's ground term is weak), so with pure reflected light they
    // render near-black and the owner reads "void above" — the missing-wall
    // failure pointing up. A small emissive term in their own colour keeps
    // them legible as the room's top surface without flattening the mood.
    const isCeiling = axis === 1 && p.facing < 0;
    const base = stoneFor(axis, p.facing) as THREE.MeshStandardMaterial;
    const mesh = new THREE.Mesh(geo, base.clone());
    const mm = mesh.material as THREE.MeshStandardMaterial;
    mm.color = new THREE.Color(p.color[0], p.color[1], p.color[2]);
    // Ceilings keep a whisper of self-light so they do not read as a void —
    // but far less than the gallery needed, because the flashlight now
    // reaches them.
    if (isCeiling) mm.emissive = new THREE.Color(p.color[0], p.color[1], p.color[2]).multiplyScalar(0.10);
    const mid: Vec3 = [
      (p.min[0] + p.max[0]) / 2, (p.min[1] + p.max[1]) / 2, (p.min[2] + p.max[2]) / 2,
    ];
    mesh.position.set(mid[0], mid[1], mid[2]);
    if (axis === 1) mesh.rotation.x = p.facing > 0 ? -Math.PI / 2 : Math.PI / 2;
    else if (axis === 0) mesh.rotation.y = p.facing > 0 ? Math.PI / 2 : -Math.PI / 2;
    else if (p.facing < 0) mesh.rotation.y = Math.PI;
    levelGroup.add(mesh);
  }
  for (const b of surfaces.boxes) {
    const geo = new THREE.BoxGeometry(
      b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]);
    const mesh = new THREE.Mesh(geo, (stoneSet.coverLow as THREE.MeshStandardMaterial).clone());
    (mesh.material as THREE.MeshStandardMaterial).color =
      new THREE.Color(b.color[0], b.color[1], b.color[2]);
    mesh.position.set(
      (b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2);
    levelGroup.add(mesh);
  }
  scene.add(levelGroup);

  // CEILING FILL. The sun points down; ceilings (and north-south walls in
  // shadow) have normals pointing away from it, so with only a dim ambient
  // they rendered BLACK — read by the owner as "the same failure pointing
  // up" as the missing walls. A hemisphere light pays normal-dependent fill.
  // This touches ONLY these MeshStandardMaterials — the SDF bodies carry
  // their own lighting uniforms (enclosure bounce), so probe/bounce tuning
  // is untouched.
  const hemi = new THREE.HemisphereLight(0xa39c93, 0x8f8880, 0.8);
  scene.add(hemi);
  // LEVEL PROBES (lighting P3/P4 step 3): the walls, floor and ceiling take
  // their indirect diffuse from the room's probe grid + the GPU gather's
  // dynamic layer (probe-lighting-node.ts, wired below the gather). The
  // hemisphere is the fill that replaces, so it fades as the weight rises —
  // otherwise the level double-lights on the flip. ?levelprobes=0 pins the
  // hemisphere at the rig's full intensity and the nodes at zero: the
  // pre-probe look. Gain -1 = each room's matched level (levelMatchedGain).
  const levelProbesParam = new URLSearchParams(location.search).get('levelprobes');
  let levelProbeWeight = levelProbesParam === '0' || levelProbesParam === 'off' ? 0 : 1;
  let levelProbeGain = -1;
  let hemiBase = hemi.intensity;
  const applyHemi = () => { hemi.intensity = hemiBase * (1 - levelProbeWeight); };
  // Declared HERE, above applyRig (which restamps them): const/let are not
  // hoisted, and the first applyRig runs long before the gather site below
  // populates these — the cullCounts race, again.
  const levelProbeNodes = new Map<number, ProbeLightingNode>();
  const levelLightLists = new Map<number, THREE.LightsNode>();
  const levelNodeMaterials: THREE.NodeMaterial[] = [];

  // -----------------------------------------------------------------------
  mark('gallery-start');
  // THE GALLERY RIG (mesh side only). The lab factory ships a warm-sun +
  // dim-purple-ambient default that made the rooms read dark; the owner
  // wants a bright white-wall gallery. We give THIS PAGE its own rig by
  // recolouring/releveling the factory's two lights rather than editing
  // the shared factory (the lab's look must not move).
  // -----------------------------------------------------------------------
  for (const child of [...scene.children]) {
    if (child instanceof THREE.DirectionalLight) {
      child.color.setHex(0xfff8ef); // neutral-warm key, not orange sunset
      child.intensity = 0.9;
    }
    if (child instanceof THREE.AmbientLight) {
      child.color.setHex(0xffffff); // bright WHITE fill, was 0x4a3a40 @ 0.6
      child.intensity = 0.95;
    }
  }
  hemi.color.setHex(0xf5f3f0);   // sky term: near-white
  hemi.groundColor.setHex(0x8f8c86); // floor bounce: mid grey
  hemi.intensity = 0.75;

  // COLOURED ACCENTS as real mesh-side lights, straight from the level data
  // — the same entries litWallAlbedo folded into the bounce albedos, which
  // is what keeps walls and zombies agreeing about the light. Five point
  // lights total (one per room + room3's second): few, on purpose — every
  // real-time light here spends frame time on WALLS, not on what the owner
  // is watching.
  const accentGroup = new THREE.Group();
  accentGroup.name = 'accent-lights';
  // ——— EXPLOSION LIGHT POOL (2026-09-10) ————————————————————————————————
  // Owner: "the explosion should cast dynamic light such that the whole room
  // lights up." Two separate lighting paths have to be fed, because the level
  // and the bodies are lit by different machinery:
  //
  //   THE LEVEL (walls, floor, kit) is lit by THREE lights — the accents above.
  //   These pool lights live in the SAME GROUP for that reason: they ride the
  //   same mesh-side registration (`router.register(accentGroup, 'mesh')`) and
  //   the same per-room light lists, so a detonation lights the room the way a
  //   brazier does rather than through a second, special-cased path.
  //
  //   THE BODIES (SDF-marched flesh) are NOT lit by THREE lights at all — the
  //   march has its own uniforms. They see light through the probe GATHER's
  //   dynamic light list, which is where the explosion is also pushed (see
  //   gatherLights). THAT path is single-room by construction: it lights the
  //   player's enclosure, so a blast in the next room lights nothing. That is
  //   the documented architecture, not a property of this effect.
  //
  // Allocated ONCE at intensity 0 and only ever modulated. CORRECTED
  // 2026-09-16 (action-stall fix): `visible` is NEVER toggled. three r185
  // folds the set of VISIBLE lights into `LightsNode.customCacheKey`, which is
  // part of the NodeBuilderState chosen for every material lit by the scene
  // lights. Toggling visibility therefore re-keys that state: the old shader
  // variant's ProgrammableStage/pipeline is released and a DIFFERENT variant is
  // compiled mid-frame. Measured on the old code: every detonation produced two
  // 180–230 ms frames with 17–18 createRenderPipeline calls (ignite and
  // expiry). Intensity 0 contributes no light — the cost of keeping the pool
  // visible is three idle point-light iterations, against ~400 ms of pipeline
  // churn per blast.
  const EXPLOSION_LIGHTS = 3;
  const explosionLightPool: THREE.PointLight[] = [];
  for (let i = 0; i < EXPLOSION_LIGHTS; i++) {
    const pl = new THREE.PointLight(0xffb060, 0, 0, 2);
    pl.visible = true;
    accentGroup.add(pl);
    explosionLightPool.push(pl);
  }
  const flickerLights: { light: THREE.PointLight; base: number; phase: number }[] = [];
  for (const r of ROOMS) {
    for (const a of r.accents) {
      const pl = new THREE.PointLight(
        new THREE.Color(a.color[0], a.color[1], a.color[2]), a.power);
      pl.position.set(a.pos[0], a.pos[1], a.pos[2]);
      // Tagged with its room so the level's per-room light lists can drop
      // the OTHER rooms' accents (see levelSceneLights below).
      pl.userData.accentRoom = r.id;
      accentGroup.add(pl);
      flickerLights.push({ light: pl, base: a.power, phase: a.pos[0] * 3.1 + a.pos[2] * 1.7 });

      // A visible source. Without it the light has no cause and reads as a bug.
      const bowl = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.16, 1),
        new THREE.MeshStandardMaterial({
          color: new THREE.Color(a.color[0], a.color[1], a.color[2]),
          emissive: new THREE.Color(a.color[0], a.color[1], a.color[2]),
          emissiveIntensity: 2.2,
          roughness: 0.7,
        }));
      bowl.position.set(a.pos[0], a.pos[1], a.pos[2]);
      accentGroup.add(bowl);
    }
  }
  scene.add(accentGroup);

  // ---------------------------------------------------------------------
  mark('dungeon-start');
  // DUNGEON RIG. Off-state parity matters: with dungeon disabled the gallery
  // must render exactly as before, so the rig is applied, not hard-coded.
  // ---------------------------------------------------------------------
  let dungeonOn = true;
  /** Live beam tuning (panel + console). x is how hard the beam drives the
   *  key; y is the highlight shoulder that keeps WOUNDS readable under direct
   *  light — at 0 a lit body hard-clips and crater, lip and clean skin all
   *  saturate to the same white, so a shot enemy looks unshot exactly when you
   *  are close enough to aim (owner, 2026-09-01). */
  // Owner's tuned values (2026-09-01, second panel pass). The high gain works
  // precisely BECAUSE the shoulder is on: 4.0 would have clipped a body to a
  // featureless white silhouette under the old hard clamp.
  //
  // keyFloor is ZERO, and the earlier worry that zero would make an unlit body
  // vanish was wrong: ambientAt still returns the fill term (lightCfg.y *
  // keyColor), so a body out of the beam keeps a real floor without the preset
  // key. Owner: "higher makes the zombies a bit too bright against ambient
  // when not lit" — which is the point of a carried lamp. What you can see is
  // what you are pointing at.
  const beamTuning = { gain: 4, shoulder: 0.35, keyFloor: 0 };
  // ?shadowmap=1024 for the old maps; 512 ships (SHADOW_MAP_SIZE). Both
  // maps ride it: the twin only feeds the march's soft level shadow.
  const shadowMapParam = Number(new URLSearchParams(location.search).get('shadowmap'));
  const flashlight = createFlashlight(DUNGEON_RIG, shadowMapParam > 0 ? { shadowMapSize: shadowMapParam } : {});
  // BOOT-TIME shadow ablation (?spotshadow=0), for the dungeon bench legs.
  // castShadow has to be decided BEFORE the first frame: toggling it live
  // crashes three r185 WebGPU (ShadowNode.updateShadow dereferences the
  // disposed map's depthTexture — see the __dungeon note below), and
  // shadow.intensity=0 cannot stand in — it only zeroes the SAMPLING term;
  // the 1024² map still renders every frame, so it would measure the wrong
  // split. At boot, AnalyticLightNode.setup never builds the shadow node at
  // all, so the leg is a true zero-cost ablation.
  flashlight.spot.castShadow = new URLSearchParams(location.search).get('spotshadow') !== '0';
  scene.add(flashlight.spot);
  scene.add(flashlight.spot.target);
  // The level-shadow twin (perf round 2 task 7) rides every shadow boot
  // decision the spot makes: ?spotshadow=0 kills BOTH maps (a true ablation
  // of the shadow cost), and the gallery rig shows neither.
  flashlight.levelShadow.castShadow = flashlight.spot.castShadow;
  scene.add(flashlight.levelShadow);
  scene.add(flashlight.levelShadow.target);

  // DEFERRED MODE: three's own shadow traversal is OFF. The deferred shadow
  // maps (deferred-shadows.ts) are explicit raster passes that never consult
  // renderer.shadowMap, and every opaque surface is an unlit G-buffer
  // producer — three's per-light shadow maps would be 1024² passes of pure
  // waste per renderer.render call. Boot-time decision: three r185 WebGPU
  // crashes when castShadow is toggled after maps were built, so this ships
  // as a boot property like the legacy ?spotshadow=0 ablation above.
  handle.renderer.shadowMap.enabled = !deferredMode;
  // PCF, not PCFSoft: the soft variant's kernel is FIXED and ignores
  // shadow.radius, which is the only edge-hardness knob the shadow map has
  // (owner ask, 2026-09-09). The WebGPU PCF filter is a 5-tap IGN-rotated
  // Vogel disk whose radius is a live reference uniform — tune at runtime
  // via __sdfGame.setShadowRadius (default SHADOW_RADIUS in
  // dungeon-lighting.ts). Changing the type needs a reload (shader
  // recompile); changing the radius after that does not.
  handle.renderer.shadowMap.type = THREE.PCFShadowMap;
  levelGroup.traverse((o) => {
    if (o instanceof THREE.Mesh) { o.castShadow = true; o.receiveShadow = true; }
  });

  function applyRig(rig: AmbientRig) {
    hemiBase = rig.hemiIntensity;
    applyHemi();
    hemi.color.setRGB(...rig.hemiSky);
    hemi.groundColor.setRGB(...rig.hemiGround);
    restampLevelProbes();
    for (const child of scene.children) {
      if (child instanceof THREE.DirectionalLight) child.intensity = rig.sunIntensity;
      if (child instanceof THREE.AmbientLight) {
        child.intensity = rig.ambientIntensity;
        child.color.setRGB(...rig.ambientColor);
      }
    }
    const fog = scene.fog as THREE.Fog | null;
    if (fog) {
      fog.color.setRGB(...rig.fogColor);
      fog.near = rig.fogNear;
      fog.far = rig.fogFar;
    }
    handle.renderer.setClearColor(new THREE.Color(...rig.fogColor));
    flashlight.spot.visible = rig === DUNGEON_RIG;
    flashlight.levelShadow.visible = rig === DUNGEON_RIG;
  }
  applyRig(DUNGEON_RIG);

  (globalThis as Record<string, unknown>).__dungeon = {
    setDungeon(on: boolean) { dungeonOn = on; applyRig(on ? DUNGEON_RIG : GALLERY_RIG); },
    get on() { return dungeonOn; },
    /** The weapon light itself, for runtime A/Bs (shadow.intensity 0/1 is the
     *  shadow kill switch — do NOT toggle spot.castShadow live, three r185
     *  WebGPU crashes rebuilding a disposed shadow map). */
    spot: flashlight.spot,
    /** Beam knobs, also on the tuning panel. */
    /** Accepts BOTH the short names and the panel's slider names, because the
     *  panel's COPY button emits the slider names (beamGain, ...) and a line
     *  you paste back must actually do something — it silently did nothing
     *  until 2026-09-01. */
    setBeam(t: {
      gain?: number; shoulder?: number; keyFloor?: number;
      beamGain?: number; beamShoulder?: number; beamKeyFloor?: number;
    }) {
      const gain = t.gain ?? t.beamGain;
      const shoulder = t.shoulder ?? t.beamShoulder;
      const keyFloor = t.keyFloor ?? t.beamKeyFloor;
      if (gain !== undefined) beamTuning.gain = gain;
      if (shoulder !== undefined) beamTuning.shoulder = shoulder;
      if (keyFloor !== undefined) beamTuning.keyFloor = keyFloor;
      return { ...beamTuning };
    },
    get beam() { return { ...beamTuning }; },
  };

  // -----------------------------------------------------------------------
  mark('drawchain-start');
  // The draw chain, exactly as the bench stands it up.
  // -----------------------------------------------------------------------
  const postAa = createPostAa(handle.renderer);
  // The blast refraction reprojects its live bands from WORLD positions every
  // frame, so it needs the camera's current view-projection. Handing it the
  // persistent camera once is enough — the matrices update in place.
  postAa.setBlastDistortCamera(camera);
  // VHS ships ON at 'blud' (owner, 2026-09-09) — the preset the owner swept in
  // vhs-panel.ts, replacing the club-mutant 'soft' this shipped at first.
  // ?vhs=blud|soft|balanced|chaotic picks another; ?vhs=off disables it, which is
  // also what the parity/bench drivers should pass — the all-off path is
  // untouched only when VHS is null.
  const vhsParam = new URLSearchParams(location.search).get('vhs');
  if (vhsParam === 'blud' || vhsParam === 'soft' || vhsParam === 'balanced'
    || vhsParam === 'chaotic') {
    postAa.setVhs(vhsParam);
  } else if (vhsParam !== 'off' && vhsParam !== 'null') {
    postAa.setVhs('blud');
  }
  const characterEffects = createCharacterEffects(handle.renderer);
  // GPU PROBE GATHER (P3/P4 dynamic layer). Declared here, ahead of the draw
  // callback, so the frame can test it without a temporal dead zone; created
  // next to the room probes once the level exists. ?probedyn=0 zeroes both
  // gains — the storage read is skipped and the march is bit-identical.
  let probeGather: ProbeGatherBinding | null = null;
  // TRACERS as gathered lights: the pellet lists are declared AFTER this draw
  // callback and after an await (the gun GLTF load), so a frame CAN render in
  // between — the same boot race the `cullCounts` comment describes. The
  // gather reads this provider, never the consts directly; it is assigned
  // right after `soldierPellets` exists.
  let liveTracers: (() => readonly Projectile[]) | null = null;
  const probeDynParam = new URLSearchParams(location.search).get('probedyn');
  let probeDynGain = probeDynParam === '0' || probeDynParam === 'off' ? 0 : 0.15;
  let probeVisStrength = probeDynParam === '0' || probeDynParam === 'off' ? 0 : 1;
  // ?proberate=1 restores every-frame gathers (see probeGatherRate above).
  // ALL THREE of these go through parseIntParam now: it reads the RAW string, so
  // an absent parameter yields null (the shipped default) rather than 0. Doing
  // it by hand is what shipped the zeroed-dynamic-layer regression — see
  // boot-params.ts for the whole story and boot-params.test.ts for the gate.
  const bootSearch = new URLSearchParams(location.search);
  let probeGatherRateBoot = parseIntParam(bootSearch.get('proberate'), { min: 1, max: 4 });
  // PROBE-GATHER COST SPLIT (2026-09-10). Two diagnostic seams that divide the
  // gather's cost into its primary-ray part and its per-light shadow part,
  // which is the split that decides whether widening the dispatch or replacing
  // the per-light sweep pays more. Both are WRONG FRAMES ON PURPOSE:
  //
  //   ?dynrays=0  -> nRays 0, so no ray work at all. What is left is the
  //                  dispatch, the per-probe setup and the blend.
  //   ?dynlights=0 -> the light list is empty, so the per-light loop never
  //                  runs and kdShadowed is never called. Primary rays only.
  //
  //   primary = lights0 - rays0        shadow = shipped - lights0
  //
  // Before these, the "shadow is ~50-70% of the work" figure was an op-count
  // MODEL, not a measurement (see the probe-gather-cost note).
  // min 0 is correct here and is exactly what made the old hand-rolled guard
  // unsafe: 0 is a real mode, so ABSENT must be detected before coercion.
  let probeRaysBoot = parseIntParam(bootSearch.get('dynrays'), { min: 0, max: 64 });
  let probeLightsBoot = parseIntParam(bootSearch.get('dynlights'), { min: 0, max: 1024 });
  // THE AFTERGLOW RATES, as verification seams (R1, 2026-09-10). `blend` is the
  // weight of the NEW estimate against last frame's record and `fall` the rate at
  // which a record decays when the estimate drops, so the shipped pair (0.6 rise,
  // 0.12 fall) makes the layer a function of its own HISTORY as well as of this
  // frame: two runs that dispatched a different number of frames before the read
  // differ for a reason that has nothing to do with the gather's maths, which is
  // exactly what made every cross-boot A/B of the gather unreadable (measured
  // 2026-09-10: two boots of ONE build disagreed at every ray count).
  //
  //   ?dynblend=1&dynfall=1 -> the record IS this frame's estimate, exactly
  //                   (mix(prev, new, 1) is new), with no decay behind it, so the
  //                   dynamic layer becomes a PURE FUNCTION of the frame's inputs
  //                   and two runs at the same state must agree byte for byte —
  //                   the only configuration in which a reduction race or a
  //                   mis-reduced probe is measurable at all. BOTH are needed:
  //                   blend 1 alone still carries history, because the rate is
  //                   `lumNew > lumPrev ? blend : fall`.
  //
  // They are WRONG FRAMES ON PURPOSE (no afterglow) and default to the shipped
  // 0.6 / 0.12, so an unparameterised page is bit-identical to before.
  let probeBlendBoot = parseFloatParam(bootSearch.get('dynblend'), { min: 0, max: 1 });
  let probeFallBoot = parseFloatParam(bootSearch.get('dynfall'), { min: 0, max: 1 });
  // FLASH BOOST. The muzzle light's envelope has already fallen to ~a third
  // of peak by the frame the gather packs it (one frame of lag), and it
  // lives 0.14 s; at 1x the bounce was a quarter of the key on a body next
  // to the muzzle. Flash sources only — the beam stays physical.
  let probeFlashBoost = 4;
  // TRACER LIGHTS. Raw intensity per pellet in the gathered light list, the
  // same units as the flash entries. ?tracerlight=0 (or off) zeroes it: the
  // pure rule returns [] and the frame packs no tracer light (bit-identical).
  //
  // MEASURED, RAISED TO 6, AND TURNED BACK DOWN TO 2 — all on 2026-09-10, and
  // the history is the useful part. The effect had never been priced against the
  // 8-bit canvas; a volley frozen mid-flight down room 1's lane showed that at
  // gain 2 it lifts the whole frame by about one 8-bit level (1,796 pixels past
  // a 2-level threshold, max delta 29) and at 6 it changes 369,088 pixels
  // (76.9%, max 68) — so 6 was shipped on that measurement. The owner then
  // reported seeing no difference in play, and the reasons are both recorded in
  // docs/dev-notes/2026-09-10-tracer-light-visibility/:
  //   1. the rig freezes the volley, which is the STEADY STATE — in play the
  //      light moves and the afterglow ramps over ~4 frames, so the in-play
  //      effect is smaller than the 76.9% figure;
  //   2. IN THE ROOM YOU ARE SHOOTING FROM IT BARELY MATTERS ANYWAY, because the
  //      muzzle flash is already lighting that room at that instant. The tracer
  //      light is a small second light in a room that just got a big one.
  // It is back at 2 for those two reasons, NOT because the plumbing is wrong:
  // the light reaches the probes and the layer's response is exactly linear in
  // the gain (0.5338 per gain unit per 2 tracers). WHERE IT WOULD EARN ITS KEEP
  // is a room you are NOT in — see the multi-room sketch — because there is no
  // competing muzzle flash there.
  const tracerLightParam = new URLSearchParams(location.search).get('tracerlight');
  let tracerLightGain = tracerLightParam === '0' || tracerLightParam === 'off' ? 0 : 2.0;
  // TRACER SLOT CAP: how many tracers can be gathered at once. 2, where it
  // started — it was raised to 4 alongside the gain on 2026-09-10 and reverted
  // with it, for the same two reasons (see the gain above). It IS the bigger of
  // the two levers on the numbers: at gain 2, 2 slots -> 8 took visibly-changed
  // pixels from 1,796 to 207,929 — so if tracer lights are ever wanted for their
  // own sake (i.e. once they can land in a room with no muzzle flash in it),
  // turn THIS one first.
  //
  // The old rationale here was cost — "8 tracers quadrupled it during
  // firefights (p95 6 -> 27 ms)". THAT IS OBSOLETE: it priced the pre-R1 gather
  // (4.00 ms). After R1 (0.18 ms) a packed-light-count sweep across 1/2/4 lights
  // and 16/32/64 rays put every configuration between 0.14 and 0.39 ms, i.e.
  // inside the instrument's own resolution, so the cap is no longer a cost knob.
  //
  // ?tracerlightslots=N (0 = off) and __sdfGame.setTracerLightSlots(n) override.
  //
  // (This default was once silently 0 rather than 2 — the `Number(null) === 0`
  // class that blacked out the dynamic layer. `parseIntParam` reads the RAW
  // string, and boot-params.ts + boot-params.test.ts carry the whole story.)
  let tracerLightSlots = parseIntParam(
    new URLSearchParams(location.search).get('tracerlightslots'), { min: 0, max: 8 },
  ) ?? 2;
  // DIRECT flash on bodies (march slot bodyFlash): intensity multiplier on
  // the flash lights before the shader's I*cos/d^2. 0 = off, bit-identical.
  let bodyFlashGain = 0.06;
  /** Seconds since the last shot; >= FLASH.windowSec means no flash.
   *
   *  DECLARED HERE, not beside the weapon state it belongs to (it used to sit
   *  ~2400 lines below, next to `gunReady`): the render callback set by
   *  `handle.setDrawFn` reads it — `flashEnvelope(flashAge)` in the legacy
   *  lighting branch, and `playerFlashLightIntensity()` just below — and the
   *  loop is already armed while boot is still awaiting the upscale model, so
   *  the later declaration threw `Cannot access 'flashAge' before
   *  initialization` on every frame until boot passed it. */
  let flashAge = Infinity;
  /** The player's muzzle flash as a LIGHT SOURCE for bodies and probes: a
   *  0.14 s burst shaped like the soldiers' (55 at the shot, (1-t)^2), so it
   *  survives the gather's one-frame lag. The sprite keeps its own envelope. */
  const playerFlashLightIntensity = () => (flashAge >= 0 && flashAge < 0.14 ? 55 * (1 - flashAge / 0.14) ** 2 : 0);
  /** An actor counts as in a room when its CURRENT position is inside the
   *  room's ground rect grown by `margin` — a body that wandered from the
   *  next room into this one, or stands in the tunnel mouth, is lit by this
   *  room's probes (which clamp to the grid edge). Spawn room is not it. */
  const nearRoom = (a: { pose(): { pos: Vec3 } }, r: RoomDef, margin = 1.5) =>
    nearRoomPoint(a.pose().pos, r, margin);
  /** The same rule for a bare POINT — the explosion light is not an actor. */
  const nearRoomPoint = (q: Vec3, r: RoomDef, margin = 1.5) =>
    q[0] >= r.minX - margin && q[0] <= r.maxX + margin
    && q[2] >= r.minZ - margin && q[2] <= r.maxZ + margin;
  const _flashWorld = new THREE.Vector3();
  let probeFrame = 0;
  let probeGatherErrors = 0;
  // GATHER AMORTIZATION (spike hunt, 2026-09-10): the dynamic gather is a
  // FIXED ~5.7 ms compute every frame — the largest standing per-frame GPU
  // cost the lighting batch added — and during fire bursts its measured
  // time balloons to ~27 ms under submission congestion. The kernel already
  // blends across dispatches (blend 0.6 rise, 0.12 fall), so dispatching
  // every OTHER frame halves that cost for a one-frame lag on indirect
  // radiance the layer smooths anyway. 1 = every frame (the old behaviour;
  // setProbeGatherRate / ?proberate flip it live).
  let probeGatherRate = 2;
  if (probeGatherRateBoot !== null) probeGatherRate = probeGatherRateBoot;
  let probeGatherTick = 0;
  let pendingGather: import('./probe-gather-compute').ProbeGatherFrame | null = null;
  // The gather's capsule source: this room's actors' posed bones, packed
  // with the bone instancer's OWN packer into a private array. Not the
  // instancer's array — that is only filled in bone-mesh mode, and in the
  // shipped mode (bones marched in the field) its count is zero.
  const probeCapsuleArrays = boneInstanceArrays(PROBE_MAX_BONE_INSTANCES);
  let probeGateLogs = 0;
  let probeLastGates: unknown = null;
  let probeLastCapsules = 0;
  let probeLastLights = 0;
  // THE FISHEYE. The camera renders WIDER than the player sees and the blit
  // squeezes it back, which is what buys the bulge without losing the frame
  // to a warp that reaches off the buffer. `centerFovDeg` is the look knob;
  // camera.fov is what pays for it. Both live on __sdfGame.
  // CO-INVARIANT: camera.fov and postAa's lens must never disagree about the
  // render FOV. Right now the only writers are the two seams below, which
  // keep that promise by construction. If anything else ever moves
  // camera.fov directly (aimFrustum's own comment already anticipates a
  // future ADS/recoil tween), it must re-call
  // `postAa.setLens(camera.fov, centerFovDeg)` in the same breath, or the
  // blit's squeeze silently stops matching the frustum that drew the frame
  // — see post-aa.ts's own setRenderCap note for the same class of hazard.
  let centerFovDeg: number = FISHEYE_DEFAULTS.centerFovDeg;
  camera.fov = FISHEYE_DEFAULTS.renderFovDeg;
  camera.updateProjectionMatrix();
  postAa.setLens(camera.fov, centerFovDeg);
  /** What `__sdfGame.fisheye`, `setFisheye` and `setRenderFov` all report.
   *  A shared function rather than three copies of the same object literal
   *  — and the setters' own return value, not just the getter, because an
   *  object-literal method can't write `return this.fisheye` and a shared
   *  local is the way around that. Reads renderFovDeg/k off the LENS, not
   *  the camera: the lens is what the blit actually applied, so this is
   *  what tells a console user their setRenderFov(500) landed on 179. */
  function fisheyeReport() {
    return {
      renderFovDeg: postAa.lens.renderFovDeg,
      centerFovDeg,
      visibleFovDeg: visibleFovDeg(postAa.lens),
      k: postAa.lens.k,
    };
  }
  // Runtime march normals (a second march attachment + renderer MRT) are allocated ONLY when the
  // boot asks for a model that reads them: `?upscaleinputs=rgbn|rgbdn`, a trained model whose name
  // contains 'rgbn'/'rgbdn', or an explicit `?upscalenormals=1`. Every other boot — including
  // `?upscale=trained&upscalemodel=s32-rgbd-best` — keeps the single-attachment march exactly as
  // shipped (owner 2026-09-12: "performance worse post this change" was the unconditional MRT).
  // Run 5: the refine twins + output-res refine targets (sdf-layer REFINE_LAYER) exist only when the
  // boot asks: `?refine=1`, or a trained model whose name contains 'headr' (run-5 exports). `?refine=0`
  // forces off. Refine implies the normal attachments.
  //
  // GRAPHICS LEVEL (owner 2026-09-13). `?graphics=high` swaps the shipped default upscaler for the
  // run-5b refine head, which READS the normal attachments and REQUIRES the refine pass — both are
  // boot allocations, which is why this is a URL parameter and not a live toggle. `?upscale=0` (the
  // native march) still allocates nothing extra even at 'high': there is no stage to feed.
  const graphics: GraphicsLevel =
    new URLSearchParams(location.search).get('graphics') === 'high' ? 'high' : 'default';
  const graphicsHighUpscale = graphics === 'high'
    && new URLSearchParams(location.search).get('upscale') !== '0';
  const refineWanted = (() => {
    const q = new URLSearchParams(location.search);
    if (q.get('refine') === '1') return true;
    if (q.get('refine') === '0') return false;
    if (graphicsHighUpscale) return true;
    return /headr(-|$)/.test(q.get('upscalemodel') ?? '');
  })();
  const marchNormalsWanted = refineWanted || (() => {
    const q = new URLSearchParams(location.search);
    if (q.get('upscalenormals') === '1') return true;
    if (q.get('upscalenormals') === '0') return false;
    const inputs = q.get('upscaleinputs') ?? '';
    const name = q.get('upscalemodel') ?? '';
    return /rgbd?n\b/.test(inputs) || /rgbd?n(-|$)/.test(name) || q.get('upscalehead') === '1';
  })();
  // `?refineband=near,far` — the bench and the smoke widen or narrow the band.
  {
    const raw = new URLSearchParams(location.search).get('refineband');
    if (raw) {
      const parts = raw.split(',').map(Number);
      const n = parts[0] ?? NaN, f = parts[1] ?? NaN;
      if (Number.isFinite(n) && Number.isFinite(f) && f > n && n >= 0) { refineBand.near = n; refineBand.far = f; }
    }
  }
  const sdfLayer = createSdfLayer(handle.renderer, { marchNormals: marchNormalsWanted, refine: refineWanted });
  if (refineWanted) sdfLayer.setRefine(true);
  postAa.addSink(sdfLayer);

  // SSCS — screen-space contact shadows (post-sscs.ts, 2026-09-09 shadow
  // continuity). Default ON here (the post-aa factory stays neutral);
  // ?sscs=off is the escape hatch, and the parity/bench drivers should pass
  // it — with the stage on, the all-off parity path is not what runs.
  // LEGACY PATH ONLY: the flesh mask is the march target's depth-in-alpha,
  // which field modes repurpose at half height and deferred mode replaces
  // with its own G-buffer (?skeleton=volume players: add &sscs=off).
  // SHIPS OFF (owner decision, 2026-09-10): the FPV weapon is always inside
  // SSCS's 0.8 m march volume (the flashlight is mounted at the weapon), so
  // melee-range receivers painted a weapon-silhouette contact-shadow smear —
  // the gray rectangle that moves with the gun. Excluding the viewmodel from
  // the occluder depth is the proper fix; until then ?sscs=on opts in.
  const sscsParam = new URLSearchParams(location.search).get('sscs');
  const sscsEnabled = sscsParam === 'on' && !deferredMode;
  if (sscsEnabled) {
    postAa.setSscsFleshTex(sdfLayer.marchTarget.texture);
    postAa.setSscs(true);
  }

  // -----------------------------------------------------------------------
  mark('deferred-start');
  // THE DEFERRED COORDINATOR (?renderer=deferred only — M2 task 5). Owns the
  // deferred frame composition: shadow maps -> shared light list ->
  // environment -> G-buffer (mesh + SDF producer passes through the task-3
  // router) -> lit present -> forward content. It does NOT own simulation:
  // the light candidates and the environment are LIVE callbacks re-read
  // every frame, so boot never reads a not-yet-initialised game variable
  // (the muzzle light in particular is created inside the async gun load —
  // the closure reads `muzzleLight`, assigned when it resolves).
  //
  // Both the sdf layer and this coordinator are post-aa SINKS: whichever one
  // the frame actually draws presents into postAa's capture target (or the
  // canvas when every post effect is off). The legacy sdfLayer is still
  // created and sized in deferred mode — it is the sizing oracle the goo and
  // the resolution ladder already agree on — but its render is never called,
  // so its targets stay uninitialised and cost nothing.
  // -----------------------------------------------------------------------
  /** The muzzle PointLight, assigned when the gun GLB resolves (it is
   *  allocated once at intensity 0 and modulated per shot). Read live by the
   *  coordinator's lights() callback. */
  let muzzleLight: THREE.PointLight | null = null;
  const spotShadowParam = new URLSearchParams(location.search).get('spotshadow');
  const deferredApi = deferredMode
    ? createGameDeferredRenderer({
      renderer: handle.renderer,
      scene,
      lights: () => {
        const candidates: GameLightCandidate[] = [
          { id: 'flashlight', role: 'flashlight', light: flashlight.spot },
        ];
        if (muzzleLight) candidates.push({ id: 'muzzle', role: 'muzzle', light: muzzleLight });
        flickerLights.forEach((f, i) =>
          candidates.push({ id: `fire-${String(i).padStart(2, '0')}`, role: 'practical', light: f.light }));
        return candidates;
      },
      environment: () => deferredEnvironmentFromRig(dungeonOn ? DUNGEON_RIG : GALLERY_RIG),
      // M2 task 5: the flashlight slot's march-key response for deferred
      // flesh, read LIVE from beamTuning — the same gain/shoulder the legacy
      // march replays per frame, so setBeamTuning moves BOTH paths together
      // and the constants cannot drift apart. knee = legacyFlashKnee(
      // shoulder): the march shader's own two-step conversion — shoulder 0
      // is compression OFF (knee 0), otherwise clamp(1 - shoulder, .05, .99)
      // — so every legal panel position packs (the raw `1 - shoulder` map
      // threw on shoulder 0 and .05 every frame). gain 0 is a PRESENT zero
      // (the beam leaves flesh) once packed, never an absent override.
      flashKey: () => ({ gain: beamTuning.gain, knee: legacyFlashKnee(beamTuning.shoulder) }),
      // M2 task 7 material-parity repair: the game's march materials keep
      // lodCfg.y at its 1 default (the legacy display decode is part of the
      // authored look — only lab-main ever flips it), so the deferred flesh
      // response gates ON here. With it the light pass shades packed flesh
      // with the authored spec/Fresnel/wet/AO response and applies the same
      // display decode; without it, deferred flesh keeps the flat M1
      // bounded approximation the owner rejected.
      fleshDisplay: () => true,
      renderEffects: (camera) => characterEffects.render(camera),
      flashlight: flashlight.spot,
      width: postAa.contentSize.width,
      height: postAa.contentSize.height,
    })
    : null;
  if (deferredApi) {
    // Boot ablation (?spotshadow=0): the shadow maps never render. The
    // sampling-only diagnostic toggle lives on __sdfGame below.
    deferredApi.setShadowGeneration(spotShadowParam !== '0');
    postAa.addSink(deferredApi);
    // Static scene routes. Everything ASYNC (kit/prop groups, chunks, baked
    // meshes, bone tubes) registers at its own creation site below.
    deferredApi.router.register(levelGroup, 'mesh', 'full');
    deferredApi.router.register(accentGroup, 'mesh', 'full');
  }
  /** SDF pass scale relative to the capped buffer. 1.0 = 1:1 (default).
   *  Runtime-adjustable for the cost table + adaptive ladder. */
  let sdfScale = 1.0;
  // Texture round-trip probe rig (texRoundTrip below) — built lazily on the
  // first call, page-lifetime, never rendered by the frame loop. A diagnostic
  // of the 2026-09-04 close-up task; nothing outside texRoundTrip touches it.
  let texProbe: null | {
    scene: THREE.Scene;
    quad: THREE.Mesh;
    ortho: THREE.OrthographicCamera;
    writes: {
      uniform: { m: THREE.MeshBasicNodeMaterial; u: { value: number } };
      dist: { m: THREE.MeshBasicNodeMaterial };
      'dist-small': { m: THREE.MeshBasicNodeMaterial };
    };
    fetchNode: ReturnType<typeof wgslFn>;
    targets: Record<string, [THREE.RenderTarget, THREE.RenderTarget]>;
  } = null;
  // Declared AHEAD of sizeSdfLayer because that function reads it and runs
  // during init — a `let` further down is a temporal dead zone and the page
  // dies before __sdfGame exists (caught immediately: headless boot found no
  // __sdfGame at all). Assigned once the actors give it a light rig.
  let gooLayer: GooLayer | null = null;
  let gooPanel: GooPanel | null = null;
  /** The wound panel (wound-panel.ts). Ships VISIBLE, like the goo panel, but
   *  COLLAPSED (panel-chrome.ts) — only its title bar shows, so it stays
   *  findable without covering the frame the way both panels did fully
   *  expanded (see c6bffc7). Every existing look-capture script
   *  (gallery-look, shadow-ab, the canary) keeps framing the room undisturbed
   *  as a result. __sdfGame.woundPanelCollapsed(false) expands it; that seam
   *  is guarded typeof-style in capture scripts like gooPanel. Not persisted
   *  across reloads — a remembered state would make a capture reproduce
   *  differently machine to machine. */
  let woundPanel: WoundPanel | null = null;
  /** The DYNAMITE / GIB panel (dynamite-panel.ts). Fourth slot (right:782px),
   *  ships VISIBLE but COLLAPSED like the other three. */
  let dynamitePanel: DynamitePanel | null = null;

  /**
   * THE PANEL'S SETTER — one entry point for every knob it owns, and the
   * read-back source for its sliders. A knob that the panel can move but this
   * function ignores is the "tuning that looked applied and was not" bug both
   * the beam and goo panels shipped; `dynamite-panel.test.ts` pins the key
   * union against this switch's cases.
   */
  function applyDynamiteTuning(patch: Partial<DynamiteTuningValues>): void {
    for (const [k, raw] of Object.entries(patch)) {
      if (raw === undefined || !Number.isFinite(raw)) continue;
      switch (k as DynamiteTuningKey) {
        case 'maxchunks':
          maxChunks = Math.max(1, Math.min(MAX_CHUNK_BUDGET, Math.round(raw)));
          break;
        case 'mode':
          gibMode = GIB_MODES[Math.max(0, Math.min(2, Math.round(raw)))]!;
          break;
        case 'bones':
          gibBones = GIB_BONES[Math.max(0, Math.min(2, Math.round(raw)))]!;
          break;
        case 'stagger':
          gibStaggerFrames = Math.max(1, Math.min(8, Math.round(raw)));
          break;
        case 'tearSec':
          gibTearSec = Math.max(0, Math.min(0.4, raw));
          break;
        case 'tearAmp':
          tearShape.amplitudeM = Math.max(0, Math.min(0.12, raw));
          break;
        case 'tearJiggle':
          tearShape.jiggleAmp = Math.max(0, Math.min(1, raw));
          break;
        case 'gibvel':
          gibVelScale = Math.max(0, Math.min(2, raw));
          break;
        // SETTLED-PIECE DETAIL. `chunkdetail` sets the OVERRIDE, so once the
        // slider is touched the piece stops following the creature's own
        // surfaceNoiseAmp — which is the point of a look lever. The per-frame
        // push reads all three, so a settled piece already on the floor changes
        // on the next frame; there is no rebake.
        case 'chunkdetail':
          chunkDetailOverride = Math.max(0, Math.min(1, raw));
          break;
        case 'chunkdetailfreq':
          chunkDetailFreq = Math.max(0.5, Math.min(64, raw));
          break;
        case 'chunkdetailalbedo':
          chunkDetailAlbedo = Math.max(0, Math.min(1.5, raw));
          break;
        // FUTURE settles only — already-baked pieces stay baked until shot or
        // recycled. The panel row says so too.
        case 'chunkbake':
          chunkBakeEnabled = Math.round(raw) === 1;
          break;
        case 'aoesize':
          aoeRadiusScale = Math.max(0.3, Math.min(1.5, raw));
          break;
        case 'edgekick':
          aoeLaunchFloor = Math.max(0, Math.min(1, raw));
          break;
        case 'fxlight':
          fxLightScale = Math.max(0, Math.min(4, raw));
          break;
        case 'fxspread':
          fxSpread = Math.max(0, Math.min(3, raw));
          break;
        case 'fxsize':
          fxSize = Math.max(0.1, Math.min(2, raw));
          break;
        // Everything below is the burst module's own tuning record.
        default: {
          const fxKey: Record<string, string> = {
            fxsmoke: 'smokeOpacity', fxlife: 'lifeSec', fxgain: 'gain', plume: 'plumeMix',
            capflat: 'capFlatten', neck: 'plumeNeckH', cap: 'plumeCapH',
            ringreach: 'ringReachH', ringopacity: 'ringOpacity', emberspeed: 'emberSpeedPerH',
          };
          const target = fxKey[k];
          if (!target) break;
          explosionVfx?.setTuning({
            [target]: raw,
            // The FLATTEN has a second field for the FIRE cap; keep them equal
            // so one slider cannot leave the two halves of the cap disagreeing.
            ...(k === 'capflat' ? { capFireFlatten: Math.min(1, 0.5 + raw * 0.25) } : {}),
            // ...and the plume A/B is four settings in the page's own wiring
            // (see the boot block), so the slider mirrors it here too.
            ...(k === 'plume'
              ? { fireCapShare: raw, capFlatten: 1 - (1 - 0.55) * raw,
                  capFireFlatten: 1 - (1 - 0.5) * raw }
              : {}),
          } as never);
          break;
        }
      }
    }
    // The tear is per-ACTOR state, so a change has to be pushed to every body —
    // and to any body that starts tearing later (`scheduleGib` re-applies it).
    for (const a of actors) a.setTearTuning({ sec: gibTearSec, ...tearShape });
    dynamitePanel?.refresh();
  }

  /** What the panel reads back. The BURST half is asked of the module rather
   *  than mirrored here: a second copy of those numbers would be the drift this
   *  panel exists to avoid. */
  function dynamiteTuningValues(): DynamiteTuningValues {
    const t = explosionVfx?.tuning;
    return {
      ...dynamiteDefaults(),
      maxchunks: maxChunks,
      mode: Math.max(0, GIB_MODES.indexOf(gibMode as typeof GIB_MODES[number])),
      bones: Math.max(0, GIB_BONES.indexOf(gibBones as typeof GIB_BONES[number])),
      stagger: gibStaggerFrames,
      tearSec: gibTearSec,
      tearAmp: tearShape.amplitudeM,
      tearJiggle: tearShape.jiggleAmp,
      gibvel: gibVelScale,
      // The settled piece's detail. `chunkdetail` reports the EFFECTIVE
      // amplitude — the override if one is set, otherwise the creature's own
      // surfaceNoiseAmp through the gain — because that is what the slider
      // should show on open, and what the shader is actually using.
      chunkdetail: chunkDetailOverride
        ?? Math.min(1, (actors[0]?.view.uniforms.surfCfg2.value.y ?? 0) * CHUNK_DETAIL_GAIN),
      chunkdetailfreq: chunkDetailFreq,
      chunkdetailalbedo: chunkDetailAlbedo,
      chunkbake: chunkBakeEnabled ? 1 : 0,
      aoesize: aoeRadiusScale,
      edgekick: aoeLaunchFloor,
      fxsize: fxSize,
      fxlight: fxLightScale,
      fxspread: fxSpread,
      ...(t ? {
        fxsmoke: t.smokeOpacity, fxlife: t.lifeSec, fxgain: t.gain, plume: t.plumeMix,
        capflat: t.capFlatten, neck: t.plumeNeckH, cap: t.plumeCapH,
        ringreach: t.ringReachH, ringopacity: t.ringOpacity, emberspeed: t.emberSpeedPerH,
      } : {}),
    };
  }
  /** The VHS panel (vhs-panel.ts). Same contract as the other two: ships
   *  VISIBLE but COLLAPSED, at the third slot (right:524px) so all three
   *  title bars sit side by side. The shipped 'blud' preset IS a sweep made
   *  in this panel — the club-mutant three are the far ends of the term space
   *  and none of them was the look; keeping the panel is how the next one
   *  gets found.
   *  __sdfGame.vhsPanel(false) / vhsPanelCollapsed(false) are the seams. */
  let vhsPanel: VhsPanel | null = null;
  let panelsHidden = false;
  // SHIPS ON (owner call, 2026-08-31: "set goo mode to default always to true
  // so i dont have to toggle it on each time"). setGoo(false) stays the kill
  // switch; mode 'depth' vs 'overlay' stays a separate toggle.
  let gooEnabled = true;
  // Smooth reconstruction at the full SDF grid is the game default.
  // Boot flags are read where the goo defaults are applied:
  //   ?goorecon=original  comparison fallback to the old reconstruction
  //   ?gooconnections=1   tapered strands (sheets are a separate opt-in)
  //   ?goosheets=1        experimental stream-grid sheets
  //   ?impactsplash=1     SUPPLEMENTARY procedural impact crown on top of the
  //                       existing slug gout (does not replace it)
  // Live equivalents: __sdfGame.setGooCandidate, __sdfGame.setImpactSplash.
  let gooReconstruction: GooReconstruction = 'smooth';
  let gooConnectionsEnabled = false;
  let gooStrandsEnabled = true;
  // SHEETS OFF BY DEFAULT: the stream-local grid removed the world-position
  // hole swimming, but whether a density patch reads as a sheet is still an
  // open visual question. Opt in with ?goosheets=1 / setGooCandidate.
  let gooSheetsEnabled = false;
  // SUPPLEMENTARY IMPACT SPLASH (reference-directed slug splash, 2026-09-13).
  // A separate procedural crown effect fired ON TOP of the existing slug gout;
  // it mutates no shared table and does not replace the Current slug. OFF by
  // default: opt in with ?impactsplash=1 or __sdfGame.setImpactSplash.
  let impactSplashEnabled = false;
  let impactSplashLayer: ImpactSplashLayer | null = null;

  /** Create the splash layer on first enable only, sharing the flesh/goo
   *  light uniform NODES so it is lit by the same rig. Returns silently if
   *  there is no actor view yet (the same pre-condition the goo layer has). */
  function ensureImpactSplashLayer(): void {
    if (impactSplashLayer) return;
    const v = actors[0]?.view;
    if (!v) return;
    impactSplashLayer = createImpactSplashLayer({
      rig: {
        lightDir: v.uniforms.lightDir,
        keyColor: v.uniforms.keyColor,
        lightCfg: v.uniforms.lightCfg,
      },
    });
    scene.add(impactSplashLayer.object);
  }

  function sizeSdfLayer() {
    const s = postAa.contentSize;
    sdfLayer.setSize(s.width, s.height);
    // The deferred layer tracks the same capped buffer (post-aa hands it the
    // same capture target as a sink).
    deferredApi?.setSize(s.width, s.height);
    sdfLayer.setConeGeometry(camera.fov, sdfLayer.targetSize.height);
    // Density follows the SDF layer at GOO_TUNING.densityScale. Called from
    // here rather than a separate resize listener (lab-main's shape) because
    // ADAPTIVE RESOLUTION moves the SDF target at runtime through
    // applySdfScale -> sizeSdfLayer: a listener would never fire and the goo
    // would keep splatting into a stale-sized field.
    const t = sdfLayer.targetSize;
    gooLayer?.setSize(t.width, t.height);
  }
  sdfLayer.setScale(sdfScale);
  sizeSdfLayer();
  window.addEventListener('resize', sizeSdfLayer);
  function applySdfScale(v: number) {
    sdfScale = Math.min(1, Math.max(0.2, v));
    sdfLayer.setScale(sdfScale);
    deferredApi?.setScale(sdfScale);
    sizeSdfLayer();
    // The AA footprint (aaCfg.x) is ONE PIXEL at the current SDF pass height;
    // a rung change moved that height, so refresh every live view (perf round
    // 2 task 6). Only called post-boot (tickAdaptive / the setSdfScale seam),
    // so `actors` below is always initialised here.
    const k = sdfLayer.pixelConeK;
    for (const a of actors) a.view.uniforms.aaCfg.value.x = k;
  }

  // -----------------------------------------------------------------------
  mark('adaptive-start');
  // ADAPTIVE RESOLUTION — same pure controller the lab uses (X1.13), wired
  // into the render callback. DEFAULT OFF: the chosen rung is what ships;
  // this is the frame-rate safety net the owner can switch on.
  // -----------------------------------------------------------------------
  // ADAPTIVE ON by default (2026-08-31), and the baseline is why.
  //
  // It lands AFTER the baseline on purpose: adaptive moves the pixel count
  // under load, so measuring with it on would have measured the safety net
  // instead of the cost. __sdfGame.bench suspends it for the same reason.
  //
  // The baseline then made the case for it stronger than expected. Resolution
  // scale is the ONLY lever that moved the frame — 0.7 is -39%/-25% and 0.5 is
  // -58%/-54%, while the occluder, the cone and FXAA all measured inside
  // repeat spread. Adaptive works by walking exactly that ladder, so it is the
  // one safety net with a measured mechanism behind it.
  // (docs/dev-notes/2026-08-31-game-perf-baseline/notes.md)
  //
  // It is still a FLOOR, not an answer: it buys frames by making the flesh
  // coarser during exactly the moments that matter most.
  // OFF by default (owner, 2026-09-04/05): the resolution drop is visible and
  // unwelcome up close, and a renderer A/B under a moving rung compares two
  // resolutions, not two renderers. __sdfGame.setAdaptive(true) re-arms it.
  let adaptiveEnabled = false;
  let adaptiveBudgetMs = 1000 / 30;
  let adaptiveState = initialAdaptiveState(performance.now());
  const ADAPTIVE_WINDOW = 30;
  const PROBE_ABORT_FRAMES = 8;
  const adaptiveFrames: number[] = [];
  function tickAdaptive(nowMs: number): void {
    if (!adaptiveEnabled) return;
    const failingProbe = adaptiveState.probing && adaptiveFrames.length >= PROBE_ABORT_FRAMES
      && (median(adaptiveFrames) > adaptiveBudgetMs * 1.1
        || adaptiveFrames.filter((f) => f > adaptiveBudgetMs * 1.8).length >= 2);
    if (adaptiveFrames.length < ADAPTIVE_WINDOW && !failingProbe) return;
    const recent = adaptiveFrames.slice(-ADAPTIVE_WINDOW);
    const sorted = [...recent].sort((a, b) => a - b);
    const next = stepAdaptive(adaptiveState, {
      nowMs,
      medianFrameMs: median(recent),
      p95FrameMs: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))],
      budgetMs: adaptiveBudgetMs,
    });
    if (next.rung !== adaptiveState.rung) {
      applySdfScale(scaleForRung(next.rung));
      // Frames rendered at the OLD scale must not feed the next decision.
      adaptiveFrames.length = 0;
    }
    adaptiveState = next;
  }
  function median(xs: number[]): number {
    if (xs.length === 0) return 0;
    const s = [...xs].sort((a, b) => a - b);
    const m = s.length >> 1;
    const hi = s[m]!;
    return s.length % 2 ? hi : (s[m - 1]! + hi) / 2;
  }
  // The frame's draw. With the goo layer on, the chain nests exactly as
  // lab-main's does: goo DENSITY (+ blur) first, the whole sdf/cone/occluder/
  // composite flow in the middle, then the goo SURFACE composited on top with
  // its reconstructed depth so the metaball blood interleaves with flesh and
  // floor. gooLayer is assigned further down (it needs a body view's light
  // uniforms, which only exist once the actors are built) — safe in this
  // closure because everything up to the end of main() is synchronous, so no
  // frame can fire against the hole.
  //
  // Goo OFF takes the original single-call path, so the toggle is exact.
  // The render loop arms on the renderer BEFORE main() finishes, so this
  // callback can fire while consts declared further down are still in their
  // temporal dead zone — the chunk list therefore goes through this
  // indirection, assigned once liveChunks exists. Empty until then.
  let chunkObjects: () => THREE.Object3D[] = () => [];
  let refreshActorTiles = () => {};

  // ---- CROWD STAGE A (?crowd=1) -------------------------------------------
  // Declared ABOVE the draw callback for the same hoisting reason the cull
  // state is (see the cullCounts comment): the callback closes over these, and
  // a frame that renders before the boot reaches a later declaration throws
  // "Cannot access before initialization" and silently skips the crowd path.
  // DEFAULT FLIP (task 8, 2026-09-14): the merged crowd march is the shipped
  // path. `?crowd=0` (or `__sdfGame.setCrowd(false)`) opts out to the per-body
  // path; `?crowd=1` is still accepted as a no-op. The distance-crowd bench
  // (docs/dev-notes/2026-09-13-merged-crowd-march-stage-a.md, `## Distance
  // crowd`) is the evidence: crowd-quad beats per-body at every n = 8..24 at
  // both SDF scales, and 24 completes at ship scale under the frame guard.
  const crowdParam = new URLSearchParams(location.search).get('crowd');
  // Stage a-2 dispatch: `?crowddispatch=boxes` restores the stage-a instanced
  // proxy boxes; anything else (including absent) uses the one-screen-quad
  // dispatch, which is the point of the stage.
  // DEFAULT DISPATCH = BOXES (2026-09-15). On the owner's 56 s room-1 recording
  // with matched fights the instanced proxy boxes beat per-body overall
  // (17.3/15.4 vs 19.8/19.2 ms frame p50) while the one-screen-quad did not
  // (20.3/20.2): the quad's remaining cost is raster footprint the boxes never
  // rasterise (`docs/dev-notes/2026-09-14-crowd-firefight-cost.md`, Task 5).
  // `?crowddispatch=quad` keeps the quad reachable; it may still win specific
  // scenes (many bodies stacked in few tiles) and is worth revisiting.
  let crowdDispatch: 'boxes' | 'quad' = new URLSearchParams(location.search).get('crowddispatch') === 'quad'
    ? 'quad' : 'boxes';
  // DEFAULT = CROWD, BOXES DISPATCH (2026-09-15). The 2026-09-14 revert to
  // per-body rested on a bench whose legs fought different fights (the
  // `setCrowd` respawn confound, fixed in sdf-game-bench.mjs). On matched
  // fights the crowd march with boxes beats per-body on the owner's real
  // room-1 run and keeps its 8..24-body wins. `?crowd=0` opts out.
  let crowdOn = crowdParam !== '0';
  // STAGE-3 COMPATIBILITY: the refine twins and the cone pass are unsupported
  // under the crowd march (they read per-body state the instance record does
  // not carry; stage 3 turns refine into a fullscreen record-reading pass). A
  // boot that asks for either falls back to per-body for its whole life,
  // warns once, and records why in crowdInfo().fallbackReason.
  // `sdfLayer.coneEnabled` is the cone pass's own gate — it ships off and has
  // no boot flag yet, so in practice only `?refine=1` triggers this today.
  let crowdFallbackReason: string | null = null;
  if (crowdOn && (refineWanted || sdfLayer.coneEnabled)) {
    crowdFallbackReason = refineWanted ? 'refine twin requested (?refine=1)' : 'cone pass requested';
    crowdOn = false;
    console.warn('[crowd] refine/cone twins are not supported under the crowd march (stage 3); falling back to per-body for this boot');
  }
  /** One CrowdType per character registry name; lazily created on first spawn. */
  const crowdTypes = new Map<string, CrowdType>();
  /** The first attached view per type — the source of the per-frame per-TYPE
   *  uniform values (lighting rig, spot, level shadow, probes). A same-name
   *  view, so its per-type statics match; the FIRST attaches in room order and
   *  pins the type's room uniforms for stage a (cross-room crowds are a known
   *  gap — see the crowd dev note). */
  const crowdSourceView = new Map<CrowdType, ZombieGpuView>();
  /** Types whose shared segVolume atlas/meta were bound from the first actor. */
  const crowdVolumeBound = new Set<CrowdType>();
  let crowdSegMetaWarned = false;
  let crowdRefineWarned = false;

  /** Copy every uniform VALUE from a stamped per-body view into a type's own
   *  nodes. The crowd material reads per-TYPE fields from these nodes and
   *  every per-INSTANCE field from the record, so an exact copy of the view's
   *  block is both correct and immune to a per-type stamp the wiring forgot to
   *  list. Textures are shared by reference (they are per-type anyway);
   *  vectors/colours/matrices copy through .copy(). */
  function copyUniformValues(dst: MarchUniforms, src: MarchUniforms): void {
    const d = dst as unknown as Record<string, { value: unknown }>;
    const s = src as unknown as Record<string, { value: unknown }>;
    for (const k of Object.keys(s)) {
      const dn = d[k], sn = s[k];
      if (!dn || !sn) continue;
      const sv = sn.value;
      const dv = dn.value;
      if (sv !== null && typeof sv === 'object' && !(sv instanceof THREE.Texture)
          && dv !== null && typeof dv === 'object'
          && typeof (dv as { copy?: unknown }).copy === 'function') {
        (dv as { copy: (o: unknown) => void }).copy(sv);
      } else {
        dn.value = sv;
      }
    }
  }
  /** TASK-6 DIAGNOSTIC LIGHT CLOCK state — see setLightClockFrozen in the
   *  __sdfGame seam. Freezes the practical flicker phase at the freeze
   *  instant; default OFF, gate-only. DECLARED HERE (before setDrawFn)
   *  because the flicker block reads it and the render loop arms before
   *  main() finishes — the same TDZ rule chunkObjects obeys. */
  let lightClockFrozen = false;
  let flickerClockFrozenAt = 0;
  /** Flashlight bounce spot gain (P4 step 1): 1 = the physically-derived disc
   *  irradiance; ?bouncespot=0 pins the bit-identical path. Default 0 since the
   *  GPU gather lights the level with the beam itself (P4 step 2);
   *  ?bouncespot=1 or setBounceSpot brings the analytic disc back.
   *
   *  DECLARED HERE for the same TDZ rule as lightClockFrozen above: the legacy
   *  lighting branch of the draw callback reads it, and the loop draws while
   *  boot is still awaiting the upscale model. Measured, not guessed — with
   *  `flashAge` hoisted this was the very next `Cannot access ... before
   *  initialization` the page threw. */
  const bounceSpotParam = new URLSearchParams(location.search).get('bouncespot');
  let bounceSpotGain = bounceSpotParam === null ? 0 : Math.max(0, Number(bounceSpotParam) || 0);
  /** THE BOOT-FRAME GATE. `handle.setDrawFn` arms this callback here, ~4700
   *  lines before main() finishes, and boot then AWAITS (the upscale model
   *  fetch, the weapon GLB, the arms GLB) — so the loop draws frames while
   *  most of the state below this point is still in its temporal dead zone.
   *  Every such frame threw `Cannot access '<x>' before initialization` and
   *  drew nothing; the owner saw one at boot (`flashAge`), and behind it stood
   *  `bounceSpotGain`, `player`, `roomProbes`, `bakedChunkMat`, `flashLight` —
   *  measured one at a time, each surfacing only once the one before it was
   *  fixed. Hoisting works for a `let`; `player` and `roomProbes` are `const`s
   *  with real initializers and cannot move. So the gate: no frame draws until
   *  main() has built everything the callback reads (set right before the
   *  `window.__sdfGame` seam). Nothing is lost — those frames drew nothing
   *  anyway — and the loader covers the canvas for all of it. */
  let drawReady = false;
  /** One-shot boot marks around the FIRST skeleton-mesh sync, so a startup
   *  probe can attribute the cold-blocking extraction without a per-frame
   *  allocation. Set once; never cleared (a rebuild's re-extraction is
   *  reported by SegmentMeshCache.stats() instead). */
  let meshSyncMarked = false;
  handle.setDrawFn(() => {
    if (!drawReady) return;
    // GPU PROBE GATHER dispatch (P3/P4). OUTSIDE the post-aa pass on purpose:
    // renderer.compute() inside a render callback broke the renderer's pass
    // state and stalled the loop after five frames (owner-observed HUD at
    // 0.0 ms, no bodies). The frame data is packed in the legacy block below
    // and dispatched here at the top of the NEXT frame — one frame of lag on
    // a layer that blends over frames anyway.
    if (pendingGather && probeGather) {
      try { probeGather.update(pendingGather); probeFrame++; }
      catch (err) { if (probeGatherErrors++ === 0) console.error('[probe-gather] update failed', err); }
      pendingGather = null;
    }
    return postAa.render(() => {
    // Anything rendered before a site claims a label lands in 'frame:other'
    // — a non-zero row there means an unlabelled pass exists.
    setPassLabel('frame:other');
    flashlight.update(camera);
    // SSCS feed: the flashlight pose and this frame's camera matrices. The
    // camera's matrixWorld is current — flashlight.update just re-ran
    // updateMatrixWorld on it; setSscsFrame rebuilds the view matrix itself.
    if (postAa.sscs) postAa.setSscsFrame(camera, flashlight.spot.position);

    // ---- COMMON per-frame updates (both render modes) ---------------------
    // Fire flicker. Cheap and deliberately not random per frame — a smooth
    // two-rate wobble reads as flame; white noise reads as a broken light.
    // Runs in BOTH modes: the deferred practicals are the same PointLights,
    // read live by the coordinator's light list.
    // The clock is wall-clock performance.now() ON PURPOSE — but that means
    // the task-6 render lock does NOT freeze it (the lock pins simulation,
    // not this). When the gate freezes the DIAGNOSTIC light clock
    // (setLightClockFrozen), ft pins to the freeze instant so two renders of
    // a locked scene have identical practical intensity; gameplay never
    // freezes it.
    {
      const ft = lightClockFrozen ? flickerClockFrozenAt : performance.now() * 0.001;
      for (const f of flickerLights) {
        const w = Math.sin(ft * 7.3 + f.phase) * 0.5 + Math.sin(ft * 17.1 + f.phase * 2.3) * 0.25;
        f.light.intensity = f.base * (1 + w * 0.14);
      }
    }
    // Bone tubes: feed this frame's posed bones (actors stepped in tick
    // ahead of this draw; chunks repacked world-space there too — posed()
    // and posedBones() are always current). Both modes: in deferred mode the
    // instancer is a level-only G-buffer producer with the SAME packing.
    // Bodies and CHUNKS are fed independently: `boneMesh` is the body switch,
    // `gibBoneMesh` the detached-piece one. They were one flag, which is why gib
    // bones could only be tubes if living skeletons became tubes as well.
    if (boneMesh || gibBoneMesh) {
      if (boneMesh) {
        const craters: { pos: Vec3; radius: number }[] = [];
        for (const a of actors) {
          const prims = a.posed().prims;
          for (const w of a.visualWounds()) craters.push({ pos: woundWorldPos(prims, w, boundedWoundPreview ? a.pose().yaw : 0), radius: w.radius });
        }
        boneInstancer.setWounds(craters);
      }
      boneInstancer.update([
        ...(boneMesh
          ? actors.map(a => { const p = a.posed(); return { prims: p.bonePrims ?? [], alive: p.clusters.map(c => c.alive) }; })
          : []),
        ...(gibBoneMesh ? liveChunks.map(c => ({ prims: c.view.posedBones() })) : []),
      ]);
    }
    // skeleton=mesh: re-pose this frame's segment meshes + crater exposure.
    // Sever re-derive: the actor's posed body reference changes — rebuild
    // the sources (revision changes, the cache extracts fresh geometry).
    // HALF-RATE SYNC (2026-09-09). On a hold frame the marched flesh is the
    // PREVIOUS frame's, reprojected. The skeleton meshes are full-rate
    // polygons on the same rig, so re-posing them here would draw current
    // bones inside stale skin — the owner's screenshot of a skeleton standing
    // outside its own body. Holding their pose keeps both representations on
    // the same instant. Before the 2026-09-08 mesh migration this could not
    // happen: bones were rows in the marched field and held with it.
    // Fields never hold: every frame marches at the current camera and pose.
    const meshHold = sdfLayer.halfRate && sdfLayer.willHold;
    if (segMeshRenderer && !meshHold) {
      // Its own phase, NOT folded into an existing one: this path shipped as
      // the forward default without a controlled timing result (skeleton
      // wrap-up, 2026-09-08) and no capture could see it until now.
      const meshTiming = telemetry.begin();
      const firstMeshSync = !meshSyncMarked;
      if (firstMeshSync) { meshSyncMarked = true; mark('mesh-sync-start'); }
      const craters: { pos: Vec3; radius: number }[] = [];
      for (const a of actors) {
        const prims = a.posed().prims;
        for (const w of a.visualWounds()) craters.push({ pos: woundWorldPos(prims, w, boundedWoundPreview ? a.pose().yaw : 0), radius: w.radius });
      }
      segMeshRenderer.setWounds(craters);
      segMeshRenderer.update(actors.map(a => {
        let e = skeletonSources.get(a);
        if (!e) { e = buildSkeletonSources(a, 'zombie'); skeletonSources.set(a, e); a.view.setPackBones(false); }
        else if (e.body !== a.body) { e = buildSkeletonSources(a, e.name); skeletonSources.set(a, e); }
        return e.sources;
      }), actors);
      telemetry.end('skeleton-mesh', meshTiming);
      if (firstMeshSync) mark('mesh-sync-end');
    }
    // skeleton=volume: only the tiny pose/meta texture changes per frame.
    // A body-reference change means sever/rebuild and therefore a new
    // revision-keyed atlas; stale same-name grids are never re-enabled.
    if (segVolumeCache) {
      for (const actor of actors) {
        const state = skeletonVolumes.get(actor);
        if (!state) continue;
        if (state.body !== actor.body) bindSkeletonVolume(actor, state.name);
        else state.binding.update(state.sources);
      }
    }
    refreshActorTiles();

    // ---- DEFERRED BRANCH (?renderer=deferred) -----------------------------
    // No per-body beam replay here BY DESIGN: the bodies are unlit surface
    // producers whose lighting comes from the deferred light stage, where the
    // muzzle flash is its OWN light entry (the task-3 light list) — never a
    // bias replayed into the flashlight's body uniforms like the legacy
    // branch below. The coordinator's render does shadows -> opaque ->
    // depth presentation -> forward content; goo nests around it exactly as
    // it nests the legacy sdf render (both are post-aa output sinks).
    if (deferredApi) {
      if (gooEnabled && gooLayer) gooLayer.render(camera, () => deferredApi.render(camera));
      else deferredApi.render(camera);
      return;
    }

    // ---- LEGACY BRANCH (default; unchanged behaviour) ---------------------
    // Hand the march the same beam the meshes get. The SDF bodies shade
    // inside the march and cannot see the scene's SpotLight at all (the
    // owner's "characters aren't lit by the light direction" report), so
    // the beam is replayed into per-body uniforms: same lamp pose, same
    // cone maths, per pixel. spotCfg.x gates it — 0 (gallery/lab) makes
    // the shader collapse to the old key exactly.
    {
      const sAxis = new THREE.Vector3();
      flashlight.spot.target.getWorldPosition(sAxis).sub(flashlight.spot.position).normalize();
      // x intensity gate, y cosInner, z cosOuter, w range — the cone edge
      // comes straight off the light so the two systems cannot drift.
      const spotOn = dungeonOn ? 1 : 0;
      const cosInner = Math.cos(flashlight.spot.angle * (1 - flashlight.spot.penumbra));
      const cosOuter = Math.cos(flashlight.spot.angle);
      // LEVEL SHADOW twin (perf round 2 task 7): exact flashlight pose, then
      // refresh its shadow matrix NOW — shadow.matrix is otherwise written
      // during the render, i.e. after we read it. Same pose => same shadows
      // on bodies as the meshes cast onto the floor.
      const twin = flashlight.levelShadow;
      twin.position.copy(flashlight.spot.position);
      twin.target.position.copy(flashlight.spot.target.position);
      twin.updateMatrixWorld();
      twin.target.updateMatrixWorld();
      twin.shadow.updateMatrices(twin);
      // shadow.map is null until three has rendered the twin's shadow pass
      // once (boot): until then the levelShadowTex binding stays on the 1×1
      // fallback and the gate stays 0 — the march is bit-identical. After
      // the first shadow pass the texture rebinds (same mechanism as
      // setFaceTexture) and the gate tracks the seam AND the beam: no beam,
      // no directional key, nothing for a level shadow to modulate.
      const map = twin.shadow.map?.depthTexture ?? null;
      const lvlOn = spotOn > 0 && twin.castShadow && map !== null && levelShadowEnabled ? 1 : 0;
      // MUZZLE FLASH -- the marched bodies. They cannot see the PointLight
      // above, so the flash rides the beam that is already replayed here.
      // Nothing is saved or restored: these uniforms are rewritten from the
      // flashlight every frame, so biasing this frame's values IS the effect.
      //
      // Added to spotOn rather than multiplied, so the flash still lights
      // bodies in the gallery rig where the flashlight gate is 0.
      // A WIDER cone is a SMALLER cosine, hence the subtraction.
      //
      // DELIBERATELY TEMPORARY: the right fix is a second light slot in the
      // march, which cannot land while sdf-render-perf-r2 is rewriting
      // march.wgsl.ts. Tracked under the spec's "Deferred".
      const fv = flashEnvelope(flashAge);
      // 6x blew a nearby body to a featureless white silhouette. 2.2 still
      // reads unmistakably as a flash without destroying the wound detail
      // that is the entire point of looking at these creatures.
      const flashGate  = spotOn + 2.2 * fv;
      const flashInner = Math.max(-1, cosInner - 0.45 * fv);
      const flashOuter = Math.max(-1, cosOuter - 0.45 * fv);
      // FLASHLIGHT BOUNCE SPOT (lighting P4 step 1). Where the beam axis
      // lands on the player's enclosure (paint colours, that room's furniture
      // first), as one disc light every body adds to its ambient. Computed
      // once per frame here, not per actor. Tunnels use their enclosure's
      // walls as-is. bounceSpotGain 0 (?bouncespot=0) is bit-identical.
      let bounceSpot: ReturnType<typeof computeBounceSpot> = null;
      if (bounceSpotGain > 0 && flashGate > 0) {
        const key = enclosureKeyAt(player.pos[0], player.pos[2]);
        const roomDef = ROOMS.find(r => r.name === key);
        const enc = enclosureOf(key);
        if (enc) {
          const walls = roomDef ? {
            negX: roomDef.wallColor, posX: roomDef.wallColor, negY: roomDef.floorColor,
            posY: roomDef.ceilColor, negZ: roomDef.wallColor, posZ: roomDef.wallColor,
          } : enc.walls;
          const occ = roomDef ? FURNITURE.filter(f => f.room === roomDef.id)
            .map(f => ({ min: [f.minX, 0, f.minZ] as Vec3, max: [f.maxX, f.height, f.maxZ] as Vec3 })) : [];
          const sp = flashlight.spot.position, sc = flashlight.spot.color;
          bounceSpot = computeBounceSpot({
            pos: [sp.x, sp.y, sp.z], axis: [sAxis.x, sAxis.y, sAxis.z],
            intensity: flashGate, cosInner: flashInner, cosOuter: flashOuter,
            range: flashlight.spot.distance, keyGain: beamTuning.gain, color: [sc.r, sc.g, sc.b],
          }, enc.box, walls, occ);
        }
      }
      // GPU PROBE GATHER (P3/P4 dynamic layer). Once per frame for the
      // player's room: its box + furniture as boxes, every posed bone as a
      // capsule, the muzzle flash as the light. Bodies in that room read the
      // layer; everyone else keeps both gains at 0.
      // The room the gather serves: the player's, or — from a tunnel or a
      // doorway — the NEAREST room by centre, so stepping back to watch a
      // firefight through the arch does not switch the layer off (owner:
      // "close it works, medium or far it doesn't").
      const dynKey = enclosureKeyAt(player.pos[0], player.pos[2]);
      let dynRoom: RoomDef | null = ROOMS.find(r => r.name === dynKey) ?? null;
      if (!dynRoom) {
        let bestD = Infinity;
        for (const r of ROOMS) {
          const cx = (r.minX + r.maxX) / 2, cz = (r.minZ + r.maxZ) / 2;
          const d = (cx - player.pos[0]) ** 2 + (cz - player.pos[2]) ** 2;
          if (d < bestD) { bestD = d; dynRoom = r; }
        }
      }
      const dynGrid = dynRoom ? roomProbes.gridOf(dynRoom.id) : null;
      const dynOn = probeGather !== null && dynRoom !== null && dynGrid !== null
        && (probeDynGain > 0 || probeVisStrength > 0);
      probeGateLogs++;
      probeLastGates = { bound: probeGather !== null, dynKey, room: dynRoom?.id ?? null, grid: !!dynGrid, gain: probeDynGain, vis: probeVisStrength, dynOn, flashI: playerFlashLightIntensity(), flashAge, capsules: probeLastCapsules, lights: probeLastLights };
      let probeCapsuleCount = 0;
      // Amortized rate: pack (and therefore dispatch, one frame later) only
      // on due ticks; skipped frames leave the dynamic layer frozen, which
      // the kernel's own cross-dispatch blending already models.
      const gatherDue = probeGatherRate <= 1 || probeGatherTick % probeGatherRate === 0;
      probeGatherTick++;
      if (dynOn && probeGather && dynRoom && dynGrid && gatherDue) {
        for (const a of actors) {
          if (!nearRoom(a, dynRoom) || probeCapsuleCount >= PROBE_MAX_BONE_INSTANCES) continue;
          const posed = a.posed();
          const sub = { ab: probeCapsuleArrays.ab.subarray(probeCapsuleCount * INSTANCE_FLOATS), overflowed: false };
          probeCapsuleCount += packBoneInstances(posed.bonePrims ?? [], posed.clusters.map(c => c.alive), sub, PROBE_MAX_BONE_INSTANCES - probeCapsuleCount);
        }
        probeLastCapsules = probeCapsuleCount;
        // THE LIGHTS. (1) The player's muzzle flash, a point light while its
        // envelope burns. (2) Every soldier's muzzle flash in this room, from
        // the same muzzle the effects sprite is posed at, 0.14 s like the
        // sprite. (3) The flashlight BEAM as a spot light — the level lit by
        // the beam bounces onto bodies, which the analytic bounce spot only
        // approximated with one disc; that spot now ships at gain 0.
        const gatherLights: import('../probe-dynamic').DynLightInput[] = [];
        // The PLAYER's flash as a LIGHT uses the soldiers' 0.14 s burst shape,
        // not the sprite's envelope: that one is gone within two frames, and
        // with one frame of gather lag the layer never saw it (owner: "why
        // doesn't my muzzle flash do the same").
        const fI = playerFlashLightIntensity();
        if (flashLight && fI > 0) {
          flashLight.getWorldPosition(_flashWorld);
          gatherLights.push({ pos: [_flashWorld.x, _flashWorld.y, _flashWorld.z], color: [1.0, 0.81, 0.58], intensity: fI * probeFlashBoost });
        }
        for (const a of actors) {
          if (!nearRoom(a, dynRoom) || !a.character) continue;
          const age = a.sinceFire();
          if (!(age >= 0 && age < 0.14)) continue;
          const m = a.character.muzzle();
          if (!m) continue;
          const k = 1 - age / 0.14;
          gatherLights.push({ pos: [m[0], m[1], m[2]], color: [1.0, 0.72, 0.45], intensity: 35 * k * k * probeFlashBoost });
        }
        if (spotOn > 0 && flashlight.spot.intensity > 0) {
          const sp = flashlight.spot.position, sc = flashlight.spot.color;
          gatherLights.push({
            pos: [sp.x, sp.y, sp.z], color: [sc.r, sc.g, sc.b], intensity: flashlight.spot.intensity,
            axis: [sAxis.x, sAxis.y, sAxis.z], cosInner, cosOuter,
          });
        }
        // (4) Live tracers LAST, filling only the slots the lights above left.
        // They are the least important read, so the flashes and the beam keep
        // their place; the gather's 8-light allocation is never exceeded.
        //
        // TRACER SLOT CAP (spike program, 2026-09-10): the gather's cost is
        // per-thread over the PACKED light count (32 rays x every light), and
        // a firefight fills all 8 slots with tracers — the fire-segment bench
        // measured the gather at p95 27 ms with tracers vs ~11 with them off,
        // in BOTH tracerGain arms of an interleaved A/B. Capping the tracer
        // contribution at 2 slots bounds the packed count near the flashes
        // alone; __sdfGame.setTracerLightSlots restores more if the look
        // wants them.
        // (3b) LIVE EXPLOSIONS. Placed BEFORE the tracers for the same reason
        // the flashes are: a detonation is the brightest event in the game and
        // it must not lose its slot to a bullet trail. `explosionLights` is the
        // same list the mesh-side pool reads, so the walls and the bodies cannot
        // disagree about where the blast was or how bright it is.
        for (const e of explosionLights) {
          const k = explosionLightEnv(e.age);
          if (k <= 0.001) continue;
          if (gatherLights.length >= 8) break;
          // Needs to be near the gather's room to reach it at all: the layer is
          // the PLAYER'S enclosure, so a blast in the next room is dropped here
          // for the same reason a tracer is (tracer-lights.ts).
          if (!nearRoomPoint(e.pos, dynRoom)) continue;
          gatherLights.push({
            pos: [e.pos[0], e.pos[1], e.pos[2]],
            color: [1.0, 0.55, 0.24],
            intensity: EXPLOSION_LIGHT.gatherPeak * k * fxLightScale,
            // The blast is the one light in the game that has to fill a ROOM
            // rather than pool around its own position — see `fxSpread`.
            fill: fxSpread,
          });
        }
        const tracerSlots = Math.min(tracerLightSlots, 8 - gatherLights.length);
        if (tracerSlots > 0 && tracerLightGain > 0) {
          gatherLights.push(...tracerGatherLights(liveTracers?.() ?? [], {
            eye: player.pos, room: dynRoom, margin: 1.5, gain: tracerLightGain,
            slugRadius: SLUG.radius, cap: tracerSlots,
          }));
        }
        probeLastLights = gatherLights.length;
        pendingGather = {
          grid: dynGrid,
          enclosure: { min: [dynRoom.minX, 0, dynRoom.minZ], max: [dynRoom.maxX, dynRoom.height, dynRoom.maxZ] },
          wallAlbedo: dynRoom.wallColor,
          occluders: FURNITURE.filter(f => f.room === dynRoom.id).map(f => ({
            box: { min: [f.minX, 0, f.minZ] as Vec3, max: [f.maxX, f.height, f.maxZ] as Vec3 },
            albedo: [0.35, 0.33, 0.30] as Vec3,
          })),
          instances: probeCapsuleArrays.ab, instanceCount: probeCapsuleCount,
          capsuleMargin: 0.06,
          // Diagnostic seams (see ?dynrays / ?dynlights above); both default to
          // the shipped values, so an unset URL is bit-identical to before.
          lights: probeLightsBoot === null ? gatherLights : gatherLights.slice(0, probeLightsBoot),
          // THE SEED IS PINNED WHILE A DEMO IS HELD. The rotation exists so the
          // estimate does not strobe in play, but it makes each dispatch report
          // the estimate of a DIFFERENT ray set, and the kernel blends toward it
          // (`blend 0.6`), so the dynamic layer oscillates over the seed cycle
          // instead of settling. Measured 2026-09-10: on a render-locked scene
          // the march digest took 24 DISTINCT values over 24 consecutive
          // positions, and two boots never aligned at any offset.
          //
          // Pinning removes the source rather than tracking it: with one ray set
          // the EMA converges to a fixed point of a FROZEN scene, which is what
          // a recording needs. It is a RECORDING-ONLY change — normal play keeps
          // the rotation — and it is the one thing here that does alter the look
          // of a recording (a settled estimate rather than an oscillating one).
          frameSeed: demoHold ? 0 : (probeFrame % 64) / 64,
          blend: probeBlendBoot ?? 0.6,
          fall: probeFallBoot ?? 0.12,
          raysPerProbe: probeRaysBoot === null ? 32 : probeRaysBoot,
        };
      }
      // DIRECT FLASH SOURCES for the bodyFlash slot: every burning muzzle in
      // play (the player's and the soldiers'), unboosted; each body takes the
      // strongest by I/d^2 from its own position.
      const directFlashes: { pos: Vec3; intensity: number }[] = [];
      const playerFlashI = playerFlashLightIntensity();
      if (flashLight && playerFlashI > 0) {
        flashLight.getWorldPosition(_flashWorld);
        directFlashes.push({ pos: [_flashWorld.x, _flashWorld.y, _flashWorld.z], intensity: playerFlashI });
      }
      for (const a of actors) {
        if (!a.character) continue;
        const age = a.sinceFire();
        if (!(age >= 0 && age < 0.14)) continue;
        const m = a.character.muzzle();
        if (!m) continue;
        const k = 1 - age / 0.14;
        directFlashes.push({ pos: [m[0], m[1], m[2]], intensity: 35 * k * k });
      }
      // The level's rooms take the same dynamic cfg as the bodies: the room
      // the gather serves reads it, every other room reads 0 — and with the
      // level probes off the level never reads the buffer at all.
      for (const [roomId, node] of levelProbeNodes) {
        const on = dynOn && dynRoom !== null && dynRoom.id === roomId && levelProbeWeight > 0;
        node.slots.probeDynCfg.value.set(on ? probeDynGain : 0, on ? probeVisStrength : 0, 0, 0);
      }
      for (const a of actors) {
        const inDyn = dynOn && dynRoom !== null && nearRoom(a, dynRoom);
        a.view.uniforms.probeDynCfg.value.set(inDyn ? probeDynGain : 0, inDyn ? probeVisStrength : 0, 0, 0);
        let best: { pos: Vec3; intensity: number } | null = null, bestScore = 0;
        if (bodyFlashGain > 0 && directFlashes.length > 0) {
          const q = a.pose().pos;
          for (const f of directFlashes) {
            const dx = f.pos[0] - q[0], dy = f.pos[1] - (q[1] + 1.0), dz = f.pos[2] - q[2];
            const score = f.intensity / Math.max(0.25, dx * dx + dy * dy + dz * dz);
            if (score > bestScore) { bestScore = score; best = f; }
          }
        }
        if (best) a.view.uniforms.bodyFlash.value.set(best.pos[0], best.pos[1], best.pos[2], best.intensity * bodyFlashGain);
        else a.view.uniforms.bodyFlash.value.w = 0;
        a.view.uniforms.spotPos.value.copy(flashlight.spot.position);
        a.view.uniforms.spotAxis.value.copy(sAxis);
        a.view.uniforms.spotCfg.value.set(flashGate, flashInner, flashOuter, flashlight.spot.distance);
        a.view.uniforms.spotColor.value.copy(flashlight.spot.color);
        if (bounceSpot) {
          a.view.uniforms.bounceSpotPos.value.set(bounceSpot.pos[0], bounceSpot.pos[1], bounceSpot.pos[2]);
          a.view.uniforms.bounceSpotNormal.value.set(bounceSpot.normal[0], bounceSpot.normal[1], bounceSpot.normal[2]);
          a.view.uniforms.bounceSpotRadiance.value.set(bounceSpot.radiance[0], bounceSpot.radiance[1], bounceSpot.radiance[2]);
          a.view.uniforms.bounceSpotCfg.value.set(bounceSpotGain, bounceSpot.radius, 0, 0);
        } else {
          a.view.uniforms.bounceSpotCfg.value.x = 0;
        }
        if (fv > 0) {
          // Push warm. The flash is burning powder, not the flashlight's white.
          const c = a.view.uniforms.spotColor.value;
          c.setRGB(c.r + 0.35 * fv, c.g + 0.16 * fv, c.b);
        }
        a.view.uniforms.spotCfg2.value.set(beamTuning.gain, beamTuning.shoulder, beamTuning.keyFloor, 0);
        a.view.uniforms.levelShadowMatrix.value.copy(twin.shadow.matrix);
        a.view.uniforms.levelShadowCfg.value.x = lvlOn;
        if (map !== null) a.view.levelShadowTex.value = map;
        // Crowd stage a: flush the per-instance record AFTER every setter and
        // the loop's own bodyFlash write, so the type's shared buffer holds
        // this frame's state before CrowdType.sync flushes it. Idempotent on
        // the per-body path (the view's own material reads the same record).
        a.view.syncRecord();
      }
      // Detached views copied the lamp only at spawn, so moving/turning the
      // camera left their flashlight behind until the bake suddenly caught up.
      // Refresh at draw time, including render-locked diagnostic frames.
      for (const c of bakedChunkReference ? [...liveChunks, ...bakedChunks] : liveChunks) {
        const u = c.view.uniforms;
        u.spotPos.value.copy(flashlight.spot.position);
        u.spotAxis.value.copy(sAxis);
        u.spotCfg.value.set(spotOn, cosInner, cosOuter, flashlight.spot.distance);
        u.spotColor.value.copy(flashlight.spot.color);
        u.spotCfg2.value.set(beamTuning.gain, beamTuning.shoulder, beamTuning.keyFloor, 0);
      }
      // Bone tubes take the SAME beam (bone-instancer's boneShade is the
      // march's own cone formula on these exact values).
      boneInstancer.uniforms.spotPos.value.copy(flashlight.spot.position);
      boneInstancer.uniforms.spotAxis.value.copy(sAxis);
      boneInstancer.uniforms.spotCfg.value.set(spotOn, cosInner, cosOuter, flashlight.spot.distance);
      boneInstancer.uniforms.spotColor.value.copy(flashlight.spot.color);
      boneInstancer.uniforms.spotCfg2.value.set(beamTuning.gain, beamTuning.shoulder, beamTuning.keyFloor, 0);
      if (segMeshRenderer) {
        // skeleton=mesh: the SAME beam — segment boneShade is the march's
        // formula on the same uniform values, like the tubes.
        segMeshRenderer.uniforms.spotPos.value.copy(flashlight.spot.position);
        segMeshRenderer.uniforms.spotAxis.value.copy(sAxis);
        segMeshRenderer.uniforms.spotCfg.value.set(spotOn, cosInner, cosOuter, flashlight.spot.distance);
        segMeshRenderer.uniforms.spotColor.value.copy(flashlight.spot.color);
        segMeshRenderer.uniforms.spotCfg2.value.set(beamTuning.gain, beamTuning.shoulder, beamTuning.keyFloor, 0);
      }
      // Baked chunks ride the same beam — same values, same formula. EVERY
      // registered instance, not just the shared one: the gore-parts bench and
      // the carved library build their OWN instances (they need their own
      // `goreCfg`), and an instance that misses this block is lit by the static
      // defaults — a fixed 2.4 directional key with the flashlight OFF, which
      // blows flesh albedo to white in a dark room. That was the owner's "pale …
      // nothing even abit fleshy".
      // ...and the same MICRO-DETAIL. A settled chunk stops being marched, and
      // the bake drops every per-pixel term the march had — which is why the
      // owner's read was that the pieces "turn into this baked smooth albedo"
      // beside a living zombie that "is pink and has a noisy normal texture".
      // `surfCfg2.y` IS that texture (surfaceNoiseAmp), so it is copied off a
      // LIVE body rather than re-authored: a piece and the creature it came off
      // cannot drift apart, and the wound panel's slider moves both at once.
      // Falls through with the last value when the cast is empty, so a piece
      // does not go smooth the moment its own body is the last one gibbed.
      const liveSurf = actors[0]?.view.uniforms.surfCfg2.value;
      // THE ROOM'S LIGHT, every frame — not just the beam.
      //
      // `seedBaked` copies lightDir/keyColor/lightCfg and derives an ambient from
      // body 1's six wall colours ONCE, when the material is created. So a
      // settled piece was frozen to whatever room the FIRST chunk happened to
      // bake in: carry the gore next door and it keeps the old room's fill,
      // while the marched bodies beside it track the new one. The owner:
      // "it doesnt appeart they follow the ambient and other enviroment light".
      //
      // Re-derived here from the same live view the seed read, by the same
      // formula, so the only thing that changes is WHEN it is sampled.
      const liveView = actors[0]?.view.uniforms;
      // `?chunkdetail=` / `__sdfGame.setChunkDetail(x)` overrides the creature's
      // own amplitude. The shipped value is the flesh preset's surfaceNoiseAmp
      // (0.06), which is deliberately subtle on a marched body and is therefore
      // hard to judge on a settled piece without sweeping it — so it sweeps.
      const detailAmp = chunkDetailOverride
        ?? (liveSurf ? Math.min(1, liveSurf.y * CHUNK_DETAIL_GAIN) : null);
      for (const lm of litChunkMaterials) {
        const bu = lm.uniforms;
        bu.spotPos.value.copy(flashlight.spot.position);
        bu.spotAxis.value.copy(sAxis);
        bu.spotCfg.value.set(spotOn, cosInner, cosOuter, flashlight.spot.distance);
        bu.spotColor.value.copy(flashlight.spot.color);
        bu.spotCfg2.value.set(beamTuning.gain, beamTuning.shoulder, beamTuning.keyFloor, 0);
        if (detailAmp !== null) {
          bu.fleshDetail.value.set(
            detailAmp, chunkDetailFreq, chunkDetailAlbedo, 0);
        }
        if (liveView) {
          bu.lightDir.value.copy(liveView.lightDir.value);
          bu.keyColor.value.copy(liveView.keyColor.value);
          bu.lightCfg.value.copy(liveView.lightCfg.value);
          const w = [liveView.wallNegX, liveView.wallPosX, liveView.wallNegY,
            liveView.wallPosY, liveView.wallNegZ, liveView.wallPosZ];
          let mr = 0, mg = 0, mb = 0;
          for (const c of w) { mr += c.value.r / 6; mg += c.value.g / 6; mb += c.value.b / 6; }
          const fill = liveView.lightCfg.value.y;
          const key = liveView.keyColor.value;
          const pw = liveView.bounceCfg.value.x;
          bu.ambient.value.setRGB(
            fill * key.r + pw * mr * 0.5,
            fill * key.g + pw * mg * 0.5,
            fill * key.b + pw * mb * 0.5);
        }
      }
    }
    // Front-to-back per-body passes (perf round 2 task 5): register this
    // frame's bodies and chunks. With the gate off the lists are not walked.
    // LEGACY ONLY — the deferred mode's SDF producer pass is fed by the
    // router, not by sdf-layer's body list.
    updateVisibleActors();
    // CROWD STAGE A: one sync per type per frame, after every attached view
    // has written its record AND after updateVisibleActors(), so the visible
    // set passed to sync() is THIS frame's. The per-frame globals (beam,
    // level shadow, dynamic probes, time, probe weight) are copied from the
    // type's source view, which the loop above just updated; tileCfg.x
    // follows the game's tile switch exactly as a per-body view's does.
    //
    // VISIBLE-ONLY PACKING (perf 7e): `?crowd=1` attaches every actor at
    // spawn; without this filter the crowd path packed and binned the whole
    // level every frame and the cost tracked the cast, not the bodies on
    // screen. The per-body path is untouched — it already draws only
    // visibleActors.
    if (crowdOn && crowdTypes.size > 0) {
      const csize = sdfLayer.targetSize;
      const grid = {
        tilesX: Math.ceil(Math.max(1, csize.width) / TILE_SIZE_PX),
        tilesY: Math.ceil(Math.max(1, csize.height) / TILE_SIZE_PX),
        tilePx: TILE_SIZE_PX,
      };
      const crowdTiming = telemetry.begin();
      // The level-shadow depth texture the type rebinds (same expression the
      // per-body loop's `map` uses; `flashlight.levelShadow.shadow.map` is
      // unchanged between there and here — nothing renders in between).
      const levelShadowMap = flashlight.levelShadow.shadow.map?.depthTexture ?? null;
      const vis = new Set<number>();
      for (const t of crowdTypes.values()) {
        const src = crowdSourceView.get(t);
        const copyTiming = telemetry.begin();
        if (src) copyUniformValues(t.uniforms, src.uniforms);
        telemetry.end('crowd-uniform-copy', copyTiming);
        // CROWD REQUIRES ITS TILE LIST (task 8). The per-body tile playtest
        // (`gameTiles`) gates only the per-body path; the crowd type owns its
        // own ComputeTileBinding and always bins it, so a ship-defaults
        // `setTiles(false)` can no longer pin the crowd march to the slow
        // per-slot cluster walk. tileCfg.x is the entry mode: 1 = tile list.
        t.uniforms.tileCfg.value.x = 1;
        if (levelShadowMap !== null) t.levelShadowTex.value = levelShadowMap;
        vis.clear();
        for (const a of visibleActors) {
          if (a.crowd?.type !== t) continue;
          // A headless baked corpse is drawn by its mesh; its instance must not
          // march too (see soldier-corpse-bake bakedState).
          if (soldierCorpses?.bakedState(a.id) === 'headless') continue;
          vis.add(a.crowd.slot);
        }
        t.sync(camera, grid, vis);
      }
      telemetry.end('crowd-sync', crowdTiming);
    }
    // Crowd stage a: one instanced mesh per type replaces its N hidden
    // per-body proxies; unattached (or crowd-off) actors keep their proxies.
    // Fire/gib profiling (2026-09-14): label the two draw-fn spans that are
    // NOT the per-type sync so the bench can attribute a cpu:draw climb.
    const setBodiesTiming = telemetry.begin();
    sdfLayer.setBodies(
      crowdOn
        ? ([...crowdTypes.values()].map(t => t.mesh) as THREE.Object3D[])
            .concat(visibleActors.filter(a => !a.crowd).map(a => a.view.object))
        : visibleActors.map(a => a.view.object),
      chunkObjects());
    telemetry.end('crowd-set-bodies', setBodiesTiming);
    const sdfRenderTiming = telemetry.begin();
    if (gooEnabled && gooLayer) {
      // Fire/gib profiling: the goo layer's callback IS the SDF submit, so
      // nest so the bench can tell a goo pass from the march submit.
      const gooTiming = telemetry.begin();
      gooLayer.render(camera, () => {
        const inner = telemetry.begin();
        sdfLayer.render(scene, camera);
        telemetry.end('crowd-sdf-inner', inner);
      });
      telemetry.end('crowd-goo-outer', gooTiming);
    } else {
      const inner = telemetry.begin();
      sdfLayer.render(scene, camera);
      telemetry.end('crowd-sdf-inner', inner);
    }
    telemetry.end('crowd-sdf-render', sdfRenderTiming);
    characterEffects.render(camera);
    });
  });

  const occluderHull = createOccluderHull();
  occluderHull.object.layers.set(OCCLUDER_LAYER);
  scene.add(occluderHull.object);
  // The inflated shadow-casting twin (see occluder-hull.ts). castShadow and
  // the layer are already set in the factory; spelled out here to sit beside
  // the occlusion hull's wiring, where the next reader will look first.
  //
  // NOTE it rides SHADOW_HULL_LAYER, NOT the occluder layer — which is why
  // the pre-pass being switched off below does not cost us character
  // shadows. The two hulls are twins in shape only; they have opposite
  // biases (shrunk to stay inside the body vs inflated to close the gaps
  // between spheres) and now opposite fates.
  occluderHull.shadowObject.layers.set(SHADOW_HULL_LAYER);
  occluderHull.shadowObject.castShadow = true;
  scene.add(occluderHull.shadowObject);
  // DEFERRED MODE: the occlusion hull and its inflated shadow twin are
  // march/composite helpers, never G-buffer or forward content — the shadow
  // module finds the twin through its SHADOW_HULL_LAYER membership instead.
  deferredApi?.router.register(occluderHull.object, 'exclude');
  deferredApi?.router.register(occluderHull.shadowObject, 'exclude');

  // OCCLUDER PRE-PASS OFF (2026-09-01). Its tMax clamp is gone from the
  // march -- the distance it rasterises is only accurate in the near field
  // and under-reports badly beyond ~3 m, which shredded bodies at range.
  // The full measurement and the revival conditions are in march.wgsl.ts
  // above tMax. __sdfGame.setOccluder still renders the pass for
  // diagnostics; nothing consumes it.
  sdfLayer.setOccluderEnabled(false);

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
  const GAME_RELAX = 1.0;

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
  const GAME_HULL_EXIT_BOUND = 1;

  /** Close-up task 3: the quarter-resolution depth prepass — a coarse march
   *  of the same field at one texel per 4x4 SDF-pixel block (~1/16 of the
   *  marching work), whose first cone-touch distance the full-res ray starts
   *  from. The start is a PROVABLE lower bound on every block ray's own
   *  first surface (DEPTH_PREPASS_MARCH carries the proof), so too-aggressive
   *  a start is not a tuning risk — but it is the failure mode that DELETES
   *  geometry, silently and range-dependently, exactly like the exit bound's
   *  historical body deletion. So this ships OFF until the task-3 census
   *  (zero missing bodies at 0.5/3/9 m, zero missing thin geometry) and the
   *  interleaved bench EARN the flip — a timing table alone is not evidence:
   *  the exit bound once "won" 0.28 ms by deleting 4 of 9 bodies.
   *  `__sdfGame.setDepthPrepass()` flips it live for A/B; OFF is bit-identical
   *  to the pre-task-3 march (the fetch hands back 0 and the max() folds). */
  // BACK TO 0 (2026-09-09). Flipped to 1 for one owner look pass and REVERTED
  // the same day: the geometry deletion this comment warned about was "very
  // noticeable" in play, exactly the failure the task-3 census exists to catch.
  // That is now an owner-observed result, not a hypothesis — do not flip it
  // again without first passing the census (zero missing bodies at 0.5/3/9 m,
  // zero missing thin geometry). `__sdfGame.setDepthPrepass()` still flips it
  // live for anyone who wants to reproduce the artifact.
  const GAME_DEPTH_PREPASS = 0;

  /** Perf round 2, task 3: skip a wound's meta/cap texel loads when the
   *  sample is beyond the wound's reach (perfCfg.y). Exact-by-construction —
   *  see the march.wgsl.ts reach comment; `__sdfGame.setWoundEarlyOut()`
   *  flips it live for A/B. */
  const GAME_WOUND_EARLY_OUT = 1;


  /**
   * Step multiplier for the game page's march (marchCfg.y). The lab ships
   * 0.6 (under-relaxed) to survive the fbm shell displacement, which this
   * page runs with amplitude 0. With a conservative field, 1.0 is plain
   * sphere tracing: exact, fewer steps, and it never enters the omega > 1
   * overshoot path that produced the 2026-08-31 box washes.
   * `__sdfGame.setOmega()` flips it live for A/B.
   */
  const GAME_OMEGA = 1.0;
  /** Near-wound step multiplier the GAME ships (perfCfg.z; 0 would mean the
   *  shader's sound constant WOUND_STEP_MUL 0.6). 1.0 on the owner's look
   *  verdict (2026-09-05, own tab, stacked craters at close and mid range:
   *  "1.0 seems fine, no major visual differences"); the wounds bench prices
   *  the 0.6 zone at 6–30% of a wounded fill-screen frame. The lab keeps the
   *  sound constant — march-step-soundness.test.ts pins it below 0.6. */
  const GAME_WOUND_STEP = 1.0;
  // Last-step secant accept (Claybook slide 25; MARCH_BODY's perfCfg.w).
  // SHIPS AT 4 (2026-09-09): accepts the hit once the secant root through
  // the last two samples is within 4 hit-epsilons. A/B on room 1 (8 walking
  // bodies): 11.92 -> 10.17 ms; wound/gib-heavy rooms inside repeat spread;
  // 1.1 m close-up pair visually identical. ?laststep=K overrides (0 = off,
  // the pre-lever march bit for bit); __sdfGame.setLastStep() flips it live.
  const GAME_LAST_STEP = (() => {
    const raw = new URLSearchParams(location.search).get('laststep');
    if (raw === null) return 4;
    const v = Number(raw) || 0;
    return v > 0 ? Math.min(16, v) : 0;
  })();

  /** Perf round 2, task 6: the footprint-AA strength (aaCfg.y). When > 0 the
   *  march may accept a sample once the field is within the ray's projected
   *  PIXEL footprint (t * aaCfg.x) instead of the 1.2 mm literal — fewer
   *  steps at range, geometric aliasing prefiltered below Nyquist. The
   *  epsilon divides by the dominant prim's GROUP DISTORTION factor
   *  (gFoldBestDistort, up to 22x on the schoolgirl sole plate) so
   *  high-distortion regions cannot stop a ray short — the exact defect that
   *  kept this lever OFF when it first shipped (see march.wgsl.ts).
   *  `__sdfGame.setAa(strength)` flips it live for A/B; 0 is the old
   *  behaviour bit-for-bit (t * 0 / distort == t * 0 == 0). */
  const GAME_AA = 1.0;

  /** Perf round 2, task 7: bodies RECEIVE the level's shadows. The twin
   *  light (dungeon-lighting.ts) renders a level-only depth map (layer 0 —
   *  no body hulls, so no self-shadowing) from the flashlight's pose; the
   *  march multiplies the KEY diffuse+specular by a 4-tap PCF lookup into
   *  it. One texture load per hit pixel, zero extra field evaluations.
   *  `__sdfGame.setLevelShadow(on)` flips it live; 0 is bit-for-bit the
   *  pre-task-7 march. NOT a level-shadow ABLATION for the bench: the twin's
   *  1024² map still renders — for the shadow-cost split use ?spotshadow=0,
   *  which kills both maps at boot. */
  const GAME_LEVEL_SHADOW = 1.0;
  /** Live seam state for the setter/getter; read by the per-frame pose
   *  block. Frames cannot fire mid-main (sync boot), so the let below is
   *  initialised before any draw — the same reasoning the blob comment
   *  above relies on. */
  let levelShadowEnabled = GAME_LEVEL_SHADOW > 0.5;

  /** The silhouette-noise amplitude the hull must budget for (marchCfg.z).
   *  Read from the live uniform rather than a constant, so retuning the noise
   *  cannot silently under-size the hull — X1.21.2 was exactly that bug on the
   *  cone and occluder bounds. */
  const shellAmpOf = () => actors[0]?.view.uniforms.marchCfg.value.z ?? 0;

  // The conservative OUTER hull (shell-hull-outer.ts). Default OFF: it is a
  // measurement instrument until the march consumes it, and rasterising it
  // for nothing is pure cost.
  const outerHull = createOuterHull();
  outerHull.entryObject.layers.set(SHELL_LAYER);
  outerHull.exitObject.layers.set(SHELL_EXIT_LAYER);
  scene.add(outerHull.entryObject);
  scene.add(outerHull.exitObject);
  deferredApi?.router.register(outerHull.entryObject, 'exclude');
  deferredApi?.router.register(outerHull.exitObject, 'exclude');
  // SHELL ON BY DEFAULT (owner visual pass, 2026-08-31). Worth -40%/-54%
  // frame time (room 4/3) at real-render parity below the same-state noise
  // floor. The hull is populated by the frame loop before the first draw
  // (tick runs ahead of drawFn), so no first-frame dropout. __sdfGame
  // .setShell(false) is the kill switch.
  sdfLayer.setShellEnabled(true);

  // BONE TUBES (2026-09-02-bone-tubes plan, task 5): every posed bone prim
  // drawn as one instanced analytic tube in the POLYGONAL pass (layer 0),
  // hidden under flesh and revealed in cavities by the composite depth test.
  // Ships OFF until the owner's gate — applyBoneMesh also flips every view's
  // packBones layout so the field stops carrying the bones it no longer draws.
  // Cap 512, not the plan's 256: measured on the live page (task 5 boot) the
  // cast packs 380 live bones — 46 bonePrims per zombie (23 authored × mirror
  // expansion), 38 in live clusters × 10 zombies — plus up to 12 flying
  // chunks. 256 overflowed on the first frame.
  // 2026-09-03 skeleton re-author: 67 drawn bones per zombie (12 rib pairs as
  // hoops, clavicles, a 15-piece pelvis), x10 bodies = 670 > 512.
  const boneInstancer = createBoneInstancer(1024,
    // DEFERRED MODE: the tubes are a level-only G-buffer producer (tissue —
    // a body's own hull must not swallow their light).
    deferredMode ? { output: 'surface', shadowReceiver: 'level-only' } : undefined);
  let gibBoneMesh = new URLSearchParams(location.search).get('gibbonemesh') !== '0';
  boneInstancer.object.layers.set(0);
  // Visible when EITHER path draws through it — gib bones alone are enough.
  boneInstancer.object.visible = gibBoneMesh;
  scene.add(boneInstancer.object);
  deferredApi?.router.register(boneInstancer.object, 'mesh', 'level-only');
  let boneMesh = false;
  /**
   * GIB BONES ARE MESH TUBES, not marched field rows (2026-09-15, owner's call:
   * "we need to change it so the bone gibs are mesh").
   *
   * Its own flag rather than `boneMesh`, because `boneMesh` switches BODIES too
   * and a living actor already wears a different skeleton entirely — extracted
   * segment meshes, `resolveSkeletonMode` defaulting to 'mesh'. Only DETACHED
   * pieces were still marched, and only because of this in `spawnChunkPiece`:
   *
   *     setPackBones(boneOnly ? true : !boneMesh)
   *
   * A bone-only chunk was forced to pack its bone rows whatever the tube mode
   * was, because with packing off its flesh list is empty, it marches an empty
   * field, and the skeleton is invisible. That guard is right when nothing else
   * draws the piece — but the instancer has been fed `liveChunks.map(c =>
   * c.view.posedBones())` all along, so with tubes on there IS something else
   * drawing it, and the guard is what kept the bones marched.
   *
   * This also relieves the cost the `gibbones=core` default was aimed at: a bone
   * piece never bakes, so as a marched chunk it holds a view slot for its whole
   * life. As a tube it holds none.
   */
  // Accepted actor skeleton default: extracted meshes in forward mode.
  // ?skeleton=procedural restores the reference; volume remains dev-only.
  // Deferred and detached chunks retain procedural bones.
  const skeletonMode = resolveSkeletonMode(location.search, {
    dev: import.meta.env.DEV, deferred: deferredMode,
  });
  if (import.meta.env.DEV && new URLSearchParams(location.search).get('skeleton') === 'mesh' && skeletonMode !== 'mesh') {
    console.warn('[sdf-game] skeleton=mesh refused (deferred mode) — procedural bones');
  }
  const segMeshCache = skeletonMode === 'mesh' ? new SegmentMeshCache() : null;
  // FIELD_MESH_LAYER, not 0: the 'bodies' field style needs to pull the
  // skeleton out of the full-resolution polygonal pass and draw it into the
  // half-height field instead. Every other style just enables that layer in
  // pass 1, so this is a no-op for them.
  const segMeshRenderer = segMeshCache ? createSegmentMeshRenderer(segMeshCache, FIELD_MESH_LAYER) : null;
  if (segMeshRenderer) scene.add(segMeshRenderer.object);
  const skeletonSources = new Map<ZombieActor, { body: BuildResult; name: string; sources: BoneFieldSource[] }>();
  const segVolumeCache = skeletonMode === 'volume' ? new SegmentVolumeCache() : null;
  type SharedVolumeAtlas = ReturnType<typeof buildSegmentAtlas> & {
    texture: ReturnType<typeof createSegmentAtlasTexture>;
    refs: number;
  };
  const sharedVolumeAtlases = new Map<string, SharedVolumeAtlas>();
  let volumeAtlasBuilds = 0;
  const skeletonVolumes = new Map<ZombieActor, {
    body: BuildResult; name: string; sources: BoneFieldSource[];
    key: string; binding: SegmentVolumeBinding;
  }>();
  /** Contract recipe (fixture-contract.md): sources bind against the
   *  actor's CURRENT body + bound rig and follow the live rig/yaw through
   *  accessors. Called at spawn (rig at rest) and on sever re-derive
   *  (body reference change — mid-pose re-bind is a documented prototype
   *  approximation for limb local frames, re-measured in task 4). */
  const buildSkeletonSources = (actor: ZombieActor, name: string) => ({
    body: actor.body,
    name,
    sources: createSkeletonSources(actor.body, actor.boundRig(), {
      character: name,
      rig: () => actor.boundRig().rig,
      bodyYaw: () => actor.pose().yaw,
    }),
  });
  const acquireVolumeAtlas = (actor: ZombieActor, sources: readonly BoneFieldSource[]) => {
    const key = sources.map(source => source.revision).sort().join('|');
    let shared = sharedVolumeAtlases.get(key);
    if (!shared) {
      const segIds = boneSegmentKeyMap(actor.body, actor.boundRig());
      const atlas = buildSegmentAtlas(sources.flatMap(source => {
        const segId = segIds.get(source.segment);
        return segId === undefined ? [] : [{ segId, grid: segVolumeCache!.get(source) }];
      }));
      shared = Object.assign(atlas, { texture: createSegmentAtlasTexture(atlas), refs: 0 });
      sharedVolumeAtlases.set(key, shared);
      volumeAtlasBuilds++;
    }
    shared.refs++;
    return { key, shared };
  };
  const releaseVolumeAtlas = (key: string) => {
    const shared = sharedVolumeAtlases.get(key);
    if (!shared || --shared.refs > 0) return;
    shared.texture.dispose();
    for (const meta of shared.metas) segVolumeCache?.evict(meta.grid);
    sharedVolumeAtlases.delete(key);
  };
  const bindSkeletonVolume = (actor: ZombieActor, name: string) => {
    const prior = skeletonVolumes.get(actor);
    if (prior) { prior.binding.dispose(); releaseVolumeAtlas(prior.key); }
    const state = buildSkeletonSources(actor, name);
    const { key, shared } = acquireVolumeAtlas(actor, state.sources);
    const binding = new SegmentVolumeBinding(shared, shared.texture, state.sources);
    actor.view.setSkeletonVolume(shared.texture, binding.metaTexture);
    const crowd = actor.crowd;
    if (crowd) {
      // Per-instance segVolumeMeta is a stage-a gap: ONE meta per type means
      // only the first instance's pose can drive 'segment' bone culling. The
      // honest fallback for the rest is 'cluster', which needs no per-instance
      // pose. The type binds the FIRST attached actor's shared atlas/meta (and
      // re-binds it when that actor's own revision changes); a later actor's
      // bind is ignored — its own view still holds the right pair.
      actor.view.setBoneCullMode('cluster');
      if (crowdSourceView.get(crowd.type) === actor.view || !crowdVolumeBound.has(crowd.type)) {
        crowd.type.setSkeletonVolume(shared.texture, binding.metaTexture);
        crowdVolumeBound.add(crowd.type);
        if (!crowdSegMetaWarned) {
          crowdSegMetaWarned = true;
          console.warn('[crowd] segVolumeMeta is per-type from the first attached actor; '
            + 'other instances fall back to cluster bone culling (stage-a gap)');
        }
      }
    } else {
      actor.view.setBoneCullMode('segment');
    }
    // Analytic primitive gradients cannot represent a sampled field.
    actor.view.uniforms.normalGradientCfg.value.x = 0;
    skeletonVolumes.set(actor, { ...state, key, binding });
  };
  const releaseSkeletonActor = (actor: ZombieActor) => {
    actor.crowd?.type.detach(actor.crowd.slot);
    skeletonSources.delete(actor);
    const volume = skeletonVolumes.get(actor);
    if (!volume) return;
    volume.binding.dispose();
    releaseVolumeAtlas(volume.key);
    skeletonVolumes.delete(actor);
  };
  import.meta.hot?.dispose(() => {
    segMeshRenderer?.dispose();
    segMeshCache?.dispose();
    for (const state of skeletonVolumes.values()) state.binding.dispose();
    skeletonVolumes.clear();
    for (const atlas of sharedVolumeAtlases.values()) atlas.texture.dispose();
    sharedVolumeAtlases.clear();
    segVolumeCache?.dispose();
  });
  // Bone-cluster sphere cull (packBoneClusters). OFF ships — the old flat
  // bone loop; the bench's bone-cull-on leg flips it. Takes effect on the
  // next upload; promotion to ON is the owner's call after the numbers.
  // BONE CULL SHIPS 'segment' (owner call, 2026-09-07). Per-rigid-segment
  // bone spheres: exact (identical hit counts across off/cluster/segment,
  // pixel gate at the noise floor), bone evaluations -48% on a wounded
  // frozen scene. Measured wounded-march win is small (~5-7% in room 3,
  // unresolved in room 4) — culling has reached the point where what is
  // left near a torso wound is genuinely near; the remaining bone cost goes
  // away only by taking bones out of the field (baked bone-segment meshes,
  // after deferred). Applied to every actor at spawn (spawnEnemy) and to
  // late toggles via setBoneCullMode. Chunks stay on the flat fold.
  // Evidence: docs/dev-notes/2026-09-07-bone-segment-spheres/notes.md.
  const GAME_BONE_CULL_MODE = 'segment' as 'off' | 'cluster' | 'segment';
  let boneCull = GAME_BONE_CULL_MODE !== 'off';
  // Three-way cull state (bone-segment spheres): boneCull stays the boolean
  // view (off vs any cull) the old seam reports.
  let boneCullMode: 'off' | 'cluster' | 'segment' = GAME_BONE_CULL_MODE;
  function applyBoneCullMode(mode: 'off' | 'cluster' | 'segment'): void {
    boneCullMode = mode;
    boneCull = mode !== 'off';
    for (const a of actors) a.view.setBoneCullMode(mode);
    for (const c of liveChunks) c.view.setBoneCullMode(mode);
  }
  function applyBoneCull(on: boolean): void {
    applyBoneCullMode(on ? 'cluster' : 'off');
  }
  function applyBoneMesh(on: boolean): void {
    boneMesh = on;
    boneInstancer.object.visible = on || gibBoneMesh;
    for (const a of actors) a.view.setPackBones(!on);
    for (const c of liveChunks) c.view.setPackBones(!on);
  }

  /** Perf round 2, task 5: front-to-back per-body passes, gated and bounded
   *  by the depth nearer passes already recorded at each pixel.
   *  Parity-proven by 5b (rooms 3/4 + staged overlap: a-vs-b at/below the
   *  capture noise floor; residual = sub-pixel fringe on occluded
   *  silhouettes) — the gate is CORRECT.
   *
   *  DEFAULT 0, not 1 (task 5b): the bench A/B measured the pass structure
   *  itself as a net LOSS at 3-4 bodies — per-body sub-passes each pay a
   *  full-target blit plus a renderer.render() scene walk (sdf-layer's pass-2
   *  loop), ~6-7 ms/frame more than the single-pass march in the run's two
   *  clean paired reps (r3 walk 9.09/8.59 off vs 15.80/15.84 on; r4 rep0
   *  agrees), dwarfing the baseline legs' own 5% spread. The skipped
   *  hidden-fragment marches are smaller than that overhead at these body
   *  counts. Task 9 re-takes on a quiet machine; if it resolves positive at
   *  higher body counts, flip back here. `__sdfGame.setDepthGate()` flips it
   *  live for A/B. */
  const GAME_DEPTH_GATE = 0;
  sdfLayer.setDepthGate(GAME_DEPTH_GATE > 0.5);
  sdfLayer.setDepthPreEnabled(GAME_DEPTH_PREPASS > 0.5);
  // TEMPORAL REPROJECTION START (plan 2026-09-10). SHIPS ON (owner,
  // 2026-09-10, after the own-body gate): march pass p50 14.9 -> 11.3 ms
  // on the room-4 bench (walk 11.0 -> 7.0, gib 18.0 -> 13.8), no visible
  // artefacts. ?tstart=0 pins the bit-identical march;
  // __sdfGame.setTemporalStart(on, margin, slope) flips it live.
  sdfLayer.setTemporalStart(new URLSearchParams(location.search).get('tstart') !== '0');
  // INTERLACED FIELDS ON (2026-09-09), replacing half-rate. Half-rate held
  // and reprojected the whole marched frame, which desynced from the
  // full-rate skeleton meshes whenever the player moved — reprojected flesh
  // against exactly-rendered polygons. Fields march half the SCANLINES at the
  // CURRENT camera every frame, so that error class does not exist, and the
  // comb IS the intended look.
  //
  // 'bodies' (owner, 2026-09-09): flesh and skeleton field TOGETHER — so the
  // characters carry the interlace and no flesh/bone row disagreement is
  // possible — while the level and the viewmodel stay crisp. 'frame' also
  // removes the disagreement but combs the gun and hands with everything
  // else; 'sdf' is cheapest but is the style that HAS the disagreement.
  //
  // Comb 0.6, not 1: full hold was judged too strong in play. 1 holds the
  // stale field verbatim, 0 interpolates it away entirely.
  // __sdfGame.setFieldStyle('off'|'sdf'|'bodies'|'frame') and setFieldComb(x).
  // DEFAULT IS 'bodies' (owner, 2026-09-09). It was reverted to 'frame' for
  // a day while its see-through rendering was diagnosed: two mechanical
  // defects in the mesh pass (autoClear undoing the coverage clear, and a
  // 1x1 depth allocation on the retained mesh field), both fixed in 9f205aaa
  // and pinned by tests. Resolution and history:
  // docs/dev-notes/2026-09-09-perf-spikes/bodies-style-handoff.md
  sdfLayer.setFieldStyle('bodies');
  sdfLayer.setFieldComb(0.6);
  // DEEPER INTERLACE FIELDS (plan 2026-09-10, steps 1-2). `?fields=N` selects the
  // divisor: 2 is the shipped half-height field, 3 and 4 march a third or a
  // quarter of the rows. The owner gate on h/3 and h/4 is an ON-SCREEN look call —
  // the comb changes period from 2 rows to 3-4 — and the arithmetic here is not
  // that decision.
  //
  // Absent is NOT zero — the boot-param rule: this reads the RAW string, so a
  // missing parameter leaves the shipped 2 alone rather than pinning a divisor
  // nobody asked for. A bad value degrades to 2, and the shader clamps again.
  //
  // There was briefly a `?fieldsdemo=1` gate here, active while a phantom WGSL
  // input (fixed in 43779459) made the flesh vanish at every divisor INCLUDING the
  // default. The gate is GONE: keeping it would ship a parameter that silently
  // does nothing, which is a trap for the next reader. `?fields=N` now does
  // exactly what it says.
  const fieldsBoot = parseIntParam(new URLSearchParams(location.search).get('fields'), { min: 2, max: 8 });
  if (fieldsBoot !== null) sdfLayer.setFieldCount(fieldsBoot);

  // ORDER MATTERS AND THIS IS THE LAST WORD ON THE WEAVE. The block above sets
  // fieldStyle 'bodies' (and `?fields`), so an accumulation switch applied BEFORE
  // it would be silently overwritten and the owner would still see the interlace
  // with `?accum=1` — which is exactly what happened on the first look (2026-09-10).
  // Accumulation REPLACES the weave, so it has to speak after it.
  // TEMPORAL ACCUMULATION (2026-09-10, plan docs/superpowers/plans/2026-09-10-temporal-accumulation.md).
  // A half-scale march is worth ~8 ms of a 16.6 ms frame but is "too pixelated and
  // aliased" on its own; this reconstructs it from a jittered, camera-reprojected
  // history. `?accum=1` turns it on AND drops the march to the default scale,
  // because accumulating at full scale is pointless; `?accumscale=` and
  // `?accumalpha=` override. Turning it on turns the field weave OFF (mutually
  // exclusive — accumulation replaces the weave, it does not join it).
  {
    const accumRaw = new URLSearchParams(location.search).get('accum');
    if (accumRaw !== null && accumRaw !== '0') {
      const accumSearch = new URLSearchParams(location.search);
      // DEFAULT THE SCALE, don't just allow it: accumulating at full scale is a
      // temporal AA with none of the perf win, so `?accum=1` on its own would be a
      // switch that looks like it does nothing. `?accumscale=` overrides.
      const scale = parseFloatParam(accumSearch.get('accumscale'), { min: 0.2, max: 1 })
        ?? TEMPORAL_ACCUM_DEFAULT_SCALE;
      // THE GAME'S OWN STATE IS THE SOURCE OF TRUTH, not the layer's. Writing
      // sdfLayer.setScale() directly leaves the game's `sdfScale` at 1.0, and
      // anything that re-applies it (a resize, the adaptive path, a later seam)
      // silently undoes this — which is exactly what a state read showed:
      // ?accumscale=0.35 booted with the layer at 1.0 (2026-09-10). Same two
      // lines the setSdfScale seam uses.
      sdfScale = Math.min(1, Math.max(0.2, scale));
      sdfLayer.setScale(sdfScale);
      deferredApi?.setScale(sdfScale);
      const alpha = parseFloatParam(accumSearch.get('accumalpha'), { min: 0.01, max: 1 });
      sdfLayer.setTemporalAccum(true, alpha ?? undefined);
    }
  }

  // NEURAL UPSCALE STAGE (spec docs/superpowers/specs/2026-09-11-neural-upscale-espcn-design.md).
  // `?upscale=<s8|s16|s32|zero>` enables it with RANDOM weights (a cost/parity
  // probe, not a look) and drops the march to 0.5 — the stage upscales exactly 2x.
  // `?upscalelayout=<sp|dc>`, `?upscaleinputs=<rgb|rgbd>`, `?upscaleseed=<int>`.
  // `?upscale=trained&upscalemodel=<name>` loads a TRAINED export from the dev model
  // store instead (P3, docs/superpowers/plans/2026-09-11-neural-upscale-p3-contracts.md §4);
  // a missing or invalid model leaves the stage off with a console error.
  // Dev-only; absent = the shipped path. The scale goes through the game's own
  // sdfScale state, exactly like the ?accum block above (b9fad129).
  //
  // A/B KEY (P3 spec §5): while an upscale config is active, U cycles
  // native (march 1.0, the field style from before the stage) -> nearest (zero model) -> model.
  // A label bottom-left names the mode. Switching reallocates targets; a hitch is expected.
  const upscaleAb: {
    mode: 'native' | 'nearest' | 'model';
    config: UpscaleConfig | null;
    model: UpscaleModel | null;
    modelName: string | null;
    fieldStyle: typeof sdfLayer.fieldStyle;
  } = { mode: 'model', config: null, model: null, modelName: null, fieldStyle: sdfLayer.fieldStyle };
  let upscaleAbLabel: HTMLDivElement | null = null;
  function updateUpscaleAbLabel() {
    const c = upscaleAb.config;
    if (!c) {
      if (upscaleAbLabel) upscaleAbLabel.hidden = true;
      return;
    }
    if (!upscaleAbLabel) {
      upscaleAbLabel = document.createElement('div');
      upscaleAbLabel.id = 'upscale-ab';
      upscaleAbLabel.setAttribute('style',
        'position:fixed; left:8px; bottom:8px; z-index:40; pointer-events:none;'
        + ' font:12px/1.3 monospace; color:#ffd98a; background:rgba(0,0,0,0.6); padding:3px 6px; border-radius:3px;');
      document.body.appendChild(upscaleAbLabel);
    }
    const m = upscaleAb.model;
    const what = upscaleAb.mode === 'native' ? 'native (march 1.0, no upscale)'
      : upscaleAb.mode === 'nearest' ? 'nearest 2x (zero model)'
      : m ? `model ${upscaleAb.modelName ?? m.id} (${m.id} ${m.inputs}${m.step !== undefined ? `, step ${m.step}` : ''})`
      : `random ${c.model} ${c.inputs} (untrained weights)`;
    upscaleAbLabel.textContent = `upscale [U]: ${what} · ${c.layout}`;
    upscaleAbLabel.hidden = false;
  }
  /** `booted` = false during main()'s boot, which sets the scale the way the ?accum block does. */
  function applyUpscaleAbMode(mode: 'native' | 'nearest' | 'model', booted = true): UpscaleInfo {
    const c = upscaleAb.config;
    if (!c) throw new Error('upscale A/B: no upscale config is active');
    const scaleTo = (v: number) => {
      if (booted) { applySdfScale(v); return; }
      sdfScale = v;
      sdfLayer.setScale(sdfScale);
      deferredApi?.setScale(sdfScale);
    };
    let info: UpscaleInfo;
    if (mode === 'native') {
      info = sdfLayer.setUpscale(null);
      scaleTo(1);
      sdfLayer.setFieldStyle(upscaleAb.fieldStyle);
    } else {
      scaleTo(UPSCALE_SCALE);
      info = mode === 'nearest'
        ? sdfLayer.setUpscale({ model: 'zero', layout: c.layout, inputs: 'rgb', seed: 1 })
        : sdfLayer.setUpscale(c, upscaleAb.model ?? undefined);
    }
    upscaleAb.mode = mode;
    updateUpscaleAbLabel();
    // A stage built AFTER boot carries brand-new per-pass pipelines the boot
    // warm-up never saw; without this they compile on the first frame the new
    // stage runs, which is the same multi-second stall in miniature. Loop
    // paused for the duration, exactly as warmPipelines does it.
    if (booted && info.on) {
      handle.setLoopRunning(false);
      void sdfLayer.precompilePasses(scene, camera)
        .then((n) => console.log(`[warm] upscale stage passes compiled (${n})`))
        .catch((err) => console.warn('[warm] upscale stage precompile failed', err))
        .finally(() => handle.setLoopRunning(true));
    }
    return info;
  }
  // SHIPPED UPSCALERS (owner 2026-09-13, after run 5b — see next-steps note §15):
  //   default: t16-rgb (v3.2) — no normals, no head, the cheapest frame (19 ms vs 19.5–20.4 for s32-rgbd).
  //   high:    the run-5b refine head — medium-band per-body refinement; needs the normal attachments + the
  //            refine pass, so it is a BOOT decision (`?graphics=high`), not a live toggle.
  // (The previous default, s32-rgbd-best.json, stays tracked for history / A-B.)
  const SHIPPED_UPSCALE = {
    default: { url: '/assets/lab/upscale/t16-rgb-v32.json', name: 'ship:t16-rgb-v32', refine: false },
    high:    { url: '/assets/lab/upscale/r5b-s32-rgbn-headr-drop-int2.json', name: 'ship:r5b-s32-rgbn-headr-drop-int2', refine: true },
  } as const;
  /** CAS-style post-sharpen strength shipped with them (UPSCALE_SHARPEN_WGSL, 'cas' mode). */
  const SHIPPED_UPSCALE_SHARPEN = 0.5;
  async function enableTrainedUpscale(name: string, layout?: string, booted = true, url?: string): Promise<UpscaleInfo> {
    const r = await fetch(url ?? `/__lab/upscale-model/${encodeURIComponent(name)}`, { cache: 'no-store' });
    if (!r.ok) throw new Error(`upscale model ${name}: HTTP ${r.status} (expected ${url ?? `.upscale-models/${name}/model.json`})`);
    const model = parseUpscaleModelJson(await r.json());
    const config = parseUpscaleConfig({ model: model.id, inputs: model.inputs, layout, seed: 1 });
    upscaleAb.config = config;
    upscaleAb.model = model;
    upscaleAb.modelName = name;
    return applyUpscaleAbMode('model', booted);
  }
  {
    const upSearch = new URLSearchParams(location.search);
    const upRaw = upSearch.get('upscale');
    if (upRaw === 'trained') {
      const name = upSearch.get('upscalemodel');
      if (!name) {
        console.error('[upscale] ?upscale=trained needs &upscalemodel=<name> — the stage stays off');
      } else {
        try {
          await enableTrainedUpscale(name, upSearch.get('upscalelayout') ?? undefined, false);
        } catch (err) {
          console.error(`[upscale] trained model ${name} not loaded — the stage stays off: ${String(err)}`);
        }
      }
    } else if (upRaw === null) {
      // DEFAULT (owner 2026-09-13): the shipped stage for this graphics level, with CAS sharpen.
      // `?upscale=0` is the native march (the pre-stage picture); the U key still cycles
      // native / nearest / model. NOTE this displaces the 'bodies' field style default: the stage
      // forces fields off (the fields+stage stack was tried and reverted 2026-09-12).
      const ship = SHIPPED_UPSCALE[graphics];
      try {
        await enableTrainedUpscale(ship.name, undefined, false, ship.url);
        sdfLayer.upscaleStage?.setSharpen(SHIPPED_UPSCALE_SHARPEN);
      } catch (err) {
        console.error(`[upscale] shipped model not loaded — native march: ${String(err)}`);
      }
    } else if (upRaw !== '0') {
      const cfg = parseUpscaleConfig({
        model: upRaw,
        layout: upSearch.get('upscalelayout') ?? undefined,
        inputs: upSearch.get('upscaleinputs') ?? undefined,
        seed: parseIntParam(upSearch.get('upscaleseed'), { min: 0, max: 2 ** 31 - 1 }) ?? undefined,
        head: upSearch.get('upscalehead') ?? undefined,   // run-4 full-res head on a random config
        headInputs: upSearch.get('upscaleheadinputs') ?? undefined,   // run-5 'detail' | 'detail+refine'
      });
      sdfScale = UPSCALE_SCALE;
      sdfLayer.setScale(sdfScale);
      deferredApi?.setScale(sdfScale);
      sdfLayer.setUpscale(cfg);
      upscaleAb.config = cfg;
      updateUpscaleAbLabel();
    }
    // `?upscalesharpen=0..1`: contrast-adaptive sharpen over the stage output (UPSCALE_SHARPEN_WGSL).
    // Live: __sdfGame.setUpscaleSharpen(x).
    const sharpenRaw = upSearch.get('upscalesharpen');
    if (sharpenRaw !== null && sdfLayer.upscaleStage) sdfLayer.upscaleStage.setSharpen(Number(sharpenRaw));
    else if (upRaw === 'trained' && sdfLayer.upscaleStage) sdfLayer.upscaleStage.setSharpen(SHIPPED_UPSCALE_SHARPEN);
    const sharpenMode = upSearch.get('upscalesharpenmode');
    if (sharpenMode === 'unsharp' && sdfLayer.upscaleStage) sdfLayer.upscaleStage.setSharpenMode('unsharp');
  }
  // Headless A/B seams (2026-08-27 hull-holes diagnosis): ship defaults stay
  // ON/ON; the driver flips these between captures. Mirrors the lab's
  // __sdfLab.setOccluder.
  let hullExclusionsEnabled = true;
  let occluderDesired = true;

  // -----------------------------------------------------------------------
  mark('zombies-start');
  // Zombies. One compiled .blob, ten bodies; seeds/headings vary, the
  // character does not (12 prims each — the cheap one, on purpose).
  // -----------------------------------------------------------------------
  const doc = parseBlob(zombieBlobSrc);
  const face = compileFace(doc);
  const flesh = compilePalette(doc) ?? { ...FLESH_PRESETS['henenlotter-latex'] };
  const faceTex = new THREE.TextureLoader().load(ZOMBIE_FLAT.url);
  faceTex.magFilter = THREE.NearestFilter;
  faceTex.minFilter = THREE.NearestFilter;
  faceTex.generateMipmaps = false;
  faceTex.flipY = true;
  const [fx, fy, fw, fh, fsw, fsh] = ZOMBIE_FLAT.rect;
  const faceAtlas = new THREE.Vector4(fw / fsw, fh / fsh, fx / fsw, fy / fsh);

  /** Face textures BY CHARACTER, loaded once and shared by every body of that
   *  kind. The zombie's stays the module-level pair above (every zombie wears
   *  one sheet); anything else gets its own from the registry.
   *
   *  THIS IS THE TRAP THE SPEC NAMED. game-main hardcoded ZOMBIE_FLAT for
   *  every body, so spawning the soldier through that path would have dressed
   *  him in the zombie's face — and one bad key in his sheet block already
   *  cost an hour on 2026-09-04 producing exactly that symptom. */
  const faceCache = new Map<string, { tex: THREE.Texture; atlas: THREE.Vector4; mean: number }>();
  function faceFor(name: string) {
    const hit = faceCache.get(name);
    if (hit) return hit;
    const sheet = compileCharacterSheet(characterEntry(name));
    if (sheet.error) {
      console.error(`[sdf-game] ${name}: sheet block failed to compile, falling `
        + `back to the zombie face. Fix it:\n  ${sheet.error}`);
    }
    const f = sheet.face;
    const tex = new THREE.TextureLoader().load(f.url);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.flipY = true;
    const [x, y, w, h, sw, sh] = f.rect;
    const entry = {
      tex,
      atlas: new THREE.Vector4(w / sw, h / sh, x / sw, y / sh),
      mean: f.mean,
    };
    faceCache.set(name, entry);
    return entry;
  }

  let probeWeight = DEFAULT_PROBE_WEIGHT;

  /** Sever dispatch indirection — actors are built before the weapon block;
   *  the grapeshot wiring below assigns this once the chunk spawner exists. */
  let onSeverDispatch: ((a: ZombieActor, piece: { limb: string; origin: Vec3; prims: Primitive[]; tornAt: Vec3[]; bones: Primitive[] }, stumpWound: Wound | null) => void) | null = null;

  const tilesPlaytest = import.meta.env.DEV && new URLSearchParams(location.search).has('tiles-playtest');
  const gameTiles = createGameTilePlaytest({
    allowed: tilesPlaytest,
    capacity: () => ({ widthPx: Math.max(960, postAa.contentSize.width), heightPx: Math.max(600, postAa.contentSize.height) }),
    createBinding: (w, h) => createComputeTileBinding(handle.renderer, w, h),
  });
  const tilesButton = tilesPlaytest ? document.createElement('button') : null;
  const updateTilesButton = () => {
    if (!tilesButton) return;
    const d = gameTiles.diagnostics();
    const fallback = Object.values(d.fallbacks).reduce((n, v) => n + v, 0);
    const label = `Tile culling: ${d.enabled ? 'ON' : 'OFF'} [F6]${fallback ? ` · ${fallback} fallback` : ''}`;
    if (tilesButton.textContent !== label) tilesButton.textContent = label;
  };
  const setGameTiles = (on: boolean) => {
    gameTiles.setEnabled(on);
    telemetry.event('tile-culling', gameTiles.diagnostics() as unknown as Record<string, unknown>);
    updateTilesButton();
  };
  if (tilesButton) {
    tilesButton.style.cssText = 'position:fixed;right:12px;top:52px;z-index:10001;padding:8px;background:#171b20;color:#eee;border:1px solid #687079';
    tilesButton.onclick = () => setGameTiles(!gameTiles.diagnostics().enabled);
    document.body.appendChild(tilesButton);
    updateTilesButton();
  }
  const tilesKey = (e: KeyboardEvent) => {
    if (tilesPlaytest && e.code === 'F6' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault(); setGameTiles(!gameTiles.diagnostics().enabled);
    }
  };
  window.addEventListener('keydown', tilesKey);
  refreshActorTiles = () => {
    if (!tilesPlaytest) return;
    const timing = telemetry.begin();
    camera.updateMatrixWorld(); camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
    const size = sdfLayer.targetSize;
    gameTiles.refresh(camera, { widthPx: size.width, heightPx: size.height }, actors.map(a => a.view));
    telemetry.end('tile-binning-submit', timing);
    updateTilesButton();
  };
  import.meta.hot?.dispose(() => {
    refreshActorTiles = () => {}; gameTiles.dispose(); tilesButton?.remove();
    window.removeEventListener('keydown', tilesKey);
  });
  // Owner-approved hybrid normals; unsupported surfaces retain calcNormal.
  let normalGradientMode: 0 | 1 = 1;
  let normalGradientDebug: 0 | 1 | 2 = 0;
  const errors: string[] = [];
  let nextId = 1;
  /** Requested state of the wound union-reach cull (ships ON) — tracked
   *  because the uniform alone cannot say it (see the woundCull getter). */
  let woundCullRequested = true;

  // The wound panel's tuning state (wound-panel.ts). Lives HERE — before the
  // boot loop — because one of its eight keys, boneRatio, shapes buildBody's
  // bone derivation, so applying it is a REBUILD through the same spawn path
  // as boot. defaultsFrom equals the FleshMaterial defaults and surfCfg3's
  // uniform defaults, so an untouched panel is exactly the pre-panel page —
  // EXCEPT the two entrails knobs whose live defaults live in
  // entrails-spawn (task 5 tuned GUT_DROPLET_SIZE to 0.3 after the panel
  // table froze 0.12), so they are re-seeded from the constants just below.
  const woundTuning = defaultsFrom(WOUND_KEYS) as WoundTuningValues;
  // Boot parity: the panel's record must state what the page ACTUALLY does
  // before anyone drags a slider — gut ropes spawn at GUT_DROPLET_SIZE and
  // slug spill rolls at SPILL_CHANCE.slug. Seeding (rather than reading the
  // constants at the use sites) keeps one writer: dragging the slider later
  // overrides the seeded value and every later spawn honours it.
  woundTuning.gutSize = GUT_DROPLET_SIZE;
  woundTuning.spillChance = SPILL_CHANCE.slug;
  // Same boot parity for the spring knobs (organs r3): the table's defaults
  // say what the panel SHOWS; these say what the page DOES until a slider
  // moves. One writer: the slider override below.
  woundTuning.coilTightness = GUT_TUNING.coilTightness;
  woundTuning.springiness = GUT_TUNING.springiness;
  /** The owner's explicit bone ratio; null = defer to the doc (absent →
   *  DEFAULT_BONE_RATIO inside buildBody, and a later authored `bones ratio`
   *  would win untouched). Once the owner MOVES the slider their value wins
   *  every later build — an explicit setting clobbering an authored ratio is
   *  the requested semantics, so there is no extra flag machinery. */
  let boneRatioOverride: number | null = null;

  /** Push the panel's tissue ramp into one view's surfCfg3, plus the cavity
   *  pair. Component order is pinned by zombie-gpu's uniform table (x
   *  depthAmp, y fat, z muscle, w visceraAmp) — the same order applyMaterial
   *  writes the material defaults, so this is a re-apply, not a second
   *  writer with its own opinion. visceraDepth is its own uniform. Until
   *  entrails task 7 w stayed where applyMaterial left it; the panel's
   *  viscera knob now owns it, and its default (1) matches the preset, so
   *  an untouched panel still shades identically. */
  function applyWoundRamp(view: ZombieGpuView): void {
    const c = view.uniforms.surfCfg3.value;
    c.x = woundTuning.woundDepthAmp;
    c.y = woundTuning.fatDepth;
    c.z = woundTuning.muscleDepth;
    c.w = woundTuning.visceraAmp;
    view.uniforms.visceraDepth.value = woundTuning.visceraDepth;
    // organAmp rides the same re-apply (organs r3): applyMaterial stamps the
    // preset default on every rebuild, so the panel's value must be
    // re-stamped after it or a cast rebuild would silently reset the knob.
    view.uniforms.organAmp.value = woundTuning.organAmp;
    // MEAT DETAIL (2026-09-12): the four MEAT sliders → meatCfg (x amp, y clot, z glint, w crevice).
    view.uniforms.meatCfg.value.set(woundTuning.meatAmp, woundTuning.meatClot, woundTuning.meatGlint, woundTuning.meatCrevice);
  }

  /** The applied tuning record plus body 1's live surfCfg3 — the shader
   *  truth half of the seam's woundTuning getter/setWoundTuning return, so
   *  "did the slider reach the field" is one read, not a hope. */
  function woundTuningNow(): WoundTuningValues & { surfCfg3: number[] | null } {
    const c = actors[0]?.view.uniforms.surfCfg3.value;
    return { ...woundTuning, surfCfg3: c ? [c.x, c.y, c.z, c.w] : null };
  }

  /** The panel → field entry point, exposed on __sdfGame.setWoundTuning.
   *  The ramp trio, the viscera pair and organAmp write uniforms live; gutSize,
   *  spillChance, coilTightness and springiness take effect on the next spawn
   *  / next roll (gutSize and the spring pair only shape ropes spawned from
   *  now on — existing droplets keep their size, they are MOVED, not resized,
   *  by the frame loop); boneRatio rebuilds the cast. */
  function applyWoundTuning(o: Partial<WoundTuningValues>): void {
    let ramp = false;
    if (o.woundDepthAmp !== undefined) { woundTuning.woundDepthAmp = o.woundDepthAmp; ramp = true; }
    if (o.fatDepth !== undefined) { woundTuning.fatDepth = o.fatDepth; ramp = true; }
    if (o.muscleDepth !== undefined) { woundTuning.muscleDepth = o.muscleDepth; ramp = true; }
    if (o.visceraAmp !== undefined) { woundTuning.visceraAmp = o.visceraAmp; ramp = true; }
    if (o.visceraDepth !== undefined) { woundTuning.visceraDepth = o.visceraDepth; ramp = true; }
    if (o.organAmp !== undefined) { woundTuning.organAmp = o.organAmp; ramp = true; }
    // MEAT DETAIL (2026-09-12): the four MEAT sliders write meatCfg live through the same re-apply.
    // (First cut forgot these four lines — the sliders moved the record and nothing reached the field.)
    for (const k of ['meatAmp', 'meatClot', 'meatGlint', 'meatCrevice'] as const) {
      if (o[k] !== undefined) { woundTuning[k] = o[k]!; ramp = true; }
    }
    if (ramp) for (const a of actors) applyWoundRamp(a.view);   // chunks copy the body template's meatCfg at spawn
    if (o.gutSize !== undefined) woundTuning.gutSize = o.gutSize;
    // Spring knobs (organs r3): read at makeGutChain time in spillVerdict, so
    // they shape every rope spawned from now on; existing ropes keep theirs.
    if (o.coilTightness !== undefined) woundTuning.coilTightness = o.coilTightness;
    if (o.springiness !== undefined) woundTuning.springiness = o.springiness;
    if (o.spillChance !== undefined) {
      woundTuning.spillChance = o.spillChance;
      // The roll reads the shared table (entrails-spawn.shouldSpill), so
      // overriding slug there is the whole override — no second source of
      // truth. blast spill stays 1.0.
      SPILL_CHANCE.slug = o.spillChance;
    }
    if (o.boneRatio !== undefined && o.boneRatio !== woundTuning.boneRatio) {
      boneRatioOverride = o.boneRatio;
      woundTuning.boneRatio = o.boneRatio;
      rebuildCast();
    }
  }

  /** ONE spawn — the boot-loop body, kept as THE actor path so the wound
   *  panel's bone-ratio rebuild cannot drift from boot. Pushes build errors
   *  into errs; the caller decides how to surface them. */
  // PER-ROOM PROBE GRIDS (lighting P3 step 2). Baked in a worker at boot from
  // each room's paint, accents and furniture; stamped onto a body at spawn
  // below. ?probes=0 keeps every body on the P1 path (probeCfg.x = 0, which
  // is bit-identical) for the parity and bench drivers. The gain defaults to
  // each room's matched level — the level of today's P1 at ambientGain 4 —
  // so only the direction and hue of the ambient change, not its brightness.
  const probesParam = new URLSearchParams(location.search).get('probes');
  const probesOff = probesParam === '0' || probesParam === 'off';
  const roomProbes = createRoomProbes({
    rooms: ROOMS, furniture: FURNITURE,
    light: {
      dir: LIGHT_PRESETS['practical-hard-key'].keyDir,
      keyColor: LIGHT_PRESETS['practical-hard-key'].keyColor,
      keyIntensity: LIGHT_PRESETS['practical-hard-key'].keyIntensity,
      fillIntensity: LIGHT_PRESETS['practical-hard-key'].fillIntensity,
    },
    workerFactory: () => new Worker(new URL('../probe-grid.worker.ts', import.meta.url), { type: 'module' }) as unknown as ProbeWorkerLike,
    onReady: (roomId) => {
      if (import.meta.env.DEV) console.info(`[room-probes] room ${roomId} baked`);
      stampLevelProbeRoom(roomId);
    },
  });
  if (probesOff) roomProbes.setProbes(0, -1);
  probeGather = createProbeGatherBinding(handle.renderer, {
    maxProbes: 10 * 4 * 10, maxBoxes: 16, maxCapsules: PROBE_MAX_CAPSULES, maxLights: 8,
  });

  // -----------------------------------------------------------------------
  mark('room-probes-start');
  // LEVEL SURFACES READING THE PROBES (lighting P3/P4 step 3; plan
  // docs/superpowers/plans/2026-09-10-level-probe-lighting.md). ONE
  // ProbeLightingNode per room, shared by every level surface of that room,
  // bound to the room's static grid (through roomProbes, like a body) and
  // to the gather's dynamic storage node (the same node the bodies bind, so
  // walls and flesh read one buffer). `material.lightsNode` REPLACES the
  // scene's light list, so each room's list re-lists every scene light —
  // the hemisphere, the ambient, the accents, the flashlight and its shadow
  // twin — and refreshLevelLights re-lists again when the muzzle-flash
  // PointLight arrives with the gun. Forward path only: in deferred mode
  // the level is a G-buffer producer and its lighting is the deferred
  // stage's. Materials are converted to node materials up front with
  // three's own fromMaterial so lightsNode is a first-class property and
  // rides the pipeline cache key.
  // -----------------------------------------------------------------------
  const roomIdAt = (x: number, z: number): number => {
    const key = enclosureKeyAt(x, z);
    const inRoom = ROOMS.find(r => r.name === key);
    if (inRoom) return inRoom.id;
    // Tunnel and doorway surfaces: the nearest room by centre (dynRoom's rule).
    let best = ROOMS[0]!, bestD = Infinity;
    for (const r of ROOMS) {
      const cx = (r.minX + r.maxX) / 2, cz = (r.minZ + r.maxZ) / 2;
      const d = (cx - x) ** 2 + (cz - z) ** 2;
      if (d < bestD) { bestD = d; best = r; }
    }
    return best.id;
  };
  /** The rooms whose accents a room's walls shade: itself plus every room
   *  it shares a tunnel with (the tunnel's surfaces belong to the nearer
   *  room, and a doorway wall sees the light across the arch). */
  const accentRoomsFor = (roomId: number): Set<number> => {
    const set = new Set<number>([roomId]);
    for (const t of TUNNELS) { if (t.a === roomId) set.add(t.b); if (t.b === roomId) set.add(t.a); }
    return set;
  };
  /** Every scene light except OTHER rooms' accent PointLights. An accent
   *  has no range (distance 0 = infinite), so before this every wall pixel
   *  in the level shaded all seven; a room's walls now shade its own and
   *  its neighbours' — the rest of the level is skipped per pixel. The
   *  probe grid still carries every accent's bounce inside its own room. */
  const levelSceneLights = (roomId: number): THREE.Light[] => {
    const allowed = accentRoomsFor(roomId);
    const ls: THREE.Light[] = [];
    scene.traverse(o => {
      const l = o as THREE.Light;
      if (!l.isLight) return;
      const accentRoom = l.userData.accentRoom as number | undefined;
      if (accentRoom !== undefined && !allowed.has(accentRoom)) return;
      ls.push(l);
    });
    return ls;
  };
  if (!deferredMode) {
    const gatherNode = probeGather.probeDynNode;
    for (const r of ROOMS) {
      const slots = createProbeLevelSlots(gatherNode);
      const node = new ProbeLightingNode(slots);
      levelProbeNodes.set(r.id, node);
      // The room's grid lands on these four slots when its bake arrives;
      // the cfg is the LEVEL's (stampLevelProbeRoom), not the bodies' —
      // bind() would write the body weight and the 4x-fill gain there.
      roomProbes.bind({
        probeTex: slots.probeTex, probeMin: slots.probeMin, probeInvExtent: slots.probeInvExtent,
        probeDims: slots.probeDims, probeCfg: { value: new THREE.Vector4() },
      }, r.id);
      stampLevelProbeRoom(r.id);
    }
    for (const [roomId, node] of levelProbeNodes) levelLightLists.set(roomId, levelLightsNode(levelSceneLights(roomId), node));
    // fromMaterial is three's own classic-to-node conversion (NodeLibrary.js);
    // it is what the builder calls per pipeline, just not in the typings.
    const library = handle.renderer.library as unknown as { fromMaterial(m: THREE.Material): THREE.NodeMaterial | null };
    for (const mesh of levelGroup.children) {
      if (!(mesh instanceof THREE.Mesh)) continue;
      const list = levelLightLists.get(roomIdAt(mesh.position.x, mesh.position.z));
      if (!list) continue;
      const nm = library.fromMaterial(mesh.material as THREE.Material);
      if (!nm) continue;
      nm.lightsNode = list;
      mesh.material = nm;
      levelNodeMaterials.push(nm);
    }
  }
  /** The room's level cfg: weight, and the gain that puts the probe level at
   *  the hemisphere's (or the owner's override). 0/0 until the bake lands. */
  function stampLevelProbeRoom(roomId: number) {
    const node = levelProbeNodes.get(roomId);
    if (!node) return;
    const grid = roomProbes.gridOf(roomId);
    let gain = 0;
    if (grid) {
      gain = levelProbeGain >= 0 ? levelProbeGain : levelMatchedGain(grid, {
        sky: [hemi.color.r, hemi.color.g, hemi.color.b],
        ground: [hemi.groundColor.r, hemi.groundColor.g, hemi.groundColor.b],
        intensity: hemiBase,
      });
    }
    node.slots.probeCfg.value.set(levelProbeWeight, gain, 0, 0);
  }
  function restampLevelProbes() {
    for (const roomId of levelProbeNodes.keys()) stampLevelProbeRoom(roomId);
  }
  /** Re-list the scene's lights on every room (a light was added — the
   *  muzzle flash with the gun) and force the level pipelines to rebuild. */
  function refreshLevelLights() {
    if (levelLightLists.size === 0) return;
    for (const [roomId, node] of levelProbeNodes) {
      levelLightLists.get(roomId)?.setLights([...levelSceneLights(roomId), node as unknown as THREE.Light]);
    }
    for (const nm of levelNodeMaterials) nm.needsUpdate = true;
  }

  /** Lazily create the ONE CrowdType a character registry name draws through
   *  (Task 5's createCrowdType). The material binds the same start/early-out
   *  sources as a per-body view (temporal start, prev, shell, depthPre,
   *  probeDyn) so a lone instance stays bit-identical; the per-TYPE uniform
   *  block is seeded by copyUniformValues from the first attached view.
   *  `?crowd=0` never calls this. */
  function crowdTypeFor(name: string, roomId: number): CrowdType {
    // Keyed by character AND spawn room. The per-TYPE uniform block is seeded
    // from the first attached view, and that block carries the ROOM's
    // lighting environment (boxMin/boxMax, the six wall colours, the room
    // probe texture, probeMin/probeCfg) which spawnEnemy stamps per actor for
    // its spawn room and never changes afterwards. One type spanning rooms
    // lit every instance with the first room's walls and probes — the pale,
    // blotchy zombie (2026-09-14). A type per (character, room) keeps the
    // block honest; rooms are frustum-culled, so few types draw per frame.
    const key = `${name}@${roomId}`;
    const existing = crowdTypes.get(key);
    if (existing) return existing;
    const t = createCrowdType(
      handle.renderer, key, defaultUniforms(blankFaceTexture()),
      sdfLayer.maxWidth, sdfLayer.maxHeight,
      {
        occluder: sdfLayer.occluder,
        shell: {
          entry: sdfLayer.shellEntry.texture,
          exit: sdfLayer.shellExit.texture,
          uniforms: sdfLayer.shellEntry.uniforms,
        },
        prev: sdfLayer.prev,
        depthPre: sdfLayer.depthPre,
        lastFrame: sdfLayer.lastFrame,
        probeDyn: probeGather ? { node: probeGather.probeDynNode } : undefined,
      },
      { dispatch: crowdDispatch, telemetry },
    );
    t.mesh.layers.set(SDF_LAYER);
    t.depthPreMesh.layers.set(DEPTH_PREPASS_LAYER);
    scene.add(t.mesh);
    scene.add(t.depthPreMesh);
    deferredApi?.router.register(t.mesh, 'sdf');
    deferredApi?.router.register(t.depthPreMesh, 'exclude');
    crowdTypes.set(key, t);
    return t;
  }

  function spawnEnemy(name: string, room: RoomDef, start: Vec3, errs: string[]): ZombieActor {
    const enc = enclosureOf(room.name)!;
    const roomFurniture = FURNITURE
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
    const tileBinding = gameTiles.createBinding();
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
    const viewGpuOpts: GpuViewOpts = {
      // The dynamic probe layer's storage node (P3/P4). Bound at material
      // creation like the tile binding — a storage node cannot be rebound.
      ...(probeGather ? { probeDyn: { node: probeGather.probeDynNode } } : {}),
      // DEFERRED MODE: no cone twin binding. sdf-layer.render never runs in
      // this mode, so the cone target would stay uninitialised — a WebGPU
      // lazy-init submit conflict that rejects the WHOLE producer pass
      // (symptom: an empty G-buffer, black world behind the forward
      // viewmodel). The tile binding is undefined unless the DEV
      // ?tiles-playtest is on (game-tile-playtest gates it), so it rides in
      // both modes harmlessly. Tiles are re-enabled for the surface path by
      // the same playtest, which bins them itself.
      ...(deferredMode ? {
        output: 'surface' as const,
        shadowReceiver: 'level-only' as const,
        ...(tileBinding ? { tiles: tileBinding } : {}),
      } : {
        cone: sdfLayer.cone,
        tiles: tileBinding,
        occluder: sdfLayer.occluder,
        // The outer hull's bounds. Passing them unconditionally is safe:
        // the fetch identities (0 / 1e9) make the march bit-identical while
        // sdfLayer.shellEnabled is false, which is the ship default.
        shell: {
          entry: sdfLayer.shellEntry.texture,
          exit: sdfLayer.shellExit.texture,
          uniforms: sdfLayer.shellEntry.uniforms,
        },
        prev: sdfLayer.prev,
        // Temporal reprojection start (plan 2026-09-10): passed
        // unconditionally like prev — cfg.x 0 is the fetch identity.
        lastFrame: sdfLayer.lastFrame,
        // The quarter-res depth prepass (close-up task 3). Passed
        // unconditionally like the shell bounds — the fetch identities make
        // the march bit-identical while sdfLayer.depthPreEnabled is false,
        // which is the ship default. Chunks get NO twin: a missing start is
        // conservative (they march from today's start), and the shared chunk
        // material's single-node-graph trick is not worth rethinking for a
        // few dozen boxes.
        depthPre: sdfLayer.depthPre,
        // Run 5: the output-res refine twins. Null unless the boot allocated refine (?refine=1),
        // in which case createZombieGpuView builds a third twin mesh on REFINE_LAYER.
        refine: sdfLayer.refineSource ?? undefined,
        levelShadow: { light: flashlight.levelShadow },
      }),
    };
    // DEFERRED MODE: kit and prop load ASYNC and are added to the scene when
    // their glTF resolves — a per-actor group is what lets ONE registration
    // (propagated to descendants by the router's sync) catch them whenever
    // they land, including across rebuilds. Legacy adds them straight to the
    // scene, unchanged (the group is not even attached there).
    const rigGroup = new THREE.Group();
    rigGroup.name = `deferred-rig-${name}-${start[0]!.toFixed(2)}-${start[2]!.toFixed(2)}`;
    if (deferredMode) scene.add(rigGroup);
    const character = createCharacterView({
      name,
      start,
      renderer: handle.renderer,
      scene: deferredMode ? rigGroup : scene,
      effectsScene: characterEffects.scene,
      errors: errs,
      // The panel's ratio, once the owner has touched it, overrides whatever
      // the doc would have done (nothing today; an authored ratio from the
      // bones block, later).
      ...(boneRatioOverride !== null ? { boneRatio: boneRatioOverride } : {}),
      gpu: viewGpuOpts,
    });
    const placed = character.body;
    const view = character.gpu;
    gameTiles.track(view, tileBinding);
    // Bone tubes: with the mesh ON the field stops packing bone rows (task 5).
    view.setPackBones(!boneMesh);
    view.applyMaterial(name === 'soldier' ? character.palette ?? flesh : flesh,
      LIGHT_PRESETS['practical-hard-key']);
    // The panel's ramp rides ON TOP of the material: applyMaterial just
    // wrote the preset defaults, so a tuned panel must re-stamp its values
    // or a rebuild would silently reset the ramp (the silent-reset class
    // of bug this panel exists to kill).
    applyWoundRamp(view);
    // Relaxation, explicit rather than inherited from the uniform default —
    // see GAME_RELAX for why it is 1.0 and what happened when it was 1.4.
    view.uniforms.woundCfg2.value.y = GAME_RELAX;
    view.uniforms.perfCfg.value.x = GAME_HULL_EXIT_BOUND;
    view.uniforms.perfCfg.value.y = GAME_WOUND_EARLY_OUT;
    view.uniforms.marchCfg.value.y = GAME_OMEGA;
    view.uniforms.perfCfg.value.z = GAME_WOUND_STEP;
    view.uniforms.perfCfg.value.w = GAME_LAST_STEP;
    view.uniforms.normalGradientCfg.value.set(normalGradientMode, normalGradientDebug, 0, 0);
    view.uniforms.aaCfg.value.y = GAME_AA;
    view.uniforms.aaCfg.value.x = sdfLayer.pixelConeK;
    view.uniforms.levelShadowCfg.value.x = GAME_LEVEL_SHADOW;
    const face = name === 'zombie'
      ? { tex: faceTex, atlas: faceAtlas, mean: ZOMBIE_FLAT.mean }
      : faceFor(name);
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
      if (name === 'soldier') {
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
    view.uniforms.bounceCfg.value.set(probeWeight, 4, 1, 1);
    roomProbes.bind(view.uniforms, room.id);
    // CROWD STAGE A: attach BEFORE the layers/registration block so the
    // deferred router can skip the per-body producer, and before the actor
    // exists (a slot is actor-independent). attach() rebinds the view's sink
    // and record slot into the type's shared atlas/buffer.
    let crowdAttach: { type: CrowdType; slot: number } | null = null;
    if (crowdOn) {
      const t = crowdTypeFor(name, room.id);
      const slot = t.attach(view);
      if (slot < 0) console.warn('[crowd] type full', name);
      else {
        crowdAttach = { type: t, slot };
        if (!crowdSourceView.has(t)) crowdSourceView.set(t, view);
        // attach/detach is the crowd's visibility gate, so the per-body proxy
        // and its depth-pre twin stay in the scene but hidden (cheap to show
        // again only via a rebuild — see setCrowd).
        view.object.visible = false;
        if (view.depthPreObject) view.depthPreObject.visible = false;
        // Stage-a gap: one segVolumeMeta per type, so only the first instance
        // can bone-cull in 'segment' pose mode. Cluster culling needs no
        // per-instance pose and stays honest for every instance.
        view.setBoneCullMode('cluster');
        if (view.refineObject) {
          view.refineObject.visible = false;
          if (!crowdRefineWarned) {
            crowdRefineWarned = true;
            console.warn('[crowd] refine twins are not supported in crowd mode (stage 3)');
          }
        }
      }
    }
    view.object.layers.set(SDF_LAYER);
    view.coneObject.layers.set(CONE_LAYER);
    if (view.depthPreObject) {
      view.depthPreObject.layers.set(DEPTH_PREPASS_LAYER);
      scene.add(view.depthPreObject);
    }
    if (view.refineObject) {
      view.refineObject.layers.set(REFINE_LAYER);
      scene.add(view.refineObject);
    }
    scene.add(view.object);
    scene.add(view.coneObject);
    // DEFERRED MODE registrations: the proxy box is the SDF producer; the
    // coarse twin (always built) and the depth-pre twin (legacy only — the
    // deferred view opts omit it) are march helpers that must never reach a
    // G-buffer or forward pass; the kit/prop group is level-only tissue.
    if (deferredApi) {
      // A crowd-attached view is one instance of a shared type draw; its own
      // producer material must NOT also feed the G-buffer.
      if (!crowdAttach) deferredApi.router.register(view.object, 'sdf');
      deferredApi.router.register(view.coneObject, 'exclude');
      if (view.depthPreObject) deferredApi.router.register(view.depthPreObject, 'exclude');
      if (view.refineObject) deferredApi.router.register(view.refineObject, 'exclude');
      deferredApi.router.register(rigGroup, 'mesh', 'level-only');
    }
    const zombieId = nextId++;
    rigGroup.userData.gameActorId = zombieId;
    const actor = createZombieActor({
      id: zombieId, room: room.id, body: placed, view, character, start,
      boundedWounds: boundedWoundPreview,
      ...(name === 'soldier' ? {
        mind: makeSoldierMind(),
        onFire: ({ origin: muz, direction: dir }) => {
          if (!character.prop || character.prop.released) return;
          encounter.shot(zombieId);
          // ONE barrel: the double-barrel volley is the player's signature,
          // and the soldier throwing the same wall of lead reads as a second
          // player rather than an enemy.
          soldierPellets.push(...spawnPellets(muz, dir, 1, seedFromUnit(rngStreams.misc())));
        },
      } : {}),
      profile: characterEntry(name).profile,
      seed: 1337 + nextId * 101,
      bounds: wanderBounds(room),
      furniture: roomFurniture,
      navigation: encounterNav,
      onSever: (piece, stumpWound) => onSeverDispatch?.(actor, piece, stumpWound),
    });
    // Ship default + any live toggle: a late spawn must not fall back to the
    // flat bone fold while the rest of the room culls.
    if (crowdAttach) actor.crowd = crowdAttach;
    actor.view.setBoneCullMode(crowdAttach ? 'cluster' : boneCullMode);
    actor.view.setRefineTail(refineTailWanted);
    // skeleton=mesh: contract sources at REST bind (before any tick steps
    // the rig — stepActorMotion rewrites restPose, which limb local frames
    // are derived from), then the field drops this actor's bone rows so
    // the segment meshes are the ONLY bone surface (smax-then-min exposure
    // via depth composition — mesh-renderer.ts header).
    if (segMeshCache) {
      skeletonSources.set(actor, buildSkeletonSources(actor, name));
      actor.view.setPackBones(false);
    }
    // Task 3 is zombie-first. Other characters keep exact procedural bones
    // until their source fixtures have been validated.
    if (segVolumeCache && name === 'zombie') bindSkeletonVolume(actor, name);
    encounterHomes.set(actor.id,[...start] as Vec3);
    return actor;
  }

  function spawnAll(errs: string[]): void {
    for (const room of ROOMS) {
      for (const [index,start] of spawnPoints(room).entries()) {
        const name = index < (room.soldiers ?? 0) ? 'soldier' : 'zombie';
        actors.push(spawnEnemy(name, room, start, errs));
      }
    }
  }

  spawnAll(errors);
  setLoader('level + actors');
  if (errors.length > 0) {
    console.error('[sdf-game] body errors:', errors.join(' | '));
  }
  // --- SETTLED-CHUNK BAKE (close-up task 5). A chunk that has come to rest
  // is a rigid static field that will never change again; when the seam is
  // on, it is extracted ONCE into a static mesh and RETIRED from the march:
  // its proxy box stops being drawn and stepped, and the mesh draws in the
  // main scene (a real early-Z occluder) instead. ON by default since the
  // owner's look verdict (2026-09-05: "looks great, nothing off from non
  // baked"); GAME_CHUNK_BAKE=0 must be pixel-identical to main, and it is —
  // every line below the seam is behind `chunkBakeEnabled` and the lists
  // stay empty.
  // STATE ONLY here — this must run BEFORE the bone-instancer light-seed
  // block below reads bakedChunkMat (declaration order is execution order
  // in this boot). The bake/gib/free functions live in the chunk section.
  //
  // OFF BY DEFAULT SINCE 2026-09-15, and the reason is worth stating because the
  // verdict above was honest when it was made. "Nothing off from non baked" was
  // 2026-09-05. What changed afterwards is that `litChunkMaterials` landed — the
  // per-frame push of the flashlight and the room's light — and the settled-chunk
  // material was never registered with it, so from that day a baked piece shaded
  // on a STATIC phantom key with the beam off. The bake did not get worse; it
  // stopped being lit. That is fixed now, but it is not the whole gap.
  //
  // Keep the optimization on. Source display/specular response and cut
  // primitives travel with the bake; retained views provide a same-pose
  // diagnostic reference via setBakedChunkReference, never the shipping draw.
  const GAME_CHUNK_BAKE: 0 | 1 = 1;
  let chunkBakeEnabled = new URLSearchParams(location.search).get('chunkbake') !== '0'
    && (GAME_CHUNK_BAKE as 0 | 1) === 1;
  interface ChunkTemplate { uniforms: import('./zombie-gpu').MarchUniforms; volumeTexture: THREE.Texture }
  interface BakedChunk {
    id: number;
    mesh: THREE.Mesh;
    view: ChunkGpuView;
    state: import('../gib-chunks').Chunk;
    faceMaterial?: BakedChunkMaterial;
    centre: Vec3;
    radius: number;
    bakeMs: number;
    /** The origin body's uniform set + volume texture, so a gib of this
     *  piece spawns meat that shades like the body it came off. */
    template: ChunkTemplate;
  }
  const bakedChunks: BakedChunk[] = [];
  let bakedChunkReference = false;
  let soldierCorpses: ReturnType<typeof createSoldierCorpseBakes> | null = null;
  // One material for every baked chunk — one pipeline, N meshes. Lighting
  // uniforms are LIVE (refreshed per frame beside the bone instancer's);
  // albedo is per-vertex so sharing costs nothing.
  let bakedChunkMat: BakedChunkMaterial | null = null;
  /**
   * EVERY material instance that must ride the flashlight beam.
   *
   * Found from the owner's report that the carved pieces (and the gore-parts
   * bench before them) look "pale, like gray offwhite … nothing even abit
   * fleshy". The per-frame beam update touched ONLY `bakedChunkMat`, so any
   * other instance made by `createBakedChunkMaterial` kept the STATIC defaults:
   * a fixed directional key of `lightCfg.x = 2.4` with `spotCfg.x = 0`, i.e. the
   * flashlight switched OFF. In a dark room that is a body lit by a lamp that is
   * not there, at ~2.5x — and `albedo * 2.46` on flesh colours clips every
   * channel to white, which is exactly "concrete meets marble".
   *
   * MEASURED after the fix, on the bench: mean part pixel **(66, 49, 44)**,
   * saturation **36.6%**, **0.1%** of part pixels clipped to white. The BEFORE
   * state is a code reading, not a capture — the block below touched only
   * `bakedChunkMat`, and an unregistered instance keeps `spotCfg.x = 0` (beam
   * off) with `lightCfg.x = 2.4` — so the only number claimed here is the AFTER
   * one. (An earlier revision of this comment quoted a before/after pair that
   * was never measured; it has been removed.)
   *
   * So instances register here and the frame update walks the list, rather than
   * each new material silently depending on someone remembering to add a second
   * copy of the same block.
   */
  const litChunkMaterials: BakedChunkMaterial[] = [];

  /** Register a material instance to be lit by the frame's beam. Every
   *  `createBakedChunkMaterial` that is DRAWN must go through this — an
   *  unregistered instance is not merely dimmer, it is lit by a lamp that does
   *  not exist (see the block above). */
  function registerLitChunkMaterial<T extends BakedChunkMaterial>(m: T): T {
    litChunkMaterials.push(m);
    return m;
  }
  let bakedChunkSeed: ((m: BakedChunkMaterial) => void) | null = null;
  let totalBakes = 0;
  let lastBakeMs = 0;
  let lastBakeInfo: Record<string, number> | null = null;
  // Bone tubes (task 5): the instancer owns its own light set — seed it once
  // from body 1's view, which just took the LIGHT_PRESETS apply above, so
  // the tube pass cannot drift from the march's key.
  {
    const v = actors[0]!.view.uniforms;
    boneInstancer.uniforms.lightDir.value.copy(v.lightDir.value);
    boneInstancer.uniforms.keyColor.value.copy(v.keyColor.value);
    boneInstancer.uniforms.lightCfg.value.copy(v.lightCfg.value);
    boneInstancer.uniforms.boneColor.value.copy(v.boneColor.value);
    boneInstancer.uniforms.deepColor.value.copy(v.deepColor.value);
    // Ambient fill: the enclosure's mean wall albedo weighted by the bounce
    // probe weight, on top of the preset's fill — a cheap stand-in for the
    // march's ambientAt probe so cavity bone sits in the same light as flesh.
    {
      const walls = [v.wallNegX, v.wallPosX, v.wallNegY, v.wallPosY, v.wallNegZ, v.wallPosZ].map(w => w.value);
      let mr = 0, mg = 0, mb = 0;
      for (const c of walls) { mr += c.r / 6; mg += c.g / 6; mb += c.b / 6; }
      const fill = v.lightCfg.value.y, key = v.keyColor.value, pw = v.bounceCfg.value.x;
      boneInstancer.uniforms.ambient.value.setRGB(
        fill * key.r + pw * mr * 0.5, fill * key.g + pw * mg * 0.5, fill * key.b + pw * mb * 0.5);
    }
    // skeleton=mesh: the segment renderer owns the SAME uniform value types
    // (boneInstancerUniforms) — seed it identically so mesh bone cannot
    // drift from the march's key either.
    if (segMeshRenderer) {
      segMeshRenderer.uniforms.lightDir.value.copy(v.lightDir.value);
      segMeshRenderer.uniforms.keyColor.value.copy(v.keyColor.value);
      segMeshRenderer.uniforms.lightCfg.value.copy(v.lightCfg.value);
      segMeshRenderer.uniforms.boneColor.value.copy(v.boneColor.value);
      segMeshRenderer.uniforms.deepColor.value.copy(v.deepColor.value);
      segMeshRenderer.uniforms.ambient.value.copy(boneInstancer.uniforms.ambient.value);
    }
  }
  // Baked chunks (close-up task 5): same seed from body 1's view — the
  // mesh shade fn is boneShade's formula, so it takes the same diet. The
  // per-frame FLASHLIGHT refresh happens in the render callback beside the
  // bone instancer's; this seed is the room's key/ambient.
  {
    const v = actors[0]!.view.uniforms;
    const seedBaked = (m: BakedChunkMaterial) => {
      m.uniforms.lightDir.value.copy(v.lightDir.value);
      m.uniforms.keyColor.value.copy(v.keyColor.value);
      m.uniforms.lightCfg.value.copy(v.lightCfg.value);
      m.uniforms.deepColor.value.copy(v.deepColor.value);
      const walls = [v.wallNegX, v.wallPosX, v.wallNegY, v.wallPosY, v.wallNegZ, v.wallPosZ].map(w => w.value);
      let mr = 0, mg = 0, mb = 0;
      for (const c of walls) { mr += c.r / 6; mg += c.g / 6; mb += c.b / 6; }
      const fill = v.lightCfg.value.y, key = v.keyColor.value, pw = v.bounceCfg.value.x;
      m.uniforms.ambient.value.setRGB(
        fill * key.r + pw * mr * 0.5, fill * key.g + pw * mg * 0.5, fill * key.b + pw * mb * 0.5);
    };
    bakedChunkSeed = seedBaked;
    if (bakedChunkMat) bakedChunkSeed(bakedChunkMat);
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
  function rebuildCast(): void {
    soldierCorpses?.dispose();
    encounter.clear(); encounterHomes.clear();
    // DRAIN IN-FLIGHT RUPTURES FIRST. Their actors are about to be disposed and
    // their queued impulses reference chunks from the pool that is also being
    // rebuilt; a window that survived the reset would gib a stale actor or
    // launch a stale id on the next tick.
    for (const q of pendingGibs) q.actor.endTear();
    pendingGibs.length = 0;
    pendingGibImpulses.length = 0;
    // The old source views are disposed below; refill from the rebuilt cast.
    crowdSourceView.clear();
    crowdVolumeBound.clear();
    for (const a of actors) {
      releaseSkeletonActor(a);
      scene.remove(a.view.object);
      scene.remove(a.view.coneObject);
      if (a.view.depthPreObject) scene.remove(a.view.depthPreObject);
      if (a.view.refineObject) scene.remove(a.view.refineObject);
      if (a.character) a.character.dispose();
      else a.view.dispose();
    }
    // No mesh may retain a geometry while the shared cache frees it. Clear
    // actor slots first, then dispose reusable cached geometries; the next
    // frame repopulates both from the rebuilt cast.
    segMeshRenderer?.clear();
    segMeshCache?.dispose();
    actors.length = 0;
    const errs: string[] = [];
    spawnAll(errs);
    if (errs.length > 0) {
      console.error('[sdf-game] rebuilt body errors:', errs.join(' | '));
    }
    // The exclusion logic mirrors the refreshHull seam, which lives below
    // this point — object properties do not hoist, so it is restated here.
    occluderHull.update(
      actors.map(a => a.posed()),
      hullExclusionsEnabled
        ? actors.flatMap(a => {
          const prims = a.posed().prims;
          const yaw = a.pose().yaw;
          return a.visualWounds().map(w => ({ centre: woundWorldPos(prims, w, yaw), radius: w.radius }));
        })
        : [],
    );
    if (sdfLayer.shellEnabled) {
      outerHull.update(actors.map(a => a.posed()), { shellAmp: shellAmpOf() });
    }
  }

  function pushProbeWeight(v: number) {
    probeWeight = Math.min(1, Math.max(0, v));
    for (const a of actors) a.view.uniforms.bounceCfg.value.x = probeWeight;
  }

  /** Ground radius the crowd separates zombies at — the same 0.35 m the
   *  player's soft-obstacle boxes already use, so the two agree. */
  const ZOMBIE_RADIUS = 0.35;
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
  const ENGAGED_RADIUS = 0.80;
  const ROOM_ID_BY_NAME = new Map(ROOMS.map(r => [r.name, r.id] as const));
  /** The player's room id, or -1 in a tunnel / the void. Zombies only notice
   *  a player who shares their room. */
  function playerRoomId(): number {
    return ROOM_ID_BY_NAME.get(enclosureKeyAt(player.pos[0], player.pos[2])) ?? -1;
  }
  /** Set when the weapon fires; consumed by the next tick to turn heads in
   *  the player's room. Sticky rather than instantaneous because a shot lands
   *  in an event handler, not in the frame callback. */
  let shotAlert = false;

  // -----------------------------------------------------------------------
  mark('player-start');
  // Player: pointer lock + WASD + gravity + capsule-vs-AABB.
  // -----------------------------------------------------------------------
  // BOOT SELECT. `?room=6` (or any room id, or its name) starts the player at
  // that room's centre facing +z — the tuning loop's entry point, so a reload
  // with a different ?fxsize lands you straight in the arena instead of walking
  // there. Absent = PLAYER_START, bit-identical to before this existed. The
  // in-page equivalent is __sdfGame.teleport(id).
  const bootRoomParam = new URLSearchParams(location.search).get('room');
  const bootRoom = bootRoomParam === null ? null
    : ROOMS.find(r => r.name === bootRoomParam
      || r.id === Number(bootRoomParam)) ?? null;
  const player: PlayerState = {
    pos: bootRoom
      ? [(bootRoom.minX + bootRoom.maxX) / 2, 0, (bootRoom.minZ + bootRoom.maxZ) / 2]
      : [PLAYER_START.x, 0, PLAYER_START.z],
    vel: [0, 0, 0],
    yaw: bootRoom ? 0 : PLAYER_START.yaw,
    pitch: PLAYER_START.pitch,
    grounded: true,
  };
  const keys = new Set<string>();
  const canvas = handle.canvas;
  canvas.addEventListener('click', () => {
    if (document.pointerLockElement !== canvas) canvas.requestPointerLock();
  });
  document.addEventListener('pointerlockchange', () => {
    hud.lockHint = document.pointerLockElement !== canvas;
  });

  // -----------------------------------------------------------------------
  // THE INPUT SEAM (deterministic demo recordings stage 3, 2026-09-14).
  //
  // The listeners no longer MUTATE anything. They accumulate the frame's raw
  // input (held keys, mouse delta, fire/reload events) and one function,
  // `readInputFrame()`, snapshots it at the tick boundary; `applyInputFrame()`
  // then performs every state change the listeners used to make inline. The
  // replay driver feeds the SAME `applyInputFrame` from a recorded frame, so
  // live play and replay cannot take different code paths.
  //
  // WHY DEFER FIRE/RELOAD TO THE TICK. They are edge events, not held state,
  // and an event that lands between two ticks has no frame index — a recording
  // built from it would be one frame ambiguous. Moving them onto the tick gives
  // every action exactly one frame, which is what makes `dt`-fixed replay
  // possible at all. The cost is at most one 16 ms frame of latency in live
  // play, and nothing about the game's feel depends on that.
  // -----------------------------------------------------------------------
  /** Accumulated mouse delta for the frame about to tick. Consumed (and
   *  zeroed) by readInputFrame. */
  let pendingDx = 0, pendingDy = 0;
  /** Edge events for the frame about to tick: 0 = none, 1 = one barrel,
   *  2 = both; `pendingReload` = a reload started this frame. */
  let pendingFire: 0 | 1 | 2 = 0;
  let pendingReload = false;
  /** TRUE while a recording is being replayed. The listeners still fire but
   *  inject nothing — the player owns the frame. */
  let replayActive = false;
  /** Frames consumed by the current replay (demoInfo().frame). */
  let replayFrame = 0;
  /** The input frame the next tick consumes. Live: readInputFrame(); replay:
   *  the player's next(). */
  let currentInputFrame: DemoFrame = { keys: [], dx: 0, dy: 0, fire: 0, reload: false, look: [0, 0] };
  /** The previous frame's key set, so applyInputFrame can derive rising edges
   *  (toggles like slug mode) from an absolute held-key snapshot. */
  let prevInputKeys = new Set<string>();
  /** The active recorder, or null. Pushed once per tick while recording. */
  let recorder: DemoRecorder | null = null;

  document.addEventListener('mousemove', (e) => {
    if (document.pointerLockElement !== canvas) return;
    if (replayActive) return; // the player owns the pose
    pendingDx += e.movementX;
    pendingDy += e.movementY;
  });
  window.addEventListener('keydown', (e) => {
    if (replayActive) return;
    keys.add(e.code);
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  let parked = DEFAULT_PROBE_WEIGHT;

  /** The mouse delta's effect, extracted so the live handler and the replay
   *  apply the IDENTICAL maths. Free aim moves the reticle (the camera follows
   *  from the tick); otherwise it turns the camera directly. */
  function applyMouseDelta(dx: number, dy: number): void {
    if (freeAimOn) {
      // The mouse moves the RETICLE, not the camera. Turning is a consequence
      // of shoving the reticle past the dead zone, handled in the tick.
      aim = moveAim(aim, dx, dy);
    } else {
      player.yaw += dx * 0.0022;
      player.pitch = Math.min(PLAYER.pitchLimit,
        Math.max(-PLAYER.pitchLimit, player.pitch - dy * 0.0022));
    }
  }

  /** Every keydown side effect, as RISING EDGES over a held-key snapshot. The
   *  listeners no longer do these inline: doing them here is what lets a
   *  replayed key set toggle slug mode exactly as a live press did. */
  function applyInputEdges(next: Set<string>): void {
    const pressed = (code: string): boolean => next.has(code) && !prevInputKeys.has(code);
    // WEAPON SLOTS. 1 = grapeshot, 2 = dynamite. Refused while a bundle is lit:
    // a player holding a burning bundle cannot put it away, which is the game's
    // own rule (Blood's dynamite FSM has no exit from the armed state) and the
    // one thing that stops slot-mashing being a free overcook cancel.
    //
    // A RISING-EDGE SCAN, not a keydown listener (rebase onto the input-seam
    // refactor, 2026-09-15): the slot switch has to go through the same snapshot
    // every other edge does, or a replayed key set would not switch weapons and
    // the recording would diverge from the live run at the first slot press.
    for (const code of next) {
      if (prevInputKeys.has(code)) continue;
      const wantSlot = slotForKey(code);
      if (wantSlot === null) continue;
      if (cook.phase === 'cooking') {
        telemetry.event('weapon-switch-refused', { slot: wantSlot, reason: 'cooking' });
      } else {
        const before = slotState;
        slotState = requestSlot(slotState, wantSlot);
        if (slotState !== before) telemetry.event('weapon-switch', { to: wantSlot });
      }
      updateHud();
    }
    if (pressed('BracketLeft')) pushProbeWeight(probeWeight - 0.05);
    if (pressed('BracketRight')) pushProbeWeight(probeWeight + 0.05);
    if (pressed('KeyP')) {
      if (probeWeight > 0) { parked = probeWeight; pushProbeWeight(0); }
      else pushProbeWeight(parked);
    }
    if (pressed('KeyE')) { slugMode = !slugMode; updateHud(); }
    // Neural upscale A/B (dev-only, P3): native -> nearest -> model while an
    // upscale config is active. One toggle per rising edge, as before
    // (the old handler's `!e.repeat` guard is the same thing here).
    if (pressed('KeyU') && upscaleAb.config) {
      applyUpscaleAbMode(upscaleAb.mode === 'native' ? 'nearest' : upscaleAb.mode === 'nearest' ? 'model' : 'native');
    }
    // H hides/shows EVERY tuning panel together. They cover most of the
    // viewport, and until now the only way to dismiss them was to know the
    // console API -- which is no use to someone doing a look pass.
    // G toggles free aim, so the two schemes can be A/B'd back to back.
    if (pressed('KeyG')) {
      freeAimOn = !freeAimOn;
      aim = { x: 0, y: 0 };
      updateHud();
    }
    if (pressed('KeyH')) {
      panelsHidden = !panelsHidden;
      woundPanel?.setVisible(!panelsHidden);
      gooPanel?.setVisible(!panelsHidden);
      vhsPanel?.setVisible(!panelsHidden);
      dynamitePanel?.setVisible(!panelsHidden);
    }
    // Manual reload. Dead under unlimited ammo BY CONSTRUCTION (the magazine is
    // never partial), which is why ?ammo=finite is the way to exercise it.
    if (pressed('KeyR') && shells < MAGAZINE_CAPACITY && reloadAge > RELOAD.totalSec) {
      startReload();
    }
    if (pressed('KeyT')) {
      reloadSpeed = reloadSpeed === 1 ? 0.25 : reloadSpeed === 0.25 ? 0.1 : 1;
      updateHud();
    }
  }

  /** Snapshot the listeners' accumulated input as the frame the next tick will
   *  consume. Zeroes the accumulators: a delta belongs to exactly one frame. */
  function readInputFrame(): DemoFrame {
    const frame: DemoFrame = {
      keys: [...keys],
      dx: pendingDx,
      dy: pendingDy,
      fire: pendingFire,
      reload: pendingReload,
      look: [player.yaw, player.pitch],
    };
    pendingDx = 0;
    pendingDy = 0;
    pendingFire = 0;
    pendingReload = false;
    return frame;
  }

  /** Apply one frame of input. THE single mutation point for player input —
   *  live play and replay both arrive here, so a replay is not a lookalike of
   *  the live path, it IS the live path. `look` is re-pinned last so float
   *  drift in the recorded deltas cannot compound down a run. */
  function applyInputFrame(f: DemoFrame): void {
    const next = new Set(f.keys);
    applyInputEdges(next);
    if (f.dx !== 0 || f.dy !== 0) applyMouseDelta(f.dx, f.dy);
    // Anti-drift absolute pin. Skipped in free aim, where the pose is a
    // consequence of the reticle rather than a thing the mouse set directly.
    if (!freeAimOn) {
      player.yaw = f.look[0];
      player.pitch = f.look[1];
    }
    if (f.fire === 1) fire(1);
    else if (f.fire === 2) fire(2);
    // The KeyR edge above already covers a live press; this covers a recorded
    // frame whose reload was folded into the flag rather than the keys.
    if (f.reload && shells < MAGAZINE_CAPACITY && reloadAge > RELOAD.totalSec) startReload();
    prevInputKeys = next;
  }

  // GRAPESHOT INPUT. Left = one barrel, right = both. The first click only
  // locks the pointer; shots need lock so a stray desktop click cannot fire.
  // DYNAMITE (slot 2) takes the same left button but as a HELD input: press
  // lights the fuse, release throws (fpv.ts's cook machine). Right button stays
  // a shotgun verb — a bundle has no second barrel.
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('mousedown', (e) => {
    if (document.pointerLockElement !== canvas) return;
    if (replayActive) return; // the player owns the shot
    if (!slotReady(slotState)) return;            // mid-switch: no verbs at all
    if (slotState.live === 'dynamite') {
      if (e.button === 0) dynPress = true;        // light it
      return;
    }
    // Deferred to the tick (see the input seam note): an edge event must land
    // on exactly one frame or a recording cannot replay it. The dynamite press
    // above is already a flag the tick consumes, so it is on the same seam.
    if (e.button === 0) pendingFire = 1;
    else if (e.button === 2) pendingFire = 2;
  });
  // The release half of the cook. Without this the bundle could only ever cook
  // to an overcook, which is not the weapon.
  window.addEventListener('mouseup', (e) => {
    if (e.button !== 0) return;
    if (document.pointerLockElement !== canvas) return;
    if (slotState.live !== 'dynamite') return;
    dynRelease = true;
  });

  // The seam for the grapeshot dispatch: a view-model hangs off this group,
  // which rides the camera every frame.
  const viewModelAnchor = new THREE.Group();
  viewModelAnchor.name = 'view-model-anchor';
  // Ride height of the whole view-model (gun + orb hands move together).
  // Owner playtest 2026-08-26: the gun sat high enough to crowd the frame.
  // Captured current / −5 cm / −10 cm from the same spot and compared: −5 cm
  // frees the centre of the frame while the breech and hammers — the detail
  // that chose this model — stay fully in frame; −10 cm starts to sink the
  // grip out of the bottom edge. −5 cm is the shipped height.
  viewModelAnchor.position.y = -0.05;
  /** Everything that leans and bobs together: gun, hands, flash, smoke, cases. */
  let aimRig: THREE.Group | null = null;
  // One rig for the whole view model, so the free-aim lean and the walk bob are
  // a single transform instead of being applied to the gun, both hands, the
  // flash, the smoke and the cases separately (and inevitably inconsistently).
  aimRig = new THREE.Group();
  aimRig.name = 'aim-rig';
  viewModelAnchor.add(aimRig);
  // WEAPON SLOT 1's own subtree. Everything the grapeshot owns — the gun, both
  // orb hands, the muzzle flash, the smoke pool, the ejected/loaded cases and
  // its point light — hangs off THIS rather than off aimRig directly, so a
  // weapon switch is ONE transform (drop it out of frame) instead of a
  // per-node flag list that would silently miss whatever gets added next.
  // aimRig keeps the free-aim lean and the walk bob; gunRig carries only the
  // holster travel.
  const gunRig = new THREE.Group();
  gunRig.name = 'gun-rig';
  aimRig.add(gunRig);
  camera.add(viewModelAnchor);
  scene.add(camera);

  // -----------------------------------------------------------------------
  mark('gun-start');
  // GRAPESHOT — the first weapon. View-model (k3 GLB + green orb hands),
  // travelling pellets, wound/sever wiring through the actors, and ballistic
  // chunks for whatever comes off. Fire model per the spec §2 as trimmed by
  // the dispatch brief: click = one barrel, right-click = both, cooldown +
  // camera kick in; break-open reload animation and muzzle smoke are not.
  // -----------------------------------------------------------------------
  const GUN_GLB = '/assets/lab/shorty-double.glb';
  /** Grip-point origin, muzzles down -Y in BLENDER space. The muzzle sits
   *  0.318 m down-barrel of the grip (model script: BMID - BLEN/2). */
  const MUZZLE_LOCAL: [number, number, number] = [0, -0.318, 0];
  /** Pivot parked at the hinge; rotating it about X breaks the action open.
   *  Blender's "muzzles down -Y" becomes +Z after the glTF y-up conversion, so
   *  a POSITIVE x-rotation swings the muzzles DOWN, which is the way a break
   *  action opens. */
  let hingePivot: THREE.Group | null = null;
  /** The GLB's own muzzle locators, kept so muzzleWorld() can read their LIVE
   *  world position each shot rather than a position sampled once at load. */
  let muzzleNodes: THREE.Object3D[] = [];
  /** Driven GLB nodes. Shells and the extractor live INSIDE Barrels, so they
   *  inherit the break rotation and the runtime only ever writes their LOCAL
   *  position -- no rotated basis is computed anywhere. */
  let shellNodes: THREE.Object3D[] = [];
  let breechNodes: THREE.Object3D[] = [];
  let extractorNode: THREE.Object3D | null = null;
  let topLeverNode: THREE.Object3D | null = null;
  /** Each shell's seated local position, so the extract slide is a delta. */
  const shellRestZ: number[] = [];
  let extractorRestZ = 0;
  let gripHandGroup: THREE.Group | null = null;
  let foreHandGroup: THREE.Group | null = null;
  let gunGroup: THREE.Group | null = null;
  let flashGroup: THREE.Group | null = null;
  let flashMaterial: THREE.MeshBasicMaterial | null = null;
  let flashLight: THREE.PointLight | null = null;
  let handMaterial: THREE.MeshStandardMaterial | null = null;
  /** The loaded arms, for the gate's seam. */
  let arms: GoblinArms | null = null;
  /** Gun body materials, kept so the finish is tunable at runtime. */
  const gunMaterials: THREE.MeshStandardMaterial[] = [];
  const FLASH_VARIANTS = 4;
  const flashTextures: THREE.DataTexture[] = [];
  const SMOKE_COUNT = 7;
  const smokePuffs: { mesh: THREE.Mesh; age: number; vel: THREE.Vector3; roll: number }[] = [];
  const ejectedShells: THREE.Group[] = [];
  const loadShells: THREE.Group[] = [];
  /** Where the last spent case was placed, in WORLD space, the moment it was
   *  handed from the extraction slide to the free tumble. Step 5b's proof
   *  that the eject origin is a real chamber mouth: this is asserted against
   *  breechWorld() rather than trusted by construction. */
  let lastEjectOrigin: Vec3 | null = null;
  const Y_UP = new THREE.Vector3(0, 1, 0);
  const _tmpV = new THREE.Vector3();
  /** The two elbows, rig space. See aimArm. */
  /** The two SHOULDERS, rig space: behind and below the camera, either side
   *  of the body. A two-bone arm runs from each hand to these (game-arms.ts
   *  aimArm): forearm to an IK elbow, upper arm on to the shoulder, whose
   *  ball ends behind the eye whatever the view pitch. The elbows bend down
   *  and OUTWARD (the hints), the way arms holding a gun at the hip do. */
  //
  //  IN VIEW SPACE (the camera's frame, viewModelAnchor), NOT the aim rig's.
  //  Free aim pitches the rig about the grip, and a shoulder that rode the
  //  rig swung round in front of the camera on a hard look up: the upper arm
  //  crossed the near plane, was cut off, and the hand read as floating
  //  (owner's screenshot). The body does not turn with the gun; the shoulders
  //  stay put behind the eye and the arms are re-aimed at them every frame.
  //
  //  The BEND HINTS are view-space directions too: OUTWARD (away from the gun,
  //  left for the left arm) and a little down. game-arms.ts floors the bend
  //  at ARM_MIN_BEND_RAD, so under a hard look up -- hand high on the
  //  fore-end, shoulder low behind -- the forearm leaves the hand sideways
  //  past the receiver instead of straight through it (owner's screenshots).
  const SHOULDER_L_VIEW = new THREE.Vector3(-0.22, -0.26, 0.06);
  const SHOULDER_R_VIEW = new THREE.Vector3(0.26, -0.30, 0.06);
  const BEND_L_VIEW = new THREE.Vector3(-1, -0.4, 0);
  const BEND_R_VIEW = new THREE.Vector3(1, -0.4, 0);
  const _sh = new THREE.Vector3(), _bd = new THREE.Vector3(), _o = new THREE.Vector3();
  /** A view-space point, expressed in the aim rig's space RIGHT NOW. Refresh
   *  the anchor's world matrices first when the rig moved this frame. */
  function viewToRig(view: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    out.copy(view);
    viewModelAnchor.localToWorld(out);
    (aimRig ?? viewModelAnchor).worldToLocal(out);
    return out;
  }
  /** A view-space DIRECTION in rig space (two points, subtracted). */
  function viewDirToRig(view: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    viewToRig(_o.set(0, 0, 0), out);
    const tip = viewToRig(view, _bd);
    return out.sub(tip).negate().normalize();
  }
  /** Aim both arms at their shoulders. Called every frame after the rig pose
   *  is set, and again wherever a hand is moved. */
  const _bendR = new THREE.Vector3(), _bendL = new THREE.Vector3();
  function aimArms(): void {
    viewModelAnchor.updateMatrixWorld(true);
    if (gripHandGroup) {
      viewDirToRig(BEND_R_VIEW, _bendR);
      aimArm(gripHandGroup, viewToRig(SHOULDER_R_VIEW, _sh), _bendR);
    }
    if (foreHandGroup) {
      viewDirToRig(BEND_L_VIEW, _bendL);
      aimArm(foreHandGroup, viewToRig(SHOULDER_L_VIEW, _sh), _bendL);
    }
  }
  /** The gun's resting pose. Every per-frame offset -- reload, recoil -- is a
   *  DELTA from here, so nothing has to remember where "home" was. */
  const GUN_REST = {
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
  const GRIP_HAND_REST = new THREE.Vector3();
  const FORE_HAND_REST = new THREE.Vector3();
  /** The muzzle in VIEW space, read off the GLB's own Muzzle_L/Muzzle_R
   *  locators rather than guessed. The first pass put the flash at
   *  (0.085, -0.060, -0.560) -- 4 cm left, 4.5 cm high and 3 cm SHORT of the
   *  real muzzle -- so it burned halfway down the barrel instead of at the
   *  bores, which is a good part of why it read wrong. */
  const MUZZLE_VIEW = new THREE.Vector3(0.125, -0.105, -0.600);
  /** Fill a VIEW-space vector from a named locator inside the loaded GLB. */
  function locatorInView(root: THREE.Object3D, name: string, out: THREE.Vector3): boolean {
    let found: THREE.Object3D | null = null;
    root.traverse((o) => { if (o.name === name) found = o; });
    if (!found) return false;
    viewModelAnchor.updateMatrixWorld(true);
    out.copy((found as THREE.Object3D).getWorldPosition(new THREE.Vector3()));
    (aimRig ?? viewModelAnchor).worldToLocal(out);
    return true;
  }
  /** A breech locator's position in aim-rig space RIGHT NOW. Unlike
   *  locatorInView this is called every frame, so it assumes the caller has
   *  already refreshed the view-model's matrices this frame.
   *
   *  This is what replaces the hardcoded breech vector. That constant was both
   *  4 cm right of the real chambers (it predated the gun being centred) and
   *  static, so it could not follow the barrels through their swing -- which is
   *  the whole of "the shells don't come out of the right location". */
  function breechInRig(i: 0 | 1, out: THREE.Vector3): boolean {
    const n = breechNodes[i];
    if (!n) return false;
    n.getWorldPosition(out);
    (aimRig ?? viewModelAnchor).worldToLocal(out);
    return true;
  }
  /** The bore's basis in RIG space this frame: `out` runs from the muzzles to
   *  the breeches (the way a case leaves a chamber), `side` from the left
   *  chamber to the right. Read off the same live locators as breechInRig, so
   *  it follows the barrels through their swing. Everything that leaves or
   *  enters a chamber is expressed in this basis: a case thrown in rig +Y from
   *  a bore tilted 66 degrees off it goes through the chamber wall. */
  const _bfA = new THREE.Vector3(), _bfB = new THREE.Vector3();
  function boreFrameInRig(out: THREE.Vector3, side: THREE.Vector3): boolean {
    const mL = muzzleNodes[0], mR = muzzleNodes[1];
    const bL = breechNodes[0], bR = breechNodes[1];
    if (!mL || !mR || !bL || !bR) return false;
    const rig = aimRig ?? viewModelAnchor;
    rig.worldToLocal(bL.getWorldPosition(_bfA));
    rig.worldToLocal(bR.getWorldPosition(_bfB));
    out.copy(_bfA).add(_bfB).multiplyScalar(0.5);
    side.copy(_bfB).sub(_bfA).normalize();
    rig.worldToLocal(mL.getWorldPosition(_bfA));
    rig.worldToLocal(mR.getWorldPosition(_bfB));
    _bfA.add(_bfB).multiplyScalar(0.5);
    out.sub(_bfA).normalize();
    return true;
  }
  /** Seconds since the last shot, and how many barrels it was. Drives recoil. */
  let fireAge = Infinity;
  let fireBarrels: 1 | 2 = 1;

  // ——— FREE AIM (Realms of the Haunting scheme) ———————————————————————
  // The mouse drives a RETICLE around the viewport; the camera only turns once
  // that reticle pushes past a large central dead zone, and the weapon leans to
  // follow it. Shots go through the reticle, not through screen centre.
  let freeAimOn = true;
  let aim: AimPoint = { x: 0, y: 0 };
  let weaponYawDeg = 0;
  let weaponPitchDeg = 0;
  /** Lateral/vertical travel of the whole view model, METRES in camera space.
   *  Smoothed on the same lag as the angles so the gun arrives as one motion
   *  rather than sliding and turning at different rates. */
  let weaponSlideXm = 0;
  let weaponSlideYm = 0;
  /** Metres walked, and the smoothed 0..1 speed envelope. Bob is driven by
   *  DISTANCE so it stays locked to footfalls at any speed. */
  let bobDistance = 0;
  let bobAmount = 0;
  let prevPlayerPos: Vec3 = [0, 0, 0];
  let reticleEl: HTMLDivElement | null = null;
  let gunReady = false;
  // LOADING SCREEN gate: resolved on BOTH paths below — a failed weapon load
  // still boots the game, and the loader must not hang on it.
  let resolveGunReady: () => void = () => {};
  const gunReadyPromise = new Promise<void>((r) => { resolveGunReady = r; });
  setLoader('weapon + effects');
  try {
    const gltf = await new GLTFLoader().loadAsync(GUN_GLB);
    // PBR metal is black without something to reflect — this page has no
    // environment and the flesh's hand-written lighting does not apply to a
    // MeshStandardMaterial. Per-material env, kit-overlay style, so the level
    // meshes keep their gallery look.
    const pmrem = new THREE.PMREMGenerator(handle.renderer);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    gltf.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      for (const mat of Array.isArray(m) ? m : m ? [m] : []) {
        const std = mat as THREE.MeshStandardMaterial;
        if (std.isMeshStandardMaterial) {
          std.envMap = env;
          // The whole point of the new palette is a gun that catches light in a
          // dark dungeon. 0.7 against its private RoomEnvironment was tuned for
          // the old near-black metal.
          std.envMapIntensity = 1.1;
          gunMaterials.push(std);
          std.needsUpdate = true;
        }
      }
    });
    gunGroup = new THREE.Group();
    gunGroup.name = 'grapeshot-k3';
    gunGroup.add(gltf.scene);
    // The break is a code-driven rotation of this node about the hinge locator
    // -- the GLB carries no animation. A null here means the export lost its
    // grouping, which must be loud: a silent null would present as a reload
    // animation that plays and moves nothing.
    const barrels = gltf.scene.getObjectByName('Barrels') ?? null;
    const hingeNode = gltf.scene.getObjectByName('Hinge') ?? null;
    if (!barrels || !hingeNode) {
      throw new Error('[sdf-game] shorty-double.glb is missing Barrels/Hinge nodes');
    }
    // Every moving part is a named node. A missing one must be LOUD: silently
    // skipping it presents as a reload that animates and moves nothing, which
    // is precisely the class of bug this whole change exists to remove.
    const need = (n: string): THREE.Object3D => {
      const o = gltf.scene.getObjectByName(n);
      if (!o) throw new Error(`[sdf-game] shorty-double.glb is missing the ${n} node`);
      return o;
    };
    shellNodes = [need('Shell_L'), need('Shell_R')];
    breechNodes = [need('Breech_L'), need('Breech_R')];
    extractorNode = need('Extractor');
    topLeverNode = need('TopLever');
    for (const s of shellNodes) shellRestZ.push(s.position.z);
    extractorRestZ = extractorNode.position.z;
    // Rotate about the HINGE, not about the barrel node's own origin -- the
    // latter would swing the barrels through the frame. Standard fix: a pivot
    // group parked at the hinge, with the barrels offset back by the same
    // amount, so the group's rotation IS the break.
    hingePivot = new THREE.Group();
    hingePivot.position.copy(hingeNode.position);
    (barrels.parent ?? gltf.scene).add(hingePivot);
    hingePivot.add(barrels);
    barrels.position.sub(hingeNode.position);
    // AXIS NOTE: the model script's "muzzles down -Y" is BLENDER space;
    // Blender's Z-up -> glTF Y-up conversion (x,z,-y) lands them at +Z in
    // GLB space, up stays +Y. rotation.y = PI aims +Z down the camera's -Z
    // (forward) with the hammers still on top. (rotation.x = PI/2 pointed
    // the gun at the sky — first live capture caught it.)
    // FPV pose, carried over from the model script's preview constants so the
    // Blender FPV render and the game agree. Yaw cants the barrels toward
    // screen centre so BOTH bores read; pitch lifts the muzzle off the floor.
    gunGroup.rotation.y = Math.PI;
    gunGroup.rotation.z = THREE.MathUtils.degToRad(GUN_REST.rollDeg);
    gunGroup.rotation.x = THREE.MathUtils.degToRad(GUN_REST.pitchDeg);
    gunGroup.position.copy(GUN_REST.pos);
    gunRig.add(gunGroup);
    // DEFERRED G-BUFFER ROUTE (composition review fix): the shorty is an
    // OPAQUE first-person surface — it belongs in the mesh pass (level-only
    // receiver, like the kits) so the shared light stage shades it, not a
    // parallel three lighting pass the deferred frame then overdraws. Its
    // materials are exactly the Standard family the adapter takes (the
    // loader filters to isMeshStandardMaterial), the version-tracking
    // adapter cache is what carries setGunTuning's live mutations into the
    // G-buffer, and castShadow stays FALSE — the shadow factory only casts
    // `castShadow === true` meshes, so routing never puts the viewmodel in
    // the flashlight maps. The flash sprite, smoke and blood stay FORWARD
    // (blended, unregistered).
    if (deferredApi) deferredApi.router.register(gunGroup, 'mesh', 'level-only');

    // Anchor points come off the GLB itself, so they cannot drift from the
    // weapon when its pose changes -- which is what left the support hand
    // floating unattached instead of gripping the fore-end.
    viewModelAnchor.updateMatrixWorld(true);
    {
      const mL = new THREE.Vector3(), mR = new THREE.Vector3();
      if (locatorInView(gltf.scene, 'Muzzle_L', mL) && locatorInView(gltf.scene, 'Muzzle_R', mR)) {
        MUZZLE_VIEW.copy(mL).add(mR).multiplyScalar(0.5);
      }
      const nL = gltf.scene.getObjectByName('Muzzle_L');
      const nR = gltf.scene.getObjectByName('Muzzle_R');
      if (nL && nR) muzzleNodes = [nL, nR];
      if (!locatorInView(gltf.scene, 'Grip_Hand', GRIP_HAND_REST)) {
        GRIP_HAND_REST.set(GUN_REST.pos.x + 0.02, GUN_REST.pos.y - 0.04, GUN_REST.pos.z + 0.05);
      }
      if (!locatorInView(gltf.scene, 'Fore_Hand', FORE_HAND_REST)) {
        FORE_HAND_REST.set(GUN_REST.pos.x, GUN_REST.pos.y - 0.05, GUN_REST.pos.z - 0.15);
      }
      // Sit each hand just off its locator so the orb WRAPS the wood rather
      // than intersecting the middle of it. The support hand also shifts to the
      // gun's left flank: directly underneath, it hid behind the fore-end and
      // read as a sliver, which is not "holding the handrail".
      GRIP_HAND_REST.y -= 0.014;
      FORE_HAND_REST.x -= 0.042;
      FORE_HAND_REST.y -= 0.014;
    }
    // THE ARMS. goblin-arm.glb, dressed by game-arms.ts: mottled skin with no
    // glow, a bracer whose steel and brass match the gun, a smartwatch on the
    // left wrist. Each group's origin is the HAND, so the rest positions read
    // off the gun's locators go straight onto it, and aimArm() swings the arm
    // behind the hand toward a fixed elbow without moving the hand.
    arms = await loadGoblinArms(GOBLIN_ARM_GLB, { env, envMapIntensity: 1.1 });
    handMaterial = arms.skin;
    gripHandGroup = arms.right;
    foreHandGroup = arms.left;
    gripHandGroup.name = 'fpv-hand-grip';
    foreHandGroup.name = 'fpv-hand-fore';
    gripHandGroup.position.copy(GRIP_HAND_REST);
    foreHandGroup.position.copy(FORE_HAND_REST);
    gunRig.add(gripHandGroup, foreHandGroup);
    aimArms();
    // DEFERRED G-BUFFER ROUTE: the goblin arms are opaque Standard-material
    // surfaces (skin, bracer, watch screen — game-arms.ts) — same route as
    // the gun, same receiver, same castShadow reasoning.
    if (deferredApi) {
      deferredApi.router.register(gripHandGroup, 'mesh', 'level-only');
      deferredApi.router.register(foreHandGroup, 'mesh', 'level-only');
    }

    // SHOTGUN CASES. Red hull, brass head -- the read the owner asked for.
    // Four meshes, all built now: two thrown out of the breech on the eject
    // beat, two carried up by the support hand and seated on the load beat.
    const hullGeo = new THREE.CylinderGeometry(0.0165, 0.0165, 0.049, 12);
    const headGeo = new THREE.CylinderGeometry(0.0172, 0.0172, 0.021, 12);
    const hullMat = new THREE.MeshStandardMaterial({ color: 0xa8231d, roughness: 0.55 });
    const headMat = new THREE.MeshStandardMaterial({ color: 0xb08d3a, roughness: 0.35, metalness: 0.9 });
    function makeShell(name: string): THREE.Group {
      const g = new THREE.Group();
      g.name = name;
      const hull = new THREE.Mesh(hullGeo, hullMat);
      hull.position.y = 0.0105;
      const head = new THREE.Mesh(headGeo, headMat);
      head.position.y = -0.0245;
      g.add(hull, head);
      // Orientation is written every frame from the live bore basis (hull +Y
      // onto -out); nothing here is a resting pose.
      g.visible = false;
      return g;
    }
    for (let i = 0; i < 2; i++) {
      const e = makeShell(`shell-eject-${i}`); ejectedShells.push(e); gunRig.add(e);
      const l = makeShell(`shell-load-${i}`); loadShells.push(l); gunRig.add(l);
      // DEFERRED G-BUFFER ROUTE: the shells are OPAQUE Standard meshes (red
      // hull, brass head) — level-only like the rest of the viewmodel. They
      // fly and tumble through the forward-composited frame, so this route
      // is also what makes them depth-test against the presented scene
      // (walls occlude a shell that landed behind it).
      if (deferredApi) {
        deferredApi.router.register(e, 'mesh', 'level-only');
        deferredApi.router.register(l, 'mesh', 'level-only');
      }
    }

    // MUZZLE FLASH -- geometry half. Textured, not flat quads: the first pass
    // used untextured PlaneGeometry and read as a bright RECTANGLE (the owner's
    // report). flash-sprite.ts generates a ragged star with real alpha, and a
    // few seeds are pre-baked so repeat fire does not strobe one silhouette.
    for (let i = 0; i < FLASH_VARIANTS; i++) {
      const tex = new THREE.DataTexture(flashPixels(128, 17 + i * 31), 128, 128, THREE.RGBAFormat);
      tex.needsUpdate = true;
      flashTextures.push(tex);
    }
    const flashMat = new THREE.MeshBasicMaterial({
      map: flashTextures[0], color: 0xffe6bf, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false,
      side: THREE.DoubleSide,
    });
    flashGroup = new THREE.Group();
    flashGroup.visible = false;
    // Two crossed cards so the star has volume from off-axis, plus a wider,
    // fainter one for the outer glow.
    for (const [roll, scale] of [[0, 1], [Math.PI / 2, 1], [Math.PI / 4, 1.7]] as const) {
      const q = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.34), flashMat);
      q.rotation.z = roll;
      q.scale.setScalar(scale);
      flashGroup.add(q);
    }
    // Just CLEAR of the bores: centred exactly on them, half the card sits
    // inside the barrel volume. And depthTest:false does not control draw
    // ORDER -- without a renderOrder the gun still paints over the flash.
    flashGroup.position.set(MUZZLE_VIEW.x, MUZZLE_VIEW.y, MUZZLE_VIEW.z - 0.035);
    flashGroup.renderOrder = 999;
    for (const c of flashGroup.children) c.renderOrder = 999;
    gunRig.add(flashGroup);
    flashMaterial = flashMat;

    // SMOKE. A small pool of soft puffs released at the muzzle, drifting up and
    // out while they expand and fade. No particle system exists on this page;
    // this is the same billboard-pool fallback fpv-view.ts uses for bursts.
    const smokeTex = new THREE.DataTexture(smokePixels(128), 128, 128, THREE.RGBAFormat);
    smokeTex.needsUpdate = true;
    for (let i = 0; i < SMOKE_COUNT; i++) {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(0.16, 0.16),
        new THREE.MeshBasicMaterial({
          map: smokeTex, transparent: true, opacity: 0, depthWrite: false,
          color: 0x9a938c,
        }),
      );
      m.visible = false;
      smokePuffs.push({ mesh: m, age: Infinity, vel: new THREE.Vector3(), roll: 0 });
      gunRig.add(m);
    }

    // MUZZLE FLASH -- level half. Allocated ONCE at intensity 0 and only ever
    // modulated: adding or removing a light at runtime forces a TSL shader
    // recompile, which would hitch on every trigger pull. Range and power are
    // both up from the first pass, which the owner reported as barely lighting
    // its surroundings.
    flashLight = new THREE.PointLight(0xffcf95, 0, 16, 1.7);
    // The deferred coordinator's muzzle candidate reads this (live closure) —
    // its own light entry, never a replay into the body flashlight uniforms.
    muzzleLight = flashLight;
    // A little AHEAD of the bores, so it throws light down the room instead of
    // mostly onto the gun's own barrels.
    flashLight.position.set(MUZZLE_VIEW.x, MUZZLE_VIEW.y, MUZZLE_VIEW.z - 0.10);
    gunRig.add(flashLight);
    // The level's light lists were built before this light existed.
    refreshLevelLights();
    gunReady = true;
    resolveGunReady();
    mark('gun-ready');
  } catch (err) {
    console.error('[sdf-game] gun model failed to load — firing still works', err);
    resolveGunReady();
    mark('gun-ready');
  }

  // PIPELINE WARM-UP (spike program, 2026-09-10). three's WebGPU backend
  // compiles a pipeline the first time a material+geometry pair renders —
  // MID-FRAME, which the owner has felt as a freeze on the first shot or
  // first gout of a session (cpu:draw spikes to 26-38 ms in the bench).
  //
  // STARTUP-HITCH ATTRIBUTION (2026-09-14, probe in
  // scripts/startup-hitch-probe.mjs): the 2026-09-13 shape — flip hidden
  // objects, compileAsync(scene), precompilePasses — left three costs on the
  // first LIVE frame, all measured there as one 780-1635 ms frame (the
  // owner's 2360 ms [Violation] right after [warm]):
  //
  // 1. WRONG CONTEXT. compileAsync compiles against the CANVAS, but the live
  //    draw renders the main scene into post-aa's HalfFloat sceneTarget
  //    (attachment formats are part of three's pipeline cache key) — so every
  //    main-pass pipeline re-created at the first presented frame (gun
  //    'Steel'/plates, level, shadow pass, VHS chain: ~57-68 creations).
  // 2. COMPUTE. The warm never dispatched compute: the first crowd sync
  //    created all 24 tile-bin compute pipelines (6 types x 4 kernels)
  //    mid-frame.
  //
  // The warm now pauses the loop (as before), lets the gun finish (its
  // materials, the muzzle light and the level-shadow rig enter the scene with
  // it), runs one empty-group tile-bin per crowd type, then draws ONE REAL
  // FRAME via handle.drawOnce() — the full live draw path (scene into
  // sceneTarget, sdf layer, goo, post chain incl. VHS) — so everything
  // compiles in the context it will actually run in, behind the loader.
  const warmPipelines = async (): Promise<WarmOutcome> => {
    const tInvoke = performance.now();
    const flipped: THREE.Object3D[] = [];
    // The render loop is ALREADY armed here (createLabRenderer starts it; the
    // game drawFn replaced the default at setDrawFn) — suspend before anything
    // compiles so nothing renders warm and nothing compiles mid-frame.
    // SUSPEND, do not change intent: a rig that pauses the loop while this is
    // in flight must win (warm-gate.ts createLoopController).
    loopControl.suspend();
    mark('warm-invoked');
    // The gun load is awaited earlier in boot, so this has usually resolved
    // already; awaiting it keeps the ordering explicit — the weapon's
    // materials and the lights it registers must be in the scene before the
    // compiles below run.
    //
    // TIMING SPLIT (2026-09-16). Awaiting a settled promise queues a
    // microtask, and main() yields at its next await; measured on the shipped
    // page that interlude is only 9-27 ms, so this continuation starts just
    // after warmPipelines() was invoked. The split is kept because `ms` should
    // be the warm's own work (it now equals the sum of `phases`) and because it
    // stays correct if more synchronous code is ever added between the invoke
    // and this point. `bootBeforeWarmMs` is that interlude, reported, not
    // folded into the warm.
    await gunReadyPromise;
    const t0 = performance.now();
    mark('warm-steps-start');
    let passesCompiled = 0;
    let computesWarmed = 0;
    // A warm that throws is a FAILED warm: the loader gate must say so rather
    // than presenting the resolved promise as success (reviewer fix 2026-09-16b).
    let didFail = false;
    const phases: Record<string, number | number[]> = {};
    try {
      let tp = performance.now();
      scene.traverse((o) => {
        // Any invisible Object3D, not just meshes: a hidden GROUP (flash
        // group) hides visible children that the compiles would otherwise
        // skip — the first-shot freeze survived for exactly those.
        if (!o.visible) { flipped.push(o); o.visible = true; }
      });
      phases.flip = performance.now() - tp;
      mark('warm-flip-done');
      // CROWD TILE-BIN COMPUTES (attribution 2 above). An empty-group bin
      // dispatches the same four kernels with zero visible slots, so the
      // pipelines are built here instead of in the first crowd sync.
      camera.updateMatrixWorld();
      camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
      tp = performance.now();
      if (crowdOn) {
        const warmGrid = {
          widthPx: sdfLayer.targetSize.width,
          heightPx: sdfLayer.targetSize.height,
        };
        const perType: number[] = [];
        for (const t of crowdTypes.values()) {
          const t1 = performance.now();
          t.tiles.bin([], camera, 0, warmGrid);
          perType.push(Math.round((performance.now() - t1) * 10) / 10);
          computesWarmed++;
        }
        phases.crowdBinsPerType = perType;
      }
      phases.crowdBins = performance.now() - tp;
      mark('warm-crowd-bins-done');
      tp = performance.now();
      if (gooLayer) await gooLayer.precompile(camera);
      phases.goo = performance.now() - tp;
      mark('warm-goo-done');
      // ONE REAL FRAME (attribution 1 above). The previous warm-up ended here
      // with a compileAsync(scene, camera) — canvas context — and every
      // main-pass pipeline still had to be built the first time the live draw
      // rendered into post-aa's HalfFloat target. drawFn IS the live draw
      // path; running it once, loop paused and loader up, compiles the level,
      // the weapon, the shadow map, the sprites and the post chain exactly
      // where they will run.
      //
      // ORDERING (measured 2026-09-14): this MUST run before
      // sdfLayer.precompilePasses. The march pass's compileAsync queues the
      // crowd material's pipeline for ASYNC creation; a queued pipeline reads
      // as not-ready, so the later real frame would SKIP the crowd march, and
      // under load the queued creation settled up to 51 s late (the probe's
      // slowest-creation record) — a boot window with no crowd at all. Drawn
      // here FIRST, the crowd pipeline is created synchronously inside the
      // march submit and precompilePasses below becomes a cache-hit
      // confirmation pass.
      tp = performance.now();
      handle.drawOnce();
      phases.drawOnce = performance.now() - tp;
      mark('warm-draw-once-done');
      // The SDF layer's own passes: the twins in their real target/MRT context,
      // the fullscreen passes (blit/accum/detail/refine-view/composite) that are
      // in private scenes the traversal above cannot reach, and the upscale
      // stage's per-layer passes. See SdfLayer.precompilePasses.
      tp = performance.now();
      passesCompiled = await sdfLayer.precompilePasses(scene, camera);
      phases.precompile = performance.now() - tp;
      mark('warm-precompile-done');
      const done = {
        ms: Math.round(performance.now() - t0),
        bootBeforeWarmMs: Math.round(t0 - tInvoke),
        flipped: flipped.length,
        // WHAT the 61 hidden objects are — the flip exists for the flash
        // group, but the traversal takes everything; the names make an
        // over-broad warm visible instead of guessed.
        flippedNames: flipped.slice(0, 80).map((o) => `${o.type}:${o.name || '?'}`),
        passes: passesCompiled,
        computes: computesWarmed,
        phases,
      };
      (window as unknown as Record<string, unknown>).__warmDone = done;
      console.log(`[warm] ${done.ms} ms of warm steps after ${done.bootBeforeWarmMs} ms of synchronous boot (${done.flipped} hidden objects, ${done.computes} crowd types, ${passesCompiled} stage/layer passes)`);
      console.log(`[warm] phases ${JSON.stringify(phases)}`);
    } catch (err) {
      didFail = true;
      console.error('[warm] pipeline warm-up failed', err);
      // A driver waiting on __warmDone must not wait forever because the
      // warm-up threw: record the failure under the same key.
      (window as unknown as Record<string, unknown>).__warmDone = {
        ms: Math.round(performance.now() - t0),
        bootBeforeWarmMs: Math.round(t0 - tInvoke),
        flipped: flipped.length, error: String(err), phases,
      };
    } finally {
      for (const o of flipped) o.visible = false;
      // Release the suspension; the CURRENT intent wins, so a pause requested
      // while the warm was in flight is respected (warm-gate.ts).
      loopControl.release();
      mark('warm-finally');
    }
    return didFail ? 'failed' : 'ok';
  };
  // ?warm=0 skips the warm-up (A/B: the first-shot freeze it removes).
  // Adversarial review 794a7cfc: a compileAsync that never settles would hold
  // the loader (and the flipped meshes) forever — bound the LOADER, never the
  // work. STARTUP-FREEZE FIX (2026-09-16): the old Promise.race resolved the
  // gate at 15 s and then claimed READY while warmPipelines was still running
  // with the loop paused — the owner's "loaded, then frozen" window.
  // REVIEWER FIX (2026-09-16b): warmPipelines catches its own throw, so its
  // promise RESOLVES on failure; the old gate therefore revealed READY after a
  // recorded warm error. `coordinateWarmGate` (warm-gate.ts) is the real
  // coordinator: it awaits the warm's OUTCOME, reports `warm-failed` /
  // `device-lost` honestly, and on the 15 s bound only changes the wording —
  // it never reveals the game before the work settles.
  const warmRequested = new URLSearchParams(location.search).get('warm') !== '0';
  const warmPromise: Promise<WarmOutcome> = warmRequested ? warmPipelines() : Promise.resolve<WarmOutcome>('ok');
  void coordinateWarmGate({
    warm: warmPromise,
    prereq: gunReadyPromise,
    timeoutMs: 15000,
    isDeviceLost: () => Boolean(handle.gpuDiagnostics.lost),
    handlers: {
      setLoader: (text, ready) => setLoader(text, ready),
      revealReady: () => {
        setLoader('READY — CLICK TO START', true);
        window.setTimeout(() => loaderEl?.classList.add('loader-hidden'), 1200);
      },
      // A failed / lost warm must not be presented as a successful compile.
      // The game is still playable, so the overlay is dismissed after a beat —
      // with the honest message, and with the failure in the console.
      revealFailure: (text) => {
        setLoader(text, true);
        window.setTimeout(() => loaderEl?.classList.add('loader-hidden'), 2500);
      },
    },
  }).then((gate) => {
    (window as unknown as Record<string, unknown>).__warmGate = { phase: gate.phase, timedOut: gate.timedOut };
    if (gate.phase !== 'ready') console.warn(`[warm] loader gate settled ${gate.phase}${gate.timedOut ? ' (after the 15 s bound)' : ''}`);
  });

  /** Scratch, so the per-shot path allocates nothing. */
  const _muzA = new THREE.Vector3(), _muzB = new THREE.Vector3();
  /**
   * World-space muzzle. Reads the GLB's OWN Muzzle_L/R locators when the gun is
   * loaded, so it follows the weapon's real heading -- including the free-aim
   * swing -- instead of being a second description of where the gun is that can
   * drift from the first. It did drift: the previous inline version put the
   * spawn point at forward -0.500 from the eye while the visible muzzle sits at
   * forward +0.600, so every projectile was born 1.1 m BEHIND the barrel and
   * flew through the player's head.
   *
   * The fallback keeps the headless contract: predictSlugHitNow() and the CDP
   * gates fire with no GLB loaded, which is why an eye-relative formula exists
   * at all. It now goes through muzzle-pos.ts's tested helper rather than
   * re-deriving the basis by hand with the sign wrong.
   */
  function muzzleWorld(): Vec3 {
    const eye = eyeOf(player);
    if (gunReady && muzzleNodes.length === 2) {
      muzzleNodes[0]!.getWorldPosition(_muzA);
      muzzleNodes[1]!.getWorldPosition(_muzB);
      _muzA.add(_muzB).multiplyScalar(0.5);
      return [_muzA.x, _muzA.y, _muzA.z];
    }
    const cp = Math.cos(player.pitch);
    const fwd = { x: Math.sin(player.yaw) * cp, y: Math.sin(player.pitch), z: -Math.cos(player.yaw) * cp };
    const right = { x: Math.cos(player.yaw), y: 0, z: Math.sin(player.yaw) };
    const up = {
      x: right.y * fwd.z - right.z * fwd.y,
      y: right.z * fwd.x - right.x * fwd.z,
      z: right.x * fwd.y - right.y * fwd.x,
    };
    const m = muzzleWorldPosition(
      { x: eye[0], y: eye[1], z: eye[2] }, { right, up, forward: fwd },
      0.2, -0.12, 0.5,
    );
    return [m.x, m.y, m.z];
  }
  /** The live frustum half-angle tangents. ONE definition: the barrel angle
   *  (weaponAngles, in the frame loop) and the shot ray (aimDir, right below)
   *  must not be able to disagree about where the reticle is -- that
   *  disagreement is exactly the class of bug this whole pass exists to fix,
   *  and duplicating this formula is how it would come back the first time
   *  someone tweens camera.fov for ADS or recoil.
   *
   *  Named aimFrustum, not frustum -- that name is already the module-scope
   *  THREE.Frustum used for on-screen-body culling, a different concept
   *  entirely (a view volume for culling vs. these bare half-angle tangents). */
  function aimFrustum(): Frustum {
    const tanV = Math.tan((camera.fov * Math.PI) / 360);
    return { tanV, tanH: tanV * camera.aspect };
  }
  function aimDir(): Vec3 {
    const cp = Math.cos(player.pitch);
    const fwd: Vec3 = [
      Math.sin(player.yaw) * cp, Math.sin(player.pitch), -Math.cos(player.yaw) * cp,
    ];
    if (!freeAimOn) return fwd;
    // FIRE THROUGH THE RETICLE. With free aim the reticle is the aim point, so
    // a shot down the camera's forward axis would land wherever the player
    // happens to be FACING rather than where they are AIMING -- the one thing
    // this scheme exists to separate. Offset the ray by the reticle's angular
    // position inside the frustum.
    const { tanV, tanH } = aimFrustum();
    const right: Vec3 = [Math.cos(player.yaw), 0, Math.sin(player.yaw)];
    // up = right x fwd, for a right-handed basis
    const up: Vec3 = [
      right[1] * fwd[2] - right[2] * fwd[1],
      right[2] * fwd[0] - right[0] * fwd[2],
      right[0] * fwd[1] - right[1] * fwd[0],
    ];
    const cx = aim.x * tanH, cy = aim.y * tanV;
    const d: Vec3 = [
      fwd[0] + right[0] * cx + up[0] * cy,
      fwd[1] + right[1] * cx + up[1] * cy,
      fwd[2] + right[2] * cx + up[2] * cy,
    ];
    const l = Math.hypot(d[0], d[1], d[2]) || 1;
    return [d[0] / l, d[1] / l, d[2] / l];
  }
  /** AIM CONVERGENCE (2026-08-26 defect-2 fix candidate): the muzzle sits
   *  ~20 cm right and ~12 cm low of the EYE, and pellets used to fly PARALLEL
   *  to the camera ray — so at ANY range impacts landed that whole offset off
   *  the crosshair. Standard FPS remedy: every projectile converges on the
   *  point where the camera ray meets AIM_CONVERGE_M. Close shots still group;
   *  the parallel-ray offset is gone by construction. */
  const AIM_CONVERGE_M = 8;
  function convergedDir(origin: Vec3): Vec3 {
    const eye = eyeOf(player);
    const a = aimDir();
    const target: Vec3 = [
      eye[0] + a[0] * AIM_CONVERGE_M,
      eye[1] + a[1] * AIM_CONVERGE_M,
      eye[2] + a[2] * AIM_CONVERGE_M,
    ];
    const d: Vec3 = [target[0] - origin[0], target[1] - origin[1], target[2] - origin[2]];
    const l = Math.hypot(d[0], d[1], d[2]) || 1;
    return [d[0] / l, d[1] / l, d[2] / l];
  }

  // Pellets: simulated pure (game-weapon.ts), drawn from a mesh pool that
  // grows on demand inside the tick's sync step.
  const pellets: Projectile[] = [];

  /** SOLDIER PELLETS — A SEPARATE LIST, AND NEVER TRACED AGAINST ACTORS.
   *
   *  Two deliberate reasons. The player's pellet path is tuned, pinned, and
   *  carries the hit-batching work from 2026-09-05; a soldier feature must not
   *  perturb it. And an un-traced list CANNOT accidentally friendly-fire the
   *  zombies — whether soldiers hurt them is a real encounter-design decision,
   *  not one to make by accident.
   *
   *  There is no player health in the SDF game, so these hit nothing at all.
   *  They stop at solid level geometry and expire; actor damage remains a later phase. */
  const soldierPellets: Projectile[] = [];
  const soldierPelletViews: TracerView[] = [];
  // The gather's tracer provider (declared at the top, next to probeGather) can
  // only be wired once both lists exist — see the boot-race note there.
  liveTracers = () => [...pellets, ...soldierPellets];

  // TRACERS. A shot in flight is drawn as a stretched, additively-blended
  // light streak (tracer-sprite.ts), not as the shaded ball this used to be:
  // a 10 cm sphere is a yellow dot downrange and a screen-filling yellow blob
  // in its first frames at the muzzle. See that file's header for the shape /
  // aim / fade split.
  //
  // ONE quad per shot — the sprite carries its own halo, so there is no second
  // glow card and no blur pass. The geometry is a unit plane; the per-frame
  // basis matrix carries length, width AND orientation together, which is why
  // these views run matrixAutoUpdate off.
  const tracerTex = new THREE.DataTexture(tracerPixels(256, 64), 256, 64, THREE.RGBAFormat);
  tracerTex.needsUpdate = true;
  const emberTex = new THREE.DataTexture(emberPixels(128), 128, 128, THREE.RGBAFormat);
  emberTex.needsUpdate = true;
  const pelletGeo = new THREE.PlaneGeometry(1, 1);
  /** The streak and the head-on ember for ONE projectile. Two quads because
   *  they are oriented differently — the streak rolls about the trajectory,
   *  the ember faces the eye outright — and because their weights are
   *  complementary: see tracerHeadOn. Both carry their own material, since
   *  each fades independently by distance and angle, the same way the smoke
   *  puffs above each own their opacity. */
  interface TracerView { streak: THREE.Mesh; ember: THREE.Mesh }
  function newTracerQuad(map: THREE.Texture): THREE.Mesh {
    const mesh = new THREE.Mesh(pelletGeo, new THREE.MeshBasicMaterial({
      map, transparent: true, opacity: 1, blending: THREE.AdditiveBlending,
      depthWrite: false, side: THREE.DoubleSide,
    }));
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    return mesh;
  }
  function newTracerView(): TracerView {
    const view = { streak: newTracerQuad(tracerTex), ember: newTracerQuad(emberTex) };
    // The EFFECTS overlay, not the main scene: the overlay draws after the
    // SDF composite against the completed depth buffer, so a streak crossing
    // in front of a body stays visible and one behind it is occluded. In the
    // main pass the streak writes no depth, and the flesh composite — depth-
    // testing only against the wall behind — painted straight over it
    // (owner-caught: tracers clipped by the soldier's body).
    characterEffects.scene.add(view.streak);
    characterEffects.scene.add(view.ember);
    return view;
  }
  /** Compose one quad's world matrix from a basis, two axis scales and a centre. */
  function setQuadMatrix(
    m: THREE.Mesh, b: TracerBasis, sx: number, sy: number, cx: number, cy: number, cz: number,
  ): void {
    const { x, y, z } = b;
    // Row-major to Matrix4.set: the COLUMNS are (x*sx, y*sy, z, centre).
    m.matrix.set(
      x[0] * sx, y[0] * sy, z[0], cx,
      x[1] * sx, y[1] * sy, z[1], cy,
      x[2] * sx, y[2] * sy, z[2], cz,
      0, 0, 0, 1,
    );
    m.matrixWorldNeedsUpdate = true;
  }
  /**
   * Point one pooled view at one live projectile, from an eye at `eye`.
   * The streak's HEAD sits on the projectile and the smear trails behind it,
   * so the thing that collides and the thing that glows are the same point;
   * the ember sits ON the projectile and takes over as the streak collapses.
   */
  function placeTracer(v: TracerView, p: Projectile, eye: Vec3): void {
    const ex = eye[0] - p.pos[0], ey = eye[1] - p.pos[1], ez = eye[2] - p.pos[2];
    const toEye: Vec3 = [ex, ey, ez];
    const dist = Math.hypot(ex, ey, ez);
    const fade = tracerNearFade(dist);
    const basis = tracerBasis(p.vel, toEye);
    if (!basis || fade <= 0) { hideTracer(v); return; }

    const len = tracerLength(Math.hypot(p.vel[0], p.vel[1], p.vel[2]));
    // Near the eye the width and the ember shrink with distance so a pellet
    // passing the camera stays a glow, never a screen-filling disc. See
    // tracerNearScale — the fade alone does not cover an ARRIVING shot.
    const near = tracerNearScale(dist);
    const wid = p.radius * TRACER.widthScale * near;
    v.streak.visible = true;
    (v.streak.material as THREE.MeshBasicMaterial).opacity = fade;
    setQuadMatrix(v.streak, basis, len, wid,
      p.pos[0] - basis.x[0] * len * 0.5,
      p.pos[1] - basis.x[1] * len * 0.5,
      p.pos[2] - basis.x[2] * len * 0.5);

    const headOn = tracerHeadOn(p.vel, toEye) * fade;
    const face = headOn > 0 ? faceEyeBasis(toEye) : null;
    if (!face) { v.ember.visible = false; return; }
    const d = p.radius * TRACER.emberScale * near;
    v.ember.visible = true;
    (v.ember.material as THREE.MeshBasicMaterial).opacity = headOn;
    setQuadMatrix(v.ember, face, d, d, p.pos[0], p.pos[1], p.pos[2]);
  }
  function hideTracer(v: TracerView): void {
    v.streak.visible = false;
    v.ember.visible = false;
  }
  const pelletViews: TracerView[] = [];

  /** NOTE (determinism stage 1, 2026-09-14): the inline LCG and its `lcgNext` /
   *  `lcgUnit` helpers are gone. The named streams in `rng.ts` replace them —
   *  `rngStreams.reload` for the reload arc, `fx` for the muzzle flash/smoke,
   *  `misc` for pellet seeds. The values change (a different seed derivation),
   *  which is intended: the point is that a divergence is traceable to ONE
   *  subsystem rather than to a single shared counter. Do NOT reseed mid-run. */
  let cooldown = 0;
  /** Shells in the gun. The reload animation only means something if running
   *  dry is a state the player can be in. */
  let shells = MAGAZINE_CAPACITY;
  /** UNLIMITED AMMO — ON by default, 2026-09-10 (owner: "i noticed we have like
   *  'ammo'? it should be unlimited for now to make testing easier").
   *
   *  The grapeshot holds two shells and then spends 1.30 s breaking open and
   *  reloading, which is the right feel for the weapon and pure friction for a
   *  gib/blast tuning pass — every second shot is a reload instead of a test.
   *  So running the magazine down is OFF unless asked for:
   *
   *    ?ammo=finite   restores the two-shell magazine, the dry click and the
   *                   reload — which is the ONLY way to exercise that animation,
   *                   so the flag is the reload gate, not a legacy switch.
   *    __sdfGame.setInfiniteAmmo(false)   same, at runtime.
   *
   *  The gun's own 0.45 s fire cooldown still applies, so this is unlimited
   *  AMMO, not an unlimited rate of fire. The dynamite needs nothing: its prop
   *  pool refills the hand after each throw's recovery beat, so it was already
   *  unlimited. */
  let infiniteAmmo = new URLSearchParams(location.search).get('ammo') !== 'finite';
  /** Seconds into the reload, or Infinity when not reloading. */
  let reloadAge = Infinity;
  /** Varies the eject arc per reload (owner: "they always eject the same").
   *  0 is the reference arc; pinReloadSeed() holds one for a gate. */
  let reloadSeed = 0;
  let pinnedReloadSeed: number | null = null;
  /** Reload time scale. 1 = real; KeyT cycles 1 -> 0.25 -> 0.1 so the owner
   *  can watch a case leave the bore frame by frame ("could slow it down to
   *  make it easier to see"). Inspection only: nothing else keys off it. */
  let reloadSpeed = 1;
  function startReload(): void {
    reloadAge = 0;
    reloadSeed = pinnedReloadSeed ?? 1 + Math.floor(rngStreams.reload() * 1e6);
  }
  let recoilPitch = 0;

  /** SLUG MODE — one big projectile, one big crater. Diagnostic first: eight
   *  barely-visible 5.5 cm craters gave no signal about placement or look.
   *  Reachable three ways: ?slug URL param at boot, KeyE in-page toggle, or
   *  __sdfGame.fireSlug(). The HUD shows which mode is live. */
  let slugMode = new URLSearchParams(location.search).has('slug');

  function fire(barrels: 1 | 2): boolean {
    // SLOT GATE. The grapeshot only speaks while it is the live weapon and the
    // switch has settled — __sdfGame.fire()/fireSlug() go through here too, so
    // a driver cannot fire the shotgun through a lit bundle.
    if (slotState.live !== 'shotgun' || !slotReady(slotState)) return false;
    if (!gunReady || cooldown > 0) return false;
    if (reloadAge <= RELOAD.totalSec) return false;   // busy breaking/loading
    if (!infiniteAmmo && shells <= 0) { startReload(); return false; } // click -> start reloading
    // Gunfire in a room turns every head in it, cone or no cone. Placed after
    // the guards on purpose: a dry click or a shot during a reload must not
    // alert anything, or the flag fires on inputs that made no noise.
    barrels = (infiniteAmmo ? barrels : Math.min(shells, barrels)) as 1 | 2;
    telemetry.event('shot', { kind: slugMode ? 'slug' : 'pellet', barrels });
    shotAlert = true;
    cooldown = GRAPESHOT.fireCooldownSec;
    recoilPitch += GRAPESHOT.kickRadPerBarrel * barrels;
    if (!infiniteAmmo) {
      shells = magazineAfterFire(shells, barrels);
      if (shells <= 0) startReload();
    }
    updateHud();
    flashAge = 0;
    fireAge = 0;
    fireBarrels = barrels;
    if (flashGroup && flashMaterial) {
      // Fresh roll AND a fresh star per shot, so repeat fire never strobes an
      // identical silhouette.
      flashGroup.rotation.z = rngStreams.fx() * Math.PI * 2;
      const tex = flashTextures[Math.floor(rngStreams.fx() * flashTextures.length)];
      if (tex) { flashMaterial.map = tex; flashMaterial.needsUpdate = true; }
    }
    // Release a few smoke puffs at the muzzle. Both barrels make more smoke.
    {
      let released = 0;
      const want = barrels === 2 ? 5 : 3;
      for (const puff of smokePuffs) {
        if (released >= want) break;
        if (puff.age !== Infinity) continue;
        puff.age = 0;
        puff.roll = rngStreams.fx() * Math.PI * 2;
        puff.mesh.position.set(
          MUZZLE_VIEW.x + (rngStreams.fx() - 0.5) * 0.03,
          MUZZLE_VIEW.y + (rngStreams.fx() - 0.5) * 0.03,
          MUZZLE_VIEW.z - 0.02 - rngStreams.fx() * 0.05,
        );
        puff.vel.set(
          (rngStreams.fx() - 0.5) * 0.25,
          0.10 + rngStreams.fx() * 0.18,
          -0.55 - rngStreams.fx() * 0.35,
        );
        puff.mesh.rotation.z = puff.roll;
        released++;
      }
    }
    if (slugMode) {
      // One lump down one known ray instead of a pellet volley.
      pellets.push(spawnSlug(muzzleWorld(), convergedDir(muzzleWorld())));
      return true;
    }
    const muz = muzzleWorld();
    const dir = convergedDir(muz);
    // spawnPellets spreads around `dir`; convergence just re-centres the cone.
    // One `misc` draw per volley is the pellet seed (mulberry32 inside).
    pellets.push(...spawnPellets(muz, dir, barrels, seedFromUnit(rngStreams.misc())));
    return true;
  }

  // Chunks: detached pieces fly ballistically and render through the shared
  // SDF chunk path — the same pipeline the lab gibs with, capped and
  // recycled so a gore party cannot churn views unboundedly.
  const MAX_CHUNKS = 12;
  /**
   * THE CHUNK-VIEW CEILING — what the shared record pool must be sized for.
   *
   * `MAX_CHUNKS` above is the PRE-DYNAMITE constant (12). The view recycler
   * deliberately does not use it: `?maxchunks` is a live knob because a full-body
   * gib is 19-20 pieces, and the comment on `maxChunks` records what a 12-view
   * pool looked like — pieces 13-20 stealing the views of pieces 1-8 inside one
   * call, which the owner read as "a weird distortion of the SDF bodies like
   * jumping into positions".
   *
   * Main's crowd march (stage a, task 7c) then gave every chunk a SLOT in one
   * shared record buffer, and `createSharedChunkGpuMaterial` sizes that buffer
   * from what the page passes: "the page passes its own view cap (MAX_CHUNKS) so
   * the pool can never under-allocate". On this branch that call site was passing
   * the stale 12 while the recycler allowed 64, so the 13th piece of any real gib
   * hit `shared chunk material is full (12 slots)` — THROWN, inside `gibActor`,
   * inside the tick. The throw landed after the body had already been spliced out
   * of `pendingGibs`, so the gib vanished silently: `gibbed` incremented,
   * `gibPieces` stayed 0, the actor was never retired, and nothing reached the
   * console because the animation loop swallowed it.
   *
   * So the pool is sized from the knob's CEILING, not its current value: the
   * material is built once at boot and `?maxchunks` / the tuning panel can raise
   * the budget at any time afterwards. 96 records is 16 vec4s each — 24 KB.
   */
  const MAX_CHUNK_BUDGET = 96;
  // ——— DYNAMITE TUNING KNOBS (2026-09-10) ————————————————————————————————
  // The whole point of the slot-2 feature is to JUDGE the blast and the gib, so
  // the numbers that decide both are live seams rather than constants:
  //   ?maxchunks=N   the live chunk-view budget. A full-body gib wants far more
  //                  pieces than a severed arm does, and the budget is what
  //                  bounds the bake queue (ONE job in flight, one swap per
  //                  frame) — which is precisely the cost this feature exists
  //                  to measure, so it must be a knob and not a constant.
  //   ?gib=pieces|clusters  gibAllPieces (one chunk per prim — Blood's "lots of
  //                  small chunks") or gibAll (one per limb; cheaper, and what
  //                  a 12-view budget can actually hold).
  //   ?dynspeed=K    scales both ends of the charge→speed band.
  const DYN_PARAMS = new URLSearchParams(location.search);
  // 24, not MAX_CHUNKS' 12: a full-body gib is 19-20 pieces, and a 12-view pool
  // means pieces 13-20 steal the views of pieces 1-8 IN THE SAME CALL — the
  // piece placed at A is re-placed at B before a frame is drawn, which the owner
  // read as "a weird distortion of the SDF bodies like jumping into positions".
  // `reset()` mutates the view in place, so it is a visible rearrangement rather
  // than an error. Raise it and one gib fits; `?maxchunks=12` restores the old
  // budget for a cost A/B.
  // LIVE, all of these: the panel that tunes the gib sits beside the frame, and
  // a knob that needs a reload per attempt is a knob the owner cannot use. The
  // boot params below set the STARTING values.
  let maxChunks = parseIntParam(DYN_PARAMS.get('maxchunks'), { min: 1, max: MAX_CHUNK_BUDGET }) ?? 64;
  // GIBS ARE NOT BODIES. The resolver's concussion launch is tuned for DUDES
  // (EXPLOSION_LAUNCH.velocityScale 0.028 on impulse 900 = ~25 m/s point-blank,
  // "a survivor crosses the room"), and firing CHUNKS at that speed threw them
  // out of an 8-16 m room before a single frame could be read — owner: "i cannot
  // see the gibs its like they are launched at such a high velocity i barely even
  // see them... they are supposed to explode and rain down". Chunks are small and
  // light; this scales the launch. The resolver's upwardBias and its 6 m/s
  // vertical floor are kept, so a slow piece still POPS UP and falls back —
  // which is what "rain down" means.
  let gibVelScale = parseFloatParam(DYN_PARAMS.get('gibvel'), { min: 0, max: 2 }) ?? 0.35;
  // CLUSTERS BY DEFAULT (2026-09-10, owner look pass). `pieces` (gibAllPieces)
  // makes ONE CHUNK PER ADDITIVE PRIM and, by that function's own design, gives
  // each one `bones: []` — a single-prim fragment has no bone that matches it
  // without splitting the bone. So the default shipped as: 19-20 small blobs,
  // no bones, and a 20-deep bake queue. The owner's read was exactly that —
  // "when a zombie SDF body gibs it turns into like weird lil balls but it
  // should keep the body part shapes... another thing is there are no bones".
  //
  // `clusters` (gibAll) is one chunk per LIMB, carrying that cluster's live BONE
  // prims: arm, forearm, thigh, shin, head, torso — body-part shapes, with
  // skeletons, at ~6 views instead of 20. It is both the better look and the
  // cheaper one, which is rare enough to take. `?gib=pieces` keeps the fine
  // confetti for comparison; the real answer for "lots of small chunks WITH
  // shape and bones" is pre-baked part meshes (see the dev-note).
  //
  // `parts` IS THE DEFAULT SINCE 2026-09-11 (gib-parts.ts). BOTH modes above
  // were rejected by the owner in one review — "it just breaks into like tubes
  // (arms and legs) and orbs (torso) which doesnt really read as gibs" plus "i
  // still dont see anything bone related like idk rib cage or something" — and
  // the two modes ARE those two complaints: clusters is one tube per limb and
  // one orb per torso; pieces is bone-free confetti. `parts` splits the torso
  // three ways, every limb at its joint, and releases the authored skeleton as
  // its own bone-only chunks. The old modes stay as A/B controls in the knobs
  // (`?gib=clusters` is the cheap one, for a cost comparison).
  const gibParam = DYN_PARAMS.get('gib');
  let gibMode: 'pieces' | 'clusters' | 'parts' =
    gibParam === 'pieces' || gibParam === 'clusters' ? gibParam : 'parts';
  /**
   * HOW A PIECE IS DRAWN — `?gibrender=sprite` swaps the marched SDF piece for a
   * billboard cut from our own rendered zombie (`public/assets/lab/gore/`).
   *
   * ORTHOGONAL TO `?gib=` ON PURPOSE, and that is the whole design: `gibMode`
   * chooses the piece SET (which chunks leave the body, from which module), and
   * this chooses what each chunk looks like on screen. The two never have to
   * agree, so every piece set stays available to compare against the sprites and
   * the blast's shape logic is untouched — a sprite piece is the SAME `Chunk`
   * state, stepped by the SAME `stepChunk`, with the same stagger, the same
   * settle rule and the same impulse release.
   *
   * DEFAULT IS `march`: this ships OPT-IN. Nothing about the shipped look
   * changes until the owner has seen the paired numbers and said so.
   */
  // `?gibrender=carve` is the third mode: pieces are REAL MESHES carved from the
  // archetype's own body, cut on a nearest-bone-group Voronoi so the boundaries
  // land at joints (see webgpu/gib-carve.ts) — not marched SDF and not
  // billboards. NB the bones are NOT in that field: `sdBody` skips op 'bone'
  // outright, so the skeleton shows on a cut as MATERIAL (goreKind), not as
  // silhouette. An earlier version of this comment claimed otherwise.
  const gibRenderParam = DYN_PARAMS.get('gibrender');
  let gibRenderMode: 'march' | 'sprite' | 'carve' | 'assets' =
    gibRenderParam === 'sprite' ? 'sprite'
      : gibRenderParam === 'carve' ? 'carve'
        : gibRenderParam === 'assets' ? 'assets' : 'march';
  /** Slabs per cluster for the carved library — the GRANULARITY dial. */
  // 1 SINCE THE ANATOMICAL PARTITION (2026-09-11): `cells` used to mean slabs per
  // CLUSTER, where 3 was the owner's "more granular" ask; it now means
  // SUBDIVISIONS OF AN ANATOMICAL PART, and 1 is one piece per bone group — a
  // forearm, a shin, a skull. Leaving it at 3 cut every part into three again and
  // put back exactly the abstraction the partition was written to remove
  // ("they read a little too abstract ... should at least somewhat resemble
  // pieces from the character"). `?gibcarvecells=2+` trades it back for gore.
  const gibCarveCells = parseIntParam(DYN_PARAMS.get('gibcarvecells'), { min: 1, max: 8 }) ?? 1;
  const gibCarveCellSize = parseFloatParam(DYN_PARAMS.get('gibcarvecell'), { min: 0.005, max: 0.05 }) ?? 0.01;
  /**
   * WHY A SETTLED PIECE NEEDS MORE MICRO-DETAIL THAN THE BODY IT CAME OFF.
   *
   * The creature's authored `surfaceNoiseAmp` is 0.06, and on a MARCHED body
   * that is enough: the march perturbs a per-pixel analytic normal taken from
   * the SDF gradient, and it has silhouette noise on top. A baked chunk has
   * neither — its normal is an interpolated vertex normal across a 1 cm mesh,
   * already smooth — so the identical amplitude reads as nothing at all.
   *
   * Measured on a FROZEN scene, one settled piece, same camera, same pixels:
   * at 0 and at 0.06 the piece is a clean even gradient; at 0.9 it is visibly
   * grainy; 0.35 is textured without reading as noise. 6x takes the authored
   * 0.06 to 0.36, which lands in that band and keeps the value TRACKING the
   * creature rather than replacing it — move the wound panel's slider and a
   * settled piece still follows.
   */
  const CHUNK_DETAIL_GAIN = 6;
  /** Domain scale for the settled piece's detail noise — the march uses 22 and
   *  that is WRONG HERE. `fbm` sums octaves at 4x and 9x, so 22 lands them at
   *  1.1 cm and 5 mm; the bake's cells are 1 cm, so the fine octave is sub-facet
   *  and aliases into speckle ("little dots ... like glitter"). At 7 the octaves
   *  are 3.6 cm and 1.6 cm — the finest is still ~1.6 cells, which is the
   *  smallest a vertex-normal mesh can carry without sparkling. */
  const CHUNK_DETAIL_FREQ = 7;
  /** How hard the same field pushes the ALBEDO, +/- this fraction. Normal
   *  perturbation alone reads as low contrast on a mesh; the living skin's
   *  contrast is mostly colour. */
  const CHUNK_DETAIL_ALBEDO = 0.28;
  /** Override for the settled piece's micro-detail amplitude; null = follow the
   *  live creature's `surfCfg2.y` through CHUNK_DETAIL_GAIN. See the per-frame
   *  push and `setChunkDetail`. */
  let chunkDetailOverride: number | null =
    parseFloatParam(DYN_PARAMS.get('chunkdetail'), { min: 0, max: 1 }) ?? null;
  /** Live twins of CHUNK_DETAIL_FREQ / CHUNK_DETAIL_ALBEDO. Both are LOOK
   *  judgements — how coarse the grain should be, and how much of the contrast
   *  should be colour rather than relief — so both sweep without a reload. */
  let chunkDetailFreq = parseFloatParam(DYN_PARAMS.get('chunkdetailfreq'), { min: 0.5, max: 64 })
    ?? CHUNK_DETAIL_FREQ;
  let chunkDetailAlbedo = parseFloatParam(DYN_PARAMS.get('chunkdetailalbedo'), { min: 0, max: 1.5 })
    ?? CHUNK_DETAIL_ALBEDO;
  const gibSpriteLiveCap = parseIntParam(DYN_PARAMS.get('gibspritelive'), { min: 1, max: 512 })
    ?? GIB_SPRITE_TUNING.liveCap;
  const gibSpriteRestCap = parseIntParam(DYN_PARAMS.get('gibspriterest'), { min: 0, max: 512 })
    ?? GIB_SPRITE_TUNING.restCap;
  const gibSpriteSizeScale = parseFloatParam(DYN_PARAMS.get('gibspritesize'), { min: 0.2, max: 3 })
    ?? GIB_SPRITE_TUNING.sizeScale;

  /**
   * THE POOL A BLAST ALLOCATES FROM, per render mode.
   *
   * The marched path's budget is the view pool's free slots PLUS whatever older
   * gore can be recycled — see the long note at its call site. The sprite path
   * has no view pool to divide: a quad has no proxy box and no bake, so the only
   * thing left worth bounding is the COUNT, and the count is its own cap. Note
   * what this means for the owner's "tubes and orbs" report: a body only ever
   * degraded because the marched pool could not afford its full set, so in
   * sprite mode the ladder below has nothing to react to and never fires.
   * RESTING pieces do not count against it either — they have already left the
   * live list (`stepSpritePieces` parks them), so a pile of old gore on the
   * floor never eats a new blast's budget.
   */
  const gibBudget = () => (gibRenderMode !== 'march'
    ? gibSpriteLiveCap
    : Math.max(1, liveChunks.length + Math.max(0, maxChunks - chunkViews.length) - gibReserved()));

  /**
   * SLOTS A PENDING RUPTURE IS HOLDING (body-to-gib task 3). The tier is chosen
   * when the body is SCHEDULED, and `gibActor` is locked to that plan at
   * release, so the views it will need must not be spent by a later blast in
   * the meantime. Counting them out of `gibBudget()` makes a second blast (or
   * an immediate `gibtear=0` gib) budget around them, which is what keeps the
   * preview and the release the same shape without raising any cap. The slot is
   * freed when the body is spliced out of `pendingGibs` at release.
   */
  const gibReserved = () => {
    let n = 0;
    for (const q of pendingGibs) n += q.reserve;
    return n;
  };

  /** What one body may take this blast. Identical in both modes EXCEPT that the
   *  sprite path reserves no tier floor: the floor exists to guarantee every
   *  body in a blast can afford the cheapest SHAPE, and sprite mode has no
   *  shapes to choose between.
   *
   *  CLAMPED TO `remaining` (2026-09-16 task 2, adversarial caps). The floor is
   *  the cheapest shape's slot count, but it is a RESERVATION, not extra
   *  capacity: at `?maxchunks=5` the old `max(floor, remaining - reserve)`
   *  handed a body 7 slots from a 5-slot pool, so the recycler overwrote two of
   *  its own pieces inside the same call — the "pieces jumping into positions"
   *  defect the budget exists to prevent. A body can now never be allowed more
   *  than the pool actually holds. */
  const gibAllowance = (remaining: number, condemnedLeft: number) => (gibRenderMode !== 'march'
    ? Math.max(1, remaining)
    : Math.max(1, Math.min(remaining,
      Math.max(GIB_TIER_FLOOR, remaining - GIB_TIER_FLOOR * Math.max(0, condemnedLeft - 1)))));

  /** And what that body actually spent. The marched path debits at least a
   *  floor's worth whatever it made, because the floor's slots are reserved for
   *  it either way; sprite mode debits exactly what it made. */
  const gibDebit = (remaining: number, made: number) => (gibRenderMode !== 'march'
    ? Math.max(0, remaining - made)
    : Math.max(0, remaining - Math.max(made, GIB_TIER_FLOOR)));
  // WHICH BONE GROUPS A BLAST RELEASES. `all` is the eleven rigid groups
  // (skull, cage, pelvis, eight long bones); `core` is the three torso masses
  // plus the skull — the A/B for what the skeleton costs; `off` is the
  // flesh-only control. `bone.cage` alone is 31 bone prims in ONE chunk, so
  // this is the first knob to reach for if a blast's cost spikes.
  const gibBonesParam = DYN_PARAMS.get('gibbones');
  // CORE BY DEFAULT (2026-09-15, owner's call). `all` releases the eleven rigid
  // groups; `core` is the three torso masses plus the skull. Bones are the
  // expensive half of a gib and they NEVER BAKE — a bone piece is a marched
  // chunk for as long as it exists, while flesh retires to a static mesh a
  // second or two after it lands — so the eight long bones are eight permanent
  // marched chunks holding view slots the flesh could have used. `?gibbones=all`
  // restores the full skeleton; `off` is the flesh-only control.
  let gibBones: GibBoneRelease =
    gibBonesParam === 'off' ? 'off' : gibBonesParam === 'all' ? 'all' : 'core';
  // THE STAGED RELEASE (dev-note §3a/b). Every piece spawns AT ITS CURRENT
  // POSED TRANSFORM WITH ZERO VELOCITY, so the frame the blast lands shows the
  // BODY's silhouette in place instead of a substitution, and the pieces then
  // go over this many frames, NEAREST THE BLAST FIRST — which is what reads as
  // the blast ripping outward through the body rather than a swap. 1 disables
  // the stagger (everything leaves on the blast frame) and is the A/B control.
  let gibStaggerFrames = parseIntParam(DYN_PARAMS.get('gibstagger'), { min: 1, max: 8 }) ?? 3;
  /**
   * GIB LAUNCH DISTRIBUTION (2026-09-16 task 3). Default `notblood` is the
   * source-derived independent spread + one shared body shove (gib-launch.ts).
   * `?giblaunch=radial` restores the OLD per-piece `concussionVelocity(at,
   * g.origin, ...)` — a labelled A/B CONTROL for normal-speed review, not a
   * supported gameplay mode. It exists because the owner's report ("pieces
   * cluster too much") can only be judged against the thing that clustered.
   */
  const gibLaunchMode = DYN_PARAMS.get('giblaunch') === 'radial' ? 'radial' : 'notblood';
  // DOES A BODY THIS BLAST IS ABOUT TO GIB GET THE 16 WOUNDS STAMPED ON IT?
  //
  // No. The gibbed branch below takes `gibActor` and `continue`s, so those
  // wounds are stamped, carried through the meter arithmetic and never read —
  // and measured in the arena the wound phase is the blast's dominant cost
  // (18.1 of a 22.0 ms resolve with 5 bodies in range). `?gibwounds=1`
  // restores the old behaviour as the A/B; `setGibWounds` is the live seam so
  // the two arms can be alternated INSIDE ONE BOOT, which is the only way an
  // A/B on this machine is a measurement at all.
  let gibWounds = DYN_PARAMS.get('gibwounds') === '1';
  // The carve probe's cap, the OTHER half of the wound cost: `?carvecap=0`
  // restores the uncapped march. Separate from `?woundcap` (the rim probe's)
  // because the two probes have different consumers — the rim's is thresholded
  // and was capped in the first pass, the carve's feeds a continuous depth and
  // is capped at the point where the shader's slab stops binding.
  setCarveProbeCapEnabled(DYN_PARAMS.get('carvecap') !== '0');
  // THE RUPTURE WINDOW (gib-tear.ts): seconds the body's planned regions take
  // to pull apart before they become chunks. 0 restores the old behaviour — the
  // body is swapped for debris in the very frame the bundle goes off — and is
  // the A/B for whether the window reads. Contract range 0.15–0.25 s; 0.2 is
  // the agreed start.
  let gibTearSec = parseFloatParam(DYN_PARAMS.get('gibtear'), { min: 0, max: 0.4 }) ?? 0.2;
  /**
   * NON-RIGID SLOUGH multiplier (`?tearslough=`, 0..3, default 1). The rupture
   * deforms flesh endpoints rather than sliding rigid regions; this scales the
   * outward/downward pull and the within-prim stretch together. `?tearslough=0`
   * is the honest A/B control: the old rigid-region motion with the head
   * attachment intact. There is no way to restore the rejected 0.3 m cranial
   * chest peel — that code path is gone.
   */
  const sloughScale = parseFloatParam(DYN_PARAMS.get('tearslough'), { min: 0, max: 3 }) ?? 1;
  /** The rupture window's SHAPE, page-level so the panel owns it and every
   *  actor is pushed the same values (ZombieActor keeps its own copy, which is
   *  what makes a capture reproducible per body). `amplitudeM`/`jiggleAmp` are
   *  the panel knobs; the rest are the coherent defaults for a body that
   *  separates into real regions (see gib-tear.ts's TearTuning). */
  const tearShape = {
    amplitudeM: 0.045, jiggleAmp: 0.35, seamM: 0.09, boneLag: 0.15, headDamp: 0.3,
    sloughOutM: TEAR_TUNING.sloughOutM * sloughScale,
    sloughSagM: TEAR_TUNING.sloughSagM * sloughScale,
    sloughStretchM: TEAR_TUNING.sloughStretchM * sloughScale,
    // HEAD ATTACHMENT / ROOT RECOIL (2026-09-16 playtest follow-up task 4). The
    // defaults come from TEAR_TUNING so the page and the module cannot drift;
    // `?tearhead=0&tearneck=0&tearrecoil=0` restores the OLD independent-damped
    // head + no whole-body jolt, which is the honest A/B control for whether the
    // attachment actually removes the chest-overtakes-head read.
    headFollow: parseFloatParam(DYN_PARAMS.get('tearhead'), { min: 0, max: 1 }) ?? TEAR_TUNING.headFollow,
    neckGapM: parseFloatParam(DYN_PARAMS.get('tearneck'), { min: 0, max: 0.2 }) ?? TEAR_TUNING.neckGapM,
    recoilM: parseFloatParam(DYN_PARAMS.get('tearrecoil'), { min: 0, max: 0.2 }) ?? TEAR_TUNING.recoilM,
  };
  // ——— BLAST REFRACTION (EXPERIMENT, default OFF) ———————————————————————————
  // The owner asked for a shockwave/distortion read on the blast. This is the
  // bounded screen-space experiment (post-aa.ts's postAaBlastWarp): `?blastdistort=1`
  // turns it on, `?bdstrength=` scales it, and at the same seed/pose/frame an
  // on/off pair is an honest A/B. It is NOT accepted until a normal-speed review
  // says it improves the read; default OFF keeps the shipped frame untouched.
  let blastDistortStrength = parseFloatParam(DYN_PARAMS.get('bdstrength'), { min: 0, max: 4 }) ?? 1;
  postAa.setBlastDistort(
    DYN_PARAMS.get('blastdistort') === '1' || DYN_PARAMS.get('blastdistort') === 'on');
  postAa.setBlastDistortStrength(blastDistortStrength);
  /** The cheapest tier's piece count — one chunk per limb cluster, i.e. the
   *  shape a body falls back to when the pool cannot afford anything better.
   *  Held back for every body still to come in a blast, so no body is left with
   *  less than this and none of them simply disappears. */
  // 7, ONE CHUNK PER LIMB PLUS THE RIBCAGE — see the ladder's `clusters+cage`
  // rung. Not 6: a reserve of 6 lets a crowded blast spend every body's slots on
  // the shape whose bones are BURIED, and measured in the arena a point-blank
  // bundle gibs five bodies, so that is not an edge case — it is what the owner
  // sees in the room he tests in. Measured after the change, below.
  const GIB_TIER_FLOOR = 7;
  const dynSpeedScale = parseFloatParam(DYN_PARAMS.get('dynspeed'), { min: 0.1, max: 4 }) ?? 1;
  // ——— EXPLOSION SIZE (owner feedback, 2026-09-10) ————————————————————————
  // "the explosion makes it impossible to see the gibs... its not really what im
  // going for - the current one is kinda like a big round fireball but in the
  // original its more like a little mushroom cloud". The gib is the thing being
  // tuned, so the blast must not stand in front of it.
  //
  // `resolveExplosion` sizes the burst from the GAMEPLAY radius: radiusM 4.69 m
  // x EXPLOSION_VFX_HEIGHT_SCALE 0.42 = a 1.97 m half-height, i.e. a ~4 m tall
  // burst in an 8 x 8 m room. Every layer scales off that half-height (the fire
  // billboards, the smoke that rises 2.2x it, the ring), so ONE multiplier on
  // the visual is the whole fix — and it stays decoupled from the AOE, which is
  // what EXPLOSION_VFX_HEIGHT_SCALE's own comment says the visual is for.
  let fxSize = parseFloatParam(DYN_PARAMS.get('fxsize'), { min: 0.1, max: 2 }) ?? 0.42;
  // ——— THE BLAST'S FOCUS (owner, 2026-09-11): "it seems the effective radius of
  // the explosion is quite large … the area of effect should be abit more
  // focused". Both default to the reference behaviour, so nothing about the
  // shipped blast moves; they are the panel's two blast sliders.
  let aoeRadiusScale = parseFloatParam(DYN_PARAMS.get('aoesize'), { min: 0.3, max: 1.5 }) ?? 1;
  // 0.45 is EXPLOSION_LAUNCH.falloffFloor — the resolver's default, kept here so
  // the panel's read-back shows the value the blast actually uses.
  let aoeLaunchFloor = parseFloatParam(DYN_PARAMS.get('edgekick'), { min: 0, max: 1 }) ?? 0.45;
  const fxSmoke = parseFloatParam(DYN_PARAMS.get('fxsmoke'), { min: 0, max: 2 }) ?? 0.38;
  const fxLife = parseFloatParam(DYN_PARAMS.get('fxlife'), { min: 0.3, max: 3 }) ?? 1.15;
  const fxGain = parseFloatParam(DYN_PARAMS.get('fxgain'), { min: 0, max: 4 }) ?? 1.25;
  // THE PLUME A/B. 1 (default) is the mushroom — the neck converges, the cap
  // rolls outward and flattens, the smoke spawns on a rim. 0 is the round
  // fireball this effect was before, blended term by term so ONE boot can A/B
  // the two on the same burst. Kept off the four size/colour knobs because it
  // is a SHAPE switch, and because `?explosionfx=atlas` is the reference the
  // shape is judged against: run 0, run 1, run atlas, in that order.
  const fxPlume = parseFloatParam(DYN_PARAMS.get('fxplume'), { min: 0, max: 1 }) ?? 1;
  // DEFERRED MODE: the shared chunk material carries the surface mode for
  // every detached chunk (one graph per output mode — the task-2 contract);
  // the legacy prev source is only bound in legacy mode.
  const chunkMaterial = createSharedChunkGpuMaterial(
    deferredMode ? undefined : sdfLayer.prev,
    deferredMode
      ? { output: 'surface', shadowReceiver: 'level-only', maxChunks: MAX_CHUNK_BUDGET }
      : { maxChunks: MAX_CHUNK_BUDGET },
  );
  const chunkViews: ChunkGpuView[] = [];
  const spareChunkViews: ChunkGpuView[] = [];
  const liveChunks: {
    id: number; state: ReturnType<typeof makeChunk>; view: ChunkGpuView; template: ChunkTemplate;
    /** WHAT THIS PIECE IS, as it was SPAWNED. The render state it implies can be
     *  read back off the view's uniforms (a bone piece is the pale one, a
     *  bone-only piece is the one with no flesh), but "kind 'bone'" and "kind
     *  'limb' with no prims" (an ORGAN piece) are indistinguishable from those
     *  uniforms alone — both pack rows and neither is meat. The bone census
     *  needs the spawn's own word. */
    kind: 'limb' | 'gob' | 'bone';
    boneOnly: boolean;
  }[] = [];
  // The bake STATE (seam, bakedChunks, material) is declared near the boot's
  // light-seed block; here live only the bake/gib/free functions.
  /** Free a baked piece's mesh and return its view to the ring. The view is
   *  NOT disposed — the ring recycles it in place via reset(), exactly as
   *  it always has (the leak gate counts these: bounded by `maxChunks`). */
  function freeBaked(b: BakedChunk): ChunkGpuView {
    const i = bakedChunks.indexOf(b);
    if (i >= 0) bakedChunks.splice(i, 1);
    scene.remove(b.mesh);
    deferredApi?.router.unregister(b.mesh);
    b.mesh.geometry.dispose();
    if (b.faceMaterial) {
      const mi = litChunkMaterials.indexOf(b.faceMaterial);
      if (mi >= 0) litChunkMaterials.splice(mi, 1);
      b.faceMaterial.dispose(); // borrowed actor atlas is not disposed
    }
    return b.view;
  }
  const chunkBakeJobs = createChunkBakeJobs(() => new Worker(
    new URL('./chunk-bake.worker.ts', import.meta.url), { type: 'module' },
  ));
  // Completed corpses arrive asynchronously. A persistent registered parent
  // gives every replacement mesh the same route and removes it automatically
  // from the router when damage restores the live SDF body.
  const soldierCorpseGroup = new THREE.Group();
  soldierCorpseGroup.name = 'soldier-corpses';
  scene.add(soldierCorpseGroup);
  deferredApi?.router.register(soldierCorpseGroup, 'mesh', 'level-only');
  soldierCorpses = createSoldierCorpseBakes(soldierCorpseGroup, () => {
    if (!bakedChunkMat) {
      // Whichever finishes first (corpse or detached chunk) must seed the
      // same mode-aware shared material.
      bakedChunkMat = registerLitChunkMaterial(createBakedChunkMaterial(
        deferredMode
          ? { output: 'surface', shadowReceiver: 'level-only', bakedAo: true }
          : { bakedAo: true, fleshResponse: true },
      ));
      bakedChunkSeed?.(bakedChunkMat);
    }
    return bakedChunkMat.material;
  });
  const disposeCorpses = () => soldierCorpses?.dispose();
  window.addEventListener('pagehide', disposeCorpses);
  import.meta.hot?.dispose(() => { disposeCorpses(); window.removeEventListener('pagehide',disposeCorpses); });
  // ——— THE GORE-PART SHOWCASE ————————————————————————————————————————————
  //
  // The owner asked for gibs to become "chunky meaty textured and blood stained
  // mesh parts" (see docs/dev-notes/2026-09-11-gibs-as-classic-gore-parts), and
  // whether they READ that way is his judgement, not a measurement. So the parts
  // get a bench he can walk up to before any of it is wired into a blast — the
  // same courtesy `?explosionfx` gave the burst. `?goreparts=1` lays a grid of
  // them out in front of the spawn; `__sdfGame.goreShowcase()` re-lays it
  // wherever he is standing.
  //
  // It renders through the EXISTING mesh gore path — one shared
  // `createBakedChunkMaterial`, the same `bakeColor` attribute, the same
  // router registration — so what he looks at is what a gib will render, with no
  // second material to drift.
  let goreShowcase: THREE.Group | null = null;
  let gorePartMat: BakedChunkMaterial | null = null;
  /** (detailAmp, bumpAmp, bloodAmp, noiseScale) for the parts' procedural detail
   *  layer. Live: `__sdfGame.goreDetail({detail, bump, blood, noise})` rewrites it
   *  so the layer can be A/B'd in one boot rather than argued about across two.
   *
   *  THE FOURTH TERM IS THE ONE THAT MATTERED. The owner's report — "when i saw the
   *  mesh they had no texture no nothing just albedo" — was measured to be the noise
   *  DOMAIN, not the amplitudes: these parts are built at final size (0.075-0.115 m)
   *  with no mesh scale, and the bump's frequencies are 6-43 per unit, so an entire
   *  part spanned LESS THAN ONE NOISE CYCLE. The bump was a smooth ramp, and the
   *  measurement said so outright: mean |difference to the neighbouring pixel|
   *  17.095 with the layer on vs 17.083 with it off, a ratio of 1.001. Scaling the
   *  domain is what produces actual per-pixel relief. */
  const gorePartDetail = new THREE.Vector4(1, 1.6, 0.9, 12);
  /** `look` for the gore materials — the bakedChunkUniforms default until
   *  `__sdfGame.goreLook()` moves it. See that API for why it is tunable. */
  const goreLookCfg = new THREE.Vector4(0.65, 0.5, 1.2, 0.6);
  /** (burnAmp, wetGain, bloodDark, stainScale) — the STAIN half. Defaults chosen
   *  from the owner's verdict that the blood was too pale and too dry to read as
   *  blood and that there were no burn stains at all: near-black venous blood
   *  (bloodDark 0.85), driven hard into the highlight so it out-speculars the
   *  flesh (wetGain 1.0), a full char field (burnAmp 1.0), and stains at a much
   *  broader DOMAIN than the bump (stainScale 2.5) so they read as patches rather
   *  than speckle. */
  const gorePartStain = new THREE.Vector4(1, 1, 0.85, 2.5);
  function spawnGoreShowcase(): number {
    const look = ((): ChunkLook | null => {
      // The palette comes from a live actor's own view uniforms, so the parts
      // are painted with the same flesh the bodies in this level use.
      const a = actors[0];
      if (!a) return null;
      const u = a.view.uniforms;
      const col = (v: { r: number; g: number; b: number }): Vec3 => [v.r, v.g, v.b];
      return {
        baseColor: col(u.baseColor.value), deepColor: col(u.deepColor.value),
        fatColor: col(u.fatColor.value), mottleColor: col(u.mottleColor.value),
        organColor: col(u.organColor.value), visceraColor: col(u.visceraColor.value),
        woundDepthAmp: u.surfCfg3.value.x, fatDepth: u.surfCfg3.value.y,
        muscleDepth: u.surfCfg3.value.z, visceraAmp: u.surfCfg3.value.w,
        visceraDepth: u.visceraDepth.value, mottleAmp: u.surfCfg2.value.z,
        mottleScale: u.surfCfg2.value.w, organAmp: u.organAmp.value, goreStrength: 1,
      };
    })();
    if (!look) return 0;
    if (!goreShowcase) {
      goreShowcase = new THREE.Group();
      goreShowcase.name = 'gore-showcase';
      scene.add(goreShowcase);
      deferredApi?.router.register(goreShowcase, 'mesh', 'level-only');
    }
    for (const child of [...goreShowcase.children]) {
      goreShowcase.remove(child);
      const m = child as THREE.Mesh;
      m.geometry?.dispose();
    }
    // ITS OWN material instance WITH the procedural detail layer on: bump, blood
    // decals and organ gloss are opt-in per instance (`goreCfg.x`), so the baked
    // chunks keep exactly the shading they had while the parts get the per-pixel
    // detail the owner asked for ("no bumps or normal maps no stains no blood
    // decals"). Assigning it to `bakedChunkMat` instead would silently restyle
    // every settled piece at the same time, which is a decision to take on its
    // own evidence.
    if (!gorePartMat) {
      gorePartMat = registerLitChunkMaterial(createBakedChunkMaterial({ goreDetail: true }));
      gorePartMat.uniforms.goreCfg.value.set(
        gorePartDetail.x, gorePartDetail.y, gorePartDetail.z, gorePartDetail.w,
      );
      gorePartMat.uniforms.goreCfg2.value.set(
        gorePartStain.x, gorePartStain.y, gorePartStain.z, gorePartStain.w,
      );
    }
    const mat = gorePartMat;
    // A grid 2.4 m ahead, 0.42 m apart, at chest height, so a full set fills the
    // view without needing to walk around it.
    const fwd: Vec3 = [Math.sin(player.yaw), 0, -Math.cos(player.yaw)];
    const right: Vec3 = [Math.cos(player.yaw), 0, Math.sin(player.yaw)];
    const rows: { geo: ReturnType<typeof meatPartGeometry>; bone: boolean }[] = [];
    let seed = 1;
    for (const v of MEAT_VARIANTS) {
      for (const size of [0.075, 0.115]) {
        rows.push({ geo: meatPartGeometry(v, size, seed++, look), bone: false });
      }
    }
    for (const v of BONE_VARIANTS) {
      rows.push({ geo: bonePartGeometry(v, 0.075, seed++, look), bone: true });
      rows.push({ geo: bonePartGeometry(v, 0.115, seed++, look), bone: true });
    }
    const perRow = 6;
    rows.forEach((row, i) => {
      const col = i % perRow, line = Math.floor(i / perRow);
      const along = 1.6 + line * 0.55;
      const across = (col - (perRow - 1) / 2) * 0.34;
      const mesh = new THREE.Mesh(row.geo.geometry, mat.material);
      mesh.position.set(
        player.pos[0] + fwd[0] * along + right[0] * across,
        0.42 + (row.bone ? 0.05 : 0),
        player.pos[2] + fwd[2] * along + right[2] * across,
      );
      // A deterministic tumble per slot, so every face of every part is visible
      // from one spot instead of all of them axis-aligned.
      mesh.rotation.set((i * 0.7) % Math.PI, (i * 1.31) % (Math.PI * 2), (i * 0.43) % Math.PI);
      mesh.frustumCulled = true;
      goreShowcase!.add(mesh);
    });
    return rows.length;
  }
  const goreShowcaseOn = bootSearch.get('goreparts') === '1';

  // ——— THE SPRITE BENCH ————————————————————————————————————————————————
  //
  // The same bench, rendered the way the REFERENCE game does it: billboarded
  // cut-out sprites instead of 3D parts. The owner asked for exactly this
  // ("generate spritesheets ... cut those up randomly and use them in the gibs
  // ... sure you trade 3d but its not important in this case"), and the point of
  // this mode is to answer ONE question — does a billboard read as gore in this
  // room? — before any generation work is spent.
  //
  // The atlas here is the DEV-ONLY Blood extract (public/assets/gibs-placeholder,
  // gitignored: never commit, never ship). A generated sheet replaces it.
  let gibAtlas: GibSpriteAtlas | null = null;
  let spriteBenchGroup: THREE.Group | null = null;
  const spriteBenchSprites: THREE.Mesh[] = [];
  const GIB_ATLAS_URL = '/assets/gibs-placeholder/manifest.json';
  /** The GENERATED sheet: own render, own resolution, committable. */
  const GIB_SHEET_URL = '/assets/lab/gore/manifest.json';
  /** Which atlas the bench is showing. `sheet` is the one that ships. */
  let gibAtlasSource: 'placeholder' | 'sheet' = 'placeholder';

  // THE BLAST'S OWN SPRITES. One set for the whole page, in its own group so a
  // sprite piece is separable from the marched views in the scene graph, in the
  // deferred router, and in a capture. Empty and unused until
  // `?gibrender=sprite` puts something in it — the shipped path never touches it.
  const spritePieces: SpritePieceSet = makeSpritePieceSet();
  scene.add(spritePieces.group);
  deferredApi?.router.register(spritePieces.group, 'mesh', 'level-only');
  /** One warning, not one per body per blast. See `gibActor`'s fallback. */
  let gibSpriteAtlasWarned = false;
  /** Keeps sprite trail-emitter ids out of the chunk ids' range — `emitTrails`
   *  keys its per-emitter clock by id and the two sequences both start at 1. */
  const SPRITE_TRAIL_ID_BASE = 0x4000_0000;

  /**
   * THE CARVED GIB LIBRARY — one per archetype, built on FIRST USE and reused by
   * every zombie for the rest of the session (the owner's own design: "all
   * zombies use the same gib library").
   *
   * Built from the COMPILED archetype, not the TS fallback: `makeZombie()` carries
   * no authored bones, so a library built from it would have no skeleton in it —
   * and the skeleton is the thing the carve exists to put back.
   *
   * The palette is read off a live actor's view uniforms so the pieces match the
   * bodies in THIS level, and a shared material is used for every piece: the
   * carved meshes carry a baked albedo + wound mask per vertex, and the
   * `goreDetail` layer supplies the per-pixel bump and blood on top, exactly as
   * the gore-parts bench does.
   */
  let carvedLibrary: CarvedLibrary | null = null;
  let carvedMaterial: BakedChunkMaterial | null = null;
  let carvedBuildMs = 0;
  let carvedWarned = false;

  function ensureCarvedLibrary(): boolean {
    if (carvedLibrary && carvedMaterial) return true;
    if (carvedLibrary) return true;
    const a = actors[0];
    if (!a) return false;
    try {
      const look: ChunkLook = (() => {
        const u = a.view.uniforms;
        const col = (v: { r: number; g: number; b: number }): Vec3 => [v.r, v.g, v.b];
        return {
          baseColor: col(u.baseColor.value), deepColor: col(u.deepColor.value),
          fatColor: col(u.fatColor.value), mottleColor: col(u.mottleColor.value),
          organColor: col(u.organColor.value), visceraColor: col(u.visceraColor.value),
          woundDepthAmp: u.surfCfg3.value.x, fatDepth: u.surfCfg3.value.y,
          muscleDepth: u.surfCfg3.value.z, visceraAmp: u.surfCfg3.value.w,
          visceraDepth: u.visceraDepth.value, mottleAmp: u.surfCfg2.value.z,
          mottleScale: u.surfCfg2.value.w, organAmp: u.organAmp.value, goreStrength: 1,
        };
      })();
      const t0 = performance.now();
      const body = buildBody(compileBlob(parseBlob(zombieBlobSrc)), DEFAULT_BUILD_OPTS, {});
      carvedLibrary = carveBodyIntoPieces({
        archetype: 'zombie', body, look,
        cells: gibCarveCells, cellSize: gibCarveCellSize,
      });
      carvedBuildMs = performance.now() - t0;
      if (!carvedMaterial) {
        carvedMaterial = registerLitChunkMaterial(createBakedChunkMaterial({ goreDetail: true, bakedAo: true }));
        carvedMaterial.uniforms.goreCfg.value.set(
          gorePartDetail.x, gorePartDetail.y, gorePartDetail.z, gorePartDetail.w,
        );
        carvedMaterial.uniforms.goreCfg2.value.set(
          gorePartStain.x, gorePartStain.y, gorePartStain.z, gorePartStain.w,
        );
      }
      console.log(`[gib-carve] zombie library: ${carvedLibrary.pieces.length} pieces, `
        + `${carvedLibrary.totalVerts} verts, ${carvedLibrary.bonePrims} bone prims in the field, `
        + `${carvedBuildMs.toFixed(0)} ms (cells ${gibCarveCells})`);
      return true;
    } catch (err) {
      carvedLibrary = null;
      if (!carvedWarned) {
        carvedWarned = true;
        console.warn(`[gib-carve] library build failed: ${String(err)} — `
          + 'falling back to marched pieces for this session');
      }
      return false;
    }
  }

  /**
   * Spawn one carved mesh piece. The geometry is SHARED from the library and the
   * material is the library's own instance, so a spawn allocates nothing but the
   * Mesh and its `Chunk` state — which is why "bake at spawn" costs nothing once
   * the library exists.
   */
  function spawnCarvedPiece(
    piece: CarvedPiece, origin: Vec3, kind: 'limb' | 'gob' | 'bone',
    impulseVel: Vec3 | null, impulseDelay: number,
  ): boolean {
    if (!ensureCarvedLibrary() || !carvedMaterial) return false;
    const rng = rngStreams.misc;
    const state = makeChunk(
      piece.limb as never, origin, [0, 0, 0], piece.radius,
      piece.longAxis as never, rng, kind,
    );
    spawnSpritePiece(spritePieces, {
      state,
      impulseDelay, impulseVel,
      render: 'mesh', geometry: piece.geometry, material: carvedMaterial.material,
    });
    return true;
  }

  /**
   * THE OFFLINE GIB ASSET RUNTIME (2026-09-16 offline-gib-assets task 2).
   *
   * The committed `public/assets/lab/gibs/*` sets are loaded ONCE per archetype
   * (asynchronously, off the boot path) and their immutable rest geometry and
   * material are shared by every piece. A spawn takes a per-instance geometry
   * from the pool and deforms it to the pose/slough the body is being drawn
   * with, so the first mesh frame is the last SDF frame — no rest-pose snap and
   * no crossfade hiding a shape change.
   *
   * `?gibrender=assets` is the A/B toggle. The SHIPPED default stays `march`
   * until Task 3's visual gate; a body gibbed before the load resolves falls
   * back to marched pieces for that blast, never to no gore.
   */
  let gibAssetMaterial: BakedChunkMaterial | null = null;
  const createGibAssetRuntime = (): GibAssetRuntime => new GibAssetRuntime({
    materialFactory: {
      create: () => {
        // Same procedural detail layer the carve uses, plus the baked flesh
        // response (this set carries `bakeResponse`/`bakeFresnel`/`bakeAnchor`,
        // so the per-pixel detail rides the asset's own rest-frame anchor).
        gibAssetMaterial = registerLitChunkMaterial(createBakedChunkMaterial({
          goreDetail: true, bakedAo: true, fleshResponse: true,
        }));
        gibAssetMaterial.uniforms.goreCfg.value.set(
          gorePartDetail.x, gorePartDetail.y, gorePartDetail.z, gorePartDetail.w,
        );
        gibAssetMaterial.uniforms.goreCfg2.value.set(
          gorePartStain.x, gorePartStain.y, gorePartStain.z, gorePartStain.w,
        );
        bakedChunkSeed?.(gibAssetMaterial);
        return gibAssetMaterial.material;
      },
    },
    onLoad: (lib) => {
      console.log(`[gib-assets] ${lib.archetype}: ${lib.pieces.length} pieces, ${lib.verts} verts, `
        + `${lib.bytes.bin} bin bytes (library build ${lib.builtMs.toFixed(0)} ms)`);
    },
  });
  let gibAssetRuntime = createGibAssetRuntime();

  /** The archetype whose committed set an actor uses. */
  function gibAssetArchetypeOf(a: ZombieActor): string {
    return a.kind === 'soldier' ? 'soldier' : 'zombie';
  }

  /** Kick off (or join) the load for the archetypes the assets path can use. */
  function ensureGibAssets(): Promise<unknown> {
    return Promise.all([
      gibAssetRuntime.ensure('zombie'),
      gibAssetRuntime.ensure('soldier'),
    ]);
  }

  /** True once at least one archetype's committed set is loaded and usable. */
  function gibAssetArmed(): boolean {
    return gibAssetRuntime.archetypeState('zombie') === 'ready'
      || gibAssetRuntime.archetypeState('soldier') === 'ready';
  }

  /**
   * Spawn one offline-asset mesh piece. Returns false (with a counted reason)
   * when the archetype/part is not available or the runtime piece is damaged;
   * the caller then falls back to the marched path for that piece.
   *
   * The `Chunk` state is built with EXACTLY `spawnChunkPiece`/`spawnSpriteGibPiece`
   * arithmetic — same radius, long axis, support spheres and pre-release spin —
   * so an asset gib settles at the same height, bounces off the same walls and
   * topples the same way as the marched one.
   */
  function spawnAssetGibPiece(
    a: ZombieActor,
    g: GibPiece,
    impulseVel: Vec3 | null,
    impulseDelay: number,
  ): boolean {
    const lib = gibAssetRuntime.library(gibAssetArchetypeOf(a));
    if (!lib) { gibAssetRuntime.countFallback('no-library'); return false; }
    const piece = lib.byPart.get(g.part);
    if (!piece) { gibAssetRuntime.countFallback('no-asset'); return false; }
    const ineligible = gibAssetMeshEligible(piece.doc, g);
    if (ineligible) { gibAssetRuntime.countFallback(ineligible); return false; }
    // THE HEAD KEEPS THE MARCHED FACE PATH — `gibAssetMeshEligible`'s
    // `head-face` rule; see its docstring for why the rest face frame is not
    // enough to draw a face on a shared-material mesh.
    //
    // ROW ALIGNMENT IS PART OF ELIGIBILITY. The deform walks the runtime piece's
    // rows (`g.prims` then `g.bones`) against the asset's bind table row for row.
    // `srcPrims`/`srcBones` equality proves the SOURCED rows line up, but not the
    // cut caps: a plan that grew or lost a `sub` cap between the rest bake and
    // this body would silently deform against the wrong frame. Fall back instead.
    if (piece.doc.bind.prims.length !== g.prims.length + g.bones.length) {
      gibAssetRuntime.countFallback('row-mismatch');
      return false;
    }
    const pool = gibAssetRuntime.poolFor(lib);
    if (!pool) { gibAssetRuntime.countFallback('no-pool'); return false; }
    const kind = g.kind ?? 'limb';
    const boneOnly = g.prims.length === 0 && g.bones.length > 0;
    const extentSource = boneOnly ? g.bones : g.prims;
    const support = chunkSupportSpheres(extentSource, g.origin);
    const state = makeChunk(
      g.limb as never, g.origin, [0, 0, 0],
      boneOnly ? boneChunkRadius(g.bones) : chunkExtent(g.prims, g.origin),
      primsLongAxis(extentSource, g.origin),
      rngStreams.misc, kind,
      (g.spinQuat || g.spinAngVel) ? { quat: g.spinQuat, angVel: g.spinAngVel } : undefined,
      support.length > 0 ? support : undefined,
    );
    // THE DEFORMATION SOURCE: THE RUNTIME PIECE'S OWN ROW-ALIGNED FRAMES.
    //
    // On the rupture path `g.prims`/`g.bones` are `retargetGibPieces`' output —
    // each SOURCED row is the body's sloughed twin (so the released mesh is the
    // geometry last drawn, no snap-back) — and `displaceGibPieces` has already
    // added the region offset to every row AND to `g.origin`. So deforming
    // against these rows and subtracting `g.origin` cancels that offset and
    // leaves exactly the chunk-relative shape `spawnChunkPiece` marches.
    //
    // WHY NOT `gibAssetPosedRows` HERE (task 3, measured). That helper maps the
    // bind table's SOURCE INDICES into `frame.deformedPrims`, which is equivalent
    // for sourced rows but has NO TWIN for an unsourced `sub` cut cap: those rows
    // fell back to the REST frame, so their vertices stayed at the REST body
    // position while the region rotated — long spike triangles off every piece.
    // The cap IS present row-aligned in the runtime piece (posed, +offset), so
    // the row-aligned frames deform every row, caps included, with one contract.
    const rows = gibAssetRowsFromPrims([...g.prims, ...g.bones]);
    const inst = pool.acquire(g.part);
    pool.deformRows(inst, rows, g.origin);
    const sprite = spawnSpritePiece(spritePieces, {
      state, render: 'mesh', geometry: inst.geometry, material: lib.material,
      impulseDelay, impulseVel,
    });
    // Return the per-instance buffers to the pool when this piece is retired
    // (evicted over a cap, cleared, or reset) — the pool's whole point.
    sprite.onDetach = () => pool.release(inst);
    sprite.mesh.name = `gib-asset-${g.part}`;
    gibAssetRuntime.countAssetPiece();
    return true;
  }

  /** Lay the sprite bench out in front of the player, sized like real gibs. */
  function laySpriteBench(): number {
    if (!gibAtlas) return 0;
    if (!spriteBenchGroup) {
      spriteBenchGroup = new THREE.Group();
      spriteBenchGroup.name = 'gib-sprite-bench';
      scene.add(spriteBenchGroup);
      deferredApi?.router.register(spriteBenchGroup, 'mesh', 'level-only');
    }
    for (const child of [...spriteBenchGroup.children]) {
      spriteBenchGroup.remove(child);
      const m = child as THREE.Mesh;
      m.geometry?.dispose();
      (m.material as THREE.Material)?.dispose();
    }
    spriteBenchSprites.length = 0;
    const fwd: Vec3 = [Math.sin(player.yaw), 0, -Math.cos(player.yaw)];
    const right: Vec3 = [Math.cos(player.yaw), 0, Math.sin(player.yaw)];
    // EVERY frame once, then the whole set again a size down: a gib has to read
    // at the size it will actually be thrown at, not just at bench scale.
    const sizes = [0.34, 0.2];
    let i = 0;
    for (const size of sizes) {
      for (const frame of gibAtlas.frames) {
        const mesh = makeGibSprite(frame, size);
        const col = i % 9, line = Math.floor(i / 9);
        const along = 1.7 + line * 0.5;
        const across = (col - 4) * 0.38;
        mesh.position.set(
          player.pos[0] + fwd[0] * along + right[0] * across,
          0.45 + (line % 2) * 0.1,
          player.pos[2] + fwd[2] * along + right[2] * across,
        );
        // Face the camera AT SPAWN as well as per frame: `tick` early-returns
        // under the render lock, so a capture would otherwise photograph the
        // bench edge-on — a plane facing +Z photographed from a player looking
        // east is a line.
        billboardGib(mesh, camera);
        spriteBenchGroup.add(mesh);
        spriteBenchSprites.push(mesh);
        i++;
      }
    }
    return spriteBenchSprites.length;
  }

  /** Load the dev-only atlas on demand. A missing one is reported, not hidden:
   *  the bench is meaningless without it and a silent empty group reads as a bug
   *  in the renderer. */
  async function ensureGibAtlas(which: 'placeholder' | 'sheet' = gibAtlasSource): Promise<number> {
    if (gibAtlas && gibAtlasSource === which) return gibAtlas.frames.length;
    gibAtlas?.dispose();
    gibAtlas = null;
    gibAtlasSource = which;
    const url = which === 'sheet' ? GIB_SHEET_URL : GIB_ATLAS_URL;
    try {
      gibAtlas = which === 'sheet' ? await loadGibSheet(url) : await loadGibSpriteAtlas(url);
      console.log(`[gib-sprites] ${which} atlas: ${gibAtlas.frames.length} frames from ${url}`);
    } catch (err) {
      console.warn(`[gib-sprites] no ${which} atlas at ${url}`
        + (which === 'placeholder'
          ? ' — run scripts/link-dev-assets.sh (the Blood extracts are dev-only placeholders)'
          : ' — generate it with: npm run blob:shot -- zombie (BLOB_MASK=1) then node scripts/gib-sheet.mjs')
        + `: ${String(err)}`);
      return 0;
    }
    return gibAtlas.frames.length;
  }

  let chunkBakeInput: ChunkBakeData | null = null;
  let lastBakeSwapMs = 0;
  let lastBakeRequestMs = 0;
  /** The sim frame a bake job was submitted on (finishChunkBake waits for the
   *  next one) and the frame a swap actually landed on (reported). */
  let bakeSubmitFrame = -1;
  let lastBakeSwapFrame = -1;
  const cancelChunkBake = () => {
    if (chunkBakeJobs.pendingId !== null) telemetry.event('chunk-bake-cancel', { chunk: chunkBakeJobs.pendingId });
    chunkBakeJobs.cancel(); chunkBakeInput = null;
  };
  window.addEventListener('pagehide', cancelChunkBake);
  window.addEventListener('pagehide', () => { pendingGibImpulses.length = 0; });
  import.meta.hot?.dispose(() => {
    cancelChunkBake();
    window.removeEventListener('pagehide', cancelChunkBake);
  });

  /** Consume at most one completed mesh in a frame. All extraction, welding,
   * colour and normal work ran in the worker; only wrap buffers and swap here.
   * Recycled IDs are never reused, so an old reply cannot hide a new piece. */
  function finishChunkBake(): void {
    // FRAME PIN (determinism stage 1, 2026-09-14). The worker reply used to be
    // applied on whichever frame it happened to arrive, so a fast worker swapped
    // on the submit frame and a slow one a frame or two later — the swap is a
    // sim-state change (`liveChunks` -> `bakedChunks`) and the census and any
    // downstream pellet-vs-chunk interaction read it. Hold the result until the
    // first frame AFTER the one the job was submitted on, so a replay swaps at
    // the same frame regardless of worker speed. Do NOT call takeCompleted()
    // before this check: consuming here would drop the result and the piece
    // would never bake.
    if (chunkBakeJobs.pendingId !== null && simFrame < bakeSubmitFrame + 1) return;
    const done = chunkBakeJobs.takeCompleted();
    if (!done) return;
    telemetry.event('chunk-bake-complete', { chunk: done.id });
    const data = chunkBakeInput;
    chunkBakeInput = null;
    const index = liveChunks.findIndex(c => c.id === done.id);
    if (!chunkBakeEnabled || index < 0 || !data) return;
    const entry = liveChunks[index]!;
    if (!chunkSettled(entry.state)) return;
    const t0 = performance.now();
    const swapTiming = telemetry.begin();
    const baked = unpackChunkBake(done.result);
    if (!bakedChunkMat) {
      // REGISTERED, like the corpse path's identical construction a few thousand
      // lines up. It was not, and this is the site that WINS in normal play: the
      // corpse bake only runs if a soldier corpse settles first, so in a plain
      // dynamite gib THIS line created the shared baked-chunk material and left
      // it out of `litChunkMaterials`.
      //
      // The registry is not cosmetic. Everything the per-frame block pushes went
      // past this material: the FLASHLIGHT (so a settled piece kept the static
      // defaults — `spotCfg.x = 0`, beam OFF, against a fixed 2.4 directional
      // key, i.e. lit by a lamp that is not there at ~2.5x, which is what blows
      // flesh albedo pale) and, since this session, `fleshDetail`. The registry
      // exists BECAUSE of exactly this class of miss — its own docstring says
      // "the per-frame beam update touched ONLY bakedChunkMat" — and then the
      // settled-chunk path was left out of the fix.
      //
      // Caught by `__sdfGame.chunkDetailApplied()` reading `[]` while the census
      // reported 12 baked pieces on screen.
      bakedChunkMat = registerLitChunkMaterial(createBakedChunkMaterial(
        // DEFERRED MODE: baked chunks are static flesh — level-only receivers
        // with a surface G-buffer producer material.
        // `bakedAo`: the settled bake writes a `bakeAo` attribute now, and
        // without reading it every piece shades at ao = 1.0 and can never be in
        // shadow — half of "way too light and dont follow the lighting".
        deferredMode
          ? { output: 'surface', shadowReceiver: 'level-only', bakedAo: true }
          : { bakedAo: true, fleshResponse: true },
      ));
      bakedChunkSeed?.(bakedChunkMat);
    }
    liveChunks.splice(index, 1);
    // Face detail stays per-fragment at the source atlas resolution. A head
    // owns its projection snapshot/material; other chunks share the plain one.
    const faceMaterial = entry.view.uniforms.faceCfg.value.x > 0.5
      ? registerLitChunkMaterial(createBakedChunkMaterial({
        bakedAo: true, fleshResponse: true, face: entry.view.uniforms,
        ...(deferredMode ? { output: 'surface' as const, shadowReceiver: 'level-only' as const } : {}),
      })) : undefined;
    if (faceMaterial) bakedChunkSeed?.(faceMaterial);
    const mesh = new THREE.Mesh(baked.geometry, (faceMaterial ?? bakedChunkMat).material);
    mesh.frustumCulled = true; // it is a static bounded mesh — let three cull it
    scene.add(mesh);
    // DEFERRED MODE: the bake swaps the piece between producer routes —
    // marched proxy (SDF producer) -> static mesh (level-only G-buffer
    // producer). The proxy is only HIDDEN (its registration stays valid for
    // the recycle ring).
    deferredApi?.router.register(mesh, 'mesh', 'level-only');
    entry.view.object.visible = bakedChunkReference;
    mesh.visible = !bakedChunkReference; // normally the proxy leaves the SDF passes
    bakedChunks.push({
      id: entry.id, mesh, view: entry.view, state: entry.state, faceMaterial,
      centre: baked.centre, radius: baked.radius, bakeMs: baked.bakeMs,
      template: entry.template,
    });
    totalBakes++;
    lastBakeMs = baked.bakeMs;
    lastBakeInfo = {
      id: entry.id, verts: baked.verts, tris: baked.tris,
      bakeMs: baked.bakeMs, overflow: baked.overflow ? 1 : 0,
      droppedQuads: baked.droppedQuads,
      extent: data.extent, flesh: data.flesh.length, bones: data.bones.length,
      torn: data.torn.length, gore: data.gore,
      radius: baked.radius,
    };
    lastBakeSwapMs = performance.now() - t0;
    // The frame this swap landed on — a recorded number, so a replay can assert
    // the same landing frame (chunkStats().bakeSwapFrame).
    lastBakeSwapFrame = simFrame;
    telemetry.end('chunk-bake-swap', swapTiming);
    telemetry.event('chunk-bake-swap', { chunk: entry.id, workerMs: baked.bakeMs, swapCpuMs: lastBakeSwapMs, vertices: baked.verts, triangles: baked.tris });
    if (baked.overflow || baked.droppedQuads > 0) {
      console.warn(`[chunk-bake] chunk ${entry.id}: overflow=${baked.overflow} droppedQuads=${baked.droppedQuads} — geometry holes`);
    }
  }
  /** A slug/pellet INTO a baked piece: the piece GIBS. Fresh small chunks
   *  spawn at the impact (its own origin body's template, so the meat
   *  matches), a blood gout sprays, and the mesh is deleted. No reverse
   *  path — the design question settled for option 2 (simpler: no dual
   *  representation to keep in sync, and closer to the feel). */
  function gibBakedPiece(b: BakedChunk, at: Vec3): void {
    telemetry.event('baked-piece-hit', { chunk: b.id, world: [...at] });
    spareChunkViews.push(freeBaked(b));
    gibChunkMeat(b.template, at);
  }
  function gibChunkMeat(template: ChunkTemplate, at: Vec3): void {
    const rng = rngStreams.misc;
    const gobs = 2 + (rng() < 0.5 ? 1 : 0);
    for (let i = 0; i < gobs; i++) {
      const theta = rng() * Math.PI * 2;
      const spread = 0.01 + rng() * 0.02;
      const r = 0.016 + rng() * 0.02;
      const a: Vec3 = [at[0] + Math.cos(theta) * spread, at[1] + 0.005, at[2] + Math.sin(theta) * spread];
      const bEnd: Vec3 = [a[0] + (rng() - 0.5) * 0.04, a[1] + rng() * 0.03, a[2] + (rng() - 0.5) * 0.04];
      spawnChunkPiece({
        limb: 'torso',
        origin: a,
        prims: [{
          limb: 'torso', cluster: 0, op: 'add', a, b: bEnd, radius: r,
          scale: [1, 1, 1], blendK: 0.008,
        } as unknown as Primitive],
        tornAt: [], bones: [],
      }, template);
    }
    if (bleedEnabled) {
      // One-shot gib gout: a fresh emitter stream so it never fuses with a
      // nearby wound's stream by proximity.
      spawnImpactGout(bloodSim, 'slug', at, [0, 1, 0], rngStreams.bleed, nextEmitterStream++);
    }
  }
  /**
   * The two per-view uniforms a chunk's KIND decides, written on EVERY spawn.
   *
   * MEAT AND BONE DO NOT SHADE ALIKE. march.wgsl.ts's pale-bone branch only
   * runs while `meltCfg.x > 0` (it was written for the melt, where the skeleton
   * emerges from thinning flesh), and the chunk view's own torn-meat gore mask
   * and face projection are decided in `reset` from whether the FLESH list is
   * empty. A released ribcage left at meltCfg.x = 0 marches, folds and shades
   * as a meat-coloured cage — the shape would finally be there and still not
   * read as bone, which is half of what the owner asked for.
   *
   * BOTH ARE WRITTEN FOR EVERY KIND, not just for bone. Chunk views are
   * RECYCLED at the maxChunks cap, so a view that was a ribcage last blast
   * keeps meltCfg.x = 1 into its next life as an arm — and a flesh piece
   * rendered through the melt ramp is a pale, matte, wrong-coloured limb. The
   * lab's spawnChunk has carried the same "every spawn, not just bone ones"
   * comment since the melt shipped; this is that rule, not a new one.
   */
  function applyChunkKindLook(view: ChunkGpuView, kind: 'limb' | 'gob' | 'bone'): void {
    view.uniforms.meltCfg.value.x = kind === 'bone' ? 1 : 0;
  }
  /** Set by the measurement seam below: pieces exist, fly and bake exactly as
   *  they would, and are simply not drawn. */
  let chunksHidden = false;
  /** Whether BONE pieces are drawn — see setBonePiecesVisible. */
  let bonesVisible = true;
  // Now that the array exists, the frame draw can read it directly.
  chunkObjects = () => (bakedChunkReference ? [...liveChunks, ...bakedChunks] : liveChunks).map(c => c.view.object);
  let nextChunkId = 1;
  function primsLongAxis(prims: Primitive[], origin: Vec3): Vec3 {
    let best: Vec3 = [0, 1, 0];
    let bestLen = 0;
    for (const p of prims) {
      if (p.op === 'sub') continue;
      const d: Vec3 = [p.b[0] - p.a[0], p.b[1] - p.a[1], p.b[2] - p.a[2]];
      const l = Math.hypot(d[0], d[1], d[2]);
      if (l > bestLen) { bestLen = l; best = d; }
    }
    return bestLen < 1e-6 ? [0, 1, 0] : [best[0] / bestLen, best[1] / bestLen, best[2] / bestLen];
  }
  /**
   * Spawn one detached piece. `kind` is the piece's MATERIAL AND PHYSICS, not a
   * label: 'bone' picks the CHUNK_TUNING thud (a ribcage that bounces like meat
   * is a rubber skeleton), the bone-only extent recipe, and — below — the two
   * per-view uniforms that make a bone chunk render at all.
   */
  function spawnChunkPiece(
    piece: {
      limb: string; origin: Vec3; prims: Primitive[]; tornAt: Vec3[];
      bones: Primitive[]; kind?: 'limb' | 'gob' | 'bone';
      /** Pre-release orientation + angular velocity (body-to-gib task 4). */
      spinQuat?: Quat; spinAngVel?: Vec3;
    },
    template: { uniforms: import('./zombie-gpu').MarchUniforms; volumeTexture: THREE.Texture },
    initialVelocity?: Vec3,
  ) {
    const rng = rngStreams.misc;
    const vel: Vec3 = [
      (rng() - 0.5) * 4.5,
      2.5 + rng() * 2.5,
      (rng() - 0.5) * 4.5,
    ];
    const kind = piece.kind ?? 'limb';
    // A BONE-ONLY PIECE HAS NO FLESH TO MEASURE. `chunkExtent` over an empty
    // prim list is 0, which would size the proxy box at 5 cm and cull the very
    // ribcage it exists to draw; `boneChunkRadius` (melt-bones.ts) is the
    // resting radius and is shared with the melt's released groups, which is
    // also what keeps a released shin from coming to rest floating half its
    // length above the floor.
    const boneOnly = piece.prims.length === 0 && piece.bones.length > 0;
    const extentSource = boneOnly ? piece.bones : piece.prims;
    // NARROW-PHASE floor support (2026-09-16 task 3): the piece's own capsule
    // ends, so a flat shin rests on its thickness instead of hovering at its
    // half-length `chunkExtent`. Falls back to the old single radius when the
    // prims carry no usable geometry.
    const support = chunkSupportSpheres(extentSource, piece.origin);
    const state = makeChunk(
      piece.limb as never, piece.origin, initialVelocity ?? vel,
      boneOnly ? boneChunkRadius(piece.bones) : chunkExtent(piece.prims, piece.origin),
      primsLongAxis(extentSource, piece.origin),
      rng, kind,
      (piece.spinQuat || piece.spinAngVel)
        ? { quat: piece.spinQuat, angVel: piece.spinAngVel }
        : undefined,
      support.length > 0 ? support : undefined,
    );
    // View budget. Order matters with the bake on: a BAKED piece is the
    // oldest, least-relevant gore, so its view recycles FIRST; only when
    // every view is live-and-flying does the old oldest-live rule apply.
    // Either way views stay bounded at `maxChunks` — the leak gate. It reads the
    // KNOB, not MAX_CHUNKS: the budget is raisable (?maxchunks) precisely
    // because a full-body gib is 19-20 pieces, and a gate here that still
    // recycled at the old constant would leave `cap: 24` reporting a pool that
    // is actually 12 — which is what the dynamite gate's census caught.
    let recycled: ChunkGpuView | undefined = spareChunkViews.pop();
    if (!recycled && chunkViews.length >= maxChunks) {
      const oldestBaked = bakedChunks.shift();
      if (oldestBaked) {
        recycled = freeBaked(oldestBaked);
      } else {
        const oldest = liveChunks.shift();
        if (oldest) {
          if (chunkBakeJobs.pendingId === oldest.id) cancelChunkBake();
          recycled = oldest.view;
        }
      }
    }
    if (recycled) {
      recycled.reset(state, piece.prims,
        piece.tornAt.length ? piece.tornAt : undefined, piece.bones, template.uniforms);
      // A bone-only chunk needs its bone ROWS packed whatever the bone-tube
      // mode is: with packBones off (the `?boneMesh` path) `reset` writes
      // organ rows only, so a chunk whose flesh list is empty packs NOTHING and
      // marches an empty field — an invisible skeleton, which is the exact
      // failure this whole piece set exists to end.
      recycled.setPackBones(boneOnly ? !gibBoneMesh : !boneMesh);
      applyChunkKindLook(recycled, kind);
      // May be arriving from a baked retirement; and a bone piece spawned while
      // the differential hides the skeleton must stay hidden.
      // With `gibBoneMesh` the tubes draw this piece and its packed rows are
      // gone, so the marched proxy has an EMPTY field: it would march and
      // discard every pixel of its box for nothing. Hidden, not merely empty.
      recycled.object.visible = !chunksHidden
        && (kind !== 'bone' || (bonesVisible && !(boneOnly && gibBoneMesh)));
      liveChunks.push({ id: nextChunkId++, state, view: recycled, template, kind, boneOnly });
    } else {
      const view = createChunkGpuView(
        state, piece.prims, template.uniforms,
        piece.tornAt.length ? piece.tornAt : undefined,
        template.volumeTexture, chunkMaterial, piece.bones,
        // Matching options with the shared material (task-2 contract: with a
        // shared material the material's mode wins; the view must agree).
        deferredMode ? { output: 'surface', shadowReceiver: 'level-only' } : undefined,
      );
      view.setPackBones(boneOnly ? !gibBoneMesh : !boneMesh);
      applyChunkKindLook(view, kind);
      view.object.visible = !chunksHidden
        && (kind !== 'bone' || (bonesVisible && !(boneOnly && gibBoneMesh)));
      view.object.layers.set(SDF_LAYER);
      scene.add(view.object);
      deferredApi?.router.register(view.object, 'sdf');
      chunkViews.push(view);
      liveChunks.push({ id: nextChunkId++, state, view, template, kind, boneOnly });
    }
  }

  /**
   * THE SPRITE PATH'S TWIN OF `spawnChunkPiece` — one detached piece, as a
   * billboard instead of a marched view.
   *
   * The chunk-construction arithmetic is DELIBERATELY the same lines as above,
   * because the two modes must not disagree about a piece's physics: the same
   * `chunkExtent`/`boneChunkRadius` radius (so a piece settles at the same
   * height off the floor and collides with the same walls), the same
   * `primsLongAxis` (so it topples the same way), the same `makeChunk` seed
   * discipline, and the same `kind` (so a bone piece THUDS in both).
   *
   * The DIFFERENCE is everything that is absent: no `template` (no SDF uniforms,
   * no volume texture), no `ChunkGpuView`, no view budget, and no bake. What a
   * sprite piece needs from the body is its own geometry's EXTENT and its limb's
   * identity — nothing about how the body was marching.
   *
   * Returns false when there is no atlas to cut a frame from, which is the one
   * way this can decline; the caller falls back to the marched path rather than
   * dropping a body's gore.
   */
  function spawnSpriteGibPiece(
    piece: {
      limb: string; origin: Vec3; prims: Primitive[]; bones: Primitive[];
      kind?: 'limb' | 'gob' | 'bone';
      spinQuat?: Quat; spinAngVel?: Vec3;
    },
    impulseVel: Vec3 | null,
    impulseDelay: number,
  ): boolean {
    if (!gibAtlas) return false;
    const rng = rngStreams.misc;
    const kind = piece.kind ?? 'limb';
    const boneOnly = piece.prims.length === 0 && piece.bones.length > 0;
    const extentSource = boneOnly ? piece.bones : piece.prims;
    const support = chunkSupportSpheres(extentSource, piece.origin);
    const state = makeChunk(
      piece.limb as never, piece.origin, [0, 0, 0],
      boneOnly ? boneChunkRadius(piece.bones) : chunkExtent(piece.prims, piece.origin),
      primsLongAxis(extentSource, piece.origin),
      rng, kind,
      (piece.spinQuat || piece.spinAngVel)
        ? { quat: piece.spinQuat, angVel: piece.spinAngVel }
        : undefined,
      support.length > 0 ? support : undefined,
    );
    spawnSpritePiece(spritePieces, {
      state, frame: pickFrame(gibAtlas, rng()),
      impulseDelay, impulseVel, sizeScale: gibSpriteSizeScale,
    });
    return true;
  }

  // -----------------------------------------------------------------------
  mark('dynamite-start');
  // WEAPON SLOT 2 — DYNAMITE (2026-09-10).
  //
  // The purpose is TUNING: a bundle you can throw at zombies and soldiers so
  // the blast radius, the gib decision and the cost of a full-body gib can be
  // judged in play rather than argued about. So the wiring is deliberately thin
  // and every number that matters is a seam (see DYN_PARAMS above).
  //
  // The pure modules do all the work: fpv.ts owns the COOK state machine and
  // the charge→speed band, dynamite-flight.ts owns the ballistic arc — flown
  // here against the REAL level (game-level.ts's levelColliders() plus the room
  // ceiling), not the lab's arena rect — explosion-aoe.ts owns the AOE, and
  // sever.ts owns the gib. This block only routes between them and the THREE
  // scene, exactly as the lab's wiring does, with the one difference that here
  // the bodies are ACTORS with GPU views, brains and collapse clocks.
  // -----------------------------------------------------------------------

  /** The bundle's contact radius in the body test, m: a zombie is ~0.45 m
   *  across at the chest. The bundle's OWN 0.08 m radius lives in the flight
   *  module, so this is the body half-width only. */
  const BUNDLE_BODY_RADIUS_M = 0.45;
  /** How many bundles may be in the air at once — and therefore how many prop
   *  instances exist (1 held + the rest in flight). Small on purpose: this is a
   *  tuning tool, not a grenade-spam simulator. */
  const MAX_BUNDLES = 4;
  /** Tallest ceiling in the level — the FALLBACK for a bundle outside every
   *  enclosure. levelColliders() carries no ceiling box for the rooms, so
   *  without a ceiling plane a full-charge lob leaves through the roof. Tunnel
   *  lintels ARE boxes (2.2 → 3.0 m), so ceiling + boxes together reproduce the
   *  level including its low mouths. */
  const BUNDLE_CEIL_M = Math.max(...ROOMS.map(r => r.height));

  /** The ceiling over a point, PER ENCLOSURE.
   *
   *  A single global plane stopped being correct the moment the arena added a
   *  6 m room to a level whose cells are 3 m: resolving to the TALLEST ceiling
   *  everywhere let a bundle sail out through the small rooms' roofs, and
   *  resolving to the smallest would have clipped the arena at half its height.
   *  Rooms and tunnels each carry their own height, so the plane is a lookup.
   *  `BUNDLE_CEIL_M` remains the answer for a point inside neither (over a wall
   *  or through a door frame mid-flight), which is the generous case and the one
   *  the collider boxes are there to catch. */
  function ceilingAt(x: number, z: number): number {
    for (const t of TUNNELS) {
      if (x >= t.minX && x <= t.maxX && z >= t.minZ && z <= t.maxZ) return t.height;
    }
    for (const r of ROOMS) {
      if (x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ) return r.height;
    }
    return BUNDLE_CEIL_M;
  }

  let slotState: WeaponSlotState = makeWeaponSlotState('shotgun');
  let cook: CookState = { phase: 'idle', phaseAt: 0, cookStart: 0 };
  /** The cook clock in SIM seconds, advanced by tick(dt) — not a wall clock,
   *  so a frozen/render-locked capture cannot advance the fuse behind its own
   *  back. */
  let dynNow = 0;
  // One-frame input edges, consumed by the next tick.
  let dynPress = false;
  let dynRelease = false;
  /** 0..1 charge of the live cook, for the HUD. */
  let dynCharge = 0;

  /** Prop pool. The HELD one is parented to `bundleRig` (inside aimRig, so it
   *  rides the free-aim lean and the walk bob); a thrown one is moved to the
   *  scene root and posed in WORLD space from its flight state. */
  const bundleProps: StickProp[] = [];
  const bundleRig = new THREE.Group();
  bundleRig.name = 'bundle-rig';
  /** Hold pose, rig space: low and off to one side, canted so the fuse end
   *  reads against the dark. Which side is the off-hand side follows the
   *  existing view-model convention (the shorty is yawed 180°, so its chambers
   *  land screen-left and the rig's +x is what the player sees on the left). */
  const BUNDLE_HOLD = {
    pos: new THREE.Vector3(0.235, -0.245, -0.42),
    rot: new THREE.Euler(
      THREE.MathUtils.degToRad(-28), THREE.MathUtils.degToRad(18), THREE.MathUtils.degToRad(28),
    ),
  };
  let bundleReady = false;
  {
    const errs: string[] = [];
    for (let i = 0; i < MAX_BUNDLES; i++) {
      try {
        const p = createStickProp();
        p.object.visible = false;
        bundleProps.push(p);
      } catch (e) { errs.push(String(e)); }
    }
    if (errs.length > 0) console.error('[sdf-game] dynamite prop pool:', errs.join(' | '));
    bundleRig.position.copy(BUNDLE_HOLD.pos);
    bundleRig.rotation.copy(BUNDLE_HOLD.rot);
    (aimRig ?? viewModelAnchor).add(bundleRig);
    bundleReady = bundleProps.length > 0;
  }

  /** The prop currently IN HAND, or null while the bundle it became is in the
   *  air. This is deliberately NOT `bundleProps[0]`: after a throw that very
   *  object belongs to the flight, and drawing it in the rig as well would put
   *  a second bundle in the player's hand. */
  let heldProp: StickProp | null = bundleProps[0] ?? null;
  // `bundleRig.visible` is the gate for the whole in-hand model, so the prop's
  // OWN flag must stay true: setting it false here made the held bundle
  // invisible from boot until the first throw cycle happened to re-acquire one
  // (owner report, 2026-09-10: "after like the first 2 throws i dont see the
  // dynamite"). One gate, not two.
  if (heldProp) { bundleRig.add(heldProp.object); heldProp.object.visible = true; }
  /** Props not in hand and not in flight. */
  const spareBundles: StickProp[] = bundleProps.slice(1);

  /** A bundle in the air. `prop` is null when more bundles are flying than the
   *  pool can draw — the SIM is never dropped, only the drawing of it. */
  interface LiveBundle { state: FlightState; prop: StickProp | null }
  const liveBundles: LiveBundle[] = [];
  /**
   * THE STAGED RELEASE'S QUEUE — the impulses a gib has NOT applied yet.
   *
   * A piece is born with ZERO velocity and sits at the body's own posed
   * transform; its concussion velocity arrives `frame` frames later, and the
   * frame is later the further the piece is from the blast. That is the whole
   * mechanism behind dev-note §3(a)/(b): the frame the bundle goes off shows
   * the BODY's silhouette in place — the pieces are co-located with it, so the
   * substitution is invisible — and the body then comes apart outward from the
   * epicentre over `gibStaggerFrames` frames instead of being replaced in one.
   *
   * It is a few frames of state, not new geometry, and it is drained in the
   * same fixed step that integrates the chunks (see stepPendingGibImpulses). */
  const pendingGibImpulses: { id: number; vel: Vec3; delay: number }[] = [];
  /**
   * BODIES IN THEIR RUPTURE WINDOW, waiting to become pieces. A gibbed body is
   * NOT retired at the blast any more: it stays in the world, drawn with its
   * planned regions separating, for `gibTearSec`, and the pieces are spawned
   * when its own window closes. The actor owns that clock (see
   * ZombieActor.beginTear); this queue remembers the plan and where to release.
   * The plan is prepared ONCE here and handed BOTH to the visualization (via
   * beginTear) and to `gibActor` at release, so the drawn regions and the
   * spawned chunks cannot disagree.
   */
  const pendingGibs: {
    actor: ZombieActor; at: Vec3; falloff: number; plan: GibPlan;
    /** The tier chosen at SCHEDULE time; the release is locked to it. */
    tier: string;
    /** Chunk views this plan needs, held out of `gibBudget()` until release. */
    reserve: number;
  }[] = [];
  /**
   * Apply every impulse whose delay has run out. A piece whose chunk was
   * recycled out of the pool in the meantime is simply gone — the queue is
   * keyed by chunk id, and ids are never reused.
   *
   * THE DELAY COUNTS DRAINS, NOT FRAMES, and that is deliberate. This drain
   * runs LATER IN THE SAME TICK as the detonation that spawned the pieces
   * (stepDynamite is before the chunk step in `tick`), so a frame-indexed
   * queue either releases the first wave before the first frame is drawn — the
   * explosion's opening frame shows pieces already moving, which is the
   * substitution the staging exists to prevent — or needs an off-by-one
   * "+2" that silently breaks the day someone reorders the tick. Counting
   * drains, a delay of 0 still means "not in the tick the blast happened in",
   * because the drain that could have fired it has already run and decremented.
   */
  function stepPendingGibImpulses(): void {
    for (let i = pendingGibImpulses.length - 1; i >= 0; i--) {
      const p = pendingGibImpulses[i]!;
      if (p.delay > 0) { p.delay--; continue; }
      const c = liveChunks.find(q => q.id === p.id);
      if (c) c.state.vel = [p.vel[0], p.vel[1], p.vel[2]];
      pendingGibImpulses.splice(i, 1);
    }
  }
  /** Radians of view pitch per unit of the resolver's cameraKick magnitude. The
   *  magnitude is ~4 at the epicentre, so this is ~3.4° of punch point-blank
   *  and proportionally less with distance. */
  const BLAST_KICK_RAD_PER_UNIT = 0.015;

  /** THE EXPLOSION'S OWN LIGHT. A blast is the brightest thing in this game and
   *  it has to READ as one: near-instant spike, then a fast fall — the same
   *  shape the muzzle flash uses, scaled up and outlasted by the fireball. */
  const EXPLOSION_LIGHT = {
    /** Seconds of light, longer than the muzzle flash's 0.14 s by a lot: a
     *  detonation is not an instantaneous event and the room has to have time to
     *  visibly return to dark. */
    lifeSec: 0.5,
    /** Mesh-side peak, in the accents' units (a brazier is 9-13).
     *
     *  320 is measured, not chosen: at 26 the light was DETECTABLY on and
     *  visually nothing — the arena's whole-frame mean rose +0.96 with it
     *  against +0.10 without (the particles alone), i.e. about one level out of
     *  255 spread over the room. A brazier sustains 9-13 and the eye adapts to
     *  it; a half-second flash has to DOMINATE the room it is in to read as one,
     *  so it starts an order of magnitude above the braziers rather than beside
     *  them. `?fxlight=` scales this and the gather peak together. */
    meshPeak: 320,
    /** Gather-side peak. The muzzle flash pushes 35 x probeFlashBoost, and an
     *  explosion is bigger and further away, so a comparable number lands it in
     *  the same range as a firefight's flashes. */
    gatherPeak: 220,
    /** Attached this far above the detonation, so a ground burst lights the room
     *  rather than a disc of floor. */
    liftM: 0.5,
  } as const;
  // `?fxlight=K` scales BOTH peaks together — the owner tunes "how much does the
  // room light up" as one number, and scaling only one side would let the walls
  // and the bodies disagree about the blast's brightness.
  let fxLightScale = parseFloatParam(DYN_PARAMS.get('fxlight'), { min: 0, max: 4 }) ?? 1;
  /** How far the blast's light reaches (the soft room-fill component): see the
   *  panel's `light reach` row and LIGHT_FILL_REF_M. 0 = the pure point light. */
  let fxSpread = parseFloatParam(DYN_PARAMS.get('fxspread'), { min: 0, max: 3 }) ?? 1.2;
  // ?woundcap=0 restores the uncapped flesh probe (see damage.ts probeFlesh):
  // the A/B control for the wound-stamping cost, settable per boot so the two
  // arms can be measured interleaved rather than across runs.
  setProbeCapEnabled(DYN_PARAMS.get('woundcap') !== '0');
  /** Live explosions lighting something, newest last. Bounded by the pool. */
  const explosionLights: { pos: Vec3; age: number }[] = [];
  /** Light a blast. Called by BOTH the real detonation and the capture seam —
   *  a seam that drew the particles but not the light made the light look like
   *  it did nothing at all in the differential capture (measured: 15.0% of frame
   *  changed with the light "on" against 15.1% with ?fxlight=0). */
  function igniteExplosionLight(at: Vec3): void {
    explosionLights.push({ pos: [at[0], at[1] + EXPLOSION_LIGHT.liftM, at[2]], age: 0 });
    while (explosionLights.length > EXPLOSION_LIGHTS) explosionLights.shift();
  }

  /** Spike-then-fall, 1 at ignition and 0 at lifeSec. */
  function explosionLightEnv(age: number): number {
    if (age < 0 || age >= EXPLOSION_LIGHT.lifeSec) return 0;
    const u = age / EXPLOSION_LIGHT.lifeSec;
    // A hard attack (the first frame is the brightest) then an exponential fall
    // — a LINEAR fade reads as a lamp being switched off, not as a blast.
    return Math.exp(-4.2 * u) * (1 - u * u * 0.35);
  }

  // Telemetry for the tuning pass — read back through __sdfGame.dynamite().
  let dynThrown = 0;
  let dynDetonations = 0;
  let dynGibbed = 0;
  let dynGibPieces = 0;
  /** DIAGNOSTIC (temporary): what the pre-tear window's drain did, so a census
   *  that disagrees with it says WHICH side is wrong. */
  let dynScheduledGibBodies = 0;
  let dynScheduledGibPieces = 0;
  let dynLastBlastMs = 0;
  /** THE RADIUS THE LAST BLAST ACTUALLY RESOLVED AT. The `detonate` seam used
   *  to return `explosionRadiusM()` — the reference CONSTANT — so the radius a
   *  rig read back could never move no matter what was tuned, and the new
   *  `?aoesize` slider looked inert to every instrument in the repo while it
   *  was in fact working. The gate caught it; this is the honest readback. */
  let dynLastRadiusM = explosionRadiusM();
  /** Pieces a gib had to leave OUT because the view pool was full — the number
   *  that says whether ?maxchunks needs raising for what is on screen. */
  let dynLastGibDropped = 0;
  /** Which piece SHAPE the last body got (see gibActor's tiers) and how many
   *  pieces it actually spawned — the two numbers the census cannot infer. */
  let dynLastGibTier = 'parts';
  /** EVERY body's tier for the last blast, in the order they were gibbed —
   *  because "what did the owner actually see" is a question about ALL of them,
   *  and a single last-body field answers it wrongly: a five-body blast in the
   *  arena gives the first body `parts` and the rest the cheap rungs, and only
   *  the log shows that. Cleared at the top of each detonation. */
  let dynGibTierLog: string[] = [];
  let dynLastGibSpawned = 0;
  let dynLastGibParts: string[] = [];
  let dynLastGibHeld = 0;
  let dynBloodOrphans = 0;

  /** World position of a prop, or the eye when there is none. */
  const _propPos = new THREE.Vector3();
  function propWorld(p: StickProp | null): Vec3 {
    if (!p) return eyeOf(player);
    p.object.getWorldPosition(_propPos);
    return [_propPos.x, _propPos.y, _propPos.z];
  }

  /** Take a prop for a bundle that is leaving the hand: the held one if it is
   *  there, else a spare, else the OLDEST flying bundle's (its state keeps
   *  flying — only the drawing of it is recycled, so the sim never desyncs). */
  function takePropForThrow(): StickProp | null {
    if (heldProp) {
      const p = heldProp;
      heldProp = null;
      bundleRig.remove(p.object);
      scene.add(p.object);
      return p;
    }
    const spare = spareBundles.pop();
    if (spare) return spare;
    const oldest = liveBundles.find(b => b.prop);
    if (!oldest || !oldest.prop) return null;
    const p = oldest.prop;
    oldest.prop = null;
    return p;
  }

  /** Give the hand a bundle again once the throw has RECOVERED.
   *
   *  `cook.phase` must be 'idle', not merely "not cooking": fpv.ts spends
   *  throwRecoverSec (0.4 s) in 'cooldown' after every release, and that beat is
   *  the throw animation — handing the player the next bundle the instant the
   *  last one leaves would put a bundle back in a hand that is still visibly
   *  mid-throw. An overcook returns straight to 'idle', so the replacement is
   *  immediate there, which is right: nothing was thrown. */
  function reacquireHeldProp(): void {
    if (heldProp || !bundleReady) return;
    if (cook.phase !== 'idle') return;
    const p = spareBundles.pop() ?? (() => {
      const oldest = liveBundles.find(b => b.prop);
      if (!oldest || !oldest.prop) return null;
      const q = oldest.prop;
      oldest.prop = null;
      return q;
    })();
    if (!p) return;
    p.object.removeFromParent();
    bundleRig.add(p.object);
    // RESET THE LOCAL TRANSFORM, and this is the whole bug (owner report
    // 2026-09-10: "after like the first 2 throws i dont see the dynamite").
    //
    // `pose({ mode: 'flight' })` writes the bundle's WORLD position and its
    // tumble quaternion onto the object. Reparenting that object into the rig
    // does not undo any of it, so a re-acquired bundle stayed exactly where it
    // detonated — measured, `local [28.235, 0.097, -12.354]` in a rig that sits
    // 0.42 m in front of the eye. Drawn metres off-screen: the player was
    // holding a bundle they could not see, and the first two throws looked fine
    // only because the first re-acquire happened to draw a prop that had never
    // flown.
    //
    // The rig carries the hold pose (BUNDLE_HOLD), so the prop's own local
    // transform must be the identity. One owner for the hold transform.
    p.object.position.set(0, 0, 0);
    p.object.quaternion.identity();
    p.object.scale.setScalar(1);
    p.object.visible = true;
    heldProp = p;
  }

  /** True when a body is within the bundle's contact radius anywhere along the
   *  sub-step's segment. Called at the FLIGHT's own 120 Hz, so a 28 m/s bundle
   *  (0.23 m per sub-step) cannot tunnel through a 0.45 m target. */
  function bundleHitsBody(from: Vec3, to: Vec3): ZombieActor | null {
    const dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2];
    const l2 = dx * dx + dy * dy + dz * dz || 1;
    for (const a of actors) {
      const p = a.pose();
      const cx = p.pos[0], cy = p.pos[1] + 0.95, cz = p.pos[2];
      const t = Math.max(0, Math.min(1,
        ((cx - from[0]) * dx + (cy - from[1]) * dy + (cz - from[2]) * dz) / l2));
      const qx = from[0] + dx * t - cx, qy = from[1] + dy * t - cy, qz = from[2] + dz * t - cz;
      if (qx * qx + qy * qy + qz * qz <= BUNDLE_BODY_RADIUS_M * BUNDLE_BODY_RADIUS_M) return a;
    }
    return null;
  }

  /** Release a bundle from the hand along the aim. */
  function throwBundle(speedMps: number): void {
    if (!bundleReady) return;
    // THE ORIGIN IS READ BEFORE THE REPARENT, and that order is load-bearing:
    // the held prop's world transform IS the hold pose (it rides `bundleRig`,
    // inside the camera), while `takePropForThrow` moves the object to the scene
    // root and leaves its LOCAL transform behind. Reading the position after
    // that hands the flight the scene ORIGIN — a point inside the level's solid
    // centre block — so the bundle was born buried in geometry, pushed out
    // downward, and left sliding along the floor. Caught by the slot gate.
    const origin = propWorld(heldProp);
    const prop = takePropForThrow();
    // The reticle IS the aim under both schemes (aimDir handles free aim), and
    // fpv.ts's throwDirection applies the game's upward lob on top — the same
    // two rules the lab's throw uses, so a bundle thrown here lands where the
    // lab's does. Deriving yaw/pitch from the aim vector keeps the lob maths
    // in that one function instead of a second copy here.
    const d = aimDir();
    const yaw = Math.atan2(d[0], -d[2]);
    const pitch = Math.asin(Math.max(-1, Math.min(1, d[1])));
    const dir = throwDirection(yaw, pitch);
    const speed = speedMps * dynSpeedScale;
    const state = makeFlight(origin, [dir[0] * speed, dir[1] * speed, dir[2] * speed], { impactMode: true });
    liveBundles.push({ state, prop });
    prop?.pose({ mode: 'flight', pos: state.pos, spin: state.spin, fuseBurning: true });
    dynThrown++;
    telemetry.event('dynamite-throw', { speedMps: speed, x: origin[0], y: origin[1], z: origin[2] });
  }

  /** The bundle that never left the hand: an overcook, or a fuse that burned
   *  out while held. Detonates AT the player. */
  function overcookInHand(): void {
    const at = propWorld(heldProp);
    telemetry.event('dynamite-overcook', { x: at[0], y: at[1], z: at[2] });
    detonateAt(at, true);
  }

  // -----------------------------------------------------------------------
  mark('detonation-start');
  // THE DETONATION — one blast, everything it does.
  // -----------------------------------------------------------------------
  /** Per-phase timings of the LAST detonation, ms. The blast is one frame of
   *  work with four very different costs in it, and "the explosion pauses the
   *  game" is not actionable until the split is known. */
  function newBlastProfile() {
    return { resolve: 0, gib: 0, wound: 0, blood: 0, chunksSpawned: 0, bodies: 0, total: 0 };
  }
  let dynBlastProfile = newBlastProfile();

  function detonateAt(at: Vec3, inHand = false): void {
    const t0 = performance.now();
    dynGibTierLog = [];
    const prof = newBlastProfile();
    dynBlastProfile = prof;
    EXPLOSION_PROFILE.traceMs = 0; EXPLOSION_PROFILE.woundMs = 0;
    EXPLOSION_PROFILE.cutMs = 0; EXPLOSION_PROFILE.bodiesTraced = 0;
    EXPLOSION_PROFILE.bodiesPruned = 0; EXPLOSION_PROFILE.prunedPrims = 0;
    EXPLOSION_PROFILE.traces = 0;
    dynDetonations++;
    const bodies: ExplosionBody[] = actors.map(a => ({
      id: String(a.id), body: a.posed(), bodyYaw: a.pose().yaw,
    }));
    const tResolve = performance.now();
    const fx = resolveExplosion(at, bodies, {
      eye: eyeOf(player),
      // Floor distance IS the height above y = 0, this level's real floor, so
      // the resolver's air-vs-ground burst choice is exact here without
      // overriding its default.
      floorDistM: Math.max(0, at[1]),
      // A gibbed body's wounds are never read (see `gibWounds` above).
      woundsOnGibbed: gibWounds,
      // THE FOCUS KNOBS, live from the panel. Both are the resolver's own
      // options and both default to the reference (scale 1, floor 0.45), so a
      // page that never touches them resolves exactly as before.
      radiusScale: aoeRadiusScale,
      launchFloor: aoeLaunchFloor,
      // The hand-splash flourish only makes sense for an in-hand detonation:
      // the resolver measures the FPV hands, and this page's hands are meshes
      // with no prim set to trace, so the band stays empty either way. Left
      // unset rather than passed a fake prim list.
      ...(inHand ? {} : {}),
    });

    prof.resolve = performance.now() - tResolve;
    prof.bodies = fx.perBody.length;
    let gibbed = 0, pieces = 0;
    // THE POOL IS DIVIDED UP FRONT, ACROSS THE BODIES THIS BLAST TAKES. Asking
    // each body in turn for "whatever is left" gives the first one everything
    // and the rest nothing: the arena's 8-body horde ends a 3-body blast with
    // one dramatic corpse and two silent disappearances. Nearest the blast
    // first, so the body the player is looking at is the one that gets the full
    // piece set; the rest degrade by tier inside gibActor.
    const condemned = fx.perBody
      .filter(pb => pb.gibbed && actors.some(q => String(q.id) === pb.bodyId))
      .sort((x, y) => y.falloff - x.falloff);
    // THE BLAST'S WHOLE BUDGET, not just the free slots. A gib may take views
    // that OLDER gore is holding — that is what `spawnChunkPiece`'s
    // oldest-first recycle has always done — so the budget is the pre-existing
    // live pieces PLUS whatever views are still unallocated. Every spawn either
    // recycles a pre-existing chunk or creates a view, so a blast kept inside
    // this number can never recycle a piece it made itself, which is the
    // "pieces jumping into new positions" bug the slice was added for.
    //
    // The budget must NOT be `maxChunks - liveChunks.length` (what it was):
    // in a full pool that is zero, the split gives every body one piece, and a
    // body with one piece is a body that vanished.
    const blastBudget = gibBudget();
    // GREEDY, NEAREST FIRST, WITH A FLOOR HELD BACK FOR THE REST. An even split
    // spends the pool on equal shares that mostly fall below the cheapest tier,
    // so three bodies in a 24-piece pool all get 8 and all degrade to the same
    // six lumps; letting the nearest body take what it can while reserving one
    // floor's worth per remaining body gives the body the player is looking at
    // the split piece set and the ones behind it the cheap shape. `remaining` is
    // debited by what a body ACTUALLY spawned, not by what it was allowed —
    // tiers are discrete, and an allowance of 13 buys 12.
    let remaining = blastBudget;
    let condemnedLeft = condemned.length;
    for (const pb of fx.perBody) {
      const a = actors.find(q => String(q.id) === pb.bodyId);
      if (!a) continue;
      if (pb.gibbed) {
        const tg = performance.now();
        // SINGLE-HIT RULE: damage ≥ GIB_THRESHOLD skips death entirely. The
        // resolver has already decided, and nothing severs a body that is
        // about to stop existing.
        if (gibTearSec > 0) {
          // The window takes it from here. The TIER IS CHOSEN NOW (task 3) with
          // the same greedy allowance the immediate path uses, and its views
          // are RESERVED out of `gibBudget()` until release, so the preview is
          // the shape that will spawn and a later blast cannot spend its slots.
          const chosen = scheduleGib(a, at, pb.falloff, gibAllowance(remaining, condemnedLeft));
          if (chosen) {
            remaining = gibDebit(remaining, chosen.reserve);
            condemnedLeft = Math.max(0, condemnedLeft - 1);
          }
          prof.gib += performance.now() - tg;
          gibbed++;
          continue;
        }
        const allowance = gibAllowance(remaining, condemnedLeft);
        const made = gibActor(a, at, pb.falloff, allowance);
        pieces += made;
        remaining = gibDebit(remaining, made);
        condemnedLeft = Math.max(0, condemnedLeft - 1);
        prof.gib += performance.now() - tg;
        gibbed++;
        continue;
      }
      // Wounds, meter credit, shove and the sever tail — all owned by the
      // actor's blast() (its doc block carries the meter contract).
      const tw = performance.now();
      a.blast({ wounds: pb.wounds, meterCredit: pb.meterCredit, impulse: pb.rigImpulse });
      // Guts, on the same stamp-time rule the pellet path uses.
      for (const w of pb.wounds) spillVerdict(a, w);
      prof.wound += performance.now() - tw;
    }
    dynGibbed += gibbed;
    dynGibPieces += pieces;

    // Concussion on pieces that already existed (the resolver's list) and on
    // the pieces this blast just made (spawnChunkPiece's ids, patched here).
    for (const ci of fx.chunkImpulses) {
      const c = liveChunks.find(q => q.id === ci.chunkId);
      if (c) c.state.vel = [ci.vel[0], ci.vel[1], ci.vel[2]];
    }
    // ——— The camera kick. `cameraKick` is the game's quake→magnitude mapping
    //     (quake/40 ≈ 4 at the epicentre, falling off linearly with distance) —
    //     a MAGNITUDE, not radians, so it is scaled into the same `recoilPitch`
    //     channel the gun kick uses and rides that channel's decay. One channel
    //     on purpose: two independent pitch impulses would fight.
    recoilPitch += fx.cameraKick * BLAST_KICK_RAD_PER_UNIT;
    // The burst BILLBOARD. Stage 3 replaces this stand-in with the procedural
    // fireball (webgpu/explosion-vfx.ts); until that lands the detonation still
    // has to be VISIBLE, so the tuning pass is not blocked on the art.
    // THE LIGHT, ignited here rather than in the VFX module: the module owns the
    // particles, the wiring owns what the room sees. A blast at the far end of a
    // corridor still gets a light (it does nothing useful, but consistency beats
    // a distance gate nobody can see).
    igniteExplosionLight(at);
    const burst = scaleBurstVisual(fx.burst);
    // BLAST REFRACTION (experiment, default OFF): feed the bounded post-aa ring
    // the blast's WORLD position, the shell's birth radius and its peak screen
    // offset. The ring reprojects every frame from its world position and a
    // growing world radius (see blast-refraction.ts and post-aa's render), so a
    // camera that moves during the ~0.55 s life keeps the band on the blast.
    //
    // THE DEFECT THIS FIXES (owner, 2026-09-16: "blastdistort=1 is
    // indistinguishable from off"): the old feed used 0.3 x burst.heightM =
    // 0.25 m, which is INSIDE the ~0.83 m opaque fireball, so the band warped
    // only pixels the fireball covered; and its life was 0.3 s with a squared
    // decay, so it was gone before the fireball cleared. The birth radius is now
    // the fireball's own rendered radius and the band expands past it.
    if (postAa.blastDistort) {
      postAa.pushBlastDistort(
        [at[0], at[1], at[2]],
        blastRefractionBirthRadiusM(burst.heightM),
        blastRefractionStrength(burst.heightM) * blastDistortStrength,
      );
    }
    if (explosionVfx) explosionVfx.spawn(burst);
    else if (burstLayer) burstLayer.spawn(burst);
    // ...including the stand-in, which used to get the UNSCALED height and was
    // therefore a third size convention in a three-way branch. It is the
    // control arm of the A/B; a control at a different size compares nothing.
    else spawnBurstStandIn(burst.at, burst.heightM, burst.kind);
    prof.chunksSpawned = pieces;
    dynLastRadiusM = fx.radiusM;
    dynLastBlastMs = performance.now() - t0;
    prof.total = dynLastBlastMs;
    dynBloodOrphans += 0;
    telemetry.event('dynamite-detonate', {
      x: at[0], y: at[1], z: at[2], radiusM: fx.radiusM,
      bodies: fx.perBody.length, gibbed, pieces, ms: dynLastBlastMs,
    });
  }

  /**
   * SCHEDULE A GIB — the pre-tear window's entry point (dev-note §3c).
   *
   * With `?gibtear=0` this IS the old path: the body becomes pieces in the frame
   * the bundle goes off. With a window, the body is BENT by the shockwave for
   * `gibTearSec` first and the pieces are spawned when the window closes, which
   * is the owner's own description of what the transition should do — "the SDF
   * flesh ... distort the flesh from the shockwave and jiggle and then rip
   * away".
   *
   * A body already in the window is NOT scheduled twice: a second bundle landing
   * on a doomed body inside 0.1 s finds it mid-tear and leaves it alone, which
   * is also what keeps the piece census honest (one body, one gib).
   */
  function scheduleGib(
    a: ZombieActor, at: Vec3, falloff: number, allowance: number,
  ): ReturnType<typeof gibTierPlan> | null {
    if (gibTearSec <= 0) return null; // caller gibs immediately
    if (a.tearing() || pendingGibs.some(q => q.actor === a)) return null;
    a.setTearTuning({ sec: gibTearSec, ...tearShape });
    // THE PLAN IS PREPARED ONCE, from the clean posed body, and reused for the
    // whole visualization AND the release. `gibParts` would re-derive it at
    // release from a body the rupture has already moved; the plan's own region
    // offsets are what the chunks are spawned with instead (spawnScheduledGibs).
    //
    // THE TIER IS CHOSEN HERE, not at release (task 3). `gibTierPlan` runs the
    // same ladder `gibActor` would, against the allowance this body is handed,
    // and the wiring locks `gibActor` to the result — so a tight pool previews
    // the cheap shape it will actually spawn instead of the full partition.
    // `?gib=pieces` is the one shape with no source indices yet; it keeps the
    // old preview-then-spawn route (see RESULTS.md Task 3 limits).
    const mode = gibMode === 'clusters' ? 'clusters' : 'parts';
    const planned = gibTierPlan(a.posed(), allowance, { bones: gibBones, mode, at });
    a.beginTear(at, falloff, planned.plan);
    pendingGibs.push({
      actor: a, at: [at[0], at[1], at[2]], falloff, plan: planned.plan,
      tier: planned.tier, reserve: planned.reserve,
    });
    return planned;
  }

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
  function spawnScheduledGibs(dt: number): number {
    if (pendingGibs.length === 0) return 0;
    // THE WINDOW'S CLOCK LIVES HERE, not in the body's step: a frozen capture
    // (`?frozen=1`) skips the whole body block, and a body whose clock stopped
    // would never become pieces. Stepping it here also means the separating
    // body is re-drawn on frames the body itself did not step.
    for (const q of pendingGibs) q.actor.stepTear(dt);
    const ready = pendingGibs.filter(q => !q.actor.tearing());
    if (ready.length === 0) return 0;
    let remaining = gibBudget();
    let left = ready.length;
    let spawned = 0;
    for (const q of ready) {
      const i = pendingGibs.indexOf(q);
      if (i >= 0) pendingGibs.splice(i, 1);
      const allowance = gibAllowance(remaining, left);
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
      const locked = gibMode !== 'pieces';
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
      const made = gibActor(q.actor, q.at, q.falloff, locked ? q.reserve : allowance, planned);
      q.actor.endTear();
      remaining = gibDebit(remaining, made);
      left--;
      spawned += made;
    }
    // The census counters live here rather than only in detonateAt: with a
    // pre-tear window the pieces are born in the TICK, several frames after the
    // blast that condemned the body, and a counter that only counted the blast
    // frame reported zero pieces for a gib that plainly happened (the gate's
    // live-view row showed 19 -> 24 chunks against "no pieces were spawned").
    dynGibPieces += spawned;
    for (const q of ready) dynScheduledGibBodies++;
    dynScheduledGibPieces += spawned;
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
  function gibActor(
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
    const clusters: GibPiece[] = (gibMode === 'pieces' ? gibAllPieces(posedBody, torsoC) : gibAll(posedBody))
      .chunks.map(g => ({ ...g, part: g.limb, kind: 'limb' as const }));
    // THE SPLIT PLAN IS CHOSEN THE SAME WAY AT BOTH ENDS (2026-09-16 task 2).
    // A scheduled rupture already carries the plan the preview drew; the
    // zero-duration path (`?gibtear=0`) and any direct caller choose it HERE
    // with the same `gibTierPlan`, so no default path can silently fall back to
    // whole-limb clusters. `?gib=clusters|pieces` keep their own labelled
    // reference shapes.
    const scheduledPlan = gibMode === 'parts' && planned === undefined
      ? gibTierPlan(posedBody, budget, { bones: gibBones, mode: 'parts', at })
      : null;
    const pieces: GibPiece[] = gibMode === 'parts'
      ? (planned?.pieces ?? scheduledPlan!.plan.pieces)
      : clusters;
    const template = { uniforms: a.view.uniforms, volumeTexture: a.view.volumeTexture };
    // IS THIS BODY ACTUALLY GOING OUT AS SPRITES? Both halves matter: the mode
    // has to be on AND there has to be an atlas to cut a frame from. Resolved
    // ONCE per body and used for the tier decision AND the spawn loop, so a body
    // can never take the sprite path's budget while spawning marched pieces.
    const spriteMode = gibRenderMode === 'sprite' && gibAtlas !== null;
    // CARVE IS THE THIRD RENDERER: real meshes from the archetype library. It
    // resolves ONCE per body (mode on AND a library that built), so a body can
    // never take the carve budget while spawning something else.
    const carveMode = gibRenderMode === 'carve' && ensureCarvedLibrary() && carvedLibrary !== null;
    // ASSETS ARE THE FOURTH RENDERER (task 2): real reusable meshes loaded from
    // the committed offline sets. Resolved ONCE per body, like carve, so the
    // budget/tier decision and the spawn loop agree. Until the archetype's load
    // resolves this is false and the body falls back to marched pieces.
    const assetMode = gibRenderMode === 'assets' && gibAssetRuntime.library(gibAssetArchetypeOf(a)) !== null;
    if (gibRenderMode === 'sprite' && gibAtlas === null && !gibSpriteAtlasWarned) {
      gibSpriteAtlasWarned = true;
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
      at, torsoC, EXPLOSION_STANDARD.impulse * launchFall * gibVelScale);
    // `?giblaunch=radial` is the labelled CONTROL: the old per-piece radial
    // shove, kept only so a normal-speed A/B can be captured side by side.
    const launchFor = (key: string, origin: Vec3): Vec3 => gibLaunchMode === 'radial'
      ? concussionVelocity(at, origin, EXPLOSION_STANDARD.impulse * launchFall * gibVelScale)
      : gibLaunchVelocity({ key, seed: demoSeed, bodyVel: coherentVel });
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
    let tier = gibMode === 'parts' ? (scheduledPlan?.tier ?? 'parts') : gibMode;
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
    const liveBefore = liveChunks.length;
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
    const perFrame = Math.max(1, Math.ceil(spawning.length / gibStaggerFrames));
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
    if (carveMode && carvedLibrary && carvedMaterial) {
      const lib = carvedLibrary.pieces;
      const yaw = a.pose().yaw;
      const cy = Math.cos(yaw), sy = Math.sin(yaw);
      const base = a.pose().pos;
      const perFrameCarve = Math.max(1, Math.ceil(lib.length / gibStaggerFrames));
      for (let i = 0; i < lib.length; i++) {
        const p = lib[i]!;
        // Body space -> world: yaw about the vertical, then translate.
        const wx = base[0] + (p.centre[0] * cy + p.centre[2] * sy);
        const wy = base[1] + p.centre[1];
        const wz = base[2] + (-p.centre[0] * sy + p.centre[2] * cy);
        const o: Vec3 = [wx, wy, wz];
        const vel = launchFor(`carve#${i}`, o);
        const delay = 1 + Math.min(gibStaggerFrames - 1, Math.floor(i / perFrameCarve));
        if (spawnCarvedPiece(p, o, 'limb', vel, delay)) spawned++;
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
      const delay = ruptureHandoff ? 0 : 1 + Math.min(gibStaggerFrames - 1, Math.floor(i / perFrame));
      if (spriteMode) {
        // THE SAME PIECE, A DIFFERENT RENDERER. `g` carries the split (which
        // prims, which bones, which limb) and the sprite path reads only its
        // EXTENT and identity from it — the geometry itself never touches the
        // GPU, which is the trade the owner accepted ("sure you trade 3d but its
        // not important in this case").
        if (spawnSpriteGibPiece(g, vel, delay)) {
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
        if (spawnAssetGibPiece(a, g, vel, delay)) {
          spawned++;
          if (boneOnly(g)) boneSpawned++;
          continue;
        }
      }
      spawnChunkPiece({
        limb: g.limb, origin: g.origin, prims: g.prims, tornAt: g.tornAt, bones: g.bones, kind: g.kind,
        // THE PRE-RELEASE MOTION RIDES THE PIECE (task 4): the orientation the
        // region was last drawn with and the angular velocity that produced it.
        // `makeChunk` overrides its random tumble with these, so the release has
        // no orientation reset and no second angular kick.
        spinQuat: g.spinQuat, spinAngVel: g.spinAngVel,
      }, template, [0, 0, 0]); // AT REST: see the doc block, point 2
      const made = liveChunks[liveChunks.length - 1];
      if (made) {
        pendingGibImpulses.push({ id: made.id, vel, delay });
        spawned++;
        if (boneOnly(g)) boneSpawned++;
      }
    }
    // Gore: the blast opens the body, so one gout at the epicentre. `spawnImpactGout`
    // takes the SIM directly (its droplets are rendered by bloodView.sync), and
    // 'slug' is the heaviest profile BleedKind has — there is no 'blast' one.
    if (bleedEnabled) {
      spawnImpactGout(bloodSim, 'slug', at, [0, 1, 0], rngStreams.bleed, nextEmitterStream++);
    }
    retireActor(a);
    telemetry.event('dynamite-gib', {
      actor: a.id, mode: gibMode, tier, pieces: spawned, dropped, bones: boneSpawned,
      gibBones, gibStaggerFrames, gibVelScale, gibLaunchMode, budget, liveBefore,
    });
    dynLastGibDropped = dropped;
    dynLastGibTier = tier;
    dynGibTierLog.push(`${tier}:${spawned}`);
    dynLastGibSpawned = spawned;
    // WHAT THE BODY BECAME, by name. A census of chunk counts cannot say
    // whether the RIBCAGE is in the pile, and "is there a ribcage" is the
    // owner's actual question — so the part ids ride the seam.
    dynLastGibParts = spawning.map(g => g.part);
    dynLastGibHeld = spawning.length - spawned;
    return spawned;
  }

  /** Take a gibbed actor out of the world: hidden from every pass, out of the
   *  router, out of the roster. The view is retained — see gibActor. */
  function retireActor(a: ZombieActor): void {
    // Equipment is a scene sibling of the flesh proxies, not their child.
    // This actor stops ticking here, so its attachments must retire too.
    a.character?.retireEquipment();
    const pi = pendingGibs.findIndex(q => q.actor === a);
    if (pi >= 0) pendingGibs.splice(pi, 1);
    a.view.object.visible = false;
    a.view.coneObject.visible = false;
    deferredApi?.router.unregister(a.view.object);
    deferredApi?.router.unregister(a.view.coneObject);
    a.view.object.removeFromParent();
    a.view.coneObject.removeFromParent();
    const i = actors.indexOf(a);
    if (i >= 0) actors.splice(i, 1);
  }

  // -----------------------------------------------------------------------
  mark('burst-start');
  // The burst stand-in (stage 3 replaces this with webgpu/explosion-vfx.ts).
  // Additive cards in the effects overlay — the SAME routing the tracers use
  // (character-effects.ts's header explains why: that scene is drawn after the
  // SDF composite with the completed depth buffer, so the composite cannot
  // erase the burst and bodies can still occlude it).
  // -----------------------------------------------------------------------
  const BURST_SLOTS = 6;
  const burstTex = new THREE.DataTexture(flashPixels(64, 11), 64, 64);
  burstTex.needsUpdate = true;
  const smokeBurstTex = new THREE.DataTexture(smokePixels(64), 64, 64);
  smokeBurstTex.needsUpdate = true;
  interface BurstSlot {
    core: THREE.Sprite; halo: THREE.Sprite; smoke: THREE.Sprite;
    age: number; life: number; h: number;
  }
  const burstSlots: BurstSlot[] = [];
  for (let i = 0; i < BURST_SLOTS; i++) {
    const core = new THREE.Sprite(new THREE.SpriteMaterial({
      map: burstTex, color: new THREE.Color(7, 4.4, 1.9), transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthTest: true, depthWrite: false, toneMapped: false,
    }));
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: burstTex, color: new THREE.Color(2.2, 0.62, 0.14), transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthTest: true, depthWrite: false, toneMapped: false,
    }));
    const smoke = new THREE.Sprite(new THREE.SpriteMaterial({
      map: smokeBurstTex, color: new THREE.Color(0.22, 0.20, 0.185), transparent: true, opacity: 0,
      depthTest: true, depthWrite: false, toneMapped: false,
    }));
    for (const s of [core, halo, smoke]) { s.visible = false; characterEffects.scene.add(s); }
    burstSlots.push({ core, halo, smoke, age: Infinity, life: 0.55, h: 1 });
  }
  let burstCursor = 0;
  function spawnBurstStandIn(at: Vec3, heightM: number, kind: 'air' | 'ground'): void {
    const s = burstSlots[burstCursor++ % BURST_SLOTS]!;
    s.age = 0;
    s.life = kind === 'ground' ? 0.62 : 0.5;
    s.h = heightM;
    // Ground bursts sit ON the floor and bloom up; air bursts centre.
    const y = kind === 'ground' ? at[1] + heightM * 0.35 : at[1];
    for (const m of [s.core, s.halo, s.smoke]) { m.position.set(at[0], y, at[2]); m.visible = true; }
  }
  function stepBursts(dt: number): void {
    for (const s of burstSlots) {
      if (s.age === Infinity) continue;
      s.age += dt;
      const u = s.age / s.life;
      if (u >= 1) {
        s.age = Infinity;
        for (const m of [s.core, s.halo, s.smoke]) m.visible = false;
        continue;
      }
      // A fast hot core, a slower halo, and a dark smoke card that outlives both.
      const fade = 1 - u;
      s.core.material.opacity = Math.pow(fade, 2.4);
      s.halo.material.opacity = 0.75 * Math.pow(fade, 1.3);
      s.smoke.material.opacity = 0.55 * Math.min(1, u * 2.2) * fade;
      const grow = 0.35 + 1.25 * Math.sqrt(u);
      s.core.scale.setScalar(s.h * 1.25 * grow);
      s.halo.scale.setScalar(s.h * 2.1 * grow);
      s.smoke.scale.setScalar(s.h * 2.6 * grow);
      s.smoke.position.y += dt * s.h * 0.55;
    }
  }

  /**
   * One frame of the slot machine and the holster travel it drives.
   *
   * `slotLowerAmount` is TOTAL (see the module): the gun is at 1 whenever the
   * dynamite is up and vice versa, so each model's transform is one multiply
   * and neither needs to know which phase the switch is in.
   */
  // ——— THE PROCEDURAL EXPLOSION (stage 3) ————————————————————————————————
  // The stand-in above draws an explosion that is merely VISIBLE; this is the
  // real one: webgpu/explosion-vfx.ts's GPU fireball / smoke / ember / ring,
  // whose look is generated in TSL node graphs rather than sampled from an
  // atlas. Four draw calls in total however many bursts are live (each layer is
  // one dynamic geometry refilled in world space), and it is routed into
  // characterEffects.scene for the same reason the tracers are: that scene
  // renders after the SDF composite against the finished depth buffer, so the
  // composite cannot erase the burst while bodies still occlude it.
  //
  //   ?explosionfx=procedural (default) | standin
  // so the two can be A/B'd without a rebuild and the stand-in keeps its job as
  // the control it was written to be.
  //   ?explosionfx=procedural (default) | atlas | standin
  // `atlas` is the extracted Blood SEQ flipbook — the dev-placeholder art the
  // OWNER asked to keep available while the procedural burst is still finding
  // its shape ("we can also use the placeholder sprite animation for now if its
  // an issue"). It is the authentic mushroom, and it is the reference the
  // procedural path has to match. DEV ONLY: those tiles are gitignored, never
  // committed and never shipped, and the layer falls back to the procedural
  // discs when they are absent (a fresh clone without scripts/link-dev-assets.sh).
  const fxMode = DYN_PARAMS.get('explosionfx') ?? 'procedural';
  let explosionVfx: ExplosionVfx | null = null;
  let burstLayer: BurstLayer | null = null;
  if (fxMode === 'atlas') {
    burstLayer = createBurstLayer(characterEffects.scene);
  } else if (fxMode !== 'standin') {
    try {
      explosionVfx = createExplosionVfx();
      // The owner's size/smoke calls, applied as DEFAULTS rather than left to a
      // caller: a burst that hides the gib is the wrong default whatever the
      // module's own taste is. Three of the four stay overridable (?fxsmoke
      // ?fxlife ?fxgain) and live via __sdfGame.setExplosionFxTuning().
      //
      // `fireScale` IS DELIBERATELY NOT ONE OF THEM. It is the module's own
      // multiplier on the burst's half-height, and `scaleBurstVisual` below
      // already carries the owner's `?fxsize` into that same half-height — so
      // setting both applied `fxSize` TWICE to the procedural path only
      // (0.42 × 0.42 × heightM) while the atlas path took it once. At the
      // shipped knobs that made the procedural burst 0.69 m tall against the
      // atlas quad's 1.65 m: `?explosionfx=atlas` is the reference the plume is
      // supposed to be matched against, and a 2.38x size mismatch is not a
      // comparison. One multiplier, all three modes.
      explosionVfx.setTuning({
        smokeOpacity: fxSmoke, lifeSec: fxLife, gain: fxGain,
        // THE SHAPE SWITCH IS FOUR SETTINGS, NOT ONE. `plumeMix` alone blends
        // the envelope terms, and measured through the differential capture it
        // barely moved the silhouette (cap/stem 20.6 against 21.8): the fire's
        // CAP ROLE is what puts mass up top, and that is a separate knob. An
        // A/B that does not move the number it exists to compare is not an A/B.
        plumeMix: fxPlume,
        fireCapShare: fxPlume,
        capFlatten: 1 - (1 - 0.55) * fxPlume,
        capFireFlatten: 1 - (1 - 0.5) * fxPlume,
      });
      characterEffects.scene.add(explosionVfx.object);
    } catch (e) {
      // Fail OPEN to the stand-in rather than take the page down: a node graph
      // this GPU cannot compile is a look problem, not a reason to have no
      // explosion at all.
      console.error('[sdf-game] explosion-vfx unavailable, using the stand-in:', e);
      explosionVfx = null;
    }
  }

  /** The resolver's `BurstVisual` with the owner's size multiplier applied —
   *  the ONE place `?fxsize` enters, for all three modes. The procedural module
   *  reads the height it is handed times its own `fireScale`, which is left at
   *  1.0 on this page precisely so this line is the only multiplier (see the
   *  setTuning comment above: applying it in both places made the procedural
   *  burst 2.38x smaller than the atlas it is the reference against). */
  function scaleBurstVisual(visual: BurstVisual): BurstVisual {
    return { ...visual, heightM: visual.heightM * fxSize };
  }

  function stepWeaponSlots(dt: number): void {
    slotState = stepWeaponSlot(slotState, dt);

    const gunLower = slotLowerAmount(slotState, 'shotgun');
    // Drop out of frame AND dip the muzzles: that reads as putting a gun away,
    // where a fade reads as a bug.
    gunRig.position.set(0, -0.42 * gunLower, 0.06 * gunLower);
    gunRig.rotation.set(THREE.MathUtils.degToRad(38) * gunLower, 0, 0);
    gunRig.visible = gunLower < 0.999;

    const bundleLower = slotLowerAmount(slotState, 'dynamite');
    bundleRig.position.set(
      BUNDLE_HOLD.pos.x,
      BUNDLE_HOLD.pos.y - 0.34 * bundleLower,
      BUNDLE_HOLD.pos.z,
    );
    // Only the LIVE weapon's model is drawn: during the drop the bundle is
    // still holstered, and it appears the instant the frame changes hands.
    bundleRig.visible = slotState.live === 'dynamite' && heldProp !== null;
  }

  /**
   * One frame of dynamite: the cook machine, the flights, and the hand state.
   *
   * `stepCook` (fpv.ts) is the authority on WHEN a bundle leaves the hand and
   * on the overcook — this only routes its one-shot signal to the throw or to
   * the in-hand detonation, so the timing rules have exactly one home.
   */
  function stepDynamite(dt: number): void {
    dynNow += dt;
    const liveDyn = slotState.live === 'dynamite' && slotReady(slotState);
    const { state: nextCook, signal } = stepCook(
      cook, { press: dynPress && liveDyn, release: dynRelease && liveDyn }, dynNow,
    );
    cook = nextCook;
    dynPress = false;
    dynRelease = false;
    const sig: CookSignal | null = signal;
    if (sig?.kind === 'throw') throwBundle(sig.speedMps);
    else if (sig?.kind === 'overcook') overcookInHand();
    dynCharge = chargeFraction(dynNow - cook.cookStart) * (cook.phase === 'cooking' ? 1 : 0);
    reacquireHeldProp();

    // ——— The flights. Stepped at the flight module's own 120 Hz so the body
    //     contact test is as fine as the bounces are; a bundle that hits a body
    //     detonates there, which is what makes the thing aimable at all.
    for (let i = liveBundles.length - 1; i >= 0; i--) {
      const b = liveBundles[i]!;
      // The ceiling is resolved per bundle PER FRAME, from where the bundle is:
      // see ceilingAt. One frame of lag across a doorway is invisible (the wall
      // boxes catch that frame), and a 5-entry lookup per bundle per frame is
      // nothing next to getting the roof wrong.
      const world = { colliders, ceilM: ceilingAt(b.state.pos[0], b.state.pos[2]) };
      let remaining = Math.min(dt, 0.25);
      let boom: Vec3 | null = null;
      while (remaining > 1e-9 && !flightDetonated(b.state)) {
        const sub = Math.min(remaining, FLIGHT_TUNING.subStepSec);
        remaining -= sub;
        const from = b.state.pos;
        // bounds: null — the dungeon has no arena rect; `colliders` is its
        // real solid geometry and `ceilM` its ceiling.
        b.state = stepFlight(b.state, sub, null, world);
        if (bundleHitsBody(from, b.state.pos)) { boom = b.state.pos; break; }
      }
      if (!boom && flightDetonated(b.state)) boom = b.state.pos;
      if (boom) {
        // Hand the prop back BEFORE the blast so the very next cook has one.
        if (b.prop) { b.prop.object.visible = false; spareBundles.push(b.prop); }
        liveBundles.splice(i, 1);
        detonateAt(boom);
        continue;
      }
      b.prop?.pose({ mode: 'flight', pos: b.state.pos, spin: b.state.spin, fuseBurning: true });
    }
    stepBursts(dt);
    explosionVfx?.update(dt, camera);
    burstLayer?.update(dt, camera);

    // THE MESH-SIDE LIGHT. Aged and written every frame. The pool is
    // PERMANENTLY VISIBLE (see its construction comment): `visible` is never
    // toggled, because that re-keys the scene's LightsNode and recompiles the
    // light variant of every lit material mid-frame. An idle slot is left at
    // intensity 0, which contributes no light.
    for (let i = explosionLights.length - 1; i >= 0; i--) {
      const e = explosionLights[i]!;
      e.age += dt;
      if (e.age >= EXPLOSION_LIGHT.lifeSec) explosionLights.splice(i, 1);
    }
    for (let i = 0; i < explosionLightPool.length; i++) {
      const pl = explosionLightPool[i]!;
      const e = explosionLights[i];
      if (!e) { pl.intensity = 0; continue; }
      const k = explosionLightEnv(e.age);
      pl.position.set(e.pos[0], e.pos[1], e.pos[2]);
      pl.intensity = EXPLOSION_LIGHT.meshPeak * k * fxLightScale;
    }
  }

  // -----------------------------------------------------------------------
  mark('bleed-start');
  // BLEED (bleeding-wounds spec, 2026-08-31). Wounds ooze/spurt/gush per
  // calibre; flying chunks trail droplets; everything settles into floor
  // splats. The pure sim lives in blood-sim.ts, the ledger in
  // bleed-registry.ts; this block owns anchors + the seeded stream.
  // Ships ON (it is the feature); __sdfGame.setBleed(false) is the off
  // gate, and OFF must be pixel-identical to the pre-feature page.
  // -----------------------------------------------------------------------
  const bloodSim = createBloodSim();
  const bleed = new BleedRegistry();

  // -----------------------------------------------------------------------
  // STABLE EMITTER STREAM IDS (blood-connections provenance, 2026-09-13).
  // blood-connections only ever fuses droplets that share a stream tag, so
  // the tag must be a real emitter identity — never a proximity guess.
  //
  // A wound's id is ALLOCATED ONCE (WeakMap on the wound reference the
  // registry stores) and reused by every per-frame droplet and its impact
  // gout, so two adjacent wounds are always two streams. Trail droplets take
  // a namespaced chunk id. Nothing here rolls an RNG and stepBlood never
  // reads `stream`, so the shipped physics is bit-identical.
  // -----------------------------------------------------------------------
  let nextEmitterStream = 1;
  const woundStreamIds = new WeakMap<Wound, number>();
  function woundStreamId(wound: Wound): number {
    let s = woundStreamIds.get(wound);
    if (s === undefined) { s = nextEmitterStream++; woundStreamIds.set(wound, s); }
    return s;
  }
  const TRAIL_STREAM_BASE = 0x40000000;
  function trailStreamId(chunkId: number): number {
    return TRAIL_STREAM_BASE + (chunkId >>> 0);
  }

  // -----------------------------------------------------------------------
  mark('goo-start');
  // GOO — screen-space metaball blood (X1.bleed-look round 2). The owner's
  // brief was "viscous and gooey and shiny blobbys and no hard edges ...
  // kinda like the metablob for the goo system", which is goo-layer.ts's own
  // job description; round 1's ribbons were judged "too thin and
  // uninteresting" because lines cannot be volumes.
  //
  // It shares a body view's light uniform NODES — not copies — so the goo and
  // the flesh stay lit by one rig. That is why it is created HERE, after the
  // actors: those nodes do not exist until a view does.
  // -----------------------------------------------------------------------
  const gooRigView = actors[0]?.view;
  if (gooRigView) {
    gooLayer = createGooLayer(handle.renderer, {
      lightDir: gooRigView.uniforms.lightDir,
      keyColor: gooRigView.uniforms.keyColor,
      lightCfg: gooRigView.uniforms.lightCfg,
    });
    postAa.addSink(gooLayer);
    const t = sdfLayer.targetSize;
    gooLayer.setSize(t.width, t.height);
    // Game defaults. The threshold trades two failure modes against each
    // other and BOTH were hit on the way here:
    //   too low  -> every isolated droplet clears it and draws its own oval
    //               (three rounds of "little oval drops"; the old 0.95 clamp
    //               made this unavoidable, since a lone blob peaks near 1.0)
    //   too high -> only dense overlap draws, so an ordinary pellet hit
    //               renders NOTHING (measured: 10 droplets, zero pixels)
    // 0.6 sits where dense stream sections fuse into connected ropes while a
    // thin hit still reads. Fat blobs and wide blur do the fusing; mist
    // carries the sparse case and the satellite grain the references show.
    // Tune live with __sdfGame.setGooTuning — 1.2+ for heavy ropes, 0.4 for
    // a wetter, beadier read.
    // GAME-PAGE GOO DEFAULTS — the owner's own tuning pass, 2026-08-31,
    // found on the live panel and pasted back verbatim. Set here rather than
    // in GOO_TUNING because that table is shared with the LAB, whose look was
    // tuned separately and must not move.
    //
    // Worth reading as a whole, because it is not where I expected to land:
    // small blobs (0.14), almost NO blur (0.5), stretch at maximum, gloss at
    // maximum, and a nearly stationary gout. That is a sharp, wet, elongated
    // read — the opposite of the round fused mass I kept steering toward.
    gooLayer.setSizeScale(0.14);
    gooLayer.setThreshold(0.65);
    // BLUR OFF (owner, 2026-08-31: "we can remove the blur"). 0 bypasses both
    // blur passes ENTIRELY — not a degenerate copy — so this is also two
    // fewer full-screen passes per frame. The code stays because goo-layer is
    // shared with the LAB, whose look is tuned around blurPx 2.5.
    gooLayer.setBlurPx(0);
    // DEPTH, not overlay. Overlay never depth-tests, so blood paints over the
    // crate it is behind and over the far side of the body it came out of,
    // which reads as a sticker regardless of scale. Overlay was added to
    // route around a depth blocker that turned out not to exist — the real
    // bug was the post-aa sink — so the reconstruction gets to do its job.
    gooLayer.setMode('depth');
    gooLayer.setStretch(4);
    gooLayer.setEdge(2.75);
    gooLayer.setAbsorb(1.6);
    gooLayer.setSpec(2.85);
    gooLayer.setGloss(220);
    gooLayer.setRim(0);
    // shadowRed RETUNED 0.12 -> 0.19 for the dungeon (owner, 2026-09-01).
    // Its whole job is that blood never reads black, and it was calibrated
    // against WHITE gallery walls that this relight deleted — against dark
    // wet stone the old floor was not enough to keep shadowed blood red.
    gooLayer.setShadowRed(0.19);

    // Smooth full-grid goo is the accepted default. Connections and sheets
    // remain opt-in; original reconstruction is available for comparison.
    const gooCandidateBoot = new URLSearchParams(location.search);
    gooReconstruction = gooCandidateBoot.get('goorecon') === 'original' ? 'original' : 'smooth';
    gooLayer.setDensityScale(1);
    gooConnectionsEnabled = gooCandidateBoot.get('gooconnections') === '1';
    gooSheetsEnabled = gooCandidateBoot.get('goosheets') === '1';
    gooLayer.setReconstruction(gooReconstruction);

    // SUPPLEMENTARY IMPACT SPLASH boot flag. Read AFTER the shipping defaults
    // so it can only ever add the new crown, never move a shipped value. It
    // is independent of the goo candidates above.
    impactSplashEnabled = gooCandidateBoot.get('impactsplash') === '1';
    if (impactSplashEnabled) ensureImpactSplashLayer();

    // Live tuning panel (owner ask, 2026-08-31: "add a ui i can tune the goo
    // manually"). The look is a five-knob family found by sweeping two at a
    // time and watching; retyping setGooTuning after every reload is not a
    // sweep. Goo ships ON, so the panel ships VISIBLE with it — this is a
    // debug page and the panel is the reason to turn the layer on at all.
    // Dismissable with __sdfGame.gooPanel(false), which is also what the
    // headless look-capture calls so screenshots frame the room, not the UI.
    const L = gooLayer;
    gooPanel = createGooPanel([
      { key: 'sizeScale', group: 'goo', min: 0.05, max: 1.5, step: 0.01,
        hint: 'World-size multiplier per blob. The scale knob: too high and the mass swallows the room.',
        get: () => L.sizeScale, set: v => L.setSizeScale(v) },
      { key: 'threshold', group: 'goo', min: 0.05, max: 4, step: 0.05,
        hint: 'Density needed to be goo. A LONE blob peaks near 1.0, so below 1 every isolated droplet draws its own shape.',
        get: () => L.threshold, set: v => L.setThreshold(v) },
      { key: 'blurPx', group: 'goo', min: 0, max: 16, step: 0.5,
        hint: 'Gaussian sigma. Wider blur fuses neighbouring peaks BEFORE the threshold sees them — the grapes-to-sheets knob.',
        get: () => L.blurPx, set: v => L.setBlurPx(v) },
      { key: 'stretch', group: 'goo', min: 0, max: 4, step: 0.05,
        hint: 'Velocity elongation cap. 0 = round blobs. High values turn a fast gout into a starburst of needles.',
        get: () => L.stretch, set: v => L.setStretch(v) },
      { key: 'edge', group: 'goo', min: 1.05, max: 4, step: 0.05,
        hint: 'Soft-edge band width, as a multiple of threshold.',
        get: () => L.edge, set: v => L.setEdge(v) },
      { key: 'absorb', group: 'goo', min: 0, max: 3, step: 0.05,
        hint: 'Beer-Lambert thickness. Higher = darker crimson core against a brighter thin fringe.',
        get: () => L.absorb, set: v => L.setAbsorb(v) },
      { key: 'spec', group: 'goo', min: 0, max: 4, step: 0.05,
        hint: 'Specular strength — the wet glint.',
        get: () => L.spec, set: v => L.setSpec(v) },
      { key: 'gloss', group: 'goo', min: 8, max: 220, step: 2,
        hint: 'Specular exponent. Low = broad sheen, high = pinpoint.',
        get: () => L.gloss, set: v => L.setGloss(v) },
      { key: 'rim', group: 'goo', min: 0, max: 1, step: 0.02,
        hint: 'Fresnel rim strength.',
        get: () => L.rim, set: v => L.setRim(v) },
      { key: 'shadowRed', group: 'goo', min: 0, max: 0.6, step: 0.01,
        hint: 'Deep-red floor. Stops heavy absorption or a grazing light from driving blood to black. 0 = off.',
        get: () => L.shadowRed, set: v => L.setShadowRed(v) },
      { key: 'count', group: 'gout', min: 10, max: 300, step: 5,
        hint: 'Slug gout droplets per impact. More = denser mass, but MAX_DROPLETS is 600 across the whole sim.',
        get: () => IMPACT_GOUT.slug.count, set: v => { IMPACT_GOUT.slug.count = Math.round(v); } },
      { key: 'speedMax', group: 'gout', min: 0.5, max: 12, step: 0.25,
        hint: 'Head speed. High values scatter the pulse before it can fuse.',
        get: () => IMPACT_GOUT.slug.speedMax, set: v => { IMPACT_GOUT.slug.speedMax = v; } },
      { key: 'speedMin', group: 'gout', min: 0.2, max: 8, step: 0.1,
        hint: 'Tail speed. The head/tail gap is what stretches the pulse into a rope.',
        get: () => IMPACT_GOUT.slug.speedMin, set: v => { IMPACT_GOUT.slug.speedMin = v; } },
      { key: 'beamGain', group: 'beam', min: 0, max: 8, step: 0.05,
        hint: 'How hard the flashlight drives the key on CHARACTERS. Was a fixed 2.2, which blew bodies past white. Raise for punch, lower if faces flatten out.',
        get: () => beamTuning.gain, set: v => { beamTuning.gain = v; } },
      { key: 'beamShoulder', group: 'beam', min: 0, max: 0.9, step: 0.05,
        hint: 'Highlight rolloff. 0 = hard clip, and a lit body loses its WOUNDS (crater, lip and skin all saturate to the same white). Higher keeps them readable under the beam.',
        get: () => beamTuning.shoulder, set: v => { beamTuning.shoulder = v; } },
      { key: 'beamKeyFloor', group: 'beam', min: 0, max: 1, step: 0.05,
        hint: 'How much of the PRESET key survives when the beam is off. 1.0 = the old bug (characters brightly lit in pitch darkness from a fixed direction). 0 = an unlit body vanishes entirely, because bounce carries hue, not level.',
        get: () => beamTuning.keyFloor, set: v => { beamTuning.keyFloor = v; } },
    ], {
      toggles: [
        {
          // The depth cue, and the reason the goo can read as "pasted on".
          // OVERLAY never depth-tests, so blood paints over the crate it is
          // behind and over the far side of the body it came out of — which
          // the eye reads as a sticker, no matter what the scale is. DEPTH
          // writes a reconstructed depth and interleaves with flesh and floor.
          label: () => `mode: ${L.mode}`,
          hint: 'overlay = always on top (no occlusion). depth = interleaves with the scene.',
          onClick: () => L.setMode(L.mode === 'overlay' ? 'depth' : 'overlay'),
        },
        {
          // The other half of "reads pasted on": the gradient normal tilts a
          // flat CAMERA-FACING base, so every blob is lit as though facing
          // you. The surface normal is reconstructed from the field's own
          // view depth and responds to where the blood actually points.
          label: () => `normals: ${L.surfaceNormals ? 'surface' : 'gradient'}`,
          hint: 'surface = world-oriented, reconstructed from depth. gradient = original screen-space tilt.',
          onClick: () => L.setSurfaceNormals(!L.surfaceNormals),
        },
      ],
      presets: [
        { label: 'blobby',
          values: { sizeScale: 0.35, threshold: 1.2, blurPx: 9, stretch: 0, edge: 1.6,
            absorb: 1, spec: 2, gloss: 55, rim: 0.3, shadowRed: 0.12, count: 140, speedMax: 3.5, speedMin: 1 } },
        { label: 'strands',
          values: { sizeScale: 0.22, threshold: 0.8, blurPx: 5, stretch: 0.8, edge: 1.6,
            absorb: 0.55, spec: 1.4, gloss: 80, rim: 0.3, shadowRed: 0.12, count: 90, speedMax: 8, speedMin: 1.5 } },
        { label: 'shipped',
          values: { sizeScale: 0.14, threshold: 0.65, blurPx: 0, stretch: 4, edge: 2.75,
            absorb: 1.6, spec: 2.85, gloss: 220, rim: 0, shadowRed: 0.12,
            count: 85, speedMax: 0.5, speedMin: 0.2 } },
      ],
    });
  }

  // Wound tuning panel (wound pass r2 task 8). One key table (WOUND_KEYS)
  // drives the sliders, the setter and the COPY text, so the panel cannot
  // emit a key the seam ignores — that drift shipped twice before (setBeam,
  // then the goo panel) and both times the tuning LOOKED applied and was
  // not. The four ramp keys are live uniform writes; boneRatio rebuilds the
  // cast (see rebuildCast — bones are derived at build time and there is no
  // live repack), which is why it commits on release instead of per tick.
  // Wounds read best with actual wounds on screen: aim + fire, then sweep.
  woundPanel = createWoundPanel({
    get: () => ({ ...woundTuning }),
    set: (key, v) => applyWoundTuning({ [key]: v }),
    presets: [
      { label: 'shipped', values: { ...woundTuning } },
      {
        // A "what the ramp can do" reference: knees pulled deep. For seeing
        // the fat/muscle bands at a glance, not a look.
        label: 'raw',
        values: { woundDepthAmp: 1, fatDepth: 0.008, muscleDepth: 0.03 },
      },
    ],
  });
  // Visible on boot, for the same reason the goo panel is (owner ask,
  // 2026-09-02: the sliders could not be found). `woundPanel(true)` was the
  // only way in, and a tuning panel nobody can find is a panel that does not
  // exist — the owner played a whole session against defaults without knowing
  // the knobs were there. `__sdfGame.woundPanel(false)` dismisses it, and
  // capture scripts already guard the seam typeof-style.
  woundPanel?.setVisible(true);

  // `?goreparts=1` lays the gore-part bench out in front of the spawn (see
  // spawnGoreShowcase). It needs a live actor for the palette, so it runs here
  // rather than at the top of boot, and it is idempotent: the seam re-lays it
  // wherever the player is standing.
  if (goreShowcaseOn) {
    const n = spawnGoreShowcase();
    console.log(`[gore-parts] showcase: ${n} parts in front of the spawn`);
  }
  // `?gibparts=sprite` (or `?gibsprites=1`) lays the SPRITE bench instead — the
  // reference look, for judging the approach.
  const gibPartsMode = bootSearch.get('gibparts');
  if (gibPartsMode === 'sprite' || gibPartsMode === 'sheet' || bootSearch.get('gibsprites') === '1') {
    void ensureGibAtlas(gibPartsMode === 'sheet' ? 'sheet' : 'placeholder').then(() => {
      const n = laySpriteBench();
      console.log(`[gib-sprites] bench: ${n} billboards in front of the spawn`);
    });
  }
  // `?gibrender=sprite` needs the GENERATED sheet loaded BEFORE the first
  // detonation, because a blast is synchronous and cannot await a fetch. This is
  // the only preload in the path; a player who detonates before it resolves gets
  // marched pieces for that one blast (and a warning), never a body with no gore.
  // `?gibrender=carve` builds the archetype library at BOOT, not on the first
  // blast: the carve is ~2 s of CPU (18 pieces x surface nets), and paying that
  // inside a detonation would be a two-second freeze at the worst possible
  // moment. Once built it is reused for every zombie in the session.
  if (gibRenderMode === 'carve') {
    // The ONLY boot-time carve trigger. Under the shipped default URL (no
    // ?gibrender=) this branch does not run: measured 2026-09-16, the default
    // mode is 'march' and the historical carve build cost is NOT boot cost.
    mark('carve-boot-scheduled');
    setTimeout(() => { mark('carve-build-start'); ensureCarvedLibrary(); mark('carve-build-end'); }, 0);
  }
  if (gibRenderMode === 'sprite') {
    void ensureGibAtlas('sheet').then((n) => {
      console.log(`[gib-sprites] blast render mode: sprite, ${n} frames, `
        + `live cap ${gibSpriteLiveCap}, rest cap ${gibSpriteRestCap}, size x${gibSpriteSizeScale}`);
    });
  }
  // `?gibrender=assets` (task 2) preloads the committed offline sets at boot, so
  // the first detonation has meshes to deform. It is a fetch + decode, not an
  // extraction, so unlike carve it costs no surface nets; a body gibbed before
  // it resolves still gets marched pieces (counted), never no gore.
  if (gibRenderMode === 'assets') {
    mark('gib-assets-boot-scheduled');
    void ensureGibAssets().then(() => {
      mark('gib-assets-boot-ready');
      console.log(`[gib-assets] blast render mode: assets, armed=${gibAssetArmed()}`);
    });
  }

  // DYNAMITE / GIB (dynamite-panel.ts). Same contract as the other three: ships
  // VISIBLE but COLLAPSED at the fourth slot, so its title bar is findable while
  // it covers nothing. The two presets are the comparison the owner asked for —
  // the split piece set with a pool wide enough not to degrade it, and the
  // one-chunk-per-limb shape he rejected, one click apart.
  dynamitePanel = createDynamitePanel({
    get: dynamiteTuningValues,
    set: (key, v) => applyDynamiteTuning({ [key]: v } as Partial<DynamiteTuningValues>),
    presets: [
      { label: 'split', values: { mode: 2, bones: 2, maxchunks: 64, tearSec: 0.1 } },
      { label: 'tubes (old)', values: { mode: 0, bones: 0, maxchunks: 24 } },
      { label: 'plume', values: { plume: 1, capflat: 0.55, ringreach: 1.4 } },
      { label: 'ball (old)', values: { plume: 0 } },
    ],
  });
  dynamitePanel.setVisible(true);

  // VHS tuning panel. The rows are derived from VHS_TERM_RANGES and every
  // emitted call is keyed by a `keyof VhsTerms`, so unlike the setBeam bug the
  // COPY text cannot name a key the setter ignores. Ships visible+collapsed
  // like its siblings; capture scripts dismiss it with __sdfGame.vhsPanel(false).
  vhsPanel = createVhsPanel({
    setVhs: (preset) => { postAa.setVhs(preset); return postAa.vhs; },
    setVhsTerm: (name, value) => postAa.setVhsTerm(name, value),
    get vhs() { return postAa.vhs; },
    get vhsTerms() { return postAa.vhsTerms; },
  });
  vhsPanel.setVisible(true);
  // The lab's droplet renderer, game-tuned: depth-WRITING cutout droplets
  // (the SDF composite's depth test then occludes droplets both ways — see
  // BloodViewOpts.dropletDepthWrite) at sim size (the lab's 0.45 is close-
  // camera compensation; BLOOD_TRAIL.size is already game-camera tuned).
  // Splats keep the lab's soft depthWrite:false — the floor's depth already
  // arbitrates them, and their 0.005 m lift beats z-fighting.
  // dropletViewScale 0.5: the owner's first-look verdict (2026-08-31) was
  // "really big" at FPV range — the lab's own 0.45 compensation exists for
  // exactly this. 0.5 keeps them a hair beefier than the lab since the game
  // wants the blood to READ; the deeper look change (gooey spray + mist
  // instead of sprite blobs) is a tracked exploration, not a scale knob.
  // X1.bleed-look pass 1 (owner: "big oval blood cells"): aggressive filament
  // stretch with volume-conserving thinning (fast spray reads as streaks, slow
  // drips stay beads) + a mist haze mesh (alphaHash so it survives the
  // composite's depth test while reading soft).
  const bloodView = createBloodView({
    dropletDepthWrite: true,
    dropletViewScale: 0.5,
    stretch: { k: 0.5, max: 3.5, thin: true },
    mist: true,
    // Round 2 (owner): "ribbons and blood trails to create cohesive lines of
    // fluid" — beads sweep tapered strips through their path history.
    ribbons: true,
  });
  for (const o of bloodView.objects) {
    o.visible = true; // ships ON (it is the feature); setBleed(false) hides
    scene.add(o);
  }

  // Goo ships ON, so apply the view state setGoo(true) would have set. Placed
  // here rather than beside the goo tuning above because bloodView does not
  // exist yet at that point in main().
  //
  // Beads off: the goo surface replaces them, and drawing both renders the
  // same particles twice. MIST STAYS — it is the sparse-case floor. The goo
  // only draws where droplets OVERLAP, so an ordinary pellet hit crosses no
  // threshold and draws nothing; with mist hidden too the result is a wound
  // with no blood at all (reproduced headless, 2026-08-31).
  if (gooEnabled) {
    bloodView.setBeadsVisible(false);
    bloodView.setMistVisible(true);
    // ...AND show the panel. It used to appear only via setGoo(true), which
    // this boot path deliberately does not call — so the panel that exists to
    // make the goo tunable was invisible on the page where goo ships ON, and
    // the owner had to toggle the layer off and on to get at it (owner ask,
    // 2026-09-01: "it should be default on tbh").
    gooPanel?.setVisible(true);
  }
  // The bleed stream is `rngStreams.bleed` (rng.ts): ONE seeded stream for
  // EVERY bleed decision (spawns, trails, splat stamps) — advanced only while
  // bleed is enabled, so setBleed(false) freezes the subsystem exactly (OFF
  // mid-stream = ON-stream-paused).
  let bleedEnabled = true;

  // GUT ROPES — at most one per body (entrails-spawn.shouldSpill): the first
  // qualifying cavity wound spawns, a second TEARS the rope free instead of
  // growing another, which bounds both the verlet sim and the goo particle
  // count. The chain owns node positions (entrails.ts); the sim only holds
  // this rope's 'gut' droplets — stepBlood skips that kind — so the goo pass
  // draws the rope as fused metaballs riding the wound's emit point.
  const gutRopes = new Map<number, { chain: GutChain; wound: Wound; droplets: Droplet[] }>();
  /** The one spill decision, taken at stamp time where cluster membership is
   *  free. Call for EVERY stamped wound (live fire routes through
   *  registerBleed; the capture twins stamp through stampBlast, so they call
   *  this directly). Rolls bleedRng — see the freeze note on registerBleed. */
  function spillVerdict(a: ZombieActor, wound: Wound): void {
    const entry = gutRopes.get(a.id);
    const verdict = shouldSpill(wound, entry !== undefined, rngStreams.bleed);
    if (verdict === 'none') return;
    if (verdict === 'tear') {
      // Keep the entry: the detached chain keeps falling/settling in
      // stepGutRopes, and its presence still blocks a second rope.
      if (entry) gutRopes.set(a.id, { ...entry, chain: detachGutChain(entry.chain) });
      return;
    }
    const { anchor } = woundEmitAnchorAndNormal(a.posed().prims, wound, a.pose().yaw);
    gutRopes.set(a.id, {
      chain: makeGutChain(anchor, {
        coilTightness: woundTuning.coilTightness,
        springiness: woundTuning.springiness,
      }),
      wound, droplets: [],
    });
  }

  /** Per-frame rope sim, BEFORE the bleed block (so stepBlood sees the same
   *  frame it does): pin to the wound's current emit point — the anchor is
   *  recomputed from the CURRENT posed prims, which is what makes the rope
   *  ride the gait — step the chain, then copy node positions into the
   *  rope's persistent 'gut' droplets. Uses only the actor's already-posed
   *  prims; never re-poses. Runs regardless of bleedEnabled: a hanging gut
   *  is body state, not spray, and stepping spends no RNG. */
  function stepGutRopes(dt: number): void {
    for (const a of actors) {
      let entry = gutRopes.get(a.id);
      if (!entry) continue;
      // Body down (falling or settled) → the rope tears free. It keeps its
      // verlet momentum, falls, settles, freezes (entrails.ts).
      if (entry.chain.attached && a.debug().phase !== 'standing') {
        entry = { ...entry, chain: detachGutChain(entry.chain) };
        gutRopes.set(a.id, entry);
      }
      if (entry.chain.attached) {
        const { anchor } = woundEmitAnchorAndNormal(a.posed().prims, entry.wound, a.pose().yaw);
        entry = { ...entry, chain: pinGutChain(entry.chain, anchor) };
        gutRopes.set(a.id, entry);
      }
      entry = { ...entry, chain: stepGutChain(entry.chain, dt) };
      gutRopes.set(a.id, entry);

      // Keep the rope's droplets in the sim. They are created once and then
      // MOVED (Droplet.pos is mutable by contract; stepBlood skips 'gut'),
      // unless particle pressure evicted them (MAX_DROPLETS shift) — then
      // rebuild at the nodes' current positions.
      const nodes = entry.chain.nodes;
      const live = entry.droplets.length === nodes.length
        && entry.droplets[0] !== undefined
        && bloodSim.droplets.includes(entry.droplets[0]);
      if (!live) {
        const fresh: Droplet[] = nodes.map(n => ({
          pos: [...n.pos] as [number, number, number],
          vel: [0, 0, 0] as [number, number, number],
          age: 0, life: Infinity,
          size: woundTuning.gutSize,
          kind: 'gut',
          // The rope belongs to the wound that spilled it: reuse that wound's
          // stable stream id so the gut nodes are attributed like every other
          // emitter rather than falling through as untagged.
          stream: woundStreamId(entry!.wound),
        }));
        for (const d of fresh) bloodSim.droplets.push(d);
        entry = { ...entry, droplets: fresh };
        gutRopes.set(a.id, entry);
      } else {
        const invDt = dt > 1e-6 ? 1 / dt : 0;
        for (let i = 0; i < nodes.length; i++) {
          const n = nodes[i]!;
          const d = entry.droplets[i]!;
          // Honest velocity — the goo stretch follows node motion, so a
          // swinging rope smears, a settled one doesn't.
          d.vel[0] = (n.pos[0] - n.prev[0]) * invDt;
          d.vel[1] = (n.pos[1] - n.prev[1]) * invDt;
          d.vel[2] = (n.pos[2] - n.prev[2]) * invDt;
          d.pos[0] = n.pos[0];
          d.pos[1] = n.pos[1];
          d.pos[2] = n.pos[2];
        }
      }
    }
  }
  /** Bleed's own sim clock — an accumulator, never wall time, so hand-
   *  stepped captures are deterministic. */
  let bleedClock = 0;
  const lastSplashShot = new WeakMap<ZombieActor, number>();
  function registerBleed(
    a: ZombieActor, wound: Wound, kind: 'pellet' | 'slug' | 'stump',
    contact?: { point: Vec3; incoming: Vec3 },
  ): void {
    if (!bleedEnabled) return;
    bleed.register(a.id, wound, kind, bleedClock);
    // IMPACT GOUT (blood-viscosity spec §a) — the dense one-tick pulse, at
    // the wound's own anchor so it leaves the body where the hole is. Fired
    // here rather than at each call site because both the impact path and
    // the sever path already funnel through this function, and two copies
    // would drift. Uses the SAME bleedRng, so setBleed(false) freezes gouts
    // and the trickle together and captures stay deterministic.
    const { anchor, normal } = woundEmitAnchorAndNormal(a.posed().prims, wound, a.pose().yaw);
    // The gout sprays back along the incoming shot; spawnImpactGout negates
    // what it is handed, and the wound normal already points OUT of the
    // body, so pass the inward direction. The wound's stable stream id tags
    // the gout so it fuses with this wound's per-frame droplets and no
    // other emitter's.
    const streamId = woundStreamId(wound);
    spawnImpactGout(bloodSim, kind, anchor, [-normal[0], -normal[1], -normal[2]], rngStreams.bleed, streamId);
    // SUPPLEMENTARY entry splash (opt-in, ?impactsplash=1). Projectile hits
    // use the contact and incoming shot below; stumps use their outward
    // wound normal. The seed is
    // derived from the wound's stable stream id, NOT from bleedRng, so it
    // draws no random numbers and leaves the shipped gout/bleed stream
    // bit-identical.
    const shotgunShot = wound.shot?.weapon === 'shotgun' ? wound.shot.shotId : undefined;
    const repeatedPellet = shotgunShot !== undefined && lastSplashShot.get(a) === shotgunShot;
    if (impactSplashEnabled && impactSplashLayer && !repeatedPellet) {
      if (shotgunShot !== undefined) lastSplashShot.set(a, shotgunShot);
      // An immediate entry splash belongs to the projectile's actual surface
      // contact, not the wound's reconstructed/carved anchor. Send it back
      // toward the incoming shot and start just outside the contacted skin.
      // Stumps have no projectile contact and retain their wound-normal path.
      const splashDirection: Vec3 = contact
        ? [-contact.incoming[0], -contact.incoming[1], -contact.incoming[2]]
        : normal;
      const splashOrigin: Vec3 = contact
        ? [contact.point[0] + splashDirection[0] * 0.035,
           contact.point[1] + splashDirection[1] * 0.035,
           contact.point[2] + splashDirection[2] * 0.035]
        : anchor;
      impactSplashLayer.emit(splashOrigin, splashDirection, (streamId * 2654435761) >>> 0, { profile: impactSplashProfiles[kind] });
    }
    // Gut-rope decision for this stamped wound — placed BELOW the
    // !bleedEnabled guard on purpose: the roll spends bleedRng, and the
    // invariant above (OFF mid-stream = ON-stream-paused) only holds if
    // nothing advances the stream while bleed is frozen. The capture twins
    // (stampWoundAt/explode) call spillVerdict directly instead.
    spillVerdict(a, wound);
  }

  // Wire every actor's severs into the chunk spawner (template = that
  // actor's own look — the chunk shades like the flesh it came from), and
  // each sever's stump wound into the bleed ledger (the gushing emitter —
  // the wound is the actor's own reference, so the anchor rides the body).
  onSeverDispatch = (a, piece, stumpWound) => {
    telemetry.event('sever', { actor: a.id, limb: piece.limb });
    spawnChunkPiece(piece, { uniforms: a.view.uniforms, volumeTexture: a.view.volumeTexture });
    if (stumpWound) registerBleed(a, stumpWound, 'stump');
  };

  // -----------------------------------------------------------------------
  mark('hud-start');
  // HUD: frame time, bodies on screen, probeWeight, where you are.
  // -----------------------------------------------------------------------
  // THE RETICLE. A target graphic rather than a bare dot, per the owner: outer
  // ring, four ticks and a centre pip, drawn as one inline SVG so it stays crisp
  // at any size and costs no asset. It is the aim point in free-aim mode.
  {
    reticleEl = document.createElement('div');
    reticleEl.setAttribute('style',
      'position:fixed; left:50%; top:50%; width:34px; height:34px; z-index:35;'
      + ' margin:-17px 0 0 -17px; pointer-events:none;'
      + ' filter:drop-shadow(0 0 2px rgba(0,0,0,0.9));');
    reticleEl.innerHTML =
      '<svg viewBox="0 0 34 34" width="34" height="34" aria-hidden="true">'
      + '<circle cx="17" cy="17" r="10.5" fill="none" stroke="#ffd98a"'
      + ' stroke-width="1.4" opacity="0.85"/>'
      + '<circle cx="17" cy="17" r="1.6" fill="#ffd98a" opacity="0.95"/>'
      + '<g stroke="#ffd98a" stroke-width="1.4" opacity="0.9">'
      + '<line x1="17" y1="1.5" x2="17" y2="6.5"/>'
      + '<line x1="17" y1="27.5" x2="17" y2="32.5"/>'
      + '<line x1="1.5" y1="17" x2="6.5" y2="17"/>'
      + '<line x1="27.5" y1="17" x2="32.5" y2="17"/>'
      + '</g></svg>';
    document.body.appendChild(reticleEl);
  }

  const hudEl = document.getElementById('hud');
  const hud = { lockHint: true };
  let frameEma = 0;
  mark('boot-time');
  const bootTime = performance.now();

  // ---- ACTOR VISIBILITY CULL (2026-09-09) --------------------------------
  //
  // Before this, `setBodies` took EVERY actor in the level. The SDF proxy
  // boxes ship `frustumCulled = false` ("the proxy IS the bound") so three
  // culls nothing, and the GPU occluder pre-pass has been off since
  // 2026-09-01 — so an enemy behind you, or behind a wall, marched like any
  // other. That matters more than it used to: enemies now pursue across
  // rooms, so the player's room holds more bodies than it spawns (bench
  // census: room 3 spawns 3, saw 8).
  //
  // WHAT THIS IS NOT. Phase 0 measured the mesh-skeleton path at 0.5 ms and
  // the encounter director at 0.2 ms, so there is deliberately NO simulation
  // LOD here — AI, motion and rig run for every actor exactly as before, and
  // cross-room pursuit is untouched. This culls only what gets MARCHED, which
  // is 75-83% of the frame.
  //
  // WHERE THE WIN ACTUALLY IS. An off-screen proxy box clips to no fragments
  // and was already nearly free, so the frustum half buys little on its own.
  // The occluded case is the real one: on-screen but behind a wall, which
  // rasterises a full box and marches it. Hence the clearSight test.
  //
  // SAFETY. A wrongly culled visible body is a visible bug; a wrongly kept one
  // is only a cost. So: two sight probes (torso and head — a body leaning out
  // from cover shows its head first), and becoming visible is INSTANT while
  // going invisible must persist for CULL_DWELL_MS. Both biases point at
  // drawing too much, never too little.
  /** id -> the last time this actor was seen. Keyed by id, not index: actors
   *  are spawned and gibbed, and an index would transfer one body's grace
   *  period to another. */
  /**
   * SCREEN COVERAGE ESTIMATE (2026-09-09), for telemetry only.
   *
   * The march is the dominant pass, and the one lever with a measured large
   * number is PIXEL COUNT (quartering the pixels bought -54%), so its cost
   * tracks COVERED PIXELS, not body count. NOTE the model once quoted here
   * (18.6 ms + 0.237 ms per 1k px, X1.4) predates the `'bodies'` interlace
   * halving the march target, and a 6x cut in the step budget bought only
   * -6..-31% (mostly single-digit) — the cost is per-PIXEL, not per-step. See
   * docs/dev-notes/2026-08-31-game-perf-baseline/notes.md:204-238.
   *
   * Captures record
   * `bodiesOnScreen` and `totalWounds` but nothing about area, which makes the
   * two candidate explanations for the close-up spikes indistinguishable:
   * "wounds are expensive" vs "a body filling the screen is expensive and you
   * happen to shoot things that are close".
   *
   * This is a CPU ESTIMATE, deliberately not the GPU occupancy probe: that one
   * is a readback, and the telemetry contract is no GPU waits or reads during
   * live play — measuring with it would distort what it measures. Each visible
   * body's bounding sphere is projected to screen and its disc area summed.
   *
   * KNOWN AND ACCEPTED IMPRECISION: overlapping bodies double-count, and no
   * occlusion is applied, so this OVERESTIMATES when bodies stack. It is a
   * monotonic proxy for "how much of the view is flesh", not a pixel count —
   * read it as a trend against frame time, never as an absolute.
   */

  /** Recompute this frame's visible set. Called once, before the draw.
   *
   *  Dwell is measured on SIM time, not wall time (2026-09-10). In live play
   *  `tick` is called once per frame with the real frame delta, so simClockMs
   *  tracks elapsed wall time almost exactly and the 250 ms grace behaves as it
   *  always has. Under a fixed-step replay or a hand-stepped capture it becomes
   *  EXACT instead of approximate, which is the entire point. The one visible
   *  consequence: while the render lock is engaged `tick` does not run, so the
   *  clock does not advance and nothing expires out of the dwell — a frozen
   *  scene stays frozen, which is what the lock means. */
  /** Run 5b: the per-body refine gate, shared by both cull modes. `centre` is
   *  the torso centre (null = no torso cluster: nothing to measure, so no
   *  twin); `kept` is the cull's verdict (always true with the cull off).
   *  Reads `sightA` for the camera. Rule: the twin is drawn only for a
   *  STANDING body (dead never refines — in either mode) inside the medium
   *  band, on screen, with hysteresis so an edge-walking body cannot flicker.
   *  Returns whether the twin is drawn. */
  function gateRefineTwin(a: ZombieActor, centre: Vec3 | null, kept: boolean): boolean {
    const twin = a.view.refineObject;
    if (!twin) return false;
    if (!centre) { twin.visible = false; return false; }
    const dx = centre[0] - sightA[0], dy = centre[1] - sightA[1], dz = centre[2] - sightA[2];
    const d = Math.hypot(dx, dy, dz);
    const wasOn = twin.visible;
    const inBand = wasOn
      ? d >= refineBand.near - refineBand.hysteresis && d <= refineBand.far + refineBand.hysteresis
      : d >= refineBand.near && d <= refineBand.far;
    const on = kept && sdfLayer.refine && a.refineEligible() && inBand;
    twin.visible = on;
    return on;
  }

  function updateVisibleActors(): void {
    const now = simTimeMs();
    cullCounts.total = actors.length;
    if (!actorCullEnabled) {
      visibleActors = actors;
      cullCounts.visible = actors.length;
      // Cull off: the frustum/dwell work is skipped, but the refine gate is
      // NOT — the spec's first rule (a dead body never refines) has to hold in
      // both modes, so a body that collapses with the cull off still loses its
      // twin. Same band + hysteresis, every actor, no visibility work.
      sightA[0] = camera.position.x; sightA[1] = camera.position.y; sightA[2] = camera.position.z;
      refinedBodies = 0;
      for (const a of actors) {
        const torso = a.posed().clusters.find(c => c.limb === 'torso');
        if (gateRefineTwin(a, torso ? torso.center as Vec3 : null, true)) refinedBodies++;
      }
      coverage.screenFrac = 0; coverage.nearestM = 0; coverage.biggestFrac = 0;
      return;
    }
    projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projScreen);
    sightA[0] = camera.position.x; sightA[1] = camera.position.y; sightA[2] = camera.position.z;
    const out: ZombieActor[] = [];
    const tw = sdfLayer.marchTarget.width, th = sdfLayer.marchTarget.height;
    const px = Math.max(1, tw * th);
    const halfHpx = th / 2;
    const tanHalfFov = Math.tan((camera.fov * Math.PI / 180) / 2);
    let area = 0, nearest = 0, biggest = 0;
    refinedBodies = 0;
    for (const a of actors) {
      const torso = a.posed().clusters.find(c => c.limb === 'torso');
      // No torso cluster (mid-gib, exotic body): never cull what we cannot
      // measure — fall back to drawing it. No distance to band-test either, so
      // the refine twin stays off for it.
      if (!torso) {
        out.push(a); lastSeenMs.set(a.id, now);
        gateRefineTwin(a, null, true);
        continue;
      }
      const c = torso.center;
      bodySphere.center.set(c[0], c[1], c[2]);
      let seen = frustum.intersectsSphere(bodySphere);
      if (seen) {
        // Two probes: torso centre, then a head-height point. A body edging
        // out of cover reveals its head before its chest.
        const head: Vec3 = [c[0], c[1] + 0.6, c[2]];
        seen = clearSight(sightA, c as Vec3, colliders) || clearSight(sightA, head, colliders);
      }
      if (seen) lastSeenMs.set(a.id, now);
      const since = now - (lastSeenMs.get(a.id) ?? -Infinity);
      const kept = seen || since < CULL_DWELL_MS;
      if (kept) out.push(a);

      // Run 5b: the per-body refine gate (see gateRefineTwin).
      if (gateRefineTwin(a, c as Vec3, kept)) refinedBodies++;

      // Coverage estimate — only for bodies actually seen this frame, so a
      // body coasting on its dwell grace does not inflate the area.
      if (seen) {
        const dx = c[0] - sightA[0], dy = c[1] - sightA[1], dz = c[2] - sightA[2];
        const dist = Math.hypot(dx, dy, dz);
        if (nearest === 0 || dist < nearest) nearest = dist;
        const r = bodySphere.radius;
        // Camera inside the bound: treat as full screen rather than dividing
        // by a distance that is about to go through zero.
        const frac = dist <= r ? 1 : Math.min(1, Math.PI * ((r / dist) * halfHpx / tanHalfFov) ** 2 / px);
        area += frac;
        if (frac > biggest) biggest = frac;
      }
    }
    coverage.screenFrac = Math.min(1, area);
    coverage.nearestM = nearest;
    coverage.biggestFrac = biggest;
    visibleActors = out;
    cullCounts.visible = out.length;
  }

  function bodiesOnScreen(): number { return cullCounts.visible; }

  function updateHud() {
    if (!hudEl) return;
    const where = enclosureKeyAt(player.pos[0], player.pos[2]);
    const slot = slotState.phase !== 'up'
      ? `switching ${slotState.target}`
      : slotState.live === 'dynamite'
        ? `2 DYNAMITE ${cook.phase === 'cooking'
          ? `${(dynCharge * 100).toFixed(0)}% LIT`
          : `${liveBundles.length} out`}`
        : '1 GRAPESHOT';
    hudEl.textContent =
      `${frameEma.toFixed(1)} ms · bodies ${bodiesOnScreen()}/${actors.length}` +
      ` · ${where} · probe ${probeWeight.toFixed(2)}` +
      ` · [${slot}]` +
      (slotState.live === 'shotgun'
        ? infiniteAmmo ? ' · shells ∞' : ` · shells ${shells}/${MAGAZINE_CAPACITY}`
        : '') +
      (slugMode ? ' · ● SLUG (E to switch back)' : ' · PELLETS (E = slug)') +
      (sdfLayer.halfRate
        ? ` · HALF30 ${sdfLayer.halfRateMode === 1 ? 'reproj' : 'hold'}`
        : '') +
      (freeAimOn ? ' · FREE-AIM (G)' : ' · mouselook (G)') +
      // The wound-zone step multiplier, so a setWoundStep() flip is visible
      // (owner: "hard to tell"). 0 = the shipped constant.
      ` · wstep ${(() => { const z = actors[0]?.view.uniforms.perfCfg.value.z ?? 0; return z > 0 ? z.toFixed(2) : `${WOUND_STEP_MUL} (ship)`; })()}` +
      (adaptiveEnabled ? ` · ADAPTIVE r${adaptiveState.rung}` : '') +
      (sdfLayer.temporalStart.on ? ' · TSTART' : '') +
      (reloadSpeed !== 1 ? ` · RELOAD x${reloadSpeed} (T)` : '') +
      (hud.lockHint ? ' · click to lock' : '') +
      (wanderFrozen ? ' · FROZEN' : '');
  }

  // -----------------------------------------------------------------------
  mark('frameloop-start');
  // Frame loop.
  // -----------------------------------------------------------------------
  // ?frozen=1 — boot with the wanderers frozen from frame 0. The boot loop
  // starts stepping the moment the page loads, so a driver that freezes via
  // the seam has already inherited a non-deterministic amount of wander;
  // captures that must be reproducible across boots (pixel parity, staged
  // benches) need the freeze to predate the first frame. Default unchanged.
  let wanderFrozen = new URLSearchParams(location.search).has('frozen');
  /** The distance-crowd bench pins the player's POSE for the whole leg
   *  (`bench({ holdPlayer: true })`). The firefight's frame-0 teleport would
   *  overwrite the caller's placePlayer() framing, and the walk input (keys /
   *  autopilot) would drift the camera; with this on, tick() forces the input
   *  to zero. Ordinary play never sets it. */
  let holdPlayerPose = false;
  /** TASK-6 DIAGNOSTIC RENDER LOCK. When true, tick(dt) returns BEFORE any
   *  simulation mutation (player step, bob, recoil, weapon smoothing, flash
   *  envelopes, smoke, chunks) — __sdfGame.step(n) becomes n pure re-renders
   *  of a bit-frozen state, and readback seams (hashSurface/readSurfaceAt)
   *  see a deterministic frame. freeze() alone never did this: it only pins
   *  the WANDERERS, while stepPlayer/bob/weapon smoothing kept mutating the
   *  camera and view-model every tick — two "identical" renders drifted as
   *  the teleported player's head-bob decayed. Default OFF; only the gate
   *  sets it, so legacy gameplay is untouched. `?simidle=1` boots straight into
   *  the lock (the bench's boot): the page's own rAF loop must not wander the
   *  cast during the settle, or the scenario it drives afterwards starts from a
   *  wall-clock-dependent state. `bench()` clears it before running. */
  let simLocked = new URLSearchParams(location.search).has('simidle');
  /** Whether the hulls have been built for the CURRENT frozen stretch — see
   *  the frozen-from-boot hull build in tick. */
  let frozenHullBuilt = false;
  let frameCount = 0;
  /** The __sdfGame.placeMarker debug sphere. */
  let marker: THREE.Mesh | null = null;
  /** Headless driver autopilot: walk toward (x, z) until within 0.25 m. */
  let autopilot: { x: number; z: number } | null = null;
  /** Stuck recovery: a wanderer frozen/standing on the path blocks the line
   *  head-on (the capsule push exactly opposes the intent, no slide). If we
   *  stop making progress, strafe around the obstacle for a beat. */
  let stuckT = 0;
  let strafeT = 0;
  let strafeDir = 1;
  let lastWalkPos: [number, number] | null = null;

  function tick(dt: number) {
    if (simLocked) return; // render-lock: drawFn still runs; nothing mutates.
    // The sim clock advances ONLY here, from the step's own dt — never from
    // wall time. This is the single source of "how much simulated time has
    // passed", so every dwell/timer that reads it is reproducible under a
    // replay. See the declaration next to lastSeenMs for the why.
    advanceSimClock(dt);
    simFrame++;
    // BLAST REFRACTION ages on SIM time, like every other sim clock — never
    // wall time — so a frozen capture advances it exactly one frame per step and
    // an on/off pair at the same frame is a real comparison (post-aa.ts).
    postAa.stepBlastDistort(dt);
    // Billboard the gib sprites. Cheap (a handful of quads) and it has to be per
    // frame: a piece that stops facing the camera vanishes edge-on.
    for (const s of spriteBenchSprites) billboardGib(s, camera);
    segMeshRenderer?.stepDebris(dt);
    // ONE INPUT FRAME PER TICK (stage 3). Live, this snapshots the listeners'
    // accumulated state; replaying, it is the player's next frame. Both go
    // through applyInputFrame, so the input path is identical either way; and
    // while recording, the frame the tick CONSUMED is what gets logged (not a
    // re-read after the fact, which could see a later event).
    const inputFrame = replayActive ? currentInputFrame : readInputFrame();
    applyInputFrame(inputFrame);
    if (replayActive) {
      // A recorded frame is consumed by exactly ONE tick. Reset to a neutral
      // frame (keeping the last look) so a repeated step — the bench's warmup,
      // say — cannot re-fire the same shot.
      currentInputFrame = neutralInput(inputFrame);
      replayFrame++;
    } else {
      // The frame the tick CONSUMED, not a re-read after the fact: a live
      // event that lands mid-tick must belong to the next frame, not this one.
      if (recorder) { recorder.push(inputFrame); updateDemoHud(); }
    }
    const held = inputFrame.keys;
    let input: MoveInput = holdPlayerPose
      ? { x: 0, z: 0, jump: false }
      : {
        x: (held.includes('KeyD') ? 1 : 0) - (held.includes('KeyA') ? 1 : 0),
        z: (held.includes('KeyW') ? 1 : 0) - (held.includes('KeyS') ? 1 : 0),
        jump: held.includes('Space'),
      };
    if (autopilot && !holdPlayerPose) {
      const dx = autopilot.x - player.pos[0];
      const dz = autopilot.z - player.pos[2];
      if (Math.hypot(dx, dz) < 0.25) {
        autopilot = null;
        input = { x: 0, z: 0, jump: false };
      } else if (strafeT > 0) {
        strafeT -= dt;
        input = { x: strafeDir, z: 0.2, jump: false };
      } else {
        player.yaw = Math.atan2(dx, -dz);
        input = { x: 0, z: 1, jump: false };
      }
      if (lastWalkPos
        && Math.hypot(player.pos[0] - lastWalkPos[0], player.pos[2] - lastWalkPos[1]) < 0.02) {
        stuckT += dt;
        if (stuckT > 0.5) {
          // Strafe AWAY from whatever is ahead: nearest zombie within 1.2 m
          // in front picks the side; walls just get the fallback flip.
          const sy = Math.sin(player.yaw), cy = Math.cos(player.yaw);
          let bestLat: number | null = null;
          let bestFwd = Infinity;
          for (const a of actors) {
            const ox = a.pose().pos[0] - player.pos[0];
            const oz = a.pose().pos[2] - player.pos[2];
            const fwdDist = ox * sy - oz * cy;
            const lat = ox * cy + oz * sy;
            if (fwdDist > 0 && fwdDist < 1.2 && Math.abs(lat) < 0.9 && fwdDist < bestFwd) {
              bestFwd = fwdDist;
              bestLat = lat;
            }
          }
          strafeDir = bestLat !== null ? (bestLat > 0 ? -1 : 1) : -strafeDir;
          strafeT = 0.8;
          stuckT = 0;
        }
      } else {
        stuckT = 0;
      }
      lastWalkPos = [player.pos[0], player.pos[2]];
    }
    // Zombies are soft obstacles: one fat AABB each, rebuilt per frame.
    const zombieBoxes = actors.filter(a=>!a.motionFrame()?.collapsed).map(a => {
      const p = a.pose().pos;
      return { min: [p[0] - 0.35, 0, p[2] - 0.35] as Vec3, max: [p[0] + 0.35, 1.8, p[2] + 0.35] as Vec3 };
    });
    stepPlayer(player, input, dt, [...colliders, ...zombieBoxes]);

    // Damage transitions use their own clock; frozen pose captures must
    // still show a newly selected preset. Refresh exclusions as it grows.
    for (const a of actors) if (a.advanceWoundPreview(dt)) frozenHullBuilt = false;
    if (!wanderFrozen) {
      frozenHullBuilt = false;
      // --- brain input + crowd separation, BEFORE the actors step ----------
      // Order matters: separating first means this frame's step() and its
      // view.update() render the corrected positions, so a resolved overlap
      // is never a frame late on screen.
      const pRoom = encounterNav.roomAt(player.pos);
      const pInfo = pRoom > 0
        ? { x: player.pos[0], z: player.pos[2], room: pRoom }
        : null;
      // The snapshot build is INSIDE the phase on purpose: it calls pose()
      // per actor and is part of what the director costs per frame.
      const encounterTiming = telemetry.begin();
      const snapshots: EncounterAgent[] = actors.map(a=>({id:a.id,pos:a.pose().pos,yaw:a.pose().yaw,room:a.room,
        home:encounterHomes.get(a.id)??a.pose().pos,soldier:a.kind==='soldier',ranged:a.kind==='soldier'&& !a.meleeCapable(),disabled:!!a.motionFrame()?.collapsed}));
      const orders=encounter.update(snapshots,pInfo,shotAlert,dt);
      shotAlert = false;
      for (const a of actors) a.setEncounterOrder(orders.get(a.id)!);
      telemetry.end('encounter', encounterTiming);

      // --- melee ring: who may swing this frame ---------------------------
      // Claimants are the alert bodies that are actually in the encounter; an
      // idle wanderer must not take a token it cannot use and starve a body
      // that is closing. Runs BEFORE the actors step, so a body's brain sees
      // this frame's verdict rather than last frame's.
      if (pInfo) {
        const claimants: RingClaimant[] = actors
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
        for (const a of actors) {
          a.setRingInput(verdict.holders.has(a.id), verdict.drift.get(a.id) ?? 0);
        }
      } else {
        for (const a of actors) a.setRingInput(false, 0);
      }

      const agents: CrowdAgent[] = actors.map(a => {
        const p = a.pose().pos;
        return {
          x: p[0], z: p[2],
          r: enclosureKeyAt(p[0],p[2]).startsWith('tunnel') ? .34 : a.engagedForCrowd() ? ENGAGED_RADIUS : .45,
          mobile: !a.motionFrame()?.collapsed,
        };
      });
      // The player is an ANCHOR: zombies slide off him rather than shove him.
      // His own capsule already resolves against the per-frame zombie boxes
      // above (stepPlayer), which is the other half of the same contact.
      agents.push({ x: player.pos[0], z: player.pos[2], r: PLAYER.radius, mobile: false });
      const push = separate(agents);
      actors.forEach((a, i) => a.nudge(push[i]![0], push[i]![1]));

      const bodyTiming = telemetry.begin();
      soldierCorpses?.update(actors,dt);
      for (const a of actors) a.step(dt);
      // 'body-step' CLOSES HERE, before the kit pose below, because that is
      // the boundary main's telemetry numbers were taken with. Widening a
      // counter to cover more work without saying so makes every recorded
      // figure incomparable to every new one, which is worse than the counter
      // being slightly narrow than it ought to be.
      telemetry.end('body-step', bodyTiming);
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
      if (!(sdfLayer.halfRate && sdfLayer.willHold)) {
        for (const a of actors) {
          if (!a.character) continue;
          const p = a.pose();
          a.character.pose(a.body, a.boundRig(), p.yaw, a.sinceFire(), a.motionFrame(), dt, a.id, a.posed());
        }
      }
      // The actor animation phase: wall-clock in play, the SIM CLOCK while a
      // demo is held. `simClockMs` is milliseconds, so the expression below is
      // the same NUMBER normal play computes — the hold changes the SOURCE,
      // not the scale, and is therefore invisible when it is off. Without this
      // the rig jiggle would differ between two runs of one recording and the
      // frame hash could never match. Pixel-only: nothing here feeds the sim.
      const now = demoHold ? simTimeMs() / 1000 : performance.now() / 1000;
      for (const a of actors) {
        a.view.setTime(now);
        // Face projection tracks the posed skull through the gait jiggle — and
        // the RUPTURE's displaced head while a doomed body is coming apart, so
        // the face does not stay pinned to the clean pose as the head rotates
        // (task 4).
        const skull = headShape(a.drawnBody());
        if (skull) a.view.setHeadShape(skull.centre, skull.axes);
      }
      // Wound exclusion, same contract as the lab's woundSpheres: hull
      // endpoint spheres must not sit inside carve zones, or they render as
      // pale discs inside craters. The carve sphere is centred ON the anchor
      // (depth-slab-clipped in the shader), so the full-radius sphere here is
      // a superset — it can only over-exclude (a slightly looser hull), never
      // expose. The game never passed this before 2026-08-27 because its
      // craters were tangent (the pale-wound defect) and never reached the
      // hull; real craters exposed it within one capture.
      if (sdfLayer.shellEnabled) {
        // Same posed bodies the occluder hull is built from, one line below —
        // this is what makes the hull "posed" at no extra cost.
        outerHull.update(actors.map(a => a.posed()), { shellAmp: shellAmpOf() });
      }
      occluderHull.update(
        actors.map(a => a.posed()),
        hullExclusionsEnabled
          ? actors.flatMap(a => {
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
        { occluder: sdfLayer.occluderEnabled, shadow: !(sdfLayer.halfRate && sdfLayer.willHold) },
      );
    } else if (!frozenHullBuilt) {
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
      if (sdfLayer.shellEnabled) {
        outerHull.update(actors.map(a => a.posed()), { shellAmp: shellAmpOf() });
      }
      occluderHull.update(
        actors.map(a => a.posed()),
        hullExclusionsEnabled
          ? actors.flatMap(a => {
            const prims = a.posed().prims;
            const yaw = a.pose().yaw;
            return a.visualWounds().map(w => ({ centre: woundWorldPos(prims, w, yaw), radius: w.radius }));
          })
          : [],
        { occluder: sdfLayer.occluderEnabled },
      );
      frozenHullBuilt = true;
    }

    // ---------------------------------------------------------------
    // GRAPESHOT SIM — pellets fly, land as wounds through actor.hit();
    // detached pieces fly ballistically through the shared chunk path.
    // ---------------------------------------------------------------
    cooldown = Math.max(0, cooldown - dt);
    recoilPitch *= Math.exp(-9 * dt);
    // ——— FREE AIM ————————————————————————————————————————————————————
    // The reticle only turns the camera once it is shoved past the dead zone;
    // inside it, aiming is free and the world stays put.
    if (freeAimOn) {
      const turn = turnFromAim(aim, dt);
      player.yaw += turn.yaw;
      player.pitch = Math.min(PLAYER.pitchLimit,
        Math.max(-PLAYER.pitchLimit, player.pitch + turn.pitch));
    }
    {
      const w = freeAimOn ? weaponAngles(aim, aimFrustum()) : { yawDeg: 0, pitchDeg: 0 };
      weaponYawDeg = approachAngle(weaponYawDeg, w.yawDeg, dt);
      weaponPitchDeg = approachAngle(weaponPitchDeg, w.pitchDeg, dt);
      // ...and the weapon CARRIES across the frame as well as turning. Rotation
      // alone pins the grip near screen centre at every reticle position --
      // that is what pivoting about the grip means -- so the gun read as bolted
      // to the camera with a hinged barrel (owner report). approachAngle is a
      // plain exponential catch-up, so it smooths metres as happily as degrees.
      const s = freeAimOn ? weaponSlide(aim) : { x: 0, y: 0 };
      weaponSlideXm = approachAngle(weaponSlideXm, s.x, dt);
      weaponSlideYm = approachAngle(weaponSlideYm, s.y, dt);
    }
    // WALK BOB, driven by distance rather than time so it stays locked to the
    // stride when the player speeds up, slows down or stops.
    {
      const pos = player.pos;
      const step = Math.hypot(pos[0] - prevPlayerPos[0], pos[2] - prevPlayerPos[2]);
      prevPlayerPos = [pos[0], pos[1], pos[2]];
      bobDistance += step;
      const speed01 = dt > 0 ? Math.min(1, step / dt / PLAYER.walkSpeed) : 0;
      bobAmount = approachBob(bobAmount, speed01, dt);
    }
    if (aimRig) {
      const b = bobPose(bobDistance, bobAmount);
      const yaw = THREE.MathUtils.degToRad(weaponYawDeg);
      const pitch = THREE.MathUtils.degToRad(weaponPitchDeg);
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
      aimRig.position.set(
        b.x + o.x + weaponSlideXm,
        b.y + o.y + weaponSlideYm,
        o.z,
      );
      aimRig.rotation.set(pitch, yaw, roll);
      // The rig just moved; the shoulders did not. Re-aim the arms at them.
      aimArms();
    }
    // Weapon slots + the dynamite, AFTER the rig has been placed for this frame
    // (the holster travel is a local transform on gunRig/bundleRig, so it does
    // not care where the rig is — but the burst sprites the dynamite spawns are
    // world-space and want the frame's final camera).
    stepWeaponSlots(dt);
    stepDynamite(dt);
    if (reticleEl) {
      reticleEl.style.display = freeAimOn ? 'block' : 'none';
      if (freeAimOn) {
        // Position against the CANVAS, not the window. Percent-of-viewport put
        // the reticle outside the render area whenever the canvas did not fill
        // the page -- so the thing marking where you are aiming sat somewhere
        // you could not shoot.
        const r = canvas.getBoundingClientRect();
        // Through the LENS. The fisheye moves the world under the crosshair,
        // so the crosshair rides the inverse map or it stops marking where
        // the shot lands. Pushed outward, because the centre is magnified.
        // Lens off (k = 0) returns `aim` unchanged — this is the old line.
        const p = reticleNdc(aim, postAa.lens);
        reticleEl.style.left = `${r.left + r.width * (0.5 + p.x * 0.5)}px`;
        reticleEl.style.top = `${r.top + r.height * (0.5 - p.y * 0.5)}px`;
      }
    }

    flashAge += dt;
    fireAge += dt;
    const flashV = flashEnvelope(flashAge);
    if (flashGroup && flashMaterial) {
      flashGroup.visible = flashV > 0;
      flashMaterial.opacity = flashV;
      // Expand as it dies rather than shrinking -- burning gas pushes outward.
      flashGroup.scale.setScalar(0.85 + 0.75 * (1 - flashV));
    }
    if (flashLight) flashLight.intensity = 55 * flashV;

    // SMOKE. Each live puff drifts, expands and fades; dead ones stay hidden.
    for (const p of smokePuffs) {
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
    const reloading = reloadAge <= RELOAD.totalSec;
    if (reloading) reloadAge += dt * reloadSpeed;
    const rp = reloading ? reloadPose(reloadAge) : { roll: 0, pitch: 0, dy: 0, dz: 0, hinge: 0 };
    const rc = fireRecoil(fireAge, fireBarrels);
    if (gunGroup) {
      gunGroup.rotation.z = THREE.MathUtils.degToRad(GUN_REST.rollDeg + rp.roll + rc.roll);
      gunGroup.rotation.x = THREE.MathUtils.degToRad(GUN_REST.pitchDeg + rp.pitch + rc.pitch);
      gunGroup.position.set(
        GUN_REST.pos.x,
        GUN_REST.pos.y + rp.dy + rc.dy,
        GUN_REST.pos.z + rp.dz + rc.dz,
      );
    }
    if (hingePivot) hingePivot.rotation.x = rp.hinge * RELOAD.openRad;
    // The breech locators are read below in RIG space, and they hang off the
    // hinge pivot that was just rotated. Without this the eject would trail the
    // barrels by exactly one frame.
    if (gunGroup) viewModelAnchor.updateMatrixWorld(true);
    if (topLeverNode) topLeverNode.rotation.y = topLeverAngle(reloading ? reloadAge : 0);

    if (reloading) {
      // THE BORE BASIS, this frame, in rig space. The cases leave along it,
      // the fresh ones are staged on it, and the hand's two breech keys are
      // derived from it -- all from the same live locators, so nothing here
      // can disagree with where the open barrels actually are.
      const out = new THREE.Vector3(), side = new THREE.Vector3();
      const breech = new THREE.Vector3();
      const haveBore = boreFrameInRig(out, side);
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
        breechInRig(0, mL); breechInRig(1, mR);
        const mid: Vec3 = [(mL.x + mR.x) / 2, (mL.y + mR.y) / 2, (mL.z + mR.z) / 2];
        const h = loadHold(mid, outV, frame.side, GOBLIN_SKIN.handRadius);
        const asDelta = (p: Vec3): HandDelta => ({
          dx: p[0] - FORE_HAND_REST.x, dy: p[1] - FORE_HAND_REST.y, dz: p[2] - FORE_HAND_REST.z,
        });
        hold = { stage: asDelta(h.stage), seat: asDelta(h.seat) };
      }
      const sh = supportHandPose(reloadAge, hold);
      const handNow = new THREE.Vector3(
        FORE_HAND_REST.x + sh.dx,
        FORE_HAND_REST.y + sh.dy,
        FORE_HAND_REST.z + sh.dz,
      );
      if (foreHandGroup) { foreHandGroup.position.copy(handNow); aimArms(); }

      // ——— STAGE 1: EXTRACTION, and the INSERT that mirrors it ————————
      // The seated cases are children of Barrels, so they are already carrying
      // the 45 deg tilt. Sliding them along their own LOCAL -Z walks them
      // straight back out of the bores; sliding them the other way seats the
      // fresh ones. Larger z is toward the muzzle. Same nodes for both: a
      // fresh case IS the seated case, arriving.
      const ex = extractStage(reloadAge);
      const ins = insertStage(reloadAge);
      for (let i = 0; i < shellNodes.length; i++) {
        const s = shellNodes[i];
        const restZ = shellRestZ[i];
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
          s.visible = reloadAge < RELOAD.extractAtSec || reloadAge >= RELOAD.loadSeatSec;
          s.position.z = restZ;
        }
      }
      if (extractorNode) {
        extractorNode.position.z = extractorRestZ - extractorOffset(reloadAge);
      }

      // ——— STAGE 2: THE TUMBLE ———————————————————————————————————————
      // Handed off where stage one LEFT the case: its centre half a case
      // length out of the mouth along the bore, on a gun that may be at any
      // point in its swing, and bore-aligned -- not snapped to the rig's -Z
      // with its rear half still inside the tube, which is what clipped.
      for (let i = 0; i < ejectedShells.length; i++) {
        const m = ejectedShells[i];
        if (!m) continue;
        const k: 0 | 1 = i === 0 ? 0 : 1;
        const e = ejectedShell(reloadAge, k, frame, reloadSeed);
        if (!e || !haveBore || !breechInRig(k, breech)) { m.visible = false; continue; }
        m.visible = true;
        const origin = breech.clone().addScaledVector(out, SHELL_LEN_M / 2);
        m.position.set(origin.x + e.x, origin.y + e.y, origin.z + e.z);
        // End over end about the side axis, from the bore-aligned start.
        m.quaternion.setFromAxisAngle(side, e.spin).multiply(qBore);
        const originWorld = (aimRig ?? viewModelAnchor).localToWorld(origin);
        lastEjectOrigin = [originWorld.x, originWorld.y, originWorld.z];
      }

      // FRESH CASES: the rig-space CARRY. They ride rigidly in the hand from
      // wherever it is to their staged spot on the bore axis, and the hand's
      // stage key IS the place that puts them there -- so at the end of the
      // carry each case sits exactly where the barrel-local insert picks it
      // up, and the two stages meet without a jump. Held tips-up at first,
      // rolling onto the bore axis as they arrive.
      const carry = loadCarry(reloadAge);
      for (let i = 0; i < loadShells.length; i++) {
        const m = loadShells[i];
        if (!m) continue;
        const k: 0 | 1 = i === 0 ? 0 : 1;
        if (carry === null || !haveBore || !hold || !breechInRig(k, breech)) {
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

      if (reloadPhaseAt(reloadAge) === 'done') {
        shells = MAGAZINE_CAPACITY;
        reloadAge = Infinity;
        if (hingePivot) hingePivot.rotation.x = 0;
        if (topLeverNode) topLeverNode.rotation.y = 0;
        if (extractorNode) extractorNode.position.z = extractorRestZ;
        for (let i = 0; i < shellNodes.length; i++) {
          const s = shellNodes[i];
          const restZ = shellRestZ[i];
          if (!s || restZ === undefined) continue;
          s.visible = true;              // loaded gun: two heads at the breech
          s.position.z = restZ;
        }
        if (gunGroup) {
          gunGroup.rotation.z = THREE.MathUtils.degToRad(GUN_REST.rollDeg);
          gunGroup.rotation.x = THREE.MathUtils.degToRad(GUN_REST.pitchDeg);
          gunGroup.position.copy(GUN_REST.pos);
        }
        if (foreHandGroup) { foreHandGroup.position.copy(FORE_HAND_REST); aimArms(); }
        for (const m of ejectedShells) m.visible = false;
        for (const m of loadShells) m.visible = false;
        updateHud();
      }
    }
    {
      const projectileTiming = telemetry.begin();
      const prevs = pellets.map(p => [...p.pos] as Vec3);
      stepProjectiles(pellets, dt);
      // Hit batching: every actor hit this frame flushes its rig/repack/
      // wound-row tail ONCE after the loop (ZombieActor.beginHits).
      const hitThisFrame = new Set<ZombieActor>();
      for (let i = pellets.length - 1; i >= 0; i--) {
        const p = pellets[i]!;
        const from = prevs[i]!;
        let dead = expired(p);
        if (!dead && bakedChunks.length > 0) {
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
          for (let bi = bakedChunks.length - 1; bi >= 0; bi--) {
            const b = bakedChunks[bi]!;
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
            gibBakedPiece(b, p.pos);
            dead = true;
            break;
          }
        }
        if (!dead && chunkBakeEnabled) {
          // Settled pieces must remain hittable while queued/in flight. A
          // sphere rejects distant shots, then the existing CPU field tests
          // the actual piece without extracting any mesh on this thread.
          const dx = p.pos[0] - from[0], dy = p.pos[1] - from[1], dz = p.pos[2] - from[2];
          const l2 = dx * dx + dy * dy + dz * dz || 1;
          for (let ci = liveChunks.length - 1; ci >= 0; ci--) {
            const c = liveChunks[ci]!;
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
            if (chunkBakeJobs.pendingId === c.id) cancelChunkBake();
            liveChunks.splice(ci, 1);
            c.view.object.visible = false;
            spareChunkViews.push(c.view);
            gibChunkMeat(c.template, hp);
            dead = true;
            break;
          }
        }
        if (!dead && p.pos[1] <= 0.02) dead = true;
        if (!dead) {
          // Level geometry: a point-in-AABB test is enough — pellets are
          // small and the substepped trace already bounds their travel.
          for (const b of colliders) {
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
          for (const a of actors) {
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
            const hitTiming = telemetry.begin();
            if (segMeshRenderer) {
              const sources = skeletonSources.get(hitActor)?.sources;
              if (sources) segMeshRenderer.impact(hitActor, sources, hitPoint, dirN, p.kind);
            }
            const stamped = p.kind === 'slug'
              ? hitActor.hitSlug(hitPoint, dirN, p.shot)
              : hitActor.hit(hitPoint, dirN, p.shot);
            telemetry.end('wound-hit', hitTiming);
            if (telemetry.active) telemetry.event('impact', {
              actor: hitActor.id, model: 'zombie', room: hitActor.room, kind: p.kind, stamped: !!stamped,
              world: hitPoint, direction: dirN, actorPose: hitActor.pose(),
              wound: stamped ? describeRecordedWound(hitActor, stamped) : null,
              woundCount: hitActor.wounds().length,
            });
            if (stamped) registerBleed(hitActor, stamped, p.kind, { point: hitPoint, incoming: dirN });
            dead = true;
          }
        }
        if (dead) pellets.splice(i, 1);
      }
      const flushTiming = telemetry.begin();
      for (const a of hitThisFrame) a.endHits();
      if (telemetry.active) for (const a of hitThisFrame) telemetry.event('actor-wounds', {
        actor: a.id, model: 'zombie', pose: a.pose(), wounds: a.wounds().map(w => describeRecordedWound(a, w)),
        aliveRegions: a.posed().clusters.filter(c => c.alive).map(c => c.limb),
      });
      soldierCorpses?.update(actors,0); // restore damaged snapshots before this draw
      telemetry.end('wound-flush', flushTiming);
      telemetry.end('projectiles-and-hits', projectileTiming);
      // SOLDIER PELLETS SIT OUTSIDE 'projectiles-and-hits' ON PURPOSE — see
      // the same argument at 'body-step'. This is work that did not exist when
      // that counter was calibrated on main, and quietly folding it in would
      // make new readings incomparable to recorded ones.
      // SOLDIER PELLETS: stepped, culled and drawn — never traced. Uses the
      // same integrator as the player's (semi-implicit Euler, gravity before
      // move); hand-rolling a second one would let the two drift apart.
      const soldierFrom = soldierPellets.map(p => [...p.pos] as Vec3);
      stepProjectiles(soldierPellets, dt);
      for (let i = soldierPellets.length - 1; i >= 0; i--) {
        if (expired(soldierPellets[i]!) || colliders.some(box =>
          segmentHitsBox(soldierFrom[i]!, soldierPellets[i]!.pos, box))) soldierPellets.splice(i, 1);
      }
      // The eye every tracer billboards around this frame. Declared here (not
      // reused from the block below) because that one is scoped to the hit
      // pass; the streaks need it whether or not anything was hit.
      const tracerEye = eyeOf(player);
      while (soldierPelletViews.length < soldierPellets.length) {
        soldierPelletViews.push(newTracerView());
      }
      for (let k = 0; k < soldierPelletViews.length; k++) {
        const v = soldierPelletViews[k]!;
        const p = soldierPellets[k];
        if (p) placeTracer(v, p, tracerEye);
        else hideTracer(v);
      }
      // Sync the mesh pool to the sim list — growing it on demand (the
      // pool is ONLY grown here; fire() must not touch meshes because it
      // runs from an evaluate() with no frame in between).
      while (pelletViews.length < pellets.length) {
        pelletViews.push(newTracerView());
      }
      for (let k = 0; k < pelletViews.length; k++) {
        const v = pelletViews[k]!;
        const p = pellets[k];
        // A slug is drawn at its own (larger) calibre — placeTracer reads the
        // projectile's radius, so no branch is needed here.
        if (p) placeTracer(v, p, tracerEye);
        else hideTracer(v);
      }
      // Chunks: ballistic step + world-space field repack, lab contract.
      // With the bake seam on, a chunk that has come to rest is retired
      // from the sim HERE (chunkSettled fires only on a grounded,
      // spin-free, flat, sub-millimetre-per-frame chunk — see gib-chunks.ts
      // for the clause-by-clause "has already stopped" argument) and its
      // march proxy is replaced by a static mesh. Reverse iteration: bake
      // SPLICES entries out of liveChunks.
      const chunkTiming = telemetry.begin();
      const cdt = Math.min(dt, 1 / 30);
      // GUT ROPES first, so stepBlood's skip of 'gut' droplets this frame
      // sees this frame's chain positions (see stepGutRopes).
      stepGutRopes(cdt);
      // Bodies whose pre-tear window has closed become pieces HERE — after the
      // actors stepped above (so the pieces take the pose the body was drawn
      // in) and before the chunk step (so their impulses are released in the
      // same frame they are born).
      spawnScheduledGibs(dt);
      // The staged release's due impulses, BEFORE the chunk step, so a piece
      // that goes this frame integrates at its launch velocity for the whole
      // frame rather than a frame late.
      stepPendingGibImpulses();
      finishChunkBake();
      for (let ci = liveChunks.length - 1; ci >= 0; ci--) {
        const c = liveChunks[ci]!;
        // Keep the exact settled snapshot visible while its worker runs.
        // No disappearance, and no pose drift between sampling and swap.
        if (chunkBakeJobs.pendingId === c.id) {
          c.view.update(c.state); // repair view resets (e.g. bone-mode changes) without moving the snapshot
          continue;
        }
        c.state = stepChunk(c.state, cdt, chunkCollidersAt(c.state.pos));
        c.view.update(c.state);
        if (chunkBakeEnabled && chunkBakeJobs.pendingId === null && !chunkBakeJobs.error && chunkSettled(c.state)) {
          const t0 = performance.now();
          const data = c.view.bakeData();
          // Bone-only pieces retain their original SDF path.
          if (data.flesh.length > 0 && chunkBakeJobs.submit(c.id, data)) {
            chunkBakeInput = data;
            bakeSubmitFrame = simFrame;
            telemetry.event('chunk-bake-request', { chunk: c.id, flesh: data.flesh.length, bones: data.bones.length });
          }
          lastBakeRequestMs = performance.now() - t0;
        }
      }
      // SPRITE PIECES, on the same clock and in the same block as the marched
      // ones — deliberately, because they are the same physics: `stepSpritePieces`
      // calls the same `stepChunk` with the same `chunkCollidersAt`, so a sprite
      // gib and a marched gib cannot disagree about where the wall is. What it
      // does NOT do is any of the bake: a settled sprite is parked, not retired
      // through a worker. Costs a loop over an empty array when the mode is off.
      if (spritePieces.live.length > 0 || spritePieces.rest.length > 0) {
        stepSpritePieces(spritePieces, {
          dt: cdt,
          cameraQuat: camera.quaternion,
          collidersAt: chunkCollidersAt,
          liveCap: gibSpriteLiveCap,
          restCap: gibSpriteRestCap,
        });
      }
      telemetry.end('chunks-and-guts', chunkTiming);
      const bloodTiming = telemetry.begin();
      // BLEED — emitters spray (anchors recomputed from the CURRENT posed
      // prims, so droplets ride the walking body), flying chunks trail, and
      // the sim settles into splats. Runs even with the wander frozen: it is
      // a cosmetic sim exactly like the pellets and chunks above (a frozen
      // capture that fired still bleeds), and posed() is always current.
      if (bleedEnabled) {
        bleedClock += cdt;
        for (const e of bleed.live(bleedClock)) {
          const a = actors.find(q => q.id === e.bodyId);
          if (!a) { bleed.evictForBody(e.bodyId); continue; }
          const { anchor, normal } = woundEmitAnchorAndNormal(a.posed().prims, e.wound, a.pose().yaw);
          e.acc = spawnWoundDroplets(
            bloodSim, e.kind, bleedClock - e.bornAt, anchor, normal, cdt, e.acc, rngStreams.bleed,
            woundStreamId(e.wound),
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
          bloodSim,
          [
            ...liveChunks.map(c => ({
              id: c.id, pos: c.state.pos, vel: c.state.vel, stream: trailStreamId(c.id),
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
            ...spritePieces.live.map(p => ({
              id: SPRITE_TRAIL_ID_BASE + p.id, pos: p.state.pos, vel: p.state.vel,
              stream: trailStreamId(SPRITE_TRAIL_ID_BASE + p.id),
            })),
          ],
          cdt, rngStreams.bleed,
        );
        stepBlood(bloodSim, cdt, rngStreams.bleed);
        // Re-pose every instance from sim state (billboards track the camera
        // even frozen — same contract as the lab's always-sync).
        bloodView.sync(bloodSim, camera);
      }
      telemetry.end('blood-simulation-and-sync', bloodTiming);
      // The optional impact crown advances even with bleed off, so an event
      // already in flight finishes instead of freezing mid-burst.
      impactSplashLayer?.step(cdt);
    }

    const eye = eyeOf(player);
    camera.position.set(eye[0], eye[1], eye[2]);
    const cp = Math.cos(player.pitch + recoilPitch);
    camera.lookAt(
      eye[0] + Math.sin(player.yaw) * cp,
      eye[1] + Math.sin(player.pitch + recoilPitch),
      eye[2] - Math.cos(player.yaw) * cp,
    );
    camera.updateMatrixWorld();

    // Optional impact crown: rebuild from the current event times after the
    // camera is final (its sync takes the camera for parity; geometry is
    // world-space). No-op when the feature is off.
    impactSplashLayer?.sync(camera);

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
    const gooTiming = telemetry.begin();
    // CANDIDATE connections: derived deterministically from the SAME droplet
    // array the sim already owns (no new particles, no new RNG). Set BEFORE
    // sync so the density instancer poses them in the same pass. When the
    // feature is off this clears any stale extras, so the shipped frame is
    // bit-identical again on the very next frame after disabling it.
    gooLayer?.setExtraBlobs(gooConnectionsEnabled
      ? connectionBlobsForSim(bloodSim.droplets, {
        enableStrands: gooStrandsEnabled, enableSheets: gooSheetsEnabled,
      })
      : []);
    gooLayer?.sync(bloodSim, camera);
    telemetry.end('goo-sync', gooTiming);
  }

  handle.setRenderCallback((dt) => {
    // Wall-clock frame delta (seconds -> ms), EMA'd — what the owner feels.
    // During __sdfGame.step() the dt is the supplied fixed step, not a
    // measurement; the readout only means something with the loop running.
    if (dt < 0.25) {
      const ms = dt * 1000;
      frameEma = frameEma === 0 ? ms : frameEma * 0.95 + ms * 0.05;
      if (adaptiveEnabled) {
        adaptiveFrames.push(ms);
        tickAdaptive(performance.now());
      }
    }
    tick(Math.min(dt, 1 / 20));
    if (frameCount++ % 10 === 0) updateHud();
  });
  updateHud();

  // -----------------------------------------------------------------------
  mark('api-start');
  // __sdfGame — the deterministic driver surface. The grapeshot dispatch
  // builds on this: zombies are addressable by id, the player pose is
  // settable, frames are steppable, wanderers freezable.
  // -----------------------------------------------------------------------
  /** Where a slug fired RIGHT NOW would hit — the shared predictor.
   *  Lifted out of __sdfGame so aimAtNearestSurface can CONFIRM an aim
   *  with the same code the placement gate uses, rather than trusting a
   *  cluster centre. No state mutated. */
  function predictSlugHitNow(): { origin: Vec3; dir: Vec3; actorId: number; hit: Vec3 | null } {
      const origin = muzzleWorld();
      const dir = convergedDir(origin);
      let bestD = Infinity;
      let hitActorId = -1;
      let hitPoint: Vec3 | null = null;
      // Simulate the slug's ACTUAL flight (gravity, like stepProjectiles) —
      // a straight muzzle ray ignores the drop and reads ~4 cm high at 3 m,
      // which the placement gate duly failed (2026-08-27).
      const pos: [number, number, number] = [origin[0], origin[1], origin[2]];
      const d0: [number, number, number] = [dir[0], dir[1], dir[2]];
      const vel: [number, number, number] = [d0[0] * SLUG.speed, d0[1] * SLUG.speed, d0[2] * SLUG.speed];
      const dt = 1 / 120;
      for (const a of actors) {
        const c = a.posed().clusters.find(cc => cc.limb === 'torso')?.center;
        if (!c) continue;
        if (Math.hypot(c[0] - origin[0], c[1] - origin[1], c[2] - origin[2]) > 20) continue;
        const posedA = a.posed();
        // Per-actor arc: reset the integrator, march segment-wise for 2 s.
        pos[0] = origin[0]; pos[1] = origin[1]; pos[2] = origin[2];
        vel[0] = d0[0] * SLUG.speed; vel[1] = d0[1] * SLUG.speed; vel[2] = d0[2] * SLUG.speed;
        for (let i = 0; i < 240; i++) {
          const next: Vec3 = [
            pos[0] + vel[0] * dt,
            pos[1] + vel[1] * dt,
            pos[2] + vel[2] * dt,
          ];
          const vNext: Vec3 = [vel[0], vel[1] + SLUG.gravity * dt, vel[2]];
          const hp = traceProjectile(pos, next, q => sdBody(q, posedA));
          if (hp) {
            const d = Math.hypot(hp[0] - origin[0], hp[1] - origin[1], hp[2] - origin[2]);
            if (d < bestD) { bestD = d; hitActorId = a.id; hitPoint = hp; }
            break;
          }
          pos[0] = next[0]; pos[1] = next[1]; pos[2] = next[2];
          vel[0] = vNext[0]; vel[1] = vNext[1]; vel[2] = vNext[2];
        }
      }
      return { origin, dir, actorId: hitActorId, hit: hitPoint };
  }

  /**
   * Aim at a body the ballistic predictor CONFIRMS is hittable.
   *
   * Two things this must not do, both learned by measurement (2026-08-31):
   *
   *   1. Do not stamp at a cluster CENTRE. A torso centre sits INSIDE the
   *      field: it anchors the crater pathologically, and a slug's severRadius
   *      cuts both hip necks into an instant collapse. The centre is used only
   *      to POINT the camera; the shot itself resolves to a surface.
   *   2. Do not aim at whatever is nearest. Room 4 spawns its zombies around
   *      the room centre, so a bench standing at the centre had a body 0.97 m
   *      away — close enough that the aim pitched 26 degrees DOWN into it, the
   *      predictor returned actorId -1, and all eight pellets expired having
   *      hit nothing. The bench then reported "firing" segments that contained
   *      no wounds at all.
   *
   * So: candidates in distance order, skipping anything inside MIN_STANDOFF,
   * and the first one the predictor confirms wins. Returns false if none do,
   * which leaves the aim untouched — a bench that silently re-aimed until it
   * connected would be measuring something the scenario never described.
   */
  const MIN_STANDOFF = 1.5;
  function aimAtNearestSurface(limb?: string, actorId?: number): boolean {
    const eye = eyeOf(player);
    const candidates = actors
      .filter(a => actorId === undefined || a.id === actorId)
      .map((a) => {
        const c = a.posed().clusters.find(cc => cc.limb === (limb ?? 'torso') && (actorId === undefined || cc.alive))?.center;
        return c ? { c: [...c] as Vec3, d: Math.hypot(c[0] - eye[0], c[1] - eye[1], c[2] - eye[2]) } : null;
      })
      .filter((x): x is { c: Vec3; d: number } => x !== null && x.d >= MIN_STANDOFF)
      .sort((a, b) => a.d - b.d);

    const yaw0 = player.yaw;
    const pitch0 = player.pitch;
    for (const cand of candidates) {
      // YAW CONVENTION: the page's forward is (sin yaw, −cos yaw) — camera
      // lookAt (below), aimDir and muzzleWorld all agree — so facing a target
      // at offset (dx, dz) is atan2(dx, −dz). walkTo (above) already did this
      // right; these two bench sites had the z sign flipped since cdba91f,
      // which mirrored the aim across the player's z plane. It only ever
      // "worked" while bodies happened to sit near that plane; with the group
      // fully on one side the bench faced a wall, benched an empty frustum
      // and fired every shot into it (measured 2026-09-02: census 0, 0
      // wounds, p50 1.5 ms). NOTE the aim search is still needed even with
      // the sign right: the predictor simulates SLUG GRAVITY, so dead-on
      // yaw/pitch at the torso can still miss low — try candidates, keep the
      // first the predictor confirms.
      player.yaw = Math.atan2(cand.c[0] - eye[0], -(cand.c[2] - eye[2]));
      player.pitch = Math.atan2(cand.c[1] - eye[1], Math.hypot(cand.c[0] - eye[0], cand.c[2] - eye[2]));
      // Scoped diagnostics settle the real viewmodel after this orientation
      // and verify the predictor there; its muzzle transform is stale here.
      if (actorId !== undefined || predictSlugHitNow().actorId >= 0) return true;
    }
    player.yaw = yaw0;
    player.pitch = pitch0;
    return false;
  }

  function describeRecordedWound(a: ZombieActor, w: Wound) {
    const prims = a.posed().prims;
    const prim = prims[w.primIdx];
    return { ...w, world: prim ? woundWorldPos(prims, w, a.pose().yaw) : null,
      bone: prim?.bone ?? null, sourceLine: prim?.src ?? null,
      region: prim ? a.posed().clusters[prim.cluster]?.limb ?? null : null };
  }
  function captureTelemetryScene(name: string) {
    if (!telemetry.active) return;
    const started = performance.now();
    telemetry.snapshot(name, {
      camera: { position: camera.position.toArray(), quaternion: camera.quaternion.toArray(), projection: camera.projectionMatrix.toArray(), fov: camera.fov },
      player: { position: player.pos, yaw: player.yaw, pitch: player.pitch },
      settings: { tiles: gameTiles.diagnostics(), sdfScale, adaptive: adaptiveEnabled, frameCap: handle.frameCap,
        width: sdfLayer.targetSize.width, height: sdfLayer.targetSize.height, woundTuning, normalGradientMode },
      actors: actors.map(a => {
        const body = a.posed();
        // Already-posed CPU data: no ray queries, GPU fence or texture readback.
        return { id: a.id, model: 'zombie', room: a.room, pose: a.pose(),
          prims: body.prims, clusters: body.clusters, bonePrims: body.bonePrims,
          wounds: a.wounds().map(w => describeRecordedWound(a, w)),
          uniforms: Object.fromEntries(Object.entries(a.view.uniforms).flatMap<[string, number | boolean | number[]]>(([key, u]) => {
            const v = (u as { value: unknown }).value;
            if (typeof v === 'number' || typeof v === 'boolean') return [[key, v]];
            if (v instanceof THREE.Vector2 || v instanceof THREE.Vector3 || v instanceof THREE.Vector4 || v instanceof THREE.Matrix4) return [[key, (v as { toArray(): number[] }).toArray()]];
            return [];
          })),
        };
      }),
      chunks: liveChunks.map(c => ({ id: c.id, state: c.state, pendingBake: chunkBakeJobs.pendingId === c.id })),
      bakedChunks: bakedChunks.map(c => ({ id: c.id, centre: c.centre, radius: c.radius })),
      purpose: 'Frozen actor geometry for diagnosis; not deterministic whole-game replay. No pixel/ray eligibility counters.',
    });
    telemetry.event('snapshot-cost', { name, cpuMs: performance.now() - started });
  }

  // Read scalar counters only; no field queries/readbacks during live play.
  let firstTelemetryFrame = true;
  let telemetryVisibilityGap = false;
  document.addEventListener('visibilitychange', () => { telemetryVisibilityGap = true; });
  const telemetryFrame = (frame: FrameTiming) => {
    telemetry.frame(frame, {
      hidden: document.hidden, visibilityGap: telemetryVisibilityGap, firstFrame: firstTelemetryFrame,
      pointerLocked: document.pointerLockElement === canvas,
      actors: actors.length, bodiesOnScreen: bodiesOnScreen(),
      liveChunks: liveChunks.length, bakedChunks: bakedChunks.length,
      projectiles: pellets.length, droplets: bloodSim.droplets.length, splats: bloodSim.splats.length,
      player: [...player.pos], yaw: player.yaw, pitch: player.pitch,
      frameCap: handle.frameCap, refreshMs: handle.refreshMs,
      renderWidth: sdfLayer.marchTarget.width, renderHeight: sdfLayer.marchTarget.height,
      frozen: wanderFrozen, chunkBake: chunkBakeEnabled, bleed: bleedEnabled,
      totalWounds: actors.reduce((n, a) => n + a.wounds().length, 0),
      pendingBake: chunkBakeJobs.pendingId, bakeError: chunkBakeJobs.error,
      tiles: gameTiles.diagnostics(), sdfScale, adaptive: adaptiveEnabled,
      woundStep: actors[0]?.view.uniforms.perfCfg.value.z, analyticNormals: normalGradientMode,
      // Fill-bound march: cost tracks covered pixels, so a capture without an
      // area term cannot separate "wounds are expensive" from "close bodies
      // are expensive". CPU estimate — see the `coverage` declaration.
      coverageFrac: +coverage.screenFrac.toFixed(4),
      nearestBodyM: +coverage.nearestM.toFixed(2),
      biggestBodyFrac: +coverage.biggestFrac.toFixed(4),
      actorCull: actorCullEnabled, visibleBodies: cullCounts.visible,
      halfRate: sdfLayer.halfRate, halfRateMode: sdfLayer.halfRateMode,
      depthPrepass: sdfLayer.depthPreEnabled,
      fieldMode: sdfLayer.fieldMode, fieldStyle: sdfLayer.fieldStyle, fieldComb: sdfLayer.fieldComb,
    });
    firstTelemetryFrame = false; telemetryVisibilityGap = false;
    telemetryControls?.afterFrame();
  };
  const telemetryControls = import.meta.env.DEV ? createTelemetryControls(telemetry, async () => ({
    build: await fetch('/__lab/telemetry-build', { cache: 'no-store', signal: AbortSignal.timeout(5000) }).then(r => { if (!r.ok) throw new Error('Build identity unavailable'); return r.json(); }),
    buildAtServerStart: import.meta.env.VITE_TELEMETRY_BUILD ?? { commit: 'unknown', dirty: true },
    captureVersion: 2, targetFrameMs: 1000 / 30, lateToleranceMs: 2, tiles: gameTiles.diagnostics(),
    page: location.pathname, query: location.search, userAgent: navigator.userAgent, backend: handle.backend,
    visibility: document.visibilityState, frameCap: handle.frameCap,
    fisheye: fisheyeReport(), renderWidth: sdfLayer.marchTarget.width, renderHeight: sdfLayer.marchTarget.height,
    woundStep: actors[0]?.view.uniforms.perfCfg.value.z,
    hullExitBound: actors[0]?.view.uniforms.perfCfg.value.x,
    halfRate: sdfLayer.halfRate, halfRateMode: sdfLayer.halfRateMode,
    depthPrepass: sdfLayer.depthPreEnabled, actorCull: actorCullEnabled,
    fieldMode: sdfLayer.fieldMode, fieldStyle: sdfLayer.fieldStyle, fieldComb: sdfLayer.fieldComb,
    coverageMeaning: 'coverageFrac/biggestBodyFrac are a CPU bounding-sphere '
      + 'estimate of screen area covered by VISIBLE bodies, not a GPU pixel '
      + 'count; overlapping bodies double-count and occlusion is ignored, so '
      + 'it OVERESTIMATES when bodies stack. Read as a trend, not an absolute.',
    gpuTiming: 'unavailable: existing multipass timestamps are not attributable to individual frames',
    intervalMeaning: 'natural drawn-frame start intervals, including frame cap/vsync and scheduling; not pure GPU time',
    cpuMeaning: 'tickCpuMs and drawCpuMs are synchronous CPU time, including submission, not GPU execution',
    phaseMeaning: 'inclusive spans accumulated since previous draw; nested hit/flush/bake spans must not be added to parents',
    spikeAttribution: 'a frame interval describes the gap BEFORE that row; inspect previous-row CPU spans and events in that gap',
    limits: { maxFrames: 18000, maxEvents: 4000, durationMs: 180000, maxSnapshots: 16, maxBytes: 12 * 1024 * 1024 },
    snapshots: 'At recording start and F9 only; snapshot-cost events identify instrumentation work.',
  }), undefined, active => {
    firstTelemetryFrame = true; telemetryVisibilityGap = false;
    handle.setFrameObserver(active ? telemetryFrame : null);
    if (active) captureTelemetryScene('recording-start');
  }, () => captureTelemetryScene('visual-issue')) : null;
  import.meta.hot?.dispose(() => telemetryControls?.dispose());

  // CONTROLLED FORWARD DEPTH PROBES (evidence seam backing __sdfGame
  // spawnDepthProbes/clearDepthProbes below). Deliberately UNREGISTERED:
  // the router hides unregistered renderables from the mesh/sdf G-buffer
  // passes and leaves them alone in the forward route, so these sprites
  // only ever composite depth-tested over the presented frame.
  const depthProbes: THREE.Sprite[] = [];
  const clearDepthProbes = () => {
    for (const s of depthProbes) {
      scene.remove(s);
      s.material.dispose();
    }
    depthProbes.length = 0;
  };
  import.meta.hot?.dispose(clearDepthProbes);

  /** debugRegisteredTree helpers: depth of `o` below `root`, world-position
   *  rounding, and a bounded descendant count for the truncation flag. */
  const nodeDepth = (root: THREE.Object3D, o: THREE.Object3D): number => {
    let d = 0;
    let p: THREE.Object3D | null = o;
    while (p && p !== root) { d++; p = p.parent; }
    return d;
  };
  const round2 = (v: number) => Math.round(v * 100) / 100;
  const countDescendants = (root: THREE.Object3D): number => {
    let n = 0;
    root.traverse(() => { n++; });
    return n - 1;
  };

  // --- DEMO HASH READBACK (deterministic demo recordings stage 2, 2026-09-10).
  // The two GPU layers the frame hash digests, read back WITH the caller's
  // padding intact: demo-hash.ts owns de-padding, because doing it in two
  // places is how a stride gets miscounted twice. See webgpu/demo-hash.ts for
  // why these two layers and not the composited frame.
  const readMarchTargetForHash = async (): Promise<{
    width: number; height: number; floatsPerTexel: number; data: ArrayLike<number>;
  }> => {
    const t = sdfLayer.marchTarget;
    const w = t.width, h = t.height;
    // 4 floats per texel is the march target's contract (rgba32f). Asserted
    // rather than assumed: a format change would otherwise be hashed as
    // garbage that still looks like a number.
    const floatsPerTexel = 4;
    if (!w || !h) throw new Error(`frameHash: marchTarget is ${w}x${h}`);
    const data = await handle.renderer.readRenderTargetPixelsAsync(t, 0, 0, w, h);
    return { width: w, height: h, floatsPerTexel, data: data as ArrayLike<number> };
  };
  /** The gather's dynamic probe layer, or null when the gather is not bound
   *  (a legitimate boot: `?probedyn=0` and the lab pages have none). */
  const readProbeDynForHash = async (): Promise<Float32Array | null> =>
    probeGather ? await probeGather.readback() : null;
  /** THE GATHER'S PACKED INPUTS — the bone capsules it gathers against, and the
   *  live count. Hashing these separates "two boots posed the bodies
   *  differently" from "the gather diverged on identical inputs", which is the
   *  open question from the 2026-09-10 frame-hash runs. See DemoHashDeps. */
  const readInstancesForHash = async (): Promise<{ data: ArrayLike<number>; count: number; floatsPerInstance: number } | null> =>
    // `probeLastCapsules` is the module-scope mirror of the draw callback's own
    // `probeCapsuleCount` (the count is written there and published here), which
    // is the only one this scope can see.
    ({ data: probeCapsuleArrays.ab, count: probeLastCapsules, floatsPerInstance: INSTANCE_FLOATS });

  /** THE ONE frame-hash dependency set. Kept as a single object on purpose:
   *  this was four inline object literals, and they SILENTLY DRIFTED — two grew
   *  `readInstances` and two did not, so the instances layer vanished from a
   *  run with no error. A hash whose layer set depends on which call site asked
   *  is not a hash. */
  const frameHashDeps = {
    readMarchTarget: readMarchTargetForHash,
    readProbeDyn: readProbeDynForHash,
    readInstances: readInstancesForHash,
  };

/** ONE SCENARIO ACTION, applied to the live page — the seam the perf
 *  bench and the frame-hash recorder BOTH drive (deterministic demo
 *  recordings stage 2, 2026-09-10). Extracted verbatim from the bench's
 *  inline `perform`: the teleport heuristics inside were tuned against the
 *  bench census (2026-08-31 — the room centre missed every shot and an
 *  outer corner aimed at a wall), so if this drifts, a recorded demo stops
 *  replaying the scenario the bench measured. One implementation, not two.
 */
function performBenchAction(a: BenchAction): void {
  switch (a.kind) {
    case 'teleport': {
      const r = ROOMS.find(x => x.id === a.room);
      if (r) {
        // Stand back from where the BODIES actually are, facing
        // them. Two heuristics were tried and both failed against
        // the census (2026-08-31): the room centre put a zombie
        // 0.97 m away so every shot pitched down into it and
        // missed, and an outer corner pointed the camera at a wall
        // with bodies 1 -> 0 on screen. The room's own actors are
        // the only thing that reliably says where to look.
        const mine = actors.filter(x => x.room === a.room);
        const cx = (r.minX + r.maxX) / 2;
        const cz = (r.minZ + r.maxZ) / 2;
        let tx = cx;
        let tz = cz;
        if (mine.length) {
          tx = mine.reduce((n, x) => n + x.pose().pos[0], 0) / mine.length;
          tz = mine.reduce((n, x) => n + x.pose().pos[2], 0) / mine.length;
        }
        // Back off along the direction from the room centre toward
        // the outer wall, so the whole group stays in front.
        const away = Math.hypot(tx - cx, tz - cz);
        let ax = away > 0.2 ? (cx - tx) / away : 0;
        let az = away > 0.2 ? (cz - tz) / away : 1;
        // Degenerate group (all at the centre): back off along -z.
        if (!Number.isFinite(ax) || (ax === 0 && az === 0)) { ax = 0; az = 1; }
        const STANDOFF = 4.0;
        const inset = 0.6;
        const px = Math.min(r.maxX - inset, Math.max(r.minX + inset, tx + ax * STANDOFF));
        const pz = Math.min(r.maxZ - inset, Math.max(r.minZ + inset, tz + az * STANDOFF));
        player.pos = [px, 0, pz];
        player.vel = [0, 0, 0];
        // atan2(dx, −dz): the page's forward is (sin yaw, −cos
        // yaw) — see aimAtNearestSurface. Was atan2(dx, +dz)
        // (z-mirrored) since cdba91f.
        player.yaw = Math.atan2(tx - px, -(tz - pz));
        player.pitch = 0;
        player.grounded = true;
      }
      break;
    }
    case 'freeze': wanderFrozen = a.on; break;
    case 'look': player.yaw = a.yaw; player.pitch = a.pitch; break;
    case 'aimSurface': aimAtNearestSurface(); break;
    case 'fire': fire(a.barrels); break;
    case 'fireSlug': {
      const keep = slugMode;
      slugMode = true;
      try { fire(1); } finally { slugMode = keep; }
      break;
    }
    // RECORDED INPUT (stage 3): stage the frame; `tick` consumes it through
    // applyInputFrame, exactly as the standalone replay driver does. Applying
    // it here as well would double the shot. `replayActive` must be on (the
    // bench's demo path sets it) or tick would overwrite this frame from the
    // live listeners.
    case 'input': currentInputFrame = a.frame; break;
  }
}

  // -------------------------------------------------------------------------
  mark('demo-start');
  // DEMO RECORDER / PLAYER (deterministic demo recordings stage 3, 2026-09-14).
  //
  // The recording is an INPUT log: one DemoFrame per fixed-step tick. Live play
  // builds each frame from the listeners (`readInputFrame`) and feeds it through
  // `applyInputFrame`; a replay builds it from the file and feeds the SAME
  // function. The recorder sits at that seam, so what it captures is exactly
  // what the sim consumed — not a re-read that could see a later event.
  // -------------------------------------------------------------------------
  /** The bench census, as one function so the replay driver and the bench
   *  script cannot disagree about what a census IS. */
  function sceneCensus(): { bodies: number; wounds: number; chunks: number; droplets: number; splats: number; gooQuads: number } {
    return {
      bodies: bodiesOnScreen(),
      wounds: actors.reduce((n, a) => n + a.wounds().length, 0),
      chunks: liveChunks.length,
      droplets: bloodSim.droplets.length,
      splats: bloodSim.splats.length,
      gooQuads: gooLayer?.liveCount ?? 0,
    };
  }

  /** Apply the DEMO-BOOT flags a replay cares about — the ones that change the
   *  SCENE, not the dev levers the caller pins. Only crowd and sdf scale today;
   *  add a flag here the moment a recording depends on it, or a replay of a
   *  crowd run would silently measure the per-body path. */
  function applyDemoQuery(query: string): void {
    const q = new URLSearchParams(query);
    if (q.has('crowd')) {
      const on = q.get('crowd') === '1';
      if (on !== crowdOn) { crowdOn = on; rebuildCast(); }
    }
    if (q.has('scale')) {
      const v = Number(q.get('scale'));
      if (Number.isFinite(v) && v > 0) applySdfScale(v);
    }
  }

  /** Put the player where the recording's frame 0 starts. meta.startPose wins:
   *  the scripted standoff is computed from where the bodies happen to be and
   *  cannot be re-derived from a room id. Room centre is the fallback. */
  function placeFromDemo(file: DemoFile): void {
    const sp = file.meta?.startPose as { x?: number; z?: number; yaw?: number; pitch?: number } | undefined;
    if (sp && Number.isFinite(sp.x) && Number.isFinite(sp.z)) {
      player.pos = [sp.x as number, 0, sp.z as number];
      player.vel = [0, 0, 0];
      player.yaw = Number.isFinite(sp.yaw) ? (sp.yaw as number) : 0;
      player.pitch = Number.isFinite(sp.pitch) ? (sp.pitch as number) : 0;
      player.grounded = true;
      return;
    }
    const r = ROOMS.find(x => x.id === file.room);
    if (r) {
      player.pos = [(r.minX + r.maxX) / 2, 0, (r.minZ + r.maxZ) / 2];
      player.vel = [0, 0, 0];
      player.yaw = 0;
      player.pitch = 0;
      player.grounded = true;
    }
  }

  /** Turn a recording into a bench Scenario: one `input` action per frame, and
   *  equal thirds as segments (t0/t1/t2) because a live recording does not
   *  carry the scripted walk/fire/gib boundaries. Feeding it through runBench
   *  keeps the per-pass timers and the per-segment census identical to every
   *  other bench row. */
  function demoScenarioOf(file: DemoFile): Scenario {
    const frames = file.frames.length;
    const steps: ScenarioStep[] = [];
    for (let f = 0; f < frames; f++) {
      steps.push({ at: f, action: { kind: 'input', frame: file.frames[f]! } });
    }
    const a = Math.floor(frames / 3);
    const b = Math.floor((2 * frames) / 3);
    return {
      frames,
      steps,
      segments: [
        { name: 't0', from: 0, to: a },
        { name: 't1', from: a, to: b },
        { name: 't2', from: b, to: frames },
      ],
    };
  }

  /** A neutral frame for the tick after a recorded one is consumed: it keeps
   *  the last look (so a repeat step cannot snap the camera) but drops every
   *  event, so a warmup step cannot re-fire a shot. */
  function neutralInput(prev: DemoFrame): DemoFrame {
    return { keys: [], dx: 0, dy: 0, fire: 0, reload: false, look: [prev.look[0], prev.look[1]] };
  }

  /** The F7 HUD line, created lazily and parked above the telemetry controls. */
  let demoHudEl: HTMLDivElement | null = null;
  function updateDemoHud(): void {
    if (!recorder) {
      if (demoHudEl) demoHudEl.hidden = true;
      return;
    }
    if (!demoHudEl) {
      demoHudEl = document.createElement('div');
      demoHudEl.id = 'demo-rec-status';
      demoHudEl.setAttribute('style',
        'position:fixed;bottom:52px;left:12px;z-index:10001;padding:4px 8px;'
        + 'background:#2a0d0dee;color:#ffb4b4;font:12px monospace;border:1px solid #a04a4a;'
        + 'border-radius:5px;pointer-events:none');
      document.body.appendChild(demoHudEl);
    }
    demoHudEl.hidden = false;
    demoHudEl.textContent = `REC \u25cf  frames: ${recorder.frames}`;
  }

  /** F7 / `__sdfGame.demoRecord('start')`. The header is snapshotted at START,
   *  not stop: the seed and query must be the ones the run BEGAN under, or a
   *  replay boots into a different world than the recording captured. */
  function demoRecordStart(): boolean {
    if (recorder) return false;
    replayActive = false;
    recorder = createDemoRecorder({
      seed: demoSeed,
      query: location.search.replace(/^\?/, ''),
      room: playerRoomId(),
      dt: 1 / 60,
      meta: {
        startPose: { x: player.pos[0], z: player.pos[2], yaw: player.yaw, pitch: player.pitch },
        // Free-aim moves a RETICLE; mouselook turns the camera. Which one is
        // live decides whether a replay pins `look` or integrates dx/dy, so it
        // is part of the recording's state, not the view's.
        freeAim: freeAimOn,
        label: 'live',
      },
    });
    updateDemoHud();
    return true;
  }

  /** Stop and (optionally) save. Returns the file so a caller keeps it in
   *  memory; the POST is best-effort — a failed save must not lose the run. */
  async function demoRecordStop(save = true): Promise<DemoFile | null> {
    if (!recorder) return null;
    const file = recorder.stop();
    recorder = null;
    updateDemoHud();
    if (save) {
      try {
        await fetch('/__lab/save-demo', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(file),
          signal: AbortSignal.timeout(15000),
        });
      } catch { /* keep the file; the caller still has it */ }
    }
    return file;
  }

  /** WAIT FOR OUTSTANDING BAKE WORKERS (determinism, 2026-09-14). The gib
   *  swap is pinned to the frame after its submit and the corpse swap to the
   *  frame the reply arrives — both only if the reply HAS arrived. Two replays
   *  of the owner's 56 s recording diverged at one sample because one worker
   *  answered before a resolveGpu yield and the other after it. Every
   *  hand-stepped driver (replay, bench, scenario hash) awaits this before a
   *  step, so the reply is always in hand on the pinned frame. Live play never
   *  calls it. */
  async function awaitBakes(): Promise<void> {
    await chunkBakeJobs.settled();
    if (soldierCorpses) await soldierCorpses.settled();
  }

  /** THE REPLAY DRIVER. Owns the sim: stops the loop, resets the sim clock and
   *  reseeds the streams, applies the scene flags and the start pose, then
   *  steps one fixed frame per recorded frame through applyInputFrame. The
   *  render lock is OFF (a replay mutates) and `demoHold` pins the render-side
   *  clocks, exactly as `demoScenario` does for a recording.
   *
   *  `hash: true` additionally digests the march target and gather layers every
   *  `every` frames — the surface scripts/sdf-demo-hash.mjs drives for
   *  DEMO_HASH_DEM. */
  async function runDemoReplay(file: DemoFile, opts: { hold?: boolean; hash?: boolean; every?: number; hashFrom?: number; label?: string } = {}) {
    if (!file || file.version !== DEMO_VERSION) throw new Error(`demoReplay: version ${file?.version} is not ${DEMO_VERSION}`);
    if (!Array.isArray(file.frames) || file.frames.length === 0) throw new Error('demoReplay: recording has no frames');
    if (opts.hold !== false) demoHold = true;
    handle.setLoopRunning(false);
    const hadAdaptive = adaptiveEnabled; adaptiveEnabled = false;
    const hadReplay = replayActive; replayActive = true;
    const hadLock = simLocked;
    // Render-side cadences reset + settled BEFORE the sim runs, exactly as the
    // bench does under ?simidle. inert for a non-hash caller and REQUIRED for a
    // hash: without it the frame parity and instance pack at frame 0 depend on
    // how long the page happened to boot.
    demoHold = true;
    demoSeedBase = probeFrame;
    postAa.setTimeFrozen(true);
    sdfLayer.resetFieldPhase();
    probeGatherTick = 0;
    // AND the pack waiting to be dispatched. Without this the first replay draw
    // dispatches a pack left over from boot, so the gather gets one extra
    // dispatch in one run and not the other (measured: 301 vs 300), which moves
    // the blended dynamic layer and makes the frame hash flap.
    pendingGather = null;
    probeGather?.reset();
    simLocked = false;
    const hadHoldPlayer = holdPlayerPose; holdPlayerPose = false;
    // Free-aim vs mouselook is a SIM input mode: it decides whether `look` is
    // pinned or dx/dy drives the reticle. The recording says which one it was
    // captured in; an old file without the flag leaves the page as booted.
    const hadFreeAim = freeAimOn;
    if (typeof file.meta?.freeAim === 'boolean') freeAimOn = file.meta.freeAim;
    const iter = createDemoPlayer(file);
    const hashes: import('./frame-hash').FrameHash[] = [];
    const parity: number[] = [];
    const every = Math.max(1, Math.floor(opts.every ?? 4));
    const hashFrom = Math.max(0, Math.floor(opts.hashFrom ?? 0));
    const started = performance.now();
    let frames = 0;
    replayFrame = 0;
    try {
      // The replay starts from the SAME origin the synth/recorder did: sim
      // clock zeroed and the named streams reseeded, so a recorded draw index
      // means the same thing here as it did when captured.
      resetSimClock();
      setRngSeed(file.seed);
      applyDemoQuery(file.query);
      placeFromDemo(file);
      simLocked = false;
      prevInputKeys = new Set<string>();
      currentInputFrame = { keys: [], dx: 0, dy: 0, fire: 0, reload: false, look: [player.yaw, player.pitch] };
      // SETTLE BEFORE FRAME 0. Two replays of one recording differed at the
      // FIRST sampled frame only (frame 0 or 92 alike) — whatever the boot left
      // queued (worker replies, uploads, the first GPU fence) landed on the
      // same yield that took the first hash. Drain it here, before any sim
      // frame, so frame 0 starts from a page that has nothing in flight.
      await awaitBakes();
      await handle.resolveGpu();
      for (let f = 0; ; f++) {
        const frame = iter.next();
        if (!frame) break;
        currentInputFrame = frame;
        await awaitBakes();
        handle.step(file.dt);
        frames++;
        // `hashFrom` skips the RENDER warm-up frames: the scripted recorder
        // settles `warmup` frames before its first hash, and a replay gets the
        // same treatment by not sampling its own first `hashFrom` frames. The
        // SIM still advances through every frame — only the samples are skipped.
        // The final frame is sampled only when it sits on the same interlace
        // field as the regular samples: a recording with an even frame count
        // would otherwise mix parities and the ab gate refuses the run.
        if (opts.hash && f >= hashFrom && (f % every === 0 || (f === file.frames.length - 1 && (f & 1) === (hashFrom & 1)))) {
          await handle.resolveGpu();
          hashes.push(await hashFrame(frameHashDeps, f));
          parity.push(f % 2);
        }
      }
    } finally {
      replayActive = hadReplay;
      simLocked = hadLock;
      adaptiveEnabled = hadAdaptive;
      holdPlayerPose = hadHoldPlayer;
      freeAimOn = hadFreeAim;
      currentInputFrame = neutralInput(currentInputFrame);
    }
    return {
      frames,
      census: sceneCensus(),
      hashes,
      parity,
      every,
      ms: Math.round(performance.now() - started),
      dispatches: probeFrame - demoSeedBase,
      label: opts.label ?? file.startedAt,
      // Bake outcomes, so a diverging replay can be blamed on a swap without a
      // second run: which soldiers baked, the last gib swap frame, bake count.
      bakes: { corpse: soldierCorpses?.stats() ?? null, chunkSwapFrame: lastBakeSwapFrame, chunkBakes: totalBakes, chunkError: chunkBakeJobs.error },
    };
  }

  /** Build a SYNTHETIC recording by driving the scripted firefight through the
   *  SAME input seam a live run uses. The executor cannot play by hand, so this
   *  is the honest stand-in: it does not fabricate a fight, it records one the
   *  scenario actually fights, as an input log. The slug shot is expressed the
   *  way a player would — a KeyE press before, a second press after — so the
   *  recording is self-contained and re-toggles cleanly on replay. */
  async function demoSynthesize(o: { room?: number; walkFrames?: number; fireFrames?: number; gibFrames?: number; label?: string } = {}): Promise<DemoFile> {
    const room = o.room ?? 2;
    const scenario = buildFirefight({ room, walkFrames: o.walkFrames, fireFrames: o.fireFrames, gibFrames: o.gibFrames });
    const problems = validateScenario(scenario);
    if (problems.length) throw new Error(`demoSynthesize: bad scenario: ${problems.join('; ')}`);
    handle.setLoopRunning(false);
    const hadLock = simLocked; simLocked = false;
    const hadAdaptive = adaptiveEnabled; adaptiveEnabled = false;
    const hadReplay = replayActive; replayActive = true;
    const hadHold = demoHold; demoHold = true;
    const slugWas = slugMode;
    // The scripted aim sets player.yaw/pitch directly, so the synthetic
    // recording is captured in MOUSELOOK mode (freeAim=false) and records that
    // as a precondition. Otherwise a replay would run the reticle path and
    // ignore the recorded look.
    const aimWas = freeAimOn;
    freeAimOn = false;
    let rec: DemoRecorder | null = null;
    try {
      // The scenario's frame-0 teleport is a PRECONDITION, not an input: its
      // computed standoff is recorded as the start pose so a replay can put the
      // player there without re-deriving it from a room id.
      const tele = scenario.steps.find(s => s.at === 0 && s.action.kind === 'teleport');
      if (tele) performBenchAction(tele.action);
      resetSimClock();
      setRngSeed(demoSeed);
      slugMode = false;
      currentInputFrame = { keys: [], dx: 0, dy: 0, fire: 0, reload: false, look: [player.yaw, player.pitch] };
      rec = createDemoRecorder({
        seed: demoSeed,
        query: location.search.replace(/^\?/, ''),
        room,
        dt: 1 / 60,
        meta: {
          label: o.label ?? `synthetic-firefight-room${room}`,
          script: 'firefight',
          synthetic: true,
          freeAim: false,
          startPose: { x: player.pos[0], z: player.pos[2], yaw: player.yaw, pitch: player.pitch },
        },
      });
      prevInputKeys = new Set<string>();
      for (let f = 0; f < scenario.frames; f++) {
        let fire: 0 | 1 | 2 = 0;
        let toggleSlug = false;
        for (const a of actionsAt(scenario, f)) {
          if (a.kind === 'aimSurface') aimAtNearestSurface();
          else if (a.kind === 'fire') fire = a.barrels;
          else if (a.kind === 'fireSlug') { toggleSlug = true; fire = 1; }
        }
        const frame: DemoFrame = {
          keys: toggleSlug ? ['KeyE'] : [], dx: 0, dy: 0, fire, reload: false,
          look: [player.yaw, player.pitch],
        };
        // Stage, do NOT apply: `tick` consumes currentInputFrame through
        // applyInputFrame, exactly as the bench's `input` action does. Applying
        // it here too would fire every shot twice.
        currentInputFrame = frame;
        rec.push(frame);
        await awaitBakes();
        handle.step(1 / 60);
        if (toggleSlug) {
          const off: DemoFrame = {
            keys: ['KeyE'], dx: 0, dy: 0, fire: 0, reload: false,
            look: [player.yaw, player.pitch],
          };
          currentInputFrame = off;
          rec.push(off);
          await awaitBakes();
          handle.step(1 / 60);
        }
      }
    } finally {
      slugMode = slugWas;
      freeAimOn = aimWas;
      replayActive = hadReplay;
      simLocked = hadLock;
      adaptiveEnabled = hadAdaptive;
      demoHold = hadHold;
      currentInputFrame = neutralInput(currentInputFrame);
    }
    if (!rec) throw new Error('demoSynthesize: recorder was never created');
    return rec.stop();
  }

  // F7 toggles the input recorder. F8/F9 are telemetry (game-telemetry-controls).
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'F7' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    e.preventDefault();
    if (recorder) void demoRecordStop(true);
    else demoRecordStart();
  });

  // -------------------------------------------------------------------------
  mark('draw-ready');
  // Everything the draw callback reads now exists — let frames draw. See the
  // boot-frame gate's note at setDrawFn.
  drawReady = true;
  (window as unknown as { __sdfGame: unknown }).__sdfGame = {
    /** The boot demo seed: `?seed=` when given, otherwise random. Reported so
     *  a recording/replay can pin it (stage 3 seam `demoInfo()`). */
    get demoSeed() { return demoSeed; },
    /** PIPELINE-CREATION LOG (pipeline-log.ts, startup-hitch attribution).
     *  `setPipelineLog(true)` starts recording per-creation entries (the
     *  device wraps are installed at boot regardless); `pipelineLog()` reads
     *  the long frames (>= 100 ms wall) with the pipelines created during
     *  each, plus the totals and the renderer.compute() per-frame census. */
    setPipelineLog: (on: boolean) => setPipelineLogEnabled(on),
    pipelineLog: () => getPipelineLog(),
    /** STAGE-3 RECORDER SEAMS. `demoRecord('start')` begins logging the input
     *  frames the tick consumes; `'stop'` returns the DemoFile and saves it via
     *  POST /__lab/save-demo. F7 does the same toggle. */
    demoRecord: (action: 'start' | 'stop') => (action === 'start' ? demoRecordStart() : demoRecordStop(true)),
    /** What the recorder/player is doing right now. `frame` is frames recorded
     *  (live) or frames replayed (replay) — never a wall-clock measure. */
    demoInfo: () => ({
      recording: !!recorder,
      replaying: replayActive,
      frame: replayActive ? replayFrame : (recorder?.frames ?? 0),
      seed: demoSeed,
      room: playerRoomId(),
      demoHold,
    }),
    /** Replay a `.dem` (`file` object, or a path/URL to fetch) headlessly and
     *  return `{ frames, census, ... }`. `hash: true` also digests the frame
     *  every `every` steps — the surface scripts/sdf-demo-hash.mjs drives for
     *  DEMO_HASH_DEM. The caller owns booting a page with the matching seed. */
    demoReplay: (fileOrPath: DemoFile | string, opts: { hold?: boolean; hash?: boolean; every?: number; hashFrom?: number; label?: string } = {}) => {
      if (typeof fileOrPath === 'string') {
        return fetch(fileOrPath, { cache: 'no-store' })
          .then((r) => {
            if (!r.ok) throw new Error(`demoReplay: fetch ${fileOrPath} -> ${r.status}`);
            return r.json() as Promise<DemoFile>;
          })
          .then((file) => runDemoReplay(file, opts));
      }
      return runDemoReplay(fileOrPath, opts);
    },
    /** The executor's stand-in for a hand-played run: drive the scripted
     *  firefight through the input seam and return the recording. See
     *  demoSynthesize's note — it records a fight that actually happened. */
    demoSynthesize,
    telemetry: telemetryControls ? {
      start: () => telemetryControls.start(), stop: () => telemetryControls.stop(), mark: () => telemetryControls.mark(),
      get active() { return telemetry.active; }, lastCapture: () => telemetryControls.lastCapture(),
    } : null,
    /** Pass-timing seam: march the gib chunks in their own labelled pass
     *  ('split'), skip them ('skip', wrong frame on purpose), or the shipped
     *  single pass ('merged'). See sdf-layer.ts setChunkPass. */
    setChunkPass: (mode: 'merged' | 'split' | 'skip') => sdfLayer.setChunkPass(mode),
    get chunkPass() { return sdfLayer.chunkPass; },
    setTiles: setGameTiles,
    /** Prototype: per-ray sphere compaction of the tile list. Only has an
     *  effect while tiles are on (tiles-playtest). */
    setTileRayCull: (on: boolean) => gameTiles.setRayCull(on),
    tiles: () => gameTiles.diagnostics(),
    /** CROWD STAGE A: switch between the per-body path and one draw per
     *  character type (?crowd=1 at boot). BOTH directions rebuild the cast:
     *  view.rebind leaves a view's own material pointing at the crowd type's
     *  record buffer, so a plain detach cannot restore the per-body path, and
     *  a fresh spawn is the only honest way back (Task 5 note). `?crowd=0` is
     *  the cheaper canonical opt-out — it never attaches at all. */
    setCrowd(on: boolean) {
      if (on === crowdOn) return;
      crowdOn = on;
      rebuildCast();
    },
    /** STAGE a-2: swap the crowd dispatch on every live type (and remember it
     *  for types created later). The instCfg.y stamp and the tile rebin land
     *  on the next sync(); a fresh page boot with ?crowddispatch= is the
     *  cheaper way to A/B. */
    setCrowdDispatch(mode: 'boxes' | 'quad') {
      crowdDispatch = mode;
      for (const t of crowdTypes.values()) t.setDispatch(mode);
    },
    /** Crowd stage a census: the flag, the dispatch, and per type
     *  attached/live slots plus tile-binding fallbacks (bench + hash
     *  diagnostics). */
    crowdInfo: () => ({
      on: crowdOn,
      // DEFAULT FLIP (task 8, 2026-09-14). `default` is the compiled-in
      // default; `flag` echoes the opt-out so a script can distinguish "on
      // because default" from "on because ?crowd=1". `fallbackReason` is set
      // only when a stage-3-incompatible pass forced this boot per-body.
      default: true,
      flag: crowdParam === '1' ? 'crowd=1' : crowdParam === '0' ? 'crowd=0' : null,
      fallbackReason: crowdFallbackReason,
      // The crowd march requires its tile list (see the draw-fn sync block):
      // true whenever the crowd is live. Gated on `on` so a crowd-off boot
      // with stale type uniforms cannot read true.
      tilesOn: crowdOn && [...crowdTypes.values()].some(t => t.info().tilesOn),
      dispatch: crowdDispatch,
      // Fire/gib profiling (2026-09-14): aggregate counters over the live
      // types, computed from ONE info() pass (info() runs the diagnostic
      // tile binner on demand, so calling it repeatedly is not free).
      ...(() => {
        let atlasFlushes = 0, atlasRows = 0, recordsFlushes = 0, volumeRebinds = 0;
        const types = [...crowdTypes].map(([n, t]) => {
          const i = t.info();
          atlasFlushes += i.atlasFlushes; atlasRows += i.atlasRows;
          recordsFlushes += i.recordsFlushes; volumeRebinds += i.volumeRebinds;
          return { name: n, ...i };
        });
        return { atlasFlushes, atlasRows, recordsFlushes, volumeRebinds, types };
      })(),
    }),
    backend: handle.backend,
    /** Place the player at (x, z) with the given yaw/pitch and zero velocity
     *  (the distance-crowd bench's framing seam, 2026-09-14). Same fields
     *  `teleport()` writes; returns the enclosure key under the feet so a
     *  caller can assert the pose landed in the intended room. */
    placePlayer(p: { x: number; z: number; yaw: number; pitch?: number }) {
      player.pos = [p.x, 0, p.z];
      player.vel = [0, 0, 0];
      player.yaw = p.yaw;
      player.pitch = p.pitch ?? 0;
      player.grounded = true;
      return enclosureKeyAt(p.x, p.z);
    },
    /** Set the player pose. y defaults to 0 (feet on the floor). */
    setPose(x: number, z: number, yaw: number, pitch = 0, y = 0) {
      player.pos = [x, y, z];
      player.vel = [0, 0, 0];
      player.yaw = yaw;
      player.pitch = pitch;
      player.grounded = y === 0;
    },
    pose: () => ({ pos: [...player.pos] as Vec3, yaw: player.yaw, pitch: player.pitch }),
    /** Project a world point through the LIVE game camera to NDC + a
     *  behind-camera flag (M2 task 5 boot driver: proves a capture subject
     *  is actually IN FRAME — the old wounded capture faced +Z with the
     *  actor 1.2 m to the west and nothing caught it). |ndc| <= 1 is on
     *  screen; z > 1 means behind/clipped. */
    screenPosOf(x: number, y: number, z: number) {
      const v = new THREE.Vector3(x, y, z).project(camera);
      return { x: v.x, y: v.y, z: v.z };
    },
    /** The live camera's world position (task-6 normal-direction evidence:
     *  an OUTWARD camera-facing surface normal points toward the eye, so it
     *  satisfies n·(eye−surface) > 0 — the camera-surface oracle). */
    cameraWorld: () => [camera.position.x, camera.position.y, camera.position.z] as Vec3,
    /** The exact inverse of screenPosOf: the world point `dist` metres along
     *  the live camera ray through an NDC point (depth-probe evidence seam —
     *  lets a gate place a forward sprite on a pixel it has already verified
     *  is empty-far in the raw G-buffer). */
    screenRayToWorld(ndcX: number, ndcY: number, dist: number) {
      const v = new THREE.Vector3(ndcX, ndcY, 0.5).unproject(camera);
      v.sub(camera.position).normalize();
      const w = camera.position.clone().addScaledVector(v, dist);
      return [w.x, w.y, w.z] as Vec3;
    },
    /** Teleport to a room's centre, facing +z. */
    teleport(roomId: number) {
      const r = ROOMS.find(r => r.id === roomId);
      if (!r) return false;
      player.pos = [(r.minX + r.maxX) / 2, 0, (r.minZ + r.maxZ) / 2];
      player.vel = [0, 0, 0];
      player.yaw = 0;
      player.pitch = 0;
      return true;
    },
    /** The player's ground position — a capture rig needs it to stand beside a
     *  chosen body rather than detonate across the room. Read-only. */
    playerPos: () => [...player.pos] as Vec3,
    /** Enclosure key under the player's feet ('room1'..'room5', tunnel, 'void'). */
    room: () => enclosureKeyAt(player.pos[0], player.pos[2]),
    /** Hand-step N frames at dt seconds each; stops the rAF loop first. */
    step(n: number, dt = 1 / 60) {
      handle.setLoopRunning(false);
      for (let i = 0; i < n; i++) {
        handle.step(dt);
        if (frameCount++ % 10 === 0) updateHud();
      }
    },
    setLoopRunning: (on: boolean) => handle.setLoopRunning(on),
    /** IS THE STATIC PROBE GRID BAKED YET?
     *
     *  The per-room grids are gathered ONCE at boot in a module WORKER, and the
     *  reply lands on whichever frame it finishes. Nothing in a recording pinned
     *  WHEN, so a capture started before the bake completed would differ from one
     *  started after it — the same async-landing problem the plan already calls
     *  out for the chunk-bake worker. `ready` is false until every queued room
     *  has replied, so a recorder can WAIT rather than assume.
     *
     *  This is a precondition seam, not a gate: it reports, it does not block.
     *  See scripts/sdf-demo-hash.mjs, which refuses to record until it is true. */
    roomProbesReady: () => roomProbes.ready,
    /** THE FRAME HASH (deterministic demo recordings stage 2, 2026-09-10).
     *  Hashes the CURRENT rendered state — it does NOT step or mutate
     *  anything, which is what makes a recorded frame reproducible: the
     *  caller owns freeze/step ordering, this only measures.
     *
     *  `frame` is the caller's recording frame index, echoed back so a
     *  recording is self-describing.
     *
     *  Reads the march target and the gather's dynamic layer. The dynamic
     *  layer is when the gather is bound, which is the shipped configuration,
     *  so a missing layer means the gather is off rather than that the hash
     *  is broken — but an unreadable MARCH TARGET throws, because a hash
     *  seam that silently hashes nothing reports "identical" forever and
     *  gets trusted.
     *
     *  Usage (see scripts/sdf-demo-hash.mjs for the whole recipe):
     *    __sdfGame.setDemoHold(true);          // pin the render-side clocks
     *    __sdfGame.setLightClockFrozen(true);  // pin the flicker clock
     *    __sdfGame.step(90); __sdfGame.step(2);
     *    await __sdfGame.frameHash(0);         // step first, hash second
     */
    frameHash: async (frame = 0) =>
      hashFrame(frameHashDeps, frame),
    /** THE PRESENTED FRAME, as the browser composes it.
     *
     *  WHY THIS IS A SEPARATE PATH from `frameHash`. `frameHash` reads GPU
     *  targets (the march target, the gather's layers) — the right instrument for
     *  asking "did the RENDERER change", and the one that catches a zeroed probe
     *  layer or a mistranscribed kernel. But it is NOT the image the owner looks
     *  at: everything downstream of the march — the interlaced field's held rows,
     *  FXAA, the VHS pass with its own temporal blend and 60/24 Hz row-noise
     *  hashes — runs after it, and a shader bug in any of those would be invisible
     *  to it. This returns the CANVAS instead, so a caller can hash what is
     *  actually on screen.
     *
     *  The trade, stated plainly: `toDataURL` yields 8-BIT premultiplied sRGB, so
     *  a difference below one 8-bit step is invisible here — and the 2026-09-05
     *  flicker wobble lives at exactly that level. Use this to check what the
     *  owner SEES; use `frameHash` to check what the renderer COMPUTED. Neither
     *  subsumes the other.
     *
     *  Returns base64 PNG without the data-URL prefix. The caller decodes and
     *  hashes it (scripts/sdf-demo-hash.mjs, using the same tested byte digest),
     *  so no image codec is needed in the page. */
    presentedShot: (): string => {
      const canvas = handle.renderer.domElement as HTMLCanvasElement;
      const url = canvas.toDataURL('image/png');
      const comma = url.indexOf(',');
      return comma >= 0 ? url.slice(comma + 1) : url;
    },
    /**
     * THE SURFACE 'bodies' COMPOSITES INTO, read back (2026-09-10).
     *
     * WHY THIS EXISTS. The march target and the composited output are DIFFERENT
     * textures, and the frame hash only ever read the former — which is why the
     * h/3 and h/4 investigation could prove the flesh is marched (3.9% of the
     * march target is surface at every divisor) and still not see that it never
     * reaches the frame. Chasing that without this seam means guessing, and three
     * guesses were already wrong.
     *
     * Returns the same padded float readback shape as `__sdfGameDebug`
     * .readMarchTarget() — base64 rgba32f plus the real width and height — because
     * a multi-megabyte float readback must not cross CDP as a returnByValue
     * object. WIDTH AND HEIGHT ARE THE LOGICAL ONES; the caller must de-pad with
     * `stride = Math.ceil(w * 16 / 256) * 64` floats, exactly as the hash does.
     *
     * Null when there is no redirect (nothing is rendering into an offscreen
     * target, so "the output" is the canvas — use presentedShot for that).
     */
    readOutputTarget: async (): Promise<{ w: number; h: number; rgba32f: string } | null> => {
      const rt = sdfLayer.outputTarget;
      if (!rt) return null;
      const w = rt.width, h = rt.height;
      const raw = new Float32Array(await handle.renderer.readRenderTargetPixelsAsync(rt, 0, 0, w, h));
      const bytes = new Uint8Array(raw.buffer);
      let binary = '';
      for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      return { w, h, rgba32f: btoa(binary) };
    },
    /** Pin the render-side subsampling clocks the frame hash needs constant
     *  (actor animation phase, gather frameSeed). See the demoHold declaration.
     *  OFF by default and inert in normal play. */
    setDemoHold: (on: boolean) => {
      demoHold = on;
      demoSeedBase = probeFrame;
      // VHS's time hashes come off `performance.now()` 60/24/chromaBurst times a
      // second, so pin them with the hold. Its temporal blend is NOT pinned by
      // this and cannot be — see post-aa setTimeFrozen: that is exactly why the
      // frame hash measures the march target and not the presented image.
      postAa.setTimeFrozen(on);
      // NOTE, and it is a lesson worth keeping: an earlier cut RESET
      // `probeFrame` here to re-anchor the gather's per-dispatch seed phase. It
      // was removed because (a) the seed is now PINNED for a recording (see the
      // frameSeed site), so the phase no longer exists to anchor, and (b) the
      // reset silently corrupted `seedIdle` — a diagnostic computed as
      // `probeFrame - demoSeedBase` across a reset boundary, which made it
      // NEGATIVE (-34, -37, -1 in the stored runs). A diagnostic that can read
      // as nonsense is worse than no diagnostic: it was briefly used as
      // evidence. Do not reset a running counter to fix a phase problem.
      return demoHold;
    },
    get demoHold() { return demoHold; },
    /** Record (or replay) a scenario as a stream of frame hashes. The driver:
     *
     *    __sdfGame.setDemoHold(true);
     *    __sdfGame.setLightClockFrozen(true);
     *    __sdfGame.step(90);                       // settle transients
     *    const rec = await __sdfGame.demoScenario({ kind: 'firefight', room: 4, frames: 120, every: 4 });
     *
     *  Preconditions are the CALLER's, deliberately: settling and freezing are
     *  the same recipe every capture script in this repo already uses, and
     *  hiding it here would make a recording that looks reproducible while its
     *  pre-roll differed. See scripts/sdf-demo-hash.mjs.
     *
     *  The scenario is DATA (game-bench-scenario.ts) and actions are applied
     *  through the SAME handler the perf bench drives, so a replay runs the
     *  scenario the bench measured rather than a lookalike. Frames are stepped
     *  one at a time and the render lock is OFF, because scenario actions
     *  mutate and a locked tick would silently swallow them.
     *
     *  Returns per-frame hashes with the scenario's own metadata, so a stored
     *  recording says which scenario, which room and how many frames produced
     *  it — a hash without those is not evidence of anything. */
    demoScenario: async (o: {
      kind?: 'firefight' | 'closeup';
      room?: number;
      /** Total frames to drive. Defaults to the scenario's own length. */
      frames?: number;
      /** Hash every Nth frame. 1 hashes all of them (slow: each hash is a
       *  ~1M-float readback). Default 4. */
      every?: number;
      /** Closeup frames, when kind === 'closeup'. */
      closeupFrames?: number;
      walkFrames?: number; fireFrames?: number; gibFrames?: number;
      /** Freeze the gather + animation clocks for the run. Default true:
       *  a recording whose frameSeed drifts cannot replay. */
      hold?: boolean;
      /** Hash the final frame position this many EXTRA times (each after its
       *  own step) to measure per-frame randomness with the boot state fixed.
       *  Default 0. See the `repeated` field of the result. */
      repeat?: number;
      /** Re-hash the SAME frame position this many times with NO step in
       *  between. The decisive control: if these differ, the nondeterminism is
       *  in the READBACK or in unwritten texels of the target — not in anything
       *  the scene did between frames. Default 0. */
      resample?: number;
      /** Run with the SIMULATION LIVE (scenario actions really apply) instead
       *  of the RENDER LOCK. Default FALSE, and that default is the point:
       *
       *  Locked (default) records pure re-renders of one settled instant, which
       *  tests what this tool exists to test — that the renderer is a
       *  deterministic function of its inputs — with no dependence on sim
       *  determinism at all. That is the mode the black-silhouette bug and a
       *  mistranscribed gather kernel both show up in.
       *
       *  `sim: true` steps a live simulation, which additionally requires every
       *  sim input to be reproducible. It is NOT yet: two runs of one spec
       *  diverge at frame 0 on this branch (measured 2026-09-10, the first
       *  honest run of this seam — the march target's extents and the dynamic
       *  layer's per-probe values differ while their activity counts match, i.e.
       *  the SAME game in a slightly different state). Use it to hunt that bug,
       *  not to gate a change. */
      sim?: boolean;
    } = {}) => {
      const scenario: Scenario = o.kind === 'closeup'
        ? buildCloseup({ frames: o.closeupFrames })
        : buildFirefight({
          room: o.room ?? 4,
          walkFrames: o.walkFrames,
          fireFrames: o.fireFrames,
          gibFrames: o.gibFrames,
        });
      const problems = validateScenario(scenario);
      if (problems.length) throw new Error(`bad scenario: ${problems.join('; ')}`);
      const total = o.frames ?? scenario.frames;
      const every = Math.max(1, Math.floor(o.every ?? 4));
      if (o.hold !== false) demoHold = true;

      // Frames must be driven by hand: the rAF loop would race the recorder
      // and a hidden/visible page would change which frames exist at all.
      handle.setLoopRunning(false);
      const hadAdaptive = adaptiveEnabled;
      adaptiveEnabled = false;

      // Named `hashes`, NOT `hashFrame`: the latter is the imported digester,
      // and shadowing it inside this scope is a real failure mode.
      // PARITY IS PART OF THE SIGNATURE. The shipped 'bodies' style marches
      // alternate scanlines, so consecutive frames are DIFFERENT BY DESIGN —
      // measured 2026-09-10: the march digest alternates between exactly two
      // values on a locked, unchanging scene. A recording must therefore sample
      // the same field parity every time, or every comparison between two
      // correct frames reports a divergence. `parityOf` is the running field
      // phase, and the recorder asserts the sampled parities agree.
      let stepsTaken = 0;
      const parityOf = (): number => stepsTaken % 2;
      const hashes: import('./frame-hash').FrameHash[] = [];
      const parity: number[] = [];
      const repeated: import('./frame-hash').FrameHash[] = [];
      const repeatedParity: number[] = [];
      const resampled: import('./frame-hash').FrameHash[] = [];
      const started = performance.now();
      const liveSim = o.sim === true;
      const hadLock = simLocked;
      // LOCK for the recording. tick() then mutates nothing, so each stepped
      // frame is a pure re-render of one settled instant (the same discipline
      // the close-up gates use) and the hash compares RENDERER state rather
      // than sim state.
      if (!liveSim) simLocked = true;
      try {
        for (let frame = 0; frame < total; frame++) {
          for (const a of actionsAt(scenario, frame)) performBenchAction(a);
          // 1/60 is the bench's fixed step and the only dt this format means.
          await awaitBakes();
          handle.step(1 / 60);
          stepsTaken++;
          // The final frame is sampled only when the regular cadence would MISS
          // it: `frame % every === 0 || frame === total - 1` could sample one
          // frame twice with an odd gap between, which flips the field parity
          // mid-recording and makes the whole run incomparable.
          if (frame % every === 0 || (frame === total - 1 && (total - 1) % every !== 0)) {
            await handle.resolveGpu();
            hashes.push(await hashFrame(frameHashDeps, frame));
            parity.push(parityOf());
          }
        }
        // READBACK CONTROL: the SAME position, no step, nothing between the
        // hashes. Separates "the frame changed" from "the readback is not a
        // function of the frame".
        for (let i = 0; i < Math.max(0, Math.floor(o.resample ?? 0)); i++) {
          resampled.push(await hashFrame(frameHashDeps, total));
        }
        // SAME-SESSION CONTROL: hash the SAME frame position again, after a
        // further step. Locked, that step mutates nothing, so this measures
        // per-frame randomness alone, with the boot state held fixed.
        for (let i = 0; i < Math.max(0, Math.floor(o.repeat ?? 0)); i++) {
          // TWO steps, not one: one step returns the SAME frame at the OTHER
          // field parity, which is a different frame by design. Stepping a pair
          // keeps parity fixed, so this control measures frame determinism
          // instead of measuring the interlace.
          await awaitBakes();
          handle.step(2 / 60);
          stepsTaken += 2;
          await handle.resolveGpu();
          repeated.push(await hashFrame(frameHashDeps, total));
          repeatedParity.push(parityOf());
        }
      } finally {
        adaptiveEnabled = hadAdaptive;
        simLocked = hadLock;
        // The loop stays OFF on purpose: a caller that wants live play back
        // says so explicitly, and one that forgets gets a still page rather
        // than a recording that quietly continued while it was being read.
      }
      return {
        scenario: o.kind === 'closeup' ? 'closeup' : `firefight-room${o.room ?? 4}`,
        room: o.room ?? 4,
        frames: total,
        every,
        tilesX: DEFAULT_TILES_X,
        tilesY: DEFAULT_TILES_Y,
        sim: liveSim,
        /** The SAME final frame hashed `repeat` times, each after its own step.
         *  The control that separates "this renderer is nondeterministic" from
         *  "these two boots did not start from the same state": if these agree
         *  within one session, a cross-boot mismatch is a BOOT-STATE difference,
         *  not per-frame randomness. */
        repeated: repeated.map((r) => r.layers),
        resampled: resampled.map((r) => r.layers),
        /** Field parity of each sampled hash. MUST be constant across a
         *  recording: the interlaced field makes alternate frames differ by
         *  design, so a set of mixed parities cannot be compared to anything. */
        parity,
        repeatedParity,
        dispatches: probeFrame - demoSeedBase,
        ms: Math.round(performance.now() - started),
        hashes,
      };
    },
    /** Freeze/unfreeze the wanderers (pose, rig and shader clock all pin). */
    freeze: (on: boolean) => { wanderFrozen = on; },
    get frozen() { return wanderFrozen; },
    /** TASK-6 RENDER LOCK: while on, tick() mutates nothing (see simLocked),
     *  so step(n) is n deterministic re-renders. Turn OFF around any state
     *  change; settle transients with step(~90); turn back on to observe. */
    setRenderLock: (on: boolean) => { simLocked = on; },
    get renderLock() { return simLocked; },
    /** TASK-6 DIAGNOSTIC LIGHT CLOCK: the practical-fire flicker runs on
     *  wall-clock performance.now() INSIDE the draw path, which the render
     *  lock does not freeze — two renders of a locked scene still differ in
     *  practical intensity. G-buffer invariance never cared; MATCHED LIT
     *  screenshots do. Freezing this one clock pins the flicker phase so
     *  locked renders are bit-comparable in lit output too. Gate-only:
     *  default OFF, ordinary gameplay never freezes it. */
    setLightClockFrozen: (on: boolean) => {
      if (on) flickerClockFrozenAt = performance.now() * 0.001;
      lightClockFrozen = on;
    },
    get lightClockFrozen() { return lightClockFrozen; },
    setProbeWeight: pushProbeWeight,
    get probeWeight() { return probeWeight; },
    /** Every zombie: id, room, live ground pose. */
    zombies: () => actors.map(a => ({ id: a.id, room: a.room, ...a.pose() })),
    /** Per-actor brain readout — the crowd/AI capture driver's oracle. */
    encounter: () => encounter.debug(),
    brains: () => actors.map(a => {
      const b = a.mind().debug();
      const p = a.pose().pos;
      return {
        id: a.id, room: a.room, kind: a.kind, phase:a.debug().phase, state: b.state, alert: b.alert,
        swingT: b.swingT, side: b.side, variant: b.variant,
        hasToken: a.debug().hasToken,
        aimT: b.aimT, cooldown: b.cooldown, sinceFire: a.sinceFire(),
        meleeContacts: a.debug().meleeContacts,
        speed: a.debug().speed, target: a.debug().target,
        dist: Math.hypot(p[0] - player.pos[0], p[2] - player.pos[2]),
        bearing: Math.atan2(p[0] - player.pos[0], p[2] - player.pos[2]),
      };
    }),
    /** Ring tuning, so a capture driver asserts against the real numbers
     *  rather than duplicating them. */
    ringTuning: () => ({ ...RING_TUNING }),
    /** attack.ts's beat boundaries, so a capture driver derives its phases
     *  from the real numbers instead of duplicating them. */
    attackTuning: () => ({ ...ATTACK_TUNING }),
    /** CAPTURE SEAM: force one actor into a specific swing pose and step it,
     *  so a strip can photograph the same body at chosen phases. Not a
     *  simulation input — it drives the actor's motion config directly for
     *  one frame and the brain overwrites it on the next step. */
    poseSwing: (id: number, phase: number, side: 'L' | 'R', variant: string) => {
      actors.find(a => a.id === id)?.forceSwing(phase, side, variant as SwingVariant);
    },
    /** Smallest centre-to-centre distance between any two zombies (m).
     *  Two 0.35 m bodies touch at 0.70; below that they are interpenetrating. */
    crowdMinDist: () => minPairDistance(actors.map(a => {
      const p = a.pose().pos;
      return { x: p[0], z: p[2], r: ZOMBIE_RADIUS, mobile: true };
    })),
    /** Closest surface gap (m) between arm primitives belonging to DIFFERENT
     *  bodies. Negative means interpenetration — which is exactly the defect
     *  the owner photographed on 2026-09-04, so it is a number now rather
     *  than something we look at. Endpoint-to-endpoint minus the two radii:
     *  a conservative under-estimate of the true capsule gap, which is the
     *  right direction for a gate (it can cry wolf, it cannot miss a clip).
     *  O(n^2 k^2) over ten bodies — only the capture driver calls it. */
    minHandGap: () => {
      const arms = actors.map(a => {
        const posed = a.posed();
        const pts: { p: Vec3; r: number }[] = [];
        for (const prim of posed.prims) {
          if (prim.limb !== 'armL' && prim.limb !== 'armR') continue;
          pts.push({ p: prim.a, r: prim.radius }, { p: prim.b, r: prim.radius });
        }
        return pts;
      });
      let best = Infinity;
      let bestPair: [number, number] = [-1, -1];
      for (let i = 0; i < arms.length; i++) {
        for (let j = i + 1; j < arms.length; j++) {
          for (const u of arms[i]!) {
            for (const v of arms[j]!) {
              const g = Math.hypot(u.p[0] - v.p[0], u.p[1] - v.p[1], u.p[2] - v.p[2])
                - u.r - v.r;
              if (g < best) { best = g; bestPair = [actors[i]!.id, actors[j]!.id]; }
            }
          }
        }
      }
      return best;
    },
    /** Which two bodies produced minHandGap()'s number, and what rooms they
     *  are in. Diagnostic: the metric is GLOBAL, so a negative can come from
     *  two idle wanderers in a distant room rather than from the melee ring
     *  around the player — which is exactly what it did on 2026-09-05. */
    minHandGapPair: () => {
      const arms = actors.map(a => {
        const posed = a.posed();
        const pts: { p: Vec3; r: number }[] = [];
        for (const prim of posed.prims) {
          if (prim.limb !== 'armL' && prim.limb !== 'armR') continue;
          pts.push({ p: prim.a, r: prim.radius }, { p: prim.b, r: prim.radius });
        }
        return pts;
      });
      let best = Infinity;
      let pair: { a: number; b: number; roomA: number; roomB: number } | null = null;
      for (let i = 0; i < arms.length; i++) {
        for (let j = i + 1; j < arms.length; j++) {
          for (const u of arms[i]!) {
            for (const v of arms[j]!) {
              const g = Math.hypot(u.p[0] - v.p[0], u.p[1] - v.p[1], u.p[2] - v.p[2])
                - u.r - v.r;
              if (g < best) {
                best = g;
                pair = {
                  a: actors[i]!.id, b: actors[j]!.id,
                  roomA: actors[i]!.room, roomB: actors[j]!.room,
                };
              }
            }
          }
        }
      }
      return { gap: best, ...(pair ?? {}) };
    },
    /** Debug seam for the crowd capture driver: the separation nudge, by id,
     *  with the same bounds clamp and furniture rejection. Lets a driver
     *  PLACE bodies (e.g. coincident, to watch separate() push them apart)
     *  without a separate teleport path that could dodge the clamps. */
    zombieNudge: (id: number, dx: number, dz: number) => {
      actors.find(a => a.id === id)?.nudge(dx, dz);
    },
    /** One zombie's internals — the weapon seam: view (uniforms/wounds),
     *  posed() (raycast target), boundRig() (impulse/recoil entry). */
    zombie: (id: number) => {
      const a = actors.find(a => a.id === id);
      return a ? {
        get body() { return a.body; },
        view: a.view, posed: a.posed, boundRig: a.boundRig, pose: a.pose, room: a.room,
        hit: a.hit, hitSlug: a.hitSlug,
        woundCount: () => a.wounds().length,
        woundList: () => [...a.wounds()],
        visualWoundList: () => [...a.visualWounds()],
      } : undefined;
    },
    /** Where every wound of a body sits IN WORLD SPACE right now — the
     *  surface anchor (= the GPU carve sphere's centre) plus the depth-slab
     *  cap, mapped at the actor's live yaw (the body-frame wound contract,
     *  game-actor refreshWounds). The placement gate diffs the surface
     *  against the fired ray's impact point; carveDepth is the punch-through
     *  guard (0.45 × measured local flesh). */
    debugWounds: (id: number) => {
      const a = actors.find(a => a.id === id);
      if (!a) return undefined;
      const prims = a.posed().prims;
      const yaw = a.pose().yaw;
      return a.wounds().map(w => ({
        surface: woundWorldPos(prims, w, yaw),
        // Where it was PLACED, before the hit's recoil shove moved the body.
        // `surface` is the live position and is what the renderer uses; this
        // is the one to compare against a pre-shot prediction. Conflating the
        // two is what made the slug placement gate read 18 cm of "error" that
        // was really IMPULSE.blast — see game-actor's stampWorld note.
        stampSurface: a.stampWorldOf(w),
        carveNormal: woundCarveNormal(prims, w, yaw),
        carveDepth: w.carveDepth,
        radius: w.radius,
        type: w.type,
        primIdx: w.primIdx,
      }));
    },
    /** Task-8 evidence seam: live gut-rope state per body, read-only. A body
     *  with no rope entry reports {none: true}. droplets is the rope's current
     *  'gut'-kind population in the blood sim (the goo pass's input). */
    guts: () => actors.map(a => {
      const e = gutRopes.get(a.id);
      const nodes = e?.chain.nodes ?? [];
      return {
        id: a.id,
        room: a.room,
        phase: a.debug().phase,
        none: !e,
        attached: e?.chain.attached ?? false,
        settled: e?.chain.settled ?? false,
        nodes: nodes.length,
        head: nodes[0] ? [...nodes[0]!.pos] as Vec3 : null,
        tail: nodes.length ? [...nodes[nodes.length - 1]!.pos] as Vec3 : null,
        droplets: e?.droplets.length ?? 0,
        woundCavity: e ? e.wound.cavity === true : null,
      };
    }),
    /** Walk the player toward (x, z) through the real collision path until
     *  within 0.25 m (or walkCancel). Pairs with step()/setLoopRunning. */
    walkTo: (x: number, z: number) => { autopilot = { x, z }; },
    walkCancel: () => { autopilot = null; },
    get walking() { return autopilot !== null; },
    frameMs: () => frameEma,
    /** Frames actually PRESENTED. Under a frame cap the rAF loop still wakes
     *  every vsync and skips most of them, so raw rAF gaps measure the display
     *  rather than the cadence -- count this instead. */
    presentCount: () => frameCount,
    bodiesOnScreen,
    // ---------------------------------------------------------------
    // GRAPESHOT — the weapon surface. fire(1|2) bypasses pointer lock so
    // the headless driver can shoot; aim with setPose(yaw, pitch).
    // ---------------------------------------------------------------
    fire: (barrels: 1 | 2 = 1) => fire(barrels),
    get flashVisible() { return flashGroup?.visible ?? false; },
    /** Free-aim seam, for the gate and for A/B by hand. */
    get freeAim() { return freeAimOn; },
    setFreeAim(on: boolean) { freeAimOn = on; aim = { x: 0, y: 0 }; updateHud(); return freeAimOn; },
    get aimPoint() { return { x: aim.x, y: aim.y }; },
    setAimPoint(x: number, y: number) {
      aim = { x: Math.min(1, Math.max(-1, x)), y: Math.min(1, Math.max(-1, y)) };
      return { x: aim.x, y: aim.y };
    },
    get weaponLeanDeg() { return { yaw: weaponYawDeg, pitch: weaponPitchDeg }; },
    /** Live free-aim / bob knobs. Every one of these is a feel number that has
     *  to be played rather than reasoned about:
     *    __sdfGame.setAimTuning({ deadzoneX: 0.5, turnRateX: 1.4 })
     *    __sdfGame.setAimTuning({ amountX: 0.03, amountY: 0.02 })   // bob
     */
    setAimTuning(t: Partial<Record<string, number>>) {
      for (const [k, v] of Object.entries(t)) {
        if (v === undefined) continue;
        if (k in FREE_AIM) (FREE_AIM as unknown as Record<string, number>)[k] = v;
        else if (k in BOB) (BOB as unknown as Record<string, number>)[k] = v;
      }
      return { ...FREE_AIM, bob: { ...BOB } };
    },
    get bob() { return { distance: bobDistance, amount: bobAmount }; },
    /** Live finish knobs. The owner's look pass: the gun reads a touch too
     *  shiny under the dungeon rig and the hands are hard to see at this
     *  exposure. Both are judgement calls that depend on the final lighting,
     *  so they are knobs rather than new constants:
     *    __sdfGame.setGunTuning({ roughness: 0.30, envMapIntensity: 0.85 })
     *    __sdfGame.setGunTuning({ handNormalScale: 1.4 })
     */
    setGunTuning(t: {
      roughness?: number; envMapIntensity?: number; metalness?: number;
      handNormalScale?: number; handRoughness?: number;
    }) {
      for (const m of gunMaterials) {
        if (t.roughness !== undefined) m.roughness = t.roughness;
        if (t.envMapIntensity !== undefined) m.envMapIntensity = t.envMapIntensity;
        if (t.metalness !== undefined) m.metalness = t.metalness;
        m.needsUpdate = true;
      }
      if (handMaterial) {
        if (t.handNormalScale !== undefined) handMaterial.normalScale.setScalar(t.handNormalScale);
        if (t.handRoughness !== undefined) handMaterial.roughness = t.handRoughness;
        handMaterial.needsUpdate = true;
      }
      return {
        roughness: gunMaterials[0]?.roughness ?? null,
        envMapIntensity: gunMaterials[0]?.envMapIntensity ?? null,
        metalness: gunMaterials[0]?.metalness ?? null,
        handNormalScale: handMaterial?.normalScale.x ?? null,
      };
    },
    get shells() { return shells; },
    /** Unlimited ammo (the shipped default; ?ammo=finite turns it off). */
    get infiniteAmmo() { return infiniteAmmo; },
    setInfiniteAmmo: (on: boolean) => {
      infiniteAmmo = on;
      // Turning it OFF with 0 shells in the gun must not leave the player
      // holding a weapon that can only click: refill so the first dry state is
      // one the player creates by firing.
      if (!on) shells = MAGAZINE_CAPACITY;
      updateHud();
      return infiniteAmmo;
    },
    get hingeOpenRad() { return hingePivot?.rotation.x ?? 0; },
    /** The reload's total length, seconds. Exposed so hand-stepping gates can
     *  DERIVE their wait budget instead of hardcoding a tick count: the shorty
     *  gate carried `57 ticks` against a 0.95 s reload, was still carrying it
     *  when the reload became 1.05 s, and failed a correct build the moment it
     *  became 1.30 s. A gate that has to be edited every time a constant moves
     *  will eventually be edited wrongly, or not at all. */
    get reloadTotalSec() { return RELOAD.totalSec; },
    /** The two chamber mouths in WORLD space, right now. The eject origin is
     *  supposed to track these through the swing; nothing proved it did. */
    breechWorld: () => breechNodes.map((n) => {
      const v = new THREE.Vector3(); n.getWorldPosition(v);
      return [v.x, v.y, v.z] as Vec3;
    }),
    /** Where the last case was when it was handed to the tumble. */
    get lastEjectOrigin() { return lastEjectOrigin; },
    /** The muzzle locators in world space right now (chunk-bake gate: lets a
     *  driver SOLVE for the player stance that puts the slug's spawn point
     *  where it wants — the muzzle offset is ~0.6 m of view-space rig, which
     *  no hand-derived stance reproduces). Read-only. */
    muzzleWorld: () => muzzleWorld(),
    /** Live projectile debug (chunk-bake gate): kind, position, age. */
    pelletsDebug: () => pellets.map(p => ({ kind: p.kind, pos: [...p.pos] as [number, number, number], age: p.ageSec })),
    /** The EXACT ray a slug fired right now would take (chunk-bake gate):
     *  origin = muzzleWorld(), dir = convergedDir(muzzleWorld()) — the same
     *  two calls fire() makes. A driver can measure a ray-to-target miss
     *  BEFORE spending the shot. Read-only. */
    slugRay: () => {
      const o = muzzleWorld();
      const d = convergedDir(o);
      return { origin: o, dir: d };
    },
    /** The arms, for the gate: both present, skin has no emissive, the watch
     *  screen exists. `watchScreen` is the drawable canvas for a later pass. */
    get arms() {
      return {
        left: !!arms?.left.parent, right: !!arms?.right.parent,
        skinEmissive: arms?.skin.emissiveIntensity ?? null,
        watch: !!arms?.left.getObjectByName('Watch_Screen'),
      };
    },
    get watchScreen() { return arms?.screen ?? null; },
    /** The eject arc's seed for the current/last reload; 0 = reference arc. */
    get reloadSeed() { return reloadSeed; },
    get reloadSpeed() { return reloadSpeed; },
    setReloadSpeed(x: number) { reloadSpeed = Math.max(0.01, x); updateHud(); },
    /** Hold one seed for every reload from now on (null releases it), so a
     *  gate can capture the same arc twice. */
    pinReloadSeed(seed: number | null) { pinnedReloadSeed = seed; },
    get gunReady() { return gunReady; },
    get cooldown() { return cooldown; },
    // SLUG MODE surface + HUD-truthful flag.
    get slugMode() { return slugMode; },
    setSlugMode(on: boolean) { slugMode = on; updateHud(); },
    fireSlug: () => { const keep = slugMode; slugMode = true; try { return fire(1); } finally { slugMode = keep; } },
    // ---------------------------------------------------------------
    // BLEED seams (bleeding-wounds). Ships ON; setBleed(false) is the
    // off gate — it freezes AND clears the blood sim so OFF is pixel-
    // identical to the pre-feature page (no frozen mid-air droplets).
    // ---------------------------------------------------------------
    setBleed: (on: boolean) => {
      bleedEnabled = on;
      for (const o of bloodView.objects) o.visible = on;
      if (!on) {
        bloodSim.droplets.length = 0;
        bloodSim.splats.length = 0;
      }
    },
    get bleed() {
      return {
        enabled: bleedEnabled,
        emitters: bleed.live(bleedClock).length,
        droplets: bloodSim.droplets.length,
        splats: bloodSim.splats.length,
      };
    },
    /** PLACEMENT GATE (2026-08-26): where a slug fired RIGHT NOW would hit —
     *  computed by exactly the code fire() uses (muzzleWorld + converged
     *  dir) against each actor's CURRENT posed field. No state mutated.
     *  Diff against debugWounds() after firing to assert the crater landed
     *  where the ray struck. */
    predictSlugHit: () => predictSlugHitNow(),
    /** Hull-holes A/B seams (2026-08-27). setOccluder turns the occluder
     *  pre-pass (and its tMax clamp) on/off; setHullExclusions passes an
     *  empty wound list to the hull builder instead of the live one. Both
     *  default to shipped behaviour. */
    setOccluder: (on: boolean) => {
      occluderDesired = on;
      sdfLayer.setOccluderEnabled(on);
    },
    get occluder() { return sdfLayer.occluderEnabled && occluderDesired; },
    setHullExclusions: (on: boolean) => { hullExclusionsEnabled = on; },
    get hullExclusions() { return hullExclusionsEnabled; },

    // -------------------------------------------------------------------
    // BENCH SEAMS (2026-08-31). Everything the ablation legs toggle, plus
    // the fence the harness times against. Ship defaults are unchanged —
    // these only move when a driver moves them.
    // -------------------------------------------------------------------
    /** The GPU completion fence. Trust the fence, never a timestamp value. */
    resolveGpu: () => handle.resolveGpu(),
    /** Per-pass GPU timestamps since the last call, labelled by pass site
     *  (gpu-pass-timing.ts). Ad-hoc probe; the bench's 'passes' mode is the
     *  measured form. `installed` false = no timestamp tracking on this page. */
    passTimings: async () => ({ installed: passTiming.installed, samples: await passTiming.collect() }),
    passCounts: () => passTiming.countsSinceLast(),
    // setAdaptive / setSdfScale already exist further down this object and
    // are better than the versions this block first added (they also clear
    // the adaptive sample window and report the whole ladder). Not
    // duplicated here — the driver calls those.
    setCone: (on: boolean) => sdfLayer.setConeEnabled(on),
    get cone() { return sdfLayer.coneEnabled; },
    // ---------------------------------------------------------------
    // FRAME PACING. setFrameCap(fps) presents on a fixed cadence; 0
    // uncaps and restores the raw rAF behaviour. Default 30, matching
    // adaptiveBudgetMs. `refreshMs` is MEASURED from raw tick gaps
    // (the loop still wakes every vsync under a cap, so the skipped
    // ticks measure the display for free) -- check it before trusting
    // any arithmetic that assumes 60 Hz.
    // ---------------------------------------------------------------
    setFrameCap: (fps: number) => {
      handle.setFrameCap(fps);
      return { frameCap: handle.frameCap, refreshMs: handle.refreshMs };
    },
    get frameCap() { return handle.frameCap; },
    get refreshMs() { return handle.refreshMs; },
    setFxaa: (on: boolean) => postAa.setFxaa(on),
    get fxaa() { return postAa.fxaa; },
    setSmear: (v: number) => postAa.setSmear(v),
    /** BLAST REFRACTION experiment (default OFF). Live seam so the capture rig
     *  can A/B the SAME frame with it off and on — same seed, same pose, same
     *  sim time — which is the only honest comparison. */
    setBlastDistort: (on: boolean) => { postAa.setBlastDistort(on); return postAa.blastDistort; },
    get blastDistort() { return postAa.blastDistort; },
    setBlastDistortStrength: (v: number) => {
      blastDistortStrength = Math.max(0, Math.min(4, Number(v) || 0));
      postAa.setBlastDistortStrength(blastDistortStrength);
      return blastDistortStrength;
    },
    get blastDistortStrength() { return postAa.blastDistortStrength; },
    get blastDistortCount() { return postAa.blastDistortCount; },
    /** The RESOLVED blast-refraction slots the last blit pushed — the seam a
     *  capture rig reads to prove the band is centred on the blast (task-2). */
    blastDistortInfo: () => postAa.blastDistortSlots,
    /** Per-room probe grids (P3 step 2): weight 0 = bit-identical P1; gain -1
     *  = each room's matched level, else an absolute multiplier. */
    /** Flashlight bounce spot (P4 step 1): 0 = off and bit-identical. */
    setBounceSpot: (gain: number) => { bounceSpotGain = Math.max(0, gain); return bounceSpotGain; },
    /** GPU probe gather dynamic layer: radiance gain (flash bounce) and
     *  visibility strength (bodies darken their surroundings). 0/0 = off. */
    /** Direct muzzle-flash light on bodies (bodyFlash slot). 0 = off. */
    setBodyFlash: (gain: number) => { bodyFlashGain = Math.max(0, gain); return bodyFlashGain; },
    get bodyFlash() { return bodyFlashGain; },
    setProbeDynamic: (radianceGain: number, visStrength: number, flashBoost?: number) => {
      probeDynGain = Math.max(0, radianceGain); probeVisStrength = Math.max(0, Math.min(1, visStrength));
      if (flashBoost !== undefined) probeFlashBoost = Math.max(0, flashBoost);
      return { radianceGain: probeDynGain, visStrength: probeVisStrength, flashBoost: probeFlashBoost };
    },
    setProbeGatherRate(framesPerGather: number) {
      probeGatherRate = Math.max(1, Math.min(4, Math.floor(framesPerGather)));
      return probeGatherRate;
    },
    /** Diagnostic cost-split seams (see ?dynrays / ?dynlights). BOTH PRODUCE
     *  WRONG FRAMES ON PURPOSE — they exist to divide the gather's cost into
     *  primary-ray and per-light-shadow parts, which is the measurement that
     *  decides whether widening the dispatch or replacing the per-light sweep
     *  pays more. null restores the shipped value (32 rays, every light). */
    setProbeRays(n: number | null) {
      probeRaysBoot = n === null ? null : Math.max(0, Math.min(64, Math.floor(n)));
      return probeRaysBoot;
    },
    setProbeLights(n: number | null) {
      probeLightsBoot = n === null ? null : Math.max(0, Math.floor(n));
      return probeLightsBoot;
    },
    get probeCostSplit() {
      return { rays: probeRaysBoot, lights: probeLightsBoot, blend: probeBlendBoot, fall: probeFallBoot };
    },
    /** The gather's afterglow rates (?dynblend / ?dynfall). Set BOTH to 1 for the
     *  PURE-ESTIMATE configuration the R1 dispatch check measures in: the record
     *  becomes exactly this frame's estimate, so the dynamic layer stops
     *  depending on how many frames the run dispatched before the read — without
     *  which two boots are not comparable to each other at all. null restores the
     *  shipped 0.6 / 0.12. */
    setProbeBlend(n: number | null) {
      probeBlendBoot = n === null ? null : Math.max(0, Math.min(1, n));
      return probeBlendBoot;
    },
    setProbeFall(n: number | null) {
      probeFallBoot = n === null ? null : Math.max(0, Math.min(1, n));
      return probeFallBoot;
    },
    // DRAW CENSUS (spike program): per-frame draw/compute totals from the
    // renderer's info. This frame is MANY render() calls (one per pass), and
    // info auto-resets per call by default, so the seam flips autoReset off
    // and the caller samples then resets — one drawStats(true) per frame is
    // the per-frame total.
    drawStats(reset = false) {
      const info = handle.renderer.info;
      info.autoReset = false;
      const out = {
        drawCalls: info.render.drawCalls,
        triangles: info.render.triangles,
        computeCalls: (info as unknown as { compute?: { drawCalls?: number } }).compute?.drawCalls ?? null,
      };
      if (reset) info.reset();
      return out;
    },
    // SCENE CENSUS (spike program): visible meshes by name, to attribute the
    // fire-frame draw volume (drawStats) to actual scene objects. Passes
    // multiply draws (objects x passes = drawCalls), so pair this with
    // drawStats when quoting.
    sceneCensus() {
      let meshes = 0, visible = 0, instanced = 0;
      const byName = new Map<string, number>();
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!(m as unknown as { isMesh?: boolean }).isMesh) return;
        meshes++;
        if (!o.visible) return;
        visible++;
        const isInst = (m as unknown as { isInstancedMesh?: boolean }).isInstancedMesh === true;
        if (isInst) instanced++;
        const name = m.name || m.parent?.name || m.type;
        const key = `${name}${isInst ? ' [inst]' : ''}`;
        byName.set(key, (byName.get(key) ?? 0) + 1);
      });
      return { meshes, visible, instanced, top: [...byName].sort((a, b) => b[1] - a[1]).slice(0, 24) };
    },
    // `frames` is a DISPATCH counter (half-rate gather => ~half the drawn frames).
    get probeDynamic() { return { radianceGain: probeDynGain, visStrength: probeVisStrength, frames: probeFrame, errors: probeGatherErrors, bound: probeGather !== null, reached: probeGateLogs, gates: probeLastGates, rate: probeGatherRate }; },
    /** TRACERS as gathered lights. Raw intensity per pellet; 0 = off (no
     *  light packed). The owner tunes by eye and exaggerates with e.g. 6. */
    setTracerLight: (gain: number) => { tracerLightGain = Math.max(0, gain); return tracerLightGain; },
    setTracerLightSlots: (slots: number) => { tracerLightSlots = Math.max(0, Math.min(8, Math.floor(slots))); return tracerLightSlots; },
    get tracerLight() { return tracerLightGain; },
    /** The slot cap, so a rig can report WHAT it measured against rather than
     *  assuming — `setTracerLightSlots` without a getter is the "silent seam"
     *  failure this file keeps re-learning. */
    get tracerLightSlots() { return tracerLightSlots; },
    probeDynReadback: () => probeGather?.readback() ?? Promise.resolve(new Float32Array(0)),
    get bounceSpot() { return bounceSpotGain; },
    setProbes: (weight: number, gain = -1) => { roomProbes.setProbes(weight, gain); return { weight: roomProbes.weight, gain: roomProbes.gain }; },
    /** LEVEL surfaces reading the probes (P3/P4 step 3): weight 0 = the
     *  pre-probe level (hemisphere at full, nodes add nothing); gain -1 =
     *  each room's hemisphere-matched level. The hemisphere fades with the
     *  weight so the flip does not brighten the room. */
    setLevelProbes: (weight: number, gain = -1) => {
      levelProbeWeight = Math.max(0, Math.min(1, weight)); levelProbeGain = gain;
      applyHemi(); restampLevelProbes();
      return { weight: levelProbeWeight, gain: levelProbeGain };
    },
    get levelProbes() {
      return {
        weight: levelProbeWeight, gain: levelProbeGain, hemi: hemi.intensity, hemiBase,
        wired: levelProbeNodes.size, materials: levelNodeMaterials.length,
        lights: [...levelLightLists].map(([id, l]) => [id, l.getLights().length]),
        rooms: [...levelProbeNodes].map(([id, n]) => [id, n.slots.probeCfg.value.x, n.slots.probeCfg.value.y, n.slots.probeDynCfg.value.x, n.slots.probeDynCfg.value.y]),
      };
    },
    get probes() { return { weight: roomProbes.weight, gain: roomProbes.gain, ready: roomProbes.ready, matched: ROOMS.map(r => [r.id, roomProbes.matchedGain(r.id)]) }; },
    get smear() { return postAa.smear; },
    // VHS is the fourth chain stage, default OFF. While on it replaces the
    // smear pass; `effectiveSmear` says which temporal filter is really
    // running (0 while VHS owns it). Both return the resulting state so a
    // console caller sees the clamp without a second read.
    setVhs: (preset: VhsPreset | null) => {
      postAa.setVhs(preset);
      // A console preset overwrites every term; without this the panel's
      // sliders would keep showing the OLD look while the screen shows the new.
      vhsPanel?.refresh();
      return postAa.vhs;
    },
    get vhs() { return postAa.vhs; },
    setVhsTerm: (name: keyof VhsTerms, value: number) => {
      postAa.setVhsTerm(name, value);
      vhsPanel?.refresh();
      return postAa.vhsTerms;
    },
    /** The live term values — the preset's, until a slider or setVhsTerm
     *  overrides one. Symmetric with `vhs`, so a capture script can read the
     *  whole look back without driving a setter. */
    get vhsTerms() { return postAa.vhsTerms; },
    get effectiveSmear() { return postAa.effectiveSmear; },
    // ---------------------------------------------------------------
    // DEFERRED RENDERER SEAM (M2 task 5). Everything is null-safe: on a
    // legacy boot they are no-ops / report the legacy mode, so a capture
    // script can call them unconditionally. diagnostics() is a bounded,
    // JSON-serialisable record for the task-6 gate: routes, unsupported
    // materials, light selection, shadow generation-vs-sampling counters
    // (deliberately SEPARATE toggles), sizes and errors.
    // ---------------------------------------------------------------
    get renderMode() { return deferredMode ? 'deferred' : 'legacy'; },
    deferredDiagnostics: (): GameDeferredRendererDiagnostics | { mode: 'legacy' } =>
      deferredApi ? deferredApi.diagnostics() : { mode: 'legacy' as const },
    /** Shadow map GENERATION. false skips both raster passes; the boot
     *  ?spotshadow=0 seeds this. */
    setSpotShadow: (on: boolean) => deferredApi?.setShadowGeneration(on),
    get spotShadow() { return deferredApi?.diagnostics().shadow.generationRequested ?? null; },
    /** Diagnostic SAMPLING-only toggle: maps keep rendering, the lit stage
     *  ignores them. Its counter state lives in deferredDiagnostics().shadow
     *  (sampling flag vs renderedMaps — the two never conflate). */
    setSpotShadowSampling: (on: boolean) => deferredApi?.setShadowSampling(on),
    /** The one exposure knob — scales the CONVERTED deferred lights without
     *  touching the source THREE lights (task 6/7 calibration seam). */
    setDeferredLightGain: (v: number) => deferredApi?.setLightGain(v),
    setDeferredDebugView: (v: DeferredDebugView) => deferredApi?.setDebugView(v),
    /** RAW G-buffer sample at an NDC point (composition review fix evidence
     *  seam): lets a gate assert the gun/hand SURFACE CHANNELS — not just
     *  metadata — follow setGunTuning on the live frame. Draws a still frame
     *  FIRST by default so the sample always reflects the CURRENT state;
     *  pass drawStill=false for BULK scans of an already-rendered locked
     *  frame (each still is a full render). Null-safe on legacy. */
    readSurfaceAt: (ndcX: number, ndcY: number, drawStill = true) => {
      if (!deferredApi) return Promise.resolve(null);
      if (drawStill) handle.drawOnce();
      return deferredApi.readSurfaceAt(ndcX, ndcY);
    },
    /** Depth-gate color before FXAA/lens; null when presenting to canvas. */
    readCompositeAt: (ndcX: number, ndcY: number) => {
      if (!deferredApi) return Promise.resolve(null);
      handle.drawOnce();
      return deferredApi.readCompositeAt(ndcX, ndcY);
    },
    /** BOUNDED MULTI-POINT surface sample (task-6 lattice scans): one
     *  readback set for up to 512 NDC points. Draws a still first so the
     *  samples reflect the current state. Null-safe on legacy. */
    sampleSurfacePoints: (points: Array<{ x: number; y: number }>) => {
      if (!deferredApi) return Promise.resolve(null);
      handle.drawOnce();
      return deferredApi.sampleSurfacePoints(points);
    },
    /** WHOLE-G-buffer digest (task-6 regression-gate seam): four per-
     *  attachment FNV-1a digests over the logical texels plus the class
     *  histogram and depth extent, computed IN PAGE — raw attachments never
     *  cross CDP. Draws a still frame FIRST, so two consecutive calls are
     *  two SEPARATE renders of the current state — the no-change repeated-
     *  render control the gate needs — not one target read twice. Null on
     *  a legacy boot. */
    hashSurface: (): Promise<GameSurfaceHash | null> => {
      if (!deferredApi) return Promise.resolve(null);
      handle.drawOnce();
      return deferredApi.hashSurface();
    },
    /** TASK-6 TRUE-EMPTY PROOF SEAM: hide/show the static level meshes
     *  (dungeon shell + accents). With them hidden and the camera aimed at
     *  the (now absent) ceiling, verified rays see NO producer at any depth:
     *  the G-buffer there is the far sentinel with an empty class — the
     *  deterministic true-empty region this enclosed dungeon otherwise
     *  lacks. The router's sync() skips visible=false subtrees, so this is
     *  exact for both the G-buffer and the forward pass. */
    setLevelMeshVisible: (on: boolean) => {
      levelGroup.visible = on;
      accentGroup.visible = on;
    },
    /** Bounded SUBTREE INSPECTOR (task-6 kit/prop evidence seam): finds the
     *  first scene descendant whose name contains `namePart` (the deferred
     *  rig groups are named `deferred-rig-<character>-…`), walks its
     *  descendants breadth-first up to `maxNodes`, and reports each node's
     *  world position, material names and ROUTER route/receiver. This is the
     *  "actual named kit descendants / material routing" evidence the task-5
     *  review demands — a mesh-count increment is not kit proof. */
    setRegisteredObjectsVisible: (uuids: string[], visible: boolean) => {
      let count = 0;
      const selected = new Set(uuids);
      scene.traverse(o => {
        if (selected.has(o.uuid)) { o.visible = visible; count++; }
      });
      return count;
    },
    debugRegisteredTree: (namePart: string, maxNodes = 48, actorId?: number) => {
      let root: THREE.Object3D | null = null;
      scene.traverse((o) => {
        if (root) return;
        if (o.name && o.name.includes(namePart) &&
            (actorId === undefined || o.userData.gameActorId === actorId)) root = o;
      });
      if (!root) return { found: false, namePart };
      const r = root as THREE.Object3D;
      const propNodes = new Set<string>();
      actors.find(a => a.id === r.userData.gameActorId)?.character?.prop?.object
        .traverse(o => propNodes.add(o.uuid));
      const nodes: Record<string, unknown>[] = [];
      const queue: THREE.Object3D[] = [r];
      let seen = 0;
      while (queue.length > 0 && nodes.length < maxNodes && seen < maxNodes * 4) {
        const o = queue.shift()!;
        seen++;
        // POSED MATRIX, not getWorldPosition: kit/prop nodes pose by writing
        // matrixWorld DIRECTLY with matrixWorldAutoUpdate=false (kit-overlay
        // bone nodes, held-prop's object) precisely so three's update pass
        // cannot overwrite the rig solve. getWorldPosition() calls
        // updateWorldMatrix(true, false), which recomputes matrixWorld from
        // the (zero) local transform and reported every kit mesh at the
        // world origin — the gate then projected [0,0,0] and missed the kit
        // entirely. matrixWorld's translation is the LAST POSED matrix —
        // what the last render actually rasterised (normally-updated nodes
        // carry the same value after a render).
        const pe = o.matrixWorld.elements;
        const p = { x: pe[12], y: pe[13], z: pe[14] };
        // SKINNED kit pieces: the node itself stays at its import transform
        // (identity) and the VERTICES ride the skeleton, so the node origin
        // is never where the piece paints. Report the SKELETON's posed bone
        // translations (bounded) as the render-space anchors — kit-overlay
        // writes bone matrixWorld directly in world space, so these are the
        // exact positions the last render drew at.
        const sk = (o as THREE.SkinnedMesh).skeleton;
        const bones: Array<[number, number, number]> | undefined = sk
          ? sk.bones.slice(0, 14).map((b) => {
            const be = b.matrixWorld.elements;
            return [+be[12].toFixed(3), +be[13].toFixed(3), +be[14].toFixed(3)] as [number, number, number];
          })
          : undefined;
        const mats: string[] = [];
        const m = (o as THREE.Mesh).material;
        if (Array.isArray(m)) for (const mm of m) mats.push(String(mm.name || mm.type));
        else if (m) mats.push(String(m.name || m.type));
        nodes.push({
          name: o.name || `<${o.type}>`, uuid: o.uuid, heldProp: propNodes.has(o.uuid), depth: nodeDepth(r, o),
          isMesh: (o as THREE.Mesh).isMesh === true, visible: o.visible,
          isSkinnedMesh: (o as THREE.SkinnedMesh).isSkinnedMesh === true,
          bones,
          materials: mats, pos: [round2(p.x), round2(p.y), round2(p.z)],
          route: deferredApi?.router.routeOf(o) ?? null,
          receiver: deferredApi?.router.receiverOf(o) ?? null,
        });
        for (const c of o.children) queue.push(c);
      }
      return {
        found: true, name: r.name, actorId: r.userData.gameActorId ?? null,
        route: deferredApi?.router.routeOf(r) ?? null,
        receiver: deferredApi?.router.receiverOf(r) ?? null,
        totalDescendants: countDescendants(r),
        truncated: seen >= maxNodes * 4 || nodes.length >= maxNodes,
        nodes,
      };
    },
    /** CONTROLLED FORWARD DEPTH PROBES (composition review fix evidence
     *  seam). Spawns up to three unregistered blended sprites (pure R, G, B —
     *  depth-tested, no depth write) at world points the caller picks from
     *  known depth pixels, so a gate can distinguish FRONT-visible /
     *  BEHIND-occluded / empty-far behaviour of the composed frame instead of
     *  inferring depth from broad image deltas. Unregistered renderables are
     *  left alone by the forward route and hidden from the G-buffer passes
     *  by the router, so the probes only ever composite. */
    spawnDepthProbes: (spots: Vec3[], scale: number | { pixels: number } = 0.14) => {
      clearDepthProbes();
      // Task-6 gate: up to EIGHT distinct probes per spawn (a depth-bracket
      // ladder along one ray needs side-by-side colours in one frame; three
      // forced a spawn-per-depth cycle). Colours stay maximally separable in
      // a 7x7 screenshot sample.
      const colors = [0xff0000, 0x00ff00, 0x0000ff, 0xffff00, 0xff00ff, 0x00ffff, 0xff8000, 0x8040ff];
      for (let i = 0; i < spots.length && i < colors.length; i++) {
        const s = new THREE.Sprite(new THREE.SpriteMaterial({
          color: colors[i]!,
          // Diagnostic palette must survive distance/exposure unchanged;
          // these sprites measure depth, not the authored fog response.
          fog: false,
          toneMapped: false,
          transparent: true,
          blending: THREE.NormalBlending,
          depthWrite: false,
          depthTest: true,
        }));
        s.name = `depth-probe-${i}`;
        s.position.set(spots[i]![0], spots[i]![1], spots[i]![2]);
        // Diagnostic option: a fixed screen footprint remains measurable
        // at far-plane depths; world-size probes shrink below one pixel.
        const viewZ = new THREE.Vector3(...spots[i]!).applyMatrix4(camera.matrixWorldInverse).z;
        const worldSize = typeof scale === 'number' ? scale
          : 2 * Math.abs(viewZ) * Math.tan(camera.fov * Math.PI / 360)
            * scale.pixels / postAa.contentSize.height;
        s.scale.setScalar(worldSize);
        scene.add(s);
        depthProbes.push(s);
      }
      return depthProbes.map((s) => s.name);
    },
    clearDepthProbes: () => clearDepthProbes(),
    // ---------------------------------------------------------------
    // THE FISHEYE. setFisheye(deg) sets the apparent vertical FOV at
    // screen CENTRE; setRenderFov(deg) sets what the camera actually
    // draws. The bend is the ratio between them, so raising the render
    // FOV at a fixed centre FOV bends harder AND shows more world —
    // at the cost of more of it being marched. setFisheye(camera.fov)
    // (or anything wider) turns the lens off exactly.
    //
    // Both setters clamp with clampFovDeg — the same clamp makeLens applies
    // internally — so camera.fov and the lens can never disagree about the
    // render FOV (a stray setRenderFov(500) would otherwise squeeze the
    // frame with a lens clamped to 179 while the frustum drew at 500). Both
    // reject non-finite input as a no-op rather than feeding a NaN into
    // camera.updateProjectionMatrix() (a dead frame) or into makeLens (whose
    // clamp does not catch NaN either — see fisheye.ts). Both return the
    // report that .fisheye also returns, so the console shows what actually
    // landed, not what was typed.
    // ---------------------------------------------------------------
    setFisheye: (deg: number) => {
      if (Number.isFinite(deg)) {
        centerFovDeg = clampFovDeg(deg);
        postAa.setLens(camera.fov, centerFovDeg);
      }
      return fisheyeReport();
    },
    setRenderFov: (deg: number) => {
      if (Number.isFinite(deg)) {
        camera.fov = clampFovDeg(deg);
        camera.updateProjectionMatrix();
        postAa.setLens(camera.fov, centerFovDeg);
        sizeSdfLayer();
      }
      return fisheyeReport();
    },
    /** renderFovDeg is what is drawn, visibleFovDeg what reaches the
     *  screen (the warp crops the mid-edges), centerFovDeg what the
     *  middle reads as. Tune against `visible`, not `render`. */
    get fisheye() {
      return fisheyeReport();
    },
    // ---------------------------------------------------------------
    // C2 HALF-RATE — march every other frame, reproject the held march
    // in between (sdf-layer.ts header). Default OFF; the look verdict is
    // the owner's, from the capture reel.
    // ---------------------------------------------------------------
    setHalfRate: (on: boolean) => sdfLayer.setHalfRate(on),
    get halfRate() { return sdfLayer.halfRate; },
    /** 0 = hold only, 1 = per-pixel depth reproject (default). */
    setHalfRateMode: (n: number) => sdfLayer.setHalfRateMode(n),
    get halfRateMode() { return sdfLayer.halfRateMode; },
    /** Aim at the nearest body's surface. Exposed so a driver can stage a
     *  shot the same way the bench scenario does. Optional `limb` aims at
     *  that cluster's centre instead of the torso (same confirm gate). */
    aimSurface: (limb?: string, actorId?: number) => aimAtNearestSurface(limb, actorId),
    /** aimSurface('head') — the bone-tubes reel's head-shot staging. */
    aimHead: () => aimAtNearestSurface('head'),

    /**
     * Screen-space metaball blood (X1.bleed-look round 2). ON suppresses the
     * bead + ribbon sprites: the goo surface carries the fluid body, and
     * those are the hard-edged shapes it exists to replace (they would also
     * draw the same particles twice). Mist and floor splats stay.
     */
    setGoo(on: boolean) {
      if (!gooLayer) return false;
      gooEnabled = on;
      // Beads and ribbons go: they are the hard-edged shapes the goo
      // replaces, and they would draw the same particles twice.
      bloodView.setBeadsVisible(!on);
      // MIST STAYS. Hiding it (first cut) was a bug with teeth: the goo only
      // draws where droplets OVERLAP, so a sparse hit — an ordinary pellet
      // at range — crosses no threshold and draws NOTHING, and with mist off
      // too the result was a wound with no blood at all. Reproduced headless:
      // pellet at threshold 1.5 spawned 10 droplets and rendered zero pixels.
      // The reference frames want both anyway — connected masses PLUS fine
      // satellite specks — so mist is the sparse-case floor and the grain.
      bloodView.setMistVisible(true);
      gooPanel?.setVisible(on);
      return true;
    },
    get goo() {
      return gooLayer
        ? {
          enabled: gooEnabled,
          threshold: gooLayer.threshold,
          edge: gooLayer.edge,
          blurPx: gooLayer.blurPx,
          sizeScale: gooLayer.sizeScale,
          target: gooLayer.targetSize,
          mode: gooLayer.mode,
          liveCount: gooLayer.liveCount,
          syncCalls: gooLayer.syncCalls,
          absorb: gooLayer.absorb,
          spec: gooLayer.spec,
          gloss: gooLayer.gloss,
          rim: gooLayer.rim,
          stretch: gooLayer.stretch,
          shadowRed: gooLayer.shadowRed,
          candidate: {
            reconstruction: gooLayer.reconstruction,
            connections: gooConnectionsEnabled,
            strands: gooStrandsEnabled,
            sheets: gooSheetsEnabled,
            extraBlobs: gooLayer.extraBlobCount,
            density: gooLayer.densityDiagnostics,
          },
          perf: {
            surfaceAtDensityRes: gooLayer.surfaceAtDensityRes,
            minTexelRadius: gooLayer.minTexelRadius,
            areaPriority: gooLayer.areaPriority,
            splatFadeTail: gooLayer.splatFadeTail,
            passGate: gooLayer.passGate,
          },
        }
        : { enabled: false, unavailable: true };
    },
    /** Live tuning for the look pass — threshold/edge/blur are the three
     *  knobs that decide beads-vs-ropes-vs-sheets. */
    /**
     * DIAGNOSTIC: read the density field back off the GPU and report what is
     * actually in it.
     *
     * This exists because "the goo is invisible" has two completely different
     * causes that look identical on screen: an EMPTY field (nothing upstream
     * ever wrote density) versus a FULL field the surface pass is failing to
     * draw. Guessing between them cost several rounds; measuring takes one
     * call. Compare `max` against `threshold`: max below it means no pixel can
     * ever qualify and the fault is upstream in sync/density; max above it
     * with nothing on screen means the fault is the surface or the composite.
     */
    async gooProbe() {
      if (!gooLayer) return { unavailable: true };
      // Half-float decode: WebGPU hands back raw 16-bit patterns, and the
      // density targets are HalfFloatType because additive blending is only
      // guaranteed on 16-bit float in WebGPU core.
      const h2f = (h: number): number => {
        const sign = (h & 0x8000) ? -1 : 1;
        const exp = (h & 0x7c00) >> 10;
        const frac = h & 0x03ff;
        if (exp === 0) return sign * Math.pow(2, -14) * (frac / 1024);
        if (exp === 0x1f) return frac ? NaN : sign * Infinity;
        return sign * Math.pow(2, exp - 15) * (1 + frac / 1024);
      };
      const readOne = async (t: THREE.RenderTarget) => {
        const w = t.width;
        const h = t.height;
        const raw = new Uint16Array(
          await handle.renderer.readRenderTargetPixelsAsync(t, 0, 0, w, h) as ArrayLike<number>,
        );
        // WebGPU pads each readback row to a 256-byte boundary; at 8 bytes per
        // RGBA16F texel that is not the same as w * 4 shorts, and ignoring it
        // reads garbage from the padding as if it were density.
        const shortsPerRow = Math.ceil((w * 8) / 256) * 256 / 2;
        let max = 0;
        let nonZero = 0;
        let sum = 0;
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const r = h2f(raw[y * shortsPerRow + x * 4] ?? 0);
            if (!Number.isFinite(r)) continue;
            if (r > 0) nonZero++;
            if (r > max) max = r;
            sum += r;
          }
        }
        return { w, h, max, nonZero, mean: sum / (w * h) };
      };
      const { density, blurred } = gooLayer.debugTargets;
      return {
        enabled: gooEnabled,
        mode: gooLayer.mode,
        threshold: gooLayer.threshold,
        blurPx: gooLayer.blurPx,
        liveCount: gooLayer.liveCount,
        syncCalls: gooLayer.syncCalls,
        density: await readOne(density),
        blurredBuf: await readOne(blurred),
      };
    },
    /** Show/hide the live tuning panel independently of the layer. */
    gooPanel(on: boolean) {
      gooPanel?.setVisible(on);
      return gooPanel?.visible ?? false;
    },
    /** Show/hide the WOUND tuning panel (ships visible but collapsed; see
     *  woundPanel's declaration). Same shape as gooPanel so capture scripts
     *  can guard it the same typeof way. */
    woundPanel(on: boolean) {
      woundPanel?.setVisible(on);
      return woundPanel?.visible ?? false;
    },
    /** Expand or re-collapse the GOO panel. Panels ship COLLAPSED so they stop
     *  covering the frame; a capture script that actually wants to photograph
     *  the sliders opens it with this. */
    gooPanelCollapsed(on: boolean) {
      gooPanel?.setCollapsed(on);
      return gooPanel?.collapsed ?? true;
    },
    /** Show/hide the DYNAMITE / GIB tuning panel (dynamite-panel.ts). Same
     *  shape as the other three so a capture script can dismiss them all. */
    dynamitePanel(on: boolean) {
      dynamitePanel?.setVisible(on);
      return dynamitePanel?.visible ?? false;
    },
    /** Expand or re-collapse the DYNAMITE / GIB panel. */
    dynamitePanelCollapsed(on: boolean) {
      dynamitePanel?.setCollapsed(on);
      return dynamitePanel?.collapsed ?? true;
    },
    /** THE PANEL'S OWN SETTER, from the console: the same keys the sliders use
     *  (see dynamite-panel.ts's table, which is the one source for both), plus
     *  the read-back. `__sdfGame.setDynamiteTuning({ maxchunks: 64 })`. */
    setDynamiteTuning(patch: Partial<DynamiteTuningValues>) {
      applyDynamiteTuning(patch);
      return dynamiteTuningValues();
    },
    dynamiteTuning: () => dynamiteTuningValues(),
    woundPanelCollapsed(on: boolean) {
      woundPanel?.setCollapsed(on);
      return woundPanel?.collapsed ?? true;
    },
    /** Show/hide the VHS tuning panel (vhs-panel.ts). Same shape as the two
     *  above, so a capture script can dismiss all three the same way. */
    vhsPanel(on: boolean) {
      vhsPanel?.setVisible(on);
      return vhsPanel?.visible ?? false;
    },
    vhsPanelCollapsed(on: boolean) {
      vhsPanel?.setCollapsed(on);
      return vhsPanel?.collapsed ?? true;
    },

    /** Wound pass r2's tuning surface (wound-panel.ts). The key names are
     *  the panel's WOUND_KEYS — the table the COPY button emits from — so a
     *  pasted COPY always round-trips. Partial: only the keys present are
     *  applied (the panel's per-slider set() sends exactly one). The ramp
     *  trio, the viscera pair and organAmp are live uniform writes; gutSize,
     *  spillChance and the spring pair govern ropes/rolls from now on;
     *  boneRatio rebuilds the cast and drops on-body wounds (documented in
     *  rebuildCast and the slider's tooltip).
     *  Returns the applied record PLUS the live surfCfg3 uniform from body
     *  1, so a caller can confirm the record actually reached the field —
     *  the verify-the-panel-drives-the-shader check, one call, no guessing. */
    setWoundTuning(o: Partial<WoundTuningValues>) {
      applyWoundTuning(o);
      return woundTuningNow();
    },
    get woundTuning() {
      return woundTuningNow();
    },
    /** Bone tubes (2026-09-02-bone-tubes, task 5): OFF ships as the field's
     *  bones; ON draws every posed bone as an instanced polygonal tube and
     *  flips every view's packBones off so the field drops its bone rows. */
    setBoneMesh: (on: boolean) => applyBoneMesh(on),
    /** Tube bone look: { stain 0..1 toward deepColor, wet 0..1 blood tint on highlights, spec gain, fres gain }. */
    setBoneLook: (o: { stain?: number; wet?: number; spec?: number; fres?: number }) => {
      const l = boneInstancer.uniforms.look.value;
      if (o.stain !== undefined) l.x = o.stain; if (o.wet !== undefined) l.y = o.wet;
      if (o.spec !== undefined) l.z = o.spec; if (o.fres !== undefined) l.w = o.fres;
      return { stain: l.x, wet: l.y, spec: l.z, fres: l.w };
    },
    get boneMesh() { return boneMesh; },
    /** skeleton=mesh diagnostics: null unless the dev selector resolved;
     *  otherwise the renderer's coverage stats — proof the intended path
     *  ran (segments/verts > 0) and extraction health flags. */
    /** Deterministic actual-hit fixture: front-centre skull slug, same eye
     * event and actor damage path as travelling projectiles. */
    hitMeshSkull: (bodyId?: number) => {
      const a = bodyId === undefined ? actors[0] : actors.find(q => q.id === bodyId);
      if (!a || !segMeshRenderer) return null;
      const sources = skeletonSources.get(a)?.sources;
      const head = sources?.find(s => s.segment === 'head' && s.isLive());
      if (!sources || !head) return null;
      const b = head.bounds, x=(b.min[0]+b.max[0])/2, y=b.min[1]+(b.max[1]-b.min[1])*.61;
      // Resolve the posed FLESH surface, not the buried bone bound. Wound depth
      // probing assumes its anchor starts on skin.
      const start=head.toWorld([x,y,b.max[2]+.20]), end=head.toWorld([x,y,b.min[2]]);
      const point=traceProjectile(start,end,p=>sdBody(p,a.posed()));
      if(!point)return null;
      const dl=Math.hypot(end[0]-start[0],end[1]-start[1],end[2]-start[2])||1;
      const direction:Vec3=[(end[0]-start[0])/dl,(end[1]-start[1])/dl,(end[2]-start[2])/dl];
      const ejected = segMeshRenderer.impact(a, sources, point, direction, 'slug');
      a.beginHits(); const wound = a.hitSlug(point, direction); a.endHits();
      return { actor: a.id, point, ejected, stamped: !!wound };
    },
    meshEyeState: (bodyId?: number) => { const a = bodyId === undefined ? actors[0] : actors.find(q => q.id === bodyId); return a && segMeshRenderer ? segMeshRenderer.eyeState(a) : null; },
    skeletonMesh: () => segMeshRenderer ? { mode: skeletonMode, ...segMeshRenderer.stats, cacheEntries: segMeshCache!.size, cacheTotals: segMeshCache!.totals, cacheStats: segMeshCache!.stats() } : null,
    /** Cold-start task 1: how many per-character body builds the memo actually
     *  ran (vs served from cache) and their cumulative CPU time. */
    bodyBuild: () => ({ ...bodyBuildCacheStats() }),
    /** Synchronous active-path proof for capture harnesses. */
    skeletonDiagnostics: () => ({
      requestedMode: skeletonMode,
      activeMode: skeletonMode === 'volume'
        ? (skeletonVolumes.size > 0 ? 'volume' : 'procedural')
        : skeletonMode === 'mesh'
          ? (segMeshRenderer && segMeshRenderer.stats.segments > 0 ? 'mesh' : 'procedural')
          : 'procedural',
      volume: segVolumeCache ? {
        actors: skeletonVolumes.size,
        grids: segVolumeCache.stats().grids,
        gridBytes: segVolumeCache.stats().bytes,
        atlases: sharedVolumeAtlases.size,
        atlasBytes: [...sharedVolumeAtlases.values()].reduce((sum, atlas) => sum + atlas.bytes, 0),
        bakeMs: [...sharedVolumeAtlases.values()].reduce((sum, atlas) => sum + atlas.totalBakeMs, 0),
        atlasBuilds: volumeAtlasBuilds,
      } : null,
    }),
    boneTubes: () => ({
      count: boneInstancer.count,
      overflowed: boneInstancer.overflowed,
      /** WHICH PATHS FEED THE TUBES, and whether the object is drawn at all.
       *  With `gibBoneMesh` a bone gib packs no field rows and its marched proxy
       *  is hidden, so the instancer is the ONLY thing drawing it — and from the
       *  chunk census (which counts marched ROWS) "the skeleton is drawn as
       *  tubes" and "the skeleton silently vanished" are indistinguishable.
       *  These three make them distinguishable. */
      gibBoneMesh, bodyBoneMesh: boneMesh, visible: boneInstancer.object.visible,
      /** TASK-6 DIAGNOSTIC (bounded): world endpoints (a, b) of up to 8
       *  posed bone prims — the SAME prim data boneInstancer.update() packs
       *  this frame — so the gate can anchor its tube-texel scan to real
       *  tube geometry instead of a blind screen lattice (visible tube
       *  pixels are 1-2px silhouette slivers that a fixed lattice misses
       *  whenever the frozen gait phase shifts). Never mutates state. */
      tips: (() => {
        const out: number[][] = [];
        for (const a of actors) {
          const prims = a.posed().bonePrims ?? [];
          for (const p of prims) {
            if (p.op !== 'bone') continue;
            out.push([p.a[0], p.a[1], p.a[2]], [p.b[0], p.b[1], p.b[2]]);
            if (out.length >= 16) return out;
          }
        }
        return out;
      })(),
    }),
    setGooTuning(o: {
      threshold?: number; edge?: number; blurPx?: number; sizeScale?: number;
      mode?: 'overlay' | 'depth';
      absorb?: number; spec?: number; gloss?: number; rim?: number;
      stretch?: number;
      shadowRed?: number;
    }) {
      if (!gooLayer) return;
      if (o.threshold !== undefined) gooLayer.setThreshold(o.threshold);
      if (o.edge !== undefined) gooLayer.setEdge(o.edge);
      if (o.blurPx !== undefined) gooLayer.setBlurPx(o.blurPx);
      if (o.sizeScale !== undefined) gooLayer.setSizeScale(o.sizeScale);
      if (o.mode !== undefined) gooLayer.setMode(o.mode);
      if (o.absorb !== undefined) gooLayer.setAbsorb(o.absorb);
      if (o.spec !== undefined) gooLayer.setSpec(o.spec);
      if (o.gloss !== undefined) gooLayer.setGloss(o.gloss);
      if (o.rim !== undefined) gooLayer.setRim(o.rim);
      if (o.stretch !== undefined) gooLayer.setStretch(o.stretch);
      if (o.shadowRed !== undefined) gooLayer.setShadowRed(o.shadowRed);
    },

    /**
     * Close-up task 4's PERF SEAMS (goo-layer.ts) — all default to the
     * shipped state; the goo A/B driver flips them per leg. Deliberately NOT
     * part of setGooTuning: these are bench levers, not look knobs, and the
     * goo panel's copy button emits tuning keys (see the emit-key warning on
     * the panel) — mixing the two would let a paste silently move a perf
     * seam.
     */
    setGooPerf(o: {
      surfaceAtDensityRes?: boolean;
      minTexelRadius?: number;
      areaPriority?: boolean;
      splatFadeTail?: number;
      passGate?: { density?: boolean; blur?: boolean; surface?: boolean };
      /** Density target fraction of the SDF size (ship 0.5). */
      densityScale?: number;
      /** Density quads per frame, at most GOO_TUNING.maxParticles (1000). */
      particleCap?: number;
    }) {
      if (!gooLayer) return { unavailable: true };
      if (o.densityScale !== undefined) gooLayer.setDensityScale(o.densityScale);
      if (o.particleCap !== undefined) gooLayer.setParticleCap(o.particleCap);
      if (o.surfaceAtDensityRes !== undefined) gooLayer.setSurfaceAtDensityRes(o.surfaceAtDensityRes);
      if (o.minTexelRadius !== undefined) gooLayer.setMinTexelRadius(o.minTexelRadius);
      if (o.areaPriority !== undefined) gooLayer.setAreaPriority(o.areaPriority);
      if (o.splatFadeTail !== undefined) gooLayer.setSplatFadeTail(o.splatFadeTail);
      if (o.passGate !== undefined) gooLayer.setPassGate(o.passGate);
      return {
        densityScale: gooLayer.densityScale,
        particleCap: gooLayer.particleCap,
        targetSize: gooLayer.targetSize,
        surfaceAtDensityRes: gooLayer.surfaceAtDensityRes,
        minTexelRadius: gooLayer.minTexelRadius,
        areaPriority: gooLayer.areaPriority,
        splatFadeTail: gooLayer.splatFadeTail,
        passGate: gooLayer.passGate,
      };
    },

    /**
     * BLOOD-SURFACE CANDIDATES (2026-09-13). Deliberately NOT part of
     * setGooTuning: those are look knobs the panel copies, while reconstruction
     * and connections are architectural candidates that must be opted into by
     * flag or explicitly here. The baseline is 'original' + connections off.
     *
     * `connections` derives extra density quads from the SAME droplet array —
     * no new particles, no new RNG. `strands`/`sheets` switch each family
     * independently for attribution; both default on while connections are on.
     */
    setGooCandidate(o: {
      reconstruction?: GooReconstruction;
      connections?: boolean;
      strands?: boolean;
      sheets?: boolean;
    }) {
      if (!gooLayer) return { unavailable: true };
      if (o.reconstruction !== undefined) {
        gooReconstruction = o.reconstruction;
        gooLayer.setReconstruction(o.reconstruction);
      }
      if (o.connections !== undefined) gooConnectionsEnabled = o.connections;
      if (o.strands !== undefined) gooStrandsEnabled = o.strands;
      if (o.sheets !== undefined) gooSheetsEnabled = o.sheets;
      return {
        reconstruction: gooLayer.reconstruction,
        connections: gooConnectionsEnabled,
        strands: gooStrandsEnabled,
        sheets: gooSheetsEnabled,
        extraBlobs: gooLayer.extraBlobCount,
      };
    },

    /**
     * SUPPLEMENTARY IMPACT SPLASH (2026-09-13). A procedural crown fired ON
     * TOP of the existing slug gout — it replaces nothing and mutates no
     * shared constant, so the Current slug stays exactly as tuned. OFF unless
     * this is called or ?impactsplash=1 is present; enabling it creates the
     * layer on first use (sharing the flesh light rig) and adds it to the
     * scene. Disabling keeps the layer but hides it, so toggling costs no
     * rebuild.
     */
    setImpactSplash(o: { enabled?: boolean; weapon?: ImpactSplashWeapon; preset?: keyof typeof impactSplashPresets; profile?: Partial<ImpactSplashProfile> } = {}) {
      const weapon = o.weapon ?? 'slug';
      if ((o.profile || o.preset) && Object.hasOwn(impactSplashProfiles, weapon)) {
        const base = o.preset && Object.hasOwn(impactSplashPresets, o.preset) ? impactSplashPresets[o.preset] : impactSplashProfiles[weapon];
        impactSplashProfiles[weapon] = resolveImpactSplashProfile({ ...base, ...o.profile });
      }
      if (o.enabled !== undefined) impactSplashEnabled = o.enabled;
      if (impactSplashEnabled) ensureImpactSplashLayer();
      impactSplashLayer?.setVisible(impactSplashEnabled);
      return {
        enabled: impactSplashEnabled,
        available: impactSplashLayer !== null,
        profiles: structuredClone(impactSplashProfiles),
        events: impactSplashLayer?.eventCount ?? 0,
      };
    },
    get impactSplash() {
      return {
        enabled: impactSplashEnabled,
        available: impactSplashLayer !== null,
        profiles: structuredClone(impactSplashProfiles),
        events: impactSplashLayer?.eventCount ?? 0,
      };
    },

    /** Sweep gout density/shape without a rebuild. Mutates the shared table,
     *  so it affects every later impact of that kind. */
    setGoutTuning(kind: 'pellet' | 'slug' | 'stump', o: Partial<ImpactGoutProfile>) {
      Object.assign(IMPACT_GOUT[kind], o);
      return { ...IMPACT_GOUT[kind] };
    },
    get gout() {
      return { pellet: { ...IMPACT_GOUT.pellet }, slug: { ...IMPACT_GOUT.slug }, stump: { ...IMPACT_GOUT.stump } };
    },

    /** The outer-hull shell march (shell-hull-outer.ts). Ships ON —
     *  owner-passed 2026-08-31 after the stale-hull mask fix; -40%/-54%
     *  frame time at real-render parity. This is the kill switch. */
    setShell(on: boolean) {
      sdfLayer.setShellEnabled(on);
      if (on) outerHull.update(actors.map(a => a.posed()), { shellAmp: shellAmpOf() });
    },
    /** Perf round 2, task 5: the front-to-back per-body passes and their
     *  accumulated-depth gate. OFF restores the single-pass march. */
    setDepthGate(on: boolean) { sdfLayer.setDepthGate(on); },
    get depthGate() { return sdfLayer.depthGate; },
    /** Close-up task 3: the quarter-res depth prepass and the march's
     *  consumption of it. OFF (ship default) is bit-identical to the
     *  pre-task-3 frame; the census and the bench decide the flip. */
    setDepthPrepass(on: boolean) { sdfLayer.setDepthPreEnabled(on); },
    /** Temporal reprojection start (plan 2026-09-10): rays start at last
     *  frame's reprojected hit minus `margin` m (0.25 ships) and `slope`.
     *  Off is bit-identical. */
    setTemporalStart: (on: boolean, margin?: number, slope?: number) => { sdfLayer.setTemporalStart(on, margin, slope); return sdfLayer.temporalStart; },
    /** Temporal accumulation of the marched flesh (?accum). OFF is the plain
     *  low-res march. Turning it on turns the field weave off and the history is
     *  re-seeded, so the first frame of the new epoch is independent of the old
     *  one — see the frame-hash decision note. */
    /** Run 5 refine pass (spec 2026-09-13 §4). setRefine throws unless the boot allocated it (?refine=1). */
    setRefine: (on: boolean) => { sdfLayer.setRefine(on); return sdfLayer.refine; },
    setRefineView: (on: boolean) => { sdfLayer.setRefineView(on); return sdfLayer.refineView; },
    setRefineCfg: (cfg: { reject?: number; normalEps?: number; steps?: number }) => { sdfLayer.setRefineCfg(cfg); return sdfLayer.refineCfg; },
    /** Run 5b: the refine twins' lighting tail — 'slim' (default) drops scatter, the wound
     *  soft shadow, the ambient bounce and the probe gather from the twin only; 'full' is
     *  run 5's behaviour. Applies to every live actor view (chunks have no refine twin). */
    setRefineTail: (tail: RefineTail) => {
      refineTailWanted = tail;
      for (const a of actors) a.view.setRefineTail(tail);
      return actors[0]?.view.refineTail ?? tail;
    },
    /** Run 5b: the per-body distance band. Clamped: near >= 0, far > near, hysteresis >= 0. */
    setRefineBand: (band: { near?: number; far?: number; hysteresis?: number }) => {
      const near = Math.max(0, band.near ?? refineBand.near);
      const far = Math.max(near + 1e-6, band.far ?? refineBand.far);
      const hysteresis = Math.max(0, band.hysteresis ?? refineBand.hysteresis);
      refineBand.near = near; refineBand.far = far; refineBand.hysteresis = hysteresis;
      return { ...refineBand };
    },
    refineBand: () => ({ ...refineBand }),
    refineInfo: () => ({ allocated: sdfLayer.refineSource !== null, on: sdfLayer.refine, view: sdfLayer.refineView, cfg: sdfLayer.refineCfg, tail: actors[0]?.view.refineTail ?? 'slim', bodies: refinedBodies, band: { ...refineBand } }),
    /** The boot's graphics level (`?graphics=high`) — which SHIPPED_UPSCALE entry was loaded.
     *  Not a setter: 'high' allocates the normal attachments + refine targets at boot. */
    graphics: (): GraphicsLevel => graphics,
    setTemporalAccum: (on: boolean, alpha?: number) => sdfLayer.setTemporalAccum(on, alpha),
    resetTemporalAccum: () => sdfLayer.resetTemporalAccum(),
    /** NEURAL UPSCALE (spec 2026-09-11). Enabling also sets the march scale to 0.5
     *  through applySdfScale (the game's own state). `null` turns the stage off and
     *  leaves the scale alone — callers restore it. `{ model }` = random weights (cost/parity
     *  only) and returns the info. `{ trained: '<name>' }` loads a trained export from the dev
     *  model store and returns a PROMISE of the info (P3); it rejects if the model is missing or invalid. */
    setUpscale: (
      raw: { model?: string; layout?: string; inputs?: string; seed?: number; trained?: string } | null,
    ): UpscaleInfo | Promise<UpscaleInfo> => {
      if (raw === null) {
        upscaleAb.config = null;
        upscaleAb.model = null;
        upscaleAb.modelName = null;
        updateUpscaleAbLabel();
        return sdfLayer.setUpscale(null);
      }
      if (raw.trained !== undefined) return enableTrainedUpscale(raw.trained, raw.layout);
      const cfg = parseUpscaleConfig(raw);
      applySdfScale(UPSCALE_SCALE);
      const info = sdfLayer.setUpscale(cfg);
      upscaleAb.config = cfg;
      upscaleAb.model = null;
      upscaleAb.modelName = null;
      upscaleAb.mode = 'model';
      updateUpscaleAbLabel();
      return info;
    },
    /** P3: the trained models in the dev store (GET /__lab/upscale-models). */
    upscaleModels: async () => {
      const r = await fetch('/__lab/upscale-models', { cache: 'no-store' });
      if (!r.ok) throw new Error(`upscaleModels: HTTP ${r.status}`);
      return r.json();
    },
    /** P3 A/B state: the mode U last selected, and the loaded model's store name. */
    upscaleAb: () => ({ active: upscaleAb.config !== null, mode: upscaleAb.mode, model: upscaleAb.modelName }),
    /** Stage state plus the camera's near/far (what rgbd depth linearization uses).
     *  near/far are reported even when the stage is off (the capture script needs them). */
    /** Whether the layer allocated the march normal attachment this boot (rgbn/rgbdn models). */
    upscaleNormalsAllocated: (): boolean => sdfLayer.marchNormalTexture !== null,
    /** Post-sharpen over the stage output, 0..1 (owner experiment 2026-09-12; `?upscalesharpen=`). */
    setUpscaleSharpen: (strength: number): number => {
      const st = sdfLayer.upscaleStage;
      if (!st) return 0;
      st.setSharpen(strength);
      return st.sharpen;
    },
    /** 'cas' | 'unsharp' (see UpscaleStage.setSharpenMode; `?upscalesharpenmode=`). */
    setUpscaleSharpenMode: (mode: 'cas' | 'unsharp'): string => {
      const st = sdfLayer.upscaleStage;
      if (!st) return 'off';
      st.setSharpenMode(mode);
      return st.sharpenMode;
    },
    upscaleInfo: () => ({
      ...sdfLayer.upscaleInfo,
      near: (camera as THREE.PerspectiveCamera).near,
      far: (camera as THREE.PerspectiveCamera).far,
    }),
    /** G1-parity (spec 2026-09-11): GPU output vs the CPU twin, in-page. Requires
     *  freeze(true) + setRenderLock(true) first. Returns statistics only. */
    upscaleSelfCheck: (opts?: { compareLayouts?: boolean }) => runUpscaleSelfCheck({
      renderer: handle.renderer,
      layer: sdfLayer,
      camera: camera as THREE.PerspectiveCamera,
      renderFrames: (n: number) => { handle.setLoopRunning(false); for (let k = 0; k < n; k++) handle.step(1 / 60); },
      resolveGpu: () => handle.resolveGpu(),
    }, opts ?? {}),
    /** NEURAL UPSCALE P3 capture (spec 2026-09-11-neural-upscale-p3-training-design.md §1).
     *  A fixed sub-pixel march jitter in output px, or null. Returns false when refused. */
    setMarchJitter: (x: number | null, y = 0) => sdfLayer.setMarchJitter(x === null ? null : [x, y]),
    /** P3 capture: replace every actor with the default cast (fresh, unwounded bodies). */
    resetCast: () => { rebuildCast(); return actors.length; },
    /** P3 capture: a full magazine, so scripted wound shots never click empty. */
    refillShells: () => { shells = MAGAZINE_CAPACITY; updateHud(); return shells; },
    /** P3 capture: world centre of an actor's live head or torso cluster, or null. */
    actorLimbCenter: (actorId: number, limb: 'head' | 'torso') => {
      const a = actors.find((q) => q.id === actorId);
      const c = a?.posed().clusters.find((cc) => cc.limb === limb && cc.alive)?.center;
      return c ? ([c[0], c[1], c[2]] as Vec3) : null;
    },
    /** P3 capture: an actor's wounds in world space — the transform rendering uses. */
    actorWounds: (actorId: number) => {
      const a = actors.find((q) => q.id === actorId);
      if (!a) return [];
      const posed = a.posed();
      const yaw = a.pose().yaw;
      return a.wounds().map((w) => ({ pos: woundWorldPos(posed.prims, w, yaw), radius: w.radius, type: w.type }));
    },
    /** P3 capture: every actor's head circle and wound circles, projected through the live camera to
     *  output px (row 0 = top); circles behind the camera are omitted. Call after a render, with the
     *  march jitter off. */
    captureAnnotations: (width: number, height: number, headRadius = 0.12) => {
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
      const circle = (c: readonly number[], r: number) => {
        const centre = new THREE.Vector3(c[0], c[1], c[2]);
        const a = centre.clone().project(camera);
        if (a.z > 1) return null;
        const b = centre.clone().addScaledVector(up, r).project(camera);
        const ax = (a.x + 1) * 0.5 * width;
        const ay = (1 - a.y) * 0.5 * height;
        const bx = (b.x + 1) * 0.5 * width;
        const by = (1 - b.y) * 0.5 * height;
        return { x: ax, y: ay, r: Math.hypot(bx - ax, by - ay) };
      };
      return actors.map((a) => {
        const posed = a.posed();
        const yaw = a.pose().yaw;
        const head = posed.clusters.find((cc) => cc.limb === 'head' && cc.alive)?.center;
        const wounds: Array<{ x: number; y: number; r: number; type: unknown }> = [];
        for (const w of a.wounds()) {
          const c = circle(woundWorldPos(posed.prims, w, yaw), w.radius);
          if (c) wounds.push({ ...c, type: w.type });
        }
        return { actorId: a.id, head: head ? circle(head, headRadius) : null, wounds };
      });
    },
    get temporalAccum() { return sdfLayer.temporalAccum; },
    get temporalStart() { return sdfLayer.temporalStart; },
    get depthPrepass() { return sdfLayer.depthPreEnabled; },
    get shell() {
      return {
        enabled: sdfLayer.shellEnabled,
        instances: outerHull.instanceCount,
        // An overflowed hull leaves flesh uncovered, which under a bounded
        // march is a HOLE, not a slightly worse bound. Never ignore this.
        overflowed: outerHull.overflowed,
        shellAmp: shellAmpOf(),
      };
    },

    /**
     * PER-PIXEL CROSS-TAB of shell OFF vs ON — the diagnostic that competing
     * aggregates could not settle (2026-08-31: one run said the shell added
     * +10k hits, another said zero; both were sums).
     *
     * Renders the occupancy buffer twice on the SAME frozen frame (shell off,
     * then on) and classifies every pixel by (hitOff, hitOn). For pixels that
     * hit ONLY with the shell on, reports what the OFF march did instead:
     * how many steps it burned and whether it hit the 96-step budget — which
     * separates "budget exhausted at grazing incidence" from "terminated on
     * distance and the extra hits are something else".
     */
    async shellDiag() {
      const readGrid = async () => {
        const prevMode = actors[0]?.view.uniforms.debugCfg.value.x ?? 0;
        for (const a of actors) a.view.uniforms.debugCfg.value.x = 4;
        try {
          handle.setLoopRunning(false);
          handle.step(1 / 60);
          await handle.resolveGpu();
          const t = sdfLayer.marchTarget;
          const w = t.width;
          const h = t.height;
          const buf = new Float32Array(
            await handle.renderer.readRenderTargetPixelsAsync(t, 0, 0, w, h),
          );
          const floatsPerRow = Math.ceil((w * 16) / 256) * 256 / 4;
          return { w, h, buf, floatsPerRow };
        } finally {
          for (const a of actors) a.view.uniforms.debugCfg.value.x = prevMode;
        }
      };
      const wasOn = sdfLayer.shellEnabled;
      try {
        sdfLayer.setShellEnabled(false);
        const off = await readGrid();
        sdfLayer.setShellEnabled(true);
        outerHull.update(actors.map(a => a.posed()), { shellAmp: shellAmpOf() });
        const on = await readGrid();
        const stepsHist = new Array(13).fill(0); // OFF steps/8 for ON-only hits
        const onStepsHist = new Array(13).fill(0); // ON steps at ON-only hits
        let onOnly = 0;
        let offOnly = 0;
        let both = 0;
        let onOnlyOffBudget = 0; // OFF burned >= 90 steps at those pixels
        let onOnlyOffMarched = 0; // OFF actually marched there (vs no fragment)
        let onOnlyFirstSample = 0; // ON hit within 2 steps of shellIn = started in/on flesh
        let tSum = 0;
        // For pixels BOTH hit: does the shell move the hit? Identical means the
        // entry bound is sound for hit rays; a shifted t means shellIn lands
        // past the true surface.
        let bothTOff = 0;
        let bothTOn = 0;
        let bothTMoved = 0; // |tOn - tOff| > 5 mm
        for (let row = 0; row < off.h; row++) {
          const ob = row * off.floatsPerRow;
          const nb = row * on.floatsPerRow;
          for (let col = 0; col < off.w; col++) {
            const o = ob + col * 4;
            const n = nb + col * 4;
            const hitOff = off.buf[o + 2]! > 0.5 && off.buf[o + 1]! > 0.5;
            const hitOn = on.buf[n + 2]! > 0.5 && on.buf[n + 1]! > 0.5;
            if (hitOff && hitOn) {
              both++;
              bothTOff += off.buf[o + 3]!;
              bothTOn += on.buf[n + 3]!;
              if (Math.abs(on.buf[n + 3]! - off.buf[o + 3]!) > 0.005) bothTMoved++;
            }
            else if (hitOff) offOnly++;
            else if (hitOn) {
              onOnly++;
              tSum += on.buf[n + 3]!;
              const onSt = on.buf[n]!;
              onStepsHist[Math.min(12, Math.floor(onSt / 8))]!++;
              if (onSt <= 2) onOnlyFirstSample++;
              if (off.buf[o + 2]! > 0.5) {
                onOnlyOffMarched++;
                const st = off.buf[o]!;
                if (st >= 90) onOnlyOffBudget++;
                stepsHist[Math.min(12, Math.floor(st / 8))]!++;
              }
            }
          }
        }
        return {
          both, offOnly, onOnly,
          onOnlyOffMarched, onOnlyOffBudget,
          onOnlyFirstSample,
          onOnlyMeanT: onOnly ? tSum / onOnly : 0,
          bothMeanTOff: both ? bothTOff / both : 0,
          bothMeanTOn: both ? bothTOn / both : 0,
          bothTMoved,
          // Histograms bucketed by 8 steps.
          offStepsAtOnOnly: stepsHist,
          onStepsAtOnOnly: onStepsHist,
        };
      } finally {
        sdfLayer.setShellEnabled(wasOn);
        handle.setLoopRunning(true);
      }
    },

    /**
     * TEMPORAL START PER-PIXEL DIAG (spike program, 2026-09-10). Freezes ONE
     * frame (loop off), renders it with the temporal start ON and OFF — the
     * ONLY difference is temporalCfg.x, the lastTex copy is the same frozen
     * frame — and classifies every marched pixel by (hitOn, hitOff). The
     * classes that matter: hitOff && !hitOn = a pixel the temporal start
     * BROKE (the see-through holes); hitOn && !hitOff = pixels it created
     * (inside-accepts). Per broken pixel we keep the ray distance t each leg
     * ended at and the step counts, which separates "started past the
     * surface, ran out of budget" (steps ~96, tOn ~ body far side) from
     * "terminated early" (few steps, tOn short).
     */
    async temporalDiag() {
      const prevMode = actors[0]?.view.uniforms.debugCfg.value.x ?? 0;
      for (const a of actors) a.view.uniforms.debugCfg.value.x = 4;
      const prevWarm = sdfLayer.temporalStart.on;
      try {
        handle.setLoopRunning(false);
        handle.step(1 / 60);
        await handle.resolveGpu();
        const read = async () => {
          const t = sdfLayer.marchTarget;
          const w = t.width;
          const h = t.height;
          const buf = new Float32Array(
            await handle.renderer.readRenderTargetPixelsAsync(t, 0, 0, w, h),
          );
          const floatsPerRow = Math.ceil((w * 16) / 256) * 256 / 4;
          return { w, h, buf, floatsPerRow };
        };
        sdfLayer.setTemporalStart(true);
        // dt = 0: re-render the SAME frozen sim state — the two legs must
        // differ ONLY by temporalCfg.x, or a swinging limb between legs
        // masquerades as the artifact (measured 2026-09-10: dt=1/60 legs
        // 'broke' ~450 px that were just melee motion).
        handle.step(0);
        await handle.resolveGpu();
        const A = await read();
        sdfLayer.setTemporalStart(false);
        handle.step(0);
        await handle.resolveGpu();
        const B = await read();
        let broke = 0, fixed = 0, bothMiss = 0, bothHit = 0;
        const broken: { x: number; y: number; tOn: number; tOff: number; stepsOn: number; stepsOff: number }[] = [];
        const pushCap = 400;
        for (let row = 0; row < A.h; row++) {
          const base = row * A.floatsPerRow;
          for (let col = 0; col < A.w; col++) {
            const o = base + col * 4;
            if (A.buf[o + 2]! < 0.5 || B.buf[o + 2]! < 0.5) continue;
            const hitA = A.buf[o + 1]! > 0.5;
            const hitB = B.buf[o + 1]! > 0.5;
            if (hitA && hitB) { bothHit++; continue; }
            if (!hitA && !hitB) { bothMiss++; continue; }
            if (!hitA && hitB) {
              broke++;
              if (broken.length < pushCap) {
                broken.push({ x: col, y: row, tOn: A.buf[o + 3]!, tOff: B.buf[o + 3]!, stepsOn: A.buf[o]!, stepsOff: B.buf[o]! });
              }
            } else fixed++;
          }
        }
        const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
        return {
          broke, fixed, bothMiss, bothHit,
          meanStepsOnBroken: mean(broken.map((b) => b.stepsOn)),
          meanStepsOffBroken: mean(broken.map((b) => b.stepsOff)),
          meanTOnBroken: mean(broken.map((b) => b.tOn)),
          maxTOnBroken: broken.reduce((m, b) => Math.max(m, b.tOn), 0),
          maxTOffBroken: broken.reduce((m, b) => Math.max(m, b.tOff), 0),
          meanTOffBroken: mean(broken.map((b) => b.tOff)),
          brokenSample: broken,
        };
      } finally {
        for (const a of actors) a.view.uniforms.debugCfg.value.x = prevMode;
        sdfLayer.setTemporalStart(prevWarm);
        handle.setLoopRunning(true);
      }
    },

    /**
     * SCREEN COVERAGE of the outer hull, against the proxy boxes it would
     * replace.
     *
     * The decisive number for the shell march, and it can be taken WITHOUT
     * touching the march: occupancy() already reports what fraction of the
     * target the proxy boxes rasterise (75-100%). This reports what fraction
     * the hull covers. The gap between them is the work a bounded march
     * deletes.
     */
    async hullCoverage() {
      const wasOn = sdfLayer.shellEnabled;
      sdfLayer.setShellEnabled(true);
      outerHull.update(actors.map(a => a.posed()), { shellAmp: shellAmpOf() });
      try {
        handle.setLoopRunning(false);
        handle.step(1 / 60);
        await handle.resolveGpu();
        const read = async (t: THREE.RenderTarget) => {
          const w = t.width;
          const h = t.height;
          const buf = new Float32Array(
            await handle.renderer.readRenderTargetPixelsAsync(t, 0, 0, w, h),
          );
          // Row padding again — bytesPerRow is aligned to 256. RedFormat, so
          // one float per pixel rather than four.
          const floatsPerRow = Math.ceil((w * 4) / 256) * 256 / 4;
          let covered = 0;
          for (let row = 0; row < h; row++) {
            const base = row * floatsPerRow;
            for (let col = 0; col < w; col++) if (buf[base + col]! > 0) covered++;
          }
          return { w, h, covered, frac: covered / (w * h) };
        };
        const entry = await read(sdfLayer.shellEntryTarget);
        const exit = await read(sdfLayer.shellExitTarget);
        return {
          entry, exit,
          instances: outerHull.instanceCount,
          overflowed: outerHull.overflowed,
          bodiesOnScreen: bodiesOnScreen(),
        };
      } finally {
        sdfLayer.setShellEnabled(wasOn);
        handle.setLoopRunning(true);
      }
    },

    /**
     * March step budget across every body (marchCfg.x, ships at 96).
     *
     * This is a MEASUREMENT seam, and the measurement it exists for is the
     * shell-march decision. Cost decomposes as roughly
     *   cost(budget) ~= hitPixels * (steps to converge) + missPixels * budget
     * because a ray that lands on flesh converges in ~8 steps while a ray that
     * misses runs on toward the budget. Sweeping the budget and fitting the
     * line therefore splits the frame into what HITS cost (the intercept) and
     * what MISSES cost (the slope) — and the misses are exactly the work a
     * bounded entry/exit shell would delete.
     *
     * Lowering this degrades the image (rays give up before converging), so
     * it is for benching only; nothing should ship on a reduced budget without
     * its own visual gate.
     */
    /** Over-relaxation (woundCfg2.y). Ships at GAME_RELAX; <= 1.0 falls back
     *  to marchCfg.y, which is the UNDER-relaxed 0.6 the page used to run. */
    setRelax(v: number) {
      for (const a of actors) a.view.uniforms.woundCfg2.value.y = v;
    },
    get relax() { return actors[0]?.view.uniforms.woundCfg2.value.y ?? 0; },
    /** FLAT-ALBEDO SEAM (close-up diagnostics task 1, 2026-09-04). 1 = the
     *  march fragment returns the body's base albedo at the hit and skips
     *  the whole post-hit chain (see the seam block in MARCH_BODY); 0 =
     *  bit-identical to the pre-seam shader (pinned by test). Rides the
     *  spare debugCfg.y channel, so no march signature or literal changes.
     *  Chunk views own COPIED uniform sets ("Its VALUES are copied, not the
     *  nodes" — createChunkGpuView), so they are looped too: a gib-frame A/B
     *  with flying chunks must not read chunks shaded by a different rule
     *  than the bodies. */
    setNormalGradient(mode: 0 | 1) {
      normalGradientMode = mode === 1 ? 1 : 0;
      for (const a of actors) a.view.uniforms.normalGradientCfg.value.x = skeletonVolumes.has(a) ? 0 : normalGradientMode;
      for (const c of chunkViews) c.uniforms.normalGradientCfg.value.x = normalGradientMode;
    },
    setNormalGradientDebug(mode: 0 | 1 | 2) {
      normalGradientDebug = mode === 1 || mode === 2 ? mode : 0;
      for (const a of actors) a.view.uniforms.normalGradientCfg.value.y = normalGradientDebug;
      for (const c of chunkViews) c.uniforms.normalGradientCfg.value.y = normalGradientDebug;
    },
    /** Read-only diagnostic identities; chunk ids survive pooled-view reuse. */
    normalGradientPieces() {
      return [
        ...actors.map(a=>({key:`body:${a.id}`,kind:'body',id:a.id,ownerLimbs:[...a.posed().prims.map(p=>p.limb),...(a.posed().bonePrims??[]).map(()=> 'internal')]})),
        ...liveChunks.map(c=>({key:`chunk:${c.id}`,kind:'chunk',id:c.id,ownerLimbs:Array.from({length:Math.round(c.view.uniforms.counts.value.x)},()=>c.state.limb)})),
      ];
    },
    normalGradientPiece(key: string) {
      if(key.startsWith('body:')) return actors.find(a=>a.id===Number(key.slice(5)))?.view;
      if(key.startsWith('chunk:')) return [...liveChunks, ...bakedChunks].find(c=>c.id===Number(key.slice(6)))?.view;
      return undefined;
    },
    normalGradientStatus() {
      const supportedBodies = actors.filter(a => classifyNormalSupport(a.posed()).commonFlesh).length;
      return { mode: normalGradientMode, diagnostic: normalGradientDebug,
        supportedBodies, legacyBodies: actors.length - supportedBodies };
    },
    /** Diagnostic: march debugCfg.x mode on every per-body view and crowd type (9 = normal output). */
    /** Diagnostic: per crowd type, which per-TYPE uniform values differ between the type's block and
     *  each attached actor's own view (per-instance/record-driven keys skipped). Textures compared by identity. */
    crowdUniformDiff() {
      const skip = new Set(['counts', 'counts2', 'woundBound', 'bodyCentre', 'bodyHalf', 'bodyAnchor', 'windDrift',
        'meltCfg', 'bodyFlash', 'headCentre', 'headQuat', 'volumePose0', 'volumePose1', 'tileCfg', 'debugCfg']);
      const out: Record<string, Record<string, string[]>> = {};
      for (const [name, t] of crowdTypes) {
        const per: Record<string, string[]> = {};
        for (const a of actors) {
          if (a.crowd?.type !== t) continue;
          const diffs: string[] = [];
          const tu = t.uniforms as unknown as Record<string, { value: unknown }>;
          const vu = a.view.uniforms as unknown as Record<string, { value: unknown }>;
          for (const k of Object.keys(tu)) {
            if (skip.has(k) || !vu[k]) continue;
            const x = tu[k]!.value, y = vu[k]!.value;
            const sx = (x as { toArray?: () => number[] }).toArray ? JSON.stringify((x as { toArray: () => number[] }).toArray()) : (x instanceof THREE.Texture ? 'tex#' + x.id : String(x));
            const sy = (y as { toArray?: () => number[] }).toArray ? JSON.stringify((y as { toArray: () => number[] }).toArray()) : (y instanceof THREE.Texture ? 'tex#' + y.id : String(y));
            if (sx !== sy) diffs.push(`${k}: type=${sx} view=${sy}`);
          }
          per[`actor${a.id}${a.crowd ? '@' + a.crowd.slot : ''}`] = diffs;
        }
        out[name] = per;
      }
      return out;
    },
    /** Diagnostic: per crowd type, each attached actor's slot, alive flag, counts row, band, bone cull mode,
     *  wound count and whether it is the type's uniform source. */
    /** Per-actor diagnostic (2026-09-14): who is in the cast, who the cull
     *  kept, what the per-body proxy's visibility is, and the corpse bake
     *  state — the fields a "why does this leg march / not march" question
     *  needs, in one call. */
    actorDump() {
      const cam = camera.position;
      return actors.map((a) => {
        const o = a.view.object;
        return {
          id: a.id, room: a.room,
          name: (a as unknown as { name?: string }).name ?? null,
          visible: visibleActors.includes(a),
          proxyVisible: o.visible,
          crowdSlot: a.crowd?.slot ?? null,
          dist: Math.round(o.position.distanceTo(cam) * 100) / 100,
          pos: [o.position.x, o.position.y, o.position.z].map((v) => Math.round(v * 100) / 100),
          kit: (() => {
            const k = a.character?.kit?.object;
            if (!k) return null;
            const w = k.getWorldPosition(new THREE.Vector3());
            return { visible: k.visible, parent: k.parent?.name ?? k.parent?.type ?? null, world: [w.x, w.y, w.z].map((v) => Math.round(v * 100) / 100) };
          })(),
          bakeEligible: a.corpseBakeEligible(),
          baked: soldierCorpses?.bakedState(a.id) ?? 'n/a',
          rev: a.damageRevision(),
        };
      });
    },
    crowdSlotDump() {
      const out: Record<string, unknown[]> = {};
      for (const [name, t] of crowdTypes) {
        const rows: unknown[] = [];
        for (const a of actors) {
          if (a.crowd?.type !== t) continue;
          const s = a.crowd.slot; const f = t.records.floats; const b = s * REC_VEC4S * 4;
          rows.push({ actor: a.id, slot: s, alive: f[b + REC_WIND_ALIVE * 4 + 3], counts: Array.from(f.subarray(b + REC_COUNTS * 4, b + REC_COUNTS * 4 + 4)),
            counts2: Array.from(f.subarray(b + REC_COUNTS2 * 4, b + REC_COUNTS2 * 4 + 4)), band: f[b + REC_ANCHOR_BAND * 4 + 3],
            woundBound: Array.from(f.subarray(b + REC_WOUND_BOUND * 4, b + REC_WOUND_BOUND * 4 + 4)),
            volPose0w: f[b + REC_VOL_POSE0 * 4 + 3], melt: Array.from(f.subarray(b + REC_MELT * 4, b + REC_MELT * 4 + 4)),
            isSource: crowdSourceView.get(t) === a.view, room: a.room });
        }
        out[name] = rows;
      }
      return out;
    },
    /** Diagnostic: a band's row (4 floats per prim column) from a crowd type's atlas. */
    crowdBandRow(typeName: string, slot: number, row: number, cols = 8) {
      const t = crowdTypes.get(typeName); if (!t) return null;
      const w = t.atlas.texture.image.width as number; const r0 = slot * CROWD_DATA_ROWS + row;
      return Array.from(t.atlas.texels.subarray(r0 * w * 4, r0 * w * 4 + cols * 4));
    },
    /** Diagnostic: set one component of a uniform on every per-body view AND every crowd type
     *  (idx 0..3 = x/y/z/w for vectors; -1 for scalars). */
    setUniformAll(name: string, idx: number, value: number) {
      const apply = (u: Record<string, { value: unknown }>) => {
        const n = u[name]; if (!n) return;
        if (idx < 0) { n.value = value; return; }
        const v = n.value as Record<string, number>; v[['x', 'y', 'z', 'w'][idx]!] = value;
      };
      for (const a of actors) apply(a.view.uniforms as unknown as Record<string, { value: unknown }>);
      for (const t of crowdTypes.values()) apply(t.uniforms as unknown as Record<string, { value: unknown }>);
    },
    setMarchDebugMode(x: number) {
      for (const a of actors) a.view.uniforms.debugCfg.value.x = x;
      for (const t of crowdTypes.values()) t.uniforms.debugCfg.value.x = x;
    },
    setFlatAlbedo(on: boolean) {
      const v = on ? 1 : 0;
      for (const a of actors) a.view.uniforms.debugCfg.value.y = v;
      for (const c of chunkViews) c.uniforms.debugCfg.value.y = v;
      // Crowd stage a: a type's uniforms are seeded by copyUniformValues from
      // its source actor view each frame (crowdOn block in the draw fn), so
      // the write above usually reaches them — but the crowd parity gate must
      // not depend on that frame ordering. Write the type nodes directly too.
      for (const t of crowdTypes.values()) t.uniforms.debugCfg.value.y = v;
    },
    get flatAlbedo() { return (actors[0]?.view.uniforms.debugCfg.value.y ?? 0) > 0.5; },
    setHullExitBound(on: boolean) { for (const a of actors) a.view.uniforms.perfCfg.value.x = on ? 1 : 0; },
    get hullExitBound() { return (actors[0]?.view.uniforms.perfCfg.value.x ?? 0) > 0.5; },
    /** Wound-loop early-out (perf round 2 task 3, perfCfg.y). */
    setWoundEarlyOut(on: boolean) { for (const a of actors) a.view.uniforms.perfCfg.value.y = on ? 1 : 0; },
    get woundEarlyOut() { return (actors[0]?.view.uniforms.perfCfg.value.y ?? 0) > 0.5; },
    /**
     * Near-wound step multiplier (perfCfg.z), for looking at the 2026-09-04
     * retune on screen. 0 restores the shipped WOUND_STEP_MUL; **0.6 is the
     * old value** — set it, shoot a torso half a dozen times, and compare the
     * crater at 1.5-2.5 m, which is where 4.3% / 2.2% of that body's pixels
     * shaded from inside the meat. See WOUND_STEP_MUL in march.wgsl.ts for
     * what the counts mean and what each value costs in steps.
     *
     * Takes effect on the next frame and survives a body rebuild (perfCfg is
     * a settings uniform, and chunk views copy it from the template).
     */
    setWoundStep(v: number) {
      const n = v <= 0 ? 0 : Math.max(0.1, Math.min(1.0, v));
      for (const a of actors) a.view.uniforms.perfCfg.value.z = n;
      updateHud();
    },
    get woundStep() { return actors[0]?.view.uniforms.perfCfg.value.z ?? 0; },
    /** Last-step secant accept multiplier (perfCfg.w); 0 = off. */
    setLastStep(v: number) {
      const n = v <= 0 ? 0 : Math.min(16, v);
      for (const a of actors) a.view.uniforms.perfCfg.value.w = n;
    },
    get lastStep() { return actors[0]?.view.uniforms.perfCfg.value.w ?? 0; },
    /** Wound union-reach cull (close-up wound-cull task, 2026-09-05) —
     *  applyWounds' one-sphere test before the wound loop. SHIPS ON; a value
     *  no-op by construction, so ON vs OFF is a pixel-parity gate, and the
     *  bench's cullOff leg prices what the loop cost. Bodies only: chunk
     *  torn-end wounds ride writeWounds directly and keep the 1e9 no-cull
     *  identity (a chunk's proxy box is already tight). */
    setWoundCull(on: boolean) {
      woundCullRequested = on;
      for (const a of actors) a.view.setWoundCull(on);
    },
    /** ATTRIBUTION ONLY: the per-limb owner re-fold under another cluster's
     *  wound (march.wgsl.ts, counts2.z). OFF renders a wrong frame on
     *  purpose; it exists to price the mechanism in the passes bench. */
    setOwnerRefold(on: boolean) {
      for (const a of actors) a.view.uniforms.counts2.value.z = on ? 0 : 1;
    },
    get ownerRefold() { return (actors[0]?.view.uniforms.counts2.value.z ?? 0) < 0.5; },
    /** Bone-cluster sphere cull (packBoneClusters). OFF ships — the old flat
     *  bone loop; the bench's bone-cull-on leg flips it for A/B. Takes effect
     *  on the next per-frame pack, so a live flip needs a frame to land. */
    setBoneCull(on: boolean) { applyBoneCull(on); },
    get boneCull() { return boneCull; },
    /** Three-way bone cull (bone-segment spheres): 'off' / 'cluster' (the
     *  parked per-flesh-cluster spheres) / 'segment' (per rigid segment).
     *  setBoneCull(on) is the boolean shorthand for off/cluster. */
    setBoneCullMode(mode: 'off' | 'cluster' | 'segment') { applyBoneCullMode(mode); },
    get boneCullMode() { return boneCullMode; },
    /** Per-ray wound list (march.wgsl.ts, counts2.w): build the reachable
     *  wound set once per pixel and fold only those. OFF is bit-identical. */
    setWoundList(on: boolean) {
      for (const a of actors) a.view.uniforms.counts2.value.w = on ? 1 : 0;
    },
    get woundList() { return (actors[0]?.view.uniforms.counts2.value.w ?? 0) > 0.5; },
    // Tracks the REQUESTED state, not the uniform: an unwounded body never
    // uploads wounds, so its bound radius stays at the 1e9 identity even
    // with the cull on, and reading the uniform back would lie.
    get woundCull() { return woundCullRequested; },
    /** Diagnostic read: every actor's wound bound [x, y, z, radius]. Proves
     *  the wire end-to-end — a radius in (0, 1e8) is a COMPUTED bound; 1e9
     *  is the no-cull identity; 0 means no wounds uploaded. */
    woundBound() {
      return actors.map(a => {
        const v = a.view.uniforms.woundBound.value;
        return [v.x, v.y, v.z, v.w];
      });
    },
    /** Step multiplier (marchCfg.y). Ships at GAME_OMEGA. */
    setOmega(v: number) {
      const n = Math.max(0.1, Math.min(1.0, v));
      for (const a of actors) a.view.uniforms.marchCfg.value.y = n;
    },
    get omega() { return actors[0]?.view.uniforms.marchCfg.value.y ?? 0; },
    /** Footprint-AA strength (perf round 2 task 6, aaCfg.y). 0 = the old
     *  march bit-for-bit; also refreshes the one-pixel footprint (aaCfg.x) so
     *  a frozen-scene A/B at a pinned scale reads the intended pair. */
    setAa(strength: number) {
      const k = sdfLayer.pixelConeK;
      for (const a of actors) {
        a.view.uniforms.aaCfg.value.x = k;
        a.view.uniforms.aaCfg.value.y = strength;
      }
    },
    get aa() { return actors[0]?.view.uniforms.aaCfg.value.y ?? 0; },
    /** Level shadows on bodies (perf round 2 task 7, levelShadowCfg.x).
     *  0 = the pre-task-7 march bit-for-bit (the helper returns 1.0 before
     *  sampling). The per-frame pose block ANDs this with the beam and map
     *  existence, so a false here also survives ?spotshadow=0 boots. */
    setLevelShadow(on: boolean) {
      levelShadowEnabled = !!on;
      for (const a of actors) a.view.uniforms.levelShadowCfg.value.x = on ? 1 : 0;
    },
    get levelShadow() { return (actors[0]?.view.uniforms.levelShadowCfg.value.x ?? 0) > 0.5; },
    setMarchSteps(n: number) {
      for (const a of actors) a.view.uniforms.marchCfg.value.x = n;
    },
    get marchSteps() { return actors[0]?.view.uniforms.marchCfg.value.x ?? 0; },

    /**
     * DEPTH-PREPASS STATS (close-up task 3) — is the coarse pass actually
     * writing starts? Same readback contract as occupancy() (one paused
     * step, row-padded float read) on the quarter-res target. A pass that
     * writes nothing (meshes not staged, clear-colour trap, fetch wrong)
     * is invisible in the frame and shows up here as nonZero 0.
     */
    async depthPreStats() {
      handle.setLoopRunning(false);
      handle.step(1 / 60);
      await handle.resolveGpu();
      const t = sdfLayer.depthPreTarget;
      const w = t.width;
      const h = t.height;
      const buf = new Float32Array(
        await handle.renderer.readRenderTargetPixelsAsync(t, 0, 0, w, h),
      );
      const floatsPerRow = Math.ceil((w * 16) / 256) * 256 / 4;
      let nonZero = 0;
      let min = Infinity;
      let max = 0;
      let sum = 0;
      for (let row = 0; row < h; row++) {
        const base = row * floatsPerRow;
        for (let col = 0; col < w; col++) {
          const v = buf[base + col * 4]!;
          if (v > 0) { nonZero++; sum += v; if (v < min) min = v; if (v > max) max = v; }
        }
      }
      handle.setLoopRunning(true);
      return { w, h, texels: w * h, nonZero, min: nonZero ? +min.toFixed(3) : 0, max: +max.toFixed(3), mean: nonZero ? +(sum / nonZero).toFixed(3) : 0 };
    },

    /**
     * PROXY-BOX OCCUPANCY — the shell-march decision measurement.
     *
     * How much of the screen area the march actually rasterises is flesh?
     * A bounded entry/exit hull never rasterises the rest, so `1 - occupancy`
     * is the shell march's addressable market. This exists because the step
     * budget sweep showed the spike's "14x fewer evals" counted the CHEAP
     * evals: cost is per-PIXEL, not per-step, so what matters is how many
     * pixels are marched for nothing.
     *
     * Method: march debug mode 4 returns raw counters BEFORE the miss-discard
     * (r = steps, g = hit, b = rasterised, a = t), one frame is rendered, and
     * the float target is read back and summed.
     *
     * Reported occupancy is a LOWER BOUND on the waste: depth-testing means
     * only the front-most body writes each pixel, so overlapping proxy boxes
     * hide extra fragment invocations this cannot see.
     */
    async occupancy() {
      const prevMode = actors[0]?.view.uniforms.debugCfg.value.x ?? 0;
      for (const a of actors) a.view.uniforms.debugCfg.value.x = 4;
      try {
        handle.setLoopRunning(false);
        handle.step(1 / 60);
        await handle.resolveGpu();
        const t = sdfLayer.marchTarget;
        const w = t.width;
        const h = t.height;
        const buf = new Float32Array(
          await handle.renderer.readRenderTargetPixelsAsync(t, 0, 0, w, h),
        );
        // ROW PADDING, and it is not optional: WebGPU aligns bytesPerRow to
        // 256, so the readback is NOT densely packed. Walking it as w*h*4
        // reads progressively misaligned rows and still yields a plausible
        // percentage — the exact shape of wrong number this whole exercise
        // keeps producing. (Same arithmetic as shell-spike-main.ts.)
        const floatsPerRow = Math.ceil((w * 16) / 256) * 256 / 4;
        let rasterised = 0;
        let hits = 0;
        let stepsOnHit = 0;
        let stepsOnMiss = 0;
        for (let row = 0; row < h; row++) {
          const base = row * floatsPerRow;
          for (let col = 0; col < w; col++) {
            const o = base + col * 4;
            if (buf[o + 2]! < 0.5) continue;
            rasterised++;
            if (buf[o + 1]! > 0.5) { hits++; stepsOnHit += buf[o]!; }
            else { stepsOnMiss += buf[o]!; }
          }
        }
        const misses = rasterised - hits;
        return {
          targetW: w, targetH: h, screenPx: w * h,
          rasterised, hits, misses,
          /** Fraction of MARCHED pixels that actually hit flesh. */
          occupancy: rasterised ? hits / rasterised : 0,
          /** Fraction of the SDF target the march touched at all. */
          coverage: rasterised / (w * h),
          meanStepsHit: hits ? stepsOnHit / hits : 0,
          meanStepsMiss: misses ? stepsOnMiss / misses : 0,
          /** Share of all marched STEPS spent on rays that hit nothing. */
          missStepShare: (stepsOnHit + stepsOnMiss) > 0
            ? stepsOnMiss / (stepsOnHit + stepsOnMiss) : 0,
          bodiesOnScreen: bodiesOnScreen(),
        };
      } finally {
        for (const a of actors) a.view.uniforms.debugCfg.value.x = prevMode;
        handle.setLoopRunning(true);
      }
    },

    /**
     * Bone capsule evaluations per marched ray (gore r3 refinement 3).
     *
     * Debug mode 5, read back exactly like occupancy() above — including the
     * 256-byte row alignment, which is not optional and has produced
     * plausible-but-wrong numbers here before.
     *
     * This exists because the TIMING bench cannot see the bone fold at all:
     * it measured +0.0% against a 4% within-run spread, which is not a
     * measurement. A counter is not subject to machine noise, so it is what
     * any bone-fold cull must be judged on. Wound some bodies first — with no
     * wounds the nearWound gate means the honest answer is zero.
     */
    async boneEvals() {
      const prevMode = actors[0]?.view.uniforms.debugCfg.value.x ?? 0;
      for (const a of actors) a.view.uniforms.debugCfg.value.x = 5;
      try {
        handle.setLoopRunning(false);
        handle.step(1 / 60);
        await handle.resolveGpu();
        const t = sdfLayer.marchTarget;
        const w = t.width;
        const h = t.height;
        const buf = new Float32Array(
          await handle.renderer.readRenderTargetPixelsAsync(t, 0, 0, w, h),
        );
        const floatsPerRow = Math.ceil((w * 16) / 256) * 256 / 4;
        let rasterised = 0;
        let hits = 0;
        let bonesOnHit = 0;
        let bonesTotal = 0;
        let maxBones = 0;
        let pixelsWithBone = 0;
        for (let row = 0; row < h; row++) {
          const base = row * floatsPerRow;
          for (let col = 0; col < w; col++) {
            const o = base + col * 4;
            if (buf[o + 2]! < 0.5) continue;
            rasterised++;
            const b = buf[o]!;
            bonesTotal += b;
            if (b > 0) pixelsWithBone++;
            if (b > maxBones) maxBones = b;
            if (buf[o + 1]! > 0.5) { hits++; bonesOnHit += b; }
          }
        }
        return {
          rasterised, hits,
          /** Total bone capsule evaluations across the whole marched frame. */
          bonesTotal,
          /** Mean over MARCHED pixels — the number a cull must move. */
          meanPerRay: rasterised ? bonesTotal / rasterised : 0,
          /** Mean over pixels that actually paid any bone cost. */
          meanPerPayingRay: pixelsWithBone ? bonesTotal / pixelsWithBone : 0,
          /** Share of marched pixels that touched the bone fold at all —
           *  the nearWound gate's effectiveness, measured rather than argued. */
          payingShare: rasterised ? pixelsWithBone / rasterised : 0,
          meanOnHit: hits ? bonesOnHit / hits : 0,
          maxBones,
          bodiesOnScreen: bodiesOnScreen(),
        };
      } finally {
        for (const a of actors) a.view.uniforms.debugCfg.value.x = prevMode;
        handle.setLoopRunning(true);
      }
    },

    /**
     * Run one bench leg.
     *
     * Parks the result on window.__gameBench as well as returning it: a
     * console call that returns a value can itself hide the page, and a
     * hidden page has no swapchain texture, so its passes do nothing and the
     * fence resolves to ~0.065 ms of nothing. That reads as a 70x speedup.
     * The harness counts hidden frames and invalidates the run, but reading
     * the value back afterwards avoids provoking it in the first place.
     */
    async bench(o: {
      room?: number; mode?: BenchMode;
      /** 'closeup' — the static frozen-frame scenario (buildCloseup): no
       *  teleport, no shots; the DRIVER stages camera + wounds before
       *  calling. Default 'firefight' — the scripted walk/fire/gib. */
      kind?: 'firefight' | 'closeup';
      closeupFrames?: number;
      walkFrames?: number; fireFrames?: number; gibFrames?: number;
      chunkFrames?: number; warmup?: number; label?: string;
      /** Hold the player's placed pose (distance-crowd scene, 2026-09-14):
       *  strips the scenario's frame-0 teleport and looks, zeroes the walk
       *  input, and re-pins pos/vel after every step so a wandering body's
       *  collision cannot shove the camera and move the measured distance.
       *  The caller is responsible for having placed the player first
       *  (`placePlayer`) — this only FREEZES the pose, it does not set it. */
      holdPlayer?: boolean;
      /** Drop every fire/fireSlug step (the frame-guard PROBE only). The
       *  probe runs the whole scenario before the measured run, so its
       *  shots kill a large crowd and the real run then measures a decimated
       *  scene — observed at n=20, where the walk segment started with 2 of
       *  21 bodies. The probe only needs the walk scene's frame cost, so it
       *  runs unarmed. */
      noShots?: boolean;
      /** REPLAY A RECORDING instead of the scripted scenario (stage 3). Every
       *  leg then plays the SAME inputs, so a census difference between two
       *  legs is a sim leak rather than two different fights. Segments become
       *  equal thirds (t0/t1/t2); the timers and census machinery are
       *  unchanged. The caller passes `warmup: 0` so the replay starts at the
       *  recording's frame 0. */
      demo?: DemoFile;
    } = {}) {
      const scenario = o.demo
        ? demoScenarioOf(o.demo)
        : o.kind === 'closeup'
          ? buildCloseup({ frames: o.closeupFrames })
          : buildFirefight({
            room: o.room ?? 4,
            walkFrames: o.walkFrames,
            fireFrames: o.fireFrames,
            gibFrames: o.gibFrames,
          });
      // HOLD THE PLAYER. Drop every action that writes the player's pose
      // (the firefight's teleport/look) and the frame-0 `freeze: false` (the
      // distance scene pre-froze the cast for a stable distance; letting the
      // scenario unfreeze would walk the crowd onto the camera again).
      // aimSurface/fire/fireSlug stay, so the segments still run the scripted
      // shots at the placed pose and frozen bodies.
      if (o.holdPlayer) {
        scenario.steps = scenario.steps.filter(
          s => s.action.kind !== 'teleport'
            && s.action.kind !== 'look'
            && s.action.kind !== 'freeze',
        );
      }
      if (o.noShots) {
        scenario.steps = scenario.steps.filter(
          s => s.action.kind !== 'fire' && s.action.kind !== 'fireSlug',
        );
      }
      const problems = validateScenario(scenario);
      if (problems.length) throw new Error(`bad scenario: ${problems.join('; ')}`);

      // Captured AFTER the caller's placePlayer(): the pose every step is
      // restored to. pos/vel are copies, not aliases.
      const held = o.holdPlayer
        ? { pos: [...player.pos] as Vec3, yaw: player.yaw, pitch: player.pitch }
        : null;
      const restoreHeldPose = () => {
        if (!held) return;
        player.pos = [held.pos[0], held.pos[1], held.pos[2]];
        player.vel = [0, 0, 0];
        player.yaw = held.yaw;
        player.pitch = held.pitch;
      };
      const hadHoldPlayer = holdPlayerPose;
      holdPlayerPose = o.holdPlayer === true;

      handle.setLoopRunning(false);
      // Clear the `?simidle=1` boot lock (see simLocked): the scenario this runs
      // must start from the deterministic spawn state, not from a set of frames
      // the boot loop happened to take. RESTORED in the finally — otherwise the
      // rAF loop it restarts would tick the sim freely between the probe and the
      // measured run, which is the same wall-clock divergence one layer up.
      const hadSimLock = simLocked;
      simLocked = false;
      // Pin the RENDER-side clocks the frame hash reads, for the same reason: a
      // repeated run must render the same frame. `demoHold` fixes the gather's
      // per-dispatch `frameSeed` and drives `view.setTime` from the SIM clock;
      // without it the hash drifts with the dispatch count even when the sim is
      // identical. Left ON (not restored): inter-run render frames must also see
      // it, or the gather re-rotates its rays between the probe and the run.
      // Sim-idle boots only — normal play and other bench callers are untouched.
      const hasSimIdle = new URLSearchParams(location.search).has('simidle');
      if (o.demo || hasSimIdle) {
        demoHold = true;
        demoSeedBase = probeFrame;
        postAa.setTimeFrozen(true);
        // The interlaced field is a two-state function of an absolute render
        // counter, so a single end-of-run hash only compares at a fixed phase.
        sdfLayer.resetFieldPhase();
        // And the gather is dispatched only every `probeGatherRate` ticks, so
        // WHICH frame the packed instances/dynamic layer were last built on is
        // a function of the absolute tick counter. Reset the cadence phase too,
        // or the end-of-run `instances`/`probeDyn` hashes differ between a
        // first page load and a warm one. Diagnostic only: `probeFrame`
        // (dispatch count) and the demo seed are left alone.
        probeGatherTick = 0;
        // The dynamic layer blends each dispatch into the previous values, so it
        // is a function of the dispatch count too. Start every run from zero, or
        // the first page load and a warm one hash differently (measured).
        // pendingGather too: a pack left over from boot would be dispatched on
        // the first measured draw, giving one run an extra gather dispatch.
        pendingGather = null;
        probeGather?.reset();
      }
      // A DEMO bench run IS a replay: the recording's frames are staged as
      // `input` actions and consumed by tick through applyInputFrame, and the
      // sim streams + clock reset to the recording's own origin so every leg
      // and every repeat starts from the same draw index. Inert off the demo
      // path, so normal play and every other bench call are untouched.
      const hadReplay = replayActive;
      const hadFreeAim = freeAimOn;
      if (o.demo) {
        replayActive = true;
        replayFrame = 0;
        resetSimClock();
        setRngSeed(o.demo.seed);
        if (typeof o.demo.meta?.freeAim === 'boolean') freeAimOn = o.demo.meta.freeAim;
        prevInputKeys = new Set<string>();
      }
      const hadAdaptive = adaptiveEnabled;
      adaptiveEnabled = false;
      const hadTelemetry = telemetry.active;
      if (o.mode === 'passes') telemetry.active = true;
      try {
        const deps: BenchDeps = {
          step: (dt) => { beginPassFrame(); handle.step(dt); restoreHeldPose(); },
          beforeStep: awaitBakes,
          // 'passes' mode: CPU tick/draw plus the telemetry phases the tick
          // already brackets (blood sim, goo sync, body step, ...). Telemetry
          // is switched active for the run so begin()/end() record; no frame
          // observer runs while the loop is off, so nothing else is captured.
          stepTimed: (dt) => {
            beginPassFrame();
            telemetry.drainPhases();
            const t = handle.stepTimed(dt);
            restoreHeldPose();
            const out: Record<string, number> = { 'cpu:tick': t.tickMs, 'cpu:draw': t.drawMs };
            for (const [k, v] of Object.entries(telemetry.drainPhases())) out[`cpu:phase:${k}`] = v;
            return out;
          },
          resolveGpu: () => handle.resolveGpu(),
          passTimings: () => passTiming.collect(),
          // THE FRAME HASH, once per leg and AFTER every timing sample (see
          // BenchDeps.endHash). The census below counts what the page CONTAINS;
          // this digests what it RENDERS — the half of the workload the census
          // is blind to, and the half that shipped two playtest-caught bugs on
          // 2026-09-10 (the zeroed dynamic probe layer, and tracer light slots
          // defaulting to 0).
          endHash: () => hashFrame(frameHashDeps, frameCount),
          now: () => performance.now(),
          hidden: () => document.hidden,
          census: () => ({
            bodies: bodiesOnScreen(),
            wounds: actors.reduce((n, a) => n + a.wounds().length, 0),
            chunks: liveChunks.length,
            droplets: bloodSim.droplets.length,
            splats: bloodSim.splats.length,
            gooQuads: gooLayer?.liveCount ?? 0,
          }),
          perform: performBenchAction,
        };
        const result = await runBench(deps, scenario, {
          mode: o.mode ?? 'throughput',
          chunkFrames: o.chunkFrames,
          warmup: o.warmup,
          label: o.label,
        });
        (window as unknown as { __gameBench: unknown }).__gameBench = result;
        return result;
      } finally {
        holdPlayerPose = hadHoldPlayer;
        replayActive = hadReplay;
        freeAimOn = hadFreeAim;
        restoreHeldPose();
        // Re-lock under `?simidle` so the frames the restarted loop renders
        // between runs cannot mutate the sim (see the capture at the top).
        simLocked = hadSimLock;
        adaptiveEnabled = hadAdaptive;
        telemetry.active = hadTelemetry;
        adaptiveState = initialAdaptiveState(performance.now(), adaptiveState.rung);
        handle.setLoopRunning(true);
      }
    },
    /**
     * INSIDE-NESS OF THE LIVE, POSED OCCLUDER HULL.
     *
     * occluder-hull.test.ts already asserts every emitted sphere sits inside
     * the flesh — but only for bodies straight out of buildBody, i.e. in the
     * REST pose. This runs the same assertion against the bodies the game is
     * actually rendering, through the same sdBody the raycaster trusts, and
     * reports which primitive authored each sphere that fails.
     */
    hullInsideness(tol = 1e-4) {
      const bad: Array<Record<string, unknown>> = [];
      let total = 0;
      let worst = 0;
      for (let bi = 0; bi < actors.length; bi++) {
        const body = actors[bi]!.posed();
        const spheres = buildHullInstances([body], HULL_SHRINK);
        for (const sph of spheres) {
          total++;
          // Inside means the centre is at least `radius` deep in the flesh.
          const d = sdBody(sph.centre, body);
          const proud = d + sph.radius;
          if (proud > worst) worst = proud;
          if (proud > tol) {
            bad.push({
              actor: actors[bi]!.id, centre: sph.centre.map(v => +v.toFixed(3)),
              radius: +sph.radius.toFixed(4), sdBody: +d.toFixed(4),
              proudMm: +(proud * 1000).toFixed(1),
            });
          }
        }
      }
      return {
        spheres: total, outside: bad.length,
        worstProudMm: +(worst * 1000).toFixed(1),
        sample: bad.slice(0, 12),
      };
    },
    /**
     * Rasterise ONE sphere of known centre and radius and read back what the
     * pre-pass wrote for it, next to the analytic ray-sphere entry for the
     * same pixel. With a single instance there is no ambiguity about which
     * sphere a fragment came from.
     */
    async syntheticSphereCheck(dist = 5, radius = 0.2) {
      const wasOn = sdfLayer.occluderEnabled;
      try {
        handle.setLoopRunning(false);
        // Straight ahead of the camera, `dist` metres away.
        const fwd = new THREE.Vector3();
        camera.getWorldDirection(fwd);
        const c = camera.position.clone().addScaledVector(fwd, dist);
        occluderHull.setSpheres([{ centre: [c.x, c.y, c.z], radius }]);
        sdfLayer.setOccluderEnabled(true);
        handle.step(1 / 60);
        await handle.resolveGpu();
        const ot = sdfLayer.occluderTarget;
        const buf = new Float32Array(
          await handle.renderer.readRenderTargetPixelsAsync(ot, 0, 0, ot.width, ot.height),
        );
        const fpr = Math.ceil((ot.width * 16) / 256) * 256 / 4;
        // The pixel the sphere centre projects to.
        const ndc = c.clone().project(camera);
        const col = Math.round(((ndc.x + 1) / 2) * ot.width - 0.5);
        const rowTop = Math.round(((1 - ndc.y) / 2) * ot.height - 0.5);
        const read = (r: number, cc: number) => buf[r * fpr + cc * 4]!;
        let covered = 0, minV = Infinity, maxV = -Infinity;
        for (let r = 0; r < ot.height; r++) {
          for (let cc = 0; cc < ot.width; cc++) {
            const v = read(r, cc);
            if (v <= 0) continue;
            covered++;
            if (v < minV) minV = v;
            if (v > maxV) maxV = v;
          }
        }
        return {
          sphereCentreDistFromCam: +camera.position.distanceTo(c).toFixed(4),
          radius,
          /** What it SHOULD read at the centre pixel: centre distance - radius. */
          analyticCentrePixel: +(camera.position.distanceTo(c) - radius).toFixed(4),
          atCentrePixelTopDown: +read(rowTop, col).toFixed(4),
          atCentrePixelBottomUp: +read(ot.height - 1 - rowTop, col).toFixed(4),
          coveredPx: covered,
          minWritten: minV === Infinity ? null : +minV.toFixed(4),
          maxWritten: maxV === -Infinity ? null : +maxV.toFixed(4),
          col, rowTop,
        };
      } finally {
        sdfLayer.setOccluderEnabled(wasOn);
        handle.setLoopRunning(true);
      }
    },

    /**
     * OCCLUDER WORLD-POSITION CHECK (close-up diagnostics task 1, question
     * B). Renders the synthetic sphere TWICE — once writing the camera
     * distance (the shipping encoding), once with uDebugWorld=1 writing the
     * fragment's WORLD POSITION — and compares both against the analytic
     * sphere the instance matrix claims was drawn.
     *
     * The attribution this buys: if the written POSITION is right but the
     * written DISTANCE is wrong, the defect is in the material's
     * length(positionWorld - cameraPosition) evaluation; if the POSITION is
     * itself wrong at range, the defect is upstream in the instance/vertex
     * path. Either way the texture round-trip is already exonerated (the
     * quad probes in texRoundTrip).
     */
    async occluderWorldCheck(dist = 5, radius = 0.2) {
      const wasOn = sdfLayer.occluderEnabled;
      try {
        handle.setLoopRunning(false);
        const fwd = new THREE.Vector3();
        camera.getWorldDirection(fwd);
        const c = camera.position.clone().addScaledVector(fwd, dist);
        occluderHull.setSpheres([{ centre: [c.x, c.y, c.z], radius }]);
        sdfLayer.setOccluderEnabled(true);
        const readFrame = async () => {
          handle.step(1 / 60);
          await handle.resolveGpu();
          const t = sdfLayer.occluderTarget;
          const buf = new Float32Array(
            await handle.renderer.readRenderTargetPixelsAsync(t, 0, 0, t.width, t.height),
          );
          return { buf, w: t.width, h: t.height };
        };
        occluderHull.debugWorld.value = 0;
        const d0 = await readFrame();
        occluderHull.debugWorld.value = 1;
        const d1 = await readFrame();
        occluderHull.debugWorld.value = 0;
        const fpr = (w: number) => Math.ceil((w * 16) / 256) * 256 / 4;
        const ndc = c.clone().project(camera);
        const col = Math.round(((ndc.x + 1) / 2) * d0.w - 0.5);
        const rowTop = Math.round(((1 - ndc.y) / 2) * d0.h - 0.5);
        const cell = (d: { buf: Float32Array; w: number }, r: number, cc: number, ch: number) =>
          d.buf[r * fpr(d.w) + cc * 4 + ch] ?? NaN;
        const r1 = Math.min(d0.h - 1 - rowTop, d0.h - 1);
        const writtenDist = cell(d0, r1, col, 0);
        const wPos = new THREE.Vector3(cell(d1, r1, col, 0), cell(d1, r1, col, 1), cell(d1, r1, col, 2));
        const dir = c.clone().sub(camera.position).normalize();
        const tHit = camera.position.distanceTo(c) - radius;
        const expectedPos = camera.position.clone().addScaledVector(dir, tHit);
        return {
          sphereCentreDistFromCam: +camera.position.distanceTo(c).toFixed(4),
          analyticCentrePixel: +tHit.toFixed(4),
          writtenDist: +writtenDist.toFixed(4),
          expectedPos: expectedPos.toArray().map(v => +v.toFixed(4)),
          writtenPos: wPos.toArray().map(v => +v.toFixed(4)),
          posErr: +wPos.distanceTo(expectedPos).toFixed(4),
          distFromWrittenPos: +wPos.distanceTo(camera.position).toFixed(4),
        };
      } finally {
        sdfLayer.setOccluderEnabled(wasOn);
        handle.setLoopRunning(true);
      }
    },

    /** Parity/bench instrumentation (close-up diagnostics task 1): installs
     *  window.__sdfGameDebug with a padded-row march-target readback + FNV
     *  hash, computed IN-PAGE (a 2.3M-float readback must not cross CDP as
     *  a returnByValue object). Outside every timing path; only the parity
     *  gate calls it. */
    installDebugProbe: () => {
      /** Shared readback body for the float-target readers: de-pads the 256-byte-aligned rows
       *  into a dense rgba32f base64 blob. `index` selects an MRT attachment. */
      const packFloatTarget = async (t: THREE.RenderTarget, index = 0) => {
        const w = t.width, h = t.height;
        const raw = new Float32Array(await handle.renderer.readRenderTargetPixelsAsync(t, 0, 0, w, h, index));
        const stride = Math.ceil(w * 16 / 256) * 64;
        const dense = new Float32Array(w * h * 4);
        for (let y = 0; y < h; y++) dense.set(raw.subarray(y * stride, y * stride + w * 4), y * w * 4);
        const bytes = new Uint8Array(dense.buffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
        return { w, h, rgba32f: btoa(binary) };
      };
      (window as unknown as { __sdfGameDebug: unknown }).__sdfGameDebug = {
        /** Raw float readback, row padding removed. The driver compares these
         * bytes before any composite, color conversion or antialias filtering. */
        normalCaptureState() {
          const pieces=[...actors.map(a=>({key:`body:${a.id}`,view:a.view})),...liveChunks.map(c=>({key:`chunk:${c.id}`,view:c.view}))];
          return {camera:camera.matrixWorld.toArray(),projection:camera.projectionMatrix.toArray(),pieces:pieces.map(({key,view})=>({key,data:Array.from((view.dataTexture as THREE.DataTexture).image.data as Float32Array),records:Array.from((view as unknown as { records: { floats: Float32Array } }).records.floats),uniforms:Object.fromEntries(Object.entries(view.uniforms).filter(([k])=>k!=='normalGradientCfg'&&k!=='debugCfg').map(([k,u])=>{const v=u.value;return [k,v&&typeof v==='object'&&'toArray' in v?(v as {toArray:()=>unknown}).toArray():v];}))}))};
        },
        /** NEURAL UPSCALE P3: the supersampled 800x600 training target. Renders the CURRENT state
         *  grid*grid times with a centred sub-pixel march jitter and temporal ray start OFF (its
         *  reprojection matrix is the unjittered camera), accumulating in-page; only the averaged
         *  target crosses CDP. Caller: freeze + render lock on, scale 1.0, fields off, upscale off. */
        async readSupersampledTarget(grid = 4) {
          const t = sdfLayer.marchTarget;
          const w = t.width, h = t.height;
          const offsets = sampleOrder(jitterGrid(grid));
          const stride = Math.ceil(w * 16 / 256) * 64;
          const wasStart = sdfLayer.temporalStart.on;
          const samples: Float32Array[] = [];
          handle.setLoopRunning(false);
          sdfLayer.setTemporalStart(false);
          try {
            for (const [jx, jy] of offsets) {
              if (!sdfLayer.setMarchJitter([jx, jy])) throw new Error('readSupersampledTarget: march jitter refused (fields or accumulation on?)');
              handle.step(1 / 60);
              await handle.resolveGpu();
              const raw = new Float32Array(await handle.renderer.readRenderTargetPixelsAsync(t, 0, 0, w, h));
              const dense = new Float32Array(w * h * 4);
              for (let y = 0; y < h; y++) dense.set(raw.subarray(y * stride, y * stride + w * 4), y * w * 4);
              samples.push(dense);
            }
          } finally {
            sdfLayer.setMarchJitter(null);
            sdfLayer.setTemporalStart(wasStart);
          }
          const { target, coverage } = accumulateSamples(samples, w, h);
          return { w, h, offsets, target: float32ToBase64(target), coverage: float32ToBase64(coverage) };
        },
        async readMarchTarget() {
          handle.setLoopRunning(false);
          handle.step(0);
          await handle.resolveGpu();
          return packFloatTarget(sdfLayer.marchTarget);
        },
        /** ROOM-2 PARITY DIAGNOSTIC (crowd stage a Task 7): per tile, whether
         *  the PROXY BOXES of >= 2 distinct instances of the SAME character
         *  type cover it. A non-multi tile is one where the crowd material's
         *  per-slot loop has a single candidate instance, so a per-body vs
         *  crowd hash mismatch there cannot be a union-fold/banding bug — it
         *  must be the instanced-vs-per-body transform (stage a-2 fix).
         *
         *  WHY NOT TileBinner OVER THE TYPE'S GROUPS (the plan's first
         *  suggestion): measured 2026-09-14 — TileBinner.bin fills EVERY tile
         *  for a group whose sphere crosses the camera plane (`nearDist <= 0`
         *  or `clipW <= 0`), and the full cast (every room) is attached to a
         *  crowd type. One same-kind body anywhere behind the camera therefore
         *  marks all 25x19 tiles multi (masked fraction 0.0000 in room 1 with
         *  exactly one zombie), which makes the masked hash the sha1 of the
         *  EMPTY string — a false "match". The box footprint is what the
         *  fragment actually rasterises, so it is the real overlap.
         *
         *  The in-page buffer is a Uint8Array(tilesX*tilesY) (1 = multi); it
         *  crosses CDP as a plain array. */
        readTileSlotMask() {
          camera.updateMatrixWorld();
          camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
          const size = sdfLayer.targetSize;
          const W = Math.max(1, size.width), H = Math.max(1, size.height);
          const tilesX = Math.ceil(W / TILE_SIZE_PX);
          const tilesY = Math.ceil(H / TILE_SIZE_PX);
          const mask = new Uint8Array(tilesX * tilesY);
          const byKind = new Map<string, ZombieActor[]>();
          for (const a of actors) {
            const list = byKind.get(a.kind);
            if (list) list.push(a); else byKind.set(a.kind, [a]);
          }
          const view = new THREE.Vector4();
          const clip = new THREE.Vector4();
          // Mark one kind's boxes, one actor at a time: a tile counts multi
          // when the SAME tile was already covered by an earlier actor of the
          // same kind. Crossing boxes from different kinds are separate draws.
          for (const list of byKind.values()) {
            const seen = new Uint8Array(tilesX * tilesY);
            for (const a of list) {
              const c = a.view.object.position;
              const h = a.view.uniforms.bodyHalf.value;
              let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
              let any = false;
              for (let corner = 0; corner < 8; corner++) {
                view.set(
                  c.x + ((corner & 1) ? h.x : -h.x),
                  c.y + ((corner & 2) ? h.y : -h.y),
                  c.z + ((corner & 4) ? h.z : -h.z),
                  1,
                ).applyMatrix4(camera.matrixWorldInverse);
                if (view.z >= 0) continue; // corner at/behind the eye plane
                clip.set(view.x, view.y, view.z, 1).applyMatrix4(camera.projectionMatrix);
                if (clip.w <= 0) continue;
                any = true;
                const px = (clip.x / clip.w * 0.5 + 0.5) * W;
                const py = (0.5 - clip.y / clip.w * 0.5) * H;
                if (px < minX) minX = px;
                if (px > maxX) maxX = px;
                if (py < minY) minY = py;
                if (py > maxY) maxY = py;
              }
              // Fully behind the camera: the proxy cannot rasterise, so it can
              // never be an overlap partner in this frame.
              if (!any) continue;
              const tx0 = Math.max(0, Math.floor(minX / TILE_SIZE_PX));
              const tx1 = Math.min(tilesX - 1, Math.floor((maxX - 1e-6) / TILE_SIZE_PX));
              const ty0 = Math.max(0, Math.floor(minY / TILE_SIZE_PX));
              const ty1 = Math.min(tilesY - 1, Math.floor((maxY - 1e-6) / TILE_SIZE_PX));
              for (let ty = ty0; ty <= ty1; ty++) {
                for (let tx = tx0; tx <= tx1; tx++) {
                  const t = ty * tilesX + tx;
                  if (seen[t]) mask[t] = 1; // a second same-kind box covers t
                  seen[t] = 1;
                }
              }
            }
          }
          return { tilesX, tilesY, tilePx: TILE_SIZE_PX, mask: Array.from(mask) };
        },
        /** Run 5b: the march MRT's NORMAL attachment as { w, h, rgba32f } — same frozen frame and
         *  de-pad as readMarchTarget. rgb = view-space normal, alpha = the per-body key the refine
         *  twins compare against (march.wgsl.ts MARCH_BODY_LIGHT `bodyKey`). Null when the layer
         *  allocated no normal attachment. */
        async readMarchNormalTarget() {
          if (!sdfLayer.marchNormalTexture) return null;
          handle.setLoopRunning(false);
          handle.step(0);
          await handle.resolveGpu();
          return packFloatTarget(sdfLayer.marchTarget, 1);
        },
        /** Run 4: the output-res detail field (sdf-layer detailTarget) as { w, h, rgba32f } — same
         *  de-pad as readMarchTarget. Null when the layer has no normal attachment. */
        async readDetailTarget() {
          const t = sdfLayer.detailTarget;
          if (!t) return null;
          handle.setLoopRunning(false);
          handle.step(0);
          await handle.resolveGpu();
          return packFloatTarget(t);
        },
        /** Run 5: both refine attachments as { c, n } of { w, h, rgba32f }; null unless the boot allocated them. */
        async readRefine() {
          const t = sdfLayer.refineTarget;
          if (!t) return null;
          handle.setLoopRunning(false); handle.step(0); await handle.resolveGpu();
          return { c: await packFloatTarget(t, 0), n: await packFloatTarget(t, 1) };
        },
        /** Neural upscale normals capture (2026-09-12): the march target re-rendered with every
         *  actor and chunk in debug mode 9 (march.wgsl.ts MARCH_BODY_LIGHT): rgb = the final
         *  WORLD-space shading normal, alpha = clip depth as usual. Same frozen frame, same
         *  size and layout as readMarchTarget. `view` is the camera's matrixWorldInverse
         *  (column-major 16), for the capture to rotate normals into view space. */
        async readMarchNormals() {
          const prev = new Map<unknown, number>();
          const views = [...actors.map((a) => a.view), ...liveChunks.map((c) => c.view)];
          for (const v of views) { prev.set(v, v.uniforms.debugCfg.value.x); v.uniforms.debugCfg.value.x = 9; }
          try {
            const dbg = (window as unknown as { __sdfGameDebug: { readMarchTarget(): Promise<{ w: number; h: number; rgba32f: string }> } }).__sdfGameDebug;
            const r = await dbg.readMarchTarget();
            return { ...r, view: camera.matrixWorldInverse.toArray() };
          } finally {
            for (const v of views) v.uniforms.debugCfg.value.x = prev.get(v) ?? 0;
          }
        },
        async normalPointSamples(bodyId: number | string, points: Vec3[]) {
          const view=typeof bodyId==='number'?actors.find(a=>a.id===bodyId)?.view:liveChunks.find(c=>`chunk:${c.id}`===bodyId)?.view;if(!view)throw new Error('missing probe piece');
          const u=view.uniforms,p=tslUniform(new THREE.Vector3()),kind=tslUniform(0),noise=tslUniform(new THREE.Vector4());
          const material=new THREE.MeshBasicNodeMaterial();
          material.outputNode=buildNormalBodyPointFn()({p,data:tslTexture(view.dataTexture),noiseCfg:noise,woundCfg:u.woundCfg,woundCfg2:u.woundCfg2,volumeTex:tslTexture3D(view.volumeTexture),volumeMin:u.volumeMin,volumeInvExtent:u.volumeInvExtent,volumeWarp:u.volumeWarp,volumeClip:u.volumeClip,perfCfg:u.perfCfg,inst:(view as unknown as { records: { node: unknown } }).records.node,instCfg:tslUniform(new THREE.Vector4(1,0,0,0)),probeKind:kind});
          material.depthTest=false;material.depthWrite=false;material.blending=THREE.NoBlending;material.toneMapped=false;
          const scene=new THREE.Scene(),geometry=new THREE.PlaneGeometry(2,2),quad=new THREE.Mesh(geometry,material);quad.frustumCulled=false;scene.add(quad);
          const camera=new THREE.OrthographicCamera(-1,1,1,-1,0,1);
          const target=new THREE.RenderTarget(1,1,{depthBuffer:false,type:THREE.FloatType,format:THREE.RGBAFormat});
          const renderer=handle.renderer,previous=renderer.getRenderTarget();
          const read=async(q:Vec3,mode:number)=>{p.value.fromArray(q);kind.value=mode;renderer.setRenderTarget(target);renderer.render(scene,camera);await handle.resolveGpu();return Array.from(new Float32Array(await renderer.readRenderTargetPixelsAsync(target,0,0,1,1)).slice(0,4));};
          const results=[];
          try {for(const point of points) {
            noise.value.x=0;
            const analytic=await read(point,0),state=await read(point,1),scalar=await read(point,2);
            const epsilons=[];
            for(const epsilon of [.0015,.0005,.0002,.0001]) {
              const gradient=[];
              for(let axis=0;axis<3;axis++) {const lo=[...point] as [number,number,number],hi=[...point] as [number,number,number];lo[axis]!-=epsilon;hi[axis]!+=epsilon;gradient.push(((await read(hi,2))[0]!-(await read(lo,2))[0]!)/(2*epsilon));}
              epsilons.push({epsilon,gradient});
            }
            const signs:Vec3[]=[[1,-1,-1],[-1,-1,1],[-1,1,-1],[1,1,1]];
            const tetra:Array<{point:Vec3;sign:Vec3;geometric:number[];noisy:number[]}>=[];
            for(const sign of signs) {const q=point.map((v,i)=>v+.0015*sign[i]!) as unknown as Vec3;tetra.push({point:q,sign,geometric:await read(q,2),noisy:[] as number[]});}
            const image=view.dataTexture.image as {width:number;data:Float32Array};
            const owner=state[1]!;const color=image.data[(ROW_PRIM_COLOR*image.width+owner)*4+3]!;const shape=image.data[(ROW_PRIM_SHAPE*image.width+owner)*4+1]!;
            const suppression=color>0?Math.max(Math.max(0,Math.min(1,color-1)),(Math.round(shape)&16)!==0?1:0):0;
            noise.value.x=u.marchCfg.value.z*(1-suppression);
            const combined=await read(point,3),noiseOnly=await read(point,4);
            for(const sample of tetra)sample.noisy=await read(sample.point,2);
            const sum=(key:'geometric'|'noisy')=>[0,1,2].map(axis=>tetra.reduce((v,s)=>v+s.sign[axis]!*s[key][0]!,0)/(.0015*4));
            results.push({point,analytic,state,scalar,epsilons,detailBreakdown:{amplitude:noise.value.x,tetra,geometricTetra:sum('geometric'),fullTetra:sum('noisy'),combined:combined.slice(1),noiseOnly:noiseOnly.slice(1)}});
          }} finally {renderer.setRenderTarget(previous);material.dispose();geometry.dispose();target.dispose();}
          return results;
        },
        /** Affected wound ROI from exact clip depth and the uploaded wound
         * rows. sdBody supplies original authored/carved flesh; classification
         * uses the production scalar equations, not a screen-space circle. */
        normalWoundCoverage(bodyId: number | string, packed: string, w: number, h: number, suspects: number[] = []) {
          const actor=typeof bodyId==='number'?actors.find(a=>a.id===bodyId):undefined;
          const chunk=typeof bodyId==='string'?liveChunks.find(c=>`chunk:${c.id}`===bodyId):undefined;
          const view=actor?.view??chunk?.view;if(!view)throw new Error('missing wound coverage piece');
          const u=view.uniforms,tex=view.dataTexture as THREE.DataTexture;
          const image=tex.image as {data:Float32Array;width:number};
          const row=(i:number,y:number)=>Array.from(image.data.subarray((y*image.width+i)*4,(y*image.width+i)*4+4));
          // Chunk CPU oracle consumes the actual uploaded straight-capsule
          // rows; other profiles require a separate independent adapter.
          const body=actor?.posed()??{
            prims:Array.from({length:Math.round(u.counts.value.x)},(_,i)=>{
              const a=row(i,ROW_PRIM_A),b=row(i,ROW_PRIM_B),scale=row(i,ROW_PRIM_SCALE),shape=row(i,ROW_PRIM_SHAPE);
              if(shape[0]!>=0||(Math.round(shape[1]!)&47)!==0)throw new Error('chunk oracle requires straight capsules');
              return {a:a.slice(0,3) as unknown as Vec3,b:b.slice(0,3) as unknown as Vec3,radius:a[3]!,blendK:b[3]!,scale:scale.slice(0,3) as unknown as Vec3,op:scale[3]!>.5?'sub' as const:'add' as const,limb:chunk!.state.limb,cluster:0,orient:row(i,ROW_PRIM_QUAT) as unknown as [number,number,number,number]};
            }),
            clusters:Array.from({length:Math.round(u.counts.value.y)},(_,i)=>{const r=row(i,ROW_CLUSTER_RANGE),b=row(i,ROW_CLUSTER_BOUNDS);return {id:i,limb:chunk!.state.limb,start:r[0]!,count:r[1]!,alive:r[2]!>.5,center:b.slice(0,3) as unknown as Vec3,radius:b[3]!};}),
          };
          const cfg=u.woundCfg.value.toArray(),cfg2=u.woundCfg2.value.toArray(),perf=u.perfCfg.value.toArray();
          const bound=u.woundBound.value;
          const wounds=Array.from({length:Math.round(cfg[0]!)},(_,i)=>({w:row(i,ROW_WOUND),meta:row(i,ROW_WOUND_META),cap:row(i,ROW_WOUND_CAP)}));
          const raw=Uint8Array.from(atob(packed),c=>c.charCodeAt(0));const data=new Float32Array(raw.buffer);
          const make=()=>({hits:0,analytic:0,reasons:Array<number>(8).fill(0)});
          const regions={wall:make(),rim:make(),internal:make(),curvedInternal:make(),headWound:make(),torsoWound:make()};
          const point=new THREE.Vector3();
          let scalarSurfaceMax=0;const samples:unknown[]=[];
          for(let i=0;i<data.length;i+=4) {
            const code=Math.round(data[i]!)-1,owner=Math.round(data[i+2]!);
            if(code<0||code>7||owner<0)continue;
            const pixel=i/4,x=pixel%w,y=Math.floor(pixel/w);
            const p=normalHitPoint(x,y,w,h,data[i+3]!,camera);
            point.fromArray(p);
            const base=sdBody(p,body);let d=base;
            if(point.distanceTo(new THREE.Vector3(bound.x,bound.y,bound.z))<=bound.w) for(const wound of wounds) {
              const v=p.map((a,k)=>a-wound.w[k]!);const r=Math.hypot(...v);
              const reach=wound.w[3]!*Math.max(2,2*cfg[3]!+3*cfg2[0]!)+4*cfg[1]!+.25;
              if(perf[1]!>.5&&r>reach)continue;
              const burn=wound.meta[0]!>1.5;
              const depth=wound.w[3]!*(burn?.35*Math.max(0,Math.min(1,wound.meta[1]!)):1);
              const cap=wound.cap[3]!>0?wound.cap[3]!:1e5;
              d=smax(d,Math.min(depth-r,cap-v.reduce((a,b,k)=>a+b*wound.cap[k]!,0)),cfg[1]!);
              const amp=depth*cfg[2]!*wound.meta[2]!*(burn?.25:1);
              if(amp>0) {
                const xx=(r-depth*cfg[3]!*wound.meta[3]!)/Math.max(depth*cfg2[0]!,1e-4);
                const gate=Math.max(0,Math.min(1,(base+.3*amp)/amp));
                d-=Math.exp(-xx*xx)*amp*(1-gate*gate*(3-2*gate));
              }
            }
            if(suspects.includes(pixel)) {
              const baseG=finiteGradient(q=>sdBody(q,body),p,1e-5);
              const resolved:WoundInput[]=wounds.map(v=>{const burn=v.meta[0]!>1.5,depth=v.w[3]!*(burn?.35*Math.max(0,Math.min(1,v.meta[1]!)):1);return {center:v.w.slice(0,3) as unknown as V3,depth,cap:v.cap[3]!>0?v.cap[3]!:1e5,inward:v.cap.slice(0,3) as unknown as V3,blend:cfg[1]!,rimPosition:depth*cfg[3]!*v.meta[3]!,rimWidth:Math.max(depth*cfg2[0]!,1e-4),rimAmp:depth*cfg[2]!*v.meta[2]!*(burn?.25:1)};});
              const dg=woundGradient({d:base,g:baseG,reason:'ok'},p,resolved);
              samples.push({pixel:[x,y],p,owner,base,baseG,dg,gradientLength:Math.hypot(...dg.g),primitive:body.prims[owner]});
            }
            const add=(region:ReturnType<typeof make>)=>{region.hits++;region.reasons[code]!++;if(code===0)region.analytic++;};
            if(owner>=u.counts.value.x) {add(regions.internal);if((Math.round(row(owner,ROW_PRIM_SHAPE)[1]!)&2)!==0)add(regions.curvedInternal);continue;}
            if(Math.abs(d-base)<=1e-5)continue;
            scalarSurfaceMax=Math.max(scalarSurfaceMax,Math.abs(d));
            add(d>base?regions.wall:regions.rim);
            if(body.prims[owner]?.limb==='head')add(regions.headWound);
            if(body.prims[owner]?.limb==='torso')add(regions.torsoWound);
          }
          return {thresholdMetres:1e-5,method:'unproject WebGPU clip-depth alpha; production uploaded wound scalar minus sdBody authored flesh; internal owners separate',regions,scalarSurfaceMax,samples,wounds,cfg,cfg2,perf};
        },
        async hashMarchTarget() {
          const t = sdfLayer.marchTarget;
          const w = t.width, h = t.height;
          const buf = new Float32Array(
            await handle.renderer.readRenderTargetPixelsAsync(t, 0, 0, w, h),
          );
          const floatsPerRow = Math.ceil((w * 16) / 256) * 256 / 4;
          let hash = 0x811c9dc5;
          let nonZero = 0;
          let rSum = 0;
          for (let row = 0; row < h; row++) {
            const base = row * floatsPerRow;
            for (let col = 0; col < w; col++) {
              const o = base + col * 4;
              const r = buf[o]!, g = buf[o + 1]!, b = buf[o + 2]!;
              hash = Math.imul(hash ^ (r | 0), 0x01000193);
              hash = Math.imul(hash ^ (g | 0), 0x01000193);
              hash = Math.imul(hash ^ (b | 0), 0x01000193);
              if (r !== 0 || g !== 0 || b !== 0) nonZero++;
              rSum += r;
            }
          }
          return { w, h, hash: (hash >>> 0).toString(16), nonZero, rSum: +rSum.toFixed(3) };
        },
      };
      return 1;
    },

    /**
     * TEXTURE ROUND-TRIP PROBE (close-up diagnostics task 1, question B).
     *
     * Writes a KNOWN ray parameter into render targets in the shapes the
     * quarter-res depth prepass (and the parked hull exit bound) would use,
     * and reads it back through BOTH consumption paths — the CPU readback
     * and the WGSL textureLoad fetch the march actually binds — at a range
     * ladder. Purpose: decide whether a written t survives the round-trip
     * (the prepass may proceed) or decays with range (the phenomenon that
     * killed the occluder pre-pass and holds GAME_HULL_EXIT_BOUND at 0).
     *
     * Three write paths, so a decay can be attributed:
     *   mode 'uniform' — colorNode = vec4(uT), uT set from the CPU. No
     *     geometry involvement at all: isolates the TEXTURE itself.
     *   mode 'dist' — the exact shipped expression,
     *     colorNode = vec4(length(positionWorld - cameraPosition)), on a
     *     quad perpendicular to the camera's forward at `dist`. Isolates
     *     the TSL distance expression under rasterisation: every fragment
     *     of a forward-facing plane at that distance should read dist
     *     exactly.
     *   (mode 'mesh' — the occluder's instanced-sphere path — is the
     *     existing syntheticSphereCheck; the driver runs both and merges
     *     the table.)
     *
     * Targets: RGBA32F and R32F (the occluder's and the outer hull's
     * formats), each at FULL march-target scale and QUARTER scale (the
     * depth prepass's scale). All NearestFilter, depth-tested like the
     * shipped pre-passes. Quarter dims are ceil, matching how a prepass
     * would allocate.
     *
     * The WGSL read is the occFetch/shellFetch body verbatim (clamp to
     * dims, floor(screenUV * dims), textureLoad .x) rendered through a
     * second material into a second target set — so the validated operator
     * is the one the march would bind, not a lookalike.
     *
     * Self-contained and idle by default: builds its scene/targets lazily
     * on first call, parks the loop, restores everything it touched.
     */
    async texRoundTrip(o: { dist: number; mode?: 'uniform' | 'dist' | 'dist-small' }) {
      const dist = o.dist;
      const mode = o.mode ?? 'uniform';
      // ---- lazily-built probe rig ----------------------------------------
      if (!texProbe) {
        const QuadFetchWGSL = /* wgsl */ `fn quadFetch(
  srcTex: texture_2d<f32>,
  suv: vec2<f32>
) -> f32 {
  let dims = vec2<f32>(textureDimensions(srcTex, 0));
  let c = clamp(vec2<i32>(floor(suv * dims)), vec2<i32>(0, 0), vec2<i32>(dims) - vec2<i32>(1, 1));
  return textureLoad(srcTex, c, 0).x;
}`;
        const mkWriteTarget = (fmt: 'rgba' | 'red', quarter: boolean): THREE.RenderTarget => new THREE.RenderTarget(
          quarter ? Math.max(1, Math.ceil(sdfLayer.marchTarget.width / 4)) : sdfLayer.marchTarget.width,
          quarter ? Math.max(1, Math.ceil(sdfLayer.marchTarget.height / 4)) : sdfLayer.marchTarget.height,
          {
            depthBuffer: true,
            type: THREE.FloatType,
            ...(fmt === 'red' ? { format: THREE.RedFormat } : {}),
            minFilter: THREE.NearestFilter,
            magFilter: THREE.NearestFilter,
          },
        );
        // Read targets are ALWAYS RGBA32F at the write target's scale: the
        // production consumers never CPU-read a RedFormat target either —
        // they textureLoad it in-shader — so the validated chain is
        // write(fmt) -> textureLoad -> rgba32f -> CPU, and the r32f CPU
        // readback (which this renderer's helper does not support) never
        // enters the picture.
        const mkReadTarget = (quarter: boolean): THREE.RenderTarget => new THREE.RenderTarget(
          quarter ? Math.max(1, Math.ceil(sdfLayer.marchTarget.width / 4)) : sdfLayer.marchTarget.width,
          quarter ? Math.max(1, Math.ceil(sdfLayer.marchTarget.height / 4)) : sdfLayer.marchTarget.height,
          {
            depthBuffer: false,
            type: THREE.FloatType,
            minFilter: THREE.NearestFilter,
            magFilter: THREE.NearestFilter,
          },
        );
        const scene = new THREE.Scene();
        const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
        quad.frustumCulled = false;
        scene.add(quad);
        const uniformMat = new THREE.MeshBasicNodeMaterial();
        const u = tslUniform(0);
        uniformMat.colorNode = tslVec4(u, u, u, 1);
        const distMat = new THREE.MeshBasicNodeMaterial();
        const dNode = tslLength(tslSub(positionWorld, cameraPosition));
        distMat.colorNode = tslVec4(dNode, dNode, dNode, 1);
        // The read pass quad faces +z from z = 0 toward an ortho camera at
        // z = 5 looking down -z: a fixed full-screen blit shape, so the
        // fetch operator's screenUV maps 1:1 onto the write target's texels.
        const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 100);
        ortho.position.set(0, 0, 5);
        ortho.lookAt(0, 0, 0);
        texProbe = {
          scene, quad, ortho,
          writes: { uniform: { m: uniformMat, u }, dist: { m: distMat }, 'dist-small': { m: distMat } },
          fetchNode: wgslFn(QuadFetchWGSL),
          targets: {
            'rgba-full': [mkWriteTarget('rgba', false), mkReadTarget(false)],
            'rgba-quarter': [mkWriteTarget('rgba', true), mkReadTarget(true)],
            'red-full': [mkWriteTarget('red', false), mkReadTarget(false)],
            'red-quarter': [mkWriteTarget('red', true), mkReadTarget(true)],
          },
        };
      }
      const probe = texProbe;
      try {
        handle.setLoopRunning(false);
        // One step so the camera's world matrix reflects any pose the driver
        // set just before this call.
        handle.step(1 / 60);
        const fwd = new THREE.Vector3();
        camera.getWorldDirection(fwd);
        // Near-plane guard: a quad closer than the near plane clips, which
        // must read as a staging fault, never as decay.
        if (dist <= camera.near * 1.2) {
          return { error: `dist ${dist} <= near ${camera.near} — stage further out` };
        }
        // The value every covered fragment should carry.
        const expected = mode === 'uniform'
          ? (probe.writes.uniform.u.value = dist, dist)
          : dist;
        // 'dist-small': the SAME per-fragment distance expression on a quad
        // only 0.4 m tall — the synthetic sphere's projected size class. If
        // THIS decays with range, the defect is projected-size-dependent
        // (rasteriser/precision), not mesh-specific; if it is exact, the
        // occluder's instanced-geometry path owns the fault alone.
        const smallQuad = mode === 'dist-small';
        probe.quad.material = probe.writes[mode].m;
        // Where the WRITE pass needs the quad: perpendicular to the view
        // axis at `dist`, sized to overflow the frustum there, so the centre
        // pixel and its neighbours are all covered by the quad itself.
        const writePos = camera.position.clone().addScaledVector(fwd, dist);
        const writeQuat = new THREE.Quaternion().setFromRotationMatrix(
          new THREE.Matrix4().lookAt(camera.position, writePos, camera.up),
        );
        const writeScale = smallQuad
          ? 0.4
          : Math.max(1, 2.5 * dist * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
        const rows: { target: string; cpu: number; wgsl: number; relErr: number; neighbourSpread: string }[] = [];
        for (const [name, [writeT, readT]] of Object.entries(probe.targets)) {
          // ---- write pass (main camera; renderer autoClears) ----
          probe.quad.position.copy(writePos);
          probe.quad.quaternion.copy(writeQuat);
          probe.quad.scale.setScalar(writeScale);
          handle.renderer.setRenderTarget(writeT);
          handle.renderer.render(probe.scene, camera);
          await handle.resolveGpu();
          // ---- CPU read of the WRITE target (RGBA only — see mkReadTarget):
          // centre pixel + neighbours, so a partial-coverage write shows up
          // as spread rather than silently aliasing into the centre value ----
          const w = writeT.width, ht = writeT.height;
          const buf = new Float32Array(
            await handle.renderer.readRenderTargetPixelsAsync(writeT, 0, 0, w, ht),
          );
          const floatsPerRow = Math.ceil((w * 16) / 256) * 256 / 4;
          const cx = Math.floor(w / 2), cy = Math.floor(ht / 2);
          const at = (x: number, y: number) => buf[y * floatsPerRow + x * 4] ?? NaN;
          const cpu = at(cx, cy);
          const spread = [at(cx - 1, cy), at(cx + 1, cy), at(cx, cy - 1), at(cx, cy + 1)];
          // ---- WGSL read: the occFetch/shellFetch operator rendered into
          // the paired RGBA target through the fixed ortho blit, then
          // CPU-read at the same centre texel ----
          const mat = new THREE.MeshBasicNodeMaterial();
          const fetched = probe.fetchNode({ srcTex: tslTexture(writeT.texture), suv: tslScreenUV });
          mat.outputNode = tslVec4(fetched, fetched, fetched, 1);
          mat.depthTest = false;
          mat.depthWrite = false;
          const savedMat: THREE.Material = probe.quad.material as THREE.Material;
          probe.quad.material = mat;
          probe.quad.position.set(0, 0, 0);
          probe.quad.quaternion.identity();
          probe.quad.scale.set(1, 1, 1);
          handle.renderer.setRenderTarget(readT);
          handle.renderer.render(probe.scene, probe.ortho);
          await handle.resolveGpu();
          const buf2 = new Float32Array(
            await handle.renderer.readRenderTargetPixelsAsync(readT, 0, 0, w, ht),
          );
          const wgsl = buf2[cy * floatsPerRow + cx * 4] ?? NaN;
          rows.push({
            target: name,
            cpu: +cpu.toFixed(5), wgsl: +wgsl.toFixed(5),
            relErr: expected !== 0 ? +Math.abs((cpu - expected) / expected).toFixed(5) : 0,
            neighbourSpread: spread.map(v => +v.toFixed(4)).join(','),
          });
          probe.quad.material = savedMat;
          mat.dispose();
        }
        return { dist, mode, expected, near: camera.near, far: camera.far, rows };
      } finally {
        handle.renderer.setRenderTarget(null);
        handle.setLoopRunning(true);
      }
    },

    /** Rebuild the hull NOW (the frame-loop update is gated on !wanderFrozen,
     *  so frozen captures would otherwise shoot through a stale hull). No
     *  simulation steps, so a stamped body stays exactly where it was put. */
    refreshHull: () => {
      occluderHull.update(
        actors.map(a => a.posed()),
        hullExclusionsEnabled
          ? actors.flatMap(a => {
            const prims = a.posed().prims;
            const yaw = a.pose().yaw;
            return a.visualWounds().map(w => ({ centre: woundWorldPos(prims, w, yaw), radius: w.radius }));
          })
          : [],
        // Same rule as the frame loop: only rebuild the occluder half when
        // the pre-pass is on to consume it.
        { occluder: sdfLayer.occluderEnabled },
      );
    },
    /** A/B seam: rebuild the SHADOW hull with spanning off (the pre-fix
     *  bead-chain) or on. Pair it with refreshHull() — and use it INSTEAD of
     *  a two-build cross-load A/B, which the wander makes untrustworthy. */
    setShadowSpan: (on: boolean, inflate?: number) => occluderHull.setShadowSpan(on, inflate),
    /** A/B seam for the shadow hull's junction bridges (the shoulder-shadow
     *  pinch fix). Pair with refreshHull() — and use it INSTEAD of a
     *  cross-load A/B, which the wander makes untrustworthy. */
    setShadowBridges: (on: boolean) => occluderHull.setShadowBridges(on),
    /** A/B seam for the shoulder socket clamp (motion.ts
     *  MOTION_TUNING.shoulderSocket). 0.05 is the shipped cap; 0 disables the
     *  clamp entirely. Live — the next stepMotion reads it — and pairable
     *  with refreshHull() / ?frozen=1 for single-variable captures. */
    setShoulderSocket: (cap: number) => {
      (MOTION_TUNING as { shoulderSocket: number }).shoulderSocket = cap;
    },
    /** SSCS seam: flip the contact-shadow stage live (it re-binds the flesh
     *  mask, so enabling from the console in deferred mode is refused — the
     *  march target is not the flesh mask there). */
    setSscs: (on: boolean) => {
      if (on && deferredMode) return 'refused: sscs is legacy-path-only';
      if (on) postAa.setSscsFleshTex(sdfLayer.marchTarget.texture);
      postAa.setSscs(on);
      return postAa.sscs;
    },
    /** SSCS live tuning: setSscsTerm('strength', 0.5) etc. Clamped to
     *  SSCS_TERM_RANGES. Pair with ?frozen=1 for single-variable captures. */
    setSscsTerm: (name: keyof SscsTerms, value: number) => {
      postAa.setSscsTerm(name, value);
      return postAa.sscsTerms;
    },
    get sscsTerms() { return postAa.sscsTerms; },
    /** Shadow-map edge hardness (the A/B seam for SHADOW_RADIUS): radius in
     *  shadow-map texels, 0 = crisp edge, ~2 the shipped default, 6+ very
     *  soft. Live on the WebGPU PCF filter (a reference uniform) — no
     *  recompile. Shapes the shadow MAP only: shadows on flesh go through
     *  the march's own LEVEL_SHADOW PCF, and the contact term's softness is
     *  setSscsTerm's to tune. */
    setShadowRadius: (r: number) => {
      flashlight.spot.shadow.radius = Math.max(0, Math.min(8, r));
      return flashlight.spot.shadow.radius;
    },
    get shadowRadius() { return flashlight.spot.shadow.radius; },
    hullDebug: () => ({
      occluder: sdfLayer.occluderEnabled,
      exclusions: hullExclusionsEnabled,
      instances: occluderHull.instanceCount,
      woundsPerBody: actors.map(a => a.wounds().length),
    }),
    /** A visible sphere in WORLD space, drawn through the normal geometry
     *  pass — so captures can mark predicted impacts vs actual craters.
     *  One marker at a time; pass null coords to remove. */
    placeMarker(x: number | null, y = 0, z = 0, colorHex = 0xff00ff) {
      if (!marker) {
        const geo = new THREE.SphereGeometry(0.03, 12, 8);
        marker = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: colorHex }));
        marker.frustumCulled = false;
        scene.add(marker);
      }
      (marker.material as THREE.MeshBasicMaterial).color.setHex(colorHex);
      if (x === null) { marker.visible = false; return; }
      marker.visible = true;
      marker.position.set(x, y, z);
    },
    projectiles: () => pellets.map(p => ({
      pos: [...p.pos] as Vec3,
      vel: [...p.vel] as Vec3,
      ageSec: p.ageSec,
    })),
    get chunkCount() { return liveChunks.length; },
    /** Dev seam (chunk-bake gate/look/bench): spawn one synthetic meat-ball
     *  chunk at a world position through the REAL spawn path — the same
     *  view, sim, settle, bake and gib machinery a severed limb uses, with
     *  a controlled size so drivers get a target whose radius they know.
     *  A severed hand-gob's 4.6 cm bounding sphere is a sniper target; this
     *  is the same machinery at a testable size. */
    spawnTestChunk: (x: number, y: number, z: number, radius = 0.12, stationary = false) => {
      const prims: Primitive[] = [];
      const rng = rngStreams.misc;
      for (let i = 0; i < 6; i++) {
        const th = rng() * Math.PI * 2;
        const ph = Math.acos(2 * rng() - 1);
        const dx = Math.sin(ph) * Math.cos(th) * radius * 0.5;
        const dy = Math.cos(ph) * radius * 0.5;
        const dz = Math.sin(ph) * Math.sin(th) * radius * 0.5;
        prims.push({
          limb: 'torso', cluster: 0, op: 'add',
          a: [x + dx - 0.02, y + dy, z + dz] as Vec3,
          b: [x + dx + 0.02, y + dy, z + dz] as Vec3,
          radius: radius * 0.55, scale: [1, 1, 1], blendK: 0.03,
        } as unknown as Primitive);
      }
      spawnChunkPiece(
        { limb: 'torso', origin: [x, y + radius, z] as Vec3, prims, tornAt: [], bones: [] },
        { uniforms: actors[0]!.view.uniforms, volumeTexture: actors[0]!.view.volumeTexture },
        stationary ? [0, 0, 0] : undefined,
      );
      return prims.length;
    },
    /** Settled-chunk bake (close-up task 5). ON at boot (GAME_CHUNK_BAKE);
     *  off is pixel-identical. Toggling mid-session only affects FUTURE
     *  settles — baked pieces stay baked until shot or recycled. */
    soldierCorpseBake: () => soldierCorpses?.stats(),
    setSoldierCorpseBake(on: boolean) { soldierCorpses?.setEnabled(on); },
    /** Micro-detail amplitude on every settled/baked piece — the march's
     *  `surfaceNoiseAmp`, which the bake used to drop entirely. `null` follows
     *  the live creature (the shipped behaviour); a number overrides it, which
     *  is how to judge a term whose authored value is 0.06. Live: no rebake,
     *  the pieces already on the floor change on the next frame. */
    setChunkDetail(x: number | null, o?: { freq?: number; albedo?: number }) {
      chunkDetailOverride = x === null ? null : Math.max(0, Math.min(1, x));
      if (o?.freq !== undefined) chunkDetailFreq = Math.max(0.5, Math.min(64, o.freq));
      if (o?.albedo !== undefined) chunkDetailAlbedo = Math.max(0, Math.min(1.5, o.albedo));
      return { amp: chunkDetailOverride, freq: chunkDetailFreq, albedo: chunkDetailAlbedo };
    },
    get chunkDetail() {
      return { amp: chunkDetailOverride, freq: chunkDetailFreq, albedo: chunkDetailAlbedo };
    },
    /** WHAT THE MATERIALS ACTUALLY HOLD, not what was requested. `chunkDetail`
     *  is the override; this is the value the per-frame push last wrote into
     *  each registered material's `fleshDetail.x`, which is what the shader
     *  reads. They differ whenever the push is not reaching a material — the
     *  exact failure this getter exists to make visible, because a look A/B on
     *  a floor full of recycling gore cannot distinguish "the term does nothing"
     *  from "the term never arrived". */
    chunkDetailApplied: () => litChunkMaterials.map(m => {
      const d = m.uniforms.fleshDetail.value;
      return { amp: d.x, freq: d.y, albedo: d.z, ambient: m.uniforms.ambient.value.getHex() };
    }),
    /** THE BAKED ALBEDO ITSELF, sampled off a settled piece's `bakeColor`
     *  attribute — the vertex colour the shader composes from.
     *
     *  The whole question about a settled piece is whether it looks wrong
     *  because of the ALBEDO or because of the LIGHT on it, and those two are
     *  indistinguishable on screen. This reads the albedo directly: mean rgb,
     *  its range, and the mean wound-mask alpha. Values are LINEAR, matching
     *  the .blob palette (flesh baseColor is 0.68 0.44 0.40). */
    bakedAlbedoStats: () => bakedChunks.map(b => {
      const a = b.mesh.geometry.getAttribute('bakeColor');
      if (!a) return { id: b.id, error: 'no bakeColor' };
      const v = a.array as ArrayLike<number>;
      const n = v.length / 4;
      let r = 0, g = 0, bl = 0, wm = 0;
      const mn = [9, 9, 9], mx = [-9, -9, -9];
      for (let i = 0; i < v.length; i += 4) {
        r += v[i]!; g += v[i + 1]!; bl += v[i + 2]!; wm += v[i + 3]!;
        for (let k = 0; k < 3; k++) {
          if (v[i + k]! < mn[k]!) mn[k] = v[i + k]!;
          if (v[i + k]! > mx[k]!) mx[k] = v[i + k]!;
        }
      }
      const f = (x: number) => Math.round(x * 1000) / 1000;
      return {
        id: b.id, verts: n,
        mean: [f(r / n), f(g / n), f(bl / n)],
        min: mn.map(f), max: mx.map(f), meanWoundMask: f(wm / n),
        // AO: mean and range. A flat 1.0 means the attribute is absent or the
        // bake is not writing it, which is indistinguishable from "the piece is
        // simply unoccluded" on screen.
        ao: (() => {
          const g2 = b.mesh.geometry.getAttribute('bakeAo');
          if (!g2) return 'absent';
          const v2 = g2.array as ArrayLike<number>;
          let sum = 0, lo = 9, hi = -9;
          for (let i = 0; i < v2.length; i++) {
            sum += v2[i]!; if (v2[i]! < lo) lo = v2[i]!; if (v2[i]! > hi) hi = v2[i]!;
          }
          return { mean: f(sum / v2.length), min: f(lo), max: f(hi) };
        })(),
      };
    }),
    /** Compare the SAME settled poses, with no worker timing or physics drift.
     * The retained views exist for recycling already; only this dev seam draws them. */
    setBakedChunkReference(on: boolean) {
      bakedChunkReference = on;
      for (const b of bakedChunks) {
        b.mesh.visible = !on;
        b.view.object.visible = on;
        if (on) b.view.update(b.state);
      }
    },
    setChunkBake(on: boolean) {
      chunkBakeEnabled = on;
      if (!on) cancelChunkBake();
      if (on && bakedChunkMat) bakedChunkSeed?.(bakedChunkMat);
    },
    get chunkBake() { return chunkBakeEnabled; },
    /** Paired-pixel diagnostic: hide exactly one live or baked producer
     * while the gate holds simulation locked; returns false for stale IDs. */
    setChunkVisible(id: number, visible: boolean) {
      const live = liveChunks.find(c => c.id === id);
      const baked = bakedChunks.find(c => c.id === id);
      const object = live?.view.object ?? baked?.mesh;
      if (!object) return false;
      object.visible = visible;
      return true;
    },
    /** Leak/observability census: live (stepped/marched) chunks, baked
     *  meshes, ring views, bake cost. The long-firefight gate reads this. */
    chunkStats: () => ({
      live: liveChunks.length,
      sharedLiveMaterial: liveChunks.every(c => (c.view.object as THREE.Mesh).material === chunkMaterial.material),
      baked: bakedChunks.length,
      views: chunkViews.length,
      totalBakes,
      lastBakeMs, // worker CPU time, NOT a main-thread span
      lastBakeSwapMs,
      lastBakeSwapFrame,
      lastBakeRequestMs,
      bakeThread: 'worker',
      pendingBake: chunkBakeJobs.pendingId,
      bakeError: chunkBakeJobs.error,
      lastBakeInfo,
      /** THE ASSET PATH'S OWN CENSUS (task 2): asset hits, fallback reasons,
       *  load bytes, live moving meshes and runtime extraction jobs. Included
       *  here so a single `chunkStats()` read answers "did the offline set
       *  actually carry this blast, and how much runtime extraction did it
       *  remove?" without a second seam. */
      gibAssets: gibAssetRuntime.countersSnapshot(),
      /** Baked pieces wearing the per-fragment textured HEAD material — the
       *  first non-zero value is the first textured-head draw (startup probe). */
      faceBaked: bakedChunks.filter(b => b.faceMaterial !== undefined).length,
      pieces: bakedChunks.map(b => ({ id: b.id, centre: [...b.centre] as [number, number, number], radius: b.radius, face: b.faceMaterial !== undefined, quat: [...b.state.quat] as [number, number, number, number] })),
      /** Live (still-marched) chunk positions — the look/bench drivers frame
       *  the camera on these in bake-OFF captures. */
      livePieces: liveChunks.map(c => ({
        id: c.id, centre: [...c.state.pos] as [number, number, number], radius: c.state.radius,
        /** Orientation and angular velocity (task 4): the rupture hand-off must
         *  leave a NON-identity quat and a nonzero spin on each released piece. */
        quat: [...c.state.quat] as [number, number, number, number],
        angVel: [...c.state.angVel] as [number, number, number],
      })),
    }),
    /** SDF-pass scale relative to the capped buffer (1.0 = 1:1). */
    setSdfScale: (v: number) => applySdfScale(v),
    get sdfScale() { return sdfScale; },
    get sdfTarget() { return sdfLayer.targetSize; },
    /** Adaptive resolution ladder — default OFF so the chosen rung ships. */
    /** A/B seam for the actor visibility cull (ships ON). The bench's
     *  `actor-cull-off` leg is the "before" column. */
    /** 'off' | 'sdf' (flesh only) | 'frame' (whole picture). */
    setFieldStyle: (style: 'off' | 'sdf' | 'bodies' | 'frame') => sdfLayer.setFieldStyle(style),
    get fieldStyle() { return sdfLayer.fieldStyle; },
    setFieldMode: (on: boolean) => sdfLayer.setFieldMode(on),
    get fieldMode() { return sdfLayer.fieldMode; },
    setFieldComb: (v: number) => sdfLayer.setFieldComb(v),
    /** THE INTERLACED FIELD DIVISOR (deeper interlace fields, 2026-09-10).
     *  2 = shipped; 3 and 4 are owner-approved on screen, which is where they
     *  must be judged — the arithmetic is not the decision. Returns what it
     *  ACTUALLY set, because `frame` refuses anything but 2 (its weave still
     *  hardcodes two fields) and a silent no-op would read as success. */
    setFieldCount: (n: number) => sdfLayer.setFieldCount(n),
    get fieldCount() { return sdfLayer.fieldCount; },
    get fieldComb() { return sdfLayer.fieldComb; },
    setActorCull(on: boolean) { actorCullEnabled = on; if (!on) lastSeenMs.clear(); },
    actorCull: () => ({ enabled: actorCullEnabled, ...cullCounts }),
    setAdaptive(on: boolean, budgetMs?: number) {
      adaptiveEnabled = on;
      if (budgetMs !== undefined) adaptiveBudgetMs = budgetMs;
      adaptiveState = initialAdaptiveState(performance.now(), adaptiveState.rung);
      adaptiveFrames.length = 0;
    },
    get adaptive() {
      return {
        enabled: adaptiveEnabled,
        budgetMs: adaptiveBudgetMs,
        rung: adaptiveState.rung,
        scale: scaleForRung(adaptiveState.rung),
        ladder: [...SCALE_LADDER],
      };
    },
    /** The active render cap + how it was chosen (?res=). */
    get resolution() {
      const cap = RES_RUNGS[resKey];
      const content = postAa.contentSize;
      return {
        rung: resKey,
        cap: { ...cap },
        content: { ...content },
        letterboxed: cap.mode === 'fixed',
      };
    },
    /** Dev twin of the lab's stampWoundAt (2026-08-27): ONE wound by ray
     *  through the same worldHitToWound path the pellet uses, pushed via
     *  stampBlast — no damage, no shove, no sever. A full grapeshot volley
     *  kills and death-gibs (the weapon works), so a pocked STANDING torso
     *  only exists through this seam. */
    stampWoundAt: (ox: number, oy: number, oz: number, dx: number, dy: number, dz: number,
      kind: 'pellet' | 'slug' = 'pellet', bodyId?: number) => {
      const a = bodyId === undefined ? actors[0] : actors.find(q => q.id === bodyId);
      if (!a) return null;
      const posed = a.posed();
      const hit = traceProjectile(
        [ox, oy, oz],
        [ox + dx * 8, oy + dy * 8, oz + dz * 8],
        q => sdBody(q, posed),
      );
      if (!hit) return null;
      // 'slug' carries the BLAST profile at 0.16 (see SLUG) — the blast-class
      // crater look without resolveExplosion's 16-wound kill-gib.
      const field = (q: Vec3) => sdBody(q, posed);
      const yaw = a.pose().yaw;
      const w = kind === 'slug'
        ? woundFromSlug(posed.prims, hit, field, yaw)
        : woundFromPellet(posed.prims, hit, yaw, field);
      a.stampBlast([w]);
      // Capture twins must spill too — task 8 judges the rope from exactly
      // this seam. Rolls bleedRng deterministically: same command sequence,
      // same rope-or-not.
      spillVerdict(a, w);
      return hit;
    },
    /** Diagnostic detonation: one blast stamped through resolveExplosion
     *  (the SAME worldHitToWound path dynamite uses) with falloff-scaled
     *  blast calibre — wounds only, no shove/sever/gib, so captures are not
     *  displaced by their own impact. Returns what it did. */
    explode: (x: number, y: number, z: number) => {
      const bodies: ExplosionBody[] = actors.map(a => ({ id: String(a.id), body: a.posed(), bodyYaw: a.pose().yaw }));
      const fx = resolveExplosion([x, y, z], bodies);
      let totalWounds = 0;
      for (const pb of fx.perBody) {
        if (pb.wounds.length === 0) continue;
        const a = actors.find(q => String(q.id) === pb.bodyId);
        if (!a) continue;
        a.stampBlast(pb.wounds);
        // One decision PER stamped wound: the first cavity wound spawns,
        // the rest tear — a blast blows the gut out rather than growing
        // multiple ropes (shouldSpill's one-rope-per-body rule).
        for (const w of pb.wounds) spillVerdict(a, w);
        totalWounds += pb.wounds.length;
      }
      return { radiusM: fx.radiusM, bodiesHit: fx.perBody.length, totalWounds };
    },
    // ——— DYNAMITE (slot 2) ————————————————————————————————————————————————
    /** The REAL detonation — the same call a thrown bundle makes, gibs and all.
     *  `explode` above stays the wound-only capture twin: this one displaces
     *  bodies and destroys them, so a still frame of it is not reproducible. */
    detonate: (x: number, y: number, z: number) => {
      const before = { actors: actors.length, chunks: liveChunks.length };
      detonateAt([x, y, z]);
      return {
        // `dynLastRadiusM`, NOT `explosionRadiusM()`: see that field's block —
        // the constant made every radius knob invisible to every rig.
        radiusM: dynLastRadiusM,
        actorsBefore: before.actors,
        actorsAfter: actors.length,
        chunksBefore: before.chunks,
        chunksAfter: liveChunks.length,
        gibbed: dynGibbed,
        gibPieces: dynGibPieces,
        lastBlastMs: dynLastBlastMs,
      };
    },
    /** Live slot/cook/flight state — the tuning readout and a gate's oracle. */
    dynamite: () => ({
      live: slotState.live,
      target: slotState.target,
      phase: slotState.phase,
      ready: slotReady(slotState),
      gunLower: slotLowerAmount(slotState, 'shotgun'),
      bundleLower: slotLowerAmount(slotState, 'dynamite'),
      cookPhase: cook.phase,
      charge: dynCharge,
      inHand: heldProp !== null,
      inFlight: liveBundles.length,
      flights: liveBundles.map(b => ({
        pos: b.state.pos, vel: b.state.vel, fuse: b.state.fuse,
        resting: b.state.resting, detonated: b.state.detonated,
        drawn: b.prop !== null,
      })),
      // PROP-POOL ACCOUNTING. The pool is where a "the dynamite vanished" bug
      // lives, and none of it is visible from the outside without these.
      props: bundleProps.length,
      spares: spareBundles.length,
      heldVisible: heldProp ? heldProp.object.visible : null,
      heldParent: heldProp ? (heldProp.object.parent === bundleRig ? 'rig' : 'other') : null,
      heldLocal: heldProp
        ? [heldProp.object.position.x, heldProp.object.position.y, heldProp.object.position.z]
          .map(v => Number(v.toFixed(3)))
        : null,
      drawnBundles: liveBundles.filter(b => b.prop !== null).length,
      thrown: dynThrown, detonations: dynDetonations,
      gibbed: dynGibbed, gibPieces: dynGibPieces, lastBlastMs: dynLastBlastMs,
      gibMode, gibBones, gibStaggerFrames, maxChunks, dynSpeedScale, gibVelScale,
      gibLaunchMode,
      aoeRadiusScale, aoeLaunchFloor,
      ceilM: BUNDLE_CEIL_M,
      // THE STAGED RELEASE, as numbers a gate can assert on: how many pieces are
      // still waiting for their blast impulse, and how far that queue's oldest
      // entry is from firing. `?gibstagger=1` must empty the queue on the blast
      // frame; the default must NOT.
      pendingPieceImpulses: pendingGibImpulses.length,
      pendingPieceFrames: pendingGibImpulses.reduce((m, p) => Math.max(m, p.delay), 0),
      // NB there is deliberately NO "pieces at rest" counter: `stepChunk`
      // applies gravity to every chunk, so a piece held for the stagger is at
      // rest for exactly the frame it was born and for none after. The queue
      // length is the honest signal that the blast has not gone off yet.
      pendingPieceDelays: pendingGibImpulses.map(p => p.delay),
      fxLightScale, lights: explosionLights.length,
      // What the ROOM is actually being lit with right now, and the age of the
      // newest burst's light — the two numbers a light measurement needs.
      meshIntensity: explosionLightPool.map(pl => Number(pl.intensity.toFixed(1))),
      lightAges: explosionLights.map(e => Number(e.age.toFixed(3))),
      lastBlastRadiusM: dynLastRadiusM,
      lastGibDropped: dynLastGibDropped,
      lastGibTier: dynLastGibTier, lastGibSpawned: dynLastGibSpawned, gibWounds,
      gibTierLog: dynGibTierLog,
      gibTearSec,
      // THE PRE-TEAR WINDOW, live: how many bodies are bending right now, how
      // far into their window the oldest is, and how many are waiting for it to
      // close. A rig asserts the sequence from these rather than from a feeling
      // about the frames.
      tearing: actors.filter(x => x.tearing()).length,
      tearAge: actors.reduce((m, x) => Math.max(m, x.tearAge()), 0),
      // THE RUPTURE'S ACTUAL DISPLACEMENT, in metres: the largest region offset
      // any body is being drawn with right now. A rig asserts that the body is
      // separating (this climbs from 0 to the peak) instead of trusting a
      // frame's silhouette.
      ruptureMaxM: actors.reduce((m, x) => {
        const f = x.tearFrame();
        if (!f) return m;
        for (const o of f.offsets) m = Math.max(m, Math.hypot(o[0], o[1], o[2]));
        return m;
      }, 0),
      // THE RUPTURE'S ACTUAL ROTATION, in radians (task 4): the largest
      // per-region angle any body is being drawn with right now. A rig asserts
      // the pieces are already TILTED before release (this climbs from 0) and
      // that the released chunks keep the orientation (chunkStats().livePieces
      // quats) rather than being a translation-only explosion.
      ruptureMaxRad: actors.reduce((m, x) => {
        const f = x.tearFrame();
        if (!f) return m;
        for (const q of f.quats) {
          const w = Math.min(1, Math.abs(q[3]));
          m = Math.max(m, 2 * Math.acos(w));
        }
        return m;
      }, 0),
      pendingGibs: pendingGibs.length,
      // THE PREVIEW'S SHAPE, live (task 3): the regions a pending body is
      // actually being drawn as, and the tier that will spawn. A rig compares
      // these against `lastGibTier`/`lastGibSpawned` after release to prove the
      // preview and the spawn are the same piece set.
      pendingPlanPieces: pendingGibs.reduce((n, q) => n + q.plan.pieces.length, 0),
      pendingTiers: pendingGibs.map(q => q.tier),
      scheduledGibBodies: dynScheduledGibBodies, scheduledGibPieces: dynScheduledGibPieces,
      lastGibParts: dynLastGibParts, lastGibHeld: dynLastGibHeld,
      blastProfile: dynBlastProfile,
      // The resolver's own split for the LAST blast. Reset in detonateAt, not
      // here: a getter with a side effect is a trap, and reading this after
      // `blastProfile` (which shares this object) silently consumed the data.
      resolveProfile: { ...EXPLOSION_PROFILE },
    }),
    /** AUTOMATION: select a slot without synthesising a key event. */
    selectSlot: (slot: WeaponSlot) => {
      if (cook.phase === 'cooking') return { ok: false, reason: 'cooking' };
      // VALIDATED, because a bad argument here does not fail — it POISONS.
      // `WeaponSlot` is the string union 'shotgun' | 'dynamite' and the slot
      // machine only ever compares against those, so a caller passing the
      // NUMBER 2 (the obvious mistake for a driving script: the key is 2, the
      // HUD says 2) gets a state whose `live`/`target` are 2 — the switch runs,
      // reports `phase: 'up'`, makes NOTHING live, and every later press is
      // dropped by `liveDyn` with no error anywhere. That cost a soak rig an
      // hour of "the throws never detonate". A refusal is cheap; a silently
      // inert weapon slot is not.
      if (!WEAPON_SLOTS.includes(slot)) {
        return { ok: false, reason: `unknown-slot:${String(slot)}` };
      }
      slotState = requestSlot(slotState, slot);
      updateHud();
      return { ok: true, live: slotState.live, target: slotState.target, phase: slotState.phase };
    },
    /** A/B seam: stamp the 16 wounds on bodies this blast gibs (the old
     *  behaviour) or skip them (the shipped one). See `gibWounds`. */
    setGibWounds: (on: boolean) => { gibWounds = !!on; return gibWounds; },
    /** AUTOMATION: light the fuse / let it go, the two edges a mouse provides.
     *  Kept as edges rather than a cooked-to-order throw so a gate drives the
     *  SAME path a player does. */
    dynamitePress: () => { dynPress = true; return { ok: true }; },
    dynamiteRelease: () => { dynRelease = true; return { ok: true }; },
    /** AUTOMATION: the in-hand overcook, without waiting out the fuse. */
    overcook: () => { overcookInHand(); return { ok: true }; },
    /** Which explosion renderer is live and what it holds. `mode` is
     *  'procedural' (the GPU fireball) or 'standin' (the additive cards). */
    explosionFx: () => ({
      mode: explosionVfx ? 'procedural' : burstLayer ? 'atlas' : 'standin',
      usingAtlas: burstLayer?.usingAtlas ?? null,
      size: fxSize, smoke: fxSmoke, life: fxLife, gain: fxGain, plume: fxPlume,
      liveBursts: explosionVfx?.activeBursts ?? 0,
      lightIntensity: explosionVfx?.lightIntensity ?? 0,
      tuning: explosionVfx?.tuning ?? null,
      // THE BURST'S OWN SHAPE, in metres, per layer — the measurement the frame
      // differential cannot make (the ring dominates the changed area, and the
      // changed region's bounding box is re-cut by one stray pixel). Read it
      // straight after a `step`, with `?frozen=1` and the loop stopped.
      layerExtents: explosionVfx?.layerExtents ?? null,
      burstHalfHeightM: explosionVfx?.burstHalfHeightM ?? null,
    }),
    /** Live tuning for the procedural burst (see ExplosionVfxTuning). */
    setExplosionFxTuning: (t: Record<string, number>) => {
      explosionVfx?.setTuning(t as never);
      return explosionVfx?.tuning ?? null;
    },
    /** Force a burst at a point, for a capture that must not wait for a throw. */
    spawnExplosionFx: (x: number, y: number, z: number, heightM = 2, kind: 'air' | 'ground' = 'ground') => {
      const visual = { kind, at: [x, y, z] as Vec3, heightM };
      const scaled = scaleBurstVisual(visual);
      igniteExplosionLight(visual.at);
      if (explosionVfx) explosionVfx.spawn(scaled);
      else if (burstLayer) burstLayer.spawn(scaled);
      else spawnBurstStandIn(scaled.at, scaled.heightM, scaled.kind);
      return { mode: explosionVfx ? 'procedural' : burstLayer ? 'atlas' : 'standin' };
    },
    /** The live roster in world terms — what a blast gate needs to pick a
     *  target and to count what a detonation removed. Read-only scalars only:
     *  id, kind, room, ground position, yaw, collapse phase. No GPU state, so
     *  this is safe to poll between stepped frames. */
    actorList: () => actors.map(a => {
      const p = a.pose();
      const d = a.debug();
      return {
        id: a.id, kind: a.kind, room: a.room,
        pos: [p.pos[0], p.pos[1], p.pos[2]] as Vec3, yaw: p.yaw,
        phase: d.phase, meter: d.meter,
      };
    }),
    /** Chunk census: live (flying/being marched) vs baked (settled meshes). A
     *  gib reads here as live rising, then baked following as the bake queue
     *  drains — which is the cost the ?maxchunks knob exists to bound. */
    /**
     * MEASUREMENT SEAM: hide every detached piece (marched proxy AND baked
     * mesh) without spawning or destroying anything.
     *
     * WHY IT EXISTS. The piece cost is the one number that would justify a
     * per-archetype mesh pre-bake, and `sdf:march` cannot price it as things
     * stand: the SAME state in ONE boot measured 2.61, 3.82 and 18.79 ms across
     * four-sample groups, a 7x spread that swamps any delta read from two
     * different states. Alternating pieces-hidden/pieces-shown at a FIXED piece
     * count is an A/B the machine can actually answer.
     */
    /**
     * SHOW/HIDE THE SKELETON. A differential seam for one claim the bone census
     * cannot make: the census reports that a bone piece is FLAGGED to render as
     * bone (pale, with rows packed), and "the skeleton is on screen" is a
     * different statement about pixels. Hiding the bone pieces and diffing the
     * frame is how that gets measured rather than argued — the same trick the
     * explosion rig uses on whole layers. Applies to pieces already live and to
     * any spawned while it is off.
     */
    setBonePiecesVisible: (on: boolean) => {
      bonesVisible = !!on;
      for (const c of liveChunks) if (c.kind === 'bone') c.view.object.visible = bonesVisible;
      return bonesVisible;
    },
    /** HIDE THE VIEW MODEL (the held shotgun/arm rig parented to the camera).
     *  A capture that must see the BODY's silhouette has the player's own arm
     *  across the right half of the frame, which covers the very flesh the
     *  rupture review is about. The rig lives under the camera, NOT the scene,
     *  so `setRegisteredObjectsVisible` cannot reach it. Capture-only, and off
     *  by default. */
    setViewModelVisible: (on: boolean) => {
      viewModelAnchor.visible = !!on;
      return viewModelAnchor.visible;
    },
    setChunksVisible: (on: boolean) => {
      chunksHidden = !on;
      for (const c of liveChunks) {
        c.view.object.visible = !chunksHidden && (c.kind !== 'bone' || bonesVisible);
      }
      for (const b of bakedChunks) b.mesh.visible = !chunksHidden;
      // SPRITE PIECES COUNT AS PIECES HERE. This seam is the "pieces shown vs
      // hidden" arm every cost rig and differential uses, and a rig that had to
      // know which render mode was on would be a rig that silently measured
      // nothing the day the mode changed. The sprite mode's OWN control is
      // `setSpritePiecesVisible` below; this one moves both.
      setSpritePiecesVisible(spritePieces, on);
      return !chunksHidden;
    },
    chunksVisible: () => !chunksHidden,
    /** THE RENDER MODE BESIDE THE PIECE MODE — live, no reload.
     *
     *  This exists as a SETTER, not only as a boot param, for the reason every
     *  A/B on this project does: single-run comparisons on this machine are
     *  worthless (the same claim has read +7.6 ms and -1.4 ms), so a paired
     *  measurement has to alternate the two arms INSIDE ONE BOOT, against the
     *  same room, the same bodies and the same camera. Switching does not
     *  disturb pieces already in flight — they keep the renderer they were born
     *  with, which is what makes the switch itself cheap and safe.
     *
     *  Turning it ON loads the sheet if it is not loaded yet and reports what
     *  happened, so a caller can tell "the mode is on" from "the mode is on and
     *  armed". */
    setGibRenderMode: async (mode: 'march' | 'sprite' | 'carve' | 'assets' = 'march') => {
      gibRenderMode = mode === 'sprite' ? 'sprite'
        : mode === 'carve' ? 'carve' : mode === 'assets' ? 'assets' : 'march';
      if (gibRenderMode === 'carve') ensureCarvedLibrary();
      if (gibRenderMode === 'sprite') await ensureGibAtlas('sheet');
      // The asset path is a fetch+decode; await it so a caller can tell "mode
      // on" from "mode on and armed" (the same contract as the sprite atlas).
      if (gibRenderMode === 'assets') await ensureGibAssets();
      return { mode: gibRenderMode, frames: gibAtlas?.frames.length ?? 0, ready: gibRenderMode === 'assets' ? gibAssetArmed() : gibAtlas !== null };
    },
    gibRenderMode: () => ({
      mode: gibRenderMode,
      // `ready` is per mode: the sprite path needs its ATLAS, the carve path its
      // LIBRARY, the assets path a loaded archetype SET — and conflating them
      // would report one mode armed because another's asset loaded.
      ready: gibRenderMode === 'assets'
        ? gibAssetArmed()
        : gibRenderMode === 'carve' ? (carvedLibrary !== null) : gibAtlas !== null,
      frames: gibAtlas?.frames.length ?? 0, atlas: gibAtlasSource,
      liveCap: gibSpriteLiveCap, restCap: gibSpriteRestCap, sizeScale: gibSpriteSizeScale,
      assets: {
        armed: gibAssetArmed(),
        zombie: gibAssetRuntime.archetypeState('zombie'),
        soldier: gibAssetRuntime.archetypeState('soldier'),
      },
      carve: carvedLibrary ? {
        pieces: carvedLibrary.pieces.length,
        verts: carvedLibrary.totalVerts,
        tris: carvedLibrary.totalTris,
        bonePrims: carvedLibrary.bonePrims,
        fleshPrims: carvedLibrary.fleshPrims,
        cells: carvedLibrary.cells,
        cellSize: carvedLibrary.cellSize,
        buildMs: carvedBuildMs,
        skipped: carvedLibrary.skipped.length,
        piecesWithBones: carvedLibrary.pieces.filter(x => x.bonesNear > 0).length,
      } : null,
    }),
    /** The carved library's per-piece breakdown — the seam a rig uses to check
     *  that the ribcage is actually in a chest slice rather than merely assumed. */
    gibCarveLibrary: () => (carvedLibrary ? carvedLibrary.pieces.map(p => ({
      part: p.part, limb: p.limb, verts: p.verts, tris: p.tris, radius: p.radius,
      bonesNear: p.bonesNear, centre: p.centre,
    })) : []),
    /** Hide/show the blast's sprite pieces without destroying them — the sprite
     *  twin of `setChunksVisible`, and how a capture proves a DETONATION's
     *  sprites are drawn rather than merely in the scene graph. */
    setSpritePiecesVisible: (on: boolean) => setSpritePiecesVisible(spritePieces, !!on),
    /** WHERE EVERY SPRITE PIECE IS — the sprite twin of `chunkStates()`, live and
     *  parked, so a rig watching a gib fly does not care which mode made it. */
    spritePieceStates: () => spritePieceStates(spritePieces),
    spriteCensus: () => ({
      live: spritePieces.live.length,
      rest: spritePieces.rest.length,
      meshes: spritePieces.group.children.length,
      geometries: spritePieces.assets.unitPlane ? 1 : 0,
      materials: spritePieces.assets.material.size,
      liveCap: gibSpriteLiveCap,
      restCap: gibSpriteRestCap,
      hidden: spritePieces.hidden,
    }),
    /** Drop every sprite piece (both lists) — the reset a paired rig wants
     *  between arms, so an earlier blast's pile is not in the frame. */
    clearSpritePieces: () => clearSpritePieces(spritePieces),
    /**
     * THE OFFLINE ASSET SEAM (task 2). `stats` is the always-available census
     * (asset hits, per-reason fallbacks, load bytes, live moving meshes, runtime
     * extraction jobs). `library` reports what loaded. `reset` cancels in-flight
     * loads and drops every cached library so a rig can force a clean reload —
     * a reset drops the sprite pieces first, which returns their pooled buffers.
     */
    gibAssetStats: () => gibAssetRuntime.countersSnapshot(),
    gibAssetLibrary: () => {
      const out: Record<string, unknown> = {};
      for (const archetype of ['zombie', 'soldier']) {
        const lib = gibAssetRuntime.library(archetype);
        out[archetype] = lib ? {
          state: gibAssetRuntime.archetypeState(archetype),
          fingerprint: lib.fingerprint,
          pieces: lib.pieces.length,
          verts: lib.verts,
          tris: lib.tris,
          binBytes: lib.bytes.bin,
          builtMs: lib.builtMs,
          materials: 1,
        } : {
          state: gibAssetRuntime.archetypeState(archetype),
          reason: gibAssetRuntime.failureReason(archetype),
        };
      }
      return out;
    },
    resetGibAssets: () => {
      const dropped = clearSpritePieces(spritePieces);
      gibAssetRuntime.dispose();
      resetGibAssetCache();
      gibAssetRuntime = createGibAssetRuntime();
      return dropped;
    },
    /** PRELOAD THE COMMITTED SETS without switching mode — the paired rig's
     *  "arm both arms first" step. Returns the armed state. */
    preloadGibAssets: async () => { await ensureGibAssets(); return gibAssetArmed(); },
    /** RELAY THE GORE-PART BENCH in front of the player: meat chunks and classic
     *  bones, rendered through the real gib mesh path. Returns how many parts. */
    goreShowcase: () => spawnGoreShowcase(),
    /** LAY THE SPRITE GIB BENCH in front of the player (loads the dev-only atlas
     *  on first use). Returns the number of billboards. */
    gibSpriteBench: async (which: 'placeholder' | 'sheet' = gibAtlasSource) => {
      await ensureGibAtlas(which);
      return laySpriteBench();
    },
    /** Show/hide the sprite bench without destroying it — the same A/B the mesh
     *  bench has, so a capture can prove the sprites are DRAWN. */
    gibSpriteBenchVisible: (on: boolean) => {
      if (spriteBenchGroup) spriteBenchGroup.visible = on;
      return spriteBenchGroup?.visible ?? false;
    },
    /** THE PARTS' PROCEDURAL DETAIL, live: `{detail, bump, blood, noise}` plus the
     *  STAIN terms `{burn, wet, dark, stainScale}`. `detail: 0` turns the whole
     *  layer off, which is the A/B control for whether the bumps and the decals are
     *  doing anything at all.
     *
     *  `noise` scales the bump's noise DOMAIN: it is the term that decides whether
     *  the bump is surface texture or a smooth tilt, and the measurement to re-run
     *  when changing it is the neighbouring-pixel roughness in
     *  `scripts/gore-detail-ab.mjs`.
     *
     *  The stain half answers the owner's next note — "still look like rocks -
     *  there no dark blood or burn stains … the blood is more specular and wet
     *  looking": `dark` pushes blood toward near-black, `wet` drives it into the
     *  highlight, `burn` is the charred field (matte, near-black — the contrast
     *  against wet blood), and `stainScale` is the stains' own broader domain. */
    /**
     * THE GORE MATERIAL'S LIGHT RESPONSE — `look` = (stain, wetTint, specGain,
     * fresGain) on every detail-layer chunk material.
     *
     * Exposed because the carve changed the regime these defaults were tuned in.
     * `chunkShade`'s specular is ADDITIVE and is NOT multiplied by albedo:
     *
     *     specular = keyC * wetTint * (shine * specGain * keyI + fres * (0.5 + 0.5 * keyI))
     *
     * and both terms are scaled by the wound mask (`fres *= 1 + wm * 1.5`). On a
     * settled chunk wm is a LOCAL halo round a torn end, so the defaults (1.2,
     * 0.6) never had to behave at wm = 1 over a large area. A carved piece is a
     * third cut face, all of it at wm = 1, under a 4x flashlight beam — measured
     * 8-11% of piece pixels blown to white against 0.0% on the marched body it is
     * supposed to match. That is the "white / concrete" read.
     */
    goreLook: (o: { spec?: number; fres?: number; wetTint?: number; stain?: number } = {}) => {
      if (o.stain !== undefined) goreLookCfg.x = o.stain;
      if (o.wetTint !== undefined) goreLookCfg.y = o.wetTint;
      if (o.spec !== undefined) goreLookCfg.z = o.spec;
      if (o.fres !== undefined) goreLookCfg.w = o.fres;
      for (const m of [gorePartMat, carvedMaterial, gibAssetMaterial]) {
        m?.uniforms.look.value.set(goreLookCfg.x, goreLookCfg.y, goreLookCfg.z, goreLookCfg.w);
      }
      return { stain: goreLookCfg.x, wetTint: goreLookCfg.y, spec: goreLookCfg.z, fres: goreLookCfg.w };
    },
    goreDetail: (
      o: {
        detail?: number; bump?: number; blood?: number; noise?: number;
        burn?: number; wet?: number; dark?: number; stainScale?: number;
      } = {},
    ) => {
      if (o.detail !== undefined) gorePartDetail.x = o.detail;
      if (o.bump !== undefined) gorePartDetail.y = o.bump;
      if (o.blood !== undefined) gorePartDetail.z = o.blood;
      if (o.noise !== undefined) gorePartDetail.w = Math.max(1, o.noise);
      if (o.burn !== undefined) gorePartStain.x = Math.max(0, o.burn);
      if (o.wet !== undefined) gorePartStain.y = Math.max(0, o.wet);
      if (o.dark !== undefined) gorePartStain.z = Math.min(1, Math.max(0, o.dark));
      if (o.stainScale !== undefined) gorePartStain.w = Math.max(0.25, o.stainScale);
      // EVERY material that opted into the detail layer, not just the bench's.
      // `carvedMaterial` is a SECOND `createBakedChunkMaterial({goreDetail:true})`
      // instance with its own uniform set (it has to be — a material instance
      // owns one goreCfg), so a writer that names only `gorePartMat` tunes the
      // bench and leaves ?gibrender=carve on its boot values. That is the same
      // shape of bug as the flashlight's: see `litChunkMaterials`, which exists
      // because the per-frame beam update had exactly this omission.
      for (const m of [gorePartMat, carvedMaterial, gibAssetMaterial]) {
        m?.uniforms.goreCfg.value.set(
          gorePartDetail.x, gorePartDetail.y, gorePartDetail.z, gorePartDetail.w,
        );
        m?.uniforms.goreCfg2.value.set(
          gorePartStain.x, gorePartStain.y, gorePartStain.z, gorePartStain.w,
        );
      }
      return {
        detail: gorePartDetail.x, bump: gorePartDetail.y,
        blood: gorePartDetail.z, noise: gorePartDetail.w,
        burn: gorePartStain.x, wet: gorePartStain.y,
        dark: gorePartStain.z, stainScale: gorePartStain.w,
      };
    },
    /** Show/hide the bench WITHOUT destroying it, which is how a capture proves
     *  the parts are actually drawn rather than merely in the scene graph. */
    goreShowcaseVisible: (on: boolean) => {
      if (goreShowcase) goreShowcase.visible = on;
      return goreShowcase?.visible ?? false;
    },
    /** WHERE EVERY LIVE PIECE IS, and what it is doing — the seam a rig needs to
     *  watch a gib fly. Added for the wall-collision check: "do the pieces stay
     *  in the room" is a question about POSITIONS over time, and the only other
     *  way to read them was a telemetry snapshot (F9). */
    chunkStates: () => [
      ...liveChunks.map(c => ({
        id: c.id, limb: c.state.limb, kind: c.state.kind,
        pos: c.state.pos, vel: c.state.vel, radius: c.state.radius,
        settled: chunkSettled(c.state),
        render: 'march' as const,
      })),
      // SPRITE PIECES ARE PIECES. A rig that asks "where is every piece and is
      // it inside a room" must get the same answer in either render mode, or the
      // wall/ceiling guarantees would silently go unverified the moment someone
      // flips `?gibrender=sprite`. `rest` distinguishes a parked quad from one
      // still flying; the other fields are the marched row's own shape.
      ...spritePieceStates(spritePieces).map(p => ({ ...p, render: 'sprite' as const })),
    ],
    /** THE ENCLOSURE A POINT IS IN, in metres: the same box the probe gather and
     *  the bundle's ceiling resolve against. A rig that wants to assert "this
     *  piece stayed in the room" needs the room's rectangle, and hard-coding it
     *  in the rig would let the level move out from under the assertion. */
    enclosureBoxAt: (x: number, z: number) => {
      const key = enclosureKeyAt(x, z);
      const enc = enclosureOf(key);
      return enc ? { key, min: enc.box.min, max: enc.box.max } : null;
    },
    chunkCensus: () => {
      // HOW MANY PIECES ARE EVEN IN THE FRAME — the ceiling on what frustum
      // culling can save, so a cost A/B can be read against it rather than
      // against a feeling about where the camera was pointing.
      const frustum = new THREE.Frustum().setFromProjectionMatrix(
        new THREE.Matrix4().multiplyMatrices(
          camera.projectionMatrix, camera.matrixWorldInverse,
        ),
      );
      let inFrustum = 0;
      for (const c of liveChunks) if (frustum.intersectsObject(c.view.object)) inFrustum++;
      // ——— IS THE SKELETON ACTUALLY DRAWN AS BONE? ————————————————————————
      // The owner's complaint was "i still dont see anything bone related like
      // idk rib cage or something", and there are two separate claims in
      // answering it. `gib-parts.test.ts` proves the FIRST: the ribcage leaves
      // the body as a bone-only chunk. These counters are the second, and they
      // are what a page can see:
      //
      //   * a bone piece renders pale only while its view carries
      //     `meltCfg.x = 1` — the pale matte branch in the melt ramp is the
      //     ONLY thing in the shader that paints bone as bone (`isBone` alone
      //     shades it as meat);
      //   * and it only has bone to paint if its rows are PACKED
      //     (`counts2.x` = packed bone count), which `packBones = true` is what
      //     guarantees: with the bone-tube path's packBones off, a bone-only
      //     chunk packs NOTHING and marches an empty field.
      //
      // `staleBoneFlags` counts the failure mode the lab's own comment warns
      // about: chunk views are RECYCLED, so a flesh piece inheriting a
      // ribcage's meltCfg.x would render pale and matte — a bone-coloured arm.
      let bonePieces = 0, boneRows = 0, organPieces = 0, buriedBonePieces = 0;
      let bonesShadingAsMeat = 0, organsShadingAsBone = 0;
      for (const c of liveChunks) {
        const pale = c.view.uniforms.meltCfg.value.x > 0;
        const rows = c.view.uniforms.counts2.value.x;
        if (c.kind === 'bone') {
          if (pale && rows > 0) { bonePieces++; boneRows += rows; }
          // A bone piece that lost its pale flag, or that has no rows packed at
          // all (the bone-tube path's packBones off would do both), shades as
          // MEAT — the skeleton is in the pile and cannot be seen.
          //
          // UNLESS THE TUBES ARE DRAWING IT (2026-09-15). Under `gibBoneMesh` a
          // bone piece packs no rows and marches nothing BY DESIGN — the
          // instancer draws it from `posedBones()` and the proxy is hidden. The
          // metric predates that path and would report all of them as a failure,
          // which is the census crying wolf about the shipped configuration.
          else if (!gibBoneMesh) bonesShadingAsMeat++;
        } else if (c.boneOnly) {
          // An ORGAN piece: deliberately NOT pale (it tints as viscera), and its
          // rows are organs. If it ever goes pale it renders as bare bone.
          organPieces++;
          if (pale) organsShadingAsBone++;
        } else if (rows > 0) {
          // THE BURIED CASE, which is the one the owner described: a FLESH piece
          // whose bones are packed INSIDE its own field as more capsules unioned
          // with the meat enclosing them. It draws as a solid tube with an
          // invisible femur in it. The cheap `clusters` tier does exactly this,
          // so this counter is how a degraded blast says so out loud.
          buriedBonePieces++;
        }
      }
      return {
      inFrustum, ofPieces: liveChunks.length,
      bonePieces, boneRows, organPieces, buriedBonePieces,
      bonesShadingAsMeat, organsShadingAsBone,
      live: liveChunks.length, baked: bakedChunks.length,
      views: chunkViews.length, spare: spareChunkViews.length,
      bakePending: chunkBakeJobs.pendingId !== null,
      cap: maxChunks,
      };
    },
    /** CAPTURE SEAM (M2 task 5): spawn one extra REGISTRY character in the
     *  player's current room through THE SAME spawnEnemy path as boot (so
     *  deferred gpu opts, router registrations and kit/prop wiring all flow
     *  identically), and return its actor id. Task-6's "all registered
     *  characters rendered once" gate drives this; ordinary play never
     *  calls it. Face/kit/prop evidence needs a live goblin/clown, which the
     *  room roster (zombies + the one soldier) does not carry. */
    /** THE REGISTRY, live (task-6 gate): the roster the gate must cover is
     *  character-registry.ts's own keys, read through the page so a driver
     *  cannot silently drift from the registry the game actually spawns
     *  (the zombie-only blind spot this gate exists to kill was exactly
     *  such a drift). Read-only, JSON-serialisable, order = registry order. */
    characterNames: (): string[] => [...characterNames()],
    spawnDebugCharacter: (name: string, start?: Vec3) => {
      const room = ROOMS.find(r => r.id === playerRoomId()) ?? ROOMS[0]!;
      const starts = spawnPoints(room);
      // The game's own debug seam keeps the modulo default; crowdGridPoints()
      // callers pass an explicit point (perf 7f).
      const chosen = start ?? starts[actors.filter(a => a.room === room.id).length % starts.length]!;
      const errs: string[] = [];
      const actor = spawnEnemy(name, room, chosen, errs);
      actors.push(actor);
      if (errs.length > 0) console.error(`[sdf-game] spawnDebugCharacter(${name}):`, errs.join(' | ')) ;
      return { id: actor.id, room: room.id, errors: errs };
    },
    /** Spawn `n` copies of `name` into the player's room (bench/crowd seam),
     *  spread on a grid centred on the room's first spawn point so the bench
     *  measures bodies-in-a-room, not N stacked on one spawn (perf 7f).
     *
     *  `opts.region` (distance scene, 2026-09-14) places the grid in an
     *  explicit ground rect instead: centred on the region's centre, clamped
     *  inside it, and with columns chosen to fit the region's span so an
     *  elongated region does not clamp bodies into collisions. The room's
     *  spawn point / bounds remain the default when `region` is omitted.
     *
     *  `ring` is accepted for the seam but the measured layout is the grid.
     *  Stops at the first failure; returns how many landed and where. */
    spawnCrowd: (
      name: string, n: number,
      opts?: { spacing?: number; ring?: boolean; region?: FloorRect },
    ) => {
      const room = ROOMS.find(r => r.id === playerRoomId()) ?? ROOMS[0]!;
      const spacing = opts?.spacing ?? 1.2;
      let p0: Vec3;
      let floor: FloorRect;
      let gridOpts: { centre: [number, number]; inset: number } | undefined;
      if (opts?.region) {
        const r = opts.region;
        const cxs = (r.minX + r.maxX) / 2;
        const czs = (r.minZ + r.maxZ) / 2;
        p0 = [cxs, 0, czs];
        floor = r;
        gridOpts = { centre: [cxs, czs], inset: REGION_INSET_M };
      } else {
        const starts = spawnPoints(room);
        p0 = starts[0] ?? ([0, 0, 0] as Vec3);
        floor = { minX: room.minX, maxX: room.maxX, minZ: room.minZ, maxZ: room.maxZ };
      }
      const points = crowdGridPoints(p0, n, spacing, floor, gridOpts);
      const placed: [number, number, number][] = [];
      let ok = 0;
      for (let i = 0; i < points.length; i++) {
        try {
          (window as any).__sdfGame.spawnDebugCharacter(name, points[i]);
          placed.push([points[i]![0], points[i]![1], points[i]![2]]);
          ok++;
        } catch (e) { console.error('[sdf-game] spawnCrowd stopped at', i, e); break; }
      }
      return { ok, placed };
    },
    /**
     * STARTUP ATTRIBUTION SEAM (2026-09-16). `bootMarks` are main()'s phase
     * marks (performance.now()), `warmDone` the warm-up's own sub-phase record,
     * `gpuDiagnostics` the device-loss / uncaptured-error channel, and
     * `loopRunning` the current rAF state (so a caller can prove the warm did
     * not restart a loop it had deliberately paused).
     */
    bootMarks: () => bootMarks.slice(),
    warmDone: () => (window as unknown as Record<string, unknown>).__warmDone ?? null,
    /** Re-run the warm-up on demand. The startup probe uses this to prove the
     *  loop-restore contract: pause the loop, call rewarm(), assert it is still
     *  paused. Warm steps are cache hits after boot, so this is cheap. */
    rewarm: () => warmPipelines(),
    gpuDiagnostics: () => handle.gpuDiagnostics,
    loopRunning: () => handle.loopRunning,
    /** Which gib renderer boot selected and whether the carve library built. */
    gibRenderer: () => ({
      mode: gibRenderMode,
      carvedLibraryBuilt: carvedLibrary !== null,
      carvedBuildMs,
      carveCells: gibCarveCells,
      /** Task 2: the offline-asset arm's own state + census. */
      assetArmed: gibAssetArmed(),
      assets: {
        zombie: gibAssetRuntime.archetypeState('zombie'),
        soldier: gibAssetRuntime.archetypeState('soldier'),
      },
      assetStats: gibAssetRuntime.countersSnapshot(),
    }),
    uptime: () => (performance.now() - bootTime) / 1000,
    get frames() { return frameCount; },
    /** Where a view-model hangs (child of the camera). */
    viewModelAnchor,
    rooms: ROOMS.map(r => ({
      id: r.id, name: r.name, zombies: r.zombies,
      bounds: { minX: r.minX, maxX: r.maxX, minZ: r.minZ, maxZ: r.maxZ },
    })),
    tunnels: TUNNELS.map(t => t.name),
    furniture: FURNITURE,
    /** Accent lights per room — capture/measurement seam (pair-shot framing). */
    accents: ROOMS.flatMap(r => r.accents.map(a => ({ room: r.id, ...a }))),
  };
  if (import.meta.env.DEV && new URLSearchParams(location.search).has('normal-playtest')) {
    const { installNormalPlaytest } = await import('./normal-gradient-playtest');
    const api = (window as unknown as { __sdfGame: Parameters<typeof installNormalPlaytest>[0] }).__sdfGame;
    const disposePlaytest = installNormalPlaytest(api);
    import.meta.hot?.dispose(disposePlaytest);
  }
  mark('main-end');
}

main().catch((err) => {
  const el = document.getElementById('errors');
  const msg = `FAILED: ${err instanceof Error ? err.message : String(err)}`;
  if (el) el.textContent = msg;
  const loaderStatus = document.getElementById('loader-status');
  if (loaderStatus) loaderStatus.textContent = 'FAILED — see console';
  console.error('[sdf-game] bootstrap failed', err);
});
