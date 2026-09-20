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
    /** Pin the render-side subsampling clocks the frame hash needs constant
     *  (actor animation phase, gather frameSeed). See the demoHold declaration.
     *  OFF by default and inert in normal play. */
    setDemoHold: (on: boolean) => {
      ctx.demo.hold = on;
      ctx.demo.seedBase = ctx.probes.frame;
      // VHS's time hashes come off `performance.now()` 60/24/chromaBurst times a
      // second, so pin them with the hold. Its temporal blend is NOT pinned by
      // this and cannot be — see post-aa setTimeFrozen: that is exactly why the
      // frame hash measures the march target and not the presented image.
      ctx.render.postAa.setTimeFrozen(on);
      // NOTE, and it is a lesson worth keeping: an earlier cut RESET
      // `probeFrame` here to re-anchor the gather's per-dispatch seed phase. It
      // was removed because (a) the seed is now PINNED for a recording (see the
      // frameSeed site), so the phase no longer exists to anchor, and (b) the
      // reset silently corrupted `seedIdle` — a diagnostic computed as
      // `probeFrame - demoSeedBase` across a reset boundary, which made it
      // NEGATIVE (-34, -37, -1 in the stored runs). A diagnostic that can read
      // as nonsense is worse than no diagnostic: it was briefly used as
      // evidence. Do not reset a running counter to fix a phase problem.
      return ctx.demo.hold;
    },
    brains: () => ctx.world.actors.map(a => {
      const b = a.mind().debug();
      const p = a.pose().pos;
      return {
        id: a.id, room: a.room, kind: a.kind, phase:a.debug().phase, state: b.state, alert: b.alert,
        swingT: b.swingT, side: b.side, variant: b.variant,
        hasToken: a.debug().hasToken,
        aimT: b.aimT, cooldown: b.cooldown, sinceFire: a.sinceFire(),
        meleeContacts: a.debug().meleeContacts,
        speed: a.debug().speed, target: a.debug().target,
        dist: Math.hypot(p[0] - ctx.player.player.pos[0], p[2] - ctx.player.player.pos[2]),
        bearing: Math.atan2(p[0] - ctx.player.player.pos[0], p[2] - ctx.player.player.pos[2]),
      };
    }),
    /** Ring tuning, so a capture driver asserts against the real numbers
     *  rather than duplicating them. */
    ringTuning: () => ({ ...RING_TUNING }),
    /** attack.ts's beat boundaries, so a capture driver derives its phases
     *  from the real numbers instead of duplicating them. */
    attackTuning: () => ({ ...ATTACK_TUNING }),
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
    /** The reload's total length, seconds. Exposed so hand-stepping gates can
     *  DERIVE their wait budget instead of hardcoding a tick count: the shorty
     *  gate carried `57 ticks` against a 0.95 s reload, was still carrying it
     *  when the reload became 1.05 s, and failed a correct build the moment it
     *  became 1.30 s. A gate that has to be edited every time a constant moves
     *  will eventually be edited wrongly, or not at all. */
    get reloadTotalSec() { return RELOAD.totalSec; },
    setBlastDistortStrength: (v: number) => {
      ctx.vfx.blastDistortStrength = Math.max(0, Math.min(4, Number(v) || 0));
      ctx.render.postAa.setBlastDistortStrength(ctx.vfx.blastDistortStrength);
      return ctx.vfx.blastDistortStrength;
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
    get levelProbes() {
      return {
        weight: ctx.lighting.levelProbeWeight, gain: ctx.lighting.levelProbeGain, hemi: ctx.lighting.hemi.intensity, hemiBase: ctx.lighting.hemiBase,
        wired: ctx.lighting.levelProbeNodes.size, materials: ctx.world.levelNodeMaterials.length,
        lights: [...ctx.world.levelLightLists].map(([id, l]) => [id, l.getLights().length]),
        rooms: [...ctx.lighting.levelProbeNodes].map(([id, n]) => [id, n.slots.probeCfg.value.x, n.slots.probeCfg.value.y, n.slots.probeDynCfg.value.x, n.slots.probeDynCfg.value.y]),
      };
    },
    // VHS is the fourth chain stage, default OFF. While on it replaces the
    // smear pass; `effectiveSmear` says which temporal filter is really
    // running (0 while VHS owns it). Both return the resulting state so a
    // console caller sees the clamp without a second read.
    setVhs: (preset: VhsPreset | null) => {
      ctx.render.postAa.setVhs(preset);
      // A console preset overwrites every term; without this the panel's
      // sliders would keep showing the OLD look while the screen shows the new.
      ctx.panels.vhsPanel?.refresh();
      return ctx.render.postAa.vhs;
    },
    setVhsTerm: (name: keyof VhsTerms, value: number) => {
      ctx.render.postAa.setVhsTerm(name, value);
      ctx.panels.vhsPanel?.refresh();
      return ctx.render.postAa.vhsTerms;
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
        ctx.player.centerFovDeg = clampFovDeg(deg);
        ctx.render.postAa.setLens(camera.fov, ctx.player.centerFovDeg);
      }
      return fisheyeReport(ctx);
    },
    /** renderFovDeg is what is drawn, visibleFovDeg what reaches the
     *  screen (the warp crops the mid-edges), centerFovDeg what the
     *  middle reads as. Tune against `visible`, not `render`. */
    get fisheye() {
      return fisheyeReport(ctx);
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
    /** Run 5b: the refine twins' lighting tail — 'slim' (default) drops scatter, the wound
     *  soft shadow, the ambient bounce and the probe gather from the twin only; 'full' is
     *  run 5's behaviour. Applies to every live actor view (chunks have no refine twin). */
    setRefineTail: (tail: RefineTail) => {
      ctx.render.refineTailWanted = tail;
      for (const a of ctx.world.actors) a.view.setRefineTail(tail);
      return ctx.world.actors[0]?.view.refineTail ?? tail;
    },
    refineInfo: () => ({ allocated: ctx.render.sdfLayer.refineSource !== null, on: ctx.render.sdfLayer.refine, view: ctx.render.sdfLayer.refineView, cfg: ctx.render.sdfLayer.refineCfg, tail: ctx.world.actors[0]?.view.refineTail ?? 'slim', bodies: ctx.render.refinedBodies, band: { ...ctx.render.refineBand } }),
    /** P3: the trained models in the dev store (GET /__lab/upscale-models). */
    upscaleModels: async () => {
      const r = await fetch('/__lab/upscale-models', { cache: 'no-store' });
      if (!r.ok) throw new Error(`upscaleModels: HTTP ${r.status}`);
      return r.json();
    },
    /** G1-parity (spec 2026-09-11): GPU output vs the CPU twin, in-page. Requires
     *  freeze(true) + setRenderLock(true) first. Returns statistics only. */
    upscaleSelfCheck: (opts?: { compareLayouts?: boolean }) => runUpscaleSelfCheck({
      renderer: ctx.boot.handle.renderer,
      layer: ctx.render.sdfLayer,
      camera: camera as THREE.PerspectiveCamera,
      renderFrames: (n: number) => { ctx.boot.handle.setLoopRunning(false); for (let k = 0; k < n; k++) ctx.boot.handle.step(1 / 60); },
      resolveGpu: () => ctx.boot.handle.resolveGpu(),
    }, opts ?? {}),
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
    /** Bone-cluster sphere cull (packBoneClusters). OFF ships — the old flat
     *  bone loop; the bench's bone-cull-on leg flips it for A/B. Takes effect
     *  on the next per-frame pack, so a live flip needs a frame to land. */
    setBoneCull(on: boolean) { applyBoneCull(ctx, on); },
    /** Three-way bone cull (bone-segment spheres): 'off' / 'cluster' (the
     *  parked per-flesh-cluster spheres) / 'segment' (per rigid segment).
     *  setBoneCull(on) is the boolean shorthand for off/cluster. */
    setBoneCullMode(mode: 'off' | 'cluster' | 'segment') { applyBoneCullMode(ctx, mode); },
    /** Footprint-AA strength (perf round 2 task 6, aaCfg.y). 0 = the old
     *  march bit-for-bit; also refreshes the one-pixel footprint (aaCfg.x) so
     *  a frozen-scene A/B at a pinned scale reads the intended pair. */
    setAa(strength: number) {
      const k = ctx.render.sdfLayer.pixelConeK;
      for (const a of ctx.world.actors) {
        a.view.uniforms.aaCfg.value.x = k;
        a.view.uniforms.aaCfg.value.y = strength;
      }
    },
    /** Level shadows on bodies (perf round 2 task 7, levelShadowCfg.x).
     *  0 = the pre-task-7 march bit-for-bit (the helper returns 1.0 before
     *  sampling). The per-frame pose block ANDs this with the beam and map
     *  existence, so a false here also survives ?spotshadow=0 boots. */
    setLevelShadow(on: boolean) {
      ctx.lighting.levelShadowEnabled = !!on;
      for (const a of ctx.world.actors) a.view.uniforms.levelShadowCfg.value.x = on ? 1 : 0;
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
    /** Rebuild the hull NOW (the frame-loop update is gated on !wanderFrozen,
     *  so frozen captures would otherwise shoot through a stale hull). No
     *  simulation steps, so a stamped body stays exactly where it was put. */
    refreshHull: () => {
      ctx.render.occluderHull.update(
        ctx.world.actors.map(a => a.posed()),
        ctx.render.hullExclusionsEnabled
          ? ctx.world.actors.flatMap(a => {
            const prims = a.posed().prims;
            const yaw = a.pose().yaw;
            return a.visualWounds().map(w => ({ centre: woundWorldPos(prims, w, yaw), radius: w.radius }));
          })
          : [],
        // Same rule as the frame loop: only rebuild the occluder half when
        // the pre-pass is on to consume it.
        { occluder: ctx.render.sdfLayer.occluderEnabled },
      );
    },
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
      if (on && ctx.boot.deferredMode) return 'refused: sscs is legacy-path-only';
      if (on) ctx.render.postAa.setSscsFleshTex(ctx.render.sdfLayer.marchTarget.texture);
      ctx.render.postAa.setSscs(on);
      return ctx.render.postAa.sscs;
    },
    hullDebug: () => ({
      occluder: ctx.render.sdfLayer.occluderEnabled,
      exclusions: ctx.render.hullExclusionsEnabled,
      instances: ctx.render.occluderHull.instanceCount,
      woundsPerBody: ctx.world.actors.map(a => a.wounds().length),
    }),
    setActorCull(on: boolean) { ctx.render.actorCullEnabled = on; if (!on) ctx.world.lastSeenMs.clear(); },
    actorCull: () => ({ enabled: ctx.render.actorCullEnabled, ...ctx.world.cullCounts }),
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
      ctx.render.bonesVisible = !!on;
      for (const c of ctx.bake.liveChunks) if (c.kind === 'bone') c.view.object.visible = ctx.render.bonesVisible;
      return ctx.render.bonesVisible;
    },
    setChunksVisible: (on: boolean) => {
      ctx.bake.hidden = !on;
      for (const c of ctx.bake.liveChunks) {
        c.view.object.visible = !ctx.bake.hidden && (c.kind !== 'bone' || ctx.render.bonesVisible);
      }
      for (const b of ctx.bake.chunks) b.mesh.visible = !ctx.bake.hidden;
      // SPRITE PIECES COUNT AS PIECES HERE. This seam is the "pieces shown vs
      // hidden" arm every cost rig and differential uses, and a rig that had to
      // know which render mode was on would be a rig that silently measured
      // nothing the day the mode changed. The sprite mode's OWN control is
      // `setSpritePiecesVisible` below; this one moves both.
      setSpritePiecesVisible(ctx.vfx.spritePieces, on);
      return !ctx.bake.hidden;
    },
    gibRenderMode: () => ({
      mode: ctx.gibs.renderMode,
      // `ready` is per mode: the sprite path needs its ATLAS, the carve path its
      // LIBRARY, the assets path a loaded archetype SET — and conflating them
      // would report one mode armed because another's asset loaded.
      ready: ctx.gibs.renderMode === 'assets'
        ? gibAssetArmed(ctx)
        : ctx.gibs.renderMode === 'carve' ? (ctx.bake.carvedLibrary !== null) : ctx.gibs.atlas !== null,
      frames: ctx.gibs.atlas?.frames.length ?? 0, atlas: ctx.gibs.atlasSource,
      liveCap: ctx.gibs.spriteLiveCap, restCap: ctx.gibs.spriteRestCap, sizeScale: ctx.gibs.spriteSizeScale,
      assets: {
        armed: gibAssetArmed(ctx),
        zombie: ctx.gibs.assetRuntime.archetypeState('zombie'),
        soldier: ctx.gibs.assetRuntime.archetypeState('soldier'),
      },
      carve: ctx.bake.carvedLibrary ? {
        pieces: ctx.bake.carvedLibrary.pieces.length,
        verts: ctx.bake.carvedLibrary.totalVerts,
        tris: ctx.bake.carvedLibrary.totalTris,
        bonePrims: ctx.bake.carvedLibrary.bonePrims,
        fleshPrims: ctx.bake.carvedLibrary.fleshPrims,
        cells: ctx.bake.carvedLibrary.cells,
        cellSize: ctx.bake.carvedLibrary.cellSize,
        buildMs: ctx.bake.carvedBuildMs,
        skipped: ctx.bake.carvedLibrary.skipped.length,
        piecesWithBones: ctx.bake.carvedLibrary.pieces.filter(x => x.bonesNear > 0).length,
      } : null,
    }),
    /** PRELOAD THE COMMITTED SETS without switching mode — the paired rig's
     *  "arm both arms first" step. Returns the armed state. */
    preloadGibAssets: async () => { await ensureGibAssets(ctx); return gibAssetArmed(ctx); },
    /** THE ENCLOSURE A POINT IS IN, in metres: the same box the probe gather and
     *  the bundle's ceiling resolve against. A rig that wants to assert "this
     *  piece stayed in the room" needs the room's rectangle, and hard-coding it
     *  in the rig would let the level move out from under the assertion. */
    enclosureBoxAt: (x: number, z: number) => {
      const key = enclosureKeyAt(x, z);
      const enc = enclosureOf(key);
      return enc ? { key, min: enc.box.min, max: enc.box.max } : null;
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
    warmDone: () => (window as unknown as Record<string, unknown>).__warmDone ?? null,
    /** DEFER-COMPILE (2026-09-19): the background-compile state machine —
     *  `{ gib, crowd }` each pending|compiling|ready|failed. A driver reads it
     *  to know whether a gib/crowd draw will use the fast path or degrade. */
    warmBackground: () => ctx.boot.warmBackground.snapshot(),
    /** Which gib renderer boot selected and whether the carve library built. */
    gibRenderer: () => ({
      mode: ctx.gibs.renderMode,
      carvedLibraryBuilt: ctx.bake.carvedLibrary !== null,
      carvedBuildMs: ctx.bake.carvedBuildMs,
      carveCells: ctx.gibs.carveCells,
      /** Task 2: the offline-asset arm's own state + census. */
      assetArmed: gibAssetArmed(ctx),
      assets: {
        zombie: ctx.gibs.assetRuntime.archetypeState('zombie'),
        soldier: ctx.gibs.assetRuntime.archetypeState('soldier'),
      },
      assetStats: ctx.gibs.assetRuntime.countersSnapshot(),
    }),
    rooms: ROOMS.map(r => ({
      id: r.id, name: r.name, zombies: r.zombies,
      bounds: { minX: r.minX, maxX: r.maxX, minZ: r.minZ, maxZ: r.maxZ },
    })),
    tunnels: TUNNELS.map(t => t.name),
    furniture: FURNITURE,
    /** Accent lights per room — capture/measurement seam (pair-shot framing). */
    accents: ROOMS.flatMap(r => r.accents.map(a => ({ room: r.id, ...a })))
  };
}
