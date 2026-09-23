// src/lab/sdf-zombie/webgpu/march/body/blocks/loop/debug-counters.wgsl.ts
//
// Task-3 split of the march body (2026-09-19): raw-counter debug modes returned before the miss discard.
// MOVE-ONLY: spliced back into its parent string by interpolation, so the
// joined WGSL is byte-identical. See docs/dev-notes/2026-09-18-march-split/.

export const DEBUG_COUNTERS_BLOCK = /* wgsl */ `  // OCCUPANCY MODE (debugCfg.x == 4, 2026-08-31). Returns RAW COUNTERS
  // instead of a colour, and — the whole point — returns BEFORE the discard,
  // so pixels that missed still write. Channels:
  //   r = steps this ray took   g = 1 if it hit flesh, else 0
  //   b = 1 always (this fragment was rasterised and marched)
  //   a = t -- BUT DO NOT READ IT BACK AS A DISTANCE. createMarchMaterial's
  //     outputNode replaces alpha with CLIP-SPACE DEPTH, so a readback of
  //     this channel always lands in [0, 1]. (2026-09-01: that silently
  //     collapsed a whole "lost pixels by distance" histogram into the
  //     0-1 m bucket before it was caught.)
  //
  // ONE MORE BIAS, and it matters for the counts below: this returns BEFORE
  // the discard, so a MISSED ray still writes depth -- at the distance it
  // gave up, which for a near body's proxy box is nearer than a far body's
  // real hit. The missed fragment then wins the depth test and the readback
  // reports "no flesh" for a pixel the shipping render draws. Wherever proxy
  // boxes overlap, occupancy()'s hit counts are therefore a LOWER bound for
  // that reason too, on top of the overdraw one below.
  //
  // WHAT IT MEASURES, and what it does not. Summing over the target gives
  // hits/rasterised = the fraction of proxy-box screen area that actually
  // shows flesh. That is the shell march's addressable market: a bounded
  // hull never rasterises the rest. It is a LOWER BOUND on the waste,
  // because depth-testing means only the front-most body writes to a pixel —
  // where several bodies' boxes overlap, the real fragment-invocation count
  // is higher than this can see.
  //
  // Only ever read back; it does not composite to anything meaningful.
  if (debugCfg.x > 3.5 && debugCfg.x < 4.5) {
    return vec4<f32>(gDebugSteps, select(0.0, 1.0, hit), 1.0, t);
  }
  // BONE-EVAL MODE (debugCfg.x == 5, gore r3 refinement 3). Same contract as
  // occupancy above — raw counters, returned BEFORE the discard so missed
  // rays still write, alpha unusable. r = bone capsule evaluations this ray.
  // This is what the bone-fold cull must move; the timing bench could not
  // resolve the fold at all (+0.0% under a 4% spread), so the counter is the
  // measurement and the bench is only a sanity check.
  // COST CENSUS, WALK (debugCfg.x == 13, 2026-09-22). Raw counters for the
  // ray WALK only, returned before the discard so misses report:
  //   r = prim evaluations (foldGroup, incl. owner re-folds)
  //   g = wound rows walked past applyWounds' reach test
  //   b = steps + 1000 * hit + 2000 * (hit near a wound)
  //   a = clip depth (see mode 4 — not a distance)
  // Mode 14 returns the same counters after the whole post-hit chain; the
  // difference is the shading cost. Only ever read back.
  if (debugCfg.x > 12.5 && debugCfg.x < 13.5) {
    return vec4<f32>(gDebugPrims, gDebugWoundRows, gDebugSteps + select(0.0, 1000.0, hit) + select(0.0, 2000.0, hit && hitNearWound), t);
  }
  // WALK RE-FOLD STUDY (debugCfg.x == 15): r = owner re-folds attempted during the
  // walk, g = re-folds that WON (lowered the field), b = steps + 1000*hit + 2000*near.
  if (debugCfg.x > 14.5 && debugCfg.x < 15.5) {
    return vec4<f32>(gDebugRefolds, gDebugRefoldWins, gDebugSteps + select(0.0, 1000.0, hit) + select(0.0, 2000.0, hit && hitNearWound), t);
  }
  if (debugCfg.x > 4.5 && debugCfg.x < 5.5) {
    return vec4<f32>(gDebugBones, select(0.0, 1.0, hit), 1.0, t);
  }
  // VOLUME-EVAL MODE (debugCfg.x == 8): r = in-grid segment samples,
  // g = exact procedural fallbacks. Returned before discard so misses count.
  if (debugCfg.x > 7.5 && debugCfg.x < 8.5) {
    return vec4<f32>(gDebugVolumeSamples, gDebugVolumeFallbacks, select(0.0, 1.0, hit), t);
  }`;
