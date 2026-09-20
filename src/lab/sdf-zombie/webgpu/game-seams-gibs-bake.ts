// src/lab/sdf-zombie/webgpu/game-seams-gibs-bake.ts
//
// Members lifted verbatim out of game-main.ts's `window.__sdfGame` literal.
// Every one needed nothing but the GameContext, so this factory takes no deps.
//
// Plan: docs/superpowers/plans/2026-09-17-game-main-decomposition.md

import type { GameContext } from './game-context';
import { type Vec3 } from '../types';
import { cancelChunkBake, spawnGoreShowcase } from './game-bake-leaves';
import { igniteExplosionLight } from './game-dynamite-leaves';
import { ensureCarvedLibrary, ensureGibAssets, ensureGibAtlas, gibAssetArmed } from './game-gibs-leaves';
import { updateHud } from './game-panels-leaves';
import { laySpriteBench } from './game-render-leaves';
import { scaleBurstVisual } from './game-vfx-leaves';
import { spawnBurstStandIn } from './game-weapon-leaves';

export function createGibsBakeSeams(ctx: GameContext) {
  const { camera } = ctx.boot.handle;
  return {
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
      for (const a of ctx.world.actors) a.view.uniforms.perfCfg.value.z = n;
      updateHud(ctx);
    },
    setChunkBake(on: boolean) {
      ctx.bake.enabled = on;
      if (!on) cancelChunkBake(ctx);
      if (on && ctx.bake.mat) ctx.bake.seed?.(ctx.bake.mat);
    },
    /** Force a burst at a point, for a capture that must not wait for a throw. */
    spawnExplosionFx: (x: number, y: number, z: number, heightM = 2, kind: 'air' | 'ground' = 'ground') => {
      const visual = { kind, at: [x, y, z] as Vec3, heightM };
      const scaled = scaleBurstVisual(ctx, visual);
      igniteExplosionLight(ctx, visual.at);
      if (ctx.vfx.explosionVfx) ctx.vfx.explosionVfx.spawn(scaled);
      else if (ctx.vfx.burstLayer) ctx.vfx.burstLayer.spawn(scaled);
      else spawnBurstStandIn(ctx, scaled.at, scaled.heightM, scaled.kind);
      return { mode: ctx.vfx.explosionVfx ? 'procedural' : ctx.vfx.burstLayer ? 'atlas' : 'standin' };
    },
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
      ctx.gibs.renderMode = mode === 'sprite' ? 'sprite'
        : mode === 'carve' ? 'carve' : mode === 'assets' ? 'assets' : 'march';
      if (ctx.gibs.renderMode === 'carve') ensureCarvedLibrary(ctx);
      if (ctx.gibs.renderMode === 'sprite') await ensureGibAtlas(ctx, 'sheet');
      // The asset path is a fetch+decode; await it so a caller can tell "mode
      // on" from "mode on and armed" (the same contract as the sprite atlas).
      if (ctx.gibs.renderMode === 'assets') await ensureGibAssets(ctx);
      return { mode: ctx.gibs.renderMode, frames: ctx.gibs.atlas?.frames.length ?? 0, ready: ctx.gibs.renderMode === 'assets' ? gibAssetArmed(ctx) : ctx.gibs.atlas !== null };
    },
    /** RELAY THE GORE-PART BENCH in front of the player: meat chunks and classic
     *  bones, rendered through the real gib mesh path. Returns how many parts. */
    goreShowcase: () => spawnGoreShowcase(ctx),
    /** LAY THE SPRITE GIB BENCH in front of the player (loads the dev-only atlas
     *  on first use). Returns the number of billboards. */
    gibSpriteBench: async (which: 'placeholder' | 'sheet' = ctx.gibs.atlasSource) => {
      await ensureGibAtlas(ctx, which);
      return laySpriteBench(ctx);
    }
  };
}
