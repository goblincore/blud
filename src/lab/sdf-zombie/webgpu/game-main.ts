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
import { createSdfLayer, SDF_LAYER, CONE_LAYER, OCCLUDER_LAYER, SHADOW_HULL_LAYER, SHELL_LAYER, SHELL_EXIT_LAYER, DEPTH_PREPASS_LAYER, FIELD_MESH_LAYER, REFINE_LAYER, PRECOMPILE_COLD_PASS_TIMEOUT_MS } from './sdf-layer';
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
import { makeGameContext } from './game-context';
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
import { getPipelineCensus, getPipelineLog, getPipelineShaderSource, setPipelineLogEnabled } from './pipeline-log';
import { coordinateWarmGate, createLoopController, type WarmOutcome } from './warm-gate';
import { createWarmBackgroundTracker } from './warm-background';
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
import {
  createShutterGameLayer, readShutterGameSettings, type ShutterGameLayer,
} from './shutter-game-layer';
import {
  createGibShutterLayer, readGibShutterSettings,
  type GibShutterLayer, type GibBlurSubject,
} from './gib-shutter-layer';
import { createShutterPanel, shutterPanelHost, type ShutterPanel } from './shutter-panel';
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
import { CHUNK_TUNING, chunkSettled, makeChunk, stepChunk, type ChunkBox } from '../gib-chunks';
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
import {
  checkGibAssetDeformBounds, gibAssetDeformBoundsOk, gibAssetRowsFromPrims,
} from './gib-asset-deform';
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
import { CHUNK_DETAIL_GAIN, MAX_CHUNK_BUDGET, applyDynamiteTuning, dynamiteTuningValues } from './game-dynamite-tuning';
import { createDebugProbeSeams } from './game-seams-debug-probe';
import { createBenchSeams } from './game-seams-bench';
import { createRenderDiagSeams } from './game-seams-render-diag';
import { createShellDiagSeams } from './game-seams-shell-diag';
import { createSpawnGooSeams } from './game-seams-spawn-goo';
import { createWorldSeams } from './game-seams-world';
import { createRenderSeams } from './game-seams-render';
import { createBootSeams } from './game-seams-boot';
import { createWeaponPlayerSeams } from './game-seams-weapon-player';
import { createFxSeams } from './game-seams-fx';
// ——— IN-GAME BURNING + SLOT 3 FLARE (2026-09-18 flare test harness). Both live
// beside this file; main() holds only their call sites.
import { createGameBurning } from './game-burning';
import { createFlareHarness } from './game-flare';
import { createMiscSeams } from './game-seams-misc';
import { applyBoneCullMode, applyBoneMesh, copyUniformValues, fisheyeReport, gibBlurSubjects, median, updateUpscaleAbLabel } from './game-render-leaves';
import { applyWoundRamp, faceFor, scaleBurstVisual, spillVerdict, woundTuningNow } from './game-vfx-leaves';
import { applyChunkKindLook, ensureGibAssets, gibAssetArchetypeOf, gibAssetArmed, newBlastProfile, primsLongAxis, reacquireHeldProp, retireActor, scheduleGib, stepPendingGibImpulses } from './game-gibs-leaves';
import { breechInRig, locatorInView, newTracerQuad, setQuadMatrix, startReload, stepBursts, viewToRig } from './game-weapon-leaves';
import { stampLevelProbeRoom } from './game-world-leaves';
import { applyBoneCull, restampLevelProbes } from './game-render-leaves2';
import { spawnAssetGibPiece, spawnSpriteGibPiece } from './game-gibs-leaves2';
import { gateRefineTwin, woundStreamId } from './game-world-leaves2';
import { describeRecordedWound, neutralInput, placeFromDemo, readInputFrame, updateDemoHud } from './game-demo-leaves';
import { applyMouseDelta } from './game-player-leaves';
import { setLoader } from './game-boot-leaves';
import { registerBleed, stepGutRopes } from './game-world-leaves3';
import { demoRecordStop } from './game-demo-leaves2';
import { createLeftoverSeams } from './game-seams-leftover';
import { createFireSeams } from './game-seams-fire';
import { createSkeletonSeams } from './game-seams-skeleton';
import { createDynamiteSeams } from './game-seams-dynamite';
import { createMarchDebugSeams } from './game-seams-march-debug';
import { ensureImpactSplashLayer } from './game-vfx-leaves';
import { laySpriteBench, sizeSdfLayer } from './game-render-leaves';
import { withCtx } from './game-context';
import { crowdTypeFor } from './game-crowd-leaves';
import { pushProbeWeight } from './game-probes-leaves';
import { aimFrustum } from './game-weapon-leaves';
import { takePropForThrow } from './game-dynamite-leaves';
import { bodiesOnScreen, traceSlugHitFrom } from './game-world-leaves';
import { captureTelemetryScene } from './game-telemetry-leaves';
import { demoScenarioOf } from './game-demo-leaves';
import { awaitBakes, registerLitChunkMaterial } from './game-bake-leaves';
import { ROOM_ID_BY_NAME, playerRoomId } from './game-player-leaves';
import { _bd, _bfA, _bfB, _muzA, _muzB, _o, boreFrameInRig, muzzleWorld, viewDirToRig } from './game-weapon-leaves';
import { BUNDLE_CEIL_M, ceilingAt } from './game-world-leaves';
import { BUNDLE_BODY_RADIUS_M, EXPLOSION_LIGHT, EXPLOSION_LIGHTS, _propPos, bundleHitsBody, explosionLightEnv, igniteExplosionLight, propWorld } from './game-dynamite-leaves';
import { BUNDLE_HOLD, BURST_SLOTS, spawnBurstStandIn, stepWeaponSlots } from './game-weapon-leaves';
import { TRAIL_STREAM_BASE, trailStreamId } from './game-vfx-leaves';
import { CULL_DWELL_MS, updateVisibleActors } from './game-render-leaves';
import { chunkCollidersAt } from './game-world-leaves';
import { applySdfScale } from './game-render-leaves';
import { aimDir } from './game-weapon-leaves';
import { finishChunkBake, spawnGoreShowcase } from './game-bake-leaves';
import { ensureCarvedLibrary } from './game-gibs-leaves';
import { updateHud } from './game-panels-leaves';
import { sceneCensus } from './game-telemetry-leaves';
import { demoRecordStart } from './game-demo-leaves';
import { ADAPTIVE_WINDOW, PROBE_ABORT_FRAMES, tickAdaptive } from './game-render-leaves';
import { applyUpscaleAbMode } from './game-render-leaves';
import { enableTrainedUpscale } from './game-render-leaves';
import { AIM_CONVERGE_M, convergedDir } from './game-weapon-leaves';
import { BEND_L_VIEW, BEND_R_VIEW, SHOULDER_L_VIEW, SHOULDER_R_VIEW, _bendL, _bendR, _sh, aimArms } from './game-weapon-leaves';
import { applyInputEdges } from './game-player-leaves';
import { spawnCarvedPiece } from './game-gibs-leaves';
import { throwBundle } from './game-dynamite-leaves';
import { predictSlugHitNow } from './game-world-leaves';
import { TracerView, hideTracer, newTracerView, placeTracer } from './game-weapon-leaves';
import { MUZZLE_VIEW, fire } from './game-weapon-leaves';
import { BakedChunk, ChunkTemplate, freeBaked } from './game-bake-leaves';
import { GIB_ATLAS_URL, GIB_SHEET_URL, ensureGibAtlas } from './game-gibs-leaves';
import { applyInputFrame } from './game-player-leaves';
import { MIN_STANDOFF, aimAtNearestSurface } from './game-weapon-leaves';
import { performBenchAction } from './game-weapon-leaves';
import { shellAmpOf } from './game-world-leaves';
import { cancelChunkBake } from './game-bake-leaves';
import { accentRoomsFor, applyHemi, levelSceneLights } from './game-lighting-leaves';
import { refreshLevelLights } from './game-lighting-leaves';
import { GIB_TIER_FLOOR, gibAllowance, gibBudget, gibDebit, gibReserved } from './game-gibs-leaves';
import { createWeaponAimSeams } from './game-seams-weapon-aim';
import { createRenderQualitySeams } from './game-seams-render-quality';
import { createDemoStepSeams } from './game-seams-demo-step';
import { createLightingProbeSeams } from './game-seams-lighting-probes';
import { createGibsBakeSeams } from './game-seams-gibs-bake';

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
  // Every main()-scope binding below lives on this container (see
  // game-context.ts). Declarations were rewritten IN PLACE by
  // scripts/game-context-codemod.ts — no line moved, so initialization
  // order is exactly what it was.
  const ctx = makeGameContext();
  // BOOT PHASE MARKS (startup attribution, 2026-09-16). main() is one long
  // synchronous block after its first awaits — rAF cannot run, timers cannot
  // fire, and every console line lands at the same wall clock — so phase
  // boundaries cannot be inferred from the log. Two array pushes per phase;
  // read via __sdfGame.bootMarks() or window.__bootMarks. `t` is
  // performance.now(), comparable to performance.timeOrigin-relative CDP
  // timestamps and to the pipeline log's frame windows.
  ctx.boot.marks = [];
  const mark = (n: string) => { ctx.boot.marks.push({ n, t: Math.round(performance.now()) }); };
  mark('main-start');
  (window as unknown as Record<string, unknown>).__bootMarks = ctx.boot.marks;
  ctx.vfx.boundedWoundPreview = import.meta.env.DEV && new URLSearchParams(location.search).has('bounded-wounds');
  ctx.boot.mount = document.getElementById('app');
  if (!ctx.boot.mount) throw new Error('#app not found');
  ctx.boot.resKey = resRungFromUrl(ctx.vfx.boundedWoundPreview ? '640' : DEFAULT_RES);
  ctx.boot.handle = await createLabRenderer(ctx.boot.mount, RES_RUNGS[ctx.boot.resKey]);
  // Per-pass GPU timestamps (gpu-pass-timing.ts). Wraps the backend's uid
  // builder once; costs a string concat per pass. Read through
  // __sdfGame.bench({ mode: 'passes' }) or __sdfGame.passTimings().
  ctx.boot.passTiming = installPassTiming(ctx.boot.handle.renderer);
  const { scene, camera } = ctx.boot.handle;
  mark('renderer-ready');

  // LOOP INTENT vs WARM SUSPENSION (warm-gate.ts, corrected 2026-09-16). The
  // old warm snapshotted loopRunning at its START and reapplied that in the
  // finally, so a rig/bench that paused (or resumed) the loop WHILE the warm
  // was in flight had its intent overwritten. Every external request now goes
  // through the controller's intent; the warm only suspends and releases.
  ctx.boot.rawSetLoopRunning = ctx.boot.handle.setLoopRunning.bind(ctx.boot.handle);
  ctx.boot.loopControl = createLoopController((on) => ctx.boot.rawSetLoopRunning(on), ctx.boot.handle.loopRunning);
  ctx.boot.handle.setLoopRunning = (on: boolean) => ctx.boot.loopControl.set(on);

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
  ctx.boot.seedSearch = new URLSearchParams(location.search);
  ctx.demo.seed = parseIntParam(ctx.boot.seedSearch.get('seed'), { min: 0, max: 0x7fffffff })
    ?? (Date.now() & 0x7fffffff);
  setRngSeed(ctx.demo.seed);
  console.info(`[sdf-game] demo seed ${ctx.demo.seed}${ctx.boot.seedSearch.has('seed') ? ' (?seed=)' : ' (random)'}`);

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
  ctx.boot.loaderEl = document.getElementById('loader');
  ctx.boot.loaderDisabled = new URLSearchParams(location.search).get('loader') === '0';
  if (ctx.boot.loaderDisabled && ctx.boot.loaderEl) ctx.boot.loaderEl.style.display = 'none';
  setLoader(ctx, 'webgpu ready');
  ctx.boot.loaderEl?.addEventListener('click', () => {
    const canvas = document.querySelector('#app canvas');
    if (canvas) canvas.requestPointerLock();
    ctx.boot.loaderEl?.classList.add('loader-hidden');
  });
  ctx.telemetry.telemetry = new GameTelemetry();

  // RENDER MODE — parsed ONCE at boot (hybrid deferred M2 task 5). Absent or
  // 'legacy' boots the legacy path unchanged; 'deferred' opts into the
  // deferred coordinator below. An explicit deferred request on a backend
  // that is not really WebGPU (WebGPURenderer silently falls back to WebGL;
  // handle.backend is the honest signal) is FATAL and visible on the page —
  // silently benchmarking legacy while claiming deferred is the one failure
  // this seam must never produce.
  ctx.boot.mode = resolveGameBootMode(new URLSearchParams(location.search).get('renderer'), ctx.boot.handle.backend);
  if (ctx.boot.mode.warning) console.warn(`[sdf-game] ${ctx.boot.mode.warning}`);
  if (ctx.boot.mode.fatal) throw new Error(ctx.boot.mode.fatal);
  ctx.boot.deferredMode = ctx.boot.mode.mode === 'deferred';

  // BACKGROUND-COMPILE POLICY (defer-compile task, 2026-09-19). A cold boot was
  // four ~48 s serialized march compiles behind the loader (body, crowd,
  // chunk-MRT, chunk-shutter). Only body + level + gun + post + fire are needed
  // for frame 1, so in the LEGACY route the crowd and gib/chunk programs are
  // compiled AFTER `ready`, and until each is READY its consumer degrades —
  // `gibDraw()` skips the pieces (they still simulate), `crowdPath()` keeps the
  // crowd VISIBLE through the already-compiled per-body path. The DEFERRED
  // route keeps the old behind-the-loader warm: its G-buffer router draws the
  // crowd/chunk meshes directly, so the setBodies fallback does not exist there.
  ctx.boot.backgroundMode = !ctx.boot.deferredMode;
  ctx.boot.warmBackground = createWarmBackgroundTracker();

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
  ctx.boot.handle.setFrameCap(30);

  // -----------------------------------------------------------------------
  mark('world-start');
  // The world: grey-box meshes from the same layout that feeds collision.
  // -----------------------------------------------------------------------
  ctx.world.colliders = levelColliders();
  // ---- ACTOR VISIBILITY CULL STATE ---------------------------------------
  //
  // EVERY binding updateVisibleActors closes over lives here, above the draw
  // callback that calls it. The function itself is a hoisted declaration;
  // const/let are not. Getting this partly right is worse than not at all: a
  // first pass moved the state but left CULL_DWELL_MS behind, and boot
  // happened to reach `actors` but not the constant before the first frame,
  // so the cull threw on every frame while the picture still looked fine.
  // If you add a binding this function reads, add it HERE.
  ctx.world.actors = [];
  // Declared HERE, above the draw callback that closes over it, not beside
  // updateVisibleActors further down. `function updateVisibleActors` is a
  // hoisted declaration, but const/let are not: with the state declared later,
  // a frame rendering during boot threw "Cannot access 'cullCounts' before
  // initialization" and the cull silently never ran (HUD stuck at bodies
  // 0/15). It was a RACE — more boot work tipped it — which is exactly the
  // kind of bug that hides until something unrelated changes.
  ctx.world.frustum = new THREE.Frustum();
  ctx.world.projScreen = new THREE.Matrix4();
  ctx.world.bodySphere = new THREE.Sphere(new THREE.Vector3(), 1.1);
  ctx.world.lastSeenMs = new Map<number, number>();
  /** SIM FRAME INDEX (determinism stage 1, 2026-09-14). Incremented once at the
   *  top of every `tick(dt)`; the bake swap is pinned to a frame relative to
   *  submit so its landing frame does not depend on WORKER SPEED (see
   *  finishChunkBake). Reads only — the single writer is `tick`. */
  ctx.demo.simFrame = 0;
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
  ctx.demo.hold = false;
  /** The gather dispatch counter at demo entry, so the seed is a function of
   *  frames-since-entry rather than of how long the page happened to boot. */
  ctx.demo.seedBase = 0;
  ctx.render.actorCullEnabled = true;
  /** Run 5b: the distance band the refine twins are drawn in — from
   *  `scripts/lib/upscale-framing.mjs` DISTANCE_M.medium = [1.5, 3.5].
   *  Owner: close bodies are most of the pixels and the least visible gain
   *  (the march already resolves them), far bodies are cheap either way, so
   *  the twin only earns its cost in the middle. Hysteresis keeps a body
   *  walking along the edge from flickering. */
  ctx.render.refineBand = { near: 1.5, far: 3.5, hysteresis: 0.25 };
  /** Run 5b: the twin lighting tail every view should be on — so a LATE SPAWN
   *  does not fall back to the default while the rest of the room is on the
   *  other tail (same idiom as boneCullMode). */
  ctx.render.refineTailWanted = 'slim';
  /** Bodies whose refine twin was drawn this frame (reset each cull pass). */
  ctx.render.refinedBodies = 0;
  ctx.render.visibleActors = [];
  ctx.world.cullCounts = { visible: 0, total: 0 };
  ctx.world.coverage = { screenFrac: 0, nearestM: 0, biggestFrac: 0 };
  ctx.world.sightA = [0, 0, 0];

  ctx.world.encounterNav = createEncounterNavigation(ROOMS, TUNNELS, ctx.world.colliders);
  ctx.world.encounter = createEncounterDirector(ctx.world.encounterNav, ctx.world.colliders);
  ctx.world.encounterHomes = new Map<number, Vec3>();
  ctx.world.surfaces = levelSurfaces();
  ctx.world.levelGroup = new THREE.Group();
  ctx.world.levelGroup.name = 'ring-level';
  ctx.world.stoneSet = dungeonMaterialSet();
  const stoneFor = (axis: 0 | 1 | 2, facing: 1 | -1) =>
    axis !== 1 ? ctx.world.stoneSet.wall
      : facing > 0 ? ctx.world.stoneSet.floor
        : ctx.world.stoneSet.perimeterAccent;
  for (const p of ctx.world.surfaces.planes) {
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
    ctx.world.levelGroup.add(mesh);
  }
  for (const b of ctx.world.surfaces.boxes) {
    const geo = new THREE.BoxGeometry(
      b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]);
    const mesh = new THREE.Mesh(geo, (ctx.world.stoneSet.coverLow as THREE.MeshStandardMaterial).clone());
    (mesh.material as THREE.MeshStandardMaterial).color =
      new THREE.Color(b.color[0], b.color[1], b.color[2]);
    mesh.position.set(
      (b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2);
    ctx.world.levelGroup.add(mesh);
  }
  scene.add(ctx.world.levelGroup);

  // CEILING FILL. The sun points down; ceilings (and north-south walls in
  // shadow) have normals pointing away from it, so with only a dim ambient
  // they rendered BLACK — read by the owner as "the same failure pointing
  // up" as the missing walls. A hemisphere light pays normal-dependent fill.
  // This touches ONLY these MeshStandardMaterials — the SDF bodies carry
  // their own lighting uniforms (enclosure bounce), so probe/bounce tuning
  // is untouched.
  ctx.lighting.hemi = new THREE.HemisphereLight(0xa39c93, 0x8f8880, 0.8);
  scene.add(ctx.lighting.hemi);
  // LEVEL PROBES (lighting P3/P4 step 3): the walls, floor and ceiling take
  // their indirect diffuse from the room's probe grid + the GPU gather's
  // dynamic layer (probe-lighting-node.ts, wired below the gather). The
  // hemisphere is the fill that replaces, so it fades as the weight rises —
  // otherwise the level double-lights on the flip. ?levelprobes=0 pins the
  // hemisphere at the rig's full intensity and the nodes at zero: the
  // pre-probe look. Gain -1 = each room's matched level (levelMatchedGain).
  ctx.lighting.levelProbesParam = new URLSearchParams(location.search).get('levelprobes');
  ctx.lighting.levelProbeWeight = ctx.lighting.levelProbesParam === '0' || ctx.lighting.levelProbesParam === 'off' ? 0 : 1;
  ctx.lighting.levelProbeGain = -1;
  ctx.lighting.hemiBase = ctx.lighting.hemi.intensity;
  // Declared HERE, above applyRig (which restamps them): const/let are not
  // hoisted, and the first applyRig runs long before the gather site below
  // populates these — the cullCounts race, again.
  ctx.lighting.levelProbeNodes = new Map<number, ProbeLightingNode>();
  ctx.world.levelLightLists = new Map<number, THREE.LightsNode>();
  ctx.world.levelNodeMaterials = [];

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
  ctx.lighting.hemi.color.setHex(0xf5f3f0);   // sky term: near-white
  ctx.lighting.hemi.groundColor.setHex(0x8f8c86); // floor bounce: mid grey
  ctx.lighting.hemi.intensity = 0.75;

  // COLOURED ACCENTS as real mesh-side lights, straight from the level data
  // — the same entries litWallAlbedo folded into the bounce albedos, which
  // is what keeps walls and zombies agreeing about the light. Five point
  // lights total (one per room + room3's second): few, on purpose — every
  // real-time light here spends frame time on WALLS, not on what the owner
  // is watching.
  ctx.world.accentGroup = new THREE.Group();
  ctx.world.accentGroup.name = 'accent-lights';
  ctx.vfx.explosionLightPool = [];
  for (let i = 0; i < EXPLOSION_LIGHTS; i++) {
    const pl = new THREE.PointLight(0xffb060, 0, 0, 2);
    pl.visible = true;
    ctx.world.accentGroup.add(pl);
    ctx.vfx.explosionLightPool.push(pl);
  }
  ctx.lighting.flickerLights = [];
  for (const r of ROOMS) {
    for (const a of r.accents) {
      const pl = new THREE.PointLight(
        new THREE.Color(a.color[0], a.color[1], a.color[2]), a.power);
      pl.position.set(a.pos[0], a.pos[1], a.pos[2]);
      // Tagged with its room so the level's per-room light lists can drop
      // the OTHER rooms' accents (see levelSceneLights below).
      pl.userData.accentRoom = r.id;
      ctx.world.accentGroup.add(pl);
      ctx.lighting.flickerLights.push({ light: pl, base: a.power, phase: a.pos[0] * 3.1 + a.pos[2] * 1.7 });

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
      ctx.world.accentGroup.add(bowl);
    }
  }
  scene.add(ctx.world.accentGroup);

  // ---------------------------------------------------------------------
  mark('dungeon-start');
  // DUNGEON RIG. Off-state parity matters: with dungeon disabled the gallery
  // must render exactly as before, so the rig is applied, not hard-coded.
  // ---------------------------------------------------------------------
  ctx.lighting.dungeonOn = true;
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
  ctx.vfx.beamTuning = { gain: 4, shoulder: 0.35, keyFloor: 0 };
  // ?shadowmap=1024 for the old maps; 512 ships (SHADOW_MAP_SIZE). Both
  // maps ride it: the twin only feeds the march's soft level shadow.
  ctx.boot.shadowMapParam = Number(new URLSearchParams(location.search).get('shadowmap'));
  ctx.lighting.flashlight = createFlashlight(DUNGEON_RIG, ctx.boot.shadowMapParam > 0 ? { shadowMapSize: ctx.boot.shadowMapParam } : {});
  // BOOT-TIME shadow ablation (?spotshadow=0), for the dungeon bench legs.
  // castShadow has to be decided BEFORE the first frame: toggling it live
  // crashes three r185 WebGPU (ShadowNode.updateShadow dereferences the
  // disposed map's depthTexture — see the __dungeon note below), and
  // shadow.intensity=0 cannot stand in — it only zeroes the SAMPLING term;
  // the 1024² map still renders every frame, so it would measure the wrong
  // split. At boot, AnalyticLightNode.setup never builds the shadow node at
  // all, so the leg is a true zero-cost ablation.
  ctx.lighting.flashlight.spot.castShadow = new URLSearchParams(location.search).get('spotshadow') !== '0';
  scene.add(ctx.lighting.flashlight.spot);
  scene.add(ctx.lighting.flashlight.spot.target);
  // The level-shadow twin (perf round 2 task 7) rides every shadow boot
  // decision the spot makes: ?spotshadow=0 kills BOTH maps (a true ablation
  // of the shadow cost), and the gallery rig shows neither.
  ctx.lighting.flashlight.levelShadow.castShadow = ctx.lighting.flashlight.spot.castShadow;
  scene.add(ctx.lighting.flashlight.levelShadow);
  scene.add(ctx.lighting.flashlight.levelShadow.target);

  // DEFERRED MODE: three's own shadow traversal is OFF. The deferred shadow
  // maps (deferred-shadows.ts) are explicit raster passes that never consult
  // renderer.shadowMap, and every opaque surface is an unlit G-buffer
  // producer — three's per-light shadow maps would be 1024² passes of pure
  // waste per renderer.render call. Boot-time decision: three r185 WebGPU
  // crashes when castShadow is toggled after maps were built, so this ships
  // as a boot property like the legacy ?spotshadow=0 ablation above.
  ctx.boot.handle.renderer.shadowMap.enabled = !ctx.boot.deferredMode;
  // PCF, not PCFSoft: the soft variant's kernel is FIXED and ignores
  // shadow.radius, which is the only edge-hardness knob the shadow map has
  // (owner ask, 2026-09-09). The WebGPU PCF filter is a 5-tap IGN-rotated
  // Vogel disk whose radius is a live reference uniform — tune at runtime
  // via __sdfGame.setShadowRadius (default SHADOW_RADIUS in
  // dungeon-lighting.ts). Changing the type needs a reload (shader
  // recompile); changing the radius after that does not.
  ctx.boot.handle.renderer.shadowMap.type = THREE.PCFShadowMap;
  ctx.world.levelGroup.traverse((o) => {
    if (o instanceof THREE.Mesh) { o.castShadow = true; o.receiveShadow = true; }
  });

  function applyRig(rig: AmbientRig) {
    ctx.lighting.hemiBase = rig.hemiIntensity;
    applyHemi(ctx);
    ctx.lighting.hemi.color.setRGB(...rig.hemiSky);
    ctx.lighting.hemi.groundColor.setRGB(...rig.hemiGround);
    restampLevelProbes(ctx);
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
    ctx.boot.handle.renderer.setClearColor(new THREE.Color(...rig.fogColor));
    ctx.lighting.flashlight.spot.visible = rig === DUNGEON_RIG;
    ctx.lighting.flashlight.levelShadow.visible = rig === DUNGEON_RIG;
  }
  applyRig(DUNGEON_RIG);

  (globalThis as Record<string, unknown>).__dungeon = {
    setDungeon(on: boolean) { ctx.lighting.dungeonOn = on; applyRig(on ? DUNGEON_RIG : GALLERY_RIG); },
    get on() { return ctx.lighting.dungeonOn; },
    /** The weapon light itself, for runtime A/Bs (shadow.intensity 0/1 is the
     *  shadow kill switch — do NOT toggle spot.castShadow live, three r185
     *  WebGPU crashes rebuilding a disposed shadow map). */
    spot: ctx.lighting.flashlight.spot,
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
      if (gain !== undefined) ctx.vfx.beamTuning.gain = gain;
      if (shoulder !== undefined) ctx.vfx.beamTuning.shoulder = shoulder;
      if (keyFloor !== undefined) ctx.vfx.beamTuning.keyFloor = keyFloor;
      return { ...ctx.vfx.beamTuning };
    },
    get beam() { return { ...ctx.vfx.beamTuning }; },
  };

  // -----------------------------------------------------------------------
  mark('drawchain-start');
  // The draw chain, exactly as the bench stands it up.
  // -----------------------------------------------------------------------
  ctx.render.postAa = createPostAa(ctx.boot.handle.renderer);
  // The blast refraction reprojects its live bands from WORLD positions every
  // frame, so it needs the camera's current view-projection. Handing it the
  // persistent camera once is enough — the matrices update in place.
  ctx.render.postAa.setBlastDistortCamera(camera);
  // VHS ships ON at 'blud' (owner, 2026-09-09) — the preset the owner swept in
  // vhs-panel.ts, replacing the club-mutant 'soft' this shipped at first.
  // ?vhs=blud|soft|balanced|chaotic picks another; ?vhs=off disables it, which is
  // also what the parity/bench drivers should pass — the all-off path is
  // untouched only when VHS is null.
  ctx.boot.vhsParam = new URLSearchParams(location.search).get('vhs');
  if (ctx.boot.vhsParam === 'blud' || ctx.boot.vhsParam === 'soft' || ctx.boot.vhsParam === 'balanced'
    || ctx.boot.vhsParam === 'chaotic') {
    ctx.render.postAa.setVhs(ctx.boot.vhsParam);
  } else if (ctx.boot.vhsParam !== 'off' && ctx.boot.vhsParam !== 'null') {
    ctx.render.postAa.setVhs('blud');
  }
  ctx.vfx.characterEffects = createCharacterEffects(ctx.boot.handle.renderer);
  // Lazy: allocates nothing until the first ignite (game-burning.ts).
  ctx.vfx.burning = createGameBurning(ctx);
  // THE MESH-SIDE FIRE LIGHTS. Built ONCE here, before the warm-up's drawOnce,
  // so the lit materials compile with the pool present (3 explosion + 4 fire
  // point lights) and the FIRST IGNITE does not re-key the LightsNode — the
  // 180–230 ms recompile stall the explosion pool's comment measured. The lights
  // are permanently visible; updateFireLightPool drives intensity (0 when idle).
  ctx.vfx.burning.createFireLightPool(ctx.world.accentGroup);
  // GPU PROBE GATHER (P3/P4 dynamic layer). Declared here, ahead of the draw
  // callback, so the frame can test it without a temporal dead zone; created
  // next to the room probes once the level exists. ?probedyn=0 zeroes both
  // gains — the storage read is skipped and the march is bit-identical.
  ctx.probes.gather = null;
  // TRACERS as gathered lights: the pellet lists are declared AFTER this draw
  // callback and after an await (the gun GLTF load), so a frame CAN render in
  // between — the same boot race the `cullCounts` comment describes. The
  // gather reads this provider, never the consts directly; it is assigned
  // right after `soldierPellets` exists.
  ctx.lighting.liveTracers = null;
  ctx.probes.dynParam = new URLSearchParams(location.search).get('probedyn');
  ctx.probes.dynGain = ctx.probes.dynParam === '0' || ctx.probes.dynParam === 'off' ? 0 : 0.15;
  ctx.probes.visStrength = ctx.probes.dynParam === '0' || ctx.probes.dynParam === 'off' ? 0 : 1;
  // ?proberate=1 restores every-frame gathers (see probeGatherRate above).
  // ALL THREE of these go through parseIntParam now: it reads the RAW string, so
  // an absent parameter yields null (the shipped default) rather than 0. Doing
  // it by hand is what shipped the zeroed-dynamic-layer regression — see
  // boot-params.ts for the whole story and boot-params.test.ts for the gate.
  ctx.boot.search = new URLSearchParams(location.search);
  ctx.probes.gatherRateBoot = parseIntParam(ctx.boot.search.get('proberate'), { min: 1, max: 4 });
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
  ctx.probes.raysBoot = parseIntParam(ctx.boot.search.get('dynrays'), { min: 0, max: 64 });
  ctx.probes.lightsBoot = parseIntParam(ctx.boot.search.get('dynlights'), { min: 0, max: 1024 });
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
  ctx.probes.blendBoot = parseFloatParam(ctx.boot.search.get('dynblend'), { min: 0, max: 1 });
  ctx.probes.fallBoot = parseFloatParam(ctx.boot.search.get('dynfall'), { min: 0, max: 1 });
  // FLASH BOOST. The muzzle light's envelope has already fallen to ~a third
  // of peak by the frame the gather packs it (one frame of lag), and it
  // lives 0.14 s; at 1x the bounce was a quarter of the key on a body next
  // to the muzzle. Flash sources only — the beam stays physical.
  ctx.probes.flashBoost = 4;
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
  ctx.lighting.tracerLightParam = new URLSearchParams(location.search).get('tracerlight');
  ctx.lighting.tracerLightGain = ctx.lighting.tracerLightParam === '0' || ctx.lighting.tracerLightParam === 'off' ? 0 : 2.0;
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
  ctx.lighting.tracerLightSlots = parseIntParam(
    new URLSearchParams(location.search).get('tracerlightslots'), { min: 0, max: 8 },
  ) ?? 2;
  // DIRECT flash on bodies (march slot bodyFlash): intensity multiplier on
  // the flash lights before the shader's I*cos/d^2. 0 = off, bit-identical.
  ctx.lighting.bodyFlashGain = 0.06;
  /** Seconds since the last shot; >= FLASH.windowSec means no flash.
   *
   *  DECLARED HERE, not beside the weapon state it belongs to (it used to sit
   *  ~2400 lines below, next to `gunReady`): the render callback set by
   *  `handle.setDrawFn` reads it — `flashEnvelope(flashAge)` in the legacy
   *  lighting branch, and `playerFlashLightIntensity()` just below — and the
   *  loop is already armed while boot is still awaiting the upscale model, so
   *  the later declaration threw `Cannot access 'flashAge' before
   *  initialization` on every frame until boot passed it. */
  ctx.weapon.flashAge = Infinity;
  /** The player's muzzle flash as a LIGHT SOURCE for bodies and probes: a
   *  0.14 s burst shaped like the soldiers' (55 at the shot, (1-t)^2), so it
   *  survives the gather's one-frame lag. The sprite keeps its own envelope. */
  const playerFlashLightIntensity = () => (ctx.weapon.flashAge >= 0 && ctx.weapon.flashAge < 0.14 ? 55 * (1 - ctx.weapon.flashAge / 0.14) ** 2 : 0);
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
  ctx.probes.frame = 0;
  ctx.probes.gatherErrors = 0;
  // GATHER AMORTIZATION (spike hunt, 2026-09-10): the dynamic gather is a
  // FIXED ~5.7 ms compute every frame — the largest standing per-frame GPU
  // cost the lighting batch added — and during fire bursts its measured
  // time balloons to ~27 ms under submission congestion. The kernel already
  // blends across dispatches (blend 0.6 rise, 0.12 fall), so dispatching
  // every OTHER frame halves that cost for a one-frame lag on indirect
  // radiance the layer smooths anyway. 1 = every frame (the old behaviour;
  // setProbeGatherRate / ?proberate flip it live).
  ctx.probes.optimized = ctx.boot.search.get('probeopt') !== '0';
  ctx.probes.gatherRate = 2;
  if (ctx.probes.gatherRateBoot !== null) ctx.probes.gatherRate = ctx.probes.gatherRateBoot;
  ctx.probes.gatherTick = 0;
  ctx.probes.pendingGather = null;
  // The gather's capsule source: this room's actors' posed bones, packed
  // with the bone instancer's OWN packer into a private array. Not the
  // instancer's array — that is only filled in bone-mesh mode, and in the
  // shipped mode (bones marched in the field) its count is zero.
  ctx.probes.capsuleArrays = boneInstanceArrays(PROBE_MAX_BONE_INSTANCES);
  ctx.probes.gateLogs = 0;
  ctx.probes.lastGates = null;
  ctx.probes.lastCapsules = 0;
  ctx.probes.lastLights = 0;
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
  ctx.player.centerFovDeg = FISHEYE_DEFAULTS.centerFovDeg;
  camera.fov = FISHEYE_DEFAULTS.renderFovDeg;
  camera.updateProjectionMatrix();
  ctx.render.postAa.setLens(camera.fov, ctx.player.centerFovDeg);
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
  ctx.boot.graphics =
    new URLSearchParams(location.search).get('graphics') === 'high' ? 'high' : 'default';
  ctx.boot.graphicsHighUpscale = ctx.boot.graphics === 'high'
    && new URLSearchParams(location.search).get('upscale') !== '0';
  ctx.render.refineWanted = (() => {
    const q = new URLSearchParams(location.search);
    if (q.get('refine') === '1') return true;
    if (q.get('refine') === '0') return false;
    if (ctx.boot.graphicsHighUpscale) return true;
    return /headr(-|$)/.test(q.get('upscalemodel') ?? '');
  })();
  ctx.boot.marchNormalsWanted = ctx.render.refineWanted || (() => {
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
      if (Number.isFinite(n) && Number.isFinite(f) && f > n && n >= 0) { ctx.render.refineBand.near = n; ctx.render.refineBand.far = f; }
    }
  }
  ctx.render.sdfLayer = createSdfLayer(ctx.boot.handle.renderer, { marchNormals: ctx.boot.marchNormalsWanted, refine: ctx.render.refineWanted });
  if (ctx.render.refineWanted) ctx.render.sdfLayer.setRefine(true);
  ctx.render.postAa.addSink(ctx.render.sdfLayer);

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
  ctx.boot.sscsParam = new URLSearchParams(location.search).get('sscs');
  ctx.boot.sscsEnabled = ctx.boot.sscsParam === 'on' && !ctx.boot.deferredMode;
  if (ctx.boot.sscsEnabled) {
    ctx.render.postAa.setSscsFleshTex(ctx.render.sdfLayer.marchTarget.texture);
    ctx.render.postAa.setSscs(true);
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
  ctx.weapon.muzzleLight = null;
  ctx.boot.spotShadowParam = new URLSearchParams(location.search).get('spotshadow');
  ctx.boot.deferredApi = ctx.boot.deferredMode
    ? createGameDeferredRenderer({
      renderer: ctx.boot.handle.renderer,
      scene,
      lights: () => {
        const candidates: GameLightCandidate[] = [
          { id: 'flashlight', role: 'flashlight', light: ctx.lighting.flashlight.spot },
        ];
        if (ctx.weapon.muzzleLight) candidates.push({ id: 'muzzle', role: 'muzzle', light: ctx.weapon.muzzleLight });
        ctx.lighting.flickerLights.forEach((f, i) =>
          candidates.push({ id: `fire-${String(i).padStart(2, '0')}`, role: 'practical', light: f.light }));
        return candidates;
      },
      environment: () => deferredEnvironmentFromRig(ctx.lighting.dungeonOn ? DUNGEON_RIG : GALLERY_RIG),
      // M2 task 5: the flashlight slot's march-key response for deferred
      // flesh, read LIVE from beamTuning — the same gain/shoulder the legacy
      // march replays per frame, so setBeamTuning moves BOTH paths together
      // and the constants cannot drift apart. knee = legacyFlashKnee(
      // shoulder): the march shader's own two-step conversion — shoulder 0
      // is compression OFF (knee 0), otherwise clamp(1 - shoulder, .05, .99)
      // — so every legal panel position packs (the raw `1 - shoulder` map
      // threw on shoulder 0 and .05 every frame). gain 0 is a PRESENT zero
      // (the beam leaves flesh) once packed, never an absent override.
      flashKey: () => ({ gain: ctx.vfx.beamTuning.gain, knee: legacyFlashKnee(ctx.vfx.beamTuning.shoulder) }),
      // M2 task 7 material-parity repair: the game's march materials keep
      // lodCfg.y at its 1 default (the legacy display decode is part of the
      // authored look — only lab-main ever flips it), so the deferred flesh
      // response gates ON here. With it the light pass shades packed flesh
      // with the authored spec/Fresnel/wet/AO response and applies the same
      // display decode; without it, deferred flesh keeps the flat M1
      // bounded approximation the owner rejected.
      fleshDisplay: () => true,
      renderEffects: (camera) => ctx.vfx.characterEffects.render(camera),
      flashlight: ctx.lighting.flashlight.spot,
      width: ctx.render.postAa.contentSize.width,
      height: ctx.render.postAa.contentSize.height,
    })
    : null;
  if (ctx.boot.deferredApi) {
    // Boot ablation (?spotshadow=0): the shadow maps never render. The
    // sampling-only diagnostic toggle lives on __sdfGame below.
    ctx.boot.deferredApi.setShadowGeneration(ctx.boot.spotShadowParam !== '0');
    ctx.render.postAa.addSink(ctx.boot.deferredApi);
    // Static scene routes. Everything ASYNC (kit/prop groups, chunks, baked
    // meshes, bone tubes) registers at its own creation site below.
    ctx.boot.deferredApi.router.register(ctx.world.levelGroup, 'mesh', 'full');
    ctx.boot.deferredApi.router.register(ctx.world.accentGroup, 'mesh', 'full');
  }
  /** SDF pass scale relative to the capped buffer. 1.0 = 1:1 (default).
   *  Runtime-adjustable for the cost table + adaptive ladder. */
  ctx.render.sdfScale = 1.0;
  // Texture round-trip probe rig (texRoundTrip below) — built lazily on the
  // first call, page-lifetime, never rendered by the frame loop. A diagnostic
  // of the 2026-09-04 close-up task; nothing outside texRoundTrip touches it.
  ctx.render.texProbe = null;
  // Declared AHEAD of sizeSdfLayer because that function reads it and runs
  // during init — a `let` further down is a temporal dead zone and the page
  // dies before __sdfGame exists (caught immediately: headless boot found no
  // __sdfGame at all). Assigned once the actors give it a light rig.
  ctx.goo.layer = null;
  ctx.panels.gooPanel = null;
  /** The wound panel (wound-panel.ts). Ships VISIBLE, like the goo panel, but
   *  COLLAPSED (panel-chrome.ts) — only its title bar shows, so it stays
   *  findable without covering the frame the way both panels did fully
   *  expanded (see c6bffc7). Every existing look-capture script
   *  (gallery-look, shadow-ab, the canary) keeps framing the room undisturbed
   *  as a result. __sdfGame.woundPanelCollapsed(false) expands it; that seam
   *  is guarded typeof-style in capture scripts like gooPanel. Not persisted
   *  across reloads — a remembered state would make a capture reproduce
   *  differently machine to machine. */
  ctx.panels.woundPanel = null;
  /** The DYNAMITE / GIB panel (dynamite-panel.ts). Fourth slot (right:782px),
   *  ships VISIBLE but COLLAPSED like the other three. */
  ctx.panels.dynamitePanel = null;
  /** The VHS panel (vhs-panel.ts). Same contract as the other two: ships
   *  VISIBLE but COLLAPSED, at the third slot (right:524px) so all three
   *  title bars sit side by side. The shipped 'blud' preset IS a sweep made
   *  in this panel — the club-mutant three are the far ends of the term space
   *  and none of them was the look; keeping the panel is how the next one
   *  gets found.
   *  __sdfGame.vhsPanel(false) / vhsPanelCollapsed(false) are the seams. */
  ctx.panels.vhsPanel = null;
  ctx.panels.hidden = false;
  // SHIPS ON (owner call, 2026-08-31: "set goo mode to default always to true
  // so i dont have to toggle it on each time"). setGoo(false) stays the kill
  // switch; mode 'depth' vs 'overlay' stays a separate toggle.
  ctx.goo.enabled = true;
  // Smooth reconstruction at the full SDF grid is the game default.
  // Boot flags are read where the goo defaults are applied:
  //   ?goorecon=original  comparison fallback to the old reconstruction
  //   ?gooconnections=1   tapered strands (sheets are a separate opt-in)
  //   ?goosheets=1        experimental stream-grid sheets
  //   ?impactsplash=1     SUPPLEMENTARY procedural impact crown on top of the
  //                       existing slug gout (does not replace it)
  // Live equivalents: __sdfGame.setGooCandidate, __sdfGame.setImpactSplash.
  ctx.goo.reconstruction = 'smooth';
  ctx.goo.connectionsEnabled = false;
  ctx.goo.strandsEnabled = true;
  // SHEETS OFF BY DEFAULT: the stream-local grid removed the world-position
  // hole swimming, but whether a density patch reads as a sheet is still an
  // open visual question. Opt in with ?goosheets=1 / setGooCandidate.
  ctx.goo.sheetsEnabled = false;
  // SUPPLEMENTARY IMPACT SPLASH (reference-directed slug splash, 2026-09-13).
  // A separate procedural crown effect fired ON TOP of the existing slug gout;
  // it mutates no shared table and does not replace the Current slug. OFF by
  // default: opt in with ?impactsplash=1 or __sdfGame.setImpactSplash.
  ctx.panels.impactSplashEnabled = false;
  ctx.panels.impactSplashLayer = null;

  // SELECTIVE SHUTTER BLUR (2026-09-17). Owner accepted the lab look and asked
  // for it in the game at the equivalent of the screenshot's 320° @ 20 fps =
  // 44.44 ms fixed exposure. Created with the goo layer (it partitions it) and
  // registered as post-aa's pre-post capture stage. ON by default; ?bloodblur=0
  // or __sdfGame.setBloodBlur(false) restores the fused sharp goo exactly.
  ctx.panels.shutterGame = null;
  ctx.panels.shutterPanel = null;
  // FLYING-GIB SHUTTER BLUR (2026-09-17, shutter task 3). The gib twin of the
  // blood layer: selected moving gibs are lifted onto a dedicated layer, drawn
  // alone and exposure-resolved over the clean scene. Separate on/off switch,
  // shared exposure/max-trail controls. ON by default on this feature branch.
  ctx.gibs.shutter = null;
  /** MUTUAL OCCLUSION (task 4). When true (default) the blood resolve also
   *  tests against the blurred-gib layer's depth, so blood behind a blurred gib
   *  is dropped. `?giboccluder=0` / `setGibOccluder(false)` is the A/B seam
   *  that shows the ordered-vs-resolved difference on one frozen frame. */
  ctx.gibs.occluderEnabled = true;
  /** Presentation identity across frames, so a freshly spawned/reused piece
   *  gets no pre-birth streak on its first drawn frame. Keyed by the owning
   *  list AND id (the sprite and chunk id sequences are independent). */
  ctx.gibs.blurPrevKeys = new Set<string>();
  ctx.render.sdfLayer.setScale(ctx.render.sdfScale);
  sizeSdfLayer(ctx);
  window.addEventListener('resize', withCtx(ctx, sizeSdfLayer));

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
  ctx.render.adaptiveEnabled = false;
  ctx.render.adaptiveBudgetMs = 1000 / 30;
  ctx.render.adaptiveState = initialAdaptiveState(performance.now());
  ctx.render.adaptiveFrames = [];
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
  ctx.crowd.param = new URLSearchParams(location.search).get('crowd');
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
  ctx.crowd.dispatch = new URLSearchParams(location.search).get('crowddispatch') === 'quad'
    ? 'quad' : 'boxes';
  // DEFAULT = CROWD, BOXES DISPATCH (2026-09-15). The 2026-09-14 revert to
  // per-body rested on a bench whose legs fought different fights (the
  // `setCrowd` respawn confound, fixed in sdf-game-bench.mjs). On matched
  // fights the crowd march with boxes beats per-body on the owner's real
  // room-1 run and keeps its 8..24-body wins. `?crowd=0` opts out.
  ctx.crowd.on = ctx.crowd.param !== '0';
  // STAGE-3 COMPATIBILITY: the refine twins and the cone pass are unsupported
  // under the crowd march (they read per-body state the instance record does
  // not carry; stage 3 turns refine into a fullscreen record-reading pass). A
  // boot that asks for either falls back to per-body for its whole life,
  // warns once, and records why in crowdInfo().fallbackReason.
  // `sdfLayer.coneEnabled` is the cone pass's own gate — it ships off and has
  // no boot flag yet, so in practice only `?refine=1` triggers this today.
  ctx.crowd.fallbackReason = null;
  if (ctx.crowd.on && (ctx.render.refineWanted || ctx.render.sdfLayer.coneEnabled)) {
    ctx.crowd.fallbackReason = ctx.render.refineWanted ? 'refine twin requested (?refine=1)' : 'cone pass requested';
    ctx.crowd.on = false;
    console.warn('[crowd] refine/cone twins are not supported under the crowd march (stage 3); falling back to per-body for this boot');
  }
  /** One CrowdType per character registry name; lazily created on first spawn. */
  ctx.crowd.types = new Map<string, CrowdType>();
  /** The first attached view per type — the source of the per-frame per-TYPE
   *  uniform values (lighting rig, spot, level shadow, probes). A same-name
   *  view, so its per-type statics match; the FIRST attaches in room order and
   *  pins the type's room uniforms for stage a (cross-room crowds are a known
   *  gap — see the crowd dev note). */
  ctx.crowd.sourceView = new Map<CrowdType, ZombieGpuView>();
  /** Types whose shared segVolume atlas/meta were bound from the first actor. */
  ctx.crowd.volumeBound = new Set<CrowdType>();
  ctx.crowd.segMetaWarned = false;
  ctx.crowd.refineWarned = false;
  /** TASK-6 DIAGNOSTIC LIGHT CLOCK state — see setLightClockFrozen in the
   *  __sdfGame seam. Freezes the practical flicker phase at the freeze
   *  instant; default OFF, gate-only. DECLARED HERE (before setDrawFn)
   *  because the flicker block reads it and the render loop arms before
   *  main() finishes — the same TDZ rule chunkObjects obeys. */
  ctx.lighting.clockFrozen = false;
  ctx.lighting.flickerClockFrozenAt = 0;
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
  ctx.lighting.bounceSpotParam = new URLSearchParams(location.search).get('bouncespot');
  ctx.lighting.bounceSpotGain = ctx.lighting.bounceSpotParam === null ? 0 : Math.max(0, Number(ctx.lighting.bounceSpotParam) || 0);
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
  ctx.boot.drawReady = false;
  /** One-shot boot marks around the FIRST skeleton-mesh sync, so a startup
   *  probe can attribute the cold-blocking extraction without a per-frame
   *  allocation. Set once; never cleared (a rebuild's re-extraction is
   *  reported by SegmentMeshCache.stats() instead). */
  ctx.render.meshSyncMarked = false;
  ctx.boot.handle.setDrawFn(() => {
    if (!ctx.boot.drawReady) return;
    // GPU PROBE GATHER dispatch (P3/P4). OUTSIDE the post-aa pass on purpose:
    // renderer.compute() inside a render callback broke the renderer's pass
    // state and stalled the loop after five frames (owner-observed HUD at
    // 0.0 ms, no bodies). The frame data is packed in the legacy block below
    // and dispatched here at the top of the NEXT frame — one frame of lag on
    // a layer that blends over frames anyway.
    if (ctx.probes.pendingGather && ctx.probes.gather) {
      try { ctx.probes.gather.update(ctx.probes.pendingGather); ctx.probes.frame++; }
      catch (err) { if (ctx.probes.gatherErrors++ === 0) console.error('[probe-gather] update failed', err); }
      ctx.probes.pendingGather = null;
    }
    return ctx.render.postAa.render(() => {
    // Anything rendered before a site claims a label lands in 'frame:other'
    // — a non-zero row there means an unlabelled pass exists.
    setPassLabel('frame:other');
    ctx.lighting.flashlight.update(camera);
    // SSCS feed: the flashlight pose and this frame's camera matrices. The
    // camera's matrixWorld is current — flashlight.update just re-ran
    // updateMatrixWorld on it; setSscsFrame rebuilds the view matrix itself.
    if (ctx.render.postAa.sscs) ctx.render.postAa.setSscsFrame(camera, ctx.lighting.flashlight.spot.position);

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
      const ft = ctx.lighting.clockFrozen ? ctx.lighting.flickerClockFrozenAt : performance.now() * 0.001;
      for (const f of ctx.lighting.flickerLights) {
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
    if (ctx.render.boneMesh || ctx.gibs.boneMesh) {
      if (ctx.render.boneMesh) {
        const craters: { pos: Vec3; radius: number }[] = [];
        for (const a of ctx.world.actors) {
          const prims = a.posed().prims;
          for (const w of a.visualWounds()) craters.push({ pos: woundWorldPos(prims, w, ctx.vfx.boundedWoundPreview ? a.pose().yaw : 0), radius: w.radius });
        }
        ctx.render.boneInstancer.setWounds(craters);
      }
      ctx.render.boneInstancer.update([
        ...(ctx.render.boneMesh
          ? ctx.world.actors.map(a => { const p = a.posed(); return { prims: p.bonePrims ?? [], alive: p.clusters.map(c => c.alive) }; })
          : []),
        ...(ctx.gibs.boneMesh ? ctx.bake.liveChunks.map(c => ({ prims: c.view.posedBones() })) : []),
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
    const meshHold = ctx.render.sdfLayer.halfRate && ctx.render.sdfLayer.willHold;
    if (ctx.render.segMeshRenderer && !meshHold) {
      // Its own phase, NOT folded into an existing one: this path shipped as
      // the forward default without a controlled timing result (skeleton
      // wrap-up, 2026-09-08) and no capture could see it until now.
      const meshTiming = ctx.telemetry.telemetry.begin();
      const firstMeshSync = !ctx.render.meshSyncMarked;
      if (firstMeshSync) { ctx.render.meshSyncMarked = true; mark('mesh-sync-start'); }
      const craters: { pos: Vec3; radius: number }[] = [];
      for (const a of ctx.world.actors) {
        const prims = a.posed().prims;
        for (const w of a.visualWounds()) craters.push({ pos: woundWorldPos(prims, w, ctx.vfx.boundedWoundPreview ? a.pose().yaw : 0), radius: w.radius });
      }
      ctx.render.segMeshRenderer.setWounds(craters);
      ctx.render.segMeshRenderer.update(ctx.world.actors.map(a => {
        let e = ctx.render.skeletonSources.get(a);
        if (!e) { e = buildSkeletonSources(a, 'zombie'); ctx.render.skeletonSources.set(a, e); a.view.setPackBones(false); }
        else if (e.body !== a.body) { e = buildSkeletonSources(a, e.name); ctx.render.skeletonSources.set(a, e); }
        return e.sources;
      }), ctx.world.actors);
      ctx.telemetry.telemetry.end('skeleton-mesh', meshTiming);
      if (firstMeshSync) mark('mesh-sync-end');
    }
    // skeleton=volume: only the tiny pose/meta texture changes per frame.
    // A body-reference change means sever/rebuild and therefore a new
    // revision-keyed atlas; stale same-name grids are never re-enabled.
    if (ctx.render.segVolumeCache) {
      for (const actor of ctx.world.actors) {
        const state = ctx.render.skeletonVolumes.get(actor);
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
    if (ctx.boot.deferredApi) {
      if (ctx.goo.enabled && ctx.goo.layer) ctx.goo.layer.render(camera, () => ctx.boot.deferredApi!.render(camera));
      else ctx.boot.deferredApi!.render(camera);
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
      ctx.lighting.flashlight.spot.target.getWorldPosition(sAxis).sub(ctx.lighting.flashlight.spot.position).normalize();
      // x intensity gate, y cosInner, z cosOuter, w range — the cone edge
      // comes straight off the light so the two systems cannot drift.
      const spotOn = ctx.lighting.dungeonOn ? 1 : 0;
      const cosInner = Math.cos(ctx.lighting.flashlight.spot.angle * (1 - ctx.lighting.flashlight.spot.penumbra));
      const cosOuter = Math.cos(ctx.lighting.flashlight.spot.angle);
      // LEVEL SHADOW twin (perf round 2 task 7): exact flashlight pose, then
      // refresh its shadow matrix NOW — shadow.matrix is otherwise written
      // during the render, i.e. after we read it. Same pose => same shadows
      // on bodies as the meshes cast onto the floor.
      const twin = ctx.lighting.flashlight.levelShadow;
      twin.position.copy(ctx.lighting.flashlight.spot.position);
      twin.target.position.copy(ctx.lighting.flashlight.spot.target.position);
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
      const lvlOn = spotOn > 0 && twin.castShadow && map !== null && ctx.lighting.levelShadowEnabled ? 1 : 0;
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
      const fv = flashEnvelope(ctx.weapon.flashAge);
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
      if (ctx.lighting.bounceSpotGain > 0 && flashGate > 0) {
        const key = enclosureKeyAt(ctx.player.player.pos[0], ctx.player.player.pos[2]);
        const roomDef = ROOMS.find(r => r.name === key);
        const enc = enclosureOf(key);
        if (enc) {
          const walls = roomDef ? {
            negX: roomDef.wallColor, posX: roomDef.wallColor, negY: roomDef.floorColor,
            posY: roomDef.ceilColor, negZ: roomDef.wallColor, posZ: roomDef.wallColor,
          } : enc.walls;
          const occ = roomDef ? FURNITURE.filter(f => f.room === roomDef.id)
            .map(f => ({ min: [f.minX, 0, f.minZ] as Vec3, max: [f.maxX, f.height, f.maxZ] as Vec3 })) : [];
          const sp = ctx.lighting.flashlight.spot.position, sc = ctx.lighting.flashlight.spot.color;
          bounceSpot = computeBounceSpot({
            pos: [sp.x, sp.y, sp.z], axis: [sAxis.x, sAxis.y, sAxis.z],
            intensity: flashGate, cosInner: flashInner, cosOuter: flashOuter,
            range: ctx.lighting.flashlight.spot.distance, keyGain: ctx.vfx.beamTuning.gain, color: [sc.r, sc.g, sc.b],
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
      const dynKey = enclosureKeyAt(ctx.player.player.pos[0], ctx.player.player.pos[2]);
      let dynRoom: RoomDef | null = ROOMS.find(r => r.name === dynKey) ?? null;
      if (!dynRoom) {
        let bestD = Infinity;
        for (const r of ROOMS) {
          const cx = (r.minX + r.maxX) / 2, cz = (r.minZ + r.maxZ) / 2;
          const d = (cx - ctx.player.player.pos[0]) ** 2 + (cz - ctx.player.player.pos[2]) ** 2;
          if (d < bestD) { bestD = d; dynRoom = r; }
        }
      }
      const dynGrid = dynRoom ? ctx.world.roomProbes.gridOf(dynRoom.id) : null;
      const dynOn = ctx.probes.gather !== null && dynRoom !== null && dynGrid !== null
        && (ctx.probes.dynGain > 0 || ctx.probes.visStrength > 0);
      ctx.probes.gateLogs++;
      ctx.probes.lastGates = { bound: ctx.probes.gather !== null, dynKey, room: dynRoom?.id ?? null, grid: !!dynGrid, gain: ctx.probes.dynGain, vis: ctx.probes.visStrength, dynOn, flashI: playerFlashLightIntensity(), flashAge: ctx.weapon.flashAge, capsules: ctx.probes.lastCapsules, lights: ctx.probes.lastLights };
      let probeCapsuleCount = 0;
      // Amortized rate: pack (and therefore dispatch, one frame later) only
      // on due ticks; skipped frames leave the dynamic layer frozen, which
      // the kernel's own cross-dispatch blending already models.
      const gatherDue = ctx.probes.gatherRate <= 1 || ctx.probes.gatherTick % ctx.probes.gatherRate === 0;
      ctx.probes.gatherTick++;
      if (dynOn && ctx.probes.gather && dynRoom && dynGrid && gatherDue) {
        for (const a of ctx.world.actors) {
          if (!nearRoom(a, dynRoom) || probeCapsuleCount >= PROBE_MAX_BONE_INSTANCES) continue;
          const posed = a.posed();
          const sub = { ab: ctx.probes.capsuleArrays.ab.subarray(probeCapsuleCount * INSTANCE_FLOATS), overflowed: false };
          probeCapsuleCount += packBoneInstances(posed.bonePrims ?? [], posed.clusters.map(c => c.alive), sub, PROBE_MAX_BONE_INSTANCES - probeCapsuleCount);
        }
        ctx.probes.lastCapsules = probeCapsuleCount;
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
        if (ctx.weapon.flashLight && fI > 0) {
          ctx.weapon.flashLight.getWorldPosition(_flashWorld);
          gatherLights.push({ pos: [_flashWorld.x, _flashWorld.y, _flashWorld.z], color: [1.0, 0.81, 0.58], intensity: fI * ctx.probes.flashBoost });
        }
        for (const a of ctx.world.actors) {
          if (!nearRoom(a, dynRoom) || !a.character) continue;
          const age = a.sinceFire();
          if (!(age >= 0 && age < 0.14)) continue;
          const m = a.character.muzzle();
          if (!m) continue;
          const k = 1 - age / 0.14;
          gatherLights.push({ pos: [m[0], m[1], m[2]], color: [1.0, 0.72, 0.45], intensity: 35 * k * k * ctx.probes.flashBoost });
        }
        if (spotOn > 0 && ctx.lighting.flashlight.spot.intensity > 0) {
          const sp = ctx.lighting.flashlight.spot.position, sc = ctx.lighting.flashlight.spot.color;
          gatherLights.push({
            pos: [sp.x, sp.y, sp.z], color: [sc.r, sc.g, sc.b], intensity: ctx.lighting.flashlight.spot.intensity,
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
        for (const e of ctx.vfx.explosionLights) {
          const k = explosionLightEnv(ctx, e.age);
          if (k <= 0.001) continue;
          if (gatherLights.length >= 8) break;
          // Needs to be near the gather's room to reach it at all: the layer is
          // the PLAYER'S enclosure, so a blast in the next room is dropped here
          // for the same reason a tracer is (tracer-lights.ts).
          if (!nearRoomPoint(e.pos, dynRoom)) continue;
          gatherLights.push({
            pos: [e.pos[0], e.pos[1], e.pos[2]],
            color: [1.0, 0.55, 0.24],
            intensity: EXPLOSION_LIGHT.gatherPeak * k * ctx.lighting.fxLightScale,
            // The blast is the one light in the game that has to fill a ROOM
            // rather than pool around its own position — see `fxSpread`.
            fill: ctx.vfx.spread,
          });
        }
        // (3c) BURNING BODIES feed the same list (≤2 slots; surplus burners
        // merge into the nearest slot) so a future anchor or shadow fix lights
        // the room here. NOTE: at the chest anchor the light self-shadows on
        // the burner's own capsules and contributes no visible radiance — see
        // pushGatherLights; the mesh pool carries the shipped room light.
        ctx.vfx.burning.pushGatherLights(
          gatherLights, ctx.player.player.pos, nearRoomPoint, dynRoom,
          Math.min(2, 8 - gatherLights.length), ctx.vfx.spread,
        );
        const tracerSlots = Math.min(ctx.lighting.tracerLightSlots, 8 - gatherLights.length);
        if (tracerSlots > 0 && ctx.lighting.tracerLightGain > 0) {
          gatherLights.push(...tracerGatherLights(ctx.lighting.liveTracers?.() ?? [], {
            eye: ctx.player.player.pos, room: dynRoom, margin: 1.5, gain: ctx.lighting.tracerLightGain,
            slugRadius: SLUG.radius, cap: tracerSlots,
          }));
        }
        ctx.probes.lastLights = gatherLights.length;
        ctx.probes.pendingGather = {
          grid: dynGrid,
          enclosure: { min: [dynRoom.minX, 0, dynRoom.minZ], max: [dynRoom.maxX, dynRoom.height, dynRoom.maxZ] },
          wallAlbedo: dynRoom.wallColor,
          occluders: FURNITURE.filter(f => f.room === dynRoom.id).map(f => ({
            box: { min: [f.minX, 0, f.minZ] as Vec3, max: [f.maxX, f.height, f.maxZ] as Vec3 },
            albedo: [0.35, 0.33, 0.30] as Vec3,
          })),
          instances: ctx.probes.capsuleArrays.ab, instanceCount: probeCapsuleCount,
          capsuleMargin: 0.06,
          optimized: ctx.probes.optimized,
          // Diagnostic seams (see ?dynrays / ?dynlights above); both default to
          // the shipped values, so an unset URL is bit-identical to before.
          lights: ctx.probes.lightsBoot === null ? gatherLights : gatherLights.slice(0, ctx.probes.lightsBoot),
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
          frameSeed: ctx.demo.hold ? 0 : (ctx.probes.frame % 64) / 64,
          blend: ctx.probes.blendBoot ?? 0.6,
          fall: ctx.probes.fallBoot ?? 0.12,
          raysPerProbe: ctx.probes.raysBoot === null ? 32 : ctx.probes.raysBoot,
        };
      }
      // DIRECT FLASH SOURCES for the bodyFlash slot: every burning muzzle in
      // play (the player's and the soldiers'), unboosted; each body takes the
      // strongest by I/d^2 from its own position.
      const directFlashes: { pos: Vec3; intensity: number }[] = [];
      const playerFlashI = playerFlashLightIntensity();
      if (ctx.weapon.flashLight && playerFlashI > 0) {
        ctx.weapon.flashLight.getWorldPosition(_flashWorld);
        directFlashes.push({ pos: [_flashWorld.x, _flashWorld.y, _flashWorld.z], intensity: playerFlashI });
      }
      for (const a of ctx.world.actors) {
        if (!a.character) continue;
        const age = a.sinceFire();
        if (!(age >= 0 && age < 0.14)) continue;
        const m = a.character.muzzle();
        if (!m) continue;
        const k = 1 - age / 0.14;
        directFlashes.push({ pos: [m[0], m[1], m[2]], intensity: 35 * k * k });
      }
      // BURNING BODIES feed the SAME bodyFlash slot (flare test harness).
      ctx.vfx.burning.pushFlashes(directFlashes);
      // The level's rooms take the same dynamic cfg as the bodies: the room
      // the gather serves reads it, every other room reads 0 — and with the
      // level probes off the level never reads the buffer at all.
      for (const [roomId, node] of ctx.lighting.levelProbeNodes) {
        const on = dynOn && dynRoom !== null && dynRoom.id === roomId && ctx.lighting.levelProbeWeight > 0;
        node.slots.probeDynCfg.value.set(on ? ctx.probes.dynGain : 0, on ? ctx.probes.visStrength : 0, 0, 0);
      }
      for (const a of ctx.world.actors) {
        const inDyn = dynOn && dynRoom !== null && nearRoom(a, dynRoom);
        a.view.uniforms.probeDynCfg.value.set(inDyn ? ctx.probes.dynGain : 0, inDyn ? ctx.probes.visStrength : 0, 0, 0);
        let best: { pos: Vec3; intensity: number } | null = null, bestScore = 0;
        if (ctx.lighting.bodyFlashGain > 0 && directFlashes.length > 0) {
          const q = a.pose().pos;
          for (const f of directFlashes) {
            const dx = f.pos[0] - q[0], dy = f.pos[1] - (q[1] + 1.0), dz = f.pos[2] - q[2];
            const score = f.intensity / Math.max(0.25, dx * dx + dy * dy + dz * dz);
            if (score > bestScore) { bestScore = score; best = f; }
          }
        }
        if (best) a.view.uniforms.bodyFlash.value.set(best.pos[0], best.pos[1], best.pos[2], best.intensity * ctx.lighting.bodyFlashGain);
        else a.view.uniforms.bodyFlash.value.w = 0;
        a.view.uniforms.spotPos.value.copy(ctx.lighting.flashlight.spot.position);
        a.view.uniforms.spotAxis.value.copy(sAxis);
        a.view.uniforms.spotCfg.value.set(flashGate, flashInner, flashOuter, ctx.lighting.flashlight.spot.distance);
        a.view.uniforms.spotColor.value.copy(ctx.lighting.flashlight.spot.color);
        if (bounceSpot) {
          a.view.uniforms.bounceSpotPos.value.set(bounceSpot.pos[0], bounceSpot.pos[1], bounceSpot.pos[2]);
          a.view.uniforms.bounceSpotNormal.value.set(bounceSpot.normal[0], bounceSpot.normal[1], bounceSpot.normal[2]);
          a.view.uniforms.bounceSpotRadiance.value.set(bounceSpot.radiance[0], bounceSpot.radiance[1], bounceSpot.radiance[2]);
          a.view.uniforms.bounceSpotCfg.value.set(ctx.lighting.bounceSpotGain, bounceSpot.radius, 0, 0);
        } else {
          a.view.uniforms.bounceSpotCfg.value.x = 0;
        }
        if (fv > 0) {
          // Push warm. The flash is burning powder, not the flashlight's white.
          const c = a.view.uniforms.spotColor.value;
          c.setRGB(c.r + 0.35 * fv, c.g + 0.16 * fv, c.b);
        }
        a.view.uniforms.spotCfg2.value.set(ctx.vfx.beamTuning.gain, ctx.vfx.beamTuning.shoulder, ctx.vfx.beamTuning.keyFloor, 0);
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
      for (const c of ctx.bake.reference ? [...ctx.bake.liveChunks, ...ctx.bake.chunks] : ctx.bake.liveChunks) {
        const u = c.view.uniforms;
        u.spotPos.value.copy(ctx.lighting.flashlight.spot.position);
        u.spotAxis.value.copy(sAxis);
        u.spotCfg.value.set(spotOn, cosInner, cosOuter, ctx.lighting.flashlight.spot.distance);
        u.spotColor.value.copy(ctx.lighting.flashlight.spot.color);
        u.spotCfg2.value.set(ctx.vfx.beamTuning.gain, ctx.vfx.beamTuning.shoulder, ctx.vfx.beamTuning.keyFloor, 0);
      }
      // Bone tubes take the SAME beam (bone-instancer's boneShade is the
      // march's own cone formula on these exact values).
      ctx.render.boneInstancer.uniforms.spotPos.value.copy(ctx.lighting.flashlight.spot.position);
      ctx.render.boneInstancer.uniforms.spotAxis.value.copy(sAxis);
      ctx.render.boneInstancer.uniforms.spotCfg.value.set(spotOn, cosInner, cosOuter, ctx.lighting.flashlight.spot.distance);
      ctx.render.boneInstancer.uniforms.spotColor.value.copy(ctx.lighting.flashlight.spot.color);
      ctx.render.boneInstancer.uniforms.spotCfg2.value.set(ctx.vfx.beamTuning.gain, ctx.vfx.beamTuning.shoulder, ctx.vfx.beamTuning.keyFloor, 0);
      if (ctx.render.segMeshRenderer) {
        // skeleton=mesh: the SAME beam — segment boneShade is the march's
        // formula on the same uniform values, like the tubes.
        ctx.render.segMeshRenderer.uniforms.spotPos.value.copy(ctx.lighting.flashlight.spot.position);
        ctx.render.segMeshRenderer.uniforms.spotAxis.value.copy(sAxis);
        ctx.render.segMeshRenderer.uniforms.spotCfg.value.set(spotOn, cosInner, cosOuter, ctx.lighting.flashlight.spot.distance);
        ctx.render.segMeshRenderer.uniforms.spotColor.value.copy(ctx.lighting.flashlight.spot.color);
        ctx.render.segMeshRenderer.uniforms.spotCfg2.value.set(ctx.vfx.beamTuning.gain, ctx.vfx.beamTuning.shoulder, ctx.vfx.beamTuning.keyFloor, 0);
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
      const liveSurf = ctx.world.actors[0]?.view.uniforms.surfCfg2.value;
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
      const liveView = ctx.world.actors[0]?.view.uniforms;
      // `?chunkdetail=` / `__sdfGame.setChunkDetail(x)` overrides the creature's
      // own amplitude. The shipped value is the flesh preset's surfaceNoiseAmp
      // (0.06), which is deliberately subtle on a marched body and is therefore
      // hard to judge on a settled piece without sweeping it — so it sweeps.
      const detailAmp = ctx.bake.detailOverride
        ?? (liveSurf ? Math.min(1, liveSurf.y * CHUNK_DETAIL_GAIN) : null);
      for (const lm of ctx.world.litChunkMaterials) {
        const bu = lm.uniforms;
        bu.spotPos.value.copy(ctx.lighting.flashlight.spot.position);
        bu.spotAxis.value.copy(sAxis);
        bu.spotCfg.value.set(spotOn, cosInner, cosOuter, ctx.lighting.flashlight.spot.distance);
        bu.spotColor.value.copy(ctx.lighting.flashlight.spot.color);
        bu.spotCfg2.value.set(ctx.vfx.beamTuning.gain, ctx.vfx.beamTuning.shoulder, ctx.vfx.beamTuning.keyFloor, 0);
        if (detailAmp !== null) {
          bu.fleshDetail.value.set(
            detailAmp, ctx.bake.detailFreq, ctx.bake.detailAlbedo, 0);
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
    updateVisibleActors(ctx);
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
    const crowdMarch = ctx.crowd.on && ctx.boot.warmBackground.crowdPath() === 'crowd';
    if (ctx.crowd.on && ctx.crowd.types.size > 0) {
      const csize = ctx.render.sdfLayer.targetSize;
      const grid = {
        tilesX: Math.ceil(Math.max(1, csize.width) / TILE_SIZE_PX),
        tilesY: Math.ceil(Math.max(1, csize.height) / TILE_SIZE_PX),
        tilePx: TILE_SIZE_PX,
      };
      const crowdTiming = ctx.telemetry.telemetry.begin();
      // The level-shadow depth texture the type rebinds (same expression the
      // per-body loop's `map` uses; `flashlight.levelShadow.shadow.map` is
      // unchanged between there and here — nothing renders in between).
      const levelShadowMap = ctx.lighting.flashlight.levelShadow.shadow.map?.depthTexture ?? null;
      const vis = new Set<number>();
      for (const t of ctx.crowd.types.values()) {
        const src = ctx.crowd.sourceView.get(t);
        const copyTiming = ctx.telemetry.telemetry.begin();
        if (src) copyUniformValues(ctx, t.uniforms, src.uniforms);
        ctx.telemetry.telemetry.end('crowd-uniform-copy', copyTiming);
        // CROWD REQUIRES ITS TILE LIST (task 8). The per-body tile playtest
        // (`gameTiles`) gates only the per-body path; the crowd type owns its
        // own ComputeTileBinding and always bins it, so a ship-defaults
        // `setTiles(false)` can no longer pin the crowd march to the slow
        // per-slot cluster walk. tileCfg.x is the entry mode: 1 = tile list.
        t.uniforms.tileCfg.value.x = 1;
        if (levelShadowMap !== null) t.levelShadowTex.value = levelShadowMap;
        vis.clear();
        for (const a of ctx.render.visibleActors) {
          if (a.crowd?.type !== t) continue;
          // A headless baked corpse is drawn by its mesh; its instance must not
          // march too (see soldier-corpse-bake bakedState).
          if (ctx.world.soldierCorpses?.bakedState(a.id) === 'headless') continue;
          vis.add(a.crowd.slot);
        }
        // ALWAYS sync, ready or not: sync() is what flushes the shared atlas
        // and record buffer the per-body FALLBACK also reads (the crowd-attached
        // views are built on the crowd sink, so their own march samples this
        // same data — see spawnEnemy). Skipping it while the crowd program
        // compiles would leave the fallback reading the boot-time upload.
        t.sync(camera, grid, vis);
      }
      ctx.telemetry.telemetry.end('crowd-sync', crowdTiming);
      // DEGRADE, NEVER STALL (defer-compile task). While the crowd program is
      // not ready, keep the type meshes invisible so the boot precompile and
      // the live draw cannot reach them; the actors are drawn instead through
      // their per-body views via setBodies below. `compileAsync`-queued
      // pipelines read NOT READY and three SKIPS them, but a live `getForRender`
      // on an UNCACHED mesh builds the 48 s pipeline SYNCHRONOUSLY — so the
      // exclusion has to be the draw list (and visibility for the boot pass).
      if (!crowdMarch) {
        for (const t of ctx.crowd.types.values()) { t.mesh.visible = false; t.depthPreMesh.visible = false; }
      }
    }
    // Crowd stage a: one instanced mesh per type replaces its N hidden
    // per-body proxies; unattached (or crowd-off) actors keep their proxies.
    // Fire/gib profiling (2026-09-14): label the two draw-fn spans that are
    // NOT the per-type sync so the bench can attribute a cpu:draw climb.
    const setBodiesTiming = ctx.telemetry.telemetry.begin();
    ctx.render.sdfLayer.setBodies(
      crowdMarch
        ? ([...ctx.crowd.types.values()].map(t => t.mesh) as THREE.Object3D[])
            .concat(ctx.render.visibleActors.filter(a => !a.crowd).map(a => a.view.object))
        : ctx.render.visibleActors.map(a => a.view.object),
      // GIBS DEGRADE (defer-compile task): the chunk/gib material is the only
      // user of the chunk program, and a draw before it is ready is the 47.8 s
      // synchronous freeze 87b8f71c exists to prevent. The pieces keep
      // simulating; they are simply not submitted until the program is ready.
      ctx.boot.warmBackground.gibDraw() === 'draw' ? chunkObjects() : []);
    ctx.telemetry.telemetry.end('crowd-set-bodies', setBodiesTiming);
    const sdfRenderTiming = ctx.telemetry.telemetry.begin();
    if (ctx.goo.enabled && ctx.goo.layer) {
      // Fire/gib profiling: the goo layer's callback IS the SDF submit, so
      // nest so the bench can tell a goo pass from the march submit.
      const gooTiming = ctx.telemetry.telemetry.begin();
      ctx.goo.layer.render(camera, () => {
        const inner = ctx.telemetry.telemetry.begin();
        ctx.render.sdfLayer.render(scene, camera);
        ctx.telemetry.telemetry.end('crowd-sdf-inner', inner);
      });
      ctx.telemetry.telemetry.end('crowd-goo-outer', gooTiming);
    } else {
      const inner = ctx.telemetry.telemetry.begin();
      ctx.render.sdfLayer.render(scene, camera);
      ctx.telemetry.telemetry.end('crowd-sdf-inner', inner);
    }
    ctx.telemetry.telemetry.end('crowd-sdf-render', sdfRenderTiming);
    // BURNING BODIES' FLAME CARDS: pose the pool before the effects scene
    // draws. An uncreated pool (nothing has ever ignited) skips this.
    ctx.vfx.burning.updateCards(camera);
    ctx.vfx.characterEffects.render(camera);
    });
  });

  ctx.render.occluderHull = createOccluderHull();
  ctx.render.occluderHull.object.layers.set(OCCLUDER_LAYER);
  scene.add(ctx.render.occluderHull.object);
  // The inflated shadow-casting twin (see occluder-hull.ts). castShadow and
  // the layer are already set in the factory; spelled out here to sit beside
  // the occlusion hull's wiring, where the next reader will look first.
  //
  // NOTE it rides SHADOW_HULL_LAYER, NOT the occluder layer — which is why
  // the pre-pass being switched off below does not cost us character
  // shadows. The two hulls are twins in shape only; they have opposite
  // biases (shrunk to stay inside the body vs inflated to close the gaps
  // between spheres) and now opposite fates.
  ctx.render.occluderHull.shadowObject.layers.set(SHADOW_HULL_LAYER);
  ctx.render.occluderHull.shadowObject.castShadow = true;
  scene.add(ctx.render.occluderHull.shadowObject);
  // DEFERRED MODE: the occlusion hull and its inflated shadow twin are
  // march/composite helpers, never G-buffer or forward content — the shadow
  // module finds the twin through its SHADOW_HULL_LAYER membership instead.
  ctx.boot.deferredApi?.router.register(ctx.render.occluderHull.object, 'exclude');
  ctx.boot.deferredApi?.router.register(ctx.render.occluderHull.shadowObject, 'exclude');

  // OCCLUDER PRE-PASS OFF (2026-09-01). Its tMax clamp is gone from the
  // march -- the distance it rasterises is only accurate in the near field
  // and under-reports badly beyond ~3 m, which shredded bodies at range.
  // The full measurement and the revival conditions are in march.wgsl.ts
  // above tMax. __sdfGame.setOccluder still renders the pass for
  // diagnostics; nothing consumes it.
  ctx.render.sdfLayer.setOccluderEnabled(false);

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
  ctx.lighting.levelShadowEnabled = GAME_LEVEL_SHADOW > 0.5;

  // The conservative OUTER hull (shell-hull-outer.ts). Default OFF: it is a
  // measurement instrument until the march consumes it, and rasterising it
  // for nothing is pure cost.
  ctx.world.outerHull = createOuterHull();
  ctx.world.outerHull.entryObject.layers.set(SHELL_LAYER);
  ctx.world.outerHull.exitObject.layers.set(SHELL_EXIT_LAYER);
  scene.add(ctx.world.outerHull.entryObject);
  scene.add(ctx.world.outerHull.exitObject);
  ctx.boot.deferredApi?.router.register(ctx.world.outerHull.entryObject, 'exclude');
  ctx.boot.deferredApi?.router.register(ctx.world.outerHull.exitObject, 'exclude');
  // SHELL ON BY DEFAULT (owner visual pass, 2026-08-31). Worth -40%/-54%
  // frame time (room 4/3) at real-render parity below the same-state noise
  // floor. The hull is populated by the frame loop before the first draw
  // (tick runs ahead of drawFn), so no first-frame dropout. __sdfGame
  // .setShell(false) is the kill switch.
  ctx.render.sdfLayer.setShellEnabled(true);

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
  ctx.render.boneInstancer = createBoneInstancer(1024,
    // DEFERRED MODE: the tubes are a level-only G-buffer producer (tissue —
    // a body's own hull must not swallow their light).
    ctx.boot.deferredMode ? { output: 'surface', shadowReceiver: 'level-only' } : undefined);
  ctx.gibs.boneMesh = new URLSearchParams(location.search).get('gibbonemesh') !== '0';
  ctx.render.boneInstancer.object.layers.set(0);
  // Visible when EITHER path draws through it — gib bones alone are enough.
  ctx.render.boneInstancer.object.visible = ctx.gibs.boneMesh;
  scene.add(ctx.render.boneInstancer.object);
  ctx.boot.deferredApi?.router.register(ctx.render.boneInstancer.object, 'mesh', 'level-only');
  ctx.render.boneMesh = false;
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
  ctx.render.skeletonMode = resolveSkeletonMode(location.search, {
    dev: import.meta.env.DEV, deferred: ctx.boot.deferredMode,
  });
  if (import.meta.env.DEV && new URLSearchParams(location.search).get('skeleton') === 'mesh' && ctx.render.skeletonMode !== 'mesh') {
    console.warn('[sdf-game] skeleton=mesh refused (deferred mode) — procedural bones');
  }
  ctx.render.segMeshCache = ctx.render.skeletonMode === 'mesh' ? new SegmentMeshCache() : null;
  // FIELD_MESH_LAYER, not 0: the 'bodies' field style needs to pull the
  // skeleton out of the full-resolution polygonal pass and draw it into the
  // half-height field instead. Every other style just enables that layer in
  // pass 1, so this is a no-op for them.
  ctx.render.segMeshRenderer = ctx.render.segMeshCache ? createSegmentMeshRenderer(ctx.render.segMeshCache, FIELD_MESH_LAYER) : null;
  if (ctx.render.segMeshRenderer) scene.add(ctx.render.segMeshRenderer.object);
  ctx.render.skeletonSources = new Map<ZombieActor, { body: BuildResult; name: string; sources: BoneFieldSource[] }>();
  ctx.render.segVolumeCache = ctx.render.skeletonMode === 'volume' ? new SegmentVolumeCache() : null;
  type SharedVolumeAtlas = ReturnType<typeof buildSegmentAtlas> & {
    texture: ReturnType<typeof createSegmentAtlasTexture>;
    refs: number;
  };
  ctx.render.sharedVolumeAtlases = new Map<string, SharedVolumeAtlas>();
  ctx.telemetry.volumeAtlasBuilds = 0;
  ctx.render.skeletonVolumes = new Map<ZombieActor, {
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
    let shared = ctx.render.sharedVolumeAtlases.get(key);
    if (!shared) {
      const segIds = boneSegmentKeyMap(actor.body, actor.boundRig());
      const atlas = buildSegmentAtlas(sources.flatMap(source => {
        const segId = segIds.get(source.segment);
        return segId === undefined ? [] : [{ segId, grid: ctx.render.segVolumeCache!.get(source) }];
      }));
      shared = Object.assign(atlas, { texture: createSegmentAtlasTexture(atlas), refs: 0 });
      ctx.render.sharedVolumeAtlases.set(key, shared);
      ctx.telemetry.volumeAtlasBuilds++;
    }
    shared.refs++;
    return { key, shared };
  };
  const releaseVolumeAtlas = (key: string) => {
    const shared = ctx.render.sharedVolumeAtlases.get(key);
    if (!shared || --shared.refs > 0) return;
    shared.texture.dispose();
    for (const meta of shared.metas) ctx.render.segVolumeCache?.evict(meta.grid);
    ctx.render.sharedVolumeAtlases.delete(key);
  };
  const bindSkeletonVolume = (actor: ZombieActor, name: string) => {
    const prior = ctx.render.skeletonVolumes.get(actor);
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
      if (ctx.crowd.sourceView.get(crowd.type) === actor.view || !ctx.crowd.volumeBound.has(crowd.type)) {
        crowd.type.setSkeletonVolume(shared.texture, binding.metaTexture);
        ctx.crowd.volumeBound.add(crowd.type);
        if (!ctx.crowd.segMetaWarned) {
          ctx.crowd.segMetaWarned = true;
          console.warn('[crowd] segVolumeMeta is per-type from the first attached actor; '
            + 'other instances fall back to cluster bone culling (stage-a gap)');
        }
      }
    } else {
      actor.view.setBoneCullMode('segment');
    }
    // Analytic primitive gradients cannot represent a sampled field.
    actor.view.uniforms.normalGradientCfg.value.x = 0;
    ctx.render.skeletonVolumes.set(actor, { ...state, key, binding });
  };
  const releaseSkeletonActor = (actor: ZombieActor) => {
    actor.crowd?.type.detach(actor.crowd.slot);
    ctx.render.skeletonSources.delete(actor);
    const volume = ctx.render.skeletonVolumes.get(actor);
    if (!volume) return;
    volume.binding.dispose();
    releaseVolumeAtlas(volume.key);
    ctx.render.skeletonVolumes.delete(actor);
  };
  import.meta.hot?.dispose(() => {
    ctx.render.segMeshRenderer?.dispose();
    ctx.render.segMeshCache?.dispose();
    for (const state of ctx.render.skeletonVolumes.values()) state.binding.dispose();
    ctx.render.skeletonVolumes.clear();
    for (const atlas of ctx.render.sharedVolumeAtlases.values()) atlas.texture.dispose();
    ctx.render.sharedVolumeAtlases.clear();
    ctx.render.segVolumeCache?.dispose();
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
  ctx.render.boneCull = GAME_BONE_CULL_MODE !== 'off';
  // Three-way cull state (bone-segment spheres): boneCull stays the boolean
  // view (off vs any cull) the old seam reports.
  ctx.render.boneCullMode = GAME_BONE_CULL_MODE;

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
  ctx.render.sdfLayer.setDepthGate(GAME_DEPTH_GATE > 0.5);
  ctx.render.sdfLayer.setDepthPreEnabled(GAME_DEPTH_PREPASS > 0.5);
  // TEMPORAL REPROJECTION START (plan 2026-09-10). SHIPS ON (owner,
  // 2026-09-10, after the own-body gate): march pass p50 14.9 -> 11.3 ms
  // on the room-4 bench (walk 11.0 -> 7.0, gib 18.0 -> 13.8), no visible
  // artefacts. ?tstart=0 pins the bit-identical march;
  // __sdfGame.setTemporalStart(on, margin, slope) flips it live.
  ctx.render.sdfLayer.setTemporalStart(new URLSearchParams(location.search).get('tstart') !== '0');
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
  ctx.render.sdfLayer.setFieldStyle('bodies');
  ctx.render.sdfLayer.setFieldComb(0.6);
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
  ctx.boot.fieldsBoot = parseIntParam(new URLSearchParams(location.search).get('fields'), { min: 2, max: 8 });
  if (ctx.boot.fieldsBoot !== null) ctx.render.sdfLayer.setFieldCount(ctx.boot.fieldsBoot);

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
      ctx.render.sdfScale = Math.min(1, Math.max(0.2, scale));
      ctx.render.sdfLayer.setScale(ctx.render.sdfScale);
      ctx.boot.deferredApi?.setScale(ctx.render.sdfScale);
      const alpha = parseFloatParam(accumSearch.get('accumalpha'), { min: 0.01, max: 1 });
      ctx.render.sdfLayer.setTemporalAccum(true, alpha ?? undefined);
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
  ctx.render.upscaleAb = { mode: 'model', config: null, model: null, modelName: null, fieldStyle: ctx.render.sdfLayer.fieldStyle };
  ctx.render.upscaleAbLabel = null;
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
  {
    const upSearch = new URLSearchParams(location.search);
    const upRaw = upSearch.get('upscale');
    if (upRaw === 'trained') {
      const name = upSearch.get('upscalemodel');
      if (!name) {
        console.error('[upscale] ?upscale=trained needs &upscalemodel=<name> — the stage stays off');
      } else {
        try {
          await enableTrainedUpscale(ctx, name, upSearch.get('upscalelayout') ?? undefined, false);
        } catch (err) {
          console.error(`[upscale] trained model ${name} not loaded — the stage stays off: ${String(err)}`);
        }
      }
    } else if (upRaw === null) {
      // DEFAULT (owner 2026-09-13): the shipped stage for this graphics level, with CAS sharpen.
      // `?upscale=0` is the native march (the pre-stage picture); the U key still cycles
      // native / nearest / model. NOTE this displaces the 'bodies' field style default: the stage
      // forces fields off (the fields+stage stack was tried and reverted 2026-09-12).
      const ship = SHIPPED_UPSCALE[ctx.boot.graphics];
      try {
        await enableTrainedUpscale(ctx, ship.name, undefined, false, ship.url);
        ctx.render.sdfLayer.upscaleStage?.setSharpen(SHIPPED_UPSCALE_SHARPEN);
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
      ctx.render.sdfScale = UPSCALE_SCALE;
      ctx.render.sdfLayer.setScale(ctx.render.sdfScale);
      ctx.boot.deferredApi?.setScale(ctx.render.sdfScale);
      ctx.render.sdfLayer.setUpscale(cfg);
      ctx.render.upscaleAb.config = cfg;
      updateUpscaleAbLabel(ctx);
    }
    // `?upscalesharpen=0..1`: contrast-adaptive sharpen over the stage output (UPSCALE_SHARPEN_WGSL).
    // Live: __sdfGame.setUpscaleSharpen(x).
    const sharpenRaw = upSearch.get('upscalesharpen');
    if (sharpenRaw !== null && ctx.render.sdfLayer.upscaleStage) ctx.render.sdfLayer.upscaleStage.setSharpen(Number(sharpenRaw));
    else if (upRaw === 'trained' && ctx.render.sdfLayer.upscaleStage) ctx.render.sdfLayer.upscaleStage.setSharpen(SHIPPED_UPSCALE_SHARPEN);
    const sharpenMode = upSearch.get('upscalesharpenmode');
    if (sharpenMode === 'unsharp' && ctx.render.sdfLayer.upscaleStage) ctx.render.sdfLayer.upscaleStage.setSharpenMode('unsharp');
  }
  // Headless A/B seams (2026-08-27 hull-holes diagnosis): ship defaults stay
  // ON/ON; the driver flips these between captures. Mirrors the lab's
  // __sdfLab.setOccluder.
  ctx.render.hullExclusionsEnabled = true;
  ctx.render.occluderDesired = true;

  // -----------------------------------------------------------------------
  mark('zombies-start');
  // Zombies. One compiled .blob, ten bodies; seeds/headings vary, the
  // character does not (12 prims each — the cheap one, on purpose).
  // -----------------------------------------------------------------------
  ctx.boot.doc = parseBlob(zombieBlobSrc);
  ctx.vfx.face = compileFace(ctx.boot.doc);
  ctx.vfx.flesh = compilePalette(ctx.boot.doc) ?? { ...FLESH_PRESETS['henenlotter-latex'] };
  ctx.vfx.faceTex = new THREE.TextureLoader().load(ZOMBIE_FLAT.url);
  ctx.vfx.faceTex.magFilter = THREE.NearestFilter;
  ctx.vfx.faceTex.minFilter = THREE.NearestFilter;
  ctx.vfx.faceTex.generateMipmaps = false;
  ctx.vfx.faceTex.flipY = true;
  const [fx, fy, fw, fh, fsw, fsh] = ZOMBIE_FLAT.rect;
  ctx.vfx.faceAtlas = new THREE.Vector4(fw / fsw, fh / fsh, fx / fsw, fy / fsh);

  /** Face textures BY CHARACTER, loaded once and shared by every body of that
   *  kind. The zombie's stays the module-level pair above (every zombie wears
   *  one sheet); anything else gets its own from the registry.
   *
   *  THIS IS THE TRAP THE SPEC NAMED. game-main hardcoded ZOMBIE_FLAT for
   *  every body, so spawning the soldier through that path would have dressed
   *  him in the zombie's face — and one bad key in his sheet block already
   *  cost an hour on 2026-09-04 producing exactly that symptom. */
  ctx.vfx.faceCache = new Map<string, { tex: THREE.Texture; atlas: THREE.Vector4; mean: number }>();

  ctx.probes.weight = DEFAULT_PROBE_WEIGHT;

  /** Sever dispatch indirection — actors are built before the weapon block;
   *  the grapeshot wiring below assigns this once the chunk spawner exists. */
  ctx.boot.onSeverDispatch = null;

  ctx.boot.tilesPlaytest = import.meta.env.DEV && new URLSearchParams(location.search).has('tiles-playtest');
  ctx.boot.gameTiles = createGameTilePlaytest({
    allowed: ctx.boot.tilesPlaytest,
    capacity: () => ({ widthPx: Math.max(960, ctx.render.postAa.contentSize.width), heightPx: Math.max(600, ctx.render.postAa.contentSize.height) }),
    createBinding: (w, h) => createComputeTileBinding(ctx.boot.handle.renderer, w, h),
  });
  ctx.boot.tilesButton = ctx.boot.tilesPlaytest ? document.createElement('button') : null;
  const updateTilesButton = () => {
    if (!ctx.boot.tilesButton) return;
    const d = ctx.boot.gameTiles.diagnostics();
    const fallback = Object.values(d.fallbacks).reduce((n, v) => n + v, 0);
    const label = `Tile culling: ${d.enabled ? 'ON' : 'OFF'} [F6]${fallback ? ` · ${fallback} fallback` : ''}`;
    if (ctx.boot.tilesButton.textContent !== label) ctx.boot.tilesButton.textContent = label;
  };
  const setGameTiles = (on: boolean) => {
    ctx.boot.gameTiles.setEnabled(on);
    ctx.telemetry.telemetry.event('tile-culling', ctx.boot.gameTiles.diagnostics() as unknown as Record<string, unknown>);
    updateTilesButton();
  };
  if (ctx.boot.tilesButton) {
    ctx.boot.tilesButton.style.cssText = 'position:fixed;right:12px;top:52px;z-index:10001;padding:8px;background:#171b20;color:#eee;border:1px solid #687079';
    ctx.boot.tilesButton.onclick = () => setGameTiles(!ctx.boot.gameTiles.diagnostics().enabled);
    document.body.appendChild(ctx.boot.tilesButton);
    updateTilesButton();
  }
  const tilesKey = (e: KeyboardEvent) => {
    if (ctx.boot.tilesPlaytest && e.code === 'F6' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault(); setGameTiles(!ctx.boot.gameTiles.diagnostics().enabled);
    }
  };
  window.addEventListener('keydown', tilesKey);
  refreshActorTiles = () => {
    if (!ctx.boot.tilesPlaytest) return;
    const timing = ctx.telemetry.telemetry.begin();
    camera.updateMatrixWorld(); camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
    const size = ctx.render.sdfLayer.targetSize;
    ctx.boot.gameTiles.refresh(camera, { widthPx: size.width, heightPx: size.height }, ctx.world.actors.map(a => a.view));
    ctx.telemetry.telemetry.end('tile-binning-submit', timing);
    updateTilesButton();
  };
  import.meta.hot?.dispose(() => {
    refreshActorTiles = () => {}; ctx.boot.gameTiles.dispose(); ctx.boot.tilesButton?.remove();
    window.removeEventListener('keydown', tilesKey);
  });
  // Owner-approved hybrid normals; unsupported surfaces retain calcNormal.
  ctx.telemetry.normalGradientMode = 1;
  ctx.telemetry.normalGradientDebug = 0;
  ctx.boot.errors = [];
  ctx.boot.nextId = 1;
  /** Requested state of the wound union-reach cull (ships ON) — tracked
   *  because the uniform alone cannot say it (see the woundCull getter). */
  ctx.vfx.woundCullRequested = true;

  // The wound panel's tuning state (wound-panel.ts). Lives HERE — before the
  // boot loop — because one of its eight keys, boneRatio, shapes buildBody's
  // bone derivation, so applying it is a REBUILD through the same spawn path
  // as boot. defaultsFrom equals the FleshMaterial defaults and surfCfg3's
  // uniform defaults, so an untouched panel is exactly the pre-panel page —
  // EXCEPT the two entrails knobs whose live defaults live in
  // entrails-spawn (task 5 tuned GUT_DROPLET_SIZE to 0.3 after the panel
  // table froze 0.12), so they are re-seeded from the constants just below.
  ctx.vfx.woundTuning = defaultsFrom(WOUND_KEYS) as WoundTuningValues;
  // Boot parity: the panel's record must state what the page ACTUALLY does
  // before anyone drags a slider — gut ropes spawn at GUT_DROPLET_SIZE and
  // slug spill rolls at SPILL_CHANCE.slug. Seeding (rather than reading the
  // constants at the use sites) keeps one writer: dragging the slider later
  // overrides the seeded value and every later spawn honours it.
  ctx.vfx.woundTuning.gutSize = GUT_DROPLET_SIZE;
  ctx.vfx.woundTuning.spillChance = SPILL_CHANCE.slug;
  // Same boot parity for the spring knobs (organs r3): the table's defaults
  // say what the panel SHOWS; these say what the page DOES until a slider
  // moves. One writer: the slider override below.
  ctx.vfx.woundTuning.coilTightness = GUT_TUNING.coilTightness;
  ctx.vfx.woundTuning.springiness = GUT_TUNING.springiness;
  /** The owner's explicit bone ratio; null = defer to the doc (absent →
   *  DEFAULT_BONE_RATIO inside buildBody, and a later authored `bones ratio`
   *  would win untouched). Once the owner MOVES the slider their value wins
   *  every later build — an explicit setting clobbering an authored ratio is
   *  the requested semantics, so there is no extra flag machinery. */
  ctx.render.boneRatioOverride = null;

  /** The panel → field entry point, exposed on __sdfGame.setWoundTuning.
   *  The ramp trio, the viscera pair and organAmp write uniforms live; gutSize,
   *  spillChance, coilTightness and springiness take effect on the next spawn
   *  / next roll (gutSize and the spring pair only shape ropes spawned from
   *  now on — existing droplets keep their size, they are MOVED, not resized,
   *  by the frame loop); boneRatio rebuilds the cast. */
  function applyWoundTuning(o: Partial<WoundTuningValues>): void {
    let ramp = false;
    if (o.woundDepthAmp !== undefined) { ctx.vfx.woundTuning.woundDepthAmp = o.woundDepthAmp; ramp = true; }
    if (o.fatDepth !== undefined) { ctx.vfx.woundTuning.fatDepth = o.fatDepth; ramp = true; }
    if (o.muscleDepth !== undefined) { ctx.vfx.woundTuning.muscleDepth = o.muscleDepth; ramp = true; }
    if (o.visceraAmp !== undefined) { ctx.vfx.woundTuning.visceraAmp = o.visceraAmp; ramp = true; }
    if (o.visceraDepth !== undefined) { ctx.vfx.woundTuning.visceraDepth = o.visceraDepth; ramp = true; }
    if (o.organAmp !== undefined) { ctx.vfx.woundTuning.organAmp = o.organAmp; ramp = true; }
    // MEAT DETAIL (2026-09-12): the four MEAT sliders write meatCfg live through the same re-apply.
    // (First cut forgot these four lines — the sliders moved the record and nothing reached the field.)
    for (const k of ['meatAmp', 'meatClot', 'meatGlint', 'meatCrevice'] as const) {
      if (o[k] !== undefined) { ctx.vfx.woundTuning[k] = o[k]!; ramp = true; }
    }
    if (ramp) for (const a of ctx.world.actors) applyWoundRamp(ctx, a.view);   // chunks copy the body template's meatCfg at spawn
    if (o.gutSize !== undefined) ctx.vfx.woundTuning.gutSize = o.gutSize;
    // Spring knobs (organs r3): read at makeGutChain time in spillVerdict, so
    // they shape every rope spawned from now on; existing ropes keep theirs.
    if (o.coilTightness !== undefined) ctx.vfx.woundTuning.coilTightness = o.coilTightness;
    if (o.springiness !== undefined) ctx.vfx.woundTuning.springiness = o.springiness;
    if (o.spillChance !== undefined) {
      ctx.vfx.woundTuning.spillChance = o.spillChance;
      // The roll reads the shared table (entrails-spawn.shouldSpill), so
      // overriding slug there is the whole override — no second source of
      // truth. blast spill stays 1.0.
      SPILL_CHANCE.slug = o.spillChance;
    }
    if (o.boneRatio !== undefined && o.boneRatio !== ctx.vfx.woundTuning.boneRatio) {
      ctx.render.boneRatioOverride = o.boneRatio;
      ctx.vfx.woundTuning.boneRatio = o.boneRatio;
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
  ctx.probes.probesParam = new URLSearchParams(location.search).get('probes');
  ctx.probes.probesOff = ctx.probes.probesParam === '0' || ctx.probes.probesParam === 'off';
  ctx.world.roomProbes = createRoomProbes({
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
      stampLevelProbeRoom(ctx, roomId);
    },
  });
  if (ctx.probes.probesOff) ctx.world.roomProbes.setProbes(0, -1);
  ctx.probes.gather = createProbeGatherBinding(ctx.boot.handle.renderer, {
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
  if (!ctx.boot.deferredMode) {
    const gatherNode = ctx.probes.gather.probeDynNode;
    for (const r of ROOMS) {
      const slots = createProbeLevelSlots(gatherNode);
      const node = new ProbeLightingNode(slots);
      ctx.lighting.levelProbeNodes.set(r.id, node);
      // The room's grid lands on these four slots when its bake arrives;
      // the cfg is the LEVEL's (stampLevelProbeRoom), not the bodies' —
      // bind() would write the body weight and the 4x-fill gain there.
      ctx.world.roomProbes.bind({
        probeTex: slots.probeTex, probeMin: slots.probeMin, probeInvExtent: slots.probeInvExtent,
        probeDims: slots.probeDims, probeCfg: { value: new THREE.Vector4() },
      }, r.id);
      stampLevelProbeRoom(ctx, r.id);
    }
    for (const [roomId, node] of ctx.lighting.levelProbeNodes) ctx.world.levelLightLists.set(roomId, levelLightsNode(levelSceneLights(ctx, roomId), node));
    // fromMaterial is three's own classic-to-node conversion (NodeLibrary.js);
    // it is what the builder calls per pipeline, just not in the typings.
    const library = ctx.boot.handle.renderer.library as unknown as { fromMaterial(m: THREE.Material): THREE.NodeMaterial | null };
    for (const mesh of ctx.world.levelGroup.children) {
      if (!(mesh instanceof THREE.Mesh)) continue;
      const list = ctx.world.levelLightLists.get(roomIdAt(mesh.position.x, mesh.position.z));
      if (!list) continue;
      const nm = library.fromMaterial(mesh.material as THREE.Material);
      if (!nm) continue;
      nm.lightsNode = list;
      mesh.material = nm;
      ctx.world.levelNodeMaterials.push(nm);
    }
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
    let crowdAttach: { type: CrowdType; slot: number } | null = null;
    if (ctx.crowd.on) {
      const t = crowdTypeFor(ctx, name, room.id);
      const slot = t.reserveSlot();
      if (slot < 0) console.warn('[crowd] type full', name);
      else crowdAttach = { type: t, slot };
    }
    const crowdViewOpts: GpuViewOpts = crowdAttach
      ? {
          sink: crowdAttach.type.atlas.sink(crowdAttach.slot),
          sinkTexture: crowdAttach.type.atlas.texture,
          records: crowdAttach.type.records,
          slot: crowdAttach.slot,
        }
      : {};
    const viewGpuOpts: GpuViewOpts = {
      // The dynamic probe layer's storage node (P3/P4). Bound at material
      // creation like the tile binding — a storage node cannot be rebound.
      ...(ctx.probes.gather ? { probeDyn: { node: ctx.probes.gather.probeDynNode } } : {}),
      ...crowdViewOpts,
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
    if (ctx.boot.deferredMode) scene.add(rigGroup);
    const character = createCharacterView({
      name,
      start,
      renderer: ctx.boot.handle.renderer,
      scene: ctx.boot.deferredMode ? rigGroup : scene,
      effectsScene: ctx.vfx.characterEffects.scene,
      errors: errs,
      // The panel's ratio, once the owner has touched it, overrides whatever
      // the doc would have done (nothing today; an authored ratio from the
      // bones block, later).
      ...(ctx.render.boneRatioOverride !== null ? { boneRatio: ctx.render.boneRatioOverride } : {}),
      gpu: viewGpuOpts,
    });
    const placed = character.body;
    const view = character.gpu;
    ctx.boot.gameTiles.track(view, tileBinding);
    // Bone tubes: with the mesh ON the field stops packing bone rows (task 5).
    view.setPackBones(!ctx.render.boneMesh);
    view.applyMaterial(name === 'soldier' ? character.palette ?? ctx.vfx.flesh : ctx.vfx.flesh,
      LIGHT_PRESETS['practical-hard-key']);
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
      // attach/detach is the crowd's visibility gate, so the per-body proxy
      // and its depth-pre twin stay in the scene but hidden. They ARE drawn
      // while the crowd program is not ready: `setBodies` re-shows them for the
      // march pass, which is the degrade that keeps members visible.
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
      ...(name === 'soldier' ? {
        mind: makeSoldierMind(),
        onFire: ({ origin: muz, direction: dir }) => {
          if (!character.prop || character.prop.released) return;
          ctx.world.encounter.shot(zombieId);
          // ONE barrel: the double-barrel volley is the player's signature,
          // and the soldier throwing the same wall of lead reads as a second
          // player rather than an enemy.
          ctx.weapon.soldierPellets.push(...spawnPellets(muz, dir, 1, seedFromUnit(rngStreams.misc())));
        },
      } : {}),
      profile: characterEntry(name).profile,
      seed: 1337 + ctx.boot.nextId * 101,
      bounds: wanderBounds(room),
      furniture: roomFurniture,
      navigation: ctx.world.encounterNav,
      onSever: (piece, stumpWound) => ctx.boot.onSeverDispatch?.(actor, piece, stumpWound),
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
      ctx.render.skeletonSources.set(actor, buildSkeletonSources(actor, name));
      actor.view.setPackBones(false);
    }
    // Task 3 is zombie-first. Other characters keep exact procedural bones
    // until their source fixtures have been validated.
    if (ctx.render.segVolumeCache && name === 'zombie') bindSkeletonVolume(actor, name);
    ctx.world.encounterHomes.set(actor.id,[...start] as Vec3);
    return actor;
  }

  function spawnAll(errs: string[]): void {
    for (const room of ROOMS) {
      for (const [index,start] of spawnPoints(room).entries()) {
        const name = index < (room.soldiers ?? 0) ? 'soldier' : 'zombie';
        ctx.world.actors.push(spawnEnemy(name, room, start, errs));
      }
    }
  }

  spawnAll(ctx.boot.errors);
  setLoader(ctx, 'level + actors');
  if (ctx.boot.errors.length > 0) {
    console.error('[sdf-game] body errors:', ctx.boot.errors.join(' | '));
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
  ctx.bake.enabled = new URLSearchParams(location.search).get('chunkbake') !== '0'
    && (GAME_CHUNK_BAKE as 0 | 1) === 1;
  ctx.bake.chunks = [];
  ctx.bake.reference = false;
  ctx.world.soldierCorpses = null;
  // One material for every baked chunk — one pipeline, N meshes. Lighting
  // uniforms are LIVE (refreshed per frame beside the bone instancer's);
  // albedo is per-vertex so sharing costs nothing.
  ctx.bake.mat = null;
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
  ctx.world.litChunkMaterials = [];
  ctx.bake.seed = null;
  ctx.bake.totalBakes = 0;
  ctx.bake.lastBakeMs = 0;
  ctx.bake.lastBakeInfo = null;
  // Bone tubes (task 5): the instancer owns its own light set — seed it once
  // from body 1's view, which just took the LIGHT_PRESETS apply above, so
  // the tube pass cannot drift from the march's key.
  {
    const v = ctx.world.actors[0]!.view.uniforms;
    ctx.render.boneInstancer.uniforms.lightDir.value.copy(v.lightDir.value);
    ctx.render.boneInstancer.uniforms.keyColor.value.copy(v.keyColor.value);
    ctx.render.boneInstancer.uniforms.lightCfg.value.copy(v.lightCfg.value);
    ctx.render.boneInstancer.uniforms.boneColor.value.copy(v.boneColor.value);
    ctx.render.boneInstancer.uniforms.deepColor.value.copy(v.deepColor.value);
    // Ambient fill: the enclosure's mean wall albedo weighted by the bounce
    // probe weight, on top of the preset's fill — a cheap stand-in for the
    // march's ambientAt probe so cavity bone sits in the same light as flesh.
    {
      const walls = [v.wallNegX, v.wallPosX, v.wallNegY, v.wallPosY, v.wallNegZ, v.wallPosZ].map(w => w.value);
      let mr = 0, mg = 0, mb = 0;
      for (const c of walls) { mr += c.r / 6; mg += c.g / 6; mb += c.b / 6; }
      const fill = v.lightCfg.value.y, key = v.keyColor.value, pw = v.bounceCfg.value.x;
      ctx.render.boneInstancer.uniforms.ambient.value.setRGB(
        fill * key.r + pw * mr * 0.5, fill * key.g + pw * mg * 0.5, fill * key.b + pw * mb * 0.5);
    }
    // skeleton=mesh: the segment renderer owns the SAME uniform value types
    // (boneInstancerUniforms) — seed it identically so mesh bone cannot
    // drift from the march's key either.
    if (ctx.render.segMeshRenderer) {
      ctx.render.segMeshRenderer.uniforms.lightDir.value.copy(v.lightDir.value);
      ctx.render.segMeshRenderer.uniforms.keyColor.value.copy(v.keyColor.value);
      ctx.render.segMeshRenderer.uniforms.lightCfg.value.copy(v.lightCfg.value);
      ctx.render.segMeshRenderer.uniforms.boneColor.value.copy(v.boneColor.value);
      ctx.render.segMeshRenderer.uniforms.deepColor.value.copy(v.deepColor.value);
      ctx.render.segMeshRenderer.uniforms.ambient.value.copy(ctx.render.boneInstancer.uniforms.ambient.value);
    }
  }
  // Baked chunks (close-up task 5): same seed from body 1's view — the
  // mesh shade fn is boneShade's formula, so it takes the same diet. The
  // per-frame FLASHLIGHT refresh happens in the render callback beside the
  // bone instancer's; this seed is the room's key/ambient.
  {
    const v = ctx.world.actors[0]!.view.uniforms;
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
    ctx.bake.seed = seedBaked;
    if (ctx.bake.mat) ctx.bake.seed(ctx.bake.mat);
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
    ctx.render.segMeshRenderer?.clear();
    ctx.render.segMeshCache?.dispose();
    ctx.world.actors.length = 0;
    const errs: string[] = [];
    spawnAll(errs);
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
  /** Set when the weapon fires; consumed by the next tick to turn heads in
   *  the player's room. Sticky rather than instantaneous because a shot lands
   *  in an event handler, not in the frame callback. */
  ctx.weapon.shotAlert = false;

  // -----------------------------------------------------------------------
  mark('player-start');
  // Player: pointer lock + WASD + gravity + capsule-vs-AABB.
  // -----------------------------------------------------------------------
  // BOOT SELECT. `?room=6` (or any room id, or its name) starts the player at
  // that room's centre facing +z — the tuning loop's entry point, so a reload
  // with a different ?fxsize lands you straight in the arena instead of walking
  // there. Absent = PLAYER_START, bit-identical to before this existed. The
  // in-page equivalent is __sdfGame.teleport(id).
  ctx.boot.roomParam = new URLSearchParams(location.search).get('room');
  ctx.boot.room = ctx.boot.roomParam === null ? null
    : ROOMS.find(r => r.name === ctx.boot.roomParam
      || r.id === Number(ctx.boot.roomParam)) ?? null;
  ctx.player.player = {
    pos: ctx.boot.room
      ? [(ctx.boot.room.minX + ctx.boot.room.maxX) / 2, 0, (ctx.boot.room.minZ + ctx.boot.room.maxZ) / 2]
      : [PLAYER_START.x, 0, PLAYER_START.z],
    vel: [0, 0, 0],
    yaw: ctx.boot.room ? 0 : PLAYER_START.yaw,
    pitch: PLAYER_START.pitch,
    grounded: true,
  };
  ctx.player.keys = new Set<string>();
  ctx.boot.canvas = ctx.boot.handle.canvas;
  ctx.boot.canvas.addEventListener('click', () => {
    if (document.pointerLockElement !== ctx.boot.canvas) ctx.boot.canvas.requestPointerLock();
  });
  document.addEventListener('pointerlockchange', () => {
    ctx.boot.hud.lockHint = document.pointerLockElement !== ctx.boot.canvas;
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
  ctx.player.pendingDx = 0, ctx.player.pendingDy = 0;
  /** Edge events for the frame about to tick: 0 = none, 1 = one barrel,
   *  2 = both; `pendingReload` = a reload started this frame. */
  ctx.weapon.pendingFire = 0;
  ctx.weapon.pendingReload = false;
  /** TRUE while a recording is being replayed. The listeners still fire but
   *  inject nothing — the player owns the frame. */
  ctx.demo.replayActive = false;
  /** Frames consumed by the current replay (demoInfo().frame). */
  ctx.demo.replayFrame = 0;
  /** The input frame the next tick consumes. Live: readInputFrame(); replay:
   *  the player's next(). */
  ctx.player.currentInputFrame = { keys: [], dx: 0, dy: 0, fire: 0, reload: false, look: [0, 0] };
  /** The previous frame's key set, so applyInputFrame can derive rising edges
   *  (toggles like slug mode) from an absolute held-key snapshot. */
  ctx.player.prevInputKeys = new Set<string>();
  /** The active recorder, or null. Pushed once per tick while recording. */
  ctx.demo.recorder = null;

  document.addEventListener('mousemove', (e) => {
    if (document.pointerLockElement !== ctx.boot.canvas) return;
    if (ctx.demo.replayActive) return; // the player owns the pose
    ctx.player.pendingDx += e.movementX;
    ctx.player.pendingDy += e.movementY;
  });
  window.addEventListener('keydown', (e) => {
    if (ctx.demo.replayActive) return;
    ctx.player.keys.add(e.code);
  });
  window.addEventListener('keyup', (e) => ctx.player.keys.delete(e.code));
  ctx.player.parked = DEFAULT_PROBE_WEIGHT;

  // GRAPESHOT INPUT. Left = one barrel, right = both. The first click only
  // locks the pointer; shots need lock so a stray desktop click cannot fire.
  // DYNAMITE (slot 2) takes the same left button but as a HELD input: press
  // lights the fuse, release throws (fpv.ts's cook machine). Right button stays
  // a shotgun verb — a bundle has no second barrel.
  ctx.boot.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  ctx.boot.canvas.addEventListener('mousedown', (e) => {
    if (document.pointerLockElement !== ctx.boot.canvas) return;
    if (ctx.demo.replayActive) return; // the player owns the shot
    if (!slotReady(ctx.weapon.slotState)) return;            // mid-switch: no verbs at all
    if (ctx.weapon.slotState.live === 'dynamite') {
      if (e.button === 0) ctx.dynamite.press = true;        // light it
      return;
    }
    // SLOT 3: left click only, deferred to the tick like every other edge.
    if (ctx.weapon.flare?.onMouseDown(e.button)) return;
    // Deferred to the tick (see the input seam note): an edge event must land
    // on exactly one frame or a recording cannot replay it. The dynamite press
    // above is already a flag the tick consumes, so it is on the same seam.
    if (e.button === 0) ctx.weapon.pendingFire = 1;
    else if (e.button === 2) ctx.weapon.pendingFire = 2;
  });
  // The release half of the cook. Without this the bundle could only ever cook
  // to an overcook, which is not the weapon.
  window.addEventListener('mouseup', (e) => {
    if (e.button !== 0) return;
    if (document.pointerLockElement !== ctx.boot.canvas) return;
    if (ctx.weapon.slotState.live !== 'dynamite') return;
    ctx.dynamite.release = true;
  });

  // The seam for the grapeshot dispatch: a view-model hangs off this group,
  // which rides the camera every frame.
  ctx.weapon.viewModelAnchor = new THREE.Group();
  ctx.weapon.viewModelAnchor.name = 'view-model-anchor';
  // Ride height of the whole view-model (gun + orb hands move together).
  // Owner playtest 2026-08-26: the gun sat high enough to crowd the frame.
  // Captured current / −5 cm / −10 cm from the same spot and compared: −5 cm
  // frees the centre of the frame while the breech and hammers — the detail
  // that chose this model — stay fully in frame; −10 cm starts to sink the
  // grip out of the bottom edge. −5 cm is the shipped height.
  ctx.weapon.viewModelAnchor.position.y = -0.05;
  /** Everything that leans and bobs together: gun, hands, flash, smoke, cases. */
  ctx.weapon.aimRig = null;
  // One rig for the whole view model, so the free-aim lean and the walk bob are
  // a single transform instead of being applied to the gun, both hands, the
  // flash, the smoke and the cases separately (and inevitably inconsistently).
  ctx.weapon.aimRig = new THREE.Group();
  ctx.weapon.aimRig.name = 'aim-rig';
  ctx.weapon.viewModelAnchor.add(ctx.weapon.aimRig);
  // WEAPON SLOT 3 (flare test harness, game-flare.ts): its own rig on aimRig.
  ctx.weapon.flare = createFlareHarness(ctx, {
    burning: ctx.vfx.burning, traceSlugHitFrom: withCtx(ctx, traceSlugHitFrom), eye: () => eyeOf(ctx.player.player), aimDir: withCtx(ctx, aimDir),
  });
  // WEAPON SLOT 1's own subtree. Everything the grapeshot owns — the gun, both
  // orb hands, the muzzle flash, the smoke pool, the ejected/loaded cases and
  // its point light — hangs off THIS rather than off aimRig directly, so a
  // weapon switch is ONE transform (drop it out of frame) instead of a
  // per-node flag list that would silently miss whatever gets added next.
  // aimRig keeps the free-aim lean and the walk bob; gunRig carries only the
  // holster travel.
  ctx.weapon.gunRig = new THREE.Group();
  ctx.weapon.gunRig.name = 'gun-rig';
  ctx.weapon.aimRig.add(ctx.weapon.gunRig);
  camera.add(ctx.weapon.viewModelAnchor);
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
  ctx.weapon.hingePivot = null;
  /** The GLB's own muzzle locators, kept so muzzleWorld() can read their LIVE
   *  world position each shot rather than a position sampled once at load. */
  ctx.weapon.muzzleNodes = [];
  /** Driven GLB nodes. Shells and the extractor live INSIDE Barrels, so they
   *  inherit the break rotation and the runtime only ever writes their LOCAL
   *  position -- no rotated basis is computed anywhere. */
  ctx.weapon.shellNodes = [];
  ctx.weapon.breechNodes = [];
  ctx.weapon.extractorNode = null;
  ctx.weapon.topLeverNode = null;
  /** Each shell's seated local position, so the extract slide is a delta. */
  ctx.weapon.shellRestZ = [];
  ctx.weapon.extractorRestZ = 0;
  ctx.weapon.gripHandGroup = null;
  ctx.weapon.foreHandGroup = null;
  ctx.weapon.gunGroup = null;
  ctx.weapon.flashGroup = null;
  ctx.weapon.flashMaterial = null;
  ctx.weapon.flashLight = null;
  ctx.weapon.handMaterial = null;
  /** The loaded arms, for the gate's seam. */
  ctx.weapon.arms = null;
  /** Gun body materials, kept so the finish is tunable at runtime. */
  ctx.weapon.gunMaterials = [];
  const FLASH_VARIANTS = 4;
  ctx.weapon.flashTextures = [];
  const SMOKE_COUNT = 7;
  ctx.vfx.smokePuffs = [];
  ctx.weapon.ejectedShells = [];
  ctx.weapon.loadShells = [];
  /** Where the last spent case was placed, in WORLD space, the moment it was
   *  handed from the extraction slide to the free tumble. Step 5b's proof
   *  that the eject origin is a real chamber mouth: this is asserted against
   *  breechWorld() rather than trusted by construction. */
  ctx.weapon.lastEjectOrigin = null;
  const Y_UP = new THREE.Vector3(0, 1, 0);
  const _tmpV = new THREE.Vector3();
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
  /** Seconds since the last shot, and how many barrels it was. Drives recoil. */
  ctx.weapon.fireAge = Infinity;
  ctx.weapon.fireBarrels = 1;

  // ——— FREE AIM (Realms of the Haunting scheme) ———————————————————————
  // The mouse drives a RETICLE around the viewport; the camera only turns once
  // that reticle pushes past a large central dead zone, and the weapon leans to
  // follow it. Shots go through the reticle, not through screen centre.
  ctx.player.freeAimOn = true;
  ctx.weapon.aim = { x: 0, y: 0 };
  ctx.weapon.yawDeg = 0;
  ctx.weapon.pitchDeg = 0;
  /** Lateral/vertical travel of the whole view model, METRES in camera space.
   *  Smoothed on the same lag as the angles so the gun arrives as one motion
   *  rather than sliding and turning at different rates. */
  ctx.weapon.slideXm = 0;
  ctx.weapon.slideYm = 0;
  /** Metres walked, and the smoothed 0..1 speed envelope. Bob is driven by
   *  DISTANCE so it stays locked to footfalls at any speed. */
  ctx.player.bobDistance = 0;
  ctx.player.bobAmount = 0;
  ctx.player.prevPlayerPos = [0, 0, 0];
  ctx.player.reticleEl = null;
  ctx.weapon.gunReady = false;
  // LOADING SCREEN gate: resolved on BOTH paths below — a failed weapon load
  // still boots the game, and the loader must not hang on it.
  let resolveGunReady: () => void = () => {};
  ctx.weapon.gunReadyPromise = new Promise<void>((r) => { resolveGunReady = r; });
  setLoader(ctx, 'weapon + effects');
  try {
    const gltf = await new GLTFLoader().loadAsync(GUN_GLB);
    // PBR metal is black without something to reflect — this page has no
    // environment and the flesh's hand-written lighting does not apply to a
    // MeshStandardMaterial. Per-material env, kit-overlay style, so the level
    // meshes keep their gallery look.
    const pmrem = new THREE.PMREMGenerator(ctx.boot.handle.renderer);
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
          ctx.weapon.gunMaterials.push(std);
          std.needsUpdate = true;
        }
      }
    });
    ctx.weapon.gunGroup = new THREE.Group();
    ctx.weapon.gunGroup.name = 'grapeshot-k3';
    ctx.weapon.gunGroup.add(gltf.scene);
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
    ctx.weapon.shellNodes = [need('Shell_L'), need('Shell_R')];
    ctx.weapon.breechNodes = [need('Breech_L'), need('Breech_R')];
    ctx.weapon.extractorNode = need('Extractor');
    ctx.weapon.topLeverNode = need('TopLever');
    for (const s of ctx.weapon.shellNodes) ctx.weapon.shellRestZ.push(s.position.z);
    ctx.weapon.extractorRestZ = ctx.weapon.extractorNode.position.z;
    // Rotate about the HINGE, not about the barrel node's own origin -- the
    // latter would swing the barrels through the frame. Standard fix: a pivot
    // group parked at the hinge, with the barrels offset back by the same
    // amount, so the group's rotation IS the break.
    ctx.weapon.hingePivot = new THREE.Group();
    ctx.weapon.hingePivot.position.copy(hingeNode.position);
    (barrels.parent ?? gltf.scene).add(ctx.weapon.hingePivot);
    ctx.weapon.hingePivot.add(barrels);
    barrels.position.sub(hingeNode.position);
    // AXIS NOTE: the model script's "muzzles down -Y" is BLENDER space;
    // Blender's Z-up -> glTF Y-up conversion (x,z,-y) lands them at +Z in
    // GLB space, up stays +Y. rotation.y = PI aims +Z down the camera's -Z
    // (forward) with the hammers still on top. (rotation.x = PI/2 pointed
    // the gun at the sky — first live capture caught it.)
    // FPV pose, carried over from the model script's preview constants so the
    // Blender FPV render and the game agree. Yaw cants the barrels toward
    // screen centre so BOTH bores read; pitch lifts the muzzle off the floor.
    ctx.weapon.gunGroup.rotation.y = Math.PI;
    ctx.weapon.gunGroup.rotation.z = THREE.MathUtils.degToRad(GUN_REST.rollDeg);
    ctx.weapon.gunGroup.rotation.x = THREE.MathUtils.degToRad(GUN_REST.pitchDeg);
    ctx.weapon.gunGroup.position.copy(GUN_REST.pos);
    ctx.weapon.gunRig.add(ctx.weapon.gunGroup);
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
    if (ctx.boot.deferredApi) ctx.boot.deferredApi.router.register(ctx.weapon.gunGroup, 'mesh', 'level-only');

    // Anchor points come off the GLB itself, so they cannot drift from the
    // weapon when its pose changes -- which is what left the support hand
    // floating unattached instead of gripping the fore-end.
    ctx.weapon.viewModelAnchor.updateMatrixWorld(true);
    {
      const mL = new THREE.Vector3(), mR = new THREE.Vector3();
      if (locatorInView(ctx, gltf.scene, 'Muzzle_L', mL) && locatorInView(ctx, gltf.scene, 'Muzzle_R', mR)) {
        MUZZLE_VIEW.copy(mL).add(mR).multiplyScalar(0.5);
      }
      const nL = gltf.scene.getObjectByName('Muzzle_L');
      const nR = gltf.scene.getObjectByName('Muzzle_R');
      if (nL && nR) ctx.weapon.muzzleNodes = [nL, nR];
      if (!locatorInView(ctx, gltf.scene, 'Grip_Hand', GRIP_HAND_REST)) {
        GRIP_HAND_REST.set(GUN_REST.pos.x + 0.02, GUN_REST.pos.y - 0.04, GUN_REST.pos.z + 0.05);
      }
      if (!locatorInView(ctx, gltf.scene, 'Fore_Hand', FORE_HAND_REST)) {
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
    ctx.weapon.arms = await loadGoblinArms(GOBLIN_ARM_GLB, { env, envMapIntensity: 1.1 });
    ctx.weapon.handMaterial = ctx.weapon.arms.skin;
    ctx.weapon.gripHandGroup = ctx.weapon.arms.right;
    ctx.weapon.foreHandGroup = ctx.weapon.arms.left;
    ctx.weapon.gripHandGroup.name = 'fpv-hand-grip';
    ctx.weapon.foreHandGroup.name = 'fpv-hand-fore';
    ctx.weapon.gripHandGroup.position.copy(GRIP_HAND_REST);
    ctx.weapon.foreHandGroup.position.copy(FORE_HAND_REST);
    ctx.weapon.gunRig.add(ctx.weapon.gripHandGroup, ctx.weapon.foreHandGroup);
    aimArms(ctx);
    // DEFERRED G-BUFFER ROUTE: the goblin arms are opaque Standard-material
    // surfaces (skin, bracer, watch screen — game-arms.ts) — same route as
    // the gun, same receiver, same castShadow reasoning.
    if (ctx.boot.deferredApi) {
      ctx.boot.deferredApi.router.register(ctx.weapon.gripHandGroup, 'mesh', 'level-only');
      ctx.boot.deferredApi.router.register(ctx.weapon.foreHandGroup, 'mesh', 'level-only');
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
      const e = makeShell(`shell-eject-${i}`); ctx.weapon.ejectedShells.push(e); ctx.weapon.gunRig.add(e);
      const l = makeShell(`shell-load-${i}`); ctx.weapon.loadShells.push(l); ctx.weapon.gunRig.add(l);
      // DEFERRED G-BUFFER ROUTE: the shells are OPAQUE Standard meshes (red
      // hull, brass head) — level-only like the rest of the viewmodel. They
      // fly and tumble through the forward-composited frame, so this route
      // is also what makes them depth-test against the presented scene
      // (walls occlude a shell that landed behind it).
      if (ctx.boot.deferredApi) {
        ctx.boot.deferredApi.router.register(e, 'mesh', 'level-only');
        ctx.boot.deferredApi.router.register(l, 'mesh', 'level-only');
      }
    }

    // MUZZLE FLASH -- geometry half. Textured, not flat quads: the first pass
    // used untextured PlaneGeometry and read as a bright RECTANGLE (the owner's
    // report). flash-sprite.ts generates a ragged star with real alpha, and a
    // few seeds are pre-baked so repeat fire does not strobe one silhouette.
    for (let i = 0; i < FLASH_VARIANTS; i++) {
      const tex = new THREE.DataTexture(flashPixels(128, 17 + i * 31), 128, 128, THREE.RGBAFormat);
      tex.needsUpdate = true;
      ctx.weapon.flashTextures.push(tex);
    }
    const flashMat = new THREE.MeshBasicMaterial({
      map: ctx.weapon.flashTextures[0], color: 0xffe6bf, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false,
      side: THREE.DoubleSide,
    });
    ctx.weapon.flashGroup = new THREE.Group();
    ctx.weapon.flashGroup.visible = false;
    // Two crossed cards so the star has volume from off-axis, plus a wider,
    // fainter one for the outer glow.
    for (const [roll, scale] of [[0, 1], [Math.PI / 2, 1], [Math.PI / 4, 1.7]] as const) {
      const q = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.34), flashMat);
      q.rotation.z = roll;
      q.scale.setScalar(scale);
      ctx.weapon.flashGroup.add(q);
    }
    // Just CLEAR of the bores: centred exactly on them, half the card sits
    // inside the barrel volume. And depthTest:false does not control draw
    // ORDER -- without a renderOrder the gun still paints over the flash.
    ctx.weapon.flashGroup.position.set(MUZZLE_VIEW.x, MUZZLE_VIEW.y, MUZZLE_VIEW.z - 0.035);
    ctx.weapon.flashGroup.renderOrder = 999;
    for (const c of ctx.weapon.flashGroup.children) c.renderOrder = 999;
    ctx.weapon.gunRig.add(ctx.weapon.flashGroup);
    ctx.weapon.flashMaterial = flashMat;

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
      ctx.vfx.smokePuffs.push({ mesh: m, age: Infinity, vel: new THREE.Vector3(), roll: 0 });
      ctx.weapon.gunRig.add(m);
    }

    // MUZZLE FLASH -- level half. Allocated ONCE at intensity 0 and only ever
    // modulated: adding or removing a light at runtime forces a TSL shader
    // recompile, which would hitch on every trigger pull. Range and power are
    // both up from the first pass, which the owner reported as barely lighting
    // its surroundings.
    ctx.weapon.flashLight = new THREE.PointLight(0xffcf95, 0, 16, 1.7);
    // The deferred coordinator's muzzle candidate reads this (live closure) —
    // its own light entry, never a replay into the body flashlight uniforms.
    ctx.weapon.muzzleLight = ctx.weapon.flashLight;
    // A little AHEAD of the bores, so it throws light down the room instead of
    // mostly onto the gun's own barrels.
    ctx.weapon.flashLight.position.set(MUZZLE_VIEW.x, MUZZLE_VIEW.y, MUZZLE_VIEW.z - 0.10);
    ctx.weapon.gunRig.add(ctx.weapon.flashLight);
    // The level's light lists were built before this light existed.
    refreshLevelLights(ctx);
    ctx.weapon.gunReady = true;
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
    ctx.boot.loopControl.suspend();
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
    await ctx.weapon.gunReadyPromise;
    const t0 = performance.now();
    ctx.boot.warmT0 = t0;
    mark('warm-steps-start');
    let passesCompiled = 0;
    let computesWarmed = 0;
    // A warm that throws is a FAILED warm: the loader gate must say so rather
    // than presenting the resolved promise as success (reviewer fix 2026-09-16b).
    let didFail = false;
    const phases: Record<string, number | number[] | Record<string, number>> = {};
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
      if (ctx.crowd.on) {
        const warmGrid = {
          widthPx: ctx.render.sdfLayer.targetSize.width,
          heightPx: ctx.render.sdfLayer.targetSize.height,
        };
        const perType: number[] = [];
        for (const t of ctx.crowd.types.values()) {
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
      if (ctx.goo.layer) await ctx.goo.layer.precompile(camera);
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
      //
      // COLD-COMPILE CORRECTION (2026-09-18). That "51 s under load" was not
      // load: it is what the march pipelines cost whenever the OS Metal shader
      // cache has no entry for them, i.e. after ANY edit to the march WGSL.
      // Measured by changing one smin constant on unchanged code: drawOnce
      // 1.8 s cached -> 80-101 s cold, 83 s of it the main thread blocked in
      // createShaderModule behind the GPU process's SYNCHRONOUS pipeline
      // builds. Headed Chrome's GPU watchdog kills the GPU process during that
      // stall ("device lost" on the loader), so the compile never completes,
      // is never cached, and every reload fails the same way until something
      // that survives the stall (a headless probe) fills the cache.
      //
      // So the async compile now runs FIRST and is genuinely AWAITED, with the
      // cold per-pass bound instead of the 8 s one whose give-up is what left
      // the queued pipeline not-ready for the real frame. Cold, the wait is
      // idle main-thread time behind the loader (measured 79 s idle, drawOnce
      // 1.2 s after it); cached, it is a few hundred ms. drawOnce stays: it
      // still compiles the main pass / post chain in their live context.
      // HIDE THE CROWD MESHES BEFORE THE BOOT COMPILE (defer-compile task,
      // 2026-09-19). The boot precompile walks VISIBLE objects, so a visible
      // crowd type mesh would queue the crowd program and put its ~48 s cold
      // compile back behind the loader. The background crowd job flips a mesh
      // visible only across its own compileAsync prologue, then hides it again.
      if (ctx.boot.backgroundMode && ctx.crowd.on) {
        for (const t of ctx.crowd.types.values()) { t.mesh.visible = false; t.depthPreMesh.visible = false; }
      }
      // THE GIB / CHUNK MARCH VARIANT (2026-09-18) now compiles in the
      // BACKGROUND set (2026-09-19): detached pieces march through the SHARED
      // chunk material, whose ~240 KB shader no boot object uses. It used to be
      // warmed here behind the loader because the first dismemberment built it
      // SYNCHRONOUSLY mid-game (47.8 s + a second stall, cold). The protection
      // stays; only the WAITING moves — `startBackgroundCompiles` rebuilds this
      // throwaway view right after `ready` and compiles both contexts, and the
      // chunk draw is SKIPPED until the tracker says ready.
      //
      // DEFERRED ROUTE keeps the old behind-the-loader warm: its G-buffer router
      // draws the chunk mesh directly, so the setBodies skip does not cover it.
      // Constant rng: the shared rngStreams must not advance here.
      let warmChunkView: ChunkGpuView | null = null;
      if (!ctx.boot.backgroundMode) {
        try {
          const a0 = ctx.world.actors[0];
          const warmPrims = a0 ? a0.posed().prims.filter((p) => p.op !== 'sub').slice(0, 2) : [];
          const warmFirst = warmPrims[0];
          if (a0 && ctx.bake.material && warmFirst) {
            const warmOrigin: Vec3 = [0, 1, 0];
            const warmState = makeChunk(
              warmFirst.limb, warmOrigin, [0, 0, 0], chunkExtent(warmPrims, warmOrigin), [0, 1, 0], () => 0.5,
            );
            warmChunkView = createChunkGpuView(
              warmState, warmPrims, a0.view.uniforms, undefined, a0.view.volumeTexture, ctx.bake.material, [],
              ctx.boot.deferredMode ? { output: 'surface', shadowReceiver: 'level-only' } : undefined,
            );
            warmChunkView.object.layers.set(SDF_LAYER);
            scene.add(warmChunkView.object);
          }
        } catch (err) {
          console.warn('[warm] gib-variant warm view could not be built — first gib will compile live', err);
        }
      }
      tp = performance.now();
      try {
        await ctx.render.sdfLayer.precompilePasses(scene, camera, { passTimeoutMs: PRECOMPILE_COLD_PASS_TIMEOUT_MS });
        phases.asyncFirst = performance.now() - tp;
        mark('warm-async-first-done');
        tp = performance.now();
        if (!ctx.boot.backgroundMode) {
          if (warmChunkView && ctx.gibs.shutter) {
            await ctx.gibs.shutter.precompileSubject(
              warmChunkView.object, ctx.render.postAa.captureTarget, scene, camera, PRECOMPILE_COLD_PASS_TIMEOUT_MS,
            );
          }
          phases.gibVariant = performance.now() - tp;
          mark('warm-gib-variant-done');
        } else {
          // Moved off the loader path; the real number lands in
          // backgroundDone.gib once startBackgroundCompiles settles it.
          phases.gibVariant = 0;
        }
      } finally {
        if (warmChunkView) {
          scene.remove(warmChunkView.object);
          warmChunkView.dispose();
        }
      }
      tp = performance.now();
      // The fire volume is a post pass that only binds while something burns:
      // switch it on (a dummy capsule, out of view) for this one real frame so
      // its pipelines compile here, not on the first ignite.
      const unwarmFire = ctx.vfx.burning.warmVolume();
      try {
        ctx.boot.handle.drawOnce();
      } finally {
        unwarmFire();
      }
      phases.drawOnce = performance.now() - tp;
      mark('warm-draw-once-done');
      // The SDF layer's own passes: the twins in their real target/MRT context,
      // the fullscreen passes (blit/accum/detail/refine-view/composite) that are
      // in private scenes the traversal above cannot reach, and the upscale
      // stage's per-layer passes. See SdfLayer.precompilePasses.
      tp = performance.now();
      passesCompiled = await ctx.render.sdfLayer.precompilePasses(scene, camera);
      phases.precompile = performance.now() - tp;
      mark('warm-precompile-done');
      // BACKGROUND-SET TIMINGS (defer-compile task). These OBJECTS are shared
      // into `__warmDone.phases`, so a driver that grabbed __warmDone at ready
      // still sees each value as the background job settles. The deferred route
      // defers nothing, so settle the tracker ready here and leave them empty.
      phases.backgroundStart = ctx.boot.warmBackgroundTimes.start;
      phases.backgroundDone = ctx.boot.warmBackgroundTimes.done;
      if (!ctx.boot.backgroundMode) {
        ctx.boot.warmBackground.settle('gib', true);
        if (ctx.crowd.on) ctx.boot.warmBackground.settle('crowd', true);
      }
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
      ctx.boot.loopControl.release();
      mark('warm-finally');
    }
    return didFail ? 'failed' : 'ok';
  };

  /**
   * Compiles the gib/chunk march variant in BOTH contexts it draws in (the
   * march MRT and the gib-shutter half-float layer) after the loader. Uses the
   * same throwaway view the boot warm used; removed and disposed when done.
   * Nothing awaits this.
   */
  const compileGibVariantInBackground = async (): Promise<boolean> => {
    let warmChunkView: ChunkGpuView | null = null;
    try {
      const a0 = ctx.world.actors[0];
      const warmPrims = a0 ? a0.posed().prims.filter((p) => p.op !== 'sub').slice(0, 2) : [];
      const warmFirst = warmPrims[0];
      if (!a0 || !ctx.bake.material || !warmFirst) return false;
      const warmOrigin: Vec3 = [0, 1, 0];
      const warmState = makeChunk(
        warmFirst.limb, warmOrigin, [0, 0, 0], chunkExtent(warmPrims, warmOrigin), [0, 1, 0], () => 0.5,
      );
      warmChunkView = createChunkGpuView(
        warmState, warmPrims, a0.view.uniforms, undefined, a0.view.volumeTexture, ctx.bake.material, [],
        undefined,
      );
      warmChunkView.object.layers.set(SDF_LAYER);
      scene.add(warmChunkView.object);
      // The march MRT context (rgba32float). Then the gib-shutter context
      // (rgba16float) — the second cold per-SHAPE target; a shape compiles once
      // per (shape x target), so both must be warmed before `gib` is ready.
      const mrtOk = await ctx.render.sdfLayer.precompileInBackground(
        warmChunkView.object, scene, camera, { timeoutMs: PRECOMPILE_COLD_PASS_TIMEOUT_MS },
      );
      let shutterOk = true;
      if (ctx.gibs.shutter) {
        shutterOk = await ctx.gibs.shutter.precompileSubjectInBackground(
          warmChunkView.object, ctx.render.postAa.captureTarget, scene, camera, PRECOMPILE_COLD_PASS_TIMEOUT_MS,
        );
      }
      return mrtOk && shutterOk;
    } catch (err) {
      console.warn('[warm] gib-variant background compile failed', err);
      return false;
    } finally {
      if (warmChunkView) {
        scene.remove(warmChunkView.object);
        warmChunkView.dispose();
      }
    }
  };

  /**
   * Compiles the crowd march program (rgba32float, 5-location instanced) after
   * the loader, one type mesh at a time. The meshes are hidden while the job is
   * pending so the live draw never reaches them; each is flipped visible only
   * across its own `compileAsync` synchronous prologue.
   */
  const compileCrowdInBackground = async (): Promise<boolean> => {
    let ok = true;
    for (const t of ctx.crowd.types.values()) {
      t.mesh.visible = true;
      const p = ctx.render.sdfLayer.precompileInBackground(
        t.mesh, scene, camera, { timeoutMs: PRECOMPILE_COLD_PASS_TIMEOUT_MS },
      );
      // The prologue (which projects the object into the render context) has
      // already run synchronously; visibility no longer matters, and keeping it
      // hidden is what lets the live draw skip the pending pipeline safely.
      t.mesh.visible = false;
      const r = await p;
      ok = ok && r;
      if (!ok) break;
    }
    return ok;
  };

  /**
   * Starts the background set. Called ONLY once the loader gate reaches
   * `ready`; nothing awaits the chain. Sequential: the driver serializes these
   * compiles anyway (async compiles do not overlap) and both jobs share the
   * renderer's transient target state.
   */
  const startBackgroundCompiles = (): void => {
    if (!ctx.boot.backgroundMode || !ctx.boot.warmRequested) return;
    void (async () => {
      try {
        ctx.boot.warmBackgroundTimes.start.gib = Math.round(performance.now() - ctx.boot.warmT0);
        ctx.boot.warmBackground.start('gib');
        const gibOk = await compileGibVariantInBackground();
        ctx.boot.warmBackgroundTimes.done.gib = Math.round(performance.now() - ctx.boot.warmT0);
        ctx.boot.warmBackground.settle('gib', gibOk);

        if (ctx.crowd.on && ctx.crowd.types.size > 0) {
          ctx.boot.warmBackgroundTimes.start.crowd = Math.round(performance.now() - ctx.boot.warmT0);
          ctx.boot.warmBackground.start('crowd');
          const crowdOk = await compileCrowdInBackground();
          ctx.boot.warmBackgroundTimes.done.crowd = Math.round(performance.now() - ctx.boot.warmT0);
          ctx.boot.warmBackground.settle('crowd', crowdOk);
        }
        mark('warm-background-done');
      } catch (err) {
        console.warn('[warm] background compile chain failed', err);
        // Never leave a job `compiling`: a consumer would degrade forever with
        // no recorded reason. `failed` is the honest, still-safe state.
        ctx.boot.warmBackground.settle('gib', false);
        ctx.boot.warmBackground.settle('crowd', false);
      }
    })();
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
  ctx.boot.warmRequested = new URLSearchParams(location.search).get('warm') !== '0';
  // `?warm=0` means NO warm-up at all: the degraded policies exist only to
  // protect the AWAITED warm's guarantee, so with no warm the consumers must
  // use their normal paths and accept the first-use compile — exactly the A/B
  // the flag documents. Settling ready is what restores that.
  if (!ctx.boot.warmRequested) {
    ctx.boot.warmBackground.settle('gib', true);
    ctx.boot.warmBackground.settle('crowd', true);
  }
  ctx.boot.warmPromise = ctx.boot.warmRequested ? warmPipelines() : Promise.resolve<WarmOutcome>('ok');
  void coordinateWarmGate({
    warm: ctx.boot.warmPromise,
    prereq: ctx.weapon.gunReadyPromise,
    timeoutMs: 15000,
    isDeviceLost: () => Boolean(ctx.boot.handle.gpuDiagnostics.lost),
    handlers: {
      setLoader: (text, ready) => setLoader(ctx, text, ready),
      revealReady: () => {
        setLoader(ctx, 'READY — CLICK TO START', true);
        window.setTimeout(() => ctx.boot.loaderEl?.classList.add('loader-hidden'), 1200);
      },
      // A failed / lost warm must not be presented as a successful compile.
      // The game is still playable, so the overlay is dismissed after a beat —
      // with the honest message, and with the failure in the console.
      revealFailure: (text) => {
        setLoader(ctx, text, true);
        window.setTimeout(() => ctx.boot.loaderEl?.classList.add('loader-hidden'), 2500);
      },
    },
  }).then((gate) => {
    (window as unknown as Record<string, unknown>).__warmGate = { phase: gate.phase, timedOut: gate.timedOut };
    if (gate.phase !== 'ready') console.warn(`[warm] loader gate settled ${gate.phase}${gate.timedOut ? ' (after the 15 s bound)' : ''}`);
    // THE BACKGROUND SET (defer-compile task, 2026-09-19). The loader is gone
    // (or failed) and the loop is released, so the crowd and gib/chunk programs
    // compile from here without holding anything up. `failed` is the honest,
    // still-safe state: the shared background times live on __warmDone.phases.
    if (gate.phase === 'ready') startBackgroundCompiles();
  });

  // Pellets: simulated pure (game-weapon.ts), drawn from a mesh pool that
  // grows on demand inside the tick's sync step.
  ctx.weapon.pellets = [];

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
  ctx.weapon.soldierPellets = [];
  ctx.weapon.soldierPelletViews = [];
  // The gather's tracer provider (declared at the top, next to probeGather) can
  // only be wired once both lists exist — see the boot-race note there.
  ctx.lighting.liveTracers = () => [...ctx.weapon.pellets, ...ctx.weapon.soldierPellets];

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
  ctx.vfx.tracerTex = new THREE.DataTexture(tracerPixels(256, 64), 256, 64, THREE.RGBAFormat);
  ctx.vfx.tracerTex.needsUpdate = true;
  ctx.vfx.emberTex = new THREE.DataTexture(emberPixels(128), 128, 128, THREE.RGBAFormat);
  ctx.vfx.emberTex.needsUpdate = true;
  ctx.weapon.pelletGeo = new THREE.PlaneGeometry(1, 1);
  ctx.weapon.pelletViews = [];

  /** NOTE (determinism stage 1, 2026-09-14): the inline LCG and its `lcgNext` /
   *  `lcgUnit` helpers are gone. The named streams in `rng.ts` replace them —
   *  `rngStreams.reload` for the reload arc, `fx` for the muzzle flash/smoke,
   *  `misc` for pellet seeds. The values change (a different seed derivation),
   *  which is intended: the point is that a divergence is traceable to ONE
   *  subsystem rather than to a single shared counter. Do NOT reseed mid-run. */
  ctx.weapon.cooldown = 0;
  /** Shells in the gun. The reload animation only means something if running
   *  dry is a state the player can be in. */
  ctx.weapon.shells = MAGAZINE_CAPACITY;
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
  ctx.weapon.infiniteAmmo = new URLSearchParams(location.search).get('ammo') !== 'finite';
  /** Seconds into the reload, or Infinity when not reloading. */
  ctx.weapon.reloadAge = Infinity;
  /** Varies the eject arc per reload (owner: "they always eject the same").
   *  0 is the reference arc; pinReloadSeed() holds one for a gate. */
  ctx.weapon.reloadSeed = 0;
  ctx.weapon.pinnedReloadSeed = null;
  /** Reload time scale. 1 = real; KeyT cycles 1 -> 0.25 -> 0.1 so the owner
   *  can watch a case leave the bore frame by frame ("could slow it down to
   *  make it easier to see"). Inspection only: nothing else keys off it. */
  ctx.weapon.reloadSpeed = 1;
  ctx.weapon.recoilPitch = 0;

  /** SLUG MODE — one big projectile, one big crater. Diagnostic first: eight
   *  barely-visible 5.5 cm craters gave no signal about placement or look.
   *  Reachable three ways: ?slug URL param at boot, KeyE in-page toggle, or
   *  __sdfGame.fireSlug(). The HUD shows which mode is live. */
  ctx.weapon.slugMode = new URLSearchParams(location.search).has('slug');

  // Chunks: detached pieces fly ballistically and render through the shared
  // SDF chunk path — the same pipeline the lab gibs with, capped and
  // recycled so a gore party cannot churn views unboundedly.
  const MAX_CHUNKS = 12;
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
  ctx.bake.maxChunks = parseIntParam(DYN_PARAMS.get('maxchunks'), { min: 1, max: MAX_CHUNK_BUDGET }) ?? 64;
  // GIBS ARE NOT BODIES. The resolver's concussion launch is tuned for DUDES
  // (EXPLOSION_LAUNCH.velocityScale 0.028 on impulse 900 = ~25 m/s point-blank,
  // "a survivor crosses the room"), and firing CHUNKS at that speed threw them
  // out of an 8-16 m room before a single frame could be read — owner: "i cannot
  // see the gibs its like they are launched at such a high velocity i barely even
  // see them... they are supposed to explode and rain down". Chunks are small and
  // light; this scales the launch. The resolver's upwardBias and its 6 m/s
  // vertical floor are kept, so a slow piece still POPS UP and falls back —
  // which is what "rain down" means.
  ctx.gibs.velScale = parseFloatParam(DYN_PARAMS.get('gibvel'), { min: 0, max: 2 }) ?? 0.35;
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
  ctx.gibs.param = DYN_PARAMS.get('gib');
  ctx.gibs.mode =
    ctx.gibs.param === 'pieces' || ctx.gibs.param === 'clusters' ? ctx.gibs.param : 'parts';
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
  ctx.gibs.renderParam = DYN_PARAMS.get('gibrender');
  ctx.gibs.renderMode =
    ctx.gibs.renderParam === 'sprite' ? 'sprite'
      : ctx.gibs.renderParam === 'carve' ? 'carve'
        : ctx.gibs.renderParam === 'march' ? 'march' : 'assets';
  /** Slabs per cluster for the carved library — the GRANULARITY dial. */
  // 1 SINCE THE ANATOMICAL PARTITION (2026-09-11): `cells` used to mean slabs per
  // CLUSTER, where 3 was the owner's "more granular" ask; it now means
  // SUBDIVISIONS OF AN ANATOMICAL PART, and 1 is one piece per bone group — a
  // forearm, a shin, a skull. Leaving it at 3 cut every part into three again and
  // put back exactly the abstraction the partition was written to remove
  // ("they read a little too abstract ... should at least somewhat resemble
  // pieces from the character"). `?gibcarvecells=2+` trades it back for gore.
  ctx.gibs.carveCells = parseIntParam(DYN_PARAMS.get('gibcarvecells'), { min: 1, max: 8 }) ?? 1;
  ctx.gibs.carveCellSize = parseFloatParam(DYN_PARAMS.get('gibcarvecell'), { min: 0.005, max: 0.05 }) ?? 0.01;
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
  ctx.bake.detailOverride =
    parseFloatParam(DYN_PARAMS.get('chunkdetail'), { min: 0, max: 1 }) ?? null;
  /** Live twins of CHUNK_DETAIL_FREQ / CHUNK_DETAIL_ALBEDO. Both are LOOK
   *  judgements — how coarse the grain should be, and how much of the contrast
   *  should be colour rather than relief — so both sweep without a reload. */
  ctx.bake.detailFreq = parseFloatParam(DYN_PARAMS.get('chunkdetailfreq'), { min: 0.5, max: 64 })
    ?? CHUNK_DETAIL_FREQ;
  ctx.bake.detailAlbedo = parseFloatParam(DYN_PARAMS.get('chunkdetailalbedo'), { min: 0, max: 1.5 })
    ?? CHUNK_DETAIL_ALBEDO;
  ctx.gibs.spriteLiveCap = parseIntParam(DYN_PARAMS.get('gibspritelive'), { min: 1, max: 512 })
    ?? GIB_SPRITE_TUNING.liveCap;
  ctx.gibs.spriteRestCap = parseIntParam(DYN_PARAMS.get('gibspriterest'), { min: 0, max: 512 })
    ?? GIB_SPRITE_TUNING.restCap;
  ctx.gibs.spriteSizeScale = parseFloatParam(DYN_PARAMS.get('gibspritesize'), { min: 0.2, max: 3 })
    ?? GIB_SPRITE_TUNING.sizeScale;
  // WHICH BONE GROUPS A BLAST RELEASES. `all` is the eleven rigid groups
  // (skull, cage, pelvis, eight long bones); `core` is the three torso masses
  // plus the skull — the A/B for what the skeleton costs; `off` is the
  // flesh-only control. `bone.cage` alone is 31 bone prims in ONE chunk, so
  // this is the first knob to reach for if a blast's cost spikes.
  ctx.gibs.bonesParam = DYN_PARAMS.get('gibbones');
  // CORE BY DEFAULT (2026-09-15, owner's call). `all` releases the eleven rigid
  // groups; `core` is the three torso masses plus the skull. Bones are the
  // expensive half of a gib and they NEVER BAKE — a bone piece is a marched
  // chunk for as long as it exists, while flesh retires to a static mesh a
  // second or two after it lands — so the eight long bones are eight permanent
  // marched chunks holding view slots the flesh could have used. `?gibbones=all`
  // restores the full skeleton; `off` is the flesh-only control.
  ctx.gibs.bones =
    ctx.gibs.bonesParam === 'off' ? 'off' : ctx.gibs.bonesParam === 'all' ? 'all' : 'core';
  // THE STAGED RELEASE (dev-note §3a/b). Every piece spawns AT ITS CURRENT
  // POSED TRANSFORM WITH ZERO VELOCITY, so the frame the blast lands shows the
  // BODY's silhouette in place instead of a substitution, and the pieces then
  // go over this many frames, NEAREST THE BLAST FIRST — which is what reads as
  // the blast ripping outward through the body rather than a swap. 1 disables
  // the stagger (everything leaves on the blast frame) and is the A/B control.
  ctx.gibs.staggerFrames = parseIntParam(DYN_PARAMS.get('gibstagger'), { min: 1, max: 8 }) ?? 3;
  /**
   * GIB LAUNCH DISTRIBUTION (2026-09-16 task 3). Default `notblood` is the
   * source-derived independent spread + one shared body shove (gib-launch.ts).
   * `?giblaunch=radial` restores the OLD per-piece `concussionVelocity(at,
   * g.origin, ...)` — a labelled A/B CONTROL for normal-speed review, not a
   * supported gameplay mode. It exists because the owner's report ("pieces
   * cluster too much") can only be judged against the thing that clustered.
   */
  ctx.gibs.launchMode = DYN_PARAMS.get('giblaunch') === 'radial' ? 'radial' : 'notblood';
  // DOES A BODY THIS BLAST IS ABOUT TO GIB GET THE 16 WOUNDS STAMPED ON IT?
  //
  // No. The gibbed branch below takes `gibActor` and `continue`s, so those
  // wounds are stamped, carried through the meter arithmetic and never read —
  // and measured in the arena the wound phase is the blast's dominant cost
  // (18.1 of a 22.0 ms resolve with 5 bodies in range). `?gibwounds=1`
  // restores the old behaviour as the A/B; `setGibWounds` is the live seam so
  // the two arms can be alternated INSIDE ONE BOOT, which is the only way an
  // A/B on this machine is a measurement at all.
  ctx.gibs.wounds = DYN_PARAMS.get('gibwounds') === '1';
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
  ctx.gibs.tearSec = parseFloatParam(DYN_PARAMS.get('gibtear'), { min: 0, max: 0.4 }) ?? 0.2;
  /**
   * NON-RIGID SLOUGH multiplier (`?tearslough=`, 0..3, default 1). The rupture
   * deforms flesh endpoints rather than sliding rigid regions; this scales the
   * outward/downward pull and the within-prim stretch together. `?tearslough=0`
   * is the honest A/B control: the old rigid-region motion with the head
   * attachment intact. There is no way to restore the rejected 0.3 m cranial
   * chest peel — that code path is gone.
   */
  ctx.vfx.sloughScale = parseFloatParam(DYN_PARAMS.get('tearslough'), { min: 0, max: 3 }) ?? 1;
  /** The rupture window's SHAPE, page-level so the panel owns it and every
   *  actor is pushed the same values (ZombieActor keeps its own copy, which is
   *  what makes a capture reproducible per body). `amplitudeM`/`jiggleAmp` are
   *  the panel knobs; the rest are the coherent defaults for a body that
   *  separates into real regions (see gib-tear.ts's TearTuning). */
  ctx.vfx.tearShape = {
    amplitudeM: 0.045, jiggleAmp: 0.35, seamM: 0.09, boneLag: 0.15, headDamp: 0.3,
    sloughOutM: TEAR_TUNING.sloughOutM * ctx.vfx.sloughScale,
    sloughSagM: TEAR_TUNING.sloughSagM * ctx.vfx.sloughScale,
    sloughStretchM: TEAR_TUNING.sloughStretchM * ctx.vfx.sloughScale,
    // HEAD ATTACHMENT / ROOT RECOIL (2026-09-16 playtest follow-up task 4). The
    // defaults come from TEAR_TUNING so the page and the module cannot drift;
    // `?tearhead=0&tearneck=0&tearrecoil=0` restores the OLD independent-damped
    // head + no whole-body jolt, which is the honest A/B control for whether the
    // attachment actually removes the chest-overtakes-head read.
    headFollow: parseFloatParam(DYN_PARAMS.get('tearhead'), { min: 0, max: 1 }) ?? TEAR_TUNING.headFollow,
    neckGapM: parseFloatParam(DYN_PARAMS.get('tearneck'), { min: 0, max: 0.2 }) ?? TEAR_TUNING.neckGapM,
    recoilM: parseFloatParam(DYN_PARAMS.get('tearrecoil'), { min: 0, max: 0.2 }) ?? TEAR_TUNING.recoilM,
  };
  // Owner-approved optical wave defaults; URL flags retain off/on A/B control.
  ctx.vfx.blastDistortStrength = parseFloatParam(DYN_PARAMS.get('bdstrength'), { min: 0, max: 4 }) ?? 2.7;
  ctx.render.postAa.setBlastDistort(
    DYN_PARAMS.get('blastdistort') !== '0' && DYN_PARAMS.get('blastdistort') !== 'off');
  ctx.render.postAa.setBlastDistortStrength(ctx.vfx.blastDistortStrength);
  ctx.dynamite.speedScale = parseFloatParam(DYN_PARAMS.get('dynspeed'), { min: 0.1, max: 4 }) ?? 1;
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
  ctx.vfx.size = parseFloatParam(DYN_PARAMS.get('fxsize'), { min: 0.1, max: 2 }) ?? 0.42;
  // ——— THE BLAST'S FOCUS (owner, 2026-09-11): "it seems the effective radius of
  // the explosion is quite large … the area of effect should be abit more
  // focused". Both default to the reference behaviour, so nothing about the
  // shipped blast moves; they are the panel's two blast sliders.
  ctx.vfx.aoeRadiusScale = parseFloatParam(DYN_PARAMS.get('aoesize'), { min: 0.3, max: 1.5 }) ?? .82;
  // 0.45 is EXPLOSION_LAUNCH.falloffFloor — the resolver's default, kept here so
  // the panel's read-back shows the value the blast actually uses.
  ctx.vfx.aoeLaunchFloor = parseFloatParam(DYN_PARAMS.get('edgekick'), { min: 0, max: 1 }) ?? 0.45;
  ctx.vfx.smoke = parseFloatParam(DYN_PARAMS.get('fxsmoke'), { min: 0, max: 2 }) ?? .76;
  ctx.vfx.life = parseFloatParam(DYN_PARAMS.get('fxlife'), { min: 0.3, max: 3 }) ?? 1.55;
  ctx.vfx.gain = parseFloatParam(DYN_PARAMS.get('fxgain'), { min: 0, max: 4 }) ?? 3.3;
  // THE PLUME A/B. 1 (default) is the mushroom — the neck converges, the cap
  // rolls outward and flattens, the smoke spawns on a rim. 0 is the round
  // fireball this effect was before, blended term by term so ONE boot can A/B
  // the two on the same burst. Kept off the four size/colour knobs because it
  // is a SHAPE switch, and because `?explosionfx=atlas` is the reference the
  // shape is judged against: run 0, run 1, run atlas, in that order.
  ctx.vfx.plume = parseFloatParam(DYN_PARAMS.get('fxplume'), { min: 0, max: 1 }) ?? .1;
  // DEFERRED MODE: the shared chunk material carries the surface mode for
  // every detached chunk (one graph per output mode — the task-2 contract);
  // the legacy prev source is only bound in legacy mode.
  ctx.bake.material = createSharedChunkGpuMaterial(
    ctx.boot.deferredMode ? undefined : ctx.render.sdfLayer.prev,
    ctx.boot.deferredMode
      ? { output: 'surface', shadowReceiver: 'level-only', maxChunks: MAX_CHUNK_BUDGET }
      : { maxChunks: MAX_CHUNK_BUDGET },
  );
  ctx.bake.views = [];
  ctx.bake.spareViews = [];
  ctx.bake.liveChunks = [];
  ctx.bake.jobs = createChunkBakeJobs(() => new Worker(
    new URL('./chunk-bake.worker.ts', import.meta.url), { type: 'module' },
  ));
  // Completed corpses arrive asynchronously. A persistent registered parent
  // gives every replacement mesh the same route and removes it automatically
  // from the router when damage restores the live SDF body.
  ctx.world.soldierCorpseGroup = new THREE.Group();
  ctx.world.soldierCorpseGroup.name = 'soldier-corpses';
  scene.add(ctx.world.soldierCorpseGroup);
  ctx.boot.deferredApi?.router.register(ctx.world.soldierCorpseGroup, 'mesh', 'level-only');
  ctx.world.soldierCorpses = createSoldierCorpseBakes(ctx.world.soldierCorpseGroup, () => {
    if (!ctx.bake.mat) {
      // Whichever finishes first (corpse or detached chunk) must seed the
      // same mode-aware shared material.
      ctx.bake.mat = registerLitChunkMaterial(ctx, createBakedChunkMaterial(
        ctx.boot.deferredMode
          ? { output: 'surface', shadowReceiver: 'level-only', bakedAo: true }
          : { bakedAo: true, fleshResponse: true },
      ));
      ctx.bake.seed?.(ctx.bake.mat);
    }
    return ctx.bake.mat.material;
  });
  const disposeCorpses = () => ctx.world.soldierCorpses?.dispose();
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
  ctx.vfx.goreShowcase = null;
  ctx.vfx.gorePartMat = null;
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
  ctx.vfx.gorePartDetail = new THREE.Vector4(1, 1.6, 0.9, 12);
  /** `look` for the gore materials — the bakedChunkUniforms default until
   *  `__sdfGame.goreLook()` moves it. See that API for why it is tunable. */
  ctx.vfx.goreLookCfg = new THREE.Vector4(0.65, 0.5, 1.2, 0.6);
  /** (burnAmp, wetGain, bloodDark, stainScale) — the STAIN half. Defaults chosen
   *  from the owner's verdict that the blood was too pale and too dry to read as
   *  blood and that there were no burn stains at all: near-black venous blood
   *  (bloodDark 0.85), driven hard into the highlight so it out-speculars the
   *  flesh (wetGain 1.0), a full char field (burnAmp 1.0), and stains at a much
   *  broader DOMAIN than the bump (stainScale 2.5) so they read as patches rather
   *  than speckle. */
  ctx.vfx.gorePartStain = new THREE.Vector4(1, 1, 0.85, 2.5);
  ctx.vfx.goreShowcaseOn = ctx.boot.search.get('goreparts') === '1';

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
  ctx.gibs.atlas = null;
  ctx.vfx.spriteBenchGroup = null;
  ctx.vfx.spriteBenchSprites = [];
  /** Which atlas the bench is showing. `sheet` is the one that ships. */
  ctx.gibs.atlasSource = 'placeholder';

  // THE BLAST'S OWN SPRITES. One set for the whole page, in its own group so a
  // sprite piece is separable from the marched views in the scene graph, in the
  // deferred router, and in a capture. Empty and unused until
  // `?gibrender=sprite` puts something in it — the shipped path never touches it.
  ctx.vfx.spritePieces = makeSpritePieceSet();
  scene.add(ctx.vfx.spritePieces.group);
  ctx.boot.deferredApi?.router.register(ctx.vfx.spritePieces.group, 'mesh', 'level-only');
  /** One warning, not one per body per blast. See `gibActor`'s fallback. */
  ctx.gibs.spriteAtlasWarned = false;
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
  ctx.bake.carvedLibrary = null;
  ctx.bake.carvedMaterial = null;
  ctx.bake.carvedBuildMs = 0;
  ctx.bake.carvedWarned = false;

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
   * Assets are the owner-approved default; `?gibrender=march` is the control.
   * A body gibbed before the load resolves falls
   * back to marched pieces for that blast, never to no gore.
   */
  ctx.gibs.assetMaterial = null;
  /** ONE NEW face material per asset head. The face layer's `headCentre`,
   *  `headQuat` and `headAxes` are WORLD-space and therefore per-actor, so a
   *  shared material could only ever project the face at one actor's frame
   *  ("no shared mutable face uniforms across actors"). The handle owns nothing
   *  but the material: the face TEXTURE stays the actor's external atlas, which
   *  is why retirement of the actor cannot blank a flying head's face. */
  ctx.gibs.assetHeadFactory = {
    create: (source: unknown): { material: THREE.Material; setFrame: (f: { centre: Vec3; quat: Quat; axes: Vec3 }) => void; dispose: () => void } => {
      const u = source as import('./zombie-gpu').MarchUniforms;
      const built = registerLitChunkMaterial(ctx, createBakedChunkMaterial({
        goreDetail: true, bakedAo: true, fleshResponse: true, face: u,
      }));
      built.uniforms.goreCfg.value.set(
        ctx.vfx.gorePartDetail.x, ctx.vfx.gorePartDetail.y, ctx.vfx.gorePartDetail.z, ctx.vfx.gorePartDetail.w,
      );
      built.uniforms.goreCfg2.value.set(
        ctx.vfx.gorePartStain.x, ctx.vfx.gorePartStain.y, ctx.vfx.gorePartStain.z, ctx.vfx.gorePartStain.w,
      );
      ctx.bake.seed?.(built);
      return {
        material: built.material,
        setFrame: (f) => {
          const fu = built.faceUniforms;
          if (!fu) return;
          fu.headCentre.value.set(f.centre[0], f.centre[1], f.centre[2]);
          fu.headQuat.value.set(f.quat[0], f.quat[1], f.quat[2], f.quat[3]);
          fu.headAxes.value.set(f.axes[0], f.axes[1], f.axes[2]);
        },
        dispose: () => {
          const i = ctx.world.litChunkMaterials.indexOf(built);
          if (i >= 0) ctx.world.litChunkMaterials.splice(i, 1);
          built.dispose();
        },
      };
    },
  };
  const createGibAssetRuntime = (): GibAssetRuntime => new GibAssetRuntime({
    materialFactory: {
      create: () => {
        // Same procedural detail layer the carve uses, plus the baked flesh
        // response (this set carries `bakeResponse`/`bakeFresnel`/`bakeAnchor`,
        // so the per-pixel detail rides the asset's own rest-frame anchor).
        ctx.gibs.assetMaterial = registerLitChunkMaterial(ctx, createBakedChunkMaterial({
          goreDetail: true, bakedAo: true, fleshResponse: true,
        }));
        ctx.gibs.assetMaterial.uniforms.goreCfg.value.set(
          ctx.vfx.gorePartDetail.x, ctx.vfx.gorePartDetail.y, ctx.vfx.gorePartDetail.z, ctx.vfx.gorePartDetail.w,
        );
        ctx.gibs.assetMaterial.uniforms.goreCfg2.value.set(
          ctx.vfx.gorePartStain.x, ctx.vfx.gorePartStain.y, ctx.vfx.gorePartStain.z, ctx.vfx.gorePartStain.w,
        );
        ctx.bake.seed?.(ctx.gibs.assetMaterial);
        return ctx.gibs.assetMaterial.material;
      },
    },
    onLoad: (lib) => {
      console.log(`[gib-assets] ${lib.archetype}: ${lib.pieces.length} pieces, ${lib.verts} verts, `
        + `${lib.bytes.bin} bin bytes (library build ${lib.builtMs.toFixed(0)} ms)`);
    },
    headMaterialFactory: ctx.gibs.assetHeadFactory,
  });
  ctx.gibs.assetRuntime = createGibAssetRuntime();

  ctx.bake.input = null;
  ctx.bake.lastSwapMs = 0;
  ctx.bake.lastRequestMs = 0;
  /** The sim frame a bake job was submitted on (finishChunkBake waits for the
   *  next one) and the frame a swap actually landed on (reported). */
  ctx.bake.submitFrame = -1;
  ctx.bake.lastSwapFrame = -1;
  window.addEventListener('pagehide', withCtx(ctx, cancelChunkBake));
  window.addEventListener('pagehide', () => { ctx.gibs.pendingGibImpulses.length = 0; });
  import.meta.hot?.dispose(() => {
    cancelChunkBake(ctx);
    window.removeEventListener('pagehide', withCtx(ctx, cancelChunkBake));
  });
  /** A slug/pellet INTO a baked piece: the piece GIBS. Fresh small chunks
   *  spawn at the impact (its own origin body's template, so the meat
   *  matches), a blood gout sprays, and the mesh is deleted. No reverse
   *  path — the design question settled for option 2 (simpler: no dual
   *  representation to keep in sync, and closer to the feel). */
  function gibBakedPiece(b: BakedChunk, at: Vec3): void {
    ctx.telemetry.telemetry.event('baked-piece-hit', { chunk: b.id, world: [...at] });
    ctx.bake.spareViews.push(freeBaked(ctx, b));
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
    if (ctx.vfx.bleedEnabled) {
      // One-shot gib gout: a fresh emitter stream so it never fuses with a
      // nearby wound's stream by proximity.
      spawnImpactGout(ctx.vfx.bloodSim, 'slug', at, [0, 1, 0], rngStreams.bleed, ctx.boot.nextEmitterStream++);
    }
  }
  /** Set by the measurement seam below: pieces exist, fly and bake exactly as
   *  they would, and are simply not drawn. */
  ctx.bake.hidden = false;
  /** Whether BONE pieces are drawn — see setBonePiecesVisible. */
  ctx.render.bonesVisible = true;
  // Now that the array exists, the frame draw can read it directly.
  chunkObjects = () => (ctx.bake.reference ? [...ctx.bake.liveChunks, ...ctx.bake.chunks] : ctx.bake.liveChunks).map(c => c.view.object);
  ctx.bake.nextId = 1;
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
      primsLongAxis(ctx, extentSource, piece.origin),
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
    let recycled: ChunkGpuView | undefined = ctx.bake.spareViews.pop();
    if (!recycled && ctx.bake.views.length >= ctx.bake.maxChunks) {
      const oldestBaked = ctx.bake.chunks.shift();
      if (oldestBaked) {
        recycled = freeBaked(ctx, oldestBaked);
      } else {
        const oldest = ctx.bake.liveChunks.shift();
        if (oldest) {
          if (ctx.bake.jobs.pendingId === oldest.id) cancelChunkBake(ctx);
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
      recycled.setPackBones(boneOnly ? !ctx.gibs.boneMesh : !ctx.render.boneMesh);
      applyChunkKindLook(ctx, recycled, kind);
      // May be arriving from a baked retirement; and a bone piece spawned while
      // the differential hides the skeleton must stay hidden.
      // With `gibBoneMesh` the tubes draw this piece and its packed rows are
      // gone, so the marched proxy has an EMPTY field: it would march and
      // discard every pixel of its box for nothing. Hidden, not merely empty.
      recycled.object.visible = !ctx.bake.hidden
        && (kind !== 'bone' || (ctx.render.bonesVisible && !(boneOnly && ctx.gibs.boneMesh)));
      ctx.bake.liveChunks.push({ id: ctx.bake.nextId++, state, view: recycled, template, kind, boneOnly });
    } else {
      const view = createChunkGpuView(
        state, piece.prims, template.uniforms,
        piece.tornAt.length ? piece.tornAt : undefined,
        template.volumeTexture, ctx.bake.material, piece.bones,
        // Matching options with the shared material (task-2 contract: with a
        // shared material the material's mode wins; the view must agree).
        ctx.boot.deferredMode ? { output: 'surface', shadowReceiver: 'level-only' } : undefined,
      );
      view.setPackBones(boneOnly ? !ctx.gibs.boneMesh : !ctx.render.boneMesh);
      applyChunkKindLook(ctx, view, kind);
      view.object.visible = !ctx.bake.hidden
        && (kind !== 'bone' || (ctx.render.bonesVisible && !(boneOnly && ctx.gibs.boneMesh)));
      view.object.layers.set(SDF_LAYER);
      scene.add(view.object);
      ctx.boot.deferredApi?.router.register(view.object, 'sdf');
      ctx.bake.views.push(view);
      ctx.bake.liveChunks.push({ id: ctx.bake.nextId++, state, view, template, kind, boneOnly });
    }
  }

  // -----------------------------------------------------------------------
  mark('dynamite-start');
  /** How many bundles may be in the air at once — and therefore how many prop
   *  instances exist (1 held + the rest in flight). Small on purpose: this is a
   *  tuning tool, not a grenade-spam simulator. */
  const MAX_BUNDLES = 4;

  ctx.weapon.slotState = makeWeaponSlotState('shotgun');
  ctx.vfx.cook = { phase: 'idle', phaseAt: 0, cookStart: 0 };
  /** The cook clock in SIM seconds, advanced by tick(dt) — not a wall clock,
   *  so a frozen/render-locked capture cannot advance the fuse behind its own
   *  back. */
  ctx.dynamite.now = 0;
  // One-frame input edges, consumed by the next tick.
  ctx.dynamite.press = false;
  ctx.dynamite.release = false;
  /** 0..1 charge of the live cook, for the HUD. */
  ctx.dynamite.charge = 0;

  /** Prop pool. The HELD one is parented to `bundleRig` (inside aimRig, so it
   *  rides the free-aim lean and the walk bob); a thrown one is moved to the
   *  scene root and posed in WORLD space from its flight state. */
  ctx.bake.bundleProps = [];
  ctx.bake.bundleRig = new THREE.Group();
  ctx.bake.bundleRig.name = 'bundle-rig';
  ctx.bake.bundleReady = false;
  {
    const errs: string[] = [];
    for (let i = 0; i < MAX_BUNDLES; i++) {
      try {
        const p = createStickProp();
        p.object.visible = false;
        ctx.bake.bundleProps.push(p);
      } catch (e) { errs.push(String(e)); }
    }
    if (errs.length > 0) console.error('[sdf-game] dynamite prop pool:', errs.join(' | '));
    ctx.bake.bundleRig.position.copy(BUNDLE_HOLD.pos);
    ctx.bake.bundleRig.rotation.copy(BUNDLE_HOLD.rot);
    (ctx.weapon.aimRig ?? ctx.weapon.viewModelAnchor).add(ctx.bake.bundleRig);
    ctx.bake.bundleReady = ctx.bake.bundleProps.length > 0;
  }

  /** The prop currently IN HAND, or null while the bundle it became is in the
   *  air. This is deliberately NOT `bundleProps[0]`: after a throw that very
   *  object belongs to the flight, and drawing it in the rig as well would put
   *  a second bundle in the player's hand. */
  ctx.weapon.heldProp = ctx.bake.bundleProps[0] ?? null;
  // `bundleRig.visible` is the gate for the whole in-hand model, so the prop's
  // OWN flag must stay true: setting it false here made the held bundle
  // invisible from boot until the first throw cycle happened to re-acquire one
  // (owner report, 2026-09-10: "after like the first 2 throws i dont see the
  // dynamite"). One gate, not two.
  if (ctx.weapon.heldProp) { ctx.bake.bundleRig.add(ctx.weapon.heldProp.object); ctx.weapon.heldProp.object.visible = true; }
  /** Props not in hand and not in flight. */
  ctx.bake.spareBundles = ctx.bake.bundleProps.slice(1);

  /** A bundle in the air. `prop` is null when more bundles are flying than the
   *  pool can draw — the SIM is never dropped, only the drawing of it. */
  interface LiveBundle { state: FlightState; prop: StickProp | null }
  ctx.bake.liveBundles = [];
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
  ctx.gibs.pendingGibImpulses = [];
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
  ctx.gibs.pendingGibs = [];
  /** Radians of view pitch per unit of the resolver's cameraKick magnitude. The
   *  magnitude is ~4 at the epicentre, so this is ~3.4° of punch point-blank
   *  and proportionally less with distance. */
  const BLAST_KICK_RAD_PER_UNIT = 0.015;
  // `?fxlight=K` scales BOTH peaks together — the owner tunes "how much does the
  // room light up" as one number, and scaling only one side would let the walls
  // and the bodies disagree about the blast's brightness.
  ctx.lighting.fxLightScale = parseFloatParam(DYN_PARAMS.get('fxlight'), { min: 0, max: 4 }) ?? 1;
  /** How far the blast's light reaches (the soft room-fill component): see the
   *  panel's `light reach` row and LIGHT_FILL_REF_M. 0 = the pure point light. */
  ctx.vfx.spread = parseFloatParam(DYN_PARAMS.get('fxspread'), { min: 0, max: 3 }) ?? 1.2;
  // ?woundcap=0 restores the uncapped flesh probe (see damage.ts probeFlesh):
  // the A/B control for the wound-stamping cost, settable per boot so the two
  // arms can be measured interleaved rather than across runs.
  setProbeCapEnabled(DYN_PARAMS.get('woundcap') !== '0');
  /** Live explosions lighting something, newest last. Bounded by the pool. */
  ctx.vfx.explosionLights = [];

  // Telemetry for the tuning pass — read back through __sdfGame.dynamite().
  ctx.dynamite.thrown = 0;
  ctx.dynamite.detonations = 0;
  ctx.dynamite.gibbed = 0;
  ctx.dynamite.gibPieces = 0;
  /** DIAGNOSTIC (temporary): what the pre-tear window's drain did, so a census
   *  that disagrees with it says WHICH side is wrong. */
  ctx.dynamite.scheduledGibBodies = 0;
  ctx.dynamite.scheduledGibPieces = 0;
  ctx.dynamite.lastBlastMs = 0;
  /** THE RADIUS THE LAST BLAST ACTUALLY RESOLVED AT. The `detonate` seam used
   *  to return `explosionRadiusM()` — the reference CONSTANT — so the radius a
   *  rig read back could never move no matter what was tuned, and the new
   *  `?aoesize` slider looked inert to every instrument in the repo while it
   *  was in fact working. The gate caught it; this is the honest readback. */
  ctx.dynamite.lastRadiusM = explosionRadiusM();
  /** Pieces a gib had to leave OUT because the view pool was full — the number
   *  that says whether ?maxchunks needs raising for what is on screen. */
  ctx.dynamite.lastGibDropped = 0;
  /** Which piece SHAPE the last body got (see gibActor's tiers) and how many
   *  pieces it actually spawned — the two numbers the census cannot infer. */
  ctx.dynamite.lastGibTier = 'parts';
  /** EVERY body's tier for the last blast, in the order they were gibbed —
   *  because "what did the owner actually see" is a question about ALL of them,
   *  and a single last-body field answers it wrongly: a five-body blast in the
   *  arena gives the first body `parts` and the rest the cheap rungs, and only
   *  the log shows that. Cleared at the top of each detonation. */
  ctx.dynamite.gibTierLog = [];
  ctx.dynamite.lastGibSpawned = 0;
  ctx.dynamite.lastGibParts = [];
  ctx.dynamite.lastGibHeld = 0;
  ctx.dynamite.bloodOrphans = 0;

  /** The bundle that never left the hand: an overcook, or a fuse that burned
   *  out while held. Detonates AT the player. */
  function overcookInHand(): void {
    const at = propWorld(ctx, ctx.weapon.heldProp);
    ctx.telemetry.telemetry.event('dynamite-overcook', { x: at[0], y: at[1], z: at[2] });
    detonateAt(at, true);
  }

  // -----------------------------------------------------------------------
  mark('detonation-start');
  ctx.dynamite.blastProfile = newBlastProfile(ctx);

  function detonateAt(at: Vec3, inHand = false): void {
    const t0 = performance.now();
    ctx.dynamite.gibTierLog = [];
    const prof = newBlastProfile(ctx);
    ctx.dynamite.blastProfile = prof;
    EXPLOSION_PROFILE.traceMs = 0; EXPLOSION_PROFILE.woundMs = 0;
    EXPLOSION_PROFILE.cutMs = 0; EXPLOSION_PROFILE.bodiesTraced = 0;
    EXPLOSION_PROFILE.bodiesPruned = 0; EXPLOSION_PROFILE.prunedPrims = 0;
    EXPLOSION_PROFILE.traces = 0;
    ctx.dynamite.detonations++;
    const bodies: ExplosionBody[] = ctx.world.actors.map(a => ({
      id: String(a.id), body: a.posed(), bodyYaw: a.pose().yaw,
    }));
    const tResolve = performance.now();
    const fx = resolveExplosion(at, bodies, {
      eye: eyeOf(ctx.player.player),
      // Floor distance IS the height above y = 0, this level's real floor, so
      // the resolver's air-vs-ground burst choice is exact here without
      // overriding its default.
      floorDistM: Math.max(0, at[1]),
      // A gibbed body's wounds are never read (see `gibWounds` above).
      woundsOnGibbed: ctx.gibs.wounds,
      // THE FOCUS KNOBS, live from the panel. Both are the resolver's own
      // options and both default to the reference (scale 1, floor 0.45), so a
      // page that never touches them resolves exactly as before.
      radiusScale: ctx.vfx.aoeRadiusScale,
      launchFloor: ctx.vfx.aoeLaunchFloor,
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
      .filter(pb => pb.gibbed && ctx.world.actors.some(q => String(q.id) === pb.bodyId))
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
    const blastBudget = gibBudget(ctx);
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
      const a = ctx.world.actors.find(q => String(q.id) === pb.bodyId);
      if (!a) continue;
      if (pb.gibbed) {
        const tg = performance.now();
        // SINGLE-HIT RULE: damage ≥ GIB_THRESHOLD skips death entirely. The
        // resolver has already decided, and nothing severs a body that is
        // about to stop existing.
        if (ctx.gibs.tearSec > 0) {
          // The window takes it from here. The TIER IS CHOSEN NOW (task 3) with
          // the same greedy allowance the immediate path uses, and its views
          // are RESERVED out of `gibBudget()` until release, so the preview is
          // the shape that will spawn and a later blast cannot spend its slots.
          const chosen = scheduleGib(ctx, a, at, pb.falloff, gibAllowance(ctx, remaining, condemnedLeft));
          if (chosen) {
            remaining = gibDebit(ctx, remaining, chosen.reserve);
            condemnedLeft = Math.max(0, condemnedLeft - 1);
          }
          prof.gib += performance.now() - tg;
          gibbed++;
          continue;
        }
        const allowance = gibAllowance(ctx, remaining, condemnedLeft);
        const made = gibActor(a, at, pb.falloff, allowance);
        pieces += made;
        remaining = gibDebit(ctx, remaining, made);
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
      for (const w of pb.wounds) spillVerdict(ctx, a, w);
      prof.wound += performance.now() - tw;
    }
    ctx.dynamite.gibbed += gibbed;
    ctx.dynamite.gibPieces += pieces;

    // Concussion on pieces that already existed (the resolver's list) and on
    // the pieces this blast just made (spawnChunkPiece's ids, patched here).
    for (const ci of fx.chunkImpulses) {
      const c = ctx.bake.liveChunks.find(q => q.id === ci.chunkId);
      if (c) c.state.vel = [ci.vel[0], ci.vel[1], ci.vel[2]];
    }
    // ——— The camera kick. `cameraKick` is the game's quake→magnitude mapping
    //     (quake/40 ≈ 4 at the epicentre, falling off linearly with distance) —
    //     a MAGNITUDE, not radians, so it is scaled into the same `recoilPitch`
    //     channel the gun kick uses and rides that channel's decay. One channel
    //     on purpose: two independent pitch impulses would fight.
    ctx.weapon.recoilPitch += fx.cameraKick * BLAST_KICK_RAD_PER_UNIT;
    // The burst BILLBOARD. Stage 3 replaces this stand-in with the procedural
    // fireball (webgpu/explosion-vfx.ts); until that lands the detonation still
    // has to be VISIBLE, so the tuning pass is not blocked on the art.
    // THE LIGHT, ignited here rather than in the VFX module: the module owns the
    // particles, the wiring owns what the room sees. A blast at the far end of a
    // corridor still gets a light (it does nothing useful, but consistency beats
    // a distance gate nobody can see).
    igniteExplosionLight(ctx, at);
    const burst = scaleBurstVisual(ctx, fx.burst);
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
    if (ctx.render.postAa.blastDistort) {
      ctx.render.postAa.pushBlastDistort(
        [at[0], at[1], at[2]],
        blastRefractionBirthRadiusM(burst.heightM),
        // Strength is applied by the post pass, once, including live changes.
        blastRefractionStrength(burst.heightM),
      );
    }
    if (ctx.vfx.explosionVfx) ctx.vfx.explosionVfx.spawn(burst);
    else if (ctx.vfx.burstLayer) ctx.vfx.burstLayer.spawn(burst);
    // ...including the stand-in, which used to get the UNSCALED height and was
    // therefore a third size convention in a three-way branch. It is the
    // control arm of the A/B; a control at a different size compares nothing.
    else spawnBurstStandIn(ctx, burst.at, burst.heightM, burst.kind);
    prof.chunksSpawned = pieces;
    ctx.dynamite.lastRadiusM = fx.radiusM;
    ctx.dynamite.lastBlastMs = performance.now() - t0;
    prof.total = ctx.dynamite.lastBlastMs;
    ctx.dynamite.bloodOrphans += 0;
    ctx.telemetry.telemetry.event('dynamite-detonate', {
      x: at[0], y: at[1], z: at[2], radiusM: fx.radiusM,
      bodies: fx.perBody.length, gibbed, pieces, ms: ctx.dynamite.lastBlastMs,
    });
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
      const made = gibActor(q.actor, q.at, q.falloff, locked ? q.reserve : allowance, planned);
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
      spawnChunkPiece({
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

  // -----------------------------------------------------------------------
  mark('burst-start');
  ctx.vfx.burstTex = new THREE.DataTexture(flashPixels(64, 11), 64, 64);
  ctx.vfx.burstTex.needsUpdate = true;
  ctx.vfx.smokeBurstTex = new THREE.DataTexture(smokePixels(64), 64, 64);
  ctx.vfx.smokeBurstTex.needsUpdate = true;
  interface BurstSlot {
    core: THREE.Sprite; halo: THREE.Sprite; smoke: THREE.Sprite;
    age: number; life: number; h: number;
  }
  ctx.weapon.burstSlots = [];
  for (let i = 0; i < BURST_SLOTS; i++) {
    const core = new THREE.Sprite(new THREE.SpriteMaterial({
      map: ctx.vfx.burstTex, color: new THREE.Color(7, 4.4, 1.9), transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthTest: true, depthWrite: false, toneMapped: false,
    }));
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: ctx.vfx.burstTex, color: new THREE.Color(2.2, 0.62, 0.14), transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthTest: true, depthWrite: false, toneMapped: false,
    }));
    const smoke = new THREE.Sprite(new THREE.SpriteMaterial({
      map: ctx.vfx.smokeBurstTex, color: new THREE.Color(0.22, 0.20, 0.185), transparent: true, opacity: 0,
      depthTest: true, depthWrite: false, toneMapped: false,
    }));
    for (const s of [core, halo, smoke]) { s.visible = false; ctx.vfx.characterEffects.scene.add(s); }
    ctx.weapon.burstSlots.push({ core, halo, smoke, age: Infinity, life: 0.55, h: 1 });
  }
  ctx.weapon.burstCursor = 0;

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
  ctx.vfx.mode = DYN_PARAMS.get('explosionfx') ?? 'procedural';
  ctx.vfx.explosionVfx = null;
  ctx.vfx.burstLayer = null;
  if (ctx.vfx.mode === 'atlas') {
    ctx.vfx.burstLayer = createBurstLayer(ctx.vfx.characterEffects.scene);
  } else if (ctx.vfx.mode !== 'standin') {
    try {
      ctx.vfx.explosionVfx = createExplosionVfx();
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
      ctx.vfx.explosionVfx.setTuning({
        smokeOpacity: ctx.vfx.smoke, lifeSec: ctx.vfx.life, gain: ctx.vfx.gain,
        // THE SHAPE SWITCH IS FOUR SETTINGS, NOT ONE. `plumeMix` alone blends
        // the envelope terms, and measured through the differential capture it
        // barely moved the silhouette (cap/stem 20.6 against 21.8): the fire's
        // CAP ROLE is what puts mass up top, and that is a separate knob. An
        // A/B that does not move the number it exists to compare is not an A/B.
        plumeMix: ctx.vfx.plume,
        fireCapShare: ctx.vfx.plume,
        capFlatten: parseFloatParam(DYN_PARAMS.get('capflat'), { min: 0, max: 1 }) ?? dynamiteDefaults().capflat,
        capFireFlatten: Math.min(1, 0.5 + (parseFloatParam(DYN_PARAMS.get('capflat'), { min: 0, max: 1 }) ?? dynamiteDefaults().capflat) * 0.25),
      });
      ctx.vfx.characterEffects.scene.add(ctx.vfx.explosionVfx.object);
    } catch (e) {
      // Fail OPEN to the stand-in rather than take the page down: a node graph
      // this GPU cannot compile is a look problem, not a reason to have no
      // explosion at all.
      console.error('[sdf-game] explosion-vfx unavailable, using the stand-in:', e);
      ctx.vfx.explosionVfx = null;
    }
  }

  /**
   * One frame of dynamite: the cook machine, the flights, and the hand state.
   *
   * `stepCook` (fpv.ts) is the authority on WHEN a bundle leaves the hand and
   * on the overcook — this only routes its one-shot signal to the throw or to
   * the in-hand detonation, so the timing rules have exactly one home.
   */
  function stepDynamite(dt: number): void {
    ctx.dynamite.now += dt;
    const liveDyn = ctx.weapon.slotState.live === 'dynamite' && slotReady(ctx.weapon.slotState);
    const { state: nextCook, signal } = stepCook(
      ctx.vfx.cook, { press: ctx.dynamite.press && liveDyn, release: ctx.dynamite.release && liveDyn }, ctx.dynamite.now,
    );
    ctx.vfx.cook = nextCook;
    ctx.dynamite.press = false;
    ctx.dynamite.release = false;
    const sig: CookSignal | null = signal;
    if (sig?.kind === 'throw') throwBundle(ctx, sig.speedMps);
    else if (sig?.kind === 'overcook') overcookInHand();
    ctx.dynamite.charge = chargeFraction(ctx.dynamite.now - ctx.vfx.cook.cookStart) * (ctx.vfx.cook.phase === 'cooking' ? 1 : 0);
    reacquireHeldProp(ctx);

    // ——— The flights. Stepped at the flight module's own 120 Hz so the body
    //     contact test is as fine as the bounces are; a bundle that hits a body
    //     detonates there, which is what makes the thing aimable at all.
    for (let i = ctx.bake.liveBundles.length - 1; i >= 0; i--) {
      const b = ctx.bake.liveBundles[i]!;
      // The ceiling is resolved per bundle PER FRAME, from where the bundle is:
      // see ceilingAt. One frame of lag across a doorway is invisible (the wall
      // boxes catch that frame), and a 5-entry lookup per bundle per frame is
      // nothing next to getting the roof wrong.
      const world = { colliders: ctx.world.colliders, ceilM: ceilingAt(ctx, b.state.pos[0], b.state.pos[2]) };
      let remaining = Math.min(dt, 0.25);
      let boom: Vec3 | null = null;
      while (remaining > 1e-9 && !flightDetonated(b.state)) {
        const sub = Math.min(remaining, FLIGHT_TUNING.subStepSec);
        remaining -= sub;
        const from = b.state.pos;
        // bounds: null — the dungeon has no arena rect; `colliders` is its
        // real solid geometry and `ceilM` its ceiling.
        b.state = stepFlight(b.state, sub, null, world);
        if (bundleHitsBody(ctx, from, b.state.pos)) { boom = b.state.pos; break; }
      }
      if (!boom && flightDetonated(b.state)) boom = b.state.pos;
      if (boom) {
        // Hand the prop back BEFORE the blast so the very next cook has one.
        if (b.prop) { b.prop.object.visible = false; ctx.bake.spareBundles.push(b.prop); }
        ctx.bake.liveBundles.splice(i, 1);
        detonateAt(boom);
        continue;
      }
      b.prop?.pose({ mode: 'flight', pos: b.state.pos, spin: b.state.spin, fuseBurning: true });
    }
    stepBursts(ctx, dt);
    ctx.vfx.explosionVfx?.update(dt, camera);
    ctx.vfx.burstLayer?.update(dt, camera);

    // THE MESH-SIDE LIGHT. Aged and written every frame. The pool is
    // PERMANENTLY VISIBLE (see its construction comment): `visible` is never
    // toggled, because that re-keys the scene's LightsNode and recompiles the
    // light variant of every lit material mid-frame. An idle slot is left at
    // intensity 0, which contributes no light.
    for (let i = ctx.vfx.explosionLights.length - 1; i >= 0; i--) {
      const e = ctx.vfx.explosionLights[i]!;
      e.age += dt;
      if (e.age >= EXPLOSION_LIGHT.lifeSec) ctx.vfx.explosionLights.splice(i, 1);
    }
    for (let i = 0; i < ctx.vfx.explosionLightPool.length; i++) {
      const pl = ctx.vfx.explosionLightPool[i]!;
      const e = ctx.vfx.explosionLights[i];
      if (!e) { pl.intensity = 0; continue; }
      const k = explosionLightEnv(ctx, e.age);
      pl.position.set(e.pos[0], e.pos[1], e.pos[2]);
      pl.intensity = EXPLOSION_LIGHT.meshPeak * k * ctx.lighting.fxLightScale;
    }
    // THE FIRE-SIDE MESH LIGHTS, beside the explosion pool writer for the same
    // reason. These four permanent PointLights are the SHIPPED room light for
    // fire: they have no shadow test, while the gather path self-shadows on the
    // burner's own capsules (see pushGatherLights). Zeroes only on the no-fire
    // transition.
    ctx.vfx.burning.updateFireLightPool(ctx.player.player.pos);
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
  ctx.vfx.bloodSim = createBloodSim();
  ctx.vfx.bleed = new BleedRegistry();

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
  ctx.boot.nextEmitterStream = 1;
  ctx.vfx.woundStreamIds = new WeakMap<Wound, number>();

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
  ctx.goo.rigView = ctx.world.actors[0]?.view;
  if (ctx.goo.rigView) {
    ctx.goo.layer = createGooLayer(ctx.boot.handle.renderer, {
      lightDir: ctx.goo.rigView.uniforms.lightDir,
      keyColor: ctx.goo.rigView.uniforms.keyColor,
      lightCfg: ctx.goo.rigView.uniforms.lightCfg,
    });
    ctx.render.postAa.addSink(ctx.goo.layer);
    const t = ctx.render.sdfLayer.targetSize;
    ctx.goo.layer.setSize(t.width, t.height);
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
    ctx.goo.layer.setSizeScale(0.14);
    ctx.goo.layer.setThreshold(0.65);
    // BLUR OFF (owner, 2026-08-31: "we can remove the blur"). 0 bypasses both
    // blur passes ENTIRELY — not a degenerate copy — so this is also two
    // fewer full-screen passes per frame. The code stays because goo-layer is
    // shared with the LAB, whose look is tuned around blurPx 2.5.
    ctx.goo.layer.setBlurPx(0);
    // DEPTH, not overlay. Overlay never depth-tests, so blood paints over the
    // crate it is behind and over the far side of the body it came out of,
    // which reads as a sticker regardless of scale. Overlay was added to
    // route around a depth blocker that turned out not to exist — the real
    // bug was the post-aa sink — so the reconstruction gets to do its job.
    ctx.goo.layer.setMode('depth');
    ctx.goo.layer.setStretch(4);
    ctx.goo.layer.setEdge(2.75);
    ctx.goo.layer.setAbsorb(1.6);
    ctx.goo.layer.setSpec(2.85);
    ctx.goo.layer.setGloss(220);
    ctx.goo.layer.setRim(0);
    // shadowRed RETUNED 0.12 -> 0.19 for the dungeon (owner, 2026-09-01).
    // Its whole job is that blood never reads black, and it was calibrated
    // against WHITE gallery walls that this relight deleted — against dark
    // wet stone the old floor was not enough to keep shadowed blood red.
    ctx.goo.layer.setShadowRed(0.19);

    // Smooth full-grid goo is the accepted default. Connections and sheets
    // remain opt-in; original reconstruction is available for comparison.
    const gooCandidateBoot = new URLSearchParams(location.search);
    ctx.goo.reconstruction = gooCandidateBoot.get('goorecon') === 'original' ? 'original' : 'smooth';
    ctx.goo.layer.setDensityScale(1);
    ctx.goo.connectionsEnabled = gooCandidateBoot.get('gooconnections') === '1';
    ctx.goo.sheetsEnabled = gooCandidateBoot.get('goosheets') === '1';
    ctx.goo.layer.setReconstruction(ctx.goo.reconstruction);

    // SELECTIVE SHUTTER BLUR (2026-09-17). Owner-accepted lab look, now a
    // shipped default: fixed 320°/360/20 s (44.44 ms) exposure on airborne
    // blood. The layer partitions THIS goo layer's density input (see
    // GooSelection) and composites as post-aa's pre-post capture stage, so the
    // blur runs in working-linear space before SSCS/FXAA/VHS and never touches
    // gameplay physics. Failure is surfaced through __sdfGame.bloodBlur.error,
    // never silently swallowed.
    ctx.panels.shutterGame = createShutterGameLayer({
      renderer: ctx.boot.handle.renderer,
      gooLayer: ctx.goo.layer,
      settings: readShutterGameSettings(location.search),
      onError: (message) => {
        // eslint-disable-next-line no-console
        console.error('[shutter-game] disabled after error:', message);
      },
    });
    // FLYING-GIB SHUTTER BLUR (2026-09-17, shutter task 3): the gib twin,
    // SHARING the blood exposure contract and adding its own on/off switch.
    // `?gibblur=0` disables only the gib layer.
    const gibSettings = readGibShutterSettings(location.search);
    gibSettings.exposureSeconds = ctx.panels.shutterGame.exposureSeconds;
    gibSettings.maxStreakPx = ctx.panels.shutterGame.maxStreakPx;
    gibSettings.seedScale = ctx.panels.shutterGame.seedScale;
    gibSettings.depthBiasM = ctx.panels.shutterGame.depthBiasM;
    // EXPLICIT ROUTE LIMIT (task 3). The gib layer isolates pieces by rendering
    // the LIVE scene through a dedicated layer; in the deferred route the gib
    // meshes are G-buffer producers with route-assigned materials, and that
    // isolated draw is neither validated nor safe (it re-triggers the deferred
    // march shader's pre-existing pipeline errors). Rather than silently leave
    // moving gibs excluded-but-undrawn, the gib blur is hard-off in deferred and
    // the gibs render sharp through their normal route. Reported, not hidden.
    const gibRouteSupported = !ctx.boot.deferredMode;
    if (!gibRouteSupported && gibSettings.enabled) {
      // eslint-disable-next-line no-console
      console.warn('[gib-shutter] deferred route: gib motion blur stays off '
        + '(only the legacy forward route is validated); gibs render sharp');
    }
    ctx.gibs.shutter = createGibShutterLayer({
      renderer: ctx.boot.handle.renderer,
      settings: gibSettings,
      supported: gibRouteSupported,
      onError: (message) => {
        // eslint-disable-next-line no-console
        console.error('[gib-shutter] disabled after error:', message);
      },
    });
    // `?giboccluder=0` disables the blood-against-blurred-gib depth test. It is
    // the A/B control for the mutual-occlusion evidence; ON is the shipped
    // behaviour. Parsed here (not in the layer) because it is a blood-pass
    // concern, not a gib-layer one.
    ctx.gibs.occluderEnabled = new URLSearchParams(location.search).get('giboccluder') !== '0';
    // ONE capture stage chains both layers: gibs first (they are opaque and
    // write their own depth in the layer), then blood over the gib-resolved
    // target. The blood resolve keeps occlusion against the capture's clean
    // static depth; the gib resolve occludes against that same depth.
    ctx.render.postAa.setCaptureStage((capture) => {
      let src: THREE.RenderTarget = capture;
      let gibDepth: THREE.DepthTexture | null = null;
      // GIBS DEGRADE (defer-compile task): the gib shutter draws the SAME
      // chunk material in its rgba16float context, so while the chunk program
      // is not ready its `capture` must not run — that draw would build the
      // second cold pipeline synchronously mid-frame. Nothing is selected, so
      // the blood pass sees the clean capture exactly as with gib blur off.
      if (ctx.gibs.shutter && ctx.boot.warmBackground.gibDraw() === 'draw') {
        const g = ctx.gibs.shutter.capture(capture, scene, camera);
        if (g) {
          src = g;
          gibDepth = ctx.gibs.shutter.occluderDepth;
        }
      }
      if (ctx.goo.enabled && ctx.panels.shutterGame) {
        // The blood resolve was built against the raw capture; point it at the
        // gib result so a blurred gib is not painted over by the blood pass.
        ctx.panels.shutterGame.setSceneTexture(src.texture);
        // MUTUAL OCCLUSION (task 4): the selected gibs were lifted out of the
        // clean capture, so their depth is NOT in `capture.depthTexture`. Hand
        // the blood resolve the gib layer's own depth so blood behind a
        // blurred gib is dropped instead of composited over it. `null` (gib
        // blur off / nothing selected) restores the single-depth behaviour.
        ctx.panels.shutterGame.setOccluderDepth(ctx.gibs.occluderEnabled ? gibDepth : null);
        const b = ctx.panels.shutterGame.capture(capture, ctx.vfx.bloodSim, camera);
        if (b) src = b;
      }
      return src === capture ? null : src;
    });
    // PREWARM against the real capture target: the layer/seed allocation and the
    // resolve/selected-layer pipeline compile happen here, at boot, instead of
    // stalling the first live blood/gib frame (measured ~0.26 s, 2026-09-17).
    ctx.panels.shutterGame.prewarm(ctx.render.postAa.captureTarget);
    ctx.gibs.shutter.prewarm(ctx.render.postAa.captureTarget);
    void ctx.panels.shutterGame.precompile();
    // Player-facing controls: separate blood/gib switches, SHARED exposure (ms)
    // and max-trail length. Ships visible like its sibling panels; debug seams
    // stay on the API.
    ctx.panels.shutterPanel = createShutterPanel(shutterPanelHost(ctx.panels.shutterGame, ctx.gibs.shutter));
    ctx.panels.shutterPanel.setVisible(true);
    const disposeShutter = (): void => {
      ctx.render.postAa.setCaptureStage(null);
      ctx.panels.shutterGame?.dispose();
      ctx.gibs.shutter?.dispose();
    };
    window.addEventListener('pagehide', disposeShutter);
    import.meta.hot?.dispose(() => {
      disposeShutter();
      window.removeEventListener('pagehide', disposeShutter);
    });

    // SUPPLEMENTARY IMPACT SPLASH boot flag. Read AFTER the shipping defaults
    // so it can only ever add the new crown, never move a shipped value. It
    // is independent of the goo candidates above.
    ctx.panels.impactSplashEnabled = gooCandidateBoot.get('impactsplash') === '1';
    if (ctx.panels.impactSplashEnabled) ensureImpactSplashLayer(ctx);

    // Live tuning panel (owner ask, 2026-08-31: "add a ui i can tune the goo
    // manually"). The look is a five-knob family found by sweeping two at a
    // time and watching; retyping setGooTuning after every reload is not a
    // sweep. Goo ships ON, so the panel ships VISIBLE with it — this is a
    // debug page and the panel is the reason to turn the layer on at all.
    // Dismissable with __sdfGame.gooPanel(false), which is also what the
    // headless look-capture calls so screenshots frame the room, not the UI.
    const L = ctx.goo.layer;
    ctx.panels.gooPanel = createGooPanel([
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
        get: () => ctx.vfx.beamTuning.gain, set: v => { ctx.vfx.beamTuning.gain = v; } },
      { key: 'beamShoulder', group: 'beam', min: 0, max: 0.9, step: 0.05,
        hint: 'Highlight rolloff. 0 = hard clip, and a lit body loses its WOUNDS (crater, lip and skin all saturate to the same white). Higher keeps them readable under the beam.',
        get: () => ctx.vfx.beamTuning.shoulder, set: v => { ctx.vfx.beamTuning.shoulder = v; } },
      { key: 'beamKeyFloor', group: 'beam', min: 0, max: 1, step: 0.05,
        hint: 'How much of the PRESET key survives when the beam is off. 1.0 = the old bug (characters brightly lit in pitch darkness from a fixed direction). 0 = an unlit body vanishes entirely, because bounce carries hue, not level.',
        get: () => ctx.vfx.beamTuning.keyFloor, set: v => { ctx.vfx.beamTuning.keyFloor = v; } },
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
  ctx.panels.woundPanel = createWoundPanel({
    get: () => ({ ...ctx.vfx.woundTuning }),
    set: (key, v) => applyWoundTuning({ [key]: v }),
    presets: [
      { label: 'shipped', values: { ...ctx.vfx.woundTuning } },
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
  ctx.panels.woundPanel?.setVisible(true);

  // `?goreparts=1` lays the gore-part bench out in front of the spawn (see
  // spawnGoreShowcase). It needs a live actor for the palette, so it runs here
  // rather than at the top of boot, and it is idempotent: the seam re-lays it
  // wherever the player is standing.
  if (ctx.vfx.goreShowcaseOn) {
    const n = spawnGoreShowcase(ctx);
    console.log(`[gore-parts] showcase: ${n} parts in front of the spawn`);
  }
  // `?gibparts=sprite` (or `?gibsprites=1`) lays the SPRITE bench instead — the
  // reference look, for judging the approach.
  ctx.gibs.partsMode = ctx.boot.search.get('gibparts');
  if (ctx.gibs.partsMode === 'sprite' || ctx.gibs.partsMode === 'sheet' || ctx.boot.search.get('gibsprites') === '1') {
    void ensureGibAtlas(ctx, ctx.gibs.partsMode === 'sheet' ? 'sheet' : 'placeholder').then(() => {
      const n = laySpriteBench(ctx);
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
  if (ctx.gibs.renderMode === 'carve') {
    // The ONLY boot-time carve trigger. Under the shipped default URL (no
    // ?gibrender=) this branch does not run: measured 2026-09-16, the default
    // mode is 'march' and the historical carve build cost is NOT boot cost.
    mark('carve-boot-scheduled');
    setTimeout(() => { mark('carve-build-start'); ensureCarvedLibrary(ctx); mark('carve-build-end'); }, 0);
  }
  if (ctx.gibs.renderMode === 'sprite') {
    void ensureGibAtlas(ctx, 'sheet').then((n) => {
      console.log(`[gib-sprites] blast render mode: sprite, ${n} frames, `
        + `live cap ${ctx.gibs.spriteLiveCap}, rest cap ${ctx.gibs.spriteRestCap}, size x${ctx.gibs.spriteSizeScale}`);
    });
  }
  // `?gibrender=assets` (task 2) preloads the committed offline sets at boot, so
  // the first detonation has meshes to deform. It is a fetch + decode, not an
  // extraction, so unlike carve it costs no surface nets; a body gibbed before
  // it resolves still gets marched pieces (counted), never no gore.
  if (ctx.gibs.renderMode === 'assets') {
    mark('gib-assets-boot-scheduled');
    void ensureGibAssets(ctx).then(() => {
      mark('gib-assets-boot-ready');
      console.log(`[gib-assets] blast render mode: assets, armed=${gibAssetArmed(ctx)}`);
    });
  }

  // DYNAMITE / GIB (dynamite-panel.ts). Same contract as the other three: ships
  // VISIBLE but COLLAPSED at the fourth slot, so its title bar is findable while
  // it covers nothing. The two presets are the comparison the owner asked for —
  // the split piece set with a pool wide enough not to degrade it, and the
  // one-chunk-per-limb shape he rejected, one click apart.
  ctx.panels.dynamitePanel = createDynamitePanel({
    get: (...a) => dynamiteTuningValues(ctx, ...a),
    set: (key, v) => applyDynamiteTuning(ctx, { [key]: v } as Partial<DynamiteTuningValues>),
    presets: [
      { label: 'optical wave', values: { blastdistort: 1, bdstrength: 2 } },
      { label: 'split', values: { mode: 2, bones: 2, maxchunks: 64, tearSec: 0.1 } },
      { label: 'tubes (old)', values: { mode: 0, bones: 0, maxchunks: 24 } },
      { label: 'plume', values: { plume: 1, capflat: 0.55, ringreach: 1.4 } },
      { label: 'ball (old)', values: { plume: 0 } },
    ],
  });
  ctx.panels.dynamitePanel.setVisible(true);

  // VHS tuning panel. The rows are derived from VHS_TERM_RANGES and every
  // emitted call is keyed by a `keyof VhsTerms`, so unlike the setBeam bug the
  // COPY text cannot name a key the setter ignores. Ships visible+collapsed
  // like its siblings; capture scripts dismiss it with __sdfGame.vhsPanel(false).
  ctx.panels.vhsPanel = createVhsPanel({
    setVhs: (preset) => { ctx.render.postAa.setVhs(preset); return ctx.render.postAa.vhs; },
    setVhsTerm: (name, value) => ctx.render.postAa.setVhsTerm(name, value),
    get vhs() { return ctx.render.postAa.vhs; },
    get vhsTerms() { return ctx.render.postAa.vhsTerms; },
  });
  ctx.panels.vhsPanel.setVisible(true);
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
  ctx.vfx.bloodView = createBloodView({
    dropletDepthWrite: true,
    dropletViewScale: 0.5,
    stretch: { k: 0.5, max: 3.5, thin: true },
    mist: true,
    // Round 2 (owner): "ribbons and blood trails to create cohesive lines of
    // fluid" — beads sweep tapered strips through their path history.
    ribbons: true,
  });
  for (const o of ctx.vfx.bloodView.objects) {
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
  if (ctx.goo.enabled) {
    ctx.vfx.bloodView.setBeadsVisible(false);
    ctx.vfx.bloodView.setMistVisible(true);
    // ...AND show the panel. It used to appear only via setGoo(true), which
    // this boot path deliberately does not call — so the panel that exists to
    // make the goo tunable was invisible on the page where goo ships ON, and
    // the owner had to toggle the layer off and on to get at it (owner ask,
    // 2026-09-01: "it should be default on tbh").
    ctx.panels.gooPanel?.setVisible(true);
  }
  // The bleed stream is `rngStreams.bleed` (rng.ts): ONE seeded stream for
  // EVERY bleed decision (spawns, trails, splat stamps) — advanced only while
  // bleed is enabled, so setBleed(false) freezes the subsystem exactly (OFF
  // mid-stream = ON-stream-paused).
  ctx.vfx.bleedEnabled = true;

  // GUT ROPES — at most one per body (entrails-spawn.shouldSpill): the first
  // qualifying cavity wound spawns, a second TEARS the rope free instead of
  // growing another, which bounds both the verlet sim and the goo particle
  // count. The chain owns node positions (entrails.ts); the sim only holds
  // this rope's 'gut' droplets — stepBlood skips that kind — so the goo pass
  // draws the rope as fused metaballs riding the wound's emit point.
  ctx.vfx.gutRopes = new Map<number, { chain: GutChain; wound: Wound; droplets: Droplet[] }>();
  /** Bleed's own sim clock — an accumulator, never wall time, so hand-
   *  stepped captures are deterministic. */
  ctx.vfx.bleedClock = 0;
  ctx.vfx.lastSplashShot = new WeakMap<ZombieActor, number>();

  // Wire every actor's severs into the chunk spawner (template = that
  // actor's own look — the chunk shades like the flesh it came from), and
  // each sever's stump wound into the bleed ledger (the gushing emitter —
  // the wound is the actor's own reference, so the anchor rides the body).
  ctx.boot.onSeverDispatch = (a, piece, stumpWound) => {
    ctx.telemetry.telemetry.event('sever', { actor: a.id, limb: piece.limb });
    spawnChunkPiece(piece, { uniforms: a.view.uniforms, volumeTexture: a.view.volumeTexture });
    if (stumpWound) registerBleed(ctx, a, stumpWound, 'stump');
  };

  // -----------------------------------------------------------------------
  mark('hud-start');
  // HUD: frame time, bodies on screen, probeWeight, where you are.
  // -----------------------------------------------------------------------
  // THE RETICLE. A target graphic rather than a bare dot, per the owner: outer
  // ring, four ticks and a centre pip, drawn as one inline SVG so it stays crisp
  // at any size and costs no asset. It is the aim point in free-aim mode.
  {
    ctx.player.reticleEl = document.createElement('div');
    ctx.player.reticleEl.setAttribute('style',
      'position:fixed; left:50%; top:50%; width:34px; height:34px; z-index:35;'
      + ' margin:-17px 0 0 -17px; pointer-events:none;'
      + ' filter:drop-shadow(0 0 2px rgba(0,0,0,0.9));');
    ctx.player.reticleEl.innerHTML =
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
    document.body.appendChild(ctx.player.reticleEl);
  }

  ctx.boot.hudEl = document.getElementById('hud');
  ctx.boot.hud = { lockHint: true };
  ctx.boot.frameEma = 0;
  mark('boot-time');
  ctx.boot.time = performance.now();

  // -----------------------------------------------------------------------
  mark('frameloop-start');
  // Frame loop.
  // -----------------------------------------------------------------------
  // ?frozen=1 — boot with the wanderers frozen from frame 0. The boot loop
  // starts stepping the moment the page loads, so a driver that freezes via
  // the seam has already inherited a non-deterministic amount of wander;
  // captures that must be reproducible across boots (pixel parity, staged
  // benches) need the freeze to predate the first frame. Default unchanged.
  ctx.demo.wanderFrozen = new URLSearchParams(location.search).has('frozen');
  /** The distance-crowd bench pins the player's POSE for the whole leg
   *  (`bench({ holdPlayer: true })`). The firefight's frame-0 teleport would
   *  overwrite the caller's placePlayer() framing, and the walk input (keys /
   *  autopilot) would drift the camera; with this on, tick() forces the input
   *  to zero. Ordinary play never sets it. */
  ctx.player.holdPlayerPose = false;
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
  ctx.demo.simLocked = new URLSearchParams(location.search).has('simidle');
  /** Whether the hulls have been built for the CURRENT frozen stretch — see
   *  the frozen-from-boot hull build in tick. */
  ctx.render.frozenHullBuilt = false;
  ctx.demo.frameCount = 0;
  /** The __sdfGame.placeMarker debug sphere. */
  ctx.player.marker = null;
  /** Headless driver autopilot: walk toward (x, z) until within 0.25 m. */
  ctx.player.autopilot = null;
  /** Stuck recovery: a wanderer frozen/standing on the path blocks the line
   *  head-on (the capsule push exactly opposes the intent, no slide). If we
   *  stop making progress, strafe around the obstacle for a beat. */
  ctx.player.stuckT = 0;
  ctx.player.strafeT = 0;
  ctx.player.strafeDir = 1;
  ctx.player.lastWalkPos = null;

  function tick(dt: number) {
    if (ctx.demo.simLocked) return; // render-lock: drawFn still runs; nothing mutates.
    // The sim clock advances ONLY here, from the step's own dt — never from
    // wall time. This is the single source of "how much simulated time has
    // passed", so every dwell/timer that reads it is reproducible under a
    // replay. See the declaration next to lastSeenMs for the why.
    advanceSimClock(dt);
    ctx.demo.simFrame++;
    // BLAST REFRACTION ages on SIM time, like every other sim clock — never
    // wall time — so a frozen capture advances it exactly one frame per step and
    // an on/off pair at the same frame is a real comparison (post-aa.ts).
    ctx.render.postAa.stepBlastDistort(dt);
    // Billboard the gib sprites. Cheap (a handful of quads) and it has to be per
    // frame: a piece that stops facing the camera vanishes edge-on.
    for (const s of ctx.vfx.spriteBenchSprites) billboardGib(s, camera);
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
      if (ctx.demo.recorder) { ctx.demo.recorder.push(inputFrame); updateDemoHud(ctx); }
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
    stepPlayer(ctx.player.player, input, dt, [...ctx.world.colliders, ...zombieBoxes]);

    // Damage transitions use their own clock; frozen pose captures must
    // still show a newly selected preset. Refresh exclusions as it grows.
    for (const a of ctx.world.actors) if (a.advanceWoundPreview(dt)) ctx.render.frozenHullBuilt = false;
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
          r: enclosureKeyAt(p[0],p[2]).startsWith('tunnel') ? .34 : a.engagedForCrowd() ? ENGAGED_RADIUS : .45,
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
          a.character.pose(a.body, a.boundRig(), p.yaw, a.sinceFire(), a.motionFrame(), dt, a.id, a.posed());
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
      if (ctx.render.sdfLayer.shellEnabled) {
        // Same posed bodies the occluder hull is built from, one line below —
        // this is what makes the hull "posed" at no extra cost.
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
    ctx.weapon.cooldown = Math.max(0, ctx.weapon.cooldown - dt);
    ctx.weapon.flare?.tickCooldown(dt);
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
    stepDynamite(dt);
    if (ctx.player.reticleEl) {
      ctx.player.reticleEl.style.display = ctx.player.freeAimOn ? 'block' : 'none';
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
    const flashV = flashEnvelope(ctx.weapon.flashAge);
    if (ctx.weapon.flashGroup && ctx.weapon.flashMaterial) {
      ctx.weapon.flashGroup.visible = flashV > 0;
      ctx.weapon.flashMaterial.opacity = flashV;
      // Expand as it dies rather than shrinking -- burning gas pushes outward.
      ctx.weapon.flashGroup.scale.setScalar(0.85 + 0.75 * (1 - flashV));
    }
    if (ctx.weapon.flashLight) ctx.weapon.flashLight.intensity = 55 * flashV;

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
    if (ctx.weapon.topLeverNode) ctx.weapon.topLeverNode.rotation.y = topLeverAngle(reloading ? ctx.weapon.reloadAge : 0);

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
        ctx.weapon.shells = MAGAZINE_CAPACITY;
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
            gibBakedPiece(b, p.pos);
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
            gibChunkMeat(c.template, hp);
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
            const stamped = p.kind === 'slug'
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
        if (expired(ctx.weapon.soldierPellets[i]!) || ctx.world.colliders.some(box =>
          segmentHitsBox(soldierFrom[i]!, ctx.weapon.soldierPellets[i]!.pos, box))) ctx.weapon.soldierPellets.splice(i, 1);
      }
      // The eye every tracer billboards around this frame. Declared here (not
      // reused from the block below) because that one is scoped to the hit
      // pass; the streaks need it whether or not anything was hit.
      const tracerEye = eyeOf(ctx.player.player);
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
      spawnScheduledGibs(dt);
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
        c.state = stepChunk(c.state, cdt, chunkCollidersAt(ctx, c.state.pos));
        c.view.update(c.state);
        if (ctx.bake.enabled && ctx.bake.jobs.pendingId === null && !ctx.bake.jobs.error && chunkSettled(c.state)) {
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
      // SPRITE PIECES, on the same clock and in the same block as the marched
      // ones — deliberately, because they are the same physics: `stepSpritePieces`
      // calls the same `stepChunk` with the same `chunkCollidersAt`, so a sprite
      // gib and a marched gib cannot disagree about where the wall is. What it
      // does NOT do is any of the bake: a settled sprite is parked, not retired
      // through a worker. Costs a loop over an empty array when the mode is off.
      if (ctx.vfx.spritePieces.live.length > 0 || ctx.vfx.spritePieces.rest.length > 0) {
        stepSpritePieces(ctx.vfx.spritePieces, {
          dt: cdt,
          cameraQuat: camera.quaternion,
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
          const { anchor, normal } = woundEmitAnchorAndNormal(a.posed().prims, e.wound, a.pose().yaw);
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
        ctx.vfx.bloodView.sync(ctx.vfx.bloodSim, camera);
      }
      ctx.telemetry.telemetry.end('blood-simulation-and-sync', bloodTiming);
      // The optional impact crown advances even with bleed off, so an event
      // already in flight finishes instead of freezing mid-burst.
      ctx.panels.impactSplashLayer?.step(cdt);
    }

    const eye = eyeOf(ctx.player.player);
    camera.position.set(eye[0], eye[1], eye[2]);
    const cp = Math.cos(ctx.player.player.pitch + ctx.weapon.recoilPitch);
    camera.lookAt(
      eye[0] + Math.sin(ctx.player.player.yaw) * cp,
      eye[1] + Math.sin(ctx.player.player.pitch + ctx.weapon.recoilPitch),
      eye[2] - Math.cos(ctx.player.player.yaw) * cp,
    );
    camera.updateMatrixWorld();

    // Optional impact crown: rebuild from the current event times after the
    // camera is final (its sync takes the camera for parity; geometry is
    // world-space). No-op when the feature is off.
    ctx.panels.impactSplashLayer?.sync(camera);

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
    ctx.goo.layer?.sync(ctx.vfx.bloodSim, camera);
    // GIB SHUTTER PARTITION: lift this frame's moving pieces onto the blur
    // layer BEFORE the base scene renders (the draw callback follows this tick),
    // so the capture's clean background has no selected gib in it. When the
    // switch is off the list is empty and every mesh is put back where it was.
    if (ctx.gibs.shutter) {
      ctx.gibs.shutter.select(ctx.gibs.shutter.enabled ? gibBlurSubjects(ctx) : []);
      if (!ctx.gibs.shutter.enabled) ctx.gibs.blurPrevKeys = new Set();
    }
    ctx.telemetry.telemetry.end('goo-sync', gooTiming);
  }

  ctx.boot.handle.setRenderCallback((dt) => {
    // Wall-clock frame delta (seconds -> ms), EMA'd — what the owner feels.
    // During __sdfGame.step() the dt is the supplied fixed step, not a
    // measurement; the readout only means something with the loop running.
    if (dt < 0.25) {
      const ms = dt * 1000;
      ctx.boot.frameEma = ctx.boot.frameEma === 0 ? ms : ctx.boot.frameEma * 0.95 + ms * 0.05;
      if (ctx.render.adaptiveEnabled) {
        ctx.render.adaptiveFrames.push(ms);
        tickAdaptive(ctx, performance.now());
      }
    }
    tick(Math.min(dt, 1 / 20));
    if (ctx.demo.frameCount++ % 10 === 0) updateHud(ctx);
  });
  updateHud(ctx);

  // -----------------------------------------------------------------------
  mark('api-start');

  // Read scalar counters only; no field queries/readbacks during live play.
  ctx.telemetry.firstFrame = true;
  ctx.telemetry.visibilityGap = false;
  document.addEventListener('visibilitychange', () => { ctx.telemetry.visibilityGap = true; });
  const telemetryFrame = (frame: FrameTiming) => {
    ctx.telemetry.telemetry.frame(frame, {
      hidden: document.hidden, visibilityGap: ctx.telemetry.visibilityGap, firstFrame: ctx.telemetry.firstFrame,
      pointerLocked: document.pointerLockElement === ctx.boot.canvas,
      actors: ctx.world.actors.length, bodiesOnScreen: bodiesOnScreen(ctx),
      liveChunks: ctx.bake.liveChunks.length, bakedChunks: ctx.bake.chunks.length,
      projectiles: ctx.weapon.pellets.length, droplets: ctx.vfx.bloodSim.droplets.length, splats: ctx.vfx.bloodSim.splats.length,
      player: [...ctx.player.player.pos], yaw: ctx.player.player.yaw, pitch: ctx.player.player.pitch,
      frameCap: ctx.boot.handle.frameCap, refreshMs: ctx.boot.handle.refreshMs,
      renderWidth: ctx.render.sdfLayer.marchTarget.width, renderHeight: ctx.render.sdfLayer.marchTarget.height,
      frozen: ctx.demo.wanderFrozen, chunkBake: ctx.bake.enabled, bleed: ctx.vfx.bleedEnabled,
      totalWounds: ctx.world.actors.reduce((n, a) => n + a.wounds().length, 0),
      pendingBake: ctx.bake.jobs.pendingId, bakeError: ctx.bake.jobs.error,
      tiles: ctx.boot.gameTiles.diagnostics(), sdfScale: ctx.render.sdfScale, adaptive: ctx.render.adaptiveEnabled,
      woundStep: ctx.world.actors[0]?.view.uniforms.perfCfg.value.z, analyticNormals: ctx.telemetry.normalGradientMode,
      // Fill-bound march: cost tracks covered pixels, so a capture without an
      // area term cannot separate "wounds are expensive" from "close bodies
      // are expensive". CPU estimate — see the `coverage` declaration.
      coverageFrac: +ctx.world.coverage.screenFrac.toFixed(4),
      nearestBodyM: +ctx.world.coverage.nearestM.toFixed(2),
      biggestBodyFrac: +ctx.world.coverage.biggestFrac.toFixed(4),
      actorCull: ctx.render.actorCullEnabled, visibleBodies: ctx.world.cullCounts.visible,
      halfRate: ctx.render.sdfLayer.halfRate, halfRateMode: ctx.render.sdfLayer.halfRateMode,
      depthPrepass: ctx.render.sdfLayer.depthPreEnabled,
      fieldMode: ctx.render.sdfLayer.fieldMode, fieldStyle: ctx.render.sdfLayer.fieldStyle, fieldComb: ctx.render.sdfLayer.fieldComb,
    });
    ctx.telemetry.firstFrame = false; ctx.telemetry.visibilityGap = false;
    ctx.telemetry.controls?.afterFrame();
  };
  ctx.telemetry.controls = import.meta.env.DEV ? createTelemetryControls(ctx.telemetry.telemetry, async () => ({
    build: await fetch('/__lab/telemetry-build', { cache: 'no-store', signal: AbortSignal.timeout(5000) }).then(r => { if (!r.ok) throw new Error('Build identity unavailable'); return r.json(); }),
    buildAtServerStart: import.meta.env.VITE_TELEMETRY_BUILD ?? { commit: 'unknown', dirty: true },
    captureVersion: 2, targetFrameMs: 1000 / 30, lateToleranceMs: 2, tiles: ctx.boot.gameTiles.diagnostics(),
    page: location.pathname, query: location.search, userAgent: navigator.userAgent, backend: ctx.boot.handle.backend,
    visibility: document.visibilityState, frameCap: ctx.boot.handle.frameCap,
    fisheye: fisheyeReport(ctx), renderWidth: ctx.render.sdfLayer.marchTarget.width, renderHeight: ctx.render.sdfLayer.marchTarget.height,
    woundStep: ctx.world.actors[0]?.view.uniforms.perfCfg.value.z,
    hullExitBound: ctx.world.actors[0]?.view.uniforms.perfCfg.value.x,
    halfRate: ctx.render.sdfLayer.halfRate, halfRateMode: ctx.render.sdfLayer.halfRateMode,
    depthPrepass: ctx.render.sdfLayer.depthPreEnabled, actorCull: ctx.render.actorCullEnabled,
    fieldMode: ctx.render.sdfLayer.fieldMode, fieldStyle: ctx.render.sdfLayer.fieldStyle, fieldComb: ctx.render.sdfLayer.fieldComb,
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
    ctx.telemetry.firstFrame = true; ctx.telemetry.visibilityGap = false;
    ctx.boot.handle.setFrameObserver(active ? telemetryFrame : null);
    if (active) captureTelemetryScene(ctx, 'recording-start');
  }, () => captureTelemetryScene(ctx, 'visual-issue')) : null;
  import.meta.hot?.dispose(() => ctx.telemetry.controls?.dispose());

  // CONTROLLED FORWARD DEPTH PROBES (evidence seam backing __sdfGame
  // spawnDepthProbes/clearDepthProbes below). Deliberately UNREGISTERED:
  // the router hides unregistered renderables from the mesh/sdf G-buffer
  // passes and leaves them alone in the forward route, so these sprites
  // only ever composite depth-tested over the presented frame.
  ctx.render.depthProbes = [];
  const clearDepthProbes = () => {
    for (const s of ctx.render.depthProbes) {
      scene.remove(s);
      s.material.dispose();
    }
    ctx.render.depthProbes.length = 0;
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
    const t = ctx.render.sdfLayer.marchTarget;
    const w = t.width, h = t.height;
    // 4 floats per texel is the march target's contract (rgba32f). Asserted
    // rather than assumed: a format change would otherwise be hashed as
    // garbage that still looks like a number.
    const floatsPerTexel = 4;
    if (!w || !h) throw new Error(`frameHash: marchTarget is ${w}x${h}`);
    const data = await ctx.boot.handle.renderer.readRenderTargetPixelsAsync(t, 0, 0, w, h);
    return { width: w, height: h, floatsPerTexel, data: data as ArrayLike<number> };
  };
  /** The gather's dynamic probe layer, or null when the gather is not bound
   *  (a legitimate boot: `?probedyn=0` and the lab pages have none). */
  const readProbeDynForHash = async (): Promise<Float32Array | null> =>
    ctx.probes.gather ? await ctx.probes.gather.readback() : null;
  /** THE GATHER'S PACKED INPUTS — the bone capsules it gathers against, and the
   *  live count. Hashing these separates "two boots posed the bodies
   *  differently" from "the gather diverged on identical inputs", which is the
   *  open question from the 2026-09-10 frame-hash runs. See DemoHashDeps. */
  const readInstancesForHash = async (): Promise<{ data: ArrayLike<number>; count: number; floatsPerInstance: number } | null> =>
    // `probeLastCapsules` is the module-scope mirror of the draw callback's own
    // `probeCapsuleCount` (the count is written there and published here), which
    // is the only one this scope can see.
    ({ data: ctx.probes.capsuleArrays.ab, count: ctx.probes.lastCapsules, floatsPerInstance: INSTANCE_FLOATS });

  /** THE ONE frame-hash dependency set. Kept as a single object on purpose:
   *  this was four inline object literals, and they SILENTLY DRIFTED — two grew
   *  `readInstances` and two did not, so the instances layer vanished from a
   *  run with no error. A hash whose layer set depends on which call site asked
   *  is not a hash. */
  ctx.boot.frameHashDeps = {
    readMarchTarget: readMarchTargetForHash,
    readProbeDyn: readProbeDynForHash,
    readInstances: readInstancesForHash,
  };

  // -------------------------------------------------------------------------
  mark('demo-start');

  /** Apply the DEMO-BOOT flags a replay cares about — the ones that change the
   *  SCENE, not the dev levers the caller pins. Only crowd and sdf scale today;
   *  add a flag here the moment a recording depends on it, or a replay of a
   *  crowd run would silently measure the per-body path. */
  function applyDemoQuery(query: string): void {
    const q = new URLSearchParams(query);
    if (q.has('crowd')) {
      const on = q.get('crowd') === '1';
      if (on !== ctx.crowd.on) { ctx.crowd.on = on; rebuildCast(); }
    }
    if (q.has('scale')) {
      const v = Number(q.get('scale'));
      if (Number.isFinite(v) && v > 0) applySdfScale(ctx, v);
    }
  }

  /** The F7 HUD line, created lazily and parked above the telemetry controls. */
  ctx.demo.hudEl = null;

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
    if (opts.hold !== false) ctx.demo.hold = true;
    ctx.boot.handle.setLoopRunning(false);
    const hadAdaptive = ctx.render.adaptiveEnabled; ctx.render.adaptiveEnabled = false;
    const hadReplay = ctx.demo.replayActive; ctx.demo.replayActive = true;
    const hadLock = ctx.demo.simLocked;
    // Render-side cadences reset + settled BEFORE the sim runs, exactly as the
    // bench does under ?simidle. inert for a non-hash caller and REQUIRED for a
    // hash: without it the frame parity and instance pack at frame 0 depend on
    // how long the page happened to boot.
    ctx.demo.hold = true;
    ctx.demo.seedBase = ctx.probes.frame;
    ctx.render.postAa.setTimeFrozen(true);
    ctx.render.sdfLayer.resetFieldPhase();
    ctx.probes.gatherTick = 0;
    // AND the pack waiting to be dispatched. Without this the first replay draw
    // dispatches a pack left over from boot, so the gather gets one extra
    // dispatch in one run and not the other (measured: 301 vs 300), which moves
    // the blended dynamic layer and makes the frame hash flap.
    ctx.probes.pendingGather = null;
    ctx.probes.gather?.reset();
    ctx.demo.simLocked = false;
    const hadHoldPlayer = ctx.player.holdPlayerPose; ctx.player.holdPlayerPose = false;
    // Free-aim vs mouselook is a SIM input mode: it decides whether `look` is
    // pinned or dx/dy drives the reticle. The recording says which one it was
    // captured in; an old file without the flag leaves the page as booted.
    const hadFreeAim = ctx.player.freeAimOn;
    if (typeof file.meta?.freeAim === 'boolean') ctx.player.freeAimOn = file.meta.freeAim;
    const iter = createDemoPlayer(file);
    const hashes: import('./frame-hash').FrameHash[] = [];
    const parity: number[] = [];
    const every = Math.max(1, Math.floor(opts.every ?? 4));
    const hashFrom = Math.max(0, Math.floor(opts.hashFrom ?? 0));
    const started = performance.now();
    let frames = 0;
    ctx.demo.replayFrame = 0;
    try {
      // The replay starts from the SAME origin the synth/recorder did: sim
      // clock zeroed and the named streams reseeded, so a recorded draw index
      // means the same thing here as it did when captured.
      resetSimClock();
      setRngSeed(file.seed);
      applyDemoQuery(file.query);
      placeFromDemo(ctx, file);
      ctx.demo.simLocked = false;
      ctx.player.prevInputKeys = new Set<string>();
      ctx.player.currentInputFrame = { keys: [], dx: 0, dy: 0, fire: 0, reload: false, look: [ctx.player.player.yaw, ctx.player.player.pitch] };
      // SETTLE BEFORE FRAME 0. Two replays of one recording differed at the
      // FIRST sampled frame only (frame 0 or 92 alike) — whatever the boot left
      // queued (worker replies, uploads, the first GPU fence) landed on the
      // same yield that took the first hash. Drain it here, before any sim
      // frame, so frame 0 starts from a page that has nothing in flight.
      await awaitBakes(ctx);
      await ctx.boot.handle.resolveGpu();
      for (let f = 0; ; f++) {
        const frame = iter.next();
        if (!frame) break;
        ctx.player.currentInputFrame = frame;
        await awaitBakes(ctx);
        ctx.boot.handle.step(file.dt);
        frames++;
        // `hashFrom` skips the RENDER warm-up frames: the scripted recorder
        // settles `warmup` frames before its first hash, and a replay gets the
        // same treatment by not sampling its own first `hashFrom` frames. The
        // SIM still advances through every frame — only the samples are skipped.
        // The final frame is sampled only when it sits on the same interlace
        // field as the regular samples: a recording with an even frame count
        // would otherwise mix parities and the ab gate refuses the run.
        if (opts.hash && f >= hashFrom && (f % every === 0 || (f === file.frames.length - 1 && (f & 1) === (hashFrom & 1)))) {
          await ctx.boot.handle.resolveGpu();
          hashes.push(await hashFrame(ctx.boot.frameHashDeps, f));
          parity.push(f % 2);
        }
      }
    } finally {
      ctx.demo.replayActive = hadReplay;
      ctx.demo.simLocked = hadLock;
      ctx.render.adaptiveEnabled = hadAdaptive;
      ctx.player.holdPlayerPose = hadHoldPlayer;
      ctx.player.freeAimOn = hadFreeAim;
      ctx.player.currentInputFrame = neutralInput(ctx, ctx.player.currentInputFrame);
    }
    return {
      frames,
      census: sceneCensus(ctx),
      hashes,
      parity,
      every,
      ms: Math.round(performance.now() - started),
      dispatches: ctx.probes.frame - ctx.demo.seedBase,
      label: opts.label ?? file.startedAt,
      // Bake outcomes, so a diverging replay can be blamed on a swap without a
      // second run: which soldiers baked, the last gib swap frame, bake count.
      bakes: { corpse: ctx.world.soldierCorpses?.stats() ?? null, chunkSwapFrame: ctx.bake.lastSwapFrame, chunkBakes: ctx.bake.totalBakes, chunkError: ctx.bake.jobs.error },
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
    ctx.boot.handle.setLoopRunning(false);
    const hadLock = ctx.demo.simLocked; ctx.demo.simLocked = false;
    const hadAdaptive = ctx.render.adaptiveEnabled; ctx.render.adaptiveEnabled = false;
    const hadReplay = ctx.demo.replayActive; ctx.demo.replayActive = true;
    const hadHold = ctx.demo.hold; ctx.demo.hold = true;
    const slugWas = ctx.weapon.slugMode;
    // The scripted aim sets player.yaw/pitch directly, so the synthetic
    // recording is captured in MOUSELOOK mode (freeAim=false) and records that
    // as a precondition. Otherwise a replay would run the reticle path and
    // ignore the recorded look.
    const aimWas = ctx.player.freeAimOn;
    ctx.player.freeAimOn = false;
    let rec: DemoRecorder | null = null;
    try {
      // The scenario's frame-0 teleport is a PRECONDITION, not an input: its
      // computed standoff is recorded as the start pose so a replay can put the
      // player there without re-deriving it from a room id.
      const tele = scenario.steps.find(s => s.at === 0 && s.action.kind === 'teleport');
      if (tele) performBenchAction(ctx, tele.action);
      resetSimClock();
      setRngSeed(ctx.demo.seed);
      ctx.weapon.slugMode = false;
      ctx.player.currentInputFrame = { keys: [], dx: 0, dy: 0, fire: 0, reload: false, look: [ctx.player.player.yaw, ctx.player.player.pitch] };
      rec = createDemoRecorder({
        seed: ctx.demo.seed,
        query: location.search.replace(/^\?/, ''),
        room,
        dt: 1 / 60,
        meta: {
          label: o.label ?? `synthetic-firefight-room${room}`,
          script: 'firefight',
          synthetic: true,
          freeAim: false,
          startPose: { x: ctx.player.player.pos[0], z: ctx.player.player.pos[2], yaw: ctx.player.player.yaw, pitch: ctx.player.player.pitch },
        },
      });
      ctx.player.prevInputKeys = new Set<string>();
      for (let f = 0; f < scenario.frames; f++) {
        let fire: 0 | 1 | 2 = 0;
        let toggleSlug = false;
        for (const a of actionsAt(scenario, f)) {
          if (a.kind === 'aimSurface') aimAtNearestSurface(ctx);
          else if (a.kind === 'fire') fire = a.barrels;
          else if (a.kind === 'fireSlug') { toggleSlug = true; fire = 1; }
        }
        const frame: DemoFrame = {
          keys: toggleSlug ? ['KeyE'] : [], dx: 0, dy: 0, fire, reload: false,
          look: [ctx.player.player.yaw, ctx.player.player.pitch],
        };
        // Stage, do NOT apply: `tick` consumes currentInputFrame through
        // applyInputFrame, exactly as the bench's `input` action does. Applying
        // it here too would fire every shot twice.
        ctx.player.currentInputFrame = frame;
        rec.push(frame);
        await awaitBakes(ctx);
        ctx.boot.handle.step(1 / 60);
        if (toggleSlug) {
          const off: DemoFrame = {
            keys: ['KeyE'], dx: 0, dy: 0, fire: 0, reload: false,
            look: [ctx.player.player.yaw, ctx.player.player.pitch],
          };
          ctx.player.currentInputFrame = off;
          rec.push(off);
          await awaitBakes(ctx);
          ctx.boot.handle.step(1 / 60);
        }
      }
    } finally {
      ctx.weapon.slugMode = slugWas;
      ctx.player.freeAimOn = aimWas;
      ctx.demo.replayActive = hadReplay;
      ctx.demo.simLocked = hadLock;
      ctx.render.adaptiveEnabled = hadAdaptive;
      ctx.demo.hold = hadHold;
      ctx.player.currentInputFrame = neutralInput(ctx, ctx.player.currentInputFrame);
    }
    if (!rec) throw new Error('demoSynthesize: recorder was never created');
    return rec.stop();
  }

  // F7 toggles the input recorder. F8/F9 are telemetry (game-telemetry-controls).
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'F7' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    e.preventDefault();
    if (ctx.demo.recorder) void demoRecordStop(ctx, true);
    else demoRecordStart(ctx);
  });

  // -------------------------------------------------------------------------
  mark('draw-ready');
  // Everything the draw callback reads now exists — let frames draw. See the
  // boot-frame gate's note at setDrawFn.
  ctx.boot.drawReady = true;
  (window as unknown as { __sdfGame: unknown }).__sdfGame = {
    ...createGibsBakeSeams(ctx),
    ...createLightingProbeSeams(ctx),
    ...createDemoStepSeams(ctx),
    ...createRenderQualitySeams(ctx),
    ...createWeaponAimSeams(ctx),
    ...createFireSeams(ctx),
    ...createSkeletonSeams(ctx),
    ...createDynamiteSeams(ctx),
    ...createMarchDebugSeams(ctx),
    ...createLeftoverSeams(ctx),
    ...createMiscSeams(ctx),
    ...createFxSeams(ctx),
    ...createWeaponPlayerSeams(ctx),
    ...createBootSeams(ctx),
    ...createRenderSeams(ctx),
    ...createWorldSeams(ctx),
    ...createDebugProbeSeams(ctx, { clearDepthProbes, countDescendants, nodeDepth, round2 }),
    ...createBenchSeams(ctx, { awaitBakes: withCtx(ctx, awaitBakes), bodiesOnScreen: withCtx(ctx, bodiesOnScreen), demoScenarioOf: withCtx(ctx, demoScenarioOf), performBenchAction: withCtx(ctx, performBenchAction) }),
    ...createRenderDiagSeams(ctx, { bodiesOnScreen: withCtx(ctx, bodiesOnScreen), camera }),
    ...createShellDiagSeams(ctx, { bodiesOnScreen: withCtx(ctx, bodiesOnScreen), shellAmpOf: withCtx(ctx, shellAmpOf), camera }),
    ...createSpawnGooSeams(ctx, { BUNDLE_CEIL_M, playerRoomId: withCtx(ctx, playerRoomId), spawnChunkPiece }),
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
    setTiles: setGameTiles,
    /** CROWD STAGE A: switch between the per-body path and one draw per
     *  character type (?crowd=1 at boot). BOTH directions rebuild the cast:
     *  view.rebind leaves a view's own material pointing at the crowd type's
     *  record buffer, so a plain detach cannot restore the per-body path, and
     *  a fresh spawn is the only honest way back (Task 5 note). `?crowd=0` is
     *  the cheaper canonical opt-out — it never attaches at all. */
    setCrowd(on: boolean) {
      if (on === ctx.crowd.on) return;
      ctx.crowd.on = on;
      rebuildCast();
    },
    /** Smallest centre-to-centre distance between any two zombies (m).
     *  Two 0.35 m bodies touch at 0.70; below that they are interpenetrating. */
    crowdMinDist: () => minPairDistance(ctx.world.actors.map(a => {
      const p = a.pose().pos;
      return { x: p[0], z: p[2], r: ZOMBIE_RADIUS, mobile: true };
    })),
    clearDepthProbes: () => clearDepthProbes(),

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
      return woundTuningNow(ctx);
    },
    /** P3 capture: replace every actor with the default cast (fresh, unwounded bodies). */
    resetCast: () => { rebuildCast(); return ctx.world.actors.length; },
    /** The active render cap + how it was chosen (?res=). */
    get resolution() {
      const cap = RES_RUNGS[ctx.boot.resKey];
      const content = ctx.render.postAa.contentSize;
      return {
        rung: ctx.boot.resKey,
        cap: { ...cap },
        content: { ...content },
        letterboxed: cap.mode === 'fixed',
      };
    },
    // ——— DYNAMITE (slot 2) ————————————————————————————————————————————————
    /** The REAL detonation — the same call a thrown bundle makes, gibs and all.
     *  `explode` above stays the wound-only capture twin: this one displaces
     *  bodies and destroys them, so a still frame of it is not reproducible. */
    detonate: (x: number, y: number, z: number) => {
      const before = { actors: ctx.world.actors.length, chunks: ctx.bake.liveChunks.length };
      detonateAt([x, y, z]);
      return {
        // `dynLastRadiusM`, NOT `explosionRadiusM()`: see that field's block —
        // the constant made every radius knob invisible to every rig.
        radiusM: ctx.dynamite.lastRadiusM,
        actorsBefore: before.actors,
        actorsAfter: ctx.world.actors.length,
        chunksBefore: before.chunks,
        chunksAfter: ctx.bake.liveChunks.length,
        gibbed: ctx.dynamite.gibbed,
        gibPieces: ctx.dynamite.gibPieces,
        lastBlastMs: ctx.dynamite.lastBlastMs,
      };
    },
    /** AUTOMATION: the in-hand overcook, without waiting out the fuse. */
    overcook: () => { overcookInHand(); return { ok: true }; },
    resetGibAssets: () => {
      const dropped = clearSpritePieces(ctx.vfx.spritePieces);
      ctx.gibs.assetRuntime.dispose();
      resetGibAssetCache();
      ctx.gibs.assetRuntime = createGibAssetRuntime();
      return dropped;
    },
    spawnDebugCharacter: (name: string, start?: Vec3) => {
      const room = ROOMS.find(r => r.id === playerRoomId(ctx)) ?? ROOMS[0]!;
      const starts = spawnPoints(room);
      // The game's own debug seam keeps the modulo default; crowdGridPoints()
      // callers pass an explicit point (perf 7f).
      const chosen = start ?? starts[ctx.world.actors.filter(a => a.room === room.id).length % starts.length]!;
      const errs: string[] = [];
      const actor = spawnEnemy(name, room, chosen, errs);
      ctx.world.actors.push(actor);
      if (errs.length > 0) console.error(`[sdf-game] spawnDebugCharacter(${name}):`, errs.join(' | ')) ;
      return { id: actor.id, room: room.id, errors: errs };
    },
    /** Re-run the warm-up on demand. The startup probe uses this to prove the
     *  loop-restore contract: pause the loop, call rewarm(), assert it is still
     *  paused. Warm steps are cache hits after boot, so this is cheap. */
    rewarm: () => warmPipelines(),
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
