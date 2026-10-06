// src/lab/sdf-zombie/webgpu/march/body-lights.wgsl.ts
//
// `bodyLights` — the shared light list's 4-light presentation loop (spec §4-§5), the shipping
// path. Its CPU twin and port reference is ../light-shade.ts `shadeBodyLights`: same math, same
// lanes. Change one, change both (body-lights.wgsl.test.ts pins the lane parity).
//
// INPUTS. `picks` is the body's REC_LIGHTS vec4: four packed `index + weight` floats, weight the
// CPU's ABSOLUTE presence (cover x distance x facing, light-pick.ts), -1 empty. `lights` is the one
// storage buffer light-list.ts packs: profiles at 0..23 (3 vec4 each), header at 24, lights from
// LIST_LIGHTS_AT (4 vec4 each). The shader never re-evaluates cone or distance: those are in the
// weight, so a light lights a body as a whole (presentingLamp's rule, owner-approved).
//
// RETURN. A struct, `BodyLit`. wgslFn's parse only needs the string to BEGIN with `fn` (the
// declaration regexp is ^-anchored, and a non-builtin return type passes through as its own
// name), so the struct TRAILS the fn inside the same string: the MARCH_IN_STRUCT trailing-
// declaration pattern (body/io.wgsl.ts). WGSL module-scope declarations are order-independent,
// so the fn may name BodyLit before the struct text. BodyLit holds only plain values (no handle
// or pointer), so it is a legal struct.
//
// INCLUDING IT (Task 9 march, Task 11 bones, Task 12 chunks). It is a helper string like the
// others in helpers.ts: import BODY_LIGHTS from './body-lights.wgsl' and append it to the include
// list AFTER every helper it could need (it calls none) and before the entry that calls it. The
// march passes its light-list storage param straight through, the way it passes `probeDyn` to
// probeDynamic (a `ptr<storage, array<vec4<f32>>, read>` param). The march calls it with
// skipFirst = true (slot 0 is shaded by its own key path from domL/domC); bones and chunks false.
// In HELPERS, last (Task 9); the march light block calls it behind lightListCfg.x.
//
// domLb (Task 9 review) is slot 0's view-biased direction Lb, the one its wrap and highlight use,
// so the march's dominant honours viewBias; domL stays the raw direction for scatter and the
// wound shadow, which sample the field toward the real light. Empty slot 0: both (0, 1, 0).
//
// CALIBRATION (Task 10). lm.z is the light's bodyNorm (1 / its reference intensity, light-list.ts):
// with the profile gain it converts the list's physical rgb into the body key the old path gave.
//
// NAMING. `meta` is a WGSL reserved word, so the light's fourth vec4 is `lm`.
//
// WHERE IT MAY BE CALLED (2026-10-05, the head split's depth fault). Only under conditions every fragment of a draw
// shares (uniforms: lightListCfg), never under a per-fragment one. On Apple's GPU, when only some fragments of a
// 4 x 4 block of the target take the call, the others come back with zeroed values in the entry point (their ray and
// hit distance, so their depth is the world origin's). A copy of this function with the storage reads replaced by
// constants does not show it. A block that needs the list per fragment calls this for every fragment and gates the
// USE of the result. Record: docs/dev-notes/2026-10-04-head-split/NOTES.md, "The depth fault, bisected"; pin:
// body/blocks/light/split-glisten.wgsl.test.ts.

import { LIGHT_VEC4S, LIST_LIGHTS_AT } from '../light-list';
import { PROFILE_VEC4S } from '../light-profiles';

export const BODY_LIGHTS = /* wgsl */ `fn bodyLights(p: vec3<f32>, n: vec3<f32>, V: vec3<f32>, picks: vec4<f32>, lights: ptr<storage, array<vec4<f32>>, read>, skipFirst: bool, skipBeam: bool) -> BodyLit {
  // skipFirst leaves slot 0's diffuse and spec out of the sums (the march shades the dominant
  // through its own key path); its rim and its dom fields are still returned.
  var o: BodyLit;
  o.domL = vec3<f32>(0.0, 1.0, 0.0);
  o.domLb = vec3<f32>(0.0, 1.0, 0.0);
  let nv = max(dot(n, V), 0.0);
  for (var k = 0; k < 4; k = k + 1) {
    let pv = picks[k];
    if (pv < 0.0) { continue; }
    let li = i32(floor(pv));
    let w = fract(pv);
    let base = ${LIST_LIGHTS_AT} + li * ${LIGHT_VEC4S};
    let a = (*lights)[base];
    let col = (*lights)[base + 1];
    let lm = (*lights)[base + 3];
    let pr = i32(lm.x) * ${PROFILE_VEC4S};
    let pa = (*lights)[pr];
    let pb = (*lights)[pr + 1];
    let pc = (*lights)[pr + 2];
    // skipBeam (light layers, 'torch through the list' off): the beam light (the torch) is shaded
    // by the march's own per-pixel flashlight instead, so its slot adds nothing here.
    if (skipBeam && pb.z > 0.0) { continue; }
    // Zero-safe normalizes: v * inverseSqrt(max(dot(v, v), 1e-12)) is vec3(0) for a zero vector,
    // where normalize(0) is NaN and 0 x NaN poisons the pixel. That happens for a light exactly
    // at p, and for Lb == -V (flashlight and muzzle have viewBias 0). The CPU twin matches.
    let lv = a.xyz - p;
    let L = select(lv * inverseSqrt(max(dot(lv, lv), 1e-12)), a.xyz, a.w > 1.5);
    let lbv = mix(L, V, pa.y);
    let Lb = lbv * inverseSqrt(max(dot(lbv, lbv), 1e-12));
    let wrap = max((dot(n, Lb) + pa.z) / (1.0 + pa.z), 0.0);
    let hv = Lb + V;
    let H = hv * inverseSqrt(max(dot(hv, hv), 1e-12));
    let sp = pb.y * pow(max(dot(n, H), 0.0), pb.w);
    let side = max(dot(n, L), 0.0);
    let back = clamp(-dot(L, V) * 0.5 + 0.5, 0.0, 1.0);
    let rim = pb.x * pow(1.0 - nv, 4.0) * max(side, back * 0.5);
    let c = col.rgb * (w * pa.x * lm.z);
    if (!(skipFirst && k == 0)) {
      o.diffuse = o.diffuse + c * wrap;
      o.spec = o.spec + c * sp;
    }
    o.rim = o.rim + c * pc.rgb * rim;
    o.beam = o.beam + pb.z * dot(c, vec3<f32>(0.2126, 0.7152, 0.0722));
    // Wrap-weighted luminance, every slot (skipFirst or not) and the beam lights' share of it:
    // compose's white clip whitens only where the TORCH ALONE is that bright (owner option 3).
    let lw = dot(c, vec3<f32>(0.2126, 0.7152, 0.0722)) * wrap;
    o.lumAll = o.lumAll + lw;
    o.lumBeam = o.lumBeam + select(0.0, lw, pb.z > 0.0);
    if (k == 0) { o.domL = L; o.domLb = Lb; o.domC = c; o.domFloor = pa.z; }
  }
  return o;
}
struct BodyLit {
  diffuse: vec3<f32>,
  spec: vec3<f32>,
  rim: vec3<f32>,
  domL: vec3<f32>,
  domLb: vec3<f32>,
  domC: vec3<f32>,
  domFloor: f32,
  beam: f32,
  lumAll: f32,
  lumBeam: f32,
}`;
