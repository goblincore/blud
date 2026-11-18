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

/**
 * THE LOOK SPIKE'S BONES (zap-look.ts, 2026-11-18). The flat bone lost the skull's features (sockets, nose,
 * teeth, jaw). Variants b and c keep two terms the flat colour threw away: the bone's own lit colour, as a
 * compressed tone (its paint: the dark of a socket, a tooth gap, a crack), and how far the surface faces the eye
 * (its form). An eye takes the OPPOSITE of the skull round it, so the sockets read in both strobe states.
 * Both variants draw a bone's EDGE (where it turns from the eye) apart from its facing middle: that outline is
 * what carries the teeth, the jaw line and the nose.
 *   b  dark bones: the middle lifted to a dark blue by the paint, the edge darker still. The bones are also drawn
 *      thinner (deflateM along the normal), so the glowing flesh shows round them;
 *   c  outline: the bone's facing middle lets the body's glow through and its edges are dark, like an x-ray plate.
 * On a jolt both are the glow's colour scaled by the paint, with dim edges.
 */
export const ZAP_XRAY_LOOK = Object.freeze({
  /** The lit colour's luminance is compressed as l / (l + toneKnee); the paint term is paintFloor up to 1 by it. */
  toneKnee: 0.25,
  paintFloor: 0.45,
  /** Where a bone's edge starts and is full, as 1 - facing: the outline that carries the features. */
  edge: [0.15, 0.75] as const,
  /** b: the lift on the dark bone's facing middle, what is left of the dark at its edge, and how far in a bone's
   *  surface is drawn (m). */
  bLift: [0.14, 0.24, 0.46] as const,
  bEdgeDark: 0.5,
  deflateM: 0.010,
  /** c: the body's glow seen through the bone's middle. */
  cThrough: 1.1,
  /** c AT RANGE: a bone's dark edge is under a pixel from a few metres, and a see-through bone is then no bone at
   *  all. From cFarM[0] to cFarM[1] from the eye the middle goes from the body's glow to look b's dark bone. */
  cFarM: [1.6, 3.0] as const,
  /** The bright bone (the negative frame, b and c): its edge, as a share of the bright. */
  edgeDim: 0.12,
  /** An eye: the gain on the glow in the positive frame, and on the dark bone in the negative. */
  eyeBright: 1.3,
  eyeDark: 0.3,
});

const lum = (c: readonly number[]) => 0.299 * c[0]! + 0.587 * c[1]! + 0.114 * c[2]!;
const sstep = (a: number, b: number, v: number) => { const u = Math.min(1, Math.max(0, (v - a) / (b - a))); return u * u * (3 - 2 * u); };

/**
 * The bone's colour under the lane `zap` (zap-look.ts encodeZapLane) for every look variant: code 0 is
 * xrayColour. `facing` is |n . v| (1: square to the eye), `eye` true for an eyeball, `distM` the bone's distance
 * from the eye (look c's bones go dark at range).
 */
export function xrayColourLook(lit: readonly number[], zap: number, facing: number, eye: boolean, distM = 0): number[] {
  const m = Math.abs(zap), code = Math.floor(m / 2), amt = m - 2 * code;
  if (code === 0) return xrayColour(lit, zap);
  const k = Math.min(1, amt * ZAP_XRAY.saturate), neg = zap < 0, L = ZAP_XRAY_LOOK;
  const bright = ZAP_LOOK.core.map(c => c * (ZAP_LOOK.gain + ZAP_LOOK.rim * 0.5));
  const dark = [...ZAP_LOOK.bone];
  const l = Math.max(0, lum(lit)), tone = l / (l + L.toneKnee), form = Math.min(1, Math.max(0, facing));
  const edge = sstep(L.edge[0], L.edge[1], 1 - form), paint = L.paintFloor + (1 - L.paintFloor) * tone;
  let to: number[];
  if (eye) to = neg ? dark.map(c => c * L.eyeDark) : bright.map(c => c * L.eyeBright);
  else if (neg) to = bright.map(c => c * paint * (1 - edge) + c * L.edgeDim * edge);
  else if (code === 1) to = dark.map((c, i) => (c + L.bLift[i]! * paint) * (1 - edge) + c * L.bEdgeDark * edge);
  else {
    const far = sstep(L.cFarM[0], L.cFarM[1], distM);
    to = ZAP_LOOK.core.map((c, i) => {
      const mid = c * L.cThrough * paint * (1 - far) + (dark[i]! + L.bLift[i]! * paint) * far;
      return mid * (1 - edge) + dark[i]! * edge;
    });
  }
  return lit.map((c, i) => c * (1 - k) + to[i]! * k);
}

