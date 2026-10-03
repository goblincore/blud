// src/lab/sdf-zombie/webgpu/normal-gradient-probe.wgsl.ts
//
// WGSL for normal-gradient-probe.ts (normal-gradient-check.html), kept apart
// from the page module so tests can import it without a browser. The probe
// renders the REAL applyWounds beside ngWounds; when either one's signature or
// the globals it reads change, this is where the probe has to follow.
import { APPLY_WOUNDS, FOLD_GROUP, HASH13, NOISE3, SAMPLE_VOLUME, SMAX, SMIN } from './march.wgsl';
import { NG_WOUND_LIP, NG_WOUNDS, NORMAL_GRADIENT_HELPERS } from './normal-gradient.wgsl';

// Private globals applyWounds / ngWounds read but do not declare themselves.
// The real march gets them from FOLD_GROUP (instance + per-ray wound list) and
// SAMPLE_VOLUME (debug counters); the probe includes neither, so it copies
// those exact declaration lines out of the real sources — a renamed or retyped
// global throws here instead of drifting. The leading fn is three's wgslFn
// parse contract (every source starts at fn), as in normal-gradient.wgsl.ts.
export const PROBE_WOUND_GLOBALS = ['gInstWoundCount', 'gInstYaw', 'gBand', 'gWoundListOn', 'gWoundN', 'gWoundList', 'gDebugMode', 'gDebugWoundRows'] as const;
export function probeWoundGlobalsSource(): string {
  const decls = PROBE_WOUND_GLOBALS.map(name => {
    const line = [FOLD_GROUP, SAMPLE_VOLUME]
      .flatMap(src => src.split('\n'))
      .find(l => l.startsWith(`var<private> ${name}:`));
    if (!line) throw new Error(`normal-gradient probe: no var<private> ${name} in the march sources`);
    return line;
  });
  return `fn ngProbeGlobals() -> f32 { return 0.0; }\n${decls.join('\n')}`;
}

/** The probe's wound entry: the REAL applyWounds (8 args incl. band) beside ngWounds. */
export const NG_WOUND_PROBE = /* wgsl */ `fn ngWoundProbe(p: vec3<f32>, base: vec4<f32>, data: texture_2d<f32>, cfg: vec4<f32>, cfg2: vec4<f32>, perf: vec4<f32>, bound: vec4<f32>, kind: f32) -> vec4<f32> {
    let reset = ngReset();
    // applyWounds counts rows by the instance record, not cfg.x (crowd records).
    gInstWoundCount = cfg.x;
    let incoming = vec4<f32>(base.x + dot(base.yzw, p), base.yzw);
    if (kind > 1.5) { let scalar = applyWounds(incoming.x, p, data, cfg, cfg2, perf, bound, gBand); return vec4<f32>(scalar.x, scalar.y, 0.0, 0.0); }
    let result = ngWounds(incoming, p, data, cfg, cfg2, perf, bound);
    if (kind > 0.5) { return vec4<f32>(f32(gNgReason), gNgLip, gNgNear, 0.0); }
    return result;
  }`;

/** ngWoundProbe's include chain, in declaration order (noise3: ragged craters). */
export function probeWoundSources(): string[] {
  return [probeWoundGlobalsSource(), SMIN, SMAX, HASH13, NOISE3, APPLY_WOUNDS, ...NORMAL_GRADIENT_HELPERS, NG_WOUND_LIP, NG_WOUNDS];
}
