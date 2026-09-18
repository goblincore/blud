// src/lab/sdf-zombie/webgpu/game-seams-render.ts
//
// Members lifted verbatim out of game-main.ts's `window.__sdfGame` literal.
// Every one needed nothing but the GameContext, so this factory takes no deps.
//
// Plan: docs/superpowers/plans/2026-09-17-game-main-decomposition.md

import type { GameContext } from './game-context';
import * as THREE from 'three/webgpu';
import { SCALE_LADDER, initialAdaptiveState, scaleForRung } from '../adaptive-scale';
import { type SscsTerms } from './post-sscs';

export function createRenderSeams(ctx: GameContext) {
  const { camera } = ctx.boot.handle;
  return {
    /** Pass-timing seam: march the gib chunks in their own labelled pass
     *  ('split'), skip them ('skip', wrong frame on purpose), or the shipped
     *  single pass ('merged'). See sdf-layer.ts setChunkPass. */
    setChunkPass: (mode: 'merged' | 'split' | 'skip') => ctx.render.sdfLayer.setChunkPass(mode),
    get chunkPass() { return ctx.render.sdfLayer.chunkPass; },
    /** Hull-holes A/B seams (2026-08-27). setOccluder turns the occluder
     *  pre-pass (and its tMax clamp) on/off; setHullExclusions passes an
     *  empty wound list to the hull builder instead of the live one. Both
     *  default to shipped behaviour. */
    setOccluder: (on: boolean) => {
      ctx.render.occluderDesired = on;
      ctx.render.sdfLayer.setOccluderEnabled(on);
    },
    get occluder() { return ctx.render.sdfLayer.occluderEnabled && ctx.render.occluderDesired; },
    setHullExclusions: (on: boolean) => { ctx.render.hullExclusionsEnabled = on; },
    get hullExclusions() { return ctx.render.hullExclusionsEnabled; },
    // setAdaptive / setSdfScale already exist further down this object and
    // are better than the versions this block first added (they also clear
    // the adaptive sample window and report the whole ladder). Not
    // duplicated here — the driver calls those.
    setCone: (on: boolean) => ctx.render.sdfLayer.setConeEnabled(on),
    get cone() { return ctx.render.sdfLayer.coneEnabled; },
    setFxaa: (on: boolean) => ctx.render.postAa.setFxaa(on),
    get fxaa() { return ctx.render.postAa.fxaa; },
    setSmear: (v: number) => ctx.render.postAa.setSmear(v),
    /** BLAST REFRACTION experiment (default OFF). Live seam so the capture rig
     *  can A/B the SAME frame with it off and on — same seed, same pose, same
     *  sim time — which is the only honest comparison. */
    setBlastDistort: (on: boolean) => { ctx.render.postAa.setBlastDistort(on); return ctx.render.postAa.blastDistort; },
    get blastDistort() { return ctx.render.postAa.blastDistort; },
    get blastDistortStrength() { return ctx.render.postAa.blastDistortStrength; },
    get blastDistortCount() { return ctx.render.postAa.blastDistortCount; },
    /** The RESOLVED blast-refraction slots the last blit pushed — the seam a
     *  capture rig reads to prove the band is centred on the blast (task-2). */
    blastDistortInfo: () => ctx.render.postAa.blastDistortSlots,
    get smear() { return ctx.render.postAa.smear; },
    get vhs() { return ctx.render.postAa.vhs; },
    /** The live term values — the preset's, until a slider or setVhsTerm
     *  overrides one. Symmetric with `vhs`, so a capture script can read the
     *  whole look back without driving a setter. */
    get vhsTerms() { return ctx.render.postAa.vhsTerms; },
    get effectiveSmear() { return ctx.render.postAa.effectiveSmear; },
    // ---------------------------------------------------------------
    // C2 HALF-RATE — march every other frame, reproject the held march
    // in between (sdf-layer.ts header). Default OFF; the look verdict is
    // the owner's, from the capture reel.
    // ---------------------------------------------------------------
    setHalfRate: (on: boolean) => ctx.render.sdfLayer.setHalfRate(on),
    get halfRate() { return ctx.render.sdfLayer.halfRate; },
    /** 0 = hold only, 1 = per-pixel depth reproject (default). */
    setHalfRateMode: (n: number) => ctx.render.sdfLayer.setHalfRateMode(n),
    get halfRateMode() { return ctx.render.sdfLayer.halfRateMode; },
    /** Tube bone look: { stain 0..1 toward deepColor, wet 0..1 blood tint on highlights, spec gain, fres gain }. */
    setBoneLook: (o: { stain?: number; wet?: number; spec?: number; fres?: number }) => {
      const l = ctx.render.boneInstancer.uniforms.look.value;
      if (o.stain !== undefined) l.x = o.stain; if (o.wet !== undefined) l.y = o.wet;
      if (o.spec !== undefined) l.z = o.spec; if (o.fres !== undefined) l.w = o.fres;
      return { stain: l.x, wet: l.y, spec: l.z, fres: l.w };
    },
    get boneMesh() { return ctx.render.boneMesh; },
    skeletonMesh: () => ctx.render.segMeshRenderer ? { mode: ctx.render.skeletonMode, ...ctx.render.segMeshRenderer.stats, cacheEntries: ctx.render.segMeshCache!.size, cacheTotals: ctx.render.segMeshCache!.totals, cacheStats: ctx.render.segMeshCache!.stats() } : null,
    /** Perf round 2, task 5: the front-to-back per-body passes and their
     *  accumulated-depth gate. OFF restores the single-pass march. */
    setDepthGate(on: boolean) { ctx.render.sdfLayer.setDepthGate(on); },
    get depthGate() { return ctx.render.sdfLayer.depthGate; },
    /** Close-up task 3: the quarter-res depth prepass and the march's
     *  consumption of it. OFF (ship default) is bit-identical to the
     *  pre-task-3 frame; the census and the bench decide the flip. */
    setDepthPrepass(on: boolean) { ctx.render.sdfLayer.setDepthPreEnabled(on); },
    /** Temporal reprojection start (plan 2026-09-10): rays start at last
     *  frame's reprojected hit minus `margin` m (0.25 ships) and `slope`.
     *  Off is bit-identical. */
    setTemporalStart: (on: boolean, margin?: number, slope?: number) => { ctx.render.sdfLayer.setTemporalStart(on, margin, slope); return ctx.render.sdfLayer.temporalStart; },
    /** Temporal accumulation of the marched flesh (?accum). OFF is the plain
     *  low-res march. Turning it on turns the field weave off and the history is
     *  re-seeded, so the first frame of the new epoch is independent of the old
     *  one — see the frame-hash decision note. */
    /** Run 5 refine pass (spec 2026-09-13 §4). setRefine throws unless the boot allocated it (?refine=1). */
    setRefine: (on: boolean) => { ctx.render.sdfLayer.setRefine(on); return ctx.render.sdfLayer.refine; },
    setRefineView: (on: boolean) => { ctx.render.sdfLayer.setRefineView(on); return ctx.render.sdfLayer.refineView; },
    setRefineCfg: (cfg: { reject?: number; normalEps?: number; steps?: number }) => { ctx.render.sdfLayer.setRefineCfg(cfg); return ctx.render.sdfLayer.refineCfg; },
    /** Run 5b: the per-body distance band. Clamped: near >= 0, far > near, hysteresis >= 0. */
    setRefineBand: (band: { near?: number; far?: number; hysteresis?: number }) => {
      const near = Math.max(0, band.near ?? ctx.render.refineBand.near);
      const far = Math.max(near + 1e-6, band.far ?? ctx.render.refineBand.far);
      const hysteresis = Math.max(0, band.hysteresis ?? ctx.render.refineBand.hysteresis);
      ctx.render.refineBand.near = near; ctx.render.refineBand.far = far; ctx.render.refineBand.hysteresis = hysteresis;
      return { ...ctx.render.refineBand };
    },
    refineBand: () => ({ ...ctx.render.refineBand }),
    setTemporalAccum: (on: boolean, alpha?: number) => ctx.render.sdfLayer.setTemporalAccum(on, alpha),
    resetTemporalAccum: () => ctx.render.sdfLayer.resetTemporalAccum(),
    /** P3 A/B state: the mode U last selected, and the loaded model's store name. */
    upscaleAb: () => ({ active: ctx.render.upscaleAb.config !== null, mode: ctx.render.upscaleAb.mode, model: ctx.render.upscaleAb.modelName }),
    /** Stage state plus the camera's near/far (what rgbd depth linearization uses).
     *  near/far are reported even when the stage is off (the capture script needs them). */
    /** Whether the layer allocated the march normal attachment this boot (rgbn/rgbdn models). */
    upscaleNormalsAllocated: (): boolean => ctx.render.sdfLayer.marchNormalTexture !== null,
    /** Post-sharpen over the stage output, 0..1 (owner experiment 2026-09-12; `?upscalesharpen=`). */
    setUpscaleSharpen: (strength: number): number => {
      const st = ctx.render.sdfLayer.upscaleStage;
      if (!st) return 0;
      st.setSharpen(strength);
      return st.sharpen;
    },
    /** 'cas' | 'unsharp' (see UpscaleStage.setSharpenMode; `?upscalesharpenmode=`). */
    setUpscaleSharpenMode: (mode: 'cas' | 'unsharp'): string => {
      const st = ctx.render.sdfLayer.upscaleStage;
      if (!st) return 'off';
      st.setSharpenMode(mode);
      return st.sharpenMode;
    },
    setUpscaleEmptyTileCulling: (enabled: boolean): boolean => {
      ctx.render.sdfLayer.upscaleStage?.setEmptyTileCulling(enabled);
      return ctx.render.sdfLayer.upscaleStage?.emptyTileCulling ?? false;
    },
    upscaleInfo: () => ({
      ...ctx.render.sdfLayer.upscaleInfo,
      near: (camera as THREE.PerspectiveCamera).near,
      far: (camera as THREE.PerspectiveCamera).far,
    }),
    /** NEURAL UPSCALE P3 capture (spec 2026-09-11-neural-upscale-p3-training-design.md §1).
     *  A fixed sub-pixel march jitter in output px, or null. Returns false when refused. */
    setMarchJitter: (x: number | null, y = 0) => ctx.render.sdfLayer.setMarchJitter(x === null ? null : [x, y]),
    get temporalAccum() { return ctx.render.sdfLayer.temporalAccum; },
    get temporalStart() { return ctx.render.sdfLayer.temporalStart; },
    get depthPrepass() { return ctx.render.sdfLayer.depthPreEnabled; },
    get boneCull() { return ctx.render.boneCull; },
    get boneCullMode() { return ctx.render.boneCullMode; },
    /** A/B seam: rebuild the SHADOW hull with spanning off (the pre-fix
     *  bead-chain) or on. Pair it with refreshHull() — and use it INSTEAD of
     *  a two-build cross-load A/B, which the wander makes untrustworthy. */
    setShadowSpan: (on: boolean, inflate?: number) => ctx.render.occluderHull.setShadowSpan(on, inflate),
    /** A/B seam for the shadow hull's junction bridges (the shoulder-shadow
     *  pinch fix). Pair with refreshHull() — and use it INSTEAD of a
     *  cross-load A/B, which the wander makes untrustworthy. */
    setShadowBridges: (on: boolean) => ctx.render.occluderHull.setShadowBridges(on),
    /** SSCS live tuning: setSscsTerm('strength', 0.5) etc. Clamped to
     *  SSCS_TERM_RANGES. Pair with ?frozen=1 for single-variable captures. */
    setSscsTerm: (name: keyof SscsTerms, value: number) => {
      ctx.render.postAa.setSscsTerm(name, value);
      return ctx.render.postAa.sscsTerms;
    },
    get sscsTerms() { return ctx.render.postAa.sscsTerms; },
    get sdfScale() { return ctx.render.sdfScale; },
    get sdfTarget() { return ctx.render.sdfLayer.targetSize; },
    /** Adaptive resolution ladder — default OFF so the chosen rung ships. */
    /** A/B seam for the actor visibility cull (ships ON). The bench's
     *  `actor-cull-off` leg is the "before" column. */
    /** 'off' | 'sdf' (flesh only) | 'frame' (whole picture). */
    setFieldStyle: (style: 'off' | 'sdf' | 'bodies' | 'frame') => ctx.render.sdfLayer.setFieldStyle(style),
    get fieldStyle() { return ctx.render.sdfLayer.fieldStyle; },
    setFieldMode: (on: boolean) => ctx.render.sdfLayer.setFieldMode(on),
    get fieldMode() { return ctx.render.sdfLayer.fieldMode; },
    setFieldComb: (v: number) => ctx.render.sdfLayer.setFieldComb(v),
    /** THE INTERLACED FIELD DIVISOR (deeper interlace fields, 2026-09-10).
     *  2 = shipped; 3 and 4 are owner-approved on screen, which is where they
     *  must be judged — the arithmetic is not the decision. Returns what it
     *  ACTUALLY set, because `frame` refuses anything but 2 (its weave still
     *  hardcodes two fields) and a silent no-op would read as success. */
    setFieldCount: (n: number) => ctx.render.sdfLayer.setFieldCount(n),
    get fieldCount() { return ctx.render.sdfLayer.fieldCount; },
    get fieldComb() { return ctx.render.sdfLayer.fieldComb; },
    setAdaptive(on: boolean, budgetMs?: number) {
      ctx.render.adaptiveEnabled = on;
      if (budgetMs !== undefined) ctx.render.adaptiveBudgetMs = budgetMs;
      ctx.render.adaptiveState = initialAdaptiveState(performance.now(), ctx.render.adaptiveState.rung);
      ctx.render.adaptiveFrames.length = 0;
    },
    get adaptive() {
      return {
        enabled: ctx.render.adaptiveEnabled,
        budgetMs: ctx.render.adaptiveBudgetMs,
        rung: ctx.render.adaptiveState.rung,
        scale: scaleForRung(ctx.render.adaptiveState.rung),
        ladder: [...SCALE_LADDER],
      };
    }
  };
}
