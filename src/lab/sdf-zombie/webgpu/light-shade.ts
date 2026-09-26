// THE 4-LIGHT PRESENTATION LOOP, CPU REFERENCE (shared light list spec §4-§5). Pure. The twin of
// march/body-lights.wgsl.ts `bodyLights`: the WGSL is the shipping path; this exists so the
// presentation rules are unit-tested, and it is the Rust port's reference. Change one, change both.
//
// It reads the PACKED buffer (light-list.ts layout, light-profiles.ts lanes), so its tests pin the
// packing too. Per picked light k (index < 0 = empty slot, skipped):
//   L    = directional ? pos : normalize(pos - p)
//   Lb   = normalize(mix(L, V, viewBias))
//   wrap = max((n.Lb + floor) / (1 + floor), 0)
//   H    = normalize(Lb + V);  spec = spec x max(n.H, 0)^specPow
//   (every normalize is zero-safe, v x inverseSqrt(max(v.v, 1e-12)): a zero vector gives 0, not NaN)
//   side = max(n.L, 0);  back = clamp(-L.V x 0.5 + 0.5, 0, 1)
//   rim  = backRim x (1 - max(n.V, 0))^4 x max(side, back x 0.5) x rimTint
//   c    = rgb x weight x gain
// The cone and distance falloff are already in the CPU weight (light-pick.ts, absolute presence):
// nothing here re-evaluates them, so a light lights a body as a whole (presentingLamp's rule).
// Slot 0 also returns domL / domLb / domC / domFloor for the march's key path (domLb = slot 0's
// Lb, which its wrap and highlight use; domL the raw direction for scatter and the wound shadow). skipFirst leaves slot 0's
// diffuse and spec out (the march shades the dominant through its own key); its rim and dom* stay.

import { LIGHT_VEC4S, LIST_LIGHTS_AT, type Vec3 } from './light-list';
import { PROFILE_VEC4S } from './light-profiles';

export interface BodyLit { diffuse: Vec3; spec: Vec3; rim: Vec3; domL: Vec3; domLb: Vec3; domC: Vec3; domFloor: number }

const dot = (a: readonly number[], b: readonly number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
// Zero-safe, the WGSL's exact form: v * inverseSqrt(max(dot(v, v), 1e-12)), so a zero vector
// gives [0, 0, 0] (never NaN) and a tiny one shrinks the same way on both sides.
const normalize = (a: readonly number[]): Vec3 => { const k = 1 / Math.sqrt(Math.max(dot(a, a), 1e-12)); return [a[0]! * k, a[1]! * k, a[2]! * k]; };
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export function shadeBodyLights(p: Vec3, n: Vec3, V: Vec3, picks: ArrayLike<number>, list: Float32Array, skipFirst = false): BodyLit {
  const o: BodyLit = { diffuse: [0, 0, 0], spec: [0, 0, 0], rim: [0, 0, 0], domL: [0, 1, 0], domLb: [0, 1, 0], domC: [0, 0, 0], domFloor: 0 };
  const nv = Math.max(dot(n, V), 0);
  for (let k = 0; k < 4; k++) {
    const pv = picks[k]!;
    if (pv < 0) continue;
    const li = Math.floor(pv);
    const w = pv - li;
    const base = (LIST_LIGHTS_AT + li * LIGHT_VEC4S) * 4;
    const a = list.subarray(base, base + 4);
    const col = list.subarray(base + 4, base + 8);
    const lm = list.subarray(base + 12, base + 16);
    const pr = Math.trunc(lm[0]!) * PROFILE_VEC4S * 4;
    const pa = list.subarray(pr, pr + 4);           // gain, viewBias, floor, backKey
    const pb = list.subarray(pr + 4, pr + 8);       // backRim, spec, 0, specPow
    const pc = list.subarray(pr + 8, pr + 12);      // rimTint.rgb, 0
    const L = a[3]! > 1.5 ? [a[0]!, a[1]!, a[2]!] as Vec3 : normalize([a[0]! - p[0], a[1]! - p[1], a[2]! - p[2]]);
    const bias = pa[1]!;
    const Lb = normalize([L[0] + (V[0] - L[0]) * bias, L[1] + (V[1] - L[1]) * bias, L[2] + (V[2] - L[2]) * bias]);
    const wrap = Math.max((dot(n, Lb) + pa[2]!) / (1 + pa[2]!), 0);
    const H = normalize([Lb[0] + V[0], Lb[1] + V[1], Lb[2] + V[2]]);
    const sp = pb[1]! * Math.pow(Math.max(dot(n, H), 0), pb[3]!);
    const side = Math.max(dot(n, L), 0);
    const back = clamp01(-dot(L, V) * 0.5 + 0.5);
    const rim = pb[0]! * Math.pow(1 - nv, 4) * Math.max(side, back * 0.5);
    const g = w * pa[0]!;
    const c: Vec3 = [col[0]! * g, col[1]! * g, col[2]! * g];
    const acc = (v: Vec3, s: number, t: ArrayLike<number> = [1, 1, 1]) => {
      v[0] += c[0] * s * t[0]!; v[1] += c[1] * s * t[1]!; v[2] += c[2] * s * t[2]!;
    };
    if (!(skipFirst && k === 0)) { acc(o.diffuse, wrap); acc(o.spec, sp); }
    acc(o.rim, rim, pc);
    if (k === 0) { o.domL = L; o.domLb = Lb; o.domC = c; o.domFloor = pa[2]!; }
  }
  return o;
}
