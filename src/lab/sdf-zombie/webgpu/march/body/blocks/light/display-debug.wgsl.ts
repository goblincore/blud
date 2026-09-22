// src/lab/sdf-zombie/webgpu/march/body/blocks/light/display-debug.wgsl.ts
//
// Task-3 split of the march body (2026-09-19): legacy display decode and debug heatmaps.
// MOVE-ONLY: spliced back into its parent string by interpolation, so the
// joined WGSL is byte-identical. See docs/dev-notes/2026-09-18-march-split/.

export const DISPLAY_DEBUG_BLOCK = /* wgsl */ `  // Legacy display look (lodCfg.y). Every flesh preset was hand-tuned in the
  // WebGL lab, which displayed the lit LINEAR value raw — no output sRGB
  // encode. This path encodes correctly, which lifts the low channels and
  // washes those presets out. Applying the sRGB EOTF (decode) here cancels
  // three's output encode exactly, so the marched flesh displays the same
  // linear values the presets were tuned against. Kill switch for the X1.3
  // retune: turn this off, retune presets through the honest chain, delete.
  if (lodCfg.y > 0.5) {
    let c = max(lit, vec3<f32>(0.0));
    let lo = c / 12.92;
    let hi = pow((c + vec3<f32>(0.055)) / 1.055, vec3<f32>(2.4));
    lit = select(hi, lo, c <= vec3<f32>(0.04045));
  }

  // PERF INSTRUMENTATION output (task 2): replace the shaded colour with
  // the counter heatmap — a two-stop blue -> yellow -> red ramp, no
  // texture. Steps normalise by the budget (marchCfg.x, 96); prims by 2000
  // (56 prims x ~35 steps as the red end). After the gamma block so the
  // ramp colours emit raw; depth (t) still goes out, so the composite's
  // depth path runs identically to a shaded frame.
  // COST CENSUS, TOTAL (debugCfg.x == 14): mode 13's counters after EVERY
  // post-hit evaluation (normal taps, AO, scatter, wound shadow). Hits only —
  // a miss has no post-hit cost. b carries steps + 1000 (hit) + 2000 (near wound).
  if (debugCfg.x > 13.5 && debugCfg.x < 14.5) {
    return vec4<f32>(gDebugPrims, gDebugWoundRows, gDebugSteps + 1000.0 + select(0.0, 2000.0, hitNearWound), t);
  }
  if (debugCfg.x > 0.5) {
    // MODE 3 (hull-holes diagnosis, 2026-08-27): heat of occT itself — the
    // distance this pixel's march will be clamped by. 0 m = blue, 4 m = red,
    // no hull = white. Shows WHICH hull surface a wounded body's pixels are
    // being cut by. Temporary diagnostic.
    if (debugCfg.x > 2.5 && debugCfg.x < 3.5) {
      let occNorm = clamp(occT / 4.0, 0.0, 1.0);
      var occCol = mix(vec3<f32>(0.05, 0.15, 0.75), vec3<f32>(0.95, 0.85, 0.15), clamp(occNorm * 2.0, 0.0, 1.0));
      occCol = mix(occCol, vec3<f32>(1.0, 1.0, 1.0), select(0.0, 1.0, occT > 3.9));
      return vec4<f32>(occCol, t);
    }
    let heatNorm = select(debugSteps / max(marchCfg.x, 1.0), debugPrims / 2000.0, debugCfg.x > 1.5);
    let rampA = vec3<f32>(0.05, 0.15, 0.75);
    let rampB = vec3<f32>(0.95, 0.85, 0.15);
    let rampC = vec3<f32>(0.85, 0.05, 0.10);
    var heatCol = mix(rampA, rampB, clamp(heatNorm * 2.0, 0.0, 1.0));
    heatCol = mix(heatCol, rampC, clamp((heatNorm - 0.5) * 2.0, 0.0, 1.0));
    return vec4<f32>(heatCol, t);
  }`;
