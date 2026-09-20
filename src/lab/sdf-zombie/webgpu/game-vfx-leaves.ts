// src/lab/sdf-zombie/webgpu/game-vfx-leaves.ts
//
// Extracted from game-main.ts's main() closure. Each function takes the
// GameContext explicitly instead of capturing main()'s scope.
//
// Plan: docs/superpowers/plans/2026-09-17-game-main-decomposition.md


import { type GameContext } from './game-context';
import * as THREE from 'three/webgpu';
import { woundEmitAnchorAndNormal } from '../bleed-registry';
import { characterEntry } from '../character-registry';
import { type Wound } from '../damage';
import { detachGutChain, makeGutChain } from '../entrails';
import { shouldSpill } from '../entrails-spawn';
import { type BurstVisual } from '../explosion-aoe';
import { compileCharacterSheet } from './character-view';
import { type ZombieActor } from './game-actor';
import { rngStreams } from './rng';
import { type WoundTuningValues } from './wound-panel';
import { type ZombieGpuView } from './zombie-gpu';
import { createImpactSplashLayer } from './impact-splash';

export function faceFor(ctx: GameContext, name: string) {
  const hit = ctx.vfx.faceCache.get(name);
  if (hit) return hit;
  const sheet = compileCharacterSheet(characterEntry(name));
  if (sheet.error) {
    console.error(`[sdf-game] ${name}: sheet block failed to compile, falling `
      + `back to the zombie face. Fix it:\n  ${sheet.error}`);
  }
  const f = sheet.face;
  const tex = new THREE.TextureLoader().load(f.url);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.flipY = true;
  const [x, y, w, h, sw, sh] = f.rect;
  const entry = {
    tex,
    atlas: new THREE.Vector4(w / sw, h / sh, x / sw, y / sh),
    mean: f.mean,
  };
  ctx.vfx.faceCache.set(name, entry);
  return entry;
}

/** Push the panel's tissue ramp into one view's surfCfg3, plus the cavity
 *  pair. Component order is pinned by zombie-gpu's uniform table (x
 *  depthAmp, y fat, z muscle, w visceraAmp) — the same order applyMaterial
 *  writes the material defaults, so this is a re-apply, not a second
 *  writer with its own opinion. visceraDepth is its own uniform. Until
 *  entrails task 7 w stayed where applyMaterial left it; the panel's
 *  viscera knob now owns it, and its default (1) matches the preset, so
 *  an untouched panel still shades identically. */
export function applyWoundRamp(ctx: GameContext, view: ZombieGpuView): void {
  const c = view.uniforms.surfCfg3.value;
  c.x = ctx.vfx.woundTuning.woundDepthAmp;
  c.y = ctx.vfx.woundTuning.fatDepth;
  c.z = ctx.vfx.woundTuning.muscleDepth;
  c.w = ctx.vfx.woundTuning.visceraAmp;
  view.uniforms.visceraDepth.value = ctx.vfx.woundTuning.visceraDepth;
  // organAmp rides the same re-apply (organs r3): applyMaterial stamps the
  // preset default on every rebuild, so the panel's value must be
  // re-stamped after it or a cast rebuild would silently reset the knob.
  view.uniforms.organAmp.value = ctx.vfx.woundTuning.organAmp;
  // MEAT DETAIL (2026-09-12): the four MEAT sliders → meatCfg (x amp, y clot, z glint, w crevice).
  view.uniforms.meatCfg.value.set(ctx.vfx.woundTuning.meatAmp, ctx.vfx.woundTuning.meatClot, ctx.vfx.woundTuning.meatGlint, ctx.vfx.woundTuning.meatCrevice);
}

/** The applied tuning record plus body 1's live surfCfg3 — the shader
 *  truth half of the seam's woundTuning getter/setWoundTuning return, so
 *  "did the slider reach the field" is one read, not a hope. */
export function woundTuningNow(ctx: GameContext): WoundTuningValues & { surfCfg3: number[] | null } {
  const c = ctx.world.actors[0]?.view.uniforms.surfCfg3.value;
  return { ...ctx.vfx.woundTuning, surfCfg3: c ? [c.x, c.y, c.z, c.w] : null };
}

/** The resolver's `BurstVisual` with the owner's size multiplier applied —
 *  the ONE place `?fxsize` enters, for all three modes. The procedural module
 *  reads the height it is handed times its own `fireScale`, which is left at
 *  1.0 on this page precisely so this line is the only multiplier (see the
 *  setTuning comment above: applying it in both places made the procedural
 *  burst 2.38x smaller than the atlas it is the reference against). */
export function scaleBurstVisual(ctx: GameContext, visual: BurstVisual): BurstVisual {
  return { ...visual, heightM: visual.heightM * ctx.vfx.size };
}

/** The one spill decision, taken at stamp time where cluster membership is
 *  free. Call for EVERY stamped wound (live fire routes through
 *  registerBleed; the capture twins stamp through stampBlast, so they call
 *  this directly). Rolls bleedRng — see the freeze note on registerBleed. */
export function spillVerdict(ctx: GameContext, a: ZombieActor, wound: Wound): void {
  const entry = ctx.vfx.gutRopes.get(a.id);
  const verdict = shouldSpill(wound, entry !== undefined, rngStreams.bleed);
  if (verdict === 'none') return;
  if (verdict === 'tear') {
    // Keep the entry: the detached chain keeps falling/settling in
    // stepGutRopes, and its presence still blocks a second rope.
    if (entry) ctx.vfx.gutRopes.set(a.id, { ...entry, chain: detachGutChain(entry.chain) });
    return;
  }
  const { anchor } = woundEmitAnchorAndNormal(a.posed().prims, wound, a.pose().yaw);
  ctx.vfx.gutRopes.set(a.id, {
    chain: makeGutChain(anchor, {
      coilTightness: ctx.vfx.woundTuning.coilTightness,
      springiness: ctx.vfx.woundTuning.springiness,
    }),
    wound, droplets: [],
  });
}

/** Create the splash layer on first enable only, sharing the flesh/goo
 *  light uniform NODES so it is lit by the same rig. Returns silently if
 *  there is no actor view yet (the same pre-condition the goo layer has). */
export function ensureImpactSplashLayer(ctx: GameContext): void {
  if (ctx.panels.impactSplashLayer) return;
  const v = ctx.world.actors[0]?.view;
  if (!v) return;
  ctx.panels.impactSplashLayer = createImpactSplashLayer({
    rig: {
      lightDir: v.uniforms.lightDir,
      keyColor: v.uniforms.keyColor,
      lightCfg: v.uniforms.lightCfg,
    },
  });
  ctx.boot.handle.scene.add(ctx.panels.impactSplashLayer.object);
}

export const TRAIL_STREAM_BASE = 0x40000000;

export function trailStreamId(ctx: GameContext, chunkId: number): number {
  return TRAIL_STREAM_BASE + (chunkId >>> 0);
}
