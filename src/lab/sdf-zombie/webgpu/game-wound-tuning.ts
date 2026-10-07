// src/lab/sdf-zombie/webgpu/game-wound-tuning.ts
//
// applyWoundTuning: writes wound panel values into the game (ramp, viscera, gut ropes), rebuilding the cast when boneRatio changes.
//
// Extracted from game-main.ts's main() closure. Each function takes the
// GameContext explicitly instead of capturing main()'s scope.
//
// Plan: docs/superpowers/plans/2026-09-17-game-main-decomposition.md

import type { GameContext } from './game-context';
import { SPILL_CHANCE } from '../entrails-spawn';
import { rebuildCast } from './game-spawn';
import { applyWoundRamp } from './game-wound-vfx';
import { type WoundTuningValues } from './wound-panel';


/** The panel → field entry point, exposed on __sdfGame.setWoundTuning.
 *  The ramp trio, the viscera pair and organAmp write uniforms live; gutSize,
 *  spillChance, coilTightness and springiness take effect on the next spawn
 *  / next roll (gutSize and the spring pair only shape ropes spawned from
 *  now on — existing droplets keep their size, they are MOVED, not resized,
 *  by the frame loop); boneRatio rebuilds the cast. */
export function applyWoundTuning(ctx: GameContext, o: Partial<WoundTuningValues>): void {
  let ramp = false;
  if (o.woundDepthAmp !== undefined) { ctx.vfx.woundTuning.woundDepthAmp = o.woundDepthAmp; ramp = true; }
  if (o.fatDepth !== undefined) { ctx.vfx.woundTuning.fatDepth = o.fatDepth; ramp = true; }
  if (o.muscleDepth !== undefined) { ctx.vfx.woundTuning.muscleDepth = o.muscleDepth; ramp = true; }
  if (o.visceraAmp !== undefined) { ctx.vfx.woundTuning.visceraAmp = o.visceraAmp; ramp = true; }
  if (o.visceraDepth !== undefined) { ctx.vfx.woundTuning.visceraDepth = o.visceraDepth; ramp = true; }
  if (o.organAmp !== undefined) { ctx.vfx.woundTuning.organAmp = o.organAmp; ramp = true; }
  // MEAT DETAIL (2026-09-12): the four MEAT sliders write meatCfg live through the same re-apply.
  // (First cut forgot these four lines — the sliders moved the record and nothing reached the field.)
  for (const k of ['meatAmp', 'meatClot', 'meatGlint', 'meatCrevice'] as const) {
    if (o[k] !== undefined) { ctx.vfx.woundTuning[k] = o[k]!; ramp = true; }
  }
  if (ramp) for (const a of ctx.world.actors) applyWoundRamp(ctx, a.view);   // chunks copy the body template's meatCfg at spawn
  if (o.gutSize !== undefined) ctx.vfx.woundTuning.gutSize = o.gutSize;
  // Spring knobs (organs r3): read at makeGutChain time in spillVerdict, so
  // they shape every rope spawned from now on; existing ropes keep theirs.
  if (o.coilTightness !== undefined) ctx.vfx.woundTuning.coilTightness = o.coilTightness;
  if (o.springiness !== undefined) ctx.vfx.woundTuning.springiness = o.springiness;
  if (o.spillChance !== undefined) {
    ctx.vfx.woundTuning.spillChance = o.spillChance;
    // The roll reads the shared table (entrails-spawn.shouldSpill), so
    // overriding slug there is the whole override — no second source of
    // truth. blast spill stays 1.0.
    SPILL_CHANCE.slug = o.spillChance;
  }
  if (o.boneRatio !== undefined && o.boneRatio !== ctx.vfx.woundTuning.boneRatio) {
    ctx.render.boneRatioOverride = o.boneRatio;
    ctx.vfx.woundTuning.boneRatio = o.boneRatio;
    rebuildCast(ctx);
  }
}
