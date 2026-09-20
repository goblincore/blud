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
      const rt = ctx.render.sdfLayer.outputTarget;
      if (!rt) return null;
      const w = rt.width, h = rt.height;
      const raw = new Float32Array(await ctx.boot.handle.renderer.readRenderTargetPixelsAsync(rt, 0, 0, w, h));
      const bytes = new Uint8Array(raw.buffer);
      let binary = '';
      for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      return { w, h, rgba32f: btoa(binary) };
    },
    /** Task-8 evidence seam: live gut-rope state per body, read-only. A body
     *  with no rope entry reports {none: true}. droplets is the rope's current
     *  'gut'-kind population in the blood sim (the goo pass's input). */
    guts: () => ctx.world.actors.map(a => {
      const e = ctx.vfx.gutRopes.get(a.id);
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
     * Screen-space metaball blood (X1.bleed-look round 2). ON suppresses the
     * bead + ribbon sprites: the goo surface carries the fluid body, and
     * those are the hard-edged shapes it exists to replace (they would also
     * draw the same particles twice). Mist and floor splats stay.
     */
    setGoo(on: boolean) {
      if (!ctx.goo.layer) return false;
      ctx.goo.enabled = on;
      // Beads and ribbons go: they are the hard-edged shapes the goo
      // replaces, and they would draw the same particles twice.
      ctx.vfx.bloodView.setBeadsVisible(!on);
      // MIST STAYS. Hiding it (first cut) was a bug with teeth: the goo only
      // draws where droplets OVERLAP, so a sparse hit — an ordinary pellet
      // at range — crosses no threshold and draws NOTHING, and with mist off
      // too the result was a wound with no blood at all. Reproduced headless:
      // pellet at threshold 1.5 spawned 10 droplets and rendered zero pixels.
      // The reference frames want both anyway — connected masses PLUS fine
      // satellite specks — so mist is the sparse-case floor and the grain.
      ctx.vfx.bloodView.setMistVisible(true);
      ctx.panels.gooPanel?.setVisible(on);
      return true;
    },
    /** Exposure in ms — longer = longer trails. Clamped [0, 200]. Shared by
     *  the blood AND gib layers (the panel control is one control). */
    setBloodBlurExposure: (ms: number) => {
      const applied = ctx.panels.shutterGame?.setExposureMs(ms) ?? 0;
      ctx.gibs.shutter?.setExposureMs(applied);
      ctx.panels.shutterPanel?.refresh();
      return applied;
    },
    /** Max drawn trail in CONTENT pixels. Clamped [1, 400]. Shared. */
    setBloodBlurMaxStreak: (px: number) => {
      const applied = ctx.panels.shutterGame?.setMaxStreakPx(px) ?? 0;
      ctx.gibs.shutter?.setMaxStreakPx(applied);
      ctx.panels.shutterPanel?.refresh();
      return applied;
    },
    /** FLYING-GIB SHUTTER BLUR — separate switch, shared exposure. */
    setGibBlur: (on: boolean) => {
      const next = ctx.gibs.shutter?.setEnabled(on) ?? false;
      ctx.panels.shutterPanel?.refresh();
      return next;
    },
    get woundTuning() {
      return woundTuningNow(ctx);
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
    /** Wound union-reach cull (close-up wound-cull task, 2026-09-05) —
     *  applyWounds' one-sphere test before the wound loop. SHIPS ON; a value
     *  no-op by construction, so ON vs OFF is a pixel-parity gate, and the
     *  bench's cullOff leg prices what the loop cost. Bodies only: chunk
     *  torn-end wounds ride writeWounds directly and keep the 1e9 no-cull
     *  identity (a chunk's proxy box is already tight). */
    setWoundCull(on: boolean) {
      ctx.vfx.woundCullRequested = on;
      for (const a of ctx.world.actors) a.view.setWoundCull(on);
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
    /** Dev twin of the lab's stampWoundAt (2026-08-27): ONE wound by ray
     *  through the same worldHitToWound path the pellet uses, pushed via
     *  stampBlast — no damage, no shove, no sever. A full grapeshot volley
     *  kills and death-gibs (the weapon works), so a pocked STANDING torso
     *  only exists through this seam. */
    stampWoundAt: (ox: number, oy: number, oz: number, dx: number, dy: number, dz: number,
      kind: 'pellet' | 'slug' = 'pellet', bodyId?: number) => {
      const a = bodyId === undefined ? ctx.world.actors[0] : ctx.world.actors.find(q => q.id === bodyId);
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
      spillVerdict(ctx, a, w);
      return hit;
    },
    warmDone: () => (window as unknown as Record<string, unknown>).__warmDone ?? null,
    /** DEFER-COMPILE (2026-09-19): the background-compile state machine —
     *  `{ gib, crowd }` each pending|compiling|ready|failed. A driver reads it
     *  to know whether a gib/crowd draw will use the fast path or degrade. */
    warmBackground: () => ctx.boot.warmBackground.snapshot(),
  };
}
