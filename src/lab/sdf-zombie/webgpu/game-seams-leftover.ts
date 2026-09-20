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
    /** PIPELINE-CREATION LOG (pipeline-log.ts, startup-hitch attribution).
     *  `setPipelineLog(true)` starts recording per-creation entries (the
     *  device wraps are installed at boot regardless); `pipelineLog()` reads
     *  the long frames (>= 100 ms wall) with the pipelines created during
     *  each, plus the totals and the renderer.compute() per-frame census. */
    setPipelineLog: (on: boolean) => setPipelineLogEnabled(on),
    pipelineLog: () => getPipelineLog(),
    /** COMPILE CENSUS (2026-09-19 shader-compile-time task, MEASURE ONLY).
     *  Every pipeline creation recorded while `?pipelinelog=1` is on, with
     *  start/end timestamps, WGSL module byte lengths, three's render-cache
     *  key and the descriptor signature, plus the shader-module fingerprint
     *  census. `scripts/compile-census.mjs` is the driver; `pipelineLog()` is
     *  the older long-frame hitch view and is unchanged. Payload is empty
     *  (and costs nothing) unless the log is enabled. */
    pipelineCensus: () => getPipelineCensus(),
    /** The WGSL source for one module hash from the compile census, so a
     *  driver can diff two variants offline. Undefined unless the log is on. */
    pipelineShaderSource: (hash: string) => getPipelineShaderSource(hash),
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
    /**
     * DEPTH-PREPASS STATS (close-up task 3) — is the coarse pass actually
     * writing starts? Same readback contract as occupancy() (one paused
     * step, row-padded float read) on the quarter-res target. A pass that
     * writes nothing (meshes not staged, clear-colour trap, fetch wrong)
     * is invisible in the frame and shows up here as nonZero 0.
     */
    async depthPreStats() {
      ctx.boot.handle.setLoopRunning(false);
      ctx.boot.handle.step(1 / 60);
      await ctx.boot.handle.resolveGpu();
      const t = ctx.render.sdfLayer.depthPreTarget;
      const w = t.width;
      const h = t.height;
      const buf = new Float32Array(
        await ctx.boot.handle.renderer.readRenderTargetPixelsAsync(t, 0, 0, w, h),
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
      ctx.boot.handle.setLoopRunning(true);
      return { w, h, texels: w * h, nonZero, min: nonZero ? +min.toFixed(3) : 0, max: +max.toFixed(3), mean: nonZero ? +(sum / nonZero).toFixed(3) : 0 };
    },
  };
}
