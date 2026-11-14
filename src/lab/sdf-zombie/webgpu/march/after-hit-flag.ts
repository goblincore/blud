// src/lab/sdf-zombie/webgpu/march/after-hit-flag.ts
//
// COMPILE-TIME switch for THE AFTER-HIT STOPS (2026-11-12, a measuring tool;
// docs/dev-notes/2026-11-11-frame-breakdown/NOTES.md). On a wounded mob the shading after the hit is the larger half
// of the march. With the switch on the march carries nine extra early returns, each taken at one debug mode
// (__sdfGame.setMarchDebugMode), so timing the pass at two neighbouring modes gives the cost of what lies between:
//
//   30  after the walk and the miss discard, before anything of the hit is worked out
//   37  after the rest anchor of the hit (restPoint)
//   38  after the analytic normal (ngBody and its detail term)
//   31  after the whole shading normal: 38 and the four-tap fallback (calcNormal), the cloth folds
//   32  after the wound and char masks (woundMask, charMask)
//   33  after the tissue ramp, the cut face and the organ and bone material
//   34  after the rest of the material chain (mottle, face, grain, normal map, gore, meat, paint, burn, melt)
//   35  after the flashlight, the light list and the specular terms, before the probes
//   36  after the scatter and AO probes, the wound shadow and the level shadow, before the ambient and the compose
//   0   the whole frame
//
// Each stop returns a value built from what its stage worked out, so the compiler cannot drop or move that work
// past the return. The picture at a stop means nothing: read the pass time.
//
//   (no parameter), ?afterhit=0   off: the shader text of before the switch, byte for byte
//   ?afterhit, ?afterhit=1        on
export function afterHitOn(search: string): boolean {
  const v = new URLSearchParams(search).get('afterhit');
  return v !== null && v !== '0';
}

export const AFTER_HIT_STOPS: boolean = (() => {
  try {
    return afterHitOn((globalThis as { location?: { search?: string } }).location?.search ?? '');
  } catch {
    return false;
  }
})();

/** The WGSL of one stop (led by a newline), or nothing with the switch off. `rgb` is a vec3 expression. */
export function afterHitStop(mode: number, rgb: string, on: boolean = AFTER_HIT_STOPS): string {
  if (!on) return '';
  return `\n  if (debugCfg.x > ${(mode - 0.5).toFixed(1)} && debugCfg.x < ${(mode + 0.5).toFixed(1)}) { return vec4<f32>(${rgb}, t); }`;
}
