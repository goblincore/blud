// src/lab/sdf-zombie/webgpu/game-seams-fx.ts
//
// Members lifted verbatim out of game-main.ts's `window.__sdfGame` literal.
// Every one needed nothing but the GameContext, so this factory takes no deps.
//
// Plan: docs/superpowers/plans/2026-09-17-game-main-decomposition.md

import type { GameContext } from './game-context';
import * as THREE from 'three/webgpu';
import { IMPACT_GOUT, type ImpactGoutProfile } from '../blood-sim';
import { type Vec3 } from '../types';
import { sdBody } from '../validate';
import { chunkSettled } from '../gib-chunks';
import { woundFromPellet, woundFromSlug, traceProjectile } from './game-weapon';
import { spillVerdict, woundTuningNow } from './game-vfx-leaves';
import { clearSpritePieces, setSpritePiecesVisible, spritePieceStates } from './gib-sprite-pieces';
import { type GooReconstruction } from './goo-layer';

export function createFxSeams(ctx: GameContext) {
  const { scene, camera } = ctx.boot.handle;
  return {
    /** TASK-6 DIAGNOSTIC LIGHT CLOCK: the practical-fire flicker runs on
     *  wall-clock performance.now() INSIDE the draw path, which the render
     *  lock does not freeze — two renders of a locked scene still differ in
     *  practical intensity. G-buffer invariance never cared; MATCHED LIT
     *  screenshots do. Freezing this one clock pins the flicker phase so
     *  locked renders are bit-comparable in lit output too. Gate-only:
     *  default OFF, ordinary gameplay never freezes it. */
    setLightClockFrozen: (on: boolean) => {
      if (on) ctx.lighting.flickerClockFrozenAt = performance.now() * 0.001;
      ctx.lighting.clockFrozen = on;
    },
    get lightClockFrozen() { return ctx.lighting.clockFrozen; },
    get probeWeight() { return ctx.probes.weight; },
    // ---------------------------------------------------------------
    // BLEED seams (bleeding-wounds). Ships ON; setBleed(false) is the
    // off gate — it freezes AND clears the blood sim so OFF is pixel-
    // identical to the pre-feature page (no frozen mid-air droplets).
    // ---------------------------------------------------------------
    setBleed: (on: boolean) => {
      ctx.vfx.bleedEnabled = on;
      for (const o of ctx.vfx.bloodView.objects) o.visible = on;
      if (!on) {
        ctx.vfx.bloodSim.droplets.length = 0;
        ctx.vfx.bloodSim.splats.length = 0;
      }
    },
    get bleed() {
      return {
        enabled: ctx.vfx.bleedEnabled,
        emitters: ctx.vfx.bleed.live(ctx.vfx.bleedClock).length,
        droplets: ctx.vfx.bloodSim.droplets.length,
        splats: ctx.vfx.bloodSim.splats.length,
      };
    },
    /** Per-room probe grids (P3 step 2): weight 0 = bit-identical P1; gain -1
     *  = each room's matched level, else an absolute multiplier. */
    /** Flashlight bounce spot (P4 step 1): 0 = off and bit-identical. */
    setBounceSpot: (gain: number) => { ctx.lighting.bounceSpotGain = Math.max(0, gain); return ctx.lighting.bounceSpotGain; },
    /** GPU probe gather dynamic layer: radiance gain (flash bounce) and
     *  visibility strength (bodies darken their surroundings). 0/0 = off. */
    /** Direct muzzle-flash light on bodies (bodyFlash slot). 0 = off. */
    setBodyFlash: (gain: number) => { ctx.lighting.bodyFlashGain = Math.max(0, gain); return ctx.lighting.bodyFlashGain; },
    get bodyFlash() { return ctx.lighting.bodyFlashGain; },
    setProbeDynamic: (radianceGain: number, visStrength: number, flashBoost?: number) => {
      ctx.probes.dynGain = Math.max(0, radianceGain); ctx.probes.visStrength = Math.max(0, Math.min(1, visStrength));
      if (flashBoost !== undefined) ctx.probes.flashBoost = Math.max(0, flashBoost);
      return { radianceGain: ctx.probes.dynGain, visStrength: ctx.probes.visStrength, flashBoost: ctx.probes.flashBoost };
    },
    /** Exact-work A/B: capsule broad phase, visibility any-hit, cone-first shadows. */
    setProbeOptimization(enabled: boolean) { ctx.probes.optimized = enabled; return ctx.probes.optimized; },
    setProbeGatherRate(framesPerGather: number) {
      ctx.probes.gatherRate = Math.max(1, Math.min(4, Math.floor(framesPerGather)));
      return ctx.probes.gatherRate;
    },
    /** Diagnostic cost-split seams (see ?dynrays / ?dynlights). BOTH PRODUCE
     *  WRONG FRAMES ON PURPOSE — they exist to divide the gather's cost into
     *  primary-ray and per-light-shadow parts, which is the measurement that
     *  decides whether widening the dispatch or replacing the per-light sweep
     *  pays more. null restores the shipped value (32 rays, every light). */
    setProbeRays(n: number | null) {
      ctx.probes.raysBoot = n === null ? null : Math.max(0, Math.min(64, Math.floor(n)));
      return ctx.probes.raysBoot;
    },
    setProbeLights(n: number | null) {
      ctx.probes.lightsBoot = n === null ? null : Math.max(0, Math.floor(n));
      return ctx.probes.lightsBoot;
    },
    get probeCostSplit() {
      return { rays: ctx.probes.raysBoot, lights: ctx.probes.lightsBoot, blend: ctx.probes.blendBoot, fall: ctx.probes.fallBoot, optimized: ctx.probes.optimized };
    },
    /** LIVE probe-gather state (the `probeDynamic` getter is a boot snapshot:
     *  object spread evaluates it once). `gates.lights` is the packed-light
     *  count from the last gather frame — the seam that separates "the fire
     *  light was pushed" from "the kernel saw it". */
    probeGates: () => ctx.probes.lastGates,
    probeDispatchCount: () => ctx.probes.frame,
    /** The gather's afterglow rates (?dynblend / ?dynfall). Set BOTH to 1 for the
     *  PURE-ESTIMATE configuration the R1 dispatch check measures in: the record
     *  becomes exactly this frame's estimate, so the dynamic layer stops
     *  depending on how many frames the run dispatched before the read — without
     *  which two boots are not comparable to each other at all. null restores the
     *  shipped 0.6 / 0.12. */
    setProbeBlend(n: number | null) {
      ctx.probes.blendBoot = n === null ? null : Math.max(0, Math.min(1, n));
      return ctx.probes.blendBoot;
    },
    setProbeFall(n: number | null) {
      ctx.probes.fallBoot = n === null ? null : Math.max(0, Math.min(1, n));
      return ctx.probes.fallBoot;
    },
    // `frames` is a DISPATCH counter (half-rate gather => ~half the drawn frames).
    get probeDynamic() { return { radianceGain: ctx.probes.dynGain, visStrength: ctx.probes.visStrength, frames: ctx.probes.frame, errors: ctx.probes.gatherErrors, bound: ctx.probes.gather !== null, reached: ctx.probes.gateLogs, gates: ctx.probes.lastGates, rate: ctx.probes.gatherRate }; },
    /** TRACERS as gathered lights. Raw intensity per pellet; 0 = off (no
     *  light packed). The owner tunes by eye and exaggerates with e.g. 6. */
    setTracerLight: (gain: number) => { ctx.lighting.tracerLightGain = Math.max(0, gain); return ctx.lighting.tracerLightGain; },
    setTracerLightSlots: (slots: number) => { ctx.lighting.tracerLightSlots = Math.max(0, Math.min(8, Math.floor(slots))); return ctx.lighting.tracerLightSlots; },
    get tracerLight() { return ctx.lighting.tracerLightGain; },
    /** The slot cap, so a rig can report WHAT it measured against rather than
     *  assuming — `setTracerLightSlots` without a getter is the "silent seam"
     *  failure this file keeps re-learning. */
    get tracerLightSlots() { return ctx.lighting.tracerLightSlots; },
    probeDynReadback: () => ctx.probes.gather?.readback() ?? Promise.resolve(new Float32Array(0)),
    get bounceSpot() { return ctx.lighting.bounceSpotGain; },
    /** Compare identical density inputs with full versus live-prefix uploads. */
    setGooUploadOptimization: (on: boolean) => ctx.goo.layer?.setUploadOptimization(on),
    get gibBlurEnabled() { return ctx.gibs.shutter?.enabled ?? false; },
    /** Mutual-occlusion A/B seam: when ON (default) the blood resolve also
     *  occludes against the blurred-gib layer depth. Returns the applied value. */
    setGibOccluder: (on: boolean) => { ctx.gibs.occluderEnabled = !!on; return ctx.gibs.occluderEnabled; },
    get gibOccluderEnabled() { return ctx.gibs.occluderEnabled; },
    /** Live values, seed/layer dims, per-frame stats and any hard error. */
    get gibBlur() {
      return ctx.gibs.shutter
        ? ctx.gibs.shutter.diagnostics()
        : { enabled: false, unavailable: true };
    },
    get goo() {
      return ctx.goo.layer
        ? {
          enabled: ctx.goo.enabled,
          threshold: ctx.goo.layer.threshold,
          edge: ctx.goo.layer.edge,
          blurPx: ctx.goo.layer.blurPx,
          sizeScale: ctx.goo.layer.sizeScale,
          target: ctx.goo.layer.targetSize,
          mode: ctx.goo.layer.mode,
          liveCount: ctx.goo.layer.liveCount,
          syncCalls: ctx.goo.layer.syncCalls,
          absorb: ctx.goo.layer.absorb,
          spec: ctx.goo.layer.spec,
          gloss: ctx.goo.layer.gloss,
          rim: ctx.goo.layer.rim,
          stretch: ctx.goo.layer.stretch,
          shadowRed: ctx.goo.layer.shadowRed,
          candidate: {
            reconstruction: ctx.goo.layer.reconstruction,
            connections: ctx.goo.connectionsEnabled,
            strands: ctx.goo.strandsEnabled,
            sheets: ctx.goo.sheetsEnabled,
            extraBlobs: ctx.goo.layer.extraBlobCount,
            density: ctx.goo.layer.densityDiagnostics,
          },
          perf: {
            surfaceAtDensityRes: ctx.goo.layer.surfaceAtDensityRes,
            minTexelRadius: ctx.goo.layer.minTexelRadius,
            areaPriority: ctx.goo.layer.areaPriority,
            splatFadeTail: ctx.goo.layer.splatFadeTail,
            passGate: ctx.goo.layer.passGate,
          },
        }
        : { enabled: false, unavailable: true };
    },
    setGooTuning(o: {
      threshold?: number; edge?: number; blurPx?: number; sizeScale?: number;
      mode?: 'overlay' | 'depth';
      absorb?: number; spec?: number; gloss?: number; rim?: number;
      stretch?: number;
      shadowRed?: number;
    }) {
      if (!ctx.goo.layer) return;
      if (o.threshold !== undefined) ctx.goo.layer.setThreshold(o.threshold);
      if (o.edge !== undefined) ctx.goo.layer.setEdge(o.edge);
      if (o.blurPx !== undefined) ctx.goo.layer.setBlurPx(o.blurPx);
      if (o.sizeScale !== undefined) ctx.goo.layer.setSizeScale(o.sizeScale);
      if (o.mode !== undefined) ctx.goo.layer.setMode(o.mode);
      if (o.absorb !== undefined) ctx.goo.layer.setAbsorb(o.absorb);
      if (o.spec !== undefined) ctx.goo.layer.setSpec(o.spec);
      if (o.gloss !== undefined) ctx.goo.layer.setGloss(o.gloss);
      if (o.rim !== undefined) ctx.goo.layer.setRim(o.rim);
      if (o.stretch !== undefined) ctx.goo.layer.setStretch(o.stretch);
      if (o.shadowRed !== undefined) ctx.goo.layer.setShadowRed(o.shadowRed);
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
      if (!ctx.goo.layer) return { unavailable: true };
      if (o.reconstruction !== undefined) {
        ctx.goo.reconstruction = o.reconstruction;
        ctx.goo.layer.setReconstruction(o.reconstruction);
      }
      if (o.connections !== undefined) ctx.goo.connectionsEnabled = o.connections;
      if (o.strands !== undefined) ctx.goo.strandsEnabled = o.strands;
      if (o.sheets !== undefined) ctx.goo.sheetsEnabled = o.sheets;
      return {
        reconstruction: ctx.goo.layer.reconstruction,
        connections: ctx.goo.connectionsEnabled,
        strands: ctx.goo.strandsEnabled,
        sheets: ctx.goo.sheetsEnabled,
        extraBlobs: ctx.goo.layer.extraBlobCount,
      };
    },
    // Tracks the REQUESTED state, not the uniform: an unwounded body never
    // uploads wounds, so its bound radius stays at the 1e9 identity even
    // with the cull on, and reading the uniform back would lie.
    get woundCull() { return ctx.vfx.woundCullRequested; },
    /** Shadow-map edge hardness (the A/B seam for SHADOW_RADIUS): radius in
     *  shadow-map texels, 0 = crisp edge, ~2 the shipped default, 6+ very
     *  soft. Live on the WebGPU PCF filter (a reference uniform) — no
     *  recompile. Shapes the shadow MAP only: shadows on flesh go through
     *  the march's own LEVEL_SHADOW PCF, and the contact term's softness is
     *  setSscsTerm's to tune. */
    setShadowRadius: (r: number) => {
      ctx.lighting.flashlight.spot.shadow.radius = Math.max(0, Math.min(8, r));
      return ctx.lighting.flashlight.spot.shadow.radius;
    },
    get shadowRadius() { return ctx.lighting.flashlight.spot.shadow.radius; },
    get chunkCount() { return ctx.bake.liveChunks.length; },
    /** Micro-detail amplitude on every settled/baked piece — the march's
     *  `surfaceNoiseAmp`, which the bake used to drop entirely. `null` follows
     *  the live creature (the shipped behaviour); a number overrides it, which
     *  is how to judge a term whose authored value is 0.06. Live: no rebake,
     *  the pieces already on the floor change on the next frame. */
    setChunkDetail(x: number | null, o?: { freq?: number; albedo?: number }) {
      ctx.bake.detailOverride = x === null ? null : Math.max(0, Math.min(1, x));
      if (o?.freq !== undefined) ctx.bake.detailFreq = Math.max(0.5, Math.min(64, o.freq));
      if (o?.albedo !== undefined) ctx.bake.detailAlbedo = Math.max(0, Math.min(1.5, o.albedo));
      return { amp: ctx.bake.detailOverride, freq: ctx.bake.detailFreq, albedo: ctx.bake.detailAlbedo };
    },
    get chunkDetail() {
      return { amp: ctx.bake.detailOverride, freq: ctx.bake.detailFreq, albedo: ctx.bake.detailAlbedo };
    },
    /** Compare the SAME settled poses, with no worker timing or physics drift.
     * The retained views exist for recycling already; only this dev seam draws them. */
    setBakedChunkReference(on: boolean) {
      ctx.bake.reference = on;
      for (const b of ctx.bake.chunks) {
        b.mesh.visible = !on;
        b.view.object.visible = on;
        if (on) b.view.update(b.state);
      }
    },
    get chunkBake() { return ctx.bake.enabled; },
    /** Paired-pixel diagnostic: hide exactly one live or baked producer
     * while the gate holds simulation locked; returns false for stale IDs. */
    setChunkVisible(id: number, visible: boolean) {
      const live = ctx.bake.liveChunks.find(c => c.id === id);
      const baked = ctx.bake.chunks.find(c => c.id === id);
      const object = live?.view.object ?? baked?.mesh;
      if (!object) return false;
      object.visible = visible;
      return true;
    },
    /** Leak/observability census: live (stepped/marched) chunks, baked
     *  meshes, ring views, bake cost. The long-firefight gate reads this. */
    chunkStats: () => ({
      live: ctx.bake.liveChunks.length,
      sharedLiveMaterial: ctx.bake.liveChunks.every(c => (c.view.object as THREE.Mesh).material === ctx.bake.material.material),
      baked: ctx.bake.chunks.length,
      views: ctx.bake.views.length,
      totalBakes: ctx.bake.totalBakes,
      lastBakeMs: ctx.bake.lastBakeMs, // worker CPU time, NOT a main-thread span
      lastBakeSwapMs: ctx.bake.lastSwapMs,
      lastBakeSwapFrame: ctx.bake.lastSwapFrame,
      lastBakeRequestMs: ctx.bake.lastRequestMs,
      bakeThread: 'worker',
      pendingBake: ctx.bake.jobs.pendingId,
      bakeError: ctx.bake.jobs.error,
      lastBakeInfo: ctx.bake.lastBakeInfo,
      /** THE ASSET PATH'S OWN CENSUS (task 2): asset hits, fallback reasons,
       *  load bytes, live moving meshes and runtime extraction jobs. Included
       *  here so a single `chunkStats()` read answers "did the offline set
       *  actually carry this blast, and how much runtime extraction did it
       *  remove?" without a second seam. */
      gibAssets: ctx.gibs.assetRuntime.countersSnapshot(),
      /** Baked pieces wearing the per-fragment textured HEAD material — the
       *  first non-zero value is the first textured-head draw (startup probe). */
      faceBaked: ctx.bake.chunks.filter(b => b.faceMaterial !== undefined).length,
      pieces: ctx.bake.chunks.map(b => ({ id: b.id, centre: [...b.centre] as [number, number, number], radius: b.radius, face: b.faceMaterial !== undefined, quat: [...b.state.quat] as [number, number, number, number] })),
      /** Live (still-marched) chunk positions — the look/bench drivers frame
       *  the camera on these in bake-OFF captures. */
      livePieces: ctx.bake.liveChunks.map(c => ({
        id: c.id, centre: [...c.state.pos] as [number, number, number], radius: c.state.radius,
        /** Orientation and angular velocity (task 4): the rupture hand-off must
         *  leave a NON-identity quat and a nonzero spin on each released piece. */
        quat: [...c.state.quat] as [number, number, number, number],
        angVel: [...c.state.angVel] as [number, number, number],
      })),
    }),
    /** A/B seam: stamp the 16 wounds on bodies this blast gibs (the old
     *  behaviour) or skip them (the shipped one). See `gibWounds`. */
    setGibWounds: (on: boolean) => { ctx.gibs.wounds = !!on; return ctx.gibs.wounds; },
    /** Which explosion renderer is live and what it holds. `mode` is
     *  'procedural' (the GPU fireball) or 'standin' (the additive cards). */
    explosionFx: () => ({
      mode: ctx.vfx.explosionVfx ? 'procedural' : ctx.vfx.burstLayer ? 'atlas' : 'standin',
      usingAtlas: ctx.vfx.burstLayer?.usingAtlas ?? null,
      size: ctx.vfx.size, smoke: ctx.vfx.smoke, life: ctx.vfx.life, gain: ctx.vfx.gain, plume: ctx.vfx.plume,
      liveBursts: ctx.vfx.explosionVfx?.activeBursts ?? 0,
      lightIntensity: ctx.vfx.explosionVfx?.lightIntensity ?? 0,
      tuning: ctx.vfx.explosionVfx?.tuning ?? null,
      // THE BURST'S OWN SHAPE, in metres, per layer — the measurement the frame
      // differential cannot make (the ring dominates the changed area, and the
      // changed region's bounding box is re-cut by one stray pixel). Read it
      // straight after a `step`, with `?frozen=1` and the loop stopped.
      layerExtents: ctx.vfx.explosionVfx?.layerExtents ?? null,
      burstHalfHeightM: ctx.vfx.explosionVfx?.burstHalfHeightM ?? null,
    }),
    /** Live tuning for the procedural burst (see ExplosionVfxTuning). */
    setExplosionFxTuning: (t: Record<string, number>) => {
      ctx.vfx.explosionVfx?.setTuning(t as never);
      return ctx.vfx.explosionVfx?.tuning ?? null;
    },
    chunksVisible: () => !ctx.bake.hidden,
    /** The carved library's per-piece breakdown — the seam a rig uses to check
     *  that the ribcage is actually in a chest slice rather than merely assumed. */
    gibCarveLibrary: () => (ctx.bake.carvedLibrary ? ctx.bake.carvedLibrary.pieces.map(p => ({
      part: p.part, limb: p.limb, verts: p.verts, tris: p.tris, radius: p.radius,
      bonesNear: p.bonesNear, centre: p.centre,
    })) : []),
    /** Hide/show the blast's sprite pieces without destroying them — the sprite
     *  twin of `setChunksVisible`, and how a capture proves a DETONATION's
     *  sprites are drawn rather than merely in the scene graph. */
    setSpritePiecesVisible: (on: boolean) => setSpritePiecesVisible(ctx.vfx.spritePieces, !!on),
    /** WHERE EVERY SPRITE PIECE IS — the sprite twin of `chunkStates()`, live and
     *  parked, so a rig watching a gib fly does not care which mode made it. */
    spritePieceStates: () => spritePieceStates(ctx.vfx.spritePieces),
    spriteCensus: () => ({
      live: ctx.vfx.spritePieces.live.length,
      rest: ctx.vfx.spritePieces.rest.length,
      meshes: ctx.vfx.spritePieces.group.children.length,
      geometries: ctx.vfx.spritePieces.assets.unitPlane ? 1 : 0,
      materials: ctx.vfx.spritePieces.assets.material.size,
      liveCap: ctx.gibs.spriteLiveCap,
      restCap: ctx.gibs.spriteRestCap,
      hidden: ctx.vfx.spritePieces.hidden,
    }),
    /** Drop every sprite piece (both lists) — the reset a paired rig wants
     *  between arms, so an earlier blast's pile is not in the frame. */
    clearSpritePieces: () => clearSpritePieces(ctx.vfx.spritePieces),
    /**
     * THE OFFLINE ASSET SEAM (task 2). `stats` is the always-available census
     * (asset hits, per-reason fallbacks, load bytes, live moving meshes, runtime
     * extraction jobs). `library` reports what loaded. `reset` cancels in-flight
     * loads and drops every cached library so a rig can force a clean reload —
     * a reset drops the sprite pieces first, which returns their pooled buffers.
     */
    gibAssetStats: () => ctx.gibs.assetRuntime.countersSnapshot(),
    gibAssetLibrary: () => {
      const out: Record<string, unknown> = {};
      for (const archetype of ['zombie', 'soldier']) {
        const lib = ctx.gibs.assetRuntime.library(archetype);
        out[archetype] = lib ? {
          state: ctx.gibs.assetRuntime.archetypeState(archetype),
          fingerprint: lib.fingerprint,
          pieces: lib.pieces.length,
          verts: lib.verts,
          tris: lib.tris,
          binBytes: lib.bytes.bin,
          builtMs: lib.builtMs,
          materials: 1,
        } : {
          state: ctx.gibs.assetRuntime.archetypeState(archetype),
          reason: ctx.gibs.assetRuntime.failureReason(archetype),
        };
      }
      return out;
    },
    /** Show/hide the sprite bench without destroying it — the same A/B the mesh
     *  bench has, so a capture can prove the sprites are DRAWN. */
    gibSpriteBenchVisible: (on: boolean) => {
      if (ctx.vfx.spriteBenchGroup) ctx.vfx.spriteBenchGroup.visible = on;
      return ctx.vfx.spriteBenchGroup?.visible ?? false;
    },
    goreDetail: (
      o: {
        detail?: number; bump?: number; blood?: number; noise?: number;
        burn?: number; wet?: number; dark?: number; stainScale?: number;
      } = {},
    ) => {
      if (o.detail !== undefined) ctx.vfx.gorePartDetail.x = o.detail;
      if (o.bump !== undefined) ctx.vfx.gorePartDetail.y = o.bump;
      if (o.blood !== undefined) ctx.vfx.gorePartDetail.z = o.blood;
      if (o.noise !== undefined) ctx.vfx.gorePartDetail.w = Math.max(1, o.noise);
      if (o.burn !== undefined) ctx.vfx.gorePartStain.x = Math.max(0, o.burn);
      if (o.wet !== undefined) ctx.vfx.gorePartStain.y = Math.max(0, o.wet);
      if (o.dark !== undefined) ctx.vfx.gorePartStain.z = Math.min(1, Math.max(0, o.dark));
      if (o.stainScale !== undefined) ctx.vfx.gorePartStain.w = Math.max(0.25, o.stainScale);
      // EVERY material that opted into the detail layer, not just the bench's.
      // `carvedMaterial` is a SECOND `createBakedChunkMaterial({goreDetail:true})`
      // instance with its own uniform set (it has to be — a material instance
      // owns one goreCfg), so a writer that names only `gorePartMat` tunes the
      // bench and leaves ?gibrender=carve on its boot values. That is the same
      // shape of bug as the flashlight's: see `litChunkMaterials`, which exists
      // because the per-frame beam update had exactly this omission.
      for (const m of [ctx.vfx.gorePartMat, ctx.bake.carvedMaterial, ctx.gibs.assetMaterial]) {
        m?.uniforms.goreCfg.value.set(
          ctx.vfx.gorePartDetail.x, ctx.vfx.gorePartDetail.y, ctx.vfx.gorePartDetail.z, ctx.vfx.gorePartDetail.w,
        );
        m?.uniforms.goreCfg2.value.set(
          ctx.vfx.gorePartStain.x, ctx.vfx.gorePartStain.y, ctx.vfx.gorePartStain.z, ctx.vfx.gorePartStain.w,
        );
      }
      return {
        detail: ctx.vfx.gorePartDetail.x, bump: ctx.vfx.gorePartDetail.y,
        blood: ctx.vfx.gorePartDetail.z, noise: ctx.vfx.gorePartDetail.w,
        burn: ctx.vfx.gorePartStain.x, wet: ctx.vfx.gorePartStain.y,
        dark: ctx.vfx.gorePartStain.z, stainScale: ctx.vfx.gorePartStain.w,
      };
    },
    /** Show/hide the bench WITHOUT destroying it, which is how a capture proves
     *  the parts are actually drawn rather than merely in the scene graph. */
    goreShowcaseVisible: (on: boolean) => {
      if (ctx.vfx.goreShowcase) ctx.vfx.goreShowcase.visible = on;
      return ctx.vfx.goreShowcase?.visible ?? false;
    },
    /** WHERE EVERY LIVE PIECE IS, and what it is doing — the seam a rig needs to
     *  watch a gib fly. Added for the wall-collision check: "do the pieces stay
     *  in the room" is a question about POSITIONS over time, and the only other
     *  way to read them was a telemetry snapshot (F9). */
    chunkStates: () => [
      ...ctx.bake.liveChunks.map(c => ({
        id: c.id, limb: c.state.limb, kind: c.state.kind,
        pos: c.state.pos, vel: c.state.vel, radius: c.state.radius,
        // Orientation too: a rig that frames a detached head has to know which
        // way it is facing to photograph the face, not just its back.
        quat: c.state.quat,
        settled: chunkSettled(c.state),
        render: 'march' as const,
      })),
      // SPRITE PIECES ARE PIECES. A rig that asks "where is every piece and is
      // it inside a room" must get the same answer in either render mode, or the
      // wall/ceiling guarantees would silently go unverified the moment someone
      // flips `?gibrender=sprite`. `rest` distinguishes a parked quad from one
      // still flying; the other fields are the marched row's own shape.
      ...spritePieceStates(ctx.vfx.spritePieces).map(p => ({ ...p, render: 'sprite' as const })),
    ],
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

    /** Sweep gout density/shape without a rebuild. Mutates the shared table,
     *  so it affects every later impact of that kind. */
    setGoutTuning(kind: 'pellet' | 'slug' | 'stump', o: Partial<ImpactGoutProfile>) {
      Object.assign(IMPACT_GOUT[kind], o);
      return { ...IMPACT_GOUT[kind] };
    },
    get gout() {
      return { pellet: { ...IMPACT_GOUT.pellet }, slug: { ...IMPACT_GOUT.slug }, stump: { ...IMPACT_GOUT.stump } };
    },

    get woundTuning() {
      return woundTuningNow(ctx);
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
  };
}
