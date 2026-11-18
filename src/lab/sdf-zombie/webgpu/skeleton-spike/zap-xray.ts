// src/lab/sdf-zombie/webgpu/skeleton-spike/zap-xray.ts
//
// THE SKELETON X-RAY (spec 2026-11-17-tesla-arc-design.md): the bone meshes of a body under the tesla
// arc show through its glowing flesh. No second draw: each bone instance carries `iZap` (the body's
// zap glow, negative on a jolt), and where it is not zero the vertex is pulled toward the camera and
// the fragment is shaded flat.
//
// The pull is a scale about the eye, so a vertex stays on its own view ray: its place on screen is
// unchanged and only its depth moves. pullM clears a body's own flesh; a wall nearer than that still
// hides the bone. The maths is here in TS (tested) and in WGSL (what runs).
import { ZAP_LOOK } from '../march/body/blocks/post/zap.wgsl';

export const ZAP_XRAY = Object.freeze({
  /** How far a zapped bone is pulled toward the eye (m). */
  pullM: 0.6,
  /** The least fraction of its distance a pulled point keeps, so a near bone never crosses the eye. */
  minKeep: 0.25,
  /** The bone's colour mix is |zap| times this: flat from a glow of 0.25 up, so the skeleton holds one colour while
   *  the glow flickers under the arc (0.56 to 0.97), and still fades over the attack and the recovery. */
  saturate: 4,
});

/** `p` pulled toward `eye` when `zap` is not zero. */
export function xrayPull(p: readonly number[], eye: readonly number[], zap: number): number[] {
  if (zap === 0) return [p[0]!, p[1]!, p[2]!];
  const d = [p[0]! - eye[0]!, p[1]! - eye[1]!, p[2]! - eye[2]!];
  const l = Math.max(Math.hypot(d[0]!, d[1]!, d[2]!), 1e-4);
  const keep = Math.max(ZAP_XRAY.minKeep, 1 - ZAP_XRAY.pullM / l);
  return [eye[0]! + d[0]! * keep, eye[1]! + d[1]! * keep, eye[2]! + d[2]! * keep];
}

/** The bone's colour under a zap of `zap`: its lit colour at 0, the dark bone from |zap| = 1 / saturate up, and
 *  the glow instead of the dark on a jolt (zap < 0). */
export function xrayColour(lit: readonly number[], zap: number): number[] {
  const k = Math.min(1, Math.abs(zap) * ZAP_XRAY.saturate);
  const to = zap < 0
    ? ZAP_LOOK.core.map(c => c * (ZAP_LOOK.gain + ZAP_LOOK.rim * 0.5))
    : [...ZAP_LOOK.bone];
  // WGSL's mix: exact at both ends.
  return lit.map((c, i) => c * (1 - k) + to[i]! * k);
}

const f = (n: number) => (Number.isInteger(n) ? `${n}.0` : `${n}`);
const v3 = (c: readonly number[]) => `vec3<f32>(${f(c[0]!)}, ${f(c[1]!)}, ${f(c[2]!)})`;

export const ZAP_XRAY_PULL_WGSL = /* wgsl */ `fn zapXrayPull(p: vec3<f32>, eye: vec3<f32>, zap: f32) -> vec3<f32> {
  if (zap == 0.0) { return p; }
  let d = p - eye;
  let l = max(length(d), 1e-4);
  let keep = max(${f(ZAP_XRAY.minKeep)}, 1.0 - ${f(ZAP_XRAY.pullM)} / l);
  return eye + d * keep;
}`;

export const ZAP_XRAY_COLOUR_WGSL = /* wgsl */ `fn zapXrayColour(lit: vec3<f32>, zap: f32) -> vec3<f32> {
  let k = min(1.0, abs(zap) * ${f(ZAP_XRAY.saturate)});
  let bright = ${v3(ZAP_LOOK.core)} * ${f(ZAP_LOOK.gain + ZAP_LOOK.rim * 0.5)};
  let dark = ${v3(ZAP_LOOK.bone)};
  return mix(lit, select(dark, bright, zap < 0.0), k);
}`;
