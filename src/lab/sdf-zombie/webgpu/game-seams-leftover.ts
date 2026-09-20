// src/lab/sdf-zombie/webgpu/game-seams-leftover.ts
//
// Members lifted verbatim out of game-main.ts's `window.__sdfGame` literal.
// Every one needed nothing but the GameContext, so this factory takes no deps.
//
// Plan: docs/superpowers/plans/2026-09-17-game-main-decomposition.md

import type { GameContext } from './game-context';
import * as THREE from 'three/webgpu';
import { ATTACK_TUNING } from '../attack';
import { IMPACT_GOUT, type ImpactGoutProfile } from '../blood-sim';
import { characterNames } from '../character-registry';
import { woundWorldPos } from '../damage';
import { resolveExplosion, type ExplosionBody } from '../explosion-aoe';
import { RING_TUNING } from '../melee-ring';
import { MOTION_TUNING } from '../motion';
import { type Vec3 } from '../types';
import { sdBody } from '../validate';
import { bodyBuildCacheStats } from './character-view';
import { REC_ANCHOR_BAND, REC_COUNTS, REC_COUNTS2, REC_MELT, REC_VEC4S, REC_VOL_POSE0, REC_WIND_ALIVE, REC_WOUND_BOUND } from './crowd-records';
import { type DynamiteTuningValues } from './dynamite-panel';
import { clampFovDeg } from './fisheye';
import { BOB, FREE_AIM } from './free-aim';
import { applyDynamiteTuning, dynamiteTuningValues } from './game-dynamite-tuning';
import { ensureGibAssets, gibAssetArmed } from './game-gibs-leaves';
import { FURNITURE, ROOMS, TUNNELS, enclosureKeyAt, enclosureOf } from './game-level';
import { applyBoneCullMode, applyBoneMesh, fisheyeReport } from './game-render-leaves';
import { applyBoneCull } from './game-render-leaves2';
import { spillVerdict, woundTuningNow } from './game-vfx-leaves';
import { RELOAD } from './game-viewmodel';
import { traceProjectile, woundFromPellet, woundFromSlug } from './game-weapon';
import { setSpritePiecesVisible } from './gib-sprite-pieces';
import { classifyNormalSupport } from './normal-gradient-support';
import { getPipelineCensus, getPipelineLog, getPipelineShaderSource, setPipelineLogEnabled } from './pipeline-log';
import { type VhsPreset, type VhsTerms } from './post-vhs';
import { runUpscaleSelfCheck } from './upscale/upscale-selfcheck';
import { type RefineTail } from './zombie-gpu';

export function createLeftoverSeams(ctx: GameContext) {
  const { scene, camera } = ctx.boot.handle;
  return {
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
  };
}
