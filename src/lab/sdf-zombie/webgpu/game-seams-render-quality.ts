// src/lab/sdf-zombie/webgpu/game-seams-render-quality.ts
//
// Members lifted verbatim out of game-main.ts's `window.__sdfGame` literal.
// Every one needed nothing but the GameContext, so this factory takes no deps.
//
// Plan: docs/superpowers/plans/2026-09-17-game-main-decomposition.md

import type { GameContext } from './game-context';
import { clampFovDeg } from './fisheye';
import { applySdfScale, enableTrainedUpscale, fisheyeReport, sizeSdfLayer, updateUpscaleAbLabel } from './game-render-leaves';
import { ensureImpactSplashLayer } from './game-vfx-leaves';
import { shellAmpOf } from './game-world-leaves';
import { impactSplashPresets, impactSplashProfiles, resolveImpactSplashProfile, type ImpactSplashProfile, type ImpactSplashWeapon } from './impact-splash-profiles';
import { UPSCALE_SCALE, parseUpscaleConfig } from './upscale/upscale-model';
import { type UpscaleInfo } from './upscale/upscale-stage';

export function createRenderQualitySeams(ctx: GameContext) {
  const { scene, camera } = ctx.boot.handle;
  return {
    setRenderFov: (deg: number) => {
      if (Number.isFinite(deg)) {
        camera.fov = clampFovDeg(deg);
        camera.updateProjectionMatrix();
        ctx.render.postAa.setLens(camera.fov, ctx.player.centerFovDeg);
        sizeSdfLayer(ctx);
      }
      return fisheyeReport(ctx);
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
      if (o.enabled !== undefined) ctx.panels.impactSplashEnabled = o.enabled;
      if (ctx.panels.impactSplashEnabled) ensureImpactSplashLayer(ctx);
      ctx.panels.impactSplashLayer?.setVisible(ctx.panels.impactSplashEnabled);
      return {
        enabled: ctx.panels.impactSplashEnabled,
        available: ctx.panels.impactSplashLayer !== null,
        profiles: structuredClone(impactSplashProfiles),
        events: ctx.panels.impactSplashLayer?.eventCount ?? 0,
      };
    },
    /** The outer-hull shell march (shell-hull-outer.ts). Ships ON —
     *  owner-passed 2026-08-31 after the stale-hull mask fix; -40%/-54%
     *  frame time at real-render parity. This is the kill switch. */
    setShell(on: boolean) {
      ctx.render.sdfLayer.setShellEnabled(on);
      if (on) ctx.world.outerHull.update(ctx.world.actors.map(a => a.posed()), { shellAmp: shellAmpOf(ctx) });
    },
    /** NEURAL UPSCALE (spec 2026-09-11). Enabling also sets the march scale to 0.5
     *  through applySdfScale (the game's own state). `null` turns the stage off and
     *  leaves the scale alone — callers restore it. `{ model }` = random weights (cost/parity
     *  only) and returns the info. `{ trained: '<name>' }` loads a trained export from the dev
     *  model store and returns a PROMISE of the info (P3); it rejects if the model is missing or invalid. */
    setUpscale: (
      raw: { model?: string; layout?: string; inputs?: string; seed?: number; trained?: string } | null,
    ): UpscaleInfo | Promise<UpscaleInfo> => {
      if (raw === null) {
        ctx.render.upscaleAb.config = null;
        ctx.render.upscaleAb.model = null;
        ctx.render.upscaleAb.modelName = null;
        updateUpscaleAbLabel(ctx);
        return ctx.render.sdfLayer.setUpscale(null);
      }
      if (raw.trained !== undefined) return enableTrainedUpscale(ctx, raw.trained, raw.layout);
      const cfg = parseUpscaleConfig(raw);
      applySdfScale(ctx, UPSCALE_SCALE);
      const info = ctx.render.sdfLayer.setUpscale(cfg);
      ctx.render.upscaleAb.config = cfg;
      ctx.render.upscaleAb.model = null;
      ctx.render.upscaleAb.modelName = null;
      ctx.render.upscaleAb.mode = 'model';
      updateUpscaleAbLabel(ctx);
      return info;
    },
    get shell() {
      return {
        enabled: ctx.render.sdfLayer.shellEnabled,
        instances: ctx.world.outerHull.instanceCount,
        // An overflowed hull leaves flesh uncovered, which under a bounded
        // march is a HOLE, not a slightly worse bound. Never ignore this.
        overflowed: ctx.world.outerHull.overflowed,
        shellAmp: shellAmpOf(ctx),
      };
    },
    /** SDF-pass scale relative to the capped buffer (1.0 = 1:1). */
    setSdfScale: (v: number) => applySdfScale(ctx, v)
  };
}