/** How far in (m) a bone's surface is drawn under the lane `zap`: look b alone thins the bones. */
export const xrayDeflate = (zap: number): number => (Math.floor(Math.abs(zap) / 2) === 1 ? ZAP_XRAY_LOOK.deflateM : 0);

const f = (n: number) => (Number.isInteger(n) ? `${n}.0` : `${n}`);
const v3 = (c: readonly number[]) => `vec3<f32>(${f(c[0]!)}, ${f(c[1]!)}, ${f(c[2]!)})`;

/** `n`: the vertex's world normal (any length; zero for geometry with none), `thin` 1 where look b may thin it. */
export const ZAP_XRAY_PULL_WGSL = /* wgsl */ `fn zapXrayPull(p: vec3<f32>, eye: vec3<f32>, zap: f32, n: vec3<f32>, thin: f32) -> vec3<f32> {
  if (zap == 0.0) { return p; }
  var q = p;
  let code = floor(abs(zap) * 0.5);
  if (code > 0.5 && code < 1.5) { q = p - n / max(length(n), 1e-6) * (${f(ZAP_XRAY_LOOK.deflateM)} * thin * step(1e-6, length(n))); }
  let d = q - eye;
  let l = max(length(d), 1e-4);
  let keep = max(${f(ZAP_XRAY.minKeep)}, 1.0 - ${f(ZAP_XRAY.pullM)} / l);
  return eye + d * keep;
}`;

/** `facing`: |n . v| at the fragment. `kind`: 1 for an eyeball, 0 for bone. `dist`: metres from the eye. */
export const ZAP_XRAY_COLOUR_WGSL = /* wgsl */ `fn zapXrayColour(lit: vec3<f32>, zap: f32, facing: f32, kind: f32, dist: f32) -> vec3<f32> {
  let code = floor(abs(zap) * 0.5);
  let amt = abs(zap) - 2.0 * code;
  let k = min(1.0, amt * ${f(ZAP_XRAY.saturate)});
  let bright = ${v3(ZAP_LOOK.core)} * ${f(ZAP_LOOK.gain + ZAP_LOOK.rim * 0.5)};
  let dark = ${v3(ZAP_LOOK.bone)};
  let neg = zap < 0.0;
  if (code < 0.5) { return mix(lit, select(dark, bright, neg), k); }
  // THE LOOK VARIANTS (ZAP_XRAY_LOOK): the bone keeps its paint (tone) and its form (facing).
  let l = max(dot(lit, vec3<f32>(0.299, 0.587, 0.114)), 0.0);
  let tone = l / (l + ${f(ZAP_XRAY_LOOK.toneKnee)});
  let form = clamp(facing, 0.0, 1.0);
  let edge = smoothstep(${f(ZAP_XRAY_LOOK.edge[0])}, ${f(ZAP_XRAY_LOOK.edge[1])}, 1.0 - form);
  let paint = ${f(ZAP_XRAY_LOOK.paintFloor)} + ${f(1 - ZAP_XRAY_LOOK.paintFloor)} * tone;
  var to = dark;
  if (kind > 0.5) {
    to = select(bright * ${f(ZAP_XRAY_LOOK.eyeBright)}, dark * ${f(ZAP_XRAY_LOOK.eyeDark)}, neg);
  } else if (neg) {
    to = mix(bright * paint, bright * ${f(ZAP_XRAY_LOOK.edgeDim)}, edge);
  } else if (code < 1.5) {
    to = mix(dark + ${v3(ZAP_XRAY_LOOK.bLift)} * paint, dark * ${f(ZAP_XRAY_LOOK.bEdgeDark)}, edge);
  } else {
    let far = smoothstep(${f(ZAP_XRAY_LOOK.cFarM[0])}, ${f(ZAP_XRAY_LOOK.cFarM[1])}, dist);
    let mid = mix(${v3(ZAP_LOOK.core)} * (${f(ZAP_XRAY_LOOK.cThrough)} * paint), dark + ${v3(ZAP_XRAY_LOOK.bLift)} * paint, far);
    to = mix(mid, dark, edge);
  }
  return mix(lit, to, k);
}`;
