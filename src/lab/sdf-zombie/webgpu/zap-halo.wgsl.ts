// src/lab/sdf-zombie/webgpu/zap-halo.wgsl.ts
//
// THE ZAP'S HALO (look spike 2026-11-18, look variant c): a soft blue-white glow round the whole of a zapped
// body, flesh and kit alike. One additive billboard at the body's centre, sized to its box; it is depth tested,
// so the body's own front (and its kit) hides the middle of it and what shows is the glow round the silhouette.
// The falloff is here; webgpu/game-zap-fx.ts places the billboard and sets its strength.
import { ZAP_LOOK } from './march/body/blocks/post/zap.wgsl';

export const ZAP_HALO = Object.freeze({
  /** The share of the body's box the billboard takes, and the metres it reaches past that on every side. */
  fit: 1,
  padM: 0.35,
  /** Gain on the glow's colour at the centre, the falloff's power, and its strength on the negative frame. */
  gain: 0.45,
  power: 2.2,
  negative: 0.12,
  /** UP CLOSE the billboard fills the view and greys the whole room behind the body. Its strength falls from full
   *  at nearM[1] from the eye to nearFloor of it at nearM[0] and nearer. */
  nearM: [1.2, 3.0] as const,
  nearFloor: 0.2,
});

/** The halo's strength for a body `distM` from the eye, on the positive or the negative (jolt) frame. */
export function zapHaloAmount(invert: boolean, distM: number): number {
  const [n0, n1] = ZAP_HALO.nearM;
  const u = Math.min(1, Math.max(0, (distM - n0) / (n1 - n0)));
  const near = ZAP_HALO.nearFloor + (1 - ZAP_HALO.nearFloor) * (u * u * (3 - 2 * u));
  return (invert ? ZAP_HALO.negative : 1) * near;
}

const f = (n: number) => (Number.isInteger(n) ? `${n}.0` : `${n}`);

/** `uv` 0..1 over the billboard; `amount` 0..1. Colour in rgb, coverage in a (additive blend). */
export const ZAP_HALO_WGSL = /* wgsl */ `fn zapHalo(uv: vec2<f32>, amount: f32) -> vec4<f32> {
  let d = length(uv * 2.0 - vec2<f32>(1.0));
  let a = pow(max(1.0 - d, 0.0), ${f(ZAP_HALO.power)}) * amount;
  return vec4<f32>(vec3<f32>(${f(ZAP_LOOK.core[0])}, ${f(ZAP_LOOK.core[1])}, ${f(ZAP_LOOK.core[2])}) * ${f(ZAP_HALO.gain)}, a);
}`;
