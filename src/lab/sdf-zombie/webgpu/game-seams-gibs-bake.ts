// src/lab/sdf-zombie/webgpu/game-seams-gibs-bake.ts
//
// Members lifted verbatim out of game-main.ts's `window.__sdfGame` literal.
// Every one needed nothing but the GameContext, so this factory takes no deps.
//
// Plan: docs/superpowers/plans/2026-09-17-game-main-decomposition.md

import type { GameContext } from './game-context';
import { type Vec3 } from '../types';
import { headPopDebris } from '../head-pop';
import { cancelChunkBake, spawnGoreShowcase } from './game-bake-leaves';
import { igniteExplosionLight } from './game-dynamite-leaves';
import { ensureCarvedLibrary, ensureGibAssets, ensureGibAtlas, gibAssetArmed } from './game-gibs-leaves';
import { updateHud } from './game-panels-leaves';
import { laySpriteBench } from './game-render-leaves';
import { scaleBurstVisual } from './game-vfx-leaves';
import { setSpritePiecesVisible } from './gib-sprite-pieces';
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
    /** HEAD-POP SHOWCASE: the cultist head-pop debris (head-pop.ts) laid AT
     *  REST 0.9 m in front of the player, spread in a row, from the head of
     *  actor `id` (default: the first actor with glowing eyes) — for looking at
     *  the eyeballs and bits without chasing them through the air. */
    headPopShowcase: (id?: number) => {
      const a = id !== undefined ? ctx.world.actors.find(q => q.id === id)
        : ctx.world.actors.find(q => q.posed().prims.some(p => p.limb === 'head' && (p.glow ?? 0) > 0));
      if (!a || !ctx.boot.onGoreDispatch) return null;
      const head = a.posed().prims.filter(p => p.limb === 'head' && !p.dead);
      let cx = 0, cy = 0, cz = 0;
      for (const p of head) { cx += (p.a[0] + p.b[0]) / 2; cy += (p.a[1] + p.b[1]) / 2; cz += (p.a[2] + p.b[2]) / 2; }
      const c: Vec3 = [cx / head.length, cy / head.length, cz / head.length];
      const pl = ctx.player.player;
      const fwd: Vec3 = [Math.sin(pl.yaw), 0, -Math.cos(pl.yaw)];
      const at: Vec3 = [pl.pos[0] + fwd[0] * 0.9, 0.9, pl.pos[2] + fwd[2] * 0.9];
      const d: Vec3 = [at[0] - c[0], at[1] - c[1], at[2] - c[2]];
      const mv = (v: Vec3): Vec3 => [v[0] + d[0], v[1] + d[1], v[2] + d[2]];
      const prims = head.map(p => ({ ...p, a: mv(p.a), b: mv(p.b) }));
      const pieces = headPopDebris({ origin: at, prims }, fwd, () => 0.5);
      const right: Vec3 = [Math.cos(pl.yaw), 0, Math.sin(pl.yaw)];
      pieces.forEach((pc, i) => {
        const off = (i - (pieces.length - 1) / 2) * 0.12;
        const sh: Vec3 = [right[0] * off, 0, right[2] * off];
        pc.origin = [pc.origin[0] + sh[0], pc.origin[1], pc.origin[2] + sh[2]];
        pc.prims = pc.prims.map(p => ({ ...p, a: [p.a[0] + sh[0], p.a[1], p.a[2] + sh[2]], b: [p.b[0] + sh[0], p.b[1], p.b[2] + sh[2]] }));
        pc.vel = [0, 0, 0]; pc.angVel = [0, 0, 0];
      });
      ctx.boot.onGoreDispatch(a, pieces);
      return pieces.length;
    },
    /** Live (flying) / baked (settled) gib-piece counts — a driver's check that
     *  a gore spawn (the cultist's head pop, head-pop.ts) actually landed. */
    chunkCounts: () => ({ live: ctx.bake.liveChunks.length, baked: ctx.bake.chunks.length, views: ctx.bake.views.length }),
    /** LAY THE SPRITE GIB BENCH in front of the player (loads the dev-only atlas
     *  on first use). Returns the number of billboards. */
    gibSpriteBench: async (which: 'placeholder' | 'sheet' = ctx.gibs.atlasSource) => {
      await ensureGibAtlas(ctx, which);
      return laySpriteBench(ctx);
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
  };
}
